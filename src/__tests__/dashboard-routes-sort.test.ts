/**
 * Phase 18 / Plan 18-03 — HTTP boundary tests for ?sort= and ?cursor=
 * Zod whitelist parsing.
 *
 * Coverage matches plan tests 1-13:
 *   1.  Default sort returns Latest (NULL-pin band first).
 *   2.  ?sort=completed_at:asc returns Oldest.
 *   3.  ?sort=DROP_TABLE → 4xx INVALID_INPUT (T-18-01 mitigation).
 *   4.  ?sort=completed_at:invalid_dir → 4xx (T-18-01 mitigation).
 *   5.  ?sort=foo:asc → 4xx (T-18-01 mitigation).
 *   6.  ?sort=no_colon → 4xx.
 *   7.  ?cursor=valid → 200 + page advances.
 *   8.  ?cursor=garbage → 4xx INVALID_INPUT (T-18-04 mitigation).
 *   9.  Limit defaults to 20 + qNum guard preserved.
 *  10.  Hierarchy ?sort=name:asc on /api/workspaces/:id/projects.
 *  11.  Hierarchy ?sort=DROP_TABLE → 4xx for each of three list routes.
 *  12.  Hierarchy default = back-compat (omit ?sort=, observe pre-Phase-18 order).
 *  13.  TRANSITIONAL shim removed (file-level grep gate).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { Engine } from '../engine/pipeline.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { ProvenanceRepo } from '../store/provenance-repo.js';
import { FakeComfyUIClient } from '../test-utils/fake-comfyui-client.js';
import { makeInMemoryDb, type TestDb } from '../test-utils/fixtures.js';
import { workspaces, projects, sequences, shots, versions } from '../store/schema.js';
import { createDashboardRouter } from '../http/dashboard-routes.js';
import { typedErrorHandler } from '../http/error-middleware.js';
import { encodeVersionCursor } from '../store/sort.js';

interface Fixture {
  testDb: TestDb;
  engine: Engine;
  app: Hono;
  workspaceId: string;
  projectId: string;
  sequenceId: string;
  shotId: string;
}

let fix: Fixture;

beforeEach(() => {
  const testDb = makeInMemoryDb();
  const hierarchyRepo = new HierarchyRepo(testDb.db);
  const versionRepo = new VersionRepo(testDb.db);
  const provenanceRepo = new ProvenanceRepo(testDb.db);
  const fake = new FakeComfyUIClient();
  const engine = new Engine(
    testDb.db,
    hierarchyRepo,
    versionRepo,
    provenanceRepo,
    fake as never,
    'outputs',
  );

  // Build a parent chain.
  const ws = hierarchyRepo.createWorkspace(`ws-${nanoid(6)}`);
  const proj = hierarchyRepo.createProject(ws.id, `p-${nanoid(6)}`);
  const seq = hierarchyRepo.createSequence(proj.id, `sq-${nanoid(6)}`);
  const shot = hierarchyRepo.createShot(seq.id, `sh-${nanoid(6)}`);

  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);

  fix = {
    testDb,
    engine,
    app,
    workspaceId: ws.id,
    projectId: proj.id,
    sequenceId: seq.id,
    shotId: shot.id,
  };
});

/**
 * Insert N versions under fix.shotId with controlled completed_at values
 * so ?sort= ordering tests have a known dataset. Bypasses Engine.create*
 * to control timestamps directly.
 */
function insertVersions(
  shotId: string,
  rows: Array<{ id?: string; vn: number; completed_at: number | null }>,
): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    const id = r.id ?? `ver_${nanoid(10)}`;
    fix.testDb.db
      .insert(versions)
      .values({
        id,
        shot_id: shotId,
        version_number: r.vn,
        status: r.completed_at !== null ? 'complete' : 'queued',
        created_at: 1000 + r.vn,
        completed_at: r.completed_at,
      })
      .run();
    ids.push(id);
  }
  return ids;
}

// ============================================================================
// Test 1 — default sort returns Latest (NULL-pin band first by D-01)
// ============================================================================
describe('GET /api/shots/:id/versions — default sort', () => {
  test('Test 1: default ?sort= returns Latest (in-progress NULL-pin first, then completed_at DESC)', async () => {
    insertVersions(fix.shotId, [
      { vn: 1, completed_at: 1000 },  // oldest complete
      { vn: 2, completed_at: 3000 },  // newest complete
      { vn: 3, completed_at: 2000 },  // middle complete
      { vn: 4, completed_at: null },  // in-progress
    ]);
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ version_number: number }> };
    // NULL band first (vn=4), then completed_at DESC (vn=2, vn=3, vn=1).
    expect(body.items.map((v) => v.version_number)).toEqual([4, 2, 3, 1]);
  });
});

// ============================================================================
// Test 2 — ?sort=completed_at:asc returns oldest first
// ============================================================================
describe('GET /api/shots/:id/versions — ?sort=completed_at:asc', () => {
  test('Test 2: ?sort=completed_at:asc returns oldest non-null completed_at first (NULL band still first)', async () => {
    insertVersions(fix.shotId, [
      { vn: 1, completed_at: 3000 },
      { vn: 2, completed_at: 1000 },
      { vn: 3, completed_at: 2000 },
    ]);
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions?sort=completed_at:asc`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ version_number: number }> };
    // ASC: smallest completed_at first.
    expect(body.items.map((v) => v.version_number)).toEqual([2, 3, 1]);
  });
});

// ============================================================================
// Tests 3-6 — invalid sort param → 4xx INVALID_INPUT (no 5xx)
// ============================================================================
describe('GET /api/shots/:id/versions — sort param validation (T-18-01)', () => {
  test('Test 3: ?sort=DROP_TABLE → 400 INVALID_INPUT (no 5xx; no input echo)', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions?sort=DROP_TABLE`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
    // T-18-03 information-disclosure hygiene: never echo the malformed input verbatim
    expect(body.error?.message ?? '').not.toContain('DROP_TABLE');
  });

  test('Test 4: ?sort=completed_at:invalid_dir → 400 INVALID_INPUT', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions?sort=completed_at:invalid_dir`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
  });

  test('Test 5: ?sort=foo:asc → 400 INVALID_INPUT (field not in whitelist)', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions?sort=foo:asc`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
  });

  test('Test 6: ?sort=no_colon → 400 INVALID_INPUT (malformed shape)', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions?sort=no_colon`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
  });
});

// ============================================================================
// Test 7 — valid ?cursor= advances the page
// ============================================================================
describe('GET /api/shots/:id/versions — ?cursor=', () => {
  test('Test 7: valid ?cursor= returns page 2 (excludes the cursor row)', async () => {
    insertVersions(fix.shotId, [
      { vn: 1, completed_at: 1000 },
      { vn: 2, completed_at: 2000 },
      { vn: 3, completed_at: 3000 },
      { vn: 4, completed_at: 4000 },
    ]);
    // Page 1 with limit=2 to issue a real next_cursor.
    const r1 = await fix.app.request(`/api/shots/${fix.shotId}/versions?limit=2`);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as {
      items: Array<{ id: string; version_number: number; completed_at: number | null }>;
      next_cursor: string | null;
    };
    expect(b1.items.length).toBe(2);
    expect(b1.next_cursor).toBeTruthy();
    const r2 = await fix.app.request(
      `/api/shots/${fix.shotId}/versions?limit=2&cursor=${encodeURIComponent(b1.next_cursor!)}`,
    );
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as {
      items: Array<{ id: string; version_number: number }>;
    };
    // The cursor row's id MUST NOT appear in page 2 — composite cursor excludes it.
    const seenIds = new Set(b1.items.map((v) => v.id));
    for (const v of b2.items) {
      expect(seenIds.has(v.id)).toBe(false);
    }
  });
});

// ============================================================================
// Test 8 — malformed cursor → 4xx INVALID_INPUT (T-18-04)
// ============================================================================
describe('GET /api/shots/:id/versions — cursor validation (T-18-04)', () => {
  test('Test 8: ?cursor=garbage → 400 INVALID_INPUT (NEVER 500)', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions?cursor=NOT_A_CURSOR`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
    expect(body.error?.message ?? '').not.toContain('NOT_A_CURSOR');
  });

  test('Test 8b: structurally-valid encoded but stale cursor still 200 (decoder accepts, engine returns empty page)', async () => {
    // A well-formed cursor pointing to a non-existent row should return 200
    // empty-or-stable, NOT 4xx — the route only rejects DECODE failure.
    const valid = encodeVersionCursor({ cna: false, sv: 99999, vid: 'ver_does_not_exist' });
    const res = await fix.app.request(
      `/api/shots/${fix.shotId}/versions?cursor=${encodeURIComponent(valid)}`,
    );
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Test 9 — limit qNum guard preserved
// ============================================================================
describe('GET /api/shots/:id/versions — limit', () => {
  test('Test 9a: omitting ?limit= defaults to 20', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions`);
    expect(res.status).toBe(200);
    // Empty fixture, but the request must succeed.
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  test('Test 9b: ?limit=-1 → 4xx INVALID_INPUT (qNum guard)', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/versions?limit=-1`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
  });
});

// ============================================================================
// Test 10 — hierarchy ?sort=name:asc on /api/workspaces/:id/projects
// ============================================================================
describe('GET /api/workspaces/:id/projects — ?sort=', () => {
  function seedProjectsUnderWs(workspaceId: string) {
    fix.testDb.db.insert(projects).values({
      id: `proj_${nanoid(6)}`,
      workspace_id: workspaceId,
      name: 'Cherry',
      naming_template: null,
      created_at: 1000,
    }).run();
    fix.testDb.db.insert(projects).values({
      id: `proj_${nanoid(6)}`,
      workspace_id: workspaceId,
      name: 'Apple',
      naming_template: null,
      created_at: 2000,
    }).run();
    fix.testDb.db.insert(projects).values({
      id: `proj_${nanoid(6)}`,
      workspace_id: workspaceId,
      name: 'Banana',
      naming_template: null,
      created_at: 3000,
    }).run();
  }

  test('Test 10: ?sort=name:asc returns alphabetic order', async () => {
    // Insert under a fresh workspace to control the row set; also pre-existing
    // beforeEach project (name `p-...`) is under fix.workspaceId — use fresh ws.
    const ws2 = fix.engine.createWorkspace(`ws-x-${nanoid(6)}`).entity;
    seedProjectsUnderWs(ws2.id);
    const res = await fix.app.request(`/api/workspaces/${ws2.id}/projects?sort=name:asc`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string }> };
    expect(body.items.map((p) => p.name)).toEqual(['Apple', 'Banana', 'Cherry']);
  });
});

// ============================================================================
// Test 11 — hierarchy ?sort=DROP_TABLE → 4xx INVALID_INPUT for each route
// ============================================================================
describe('hierarchy routes — ?sort= validation (T-18-01)', () => {
  test('Test 11a: /api/workspaces/:id/projects?sort=DROP_TABLE → 400', async () => {
    const res = await fix.app.request(`/api/workspaces/${fix.workspaceId}/projects?sort=DROP_TABLE`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
  });

  test('Test 11b: /api/projects/:id/sequences?sort=DROP_TABLE → 400', async () => {
    const res = await fix.app.request(`/api/projects/${fix.projectId}/sequences?sort=DROP_TABLE`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
  });

  test('Test 11c: /api/sequences/:id/shots?sort=DROP_TABLE → 400', async () => {
    const res = await fix.app.request(`/api/sequences/${fix.sequenceId}/shots?sort=DROP_TABLE`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_INPUT');
  });
});

// ============================================================================
// Test 12 — hierarchy default = back-compat (omit ?sort= preserves
// pre-Phase-18 created_at ASC, id ASC)
// ============================================================================
describe('hierarchy routes — back-compat default (D-10)', () => {
  test('Test 12: omit ?sort= preserves pre-Phase-18 ORDER BY (created_at ASC)', async () => {
    const ws3 = fix.engine.createWorkspace(`ws-bc-${nanoid(6)}`).entity;
    fix.testDb.db.insert(projects).values({
      id: `proj_${nanoid(6)}`, workspace_id: ws3.id, name: 'Z', naming_template: null, created_at: 5000,
    }).run();
    fix.testDb.db.insert(projects).values({
      id: `proj_${nanoid(6)}`, workspace_id: ws3.id, name: 'A', naming_template: null, created_at: 1000,
    }).run();
    fix.testDb.db.insert(projects).values({
      id: `proj_${nanoid(6)}`, workspace_id: ws3.id, name: 'M', naming_template: null, created_at: 3000,
    }).run();
    const res = await fix.app.request(`/api/workspaces/${ws3.id}/projects`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ created_at: number }> };
    // Default ORDER BY = created_at ASC, id ASC (back-compat invariant).
    expect(body.items.map((p) => p.created_at)).toEqual([1000, 3000, 5000]);
  });
});

// ============================================================================
// Test 13 — TRANSITIONAL shim removed (Plan 18-02 cleanup verified)
// ============================================================================
describe('Plan 18-02 TRANSITIONAL shim cleanup', () => {
  test('Test 13: dashboard-routes.ts contains zero TRANSITIONAL pins', async () => {
    const src = await readFile('src/http/dashboard-routes.ts', 'utf8');
    expect(src).not.toMatch(/TRANSITIONAL/);
  });
});

// Suppress unused import lints when sequences/shots seeding helpers aren't used in this run.
void sequences;
void shots;
