import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { provenance } from './schema.js';
import type {
  ManifestSignedPayloadFields,
  ModelRef,
  ProvenanceEvent,
  SummaryGeneratedPayloadFields,
} from '../types/provenance.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Phase 14 fix MR-02: bound the manifest_signed event scan so a long-lived
 * version with many signed/skipped retries can't push the lookup into O(N)
 * territory. The newest-first ORDER BY timestamp DESC means the latest
 * matching event is overwhelmingly within the first 1-2 rows; 50 is the
 * pathological-budget ceiling. Exported for tests so a regression that drops
 * the LIMIT shows up immediately.
 */
export const MANIFEST_SIGNED_LOOKUP_LIMIT = 50;

/**
 * Phase 19 (SUM-05) — bound the summary_generated event scan analogously
 * to MANIFEST_SIGNED_LOOKUP_LIMIT. The newest-first ORDER BY timestamp DESC
 * means the latest matching cache-key tuple lives near the head; 50 is
 * the pathological-budget ceiling. Exported for tests so a regression that
 * drops the LIMIT shows up immediately.
 */
export const SUMMARY_GENERATED_LOOKUP_LIMIT = 50;

/**
 * Detect SQLite unique-constraint violations. Duplicated verbatim from
 * version-repo.ts and hierarchy-repo.ts (see 02-PATTERNS.md — intentional
 * duplication keeps repo files independent with no cross-repo coupling).
 */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  const code = e.code ?? '';
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
    if (/UNIQUE/i.test(e.message ?? '')) return true;
  }
  return false;
}

/**
 * Append-only provenance event store (D-PROV-01, D-PROV-03).
 *
 * Structural invariant: this class has NO update/delete methods. That is
 * the enforcement of D-PROV-01 — the architecture-purity test asserts
 * `db.update(` and `db.delete(` do not appear in this file. Do not add
 * them. Events for a version form an ordered audit log; states are
 * separate rows, never mutations.
 */
export type ProvenanceSubmittedPayload = { workflow_json: string };
export type ProvenanceCompletedPayload = {
  prompt_json: string | null;
  seed: number | null;
  models_json: string;
  outputs_json: string;
};
export type ProvenanceFailedPayload = { error_code: string; error_message: string };
/** Phase 13 — PROV-V-03. Sibling event written by the background fingerprinter
 *  AFTER the 'completed' event. Carries fingerprinted ModelRef[] (with
 *  `model_hash` populated on success or `model_hash_unavailable` on
 *  unreachable / unreadable). Append-only: never updates the original
 *  'completed' event. */
export type ProvenanceModelsFingerprintedPayload = { models_json: string };

/** Phase 14 — PROV-V-01. Sibling event written by Engine.signOutput AFTER
 *  the 'completed' event + 'models_fingerprinted'. Carries the JSON-encoded
 *  ManifestSignedPayloadFields in a nullable manifest_signed_json column
 *  (migration 0006). Append-only: never updates earlier rows. v1.1 scope
 *  (Concern #2): NO `sidecar` field. */
export type ProvenanceManifestSignedRowPayload = {
  manifest_signed_json: string;
};

/** Phase 19 — SUM-05. Sibling event written by Engine.summarizeVersion AFTER
 *  a successful LIVE Anthropic call + validation pass. Carries the
 *  JSON-encoded SummaryGeneratedPayloadFields in a nullable
 *  summary_generated_json column (migration 0007). Append-only — fallback
 *  paths NEVER write a row (D-VAL-2). */
export type ProvenanceSummaryGeneratedRowPayload = {
  summary_generated_json: string;
};

export type ProvenanceEventPayload =
  | ({ event_type: 'submitted' } & ProvenanceSubmittedPayload)
  | ({ event_type: 'completed' } & ProvenanceCompletedPayload)
  | ({ event_type: 'failed' } & ProvenanceFailedPayload)
  | ({ event_type: 'models_fingerprinted' } & ProvenanceModelsFingerprintedPayload)
  | ({ event_type: 'manifest_signed' } & ProvenanceManifestSignedRowPayload)
  | ({ event_type: 'summary_generated' } & ProvenanceSummaryGeneratedRowPayload);

export class ProvenanceRepo {
  constructor(private db: Db) {}

  /** Insert one event. Generates id + timestamp. Returns the inserted row. */
  insertEvent(versionId: string, payload: ProvenanceEventPayload): ProvenanceEvent {
    const row: ProvenanceEvent = {
      id: newId('prov'),
      version_id: versionId,
      event_type: payload.event_type,
      workflow_json: payload.event_type === 'submitted' ? payload.workflow_json : null,
      prompt_json: payload.event_type === 'completed' ? payload.prompt_json : null,
      seed: payload.event_type === 'completed' ? payload.seed : null,
      // Phase 13 — both 'completed' and 'models_fingerprinted' carry models_json.
      // Discriminated-union narrowing keeps strict TS happy while letting the
      // sibling fingerprinted row reuse the existing models_json column.
      models_json:
        payload.event_type === 'completed' || payload.event_type === 'models_fingerprinted'
          ? payload.models_json
          : null,
      outputs_json: payload.event_type === 'completed' ? payload.outputs_json : null,
      error_code: payload.event_type === 'failed' ? payload.error_code : null,
      error_message: payload.event_type === 'failed' ? payload.error_message : null,
      // Phase 14 — PROV-V-01. The 'manifest_signed' event_type carries its
      // payload in the new manifest_signed_json column (migration 0006).
      manifest_signed_json:
        payload.event_type === 'manifest_signed' ? payload.manifest_signed_json : null,
      // Phase 19 — SUM-05. The 'summary_generated' event_type carries its
      // payload in the new summary_generated_json column (migration 0007).
      summary_generated_json:
        payload.event_type === 'summary_generated' ? payload.summary_generated_json : null,
      timestamp: Date.now(),
    };
    try {
      this.db.insert(provenance).values(row).run();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TypedError('INVALID_INPUT', `provenance event id collision: ${row.id}`);
      }
      throw err;
    }
    return row;
  }

  /** All events for a version, oldest first. Uses idx_provenance_version_time. */
  getEventsForVersion(versionId: string): ProvenanceEvent[] {
    return this.db
      .select()
      .from(provenance)
      .where(eq(provenance.version_id, versionId))
      .orderBy(provenance.timestamp)
      .all() as ProvenanceEvent[];
  }

  /** Latest `completed` event for a version; null if none. */
  getLatestCompletedEvent(versionId: string): ProvenanceEvent | null {
    const rows = this.db
      .select()
      .from(provenance)
      .where(and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'completed')))
      .orderBy(desc(provenance.timestamp))
      .limit(1)
      .all() as ProvenanceEvent[];
    return rows[0] ?? null;
  }

  /** Single `submitted` event for a version (exactly one per version by design); null if none. */
  getSubmitEvent(versionId: string): ProvenanceEvent | null {
    const rows = this.db
      .select()
      .from(provenance)
      .where(and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'submitted')))
      .limit(1)
      .all() as ProvenanceEvent[];
    return rows[0] ?? null;
  }

  /** Phase 13 — PROV-V-03. `appendModelsFingerprintedEvent` writes an
   *  append-only sibling event carrying the background-fingerprinted models.
   *  Caller (Engine.fingerprintModelsForVersion) guarantees idempotency by
   *  checking for an existing event first. The original 'completed' event
   *  row stays byte-identical (T-13-07 mitigation). */
  appendModelsFingerprintedEvent(versionId: string, models: ModelRef[]): ProvenanceEvent {
    return this.insertEvent(versionId, {
      event_type: 'models_fingerprinted',
      models_json: JSON.stringify(models),
    });
  }

  /** Phase 13 — PROV-V-03. `getLatestFingerprints` returns the latest
   *  fingerprinted ModelRef[] for a version, falling back to the latest
   *  'completed' event's models_json when the fingerprinter has not yet run.
   *  Returns null when neither source yields a parseable array (legacy /
   *  malformed / pre-Phase-13 rows). T-13-12 mitigation: catches JSON.parse
   *  / non-array errors so downstream consumers (Phase 14 C2PA manifest) get
   *  a clean null signal rather than a partially-parsed object. */
  getLatestFingerprints(versionId: string): ModelRef[] | null {
    const fingerprinted = this.db
      .select()
      .from(provenance)
      .where(
        and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'models_fingerprinted')),
      )
      .orderBy(desc(provenance.timestamp))
      .limit(1)
      .all() as ProvenanceEvent[];
    const source = fingerprinted[0] ?? this.getLatestCompletedEvent(versionId);
    if (!source?.models_json) return null;
    try {
      const parsed = JSON.parse(source.models_json);
      if (!Array.isArray(parsed)) return null;
      return parsed as ModelRef[];
    } catch {
      return null;
    }
  }

  /** Phase 14 — PROV-V-01. `appendManifestSignedEvent` writes an
   *  append-only sibling event carrying the outcome of an Engine.signOutput
   *  call. Mirrors Phase 13's appendModelsFingerprintedEvent shape exactly.
   *  Uses the new manifest_signed_json column (migration 0006). NEVER carries
   *  key material — only the cert subject summary derived from the cert's
   *  public DN (Plan 14-02 loadSigner with RFC4514-safe parser).
   *
   *  v1.1 scope (Concern #2): NO `sidecar` field — c2pa-node v0.5.26 has no
   *  sidecar API. EXR/PSD surface as signed=false / status_reason='unsupported_format'
   *  with the original file untouched on disk. */
  appendManifestSignedEvent(
    versionId: string,
    payload: ManifestSignedPayloadFields,
  ): ProvenanceEvent {
    return this.insertEvent(versionId, {
      event_type: 'manifest_signed',
      manifest_signed_json: JSON.stringify(payload),
    });
  }

  /**
   * Phase 16 / Plan 16-02 (D-CTX-5) — sibling-row helper for redacted writes.
   *
   * Behaviorally identical to appendManifestSignedEvent: serialises the payload
   * via JSON.stringify into manifest_signed_json. The DIFFERENCE is the
   * payload shape carries redacted=true + redacted_fields[]. Centralising
   * the helper lets test harnesses + Engine.redactManifestForVersion share
   * one writer; pre-Phase-16 callers continue using appendManifestSignedEvent
   * unchanged (additive surface, no migration).
   *
   * Append-only invariant: NEVER updates the original (un-redacted) row.
   * The redacted row is a SIBLING with later timestamp; getLatestManifestSignedEvent
   * returns the redacted row first (DESC by timestamp).
   *
   * C-02 fix: the redacted=true GUARD runs BEFORE insertEvent. payload.redacted !== true
   * REJECTS pre-commit — the row is never inserted, the caller's atomic-write
   * disk overwrite has not corrupted append-only state.
   */
  appendManifestSignedRedactedEvent(
    versionId: string,
    payload: ManifestSignedPayloadFields,
  ): ProvenanceEvent {
    // Defensive (C-02): assert the caller actually flagged redacted=true.
    // Guard runs BEFORE insertEvent so on misuse no row is committed.
    if (payload.redacted !== true) {
      throw new Error(
        'appendManifestSignedRedactedEvent called with payload.redacted !== true — use appendManifestSignedEvent for non-redacted writes',
      );
    }
    return this.insertEvent(versionId, {
      event_type: 'manifest_signed',
      manifest_signed_json: JSON.stringify(payload),
    });
  }

  /** Phase 14 — PROV-V-01. Returns the most recent manifest_signed event for
   *  a version+filename pair, or null. Used by Engine.signOutput's idempotency
   *  guard (Concern #7) and by the HTTP layer's X-C2PA-Signing-Status header
   *  (Plan 14-04). Filters in-memory rather than via JSON path expressions —
   *  the per-version event count is small (a handful of events per version),
   *  so a full scan-and-decode is cheap and avoids relying on SQLite's
   *  json_extract availability across builds.
   *
   *  Phase 14 fix MR-02: bounded scan via LIMIT MANIFEST_SIGNED_LOOKUP_LIMIT.
   *  The existing `idx_provenance_version_time` (version_id, timestamp) index
   *  covers the WHERE + ORDER BY, and SQLite walks the index in reverse for
   *  the DESC order. The newest-first ordering means the matching filename is
   *  overwhelmingly within the first 1-2 rows; capping at 50 prevents the
   *  recovery-poller multi-attempt scenario from O(N) scanning across all
   *  signed/skipped events for a long-lived version. Versions emitting more
   *  than MANIFEST_SIGNED_LOOKUP_LIMIT events for a single filename are
   *  considered pathological — diagnostic flag, not a normal operating state. */
  getLatestManifestSignedEvent(
    versionId: string,
    filename: string,
  ): ManifestSignedPayloadFields | null {
    const rows = this.db
      .select()
      .from(provenance)
      .where(
        and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'manifest_signed')),
      )
      .orderBy(desc(provenance.timestamp))
      .limit(MANIFEST_SIGNED_LOOKUP_LIMIT)
      .all() as ProvenanceEvent[];
    for (const row of rows) {
      if (!row.manifest_signed_json) continue;
      try {
        const parsed = JSON.parse(row.manifest_signed_json) as ManifestSignedPayloadFields;
        if (parsed.filename === filename) return parsed;
      } catch {
        // Malformed payload — skip and keep walking newer-to-older. T-13-12
        // mitigation parity: callers see a clean null signal rather than a
        // partially-parsed object.
        continue;
      }
    }
    return null;
  }

  /**
   * Phase 19 — SUM-05. appendSummaryGeneratedEvent writes an
   * append-only sibling event carrying the verified-good Anthropic LLM
   * output. Mirrors Phase 14's appendManifestSignedEvent shape exactly.
   *
   * Cache-key composite (manifest_sha256, template_version, model_id) lives
   * INSIDE the JSON payload — readers compose the lookup at the engine layer.
   *
   * NEVER carries raw API key material — the engine's flattenAnthropicError
   * (Plan 19-04) + sanitizer multi-encoding leak scan (Plan 19-02) run BEFORE
   * this writer.
   */
  appendSummaryGeneratedEvent(
    versionId: string,
    payload: SummaryGeneratedPayloadFields,
  ): ProvenanceEvent {
    return this.insertEvent(versionId, {
      event_type: 'summary_generated',
      summary_generated_json: JSON.stringify(payload),
    });
  }

  /**
   * Phase 19 — SUM-05. Bounded-scan composite-key lookup.
   * LIMIT-50 + in-memory JSON filter mirrors getLatestManifestSignedEvent at
   * lines 265-291 above. Returns the latest 'summary_generated' row for
   * (versionId, manifestSha256, templateVersion, modelId) — null when no
   * matching row exists within the bounded scan.
   *
   * Cache-key invariant: Phase 16 redact mutates manifest_sha256, so a
   * post-redact lookup misses the pre-redact cache row "for free" without
   * explicit invalidation logic. Plan 19-04 composes the lookup tuple at the
   * engine boundary (manifest_sha256 from getLatestManifestSignedEvent;
   * template_version from src/engine/summary/template.ts; model_id from
   * SUMMARY_MODEL_ID).
   */
  getLatestSummaryGeneratedEvent(
    versionId: string,
    manifestSha256: string,
    templateVersion: string,
    modelId: string,
  ): SummaryGeneratedPayloadFields | null {
    const rows = this.db
      .select()
      .from(provenance)
      .where(
        and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'summary_generated')),
      )
      .orderBy(desc(provenance.timestamp))
      .limit(SUMMARY_GENERATED_LOOKUP_LIMIT)
      .all() as ProvenanceEvent[];
    for (const row of rows) {
      if (!row.summary_generated_json) continue;
      try {
        const parsed = JSON.parse(row.summary_generated_json) as SummaryGeneratedPayloadFields;
        if (
          parsed.manifest_sha256 === manifestSha256 &&
          parsed.template_version === templateVersion &&
          parsed.model_id === modelId
        ) {
          return parsed;
        }
      } catch {
        // Malformed payload — skip and keep walking newer-to-older.
        continue;
      }
    }
    return null;
  }
}
