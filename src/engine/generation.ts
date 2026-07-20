import path from 'node:path/posix';
import type { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
import type { GenerationProvider } from '../providers/provider.js';
import type { BreadcrumbResolver } from './breadcrumb.js';
import type { ProvenanceWriter } from './provenance.js';
import { TypedError, type ErrorCode } from './errors.js';
import { createBackoffIterator, sleep } from './backoff.js';
import { validateWorkflowFormat, flattenComfyError } from '../comfyui/format.js';
import { applySeedShortcut, applyOverrides } from './iterate-merge.js';
import {
  buildOutputPath,
  ensureDir,
  resolveCollisionSuffix,
  versionLabel,
} from '../utils/outputs.js';
import type { Version, Breadcrumb } from '../types/hierarchy.js';
import type { ModelRef, IterateOverride } from '../types/provenance.js';
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
    private provenanceRepo: ProvenanceRepo,
    private provenanceWriter: ProvenanceWriter,
    private client: GenerationProvider | null,
    private breadcrumb: BreadcrumbResolver,
    private outputRoot: string = 'outputs',
    options: { maxConcurrentPollers?: number } = {},
    /** Phase 13 — PROV-V-03. Optional fire-and-forget hook fired from
     *  downloadAndPersist immediately AFTER writeCompletedEvent + markCompleted
     *  in the success branch only (failed-download branch never fires it).
     *  Synchronous: receiver MUST `void` any async work — must not delay the
     *  generation hot path (criterion #4). Engine.pipeline binds this to
     *  fingerprintModelsForVersion at construction time. */
    private fingerprintHook?: (versionId: string) => void,
  ) {
    const cap = options.maxConcurrentPollers ?? DEFAULT_MAX_CONCURRENT_POLLERS;
    // Clamp to a sane range: at least 1, at most 20 (Pro tier × 4 buffer).
    this.maxConcurrentPollers = Math.max(1, Math.min(20, cap));
  }

  /**
   * Two-phase submit (Pattern 2): shot-exists + format validation → insert row →
   * POST /api/prompt → setJobId. On ComfyUI failure, the row is transitioned to
   * `failed` with the matching code before rethrowing. Public signature preserved
   * verbatim from Phase 2 (LANDMINE #1) — body delegates to submitInternal which
   * is shared with reproduce/iterate.
   */
  async submitGeneration(
    shotId: string,
    workflowJson: Record<string, unknown>,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    return this.submitInternal({ shotId, workflowJson, notes });
  }

  /**
   * Shared submit path — Phase 2 two-phase submit + Phase 3 provenance writes.
   * Called by submitGeneration (no lineage), reproduceVersion (lineage='reproduce'),
   * and iterateFromVersion (lineage='iterate'). The submitted provenance event is
   * written BEFORE the HTTP POST so D-PROV-04 holds even when ComfyUI rejects.
   */
  private async submitInternal(args: {
    shotId: string;
    workflowJson: Record<string, unknown>;
    notes?: string;
    parentVersionId?: string;
    lineageType?: 'reproduce' | 'iterate';
  }): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    if (!this.client) {
      throw new TypedError(
        'COMFYUI_CREDENTIALS_MISSING',
        'COMFYUI_API_KEY is not set — generation is unavailable',
        'Set COMFYUI_API_KEY in .env at the repo root. See .env.example.',
      );
    }
    // Fail-fast: shot existence + format. No DB writes until both succeed.
    const shot = this.hierarchy.getShot(args.shotId);
    if (!shot) {
      throw new TypedError(
        'SHOT_NOT_FOUND',
        `Shot '${args.shotId}' not found`,
        `Verify the shot id with { tool: 'shot', action: 'get' }`,
      );
    }
    validateWorkflowFormat(args.workflowJson);

    // D-PROV-33 (LANDMINE #8): lineage written at INSERT time, not via follow-up
    // UPDATE. A reader observing the row between INSERT and UPDATE would otherwise
    // briefly see `lineage_type: null` on a reproduce/iterate row.
    const lineage =
      args.parentVersionId && args.lineageType
        ? { parent_version_id: args.parentVersionId, lineage_type: args.lineageType }
        : undefined;
    const row = this.versions.insertVersion(args.shotId, args.notes, lineage);

    // Submit-event provenance BEFORE HTTP so D-PROV-04 holds even if ComfyUI rejects.
    this.provenanceWriter.writeSubmitEvent(row.id, args.workflowJson);

    try {
      const { prompt_id } = await this.client.submit(args.workflowJson);
      this.versions.setJobId(row.id, prompt_id);
    } catch (err) {
      // ComfyUI-side failure — provenance first, then markFailed, then rethrow.
      const code: ErrorCode = err instanceof TypedError ? err.code : 'COMFYUI_API_ERROR';
      const msg = err instanceof TypedError ? err.message : String(err);
      this.provenanceWriter.writeFailedEvent(row.id, code, msg);
      this.versions.markFailed(row.id, code, msg);
      if (err instanceof TypedError) throw err;
      throw new TypedError('COMFYUI_API_ERROR', msg);
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
      const msg = `Generation did not complete within ${GENERATION_TIMEOUT_MS / 1000}s`;
      this.provenanceWriter.writeFailedEvent(row.id, 'GENERATION_TIMEOUT', msg);
      this.versions.markFailed(row.id, 'GENERATION_TIMEOUT', msg);
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
      this.provenanceWriter.writeFailedEvent(row.id, 'COMFYUI_API_ERROR', 'Version has no job_id');
      this.versions.markFailed(row.id, 'COMFYUI_API_ERROR', 'Version has no job_id');
      const updated = this.versions.getVersion(versionId)!;
      return { entity: updated, breadcrumb: this.breadcrumb.resolve('version', row.id) };
    }
    const remote = await this.client.status(row.job_id);
    const mapped = this.mapState(remote.status);
    if (mapped === 'completed') {
      await this.downloadAndPersist(row, remote.outputs ?? []);
    } else if (mapped === 'failed') {
      // DEMO-02: single helper handles node_errors + string + fallback.
      // Same flatten contract as the submit-time branch in src/comfyui/client.ts.
      // Recovery poller path (drivePoller → getGenerationStatus) inherits this.
      const flat = flattenComfyError(remote.error);
      this.provenanceWriter.writeFailedEvent(row.id, 'COMFYUI_API_ERROR', flat);
      this.versions.markFailed(row.id, 'COMFYUI_API_ERROR', flat);
    } else if (mapped === 'running' && row.status !== 'running') {
      this.versions.transition(row.id, 'running');
    }
    const updated = this.versions.getVersion(versionId)!;
    return { entity: updated, breadcrumb: this.breadcrumb.resolve('version', row.id) };
  }

  /**
   * Re-submit a completed version's resolved prompt blob verbatim (PROV-05).
   * New version gets parent_version_id + lineage_type='reproduce' at INSERT
   * (D-PROV-33). Warnings array flags drift-detection limits (D-PROV-28) —
   * ALWAYS present (empty array permitted).
   */
  async reproduceVersion(
    sourceVersionId: string,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb; reproduction_warnings: string[] }> {
    const source = this.versions.getVersion(sourceVersionId);
    if (!source) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${sourceVersionId}' not found`,
        `Verify the id with { tool: 'version', action: 'get' }`,
      );
    }
    if (source.status !== 'completed') {
      throw new TypedError(
        'VERSION_NOT_COMPLETED',
        `Version '${sourceVersionId}' is in '${source.status}' — cannot reproduce`,
        `Only completed versions can be reproduced. Check status via { tool: 'generation', action: 'status' }.`,
      );
    }
    const completedEvent = this.provenanceRepo.getLatestCompletedEvent(sourceVersionId);
    if (!completedEvent) {
      throw new TypedError(
        'REPRODUCE_BLOCKED',
        `Version '${sourceVersionId}' has no completed provenance row`,
        `Source predates Phase 3 provenance capture or crashed before completion. Source status: '${source.status}'.`,
      );
    }
    if (completedEvent.prompt_json == null) {
      throw new TypedError(
        'PROVENANCE_UNAVAILABLE',
        `Version '${sourceVersionId}' has no resolved prompt blob (likely non-PNG output)`,
        `Reproduce needs the resolved prompt JSON. Use { tool: 'generation', action: 'iterate' } with explicit overrides instead.`,
      );
    }

    const warnings: string[] = [];
    let models: ModelRef[] = [];
    try {
      models = JSON.parse(completedEvent.models_json ?? '[]') as ModelRef[];
    } catch {
      models = [];
    }
    for (const m of models) {
      if (m.model_hash == null) {
        warnings.push(
          `Model '${m.model_name}' not checksummed — cannot guarantee byte-identical output`,
        );
      }
    }
    if (models.length === 0) {
      warnings.push('Cloud API did not expose model metadata — reproduction is best-effort');
    }

    const promptBlob = JSON.parse(completedEvent.prompt_json) as Record<string, unknown>;
    const result = await this.submitInternal({
      shotId: source.shot_id,
      workflowJson: promptBlob,
      notes,
      parentVersionId: sourceVersionId,
      lineageType: 'reproduce',
    });

    // Phase 12 — DEMO-03 (D-CTX-5). Persist warnings on the new version row so
    // version.diff can read them at any time without re-deriving from a
    // partner-API response that may no longer exist. Empty arrays still
    // persisted as '[]' so the read path can distinguish "no warnings
    // recorded" (NULL — legacy) from "explicitly empty" ('[]').
    this.versions.setReproductionWarnings(result.entity.id, warnings);

    return {
      entity: result.entity,
      breadcrumb: result.breadcrumb,
      reproduction_warnings: warnings,
    };
  }

  /**
   * Iterate from a source version with node-scoped overrides / seed shortcut (PROV-06).
   * From 'completed' sources uses prompt_json (D-PROV-13); from 'failed' uses
   * workflow_json (D-PROV-24). Rejects submitted/running (D-PROV-25). Merged blob
   * re-validated via validateWorkflowFormat (D-PROV-23). Lineage set at INSERT.
   */
  async iterateFromVersion(
    sourceVersionId: string,
    overrides?: Record<string, IterateOverride>,
    seed?: number,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    const source = this.versions.getVersion(sourceVersionId);
    if (!source) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${sourceVersionId}' not found`,
        `Verify the id with { tool: 'version', action: 'get' }`,
      );
    }

    let baseBlob: Record<string, unknown>;
    if (source.status === 'completed') {
      const completedEvent = this.provenanceRepo.getLatestCompletedEvent(sourceVersionId);
      if (!completedEvent || completedEvent.prompt_json == null) {
        throw new TypedError(
          'PROVENANCE_UNAVAILABLE',
          `Version '${sourceVersionId}' has no resolved prompt blob`,
          `Source predates Phase 3 or used a non-PNG output format. Iterate not available.`,
        );
      }
      baseBlob = JSON.parse(completedEvent.prompt_json) as Record<string, unknown>;
    } else if (source.status === 'failed') {
      // D-PROV-24: iterate from failed uses authored workflow.
      const submitEvent = this.provenanceRepo.getSubmitEvent(sourceVersionId);
      if (!submitEvent || submitEvent.workflow_json == null) {
        throw new TypedError(
          'PROVENANCE_UNAVAILABLE',
          `Version '${sourceVersionId}' has no captured submit workflow`,
          `Source failed before provenance capture. Iterate not available.`,
        );
      }
      baseBlob = JSON.parse(submitEvent.workflow_json) as Record<string, unknown>;
    } else {
      // D-PROV-25: submitted/running → block.
      throw new TypedError(
        'VERSION_NOT_COMPLETED',
        `Version '${sourceVersionId}' is in '${source.status}' — cannot iterate`,
        `Iterate supports completed or failed sources. Wait for completion via { tool: 'generation', action: 'status' }.`,
      );
    }

    let mergedBlob: Record<string, unknown> = baseBlob;
    if (seed !== undefined) {
      mergedBlob = applySeedShortcut(mergedBlob, seed);
    }
    if (overrides !== undefined) {
      mergedBlob = applyOverrides(mergedBlob, overrides);
    }
    // D-PROV-23: merged blob must still be API-format-valid.
    validateWorkflowFormat(mergedBlob);

    return this.submitInternal({
      shotId: source.shot_id,
      workflowJson: mergedBlob,
      notes,
      parentVersionId: sourceVersionId,
      lineageType: 'iterate',
    });
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
        const msg = `Failed to download output ${out.filename} after ${DOWNLOAD_MAX_ATTEMPTS} attempts`;
        this.provenanceWriter.writeFailedEvent(row.id, 'DOWNLOAD_FAILED', msg);
        this.versions.markFailed(row.id, 'DOWNLOAD_FAILED', msg);
        return; // subsequent outputs intentionally left for debug/audit per D-GEN-36
      }
    }
    // D-PROV-05 / D-PROV-03: fetch the resolved prompt blob from the first
    // downloaded PNG output and emit the completed provenance event BEFORE
    // markCompleted. Null prompt_json is tolerated — PROVENANCE_UNAVAILABLE
    // surfaces later when the agent tries reproduce/iterate.
    const firstPngPath =
      stored.find((s) => s.content_type.startsWith('image/png'))?.path ??
      stored[0]?.path ??
      null;
    let promptBlob: Record<string, unknown> | null = null;
    if (firstPngPath && this.client) {
      promptBlob = await this.client.fetchResolvedPrompt(firstPngPath);
    }
    const outputsJson = JSON.stringify(stored);
    this.provenanceWriter.writeCompletedEvent(row.id, promptBlob, outputsJson);
    this.versions.markCompleted(row.id, outputsJson);
    // Phase 13 — PROV-V-03 (criterion #4). Fire the fingerprint hook AFTER
    // the synchronous completion writes return. The receiver
    // (Engine.fingerprintModelsForVersion via the bound callback in
    // pipeline.ts) wraps async work in `void X.catch(...)` so this call
    // returns synchronously — the generation hot path is NOT delayed.
    // Synchronous throws here are logged but never break the completion path.
    try {
      this.fingerprintHook?.(row.id);
    } catch (err) {
      console.error(
        `vfx-familiar: fingerprint hook synchronous error for ${row.id}:`,
        (err as Error).message,
      );
    }
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
