import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { provenance } from './schema.js';
import type {
  CostRecordedPayloadFields,
  ManifestSignedPayloadFields,
  ModelRef,
  ProvenanceEvent,
  SpecBoundPayloadFields,
  SummaryGeneratedPayloadFields,
} from '../types/provenance.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Bound the manifest_signed event scan so a long-lived
 * version with many signed/skipped retries can't push the lookup into O(N)
 * territory. The newest-first ORDER BY timestamp DESC means the latest
 * matching event is overwhelmingly within the first 1-2 rows; 50 is the
 * pathological-budget ceiling. Exported for tests so a regression that drops
 * the LIMIT shows up immediately.
 */
export const MANIFEST_SIGNED_LOOKUP_LIMIT = 50;

/**
 * Bound the summary_generated event scan analogously
 * to MANIFEST_SIGNED_LOOKUP_LIMIT. The newest-first ORDER BY timestamp DESC
 * means the latest matching cache-key tuple lives near the head; 50 is
 * the pathological-budget ceiling. Exported for tests so a regression that
 * drops the LIMIT shows up immediately.
 */
export const SUMMARY_GENERATED_LOOKUP_LIMIT = 50;

/**
 * Cost actuals — bound the 'cost_recorded' scan so getLatestCostRecorded stays
 * O(1)-ish and can skip a malformed newest row to an older valid one. Corrections
 * are rare (a handful per take), so the newest valid record is within the first
 * couple of rows; 50 is the pathological ceiling. Mirrors the manifest/summary
 * lookup limits.
 */
export const COST_RECORDED_LOOKUP_LIMIT = 50;

/**
 * Spec binding — a version binds to at most ONE spec revision, written once at
 * creation, so the expected row count here is 0 or 1. The scan is bounded only
 * to survive a duplicate written by a buggy caller without an unbounded read;
 * the oldest valid row still wins (see getSpecBound).
 */
export const SPEC_BOUND_LOOKUP_LIMIT = 8;

/**
 * Detect SQLite unique-constraint violations. Duplicated verbatim from
 * version-repo.ts and hierarchy-repo.ts — intentional
 * duplication keeps repo files independent with no cross-repo coupling.
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
 * Append-only provenance event store.
 *
 * Structural invariant: this class has NO update/delete methods. The
 * architecture-purity test enforces it with a source-text scan of this
 * file for the Drizzle mutation builders and for raw UPDATE/DELETE SQL
 * naming the provenance table — a scan, not a method-name blocklist,
 * because a mutator under a novel name walked past the old blocklist
 * with the whole suite green. Do not add mutation paths under any name.
 * Events for a version form an ordered audit log; states are separate
 * rows, never mutations.
 */
export type ProvenanceSubmittedPayload = { workflow_json: string };
export type ProvenanceCompletedPayload = {
  prompt_json: string | null;
  seed: number | null;
  models_json: string;
  outputs_json: string;
  // Neutral, provider-agnostic provenance for backends with no
  // ComfyUI prompt graph (Replicate/FAL/…) and for externally-registered outputs.
  // Optional; omitted ⇒ NULL (legacy/ComfyUI completed events).
  generation_request_json?: string | null;
  generation_result_json?: string | null;
};
export type ProvenanceFailedPayload = { error_code: string; error_message: string };
/** Sibling event written by the background fingerprinter
 *  AFTER the 'completed' event. Carries fingerprinted ModelRef[] (with
 *  `model_hash` populated on success or `model_hash_unavailable` on
 *  unreachable / unreadable). Append-only: never updates the original
 *  'completed' event. */
export type ProvenanceModelsFingerprintedPayload = { models_json: string };

/** Sibling event written by Engine.signOutput AFTER
 *  the 'completed' event + 'models_fingerprinted'. Carries the JSON-encoded
 *  ManifestSignedPayloadFields in a nullable manifest_signed_json column
 *  (migration 0006). Append-only: never updates earlier rows. Deliberately
 *  NO `sidecar` field. */
export type ProvenanceManifestSignedRowPayload = {
  manifest_signed_json: string;
};

/** Sibling event written by Engine.summarizeVersion AFTER
 *  a successful LIVE Anthropic call + validation pass. Carries the
 *  JSON-encoded SummaryGeneratedPayloadFields in a nullable
 *  summary_generated_json column (migration 0007). Append-only — fallback
 *  paths NEVER write a row. */
export type ProvenanceSummaryGeneratedRowPayload = {
  summary_generated_json: string;
};

/** Cost actuals — sibling event carrying the JSON-encoded CostRecordedPayloadFields
 *  in the nullable cost_recorded_json column (migration 0011). Append-only:
 *  corrections are new sibling events; the newest wins. */
export type ProvenanceCostRecordedRowPayload = {
  cost_recorded_json: string;
};

/** Spec binding — sibling event carrying the JSON-encoded SpecBoundPayloadFields
 *  in the nullable spec_bound_json column (migration 0013). Written at most once
 *  per version, at creation, and only when the project had a spec. Append-only:
 *  a later spec revision NEVER rewrites an earlier binding — that immutability is
 *  the whole point (it is what dates a take against the spec it was made under). */
export type ProvenanceSpecBoundRowPayload = {
  spec_bound_json: string;
};

export type ProvenanceEventPayload =
  | ({ event_type: 'submitted' } & ProvenanceSubmittedPayload)
  | ({ event_type: 'completed' } & ProvenanceCompletedPayload)
  | ({ event_type: 'failed' } & ProvenanceFailedPayload)
  | ({ event_type: 'models_fingerprinted' } & ProvenanceModelsFingerprintedPayload)
  | ({ event_type: 'manifest_signed' } & ProvenanceManifestSignedRowPayload)
  | ({ event_type: 'summary_generated' } & ProvenanceSummaryGeneratedRowPayload)
  | ({ event_type: 'cost_recorded' } & ProvenanceCostRecordedRowPayload)
  | ({ event_type: 'spec_bound' } & ProvenanceSpecBoundRowPayload);

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
      // Both 'completed' and 'models_fingerprinted' carry models_json.
      // Discriminated-union narrowing keeps strict TS happy while letting the
      // sibling fingerprinted row reuse the existing models_json column.
      models_json:
        payload.event_type === 'completed' || payload.event_type === 'models_fingerprinted'
          ? payload.models_json
          : null,
      outputs_json: payload.event_type === 'completed' ? payload.outputs_json : null,
      error_code: payload.event_type === 'failed' ? payload.error_code : null,
      error_message: payload.event_type === 'failed' ? payload.error_message : null,
      // The 'manifest_signed' event_type carries its
      // payload in the manifest_signed_json column (migration 0006).
      manifest_signed_json:
        payload.event_type === 'manifest_signed' ? payload.manifest_signed_json : null,
      // The 'summary_generated' event_type carries its
      // payload in the summary_generated_json column (migration 0007).
      summary_generated_json:
        payload.event_type === 'summary_generated' ? payload.summary_generated_json : null,
      // Neutral provenance columns, populated only on 'completed'
      // events that carry them (non-ComfyUI + externally-registered outputs).
      generation_request_json:
        payload.event_type === 'completed' ? (payload.generation_request_json ?? null) : null,
      generation_result_json:
        payload.event_type === 'completed' ? (payload.generation_result_json ?? null) : null,
      // Cost actuals — populated only on 'cost_recorded' events.
      cost_recorded_json:
        payload.event_type === 'cost_recorded' ? payload.cost_recorded_json : null,
      // Spec binding — populated only on 'spec_bound' events.
      spec_bound_json: payload.event_type === 'spec_bound' ? payload.spec_bound_json : null,
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

  /** `appendModelsFingerprintedEvent` writes an
   *  append-only sibling event carrying the background-fingerprinted models.
   *  Caller (Engine.fingerprintModelsForVersion) guarantees idempotency by
   *  checking for an existing event first. The original 'completed' event
   *  row stays byte-identical. */
  appendModelsFingerprintedEvent(versionId: string, models: ModelRef[]): ProvenanceEvent {
    return this.insertEvent(versionId, {
      event_type: 'models_fingerprinted',
      models_json: JSON.stringify(models),
    });
  }

  /** `getLatestFingerprints` returns the latest
   *  fingerprinted ModelRef[] for a version, falling back to the latest
   *  'completed' event's models_json when the fingerprinter has not yet run.
   *  Returns null when neither source yields a parseable array (legacy /
   *  malformed / pre-fingerprinting rows). Catches JSON.parse
   *  / non-array errors so downstream consumers (the C2PA manifest) get
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

  /** `appendManifestSignedEvent` writes an
   *  append-only sibling event carrying the outcome of an Engine.signOutput
   *  call. Mirrors appendModelsFingerprintedEvent shape exactly.
   *  Uses the manifest_signed_json column (migration 0006). NEVER carries
   *  key material — only the cert subject summary derived from the cert's
   *  public DN (loadSigner's RFC4514-safe parser).
   *
   *  Deliberately NO `sidecar` field — c2pa-node v0.5.26 has no
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
   * Sibling-row helper for redacted writes.
   *
   * Behaviorally identical to appendManifestSignedEvent: serialises the payload
   * via JSON.stringify into manifest_signed_json. The DIFFERENCE is the
   * payload shape carries redacted=true + redacted_fields[]. Centralising
   * the helper lets test harnesses + Engine.redactManifestForVersion share
   * one writer; pre-existing callers continue using appendManifestSignedEvent
   * unchanged (additive surface, no migration).
   *
   * Append-only invariant: NEVER updates the original (un-redacted) row.
   * The redacted row is a SIBLING with later timestamp; getLatestManifestSignedEvent
   * returns the redacted row first (DESC by timestamp).
   *
   * The redacted=true GUARD runs BEFORE insertEvent. payload.redacted !== true
   * REJECTS pre-commit — the row is never inserted, the caller's atomic-write
   * disk overwrite has not corrupted append-only state.
   */
  appendManifestSignedRedactedEvent(
    versionId: string,
    payload: ManifestSignedPayloadFields,
  ): ProvenanceEvent {
    // Defensive: assert the caller actually flagged redacted=true.
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

  /** Returns the most recent manifest_signed event for
   *  a version+filename pair, or null. Used by Engine.signOutput's idempotency
   *  guard and by the HTTP layer's X-C2PA-Signing-Status header.
   *  Filters in-memory rather than via JSON path expressions —
   *  the per-version event count is small (a handful of events per version),
   *  so a full scan-and-decode is cheap and avoids relying on SQLite's
   *  json_extract availability across builds.
   *
   *  Bounded scan via LIMIT MANIFEST_SIGNED_LOOKUP_LIMIT.
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
        // Malformed payload — skip and keep walking newer-to-older, matching
        // getLatestFingerprints: callers see a clean null signal rather than a
        // partially-parsed object.
        continue;
      }
    }
    return null;
  }

  /**
   * appendSummaryGeneratedEvent writes an
   * append-only sibling event carrying the verified-good Anthropic LLM
   * output. Mirrors appendManifestSignedEvent shape exactly.
   *
   * Cache-key composite (manifest_sha256, template_version, model_id) lives
   * INSIDE the JSON payload — readers compose the lookup at the engine layer.
   *
   * NEVER carries raw API key material — the engine's flattenAnthropicError
   * + the sanitizer's multi-encoding leak scan run BEFORE
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
   * Bounded-scan composite-key lookup.
   * LIMIT-50 + in-memory JSON filter mirrors getLatestManifestSignedEvent
   * above. Returns the latest 'summary_generated' row for
   * (versionId, manifestSha256, templateVersion, modelId) — null when no
   * matching row exists within the bounded scan.
   *
   * Cache-key invariant: redaction mutates manifest_sha256, so a
   * post-redact lookup misses the pre-redact cache row "for free" without
   * explicit invalidation logic. The lookup tuple is composed at the
   * engine boundary (manifest_sha256 from getLatestManifestSignedEvent;
   * template_version from src/engine/summary/template.ts; model_id from
   * SUMMARY_MODEL_ID).
   */
  /** Cost actuals — append a 'cost_recorded' sibling event. Append-only: never
   *  updates an earlier row; a correction is a newer event that getLatestCostRecorded
   *  returns first. Mirrors appendManifestSignedEvent shape. */
  appendCostRecordedEvent(
    versionId: string,
    payload: CostRecordedPayloadFields,
  ): ProvenanceEvent {
    return this.insertEvent(versionId, {
      event_type: 'cost_recorded',
      cost_recorded_json: JSON.stringify(payload),
    });
  }

  /** Cost actuals — the most recent VALID 'cost_recorded' payload for a version,
   *  or null. Bounded newest-first scan (mirrors getLatestManifestSignedEvent /
   *  getLatestSummaryGeneratedEvent): a malformed newest row is SKIPPED to the
   *  next valid one rather than hiding all history behind a single bad payload.
   *  Order is (timestamp DESC, rowid DESC): rowid is SQLite's monotonic insertion
   *  counter, so the true newest record wins even when two corrections land in the
   *  same millisecond (id is a nanoid — not sortable by insertion order). */
  getLatestCostRecorded(versionId: string): CostRecordedPayloadFields | null {
    const rows = this.db
      .select()
      .from(provenance)
      .where(and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'cost_recorded')))
      .orderBy(desc(provenance.timestamp), sql`rowid desc`)
      .limit(COST_RECORDED_LOOKUP_LIMIT)
      .all() as ProvenanceEvent[];
    for (const row of rows) {
      if (!row.cost_recorded_json) continue;
      try {
        const parsed = JSON.parse(row.cost_recorded_json) as CostRecordedPayloadFields;
        // Shape guard: only return a structurally valid payload so downstream
        // (pipeline log / dashboard) never receives a non-numeric amount that
        // would crash a `.toFixed`. A malformed-shape row is skipped like bad JSON.
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          typeof parsed.amount === 'number' &&
          Number.isFinite(parsed.amount) &&
          typeof parsed.currency === 'string'
        ) {
          return parsed;
        }
        continue;
      } catch {
        // Malformed payload — keep walking newer-to-older (getLatestFingerprints parity).
        continue;
      }
    }
    return null;
  }

  /** Spec binding — record which project spec revision was active when this
   *  version was created. Written once, at creation. */
  appendSpecBoundEvent(versionId: string, payload: SpecBoundPayloadFields): ProvenanceEvent {
    return this.insertEvent(versionId, {
      event_type: 'spec_bound',
      spec_bound_json: JSON.stringify(payload),
    });
  }

  /** Spec binding — the spec revision a version was created under, or null when
   *  no spec was active. Unlike the cost lookup there is no "newest wins"
   *  correction semantics: a version binds at most once, so this reads the
   *  OLDEST valid row. A duplicate written by a buggy caller must not be able to
   *  silently re-date a take against a later spec revision. */
  getSpecBound(versionId: string): SpecBoundPayloadFields | null {
    const rows = this.db
      .select()
      .from(provenance)
      .where(and(eq(provenance.version_id, versionId), eq(provenance.event_type, 'spec_bound')))
      .orderBy(provenance.timestamp, sql`rowid asc`)
      .limit(SPEC_BOUND_LOOKUP_LIMIT)
      .all() as ProvenanceEvent[];
    for (const row of rows) {
      if (!row.spec_bound_json) continue;
      try {
        const parsed = JSON.parse(row.spec_bound_json) as SpecBoundPayloadFields;
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          typeof parsed.spec_id === 'string' &&
          typeof parsed.project_id === 'string' &&
          typeof parsed.revision === 'number' &&
          Number.isInteger(parsed.revision) &&
          typeof parsed.content_hash === 'string'
        ) {
          return parsed;
        }
        continue;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Total RECORDED spend in `currency` since `sinceMs`. Backs the operator's
   * spend ceiling.
   *
   * Deliberately sums the LATEST record per version rather than every
   * 'cost_recorded' row: corrections are appended as sibling events (the record
   * is append-only, never updated), so adding them all would double-count a
   * take whose cost was corrected.
   *
   * Only matching-currency events count. Mixed currencies are not converted —
   * summing them would be meaningless, and guessing a rate would be worse.
   * Malformed payloads are skipped exactly as getLatestCostRecorded skips them.
   */
  sumRecordedCostSince(sinceMs: number, currency: string): number {
    const rows = this.db
      .selectDistinct({ version_id: provenance.version_id })
      .from(provenance)
      .where(
        and(
          eq(provenance.event_type, 'cost_recorded'),
          gte(provenance.timestamp, sinceMs),
        ),
      )
      .all() as Array<{ version_id: string }>;

    const want = currency.trim().toUpperCase();
    let total = 0;
    for (const { version_id } of rows) {
      const latest = this.getLatestCostRecorded(version_id);
      if (!latest) continue;
      if (latest.currency.trim().toUpperCase() !== want) continue;
      total += latest.amount;
    }
    return total;
  }

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
