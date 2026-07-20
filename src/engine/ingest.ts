// src/engine/ingest.ts
//
// Inbound output ingestion (pivot Phase D) — the "any output can speak to it"
// download path. An external agent or a provider webhook reports a finished
// asset by URL; the engine fetches it into the version's output dir. Because the
// URL is caller-supplied (a NEW trust boundary the trusted outbound path never
// had), this enforces: https-only, an output-host ALLOWLIST, and a byte cap.
//
// PURE store/util layer: TypedError + streamToPath only. No MCP, no DB.

import { TypedError } from './errors.js';
import { streamToPath } from '../utils/stream-to-path.js';

export const DEFAULT_INGEST_MAX_BYTES = 500 * 1024 * 1024;

// Known delivery hosts external agents / provider webhooks commonly report from.
// Operators extend this via VELLUM_INGEST_ALLOWED_HOSTS (additive — see server.ts).
export const DEFAULT_INGEST_ALLOWED_HOSTS: readonly string[] = [
  'replicate.delivery', // Replicate
  'storage.googleapis.com', // ComfyUI Cloud signed outputs
  'fal.media', // FAL
  'cdn.scenario.com', // Scenario (best effort)
];

export interface IngestResult {
  path: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

/** Suffix/exact host allowlist match (case-insensitive). */
function hostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((a) => host === a || host.endsWith('.' + a));
}

/**
 * Validate a caller-supplied output URL against the trust boundary and return the
 * parsed URL. Throws TypedError on any violation. Reused for a pre-flight check
 * (before creating a version) AND inside the download.
 */
export function assertIngestUrlAllowed(rawUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TypedError('INVALID_INPUT', `Not a valid output URL: ${rawUrl}`);
  }
  if (url.protocol !== 'https:') {
    throw new TypedError(
      'DOWNLOAD_FAILED',
      `Refusing non-https ingest URL (${url.protocol})`,
      'External outputs must be public https URLs.',
    );
  }
  if (!hostAllowed(url.hostname.toLowerCase(), allowedHosts)) {
    throw new TypedError(
      'DOWNLOAD_FAILED',
      `Ingest host not allowlisted: ${url.hostname}`,
      'Add the host to VELLUM_INGEST_ALLOWED_HOSTS if it is a legitimate output source.',
    );
  }
  return url;
}

/** Fetch an allowlisted https output URL to destPath with a byte cap + atomic write. */
export async function ingestDownloadToPath(
  rawUrl: string,
  destPath: string,
  opts: { allowedHosts: readonly string[]; maxBytes?: number; fetchImpl?: typeof fetch },
): Promise<IngestResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? DEFAULT_INGEST_MAX_BYTES;
  const url = assertIngestUrlAllowed(rawUrl, opts.allowedHosts);

  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
  } catch (err) {
    throw new TypedError(
      'DOWNLOAD_FAILED',
      `Ingest download failed: ${(err as Error)?.message ?? String(err)}`,
    );
  }
  // redirect:'manual' — a 3xx off an allowlisted host could bounce to a
  // non-allowlisted one (SSRF); reject rather than follow.
  if (res.status >= 300 && res.status < 400) {
    throw new TypedError('DOWNLOAD_FAILED', `Unexpected redirect (${res.status}) from ingest host ${url.hostname}`);
  }
  if (!res.ok || !res.body) {
    throw new TypedError('DOWNLOAD_FAILED', `Ingest download failed: ${res.status} ${res.statusText}`.trim());
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new TypedError('DOWNLOAD_FAILED', `Remote file size ${contentLength} exceeds max ${maxBytes} bytes`);
  }
  let bytes = 0;
  try {
    ({ bytes } = await streamToPath(res.body, destPath, { maxBytes, filenameForError: rawUrl }));
  } catch (err) {
    throw new TypedError('DOWNLOAD_FAILED', `Failed to stream ingest output to disk: ${(err as Error).message}`);
  }
  return {
    path: destPath,
    url: url.toString(),
    contentType,
    sizeBytes: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : bytes,
  };
}
