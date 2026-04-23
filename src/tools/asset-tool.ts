import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { versionLabel as _versionLabel } from '../utils/outputs.js';
import {
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  MAX_TAG_LENGTH,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
  TAG_REGEX,
} from './shape.js';
import type { VersionWithAssets, ScopeFilter } from '../types/assets.js';
import type { Breadcrumb } from '../types/hierarchy.js';

// Re-export versionLabel as referenced name if future shapers need it. Kept
// referenced via underscore prefix to satisfy `noUnusedLocals` without churn.
void _versionLabel;

/**
 * Phase 4 asset tool — registers the 7-action MCP tool `asset` (D-ASST-01,
 * D-ASST-02). Thin Zod-validated delegate (D-33) to engine methods.
 *
 * Actions (discriminated on `action`):
 *  - add_tag          — idempotent tag insert, max 50 per version
 *  - remove_tag       — idempotent tag delete
 *  - set_metadata     — upsert (value + created_at refresh), max 100 per version
 *  - remove_metadata  — idempotent metadata delete
 *  - query            — AND-only filter by tags/metadata/scope/date/status
 *  - list_tags        — scope-aware tag aggregation with count DESC, name ASC
 *  - list_metadata_keys — scope-aware metadata-key aggregation
 *
 * Envelope invariants:
 *  - D-25 dual-form: every response carries {structuredContent, content:[{type,text}]}
 *  - D-22/D-ASST-04: mutator responses carry the refreshed VersionWithAssets
 *    plus breadcrumb (5 entries) + breadcrumb_text ("ws > project > seq > shot > v001")
 *  - D-ASST-05: query items each include tags + metadata + breadcrumb inline
 *  - D-ASST-06: list_tags / list_metadata_keys echo the input scope
 *  - D-28/D-32: ZodError is caught and re-wrapped as INVALID_INPUT with input.<path>;
 *    the raw Zod stack NEVER reaches the agent (T-04-04-02 mitigation)
 */

// ================================================================
// Shared Zod fragments (declared once, reused across action schemas)
// ================================================================

const VersionIdZ = z.string().min(1).max(MAX_ID_LENGTH);
const TagZ = z
  .string()
  .min(1)
  .max(MAX_TAG_LENGTH)
  .regex(TAG_REGEX, 'TAG_INVALID');
const KeyZ = z
  .string()
  .min(1)
  .max(MAX_METADATA_KEY_LENGTH)
  .regex(TAG_REGEX, 'METADATA_INVALID');
const ValueZ = z.string().min(1).max(MAX_METADATA_VALUE_LENGTH);
const StatusZ = z.enum(['submitted', 'running', 'completed', 'failed']);
const ScopeIdZ = z.string().min(1).max(MAX_ID_LENGTH).optional();

// ================================================================
// Per-action discriminated schemas (D-ASST-12..18)
// ================================================================

const AddTagInput = z.object({
  action: z.literal('add_tag'),
  version_id: VersionIdZ,
  tag: TagZ,
});

const RemoveTagInput = z.object({
  action: z.literal('remove_tag'),
  version_id: VersionIdZ,
  tag: TagZ,
});

const SetMetadataInput = z.object({
  action: z.literal('set_metadata'),
  version_id: VersionIdZ,
  key: KeyZ,
  value: ValueZ,
});

const RemoveMetadataInput = z.object({
  action: z.literal('remove_metadata'),
  version_id: VersionIdZ,
  key: KeyZ,
});

const QueryInput = z.object({
  action: z.literal('query'),
  workspace_id: ScopeIdZ,
  project_id: ScopeIdZ,
  sequence_id: ScopeIdZ,
  shot_id: ScopeIdZ,
  tags: z.array(TagZ).min(1).max(20).optional(),
  metadata: z
    .array(z.object({ key: KeyZ, value: ValueZ }))
    .min(1)
    .max(20)
    .optional(),
  date_from: z.number().int().nonnegative().optional(),
  date_to: z.number().int().nonnegative().optional(),
  status: StatusZ.optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
});

const ListTagsInput = z.object({
  action: z.literal('list_tags'),
  workspace_id: ScopeIdZ,
  project_id: ScopeIdZ,
  sequence_id: ScopeIdZ,
  shot_id: ScopeIdZ,
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
});

const ListMetadataKeysInput = z.object({
  action: z.literal('list_metadata_keys'),
  workspace_id: ScopeIdZ,
  project_id: ScopeIdZ,
  sequence_id: ScopeIdZ,
  shot_id: ScopeIdZ,
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
});

const AssetInputSchema = z.discriminatedUnion('action', [
  AddTagInput,
  RemoveTagInput,
  SetMetadataInput,
  RemoveMetadataInput,
  QueryInput,
  ListTagsInput,
  ListMetadataKeysInput,
]);

// ================================================================
// Response shapers — flatten Breadcrumb into {breadcrumb: entries,
// breadcrumb_text: text} on every response (D-22 invariant).
// ================================================================

/**
 * D-ASST-04: shape mutator response (add_tag / remove_tag / set_metadata /
 * remove_metadata). Engine returns a refreshed VersionWithAssets + Breadcrumb;
 * tool emits {entity, breadcrumb: BreadcrumbEntry[], breadcrumb_text: string}.
 * The engine already attaches `version_label` inside AssetsEngine.buildMutationResponse.
 */
function shapeMutationResponse(result: {
  entity: VersionWithAssets & { version_label: string };
  breadcrumb: Breadcrumb;
}) {
  return {
    entity: result.entity,
    breadcrumb: result.breadcrumb.entries,
    breadcrumb_text: result.breadcrumb.text,
  };
}

/**
 * D-ASST-05 + D-ASST-22: shape asset.query response. Items already carry
 * breadcrumb from the engine (queryAssets return type); this shaper flattens
 * each item's Breadcrumb to the standard form and emits the paginated envelope.
 */
function shapeQueryResponse(result: {
  items: (VersionWithAssets & { version_label: string; breadcrumb: Breadcrumb })[];
  total_count: number;
  limit: number;
  offset: number;
}) {
  return {
    items: result.items.map((item) => {
      const { breadcrumb, ...rest } = item;
      return {
        ...rest,
        breadcrumb: breadcrumb.entries,
        breadcrumb_text: breadcrumb.text,
      };
    }),
    total_count: result.total_count,
    limit: result.limit,
    offset: result.offset,
  };
}

/**
 * D-ASST-06: shape list_tags / list_metadata_keys response. No breadcrumb on
 * aggregate lists — scope is echoed instead so the agent can verify the intended
 * scope was used. Engine returns a concrete ScopeFilter already.
 */
function shapeTagListResponse(result: {
  items: Array<{ name: string; count: number }>;
  total_count: number;
  limit: number;
  offset: number;
  scope: ScopeFilter;
}) {
  return {
    items: result.items,
    total_count: result.total_count,
    limit: result.limit,
    offset: result.offset,
    scope: result.scope,
  };
}

// ================================================================
// registerAsset — tool registration + 7-action switch
// ================================================================

/**
 * Register the `asset` MCP tool on the supplied server (D-ASST-01). Thin
 * Zod-validated delegate (D-33) to the composed Engine's 7 asset methods.
 *
 * RT-01/RT-02: raw ZodRawShape exposed to MCP for `tools/list` introspection;
 * the discriminated union re-validates inside the handler so the ZodError catch
 * branch is reachable (defence-in-depth with the engine's own raw-JS validation).
 *
 * Error model:
 *  - ZodError       → INVALID_INPUT with `input.<path>` in message (D-32,
 *                     T-04-04-02 mitigation — no Zod stack leaks to the agent)
 *  - TypedError     → flows through toolError unchanged (D-28)
 *    (VERSION_NOT_FOUND, TAG_INVALID, METADATA_INVALID, TAG_LIMIT_EXCEEDED,
 *     METADATA_LIMIT_EXCEEDED, INVALID_SCOPE, INVALID_INPUT from engine)
 *  - Anything else  → toolError re-wraps as INVALID_INPUT (D-13 defence)
 */
export function registerAsset(server: McpServer, engine: Engine): void {
  server.registerTool(
    'asset',
    {
      title: 'Asset',
      description:
        'Tag, annotate, and search versions. ' +
        'Actions: ' +
        'add_tag (idempotent; tag must match /^[A-Za-z0-9_\\-.:]+$/, max 64 chars; max 50 tags per version), ' +
        'remove_tag (idempotent; no-op if missing), ' +
        'set_metadata (upsert; key matches tag regex, value up to 2000 chars; max 100 entries per version), ' +
        'remove_metadata (idempotent), ' +
        'query (AND-only filter by tags/metadata/scope/date_range/status; single-scope XOR: at most one of workspace_id|project_id|sequence_id|shot_id; paginated default 20 max 100; ordered created_at DESC), ' +
        'list_tags (scope-aware tag name+count aggregation, ordered count DESC, name ASC), ' +
        'list_metadata_keys (scope-aware metadata key name+count aggregation). ' +
        'All mutator responses carry the refreshed version with inline tags + metadata + breadcrumb.',
      // Raw ZodRawShape (RT-01): SDK wraps into z.object for tools/list.
      // Every field is .optional() at this layer so the SDK's pre-handler
      // validation never short-circuits — the handler's AssetInputSchema.parse()
      // is the single source of truth for shape enforcement (RT-02).
      inputSchema: {
        action: z.enum([
          'add_tag',
          'remove_tag',
          'set_metadata',
          'remove_metadata',
          'query',
          'list_tags',
          'list_metadata_keys',
        ]),
        version_id: z.string().optional(),
        tag: z.string().optional(),
        key: z.string().optional(),
        value: z.string().optional(),
        workspace_id: z.string().optional(),
        project_id: z.string().optional(),
        sequence_id: z.string().optional(),
        shot_id: z.string().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
        date_from: z.number().int().optional(),
        date_to: z.number().int().optional(),
        status: z.enum(['submitted', 'running', 'completed', 'failed']).optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      },
    },
    async (rawInput) => {
      try {
        const input = AssetInputSchema.parse(rawInput);
        switch (input.action) {
          case 'add_tag':
            return toolOk(
              shapeMutationResponse(engine.addTag(input.version_id, input.tag)),
            );
          case 'remove_tag':
            return toolOk(
              shapeMutationResponse(engine.removeTag(input.version_id, input.tag)),
            );
          case 'set_metadata':
            return toolOk(
              shapeMutationResponse(
                engine.setMetadata(input.version_id, input.key, input.value),
              ),
            );
          case 'remove_metadata':
            return toolOk(
              shapeMutationResponse(engine.removeMetadata(input.version_id, input.key)),
            );
          case 'query':
            return toolOk(
              shapeQueryResponse(
                engine.queryAssets({
                  workspace_id: input.workspace_id,
                  project_id: input.project_id,
                  sequence_id: input.sequence_id,
                  shot_id: input.shot_id,
                  tags: input.tags,
                  metadata: input.metadata,
                  date_from: input.date_from,
                  date_to: input.date_to,
                  status: input.status,
                  limit: input.limit,
                  offset: input.offset,
                }),
              ),
            );
          case 'list_tags':
            return toolOk(
              shapeTagListResponse(
                engine.listTags({
                  workspace_id: input.workspace_id,
                  project_id: input.project_id,
                  sequence_id: input.sequence_id,
                  shot_id: input.shot_id,
                  limit: input.limit,
                  offset: input.offset,
                }),
              ),
            );
          case 'list_metadata_keys':
            return toolOk(
              shapeTagListResponse(
                engine.listMetadataKeys({
                  workspace_id: input.workspace_id,
                  project_id: input.project_id,
                  sequence_id: input.sequence_id,
                  shot_id: input.shot_id,
                  limit: input.limit,
                  offset: input.offset,
                }),
              ),
            );
          default: {
            const _exhaustive: never = input;
            throw new TypedError(
              'INVALID_INPUT',
              `Unhandled asset action: ${String(_exhaustive)}`,
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
