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

import { TypedError } from '../engine/errors.js';
import {
  extractHttpsOutputs,
  guardedStreamDownload,
  resolveAllowedHosts,
} from './url-provider-shared.js';
import type { GenerationProvider, DownloadToPathResult } from './provider.js';
import type { NeutralProvenance } from './provenance.js';
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

/**
 * Flatten Replicate's `output` into ComfyOutput[] via the shared recursive,
 * depth/count-bounded extractor. Replicate schemas vary widely (bare URL, array,
 * object, and nested shapes like { video: ["https://…"] }); a shallow scan would
 * silently drop the real asset. Non-https values are ignored; status() treats a
 * completed prediction with zero extractable URLs as a failure. Root-path URLs
 * fall back to `replicate_output_<i>`.
 */
export function extractReplicateOutputs(output: unknown): ComfyOutput[] {
  return extractHttpsOutputs(output, 'replicate_output');
}

export class ReplicateAdapter implements GenerationProvider {
  readonly id = 'replicate';
  // URL provider — no embedded prompt blob, so reproduce re-submits the original
  // { version, input } request recorded at submit time (params-replay), not a
  // resolved graph. See GenerationProvider.reproduceStrategy.
  readonly reproduceStrategy = 'request-replay' as const;
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
    this.allowedOutputHosts = resolveAllowedHosts(
      base,
      DEFAULT_REPLICATE_OUTPUT_HOSTS,
      options.additionalAllowedHosts,
    );
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
    if (state === 'completed') {
      const outputs = extractReplicateOutputs(p.output);
      // A prediction that succeeds but yields no downloadable https URL (e.g. a
      // model returning text/data-URIs) must NOT strand a version as terminally
      // 'completed' with zero assets. Surface it as a failure with an actionable
      // message so the engine records a FAILED version, not a silent empty success.
      if (outputs.length === 0) {
        return {
          status: 'failed',
          error:
            'Replicate prediction succeeded but returned no downloadable https output URL — Vellum could not persist an asset. Output was not an https URL (or nested set of URLs).',
        };
      }
      return { status: 'completed', outputs };
    }
    const out: StatusResponse = { status: state };
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
    // filename is the safe basename; the real source URL rides in opts.type.
    const source = opts.type && /^https:\/\//i.test(opts.type) ? opts.type : filename;
    return guardedStreamDownload({
      filename,
      source,
      destPath,
      fetchImpl: this.fetchImpl,
      allowedHosts: this.allowedOutputHosts,
      maxBytes,
      providerLabel: 'Replicate',
      scrub: (s) => this.scrub(s),
      allowlistEnvHint: 'REPLICATE_ALLOWED_OUTPUT_HOSTS',
    });
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

  /**
   * Pivot #2a — map a Replicate { version, input } request into NeutralProvenance.
   * The `input` bag IS the neutral params; `version` is the model id (weights are
   * hosted, so no local hash — recorded as unavailable). Persisted in
   * generation_result_json at completion for cross-provider diff.
   */
  describeProvenance(request: Record<string, unknown>): NeutralProvenance | null {
    const version = typeof request.version === 'string' ? request.version : undefined;
    const input =
      request.input && typeof request.input === 'object' && !Array.isArray(request.input)
        ? (request.input as Record<string, unknown>)
        : {};
    return {
      provider_id: this.id,
      model_id: version,
      params: input,
      models: version
        ? [{ provider_model_id: version, hash: null, unavailable_reason: 'hosted_provider' }]
        : [],
    };
  }
}
