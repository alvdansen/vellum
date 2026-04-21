import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { shapeCreateOrGet, shapeList } from './shape.js';

// Zod v4 discriminated-union inputs per D-05, D-24.
// Create requires projectId (HIER-03); list accepts optional projectId filter.
const CreateInput = z.object({
  action: z.literal('create'),
  projectId: z.string().min(1),
  name: z.string().min(1),
});
const ListInput = z.object({
  action: z.literal('list'),
  projectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1),
});

const SequenceInput = z.discriminatedUnion('action', [CreateInput, ListInput, GetInput]);

/**
 * Register the `sequence` MCP tool (D-01, D-02, HIER-03).
 *
 * Thin Zod-validated delegate per D-33: one engine call per action, breadcrumb
 * injected via shapeCreateOrGet/shapeList, TypedError mapped via toolError.
 */
export function registerSequence(server: McpServer, engine: Engine) {
  server.registerTool(
    'sequence',
    {
      title: 'Sequence',
      description: 'Manage sequences within a project. Actions: create, list, get.',
      inputSchema: SequenceInput,
    },
    async (input) => {
      try {
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
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          const first = err.issues[0];
          const path = first.path.join('.');
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
