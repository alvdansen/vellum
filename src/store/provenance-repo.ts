import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { provenance } from './schema.js';
import type {
  ManifestSignedPayloadFields,
  ModelRef,
  ProvenanceEvent,
} from '../types/provenance.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;

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

export type ProvenanceEventPayload =
  | ({ event_type: 'submitted' } & ProvenanceSubmittedPayload)
  | ({ event_type: 'completed' } & ProvenanceCompletedPayload)
  | ({ event_type: 'failed' } & ProvenanceFailedPayload)
  | ({ event_type: 'models_fingerprinted' } & ProvenanceModelsFingerprintedPayload)
  | ({ event_type: 'manifest_signed' } & ProvenanceManifestSignedRowPayload);

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

  /** Phase 14 — PROV-V-01. Returns the most recent manifest_signed event for
   *  a version+filename pair, or null. Used by Engine.signOutput's idempotency
   *  guard (Concern #7) and by the HTTP layer's X-C2PA-Signing-Status header
   *  (Plan 14-04). Filters in-memory rather than via JSON path expressions —
   *  the per-version event count is small (a handful of events per version),
   *  so a full scan-and-decode is cheap and avoids relying on SQLite's
   *  json_extract availability across builds. */
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
}
