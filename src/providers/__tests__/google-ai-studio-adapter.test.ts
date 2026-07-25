import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GoogleAIStudioAdapter,
  DEFAULT_GOOGLE_MODEL,
  INLINE_OUTPUT_URL,
} from '../google-ai-studio-adapter.js';

const KEY = 'AIza_secretkey_abcdef';
// A tiny valid 1x1 PNG, base64.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');

/** Capture the request the adapter sends so tests can assert on the body. */
interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (cap: Captured) => Response): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fn = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const cap: Captured = {
      url: url.toString(),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(cap);
    return handler(cap);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A generateContent response carrying `n` inline PNG image parts. */
function imageResponse(n = 1) {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: Array.from({ length: n }, () => ({ inlineData: { mimeType: 'image/png', data: PNG_B64 } })),
        },
      },
    ],
  };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gais-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('GoogleAIStudioAdapter — contract', () => {
  test('id, request-replay strategy, and method surface', () => {
    const a = new GoogleAIStudioAdapter(KEY);
    expect(a.id).toBe('google-ai-studio');
    expect(a.reproduceStrategy).toBe('request-replay');
    for (const m of ['submit', 'status', 'downloadToPath', 'validateRequest', 'fetchResolvedPrompt', 'describeProvenance'] as const) {
      expect(typeof a[m]).toBe('function');
    }
  });

  test('validateRequest requires a prompt or contents', () => {
    const a = new GoogleAIStudioAdapter(KEY);
    expect(() => a.validateRequest({})).toThrow(/prompt.*or.*contents/i);
    expect(() => a.validateRequest({ prompt: '   ' })).toThrow();
    // model must be a non-empty string when provided (prompt present so it's the model that fails).
    expect(() => a.validateRequest({ prompt: 'a cat', model: '' })).toThrow(/model/i);
    expect(() => a.validateRequest({ prompt: 'a cat' })).not.toThrow();
    expect(() => a.validateRequest({ contents: [{ parts: [{ text: 'a cat' }] }] })).not.toThrow();
  });

  test('describeProvenance maps model + params', () => {
    const a = new GoogleAIStudioAdapter(KEY);
    const p = a.describeProvenance({ model: 'gemini-2.5-flash-image', prompt: 'x' });
    expect(p?.provider_id).toBe('google-ai-studio');
    expect(p?.model_id).toBe('gemini-2.5-flash-image');
    expect(p?.params).toEqual({ prompt: 'x' });
    // Default model when omitted.
    expect(a.describeProvenance({ prompt: 'x' })?.model_id).toBe(DEFAULT_GOOGLE_MODEL);
  });
});

describe('GoogleAIStudioAdapter — submit', () => {
  test('sends x-goog-api-key header and wraps a prompt into contents', async () => {
    const { fetch, calls } = mockFetch(() => json(imageResponse(1)));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    const res = await a.submit({ prompt: 'a watercolor room' });
    expect(res.prompt_id).toMatch(/^gais_/);
    const cap = calls[0]!;
    expect(cap.method).toBe('POST');
    expect(cap.url).toContain(`/models/${DEFAULT_GOOGLE_MODEL}:generateContent`);
    expect(cap.headers['x-goog-api-key']).toBe(KEY);
    // Key must NOT be in the URL.
    expect(cap.url).not.toContain(KEY);
    expect(cap.body).toEqual({ contents: [{ parts: [{ text: 'a watercolor room' }] }] });
  });

  test('passes native contents + model + generationConfig through verbatim', async () => {
    const { fetch, calls } = mockFetch(() => json(imageResponse(1)));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    const contents = [{ parts: [{ text: 'hi' }, { inlineData: { mimeType: 'image/png', data: PNG_B64 } }] }];
    await a.submit({ model: 'gemini-3-pro-image-preview', contents, generationConfig: { temperature: 0.2 } });
    const cap = calls[0]!;
    expect(cap.url).toContain('/models/gemini-3-pro-image-preview:generateContent');
    expect(cap.body).toEqual({ contents, generationConfig: { temperature: 0.2 } });
  });

  test('HTTP 429 surfaces a rate-limit error, not an empty success', async () => {
    const { fetch } = mockFetch(() => json({ error: { message: 'quota' } }, 429));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    await expect(a.submit({ prompt: 'x' })).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR' });
  });

  test('a response with no image (safety block) is a failure', async () => {
    const { fetch } = mockFetch(() => json({ promptFeedback: { blockReason: 'SAFETY' } }));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    await expect(a.submit({ prompt: 'x' })).rejects.toThrow(/blocked.*SAFETY/i);
  });

  test('API key never leaks into an error message', async () => {
    const { fetch } = mockFetch(() => json({ error: { message: `bad key ${KEY}` } }, 400));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    await expect(a.submit({ prompt: 'x' })).rejects.toThrow(/\[redacted\]/);
    await expect(a.submit({ prompt: 'x' })).rejects.not.toThrow(new RegExp(KEY));
  });
});

describe('GoogleAIStudioAdapter — status + download (inline bridge)', () => {
  test('submit → status → downloadToPath writes the decoded bytes and evicts', async () => {
    const { fetch } = mockFetch(() => json(imageResponse(1)));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    const { prompt_id } = await a.submit({ prompt: 'x' });

    const st = await a.status(prompt_id);
    expect(st.status).toBe('completed');
    expect(st.outputs).toHaveLength(1);
    const out = st.outputs![0]!;
    expect(out.filename).toBe('gemini_0.png');
    expect(out.subfolder).toBe(prompt_id);
    expect(out.type).toBe('inline:0');

    const dest = join(tmp, out.filename);
    const dl = await a.downloadToPath(out.filename, { subfolder: out.subfolder, type: out.type }, dest);
    expect(dl.url).toBe(INLINE_OUTPUT_URL);
    expect(dl.contentType).toBe('image/png');
    expect(dl.sizeBytes).toBe(PNG_BYTES.byteLength);
    expect(readFileSync(dest)).toEqual(PNG_BYTES);

    // Buffer evicted after the last image is written — status now reports failed.
    expect((await a.status(prompt_id)).status).toBe('failed');
    await expect(
      a.downloadToPath(out.filename, { subfolder: out.subfolder, type: out.type }, join(tmp, 'again.png')),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR' });
  });

  test('multiple images produce one output locator each', async () => {
    const { fetch } = mockFetch(() => json(imageResponse(3)));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    const { prompt_id } = await a.submit({ prompt: 'x' });
    const st = await a.status(prompt_id);
    expect(st.outputs!.map((o) => o.type)).toEqual(['inline:0', 'inline:1', 'inline:2']);
    // Write two of the three; the job stays buffered until the last is written.
    for (const i of [0, 1]) {
      await a.downloadToPath(`gemini_${i}.png`, { subfolder: prompt_id, type: `inline:${i}` }, join(tmp, `g${i}.png`));
    }
    expect((await a.status(prompt_id)).status).toBe('completed');
    await a.downloadToPath('gemini_2.png', { subfolder: prompt_id, type: 'inline:2' }, join(tmp, 'g2.png'));
    expect((await a.status(prompt_id)).status).toBe('failed');
  });

  test('status for an unknown job id is a terminal failure, not a throw', async () => {
    const a = new GoogleAIStudioAdapter(KEY);
    const st = await a.status('gais_nonexistent');
    expect(st.status).toBe('failed');
    expect(st.error).toMatch(/no longer staged|re-run/i);
  });

  test('downloadToPath enforces a byte cap', async () => {
    const { fetch } = mockFetch(() => json(imageResponse(1)));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    const { prompt_id } = await a.submit({ prompt: 'x' });
    await expect(
      a.downloadToPath('gemini_0.png', { subfolder: prompt_id, type: 'inline:0' }, join(tmp, 'x.png'), { maxBytes: 4 }),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR' });
  });

  test('a large batch of in-flight jobs ALL survive (disk staging, no lossy cap)', async () => {
    // A caller often submits a whole batch, then polls. Every paid generation
    // must still be downloadable — none silently evicted. (Regression for the
    // memory-capped-stash bug found in review.)
    const { fetch } = mockFetch(() => json(imageResponse(1)));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push((await a.submit({ prompt: `shot ${i}` })).prompt_id);
    // First and last submitted are both still completable.
    expect((await a.status(ids[0]!)).status).toBe('completed');
    expect((await a.status(ids[39]!)).status).toBe('completed');
    const dl = await a.downloadToPath('gemini_0.png', { subfolder: ids[0]!, type: 'inline:0' }, join(tmp, 'first.png'));
    expect(readFileSync(dl.path)).toEqual(PNG_BYTES);
  });

  test('fetchResolvedPrompt returns null (no embedded blob)', async () => {
    const a = new GoogleAIStudioAdapter(KEY);
    expect(await a.fetchResolvedPrompt('/x.png')).toBeNull();
  });
});

describe('GoogleAIStudioAdapter — review hardening', () => {
  test('canonical models/ resource name is not double-prefixed or %2F-encoded', async () => {
    const { fetch, calls } = mockFetch(() => json(imageResponse(1)));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    await a.submit({ prompt: 'x', model: 'models/gemini-2.5-flash-image' });
    expect(calls[0]!.url).toContain('/models/gemini-2.5-flash-image:generateContent');
    expect(calls[0]!.url).not.toContain('models/models');
    expect(calls[0]!.url).not.toContain('%2F');
  });

  test('unknown request keys are forwarded, not silently dropped', async () => {
    const { fetch, calls } = mockFetch(() => json(imageResponse(1)));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    await a.submit({ prompt: 'x', generationConfig: { imageConfig: { aspectRatio: '16:9' } }, tools: [{ googleSearch: {} }] });
    expect(calls[0]!.body).toMatchObject({
      generationConfig: { imageConfig: { aspectRatio: '16:9' } },
      tools: [{ googleSearch: {} }],
    });
  });

  test('429 surfaces Google\'s quota detail from the response body', async () => {
    const { fetch } = mockFetch(() => json({ error: { message: 'Quota exceeded for metric gen-per-minute', status: 'RESOURCE_EXHAUSTED' } }, 429));
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    await expect(a.submit({ prompt: 'x' })).rejects.toThrow(/gen-per-minute/);
  });

  test('describeProvenance elides inline input image data (no base64 bloat)', () => {
    const a = new GoogleAIStudioAdapter(KEY);
    const p = a.describeProvenance({
      model: 'gemini-2.5-flash-image',
      contents: [{ parts: [{ text: 'edit this' }, { inlineData: { mimeType: 'image/png', data: PNG_B64 } }] }],
    });
    const s = JSON.stringify(p);
    expect(s).not.toContain(PNG_B64);
    expect(s).toContain('[inline data elided]');
  });

  test('a mixed text+image response keeps only the image part (real Gemini shape)', async () => {
    const { fetch } = mockFetch(() =>
      json({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: "Here's your storybook interior." },
                { inlineData: { mimeType: 'image/png', data: PNG_B64 } },
              ],
            },
          },
        ],
      }),
    );
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    const { prompt_id } = await a.submit({ prompt: 'x' });
    const st = await a.status(prompt_id);
    expect(st.status).toBe('completed');
    expect(st.outputs).toHaveLength(1); // the text part is ignored
  });

  test('a data: URI base64 payload is stripped and decoded correctly', async () => {
    const dataUri = `data:image/png;base64,${PNG_B64}`;
    const { fetch } = mockFetch(() =>
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: dataUri } }] } }] }),
    );
    const a = new GoogleAIStudioAdapter(KEY, undefined, { fetchImpl: fetch, stagingRoot: join(tmp, 'stage') });
    const { prompt_id } = await a.submit({ prompt: 'x' });
    const dl = await a.downloadToPath('gemini_0.png', { subfolder: prompt_id, type: 'inline:0' }, join(tmp, 'd.png'));
    expect(readFileSync(dl.path)).toEqual(PNG_BYTES);
  });
});
