// src/providers/replicate-adapter.ts
//
// Replicate adapter (pivot Phase C) — the first NON-ComfyUI GenerationProvider,
// proving the seam is real. Raw fetch over Replicate's REST API (no `replicate`
// npm dependency — mirrors ComfyUIClient's zero-SDK approach, which keeps boot
// resilient and the providers/ module pure). `fetchImpl` is injectable so the
// whole lifecycle is unit-testable with a mock — no live token needed.
//
// PURITY: no MCP SDK, no SQLite/ORM, no HTTP-server layer (architecture-purity
// guards src/providers/). Only TypedError + streamToPath, like ComfyUIClient.
//
// Replicate REST shape:
//   submit : POST {base}/v1/predictions  { version, input }        -> { id, status }
//   status : GET  {base}/v1/predictions/{id}                        -> { status, output, error }
//            native status vocabulary: starting|processing|succeeded|failed|canceled
//   output : prediction.output is an https URL or an array of URLs (public, expiring)
//
// OUTPUT MODELLING: the engine's downloadAndPersist uses ComfyOutput.filename for
// BOTH the on-disk path and the download identifier. ComfyUI filenames are clean;
// Replicate outputs are URLs. So this adapter emits ComfyOutput as
//   { filename: <safe basename for disk>, subfolder: '', type: <full https URL> }
// — the engine derives a clean disk path from the basename, and downloadToPath
// fetches the URL carried in `type`. The engine treats subfolder/type opaquely.

import { basename as pathBasename } from 'node:path';
import { streamToPath } from '../utils/stream-to-path.js';
import { TypedError } from '../engine/errors.js';
import type { GenerationProvider, DownloadToPathResult } from './provider.js';
import type { SubmitResponse, StatusResponse, ComfyOutput } from '../comfyui/types.js';

export const DEFAULT_REPLICATE_API_BASE = 'https://api.replicate.com';
export const DEFAULT_REPLICATE_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

// Replicate serves prediction outputs from replicate.delivery (+ the API host).
const DEFAULT_REPLICATE_OUTPUT_HOSTS = ['replicate.delivery', 'replicate.com'];
const MAX_ERROR_MESSAGE_CHARS = 1_000;

export interface ReplicateAdapterOptions {
  fetchImpl?: typeof fetch;
  /** Extra allowlisted output hosts (exact or suffix match), e.g. a CDN mirror. */
  additionalAllowedHosts?: string[];
}

interface ReplicatePrediction {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
}

/** starting|processing|succeeded|failed|canceled → the engine's closed state union. */
export function mapReplicateStatus(raw: unknown): StatusResponse['status'] {
  switch (raw) {
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'cancelled';
    case 'processing':
      return 'in_progress';
    case 'starting':
    default:
      return 'pending';
  }
}

/** Derive a safe on-disk basename from an output URL; fall back to an index name. */
function safeOutputName(url: string, index: number): string {
  let name = '';
  try {
    name = pathBasename(new URL(url).pathname);
  } catch {
    name = '';
  }
  // Strip anything that isn't a conservative filename char; guard empty/dotfiles.
  name = name.replace(/[^A-Za-z0-9._-]/g, '');
  if (!name || name === '.' || name === '..') name = `replicate_output_${index}`;
  return name;
}

/** Flatten Replicate's `output` (string | string[] | object) into ComfyOutput[]. */
export function extractReplicateOutputs(output: unknown): ComfyOutput[] {
  const urls: string[] = [];
  const pushIfUrl = (v: unknown): void => {
    if (typeof v === 'string' && /^https:\/\//i.test(v)) urls.push(v);
  };
  if (typeof output === 'string') pushIfUrl(output);
  else if (Array.isArray(output)) for (const o of output) pushIfUrl(o);
  else if (output && typeof output === 'object')
    for (const v of Object.values(output as Record<string, unknown>)) pushIfUrl(v);
  return urls.map((u, i) => ({ filename: safeOutputName(u, i), subfolder: '', type: u }));
}

export class ReplicateAdapter implements GenerationProvider {
  readonly id = 'replicate';
  private apiKey: string;
  private base: string;
  private fetchImpl: typeof fetch;
  private allowedOutputHosts: string[];

  constructor(
    apiKey: string,
    base: string = DEFAULT_REPLICATE_API_BASE,
    options: ReplicateAdapterOptions = {},
  ) {
    this.apiKey = apiKey;
    this.base = base;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowedOutputHosts = [...DEFAULT_REPLICATE_OUTPUT_HOSTS];
    try {
      this.allowedOutputHosts.push(new URL(base).hostname.toLowerCase());
    } catch {
      /* base validated upstream */
    }
    for (const raw of options.additionalAllowedHosts ?? []) {
      const t = raw.trim().toLowerCase();
      if (t) this.allowedOutputHosts.push(t);
    }
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /** Never let the API token leak into an error surfaced to an agent/log. */
  private scrub(s: string): string {
    let out = s;
    if (this.apiKey && this.apiKey.length >= 4) out = out.replaceAll(this.apiKey, '[redacted]');
    return out.length > MAX_ERROR_MESSAGE_CHARS
      ? out.slice(0, MAX_ERROR_MESSAGE_CHARS) + '...[truncated]'
      : out;
  }

  /** GenerationProvider.validateRequest — Replicate needs { version, input }. */
  validateRequest(spec: Record<string, unknown>): void {
    if (typeof spec.version !== 'string' || spec.version.length === 0) {
      throw new TypedError(
        'INVALID_REQUEST_FORMAT',
        'Replicate request must include a non-empty string `version` (model version id).',
        'Submit { version: "owner/model:versionhash", input: { ... } }.',
      );
    }
    if (typeof spec.input !== 'object' || spec.input === null || Array.isArray(spec.input)) {
      throw new TypedError(
        'INVALID_REQUEST_FORMAT',
        'Replicate request must include an `input` object.',
        'Submit { version, input: { prompt: "...", ... } }.',
      );
    }
  }

  async submit(request: Record<string, unknown>): Promise<SubmitResponse> {
    const url = new URL('/v1/predictions', this.base);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ version: request.version, input: request.input }),
        redirect: 'manual',
      });
    } catch (err) {
      throw new TypedError(
        'REPLICATE_API_ERROR',
        `Replicate submit failed: ${this.scrub((err as Error)?.message ?? String(err))}`,
      );
    }
    if (res.status === 429) {
      throw new TypedError(
        'REPLICATE_API_ERROR',
        'Replicate rate limit reached (HTTP 429)',
        'Wait for in-flight predictions to finish and retry; check your Replicate plan concurrency.',
      );
    }
    if (!res.ok) {
      const body = this.scrub(await res.text().catch(() => ''));
      throw new TypedError(
        'REPLICATE_API_ERROR',
        `Replicate submit failed: ${res.status} ${res.statusText} ${body}`.trim(),
      );
    }
    const json = (await res.json().catch(() => ({}))) as ReplicatePrediction;
    if (!json.id) {
      throw new TypedError('REPLICATE_API_ERROR', 'Replicate submit response missing prediction id');
    }
    return { prompt_id: json.id };
  }

  async status(jobId: string): Promise<StatusResponse> {
    const url = new URL(`/v1/predictions/${encodeURIComponent(jobId)}`, this.base);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'GET', headers: this.headers(), redirect: 'manual' });
    } catch (err) {
      throw new TypedError(
        'REPLICATE_API_ERROR',
        `Replicate status failed: ${this.scrub((err as Error)?.message ?? String(err))}`,
      );
    }
    if (!res.ok) {
      const body = this.scrub(await res.text().catch(() => ''));
      throw new TypedError(
        'REPLICATE_API_ERROR',
        `Replicate status failed: ${res.status} ${res.statusText} ${body}`.trim(),
      );
    }
    const p = (await res.json().catch(() => ({}))) as ReplicatePrediction;
    const state = mapReplicateStatus(p.status);
    const out: StatusResponse = { status: state };
    if (state === 'completed') out.outputs = extractReplicateOutputs(p.output);
    if (state === 'failed' && p.error != null) out.error = p.error;
    return out;
  }

  /**
   * `filename` is the safe basename; the actual source URL rides in `opts.type`
   * (see OUTPUT MODELLING note at top). Streams to destPath with an https-only +
   * host-allowlist SSRF guard, byte cap, and atomic temp-then-rename write.
   */
  async downloadToPath(
    filename: string,
    opts: { subfolder?: string; type?: string },
    destPath: string,
    options: { maxBytes?: number } = {},
  ): Promise<DownloadToPathResult> {
    const maxBytes = options.maxBytes ?? DEFAULT_REPLICATE_DOWNLOAD_MAX_BYTES;
    const source = opts.type && /^https:\/\//i.test(opts.type) ? opts.type : filename;

    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new TypedError('DOWNLOAD_FAILED', `Replicate output is not a valid URL: ${source}`);
    }
    if (url.protocol !== 'https:') {
      throw new TypedError('DOWNLOAD_FAILED', `Refusing non-https Replicate output (${url.protocol})`);
    }
    if (!this.isAllowedHost(url.hostname.toLowerCase())) {
      throw new TypedError(
        'DOWNLOAD_FAILED',
        `Replicate output host not allowlisted: ${url.hostname}`,
        'Add the host to REPLICATE_ALLOWED_OUTPUT_HOSTS if this is a legitimate delivery mirror.',
      );
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'GET', redirect: 'manual' });
    } catch (err) {
      throw new TypedError(
        'DOWNLOAD_FAILED',
        `Replicate download failed: ${this.scrub((err as Error)?.message ?? String(err))}`,
      );
    }
    // redirect:'manual' — a 3xx from a delivery host is unexpected; reject (SSRF).
    if (res.status >= 300 && res.status < 400) {
      throw new TypedError('DOWNLOAD_FAILED', `Unexpected redirect (${res.status}) from Replicate output host`);
    }
    if (!res.ok || !res.body) {
      throw new TypedError('DOWNLOAD_FAILED', `Replicate download failed: ${res.status} ${res.statusText}`.trim());
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
      ({ bytes } = await streamToPath(res.body, destPath, { maxBytes, filenameForError: filename }));
    } catch (err) {
      throw new TypedError(
        'DOWNLOAD_FAILED',
        `Failed to stream Replicate output '${filename}' to disk: ${(err as Error).message}`,
      );
    }
    return {
      path: destPath,
      url: url.toString(),
      contentType,
      sizeBytes: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : bytes,
    };
  }

  /**
   * Replicate has no embedded prompt blob (outputs are URLs, not PNGs with a
   * resolved graph). Provenance for URL providers comes from the request/response,
   * not a post-hoc file read — so this returns null and the engine degrades to
   * its PROVENANCE_UNAVAILABLE path (never throws).
   */
  async fetchResolvedPrompt(_pngPath: string): Promise<Record<string, unknown> | null> {
    return null;
  }

  private isAllowedHost(host: string): boolean {
    return this.allowedOutputHosts.some((a) => host === a || host.endsWith('.' + a));
  }
}
