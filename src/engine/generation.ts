import path from 'node:path/posix';
import type { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { BreadcrumbResolver } from './breadcrumb.js';
import { TypedError } from './errors.js';
import { createBackoffIterator, sleep } from './backoff.js';
import { validateWorkflowFormat, extractFirstNodeError } from '../comfyui/format.js';
import {
  buildOutputPath,
  ensureDir,
  resolveCollisionSuffix,
  versionLabel,
} from '../utils/outputs.js';
import type { Version, Breadcrumb } from '../types/hierarchy.js';
import type { ComfyOutput, StatusResponse, StoredOutput } from '../comfyui/types.js';

const GENERATION_TIMEOUT_MS = 600_000; // D-GEN-25: 10 minutes
/**
 * D-GEN-36: per-file download retry schedule.
 *
 * The download loop runs UP TO 3 ATTEMPTS with 2 SLEEPS between them:
 *   attempt 1 → fail → sleep 2s → attempt 2 → fail → sleep 4s → attempt 3 → give up
 *
 * Historical note: an earlier `DOWNLOAD_RETRY_DELAYS = [2_000, 4_000, 8_000]`
 * carried a third value (8s) that was never slept on — the loop exited before
 * the final sleep ran. The dead value misled readers about the real cadence.
 * Renamed to reflect the actual semantics (delays BETWEEN attempts, not per-attempt).
 */
const DOWNLOAD_BETWEEN_ATTEMPT_DELAYS = [2_000, 4_000];
const DOWNLOAD_MAX_ATTEMPTS = DOWNLOAD_BETWEEN_ATTEMPT_DELAYS.length + 1;

/**
 * C6: cap concurrent recovery pollers. ComfyUI Cloud concurrency tiers are
 * Free=1, Creator=3, Pro=5. A boot after crash with N pending rows must NOT
 * fan out N parallel /api/job/{id}/status calls — that would thrash the 429
 * rate-limit path and make recovery itself the thundering herd.
 *
 * Default matches the Creator tier. Override via COMFYUI_MAX_CONCURRENT_POLLS
 * env var at server wiring time (server.ts passes this into the Engine).
 */
const DEFAULT_MAX_CONCURRENT_POLLERS = 3;
/** Bounded jitter (ms) applied to each poller's initial sleep to de-sync boot volleys. */
const POLLER_BOOT_JITTER_MAX_MS = 800;

/**
 * GenerationEngine — owns the version row lifecycle (D-GEN-15..D-GEN-20), the
 * ComfyUI handshake (D-GEN-21..D-GEN-27), download orchestration (D-GEN-32..37),
 * and the on-start recovery poller (D-GEN-28..D-GEN-31). Composed into Engine
 * facade (pipeline.ts) and exposed via `submitGeneration`, `getGenerationStatus`,
 * `start`, `stop`.
 *
 * Invariants:
 *  - Zero MCP SDK imports (D-33, architecture-purity guard).
 *  - Never holds a SQLite write txn across network I/O (Pitfall #6). Submit
 *    follows the two-phase insert → fetch → update pattern.
 *  - "completed" is only reached after every output file lands on disk (D-GEN-32).
 *  - `completed_at` is set at most once (D-GEN-20 — enforced by VersionRepo's
 *    `WHERE completed_at IS NULL` guard on terminal UPDATEs).
 */
export class GenerationEngine {
  private pollers = new Map<string, AbortController>();
  private readonly maxConcurrentPollers: number;

  constructor(
    private hierarchy: HierarchyRepo,
    private versions: VersionRepo,
    private client: ComfyUIClient | null,
    private breadcrumb: BreadcrumbResolver,
    private outputRoot: string = 'outputs',
    options: { maxConcurrentPollers?: number } = {},
  ) {
    const cap = options.maxConcurrentPollers ?? DEFAULT_MAX_CONCURRENT_POLLERS;
    // Clamp to a sane range: at least 1, at most 20 (Pro tier × 4 buffer).
    this.maxConcurrentPollers = Math.max(1, Math.min(20, cap));
  }

  /**
   * Two-phase submit (Pattern 2): shot-exists + format validation → insert row →
   * POST /api/prompt → setJobId. On ComfyUI failure, the row is transitioned to
   * `failed` with the matching code before rethrowing.
   */
  async submitGeneration(
    shotId: string,
    workflowJson: Record<string, unknown>,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    if (!this.client) {
      throw new TypedError(
        'COMFYUI_CREDENTIALS_MISSING',
        'COMFYUI_API_KEY is not set — generation is unavailable',
        'Set COMFYUI_API_KEY in .env at the repo root. See .env.example.',
      );
    }
    // Fail-fast: shot existence + format. No DB writes until both succeed.
    const shot = this.hierarchy.getShot(shotId);
    if (!shot) {
      throw new TypedError(
        'SHOT_NOT_FOUND',
        `Shot '${shotId}' not found`,
        `Verify the shot id with { tool: 'shot', action: 'get' }`,
      );
    }
    validateWorkflowFormat(workflowJson);

    // Two-phase submit: insert row first (version_number = MAX+1 inside txn),
    // then hit ComfyUI. Row exists before any network I/O (Pitfall #6).
    const row = this.versions.insertVersion(shotId, notes);
    try {
      const { prompt_id } = await this.client.submit(workflowJson);
      this.versions.setJobId(row.id, prompt_id);
    } catch (err) {
      // ComfyUI-side failure — transition the row to failed with the matching code.
      if (err instanceof TypedError) {
        this.versions.markFailed(row.id, err.code, err.message);
        throw err;
      }
      this.versions.markFailed(row.id, 'COMFYUI_API_ERROR', String(err));
      throw new TypedError('COMFYUI_API_ERROR', String(err));
    }
    const refreshed = this.versions.getVersion(row.id)!;
    return { entity: refreshed, breadcrumb: this.breadcrumb.resolve('version', row.id) };
  }

  /**
   * Fresh-fetch for non-terminal rows; cached for terminal rows (D-GEN-31).
   * Enforces 10-minute timeout before network call (D-GEN-25). On `completed`
   * from the remote, runs downloadAndPersist — only flips to `completed` after
   * every output lands on disk (D-GEN-32).
   */
  async getGenerationStatus(
    versionId: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    const row = this.versions.getVersion(versionId);
    if (!row) {
      throw new TypedError('VERSION_NOT_FOUND', `Version '${versionId}' not found`);
    }
    // Terminal states: return cached — no API roundtrip (D-GEN-31).
    if (row.status === 'completed' || row.status === 'failed') {
      return { entity: row, breadcrumb: this.breadcrumb.resolve('version', row.id) };
    }
    // 10-minute timeout check (D-GEN-25). Runs BEFORE any network call so a
    // stuck ComfyUI cannot hold the row hostage.
    if (Date.now() - row.created_at > GENERATION_TIMEOUT_MS) {
      this.versions.markFailed(
        row.id,
        'GENERATION_TIMEOUT',
        `Generation did not complete within ${GENERATION_TIMEOUT_MS / 1000}s`,
      );
      const updated = this.versions.getVersion(versionId)!;
      return { entity: updated, breadcrumb: this.breadcrumb.resolve('version', row.id) };
    }
    if (!this.client) {
      throw new TypedError(
        'COMFYUI_CREDENTIALS_MISSING',
        'COMFYUI_API_KEY is not set — cannot fetch status',
        'Set COMFYUI_API_KEY in .env at the repo root. See .env.example.',
      );
    }
    if (!row.job_id) {
      // Edge case: row inserted at submit-time but submit call failed before
      // setJobId (very rare — markFailed runs in the catch in submitGeneration).
      this.versions.markFailed(row.id, 'COMFYUI_API_ERROR', 'Version has no job_id');
      const updated = this.versions.getVersion(versionId)!;
      return { entity: updated, breadcrumb: this.breadcrumb.resolve('version', row.id) };
    }
    const remote = await this.client.status(row.job_id);
    const mapped = this.mapState(remote.status);
    if (mapped === 'completed') {
      await this.downloadAndPersist(row, remote.outputs ?? []);
    } else if (mapped === 'failed') {
      const nodeErrors = (remote.error as { node_errors?: unknown } | undefined)
        ?.node_errors;
      const flat =
        extractFirstNodeError(nodeErrors) ??
        (typeof remote.error === 'string' ? remote.error : 'ComfyUI reported failed');
      this.versions.markFailed(row.id, 'COMFYUI_API_ERROR', flat);
    } else if (mapped === 'running' && row.status !== 'running') {
      this.versions.transition(row.id, 'running');
    }
    const updated = this.versions.getVersion(versionId)!;
    return { entity: updated, breadcrumb: this.breadcrumb.resolve('version', row.id) };
  }

  /** Map ComfyUI status strings onto the Phase 2 state machine (D-GEN-18). */
  private mapState(
    s: StatusResponse['status'],
  ): 'running' | 'completed' | 'failed' | 'pending' {
    if (s === 'completed') return 'completed';
    if (s === 'failed' || s === 'cancelled') return 'failed';
    if (s === 'in_progress' || s === 'pending') return 'running';
    return 'pending';
  }

  /**
   * Download every output to disk with a 3-attempt retry per file (D-GEN-36).
   * Only flips the version to 'completed' after all files land (D-GEN-32). On
   * hopeless download, marks failed with DOWNLOAD_FAILED; previously-downloaded
   * files remain as debug artefacts (D-GEN-36).
   */
  private async downloadAndPersist(row: Version, outputs: ComfyOutput[]): Promise<void> {
    if (!this.client) return; // unreachable via getGenerationStatus guard
    // Resolve the disk path template using the hierarchy chain — need
    // shot/seq/project names. Single-pass walk.
    const shot = this.hierarchy.getShot(row.shot_id)!;
    const seq = this.hierarchy.getSequence(shot.sequence_id)!;
    const proj = this.hierarchy.getProject(seq.project_id)!;
    const vLabel = versionLabel(row.version_number);

    const stored: StoredOutput[] = [];
    for (const out of outputs) {
      const relPath = buildOutputPath({
        projectName: proj.name,
        sequenceName: seq.name,
        shotName: shot.name,
        versionLabel: vLabel,
        filename: out.filename,
        root: this.outputRoot,
      });
      const dir = path.dirname(relPath);
      await ensureDir(dir);
      const finalName = await resolveCollisionSuffix(dir, out.filename);
      const finalPath = path.join(dir, finalName);

      let attempt = 0;
      let lastErr: unknown = null;
      while (attempt < DOWNLOAD_MAX_ATTEMPTS) {
        try {
          const dl = await this.client.downloadToPath(
            out.filename,
            { subfolder: out.subfolder, type: out.type },
            finalPath,
          );
          stored.push({
            filename: finalName,
            path: dl.path,
            url: dl.url,
            content_type: dl.contentType,
            size_bytes: dl.sizeBytes,
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          // Sleep BETWEEN attempts only. After the last attempt there is no sleep —
          // the loop exits and the error propagates to markFailed below.
          if (attempt < DOWNLOAD_BETWEEN_ATTEMPT_DELAYS.length) {
            await sleep(DOWNLOAD_BETWEEN_ATTEMPT_DELAYS[attempt]);
          }
          attempt++;
        }
      }
      if (lastErr) {
        this.versions.markFailed(
          row.id,
          'DOWNLOAD_FAILED',
          `Failed to download output ${out.filename} after ${DOWNLOAD_MAX_ATTEMPTS} attempts`,
        );
        return; // subsequent outputs intentionally left for debug/audit per D-GEN-36
      }
    }
    this.versions.markCompleted(row.id, JSON.stringify(stored));
  }

  /**
   * On-start recovery poller (D-GEN-28, D-GEN-29). For every pending row,
   * spawns an independent async driver that uses createBackoffIterator delays.
   * One AbortController per row, stored in `pollers` for stop() teardown.
   *
   * C6: concurrency is capped at `maxConcurrentPollers`. Extra rows wait in a
   * queue and are launched as earlier pollers reach a terminal state. This
   * prevents thundering-herd behaviour on a post-crash boot with many pending
   * rows (which would instantly hit ComfyUI's 429 rate-limit path).
   */
  async start(): Promise<void> {
    const pending = this.versions.listPendingVersions();
    const queue = [...pending];
    let inFlight = 0;

    const launch = (row: Version): void => {
      inFlight++;
      const controller = new AbortController();
      this.pollers.set(row.id, controller);
      void this.drivePoller(row.id, controller.signal).finally(() => {
        this.pollers.delete(row.id);
        inFlight--;
        // Drain the queue as slots free up.
        while (inFlight < this.maxConcurrentPollers && queue.length > 0) {
          const next = queue.shift()!;
          launch(next);
        }
      });
    };

    // Prime up to `maxConcurrentPollers` slots; the rest drain on completion.
    while (inFlight < this.maxConcurrentPollers && queue.length > 0) {
      const row = queue.shift()!;
      launch(row);
    }
  }

  /** Abort every in-flight poller. Called on SIGINT/SIGTERM from server.ts. */
  async stop(): Promise<void> {
    for (const c of this.pollers.values()) c.abort();
    this.pollers.clear();
  }

  /**
   * Per-row poll loop. Uses createBackoffIterator for delays, an AbortSignal
   * to bail on `stop()`, and delegates to `getGenerationStatus` so the state
   * machine logic stays in one place.
   */
  private async drivePoller(rowId: string, signal: AbortSignal): Promise<void> {
    const delays = createBackoffIterator();
    // C6: bounded jitter on the first iteration de-syncs N parallel pollers so
    // they do not all fire within the same millisecond window at boot.
    const bootJitter = Math.floor(Math.random() * POLLER_BOOT_JITTER_MAX_MS);
    let firstIteration = true;
    while (!signal.aborted) {
      const next = await delays.next();
      const delayMs = (next.value ?? 30_000) + (firstIteration ? bootJitter : 0);
      firstIteration = false;
      try {
        await sleep(delayMs, signal);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        throw err;
      }
      if (signal.aborted) return;
      try {
        await this.getGenerationStatus(rowId);
        const refreshed = this.versions.getVersion(rowId);
        if (
          !refreshed ||
          refreshed.status === 'completed' ||
          refreshed.status === 'failed'
        )
          return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error(
          `[recovery] version=${rowId} poll error:`,
          (err as Error).message,
        );
      }
    }
  }
}
