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

/**
 * Phase 16 / Plan 16-03 (D-PLAN-3-5 + C-05 hardening): max base64-encoded
 * manifest bytes accepted by `verify_manifest`. Pre-revision was 700 MB
 * (mirror of BUFFER_SIGNING_MAX_BYTES 500 MB + 33% base64 overhead) — too
 * lenient for the verify path. The verify payload is metadata, not asset
 * bytes; capping at 100 MB still admits any plausible JUMBF size while
 * protecting against pathological DoS (T-16-17 mitigation). Hono bodyLimit
 * MUST be ≥100 MB so HTTP transport doesn't reject before Zod runs.
 */
const MAX_VERIFY_BYTES_BASE64 = 100 * 1024 * 1024; // 100 MB

/**
 * Phase 16 / Plan 16-03 (D-CTX-4) — `export_manifest` input. Returns the
 * C2PA-signed manifest for any version_id in a structured envelope per
 * D-PROV-08. Heavy payload (full manifest bytes base64-encoded inline) —
 * the agent surface design goal is "calls return data inline, not via
 * secondary URL fetches".
 */
const ExportManifestInput = z.object({
  action: z.literal('export_manifest'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});

/**
 * Phase 16 / Plan 16-03 (D-CTX-4 + D-PLAN-3-2) — `verify_manifest` input.
 * Discriminated by FIELD presence: either {version_id} OR
 * {manifest_bytes_base64, format}. Engine resolves disk bytes + mimeType
 * for the version-id form (Plan 16-01 verifier.ts handles); the bytes form
 * skips the disk read (used by agent payloads received via base64 OR
 * redaction round-trip tests).
 *
 * D-PLAN-3-5: bytes form has a length cap to prevent oversized payloads.
 * D-PLAN-3-4: bytes form yields breadcrumb=null in the envelope (engine
 * has no version_id to resolve from).
 *
 * Both arms share `action: z.literal('verify_manifest')` — Zod's
 * discriminatedUnion REQUIRES unique action literals across arms, so we
 * compose this as a plain z.union() and embed the two arms directly into
 * the top-level VersionInputSchema below (also as a z.union, not a
 * discriminatedUnion — see VersionInputSchema comment).
 */
const VerifyManifestByVersionInput = z.object({
  action: z.literal('verify_manifest'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});

const VerifyManifestByBytesInput = z.object({
  action: z.literal('verify_manifest'),
  manifest_bytes_base64: z.string().min(1).max(MAX_VERIFY_BYTES_BASE64),
  format: z.string().min(1).max(64),
});

/**
 * Phase 16 / Plan 16-03 — top-level version input.
 *
 * Note: this WAS a `z.discriminatedUnion('action', [...])` until Phase 16
 * added the two `verify_manifest` arms. Zod's discriminatedUnion REQUIRES
 * unique discriminator literals across all arms, so we widened to a plain
 * z.union(). Runtime parse behavior is identical: each arm has unique
 * required fields (version_id vs manifest_bytes_base64+format) so callers
 * pass exactly one shape; first-matching-arm semantics resolve any
 * ambiguity in declaration order (version_id arm wins when both are
 * present — covered by Test 8 in version-tool-export-verify.test.ts).
 *
 * Trade-off (tracked in deferred-items.md): without a discriminator
 * literal, JSON-Schema generation emits `anyOf` without a `discriminator`
 * field, which makes the published MCP `tools/list` schema slightly less
 * useful for clients that auto-pick the right arm. v1.2 may switch to
 * hand-written inputSchema OR Zod v4 discriminatedUnion-with-fallback.
 */
const VersionInputSchema = z.union([
  GetInput,
  ListInput,
  DiffInput,
  ProvenanceInput,
  ExportManifestInput,
  VerifyManifestByVersionInput,
  VerifyManifestByBytesInput,
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
 *
 * Phase 14 Plan 14-05 — additive non-breaking c2pa_status field surfacing
 * the latest manifest_signed event for the version's first output (the
 * dashboard-stable download path). Three states (mirroring the
 * X-C2PA-Signing-Status HTTP header):
 *   - 'signed'   — manifest_signed event has signed=true
 *   - 'unsigned' — manifest_signed event has signed=false (carries
 *                  c2pa_status_reason)
 *   - 'unknown'  — no manifest_signed event recorded yet (legacy version,
 *                  pre-Phase-14, or download still in progress)
 *
 * The field is computed by reading outputs[0].filename (the first stored
 * filename) + calling engine.getC2paStatusForVersion(versionId, filename).
 * If outputs are empty or filename is unparseable, c2pa_status is 'unknown'.
 *
 * No new MCP top-level tool — this is purely a non-breaking envelope
 * extension on the version.get response.
 */
function shapeVersionEntity(
  result: {
    entity: VersionWithAssets;
    breadcrumb: Breadcrumb;
  },
  c2paStatus: { c2pa_status: 'signed' | 'unsigned' | 'unknown'; c2pa_status_reason: string | null },
): {
  entity: VersionWithAssets & {
    version_label: string;
    c2pa_status: 'signed' | 'unsigned' | 'unknown';
    c2pa_status_reason: string | null;
  };
  breadcrumb: Breadcrumb['entries'];
  breadcrumb_text: string;
} {
  return {
    entity: {
      ...result.entity,
      version_label: versionLabel(result.entity.version_number),
      c2pa_status: c2paStatus.c2pa_status,
      c2pa_status_reason: c2paStatus.c2pa_status_reason,
    },
    breadcrumb: result.breadcrumb.entries,
    breadcrumb_text: result.breadcrumb.text,
  };
}

/**
 * Phase 14 Plan 14-05 — resolve c2pa_status for the version's first output.
 * Returns 'unknown' when outputs_json is empty, malformed, or no
 * manifest_signed event exists for the (versionId, filename) pair.
 */
function resolveC2paStatus(
  engine: Engine,
  versionId: string,
  outputsJson: string | null,
): { c2pa_status: 'signed' | 'unsigned' | 'unknown'; c2pa_status_reason: string | null } {
  if (!outputsJson) return { c2pa_status: 'unknown', c2pa_status_reason: null };
  let parsed: Array<{ filename?: string }> = [];
  try {
    const maybe = JSON.parse(outputsJson);
    parsed = Array.isArray(maybe) ? (maybe as Array<{ filename?: string }>) : [];
  } catch {
    return { c2pa_status: 'unknown', c2pa_status_reason: null };
  }
  const filename = parsed[0]?.filename;
  if (!filename) return { c2pa_status: 'unknown', c2pa_status_reason: null };
  const status = engine.getC2paStatusForVersion(versionId, filename);
  if (status === null) return { c2pa_status: 'unknown', c2pa_status_reason: null };
  if (status.signed) return { c2pa_status: 'signed', c2pa_status_reason: null };
  return {
    c2pa_status: 'unsigned',
    c2pa_status_reason: status.status_reason || 'unknown',
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
 *
 * Phase 12 — DEMO-03 (D-CTX-4): also forwards `reproduction_divergence`,
 * which is non-null when B is reproduce-lineage AND at least one divergence
 * signal fired (sha256 mismatch or persisted partner-API warnings). Defaults
 * to `null` so the field shape is stable for non-reproduce-lineage diffs.
 */
function shapeDiffEnvelope(
  result: DiffResponse & { breadcrumb: Breadcrumb['entries']; breadcrumb_text: string },
): {
  summary: string;
  changes: DiffResponse['changes'];
  reproduction_divergence: DiffResponse['reproduction_divergence'];
  breadcrumb: Breadcrumb['entries'];
  breadcrumb_text: string;
} {
  return {
    summary: result.summary,
    changes: result.changes,
    reproduction_divergence: result.reproduction_divergence ?? null,
    breadcrumb: result.breadcrumb,
    breadcrumb_text: result.breadcrumb_text,
  };
}

/**
 * Phase 16 / Plan 16-03 (D-PROV-08) — envelope shaper for `export_manifest`.
 * Reads ExporterResult (Plan 16-01) verbatim + resolves breadcrumb via
 * engine.getVersion. Carries the FULL manifest bytes inline (base64) per
 * Plan 16-01's D-PLAN-4 — agent calls return data inline, not via
 * secondary URL fetches.
 */
function shapeExportManifestEnvelope(
  versionId: string,
  result: import('../engine/c2pa/exporter.js').ExporterResult,
  breadcrumb: Breadcrumb,
): {
  version_id: string;
  format: string;
  signed_at: string | null;
  manifest_bytes_base64: string | null;
  manifest_status: 'present' | 'absent' | 'unsupported_format';
  cert_subject: string | null;
  ingredients_summary:
    | { parent_count: 0 | 1; component_count: number; input_assertion: boolean; unavailable_count: number }
    | null;
  breadcrumb: Breadcrumb['entries'];
  breadcrumb_text: string;
} {
  return {
    version_id: versionId,
    format: result.format,
    signed_at: result.signed_at,
    manifest_bytes_base64: result.manifest_bytes_base64,
    manifest_status: result.manifest_status,
    cert_subject: result.cert_subject,
    ingredients_summary: result.ingredients_summary,
    breadcrumb: breadcrumb.entries,
    breadcrumb_text: breadcrumb.text,
  };
}

/**
 * Phase 16 / Plan 16-03 (D-PROV-08) — envelope shaper for `verify_manifest`.
 * Spreads VerificationReport verbatim + a (possibly-null) breadcrumb.
 *
 * D-PLAN-3-4: breadcrumb is NULL when caller invoked via the bytes form
 * (the engine has nothing to resolve from). The version-id form passes a
 * resolved Breadcrumb; the bytes form passes null.
 */
function shapeVerifyManifestEnvelope(
  report: import('../engine/c2pa/verifier.js').VerificationReport,
  breadcrumb: Breadcrumb | null,
): {
  valid: boolean;
  signature_status: import('../engine/c2pa/verifier.js').VerificationReport['signature_status'];
  matched_assertions: string[];
  gaps: string[];
  failures: Array<{ assertion: string; reason: string }>;
  cert_subject: string | null;
  signed_at: string | null;
  breadcrumb: Breadcrumb['entries'] | null;
  breadcrumb_text: string | null;
} {
  return {
    valid: report.valid,
    signature_status: report.signature_status,
    matched_assertions: report.matched_assertions,
    gaps: report.gaps,
    failures: report.failures,
    cert_subject: report.cert_subject,
    signed_at: report.signed_at,
    breadcrumb: breadcrumb ? breadcrumb.entries : null,
    breadcrumb_text: breadcrumb ? breadcrumb.text : null,
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
        'provenance (full chronological event timeline including workflow_json on submit and prompt_json/models_json/seed on completed events — heavy payload, explicit opt-in; tags/metadata are NOT in the event stream per D-ASST-21), ' +
        // Phase 16 / Plan 16-03 (D-CTX-4) — two new agent-surface actions.
        'export_manifest (returns the C2PA-signed manifest for a version_id in a structured envelope: {version_id, format, signed_at, manifest_bytes_base64, manifest_status: \'present\'|\'absent\'|\'unsupported_format\', cert_subject, ingredients_summary, breadcrumb} per D-PROV-08), ' +
        'verify_manifest (verifies a C2PA manifest against the configured trust root — accepts EITHER {version_id} OR {manifest_bytes_base64, format}; returns {valid, signature_status, matched_assertions, gaps, failures, cert_subject, signed_at, breadcrumb}; breadcrumb is null when called via the bytes form). ' +
        'All responses include breadcrumb + breadcrumb_text per D-22.',
      // RT-01: every field is .optional() at the ZodRawShape layer; the
      // discriminated union re-validates inside the handler (RT-02).
      inputSchema: {
        action: z.enum([
          'get', 'list', 'diff', 'provenance',
          // Phase 16 / Plan 16-03 (D-CTX-4) — two new actions; tools/list
          // surfaces them in the published JSON-Schema.
          'export_manifest', 'verify_manifest',
        ]),
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
        // Phase 16 / Plan 16-03 — verify_manifest by-bytes form. Both fields
        // are optional at the ZodRawShape layer; the inner z.union arms
        // require them together.
        manifest_bytes_base64: z.string().optional(),
        format: z.string().optional(),
      },
    },
    async (rawInput) => {
      try {
        const input = VersionInputSchema.parse(rawInput);
        switch (input.action) {
          case 'get': {
            const versionResult = engine.getVersion(input.version_id);
            const c2paStatus = resolveC2paStatus(
              engine,
              versionResult.entity.id,
              versionResult.entity.outputs_json,
            );
            return toolOk(shapeVersionEntity(versionResult, c2paStatus));
          }
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
              shapeDiffEnvelope(await engine.diffVersions(input.version_a, input.version_b)),
            );
          case 'provenance':
            return toolOk(shapeProvenanceEnvelope(engine.getProvenance(input.version_id)));
          // Phase 16 / Plan 16-03 (D-CTX-4) — two new agent-surface actions.
          case 'export_manifest': {
            const result = await engine.exportManifestForVersion(input.version_id);
            // breadcrumb resolved via engine.getVersion (same as 'get' action).
            // VERSION_NOT_FOUND would have already thrown from
            // exportManifestForVersion; if the version exists, getVersion
            // succeeds. Track in deferred-items.md if any reviewer flags the
            // double-call — v1.2 may add a getVersionWithBreadcrumb accessor.
            const versionResult = engine.getVersion(input.version_id);
            return toolOk(
              shapeExportManifestEnvelope(input.version_id, result, versionResult.breadcrumb),
            );
          }
          case 'verify_manifest': {
            // Discriminate by FIELD presence (D-PLAN-3-2). 'version_id' in
            // input matches VerifyManifestByVersionInput; otherwise it's
            // VerifyManifestByBytesInput.
            if ('version_id' in input) {
              const report = await engine.verifyManifestForVersion({
                versionId: input.version_id,
              });
              const versionResult = engine.getVersion(input.version_id);
              return toolOk(shapeVerifyManifestEnvelope(report, versionResult.breadcrumb));
            }
            // Bytes form — D-PLAN-3-4 breadcrumb is null.
            const buffer = Buffer.from(input.manifest_bytes_base64, 'base64');
            const report = await engine.verifyManifestForVersion({
              manifestBytes: buffer,
              format: input.format,
            });
            return toolOk(shapeVerifyManifestEnvelope(report, null));
          }
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
