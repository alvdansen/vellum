import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createDashboardRouter } from '../dashboard-routes.js';
import { typedErrorHandler } from '../error-middleware.js';
import { buildStackWithOutputs } from '../../test-utils/fixtures.js';
import type { EngineForDashboard } from '../dashboard-routes.js';

/**
 * REGRESSION — the asset read-query routes must validate their body.
 *
 * They handed the raw request body straight to the engine, which binds the
 * values into SQL. The body the route's own comment documents — `{}`, mirroring
 * the MCP tool input — therefore came back as
 * `500 {"code":"INTERNAL_ERROR","message":"datatype mismatch"}`: a raw SQLite
 * error, because `limit` and `offset` arrived undefined with no defaults
 * applied. A non-array `tags` produced the same 500, and `limit` had no ceiling
 * at all even though the MCP surface has always capped it.
 *
 * Both surfaces now parse the SAME schema (src/tools/asset-query-schema.ts).
 */

function appFor(engine: EngineForDashboard): Hono {
  // server.ts mounts the typed-error handler at APP level, not on the router,
  // so a harness without it turns every TypedError into a bare 500 and would
  // report the fix as broken.
  const app = new Hono();
  app.onError(typedErrorHandler);
  app.route('/', createDashboardRouter(engine));
  return app;
}

async function post(
  engine: EngineForDashboard,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await appFor(engine).request(`http://127.0.0.1:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe('asset query routes', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups) c();
    cleanups.length = 0;
  });

  function engine(): EngineForDashboard {
    const stack = buildStackWithOutputs();
    cleanups.push(stack.cleanup);
    return stack.engine;
  }

  it.each(['/api/assets/query', '/api/assets/list_tags', '/api/assets/list_metadata_keys'])(
    '%s accepts the documented empty body and applies defaults',
    async (path) => {
      const { status, json } = await post(engine(), path, {});
      expect(status).toBe(200);
      expect(json).toMatchObject({ limit: 20, offset: 0 });
    },
  );

  it('accepts a request with no body at all', async () => {
    const { status } = await post(engine(), '/api/assets/query');
    expect(status).toBe(200);
  });

  it('rejects a non-array tags with 400 INVALID_INPUT naming the field', async () => {
    const { status, json } = await post(engine(), '/api/assets/query', { tags: 'hero' });
    expect(status).toBe(400);
    expect(json.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(String((json.error as { message: string }).message)).toMatch(/tags/);
  });

  it('caps limit the way the tool surface does', async () => {
    const { status } = await post(engine(), '/api/assets/query', { limit: 1_000_000_000 });
    expect(status).toBe(400);
  });

  it('rejects a negative offset', async () => {
    const { status } = await post(engine(), '/api/assets/query', { offset: -1 });
    expect(status).toBe(400);
  });

  it('never answers with a raw database error', async () => {
    // The whole class of failure: an unvalidated body reaching SQL and coming
    // back as 500 "datatype mismatch".
    for (const body of [{}, { tags: 'hero' }, { limit: 'lots' }, { status: 'bogus' }]) {
      const { status, json } = await post(engine(), '/api/assets/query', body);
      expect(status).not.toBe(500);
      expect(JSON.stringify(json)).not.toMatch(/datatype mismatch/);
    }
  });

  it('still returns real results for a valid query', async () => {
    const e = engine();
    const ws = (e as unknown as { createWorkspace: (n: string) => { entity: { id: string } } })
      .createWorkspace('ws1');
    const { status, json } = await post(e, '/api/assets/query', {
      workspace_id: ws.entity.id,
      limit: 5,
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ limit: 5, offset: 0, total_count: 0 });
  });
});
