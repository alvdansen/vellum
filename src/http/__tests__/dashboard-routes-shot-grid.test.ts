// Phase 21 / Plan 21-02 — GRID-04 HTTP integration tests for
// `GET /api/sequences/:id/shot-grid`.
//
// Strategy (mirrors dashboard-routes.test.ts:54-73):
//   - Build a fresh Hono app + createDashboardRouter(engine) per test; mount
//     typedErrorHandler so TypedError throws convert to a 4xx JSON envelope.
//   - Use FakeEngine with per-test override of `engine.listShotGrid` (FakeEngine
//     does not yet ship a default impl — the route is Wave 2 new surface, and
//     the real engine path is covered at the repo level in 21-01-T07).
//   - Use `engine.calls.push({ method, args })` from inside the override so
//     delegation assertions follow the file's existing idiom.
//
// Scope: 7 cases per <behavior> in 21-02-PLAN.md Task T03:
//   1. Happy path — default cursor:null, limit:20
//   2. ?limit=5 overrides default
//   3. ?cursor=<valid> decodes structurally
//   4. ?cursor=DROP_TABLE → 400 INVALID_INPUT
//   5. unknown sequence → 404 SEQUENCE_NOT_FOUND
//   6. ?limit=-1 → 400 INVALID_INPUT (qNum rejects)
//   7. ?limit=foo → 400 INVALID_INPUT (qNum rejects non-numeric)
//
// Test surface NEVER touches real engine state, real SQL, or real disk —
// the route's job here is to translate URL → engine.listShotGrid args and
// translate engine.listShotGrid errors → HTTP envelopes. Repo-layer SQL
// behavior is covered by src/store/__tests__/shot-status-repo-grid.test.ts.

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { FakeEngine } from '../../test-utils/fake-engine.js';
import { createDashboardRouter } from '../dashboard-routes.js';
import { typedErrorHandler } from '../error-middleware.js';
import { TypedError } from '../../engine/errors.js';
import { encodeShotGridCursor } from '../../store/shot-status-repo.js';

/** Mirror of dashboard-routes.test.ts:54-73 — buildApp helper. */
function buildApp(engine: FakeEngine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}

/**
 * Sample happy-path response shape that the engine returns to the route.
 * Matches D-13 envelope verbatim: { sequence, shots[], next_cursor, total_count }.
 */
const EMPTY_GRID_RESPONSE = {
  sequence: { id: 'seq_1', name: 'SEQ_010' },
  shots: [] as Array<{
    id: string;
    name: string;
    status: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit';
    version_count: number;
    latest_completed_version: {
      id: string;
      thumbnail_url: string;
      completed_at: number;
    } | null;
  }>,
  next_cursor: null as string | null,
  total_count: 0,
};

describe('GET /api/sequences/:id/shot-grid (GRID-04)', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    engine.reset();
  });

  it('returns 200 and delegates to engine.listShotGrid with cursor=null, limit=20 defaults', async () => {
    (engine as unknown as { listShotGrid: unknown }).listShotGrid = ((
      seqId: string,
      opts: { cursor: unknown; limit: number },
    ) => {
      engine.calls.push({ method: 'listShotGrid', args: [seqId, opts] });
      return { ...EMPTY_GRID_RESPONSE, sequence: { id: seqId, name: 'SEQ_010' } };
    }) as never;
    const app = buildApp(engine);

    const res = await app.request('/api/sequences/seq_1/shot-grid');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sequence');
    expect(body).toHaveProperty('shots');
    expect(body).toHaveProperty('next_cursor');
    expect(body).toHaveProperty('total_count');
    expect(body.sequence.id).toBe('seq_1');
    expect(body.shots).toEqual([]);
    expect(body.next_cursor).toBeNull();
    expect(body.total_count).toBe(0);
    const call = engine.calls.find((c) => c.method === 'listShotGrid');
    expect(call).toBeTruthy();
    expect(call!.args[0]).toBe('seq_1');
    expect(call!.args[1]).toEqual({ cursor: null, limit: 20 });
  });

  it('?limit=5 overrides the default limit', async () => {
    (engine as unknown as { listShotGrid: unknown }).listShotGrid = ((
      seqId: string,
      opts: { cursor: unknown; limit: number },
    ) => {
      engine.calls.push({ method: 'listShotGrid', args: [seqId, opts] });
      return { ...EMPTY_GRID_RESPONSE, sequence: { id: seqId, name: 'SEQ_010' } };
    }) as never;
    const app = buildApp(engine);

    const res = await app.request('/api/sequences/seq_1/shot-grid?limit=5');

    expect(res.status).toBe(200);
    const call = engine.calls.find((c) => c.method === 'listShotGrid');
    expect(call!.args[1]).toEqual({ cursor: null, limit: 5 });
  });

  it('?cursor=<valid base64url> decodes structurally to ShotGridCursor', async () => {
    const goodCursor = encodeShotGridCursor({ n: 'sh020', sid: 'shot_x' });
    (engine as unknown as { listShotGrid: unknown }).listShotGrid = ((
      seqId: string,
      opts: { cursor: unknown; limit: number },
    ) => {
      engine.calls.push({ method: 'listShotGrid', args: [seqId, opts] });
      return { ...EMPTY_GRID_RESPONSE, sequence: { id: seqId, name: 'SEQ_010' } };
    }) as never;
    const app = buildApp(engine);

    const res = await app.request(
      `/api/sequences/seq_1/shot-grid?cursor=${encodeURIComponent(goodCursor)}&limit=10`,
    );

    expect(res.status).toBe(200);
    const call = engine.calls.find((c) => c.method === 'listShotGrid');
    expect(call!.args[1]).toEqual({
      cursor: { n: 'sh020', sid: 'shot_x' },
      limit: 10,
    });
  });

  it('?cursor=DROP_TABLE (malformed) returns 400 INVALID_INPUT', async () => {
    // Engine should NEVER be called — the route helper rejects at the parse seam.
    (engine as unknown as { listShotGrid: unknown }).listShotGrid = (() => {
      throw new Error('engine.listShotGrid should not be reached on malformed cursor');
    }) as never;
    const app = buildApp(engine);

    const res = await app.request('/api/sequences/seq_1/shot-grid?cursor=DROP_TABLE');

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
    // Information-disclosure hygiene (T-18-03 / Phase 18 precedent):
    // the error message must NOT echo the malformed input back verbatim.
    expect(body.error.message).not.toContain('DROP_TABLE');
  });

  it('unknown sequence id → 404 SEQUENCE_NOT_FOUND envelope', async () => {
    (engine as unknown as { listShotGrid: unknown }).listShotGrid = ((id: string) => {
      throw new TypedError(
        'SEQUENCE_NOT_FOUND',
        `Sequence '${id}' not found`,
        `List sequences with { tool: 'sequence', action: 'list' }`,
      );
    }) as never;
    const app = buildApp(engine);

    const res = await app.request('/api/sequences/seq_missing/shot-grid');

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SEQUENCE_NOT_FOUND');
  });

  it('?limit=-1 returns 400 INVALID_INPUT (qNum rejects negative)', async () => {
    (engine as unknown as { listShotGrid: unknown }).listShotGrid = (() => {
      throw new Error('engine.listShotGrid should not be reached on bad limit');
    }) as never;
    const app = buildApp(engine);

    const res = await app.request('/api/sequences/seq_1/shot-grid?limit=-1');

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('?limit=foo returns 400 INVALID_INPUT (qNum rejects non-numeric)', async () => {
    (engine as unknown as { listShotGrid: unknown }).listShotGrid = (() => {
      throw new Error('engine.listShotGrid should not be reached on bad limit');
    }) as never;
    const app = buildApp(engine);

    const res = await app.request('/api/sequences/seq_1/shot-grid?limit=foo');

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
  });
});
