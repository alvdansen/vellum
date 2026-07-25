/**
 * Phase 22 / Plan 22-01 — HTTP boundary tests for the new
 * PATCH /api/shots/:id/status route (D-19).
 *
 * Closes REV-04 server-side: the body's `note` (whether absent, empty string,
 * or a real string) ends up persisted as `null` when blank — never `''`.
 *
 * Coverage:
 *  1. Valid body { to_status: 'approved' } → 200 + { status, history }
 *  2. Body without `note` → DB row.note IS NULL (verified via engine.listShotStatusHistory)
 *  3. Body with `note: ''` → DB row.note IS NULL (REV-04 null-when-blank invariant)
 *  4. Body { to_status: 'wip', note: 'Restored from omit' } → 200 (REV-05 Restore path)
 *  5. Body { to_status: 'not-a-status' } → 400 INVALID_INPUT
 *  6. Bare unknown shot id → 404 SHOT_NOT_FOUND
 *  7. Note longer than 500 chars → 400 INVALID_INPUT (Zod max)
 *  8. Body { changed_by: 'agent' } stored in shot_status_events.changed_by
 *
 * Architecture-purity: this test file lives in src/__tests__/ (server tree),
 * so import paths use ../engine/... and ../http/... — zero MCP SDK imports.
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

  // Build parent chain — workspace → project → sequence → shot (sh010 — must
  // match SHOT_NAME_REGEX in src/types/hierarchy.ts:11).
  const ws = hierarchyRepo.createWorkspace(`ws-${nanoid(6)}`);
  const proj = hierarchyRepo.createProject(ws.id, `p-${nanoid(6)}`);
  const seq = hierarchyRepo.createSequence(proj.id, `sq010`);
  const shot = hierarchyRepo.createShot(seq.id, `sh010`);

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

const PATCH_JSON_HEADERS = { 'Content-Type': 'application/json' };

interface PatchOk {
  status: string;
  history: Array<{
    id: string;
    to_status: string;
    from_status: string | null;
    changed_by: string;
    note: string | null;
  }>;
}

interface PatchErr {
  error: { code: string; message: string };
}

describe('PATCH /api/shots/:id/status — happy path', () => {
  test('Test 1: valid body { to_status: "approved" } → 200 + { status, history }', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
      method: 'PATCH',
      headers: PATCH_JSON_HEADERS,
      body: JSON.stringify({ to_status: 'approved' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PatchOk;
    expect(body.status).toBe('approved');
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history.length).toBe(1);
    expect(body.history[0].to_status).toBe('approved');
    expect(body.history[0].changed_by).toBe('user');
    expect(body.history[0].note).toBe(null);
  });
});

describe('PATCH /api/shots/:id/status — REV-04 null-note invariant', () => {
  test('Test 2: body without `note` persists note=null in shot_status_events', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
      method: 'PATCH',
      headers: PATCH_JSON_HEADERS,
      body: JSON.stringify({ to_status: 'pending-review' }),
    });
    expect(res.status).toBe(200);
    // Verify via engine.listShotStatusHistory — DB row must hold NULL, not ''.
    const { history } = fix.engine.listShotStatusHistory(fix.shotId, 50);
    expect(history.length).toBe(1);
    expect(history[0].note).toBe(null);
  });

  test('Test 3: body with `note: ""` persists note=null (REV-04 null-when-blank)', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
      method: 'PATCH',
      headers: PATCH_JSON_HEADERS,
      body: JSON.stringify({ to_status: 'on-hold', note: '' }),
    });
    expect(res.status).toBe(200);
    const { history } = fix.engine.listShotStatusHistory(fix.shotId, 50);
    expect(history.length).toBe(1);
    // The HTTP route's note coercion must collapse '' → null so the row stored
    // matches the REV-04 invariant ("null when blank, not empty string").
    expect(history[0].note).toBe(null);
  });
});

describe('PATCH /api/shots/:id/status — REV-05 Restore path', () => {
  test('Test 4: { to_status: "wip", note: "Restored from omit" } → 200 (Restore structurally identical)', async () => {
    // Pre-arrange: drive the shot into omit so the Restore transition is realistic.
    fix.engine.setShotStatus(fix.shotId, 'omit', 'user');
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
      method: 'PATCH',
      headers: PATCH_JSON_HEADERS,
      body: JSON.stringify({ to_status: 'wip', note: 'Restored from omit' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PatchOk;
    expect(body.status).toBe('wip');
    // REV-05 invariant: the Restore event is recorded with the canonical note.
    // (Position in history isn't part of REV-05 — when both events land on the
    // same millisecond, the STAT-03 DESC ordering is non-deterministic between
    // ties. The invariant under test is "wip event with Restored-from-omit note
    // exists in history", which `.find()` captures cleanly.)
    const restoreEvent = body.history.find(
      (h) => h.to_status === 'wip' && h.note === 'Restored from omit',
    );
    expect(restoreEvent).toBeDefined();
    // Both events should be present (Restore writes a row; the prior omit row stays).
    expect(body.history.length).toBe(2);
    expect(body.history.some((h) => h.to_status === 'omit')).toBe(true);
  });
});

describe('PATCH /api/shots/:id/status — error envelopes', () => {
  test('Test 5: invalid to_status → 400 INVALID_INPUT', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
      method: 'PATCH',
      headers: PATCH_JSON_HEADERS,
      body: JSON.stringify({ to_status: 'not-a-status' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as PatchErr;
    expect(body.error.code).toBe('INVALID_INPUT');
    // T-22-06 hygiene: the raw input must not be echoed verbatim into the
    // error message. The path token is acceptable; the value is not.
    expect(body.error.message).not.toContain('not-a-status');
  });

  test('Test 6: unknown shot id → 404 SHOT_NOT_FOUND', async () => {
    const res = await fix.app.request('/api/shots/sht_does_not_exist/status', {
      method: 'PATCH',
      headers: PATCH_JSON_HEADERS,
      body: JSON.stringify({ to_status: 'approved' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as PatchErr;
    expect(body.error.code).toBe('SHOT_NOT_FOUND');
  });

  test('Test 7: note longer than 500 chars → 400 INVALID_INPUT (Zod max)', async () => {
    const longNote = 'x'.repeat(501);
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
      method: 'PATCH',
      headers: PATCH_JSON_HEADERS,
      body: JSON.stringify({ to_status: 'approved', note: longNote }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as PatchErr;
    expect(body.error.code).toBe('INVALID_INPUT');
  });
});

describe('PATCH /api/shots/:id/status — changed_by attribution', () => {
  test('Test 8: body { changed_by: "agent" } stored in shot_status_events.changed_by', async () => {
    const res = await fix.app.request(`/api/shots/${fix.shotId}/status`, {
      method: 'PATCH',
      headers: PATCH_JSON_HEADERS,
      body: JSON.stringify({ to_status: 'approved', changed_by: 'agent' }),
    });
    expect(res.status).toBe(200);
    const { history } = fix.engine.listShotStatusHistory(fix.shotId, 50);
    expect(history.length).toBe(1);
    expect(history[0].changed_by).toBe('agent');
  });
});
