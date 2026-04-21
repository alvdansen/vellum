import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { shapeCreateOrGet, shapeList } from './shape.js';

// Zod v4 discriminated-union inputs per D-05, D-24.
// Create requires sequenceId (HIER-04) and applies the shot regex at the Zod
// boundary for early rejection. The engine ALSO enforces the regex (D-07)
// so defence-in-depth holds even if input bypasses Zod.
const CreateInput = z.object({
  action: z.literal('create'),
  sequenceId: z.string().min(1),
  // Message set to the error code so the handler's catch block can detect this
  // specific failure and emit INVALID_SHOT_FORMAT with the proper hint.
  name: z.string().regex(/^sh\d{3,}$/, 'INVALID_SHOT_FORMAT'),
});
const ListInput = z.object({
  action: z.literal('list'),
  sequenceId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1),
});

const ShotInput = z.discriminatedUnion('action', [CreateInput, ListInput, GetInput]);

/**
 * Register the `shot` MCP tool (D-01, D-02, HIER-04, HIER-05, D-07).
 *
 * Thin Zod-validated delegate per D-33: one engine call per action, breadcrumb
 * injected via shapeCreateOrGet/shapeList, TypedError mapped via toolError.
 * Shot names are gated at BOTH the Zod boundary AND inside engine.createShot
 * so any bypass of the tool layer still fails closed.
 */
export function registerShot(server: McpServer, engine: Engine) {
  server.registerTool(
    'shot',
    {
      title: 'Shot',
      description:
        "Manage shots within a sequence. Shot names must match ^sh\\d{3,}$ (e.g. sh010, sh020). Actions: create, list, get.",
      inputSchema: ShotInput,
    },
    async (input) => {
      try {
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
            new TypedError(
              'INVALID_INPUT',
              `Invalid input at 'input.${path}' -- ${first.message}`,
            ),
          );
        }
        return toolError(err);
      }
    },
  );
}
