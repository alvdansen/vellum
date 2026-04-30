import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { provenance } from './schema.js';
import type { ModelRef, ProvenanceEvent } from '../types/provenance.js';
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

export type ProvenanceEventPayload =
  | ({ event_type: 'submitted' } & ProvenanceSubmittedPayload)
  | ({ event_type: 'completed' } & ProvenanceCompletedPayload)
  | ({ event_type: 'failed' } & ProvenanceFailedPayload)
  | ({ event_type: 'models_fingerprinted' } & ProvenanceModelsFingerprintedPayload);

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

  /** Phase 13 — PROV-V-03. Append-only sibling event carrying the
   *  background-fingerprinted models. Caller (Engine.fingerprintModelsForVersion)
   *  guarantees idempotency by checking for an existing event first. The
   *  original 'completed' event row stays byte-identical (T-13-07 mitigation). */
  appendModelsFingerprintedEvent(versionId: string, models: ModelRef[]): ProvenanceEvent {
    return this.insertEvent(versionId, {
      event_type: 'models_fingerprinted',
      models_json: JSON.stringify(models),
    });
  }

  /** Phase 13 — PROV-V-03. Returns the latest fingerprinted ModelRef[] for a
   *  version, falling back to the latest 'completed' event's models_json when
   *  the fingerprinter has not yet run. Returns null when neither source
   *  yields a parseable array (legacy / malformed / pre-Phase-13 rows).
   *  T-13-12 mitigation: catches JSON.parse / non-array errors so downstream
   *  consumers (Phase 14 C2PA manifest) get a clean null signal rather than a
   *  partially-parsed object. */
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
}
