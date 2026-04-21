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
// re-validation so TypeScript narrowing + exhaustiveness + action-specific
// field requirements survive; the SDK sees the raw ZodRawShape below and
// publishes a non-empty JSON schema in tools/list (RT-01).
const CreateInput = z.object({
  action: z.literal('create'),
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
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
});
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
});

const WorkspaceInputSchema = z.discriminatedUnion('action', [
  CreateInput,
  ListInput,
  GetInput,
]);

/**
 * Register the `workspace` MCP tool (D-01, D-02).
 *
 * Thin Zod-validated delegate per D-33: one engine call per action, breadcrumb
 * injected via shapeCreateOrGet/shapeList, TypedError mapped via toolError.
 * No business logic, no repo access.
 *
 * RT-01/RT-02: `inputSchema` is a raw `ZodRawShape` (union of all fields across
 * actions, optional where only relevant to some). The MCP SDK wraps this into a
 * `z.object(...)` at registration time so `tools/list` publishes real properties.
 * Inside the handler we re-validate with the discriminated union — this is how
 * the `instanceof z.ZodError` branch becomes reachable (the SDK's prior
 * validation passed because all fields are optional at the raw-shape level).
 */
export function registerWorkspace(server: McpServer, engine: Engine) {
  server.registerTool(
    'workspace',
    {
      title: 'Workspace',
      description:
        'Manage workspaces (top-level hierarchy container). Actions: create, list, get.',
      // Raw ZodRawShape (RT-01): SDK wraps this into z.object(...) so
      // `tools/list` publishes real JSON-schema properties. Every field is
      // `.optional()` at this layer so the SDK's pre-handler validation never
      // short-circuits — the handler's `WorkspaceInputSchema.parse()` is the
      // single source of truth for shape enforcement (RT-02).
      inputSchema: {
        action: z.enum(['create', 'list', 'get']),
        name: z.string().optional(),
        id: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      },
    },
    async (rawInput) => {
      try {
        const input = WorkspaceInputSchema.parse(rawInput);
        switch (input.action) {
          case 'create':
            return toolOk(shapeCreateOrGet(engine.createWorkspace(input.name)));
          case 'list':
            return toolOk(shapeList(engine.listWorkspaces(input.limit, input.offset)));
          case 'get':
            return toolOk(shapeCreateOrGet(engine.getWorkspace(input.id)));
          default: {
            const _exhaustive: never = input;
            throw new TypedError(
              'INVALID_INPUT',
              `Unhandled workspace action: ${String(_exhaustive)}`,
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
