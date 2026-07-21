import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FalAdapter, mapFalStatus, extractFalOutputs, DEFAULT_FAL_API_BASE } from '../fal-adapter.js';

const KEY = 'fal_secretkey_1234';
const MODEL = 'fal-ai/flux/dev';

/** Router keyed on `${method} ${pathname}`. */
function mockFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`;
    const handler = routes[key] ?? routes[`${(init?.method ?? 'GET').toUpperCase()} *`];
    if (!handler) throw new Error(`unrouted ${key}`);
    return handler();
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('FalAdapter', () => {
  test('id "fal", request-replay strategy, provider contract shape', () => {
    const a = new FalAdapter(KEY);
    expect(a.id).toBe('fal');
    expect(a.reproduceStrategy).toBe('request-replay');
    for (const m of ['submit', 'status', 'downloadToPath', 'validateRequest', 'fetchResolvedPrompt', 'describeProvenance'] as const) {
      expect(typeof a[m]).toBe('function');
    }
  });

  describe('validateRequest', () => {
    const a = new FalAdapter(KEY);
    test('accepts { model, input }', () => {
      expect(() => a.validateRequest({ model: MODEL, input: { prompt: 'hi' } })).not.toThrow();
    });
    test('rejects missing/invalid model (incl. traversal)', () => {
      expect(() => a.validateRequest({ input: {} })).toThrowError(/model/);
      expect(() => a.validateRequest({ model: 'has space', input: {} })).toThrowError(/model/);
      expect(() => a.validateRequest({ model: '../etc/passwd', input: {} })).toThrowError(/model/);
    });
    test('rejects missing/invalid input', () => {
      expect(() => a.validateRequest({ model: MODEL })).toThrowError(/input/);
      expect(() => a.validateRequest({ model: MODEL, input: [] })).toThrowError(/input/);
    });
  });

  describe('submit', () => {
    test('POSTs input to /{model} with Key auth and returns composite job id', async () => {
      let sentBody: unknown = null;
      let authHeader = '';
      const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        authHeader = (init?.headers as Record<string, string>).Authorization;
        return json({ request_id: 'req_1', status: 'IN_QUEUE' });
      }) as unknown as typeof fetch;
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, { fetchImpl });
      const res = await a.submit({ model: MODEL, input: { prompt: 'a cat' } });
      expect(res.prompt_id).toBe(`${MODEL}::req_1`);
      expect(sentBody).toEqual({ prompt: 'a cat' }); // input posted directly
      expect(authHeader).toBe(`Key ${KEY}`);
    });

    test('429 → FAL_API_ERROR', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({ [`POST /${MODEL}`]: () => new Response('rate', { status: 429 }) }),
      });
      await expect(a.submit({ model: MODEL, input: {} })).rejects.toMatchObject({ code: 'FAL_API_ERROR' });
    });

    test('non-ok scrubs the key from the error', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({ [`POST /${MODEL}`]: () => new Response(`bad ${KEY}`, { status: 500 }) }),
      });
      await expect(a.submit({ model: MODEL, input: {} })).rejects.toThrow();
      try {
        await a.submit({ model: MODEL, input: {} });
      } catch (e) {
        expect((e as Error).message).not.toContain(KEY);
        expect((e as Error).message).toContain('[redacted]');
      }
    });

    test('missing request_id → error', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({ [`POST /${MODEL}`]: () => json({ status: 'IN_QUEUE' }) }),
      });
      await expect(a.submit({ model: MODEL, input: {} })).rejects.toMatchObject({ code: 'FAL_API_ERROR' });
    });
  });

  describe('status', () => {
    const jobId = `${MODEL}::req_1`;
    test('IN_QUEUE → pending, IN_PROGRESS → in_progress (no result fetch)', async () => {
      for (const [native, mapped] of [['IN_QUEUE', 'pending'], ['IN_PROGRESS', 'in_progress']] as const) {
        const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
          fetchImpl: mockFetch({ [`GET /${MODEL}/requests/req_1/status`]: () => json({ status: native }) }),
        });
        const s = await a.status(jobId);
        expect(s.status).toBe(mapped);
        expect(s.outputs).toBeUndefined();
      }
    });

    test('COMPLETED → fetches result, extracts https outputs', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({
          [`GET /${MODEL}/requests/req_1/status`]: () => json({ status: 'COMPLETED' }),
          [`GET /${MODEL}/requests/req_1`]: () => json({ images: [{ url: 'https://fal.media/files/x/out.png' }] }),
        }),
      });
      const s = await a.status(jobId);
      expect(s.status).toBe('completed');
      expect(s.outputs).toHaveLength(1);
      expect(s.outputs![0].type).toBe('https://fal.media/files/x/out.png');
      expect(s.outputs![0].filename).toBe('out.png');
    });

    test('COMPLETED with no downloadable https URL → failed', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({
          [`GET /${MODEL}/requests/req_1/status`]: () => json({ status: 'COMPLETED' }),
          [`GET /${MODEL}/requests/req_1`]: () => json({ text: 'the answer is 42' }),
        }),
      });
      const s = await a.status(jobId);
      expect(s.status).toBe('failed');
      expect(String(s.error)).toMatch(/no downloadable/i);
    });

    test('malformed job id (no separator) → FAL_API_ERROR', async () => {
      const a = new FalAdapter(KEY);
      await expect(a.status('req_1')).rejects.toMatchObject({ code: 'FAL_API_ERROR' });
    });

    test('non-ok status endpoint → FAL_API_ERROR (key scrubbed)', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({ [`GET /${MODEL}/requests/req_1/status`]: () => new Response(`boom ${KEY}`, { status: 500 }) }),
      });
      await expect(a.status(jobId)).rejects.toMatchObject({ code: 'FAL_API_ERROR' });
    });

    test('COMPLETED but result GET non-ok → failed, key scrubbed from error', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({
          [`GET /${MODEL}/requests/req_1/status`]: () => json({ status: 'COMPLETED' }),
          [`GET /${MODEL}/requests/req_1`]: () => new Response(`err ${KEY}`, { status: 500 }),
        }),
      });
      const s = await a.status(jobId);
      expect(s.status).toBe('failed');
      expect(String(s.error)).not.toContain(KEY);
      expect(String(s.error)).toContain('[redacted]');
    });

    test('COMPLETED but result GET throws → FAL_API_ERROR, key scrubbed', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({
          [`GET /${MODEL}/requests/req_1/status`]: () => json({ status: 'COMPLETED' }),
          [`GET /${MODEL}/requests/req_1`]: () => {
            throw new Error(`net ${KEY}`);
          },
        }),
      });
      await expect(a.status(jobId)).rejects.toMatchObject({ code: 'FAL_API_ERROR' });
      try {
        await a.status(jobId);
      } catch (e) {
        expect((e as Error).message).not.toContain(KEY);
        expect((e as Error).message).toContain('[redacted]');
      }
    });
  });

  describe('downloadToPath', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'vellum-fal-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test('streams an allowlisted https output (fal.media) to disk', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({
          'GET /files/x/out.png': () =>
            new Response(bytes, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '5' } }),
        }),
      });
      const dest = join(dir, 'out.png');
      const r = await a.downloadToPath('out.png', { type: 'https://fal.media/files/x/out.png' }, dest);
      expect(r.sizeBytes).toBe(5);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest)).toEqual(Buffer.from(bytes));
    });

    test('rejects a non-allowlisted host', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({ 'GET *': () => new Response('x', { status: 200 }) }),
      });
      await expect(
        a.downloadToPath('o.png', { type: 'https://evil.example.com/o.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('rejects non-https output', async () => {
      const a = new FalAdapter(KEY);
      await expect(
        a.downloadToPath('o.png', { type: 'http://fal.media/x/o.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('accepts a regional subdomain of an allowlisted host (suffix match)', async () => {
      const bytes = new Uint8Array([9, 9, 9]);
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({
          'GET /files/x/o.png': () =>
            new Response(bytes, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '3' } }),
        }),
      });
      const dest = join(dir, 'o.png');
      const r = await a.downloadToPath('o.png', { type: 'https://storage.fal.media/files/x/o.png' }, dest);
      expect(r.sizeBytes).toBe(3);
      expect(existsSync(dest)).toBe(true);
    });

    test('rejects an apex look-alike host (evilfal.media) — the ".host" boundary holds', async () => {
      const a = new FalAdapter(KEY, DEFAULT_FAL_API_BASE, {
        fetchImpl: mockFetch({ 'GET *': () => new Response('x', { status: 200 }) }),
      });
      await expect(
        a.downloadToPath('o.png', { type: 'https://evilfal.media/o.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });
  });

  test('fetchResolvedPrompt returns null', async () => {
    await expect(new FalAdapter(KEY).fetchResolvedPrompt('/x.png')).resolves.toBeNull();
  });

  describe('describeProvenance', () => {
    const a = new FalAdapter(KEY);
    test('maps { model, input } → NeutralProvenance', () => {
      expect(a.describeProvenance({ model: MODEL, input: { prompt: 'x', seed: 3 } })).toEqual({
        provider_id: 'fal',
        model_id: MODEL,
        params: { prompt: 'x', seed: 3 },
        models: [{ provider_model_id: MODEL, hash: null, unavailable_reason: 'hosted_provider' }],
      });
    });
    test('missing model → model_id undefined, empty models', () => {
      const n = a.describeProvenance({ input: {} });
      expect(n?.model_id).toBeUndefined();
      expect(n?.models).toEqual([]);
    });
  });
});

describe('mapFalStatus', () => {
  test('maps the native vocabulary + unknown → pending', () => {
    expect(mapFalStatus('COMPLETED')).toBe('completed');
    expect(mapFalStatus('IN_PROGRESS')).toBe('in_progress');
    expect(mapFalStatus('IN_QUEUE')).toBe('pending');
    expect(mapFalStatus('???')).toBe('pending');
  });
});

describe('extractFalOutputs', () => {
  test('extracts nested image/video/audio url shapes; ignores non-https', () => {
    expect(extractFalOutputs({ images: [{ url: 'https://fal.media/a/1.png' }] })).toHaveLength(1);
    expect(extractFalOutputs({ video: { url: 'https://fal.media/a/v.mp4' } })).toHaveLength(1);
    expect(extractFalOutputs({ audio: { url: 'https://fal.media/a/a.mp3' } })).toHaveLength(1);
    expect(extractFalOutputs({ text: 'nope', n: 5 })).toHaveLength(0);
  });
});
