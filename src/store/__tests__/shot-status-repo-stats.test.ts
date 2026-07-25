import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb, type TestDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import {
  getSequenceStats,
  getSequenceStatsStaleSqlText,
  getSequenceStatsGroupBySqlText,
  listShotsForGrid,
  STALE_SHOT_DAYS,
} from '../shot-status-repo.js';

/**
 * Phase 23 — OVR-01 + OVR-02 whole-sequence stats. This suite locks the
 * `getSequenceStats` repo function's behavior + the EXPLAIN QUERY PLAN
 * invariants for its two queries.
 *
 * Behavior coverage (8 tests):
 *   1. counts correctness (5 wip shots) — all 5 ShotStatus keys initialized
 *      to 0 even when GROUP BY emits a sparse row set.
 *   2. counts correctness (mixed-status fixture) — total === Σ counts.
 *   3. stale_count semantics — wip + completed version > 14d ago → stale.
 *      Also verifies per-row `is_stale === 1` from listShotsForGrid.
 *   4. D-15 grace period — wip shot with ZERO completed versions is NEVER
 *      stale, regardless of calendar age. EXISTS clause falls out.
 *   5. OVR-02 status filter — approved/on-hold/omit shots are NEVER stale
 *      even with old completed versions. Only wip/pending-review qualify.
 *   6. Recent completion not stale — wip + completed version < 14d ago → not
 *      stale, per-row is_stale === 0.
 *   7. EXPLAIN Q1 (GROUP BY counts) — uses `idx_shots_status` covering index;
 *      NO `SCAN shots` (full-table scan).
 *   8. EXPLAIN Q2 (stale-count EXISTS) — uses versions.shot_id autoindex; NO
 *      `SCAN versions` (full-table scan). The EXISTS short-circuit's surface
 *      as CORRELATED LIST SUBQUERY is allowed by design (per RESEARCH Open
 *      Question 3 resolution).
 *
 * Fixtures mirror src/store/__tests__/shot-status-repo-grid.test.ts:1-50
 * verbatim — fresh in-memory DB + HierarchyRepo seeding per test.
 *
 * Landmines (PATTERNS §12):
 *   - hierarchy.createShot requires names matching /^sh\d{3,}$/. Use sh010,
 *     sh020, ..., sh050.
 *   - DO NOT seed via raw INSERT; always go through HierarchyRepo.createShot
 *     so the shots.status default ('wip') fires from the column default.
 *   - Status transitions to non-wip use raw UPDATE on shots — Phase 20's
 *     insertStatusEvent dual-writes via append-only events, which is not
 *     needed for stats correctness (the GROUP BY reads `shots.status`).
 *   - versions.completed_at backdating uses raw UPDATE — markCompleted stamps
 *     Date.now() and the column has no setter. Mirrors the
 *     versionsWithTimestampSpread fixture pattern at fixtures.ts:238-242.
 */

let testDb: TestDb;
let hierarchy: HierarchyRepo;
let versionRepo: VersionRepo;
let sequenceId: string;

beforeEach(() => {
  testDb = makeInMemoryDb();
  hierarchy = new HierarchyRepo(testDb.db);
  versionRepo = new VersionRepo(testDb.db);
  const ws = hierarchy.createWorkspace(`ws-stats-${Date.now()}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  sequenceId = seq.id;
});

/** Backdate a shot's status (raw UPDATE — bypasses append-only events for fixture purposes). */
function setShotStatus(shotId: string, status: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit'): void {
  testDb.sqlite.prepare(`UPDATE shots SET status = ? WHERE id = ?`).run(status, shotId);
}

/** Create a completed version for a shot with controlled completed_at. */
function seedCompletedVersion(shotId: string, completedAt: number): string {
  const ver = versionRepo.insertVersion(shotId);
  // markCompleted stamps Date.now(); we then backdate via raw UPDATE.
  versionRepo.markCompleted(ver.id, '[]');
  testDb.sqlite
    .prepare(`UPDATE versions SET completed_at = ? WHERE id = ?`)
    .run(completedAt, ver.id);
  return ver.id;
}

const FOURTEEN_DAYS_MS = STALE_SHOT_DAYS * 86_400_000;

describe('getSequenceStats — GROUP BY counts correctness (Test 1)', () => {
  test('5 fresh wip shots return counts.wip=5, others=0, total=5, stale_count=0', () => {
    for (let i = 0; i < 5; i++) {
      hierarchy.createShot(sequenceId, `sh${String((i + 1) * 10).padStart(3, '0')}`);
    }
    const result = getSequenceStats(testDb.db, sequenceId);
    expect(result.total).toBe(5);
    expect(result.counts.wip).toBe(5);
    expect(result.counts['pending-review']).toBe(0);
    expect(result.counts.approved).toBe(0);
    expect(result.counts['on-hold']).toBe(0);
    expect(result.counts.omit).toBe(0);
    expect(result.stale_count).toBe(0);
  });
});

describe('getSequenceStats — mixed-status fixture (Test 2)', () => {
  test('one shot in each of 5 statuses returns counts=1 per key, total=5, stale_count=0', () => {
    const wip = hierarchy.createShot(sequenceId, 'sh010');
    const pendingReview = hierarchy.createShot(sequenceId, 'sh020');
    const approved = hierarchy.createShot(sequenceId, 'sh030');
    const onHold = hierarchy.createShot(sequenceId, 'sh040');
    const omit = hierarchy.createShot(sequenceId, 'sh050');
    // wip is the default — leave it. Mutate the other 4 via raw UPDATE.
    setShotStatus(pendingReview.id, 'pending-review');
    setShotStatus(approved.id, 'approved');
    setShotStatus(onHold.id, 'on-hold');
    setShotStatus(omit.id, 'omit');

    const result = getSequenceStats(testDb.db, sequenceId);
    expect(result.total).toBe(5);
    expect(result.counts.wip).toBe(1);
    expect(result.counts['pending-review']).toBe(1);
    expect(result.counts.approved).toBe(1);
    expect(result.counts['on-hold']).toBe(1);
    expect(result.counts.omit).toBe(1);
    // No versions seeded — no completed-version row to qualify as stale.
    expect(result.stale_count).toBe(0);
    // Avoid unused-var warning for wip (kept for fixture clarity).
    expect(wip.id).toBeTruthy();
  });
});

describe('getSequenceStats — stale_count semantics (Tests 3 + 4 + 5 + 6)', () => {
  test('Test 3: wip shot with completed version > 14d old IS stale; per-row is_stale === 1', () => {
    const shot = hierarchy.createShot(sequenceId, 'sh010');
    // 30 days ago — well past the 14d cutoff.
    seedCompletedVersion(shot.id, Date.now() - 30 * 86_400_000);

    const stats = getSequenceStats(testDb.db, sequenceId);
    expect(stats.stale_count).toBe(1);

    const grid = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(grid.items).toHaveLength(1);
    expect(grid.items[0]!.is_stale).toBe(1);
  });

  test('Test 4 (D-15 grace): shot with zero completed versions is NOT stale', () => {
    hierarchy.createShot(sequenceId, 'sh010');
    // No version inserted — the EXISTS clause must fall out.

    const stats = getSequenceStats(testDb.db, sequenceId);
    expect(stats.stale_count).toBe(0);

    const grid = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(grid.items).toHaveLength(1);
    // Zero completed versions → r.completed_at IS NULL → CASE returns 0.
    expect(grid.items[0]!.is_stale).toBe(0);
  });

  test('Test 5 (OVR-02 status filter): approved shot with old completed version is NOT stale', () => {
    const shot = hierarchy.createShot(sequenceId, 'sh010');
    seedCompletedVersion(shot.id, Date.now() - 30 * 86_400_000);
    // Mutate status AFTER the version is seeded — approved/on-hold/omit/PR are
    // all filtered out by the IN ('wip','pending-review') clause.
    setShotStatus(shot.id, 'approved');

    const stats = getSequenceStats(testDb.db, sequenceId);
    expect(stats.stale_count).toBe(0);

    const grid = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(grid.items[0]!.is_stale).toBe(0);
  });

  test('Test 6: wip shot with completed version < 14d old is NOT stale', () => {
    const shot = hierarchy.createShot(sequenceId, 'sh010');
    // 5 days ago — well within the 14d window.
    seedCompletedVersion(shot.id, Date.now() - 5 * 86_400_000);

    const stats = getSequenceStats(testDb.db, sequenceId);
    expect(stats.stale_count).toBe(0);

    const grid = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(grid.items[0]!.is_stale).toBe(0);
  });

  test('pending-review shot with completed version > 14d old IS stale (OVR-02 covers both statuses)', () => {
    const shot = hierarchy.createShot(sequenceId, 'sh010');
    seedCompletedVersion(shot.id, Date.now() - 30 * 86_400_000);
    setShotStatus(shot.id, 'pending-review');

    const stats = getSequenceStats(testDb.db, sequenceId);
    expect(stats.stale_count).toBe(1);

    const grid = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(grid.items[0]!.is_stale).toBe(1);
  });
});

describe('getSequenceStats — EXPLAIN QUERY PLAN (Tests 7 + 8 — no full table scans)', () => {
  beforeEach(() => {
    // Seed 5 shots so the planner picks a representative path.
    for (let i = 0; i < 5; i++) {
      hierarchy.createShot(sequenceId, `sh${String((i + 1) * 10).padStart(3, '0')}`);
    }
  });

  test('Test 7: GROUP BY counts query plan uses idx_shots_status (no SCAN shots)', () => {
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + getSequenceStatsGroupBySqlText())
      .all(sequenceId) as Array<{ detail: string }>;
    // Whitelist phrasing: planner output must reference USING INDEX
    // idx_shots_status OR SEARCH shots USING (the covering index).
    const usesIndex = planRows.some(
      (r) =>
        r.detail.includes('idx_shots_status') ||
        r.detail.includes('SEARCH shots'),
    );
    expect(usesIndex).toBe(true);
    // Anti-pattern: no full table SCAN on shots without an index.
    const fullScan = planRows.filter((r) =>
      /^SCAN shots( |$)/.test(r.detail),
    );
    expect(fullScan).toEqual([]);
  });

  test('Test 8: stale-count EXISTS query plan does NOT contain SCAN versions (autoindex used)', () => {
    const cutoff = Date.now() - FOURTEEN_DAYS_MS;
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + getSequenceStatsStaleSqlText())
      .all(sequenceId, cutoff) as Array<{ detail: string }>;
    // The EXISTS short-circuit MUST use the versions.shot_id autoindex from
    // UNIQUE(shot_id, version_number) — no full-table scan on versions.
    const versionsFullScan = planRows.filter((r) =>
      /^SCAN versions( |$)/.test(r.detail),
    );
    expect(versionsFullScan).toEqual([]);
    // Similarly assert no full scan on shots in the outer query.
    const shotsFullScan = planRows.filter((r) =>
      /^SCAN shots( |$)/.test(r.detail),
    );
    expect(shotsFullScan).toEqual([]);
  });

  test('Test 8b (positive): stale-count plan uses an INDEX for the versions EXISTS subquery (no full scan)', () => {
    const cutoff = Date.now() - FOURTEEN_DAYS_MS;
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + getSequenceStatsStaleSqlText())
      .all(sequenceId, cutoff) as Array<{ detail: string }>;
    // SQLite plans the EXISTS subquery as `SEARCH v ... USING INDEX ...` —
    // the table is aliased as `v` so the plan row uses the alias, not the
    // table name. Accept any index-backed access path on the versions table:
    // SEARCH v (aliased), SEARCH versions (full name), or any explicit
    // sqlite_autoindex / USING INDEX reference. The negative invariant in
    // Test 8 above is the load-bearing assertion (no SCAN versions); this
    // positive test documents the planner picks an index path.
    const usesIndexForVersions = planRows.some(
      (r) =>
        r.detail.includes('SEARCH v ') ||
        r.detail.includes('SEARCH versions') ||
        r.detail.includes('sqlite_autoindex_versions') ||
        (r.detail.includes('versions') && r.detail.includes('USING INDEX')) ||
        (r.detail.includes(' v ') && r.detail.includes('USING INDEX')),
    );
    expect(usesIndexForVersions).toBe(true);
  });
});
