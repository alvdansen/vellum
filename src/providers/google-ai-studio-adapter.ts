// src/providers/google-ai-studio-adapter.ts
//
// Google AI Studio (Gemini / "Nano Banana") adapter — the FIFTH GenerationProvider
// and the THIRD adapter FAMILY. ComfyUI replays a resolved node graph; Replicate/
// FAL/BytePlus poll a URL job. Gemini image generation is SYNCHRONOUS and returns
// the image as INLINE BASE-64 in the generateContent response — there is no job to
// poll and no URL to fetch. This adapter owns decoding + writing those bytes itself
// (downloadToPath writes decoded base64, never fetches), so the SSRF/allowlist
// machinery the URL adapters share does not apply here at all.
//
// Bridging a synchronous API onto the engine's submit → status → download lifecycle:
//   • submit()  performs the generation (credits spend HERE), decodes the returned
//               image parts, and STAGES them to a per-job temp directory on disk.
//               Returns { prompt_id: <job id> }.
//   • status()  returns `completed` immediately with one output locator per staged
//               image (job id in `subfolder`, image index in `type`).
//   • downloadToPath() reads the staged file for (subfolder=job id, type=index),
//               atomically writes it to destPath, deletes the staged file, and drops
//               the job once its last image is written. url is the sentinel
//               `inline:base64` (greppable — "where did this come from?" → decoded
//               in-process, not fetched).
//
// WHY DISK STAGING, not an in-memory buffer: a caller often submits a whole batch
// of shots and THEN polls them. Holding every generated image in RAM until download
// would either blow memory or force an eviction cap that silently DESTROYS a paid,
// not-yet-downloaded generation. Staging to disk keeps only tiny metadata in memory,
// so any number of jobs can be in flight. A process restart still loses in-flight
// staged jobs (status then reports `failed`, re-runnable — Gemini is non-deterministic
// so a re-run is a new take anyway); the directories they left behind are swept on
// the next submit, including across restarts — which is why the staging root is
// deterministic rather than per-instance random.
//
// PURITY: no MCP SDK, no SQLite/ORM (architecture-purity guards src/providers/).

import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { TypedError } from '../engine/errors.js';
import { PROVIDER_INLINE_GENERATION_TIMEOUT_MS, timeoutSignal } from '../utils/http-timeout.js';
import { streamToPath } from '../utils/stream-to-path.js';
import type { GenerationProvider, DownloadToPathResult } from './provider.js';
import type { NeutralProvenance } from './provenance.js';
import type { SubmitResponse, StatusResponse, ComfyOutput } from '../comfyui/types.js';

export const DEFAULT_GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GOOGLE_MODEL = 'gemini-2.5-flash-image';
export const DEFAULT_GOOGLE_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
/** StoredOutput.url sentinel for inline-decoded outputs (mirrors DIRECT_UPLOAD_URL). */
export const INLINE_OUTPUT_URL = 'inline:base64';
/** Sweep staged job dirs older than this on each submit (orphan-download cleanup). */
const STAGE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ERROR_MESSAGE_CHARS = 1_000;
/** Reject a response whose Content-Length declares more than this before reading it. */
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;

interface GeminiInlineData {
  mimeType?: string;
  data?: string;
}
interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string; safetyRatings?: unknown };
  error?: { message?: string; status?: string };
}

interface StagedImage {
  path: string;
  mime: string;
  filename: string;
}
interface StageEntry {
  /** One slot per produced image; nulled as each is written out. */
  images: Array<StagedImage | null>;
  createdAt: number;
}

/** Map a returned image mime type to a safe file extension. */
function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    default:
      return 'bin';
  }
}

/** Strip a `data:<mime>;base64,` prefix Gemini does not send but a caller/mock might. */
function stripDataUri(b64: string): string {
  const m = /^data:[^;,]*;base64,/i.exec(b64);
  return m ? b64.slice(m[0].length) : b64;
}

export interface GoogleAIStudioAdapterOptions {
  fetchImpl?: typeof fetch;
  /** Deadline for the generateContent call. Tests drive a short one. */
  requestTimeoutMs?: number;
  /** Default model when a request omits one. */
  defaultModel?: string;
  /** Override the on-disk staging root (tests). Defaults under os.tmpdir(). */
  stagingRoot?: string;
}

export class GoogleAIStudioAdapter implements GenerationProvider {
  readonly id = 'google-ai-studio';
  readonly apiErrorCode = 'GOOGLE_API_ERROR' as const;
  // No embedded blob + non-deterministic sampling — reproduce re-submits the
  // ORIGINAL request (request-replay), never claimed to be byte-identical.
  readonly reproduceStrategy = 'request-replay' as const;
  private apiKey: string;
  private base: string;
  private fetchImpl: typeof fetch;
  private defaultModel: string;
  private requestTimeoutMs: number;
  private stagingRoot: string;
  /** jobId → staged image metadata (tiny; the bytes live on disk, not here). */
  private stage = new Map<string, StageEntry>();

  constructor(
    apiKey: string,
    base: string = DEFAULT_GOOGLE_API_BASE,
    options: GoogleAIStudioAdapterOptions = {},
  ) {
    this.apiKey = apiKey;
    this.base = base;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultModel = options.defaultModel ?? DEFAULT_GOOGLE_MODEL;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? PROVIDER_INLINE_GENERATION_TIMEOUT_MS;
    // Staging root is DETERMINISTIC, not per-instance-random. A random root
    // meant every boot minted a new directory that no later process could ever
    // find, so the sweep below could not reach anything an earlier run left —
    // and even a fully clean run leaked one empty directory per server start.
    //
    // Scoped by uid because os.tmpdir() is /tmp (mode 1777) on Linux: a bare
    // shared name would be created 0755 by whichever local user got there first,
    // and every other user's job-dir mkdir would then fail EACCES *after* the
    // generation had already been billed. Job dirs are gais_<nanoid(21)>, so
    // concurrent instances sharing a root still cannot collide.
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    this.stagingRoot =
      options.stagingRoot ?? path.join(os.tmpdir(), `vellum-gais-staging-${uid}`);
  }

  /**
   * Build the generateContent URL. Accepts a bare model id ('gemini-2.5-flash-image')
   * OR a canonical resource name ('models/…' / 'tunedModels/…' — what ListModels
   * returns). Each path segment is encoded individually so the resource slash is
   * preserved (encodeURIComponent on the whole name would turn 'models/x' into
   * 'models%2Fx' and 404).
   */
  private generateUrl(model: string): URL {
    const resource = model.includes('/') ? model : `models/${model}`;
    const encoded = resource
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    return new URL(`${this.base.replace(/\/+$/, '')}/${encoded}:generateContent`);
  }

  /** Never let the API key leak into an error surfaced to an agent/log. */
  private scrub(s: string): string {
    let out = s;
    if (this.apiKey && this.apiKey.length >= 4) out = out.replaceAll(this.apiKey, '[redacted]');
    return out.length > MAX_ERROR_MESSAGE_CHARS
      ? out.slice(0, MAX_ERROR_MESSAGE_CHARS) + '...[truncated]'
      : out;
  }

  /** GenerationProvider.validateRequest — need a `prompt` string OR a `contents` array. */
  validateRequest(spec: Record<string, unknown>): void {
    const hasPrompt = typeof spec.prompt === 'string' && spec.prompt.trim() !== '';
    const hasContents = Array.isArray(spec.contents) && spec.contents.length > 0;
    if (!hasPrompt && !hasContents) {
      throw new TypedError(
        'INVALID_REQUEST_FORMAT',
        'Google AI Studio request must include a non-empty `prompt` string or a `contents` array.',
        'Submit { prompt: "a watercolor storybook interior" } or a native { contents: [{ parts: [{ text: "..." }] }] }.',
      );
    }
    if (spec.model !== undefined && (typeof spec.model !== 'string' || spec.model.trim() === '')) {
      throw new TypedError(
        'INVALID_REQUEST_FORMAT',
        'Google AI Studio request `model`, when provided, must be a non-empty string.',
        `Omit it to use '${this.defaultModel}', or pass e.g. { model: "gemini-2.5-flash-image" }.`,
      );
    }
  }

  /**
   * Resolve the model + build the native generateContent body. Convenience keys
   * `prompt` and `model` are consumed here; EVERY other key (contents,
   * generationConfig, safetySettings, systemInstruction, imageConfig, tools, …) is
   * forwarded VERBATIM so a caller can drive any current/future Gemini feature — a
   * whitelist would silently drop a misplaced field and spend quota on the wrong shape.
   */
  private buildBody(request: Record<string, unknown>): { model: string; body: Record<string, unknown> } {
    const model =
      typeof request.model === 'string' && request.model.trim() ? request.model : this.defaultModel;
    const { prompt, model: _model, contents, ...rest } = request;
    const resolvedContents = Array.isArray(contents)
      ? contents
      : [{ parts: [{ text: String(prompt ?? '') }] }];
    return { model, body: { contents: resolvedContents, ...rest } };
  }

  /** Pull every inline image part out of a generateContent response. */
  private extractImages(json: GeminiResponse): Array<{ bytes: Buffer; mime: string }> {
    const images: Array<{ bytes: Buffer; mime: string }> = [];
    for (const cand of json.candidates ?? []) {
      for (const part of cand.content?.parts ?? []) {
        const raw = part.inlineData?.data;
        const mime = part.inlineData?.mimeType;
        if (typeof raw === 'string' && raw.length > 0 && typeof mime === 'string' && mime.startsWith('image/')) {
          const bytes = Buffer.from(stripDataUri(raw), 'base64');
          if (bytes.byteLength > 0) images.push({ bytes, mime });
        }
      }
    }
    return images;
  }

  /** Build a human-readable failure message when a response carried no image. */
  private noImageError(json: GeminiResponse): string {
    const block = json.promptFeedback?.blockReason;
    if (block) return `Google AI Studio blocked the request (${block}).`;
    const finish = json.candidates?.[0]?.finishReason;
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ');
    const detail = [finish ? `finishReason=${finish}` : '', text ? `model said: ${text}` : '']
      .filter(Boolean)
      .join('; ');
    return `Google AI Studio returned no image${detail ? ` (${detail})` : ''}.`;
  }

  /**
    * Delete staged job dirs older than the TTL (best-effort orphan cleanup).
    *
    * Two passes, because the in-memory one alone cannot see an orphan. `stage`
    * only holds jobs THIS process staged, so anything left behind by a previous
    * run — a crash, a SIGKILL, or just a graceful exit with a job still in
    * flight, since shutdown does not touch providers — was invisible to it and
    * stayed on disk forever.
    *
    * The filesystem pass deletes only directories older than the same TTL the
    * owning process applies to itself, so a live concurrent instance loses
    * nothing it would not have swept on its own next submit.
    */
  private async sweepStale(now: number): Promise<void> {
    for (const [jobId, entry] of this.stage) {
      if (now - entry.createdAt > STAGE_TTL_MS) {
        this.stage.delete(jobId);
        await fsp.rm(path.join(this.stagingRoot, jobId), { recursive: true, force: true }).catch(() => undefined);
      }
    }

    let names: string[];
    try {
      names = await fsp.readdir(this.stagingRoot);
    } catch {
      return; // root does not exist yet — nothing to sweep
    }
    for (const name of names) {
      if (!name.startsWith('gais_') || this.stage.has(name)) continue;
      const dir = path.join(this.stagingRoot, name);
      try {
        const st = await fsp.stat(dir);
        if (now - st.mtimeMs > STAGE_TTL_MS) {
          await fsp.rm(dir, { recursive: true, force: true });
        }
      } catch {
        /* raced with another instance sweeping the same dir — fine */
      }
    }
  }

  async submit(request: Record<string, unknown>): Promise<SubmitResponse> {
    const { model, body } = this.buildBody(request);
    const url = this.generateUrl(model);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'manual',
        // Hang-breaker, not a latency budget: this single call performs the
        // whole generation (Gemini is synchronous), so the deadline sits well
        // above normal image-generation latency. Without it a wedged socket
        // hangs the caller forever — Node's fetch has no default timeout.
        signal: timeoutSignal(this.requestTimeoutMs),
      });
    } catch (err) {
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio submit failed: ${this.scrub((err as Error)?.message ?? String(err))}`,
        undefined,
        true, // no response came back — generation may have run and been billed
      );
    }
    if (res.status === 429) {
      // Surface Google's own quota detail (metric + retryDelay) — a hardcoded
      // "free tier exhausted" guess is wrong for a paid key hitting a per-minute cap.
      const detail = this.scrub(await res.text().catch(() => ''));
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio rate limit reached (HTTP 429).${detail ? ` ${detail}` : ''}`.trim(),
        'Wait for the quota window named in the response to reset and retry, or route this generation to another provider.',
      );
    }
    if (!res.ok) {
      const bodyText = this.scrub(await res.text().catch(() => ''));
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio submit failed: ${res.status} ${res.statusText} ${bodyText}`.trim(),
      );
    }
    // Bound buffering of an unexpectedly huge response before reading it into memory.
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio response is ${declared} bytes — exceeds the ${MAX_RESPONSE_BYTES}-byte cap.`,
      );
    }
    const json = (await res.json().catch(() => ({}))) as GeminiResponse;
    const images = this.extractImages(json);
    if (images.length === 0) {
      // A response with no image is a FAILURE (safety block / text-only refusal),
      // never an empty success — spend happened, so surface why.
      throw new TypedError('GOOGLE_API_ERROR', this.scrub(this.noImageError(json)));
    }
    const oversize = images.find((im) => im.bytes.byteLength > DEFAULT_GOOGLE_DOWNLOAD_MAX_BYTES);
    if (oversize) {
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio returned a ${oversize.bytes.byteLength}-byte image — exceeds the ${DEFAULT_GOOGLE_DOWNLOAD_MAX_BYTES}-byte cap.`,
      );
    }

    const now = Date.now();
    await this.sweepStale(now);

    const jobId = `gais_${nanoid()}`;
    const jobDir = path.join(this.stagingRoot, jobId);
    // 0700/0600: on a shared Linux host os.tmpdir() is world-writable, and these
    // are generated images the operator paid for.
    await fsp.mkdir(jobDir, { recursive: true, mode: 0o700 });
    const staged: Array<StagedImage | null> = [];
    try {
      for (let i = 0; i < images.length; i++) {
        const { bytes, mime } = images[i]!;
        const filename = `gemini_${i}.${extForMime(mime)}`;
        const p = path.join(jobDir, `${i}.${extForMime(mime)}`);
        await fsp.writeFile(p, bytes, { mode: 0o600 });
        staged.push({ path: p, mime, filename });
      }
    } catch (err) {
      // Staging write failed after spend — clean up and surface, don't leak a half dir.
      await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio could not stage decoded output: ${this.scrub((err as Error)?.message ?? String(err))}`,
      );
    }
    this.stage.set(jobId, { images: staged, createdAt: now });
    return { prompt_id: jobId };
  }

  async status(jobId: string): Promise<StatusResponse> {
    const entry = this.stage.get(jobId);
    if (!entry) {
      // No staged images — never staged, swept, or lost to a restart. Terminal
      // failure; re-run to retry (Gemini is non-deterministic anyway).
      return {
        status: 'failed',
        error:
          'Google AI Studio inline output is no longer staged (server restart or TTL sweep). Re-run the generation.',
      };
    }
    const outputs: ComfyOutput[] = [];
    entry.images.forEach((img, index) => {
      if (img) outputs.push({ filename: img.filename, subfolder: jobId, type: `inline:${index}` });
    });
    if (outputs.length === 0) {
      return { status: 'failed', error: 'Google AI Studio job produced no retained outputs.' };
    }
    return { status: 'completed', outputs };
  }

  /**
   * Write a staged inline image to destPath. `opts.subfolder` is the job id and
   * `opts.type` is `inline:<index>` (both set by status()). No fetch, no SSRF: the
   * bytes are already staged on local disk. Atomic temp-then-rename via streamToPath.
   */
  async downloadToPath(
    filename: string,
    opts: { subfolder?: string; type?: string },
    destPath: string,
    options: { maxBytes?: number } = {},
  ): Promise<DownloadToPathResult> {
    const jobId = opts.subfolder ?? '';
    const rawIndex = (opts.type ?? '').replace(/^inline:/, '');
    const index = Number.parseInt(rawIndex, 10);
    const entry = this.stage.get(jobId);
    const image = entry && Number.isInteger(index) && index >= 0 ? entry.images[index] : null;
    if (!entry || !image) {
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio inline output '${filename}' is no longer staged — re-run the generation.`,
      );
    }
    const maxBytes = options.maxBytes ?? DEFAULT_GOOGLE_DOWNLOAD_MAX_BYTES;
    let bytes: Buffer;
    try {
      bytes = await fsp.readFile(image.path);
    } catch (err) {
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio staged output '${filename}' could not be read: ${this.scrub((err as Error)?.message ?? String(err))}`,
      );
    }
    if (bytes.byteLength > maxBytes) {
      throw new TypedError(
        'GOOGLE_API_ERROR',
        `Google AI Studio output '${filename}' is ${bytes.byteLength} bytes — exceeds the ${maxBytes}-byte cap.`,
      );
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    });
    await streamToPath(stream, destPath, { maxBytes, filenameForError: filename });

    // Consume this image; drop the whole job (and its staged dir) once emptied.
    entry.images[index] = null;
    await fsp.rm(image.path, { force: true }).catch(() => undefined);
    if (entry.images.every((o) => o === null)) {
      this.stage.delete(jobId);
      await fsp.rm(path.join(this.stagingRoot, jobId), { recursive: true, force: true }).catch(() => undefined);
    }

    return {
      path: destPath,
      url: INLINE_OUTPUT_URL,
      contentType: image.mime,
      sizeBytes: bytes.byteLength,
    };
  }

  /** No embedded blob — provenance comes from describeProvenance on the request. */
  async fetchResolvedPrompt(_pngPath: string): Promise<Record<string, unknown> | null> {
    return null;
  }

  /**
   * Pivot #2a — map a Gemini request into NeutralProvenance for cross-provider diff.
   * Inline INPUT image data in `contents` is elided so provenance never balloons
   * with multi-MB base64 (the diff cares about params + model, not pixel payloads).
   */
  describeProvenance(request: Record<string, unknown>): NeutralProvenance | null {
    const { model: rawModel, ...rest } = request;
    const model = typeof rawModel === 'string' && rawModel.trim() ? rawModel : this.defaultModel;
    return {
      provider_id: this.id,
      model_id: model,
      params: elideInlineData(rest) as Record<string, unknown>,
      models: [{ provider_model_id: model, hash: null, unavailable_reason: 'hosted_provider' }],
    };
  }
}

/** Recursively replace any `inlineData.data` base64 payload with a short placeholder. */
function elideInlineData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(elideInlineData);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'inlineData' && v !== null && typeof v === 'object') {
        const inline = v as Record<string, unknown>;
        out[k] = { ...inline, data: typeof inline.data === 'string' ? '[inline data elided]' : inline.data };
      } else {
        out[k] = elideInlineData(v);
      }
    }
    return out;
  }
  return value;
}
