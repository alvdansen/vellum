import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb, type TestDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import {
  listShotsForGrid,
  listShotsForGridSqlText,
  encodeShotGridCursor,
  decodeShotGridCursor,
  type ShotGridCursor,
  type ShotGridQueryRow,
} from '../shot-status-repo.js';

/**
 * Phase 21 — GRID-04 single-query EXPLAIN QUERY PLAN lock + cursor walk +
 * null-coalesce semantics + total_count parity tests.
 *
 * The EXPLAIN test is load-bearing: it asserts NO `CORRELATED SCALAR
 * SUBQUERY referencing 'ranked'` ever surfaces in the planner output, which
 * is the structural guarantee that the latest-completed-version join stays
 * single-pass. Any future regression that re-introduces a correlated
 * subquery on the `ranked` CTE will fail this test.
 *
 * Fixtures: makeInMemoryDb + HierarchyRepo seeding mirror the shape used by
 * src/store/__tests__/shot-status-repo.test.ts:29-41.
 *
 * Landmines:
 *   - hierarchy.createShot requires names matching /^sh\d{3,}$/. Use sh010,
 *     sh020, ..., sh050.
 *   - DO NOT seed via raw INSERT; always go through HierarchyRepo.createShot
 *     so the shots.status default ('wip') fires.
 *   - EXPLAIN bind params: all 6 placeholders are required even when null;
 *     SQLite needs the param count to match the prepared statement.
 */

let testDb: TestDb;
let hierarchy: HierarchyRepo;
let versionRepo: VersionRepo;
let sequenceId: string;

beforeEach(() => {
  testDb = makeInMemoryDb();
  hierarchy = new HierarchyRepo(testDb.db);
  versionRepo = new VersionRepo(testDb.db);
  const ws = hierarchy.createWorkspace(`ws-grid-${Date.now()}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  sequenceId = seq.id;
});

/**
 * Walk every page of the shot grid until next_cursor === null. Mirrors
 * version-repo-cursor.test.ts walkAllPages. Safety cap at 100 iterations.
 */
function walkAllShotsForGrid(pageSize: number): {
  allItems: ShotGridQueryRow[];
  pageCount: number;
  totals: number[];
} {
  const allItems: ShotGridQueryRow[] = [];
  const totals: number[] = [];
  let cursor: ShotGridCursor | null = null;
  let pageCount = 0;
  while (pageCount < 100) {
    const page = listShotsForGrid(testDb.db, sequenceId, { cursor, limit: pageSize });
    allItems.push(...page.items);
    totals.push(page.total_count);
    pageCount += 1;
    if (page.next_cursor === null) break;
    cursor = decodeShotGridCursor(page.next_cursor);
    if (cursor === null) {
      throw new Error('Test bug: cursor decode failed mid-walk');
    }
  }
  return { allItems, pageCount, totals };
}

describe('listShotsForGrid — EXPLAIN QUERY PLAN (GRID-04 N+1 lock)', () => {
  beforeEach(() => {
    // Seed 5 shots so the planner picks a representative path.
    for (let i = 0; i < 5; i++) {
      const name = `sh${String((i + 1) * 10).padStart(3, '0')}`;
      hierarchy.createShot(sequenceId, name);
    }
  });

  test('plan rows do NOT contain CORRELATED SCALAR SUBQUERY referencing the ranked CTE', () => {
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + listShotsForGridSqlText())
      .all(sequenceId, null, null, null, null, 21) as Array<{ detail: string }>;
    const correlatedRanked = planRows.filter(
      (r) => r.detail.includes('CORRELATED') && r.detail.includes('ranked'),
    );
    expect(correlatedRanked).toEqual([]);
  });

  test('plan rows reference CTE materialization (CO-ROUTINE / MATERIALIZE / ranked)', () => {
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + listShotsForGridSqlText())
      .all(sequenceId, null, null, null, null, 21) as Array<{ detail: string }>;
    const hasCteEvidence = planRows.some(
      (r) =>
        r.detail.includes('CO-ROUTINE') ||
        r.detail.includes('MATERIALIZE') ||
        r.detail.includes('ranked'),
    );
    expect(hasCteEvidence).toBe(true);
  });
});

describe('listShotsForGrid — status null-coalesce (GRID-04)', () => {
  test('5 fresh shots (no status events) return status: "wip"', () => {
    for (let i = 0; i < 5; i++) {
      hierarchy.createShot(sequenceId, `sh${String((i + 1) * 10).padStart(3, '0')}`);
    }
    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(5);
    for (const item of result.items) {
      expect(item.status).toBe('wip');
    }
  });
});

describe('listShotsForGrid — latest_completed_version', () => {
  test('shot with 2 completed versions populates lcv_id (latest completed_at) + lcv_completed_at', () => {
    const shot = hierarchy.createShot(sequenceId, 'sh010');
    // Insert 2 versions, mark both completed. The second one is the latest
    // by completed_at because markCompleted stamps Date.now() (the test
    // setTimeout below guarantees increasing timestamps even on coarse clocks).
    const v1 = versionRepo.insertVersion(shot.id);
    versionRepo.markCompleted(v1.id, '[]');
    // Synchronous sleep via busy-wait — Date.now() ticks at ≥ 1ms; this
    // guarantees v2.completed_at > v1.completed_at without an async/await
    // suspension that vitest fake-timers would interfere with.
    const start = Date.now();
    while (Date.now() === start) {
      // spin
    }
    const v2 = versionRepo.insertVersion(shot.id);
    versionRepo.markCompleted(v2.id, '[]');

    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.lcv_id).toBe(v2.id);
    expect(typeof result.items[0]!.lcv_completed_at).toBe('number');
    expect(result.items[0]!.lcv_completed_at).not.toBeNull();
  });

  test('shot with 1 submitted-but-not-completed version yields lcv_id=null + lcv_completed_at=null', () => {
    const shot = hierarchy.createShot(sequenceId, 'sh010');
    versionRepo.insertVersion(shot.id);
    // Intentionally skip markCompleted — the version stays at status='submitted'.

    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.lcv_id).toBeNull();
    expect(result.items[0]!.lcv_completed_at).toBeNull();
  });
});

describe('listShotsForGrid — version_count counts ALL versions', () => {
  test('shot with 2 completed + 1 submitted versions has version_count=3', () => {
    const shot = hierarchy.createShot(sequenceId, 'sh010');
    const v1 = versionRepo.insertVersion(shot.id);
    const v2 = versionRepo.insertVersion(shot.id);
    versionRepo.insertVersion(shot.id); // third version stays submitted
    versionRepo.markCompleted(v1.id, '[]');
    versionRepo.markCompleted(v2.id, '[]');

    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.version_count).toBe(3);
  });
});

describe('listShotsForGrid — cursor walk', () => {
  test('5 shots with pageSize=2 produces 3 pages with every id visited exactly once', () => {
    for (let i = 0; i < 5; i++) {
      hierarchy.createShot(sequenceId, `sh${String((i + 1) * 10).padStart(3, '0')}`);
    }
    const { allItems, pageCount } = walkAllShotsForGrid(2);
    expect(allItems).toHaveLength(5);
    const ids = allItems.map((it) => it.id);
    expect(new Set(ids).size).toBe(allItems.length);
    expect(pageCount).toBe(3);
  });
});

describe('listShotsForGrid — total_count parity across pages', () => {
  test('every page in the walk reports the same total_count (cursor-independent)', () => {
    for (let i = 0; i < 5; i++) {
      hierarchy.createShot(sequenceId, `sh${String((i + 1) * 10).padStart(3, '0')}`);
    }
    const { totals } = walkAllShotsForGrid(2);
    expect(new Set(totals).size).toBe(1);
    expect(totals[0]).toBe(5);
    // Sanity check that every page reported 5 individually
    for (const t of totals) {
      expect(t).toBe(5);
    }
  });
});

describe('decodeShotGridCursor — defensive (NEVER throws)', () => {
  test('returns null for a malformed (non-base64) string', () => {
    expect(decodeShotGridCursor('not-base64!@#')).toBeNull();
  });

  test('returns null for an empty string', () => {
    expect(decodeShotGridCursor('')).toBeNull();
  });

  test('returns null for valid base64url that decodes to non-JSON', () => {
    // 'garbage' → base64url → still won't parse as JSON
    const garbage = Buffer.from('garbage', 'utf8').toString('base64url');
    expect(decodeShotGridCursor(garbage)).toBeNull();
  });

  test('returns null for valid JSON missing required fields', () => {
    const missingSid = Buffer.from(JSON.stringify({ n: 'sh010' }), 'utf8').toString('base64url');
    expect(decodeShotGridCursor(missingSid)).toBeNull();
  });

  test('encode then decode round-trips a valid cursor', () => {
    const c: ShotGridCursor = { n: 'sh010', sid: 'shot_abc' };
    expect(decodeShotGridCursor(encodeShotGridCursor(c))).toEqual(c);
  });
});
