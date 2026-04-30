import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import {
  ComfyUIClient,
  DEFAULT_COMFYUI_API_BASE,
  HEALTHCHECK_PATH,
  MAX_ERROR_BODY_BYTES,
  normalizeCloudStatus,
} from '../client.js';
import '../../test-utils/matchers.js';

/**
 * Tests for ComfyUIClient — Plan 02-02 Task 1.
 *
 * Covers:
 *  - submit: happy, 429, 4xx with node_errors, 500
 *  - status: happy normalisation, HTTP error
 *  - download SSRF gate: allowed host, disallowed host, non-302, additional hosts
 *  - downloadToPath: temp-then-rename atomic write contract
 *
 * Uses `fetchImpl` injection to drive deterministic responses. No real network.
 *
 * Phase 7 D-EP-07 note: `submit()` now awaits `ensureEndpointHealthy()` before
 * the POST /api/prompt. The healthcheck issues a GET against HEALTHCHECK_PATH,
 * so `mockFetch` transparently returns 200 for that GET and delegates all other
 * calls to the test-supplied handler. Tests that want to exercise a DRIFT path
 * (Plan 04) should use `mockFetchRaw` (no auto-healthcheck) to observe the GET.
 */

/**
 * Auto-healthcheck wrapper: first intercepts the D-EP-07 healthcheck GET
 * against HEALTHCHECK_PATH and returns 200, then delegates every other call
 * to the test-supplied handler. This preserves the existing test semantics
 * (which predate the healthcheck) — non-200 submit responses, 302 rejection,
 * network errors, etc. — without requiring per-test retrofitting.
 */
function mockFetch(
  fn: (req: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  const wrapped = async (
    req: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const urlStr =
      typeof req === 'string'
        ? req
        : req instanceof URL
          ? req.toString()
          : (req as Request).url;
    try {
      const pathname = new URL(urlStr).pathname;
      if (method === 'GET' && pathname === HEALTHCHECK_PATH) {
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    } catch {
      /* fall through — pass to user handler */
    }
    return fn(req, init);
  };
  return wrapped as unknown as typeof fetch;
}

/**
 * Raw mock fetch — NO healthcheck interception. Use when a test needs to
 * observe or drive the healthcheck GET itself (Plan 04 DRIFT coverage).
 */
function mockFetchRaw(
  fn: (req: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const BASE = DEFAULT_COMFYUI_API_BASE;
const KEY = 'sk-test-fake';

describe('ComfyUIClient.submit', () => {
  test('POST /api/prompt with X-API-Key and {prompt, extra_data} body returns {prompt_id}', async () => {
    let capturedInit: RequestInit | undefined;
    let capturedUrl: URL | string | Request | undefined;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse(200, { prompt_id: 'abc123' });
      }),
    });
    const out = await client.submit({ '1': { class_type: 'KSampler', inputs: {} } });
    expect(out.prompt_id).toBe('abc123');
    const u = new URL(capturedUrl!.toString());
    expect(u.pathname).toBe('/api/prompt');
    expect(u.origin).toBe(BASE);
    expect((capturedInit!.headers as Record<string, string>)['X-API-Key']).toBe(KEY);
    const body = JSON.parse(capturedInit!.body as string);
    expect(body).toEqual({
      prompt: { '1': { class_type: 'KSampler', inputs: {} } },
      extra_data: { api_key_comfy_org: KEY },
    });
  });

  test('extra_data.api_key_comfy_org is injected so partner-API nodes (Gemini, Kling, ...) authenticate', async () => {
    // Regression guard: without this field, partner / API nodes throw
    // "Unauthorized: Please login first to use this node" at execution time.
    // Per https://docs.comfy.org/development/comfyui-server/api-key-integration
    let capturedBody: unknown = null;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async (_url, init) => {
        capturedBody = JSON.parse(init!.body as string);
        return jsonResponse(200, { prompt_id: 'partner-ok' });
      }),
    });
    await client.submit({
      '1': {
        class_type: 'GeminiImage2Node',
        inputs: { prompt: 'test', model: 'gemini-3-pro-image-preview', seed: 0 },
      },
    });
    expect((capturedBody as { extra_data?: Record<string, unknown> }).extra_data).toBeDefined();
    expect(
      (capturedBody as { extra_data: { api_key_comfy_org?: string } }).extra_data
        .api_key_comfy_org,
    ).toBe(KEY);
  });

  test('429 surfaces COMFYUI_RATE_LIMITED with tier hint', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => jsonResponse(429, { error: 'rate limited' })),
    });
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_RATE_LIMITED',
    });
  });

  test('4xx with node_errors flattens to COMFYUI_API_ERROR message', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () =>
        jsonResponse(400, {
          error: 'validation failed',
          node_errors: {
            '3': {
              errors: [{ type: 'x', message: 'bad input' }],
              dependent_outputs: [],
              class_type: 'KSampler',
            },
          },
        }),
      ),
    });
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: 'Node 3 (KSampler): bad input',
    });
  });

  test('500 falls through to generic COMFYUI_API_ERROR with status line', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(
        async () =>
          new Response('Internal Server Error', {
            status: 500,
            statusText: 'Internal Server Error',
          }),
      ),
    });
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
    });
  });

  test('IS-04: ComfyUI error containing API-key substring is scrubbed before throwing', async () => {
    // Upstream echoes the X-API-Key header verbatim into its error body. The
    // client must NOT let that string escape into the thrown TypedError.
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () =>
        jsonResponse(400, {
          error: 'validation failed',
          node_errors: {
            '3': {
              errors: [{ type: 'x', message: `bad input (saw: ${KEY})` }],
              dependent_outputs: [],
              class_type: 'KSampler',
            },
          },
        }),
      ),
    });
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
    });
    // Re-run to capture the message and assert it does not contain the key.
    try {
      await client.submit({ '1': { class_type: 'A', inputs: {} } });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(KEY);
      expect(msg).toContain('[redacted]');
    }
  });

  test('IS-04: status error containing the API key is scrubbed before returning', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () =>
        jsonResponse(200, {
          status: 'failed',
          error: `upstream echo: ${KEY} something`,
        }),
      ),
    });
    const s = await client.status('job-1');
    expect(typeof s.error).toBe('string');
    expect(s.error as string).not.toContain(KEY);
    expect(s.error as string).toContain('[redacted]');
  });

  test('IS-04: long error messages are truncated to MAX_ERROR_MESSAGE_CHARS', async () => {
    const huge = 'x'.repeat(5000);
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () =>
        new Response(JSON.stringify({ error: huge }), {
          status: 500,
          statusText: 'Internal',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    });
    try {
      await client.submit({ '1': { class_type: 'A', inputs: {} } });
    } catch (e) {
      const msg = (e as Error).message;
      // Should be bounded.
      expect(msg.length).toBeLessThan(1500);
    }
  });

  test('IS-03: submit error-body read is capped at MAX_ERROR_BODY_BYTES', async () => {
    // Build an oversized body (2× the cap) and verify the client does not
    // swallow memory and still surfaces a typed error.
    const oversize = 'x'.repeat(MAX_ERROR_BODY_BYTES * 2);
    let readCount = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        readCount++;
        return new Response(oversize, {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'text/plain' },
        });
      }),
    });
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
    });
    expect(readCount).toBe(1);
  });

  test('C4: submit uses redirect:manual and rejects 302 (API key must not leak across redirect)', async () => {
    let calls = 0;
    let capturedInit: RequestInit | undefined;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async (_url, init) => {
        calls++;
        capturedInit = init;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/steal' },
        });
      }),
    });
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringMatching(/redirect/i),
    });
    expect(calls).toBe(1); // must NOT have followed to evil.example
    expect(capturedInit?.redirect).toBe('manual');
  });
});

describe('ComfyUIClient.status', () => {
  test('GET /api/jobs/{id} returns normalised StatusResponse (flat-array legacy shape)', async () => {
    let capturedUrl: URL | string | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse(200, {
          status: 'completed',
          progress: 1,
          outputs: [{ filename: 'x.png', subfolder: '', type: 'output' }],
        });
      }),
    });
    const s = await client.status('job-1');
    expect(s.status).toBe('completed');
    expect(s.progress).toBe(1);
    expect(s.outputs).toHaveLength(1);
    const u = new URL(capturedUrl!.toString());
    expect(u.pathname).toBe('/api/jobs/job-1');
    expect((capturedInit!.headers as Record<string, string>)['X-API-Key']).toBe(KEY);
  });

  test('D-EP-17: /api/jobs nested-map outputs shape flattens to ComfyOutput[]', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () =>
        jsonResponse(200, {
          status: 'completed',
          outputs: {
            '9': {
              images: [
                { filename: 'a.png', subfolder: '', type: 'output' },
                { filename: 'b.png', subfolder: 'sub', type: 'output' },
              ],
            },
            '12': {
              gifs: [{ filename: 'c.gif', subfolder: '', type: 'output' }],
            },
          },
        }),
      ),
    });
    const s = await client.status('job-1');
    expect(s.status).toBe('completed');
    expect(s.outputs).toEqual([
      { filename: 'a.png', subfolder: '', type: 'output' },
      { filename: 'b.png', subfolder: 'sub', type: 'output' },
      { filename: 'c.gif', subfolder: '', type: 'output' },
    ]);
  });

  test('D-EP-17: top-level error_message populates StatusResponse.error when no `error` field', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () =>
        jsonResponse(200, {
          status: 'error',
          error_message: 'worker dispatch failed',
        }),
      ),
    });
    const s = await client.status('job-1');
    expect(s.status).toBe('failed');
    expect(s.error).toBe('worker dispatch failed');
  });

  test('C4: status uses redirect:manual and rejects 302 (API key must not leak)', async () => {
    let calls = 0;
    let capturedInit: RequestInit | undefined;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async (_url, init) => {
        calls++;
        capturedInit = init;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/steal' },
        });
      }),
    });
    await expect(client.status('job-1')).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringMatching(/redirect/i),
    });
    expect(calls).toBe(1);
    expect(capturedInit?.redirect).toBe('manual');
  });

  test('status HTTP error surfaces COMFYUI_API_ERROR', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(
        async () => new Response('nope', { status: 502, statusText: 'Bad Gateway' }),
      ),
    });
    await expect(client.status('job-1')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
    });
  });

  test('D-EP-16: Cloud terminal "success" maps to "completed" via normalizeCloudStatus', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () =>
        jsonResponse(200, {
          status: 'success',
          outputs: [{ filename: 'x.png', subfolder: '', type: 'output' }],
        }),
      ),
    });
    const s = await client.status('job-1');
    expect(s.status).toBe('completed');
  });

  test('D-EP-16: Cloud terminal "error" maps to "failed" and preserves error blob', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () =>
        jsonResponse(200, {
          status: 'error',
          error: { message: 'worker dispatch failed' },
        }),
      ),
    });
    const s = await client.status('job-1');
    expect(s.status).toBe('failed');
    expect(s.error).toEqual({ message: 'worker dispatch failed' });
  });
});

describe('normalizeCloudStatus (D-EP-16)', () => {
  test('Cloud terminal strings map to canonical vocabulary', () => {
    expect(normalizeCloudStatus('success')).toBe('completed');
    expect(normalizeCloudStatus('completed')).toBe('completed');
    expect(normalizeCloudStatus('error')).toBe('failed');
    expect(normalizeCloudStatus('failed')).toBe('failed');
    expect(normalizeCloudStatus('cancelled')).toBe('cancelled');
    expect(normalizeCloudStatus('canceled')).toBe('cancelled');
  });

  test('intermediate strings map to canonical vocabulary', () => {
    expect(normalizeCloudStatus('running')).toBe('in_progress');
    expect(normalizeCloudStatus('in_progress')).toBe('in_progress');
  });

  test('unknown and non-string inputs fall through to "pending"', () => {
    expect(normalizeCloudStatus('queued')).toBe('pending');
    expect(normalizeCloudStatus('submitted')).toBe('pending');
    expect(normalizeCloudStatus('')).toBe('pending');
    expect(normalizeCloudStatus(undefined)).toBe('pending');
    expect(normalizeCloudStatus(null)).toBe('pending');
    expect(normalizeCloudStatus(42)).toBe('pending');
    expect(normalizeCloudStatus({ status: 'success' })).toBe('pending');
  });
});

describe('ComfyUIClient.download SSRF gate', () => {
  test('302 to allowed host rewrites without API-Key header and returns body', async () => {
    const signedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    let stageCall = 0;
    let secondInitSeen: RequestInit | undefined;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async (_url, init) => {
        stageCall++;
        if (stageCall === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/x.png' },
          });
        }
        secondInitSeen = init;
        return new Response(signedBytes, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(signedBytes.byteLength),
          },
        });
      }),
    });
    const res = await client.download('x.png');
    expect(res.contentType).toBe('image/png');
    expect(res.url).toContain('storage.googleapis.com');
    // Second fetch must NOT carry the X-API-Key header
    const secondHeaders = secondInitSeen!.headers as Record<string, string> | undefined;
    expect(secondHeaders?.['X-API-Key']).toBeUndefined();
  });

  test('302 to disallowed host rejects with COMFYUI_API_ERROR', async () => {
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.com/steal' },
          });
        return new Response('should not reach', { status: 200 });
      }),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('Unexpected redirect host'),
    });
  });

  test('non-302 response on /api/view rejects with COMFYUI_API_ERROR', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => new Response('ok', { status: 200 })),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
    });
  });

  test('C3: signed-URL second hop rejects a further redirect (SSRF bypass blocked)', async () => {
    // Allowlisted host responds 302 → internal metadata endpoint.
    // Without redirect:manual on the second fetch, Node fetch would silently
    // follow this, defeating the first-hop SSRF allowlist.
    let n = 0;
    let secondInit: RequestInit | undefined;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async (_url, init) => {
        n++;
        if (n === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/bucket/signed' },
          });
        }
        if (n === 2) {
          secondInit = init;
          return new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          });
        }
        return new Response('leaked', { status: 200 });
      }),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringMatching(/redirect|SSRF/i),
    });
    expect(n).toBe(2); // must NOT have made a third hop to 169.254.x
    expect(secondInit?.redirect).toBe('manual');
  });

  test('additionalAllowedHosts accepts extra comma-separated hosts', async () => {
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      additionalAllowedHosts: ['extra.com'],
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://extra.com/blob' },
          });
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }),
    });
    const res = await client.download('x.bin');
    expect(res.url).toContain('extra.com');
  });

  test('default allowlist accepts cloud.comfy.org / googleapis.com / amazonaws.com / r2.cloudflarestorage.com', async () => {
    const hosts = [
      'cloud.comfy.org',
      'storage.googleapis.com',
      's3.amazonaws.com',
      'comfy-xyz.r2.cloudflarestorage.com',
    ];
    for (const h of hosts) {
      let n = 0;
      const client = new ComfyUIClient(KEY, BASE, {
        fetchImpl: mockFetch(async () => {
          if (++n === 1)
            return new Response(null, {
              status: 302,
              headers: { location: `https://${h}/blob` },
            });
          return new Response(new Uint8Array([1]), {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          });
        }),
      });
      const res = await client.download('x.bin');
      expect(res.url).toContain(h);
    }
  });

  test('IS-01: regex-metachar admin typo in additionalAllowedHosts does NOT broaden the allowlist', async () => {
    // `foo|.*` with naive-regex escaping would compile to /^foo|.*$/ and match
    // every hostname because the alternation promotes `.*` to the top level.
    // With literal string matching this is just a nonsense hostname that matches
    // nothing, and the redirect must be rejected.
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      additionalAllowedHosts: ['foo|.*'],
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example.com/steal' },
          });
        return new Response('leaked', { status: 200 });
      }),
    });
    await expect(client.download('x.bin')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('Unexpected redirect host'),
    });
    expect(n).toBe(1); // never made the second hop
  });

  test('IS-01: additionalAllowedHosts exact + suffix match (not parent-domain, not other-domain)', async () => {
    // Exact match succeeds
    {
      let n = 0;
      const client = new ComfyUIClient(KEY, BASE, {
        additionalAllowedHosts: ['tenant.example.com'],
        fetchImpl: mockFetch(async () => {
          if (++n === 1)
            return new Response(null, {
              status: 302,
              headers: { location: 'https://tenant.example.com/blob' },
            });
          return new Response(new Uint8Array([1]), {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          });
        }),
      });
      const r = await client.download('ok.bin');
      expect(r.url).toContain('tenant.example.com');
    }
    // Suffix match succeeds: sub.tenant.example.com
    {
      let n = 0;
      const client = new ComfyUIClient(KEY, BASE, {
        additionalAllowedHosts: ['tenant.example.com'],
        fetchImpl: mockFetch(async () => {
          if (++n === 1)
            return new Response(null, {
              status: 302,
              headers: { location: 'https://sub.tenant.example.com/blob' },
            });
          return new Response(new Uint8Array([1]), {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          });
        }),
      });
      const r = await client.download('ok2.bin');
      expect(r.url).toContain('sub.tenant.example.com');
    }
    // Parent-domain must NOT be allowed (tenant.example.com does not admit example.com)
    {
      let n = 0;
      const client = new ComfyUIClient(KEY, BASE, {
        additionalAllowedHosts: ['tenant.example.com'],
        fetchImpl: mockFetch(async () => {
          if (++n === 1)
            return new Response(null, {
              status: 302,
              headers: { location: 'https://example.com/blob' },
            });
          return new Response('leaked', { status: 200 });
        }),
      });
      await expect(client.download('bad.bin')).rejects.toMatchObject({
        code: 'COMFYUI_API_ERROR',
        message: expect.stringContaining('Unexpected redirect host'),
      });
    }
    // Different domain must NOT be allowed
    {
      let n = 0;
      const client = new ComfyUIClient(KEY, BASE, {
        additionalAllowedHosts: ['tenant.example.com'],
        fetchImpl: mockFetch(async () => {
          if (++n === 1)
            return new Response(null, {
              status: 302,
              headers: { location: 'https://evil.com/blob' },
            });
          return new Response('leaked', { status: 200 });
        }),
      });
      await expect(client.download('bad2.bin')).rejects.toMatchObject({
        code: 'COMFYUI_API_ERROR',
      });
    }
  });
});

describe('ComfyUIClient.downloadToPath (temp-then-rename)', () => {
  test('streams to {dest}.partial and renames on success', async () => {
    // Use a real temp dir + real fs — test the atomic-rename contract end-to-end.
    const os = await import('node:os');
    const pth = await import('node:path');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), 'vfx-client-'));
    const dest = pth.join(tmp, 'x.png');

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/x.png' },
          });
        return new Response(bytes, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(bytes.byteLength),
          },
        });
      }),
    });
    const out = await client.downloadToPath('x.png', {}, dest);
    expect(out.path).toBe(dest);
    expect(out.sizeBytes).toBe(bytes.byteLength);
    const onDisk = await fsp.readFile(dest);
    expect(onDisk.byteLength).toBe(bytes.byteLength);
    // Partial file should be gone
    await expect(fsp.access(dest + '.partial')).rejects.toThrow();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test('IS-03: downloadToPath rejects when content-length exceeds maxBytes (pre-flight)', async () => {
    const os = await import('node:os');
    const pth = await import('node:path');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), 'vfx-client-maxbytes-'));
    const dest = pth.join(tmp, 'big.png');

    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/big.png' },
          });
        // Advertise 1 MB — cap will be set to 100 bytes.
        return new Response(new Uint8Array(0), {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(1 * 1024 * 1024),
          },
        });
      }),
    });
    await expect(
      client.downloadToPath('big.png', {}, dest, { maxBytes: 100 }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'DOWNLOAD_FAILED',
      message: expect.stringContaining('exceeds max'),
    });
    // No partial file should remain
    await expect(fsp.access(dest + '.partial')).rejects.toThrow();
    await expect(fsp.access(dest)).rejects.toThrow();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test('IS-03: downloadToPath aborts mid-stream when actual bytes exceed maxBytes', async () => {
    const os = await import('node:os');
    const pth = await import('node:path');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), 'vfx-client-mid-'));
    const dest = pth.join(tmp, 'midstream.bin');

    // No content-length advertised; body sends 1024 bytes but maxBytes=100.
    const body = new Uint8Array(1024).fill(0xaa);
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/midstream.bin' },
          });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }),
    });
    await expect(
      client.downloadToPath('midstream.bin', {}, dest, { maxBytes: 100 }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'DOWNLOAD_FAILED',
    });
    await expect(fsp.access(dest)).rejects.toThrow();
    await expect(fsp.access(dest + '.partial')).rejects.toThrow();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test('IP-03: non-writable destination path is caught and no .partial leaks', async () => {
    const os = await import('node:os');
    const pth = await import('node:path');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), 'vfx-client-ip03-'));
    // Make a path whose parent IS a file (not a directory) so createWriteStream
    // throws synchronously with ENOTDIR/EEXIST before any bytes are written.
    // This exercises the pre-pipe error path that the fix guards against.
    const dataFile = pth.join(tmp, 'blocker');
    await fsp.writeFile(dataFile, 'blocker');
    const dest = pth.join(dataFile, 'nested', 'x.png'); // parent is a regular file
    const bytes = new Uint8Array([1, 2, 3]);
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/x.png' },
          });
        return new Response(bytes, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(bytes.byteLength),
          },
        });
      }),
    });
    await expect(client.downloadToPath('x.png', {}, dest)).rejects.toMatchObject({
      name: 'TypedError',
      code: 'DOWNLOAD_FAILED',
    });
    // No partial file leaked
    await expect(fsp.access(dest + '.partial')).rejects.toThrow();
    await expect(fsp.access(dest)).rejects.toThrow();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test('IT-01: signed-URL 5xx before stream starts → COMFYUI_API_ERROR (not DOWNLOAD_FAILED), no partial file leaks', async () => {
    // The signed-URL fetch returns 500 — `download()` itself throws
    // COMFYUI_API_ERROR before `downloadToPath` reaches the pipeline, so the
    // typed error code here is COMFYUI_API_ERROR (not DOWNLOAD_FAILED). The
    // earlier title misled readers.
    const os = await import('node:os');
    const pth = await import('node:path');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), 'vfx-client-fail-'));
    const dest = pth.join(tmp, 'x.png');

    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/x.png' },
          });
        return new Response('server error', { status: 500, statusText: 'Internal' });
      }),
    });
    await expect(client.downloadToPath('x.png', {}, dest)).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
    });
    await expect(fsp.access(dest)).rejects.toThrow();
    await expect(fsp.access(dest + '.partial')).rejects.toThrow();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test('IT-01b: stream mid-pipe error → DOWNLOAD_FAILED with partial cleanup', async () => {
    // This time the pipe DOES start. The body emits a chunk, then errors mid
    // stream (reader.cancel() → Readable.fromWeb emits an 'error'). streamToPath
    // must unlink the partial and surface DOWNLOAD_FAILED.
    const os = await import('node:os');
    const pth = await import('node:path');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), 'vfx-client-midpipe-'));
    const dest = pth.join(tmp, 'midpipe.bin');

    // Construct a ReadableStream that emits 1 chunk and then errors.
    function boomStream(): ReadableStream<Uint8Array> {
      let emitted = false;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!emitted) {
            emitted = true;
            controller.enqueue(new Uint8Array([1, 2, 3, 4]));
            // Error after the first enqueue so the pipeline has started.
            controller.error(new Error('mid-pipe boom'));
            return;
          }
        },
      });
    }

    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/midpipe.bin' },
          });
        return new Response(boomStream(), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }),
    });
    await expect(client.downloadToPath('midpipe.bin', {}, dest)).rejects.toMatchObject({
      name: 'TypedError',
      code: 'DOWNLOAD_FAILED',
    });
    await expect(fsp.access(dest)).rejects.toThrow();
    await expect(fsp.access(dest + '.partial')).rejects.toThrow();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test('IT-02: submit network error (fetch throws TypeError) → COMFYUI_API_ERROR', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        throw new TypeError('fetch failed: ECONNREFUSED');
      }),
    });
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('network error'),
    });
  });

  test('IT-02b: status network error (fetch throws TypeError) → COMFYUI_API_ERROR', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        throw new TypeError('fetch failed: timeout');
      }),
    });
    await expect(client.status('job-1')).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('network error'),
    });
  });

  test('IT-03: submit 200 without prompt_id → COMFYUI_API_ERROR', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => jsonResponse(200, { not_a_prompt_id: 'xyz' })),
    });
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('missing prompt_id'),
    });
  });

  test('IT-04: /api/view redirect with missing Location → COMFYUI_API_ERROR', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => new Response(null, { status: 302 })),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('no Location'),
    });
  });

  test('IT-04b: /api/view redirect with invalid Location URL → COMFYUI_API_ERROR', async () => {
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(
        async () => new Response(null, { status: 302, headers: { location: 'not a url' } }),
      ),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('Invalid redirect Location'),
    });
  });

  test('IT-05: signed-URL 403 → COMFYUI_API_ERROR with signed-URL prefix', async () => {
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/x.png' },
          });
        return new Response('forbidden', { status: 403, statusText: 'Forbidden' });
      }),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('Signed URL fetch failed'),
    });
  });

  test('IT-05b: signed-URL 404 → COMFYUI_API_ERROR with signed-URL prefix', async () => {
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/x.png' },
          });
        return new Response('not found', { status: 404, statusText: 'Not Found' });
      }),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('Signed URL fetch failed'),
    });
  });

  test('IT-06: download with missing content-length falls back to streamed byte count', async () => {
    const os = await import('node:os');
    const pth = await import('node:path');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), 'vfx-client-noclen-'));
    const dest = pth.join(tmp, 'noclen.bin');

    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://storage.googleapis.com/comfy-fake/noclen.bin' },
          });
        // NO content-length header.
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }),
    });
    const out = await client.downloadToPath('noclen.bin', {}, dest);
    expect(out.sizeBytes).toBe(bytes.byteLength);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test.each([
    ['http://127.0.0.1/metadata', '127.0.0.1'],
    ['http://169.254.169.254/latest/meta-data/', '169.254.169.254'],
    ['http://localhost/admin', 'localhost'],
    ['http://10.0.0.1/steal', '10.0.0.1'],
    ['http://[::1]/internal', '::1'],
    ['https://cloud.comfy.org.evil.com/steal', 'cloud.comfy.org.evil.com'],
    ['https://googleapiscom.evil.com/steal', 'googleapiscom.evil.com'],
  ])('IT-07: SSRF hostile redirect target %s is rejected', async (target, expectedHost) => {
    let n = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, { status: 302, headers: { location: target } });
        return new Response('leaked', { status: 200 });
      }),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining(expectedHost),
    });
    expect(n).toBe(1); // must NOT have made the second hop
  });

  test('IT-08: BASE-origin host is auto-included in the allowlist (tenant-specific self-hosted)', async () => {
    // Tenant base like https://tenant.example.com — the configured origin
    // host must be accepted on 302 without requiring additionalAllowedHosts.
    const tenantBase = 'https://tenant.example.com';
    let n = 0;
    const client = new ComfyUIClient(KEY, tenantBase, {
      fetchImpl: mockFetch(async () => {
        if (++n === 1)
          return new Response(null, {
            status: 302,
            headers: { location: `${tenantBase}/signed/file.png` },
          });
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }),
    });
    const out = await client.download('file.png');
    expect(out.url).toContain('tenant.example.com');
  });
});

describe('ComfyUIClient.fetchResolvedPrompt (D-PROV-05)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fetch-prompt-${nanoid(6)}-`));
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Build a minimal valid PNG with a tEXt chunk carrying (key, value).
   * CRC is zeroed — png-metadata.ts does NOT validate CRC (per extractTextChunk
   * comment: ComfyUI writes correct CRCs, and strict CRC checking would make
   * the parser intolerant of otherwise-valid test fixtures).
   */
  function buildPngWithTextChunk(key: string, value: string): Buffer {
    const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const typeBuf = Buffer.from('tEXt', 'latin1');
    const keyBuf = Buffer.from(key, 'latin1');
    const nullSep = Buffer.from([0x00]);
    const valueBuf = Buffer.from(value, 'utf8');
    const data = Buffer.concat([keyBuf, nullSep, valueBuf]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(0, 0);
    const chunk = Buffer.concat([length, typeBuf, data, crc]);
    const iendLen = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const iendType = Buffer.from('IEND', 'latin1');
    const iendCrc = Buffer.from([0xae, 0x42, 0x60, 0x82]);
    const iend = Buffer.concat([iendLen, iendType, iendCrc]);
    return Buffer.concat([magic, chunk, iend]);
  }

  test('valid PNG with valid JSON prompt chunk → returns parsed object', async () => {
    const blob = { '3': { class_type: 'KSampler', inputs: { seed: 42 } } };
    const png = buildPngWithTextChunk('prompt', JSON.stringify(blob));
    const pngPath = pth.join(tempDir, 'out.png');
    await fsp.writeFile(pngPath, png);
    const client = new ComfyUIClient(KEY, BASE);
    const result = await client.fetchResolvedPrompt(pngPath);
    expect(result).toEqual(blob);
  });

  test('PNG missing prompt chunk → returns null', async () => {
    const png = buildPngWithTextChunk('workflow', '{}');
    const pngPath = pth.join(tempDir, 'out.png');
    await fsp.writeFile(pngPath, png);
    const client = new ComfyUIClient(KEY, BASE);
    const result = await client.fetchResolvedPrompt(pngPath);
    expect(result).toBeNull();
  });

  test('PNG with malformed JSON in prompt chunk → returns null', async () => {
    const png = buildPngWithTextChunk('prompt', 'not-json{');
    const pngPath = pth.join(tempDir, 'out.png');
    await fsp.writeFile(pngPath, png);
    const client = new ComfyUIClient(KEY, BASE);
    const result = await client.fetchResolvedPrompt(pngPath);
    expect(result).toBeNull();
  });

  test('prompt chunk JSON is an array (not object) → returns null', async () => {
    const png = buildPngWithTextChunk('prompt', '[1,2,3]');
    const pngPath = pth.join(tempDir, 'out.png');
    await fsp.writeFile(pngPath, png);
    const client = new ComfyUIClient(KEY, BASE);
    const result = await client.fetchResolvedPrompt(pngPath);
    expect(result).toBeNull();
  });

  test('file does not exist → returns null (never throws)', async () => {
    const client = new ComfyUIClient(KEY, BASE);
    const result = await client.fetchResolvedPrompt(pth.join(tempDir, 'missing.png'));
    expect(result).toBeNull();
  });

  test('non-PNG file (bad magic) → returns null', async () => {
    const bogus = Buffer.from('not a png at all');
    const pngPath = pth.join(tempDir, 'bogus.png');
    await fsp.writeFile(pngPath, bogus);
    const client = new ComfyUIClient(KEY, BASE);
    const result = await client.fetchResolvedPrompt(pngPath);
    expect(result).toBeNull();
  });

  test('NO network I/O — fetchImpl is never called', async () => {
    let fetchCalls = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetch(async () => {
        fetchCalls++;
        return jsonResponse(200, {});
      }),
    });
    const pngPath = pth.join(tempDir, 'missing.png');
    await client.fetchResolvedPrompt(pngPath);
    expect(fetchCalls).toBe(0);
  });
});

describe('ComfyUIClient.ensureEndpointHealthy (D-EP-07, D-EP-08, D-EP-10)', () => {
  test('first-submit healthcheck fires exactly once; second submit skips it (cache hit)', async () => {
    let healthGets = 0;
    let promptPosts = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetchRaw(async (url, init) => {
        const u = new URL(url.toString());
        if (u.pathname === HEALTHCHECK_PATH && (init?.method ?? 'GET') === 'GET') {
          healthGets++;
          return jsonResponse(200, { queue_running: [], queue_pending: [] });
        }
        if (u.pathname === '/api/prompt' && init?.method === 'POST') {
          promptPosts++;
          return jsonResponse(200, { prompt_id: `p-${promptPosts}` });
        }
        throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${u.pathname}`);
      }),
    });

    const r1 = await client.submit({ '1': { class_type: 'A', inputs: {} } });
    const r2 = await client.submit({ '2': { class_type: 'B', inputs: {} } });

    expect(r1.prompt_id).toBe('p-1');
    expect(r2.prompt_id).toBe('p-2');
    expect(healthGets).toBe(1); // D-EP-07: cached after first success
    expect(promptPosts).toBe(2); // Both submits proceeded
  });

  test('healthcheck 401 throws COMFYUI_ENDPOINT_DRIFT with probe-script hint; /api/prompt never called', async () => {
    let healthGets = 0;
    let promptPosts = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetchRaw(async (url, init) => {
        const u = new URL(url.toString());
        if (u.pathname === HEALTHCHECK_PATH && (init?.method ?? 'GET') === 'GET') {
          healthGets++;
          return jsonResponse(401, { error: 'Unauthorized' });
        }
        if (u.pathname === '/api/prompt') promptPosts++;
        return jsonResponse(200, { prompt_id: 'should-not-be-called' });
      }),
    });

    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'COMFYUI_ENDPOINT_DRIFT',
    });

    expect(healthGets).toBe(1);
    expect(promptPosts).toBe(0); // Submit short-circuited on healthcheck

    // Capture the hint to verify probe-script reference (D-EP-08).
    try {
      await client.submit({ '1': { class_type: 'A', inputs: {} } });
    } catch (e) {
      const err = e as { hint?: string };
      expect(err.hint).toContain('scripts/probe-comfy-endpoint.mts');
    }
  });

  test('concurrent submits share one in-flight healthcheck Promise (race-safe memoization, D-EP-10)', async () => {
    let healthGets = 0;
    let promptPosts = 0;
    let resolveHealth: ((value: Response) => void) | undefined;
    const healthPromise = new Promise<Response>((r) => {
      resolveHealth = r;
    });

    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetchRaw(async (url) => {
        const u = new URL(url.toString());
        if (u.pathname === HEALTHCHECK_PATH) {
          healthGets++;
          return healthPromise;
        }
        if (u.pathname === '/api/prompt') {
          promptPosts++;
          return jsonResponse(200, { prompt_id: `p-${promptPosts}` });
        }
        throw new Error(`Unexpected fetch: ${u.pathname}`);
      }),
    });

    // Kick off two submits concurrently BEFORE resolving the healthcheck.
    const p1 = client.submit({ '1': { class_type: 'A', inputs: {} } });
    const p2 = client.submit({ '2': { class_type: 'B', inputs: {} } });

    // Give the event loop a tick so both submits reach the await inside
    // ensureEndpointHealthy.
    await new Promise((r) => setTimeout(r, 5));
    expect(healthGets).toBe(1); // Both submits awaiting the same Promise

    // Resolve the healthcheck; both submits should then proceed.
    resolveHealth!(jsonResponse(200, { queue_running: [] }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.prompt_id).toMatch(/^p-/);
    expect(r2.prompt_id).toMatch(/^p-/);
    expect(healthGets).toBe(1); // Confirmed — never a second GET
    expect(promptPosts).toBe(2);
  });

  test('failed healthcheck does not poison cache; next submit retries cleanly (Pitfall #2)', async () => {
    let healthGets = 0;
    let promptPosts = 0;
    const client = new ComfyUIClient(KEY, BASE, {
      fetchImpl: mockFetchRaw(async (url) => {
        const u = new URL(url.toString());
        if (u.pathname === HEALTHCHECK_PATH) {
          healthGets++;
          // First call: drift. Second call: recovered.
          if (healthGets === 1) return jsonResponse(401, { error: 'Unauthorized' });
          return jsonResponse(200, { queue_running: [] });
        }
        if (u.pathname === '/api/prompt') {
          promptPosts++;
          return jsonResponse(200, { prompt_id: 'recovered' });
        }
        throw new Error(`Unexpected fetch: ${u.pathname}`);
      }),
    });

    // First submit — healthcheck 401 → DRIFT
    await expect(
      client.submit({ '1': { class_type: 'A', inputs: {} } }),
    ).rejects.toMatchObject({ code: 'COMFYUI_ENDPOINT_DRIFT' });
    expect(healthGets).toBe(1);
    expect(promptPosts).toBe(0);

    // Second submit — healthcheck retries (cache was reset), returns 200,
    // submit proceeds.
    const r = await client.submit({ '1': { class_type: 'A', inputs: {} } });
    expect(r.prompt_id).toBe('recovered');
    expect(healthGets).toBe(2); // Fresh check on second submit (cache not poisoned)
    expect(promptPosts).toBe(1);
  });
});
