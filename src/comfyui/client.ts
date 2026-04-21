import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { TypedError } from '../engine/errors.js';
import { extractFirstNodeError } from './format.js';
import type {
  SubmitRequest,
  SubmitResponse,
  StatusResponse,
  ComfyOutput,
} from './types.js';

/**
 * ComfyUI Cloud HTTP client (D-GEN-21).
 *
 * Zero MCP imports, zero DB imports — pure HTTP over native fetch. Wraps the
 * three Phase 2 endpoints: POST /api/prompt, GET /api/job/{id}/status, GET /api/view.
 *
 * Auth: `X-API-Key: <apiKey>` on every request (D-GEN-21 specifics).
 * Redirect safety: `redirect: 'manual'` on /api/view to validate signed-URL host
 * against an allowlist (D-GEN-22 + Pattern 4 SSRF defence). Signed-URL fetch
 * drops the API key per ComfyUI Cloud docs.
 *
 * Error policy: every non-2xx path surfaces a TypedError with a useful hint;
 * 429 → COMFYUI_RATE_LIMITED with tier context; node_errors flattened via
 * extractFirstNodeError (D-GEN-27).
 */

/**
 * Canonical ComfyUI Cloud base URL. Exported so server wiring and test
 * fixtures agree on one literal (no more scattered copies of the same host).
 * Per D-GEN-21; override with COMFYUI_API_BASE for self-hosted tenants.
 */
export const DEFAULT_COMFYUI_API_BASE = 'https://cloud.comfy.org';

/**
 * IS-03: hard cap on error-body reads (submit 4xx/5xx) so a misbehaving or
 * hostile ComfyUI response cannot blow out memory while the client tries to
 * extract a node_errors JSON blob. 64 KiB is generous for a realistic error
 * payload and tight enough to block DoS.
 */
export const MAX_ERROR_BODY_BYTES = 64_000;

/**
 * IS-03: default cap on per-file downloads. 500 MiB is larger than any
 * plausible image or single-frame video from ComfyUI but small enough that
 * a runaway signed-URL does not fill disk. Callers (engine / tests) can
 * override via `maxBytes` on `downloadToPath`.
 */
export const DEFAULT_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

/**
 * Read a response body as text but stop after `limit` bytes. Prevents a
 * hostile response from exhausting memory via `res.text()` (which reads the
 * whole body). On overflow, returns what we have so far plus a truncation
 * marker — sufficient for logging / extractFirstNodeError.
 */
async function readTextWithLimit(res: Response, limit: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        // Decode just enough to stay under the cap, then bail.
        const over = total - limit;
        const keep = value.slice(0, Math.max(0, value.byteLength - over));
        out += decoder.decode(keep, { stream: false });
        out += `\n...[truncated at ${limit} bytes]`;
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return out;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } catch {
    /* ignore read errors — return whatever we have */
  }
  return out;
}

export interface DownloadResult {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
  url: string;
}

export interface ComfyUIClientOptions {
  /** Additional hosts allowed as 302 redirect targets beyond the built-in defaults. */
  additionalAllowedHosts?: string[];
  /**
   * Test seam — override `fetch` for deterministic unit tests. Production leaves
   * undefined (uses global fetch).
   */
  fetchImpl?: typeof fetch;
}

/**
 * Default allowlist for signed-URL redirect hosts (D-GEN-22).
 * Keep permissive — ComfyUI Cloud signed URLs may land on any cloud object-store host.
 * Narrow after first live-smoke to the observed provider if needed.
 */
const DEFAULT_ALLOWED_HOST_PATTERNS: RegExp[] = [
  /(^|\.)cloud\.comfy\.org$/,
  /(^|\.)googleapis\.com$/,
  /(^|\.)amazonaws\.com$/,
  /(^|\.)r2\.cloudflarestorage\.com$/,
];

/**
 * IS-04: cap on persisted ComfyUI error messages. Truncates anything longer
 * than this before it crosses the client boundary so downstream storage
 * (versions.error_message) never holds pathologically-large strings.
 */
export const MAX_ERROR_MESSAGE_CHARS = 1_000;

export class ComfyUIClient {
  private allowed: RegExp[];
  /**
   * IS-01: admin-supplied allowed hosts are matched by EXACT or SUFFIX
   * string comparison, not regex. Using a regex over user input (even with
   * `.replace(/\./g, '\\.')`) still allows metacharacters (`|`, `+`, `*`, `[`)
   * through — an admin typo like `foo|.*` would broaden the allowlist to
   * every host. String comparison closes that escape hatch entirely.
   *
   * Semantics match the default patterns (`/(^|\.)X$/`): host === allowed OR
   * host.endsWith('.' + allowed). Case-insensitive (hostnames compared lowercase).
   */
  private allowedLiteralHosts: string[];
  private fetchImpl: typeof fetch;

  /**
   * IS-04: scrub the configured API key literal from any string before it
   * leaves the client boundary, then truncate to MAX_ERROR_MESSAGE_CHARS.
   *
   * Rationale: a ComfyUI error response could (rarely) echo back request
   * headers — including X-API-Key. That blob flows into
   * TypedError.message, and then through markFailed into versions.error_message
   * where an agent can read it back with a status call. Stripping the key
   * at the client boundary is the narrowest fix that doesn't require plumbing
   * the key into engine code.
   */
  private scrubAndTruncate(s: string): string {
    let out = s;
    // Defensive: only scrub if the key is a non-empty non-placeholder string.
    if (this.apiKey && this.apiKey.length >= 4) {
      // Replace every occurrence, including within bearer/apikey prefixes.
      // String.replaceAll is available in Node 15+ (we're on Node 25).
      out = out.replaceAll(this.apiKey, '[redacted]');
    }
    if (out.length > MAX_ERROR_MESSAGE_CHARS) {
      out = out.slice(0, MAX_ERROR_MESSAGE_CHARS) + `...[truncated]`;
    }
    return out;
  }

  constructor(
    private apiKey: string,
    private base: string,
    options: ComfyUIClientOptions = {},
  ) {
    this.allowed = [...DEFAULT_ALLOWED_HOST_PATTERNS];
    this.allowedLiteralHosts = [];
    // Also accept the configured base origin host verbatim — exact match only.
    try {
      const baseHost = new URL(base).hostname.toLowerCase();
      this.allowedLiteralHosts.push(baseHost);
    } catch {
      /* ignore — upstream validates base URL */
    }
    for (const raw of options.additionalAllowedHosts ?? []) {
      const trimmed = raw.trim().toLowerCase();
      if (!trimmed) continue;
      this.allowedLiteralHosts.push(trimmed);
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** POST /api/prompt — returns { prompt_id } (D-GEN-21). */
  async submit(workflowJson: Record<string, unknown>): Promise<SubmitResponse> {
    const body: SubmitRequest = { prompt: workflowJson };
    const url = new URL('/api/prompt', this.base);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(body),
        // Do NOT follow redirects automatically. Node's fetch preserves
        // custom headers (including X-API-Key) across cross-origin redirects.
        // A single 302 from a compromised base URL would exfiltrate the key.
        redirect: 'manual',
      });
    } catch (err) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        this.scrubAndTruncate(`ComfyUI network error: ${(err as Error).message}`),
      );
    }
    if (res.status >= 300 && res.status < 400) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        `ComfyUI /api/prompt returned unexpected redirect ${res.status} (API key would leak if followed)`,
      );
    }
    if (res.status === 429) {
      throw new TypedError(
        'COMFYUI_RATE_LIMITED',
        `ComfyUI returned 429 (concurrency limit reached)`,
        'ComfyUI concurrency limit reached (Free: 1, Creator: 3, Pro: 5 concurrent jobs). Wait for an in-flight generation to complete and retry.',
      );
    }
    if (!res.ok) {
      // IS-03: cap body read at MAX_ERROR_BODY_BYTES — a hostile or
      // misbehaving upstream cannot exhaust memory via a multi-GB error body.
      const text = await readTextWithLimit(res, MAX_ERROR_BODY_BYTES);
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* ignore — malformed or truncated JSON falls through to generic message */
      }
      const nodeErrors = (parsed as { node_errors?: unknown } | null)?.node_errors;
      const nodeMessage = extractFirstNodeError(nodeErrors);
      // IS-04: scrub the API key (in case ComfyUI echoed a header) and
      // truncate before the message leaves the client boundary.
      throw new TypedError(
        'COMFYUI_API_ERROR',
        this.scrubAndTruncate(
          nodeMessage ?? `ComfyUI request failed: ${res.status} ${res.statusText}`,
        ),
      );
    }
    const json = (await res.json()) as SubmitResponse;
    if (!json?.prompt_id) {
      throw new TypedError('COMFYUI_API_ERROR', 'ComfyUI response missing prompt_id');
    }
    return json;
  }

  /** GET /api/job/{id}/status — normalise to StatusResponse (D-GEN-21). */
  async status(jobId: string): Promise<StatusResponse> {
    const url = new URL(`/api/job/${encodeURIComponent(jobId)}/status`, this.base);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        // See submit() — Node fetch forwards custom headers across redirects,
        // so a 302 from the status endpoint would leak X-API-Key.
        redirect: 'manual',
      });
    } catch (err) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        this.scrubAndTruncate(`ComfyUI network error: ${(err as Error).message}`),
      );
    }
    if (res.status >= 300 && res.status < 400) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        `ComfyUI /api/job status returned unexpected redirect ${res.status} (API key would leak if followed)`,
      );
    }
    if (!res.ok) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        this.scrubAndTruncate(
          `ComfyUI status request failed: ${res.status} ${res.statusText}`,
        ),
      );
    }
    const raw = (await res.json()) as Record<string, unknown>;
    // Accept lenient inputs — status field is canonical; progress/outputs/error are best-effort.
    const status = (raw.status ?? 'pending') as StatusResponse['status'];
    const progress = typeof raw.progress === 'number' ? raw.progress : undefined;
    const outputs = Array.isArray(raw.outputs) ? (raw.outputs as ComfyOutput[]) : undefined;
    // IS-04: scrub any echoed API key from the error blob before it leaves
    // the client boundary. The engine persists this verbatim into
    // versions.error_message, so scrubbing here prevents the key from
    // reaching disk / agent responses. Applied to both string and object
    // shapes by serialising, scrubbing, and re-parsing when possible.
    const error =
      'error' in raw ? this.scrubErrorValue(raw.error as unknown) : undefined;
    return { status, progress, outputs, error };
  }

  /**
   * IS-04: scrub the API key from an arbitrary status.error value. Strings
   * are scrub+truncated directly. Objects are serialised, scrubbed, re-parsed
   * (silently falls back to a redacted marker if the object is not JSON-safe).
   */
  private scrubErrorValue(val: unknown): unknown {
    if (val == null) return val;
    if (typeof val === 'string') return this.scrubAndTruncate(val);
    try {
      const json = JSON.stringify(val);
      const scrubbed = this.scrubAndTruncate(json);
      // If the scrubbed JSON is still parseable, return the structured form;
      // otherwise fall back to a truncated string marker.
      try {
        return JSON.parse(scrubbed);
      } catch {
        return scrubbed;
      }
    } catch {
      return '[unserialisable error — redacted]';
    }
  }

  /**
   * GET /api/view — returns a streaming body + metadata after validating the
   * 302 redirect target host against the allowlist (D-GEN-22, Pattern 4).
   * Caller is responsible for consuming the body stream.
   */
  async download(
    filename: string,
    opts: { subfolder?: string; type?: string } = {},
  ): Promise<DownloadResult> {
    const viewUrl = new URL('/api/view', this.base);
    viewUrl.searchParams.set('filename', filename);
    viewUrl.searchParams.set('subfolder', opts.subfolder ?? '');
    viewUrl.searchParams.set('type', opts.type ?? 'output');

    const first = await this.fetchImpl(viewUrl, {
      method: 'GET',
      headers: { 'X-API-Key': this.apiKey },
      redirect: 'manual',
    });
    if (first.status !== 302 && first.status !== 301) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        `Expected 302 redirect from /api/view, got ${first.status}`,
      );
    }
    const location = first.headers.get('location');
    if (!location) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        '/api/view returned redirect with no Location',
      );
    }
    let target: URL;
    try {
      target = new URL(location);
    } catch {
      throw new TypedError('COMFYUI_API_ERROR', `Invalid redirect Location: ${location}`);
    }
    if (!this.isAllowedHost(target.hostname)) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        `Unexpected redirect host: ${target.hostname}`,
        'Add the signed-URL host to COMFYUI_ALLOWED_REDIRECT_HOSTS (comma-separated) if it is legitimate.',
      );
    }
    // Signed URLs do NOT need auth headers (ComfyUI Cloud docs).
    // Explicitly pass no headers so the original request's X-API-Key does not leak.
    //
    // C3: close SSRF bypass on this second hop. Without redirect:'manual',
    // Node's fetch silently follows up to 20 further redirects. An attacker
    // who can influence an allowlisted host's response (misconfigured bucket,
    // compromised tenant, typo'd URL) could chain 302 → http://169.254.169.254
    // and exfiltrate cloud-metadata content — defeating the first-hop allowlist.
    // Signed URLs are direct-fetch resources; they should not redirect further.
    const second = await this.fetchImpl(target, {
      method: 'GET',
      redirect: 'manual',
    });
    if (second.status >= 300 && second.status < 400) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        `Signed-URL fetch returned unexpected redirect ${second.status} (SSRF bypass blocked)`,
      );
    }
    if (!second.ok || !second.body) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        `Signed URL fetch failed: ${second.status} ${second.statusText}`,
      );
    }
    const contentLengthRaw = second.headers.get('content-length');
    return {
      body: second.body,
      contentType: second.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: contentLengthRaw ? Number(contentLengthRaw) : NaN,
      url: target.toString(),
    };
  }

  /**
   * Wrapper over `download` that streams to disk atomically: writes to
   * `{destPath}.partial`, then `rename()` on success. On failure unlinks the
   * partial and throws `TypedError('DOWNLOAD_FAILED', ...)`. (Pattern 5.)
   *
   * IS-03: `maxBytes` caps the write length. If the stream exceeds the cap
   * mid-pipe, the pipeline is aborted, the partial file is unlinked, and a
   * typed error is thrown. Prevents a hostile allowlisted host from filling
   * disk via an unbounded signed-URL.
   */
  async downloadToPath(
    filename: string,
    opts: { subfolder?: string; type?: string },
    destPath: string,
    options: { maxBytes?: number } = {},
  ): Promise<{
    path: string;
    url: string;
    contentType: string;
    sizeBytes: number;
  }> {
    const maxBytes = options.maxBytes ?? DEFAULT_DOWNLOAD_MAX_BYTES;
    const result = await this.download(filename, opts);
    // Pre-flight: if the server advertised a content-length larger than the
    // cap, bail before opening a write stream.
    if (
      Number.isFinite(result.contentLength) &&
      result.contentLength > maxBytes
    ) {
      throw new TypedError(
        'DOWNLOAD_FAILED',
        `Remote file '${filename}' size ${result.contentLength} exceeds max ${maxBytes} bytes`,
      );
    }
    const partial = `${destPath}.partial`;
    let bytes = 0;
    const writer = createWriteStream(partial);
    let overflow = false;
    try {
      const readable = Readable.fromWeb(
        result.body as unknown as import('node:stream/web').ReadableStream,
      );
      readable.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > maxBytes && !overflow) {
          overflow = true;
          // Destroying the readable aborts the pipeline with an error that
          // propagates to the catch below (and unlinks the partial).
          readable.destroy(
            new Error(
              `Download '${filename}' exceeded maxBytes=${maxBytes} (saw ${bytes})`,
            ),
          );
        }
      });
      await pipeline(readable, writer);
      await rename(partial, destPath);
    } catch (err) {
      await unlink(partial).catch(() => undefined);
      throw new TypedError(
        'DOWNLOAD_FAILED',
        `Failed to stream '${filename}' to disk: ${(err as Error).message}`,
      );
    }
    return {
      path: destPath,
      url: result.url,
      contentType: result.contentType,
      sizeBytes:
        Number.isFinite(result.contentLength) && result.contentLength > 0
          ? result.contentLength
          : bytes,
    };
  }

  private isAllowedHost(host: string): boolean {
    if (this.allowed.some((re) => re.test(host))) return true;
    const hostLower = host.toLowerCase();
    return this.allowedLiteralHosts.some(
      (h) => hostLower === h || hostLower.endsWith('.' + h),
    );
  }
}
