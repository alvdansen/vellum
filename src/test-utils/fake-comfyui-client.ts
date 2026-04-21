import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { TypedError } from '../engine/errors.js';
import type { SubmitResponse, StatusResponse, ComfyOutput } from '../comfyui/types.js';

/**
 * Test double for the real ComfyUIClient that Plan 02-02 will implement.
 * Mirrors the client's three-method surface (submit/status/download) so engine
 * tests can drive state-machine branches without hitting the network.
 *
 * Pure in-memory spy: no fs, no DB, no network. All invocations recorded in
 * `calls` for assertion; `reset()` clears both calls and counters.
 */

export interface FakeCall {
  method: string;
  args: unknown[];
}

/**
 * Scenario modes alter the fake's canned responses so engine-level tests can
 * drive each branch of the generation state machine.
 *  - happy              : submit ok; status progresses to completed; download ok
 *  - rate-limited       : submit throws COMFYUI_RATE_LIMITED
 *  - submit-error       : submit throws COMFYUI_API_ERROR
 *  - slow-running       : status returns in_progress for `slowRunningPolls` calls
 *                         before returning completed
 *  - failed-workflow    : status returns {status:'failed', error:{node_errors:...}}
 *  - download-flaky     : first `downloadFlakyFailures` download calls throw,
 *                         then subsequent calls succeed
 *  - download-hopeless  : every download call throws COMFYUI_API_ERROR
 */
export type FakeScenario =
  | 'happy'
  | 'rate-limited'
  | 'submit-error'
  | 'slow-running'
  | 'failed-workflow'
  | 'download-flaky'
  | 'download-hopeless';

export interface FakeDownloadResult {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
  url: string;
}

export class FakeComfyUIClient {
  calls: FakeCall[] = [];
  scenario: FakeScenario = 'happy';

  /** Test-controlled promptId for submit response. */
  cannedPromptId = 'prompt_fake_123';

  /** For slow-running: how many status() calls return 'in_progress' before 'completed'. */
  slowRunningPolls = 2;

  /** For download-flaky: how many download calls must fail before the fake starts succeeding. */
  downloadFlakyFailures = 1;

  /** For tests needing outputs on completed. */
  cannedOutputs: ComfyOutput[] = [{ filename: 'out.png', subfolder: '', type: 'output' }];

  /** For tests needing a specific node_errors response shape on 'failed'. */
  cannedNodeErrors: unknown = {
    '3': {
      errors: [{ type: 'required_input_missing', message: 'bad input' }],
      dependent_outputs: [],
      class_type: 'KSampler',
    },
  };

  private statusCalls = 0;
  private downloadCalls = 0;

  /** C6 test support: track concurrent in-flight status() calls for poller-cap assertions. */
  inFlightStatus = 0;
  maxInFlightStatus = 0;
  /** Artificial delay (ms) inserted into status() to create observable concurrency windows. */
  statusDelayMs = 0;

  async submit(workflowJson: Record<string, unknown>): Promise<SubmitResponse> {
    this.calls.push({ method: 'submit', args: [workflowJson] });
    if (this.scenario === 'rate-limited') {
      throw new TypedError(
        'COMFYUI_RATE_LIMITED',
        'ComfyUI concurrency limit reached',
        'ComfyUI concurrency limit reached (Free: 1, Creator: 3, Pro: 5 concurrent jobs). Wait for an in-flight generation to complete and retry.',
      );
    }
    if (this.scenario === 'submit-error') {
      throw new TypedError('COMFYUI_API_ERROR', 'Submit failed: 500 Internal Server Error');
    }
    return { prompt_id: this.cannedPromptId };
  }

  async status(jobId: string): Promise<StatusResponse> {
    this.calls.push({ method: 'status', args: [jobId] });
    this.statusCalls++;
    this.inFlightStatus++;
    if (this.inFlightStatus > this.maxInFlightStatus) {
      this.maxInFlightStatus = this.inFlightStatus;
    }
    try {
      if (this.statusDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.statusDelayMs));
      }
      if (this.scenario === 'failed-workflow') {
        return {
          status: 'failed',
          error: { node_errors: this.cannedNodeErrors },
        } as StatusResponse;
      }
      if (this.scenario === 'slow-running' && this.statusCalls <= this.slowRunningPolls) {
        return {
          status: 'in_progress',
          progress: this.statusCalls / (this.slowRunningPolls + 1),
        };
      }
      // happy / slow-running-after-N / download-* scenarios complete here
      return { status: 'completed', outputs: this.cannedOutputs };
    } finally {
      this.inFlightStatus--;
    }
  }

  async download(
    filename: string,
    opts: { subfolder?: string; type?: string } = {},
  ): Promise<FakeDownloadResult> {
    this.calls.push({ method: 'download', args: [filename, opts] });
    this.downloadCalls++;
    if (this.scenario === 'download-hopeless') {
      throw new TypedError('COMFYUI_API_ERROR', `Download failed: ${filename}`);
    }
    if (
      this.scenario === 'download-flaky' &&
      this.downloadCalls <= this.downloadFlakyFailures
    ) {
      throw new TypedError(
        'COMFYUI_API_ERROR',
        `Transient download failure (attempt ${this.downloadCalls})`,
      );
    }
    // Return a small in-memory stream
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header — 4 bytes
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return {
      body: stream,
      contentType: 'image/png',
      contentLength: bytes.byteLength,
      url: `https://storage.googleapis.com/comfy-fake/${filename}`,
    };
  }

  /**
   * Mirror of the real ComfyUIClient.downloadToPath — temp-then-rename atomic
   * write. Delegates to `download()` for scenario-driven failures (hopeless,
   * flaky) so test counters work uniformly across the 2-method surface.
   *
   * Added in Plan 02-02 Task 2 (Rule 2 auto-add): the GenerationEngine's
   * downloadAndPersist calls `client.downloadToPath(filename, opts, destPath)`
   * directly; without this method the fake breaks the engine contract.
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
    // download() handles scenario-driven failures. downloadToPath delegates,
    // consumes the body, and writes to disk atomically.
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
        `Fake failed to stream '${filename}' to disk: ${(err as Error).message}`,
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

  reset(): void {
    this.calls = [];
    this.statusCalls = 0;
    this.downloadCalls = 0;
    this.scenario = 'happy';
  }
}
