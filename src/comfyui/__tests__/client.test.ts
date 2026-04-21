import { describe, test, expect } from 'vitest';
import {
  ComfyUIClient,
  DEFAULT_COMFYUI_API_BASE,
  MAX_ERROR_BODY_BYTES,
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
 */

function mockFetch(
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
  test('POST /api/prompt with X-API-Key and {prompt: workflow} body returns {prompt_id}', async () => {
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
    expect(body).toEqual({ prompt: { '1': { class_type: 'KSampler', inputs: {} } } });
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
  test('GET /api/job/{id}/status returns normalised StatusResponse', async () => {
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
    expect(u.pathname).toBe('/api/job/job-1/status');
    expect((capturedInit!.headers as Record<string, string>)['X-API-Key']).toBe(KEY);
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

  test('signed-URL fetch failure unlinks partial and throws DOWNLOAD_FAILED', async () => {
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
        // signed-URL fetch returns 500 — download() itself throws COMFYUI_API_ERROR
        // so downloadToPath's stream pipeline never starts. But the partial file
        // is never created, so the assertion is no-partial-exists.
        return new Response('server error', { status: 500, statusText: 'Internal' });
      }),
    });
    await expect(client.downloadToPath('x.png', {}, dest)).rejects.toMatchObject({
      name: 'TypedError',
    });
    await expect(fsp.access(dest)).rejects.toThrow();
    await expect(fsp.access(dest + '.partial')).rejects.toThrow();
    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
