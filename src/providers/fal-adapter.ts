// src/providers/fal-adapter.ts
//
// FAL adapter (pivot enhancement #4) — the THIRD GenerationProvider, added to
// further validate the seam (a provider whose shape differs meaningfully from
// Replicate). Raw fetch over FAL's queue REST API (no `@fal-ai/client` dep —
// mirrors the zero-SDK approach). `fetchImpl` injectable for mock-first testing.
//
// PURITY: no MCP SDK, no SQLite/ORM (architecture-purity guards src/providers/).
//
// FAL queue REST shape (differs from Replicate in three ways):
//   auth   : header `Authorization: Key <FAL_KEY>` (not Bearer)
//   submit : POST {base}/{model}                              body = input object
//              -> { request_id, status }
//   status : GET  {base}/{model}/requests/{id}/status         -> { status }
//              native vocabulary: IN_QUEUE | IN_PROGRESS | COMPLETED
//   result : GET  {base}/{model}/requests/{id}                -> model output JSON
//              (e.g. { images: [{ url }] } / { video: { url } } / { audio: { url } })
//
// The status/result endpoints need BOTH the model AND the request id, but the
// engine's status(jobId) receives a single opaque string. So submit() returns a
// COMPOSITE job id `"<model>::<request_id>"` (persisted in versions.job_id, so it
// survives restart + the recovery poller); status() splits it back apart.

import { TypedError } from '../engine/errors.js';
import {
  extractHttpsOutputs,
  guardedStreamDownload,
  resolveAllowedHosts,
} from './url-provider-shared.js';
import type { GenerationProvider, DownloadToPathResult } from './provider.js';
import type { NeutralProvenance } from './provenance.js';
import type { SubmitResponse, StatusResponse, ComfyOutput } from '../comfyui/types.js';

export const DEFAULT_FAL_API_BASE = 'https://queue.fal.run';
export const DEFAULT_FAL_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

// FAL serves outputs from fal.media (+ regional subdomains) and fal.run/fal.ai.
const DEFAULT_FAL_OUTPUT_HOSTS = ['fal.media', 'fal.run', 'fal.ai'];
const MAX_ERROR_MESSAGE_CHARS = 1_000;
const JOB_ID_SEP = '::';
// Model path: dashed segments separated by '/', e.g. fal-ai/flux/dev. No '..'.
const MODEL_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

interface FalStatusResponse {
  status?: string;
  error?: unknown;
}

/** IN_QUEUE|IN_PROGRESS|COMPLETED → the engine's canonical status union. */
export function mapFalStatus(raw: unknown): StatusResponse['status'] {
  switch (raw) {
    case 'COMPLETED':
      return 'completed';
    case 'IN_PROGRESS':
      return 'in_progress';
    case 'IN_QUEUE':
    default:
      return 'pending';
  }
}

/** Flatten a FAL result into ComfyOutput[] (shared recursive extractor). */
export function extractFalOutputs(result: unknown): ComfyOutput[] {
  return extractHttpsOutputs(result, 'fal_output');
}

export interface FalAdapterOptions {
  fetchImpl?: typeof fetch;
  /** Extra allowlisted output hosts (exact or suffix match). */
  additionalAllowedHosts?: string[];
}

export class FalAdapter implements GenerationProvider {
  readonly id = 'fal';
  // URL provider — reproduce re-submits the original { model, input } request.
  readonly reproduceStrategy = 'request-replay' as const;
  private apiKey: string;
  private base: string;
  private fetchImpl: typeof fetch;
  private allowedOutputHosts: string[];

  constructor(apiKey: string, base: string = DEFAULT_FAL_API_BASE, options: FalAdapterOptions = {}) {
    this.apiKey = apiKey;
    this.base = base;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowedOutputHosts = resolveAllowedHosts(base, DEFAULT_FAL_OUTPUT_HOSTS, options.additionalAllowedHosts);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Key ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /** Never let the FAL key leak into an error surfaced to an agent/log. */
  private scrub(s: string): string {
    let out = s;
    if (this.apiKey && this.apiKey.length >= 4) out = out.replaceAll(this.apiKey, '[redacted]');
    return out.length > MAX_ERROR_MESSAGE_CHARS ? out.slice(0, MAX_ERROR_MESSAGE_CHARS) + '...[truncated]' : out;
  }

  /** GenerationProvider.validateRequest — FAL needs { model, input }. */
  validateRequest(spec: Record<string, unknown>): void {
    if (typeof spec.model !== 'string' || !MODEL_RE.test(spec.model) || spec.model.includes('..')) {
      throw new TypedError(
        'INVALID_REQUEST_FORMAT',
        'FAL request must include a `model` path like "fal-ai/flux/dev" ([A-Za-z0-9._-] segments, no "..").',
        'Submit { model: "fal-ai/flux/dev", input: { prompt: "..." } }.',
      );
    }
    if (typeof spec.input !== 'object' || spec.input === null || Array.isArray(spec.input)) {
      throw new TypedError(
        'INVALID_REQUEST_FORMAT',
        'FAL request must include an `input` object.',
        'Submit { model, input: { prompt: "...", ... } }.',
      );
    }
  }

  async submit(request: Record<string, unknown>): Promise<SubmitResponse> {
    const model = request.model as string;
    const url = new URL(`/${model}`, this.base);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(request.input ?? {}),
        redirect: 'manual',
      });
    } catch (err) {
      throw new TypedError('FAL_API_ERROR', `FAL submit failed: ${this.scrub((err as Error)?.message ?? String(err))}`);
    }
    if (res.status === 429) {
      throw new TypedError(
        'FAL_API_ERROR',
        'FAL rate limit reached (HTTP 429)',
        'Wait for in-flight requests to finish and retry; check your FAL plan concurrency.',
      );
    }
    if (!res.ok) {
      const body = this.scrub(await res.text().catch(() => ''));
      throw new TypedError('FAL_API_ERROR', `FAL submit failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    const json = (await res.json().catch(() => ({}))) as { request_id?: string };
    if (!json.request_id) {
      throw new TypedError('FAL_API_ERROR', 'FAL submit response missing request_id');
    }
    // Composite job id so status() can rebuild the per-model queue URL after restart.
    return { prompt_id: `${model}${JOB_ID_SEP}${json.request_id}` };
  }

  async status(jobId: string): Promise<StatusResponse> {
    const sep = jobId.indexOf(JOB_ID_SEP);
    if (sep <= 0) {
      throw new TypedError('FAL_API_ERROR', `Malformed FAL job id '${jobId}' (expected "<model>::<request_id>")`);
    }
    const model = jobId.slice(0, sep);
    const requestId = jobId.slice(sep + JOB_ID_SEP.length);
    const statusUrl = new URL(`/${model}/requests/${encodeURIComponent(requestId)}/status`, this.base);

    let res: Response;
    try {
      res = await this.fetchImpl(statusUrl, { method: 'GET', headers: this.headers(), redirect: 'manual' });
    } catch (err) {
      throw new TypedError('FAL_API_ERROR', `FAL status failed: ${this.scrub((err as Error)?.message ?? String(err))}`);
    }
    if (!res.ok) {
      const body = this.scrub(await res.text().catch(() => ''));
      throw new TypedError('FAL_API_ERROR', `FAL status failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    const s = (await res.json().catch(() => ({}))) as FalStatusResponse;
    const state = mapFalStatus(s.status);
    if (state !== 'completed') {
      return { status: state };
    }

    // COMPLETED — fetch the result payload and extract downloadable https URLs.
    const resultUrl = new URL(`/${model}/requests/${encodeURIComponent(requestId)}`, this.base);
    let rres: Response;
    try {
      rres = await this.fetchImpl(resultUrl, { method: 'GET', headers: this.headers(), redirect: 'manual' });
    } catch (err) {
      throw new TypedError('FAL_API_ERROR', `FAL result fetch failed: ${this.scrub((err as Error)?.message ?? String(err))}`);
    }
    if (!rres.ok) {
      const body = this.scrub(await rres.text().catch(() => ''));
      return { status: 'failed', error: `FAL result fetch failed: ${rres.status} ${rres.statusText} ${body}`.trim() };
    }
    const result = await rres.json().catch(() => ({}));
    const outputs = extractFalOutputs(result);
    if (outputs.length === 0) {
      return {
        status: 'failed',
        error:
          'FAL request completed but returned no downloadable https output URL — Vellum could not persist an asset.',
      };
    }
    return { status: 'completed', outputs };
  }

  /**
   * `filename` is the safe basename; the source URL rides in opts.type. Streams to
   * destPath via the shared SSRF-guarded download (https + host allowlist + byte cap).
   */
  async downloadToPath(
    filename: string,
    opts: { subfolder?: string; type?: string },
    destPath: string,
    options: { maxBytes?: number } = {},
  ): Promise<DownloadToPathResult> {
    const maxBytes = options.maxBytes ?? DEFAULT_FAL_DOWNLOAD_MAX_BYTES;
    const source = opts.type && /^https:\/\//i.test(opts.type) ? opts.type : filename;
    return guardedStreamDownload({
      filename,
      source,
      destPath,
      fetchImpl: this.fetchImpl,
      allowedHosts: this.allowedOutputHosts,
      maxBytes,
      providerLabel: 'FAL',
      scrub: (s) => this.scrub(s),
      allowlistEnvHint: 'FAL_ALLOWED_OUTPUT_HOSTS',
    });
  }

  /** URL provider — no embedded blob. Provenance comes from the request. */
  async fetchResolvedPrompt(_pngPath: string): Promise<Record<string, unknown> | null> {
    return null;
  }

  /** Pivot #2a — map a FAL { model, input } request into NeutralProvenance. */
  describeProvenance(request: Record<string, unknown>): NeutralProvenance | null {
    const model = typeof request.model === 'string' ? request.model : undefined;
    const input =
      request.input && typeof request.input === 'object' && !Array.isArray(request.input)
        ? (request.input as Record<string, unknown>)
        : {};
    return {
      provider_id: this.id,
      model_id: model,
      params: input,
      models: model ? [{ provider_model_id: model, hash: null, unavailable_reason: 'hosted_provider' }] : [],
    };
  }
}
