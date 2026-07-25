import { describe, test, expect, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import '../../test-utils/matchers.js';
import { makeInMemoryDb, type TestDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import { versions } from '../schema.js';
import {
  DEFAULT_VERSION_SORT,
  decodeVersionCursor,
  type VersionCursor,
  type VersionSort,
  type SortField,
  type SortDirection,
} from '../sort.js';
import type { Version } from '../../types/hierarchy.js';

/**
 * Phase 18 / Plan 18-02 — Composite-cursor pagination stability for
 * VersionRepo.listByShot. Covers SORT-05:
 *   - Round-trip walk has no duplicates / no skips across full table sweep.
 *   - Insert race + delete race tolerated (no duplicate ids across pages).
 *   - Multi-field round-trip (3 representative sort tuples).
 *   - NULL band traversal (cursor.cna captures band correctly).
 *   - total_count parity across pages (cursor-independent).
 */

interface Fixture {
  id: string;
  version_number: number;
  status: string;
  completed_at: number | null;
  created_at: number;
}

let testDb: TestDb;
let repo: VersionRepo;
let hierarchy: HierarchyRepo;
let shotId: string;

beforeEach(() => {
  testDb = makeInMemoryDb();
  repo = new VersionRepo(testDb.db);
  hierarchy = new HierarchyRepo(testDb.db);
  const ws = hierarchy.createWorkspace(`ws-cursor-${nanoid(6)}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  shotId = shot.id;
});

function insertFixtures(fixtures: Fixture[]): void {
  for (const f of fixtures) {
    testDb.db
      .insert(versions)
      .values({
        id: f.id,
        shot_id: shotId,
        version_number: f.version_number,
        status: f.status,
        job_id: null,
        parent_version_id: null,
        notes: null,
        created_at: f.created_at,
        completed_at: f.completed_at,
        error_code: null,
        error_message: null,
        outputs_json: null,
        lineage_type: null,
        reproduction_warnings_json: null,
      })
      .run();
  }
}

/**
 * Walk every page until next_cursor === null. Concatenates all items into a
 * single array. Safety cap of 100 iterations protects against infinite-cursor
 * regressions; 47-row fixture × pageSize=10 is at most 5 pages.
 */
function walkAllPages(
  sort: VersionSort,
  pageSize: number,
): { allItems: Version[]; pageCount: number } {
  const allItems: Version[] = [];
  let cursor: VersionCursor | null = null;
  let pageCount = 0;
  while (pageCount < 100) {
    const page = repo.listByShot(shotId, { sort, cursor, limit: pageSize });
    allItems.push(...page.items);
    pageCount += 1;
    if (page.next_cursor === null) break;
    cursor = decodeVersionCursor(page.next_cursor);
    if (cursor === null) {
      throw new Error('Test bug: cursor decode failed mid-walk');
    }
  }
  return { allItems, pageCount };
}

/**
 * Counter-based deterministic seed (NOT Math.random) so tests are reproducible.
 * Returns a hash-distributed-ish number in [0, 10000) for completed_at spread.
 */
function pseudoRandomTs(seed: number, salt: number): number {
  // Simple multiplicative hash; deterministic for given (seed, salt).
  return ((seed * 2654435761 + salt) >>> 0) % 10000;
}

function build47CompletedFixture(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (let i = 0; i < 47; i++) {
    fixtures.push({
      id: `ver_completed_${String(i).padStart(2, '0')}`,
      version_number: i + 1,
      status: 'completed',
      completed_at: 1_000_000 + pseudoRandomTs(i, 1),
      created_at: 500_000 + pseudoRandomTs(i, 2),
    });
  }
  return fixtures;
}

describe('VersionRepo.listByShot — SORT-05 round-trip walk (no duplicates / no skips)', () => {
  test('full walk of 47 completed versions across multiple pages has no duplicates and no skips', () => {
    insertFixtures(build47CompletedFixture());

    const { allItems, pageCount } = walkAllPages(DEFAULT_VERSION_SORT, 10);

    // (a) Total length === 47
    expect(allItems).toHaveLength(47);
    // (b) Every original id appears exactly once.
    const ids = allItems.map((v) => v.id);
    expect(new Set(ids).size).toBe(47);
    // Multi-page walk: 47 / 10 = 5 pages.
    expect(pageCount).toBe(5);
    // (c) Last cursor.next_cursor IS null on final page; assertion implicit
    // via walkAllPages while-loop exit. Verify cross-page id-set parity:
    const baseline = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 100,
    });
    expect(baseline.items.map((v) => v.id).sort()).toEqual(ids.slice().sort());
  });
});

describe('VersionRepo.listByShot — SORT-05 no duplicates under insert race', () => {
  test('insert mid-walk does not produce duplicate ids across pages', () => {
    insertFixtures(build47CompletedFixture());

    // Walk page 1 (limit=10).
    const page1 = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 10,
    });
    const page1Ids = page1.items.map((v) => v.id);
    expect(page1.next_cursor).not.toBeNull();

    // Insert a NEW completed version with the most-recent completed_at AFTER
    // the cursor was captured. Under composite cursor, this new row should
    // NOT appear on page 2 (it would have been on page 1 if it had existed
    // earlier — its completed_at is greater than every existing row).
    insertFixtures([
      {
        id: 'ver_inserted_late',
        version_number: 100,
        status: 'completed',
        completed_at: 9_999_999, // most recent
        created_at: 9_000_000,
      },
    ]);

    // Walk pages 2..N from the page-1 cursor.
    const remainingIds: string[] = [];
    let cursor: VersionCursor | null = decodeVersionCursor(page1.next_cursor!);
    while (cursor !== null) {
      const page = repo.listByShot(shotId, {
        sort: DEFAULT_VERSION_SORT,
        cursor,
        limit: 10,
      });
      remainingIds.push(...page.items.map((v) => v.id));
      if (page.next_cursor === null) break;
      cursor = decodeVersionCursor(page.next_cursor);
    }

    const allWalkedIds = [...page1Ids, ...remainingIds];

    // No duplicate ids across all pages.
    expect(new Set(allWalkedIds).size).toBe(allWalkedIds.length);
    // The newly inserted row is NOT present in pages 2..N (it would have
    // appeared on page 1 if walked from a fresh cursor). This is correct
    // composite-cursor behavior — pagination is anchored to a snapshot.
    expect(allWalkedIds).not.toContain('ver_inserted_late');
  });
});

describe('VersionRepo.listByShot — SORT-05 no duplicates under delete race', () => {
  test('delete mid-walk does not produce duplicate ids across pages', () => {
    insertFixtures(build47CompletedFixture());

    // Walk page 1 (limit=10).
    const page1 = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 10,
    });
    const page1Ids = page1.items.map((v) => v.id);
    expect(page1.next_cursor).not.toBeNull();

    // Delete row at position 5 from page 1 (already returned).
    const deletedId = page1.items[4].id;
    testDb.db.delete(versions).where(eq(versions.id, deletedId)).run();

    // Walk pages 2..N.
    const remainingIds: string[] = [];
    let cursor: VersionCursor | null = decodeVersionCursor(page1.next_cursor!);
    while (cursor !== null) {
      const page = repo.listByShot(shotId, {
        sort: DEFAULT_VERSION_SORT,
        cursor,
        limit: 10,
      });
      remainingIds.push(...page.items.map((v) => v.id));
      if (page.next_cursor === null) break;
      cursor = decodeVersionCursor(page.next_cursor);
    }

    const allWalkedIds = [...page1Ids, ...remainingIds];

    // No duplicates across all pages.
    expect(new Set(allWalkedIds).size).toBe(allWalkedIds.length);
    // The deleted id is still in page1Ids (it was returned BEFORE deletion),
    // but should NOT appear again in pages 2..N.
    expect(remainingIds).not.toContain(deletedId);
  });
});

describe('VersionRepo.listByShot — SORT-05 multi-field round-trip', () => {
  // 'name' is skipped: VERSION_COL_REF['name'] falls back to versions.id
  // (DEVIATION 2 — the dashboard never exposes this option). Walking with
  // {field:'name'} would be redundant with id-tiebreaker walks below.
  const cases: Array<{ sort: VersionSort; label: string }> = [
    { sort: { field: 'completed_at', dir: 'asc' }, label: 'completed_at ASC' },
    { sort: { field: 'created_at', dir: 'desc' }, label: 'created_at DESC' },
    { sort: { field: 'version_number', dir: 'asc' }, label: 'version_number ASC' },
  ];

  for (const c of cases) {
    test(`round-trip walk under ${c.label} produces id-set parity with single-page baseline`, () => {
      insertFixtures(build47CompletedFixture());

      const { allItems } = walkAllPages(c.sort, 10);
      const walkedIds = allItems.map((v) => v.id).slice().sort();

      const baseline = repo.listByShot(shotId, {
        sort: c.sort,
        cursor: null,
        limit: 100,
      });
      const baselineIds = baseline.items.map((v) => v.id).slice().sort();

      expect(walkedIds).toEqual(baselineIds);
      expect(walkedIds).toHaveLength(47);
    });
  }
});

describe('VersionRepo.listByShot — SORT-05 cursor with NULL-band exit', () => {
  test('25 in-progress + 25 completed: page 1 returns top of NULL band; cursor advances correctly across the band boundary', () => {
    const fixtures: Fixture[] = [];
    // 25 in-progress (completed_at = NULL).
    for (let i = 0; i < 25; i++) {
      fixtures.push({
        id: `ver_inprog_${String(i).padStart(2, '0')}`,
        version_number: i + 1,
        status: 'submitted',
        completed_at: null,
        created_at: 100 + i,
      });
    }
    // 25 completed.
    for (let i = 0; i < 25; i++) {
      fixtures.push({
        id: `ver_complete_${String(i).padStart(2, '0')}`,
        version_number: i + 26,
        status: 'completed',
        completed_at: 1000 + i,
        created_at: 500 + i,
      });
    }
    insertFixtures(fixtures);

    // Page 1 (limit=10): expect 10 in-progress versions (top of NULL band).
    const page1 = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 10,
    });
    expect(page1.items).toHaveLength(10);
    for (const v of page1.items) {
      expect(v.completed_at).toBeNull();
    }
    expect(page1.next_cursor).not.toBeNull();

    // Decode page-1 cursor: cna should be true (still inside NULL band).
    const cursor1 = decodeVersionCursor(page1.next_cursor!);
    expect(cursor1).not.toBeNull();
    expect(cursor1!.cna).toBe(true);

    // Walk all pages and verify the 50-row id set is fully covered.
    const { allItems, pageCount } = walkAllPages(DEFAULT_VERSION_SORT, 10);
    expect(allItems).toHaveLength(50);
    expect(new Set(allItems.map((v) => v.id)).size).toBe(50);
    expect(pageCount).toBe(5);

    // Boundary check: first 25 rows are in-progress, last 25 are completed.
    expect(allItems.slice(0, 25).every((v) => v.completed_at === null)).toBe(true);
    expect(allItems.slice(25).every((v) => v.completed_at !== null)).toBe(true);
  });
});

describe('VersionRepo.listByShot — SORT-05 total_count parity across pages', () => {
  test('every page in the walk reports the same total_count (cursor-independent)', () => {
    insertFixtures(build47CompletedFixture());

    const totals: number[] = [];
    let cursor: VersionCursor | null = null;
    let safety = 0;
    while (safety < 100) {
      const page = repo.listByShot(shotId, {
        sort: DEFAULT_VERSION_SORT,
        cursor,
        limit: 10,
      });
      totals.push(page.total_count);
      if (page.next_cursor === null) break;
      cursor = decodeVersionCursor(page.next_cursor);
      safety += 1;
    }

    // All page totals are identical (cursor-independent).
    expect(new Set(totals).size).toBe(1);
    expect(totals[0]).toBe(47);
  });
});

describe('VersionRepo.listByShot — id ASC tiebreaker stability under same sort value', () => {
  test('rows with identical sort value paginate stably via versions.id ASC tiebreaker', () => {
    // 12 completed versions all with the SAME completed_at — the tiebreaker
    // (versions.id ASC) is the sole stable ordering signal.
    const fixtures: Fixture[] = [];
    for (let i = 0; i < 12; i++) {
      fixtures.push({
        id: `ver_tiebreak_${String(i).padStart(2, '0')}`,
        version_number: i + 1,
        status: 'completed',
        completed_at: 5000, // ALL identical
        created_at: 100 + i,
      });
    }
    insertFixtures(fixtures);

    const { allItems } = walkAllPages(DEFAULT_VERSION_SORT, 5);

    // 12 rows / 5 per page = 3 pages (5 + 5 + 2).
    expect(allItems).toHaveLength(12);
    // Ordered by versions.id ASC (the tiebreaker becomes the sole sort signal).
    const expected = fixtures.map((f) => f.id).slice().sort();
    expect(allItems.map((v) => v.id)).toEqual(expected);
  });
});

describe('VersionRepo.listByShot — SortField × SortDirection cursor sweep', () => {
  // Lightweight sweep across all 4×2=8 enum values to confirm cursor pagination
  // works on every dimension. Smaller fixture (15 rows) for speed.
  const FIELDS: SortField[] = ['completed_at', 'created_at', 'name', 'version_number'];
  const DIRS: SortDirection[] = ['asc', 'desc'];

  beforeEach(() => {
    insertFixtures(
      Array.from({ length: 15 }, (_, i) => ({
        id: `ver_sweep_${String(i).padStart(2, '0')}`,
        version_number: i + 1,
        status: 'completed',
        completed_at: 1000 + i * 7,
        created_at: 500 + i * 3,
      })),
    );
  });

  for (const field of FIELDS) {
    for (const dir of DIRS) {
      test(`{ field: '${field}', dir: '${dir}' } walks 15 rows in 3 pages of 5 with id-set parity`, () => {
        const sort: VersionSort = { field, dir };
        const { allItems, pageCount } = walkAllPages(sort, 5);

        expect(allItems).toHaveLength(15);
        expect(new Set(allItems.map((v) => v.id)).size).toBe(15);
        expect(pageCount).toBe(3);

        const baseline = repo.listByShot(shotId, {
          sort,
          cursor: null,
          limit: 100,
        });
        expect(baseline.items.map((v) => v.id).slice().sort()).toEqual(
          allItems.map((v) => v.id).slice().sort(),
        );
      });
    }
  }
});
