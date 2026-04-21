import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { shapeCreateOrGet, shapeList } from './shape.js';

// Zod v4 discriminated-union inputs per D-05, D-24.
// Create requires workspaceId (HIER-02); list accepts optional workspaceId filter.
const CreateInput = z.object({
  action: z.literal('create'),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
});
const ListInput = z.object({
  action: z.literal('list'),
  workspaceId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1),
});

const ProjectInput = z.discriminatedUnion('action', [CreateInput, ListInput, GetInput]);

/**
 * Register the `project` MCP tool (D-01, D-02, HIER-02).
 *
 * Thin Zod-validated delegate per D-33: one engine call per action, breadcrumb
 * injected via shapeCreateOrGet/shapeList, TypedError mapped via toolError.
 */
export function registerProject(server: McpServer, engine: Engine) {
  server.registerTool(
    'project',
    {
      title: 'Project',
      description: 'Manage projects within a workspace. Actions: create, list, get.',
      inputSchema: ProjectInput,
    },
    async (input) => {
      try {
        switch (input.action) {
          case 'create':
            return toolOk(
              shapeCreateOrGet(engine.createProject(input.workspaceId, input.name)),
            );
          case 'list':
            return toolOk(
              shapeList(engine.listProjects(input.workspaceId, input.limit, input.offset)),
            );
          case 'get':
            return toolOk(shapeCreateOrGet(engine.getProject(input.id)));
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
