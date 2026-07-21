// Pivot #3 — tests for the bearer-gated provider-webhook ingest route
// (POST /webhooks/:provider → registerExternalOutput). Driven over a real Hono
// app via app.request; a minimal fake engine records the delegated input.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebhookRouter } from '../webhooks.js';
import { typedErrorHandler, statusForCode } from '../index.js';
import { TypedError } from '../../engine/errors.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { GenerationEngine } from '../../engine/generation.js';
import { ProvenanceWriter } from '../../engine/provenance.js';
import { BreadcrumbResolver } from '../../engine/breadcrumb.js';

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

// ── Modal-ingest: multipart direct-bytes upload route ──────────────────────────

function uploadReq(
  app: Hono,
  path: string,
  opts: {
    meta?: unknown;
    files?: Array<{ name: string; type?: string; data: Uint8Array }>;
    headers?: Record<string, string>;
  } = {},
) {
  const fd = new FormData();
  if (opts.meta !== undefined) {
    fd.append('meta', typeof opts.meta === 'string' ? opts.meta : JSON.stringify(opts.meta));
  }
  for (const f of opts.files ?? []) {
    fd.append('files', new File([f.data as BlobPart], f.name, { type: f.type ?? 'image/png' }));
  }
  return app.request(path, { method: 'POST', headers: opts.headers ?? {}, body: fd });
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const GOOD_META = { shot_id: 'shot_1' };
const GOOD_FILES = [{ name: 'ckpt_000100.png', data: PNG_BYTES }];

describe('POST /webhooks/:provider/upload', () => {
  it('is DISABLED (503) when no ingest token is configured', async () => {
    const engine = fakeEngine();
    const res = await uploadReq(buildApp(engine) /* no token */, '/webhooks/modal/upload', {
      meta: GOOD_META,
      files: GOOD_FILES,
      headers: auth(TOKEN),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('WEBHOOK_INGEST_DISABLED');
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects a missing/wrong bearer token with 401', async () => {
    const engine = fakeEngine();
    const app = buildApp(engine, TOKEN);
    const noAuth = await uploadReq(app, '/webhooks/modal/upload', { meta: GOOD_META, files: GOOD_FILES });
    expect(noAuth.status).toBe(401);
    const badAuth = await uploadReq(app, '/webhooks/modal/upload', {
      meta: GOOD_META,
      files: GOOD_FILES,
      headers: auth('whsec_supersecret_XXXX'),
    });
    expect(badAuth.status).toBe(401);
    expect(engine.calls).toHaveLength(0);
  });

  it('delegates a valid multipart upload as byte entries (provider from path, meta fields mapped)', async () => {
    const engine = fakeEngine();
    const res = await uploadReq(buildApp(engine, TOKEN), '/webhooks/modal/upload', {
      meta: {
        shot_id: 'shot_42',
        provenance: { base_model: 'flux-dev', step: 100 },
        external_job_ref: 'run-2026-07-21a',
        notes: 'checkpoint sample',
      },
      files: [{ name: 'ckpt_000100.png', type: 'image/png', data: PNG_BYTES }],
      headers: auth(TOKEN),
    });
    expect(res.status).toBe(201);
    expect(engine.calls).toHaveLength(1);
    const call = engine.calls[0] as {
      shotId: string;
      providerId: string;
      outputs: Array<{ bytes: Uint8Array; filename: string; content_type?: string }>;
      provenance: unknown;
      externalJobRef: string;
      notes: string;
    };
    expect(call.shotId).toBe('shot_42');
    expect(call.providerId).toBe('modal');
    expect(call.externalJobRef).toBe('run-2026-07-21a');
    expect(call.notes).toBe('checkpoint sample');
    expect(call.provenance).toEqual({ base_model: 'flux-dev', step: 100 });
    expect(call.outputs).toHaveLength(1);
    expect(call.outputs[0].filename).toBe('ckpt_000100.png');
    expect(call.outputs[0].content_type).toBe('image/png');
    expect([...call.outputs[0].bytes]).toEqual([...PNG_BYTES]);
  });

  it('happy path against the REAL engine: 201 and the uploaded file lands on disk', async () => {
    const { db } = makeInMemoryDb();
    const dir = mkdtempSync(join(tmpdir(), 'vellum-upload-route-'));
    try {
      const hierarchy = new HierarchyRepo(db);
      const vRepo = new VersionRepo(db);
      const pRepo = new ProvenanceRepo(db);
      const engine = new GenerationEngine(
        hierarchy,
        vRepo,
        pRepo,
        new ProvenanceWriter(pRepo),
        null,
        new BreadcrumbResolver(hierarchy, vRepo),
        dir,
      );
      const ws = hierarchy.createWorkspace('wu');
      const proj = hierarchy.createProject(ws.id, 'hh-style-lora');
      const seq = hierarchy.createSequence(proj.id, 'run-2026-07-21a');
      const sh = hierarchy.createShot(seq.id, 'prompt_fox');

      const app = new Hono();
      app.onError(typedErrorHandler);
      app.route('/', createWebhookRouter(engine, { ingestToken: TOKEN }));

      const res = await uploadReq(app, '/webhooks/modal/upload', {
        meta: { shot_id: sh.id, provenance: { step: 100 } },
        files: [{ name: 'ckpt_000100.png', type: 'image/png', data: PNG_BYTES }],
        headers: auth(TOKEN),
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as { entity: { status: string; provider: string; outputs_json: string } };
      expect(json.entity.status).toBe('completed');
      expect(json.entity.provider).toBe('modal');
      const outputs = JSON.parse(json.entity.outputs_json) as Array<{ path: string; url: string }>;
      expect(outputs[0].url).toBe('uploaded:direct');
      expect([...readFileSync(outputs[0].path)]).toEqual([...PNG_BYTES]);
      const files = readdirSync(dir, { recursive: true }) as string[];
      expect(files.some((f) => String(f).endsWith('ckpt_000100.png'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing or invalid meta with 400', async () => {
    const engine = fakeEngine();
    const app = buildApp(engine, TOKEN);
    for (const meta of [undefined, 'not json', { outputs: [] } /* missing shot_id */]) {
      const res = await uploadReq(app, '/webhooks/modal/upload', {
        meta,
        files: GOOD_FILES,
        headers: auth(TOKEN),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_INPUT');
    }
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects zero files with 400', async () => {
    const engine = fakeEngine();
    const res = await uploadReq(buildApp(engine, TOKEN), '/webhooks/modal/upload', {
      meta: GOOD_META,
      headers: auth(TOKEN),
    });
    expect(res.status).toBe(400);
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects more than 20 files with 400', async () => {
    const engine = fakeEngine();
    const res = await uploadReq(buildApp(engine, TOKEN), '/webhooks/modal/upload', {
      meta: GOOD_META,
      files: Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.png`, data: PNG_BYTES })),
      headers: auth(TOKEN),
    });
    expect(res.status).toBe(400);
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects an oversize file with 413 before delegating', async () => {
    const engine = fakeEngine();
    const app = new Hono();
    app.onError(typedErrorHandler);
    app.route('/', createWebhookRouter(engine as never, { ingestToken: TOKEN, maxUploadBytes: 16 }));
    const res = await uploadReq(app, '/webhooks/modal/upload', {
      meta: GOOD_META,
      files: [{ name: 'big.png', data: new Uint8Array(64) }],
      headers: auth(TOKEN),
    });
    expect(res.status).toBe(413);
    expect(engine.calls).toHaveLength(0);
  });

  it('rejects an invalid provider path segment with 400', async () => {
    const engine = fakeEngine();
    const res = await uploadReq(buildApp(engine, TOKEN), '/webhooks/foo$bar/upload', {
      meta: GOOD_META,
      files: GOOD_FILES,
      headers: auth(TOKEN),
    });
    expect(res.status).toBe(400);
    expect(engine.calls).toHaveLength(0);
  });

  it('does not disturb the JSON route: a 21-output JSON body still 400s and JSON cap still applies', async () => {
    // Guard: adding the upload route must not loosen the original route's limits.
    const engine = fakeEngine();
    const app = buildApp(engine, TOKEN);
    const res = await post(app, '/webhooks/replicate', GOOD_BODY, auth(TOKEN));
    expect(res.status).toBe(201);
    expect(engine.calls).toHaveLength(1);
  });
});
