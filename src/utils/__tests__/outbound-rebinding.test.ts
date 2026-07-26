// src/utils/__tests__/outbound-rebinding.test.ts
//
// Regression suite for the OUTBOUND private-address guard, wired at every place
// the server fetches a URL it did not fully choose itself:
//
//   1. the URL-provider download path  (Replicate / FAL / BytePlus)
//   2. the ingest path                 (agent- or webhook-supplied output URLs)
//   3. the ComfyUI signed-URL 2nd hop  (302 target off an allowlisted host)
//
// Each of those already had a host ALLOWLIST. An allowlist answers "do we trust
// this name?" — it says nothing about where the name points. DNS rebinding walks
// straight through it: an allowlisted delivery host (or one an operator was
// talked into adding) resolves to 169.254.169.254 or 127.0.0.1, the server
// fetches it, and the response is persisted as a version's asset. Cloud instance
// credentials become a provenance record.
//
// These tests assert the address check runs on all three paths, refuses on ANY
// private answer, and — critically — that it is NOT skipped when a fake `fetch`
// is injected. `forbiddenLookup` pins the ordering guarantee: a host rejected by
// name must never cost a DNS query.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReplicateAdapter, DEFAULT_REPLICATE_API_BASE } from '../../providers/replicate-adapter.js';
import { FalAdapter, DEFAULT_FAL_API_BASE } from '../../providers/fal-adapter.js';
import { ByteplusAdapter, DEFAULT_BYTEPLUS_API_BASE } from '../../providers/byteplus-adapter.js';
import { ComfyUIClient } from '../../comfyui/client.js';
import { ingestDownloadToPath, DEFAULT_INGEST_ALLOWED_HOSTS } from '../../engine/ingest.js';
import {
  publicLookup,
  rebindingLookup,
  mixedLookup,
  forbiddenLookup,
  countingLookup,
} from '../../test-utils/fake-dns.js';

/** Addresses a public delivery host has no business resolving to. */
const INWARD = [
  ['cloud metadata (link-local)', '169.254.169.254'],
  ['loopback', '127.0.0.1'],
  ['RFC1918 10/8', '10.0.0.5'],
  ['RFC1918 192.168/16', '192.168.1.1'],
  ['RFC1918 172.16/12', '172.20.3.4'],
  ['CGNAT', '100.100.0.1'],
  ['IPv6 loopback', '::1'],
  ['IPv6 unique-local', 'fd00::1'],
  ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
] as const;

/** A fetch that fails the test if it is ever reached. */
function neverFetch(): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    throw new Error(`fetch must not happen for ${String(input)}`);
  }) as unknown as typeof fetch;
}

/** A fetch that would happily serve bytes — proves the guard, not the mock, refuses. */
function servingFetch(): typeof fetch {
  return (async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
    })) as unknown as typeof fetch;
}

describe('outbound SSRF: allowlisted host resolving to a private address', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vellum-rebind-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('URL-provider download path', () => {
    for (const [label, address] of INWARD) {
      test(`Replicate refuses replicate.delivery → ${label} (${address})`, async () => {
        const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
          fetchImpl: servingFetch(),
          lookupImpl: rebindingLookup(address),
        });
        const dest = join(dir, 'out.png');
        await expect(
          a.downloadToPath('out.png', { type: 'https://replicate.delivery/x/out.png' }, dest),
        ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
        expect(existsSync(dest)).toBe(false);
      });
    }

    test('FAL refuses fal.media → 169.254.169.254', async () => {
      const a = new FalAdapter('fal_key_1234', DEFAULT_FAL_API_BASE, {
        fetchImpl: servingFetch(),
        lookupImpl: rebindingLookup('169.254.169.254'),
      });
      await expect(
        a.downloadToPath('o.png', { type: 'https://fal.media/files/o.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('BytePlus refuses a tos delivery subdomain → 127.0.0.1', async () => {
      const a = new ByteplusAdapter('ark_key_1234', DEFAULT_BYTEPLUS_API_BASE, {
        fetchImpl: servingFetch(),
        lookupImpl: rebindingLookup('127.0.0.1'),
      });
      await expect(
        a.downloadToPath('v.mp4', { type: 'https://tos-x.bytepluses.com/v.mp4' }, join(dir, 'v.mp4')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('refuses when only ONE of several answers is private', async () => {
      // Which address the connection picks is not ours to choose, so any private
      // answer must sink the whole fetch.
      const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: servingFetch(),
        lookupImpl: mixedLookup('169.254.169.254'),
      });
      await expect(
        a.downloadToPath('o.png', { type: 'https://replicate.delivery/x/o.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('a literal private IP in the URL is refused without any lookup', async () => {
      // Message-matched, not just code-matched: a bare DOWNLOAD_FAILED would also
      // be produced by `neverFetch` throwing, so this test would pass against
      // unguarded code for entirely the wrong reason.
      const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: neverFetch(),
        lookupImpl: forbiddenLookup,
        additionalAllowedHosts: ['169.254.169.254'],
      });
      await expect(
        a.downloadToPath('o.png', { type: 'https://169.254.169.254/latest/meta-data/' }, join(dir, 'o')),
      ).rejects.toMatchObject({
        code: 'DOWNLOAD_FAILED',
        message: expect.stringContaining('private address'),
      });
    });

    test('a non-allowlisted host is rejected by NAME, before any DNS query', async () => {
      // `forbiddenLookup` throws if reached, so this pins the ordering: the name
      // check must come first and short-circuit. Message-matched for the same
      // reason as above.
      const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: neverFetch(),
        lookupImpl: forbiddenLookup,
      });
      await expect(
        a.downloadToPath('o.png', { type: 'https://evil.example.com/o.png' }, join(dir, 'o.png')),
      ).rejects.toMatchObject({
        code: 'DOWNLOAD_FAILED',
        message: expect.stringContaining('not allowlisted'),
      });
    });

    test('a public answer still downloads — the guard is not just refusing everything', async () => {
      const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
        fetchImpl: servingFetch(),
        lookupImpl: publicLookup,
      });
      const dest = join(dir, 'ok.png');
      const r = await a.downloadToPath('ok.png', { type: 'https://replicate.delivery/x/ok.png' }, dest);
      expect(r.path).toBe(dest);
      expect(existsSync(dest)).toBe(true);
    });
  });

  describe('ingest path', () => {
    test('refuses an allowlisted ingest host that resolves to cloud metadata', async () => {
      const dest = join(dir, 'i.png');
      await expect(
        ingestDownloadToPath('https://replicate.delivery/x/i.png', dest, {
          allowedHosts: DEFAULT_INGEST_ALLOWED_HOSTS,
          fetchImpl: servingFetch(),
          lookupImpl: rebindingLookup('169.254.169.254'),
        }),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
      expect(existsSync(dest)).toBe(false);
    });

    test('refuses an operator-added host that resolves into RFC1918', async () => {
      // The realistic version: an operator is talked into adding a host to
      // VELLUM_INGEST_ALLOWED_HOSTS, and that host points at the internal network.
      await expect(
        ingestDownloadToPath('https://mirror.partner.example/o.png', join(dir, 'o.png'), {
          allowedHosts: [...DEFAULT_INGEST_ALLOWED_HOSTS, 'partner.example'],
          fetchImpl: servingFetch(),
          lookupImpl: rebindingLookup('10.1.2.3'),
        }),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    });

    test('a public answer still ingests', async () => {
      const dest = join(dir, 'ok.bin');
      const r = await ingestDownloadToPath('https://fal.media/files/ok.bin', dest, {
        allowedHosts: DEFAULT_INGEST_ALLOWED_HOSTS,
        fetchImpl: servingFetch(),
        lookupImpl: publicLookup,
      });
      expect(r.path).toBe(dest);
      expect(existsSync(dest)).toBe(true);
    });
  });

  describe('ComfyUI signed-URL second hop', () => {
    const KEY = 'ck_test_key_1234';
    const BASE = 'https://api.comfy.test';

    /** First hop 302s to `location`; a second hop would serve bytes. */
    function redirectingFetch(location: string, counter: { n: number }): typeof fetch {
      return (async () => {
        counter.n += 1;
        if (counter.n === 1) return new Response(null, { status: 302, headers: { location } });
        return new Response(new Uint8Array([9]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '1' },
        });
      }) as unknown as typeof fetch;
    }

    test('refuses a 302 to an allowlisted host that resolves to loopback', async () => {
      const counter = { n: 0 };
      const client = new ComfyUIClient(KEY, BASE, {
        fetchImpl: redirectingFetch('https://storage.googleapis.com/bucket/x.png', counter),
        lookupImpl: rebindingLookup('127.0.0.1'),
      });
      await expect(client.download('x.png')).rejects.toMatchObject({ code: 'COMFYUI_API_ERROR' });
      expect(counter.n).toBe(1); // never made the second hop
    });

    test('refuses a 302 to an operator-added host that resolves to cloud metadata', async () => {
      const counter = { n: 0 };
      const client = new ComfyUIClient(KEY, BASE, {
        additionalAllowedHosts: ['mirror.example'],
        fetchImpl: redirectingFetch('https://mirror.example/signed/x.png', counter),
        lookupImpl: rebindingLookup('169.254.169.254'),
      });
      await expect(client.download('x.png')).rejects.toMatchObject({ code: 'COMFYUI_API_ERROR' });
      expect(counter.n).toBe(1);
    });

    test('a public answer still completes the second hop', async () => {
      const counter = { n: 0 };
      const client = new ComfyUIClient(KEY, BASE, {
        fetchImpl: redirectingFetch('https://storage.googleapis.com/bucket/x.png', counter),
        lookupImpl: publicLookup,
      });
      const res = await client.download('x.png');
      expect(res.url).toContain('storage.googleapis.com');
      expect(counter.n).toBe(2);
    });
  });

  describe('the guard cannot be disabled by injecting a fake fetch', () => {
    test('a fake fetch that would serve metadata is still never reached', async () => {
      // The tempting shortcut is "skip the DNS check when fetchImpl is injected,
      // so tests stay fast". That leaves a security control that does nothing in
      // production the moment anyone injects a client. This asserts the opposite:
      // a fully-functional fake fetch, and the guard still refuses first.
      let fetched = false;
      const fetchImpl = (async () => {
        fetched = true;
        return new Response('ami-id\ninstance-id\niam/', { status: 200 });
      }) as unknown as typeof fetch;

      const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
        fetchImpl,
        lookupImpl: rebindingLookup('169.254.169.254'),
      });
      await expect(
        a.downloadToPath('o', { type: 'https://replicate.delivery/latest/meta-data/' }, join(dir, 'o')),
      ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
      expect(fetched).toBe(false);
    });
  });
});

describe('outbound SSRF: the signed-URL redirect must not downgrade to plaintext', () => {
  // REGRESSION. guardedStreamDownload and ingestDownloadToPath both refuse
  // anything but https. ComfyUIClient.download checked the redirect target's
  // HOST and (since the rebinding fix) its resolved ADDRESS — but never its
  // PROTOCOL. So a 302 to http:// on an allowlisted host was followed in
  // cleartext: the signed URL and the asset went over the wire in the open, and
  // a network attacker could substitute the bytes that are then persisted and
  // signed as provenance. SECURITY.md's "https only" claim was false here.
  const KEY = 'ck_test_key_1234';

  function redirectingTo(location: string, counter: { n: number }): typeof fetch {
    return (async () => {
      counter.n += 1;
      if (counter.n === 1) return new Response(null, { status: 302, headers: { location } });
      return new Response(new Uint8Array([9]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '1' },
      });
    }) as unknown as typeof fetch;
  }

  test('refuses a 302 to http:// on an otherwise allowlisted host', async () => {
    const counter = { n: 0 };
    const client = new ComfyUIClient(KEY, 'https://api.comfy.test', {
      fetchImpl: redirectingTo('http://storage.googleapis.com/bucket/x.png', counter),
      lookupImpl: publicLookup,
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('non-https'),
    });
    expect(counter.n).toBe(1); // never made the plaintext hop
  });

  test('refuses other non-https schemes too', async () => {
    for (const location of ['ftp://storage.googleapis.com/x.png', 'file:///etc/passwd']) {
      const counter = { n: 0 };
      const client = new ComfyUIClient(KEY, 'https://api.comfy.test', {
        fetchImpl: redirectingTo(location, counter),
        lookupImpl: publicLookup,
      });
      await expect(client.download('x.png'), location).rejects.toMatchObject({
        code: 'COMFYUI_API_ERROR',
      });
      expect(counter.n, location).toBe(1);
    }
  });

  test('a self-hosted plaintext instance may still redirect to itself', async () => {
    // The one legitimate plaintext case: an operator who set
    // COMFYUI_API_BASE_ALLOW_HTTP=1 for a local instance, which then serves its
    // own outputs. Same origin as the base, and nothing wider.
    const counter = { n: 0 };
    const client = new ComfyUIClient(KEY, 'http://127.0.0.1:8188', {
      fetchImpl: redirectingTo('http://127.0.0.1:8188/view/x.png', counter),
      lookupImpl: rebindingLookup('127.0.0.1'),
    });
    const res = await client.download('x.png');
    expect(res.url).toBe('http://127.0.0.1:8188/view/x.png');
    expect(counter.n).toBe(2);
  });

  test('a plaintext base does NOT license plaintext to a different host', async () => {
    const counter = { n: 0 };
    const client = new ComfyUIClient(KEY, 'http://127.0.0.1:8188', {
      additionalAllowedHosts: ['mirror.example'],
      fetchImpl: redirectingTo('http://mirror.example/x.png', counter),
      lookupImpl: publicLookup,
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('non-https'),
    });
    expect(counter.n).toBe(1);
  });
});

describe('the self-hosted exemption is exactly as wide as the operator declared', () => {
  // COMFYUI_API_BASE_ALLOW_HTTP / _ALLOW_PRIVATE let an operator point Vellum at
  // a local ComfyUI. That instance serves its own outputs, so it has to be able
  // to redirect to itself — a local address IS private, and refusing it would
  // break the setup those flags exist to enable. The exemption must not extend
  // one inch further than the origin the operator actually declared.
  const KEY = 'ck_test_key_1234';

  function redirectingTo(location: string, counter: { n: number }): typeof fetch {
    return (async () => {
      counter.n += 1;
      if (counter.n === 1) return new Response(null, { status: 302, headers: { location } });
      return new Response(new Uint8Array([9]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '1' },
      });
    }) as unknown as typeof fetch;
  }

  test('a PUBLIC https base gets NO exemption — the cloud host stays fully guarded', async () => {
    // The important negative. The base host is always allowlisted, so if the
    // exemption keyed on "same origin as base" alone, the primary cloud host
    // would silently lose the rebinding check.
    const counter = { n: 0 };
    const client = new ComfyUIClient(KEY, 'https://cloud.comfy.org', {
      fetchImpl: redirectingTo('https://cloud.comfy.org/view/x.png', counter),
      lookupImpl: rebindingLookup('169.254.169.254'),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('private address'),
    });
    expect(counter.n).toBe(1);
  });

  test('a private base does not exempt a DIFFERENT private host', async () => {
    const counter = { n: 0 };
    const client = new ComfyUIClient(KEY, 'http://127.0.0.1:8188', {
      additionalAllowedHosts: ['other.internal'],
      fetchImpl: redirectingTo('https://other.internal/x.png', counter),
      lookupImpl: rebindingLookup('10.0.0.9'),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({
      code: 'COMFYUI_API_ERROR',
      message: expect.stringContaining('private address'),
    });
    expect(counter.n).toBe(1);
  });

  test('a private base does not exempt a different PORT on the same host', async () => {
    // Origin includes the port, so :8189 is not the declared instance.
    const counter = { n: 0 };
    const client = new ComfyUIClient(KEY, 'http://127.0.0.1:8188', {
      fetchImpl: redirectingTo('http://127.0.0.1:8189/x.png', counter),
      lookupImpl: rebindingLookup('127.0.0.1'),
    });
    await expect(client.download('x.png')).rejects.toMatchObject({ code: 'COMFYUI_API_ERROR' });
    expect(counter.n).toBe(1);
  });
});

describe('the guard resolves only when it should', () => {
  // Counted, not thrown. A resolver that throws does not fail a test:
  // assertPublicHostname catches a lookup failure and rewrites it into the
  // caller's error code, so `forbiddenLookup` alone proves nothing unless the
  // test also pins the message. These count instead.
  let dir2: string;
  beforeEach(() => {
    dir2 = mkdtempSync(join(tmpdir(), 'vellum-count-'));
  });
  afterEach(() => {
    rmSync(dir2, { recursive: true, force: true });
  });

  test('a non-allowlisted host costs ZERO DNS queries', async () => {
    const { lookup, calls } = countingLookup();
    const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
      fetchImpl: neverFetch(),
      lookupImpl: lookup,
    });
    await expect(
      a.downloadToPath('o.png', { type: 'https://evil.example.com/o.png' }, join(dir2, 'o.png')),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    expect(calls).toEqual([]);
  });

  test('a literal IP costs zero DNS queries', async () => {
    const { lookup, calls } = countingLookup();
    const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
      fetchImpl: neverFetch(),
      lookupImpl: lookup,
      additionalAllowedHosts: ['169.254.169.254'],
    });
    await expect(
      a.downloadToPath('o', { type: 'https://169.254.169.254/latest/' }, join(dir2, 'o')),
    ).rejects.toMatchObject({ message: expect.stringContaining('private address') });
    expect(calls).toEqual([]);
  });

  test('an allowlisted hostname IS resolved, exactly once', async () => {
    const { lookup, calls } = countingLookup();
    const a = new ReplicateAdapter('r8_tok_1234', DEFAULT_REPLICATE_API_BASE, {
      fetchImpl: servingFetch(),
      lookupImpl: lookup,
    });
    await a.downloadToPath('ok.png', { type: 'https://replicate.delivery/x/ok.png' }, join(dir2, 'ok.png'));
    expect(calls).toEqual(['replicate.delivery']);
  });
});
