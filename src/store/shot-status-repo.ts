import { desc, eq } from 'drizzle-orm';
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
