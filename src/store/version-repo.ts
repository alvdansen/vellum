import { eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { versions } from './schema.js';
import type { Version } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Detect SQLite unique-constraint violations — identical copy of the helper in
 * hierarchy-repo.ts. Duplicated intentionally (see 02-PATTERNS.md callout) so
 * repo files stay independent; no cross-repo import coupling.
 */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  const code = e.code ?? '';
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
    const msg = e.message ?? '';
    if (/UNIQUE/i.test(msg)) return true;
  }
  return false;
}

/**
 * VersionRepo — owns SQL I/O for the `versions` table. Every insert goes through
 * an allocate+insert transaction (D-GEN-16). State transitions obey D-GEN-18
 * one-way rules: `completed_at IS NULL` guard on terminal updates enforces
 * D-GEN-20 immutability. Zero MCP / network imports (architecture purity).
 *
 * Threat-model anchors:
 *  - T-02-01-02 (concurrent-submit race): allocate+insert is transactional;
 *    UNIQUE(shot_id, version_number) retry once → CONCURRENT_SUBMIT_CONFLICT.
 *  - T-02-01-03 (terminal overwrite): WHERE completed_at IS NULL on terminal
 *    updates → second call is a no-op.
 *  - T-02-01-04 (raw-error leak): isUniqueViolation → TypedError wrapping;
 *    tool envelope is defence-in-depth.
 */
export class VersionRepo {
  constructor(private db: Db) {}

  /**
   * Allocate the next version_number for shotId and insert a new row at status
   * 'submitted' inside a single transaction. Retries ONCE on UNIQUE violation
   * (rare race per Pitfall 3); second failure surfaces CONCURRENT_SUBMIT_CONFLICT.
   */
  insertVersion(shotId: string, notes?: string): Version {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return this.doInsert(shotId, notes);
      } catch (err) {
        if (isUniqueViolation(err) && attempt === 0) continue;
        if (isUniqueViolation(err)) {
          throw new TypedError(
            'CONCURRENT_SUBMIT_CONFLICT',
            `Concurrent submit for shot '${shotId}' — retry once`,
            'Retry the submit call; this is a rare race between two near-simultaneous submits to the same shot.',
          );
        }
        throw err;
      }
    }
    throw new TypedError('CONCURRENT_SUBMIT_CONFLICT', 'Exhausted retries (unreachable)');
  }

  private doInsert(shotId: string, notes?: string): Version {
    return this.db.transaction((tx) => {
      const maxRow = tx
        .select({ m: sql<number>`COALESCE(MAX(${versions.version_number}), 0)` })
        .from(versions)
        .where(eq(versions.shot_id, shotId))
        .get();
      const versionNumber = Number(maxRow?.m ?? 0) + 1;
      const row: Version = {
        id: newId('ver'),
        shot_id: shotId,
        version_number: versionNumber,
        status: 'submitted',
        job_id: null,
        parent_version_id: null,
        notes: notes ?? null,
        created_at: Date.now(),
        completed_at: null,
        error_code: null,
        error_message: null,
        outputs_json: null,
      };
      tx.insert(versions).values(row).run();
      return row;
    });
  }

  /** Set job_id after the ComfyUI POST returns a prompt_id (D-GEN-21). */
  setJobId(id: string, jobId: string): void {
    this.db.update(versions).set({ job_id: jobId }).where(eq(versions.id, id)).run();
  }

  /**
   * Mark failed — one-shot terminal transition (D-GEN-20 immutability).
   * WHERE completed_at IS NULL ensures a second call is a no-op.
   */
  markFailed(id: string, code: string, message: string): void {
    this.db.run(sql`
      UPDATE versions
      SET status = 'failed',
          error_code = ${code},
          error_message = ${message},
          completed_at = ${Date.now()}
      WHERE id = ${id} AND completed_at IS NULL
    `);
  }

  /**
   * Mark completed — one-shot terminal transition (D-GEN-20 immutability).
   * outputsJson must be a pre-serialised JSON string.
   */
  markCompleted(id: string, outputsJson: string): void {
    this.db.run(sql`
      UPDATE versions
      SET status = 'completed',
          outputs_json = ${outputsJson},
          completed_at = ${Date.now()}
      WHERE id = ${id} AND completed_at IS NULL
    `);
  }

  /**
   * Non-terminal transition (submitted → running). Terminals use markFailed/markCompleted.
   *
   * Guarded by `status = 'submitted' AND completed_at IS NULL` to prevent a TOCTOU race:
   * if the recovery poller has already driven the row to `completed`, a concurrent tool-path
   * caller holding a stale `submitted` snapshot must NOT regress the row back to `running`.
   * The guard makes the update a no-op in that race, preserving D-GEN-20 immutability.
   */
  transition(id: string, next: 'running'): void {
    this.db.run(sql`
      UPDATE versions
      SET status = ${next}
      WHERE id = ${id} AND status = 'submitted' AND completed_at IS NULL
    `);
  }

  getVersion(id: string): Version | null {
    const r = this.db.select().from(versions).where(eq(versions.id, id)).get();
    return (r as Version | undefined) ?? null;
  }

  /** Used by the on-start recovery poller (D-GEN-28). */
  listPendingVersions(): Version[] {
    return this.db
      .select()
      .from(versions)
      .where(inArray(versions.status, ['submitted', 'running']))
      .all() as Version[];
  }
}
