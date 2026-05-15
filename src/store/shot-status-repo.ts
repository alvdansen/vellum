import { desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { shots, shotStatusEvents } from './schema.js';
import type { ShotStatus } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Phase 20 — STAT-02, STAT-03. Append-only shot status event store.
 *
 * Structural invariant: this module exposes NO update/delete/remove/clear
 * functions for the events table. That is the enforcement of the
 * append-only rule (D-PROV-01 sibling) — the architecture-purity test in
 * Plan 04 greps this file for the forbidden SQL mutation verbs against
 * the events table and asserts zero matches. Mirrors
 * src/store/provenance-repo.ts shape.
 *
 * Dual-model truth: shots.status is a materialized denorm for O(1) grid
 * reads; the events table is the canonical history. insertStatusEvent
 * writes BOTH inside a single sync transaction so partial writes are
 * impossible.
 *
 * Null-coalesce invariant: getCurrentStatus returns 'wip' for shots with
 * zero history rows (pre-migration shots or never-transitioned shots) — it
 * never returns null.
 */

/**
 * Shape of a row in shot_status_events. The schema column types are
 * preserved verbatim from src/store/schema.ts (added by Plan 01).
 *
 * - `from_status` is null on the first-ever status set for a shot.
 * - `note` is null when the caller did not provide a free-text note.
 * - `changed_by` carries 'user' or the calling tool name (Plan 04 sets this).
 */
export interface ShotStatusEvent {
  id: string;
  shot_id: string;
  from_status: ShotStatus | null;
  to_status: ShotStatus;
  changed_by: string;
  note: string | null;
  created_at: number;
}

/**
 * REQUIREMENTS.md OVR-02 — staleness threshold for a shot with status in
 * ('wip' | 'pending-review') and no completed version in the last N days.
 * Named constant lives here as the single source of truth; grid query
 * paths import this rather than inlining `14`.
 */
export const STALE_SHOT_DAYS = 14;

/**
 * STAT-02 — atomic dual-write of a shot status transition.
 *
 * Writes an append-only INSERT into shot_status_events AND an UPDATE on
 * shots.status inside ONE transaction. better-sqlite3 transactions are
 * synchronous, so partial writes are impossible — if either statement
 * throws, both roll back. Returns the inserted ShotStatusEvent row.
 *
 * The transaction-call shape — single callback, NO trailing `()` — is the
 * Drizzle/better-sqlite3 idiom established elsewhere in this codebase
 * (see src/engine/assets.ts L494, src/store/metadata-repo.ts L217,
 * src/store/tag-repo.ts L223, src/store/version-repo.ts L92).
 */
export function insertStatusEvent(
  db: Db,
  shotId: string,
  fromStatus: ShotStatus | null,
  toStatus: ShotStatus,
  changedBy: string,
  note?: string,
): ShotStatusEvent {
  const id = newId('sse');
  const now = Date.now();
  const row: ShotStatusEvent = {
    id,
    shot_id: shotId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: changedBy,
    note: note ?? null,
    created_at: now,
  };
  db.transaction(() => {
    db.insert(shotStatusEvents).values(row).run();
    // Materialize the new status on shots.status for O(1) grid reads.
    db.update(shots).set({ status: toStatus }).where(eq(shots.id, shotId)).run();
  });
  return row;
}

/**
 * STAT-03 — return up to `limit` shot status events for a shot, ordered
 * newest-first. Uses idx_shot_status_events_shot_time (Plan 01) — the
 * (shot_id, created_at) covering index lets SQLite walk the index in
 * reverse for the DESC order without a sort step.
 *
 * Returns an empty array (NOT null) when no rows exist — callers handle
 * the 'wip' default via getCurrentStatus, not via null-checks here.
 */
export function getStatusHistory(
  db: Db,
  shotId: string,
  limit = 50,
): ShotStatusEvent[] {
  return db
    .select()
    .from(shotStatusEvents)
    .where(eq(shotStatusEvents.shot_id, shotId))
    .orderBy(desc(shotStatusEvents.created_at))
    .limit(limit)
    .all() as ShotStatusEvent[];
}

/**
 * STAT-03 — return the current shot status, null-coalesced to 'wip' when
 * the shot has zero history rows (pre-migration shots, or shots that have
 * never been transitioned out of the default).
 *
 * CRITICAL invariant: this function NEVER returns null. The nullish-
 * coalescing operator on `history[0]?.to_status` collapses both "no
 * rows" and "to_status column was null" (the latter is structurally
 * impossible — schema declares notNull — but the operator is the belt-
 * and-suspenders guard that callers can rely on).
 */
export function getCurrentStatus(db: Db, shotId: string): ShotStatus {
  const history = getStatusHistory(db, shotId, 1);
  return (history[0]?.to_status as ShotStatus) ?? 'wip';
}

// ===== Phase 21 — listShotsForGrid (GRID-04 single-query, window-function CTE) =====

/**
 * Cursor shape for the shot grid pagination — opaque base64url-encoded
 * { n: shotName, sid: shotId } pair. The `n` field is the sort key (last
 * shot.name on the page; shots.name is NOT NULL per schema.ts:60). The
 * `sid` is the stable tiebreaker (shot.id is the UNIQUE PRIMARY KEY).
 * Together they yield deterministic pagination under composite ASC order.
 */
export interface ShotGridCursor {
  /** Last shot name on the current page (the sort key). */
  n: string;
  /** Last shot id (stable tiebreaker, shots.id is UNIQUE PRIMARY KEY). */
  sid: string;
}

/**
 * Encode a cursor as a base64url JSON string. Mirrors src/store/sort.ts:169-173
 * encodeVersionCursor — uniform encoding strategy across all pagination
 * surfaces so the dashboard / engine treats every cursor as opaque.
 */
export function encodeShotGridCursor(c: ShotGridCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/**
 * Decode a base64url JSON cursor. Returns `null` on ANY failure path —
 * empty string, non-base64, invalid JSON, missing fields, wrong types.
 * NEVER throws. Mirrors src/store/sort.ts:175-196 decodeVersionCursor
 * defensive structural-validation pattern.
 */
export function decodeShotGridCursor(s: string): ShotGridCursor | null {
  try {
    if (typeof s !== 'string' || s.length === 0) return null;
    const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof obj !== 'object' || obj === null) return null;
    if (typeof obj.n !== 'string') return null;
    if (typeof obj.sid !== 'string' || obj.sid.length === 0) return null;
    return { n: obj.n, sid: obj.sid };
  } catch {
    return null;
  }
}

/**
 * Per-row shape returned by listShotsForGrid. The `lcv_*` columns carry the
 * latest-completed-version join result (NULL when the shot has no completed
 * versions). The engine facade (Pattern 10) nests these into a single
 * `latest_completed_version: { id, completed_at, thumbnail_url } | null`
 * object before returning to the HTTP route.
 *
 * Phase 23 — D-03 adds `is_stale` (0 or 1 from the CASE expression in the
 * CTE SELECT). The engine facade coerces this to a real boolean before
 * shipping to the dashboard (per the wire-type `ShotGridRow.is_stale: boolean`
 * at `packages/dashboard/src/types/shot-grid.ts`).
 */
export interface ShotGridQueryRow {
  id: string;
  name: string;
  status: ShotStatus;
  version_count: number;
  lcv_id: string | null;
  lcv_completed_at: number | null;
  /**
   * Phase 23 — D-03 per-row staleness flag. SQLite returns 0|1 from the
   * `CASE WHEN ... THEN 1 ELSE 0 END` expression; the engine layer coerces
   * to `Boolean(is_stale)` before emitting on the wire. Computed inline in
   * the CTE outer SELECT using:
   *   - `s.status IN ('wip','pending-review')` (OVR-02 status filter)
   *   - `r.completed_at IS NOT NULL` (D-15 grace: zero-version shots NEVER stale)
   *   - `r.completed_at < cutoff` (the 14-day threshold, bound at query time)
   */
  is_stale: number;
}

/**
 * Page-shaped result from listShotsForGrid — items array + opaque cursor +
 * cursor-independent total_count. Mirrors the PaginatedVersionsResponse
 * envelope at packages/dashboard/src/lib/api.ts:209-215 in spirit.
 */
export interface ShotGridQueryResult {
  items: ShotGridQueryRow[];
  next_cursor: string | null;
  total_count: number;
}

/**
 * GRID-04 — denormalized shot list for the grid view. Single-pass SQL with
 * window-function CTE (no N+1). Cursor pagination on (shots.name, shots.id) ASC.
 *
 * EXPLAIN QUERY PLAN invariant: NO `CORRELATED SCALAR SUBQUERY` for the
 * latest-version (ranked) join. The benign uncorrelated `version_count`
 * subquery is allowed (single index scan against the autoindex on
 * versions.shot_id from the UNIQUE(shot_id, version_number) constraint).
 * See 21-RESEARCH.md §"Validation Architecture" for the test pattern that
 * enforces this invariant via `EXPLAIN QUERY PLAN` introspection.
 *
 * Null-coalesce: shots.status comes through verbatim (Phase 20 STAT-02 dual-
 * write keeps it materialized; pre-migration shots default to 'wip' via the
 * column default in src/store/schema.ts:68). Empty version_count yields 0
 * (NOT null) via SQLite COUNT(*) semantics.
 *
 * Cursor semantics: the WHERE clause uses standard composite-key after-cursor
 * `(name > cursorName) OR (name = cursorName AND id > cursorSid)` so every
 * shot is visited exactly once across a paginated walk. The cursorName +
 * cursorSid args are bound 4× / 1× respectively to match the 5 WHERE
 * placeholders; the limit-bind adds a 6th for the `LIMIT ?` clause.
 */
export function listShotsForGrid(
  db: Db,
  sequenceId: string,
  opts: { cursor: ShotGridCursor | null; limit: number },
): ShotGridQueryResult {
  const { cursor, limit } = opts;

  // total_count — single COUNT(*) over the sequence's shots. Cursor-independent.
  const totalRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(shots)
    .where(eq(shots.sequence_id, sequenceId))
    .get();

  const cursorName = cursor?.n ?? null;
  const cursorSid = cursor?.sid ?? null;
  // Phase 23 — D-03 + D-15 cutoff for the inline `is_stale` CASE. Computed
  // ONCE per call so the planner sees a literal placeholder, not two
  // separate Date.now() calls (which would re-evaluate inside the SQL
  // template). Mirrors the cutoff binding used by getSequenceStats below.
  const cutoff = Date.now() - STALE_SHOT_DAYS * 86_400_000;

  // limit+1 fetch for has_more (mirrors src/store/version-repo.ts limit+1 probe).
  const rows = db.all(sql`
    WITH ranked AS (
      SELECT v.id, v.shot_id, v.completed_at,
        ROW_NUMBER() OVER (
          PARTITION BY v.shot_id
          ORDER BY v.completed_at DESC, v.id ASC
        ) AS rn
      FROM versions v
      WHERE v.status = 'completed' AND v.completed_at IS NOT NULL
    )
    SELECT
      s.id        AS id,
      s.name      AS name,
      s.status    AS status,
      (SELECT COUNT(*) FROM versions vc WHERE vc.shot_id = s.id) AS version_count,
      r.id           AS lcv_id,
      r.completed_at AS lcv_completed_at,
      -- Phase 23 -- D-03 + D-15 inline is_stale (no extra query). Per OVR-02
      -- + D-15 pragmatic: status IN (wip, pending-review) AND latest completed
      -- version exists AND it is older than STALE_SHOT_DAYS days. Zero-version
      -- shots fall out via r.completed_at IS NOT NULL (the LEFT JOIN ranked
      -- produces NULL when no completed version exists). Reuses the existing
      -- ranked CTE join -- adds NO new correlated subquery in the EXPLAIN
      -- plan, preserving the Phase 21 GRID-04 single-scan invariant.
      CASE
        WHEN s.status IN ('wip','pending-review')
          AND r.completed_at IS NOT NULL
          AND r.completed_at < ${cutoff}
        THEN 1 ELSE 0
      END AS is_stale
    FROM shots s
    LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1
    WHERE s.sequence_id = ${sequenceId}
      AND (
        ${cursorName} IS NULL
        OR s.name > ${cursorName}
        OR (s.name = ${cursorName} AND s.id > ${cursorSid})
      )
    ORDER BY s.name ASC, s.id ASC
    LIMIT ${limit + 1}
  `) as ShotGridQueryRow[];

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let next_cursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1]!;
    next_cursor = encodeShotGridCursor({ n: last.name, sid: last.id });
  }

  return { items, next_cursor, total_count: Number(totalRow?.c ?? 0) };
}

/**
 * Returns the EXACT raw SQL text (with `?` placeholders) used by
 * listShotsForGrid above, so the EXPLAIN QUERY PLAN test can introspect the
 * planner output without duplicating SQL strings between the prod path and
 * the test path.
 *
 * Placeholder order (7 total binds — Phase 23 adds cutoff after sequenceId):
 *   1. cutoff               — r.completed_at < ? (Phase 23 — is_stale CASE)
 *   2. sequenceId           — s.sequence_id = ?
 *   3. cursorName  ($IS NULL$) — ? IS NULL
 *   4. cursorName  (>)        — s.name > ?
 *   5. cursorName  (= tiebreak) — s.name = ?
 *   6. cursorSid              — s.id > ?
 *   7. limit                  — LIMIT ?
 */
export function listShotsForGridSqlText(): string {
  return /* sql */ `
    WITH ranked AS (
      SELECT v.id, v.shot_id, v.completed_at,
        ROW_NUMBER() OVER (PARTITION BY v.shot_id ORDER BY v.completed_at DESC, v.id ASC) AS rn
      FROM versions v
      WHERE v.status = 'completed' AND v.completed_at IS NOT NULL
    )
    SELECT
      s.id        AS id,
      s.name      AS name,
      s.status    AS status,
      (SELECT COUNT(*) FROM versions vc WHERE vc.shot_id = s.id) AS version_count,
      r.id           AS lcv_id,
      r.completed_at AS lcv_completed_at,
      CASE
        WHEN s.status IN ('wip','pending-review')
          AND r.completed_at IS NOT NULL
          AND r.completed_at < ?
        THEN 1 ELSE 0
      END AS is_stale
    FROM shots s
    LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1
    WHERE s.sequence_id = ?
      AND (? IS NULL OR s.name > ? OR (s.name = ? AND s.id > ?))
    ORDER BY s.name ASC, s.id ASC
    LIMIT ?
  `;
}

// ===== Phase 23 — getSequenceStats (OVR-01 + OVR-02 whole-sequence stats) =====

/**
 * Phase 23 — D-02 LOCKED return shape from the repo layer. The engine facade
 * (Plan 23-02) composes this with sequence metadata and computes the
 * approved-percentage in TypeScript (per D-14 — Math.round at the engine
 * boundary, NOT in SQL) before shipping the dashboard-facing `SequenceStats`
 * envelope.
 *
 * - `total`: derived in TS as Σ counts (saves one extra COUNT(*) roundtrip).
 * - `counts`: ALL 5 ShotStatus keys initialized to 0 — sparse GROUP BY rows
 *   are merged on top, so consumers can safely read any key without
 *   undefined-checks.
 * - `stale_count`: separate EXISTS-clause query (Q2 below).
 */
export interface SequenceStatsRaw {
  total: number;
  counts: Record<ShotStatus, number>;
  stale_count: number;
}

/**
 * OVR-01 + OVR-02 — whole-sequence stats for the dashboard
 * `<SequenceHeader/>` subrow. Computed via TWO independent queries:
 *
 *   Q1: SELECT status, COUNT(*) FROM shots WHERE sequence_id=? GROUP BY status
 *     Uses `idx_shots_status (sequence_id, status)` covering index (from
 *     migration 0008 — see drizzle/0008_shot_status.sql:25). The planner can
 *     satisfy the entire query from the index without a table fetch.
 *
 *   Q2: SELECT COUNT(*) FROM shots WHERE shots.sequence_id=?
 *         AND shots.status IN ('wip','pending-review')
 *         AND EXISTS (SELECT 1 FROM versions v
 *           WHERE v.shot_id=shots.id
 *             AND v.status='completed'
 *             AND v.completed_at IS NOT NULL
 *             AND v.completed_at < ?)
 *     The cutoff timestamp is bound at query time (Date.now() - STALE_SHOT_DAYS
 *     * 86_400_000). EXISTS short-circuits on first matching version per shot;
 *     uses the versions PK autoindex on (shot_id, version_number) for the
 *     inner search. D-15 pragmatic — zero-completed-version shots are excluded
 *     from stale_count by the EXISTS clause (they "haven't started yet" — not
 *     "went idle"). See SUMMARY.md for the deviation from a literal reading of
 *     OVR-02.
 *
 * `total` is derived in TypeScript as Σ counts — saves one extra COUNT(*)
 * roundtrip. Returns a plain object (no envelope) — the engine facade
 * (Plan 23-02) computes the approved-percentage via Math.round at the
 * boundary and wraps the result in the dashboard's `SequenceStats` shape.
 *
 * Error behavior: returns `{ total: 0, counts: {...all zero}, stale_count: 0 }`
 * for an unknown sequenceId. The engine layer's `getSequence(sequenceId)`
 * lookup throws `SEQUENCE_NOT_FOUND` for unknown IDs — this function is the
 * repo primitive, not the user-facing surface.
 *
 * EXPLAIN QUERY PLAN invariant: NO `CORRELATED SCALAR SUBQUERY` for Q1
 * (single GROUP BY, no subqueries); Q2's EXISTS clause IS allowed to surface
 * as a CORRELATED LIST SUBQUERY (that's the EXISTS short-circuit's intended
 * plan). The test in shot-status-repo-stats.test.ts asserts only the absence
 * of `SCAN versions` (full-table scan) — presence of `SEARCH versions USING`
 * is the signal that the autoindex is used.
 */
export function getSequenceStats(db: Db, sequenceId: string): SequenceStatsRaw {
  // Q1: per-status GROUP BY counts.
  const countRows = db.all(sql`
    SELECT status AS status, COUNT(*) AS c
    FROM shots
    WHERE sequence_id = ${sequenceId}
    GROUP BY status
  `) as Array<{ status: ShotStatus; c: number }>;

  // Initialize all 5 statuses at 0 — GROUP BY emits only non-empty buckets.
  const counts: Record<ShotStatus, number> = {
    'wip': 0,
    'pending-review': 0,
    'approved': 0,
    'on-hold': 0,
    'omit': 0,
  };
  let total = 0;
  for (const row of countRows) {
    counts[row.status] = Number(row.c);
    total += Number(row.c);
  }

  // Q2: stale_count via EXISTS — D-15 pragmatic (zero-version shots excluded).
  const cutoff = Date.now() - STALE_SHOT_DAYS * 86_400_000;
  const staleRow = db.get(sql`
    SELECT COUNT(*) AS c
    FROM shots
    WHERE shots.sequence_id = ${sequenceId}
      AND shots.status IN ('wip', 'pending-review')
      AND EXISTS (
        SELECT 1 FROM versions v
        WHERE v.shot_id = shots.id
          AND v.status = 'completed'
          AND v.completed_at IS NOT NULL
          AND v.completed_at < ${cutoff}
      )
  `) as { c: number } | undefined;

  return {
    total,
    counts,
    stale_count: Number(staleRow?.c ?? 0),
  };
}

/**
 * Returns the EXACT raw SQL text (with `?` placeholders) for the
 * getSequenceStats Q2 stale-count query, so the EXPLAIN QUERY PLAN test can
 * introspect without duplicating SQL strings. Mirrors `listShotsForGridSqlText`
 * precedent at line 301.
 *
 * Placeholder order (2 binds):
 *   1. sequenceId — shots.sequence_id = ?
 *   2. cutoff     — v.completed_at < ?
 */
export function getSequenceStatsStaleSqlText(): string {
  return /* sql */ `
    SELECT COUNT(*) AS c
    FROM shots
    WHERE shots.sequence_id = ?
      AND shots.status IN ('wip', 'pending-review')
      AND EXISTS (
        SELECT 1 FROM versions v
        WHERE v.shot_id = shots.id
          AND v.status = 'completed'
          AND v.completed_at IS NOT NULL
          AND v.completed_at < ?
      )
  `;
}

/**
 * Returns the EXACT raw SQL text (with `?` placeholders) for the
 * getSequenceStats Q1 GROUP BY counts query — the EXPLAIN test asserts that
 * the planner picks `idx_shots_status` for this path.
 *
 * Placeholder order (1 bind):
 *   1. sequenceId — sequence_id = ?
 */
export function getSequenceStatsGroupBySqlText(): string {
  return /* sql */ `
    SELECT status AS status, COUNT(*) AS c
    FROM shots
    WHERE sequence_id = ?
    GROUP BY status
  `;
}
