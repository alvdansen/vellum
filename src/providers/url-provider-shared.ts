// src/providers/url-provider-shared.ts
//
// Shared building blocks for URL-based GenerationProviders (Replicate, FAL, and
// future hosted APIs whose outputs are https URLs rather than embedded blobs).
// Extracted so the SECURITY-CRITICAL bits — the recursive output walk with its
// depth/count backstops and the SSRF-guarded streaming download — live in ONE
// place instead of being copied per adapter.
//
// PURITY: no MCP SDK, no SQLite/ORM (architecture-purity guards src/providers/).
// Only TypedError + streamToPath, like the adapters themselves.

import { basename as pathBasename } from 'node:path';
import { streamToPath, resolveDownloadIdleTimeoutMs } from '../utils/stream-to-path.js';
import { assertPublicHostname, type LookupFn } from '../utils/private-address.js';
import { TypedError } from '../engine/errors.js';
import type { ComfyOutput } from '../comfyui/types.js';
import type { DownloadToPathResult } from './provider.js';

// Bound the walk over attacker-influenced model-output JSON. Real hosted-provider
// outputs are shallow (url | url[] | {k:url} | [{k:url}], depth ≤ ~3), so these
// caps only bite on pathological/abusive shapes: they stop a deeply-nested output
// from stack-overflowing the recursion, and stop one job from fanning out into an
// unbounded (terabyte-scale) download set. Generous enough never to clip a
// legitimate result.
export const MAX_OUTPUT_WALK_DEPTH = 32;
export const MAX_OUTPUT_URLS = 512;

/**
 * Derive a safe on-disk basename from an output URL; fall back to `<prefix>_<i>`.
 * Strips non-conservative filename chars, then collapses any run of 2+ dots to a
 * single dot so a delivery-URL basename like 'frame..001.png' can never carry a
 * '..' segment into the engine's buildOutputPath (which throws INVALID_INPUT on '..').
 */
export function safeOutputName(url: string, index: number, fallbackPrefix: string): string {
  let name = '';
  try {
    name = pathBasename(new URL(url).pathname);
  } catch {
    name = '';
  }
  name = name.replace(/[^A-Za-z0-9._-]/g, '').replace(/\.{2,}/g, '.');
  if (!name || name === '.' || name === '..') name = `${fallbackPrefix}_${index}`;
  return name;
}

/**
 * Flatten a hosted provider's `output` into ComfyOutput[]. Output schemas vary
 * widely by model — a bare URL string, an array of URLs, an object of URLs, and
 * nested shapes like { video: ["https://…"] } or [{ image: "https://…" }]. We
 * RECURSE (a shallow scan silently drops the real asset) and collect every https
 * URL, bounded by MAX_OUTPUT_WALK_DEPTH / MAX_OUTPUT_URLS. Non-https values
 * (data: URIs, numbers, text) are ignored; a caller treats a completed job with
 * zero extractable URLs as a failure, not a silent empty success. The URL rides
 * in ComfyOutput.type; the safe basename is the on-disk filename.
 */
export function extractHttpsOutputs(output: unknown, fallbackPrefix: string): ComfyOutput[] {
  const urls: string[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (urls.length >= MAX_OUTPUT_URLS || depth > MAX_OUTPUT_WALK_DEPTH) return;
    if (typeof v === 'string') {
      if (/^https:\/\//i.test(v)) urls.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const el of v) {
        if (urls.length >= MAX_OUTPUT_URLS) break;
        visit(el, depth + 1);
      }
      return;
    }
    if (v && typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>)) {
        if (urls.length >= MAX_OUTPUT_URLS) break;
        visit(val, depth + 1);
      }
    }
  };
  visit(output, 0);
  return urls.map((u, i) => ({ filename: safeOutputName(u, i, fallbackPrefix), subfolder: '', type: u }));
}

/** Build the output-host allowlist: built-in defaults + the API base host + operator additions. */
export function resolveAllowedHosts(base: string, defaults: readonly string[], additional?: string[]): string[] {
  const hosts = [...defaults];
  try {
    hosts.push(new URL(base).hostname.toLowerCase());
  } catch {
    /* base validated upstream */
  }
  for (const raw of additional ?? []) {
    const t = raw.trim().toLowerCase();
    if (t) hosts.push(t);
  }
  return hosts;
}

/** Exact-or-suffix host match against the allowlist. */
export function isAllowedHost(host: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => host === a || host.endsWith('.' + a));
}

/**
 * SSRF-guarded streaming download shared by URL providers: https-only + host
 * allowlist + resolved-address check + redirect:manual + content-length byte cap
 * + atomic temp-then-rename (via streamToPath). `providerLabel` / `scrub` /
 * `allowlistEnvHint` keep error messages provider-appropriate and token-free.
 *
 * The allowlist answers "do we trust this NAME?"; `assertPublicHostname` answers
 * "and where does that name actually point?". Both are always enforced — the
 * address check is NEVER conditional on whether a caller injected a fake fetch,
 * because a control that switches itself off under test is not a control. Tests
 * pass `lookupImpl` instead, which keeps the code path identical and the DNS
 * answer deterministic.
 */
export async function guardedStreamDownload(args: {
  filename: string;
  /** The candidate source URL (must be https + allowlisted host + publicly-resolving). */
  source: string;
  destPath: string;
  fetchImpl: typeof fetch;
  /** Resolver seam. Production leaves it undefined (real DNS); tests inject one. */
  lookupImpl?: LookupFn;
  allowedHosts: readonly string[];
  maxBytes: number;
  providerLabel: string;
  scrub: (s: string) => string;
  allowlistEnvHint: string;
}): Promise<DownloadToPathResult> {
  const { filename, source, destPath, fetchImpl, lookupImpl, allowedHosts, maxBytes, providerLabel, scrub, allowlistEnvHint } = args;

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new TypedError('DOWNLOAD_FAILED', `${providerLabel} output is not a valid URL: ${source}`);
  }
  if (url.protocol !== 'https:') {
    throw new TypedError('DOWNLOAD_FAILED', `Refusing non-https ${providerLabel} output (${url.protocol})`);
  }
  if (!isAllowedHost(url.hostname.toLowerCase(), allowedHosts)) {
    throw new TypedError(
      'DOWNLOAD_FAILED',
      `${providerLabel} output host not allowlisted: ${url.hostname}`,
      `Add the host to ${allowlistEnvHint} if this is a legitimate delivery mirror.`,
    );
  }
  // Resolve AFTER the allowlist so a rejected host never costs a DNS query, and
  // BEFORE the fetch so an allowlisted name pointing inward is refused unconnected.
  await assertPublicHostname(url.hostname, `${providerLabel} output host`, lookupImpl);

  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
  } catch (err) {
    throw new TypedError('DOWNLOAD_FAILED', `${providerLabel} download failed: ${scrub((err as Error)?.message ?? String(err))}`);
  }
  // redirect:'manual' — a 3xx from a delivery host is unexpected; reject (SSRF).
  if (res.status >= 300 && res.status < 400) {
    throw new TypedError('DOWNLOAD_FAILED', `Unexpected redirect (${res.status}) from ${providerLabel} output host`);
  }
  if (!res.ok || !res.body) {
    throw new TypedError('DOWNLOAD_FAILED', `${providerLabel} download failed: ${res.status} ${res.statusText}`.trim());
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new TypedError(
      'DOWNLOAD_FAILED',
      `Remote file '${filename}' size ${contentLength} exceeds max ${maxBytes} bytes`,
    );
  }
  let bytes = 0;
  try {
    ({ bytes } = await streamToPath(res.body, destPath, {
      maxBytes,
      filenameForError: filename,
      idleTimeoutMs: resolveDownloadIdleTimeoutMs(),
    }));
  } catch (err) {
    throw new TypedError('DOWNLOAD_FAILED', `Failed to stream ${providerLabel} output '${filename}' to disk: ${(err as Error).message}`);
  }
  return {
    path: destPath,
    url: url.toString(),
    contentType,
    sizeBytes: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : bytes,
  };
}
