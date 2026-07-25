// HTTP integration tests for `GET /api/shots/:id/pipeline-log`.
//
// Strategy mirrors dashboard-routes-shot-grid.test.ts: a fresh Hono app +
// createDashboardRouter(engine) per test with typedErrorHandler mounted, and a
// per-test override of `engine.getShotPipelineLog` (FakeEngine ships no default
// impl — the engine method itself is covered at the repo level by the
// pipeline-log feature tests). The route's job here is a thin delegation:
// URL → engine.getShotPipelineLog(shotId), and TypedError → HTTP envelope.

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { FakeEngine } from '../../test-utils/fake-engine.js';
import { createDashboardRouter } from '../dashboard-routes.js';
import { typedErrorHandler } from '../error-middleware.js';
import { TypedError } from '../../engine/errors.js';

function buildApp(engine: FakeEngine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}

const SAMPLE = {
  markdown: '# Pipeline Log — SEQ010 / SH_020\n\n- **Shot:** SH_020\n',
  breadcrumb: [{ type: 'shot', id: 'shot_1', name: 'SH_020' }],
  breadcrumb_text: 'Demo Show / SEQ010 / SH_020',
  shot_id: 'shot_1',
  take_count: 3,
};

describe('GET /api/shots/:id/pipeline-log', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    engine.reset();
  });

  it('delegates to engine.getShotPipelineLog and returns the markdown envelope', async () => {
    (engine as unknown as { getShotPipelineLog: (id: string) => unknown }).getShotPipelineLog =
      (id: string) => {
        engine.calls.push({ method: 'getShotPipelineLog', args: [id] });
        return SAMPLE;
      };
    const app = buildApp(engine);
    const res = await app.request('/api/shots/shot_1/pipeline-log');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SAMPLE);
    expect(engine.calls).toContainEqual({
      method: 'getShotPipelineLog',
      args: ['shot_1'],
    });
  });

  it('propagates SHOT_NOT_FOUND as a 404 error envelope', async () => {
    (engine as unknown as { getShotPipelineLog: (id: string) => unknown }).getShotPipelineLog =
      (id: string) => {
        throw new TypedError('SHOT_NOT_FOUND', `Shot '${id}' not found`);
      };
    const app = buildApp(engine);
    const res = await app.request('/api/shots/nope/pipeline-log');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SHOT_NOT_FOUND');
  });
});
