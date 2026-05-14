/**
 * Phase 22 / Plan 22-01 — HTTP boundary tests for the new
 * GET /api/shots/:id/status-history route (RESEARCH Q1).
 *
 * The route is a thin wrapper over engine.listShotStatusHistory; the engine
 * function is the same one the MCP `shot.list_status_history` arm already
 * delegates to (Phase 20 STAT-04). This plan adds the parallel HTTP entry
 * point so the dashboard can render the unified timeline (D-04).
 *
 * Coverage:
 *  1. Empty history → 200 + { shotId, history: [], total: 0 }
 *  2. After one PATCH → body.history has that event + total === 1
 *  3. limit=abc → 400 INVALID_INPUT (qNum guard)
 *  4. Unknown shot id → 404 SHOT_NOT_FOUND
 *
 * Architecture-purity: server tree imports only — zero MCP SDK.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { Engine } from '../engine/pipeline.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { ProvenanceRepo } from '../store/provenance-repo.js';
import { FakeComfyUIClient } from '../test-utils/fake-comfyui-client.js';
import { makeInMemoryDb, type TestDb } from '../test-utils/fixtures.js';
import { createDashboardRouter } from '../http/dashboard-routes.js';
import { typedErrorHandler } from '../http/error-middleware.js';

interface Fixture {
  testDb: TestDb;
  engine: Engine;
  app: Hono;
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

  const ws = hierarchyRepo.createWorkspace(`ws-${nanoid(6)}`);
  const proj = hierarchyRepo.createProject(ws.id, `p-${nanoid(6)}`);
  const seq = hierarchyRepo.createSequence(proj.id, `sq010`);
  const shot = hierarchyRepo.createShot(seq.id, `sh010`);

  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);

  fix = { testDb, engine, app, shotId: shot.id };
});

interface HistoryOk {
  shotId: string;
  history: Array<{
    id: string;
    to_status: string;
    from_status: string | null;
    changed_by: string;
    note: string | null;
  }>;
  total: number;
}

interface HistoryErr {
  error: { code: string; message: string };
}

describe('GET /api/shots/:id/status-history — empty state', () => {
  test('Test 1: shot with no events → 200 + { shotId, history: [], total: 0 }', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status-history?limit=50`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryOk;
    expect(body.shotId).toBe(fix.shotId);
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history.length).toBe(0);
    expect(body.total).toBe(0);
  });
});

describe('GET /api/shots/:id/status-history — after PATCH', () => {
  test('Test 2: after one engine.setShotStatus → body.history contains that event + total === 1', async () => {
    fix.engine.setShotStatus(fix.shotId, 'approved', 'user', 'Looks good');
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status-history?limit=50`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryOk;
    expect(body.total).toBe(1);
    expect(body.history.length).toBe(1);
    expect(body.history[0].to_status).toBe('approved');
    expect(body.history[0].changed_by).toBe('user');
    expect(body.history[0].note).toBe('Looks good');
  });
});

describe('GET /api/shots/:id/status-history — limit validation', () => {
  test('Test 3: limit=abc → 400 INVALID_INPUT (qNum guard)', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status-history?limit=abc`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as HistoryErr;
    expect(body.error.code).toBe('INVALID_INPUT');
  });
});

describe('GET /api/shots/:id/status-history — unknown shot', () => {
  test('Test 4: unknown shot id → 404 SHOT_NOT_FOUND', async () => {
    const res = await fix.app.request('/api/shots/sht_does_not_exist/status-history?limit=50');
    expect(res.status).toBe(404);
    const body = (await res.json()) as HistoryErr;
    expect(body.error.code).toBe('SHOT_NOT_FOUND');
  });
});
