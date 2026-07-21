import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ByteplusAdapter,
  mapByteplusStatus,
  extractByteplusOutputs,
  DEFAULT_BYTEPLUS_API_BASE,
} from '../byteplus-adapter.js';

const KEY = 'ark_secretkey_1234';
const MODEL = 'dreamina-seedance-2-0-260128';
const CONTENT = [{ type: 'text', text: 'a slow dolly shot of rain on glass' }];
const TASKS = '/api/v3/contents/generations/tasks';

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

describe('ByteplusAdapter', () => {
  test('id "byteplus", request-replay strategy, provider contract shape', () => {
    const a = new ByteplusAdapter(KEY);
    expect(a.id).toBe('byteplus');
    expect(a.reproduceStrategy).toBe('request-replay');
    for (const m of ['submit', 'status', 'downloadToPath', 'validateRequest', 'fetchResolvedPrompt', 'describeProvenance'] as const) {
      expect(typeof a[m]).toBe('function');
    }
  });

  describe('validateRequest', () => {
    const a = new ByteplusAdapter(KEY);
    test('accepts { model, content[] }', () => {
      expect(() => a.validateRequest({ model: MODEL, content: CONTENT })).not.toThrow();
    });
    test('rejects missing/empty model', () => {
      expect(() => a.validateRequest({ content: CONTENT })).toThrowError(/model/);
      expect(() => a.validateRequest({ model: '', content: CONTENT })).toThrowError(/model/);
      expect(() => a.validateRequest({ model: '   ', content: CONTENT })).toThrowError(/model/);
    });
    test('rejects missing/non-array content', () => {
      expect(() => a.validateRequest({ model: MODEL })).toThrowError(/content/);
      expect(() => a.validateRequest({ model: MODEL, content: { type: 'text' } })).toThrowError(/content/);
      expect(() => a.validateRequest({ model: MODEL, content: 'a prompt' })).toThrowError(/content/);
    });
  });

  describe('submit', () => {
    test('POSTs { model, content } to the tasks endpoint with Bearer auth and returns the task id', async () => {
      let sentBody: unknown = null;
      let authHeader = '';
      let calledPath = '';
      const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
        calledPath = (input instanceof URL ? input : new URL(String(input))).pathname;
        sentBody = JSON.parse(String(init?.body));
        authHeader = (init?.headers as Record<string, string>).Authorization;
        return json({ id: 'task_1', status: 'queued' });
      }) as unknown as typeof fetch;
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, { fetchImpl });
      const res = await a.submit({ model: MODEL, content: CONTENT });
      expect(res.prompt_id).toBe('task_1');
      expect(calledPath).toBe(TASKS); // /api/v3 prefix must survive URL building
      expect(sentBody).toEqual({ model: MODEL, content: CONTENT });
      expect(authHeader).toBe(`Bearer ${KEY}`);
    });

    test('429 → BYTEPLUS_API_ERROR with ModelArk beta-limit hint', async () => {
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({ [`POST ${TASKS}`]: () => new Response('rate', { status: 429 }) }),
      });
      await expect(a.submit({ model: MODEL, content: CONTENT })).rejects.toMatchObject({
        code: 'BYTEPLUS_API_ERROR',
        hint: expect.stringMatching(/2 requests\/sec|3 concurrent/),
      });
    });

    test('non-ok scrubs the key from the error', async () => {
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({ [`POST ${TASKS}`]: () => new Response(`bad ${KEY}`, { status: 500 }) }),
      });
      await expect(a.submit({ model: MODEL, content: CONTENT })).rejects.toThrow();
      try {
        await a.submit({ model: MODEL, content: CONTENT });
      } catch (e) {
        expect((e as Error).message).not.toContain(KEY);
        expect((e as Error).message).toContain('[redacted]');
      }
    });

    test('missing task id → error', async () => {
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({ [`POST ${TASKS}`]: () => json({ status: 'queued' }) }),
      });
      await expect(a.submit({ model: MODEL, content: CONTENT })).rejects.toMatchObject({
        code: 'BYTEPLUS_API_ERROR',
      });
    });
  });

  describe('status', () => {
    test('queued → pending, running → in_progress (no outputs)', async () => {
      for (const [native, mapped] of [['queued', 'pending'], ['running', 'in_progress']] as const) {
        const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
          fetchImpl: mockFetch({ [`GET ${TASKS}/task_1`]: () => json({ id: 'task_1', status: native }) }),
        });
        const s = await a.status('task_1');
        expect(s.status).toBe(mapped);
        expect(s.outputs).toBeUndefined();
      }
    });

    test('failed → failed with the task error surfaced; cancelled → cancelled', async () => {
      const failed = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({
          [`GET ${TASKS}/task_1`]: () =>
            json({ id: 'task_1', status: 'failed', error: { code: 'ModelError', message: 'boom' } }),
        }),
      });
      const f = await failed.status('task_1');
      expect(f.status).toBe('failed');
      expect(f.error).toEqual({ code: 'ModelError', message: 'boom' });

      const cancelled = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({ [`GET ${TASKS}/task_1`]: () => json({ id: 'task_1', status: 'cancelled' }) }),
      });
      const c = await cancelled.status('task_1');
      expect(c.status).toBe('cancelled');
    });

    test('succeeded → extracts the video_url nested under content', async () => {
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({
          [`GET ${TASKS}/task_1`]: () =>
            json({
              id: 'task_1',
              status: 'succeeded',
              content: { video_url: 'https://tos-ap-southeast.bytepluses.com/x/out.mp4' },
            }),
        }),
      });
      const s = await a.status('task_1');
      expect(s.status).toBe('completed');
      expect(s.outputs).toHaveLength(1);
      expect(s.outputs![0].type).toBe('https://tos-ap-southeast.bytepluses.com/x/out.mp4');
      expect(s.outputs![0].filename).toBe('out.mp4');
    });

    test('succeeded with no downloadable https URL → failed', async () => {
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({
          [`GET ${TASKS}/task_1`]: () => json({ id: 'task_1', status: 'succeeded', content: {} }),
        }),
      });
      const s = await a.status('task_1');
      expect(s.status).toBe('failed');
      expect(String(s.error)).toMatch(/no downloadable/i);
    });

    test('non-ok status endpoint → BYTEPLUS_API_ERROR (key scrubbed)', async () => {
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({ [`GET ${TASKS}/task_1`]: () => new Response(`boom ${KEY}`, { status: 500 }) }),
      });
      await expect(a.status('task_1')).rejects.toMatchObject({ code: 'BYTEPLUS_API_ERROR' });
      try {
        await a.status('task_1');
      } catch (e) {
        expect((e as Error).message).not.toContain(KEY);
        expect((e as Error).message).toContain('[redacted]');
      }
    });
  });

  describe('downloadToPath', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'vellum-byteplus-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test('streams an allowlisted https output (volces.com) to disk', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({
          'GET /x/out.mp4': () =>
            new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '5' } }),
        }),
      });
      const dest = join(dir, 'out.mp4');
      const r = await a.downloadToPath('out.mp4', { type: 'https://volces.com/x/out.mp4' }, dest);
      expect(r.sizeBytes).toBe(5);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest)).toEqual(Buffer.from(bytes));
    });

    test('accepts a TOS delivery subdomain via suffix match (tos-x.bytepluses.com)', async () => {
      const bytes = new Uint8Array([9, 9, 9]);
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({
          'GET /x/o.mp4': () =>
            new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '3' } }),
        }),
      });
      const dest = join(dir, 'o.mp4');
      const r = await a.downloadToPath('o.mp4', { type: 'https://tos-x.bytepluses.com/x/o.mp4' }, dest);
      expect(r.sizeBytes).toBe(3);
      expect(existsSync(dest)).toBe(true);
    });

    test('rejects an apex look-alike host (evilbytepluses.com) — the ".host" boundary holds', async () => {
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({ 'GET *': () => new Response('x', { status: 200 }) }),
      });
      await expect(
        a.downloadToPath('o.mp4', { type: 'https://evilbytepluses.com/o.mp4' }, join(dir, 'o.mp4')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('rejects a non-allowlisted host', async () => {
      const a = new ByteplusAdapter(KEY, DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: mockFetch({ 'GET *': () => new Response('x', { status: 200 }) }),
      });
      await expect(
        a.downloadToPath('o.mp4', { type: 'https://evil.example.com/o.mp4' }, join(dir, 'o.mp4')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('rejects non-https output', async () => {
      const a = new ByteplusAdapter(KEY);
      await expect(
        a.downloadToPath('o.mp4', { type: 'http://volces.com/x/o.mp4' }, join(dir, 'o.mp4')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });
  });

  test('fetchResolvedPrompt returns null', async () => {
    await expect(new ByteplusAdapter(KEY).fetchResolvedPrompt('/x.png')).resolves.toBeNull();
  });

  describe('describeProvenance', () => {
    const a = new ByteplusAdapter(KEY);
    test('maps { model, content } → NeutralProvenance (params = everything except model)', () => {
      expect(a.describeProvenance({ model: MODEL, content: CONTENT })).toEqual({
        provider_id: 'byteplus',
        model_id: MODEL,
        params: { content: CONTENT },
        models: [{ provider_model_id: MODEL, hash: null, unavailable_reason: 'hosted_provider' }],
      });
    });
    test('missing model → model_id undefined, empty models', () => {
      const n = a.describeProvenance({ content: CONTENT });
      expect(n?.model_id).toBeUndefined();
      expect(n?.models).toEqual([]);
      expect(n?.params).toEqual({ content: CONTENT });
    });
  });
});

describe('mapByteplusStatus', () => {
  test('maps all five native states + unknown → pending', () => {
    expect(mapByteplusStatus('queued')).toBe('pending');
    expect(mapByteplusStatus('running')).toBe('in_progress');
    expect(mapByteplusStatus('succeeded')).toBe('completed');
    expect(mapByteplusStatus('failed')).toBe('failed');
    expect(mapByteplusStatus('cancelled')).toBe('cancelled');
    expect(mapByteplusStatus('???')).toBe('pending');
  });

  test("'expired' is terminal → failed (never a pending-forever trap)", () => {
    expect(mapByteplusStatus('expired')).toBe('failed');
  });
});

describe('provider-aware generation timeout (routing review)', () => {
  test('declares a 30-minute generationTimeoutMs for long video tasks', () => {
    const a = new ByteplusAdapter(KEY);
    expect(a.generationTimeoutMs).toBe(30 * 60_000);
  });
});

describe('extractByteplusOutputs', () => {
  test('extracts nested video_url shapes; ignores non-https', () => {
    expect(
      extractByteplusOutputs({ content: { video_url: 'https://tos-x.bytepluses.com/a/v.mp4' } }),
    ).toHaveLength(1);
    expect(extractByteplusOutputs({ content: { video_url: 'http://insecure/v.mp4' } })).toHaveLength(0);
    expect(extractByteplusOutputs({ content: {}, usage: { tokens: 5 } })).toHaveLength(0);
  });
});
