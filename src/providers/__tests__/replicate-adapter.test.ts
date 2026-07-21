import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ReplicateAdapter,
  mapReplicateStatus,
  extractReplicateOutputs,
  DEFAULT_REPLICATE_API_BASE,
} from '../replicate-adapter.js';

const TOKEN = 'r8_secrettoken1234';

/** Build a fetch mock from a router keyed on `${method} ${pathname}`. */
function mockFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    const handler = routes[key] ?? routes[`${method} *`];
    if (!handler) throw new Error(`unrouted ${key}`);
    return handler();
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ReplicateAdapter', () => {
  test('id is "replicate" and satisfies the provider contract shape', () => {
    const a = new ReplicateAdapter(TOKEN);
    expect(a.id).toBe('replicate');
    expect(typeof a.submit).toBe('function');
    expect(typeof a.status).toBe('function');
    expect(typeof a.downloadToPath).toBe('function');
    expect(typeof a.validateRequest).toBe('function');
    expect(typeof a.fetchResolvedPrompt).toBe('function');
  });

  describe('validateRequest', () => {
    const a = new ReplicateAdapter(TOKEN);
    test('accepts { version, input }', () => {
      expect(() => a.validateRequest({ version: 'owner/m:abc', input: { prompt: 'hi' } })).not.toThrow();
    });
    test('rejects missing version', () => {
      expect(() => a.validateRequest({ input: {} })).toThrowError(/version/);
    });
    test('rejects missing/invalid input', () => {
      expect(() => a.validateRequest({ version: 'x' })).toThrowError(/input/);
      expect(() => a.validateRequest({ version: 'x', input: [] })).toThrowError(/input/);
    });
  });

  describe('submit', () => {
    test('POSTs {version,input} and maps prediction id -> prompt_id', async () => {
      let sentBody: unknown = null;
      const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        return json({ id: 'pred_123', status: 'starting' });
      }) as unknown as typeof fetch;
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, { fetchImpl });
      const res = await a.submit({ version: 'owner/m:abc', input: { prompt: 'a cat' } });
      expect(res.prompt_id).toBe('pred_123');
      expect(sentBody).toEqual({ version: 'owner/m:abc', input: { prompt: 'a cat' } });
    });

    test('429 -> REPLICATE_API_ERROR', async () => {
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: mockFetch({ 'POST /v1/predictions': () => new Response('rate', { status: 429 }) }),
      });
      await expect(a.submit({ version: 'x', input: {} })).rejects.toMatchObject({
        code: 'REPLICATE_API_ERROR',
      });
    });

    test('non-ok scrubs the API token from the error message', async () => {
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: mockFetch({
          'POST /v1/predictions': () => new Response(`bad ${TOKEN}`, { status: 500 }),
        }),
      });
      await expect(a.submit({ version: 'x', input: {} })).rejects.toThrow();
      try {
        await a.submit({ version: 'x', input: {} });
      } catch (e) {
        expect((e as Error).message).not.toContain(TOKEN);
        expect((e as Error).message).toContain('[redacted]');
      }
    });

    test('missing prediction id -> error', async () => {
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: mockFetch({ 'POST /v1/predictions': () => json({ status: 'starting' }) }),
      });
      await expect(a.submit({ version: 'x', input: {} })).rejects.toMatchObject({
        code: 'REPLICATE_API_ERROR',
      });
    });
  });

  describe('status', () => {
    const cases: Array<[string, string, boolean]> = [
      ['starting', 'pending', false],
      ['processing', 'in_progress', false],
      ['succeeded', 'completed', true],
      ['failed', 'failed', false],
      ['canceled', 'cancelled', false],
    ];
    for (const [native, mapped, hasOutputs] of cases) {
      test(`maps ${native} -> ${mapped}`, async () => {
        const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
          fetchImpl: mockFetch({
            'GET /v1/predictions/pred_1': () =>
              json({
                id: 'pred_1',
                status: native,
                output: hasOutputs ? ['https://replicate.delivery/x/out.png'] : undefined,
                error: native === 'failed' ? 'boom' : undefined,
              }),
          }),
        });
        const s = await a.status('pred_1');
        expect(s.status).toBe(mapped);
        if (hasOutputs) {
          expect(s.outputs).toHaveLength(1);
          expect(s.outputs![0].type).toBe('https://replicate.delivery/x/out.png');
          expect(s.outputs![0].filename).toBe('out.png');
        }
        if (native === 'failed') expect(s.error).toBe('boom');
      });
    }
  });

  describe('status — completed-with-no-asset guard', () => {
    test('nested-array output is extracted, not dropped', async () => {
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: mockFetch({
          'GET /v1/predictions/pred_n': () =>
            json({ id: 'pred_n', status: 'succeeded', output: { video: ['https://replicate.delivery/a/out.mp4'] } }),
        }),
      });
      const s = await a.status('pred_n');
      expect(s.status).toBe('completed');
      expect(s.outputs).toHaveLength(1);
      expect(s.outputs![0].type).toBe('https://replicate.delivery/a/out.mp4');
    });

    test('succeeded but no downloadable https URL → failed (not a silent empty success)', async () => {
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: mockFetch({
          'GET /v1/predictions/pred_x': () =>
            json({ id: 'pred_x', status: 'succeeded', output: 'data:image/png;base64,AAAA' }),
        }),
      });
      const s = await a.status('pred_x');
      expect(s.status).toBe('failed');
      expect(String(s.error)).toMatch(/no downloadable/i);
    });
  });

  describe('downloadToPath', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'vellum-replicate-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test('streams an allowlisted https output to disk and returns metadata', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: mockFetch({
          'GET /x/out.png': () =>
            new Response(bytes, {
              status: 200,
              headers: { 'content-type': 'image/png', 'content-length': '5' },
            }),
        }),
      });
      const dest = join(dir, 'out.png');
      // Engine convention: filename is the basename, URL rides in opts.type.
      const r = await a.downloadToPath('out.png', { type: 'https://replicate.delivery/x/out.png' }, dest);
      expect(r.path).toBe(dest);
      expect(r.contentType).toBe('image/png');
      expect(r.sizeBytes).toBe(5);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest)).toEqual(Buffer.from(bytes));
    });

    test('rejects a non-allowlisted host', async () => {
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: mockFetch({ 'GET *': () => new Response('x', { status: 200 }) }),
      });
      await expect(
        a.downloadToPath('out.png', { type: 'https://evil.example.com/out.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('rejects non-https output', async () => {
      const a = new ReplicateAdapter(TOKEN);
      await expect(
        a.downloadToPath('out.png', { type: 'http://replicate.delivery/x/out.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('rejects an unexpected redirect (SSRF guard)', async () => {
      const a = new ReplicateAdapter(TOKEN, DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: mockFetch({
          'GET /x/out.png': () => new Response(null, { status: 302, headers: { location: 'https://evil/' } }),
        }),
      });
      await expect(
        a.downloadToPath('out.png', { type: 'https://replicate.delivery/x/out.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });
  });

  test('fetchResolvedPrompt returns null (no embedded blob for URL providers)', async () => {
    const a = new ReplicateAdapter(TOKEN);
    await expect(a.fetchResolvedPrompt('/any/path.png')).resolves.toBeNull();
  });
});

describe('mapReplicateStatus', () => {
  test('maps the native vocabulary + unknown -> pending', () => {
    expect(mapReplicateStatus('succeeded')).toBe('completed');
    expect(mapReplicateStatus('failed')).toBe('failed');
    expect(mapReplicateStatus('canceled')).toBe('cancelled');
    expect(mapReplicateStatus('processing')).toBe('in_progress');
    expect(mapReplicateStatus('starting')).toBe('pending');
    expect(mapReplicateStatus('mystery')).toBe('pending');
  });
});

describe('extractReplicateOutputs', () => {
  test('string, array, and object outputs; non-https filtered', () => {
    expect(extractReplicateOutputs('https://replicate.delivery/a/1.png')).toHaveLength(1);
    expect(extractReplicateOutputs(['https://replicate.delivery/a/1.png', 'https://replicate.delivery/a/2.png'])).toHaveLength(2);
    expect(extractReplicateOutputs({ image: 'https://replicate.delivery/a/1.png', seed: 42 })).toHaveLength(1);
    expect(extractReplicateOutputs(['not-a-url', 42, null])).toHaveLength(0);
  });

  test('recurses into nested arrays and objects (would otherwise silently drop the asset)', () => {
    expect(extractReplicateOutputs({ video: ['https://replicate.delivery/a/out.mp4'] })).toHaveLength(1);
    expect(
      extractReplicateOutputs([
        { image: 'https://replicate.delivery/a/1.png' },
        { image: 'https://replicate.delivery/a/2.png' },
      ]),
    ).toHaveLength(2);
    expect(extractReplicateOutputs({ a: { b: { url: 'https://replicate.delivery/a/deep.png' } } })).toHaveLength(1);
  });

  test('drops data: URIs (no https) — status() turns this into a failure, not empty success', () => {
    expect(extractReplicateOutputs('data:image/png;base64,AAAA')).toHaveLength(0);
    expect(extractReplicateOutputs({ image: 'data:image/png;base64,AAAA' })).toHaveLength(0);
  });

  test('derives a safe basename and carries the URL in type', () => {
    const [o] = extractReplicateOutputs('https://replicate.delivery/pbxt/abc/render.webp');
    expect(o.filename).toBe('render.webp');
    expect(o.type).toBe('https://replicate.delivery/pbxt/abc/render.webp');
    expect(o.subfolder).toBe('');
  });

  test('falls back to an index name when the URL has no basename (root path)', () => {
    const [o] = extractReplicateOutputs('https://replicate.delivery/');
    expect(o.filename).toBe('replicate_output_0');
  });

  test("collapses '..' in a delivery-URL basename so it never reaches buildOutputPath as traversal", () => {
    const [o] = extractReplicateOutputs('https://replicate.delivery/pbxt/xyz/frame..001.png');
    expect(o.filename).not.toContain('..');
    expect(o.filename).toBe('frame.001.png');
  });

  test('bounds pathologically deep nesting without overflowing the stack', () => {
    // A ~50k-deep nested array (accepted by JSON.parse) would blow the recursion
    // stack without a depth guard; the URL sits far below the depth cap so it is
    // dropped, but the walk must not throw a RangeError.
    let deep: unknown = 'https://replicate.delivery/a/toodeep.png';
    for (let i = 0; i < 50_000; i++) deep = [deep];
    let result: ReturnType<typeof extractReplicateOutputs> = [];
    expect(() => {
      result = extractReplicateOutputs(deep);
    }).not.toThrow();
    expect(result).toHaveLength(0);
  });

  test('caps output fan-out at 512 URLs (DoS backstop against an abusive prediction)', () => {
    const many = Array.from(
      { length: 600 },
      (_, i) => `https://replicate.delivery/a/${i}.png`,
    );
    expect(extractReplicateOutputs(many)).toHaveLength(512);
  });
});
