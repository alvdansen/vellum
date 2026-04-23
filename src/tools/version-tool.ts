import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';
import { toolOk, toolError } from './envelope.js';
import { versionLabel } from '../utils/outputs.js';
import {
  shapeList,
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from './shape.js';
import type { Breadcrumb } from '../types/hierarchy.js';
import type { VersionWithAssets } from '../types/assets.js';
import type { ProvenanceEvent, DiffResponse } from '../types/provenance.js';

/**
 * D-PROV-07, D-PROV-08: `version get` — cheap metadata payload. Returns the
 * raw Version row + a derived `version_label` + breadcrumb envelope. Heavy
 * provenance fields (workflow_json / prompt_json) are reached via the
 * explicit `version provenance` opt-in (D-PROV-10).
 */
const GetInput = z.object({
  action: z.literal('get'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});

/**
 * D-PROV-09: `version list` — paginated list of versions for a shot, ordered
 * version_number DESC at the repo layer (Plan 02 `VersionRepo.listByShot`).
 * limit defaults to 20 (Phase 1 D-24), capped at MAX_PAGE_SIZE.
 */
const ListInput = z.object({
  action: z.literal('list'),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
  // Phase 4 — D-ASST-20: opt-in hydration for version list items. Default
  // false keeps the list payload cheap; setting either (or both) asks the
  // engine to emit tags: string[] and/or metadata: Array<{key, value}> per
  // item. The `get` action is always-hydrated (D-ASST-19) — no such flag there.
  include_tags: z.boolean().default(false),
  include_metadata: z.boolean().default(false),
});

/**
 * D-PROV-11: `version diff` — two-version comparison. Cross-shot constraint
 * (D-PROV-20) is enforced by the pure diffVersions engine, NOT at this
 * boundary. Not-completed sources (D-PROV-19) surface as VERSION_NOT_COMPLETED.
 */
const DiffInput = z.object({
  action: z.literal('diff'),
  version_a: z.string().min(1).max(MAX_ID_LENGTH),
  version_b: z.string().min(1).max(MAX_ID_LENGTH),
});

/**
 * D-PROV-10: `version provenance` — full chronological event history. Heavy
 * payload (workflow_json + prompt_json + models_json per applicable event).
 */
const ProvenanceInput = z.object({
  action: z.literal('provenance'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});

const VersionInputSchema = z.discriminatedUnion('action', [
  GetInput,
  ListInput,
  DiffInput,
  ProvenanceInput,
]);

/**
 * D-PROV-08 + D-ASST-19: shape a Version entity for `get` responses. Adds
 * `version_label` (mirrors generation-tool's derivation). Does NOT parse
 * outputs_json — `version get` is the cheap-metadata action; heavy payload
 * lives on `version provenance`. outputs_json is still present on the entity
 * when populated — downstream consumers can read it as the raw column — but
 * the tool does not synthesize a typed `outputs` array at this surface.
 *
 * Phase 4: the engine (Plan 04-03) now returns VersionWithAssets on getVersion
 * so the `...result.entity` spread carries `tags: string[]` and
 * `metadata: Array<{key, value}>` through automatically. Body is unchanged
 * from Phase 3 — only the type annotation widens to VersionWithAssets.
 */
function shapeVersionEntity(result: {
  entity: VersionWithAssets;
  breadcrumb: Breadcrumb;
}): {
  entity: VersionWithAssets & { version_label: string };
  breadcrumb: Breadcrumb['entries'];
  breadcrumb_text: string;
} {
  return {
    entity: {
      ...result.entity,
      version_label: versionLabel(result.entity.version_number),
    },
    breadcrumb: result.breadcrumb.entries,
    breadcrumb_text: result.breadcrumb.text,
  };
}

/**
 * D-PROV-10: shape a provenance envelope. Events array is passed through
 * verbatim (ProvenanceEvent is already the column-row shape from Plan 01).
 */
function shapeProvenanceEnvelope(result: {
  events: ProvenanceEvent[];
  breadcrumb: Breadcrumb;
}): {
  events: ProvenanceEvent[];
  breadcrumb: Breadcrumb['entries'];
  breadcrumb_text: string;
} {
  return {
    events: result.events,
    breadcrumb: result.breadcrumb.entries,
    breadcrumb_text: result.breadcrumb.text,
  };
}

/**
 * D-PROV-11, D-PROV-15: pass-through shaper for diff. The Engine facade
 * already returns `breadcrumb: Breadcrumb['entries']` + `breadcrumb_text: string`
 * (NOT a nested Breadcrumb object), so no flattening is needed — just forward
 * `summary`, `changes`, and the two breadcrumb fields.
 */
function shapeDiffEnvelope(
  result: DiffResponse & { breadcrumb: Breadcrumb['entries']; breadcrumb_text: string },
): {
  summary: string;
  changes: DiffResponse['changes'];
  breadcrumb: Breadcrumb['entries'];
  breadcrumb_text: string;
} {
  return {
    summary: result.summary,
    changes: result.changes,
    breadcrumb: result.breadcrumb,
    breadcrumb_text: result.breadcrumb_text,
  };
}

/**
 * Register the `version` MCP tool (D-PROV-07).
 *
 * Thin Zod-validated delegator (D-33 / architecture-purity): every action
 * resolves to exactly one engine call. All errors from the engine are typed
 * and flow through toolError unchanged.
 *
 * RT-01/RT-02: raw ZodRawShape exposed to MCP, discriminated union
 * re-validated inside the handler so tools/list carries real JSON-schema
 * properties AND the ZodError catch branch is reachable.
 *
 * Error model:
 *  - VERSION_NOT_FOUND: any action when the id does not exist.
 *  - VERSION_NOT_COMPLETED: diff when either side has no terminal event (D-PROV-19).
 *  - INVALID_INPUT: diff cross-shot (D-PROV-20); Zod failures.
 *  - Engine never throws raw; all codes are TypedError (D-28).
 */
export function registerVersion(server: McpServer, engine: Engine) {
  server.registerTool(
    'version',
    {
      title: 'Version',
      description:
        'Inspect and compare versions. Actions: ' +
        'get (cheap metadata for a version_id — always includes inline tags: string[] (alphabetical) and metadata: Array<{key, value}> (by-key); lineage_type/parent_version_id included), ' +
        'list (paginated versions for a shot_id, ordered version_number DESC; optional include_tags and include_metadata boolean flags default false to keep default payload cheap), ' +
        'diff (same-shot structured comparison between two completed/failed versions — returns summary + changes{params, models, seed, workflow, metadata}), ' +
        'provenance (full chronological event timeline including workflow_json on submit and prompt_json/models_json/seed on completed events — heavy payload, explicit opt-in; tags/metadata are NOT in the event stream per D-ASST-21). ' +
        'All responses include breadcrumb + breadcrumb_text per D-22.',
      // RT-01: every field is .optional() at the ZodRawShape layer; the
      // discriminated union re-validates inside the handler (RT-02).
      inputSchema: {
        action: z.enum(['get', 'list', 'diff', 'provenance']),
        version_id: z.string().optional(),
        shot_id: z.string().optional(),
        version_a: z.string().optional(),
        version_b: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
        // Phase 4 — D-ASST-20: opt-in hydration flags for `list`. Unused on
        // other actions (action-discriminated re-validation inside the
        // handler drops them for get/diff/provenance).
        include_tags: z.boolean().optional(),
        include_metadata: z.boolean().optional(),
      },
    },
    async (rawInput) => {
      try {
        const input = VersionInputSchema.parse(rawInput);
        switch (input.action) {
          case 'get':
            return toolOk(shapeVersionEntity(engine.getVersion(input.version_id)));
          case 'list':
            return toolOk(
              shapeList(
                engine.listVersionsForShot(input.shot_id, input.limit, input.offset, {
                  include_tags: input.include_tags,
                  include_metadata: input.include_metadata,
                }),
              ),
            );
          case 'diff':
            return toolOk(
              shapeDiffEnvelope(engine.diffVersions(input.version_a, input.version_b)),
            );
          case 'provenance':
            return toolOk(shapeProvenanceEnvelope(engine.getProvenance(input.version_id)));
          default: {
            const _exhaustive: never = input;
            throw new TypedError(
              'INVALID_INPUT',
              `Unhandled version action: ${String(_exhaustive)}`,
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
