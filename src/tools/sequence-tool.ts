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
import {
  RenameInput,
  ArchiveInput,
  UnarchiveInput,
  HistoryInput,
  MUTATION_RAW_FIELDS,
  mutationHelpText,
  handleHierarchyMutation,
} from './hierarchy-mutation.js';

// Zod v4 discriminated-union inputs. Kept for handler-side
// re-validation; tool-layer Zod schema exposed to MCP is a raw ZodRawShape
// (RT-01). Create requires projectId (HIER-03); list accepts optional filter.
const CreateInput = z.object({
  action: z.literal('create'),
  projectId: z.string().min(1).max(MAX_ID_LENGTH),
  // DM-01: .trim() normalizes leading/trailing whitespace.
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
  projectId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
  // Archived rows are hidden by default; opt back in explicitly.
  include_archived: z.boolean().optional(),
}).strict();
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
}).strict();

const SequenceInputSchema = z.discriminatedUnion('action', [
  CreateInput,
  ListInput,
  GetInput,
  RenameInput,
  ArchiveInput,
  UnarchiveInput,
  HistoryInput,
]);

/**
 * Register the `sequence` MCP tool (HIER-03).
 *
 * Thin Zod-validated delegate: one engine call per action, breadcrumb
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
      description:
        'Manage sequences within a project. Actions: create, list, get, rename, archive, unarchive, history. ' +
        mutationHelpText('sequence'),
      // Raw ZodRawShape (RT-01): SDK wraps this into z.object(...) so
      // `tools/list` publishes real JSON-schema properties. Every field is
      // `.optional()` at this layer so the SDK's pre-handler validation never
      // short-circuits — the handler's `SequenceInputSchema.parse()` is the
      // single source of truth for shape enforcement (RT-02).
      inputSchema: z.object({
        action: z.enum(['create', 'list', 'get', 'rename', 'archive', 'unarchive', 'history']),
        // Shared rename/archive/history fields. Spread FIRST so each tool's
        // own explicit declarations win where they overlap.
        ...MUTATION_RAW_FIELDS,
        projectId: z.string().optional(),
        name: z.string().optional(),
        id: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      }).passthrough(),
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
              shapeList(engine.listSequences(input.projectId, input.limit, input.offset, { includeArchived: input.include_archived })),
            );
          case 'get':
            return toolOk(shapeCreateOrGet(engine.getSequence(input.id)));
          case 'rename':
          case 'archive':
          case 'unarchive':
          case 'history':
            // Shared across all four levels — see tools/hierarchy-mutation.ts.
            return handleHierarchyMutation(engine, 'sequence', input)!;
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
          return toolError(zodInputError(err));
        }
        return toolError(err);
      }
    },
  );
}
