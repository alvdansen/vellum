// src/providers/byteplus-adapter.ts
//
// BytePlus ModelArk adapter (Stage-4 video lane — Seedance 2.0) — the FOURTH
// GenerationProvider. Raw fetch over ModelArk's content-generation TASKS API
// (no vendor SDK dep — mirrors the zero-SDK approach of the Replicate/FAL
// adapters). `fetchImpl` injectable for mock-first testing.
//
// PURITY: no MCP SDK, no SQLite/ORM (architecture-purity guards src/providers/).
//
// ModelArk tasks REST shape (async video generation):
//   auth   : header `Authorization: Bearer <ARK API key>`
//   submit : POST {base}/contents/generations/tasks
//              body = { model, content } where model is e.g.
//              'dreamina-seedance-2-0-260128' and content is an array of parts
//              ({type:'text',text:...} plus image/video reference parts)
//              -> { id: <task id>, ... }
//   status : GET  {base}/contents/generations/tasks/{id}
//              -> { id, status, content?: { video_url }, error? }
//              native vocabulary: queued|running|succeeded|failed|cancelled
//
// NOTE the base URL carries a path segment (/api/v3), so endpoint URLs are
// built by appending to the base — never via `new URL('/path', base)`, which
// would silently drop /api/v3.

import { TypedError } from '../engine/errors.js';
import {
  extractHttpsOutputs,
  guardedStreamDownload,
  resolveAllowedHosts,
} from './url-provider-shared.js';
import type { GenerationProvider, DownloadToPathResult } from './provider.js';
import type { NeutralProvenance } from './provenance.js';
import type { SubmitResponse, StatusResponse, ComfyOutput } from '../comfyui/types.js';

export const DEFAULT_BYTEPLUS_API_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
export const DEFAULT_BYTEPLUS_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

// ModelArk delivers generated video from TOS (BytePlus object storage) delivery
// domains. Suffix matching covers tos-*.bytepluses.com style subdomains.
// VERIFY on first production run: inspect a live task's `content.video_url`
// host — if ModelArk delivers from a domain outside this set, extend it via
// BYTEPLUS_ALLOWED_OUTPUT_HOSTS rather than editing this default.
const DEFAULT_BYTEPLUS_OUTPUT_HOSTS = ['bytepluses.com', 'volces.com', 'byteplusapi.com'];
const MAX_ERROR_MESSAGE_CHARS = 1_000;
const TASKS_PATH = '/contents/generations/tasks';

interface ByteplusTaskResponse {
  id?: string;
  status?: string;
  content?: unknown;
  error?: unknown;
}

/** queued|running|succeeded|failed|cancelled → the engine's canonical status union. */
export function mapByteplusStatus(raw: unknown): StatusResponse['status'] {
  switch (raw) {
    case 'succeeded':
      return 'completed';
    case 'running':
      return 'in_progress';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'queued':
    default:
      return 'pending';
  }
}

/** Flatten a ModelArk task result into ComfyOutput[] (shared recursive extractor). */
export function extractByteplusOutputs(result: unknown): ComfyOutput[] {
  return extractHttpsOutputs(result, 'byteplus_output');
}

export interface ByteplusAdapterOptions {
  fetchImpl?: typeof fetch;
  /** Extra allowlisted output hosts (exact or suffix match). */
  additionalAllowedHosts?: string[];
}

export class ByteplusAdapter implements GenerationProvider {
  readonly id = 'byteplus';
  // URL provider — reproduce re-submits the original { model, content } request.
  readonly reproduceStrategy = 'request-replay' as const;
  private apiKey: string;
  private base: string;
  private fetchImpl: typeof fetch;
  private allowedOutputHosts: string[];

  constructor(
    apiKey: string,
    base: string = DEFAULT_BYTEPLUS_API_BASE,
    options: ByteplusAdapterOptions = {},
  ) {
    this.apiKey = apiKey;
    this.base = base;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowedOutputHosts = resolveAllowedHosts(
      base,
      DEFAULT_BYTEPLUS_OUTPUT_HOSTS,
      options.additionalAllowedHosts,
    );
  }

  /** Append a path to the base WITHOUT clobbering its /api/v3 prefix. */
  private endpoint(path: string): URL {
    return new URL(this.base.replace(/\/+$/, '') + path);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /** Never let the ARK API key leak into an error surfaced to an agent/log. */
  private scrub(s: string): string {
    let out = s;
    if (this.apiKey && this.apiKey.length >= 4) out = out.replaceAll(this.apiKey, '[redacted]');
    return out.length > MAX_ERROR_MESSAGE_CHARS ? out.slice(0, MAX_ERROR_MESSAGE_CHARS) + '...[truncated]' : out;
  }

  /** GenerationProvider.validateRequest — ModelArk needs { model, content[] }. */
  validateRequest(spec: Record<string, unknown>): void {
    if (typeof spec.model !== 'string' || spec.model.trim() === '') {
      throw new TypedError(
        'INVALID_REQUEST_FORMAT',
        'BytePlus ModelArk request must include a `model` id like "dreamina-seedance-2-0-260128".',
        'Submit { model: "dreamina-seedance-2-0-260128", content: [{ type: "text", text: "..." }] }.',
      );
    }
    if (!Array.isArray(spec.content)) {
      throw new TypedError(
        'INVALID_REQUEST_FORMAT',
        'BytePlus ModelArk request must include a `content` array of parts.',
        'Submit { model, content: [{ type: "text", text: "..." }, ...image/video reference parts] }.',
      );
    }
  }

  async submit(request: Record<string, unknown>): Promise<SubmitResponse> {
    const url = this.endpoint(TASKS_PATH);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(request),
        redirect: 'manual',
      });
    } catch (err) {
      throw new TypedError(
        'BYTEPLUS_API_ERROR',
        `BytePlus submit failed: ${this.scrub((err as Error)?.message ?? String(err))}`,
      );
    }
    if (res.status === 429) {
      throw new TypedError(
        'BYTEPLUS_API_ERROR',
        'BytePlus ModelArk rate limit reached (HTTP 429)',
        'ModelArk beta limits: 2 requests/sec and 3 concurrent tasks. Wait for in-flight tasks to finish and retry.',
      );
    }
    if (!res.ok) {
      const body = this.scrub(await res.text().catch(() => ''));
      throw new TypedError(
        'BYTEPLUS_API_ERROR',
        `BytePlus submit failed: ${res.status} ${res.statusText} ${body}`.trim(),
      );
    }
    const json = (await res.json().catch(() => ({}))) as ByteplusTaskResponse;
    if (!json.id) {
      throw new TypedError('BYTEPLUS_API_ERROR', 'BytePlus submit response missing task id');
    }
    return { prompt_id: json.id };
  }

  async status(jobId: string): Promise<StatusResponse> {
    const url = this.endpoint(`${TASKS_PATH}/${encodeURIComponent(jobId)}`);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'GET', headers: this.headers(), redirect: 'manual' });
    } catch (err) {
      throw new TypedError(
        'BYTEPLUS_API_ERROR',
        `BytePlus status failed: ${this.scrub((err as Error)?.message ?? String(err))}`,
      );
    }
    if (!res.ok) {
      const body = this.scrub(await res.text().catch(() => ''));
      throw new TypedError(
        'BYTEPLUS_API_ERROR',
        `BytePlus status failed: ${res.status} ${res.statusText} ${body}`.trim(),
      );
    }
    const task = (await res.json().catch(() => ({}))) as ByteplusTaskResponse;
    const state = mapByteplusStatus(task.status);
    if (state === 'completed') {
      // succeeded — the video URL sits nested under content (e.g. { video_url }).
      // Walk the whole response so schema drift (a renamed key) cannot silently
      // drop the asset; zero https URLs is a FAILURE, never an empty success.
      const outputs = extractByteplusOutputs(task);
      if (outputs.length === 0) {
        return {
          status: 'failed',
          error:
            'BytePlus ModelArk task succeeded but returned no downloadable https output URL — Vellum could not persist an asset.',
        };
      }
      return { status: 'completed', outputs };
    }
    const out: StatusResponse = { status: state };
    if (state === 'failed' && task.error != null) out.error = task.error;
    return out;
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
    const maxBytes = options.maxBytes ?? DEFAULT_BYTEPLUS_DOWNLOAD_MAX_BYTES;
    const source = opts.type && /^https:\/\//i.test(opts.type) ? opts.type : filename;
    return guardedStreamDownload({
      filename,
      source,
      destPath,
      fetchImpl: this.fetchImpl,
      allowedHosts: this.allowedOutputHosts,
      maxBytes,
      providerLabel: 'BytePlus',
      scrub: (s) => this.scrub(s),
      allowlistEnvHint: 'BYTEPLUS_ALLOWED_OUTPUT_HOSTS',
    });
  }

  /** URL provider — no embedded blob. Provenance comes from the request. */
  async fetchResolvedPrompt(_pngPath: string): Promise<Record<string, unknown> | null> {
    return null;
  }

  /** Pivot #2a — map a ModelArk { model, content } request into NeutralProvenance. */
  describeProvenance(request: Record<string, unknown>): NeutralProvenance | null {
    const { model: rawModel, ...rest } = request;
    const model = typeof rawModel === 'string' ? rawModel : undefined;
    return {
      provider_id: this.id,
      model_id: model,
      params: rest,
      models: model ? [{ provider_model_id: model, hash: null, unavailable_reason: 'hosted_provider' }] : [],
    };
  }
}
