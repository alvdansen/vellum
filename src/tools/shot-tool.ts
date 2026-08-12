import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { SHOT_NAME_REGEX, SHOT_STATUSES } from '../types/hierarchy.js';
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
// re-validation; tool-layer Zod schema exposed to MCP is a raw ZodRawShape.
// Create requires sequenceId and applies the shot regex at
// the Zod boundary for early rejection. The engine ALSO enforces the regex
// so defence-in-depth holds even if input bypasses Zod.
const CreateInput = z.object({
  action: z.literal('create'),
  sequenceId: z.string().min(1).max(MAX_ID_LENGTH),
  // .trim() normalizes leading/trailing whitespace. The regex enforces
  // the exact format AFTER trim so `"  sh010  "` is accepted as `"sh010"`.
  // Message set to the error code so the handler's catch block can detect this
  // specific failure and emit INVALID_SHOT_FORMAT with the proper hint.
  name: z
    .string()
    .trim()
    .max(MAX_NAME_LENGTH)
    .regex(SHOT_NAME_REGEX, 'INVALID_SHOT_FORMAT'),
}).strict();
const ListInput = z.object({
  action: z.literal('list'),
  sequenceId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
  // Archived rows are hidden by default; opt back in explicitly.
  include_archived: z.boolean().optional(),
}).strict();
const GetInput = z.object({
  action: z.literal('get'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
}).strict();

// Status arms wired to the pipeline
// facade (Engine.setShotStatus / getShotStatus / listShotStatusHistory).
// SHOT_STATUSES is the single source of truth for the valid status set
// (defined in src/types/hierarchy.ts alongside the ShotStatus type).
const ShotStatusEnum = z.enum(SHOT_STATUSES);

const SetStatusInput = z.object({
  action: z.literal('set_status'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
  status: ShotStatusEnum,
  changed_by: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
  // WHICH version is being approved. Only valid with status:'approved'.
  // Without it an approval records only THAT the shot was approved, never what.
  approved_version_id: z.string().min(1).max(MAX_ID_LENGTH).optional(),
}).strict();

const GetStatusInput = z.object({
  action: z.literal('get_status'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
}).strict();

const ListStatusHistoryInput = z.object({
  action: z.literal('list_status_history'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

// Render the shot's pipeline log (markdown) from append-only
// provenance. Read-only projection; no state change.
const PipelineLogInput = z.object({
  action: z.literal('pipeline_log'),
  id: z.string().min(1).max(MAX_ID_LENGTH),
}).strict();

const ShotInputSchema = z.discriminatedUnion('action', [
  CreateInput,
  ListInput,
  GetInput,
  SetStatusInput,
  GetStatusInput,
  ListStatusHistoryInput,
  PipelineLogInput,
  RenameInput,
  ArchiveInput,
  UnarchiveInput,
  HistoryInput,
]);

/**
 * Register the `shot` MCP tool.
 *
 * Thin Zod-validated delegate: one engine call per action, breadcrumb
 * injected via shapeCreateOrGet/shapeList, TypedError mapped via toolError.
 * Shot names are gated at BOTH the Zod boundary AND inside engine.createShot
 * so any bypass of the tool layer still fails closed.
 *
 * Raw ZodRawShape exposed to MCP, discriminated union
 * re-validated inside the handler so tools/list carries real properties AND
 * the handler's ZodError catch branch is reachable.
 */
export function registerShot(server: McpServer, engine: Engine) {
  server.registerTool(
    'shot',
    {
      title: 'Shot',
      description:
        "Manage shots within a sequence. Use your own shot codes — 'sh010', 'SH014', 'EP101_SH014' are all valid; the only rules are safety ones (no spaces, no '..', no leading dot, not a Windows reserved name) because the name becomes a directory. Actions: create, list, get, rename, archive, unarchive, history, set_status, get_status, list_status_history, pipeline_log. " + mutationHelpText('shot') + " set_status sets the production status — allowed values: wip, pending-review, approved, on-hold, omit. When approving, pass approved_version_id so the record says WHICH take was approved; get_status then reports approvalStale + versionsSinceApproval if newer takes have landed since (a new take never silently un-approves a shot). pipeline_log renders a per-shot pipeline log as markdown (status timeline, every take with provider/lineage/cost/outputs, incl. failed & rejected takes) projected from append-only provenance — a regenerable replacement for a hand-maintained shot log.",
      // Raw ZodRawShape: SDK wraps this into z.object(...) so
      // `tools/list` publishes real JSON-schema properties. Every field is
      // `.optional()` at this layer so the SDK's pre-handler validation never
      // short-circuits — the handler's `ShotInputSchema.parse()` is the
      // single source of truth for shape enforcement.
      inputSchema: z.object({
        action: z.enum([
          'create',
          'list',
          'get',
          'set_status',
          'get_status',
          'list_status_history',
          'pipeline_log',
        
          'rename',
          'archive',
          'unarchive',
          'history',]),
        // Shared rename/archive/history fields. Spread FIRST so each tool's
        // own explicit declarations win where they overlap.
        ...MUTATION_RAW_FIELDS,
        sequenceId: z.string().optional(),
        name: z.string().optional(),
        id: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
        // Fields used by set_status (status/changed_by/note) and
        // list_status_history (limit is shared with list above). All optional
        // at the raw layer; the discriminated-union ShotInputSchema enforces
        // per-arm shape inside the handler.
        status: z.string().optional(),
        changed_by: z.string().optional(),
        note: z.string().optional(),
        approved_version_id: z.string().optional(),
      }).passthrough(),
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
              shapeList(engine.listShots(input.sequenceId, input.limit, input.offset, { includeArchived: input.include_archived })),
            );
          case 'get':
            return toolOk(shapeCreateOrGet(engine.getShot(input.id)));
          case 'set_status':
            // The status arms wire directly to the pipeline
            // facade. The engine throws SHOT_NOT_FOUND TypedError on missing
            // shot; the outer catch's `toolError(err)` arm propagates that
            // generically (no per-arm error handling needed).
            return toolOk(
              engine.setShotStatus(
                input.id,
                input.status,
                input.changed_by ?? 'user',
                input.note,
                input.approved_version_id,
              ),
            );
          case 'get_status':
            return toolOk(engine.getShotStatus(input.id));
          case 'list_status_history':
            return toolOk(engine.listShotStatusHistory(input.id, input.limit));
          case 'pipeline_log':
            return toolOk(engine.getShotPipelineLog(input.id));
          case 'rename':
          case 'archive':
          case 'unarchive':
          case 'history':
            // Shared across all four levels — see tools/hierarchy-mutation.ts.
            return handleHierarchyMutation(engine, 'shot', input)!;
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
          // Detect the shot-regex failure by the sentinel message and re-map
          // to the precise typed code with the actionable hint.
          if (err.issues[0]?.message === 'INVALID_SHOT_FORMAT') {
            return toolError(
              new TypedError(
                'INVALID_SHOT_FORMAT',
                `Shot name does not match expected format`,
                `Shot names must match ^sh\\d{3,}$ -- e.g. 'sh010', 'sh020'`,
              ),
            );
          }
          return toolError(zodInputError(err));
        }
        return toolError(err);
      }
    },
  );
}
