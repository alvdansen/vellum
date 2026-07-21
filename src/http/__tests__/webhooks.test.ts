// Pivot #3 — tests for the bearer-gated provider-webhook ingest route
// (POST /webhooks/:provider → registerExternalOutput). Driven over a real Hono
// app via app.request; a minimal fake engine records the delegated input.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createWebhookRouter } from '../webhooks.js';
import { typedErrorHandler, statusForCode } from '../index.js';
import { TypedError } from '../../engine/errors.js';

const TOKEN = 'whsec_supersecret_1234';
const GOOD_BODY = { shot_id: 'shot_1', outputs: [{ url: 'https://replicate.delivery/a/o.png' }] };

interface FakeEngine {
  calls: Array<Record<string, unknown>>;
  registerExternalOutput(input: Record<string, unknown>): Promise<unknown>;
}

function fakeEngine(opts: { throwErr?: unknown } = {}): FakeEngine {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    async registerExternalOutput(input: Record<string, unknown>) {
      calls.push(input);
      if (opts.throwErr) throw opts.throwErr;
      return {
        entity: { id: 'ver_1', shot_id: input.shotId, provider: input.providerId, status: 'completed' },
        breadcrumb: { entries: [], text: 'ws > p > sq > sh > v001' },
      };
    },
  };
}

function buildApp(engine: FakeEngine, ingestToken?: string): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  app.route('/', createWebhookRouter(engine as never, { ingestToken }));
  return app;
}

function post(app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('POST /webhooks/:provider', () => {
  it('is DISABLED (503) when no ingest token is configured — never unauthenticated', async () => {
    const engine = fakeEngine();
    const res = await post(buildApp(engine) /* no token */, '/webhooks/replicate', GOOD_BODY, auth(TOKEN));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('WEBHOOK_INGEST_DISABLED');
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects a missing bearer token with 401', async () => {
    const engine = fakeEngine();
    const res = await post(buildApp(engine, TOKEN), '/webhooks/replicate', GOOD_BODY);
    expect(res.status).toBe(401);
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects a same-length-but-wrong token with 401 (constant-time content check)', async () => {
    const engine = fakeEngine();
    const wrong = 'whsec_supersecret_XXXX'; // same length as TOKEN, different content
    expect(wrong).toHaveLength(TOKEN.length);
    const res = await post(buildApp(engine, TOKEN), '/webhooks/replicate', GOOD_BODY, auth(wrong));
    expect(res.status).toBe(401);
    expect(engine.calls).toHaveLength(0);
  });

  it('accepts a valid request and delegates to registerExternalOutput with provider from the path', async () => {
    const engine = fakeEngine();
    const res = await post(
      buildApp(engine, TOKEN),
      '/webhooks/replicate',
      {
        shot_id: 'shot_42',
        outputs: [{ url: 'https://replicate.delivery/a/o.png', filename: 'o.png' }],
        provenance: { params: { seed: 7 } },
        external_job_ref: 'pred_abc',
        notes: 'from webhook',
      },
      auth(TOKEN),
    );
    expect(res.status).toBe(201);
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]).toEqual({
      shotId: 'shot_42',
      providerId: 'replicate',
      outputs: [{ url: 'https://replicate.delivery/a/o.png', filename: 'o.png' }],
      provenance: { params: { seed: 7 } },
      externalJobRef: 'pred_abc',
      notes: 'from webhook',
    });
    // 201 body carries the new version entity + breadcrumb (same shape as register).
    const json = (await res.json()) as { entity: Record<string, unknown>; breadcrumb: { text: string } };
    expect(json.entity).toMatchObject({ shot_id: 'shot_42', provider: 'replicate', status: 'completed' });
    expect(json.breadcrumb.text).toBe('ws > p > sq > sh > v001');
  });

  it('treats a whitespace-only ingest token as unconfigured (503)', async () => {
    const engine = fakeEngine();
    const res = await post(buildApp(engine, '   '), '/webhooks/replicate', GOOD_BODY, auth('   '));
    expect(res.status).toBe(503);
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects more than 20 outputs (upper boundary) with 400', async () => {
    const engine = fakeEngine();
    const outputs = Array.from({ length: 21 }, (_, i) => ({ url: `https://replicate.delivery/a/${i}.png` }));
    const res = await post(buildApp(engine, TOKEN), '/webhooks/replicate', { shot_id: 's1', outputs }, auth(TOKEN));
    expect(res.status).toBe(400);
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects an invalid provider path segment (charset/length) with 400', async () => {
    const engine = fakeEngine();
    const app = buildApp(engine, TOKEN);
    const bad = await post(app, '/webhooks/foo$bar', GOOD_BODY, auth(TOKEN));
    expect(bad.status).toBe(400);
    const tooLong = await post(app, `/webhooks/${'p'.repeat(65)}`, GOOD_BODY, auth(TOKEN));
    expect(tooLong.status).toBe(400);
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects an oversized body with 413 (memory-exhaustion guard) before delegating', async () => {
    const engine = fakeEngine();
    const body = JSON.stringify({
      shot_id: 's1',
      outputs: [{ url: 'https://replicate.delivery/a/o.png' }],
      provenance: { blob: 'x'.repeat(300 * 1024) },
    });
    // Production (node-server) always sends Content-Length for a buffered body;
    // bodyLimit rejects on the header before buffering the payload.
    const res = await buildApp(engine, TOKEN).request('/webhooks/replicate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
        ...auth(TOKEN),
      },
      body,
    });
    expect(res.status).toBe(413);
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects an invalid body (bad url / empty outputs / missing shot_id) with 400, no delegation', async () => {
    const engine = fakeEngine();
    const app = buildApp(engine, TOKEN);
    for (const bad of [
      { shot_id: 'shot_1', outputs: [] },
      { shot_id: 'shot_1', outputs: [{ url: 'not-a-url' }] },
      { outputs: [{ url: 'https://replicate.delivery/a/o.png' }] },
    ]) {
      const res = await post(app, '/webhooks/replicate', bad, auth(TOKEN));
      expect(res.status).toBe(400);
    }
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects a non-JSON body with 400', async () => {
    const engine = fakeEngine();
    const res = await post(buildApp(engine, TOKEN), '/webhooks/replicate', 'not json', auth(TOKEN));
    expect(res.status).toBe(400);
    expect(engine.calls).toHaveLength(0);
  });

  it('propagates a TypedError from the engine via the shared error handler', async () => {
    const engine = fakeEngine({
      throwErr: new TypedError('SHOT_NOT_FOUND', "Shot 'shot_x' not found"),
    });
    const res = await post(buildApp(engine, TOKEN), '/webhooks/replicate', GOOD_BODY, auth(TOKEN));
    expect(res.status).toBe(statusForCode('SHOT_NOT_FOUND'));
    expect((await res.json()).error.code).toBe('SHOT_NOT_FOUND');
  });
});
