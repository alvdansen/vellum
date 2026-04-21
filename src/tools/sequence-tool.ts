import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
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
// (RT-01). Create requires projectId (HIER-03); list accepts optional filter.
const CreateInput = z.object({
  action: z.literal('create'),
  projectId: z.string().min(1).max(MAX_ID_LENGTH),
  name: z
    .string()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .refine((s) => !s.includes(' > '), {
      message: 'name cannot contain " > " (breadcrumb separator)',
    }),
});
const ListInput = z.object({
  action: z.literal('list'),
  projectId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
});

const SequenceInputSchema = z.discriminatedUnion('action', [
  CreateInput,
  ListInput,
  GetInput,
]);

/**
 * Register the `sequence` MCP tool (D-01, D-02, HIER-03).
 *
 * Thin Zod-validated delegate per D-33: one engine call per action, breadcrumb
 * injected via shapeCreateOrGet/shapeList, TypedError mapped via toolError.
 *
 * RT-01/RT-02: raw ZodRawShape exposed to MCP, discriminated union
 * re-validated inside the handler so tools/list carries real properties AND
 * the handler's ZodError catch branch is reachable.
 */
export function registerSequence(server: McpServer, engine: Engine) {
  server.registerTool(
    'sequence',
    {
      title: 'Sequence',
      description: 'Manage sequences within a project. Actions: create, list, get.',
      // Raw ZodRawShape (RT-01): SDK wraps this into z.object(...) so
      // `tools/list` publishes real JSON-schema properties. Every field is
      // `.optional()` at this layer so the SDK's pre-handler validation never
      // short-circuits — the handler's `SequenceInputSchema.parse()` is the
      // single source of truth for shape enforcement (RT-02).
      inputSchema: {
        action: z.enum(['create', 'list', 'get']),
        projectId: z.string().optional(),
        name: z.string().optional(),
        id: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      },
    },
    async (rawInput) => {
      try {
        const input = SequenceInputSchema.parse(rawInput);
        switch (input.action) {
          case 'create':
            return toolOk(
              shapeCreateOrGet(engine.createSequence(input.projectId, input.name)),
            );
          case 'list':
            return toolOk(
              shapeList(engine.listSequences(input.projectId, input.limit, input.offset)),
            );
          case 'get':
            return toolOk(shapeCreateOrGet(engine.getSequence(input.id)));
          default: {
            const _exhaustive: never = input;
            throw new TypedError(
              'INVALID_INPUT',
              `Unhandled sequence action: ${String(_exhaustive)}`,
            );
          }
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          const first = err.issues[0];
          const path = first.path.join('.');
          return toolError(
            new TypedError('INVALID_INPUT', `Invalid input at 'input.${path}'`),
          );
        }
        return toolError(err);
      }
    },
  );
}
