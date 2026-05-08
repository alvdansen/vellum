import { describe, test, expect, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';
import '../../test-utils/matchers.js';
import { makeInMemoryDb, type TestDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { workspaces, projects, sequences, shots } from '../schema.js';
import type { HierarchySort } from '../sort.js';
import { Engine } from '../../engine/pipeline.js';
import { VersionRepo } from '../version-repo.js';
import { ProvenanceRepo } from '../provenance-repo.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';

/**
 * Phase 18 / Plan 18-03 — hierarchy-repo opts.sort coverage + back-compat
 * preservation + workspace untouched + Engine facade forwarding.
 *
 * Behavior covered (matches plan tests 1-11):
 *   1. Back-compat — opts omitted → pre-Phase-18 created_at ASC, id ASC ordering
 *      (D-10 invariant for MCP tool callers).
 *   2/3. listProjects sort=name asc/desc against deterministic name fixture.
 *   4. listProjects sort=created_at desc.
 *   5. Whitelist enum sweep — every (field, dir) tuple in 2×2=4 combinations.
 *   6. listSequences mirror.
 *   7. listShots mirror.
 *   8. listWorkspaces signature unchanged (no opts surface; D-WEBUI scope).
 *   9. id ASC tiebreaker invariant when sort values collide.
 *  10. Tool back-compat regression — engine.listProjects(workspaceId, limit, offset)
 *      compiles + returns the unchanged-default ORDER BY.
 *  11. Engine facade forwards opts byte-equal to repo.
 */

interface TestContext {
  testDb: TestDb;
  repo: HierarchyRepo;
  workspaceId: string;
  /**
   * Lazily-built parent chain. Tests that need a project/sequence call
   * `ensureProject()` / `ensureSequence()` on demand so per-test fixtures
   * own which rows exist (avoids beforeEach contamination of project/sequence
   * list assertions).
   */
}

let ctx: TestContext;

beforeEach(() => {
  const testDb = makeInMemoryDb();
  const repo = new HierarchyRepo(testDb.db);
  const ws = repo.createWorkspace(`ws-h-${nanoid(6)}`);
  ctx = {
    testDb,
    repo,
    workspaceId: ws.id,
  };
});

/**
 * Lazily create a project under ctx.workspaceId for tests that need a
 * sequence/shot parent chain. The created project is the ONLY row under
 * ctx.workspaceId after this call (test isolation invariant).
 */
function ensureProject(name = 'p1'): string {
  const proj = ctx.repo.createProject(ctx.workspaceId, name);
  return proj.id;
}

function ensureSequence(projectId: string, name = 'sq010'): string {
  const seq = ctx.repo.createSequence(projectId, name);
  return seq.id;
}

/**
 * Insert N projects under the given workspace with deterministic name +
 * created_at values. Bypasses repo.createProject so the test owns timestamp
 * control (the repo stamps Date.now() into created_at — fine for ordering
 * tests when we want sequenced timestamps but need explicit values).
 */
function insertProjects(
  workspaceId: string,
  rows: Array<{ name: string; created_at: number; id?: string }>,
): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    const id = r.id ?? `proj_${nanoid(10)}`;
    ctx.testDb.db
      .insert(projects)
      .values({
        id,
        workspace_id: workspaceId,
        name: r.name,
        naming_template: null,
        created_at: r.created_at,
      })
      .run();
    ids.push(id);
  }
  return ids;
}

function insertSequences(
  projectId: string,
  rows: Array<{ name: string; created_at: number; id?: string }>,
): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    const id = r.id ?? `seq_${nanoid(10)}`;
    ctx.testDb.db
      .insert(sequences)
      .values({
        id,
        project_id: projectId,
        name: r.name,
        created_at: r.created_at,
      })
      .run();
    ids.push(id);
  }
  return ids;
}

function insertShots(
  sequenceId: string,
  rows: Array<{ name: string; created_at: number; id?: string }>,
): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    const id = r.id ?? `shot_${nanoid(10)}`;
    ctx.testDb.db
      .insert(shots)
      .values({
        id,
        sequence_id: sequenceId,
        name: r.name,
        created_at: r.created_at,
      })
      .run();
    ids.push(id);
  }
  return ids;
}

// ============================================================================
// Test 1 — Back-compat: opts omitted preserves created_at ASC, id ASC ordering
// ============================================================================
describe('HierarchyRepo back-compat (D-10 — opts omitted)', () => {
  test('listProjects without opts uses created_at ASC, id ASC (pre-Phase-18 baseline)', () => {
    insertProjects(ctx.workspaceId, [
      { name: 'Cherry', created_at: 3000, id: 'proj_aaa' },
      { name: 'Apple', created_at: 1000, id: 'proj_bbb' },
      { name: 'Banana', created_at: 2000, id: 'proj_ccc' },
    ]);
    const result = ctx.repo.listProjects(ctx.workspaceId, 20, 0);
    expect(result.items.map((p) => p.name)).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  test('listSequences without opts uses created_at ASC, id ASC', () => {
    const projectId = ensureProject();
    insertSequences(projectId, [
      { name: 'sq030', created_at: 3000 },
      { name: 'sq010', created_at: 1000 },
      { name: 'sq020', created_at: 2000 },
    ]);
    const result = ctx.repo.listSequences(projectId, 20, 0);
    expect(result.items.map((s) => s.created_at)).toEqual([1000, 2000, 3000]);
  });

  test('listShots without opts uses created_at ASC, id ASC', () => {
    const projectId = ensureProject();
    const sequenceId = ensureSequence(projectId);
    insertShots(sequenceId, [
      { name: 'sh030', created_at: 3000 },
      { name: 'sh010', created_at: 1000 },
      { name: 'sh020', created_at: 2000 },
    ]);
    const result = ctx.repo.listShots(sequenceId, 20, 0);
    expect(result.items.map((s) => s.created_at)).toEqual([1000, 2000, 3000]);
  });
});

// ============================================================================
// Tests 2-5 — listProjects opts.sort coverage (whitelist enum sweep)
// ============================================================================
describe('HierarchyRepo.listProjects opts.sort', () => {
  test('Test 2: sort=name asc returns alphabetic ASC order', () => {
    insertProjects(ctx.workspaceId, [
      { name: 'Cherry', created_at: 1000 },
      { name: 'Apple', created_at: 2000 },
      { name: 'Banana', created_at: 3000 },
      { name: 'Date', created_at: 4000 },
      { name: 'Elderberry', created_at: 5000 },
    ]);
    const result = ctx.repo.listProjects(ctx.workspaceId, 20, 0, {
      sort: { field: 'name', dir: 'asc' },
    });
    expect(result.items.map((p) => p.name)).toEqual([
      'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry',
    ]);
  });

  test('Test 3: sort=name desc returns reversed alphabetic order', () => {
    insertProjects(ctx.workspaceId, [
      { name: 'Cherry', created_at: 1000 },
      { name: 'Apple', created_at: 2000 },
      { name: 'Banana', created_at: 3000 },
      { name: 'Date', created_at: 4000 },
      { name: 'Elderberry', created_at: 5000 },
    ]);
    const result = ctx.repo.listProjects(ctx.workspaceId, 20, 0, {
      sort: { field: 'name', dir: 'desc' },
    });
    expect(result.items.map((p) => p.name)).toEqual([
      'Elderberry', 'Date', 'Cherry', 'Banana', 'Apple',
    ]);
  });

  test('Test 4: sort=created_at desc returns newest-first', () => {
    insertProjects(ctx.workspaceId, [
      { name: 'A', created_at: 1000 },
      { name: 'B', created_at: 2000 },
      { name: 'C', created_at: 3000 },
    ]);
    const result = ctx.repo.listProjects(ctx.workspaceId, 20, 0, {
      sort: { field: 'created_at', dir: 'desc' },
    });
    expect(result.items.map((p) => p.created_at)).toEqual([3000, 2000, 1000]);
  });

  test('Test 5: whitelist enum coverage — all 2x2=4 combinations', () => {
    insertProjects(ctx.workspaceId, [
      { name: 'Banana', created_at: 1000 },
      { name: 'Apple', created_at: 3000 },
      { name: 'Cherry', created_at: 2000 },
    ]);
    const combinations: Array<{ sort: HierarchySort; expected: string[] }> = [
      { sort: { field: 'name', dir: 'asc' }, expected: ['Apple', 'Banana', 'Cherry'] },
      { sort: { field: 'name', dir: 'desc' }, expected: ['Cherry', 'Banana', 'Apple'] },
      { sort: { field: 'created_at', dir: 'asc' }, expected: ['Banana', 'Cherry', 'Apple'] },
      { sort: { field: 'created_at', dir: 'desc' }, expected: ['Apple', 'Cherry', 'Banana'] },
    ];
    for (const { sort, expected } of combinations) {
      const result = ctx.repo.listProjects(ctx.workspaceId, 20, 0, { sort });
      expect(
        result.items.map((p) => p.name),
        `sort=${sort.field}:${sort.dir}`,
      ).toEqual(expected);
    }
  });
});

// ============================================================================
// Test 6 — sequences mirror
// ============================================================================
describe('HierarchyRepo.listSequences opts.sort', () => {
  test('Test 6: sequences sort=name asc returns alphabetic ASC', () => {
    const projectId = ensureProject();
    insertSequences(projectId, [
      { name: 'sq040', created_at: 1000 },
      { name: 'sq010', created_at: 2000 },
      { name: 'sq030', created_at: 3000 },
      { name: 'sq020', created_at: 4000 },
    ]);
    const result = ctx.repo.listSequences(projectId, 20, 0, {
      sort: { field: 'name', dir: 'asc' },
    });
    expect(result.items.map((s) => s.name)).toEqual(['sq010', 'sq020', 'sq030', 'sq040']);
  });

  test('Test 6b: sequences sort=created_at desc', () => {
    const projectId = ensureProject();
    insertSequences(projectId, [
      { name: 'sq010', created_at: 1000 },
      { name: 'sq020', created_at: 2000 },
      { name: 'sq030', created_at: 3000 },
    ]);
    const result = ctx.repo.listSequences(projectId, 20, 0, {
      sort: { field: 'created_at', dir: 'desc' },
    });
    expect(result.items.map((s) => s.created_at)).toEqual([3000, 2000, 1000]);
  });
});

// ============================================================================
// Test 7 — shots mirror
// ============================================================================
describe('HierarchyRepo.listShots opts.sort', () => {
  test('Test 7: shots sort=created_at desc returns newest-first', () => {
    const projectId = ensureProject();
    const sequenceId = ensureSequence(projectId);
    insertShots(sequenceId, [
      { name: 'sh010', created_at: 1000 },
      { name: 'sh020', created_at: 2000 },
      { name: 'sh030', created_at: 3000 },
      { name: 'sh040', created_at: 4000 },
    ]);
    const result = ctx.repo.listShots(sequenceId, 20, 0, {
      sort: { field: 'created_at', dir: 'desc' },
    });
    expect(result.items.map((s) => s.created_at)).toEqual([4000, 3000, 2000, 1000]);
  });

  test('Test 7b: shots sort=name asc — alphabetic ASC', () => {
    const projectId = ensureProject();
    const sequenceId = ensureSequence(projectId);
    insertShots(sequenceId, [
      { name: 'sh030', created_at: 1000 },
      { name: 'sh010', created_at: 2000 },
      { name: 'sh020', created_at: 3000 },
    ]);
    const result = ctx.repo.listShots(sequenceId, 20, 0, {
      sort: { field: 'name', dir: 'asc' },
    });
    expect(result.items.map((s) => s.name)).toEqual(['sh010', 'sh020', 'sh030']);
  });
});

// ============================================================================
// Test 8 — workspaces unchanged (D-WEBUI scope; not user-facing in tree dropdown)
// ============================================================================
describe('HierarchyRepo.listWorkspaces signature is unchanged', () => {
  test('Test 8: listWorkspaces takes (limit, offset) only — no opts surface', () => {
    // Insert two more workspaces with deterministic created_at to verify the
    // pre-Phase-18 created_at ASC, id ASC order remains.
    ctx.testDb.db.insert(workspaces).values({
      id: 'ws_zzz_late', name: `late-${nanoid(6)}`, naming_template: null, created_at: 9000,
    }).run();
    ctx.testDb.db.insert(workspaces).values({
      id: 'ws_aaa_early', name: `early-${nanoid(6)}`, naming_template: null, created_at: 100,
    }).run();
    const result = ctx.repo.listWorkspaces(20, 0);
    // Three workspaces total: original (ctx.workspaceId, recent), late (9000), early (100).
    // Ordered by created_at ASC: early (100) → original (recent) → late (9000)? No: original
    // was created via Date.now() during beforeEach so its created_at is very large.
    // The earliest is now ws_aaa_early (100), then ctx.workspaceId, then ws_zzz_late (9000)? Wait:
    // Date.now() returns ms-since-epoch (~1.7T+). 9000 is BEFORE that, so order is:
    //   ws_aaa_early (100) → ws_zzz_late (9000) → original (Date.now() large value)
    expect(result.items.length).toBe(3);
    expect(result.items[0].id).toBe('ws_aaa_early');
    expect(result.items[1].id).toBe('ws_zzz_late');
    expect(result.items[2].id).toBe(ctx.workspaceId);
  });
});

// ============================================================================
// Test 9 — id ASC tiebreaker invariant when sort values collide
// ============================================================================
describe('HierarchyRepo tiebreaker invariant', () => {
  // Test 9 (identical name → id ASC tiebreaker) is unreachable in production
  // because the schema enforces UNIQUE(workspace_id, name) on projects (and
  // analogous constraints on sequences/shots). Two projects under the same
  // workspace can never share a name, so the secondary sort by id is
  // effectively dormant for the name field. Test 9b below exercises the
  // tiebreaker via created_at, which has no uniqueness constraint and can
  // collide.

  test('Test 9b: identical created_at → tiebreaker by id ASC', () => {
    insertProjects(ctx.workspaceId, [
      { name: 'A', created_at: 5000, id: 'proj_z_last' },
      { name: 'B', created_at: 5000, id: 'proj_a_first' },
      { name: 'C', created_at: 5000, id: 'proj_m_mid' },
    ]);
    const result = ctx.repo.listProjects(ctx.workspaceId, 20, 0, {
      sort: { field: 'created_at', dir: 'desc' },
    });
    // All three have created_at=5000; tiebreaker is id ASC (independent of dir).
    expect(result.items.map((p) => p.id)).toEqual([
      'proj_a_first', 'proj_m_mid', 'proj_z_last',
    ]);
  });
});

// ============================================================================
// Test 10 — Tool back-compat regression: real Engine, no opts arg compiles + works
// ============================================================================
describe('Engine facade tool back-compat (D-10)', () => {
  function makeEngine(): Engine {
    const versionRepo = new VersionRepo(ctx.testDb.db);
    const provenanceRepo = new ProvenanceRepo(ctx.testDb.db);
    const fake = new FakeComfyUIClient();
    return new Engine(
      ctx.testDb.db,
      ctx.repo,
      versionRepo,
      provenanceRepo,
      fake as never,
      'outputs',
    );
  }

  test('Test 10: engine.listProjects(workspaceId, limit, offset) without opts compiles + uses default ORDER BY', () => {
    insertProjects(ctx.workspaceId, [
      { name: 'Z-late', created_at: 3000 },
      { name: 'A-early', created_at: 1000 },
      { name: 'M-mid', created_at: 2000 },
    ]);
    const engine = makeEngine();
    // Tool-style call shape (matches src/tools/project-tool.ts:88) — opts omitted.
    const result = engine.listProjects(ctx.workspaceId, 20, 0);
    // Default ORDER BY = created_at ASC, id ASC (back-compat invariant).
    expect(result.items.map((p) => p.created_at)).toEqual([1000, 2000, 3000]);
  });

  test('Test 10b: engine.listSequences/listShots without opts also use defaults', () => {
    const projectId = ensureProject();
    const sequenceId = ensureSequence(projectId);
    insertSequences(projectId, [
      { name: 'sq030', created_at: 3000 },
      { name: 'sq020', created_at: 1000 },
    ]);
    insertShots(sequenceId, [
      { name: 'sh020', created_at: 2000 },
      { name: 'sh030', created_at: 1000 },
    ]);
    const engine = makeEngine();
    const seqs = engine.listSequences(projectId, 20, 0);
    // The lazily-created project is named 'p1' with current Date.now() created_at,
    // and the lazy sequence 'sq010' has its own Date.now() too. Both are very
    // large compared to the explicit fixtures (1000-3000), so they sort LAST.
    // Expected order: explicit ASC then the lazy parent at the end.
    expect(seqs.items.map((s) => s.created_at).slice(0, 2)).toEqual([1000, 3000]);
    const shotResults = engine.listShots(sequenceId, 20, 0);
    expect(shotResults.items.map((s) => s.created_at)).toEqual([1000, 2000]);
  });
});

// ============================================================================
// Test 11 — Engine facade forwards opts byte-equal to repo
// ============================================================================
describe('Engine facade forwards opts to repo', () => {
  test('Test 11: engine.listProjects with opts.sort calls repo.listProjects with byte-equal opts', () => {
    insertProjects(ctx.workspaceId, [
      { name: 'B', created_at: 2000 },
      { name: 'A', created_at: 1000 },
    ]);
    const versionRepo = new VersionRepo(ctx.testDb.db);
    const provenanceRepo = new ProvenanceRepo(ctx.testDb.db);
    const fake = new FakeComfyUIClient();
    const engine = new Engine(
      ctx.testDb.db,
      ctx.repo,
      versionRepo,
      provenanceRepo,
      fake as never,
      'outputs',
    );
    // Spy on repo.listProjects to capture the args the facade forwards.
    const spy = vi.spyOn(ctx.repo, 'listProjects');
    const opts = { sort: { field: 'name' as const, dir: 'asc' as const } };
    engine.listProjects(ctx.workspaceId, 20, 0, opts);
    expect(spy).toHaveBeenCalledWith(ctx.workspaceId, 20, 0, opts);
    spy.mockRestore();
  });

  test('Test 11b: engine.listSequences forwards opts byte-equal', () => {
    const projectId = ensureProject();
    const versionRepo = new VersionRepo(ctx.testDb.db);
    const provenanceRepo = new ProvenanceRepo(ctx.testDb.db);
    const fake = new FakeComfyUIClient();
    const engine = new Engine(
      ctx.testDb.db,
      ctx.repo,
      versionRepo,
      provenanceRepo,
      fake as never,
      'outputs',
    );
    const spy = vi.spyOn(ctx.repo, 'listSequences');
    const opts = { sort: { field: 'created_at' as const, dir: 'desc' as const } };
    engine.listSequences(projectId, 10, 5, opts);
    expect(spy).toHaveBeenCalledWith(projectId, 10, 5, opts);
    spy.mockRestore();
  });

  test('Test 11c: engine.listShots forwards opts byte-equal', () => {
    const projectId = ensureProject();
    const sequenceId = ensureSequence(projectId);
    const versionRepo = new VersionRepo(ctx.testDb.db);
    const provenanceRepo = new ProvenanceRepo(ctx.testDb.db);
    const fake = new FakeComfyUIClient();
    const engine = new Engine(
      ctx.testDb.db,
      ctx.repo,
      versionRepo,
      provenanceRepo,
      fake as never,
      'outputs',
    );
    const spy = vi.spyOn(ctx.repo, 'listShots');
    const opts = { sort: { field: 'name' as const, dir: 'desc' as const } };
    engine.listShots(sequenceId, 7, 3, opts);
    expect(spy).toHaveBeenCalledWith(sequenceId, 7, 3, opts);
    spy.mockRestore();
  });

  test('Test 11d: engine.listProjects without opts forwards undefined for opts param', () => {
    const versionRepo = new VersionRepo(ctx.testDb.db);
    const provenanceRepo = new ProvenanceRepo(ctx.testDb.db);
    const fake = new FakeComfyUIClient();
    const engine = new Engine(
      ctx.testDb.db,
      ctx.repo,
      versionRepo,
      provenanceRepo,
      fake as never,
      'outputs',
    );
    const spy = vi.spyOn(ctx.repo, 'listProjects');
    // Tool-shape call: omit opts entirely.
    engine.listProjects(ctx.workspaceId, 20, 0);
    // The repo signature accepts an optional 4th arg; the facade is allowed to
    // call it with either 3 args (omitted) or 4 args (undefined). Drizzle
    // treats both equivalently. Assert the spy received either 3 or 4 args
    // with the 4th being undefined when present.
    const callArgs = spy.mock.calls[0];
    expect(callArgs[0]).toBe(ctx.workspaceId);
    expect(callArgs[1]).toBe(20);
    expect(callArgs[2]).toBe(0);
    // Either undefined or absent — both honour D-10 back-compat.
    if (callArgs.length >= 4) {
      expect(callArgs[3]).toBeUndefined();
    }
    spy.mockRestore();
  });
});
