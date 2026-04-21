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

export class ComfyUIClient {
  private allowed: RegExp[];
  private fetchImpl: typeof fetch;

  constructor(
    private apiKey: string,
    private base: string,
    options: ComfyUIClientOptions = {},
  ) {
    this.allowed = [...DEFAULT_ALLOWED_HOST_PATTERNS];
    // Also accept the configured base origin host verbatim.
    try {
      const baseHost = new URL(base).hostname;
      this.allowed.push(new RegExp(`^${baseHost.replace(/\./g, '\\.')}$`));
    } catch {
      /* ignore — upstream validates base URL */
    }
    for (const raw of options.additionalAllowedHosts ?? []) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      this.allowed.push(new RegExp(`^${trimmed.replace(/\./g, '\\.')}$`));
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
        `ComfyUI network error: ${(err as Error).message}`,
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
      const text = await res.text().catch(() => '');
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* ignore */
      }
      const nodeErrors = (parsed as { node_errors?: unknown } | null)?.node_errors;
      const nodeMessage = extractFirstNodeError(nodeErrors);
      throw new TypedError(
        'COMFYUI_API_ERROR',
        nodeMessage ?? `ComfyUI request failed: ${res.status} ${res.statusText}`,
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
        `ComfyUI network error: ${(err as Error).message}`,
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
        `ComfyUI status request failed: ${res.status} ${res.statusText}`,
      );
    }
    const raw = (await res.json()) as Record<string, unknown>;
    // Accept lenient inputs — status field is canonical; progress/outputs/error are best-effort.
    const status = (raw.status ?? 'pending') as StatusResponse['status'];
    const progress = typeof raw.progress === 'number' ? raw.progress : undefined;
    const outputs = Array.isArray(raw.outputs) ? (raw.outputs as ComfyOutput[]) : undefined;
    const error = 'error' in raw ? raw.error : undefined;
    return { status, progress, outputs, error };
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
    const second = await this.fetchImpl(target, { method: 'GET' });
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
   */
  async downloadToPath(
    filename: string,
    opts: { subfolder?: string; type?: string },
    destPath: string,
  ): Promise<{
    path: string;
    url: string;
    contentType: string;
    sizeBytes: number;
  }> {
    const result = await this.download(filename, opts);
    const partial = `${destPath}.partial`;
    let bytes = 0;
    const writer = createWriteStream(partial);
    try {
      const readable = Readable.fromWeb(
        result.body as unknown as import('node:stream/web').ReadableStream,
      );
      readable.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
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
    return this.allowed.some((re) => re.test(host));
  }
}
