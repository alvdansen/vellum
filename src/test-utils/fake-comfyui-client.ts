import { TypedError } from '../engine/errors.js';
import { streamToPath } from '../utils/stream-to-path.js';
import type { SubmitResponse, StatusResponse, ComfyOutput } from '../comfyui/types.js';
import type { GenerationProvider } from '../providers/provider.js';
import { validateWorkflowFormat } from '../comfyui/format.js';

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
  | 'download-hopeless'
  | 'cancelled-status'
  | 'unknown-status';

export interface FakeDownloadResult {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
  url: string;
}

// `implements GenerationProvider` is deliberate: it makes the test double a
// COMPILE-TIME-CHECKED witness that the interface the engine depends on is
// actually satisfiable by a non-ComfyUI backend. If the contract and this fake
// ever drift, the build breaks here (the point of Phase A).
export class FakeComfyUIClient implements GenerationProvider {
  /** Mirrors the real ComfyUI adapter id (pivot Phase B) — the fake stands in for it. */
  readonly id = 'comfyui-cloud';
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

  /**
   * Phase 3 addition: canned return value for fetchResolvedPrompt. Mirrors the
   * real ComfyUIClient method. Default null exercises the PROVENANCE_UNAVAILABLE
   * path in engine tests; tests set this to a canned blob to exercise the happy
   * prompt-blob-captured path. The real client reads PNG tEXt chunks — this fake
   * skips the filesystem layer since engine tests don't need to exercise PNG
   * parsing (covered independently by png-metadata.test.ts + client.test.ts).
   */
  cannedPromptBlob: Record<string, unknown> | null = null;

  /** For tests needing a specific node_errors response shape on 'failed'. */
  cannedNodeErrors: unknown = {
    '3': {
      errors: [{ type: 'required_input_missing', message: 'bad input' }],
      dependent_outputs: [],
      class_type: 'KSampler',
    },
  };

  /**
   * DEMO-02 parity-test escape hatch (Plan 11-02). When set, the
   * `failed-workflow` scenario uses THIS value verbatim as `StatusResponse.error`
   * (replacing the default `{ node_errors: this.cannedNodeErrors }` wrap). Lets
   * the parity test drive string-error, missing-error, and malformed-error
   * fixtures through the engine's failed branch. `null` (default) means: use
   * the legacy wrap, preserving every pre-existing test's behaviour byte-for-byte.
   *
   * Sentinel: `FakeComfyUIClient.OMIT_ERROR` (a unique symbol) means "emit the
   * failed status with NO error field" (StatusResponse.error === undefined).
   * Distinct from the default `null` which preserves the legacy wrap.
   */
  cannedFailedError: unknown = null;

  /** Sentinel for cannedFailedError to indicate "omit the error field entirely". */
  static OMIT_ERROR = Symbol('OMIT_ERROR');

  private statusCalls = 0;
  private downloadCalls = 0;

  /** C6 test support: track concurrent in-flight status() calls for poller-cap assertions. */
  inFlightStatus = 0;
  maxInFlightStatus = 0;
  /** Artificial delay (ms) inserted into status() to create observable concurrency windows. */
  statusDelayMs = 0;

  /** Mirrors ComfyUIClient.validateRequest so engine+fake tests keep rejecting
   *  malformed workflows through the provider-routed validation path (Phase C). */
  validateRequest(spec: Record<string, unknown>): void {
    validateWorkflowFormat(spec);
  }

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
        // DEMO-02 (Plan 11-02) parity-test escape hatch. Default (null)
        // preserves the legacy `{ node_errors: cannedNodeErrors }` wrap so
        // every pre-existing failed-workflow test continues to behave
        // identically. Setting `cannedFailedError` to a custom value (or to
        // OMIT_ERROR) overrides the wrap so the parity test can drive
        // string-error, missing-error, and malformed-error fixtures through
        // the engine's failed branch.
        if (this.cannedFailedError === FakeComfyUIClient.OMIT_ERROR) {
          return { status: 'failed' } as StatusResponse;
        }
        if (this.cannedFailedError !== null) {
          return {
            status: 'failed',
            error: this.cannedFailedError,
          } as StatusResponse;
        }
        return {
          status: 'failed',
          error: { node_errors: this.cannedNodeErrors },
        } as StatusResponse;
      }
      if (this.scenario === 'cancelled-status') {
        return { status: 'cancelled' } as StatusResponse;
      }
      if (this.scenario === 'unknown-status') {
        // Return a status string outside the canonical enum — the engine's
        // mapState must fall through to 'pending' (no transition fired).
        return { status: 'mystery_state' } as unknown as StatusResponse;
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
    // download() handles scenario-driven failures. downloadToPath delegates
    // to the shared streamToPath helper (IM-02) so the atomic-write invariant
    // lives in exactly one place.
    const result = await this.download(filename, opts);
    let bytes = 0;
    try {
      ({ bytes } = await streamToPath(result.body, destPath, { filenameForError: filename }));
    } catch (err) {
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

  /**
   * Phase 3 addition (D-PROV-05): mirror of the real ComfyUIClient method.
   * Returns `cannedPromptBlob` regardless of path so tests can drive both
   * the null-blob branch (PROVENANCE_UNAVAILABLE reserve) and the captured-blob
   * branch by assigning `fake.cannedPromptBlob = {...}` per test.
   */
  async fetchResolvedPrompt(pngPath: string): Promise<Record<string, unknown> | null> {
    this.calls.push({ method: 'fetchResolvedPrompt', args: [pngPath] });
    return this.cannedPromptBlob;
  }

  reset(): void {
    this.calls = [];
    this.statusCalls = 0;
    this.downloadCalls = 0;
    this.scenario = 'happy';
    this.cannedPromptBlob = null;
    this.cannedFailedError = null; // Plan 11-02 DEMO-02 parity field
  }
}
