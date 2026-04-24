import { readFile } from 'node:fs/promises';
import { TypedError } from '../engine/errors.js';
import { extractFirstNodeError } from './format.js';
import { extractTextChunk } from './png-metadata.js';
import { streamToPath } from '../utils/stream-to-path.js';
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
 * three Phase 2 endpoints: POST /api/prompt, GET /api/jobs/{id}, GET /api/view.
 * (Phase 7 D-EP-17 switched the status fetch from the singular
 * `/api/job/{id}/status` endpoint — dispatch-state-only, no outputs — to the
 * plural `/api/jobs/{id}` endpoint which returns the full execution record.)
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
 *
 * @since 2026-04-24 (Phase 7, D-EP-06) — value confirmed by scripts/probe-comfy-endpoint.mts winner.
 */
export const DEFAULT_COMFYUI_API_BASE = 'https://cloud.comfy.org';

/**
 * Phase 7 D-EP-14: path used by both the first-submit healthcheck
 * (ensureEndpointHealthy) and the sentinel test (endpoint-probe.test.ts).
 * Set by scripts/probe-comfy-endpoint.mts winner — a read-only GET endpoint
 * that returns 200 for authenticated requests.
 *
 * Note on auth-method-per-endpoint quirk (observed 2026-04-24 by probe):
 * `cloud.comfy.org/api/queue` returns 401 "invalid API key" and
 * `/api/history` returns 401 "authentication method not allowed" with the
 * SAME X-API-Key that `/api/system_stats` accepts with 200. The healthcheck
 * path MUST be `/api/system_stats` specifically — do NOT switch to `/api/queue`
 * expecting it to work. See 07-01-SUMMARY.md probe matrix for evidence.
 */
export const HEALTHCHECK_PATH = '/api/system_stats';

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

/**
 * Phase 7 D-EP-16: translate ComfyUI Cloud's on-the-wire status strings to the
 * canonical `StatusResponse['status']` state machine used by the engine
 * (D-GEN-18). The Cloud's v0.82.0 API returns `'success'` / `'error'` for
 * terminal states — values that `StatusResponse` does not enumerate and that
 * the engine's `mapState()` (`src/engine/generation.ts:364`) silently collapses
 * to `'pending'`, causing the poll loop to spin until deadline.
 *
 * Keep the engine-facing type stable; translate at the client boundary so the
 * engine stays vocabulary-free. Unknown strings fall through to `'pending'` —
 * a safe default that lets the poll loop keep trying rather than terminating
 * on a transient state we haven't catalogued yet.
 *
 * Observed terminal Cloud values (2026-04-24 live-smoke run against v0.82.0):
 *   - `success` — job completed with outputs (confirmed via `/api/job/{id}/status`)
 *   - `error` — job failed; `error_message` populated with the worker traceback
 *
 * Intermediate values are not yet fully catalogued — `running` / `in_progress`
 * are mapped defensively based on the open-source ComfyUI vocabulary; any
 * unknown string maps to `pending` rather than `running` to avoid
 * prematurely flipping downstream state.
 */
export function normalizeCloudStatus(raw: unknown): StatusResponse['status'] {
  if (typeof raw !== 'string') return 'pending';
  switch (raw) {
    case 'success':
    case 'completed':
      return 'completed';
    case 'error':
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'running':
    case 'in_progress':
      return 'in_progress';
    default:
      return 'pending';
  }
}

/**
 * Phase 7 D-EP-17: flatten ComfyUI Cloud's `/api/jobs/{id}` nested outputs
 * shape into the engine-facing `ComfyOutput[]` flat list.
 *
 * Cloud's `outputs` field is a node-id-keyed map whose values are media-type
 * buckets (`images` / `gifs` / `videos` / etc.) each carrying a flat array
 * of `{ filename, subfolder, type, display_name?, ... }` entries:
 *
 *     {"outputs": {"9": {"images": [{"filename": "...", "subfolder": "", "type": "output"}]}}}
 *
 * Accepts three input shapes for forward/back compatibility:
 *   1. `undefined` / `null` → `undefined` (no outputs yet)
 *   2. Flat array `ComfyOutput[]` → passed through (legacy stock ComfyUI shape + unit-test mocks)
 *   3. Nested map (Cloud /api/jobs shape) → flattened in-order by Object.values iteration
 *
 * Non-object and malformed entries are skipped silently — the engine tolerates
 * `outputs: undefined` via `remote.outputs ?? []`, so a lossy extraction is
 * safer than throwing mid-poll.
 */
export function extractOutputs(raw: unknown): ComfyOutput[] | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    const items = (raw as unknown[]).filter(
      (o): o is ComfyOutput =>
        o != null &&
        typeof o === 'object' &&
        typeof (o as { filename?: unknown }).filename === 'string',
    );
    return items.length > 0 ? items : undefined;
  }
  if (typeof raw !== 'object') return undefined;
  const out: ComfyOutput[] = [];
  for (const node of Object.values(raw as Record<string, unknown>)) {
    if (node == null || typeof node !== 'object') continue;
    for (const mediaArr of Object.values(node as Record<string, unknown>)) {
      if (!Array.isArray(mediaArr)) continue;
      for (const item of mediaArr) {
        if (item == null || typeof item !== 'object') continue;
        const filename = (item as { filename?: unknown }).filename;
        if (typeof filename !== 'string') continue;
        const subfolder = (item as { subfolder?: unknown }).subfolder;
        const type = (item as { type?: unknown }).type;
        out.push({
          filename,
          subfolder: typeof subfolder === 'string' ? subfolder : undefined,
          type: typeof type === 'string' ? type : undefined,
        });
      }
    }
  }
  return out.length > 0 ? out : undefined;
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
   * Phase 7 D-EP-07: first-submit healthcheck cache. `null` = never checked;
   * Promise = in-flight OR confirmed-success. Caching the Promise (not a boolean)
   * keeps concurrent first-submit callers race-safe — they all await the same
   * result. On failure, the IIFE resets this to `null` before re-throwing so a
   * later submit can retry (e.g., after an operator edits .env and the current
   * process survives the edit — uncommon, but supported).
   */
  private healthCheckResult: Promise<void> | null = null;

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

  /**
   * Phase 7 D-EP-07: first-submit healthcheck.
   *
   * Cheap GET against HEALTHCHECK_PATH to confirm the configured base + key
   * combo is still live. Called lazily from submit() — result cached on the
   * instance for the lifetime of the process. Never re-runs (no per-submit
   * overhead). On failure throws COMFYUI_ENDPOINT_DRIFT with an actionable
   * hint pointing at the probe script.
   *
   * Race-safe: the memoized Promise ensures concurrent submits share one
   * in-flight check. Failure leaves healthCheckResult=null so a later submit
   * can retry (drift may resolve via operator .env edit without restart).
   */
  private async ensureEndpointHealthy(): Promise<void> {
    if (this.healthCheckResult) return this.healthCheckResult;
    this.healthCheckResult = (async () => {
      const url = new URL(HEALTHCHECK_PATH, this.base);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'GET',
          headers: { 'X-API-Key': this.apiKey },
          // D-EP-07: match submit()/status() redirect policy. Node's fetch
          // preserves X-API-Key across cross-origin redirects — a single 302
          // from a drifted or compromised base URL would exfiltrate the key.
          redirect: 'manual',
        });
      } catch (err) {
        // Failure MUST NOT memoize — let a later submit retry.
        this.healthCheckResult = null;
        throw new TypedError(
          'COMFYUI_ENDPOINT_DRIFT',
          this.scrubAndTruncate(
            `ComfyUI healthcheck network error against ${this.base}${HEALTHCHECK_PATH}: ${(err as Error).message}`,
          ),
          'COMFYUI_API_BASE may have drifted. Run `npx tsx scripts/probe-comfy-endpoint.mts` to find the current working base, then update .env COMFYUI_API_BASE.',
        );
      }
      if (res.status !== 200) {
        this.healthCheckResult = null;
        throw new TypedError(
          'COMFYUI_ENDPOINT_DRIFT',
          this.scrubAndTruncate(
            `ComfyUI healthcheck returned HTTP ${res.status} against ${this.base}${HEALTHCHECK_PATH}`,
          ),
          'COMFYUI_API_BASE may have drifted. Run `npx tsx scripts/probe-comfy-endpoint.mts` to find the current working base, then update .env COMFYUI_API_BASE.',
        );
      }
      // 200 path — discard body (we only care about the status). Drain so
      // the connection can be reused by the next fetch.
      try { await res.arrayBuffer(); } catch { /* ignore */ }
    })();
    return this.healthCheckResult;
  }

  /** POST /api/prompt — returns { prompt_id } (D-GEN-21). */
  async submit(workflowJson: Record<string, unknown>): Promise<SubmitResponse> {
    // D-EP-07: first-submit healthcheck. Cached for process lifetime on success;
    // reset to null on failure so a later submit can retry after an .env edit.
    // Throws COMFYUI_ENDPOINT_DRIFT (surfaces via tool envelope per D-GEN-41).
    await this.ensureEndpointHealthy();
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

  /**
   * GET /api/jobs/{id} — normalise to StatusResponse (D-GEN-21, D-EP-17).
   *
   * Phase 7 D-EP-17: the singular `/api/job/{id}/status` endpoint returns only
   * dispatch-layer state (`status`, `assigned_inference`, `error_message`) and
   * omits the `outputs` field entirely, so the engine can never flip a version
   * to `completed`. The plural `/api/jobs/{id}` endpoint returns the full
   * execution record with canonical status (`"completed"`), nested
   * `outputs[nodeId][mediaType][]` shape, and the resolved workflow prompt.
   * Both endpoints share the same auth + redirect posture.
   */
  async status(jobId: string): Promise<StatusResponse> {
    const url = new URL(`/api/jobs/${encodeURIComponent(jobId)}`, this.base);
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
        `ComfyUI /api/jobs returned unexpected redirect ${res.status} (API key would leak if followed)`,
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
    // D-EP-16: Cloud terminal strings arrive as either canonical ('completed' /
    // 'failed' — plural /api/jobs shape) or legacy ('success' / 'error' —
    // singular /api/job shape, retained as defence in depth for intermediate
    // or undocumented states). normalizeCloudStatus collapses both to the
    // engine vocabulary; any unknown string falls through to 'pending' so the
    // poll loop keeps trying instead of prematurely advancing downstream state.
    const status = normalizeCloudStatus(raw.status);
    const progress = typeof raw.progress === 'number' ? raw.progress : undefined;
    // D-EP-17: handle both the nested /api/jobs map and the flat legacy array
    // shape (used by existing unit-test mocks) via extractOutputs.
    const outputs = extractOutputs(raw.outputs);
    // IS-04: scrub any echoed API key from the error blob before it leaves
    // the client boundary. The engine persists this verbatim into
    // versions.error_message, so scrubbing here prevents the key from
    // reaching disk / agent responses. Applied to both string and object
    // shapes by serialising, scrubbing, and re-parsing when possible.
    //
    // Cloud's `/api/jobs/{id}` surfaces failure detail in `error_message`
    // (top-level string, often a JSON-encoded worker traceback). Legacy
    // shapes used a top-level `error` field. Prefer `error` when present;
    // fall back to `error_message` so the failure path produces a non-empty
    // message the engine can flatten via extractFirstNodeError.
    const error =
      'error' in raw
        ? this.scrubErrorValue(raw.error as unknown)
        : typeof raw.error_message === 'string' && raw.error_message.length > 0
          ? this.scrubErrorValue(raw.error_message)
          : undefined;
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
    let bytes = 0;
    try {
      ({ bytes } = await streamToPath(result.body, destPath, {
        maxBytes,
        filenameForError: filename,
      }));
    } catch (err) {
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

  /**
   * Phase 3 (D-PROV-05, RESEARCH.md §D-PROV-05 Resolution): fetch the resolved
   * prompt blob for a completed job from the already-downloaded PNG output.
   *
   * Implementation: read PNG tEXt 'prompt' chunk from disk via fs.promises.readFile
   * → extractTextChunk (Plan 01 output) → JSON.parse. Returns null if the file
   * is not a PNG, if the tEXt 'prompt' chunk is missing, if the chunk payload
   * fails to JSON-parse, or if the parsed value is not a plain object. Never
   * throws — callers (GenerationEngine.downloadAndPersist) tolerate null by
   * passing it to ProvenanceWriter.writeCompletedEvent, which stores
   * `prompt_json: null`; reproduce/iterate then surface `PROVENANCE_UNAVAILABLE`
   * when the agent tries to use that version.
   *
   * If a follow-up spike confirms /api/job/{id}/status or /api/history/{id}
   * returns the resolved blob, this method's body can be swapped for an
   * HTTP call with the same signature. The caller contract stays the same.
   *
   * DOES NOT make any HTTP call. Zero network I/O. Pure filesystem read.
   */
  async fetchResolvedPrompt(pngPath: string): Promise<Record<string, unknown> | null> {
    try {
      const buf = await readFile(pngPath);
      const promptStr = extractTextChunk(buf, 'prompt');
      if (!promptStr) return null;
      const parsed = JSON.parse(promptStr) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private isAllowedHost(host: string): boolean {
    if (this.allowed.some((re) => re.test(host))) return true;
    const hostLower = host.toLowerCase();
    return this.allowedLiteralHosts.some(
      (h) => hostLower === h || hostLower.endsWith('.' + h),
    );
  }
}
