import { eq, inArray, and, sql, gte, desc } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { versions } from './schema.js';
import type { Version } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';
import {
  buildVersionOrderBy,
  buildAfterCursorWhere,
  encodeVersionCursor,
  readSortValue,
  type VersionSort,
  type VersionCursor,
} from './sort.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Detect SQLite unique-constraint violations — identical copy of the helper in
 * hierarchy-repo.ts. Duplicated intentionally so
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
 * Lock contention, as opposed to a constraint violation.
 *
 * SQLITE_BUSY_SNAPSHOT is the one that matters here: it means our DEFERRED
 * snapshot was invalidated by another connection's commit before we tried to
 * write. SQLite deliberately does NOT route it through the busy handler, so
 * `busy_timeout` never retries it — it surfaces immediately as a raw driver
 * error. Left unhandled it reaches the tool envelope, which rewrites any
 * non-TypedError to `INVALID_INPUT: Unexpected internal error` — the one code
 * that tells an agent "your arguments were wrong", so it mutates the request
 * instead of retrying the identical one that would now succeed.
 */
function isBusyConflict(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT';
}

/**
 * VersionRepo — owns SQL I/O for the `versions` table. Every insert goes through
 * an allocate+insert transaction. State transitions obey
 * one-way rules: `completed_at IS NULL` guard on terminal updates enforces
 * terminal-state immutability. Zero MCP / network imports (architecture purity).
 *
 * Threat-model anchors:
 *  - Concurrent-submit race: allocate+insert is transactional;
 *    UNIQUE(shot_id, version_number) retry once → CONCURRENT_SUBMIT_CONFLICT.
 *  - Terminal overwrite: WHERE completed_at IS NULL on terminal
 *    updates → second call is a no-op.
 *  - Raw-error leak: isUniqueViolation → TypedError wrapping;
 *    tool envelope is defence-in-depth.
 */
export class VersionRepo {
  constructor(private db: Db) {}

  /**
   * Allocate the next version_number for shotId and insert a new row at status
   * 'submitted' inside a single transaction. Retries ONCE on UNIQUE violation
   * (a rare race); second failure surfaces CONCURRENT_SUBMIT_CONFLICT.
   *
   * Lineage extension: when the caller is
   * reproduce/iterate, pass `lineage` to write parent_version_id + lineage_type
   * at INSERT time. NEVER via follow-up UPDATE — a reader observing the row
   * between INSERT and UPDATE would briefly see `lineage_type: null` on a
   * reproduce/iterate row, which is a lie. Insert-time write closes that window.
   */
  insertVersion(
    shotId: string,
    notes?: string,
    lineage?: { parent_version_id?: string; lineage_type?: 'reproduce' | 'iterate' },
    provider?: string | null,
    requestFingerprint?: string | null,
  ): Version {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return this.doInsert(shotId, notes, lineage, provider, requestFingerprint);
      } catch (err) {
        // Both are failure modes of the same race, and neither means the caller
        // did anything wrong — but they are retried differently.
        //
        // A UNIQUE violation is instantaneous: the other writer already
        // committed, so a second attempt reads the new MAX and succeeds. Retry
        // in-process.
        //
        // A BUSY conflict is NOT retried here. better-sqlite3 is synchronous, so
        // the attempt that just failed spent the whole busy_timeout (5s) with
        // the event loop blocked — every MCP call, SSE push and dashboard
        // request in this process stalled behind it. Retrying would spend
        // another 5s on a condition that has just proved it is not clearing.
        // CONCURRENT_SUBMIT_CONFLICT already tells the agent to retry, and an
        // agent retrying a second later is strictly better than a server frozen
        // for ten seconds.
        if (isUniqueViolation(err) && attempt === 0) continue;
        if (isUniqueViolation(err) || isBusyConflict(err)) {
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

  private doInsert(
    shotId: string,
    notes?: string,
    lineage?: { parent_version_id?: string; lineage_type?: 'reproduce' | 'iterate' },
    provider?: string | null,
    requestFingerprint?: string | null,
  ): Version {
    // BEGIN IMMEDIATE, not Drizzle's default BEGIN DEFERRED.
    //
    // This transaction reads MAX(version_number) and then writes a row derived
    // from it — a read-modify-write, which must not run under a deferred
    // snapshot. Deferred takes no lock until the first write, so any commit by
    // another connection in between (it does not even have to touch `versions`)
    // invalidates our snapshot and the INSERT raises SQLITE_BUSY_SNAPSHOT, which
    // busy_timeout does not retry. IMMEDIATE takes the write lock up front, so
    // contention degrades to plain SQLITE_BUSY — which busy_timeout=5000 does
    // handle. Two server processes over one database is the documented setup
    // (README's two-terminal instructions), so this is reachable, not theoretical.
    return this.db.transaction(
      (tx) => {
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
          parent_version_id: lineage?.parent_version_id ?? null,
          notes: notes ?? null,
          created_at: Date.now(),
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: null,
          // NULL marks originals from generation.submit.
          // Written at INSERT time for reproduce/iterate via the `lineage` param —
          // NEVER via follow-up UPDATE (see the doc comment on insertVersion).
          lineage_type: lineage?.lineage_type ?? null,
          // NULL on insert; populated by
          // engine.reproduceVersion via VersionRepo.setReproductionWarnings
          // immediately after the row INSERT for reproduce-lineage versions.
          reproduction_warnings_json: null,
          // The provider that produced this version, stamped at
          // INSERT time from the active GenerationProvider.id. NULL when the caller
          // does not supply one (legacy/test paths).
          provider: provider ?? null,
          // Duplicate-submit guard: fingerprint of the request this row was
          // submitted with. NULL for callers that do not supply one (legacy/test
          // paths), which the guard reads as "never a duplicate".
          request_fingerprint: requestFingerprint ?? null,
        };
        tx.insert(versions).values(row).run();
        return row;
      },
      { behavior: 'immediate' },
    );
  }

  /**
   * Duplicate-submit lookup: the most recent version for this shot submitted
   * with an IDENTICAL request inside the window.
   *
   * Only rows that could represent an unreconciled spend are interesting:
   *   - 'submitted' — still in flight, the work is being paid for right now,
   *   - 'failed'    — which includes the ambiguous case where the provider may
   *                   have accepted and charged without us learning the job id.
   * A 'completed' row is NOT a duplicate: the take finished and landed, and
   * asking for another take of the same prompt is ordinary work (sampling is
   * non-deterministic, so a re-run is a new take).
   *
   * A null/absent fingerprint never matches — legacy rows carry NULL and must
   * not block anything.
   */
  findRecentBySameRequest(
    shotId: string,
    fingerprint: string,
    sinceMs: number,
  ): Version | null {
    const rows = this.db
      .select()
      .from(versions)
      .where(
        and(
          eq(versions.shot_id, shotId),
          eq(versions.request_fingerprint, fingerprint),
          gte(versions.created_at, sinceMs),
          inArray(versions.status, ['submitted', 'failed']),
        ),
      )
      .orderBy(desc(versions.created_at))
      .limit(1)
      .all();
    return (rows[0] as Version | undefined) ?? null;
  }

  /** Set job_id after the ComfyUI POST returns a prompt_id. */
  setJobId(id: string, jobId: string): void {
    this.db.update(versions).set({ job_id: jobId }).where(eq(versions.id, id)).run();
  }

  /**
   * Mark failed — one-shot terminal transition (terminal-state immutability).
   * WHERE completed_at IS NULL ensures a second call is a no-op.
   *
   * Returns whether THIS call performed the transition. A single conditional
   * UPDATE in autocommit is serialized by SQLite, so across any number of
   * processes exactly one caller sees true. That makes the return value an
   * atomic claim, and the only correct gate for writing the matching
   * append-only provenance event — a read-then-write existence check is not
   * atomic cross-process and lets two writers both observe "absent".
   */
  markFailed(id: string, code: string, message: string): boolean {
    const res = this.db.run(sql`
      UPDATE versions
      SET status = 'failed',
          error_code = ${code},
          error_message = ${message},
          completed_at = ${Date.now()}
      WHERE id = ${id} AND completed_at IS NULL
    `);
    return (res as unknown as { changes: number }).changes > 0;
  }

  /**
   * Claim the failed transition and append its provenance event as ONE unit.
   *
   * Gating the event on the claim made the event follow the transition, which
   * is what stops two processes writing contradictory records. But it also made
   * the two statements separately failable: if the row flipped terminal and the
   * event INSERT then threw — a full disk, an I/O error, a lock timeout — the
   * version was left permanently terminal with no terminal event, and nothing
   * could repair it. The status read short-circuits terminal rows, the recovery
   * poller only scans non-terminal ones, and provenance is append-only by
   * design. `reproduce` and `iterate` are then blocked on that version forever.
   *
   * The pre-inversion order self-healed that case, because a failed event write
   * left the row non-terminal and the next poll retried. Wrapping both in one
   * transaction keeps the atomic claim AND restores that property: if the
   * append throws, the transition rolls back with it.
   *
   * `append` must be synchronous and must write on this same connection — both
   * hold for better-sqlite3, which is how it participates in this transaction.
   */
  markFailedAtomic(id: string, code: string, message: string, append: () => void): boolean {
    return this.db.transaction(() => {
      const won = this.markFailed(id, code, message);
      if (won) append();
      return won;
    });
  }

  /** Claim the completed transition and append its event as one unit. See markFailedAtomic. */
  markCompletedAtomic(id: string, outputsJson: string, append: () => void): boolean {
    return this.db.transaction(() => {
      const won = this.markCompleted(id, outputsJson);
      if (won) append();
      return won;
    });
  }

  /**
   * Mark completed — one-shot terminal transition (terminal-state immutability).
   * outputsJson must be a pre-serialised JSON string.
   *
   * Returns whether THIS call performed the transition — see markFailed for why
   * that return value is the cross-process-safe gate for the provenance event.
   */
  markCompleted(id: string, outputsJson: string): boolean {
    const res = this.db.run(sql`
      UPDATE versions
      SET status = 'completed',
          outputs_json = ${outputsJson},
          completed_at = ${Date.now()}
      WHERE id = ${id} AND completed_at IS NULL
    `);
    return (res as unknown as { changes: number }).changes > 0;
  }

  /**
   * Persist the JSON-encoded reproduction
   * warnings array on a version row. Plain UPDATE — no completed_at guard
   * (warnings are sticky to the row and may be written for any non-terminal
   * status; reproduce-lineage rows reach this path immediately after submit).
   * Empty arrays are persisted as '[]' so the read path can distinguish
   * "no warnings recorded" (NULL — legacy) from "explicitly empty" ('[]').
   */
  setReproductionWarnings(id: string, warnings: string[]): void {
    this.db
      .update(versions)
      .set({ reproduction_warnings_json: JSON.stringify(warnings) })
      .where(eq(versions.id, id))
      .run();
  }

  /**
   * Non-terminal transition (submitted → running). Terminals use markFailed/markCompleted.
   *
   * Guarded by `status = 'submitted' AND completed_at IS NULL` to prevent a TOCTOU race:
   * if the recovery poller has already driven the row to `completed`, a concurrent tool-path
   * caller holding a stale `submitted` snapshot must NOT regress the row back to `running`.
   * The guard makes the update a no-op in that race, preserving terminal-state immutability.
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

  /**
   * How many generations are in flight right now.
   *
   * Backs the operator-configurable in-flight ceiling: a runaway agent issuing
   * hundreds of valid submits is otherwise bounded only by what the provider
   * will bill for. Counts the same non-terminal band the recovery poller
   * considers pending.
   */
  countInFlight(): number {
    const row = this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(versions)
      .where(inArray(versions.status, ['submitted', 'running']))
      .get();
    return Number(row?.n ?? 0);
  }

  /** Used by the on-start recovery poller. */
  listPendingVersions(): Version[] {
    return this.db
      .select()
      .from(versions)
      .where(inArray(versions.status, ['submitted', 'running']))
      .all() as Version[];
  }

  /**
   * Paginated version list for a shot via composite-cursor
   * pagination. ORDER BY assembled from a whitelist enum (via
   * buildVersionOrderBy); in-progress band pinned to top via the
   * (completed_at IS NULL) DESC NULL-bit term.
   *
   * Stability invariant: the trailing `versions.id ASC` tiebreaker
   * makes the composite key unique. Cursor encodes (cna, sv, vid) — pagination
   * is duplicate-free and skip-free under inserts and deletes.
   *
   * total_count is cursor-independent — single COUNT(*) query mirrors the
   * pre-cursor-pagination shape so existing total_count semantics are preserved.
   *
   * Threat model anchors:
   *  - SQL injection via sort field: inherits the whitelist enum + the
   *    Record<SortField, () => SQL> column-ref map from src/store/sort.ts; user
   *    strings never reach the SQL fragment.
   *  - SQL injection via cursor: cursor is a structurally-validated
   *    VersionCursor object passed by callers; the HTTP layer rejects
   *    malformed cursors at the boundary before they reach this method.
   */
  listByShot(
    shotId: string,
    opts: { sort: VersionSort; cursor: VersionCursor | null; limit: number },
  ): { items: Version[]; next_cursor: string | null; total_count: number } {
    const { sort, cursor, limit } = opts;

    // total_count is cursor-independent (matches the pre-cursor-pagination shape).
    const totalRow = this.db
      .select({ c: sql<number>`COUNT(*)` })
      .from(versions)
      .where(eq(versions.shot_id, shotId))
      .get();

    // Build WHERE: shot filter ALWAYS; AND after-cursor predicate WHEN cursor present.
    const whereClause = cursor
      ? and(eq(versions.shot_id, shotId), buildAfterCursorWhere(sort, cursor))
      : eq(versions.shot_id, shotId);

    // Fetch limit+1 rows to peek for has_more without a second query.
    const rows = this.db
      .select()
      .from(versions)
      .where(whereClause)
      .orderBy(buildVersionOrderBy(sort))
      .limit(limit + 1)
      .all() as Version[];

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastRow = items[items.length - 1];
      const sortValue = readSortValue(lastRow, sort.field);
      nextCursor = encodeVersionCursor({
        cna: lastRow.completed_at === null,
        sv: sortValue,
        vid: lastRow.id,
      });
    }

    return { items, next_cursor: nextCursor, total_count: Number(totalRow?.c ?? 0) };
  }

  /**
   * List the N most-recent versions whose status
   * is 'completed', ordered by completed_at DESC. Powers Engine.getDashboardHome
   * `recent_versions` rail. No total_count or offset — the dashboard home
   * surfaces a single fixed-N rail; pagination/scoping can be added later
   * without changing the Version[] return contract.
   *
   * Analog: listByShot above (same Drizzle chain, different filter + sort).
   */
  /**
   * Pipeline-log — every version for a shot, oldest take first
   * (version_number ASC, id ASC tiebreaker). Unpaginated by design: a per-shot
   * pipeline log renders the FULL take history (including failed/rejected takes)
   * as one document. Per-shot take counts are bounded (dozens in practice), so a
   * single ordered scan over the UNIQUE(shot_id, version_number) autoindex is
   * cheap. Distinct from listByShot (cursor-paginated, sort-configurable, grid/
   * dashboard-facing) — this is a stable full read for provenance export.
   */
  listAllForShot(shotId: string): Version[] {
    return this.db
      .select()
      .from(versions)
      .where(eq(versions.shot_id, shotId))
      .orderBy(versions.version_number, versions.id)
      .all() as Version[];
  }

  listRecentCompleted(limit: number): Version[] {
    return this.db
      .select()
      .from(versions)
      .where(eq(versions.status, 'completed'))
      .orderBy(sql`${versions.completed_at} DESC`)
      .limit(limit)
      .all() as Version[];
  }
}
