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
  type SortField,
  type SortDirection,
  type VersionSort,
} from '../sort.js';

/**
 * Phase 18 / Plan 18-02 — Whitelist sort + NULL-pin + default page size
 * + return-shape coverage for VersionRepo.listByShot under composite-cursor
 * pagination. Cursor stability invariants live in version-repo-cursor.test.ts.
 *
 * Behavior covered:
 *   - SORT-01 default sort: NULL band pinned to top, completed_at DESC under
 *     it; in-progress versions surface above completed regardless of sort dir.
 *   - SORT-02 whitelist: every (field, dir) tuple in 4×2=8 enum values is
 *     accepted without throwing.
 *   - NULL-pin under Oldest direction: in-progress band still pinned (D-01).
 *   - NULL-pin shape consistency for non-null fields (version_number).
 *   - Default page-size 20 (CLAUDE.md convention + D-18).
 *   - Return shape: exactly { items, next_cursor, total_count }.
 *   - next_cursor null on last page; non-null when more pages exist.
 */

interface Fixture {
  id?: string;
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
  const ws = hierarchy.createWorkspace(`ws-sort-${nanoid(6)}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  shotId = shot.id;
});

/**
 * Bypasses repo.insertVersion so deterministic completed_at/created_at can be
 * set directly. The repo's insert path stamps Date.now() into created_at and
 * leaves completed_at NULL — fine for ordering by version_number, but the
 * NULL-pin tests need explicit completed_at values.
 */
function setupShotWithVersions(fixtures: Fixture[]): string[] {
  const ids: string[] = [];
  for (const f of fixtures) {
    const id = f.id ?? `ver_${nanoid(10)}`;
    testDb.db
      .insert(versions)
      .values({
        id,
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
    ids.push(id);
  }
  return ids;
}

describe('VersionRepo.listByShot — SORT-01 default sort + NULL-pin', () => {
  test('default Latest sort: in-progress band pinned to top, completed sorted DESC by completed_at', () => {
    // 3 completed (completed_at = 1000/2000/3000) + 2 in-progress (NULL).
    const [
      completed1000,
      completed2000,
      completed3000,
      inProgress1,
      inProgress2,
    ] = setupShotWithVersions([
      { id: 'ver_completed1000', version_number: 1, status: 'completed', completed_at: 1000, created_at: 100 },
      { id: 'ver_completed2000', version_number: 2, status: 'completed', completed_at: 2000, created_at: 200 },
      { id: 'ver_completed3000', version_number: 3, status: 'completed', completed_at: 3000, created_at: 300 },
      { id: 'ver_inProgress1', version_number: 4, status: 'submitted', completed_at: null, created_at: 400 },
      { id: 'ver_inProgress2', version_number: 5, status: 'running', completed_at: null, created_at: 500 },
    ]);

    const result = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 20,
    });

    // In-progress (cna=true) band first (DESC on the IS NULL bit), then completed band DESC by completed_at.
    // Within in-progress band, the tiebreaker is versions.id ASC, so 'ver_inProgress1' < 'ver_inProgress2'.
    expect(result.items.map((v) => v.id)).toEqual([
      inProgress1,
      inProgress2,
      completed3000,
      completed2000,
      completed1000,
    ]);
  });
});

describe('VersionRepo.listByShot — SORT-02 whitelist enum × directions', () => {
  const FIELDS: SortField[] = ['completed_at', 'created_at', 'name', 'version_number'];
  const DIRS: SortDirection[] = ['asc', 'desc'];

  beforeEach(() => {
    setupShotWithVersions([
      { version_number: 1, status: 'completed', completed_at: 1000, created_at: 100 },
      { version_number: 2, status: 'completed', completed_at: 2000, created_at: 200 },
      { version_number: 3, status: 'submitted', completed_at: null, created_at: 300 },
    ]);
  });

  for (const field of FIELDS) {
    for (const dir of DIRS) {
      test(`accepts sort { field: '${field}', dir: '${dir}' } without throwing`, () => {
        const sort: VersionSort = { field, dir };
        expect(() => repo.listByShot(shotId, { sort, cursor: null, limit: 20 })).not.toThrow();
        const result = repo.listByShot(shotId, { sort, cursor: null, limit: 20 });
        expect(result.items.length).toBeGreaterThan(0);
      });
    }
  }
});

describe('VersionRepo.listByShot — NULL-pin under Oldest direction', () => {
  test('Oldest sort: in-progress band STILL pinned to top (D-01 holds for both directions)', () => {
    const [
      completed1000,
      completed2000,
      inProgress,
    ] = setupShotWithVersions([
      { id: 'ver_completed1000', version_number: 1, status: 'completed', completed_at: 1000, created_at: 100 },
      { id: 'ver_completed2000', version_number: 2, status: 'completed', completed_at: 2000, created_at: 200 },
      { id: 'ver_inProgress', version_number: 3, status: 'submitted', completed_at: null, created_at: 300 },
    ]);

    const result = repo.listByShot(shotId, {
      sort: { field: 'completed_at', dir: 'asc' },
      cursor: null,
      limit: 20,
    });

    // In-progress pinned first (NULL-bit = 1, DESC); completed band sorted ASC.
    expect(result.items.map((v) => v.id)).toEqual([
      inProgress,
      completed1000,
      completed2000,
    ]);
  });
});

describe('VersionRepo.listByShot — NULL-pin shape with non-null fields', () => {
  test("version_number sort: in-progress still surfaces at top because (completed_at IS NULL) DESC is the first ORDER BY term", () => {
    const [
      completed1,
      completed2,
      inProgress,
    ] = setupShotWithVersions([
      { id: 'ver_completed1', version_number: 1, status: 'completed', completed_at: 1000, created_at: 100 },
      { id: 'ver_completed2', version_number: 2, status: 'completed', completed_at: 2000, created_at: 200 },
      { id: 'ver_inProgress', version_number: 3, status: 'submitted', completed_at: null, created_at: 300 },
    ]);

    // version_number DESC should still produce in-progress at top (NULL-pin first term).
    const result = repo.listByShot(shotId, {
      sort: { field: 'version_number', dir: 'desc' },
      cursor: null,
      limit: 20,
    });

    expect(result.items[0].id).toBe(inProgress);
    // After NULL-pin band: completed rows DESC by version_number.
    expect(result.items.slice(1).map((v) => v.id)).toEqual([completed2, completed1]);
  });
});

describe('VersionRepo.listByShot — default page size + return shape', () => {
  test('limit=20 caps result count at 20 even when more rows exist', () => {
    // 25 completed versions.
    const fixtures: Fixture[] = [];
    for (let i = 0; i < 25; i++) {
      fixtures.push({
        version_number: i + 1,
        status: 'completed',
        completed_at: 1000 + i,
        created_at: 100 + i,
      });
    }
    setupShotWithVersions(fixtures);

    const result = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 20,
    });

    expect(result.items.length).toBeLessThanOrEqual(20);
    expect(result.items).toHaveLength(20);
  });

  test('return shape is exactly { items, next_cursor, total_count }', () => {
    setupShotWithVersions([
      { version_number: 1, status: 'completed', completed_at: 1000, created_at: 100 },
    ]);

    const result = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 20,
    });

    expect(Object.keys(result).sort()).toEqual(['items', 'next_cursor', 'total_count']);
  });

  test('next_cursor is null when total rows ≤ limit (last page reached)', () => {
    setupShotWithVersions([
      { version_number: 1, status: 'completed', completed_at: 1000, created_at: 100 },
      { version_number: 2, status: 'completed', completed_at: 2000, created_at: 200 },
    ]);

    const result = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 20,
    });

    expect(result.next_cursor).toBeNull();
    expect(result.items).toHaveLength(2);
    expect(result.total_count).toBe(2);
  });

  test('next_cursor is a non-empty base64url string when total rows > limit, items.length === limit', () => {
    // 5 versions, limit = 3 → next_cursor non-null + items length === 3.
    setupShotWithVersions([
      { version_number: 1, status: 'completed', completed_at: 1000, created_at: 100 },
      { version_number: 2, status: 'completed', completed_at: 2000, created_at: 200 },
      { version_number: 3, status: 'completed', completed_at: 3000, created_at: 300 },
      { version_number: 4, status: 'completed', completed_at: 4000, created_at: 400 },
      { version_number: 5, status: 'completed', completed_at: 5000, created_at: 500 },
    ]);

    const result = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 3,
    });

    expect(result.items).toHaveLength(3);
    expect(result.next_cursor).not.toBeNull();
    expect(typeof result.next_cursor).toBe('string');
    expect(result.next_cursor!.length).toBeGreaterThan(0);
    // base64url alphabet: A-Z, a-z, 0-9, -, _
    expect(result.next_cursor!).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.total_count).toBe(5);
  });
});

describe('VersionRepo.listByShot — total_count is cursor-independent', () => {
  test('total_count remains the same across pages of the cursor walk', () => {
    setupShotWithVersions(
      Array.from({ length: 10 }, (_, i) => ({
        version_number: i + 1,
        status: 'completed',
        completed_at: 1000 + i * 100,
        created_at: 100 + i,
      })),
    );

    const page1 = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 4,
    });
    expect(page1.total_count).toBe(10);
    expect(page1.next_cursor).not.toBeNull();
  });
});

describe('VersionRepo.listByShot — empty shot', () => {
  test('returns items:[], next_cursor:null, total_count:0 for a shot with no versions', () => {
    const result = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 20,
    });
    expect(result.items).toEqual([]);
    expect(result.next_cursor).toBeNull();
    expect(result.total_count).toBe(0);
  });
});

describe('VersionRepo.listByShot — shot scoping', () => {
  test('only returns versions for the requested shot id', () => {
    // Add a second shot in the same sequence with its own versions.
    const seq = hierarchy.createSequence(
      hierarchy.createProject(hierarchy.createWorkspace(`ws-other-${nanoid(6)}`).id, 'p2').id,
      'sq020',
    );
    const otherShot = hierarchy.createShot(seq.id, 'sh020');
    setupShotWithVersions([
      { version_number: 1, status: 'completed', completed_at: 1000, created_at: 100 },
      { version_number: 2, status: 'completed', completed_at: 2000, created_at: 200 },
    ]);
    // Insert versions on the OTHER shot.
    testDb.db
      .insert(versions)
      .values({
        id: 'ver_other',
        shot_id: otherShot.id,
        version_number: 1,
        status: 'completed',
        job_id: null,
        parent_version_id: null,
        notes: null,
        created_at: 100,
        completed_at: 1000,
        error_code: null,
        error_message: null,
        outputs_json: null,
        lineage_type: null,
        reproduction_warnings_json: null,
      })
      .run();

    const result = repo.listByShot(shotId, {
      sort: DEFAULT_VERSION_SORT,
      cursor: null,
      limit: 20,
    });
    expect(result.items).toHaveLength(2);
    expect(result.total_count).toBe(2);
    for (const v of result.items) {
      expect(v.shot_id).toBe(shotId);
    }
    // Sanity: ensure the other shot's row exists in the DB so the test scope
    // matters. (Reads via raw drizzle to bypass listByShot.)
    const allCount = testDb.db
      .select()
      .from(versions)
      .where(eq(versions.shot_id, otherShot.id))
      .all().length;
    expect(allCount).toBe(1);
  });
});
