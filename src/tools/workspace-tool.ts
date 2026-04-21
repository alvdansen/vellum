import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { shapeCreateOrGet, shapeList } from './shape.js';

// Zod v4 discriminated-union inputs per D-05, D-24.
const CreateInput = z.object({
  action: z.literal('create'),
  name: z.string().min(1),
});
const ListInput = z.object({
  action: z.literal('list'),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1),
});

const WorkspaceInput = z.discriminatedUnion('action', [CreateInput, ListInput, GetInput]);

/**
 * Register the `workspace` MCP tool (D-01, D-02).
 *
 * Thin Zod-validated delegate per D-33: one engine call per action, breadcrumb
 * injected via shapeCreateOrGet/shapeList, TypedError mapped via toolError.
 * No business logic, no repo access.
 */
export function registerWorkspace(server: McpServer, engine: Engine) {
  server.registerTool(
    'workspace',
    {
      title: 'Workspace',
      description:
        'Manage workspaces (top-level hierarchy container). Actions: create, list, get.',
      inputSchema: WorkspaceInput,
    },
    async (input) => {
      try {
        switch (input.action) {
          case 'create':
            return toolOk(shapeCreateOrGet(engine.createWorkspace(input.name)));
          case 'list':
            return toolOk(shapeList(engine.listWorkspaces(input.limit, input.offset)));
          case 'get':
            return toolOk(shapeCreateOrGet(engine.getWorkspace(input.id)));
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
