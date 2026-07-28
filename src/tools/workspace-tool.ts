import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError, zodInputError } from './envelope.js';
import {
  shapeCreateOrGet,
  shapeList,
  MAX_NAME_LENGTH,
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from './shape.js';

// Zod v4 discriminated-union inputs. Kept for handler-side
// re-validation so TypeScript narrowing + exhaustiveness + action-specific
// field requirements survive; the SDK sees the raw ZodRawShape below and
// publishes a non-empty JSON schema in tools/list (RT-01).
const CreateInput = z.object({
  action: z.literal('create'),
  // DM-01: .trim() normalizes leading/trailing whitespace so `"  foo  "` and
  // `"foo"` collapse to the same UNIQUE key. Case-insensitive collapse is
  // intentionally deferred (SQLite COLLATE NOCASE requires a table rebuild).
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .refine((s) => !s.includes(' > '), {
      message: 'name cannot contain " > " (breadcrumb separator)',
    }),
}).strict();
const ListInput = z.object({
  action: z.literal('list'),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
}).strict();
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
}).strict();

const WorkspaceInputSchema = z.discriminatedUnion('action', [
  CreateInput,
  ListInput,
  GetInput,
]);

/**
 * Register the `workspace` MCP tool.
 *
 * Thin Zod-validated delegate: one engine call per action, breadcrumb
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
      inputSchema: z.object({
        action: z.enum(['create', 'list', 'get']),
        name: z.string().optional(),
        id: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      }).passthrough(),
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
          return toolError(zodInputError(err));
        }
        return toolError(err);
      }
    },
  );
}
