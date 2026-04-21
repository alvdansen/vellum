import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { SHOT_NAME_REGEX } from '../types/hierarchy.js';
import { toolOk, toolError } from './envelope.js';
import {
  shapeCreateOrGet,
  shapeList,
  MAX_NAME_LENGTH,
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from './shape.js';

// Zod v4 discriminated-union inputs per D-05, D-24. Kept for handler-side
// re-validation; tool-layer Zod schema exposed to MCP is a raw ZodRawShape
// (RT-01). Create requires sequenceId (HIER-04) and applies the shot regex at
// the Zod boundary for early rejection. The engine ALSO enforces the regex
// (D-07) so defence-in-depth holds even if input bypasses Zod.
const CreateInput = z.object({
  action: z.literal('create'),
  sequenceId: z.string().min(1).max(MAX_ID_LENGTH),
  // DM-01: .trim() normalizes leading/trailing whitespace. The regex enforces
  // the exact format AFTER trim so `"  sh010  "` is accepted as `"sh010"`.
  // Message set to the error code so the handler's catch block can detect this
  // specific failure and emit INVALID_SHOT_FORMAT with the proper hint.
  name: z
    .string()
    .trim()
    .max(MAX_NAME_LENGTH)
    .regex(SHOT_NAME_REGEX, 'INVALID_SHOT_FORMAT'),
});
const ListInput = z.object({
  action: z.literal('list'),
  sequenceId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
});

const ShotInputSchema = z.discriminatedUnion('action', [
  CreateInput,
  ListInput,
  GetInput,
]);

/**
 * Register the `shot` MCP tool (D-01, D-02, HIER-04, HIER-05, D-07).
 *
 * Thin Zod-validated delegate per D-33: one engine call per action, breadcrumb
 * injected via shapeCreateOrGet/shapeList, TypedError mapped via toolError.
 * Shot names are gated at BOTH the Zod boundary AND inside engine.createShot
 * so any bypass of the tool layer still fails closed.
 *
 * RT-01/RT-02: raw ZodRawShape exposed to MCP, discriminated union
 * re-validated inside the handler so tools/list carries real properties AND
 * the handler's ZodError catch branch is reachable.
 */
export function registerShot(server: McpServer, engine: Engine) {
  server.registerTool(
    'shot',
    {
      title: 'Shot',
      description:
        "Manage shots within a sequence. Shot names must match ^sh\\d{3,}$ (e.g. sh010, sh020). Actions: create, list, get.",
      // Raw ZodRawShape (RT-01): SDK wraps this into z.object(...) so
      // `tools/list` publishes real JSON-schema properties. Every field is
      // `.optional()` at this layer so the SDK's pre-handler validation never
      // short-circuits — the handler's `ShotInputSchema.parse()` is the
      // single source of truth for shape enforcement (RT-02).
      inputSchema: {
        action: z.enum(['create', 'list', 'get']),
        sequenceId: z.string().optional(),
        name: z.string().optional(),
        id: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      },
    },
    async (rawInput) => {
      try {
        const input = ShotInputSchema.parse(rawInput);
        switch (input.action) {
          case 'create':
            return toolOk(
              shapeCreateOrGet(engine.createShot(input.sequenceId, input.name)),
            );
          case 'list':
            return toolOk(
              shapeList(engine.listShots(input.sequenceId, input.limit, input.offset)),
            );
          case 'get':
            return toolOk(shapeCreateOrGet(engine.getShot(input.id)));
          default: {
            const _exhaustive: never = input;
            throw new TypedError(
              'INVALID_INPUT',
              `Unhandled shot action: ${String(_exhaustive)}`,
            );
          }
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          const first = err.issues[0];
          const path = first.path.join('.');
          // Detect the shot-regex failure by the sentinel message and re-map
          // to the precise typed code with the actionable hint.
          if (first.message === 'INVALID_SHOT_FORMAT') {
            return toolError(
              new TypedError(
                'INVALID_SHOT_FORMAT',
                `Shot name does not match expected format`,
                `Shot names must match ^sh\\d{3,}$ -- e.g. 'sh010', 'sh020'`,
              ),
            );
          }
          return toolError(
            new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}'`),
          );
        }
        return toolError(err);
      }
    },
  );
}
