import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertIngestUrlAllowed,
  ingestDownloadToPath,
  DEFAULT_INGEST_ALLOWED_HOSTS,
} from '../ingest.js';

const HOSTS = DEFAULT_INGEST_ALLOWED_HOSTS;

function mockFetch(handler: (url: URL) => Response): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = input instanceof URL ? input : new URL(String(input));
    return handler(url);
  }) as unknown as typeof fetch;
}

describe('assertIngestUrlAllowed (trust boundary)', () => {
  test('accepts an allowlisted https host (exact + subdomain)', () => {
    expect(() => assertIngestUrlAllowed('https://replicate.delivery/x/o.png', HOSTS)).not.toThrow();
    expect(() => assertIngestUrlAllowed('https://pbxt.replicate.delivery/x/o.png', HOSTS)).not.toThrow();
  });

  test('rejects non-https', () => {
    expect(() => assertIngestUrlAllowed('http://replicate.delivery/o.png', HOSTS)).toThrowError(/non-https/);
  });

  test('rejects a non-allowlisted host', () => {
    expect(() => assertIngestUrlAllowed('https://evil.example.com/o.png', HOSTS)).toThrowError(/not allowlisted/);
  });

  test('rejects a garbage URL', () => {
    expect(() => assertIngestUrlAllowed('not a url', HOSTS)).toThrowError(/valid output URL/);
  });

  test('honours operator-supplied extra hosts', () => {
    expect(() => assertIngestUrlAllowed('https://cdn.mine.io/o.png', [...HOSTS, 'mine.io'])).not.toThrow();
  });
});

describe('ingestDownloadToPath', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vellum-ingest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('streams an allowlisted output to disk with metadata', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const fetchImpl = mockFetch(
      () =>
        new Response(bytes, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '3' } }),
    );
    const dest = join(dir, 'o.png');
    const r = await ingestDownloadToPath('https://replicate.delivery/x/o.png', dest, {
      allowedHosts: HOSTS,
      fetchImpl,
    });
    expect(r.contentType).toBe('image/png');
    expect(r.sizeBytes).toBe(3);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest)).toEqual(Buffer.from(bytes));
  });

  test('rejects a non-allowlisted host before fetching', async () => {
    let called = false;
    const fetchImpl = mockFetch(() => {
      called = true;
      return new Response('x');
    });
    await expect(
      ingestDownloadToPath('https://evil.example.com/o.png', join(dir, 'o.png'), { allowedHosts: HOSTS, fetchImpl }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    expect(called).toBe(false);
  });

  test('rejects when content-length exceeds the cap', async () => {
    const fetchImpl = mockFetch(
      () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-length': '999999' } }),
    );
    await expect(
      ingestDownloadToPath('https://replicate.delivery/x/o.png', join(dir, 'o.png'), {
        allowedHosts: HOSTS,
        maxBytes: 10,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });

  test('rejects an unexpected redirect (SSRF)', async () => {
    const fetchImpl = mockFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://evil/' } }),
    );
    await expect(
      ingestDownloadToPath('https://replicate.delivery/x/o.png', join(dir, 'o.png'), {
        allowedHosts: HOSTS,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });
});
