import path from 'node:path/posix';
import { unlink } from 'node:fs/promises';
import type { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
import type { GenerationProvider } from '../providers/provider.js';
import type { BreadcrumbResolver } from './breadcrumb.js';
import type { ProvenanceWriter } from './provenance.js';
import { TypedError, type ErrorCode } from './errors.js';
import { createBackoffIterator, sleep } from './backoff.js';
// validateWorkflowFormat is still used directly by the ComfyUI-graph-specific
// iterate path (applySeedShortcut/applyOverrides do node-graph surgery); the
// general submit path routes validation through GenerationProvider.validateRequest.
import { flattenComfyError, validateWorkflowFormat } from '../comfyui/format.js';
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
import {
  ingestDownloadToPath,
  assertIngestUrlAllowed,
  DEFAULT_INGEST_ALLOWED_HOSTS,
  DEFAULT_INGEST_MAX_BYTES,
} from './ingest.js';
import { streamToPath } from '../utils/stream-to-path.js';

/** Pivot Phase D — a registered output reported by public https URL. */
export interface UrlOutputEntry {
  url: string;
  filename?: string;
  content_type?: string;
}

/** Modal-ingest — a registered output delivered as raw bytes (multipart upload
 *  or a sibling process handing over a buffer). No URL, no fetch, no SSRF
 *  surface: the bytes are already in-process. `filename` is REQUIRED because
 *  there is no URL to derive a name from. */
export interface ByteOutputEntry {
  bytes: Buffer | Uint8Array;
  filename: string;
  content_type?: string;
}

export type ExternalOutputEntry = UrlOutputEntry | ByteOutputEntry;

/** StoredOutput.url sentinel for direct-bytes entries — human-readable and
 *  greppable ("where did this file come from?" → it was uploaded, not fetched). */
export const DIRECT_UPLOAD_URL = 'uploaded:direct';

function isByteEntry(out: ExternalOutputEntry): out is ByteOutputEntry {
  return 'bytes' in out && out.bytes != null;
}

/** Pivot Phase D — inbound registration input (an external agent/webhook
 *  reporting a finished asset by URL, or direct bytes via multipart upload). */
export interface RegisterExternalOutputInput {
  shotId: string;
  providerId: string;
  outputs: ExternalOutputEntry[];
  provenance?: Record<string, unknown>;
  notes?: string;
  externalJobRef?: string;
}

/** Sanitize a registered output's on-disk basename (from provided name or URL). */
function safeRegisteredFilename(provided: string | undefined, url: string, index: number): string {
  let name = (provided ?? '').trim();
  if (!name) {
    try {
      name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    } catch {
      name = '';
    }
  }
  // Strip unsafe chars, then collapse any run of 2+ dots to a single dot so a
  // name like 'boom..png' can never carry a '..' traversal segment into
  // buildOutputPath (which would otherwise throw past the version row).
  name = name.replace(/[^A-Za-z0-9._-]/g, '').replace(/\.{2,}/g, '.');
  if (!name || name === '.' || name === '..') name = `output_${index}`;
  return name;
}

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
  // Pivot Phase D — inbound ingest trust boundary. Built-in known hosts plus any
  // operator additions (VELLUM_INGEST_ALLOWED_HOSTS). fetchImpl is test-injectable.
  private readonly ingestAllowedHosts: readonly string[];
  private readonly ingestFetchImpl?: typeof fetch;
  // Multi-provider routing (10-ton P0): every configured provider, keyed by id.
  // `client` remains the DEFAULT provider (back-compat: single-provider callers
  // and every pre-routing test construct the engine exactly as before). The map
  // always contains the default when one exists.
  private readonly providers: Map<string, GenerationProvider>;
  private readonly ingestMaxBytes: number;

  constructor(
    private hierarchy: HierarchyRepo,
    private versions: VersionRepo,
    private provenanceRepo: ProvenanceRepo,
    private provenanceWriter: ProvenanceWriter,
    private client: GenerationProvider | null,
    private breadcrumb: BreadcrumbResolver,
    private outputRoot: string = 'outputs',
    options: {
      maxConcurrentPollers?: number;
      ingestAllowedHosts?: readonly string[];
      ingestFetchImpl?: typeof fetch;
      /** Multi-provider routing: ALL configured providers. Optional — when
       *  omitted the engine runs single-provider on `client` as before. */
      providers?: ReadonlyMap<string, GenerationProvider>;
      /** Operator-configurable per-output ingest byte cap (URL fetches AND
       *  direct-bytes uploads). Defaults to DEFAULT_INGEST_MAX_BYTES. */
      ingestMaxBytes?: number;
    } = {},
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
    this.ingestAllowedHosts = [
      ...DEFAULT_INGEST_ALLOWED_HOSTS,
      ...(options.ingestAllowedHosts ?? []),
    ];
    this.ingestFetchImpl = options.ingestFetchImpl;
    this.ingestMaxBytes = options.ingestMaxBytes ?? DEFAULT_INGEST_MAX_BYTES;
    this.providers = new Map(options.providers ?? []);
    if (this.client && !this.providers.has(this.client.id)) {
      this.providers.set(this.client.id, this.client);
    }
  }

  /**
   * Resolve a provider for an operation. `id` undefined/null → the default
   * provider. A named id must be configured; legacy rows with provider=null
   * resolve to the default (they predate provider stamping — ComfyUI-era).
   * Throws a typed, actionable error when nothing resolves.
   */
  private resolveProvider(
    id: string | null | undefined,
    context: string,
  ): GenerationProvider {
    if (id == null) {
      if (!this.client) {
        throw new TypedError(
          'GENERATION_CREDENTIALS_MISSING',
          `No generation provider is configured — cannot ${context}`,
          'Configure a provider (e.g. COMFYUI_API_KEY, REPLICATE_API_TOKEN, FAL_KEY) in .env. See .env.example.',
        );
      }
      return this.client;
    }
    const p = this.providers.get(id);
    if (!p) {
      throw new TypedError(
        'PROVIDER_MISCONFIGURED',
        `Provider '${id}' is not configured — cannot ${context}`,
        `Configured providers: ${[...this.providers.keys()].join(', ') || '(none)'}. Set the '${id}' credentials in .env, or use a configured provider.`,
      );
    }
    return p;
  }

  /**
   * Approval gate — propose-time fail-fast. Resolves the (named or default)
   * provider and runs its request validation WITHOUT any DB write, so an
   * invalid request is rejected at PROPOSE time and an approver never reviews
   * a request that could not execute.
   */
  validateProposedRequest(providerId: string | undefined, request: Record<string, unknown>): void {
    const provider = this.resolveProvider(providerId ?? null, 'propose a generation');
    provider.validateRequest?.(request);
  }

  /**
   * Resolve the provider a REPRODUCE/ITERATE must run on: the provider that
   * PRODUCED the source version. A stamped row routes to its own provider
   * (typed error when no longer configured). A legacy null-provider row is
   * ComfyUI-era — it must replay a resolved node graph, so it routes to the
   * default when the default is resolved-graph, else to ANY configured
   * resolved-graph provider, else throws (feeding a node graph to a URL
   * backend would fail deep inside it with a confusing INVALID_REQUEST_FORMAT).
   */
  private resolveSourceProvider(
    source: Version,
    sourceVersionId: string,
    errCode: 'REPRODUCE_BLOCKED' | 'PROVENANCE_UNAVAILABLE',
  ): GenerationProvider {
    if (source.provider) {
      const p = this.providers.get(source.provider);
      if (!p) {
        throw new TypedError(
          errCode,
          `Version '${sourceVersionId}' was produced by provider '${source.provider}', which is not currently configured.`,
          `Configured providers: ${[...this.providers.keys()].join(', ') || '(none)'}. Set the '${source.provider}' credentials in .env to use this version as a source.`,
        );
      }
      return p;
    }
    const defaultStrategy = this.client?.reproduceStrategy ?? 'resolved-graph';
    if (this.client && defaultStrategy === 'resolved-graph') return this.client;
    // Try any configured resolved-graph provider before blocking.
    const graphProvider = [...this.providers.values()].find(
      (p) => (p.reproduceStrategy ?? 'resolved-graph') === 'resolved-graph',
    );
    if (!graphProvider) {
      throw new TypedError(
        errCode,
        `Version '${sourceVersionId}' predates provider stamping and needs a 'resolved-graph' backend, but none is configured.`,
        `Configure a resolved-graph provider (e.g. COMFYUI_API_KEY) to use legacy versions as sources.`,
      );
    }
    return graphProvider;
  }

  /**
   * Pivot Phase D — inbound registration. An external agent (or provider webhook)
   * reports a finished asset by URL; we create a COMPLETED version stamped with the
   * reporting provider, ingest each output under the SSRF-guarded trust boundary,
   * and record neutral provenance. This is how "any output can speak to it" — it
   * converges on the same completed-event + markCompleted machinery as the outbound
   * path, skipping submit/poll.
   */
  async registerExternalOutput(
    input: RegisterExternalOutputInput,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    const shot = this.hierarchy.getShot(input.shotId);
    if (!shot) {
      throw new TypedError(
        'SHOT_NOT_FOUND',
        `Shot '${input.shotId}' not found`,
        `Verify the shot id with { tool: 'shot', action: 'get' }`,
      );
    }
    if (!input.providerId) {
      throw new TypedError('INVALID_INPUT', 'register requires a non-empty provider id');
    }
    if (!input.outputs || input.outputs.length === 0) {
      throw new TypedError(
        'INVALID_INPUT',
        'register requires at least one output',
        'Pass outputs: [{ url: "https://…" }].',
      );
    }
    // Pre-flight the trust boundary BEFORE any DB write — a rejected URL (or an
    // invalid/oversize byte entry) must not leave an orphaned version row behind.
    for (const out of input.outputs) {
      if (isByteEntry(out)) {
        // Direct bytes: no URL, no fetch, no SSRF surface — but the same byte
        // cap the URL path enforces, rejected BEFORE any write.
        if (typeof out.filename !== 'string' || out.filename.trim() === '') {
          throw new TypedError(
            'INVALID_INPUT',
            'A direct-bytes output requires a filename',
            "Pass outputs: [{ bytes: <data>, filename: 'sample.png' }].",
          );
        }
        if (out.bytes.byteLength > this.ingestMaxBytes) {
          throw new TypedError(
            'INVALID_INPUT',
            `Uploaded output '${out.filename}' is ${out.bytes.byteLength} bytes — exceeds the ${this.ingestMaxBytes}-byte ingest cap`,
            'Reduce the file size or raise the operator ingest byte cap.',
          );
        }
      } else {
        assertIngestUrlAllowed(out.url, this.ingestAllowedHosts);
      }
    }

    const seq = this.hierarchy.getSequence(shot.sequence_id)!;
    const proj = this.hierarchy.getProject(seq.project_id)!;
    const row = this.versions.insertVersion(input.shotId, input.notes, undefined, input.providerId);
    if (input.externalJobRef) this.versions.setJobId(row.id, input.externalJobRef);
    const vLabel = versionLabel(row.version_number);

    const stored: StoredOutput[] = [];
    for (let i = 0; i < input.outputs.length; i++) {
      const out = input.outputs[i]!;
      // Path-building (buildOutputPath / ensureDir / resolveCollisionSuffix) is
      // INSIDE the try: any pre-fetch failure (a malformed filename, mkdir EACCES/
      // ENOSPC, a readdir error) must route through markFailed — never escape past
      // the version row and strand it at 'submitted'.
      try {
        const baseName = isByteEntry(out)
          ? safeRegisteredFilename(out.filename, '', i)
          : safeRegisteredFilename(out.filename, out.url, i);
        const relPath = buildOutputPath({
          projectName: proj.name,
          sequenceName: seq.name,
          shotName: shot.name,
          versionLabel: vLabel,
          filename: baseName,
          root: this.outputRoot,
        });
        const dir = path.dirname(relPath);
        await ensureDir(dir);
        const finalName = await resolveCollisionSuffix(dir, baseName);
        const finalPath = path.join(dir, finalName);
        if (isByteEntry(out)) {
          // Direct bytes skip the fetch entirely but share the identical path
          // machinery + atomic temp-then-rename write (streamToPath). The byte
          // cap was pre-flighted above; maxBytes here is belt-and-suspenders.
          const bytes = out.bytes;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
              );
              controller.close();
            },
          });
          await streamToPath(body, finalPath, {
            maxBytes: this.ingestMaxBytes,
            filenameForError: finalName,
          });
          stored.push({
            filename: finalName,
            path: finalPath,
            url: DIRECT_UPLOAD_URL,
            content_type: out.content_type ?? 'application/octet-stream',
            size_bytes: bytes.byteLength,
          });
        } else {
          const dl = await ingestDownloadToPath(out.url, finalPath, {
            allowedHosts: this.ingestAllowedHosts,
            fetchImpl: this.ingestFetchImpl,
            maxBytes: this.ingestMaxBytes,
          });
          stored.push({
            filename: finalName,
            path: dl.path,
            url: out.url,
            content_type: out.content_type ?? dl.contentType,
            size_bytes: dl.sizeBytes,
          });
        }
      } catch (err) {
        // Best-effort: remove files already committed by earlier outputs so a
        // failed registration leaves no dangling assets with no provenance pointer.
        await Promise.all(stored.map((s) => unlink(s.path).catch(() => undefined)));
        const code: ErrorCode = err instanceof TypedError ? err.code : 'DOWNLOAD_FAILED';
        const msg = err instanceof TypedError ? err.message : String(err);
        this.provenanceWriter.writeFailedEvent(row.id, code, msg);
        this.versions.markFailed(row.id, code, msg);
        if (err instanceof TypedError) throw err;
        throw new TypedError('DOWNLOAD_FAILED', msg);
      }
    }

    // Neutral provenance: caller-asserted params/models + the reporting provider id.
    // provider_id LAST so caller-asserted provenance can never spoof the
    // authenticated reporting provider in the append-only record (review fix).
    const neutralJson = JSON.stringify({ ...(input.provenance ?? {}), provider_id: input.providerId });
    this.provenanceWriter.writeCompletedEvent(row.id, null, JSON.stringify(stored), neutralJson);
    this.versions.markCompleted(row.id, JSON.stringify(stored));
    const refreshed = this.versions.getVersion(row.id)!;
    return { entity: refreshed, breadcrumb: this.breadcrumb.resolve('version', row.id) };
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
    /** Multi-provider routing: submit to this configured provider (default when omitted). */
    providerId?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    return this.submitInternal({ shotId, workflowJson, notes, providerId });
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
    /** Multi-provider routing: submit via this configured provider instead of the
     *  default. Reproduce/iterate pass the SOURCE version's provider here. */
    providerId?: string;
  }): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    // Back-compat: the historical no-provider-at-all error (single-provider era)
    // keeps its code+message; a NAMED but unconfigured provider throws
    // PROVIDER_MISCONFIGURED from resolveProvider.
    if (!this.client && args.providerId == null) {
      throw new TypedError(
        'COMFYUI_CREDENTIALS_MISSING',
        'COMFYUI_API_KEY is not set — generation is unavailable',
        'Set COMFYUI_API_KEY in .env at the repo root. See .env.example.',
      );
    }
    const provider = this.resolveProvider(args.providerId, 'submit a generation');
    // Fail-fast: shot existence + format. No DB writes until both succeed.
    const shot = this.hierarchy.getShot(args.shotId);
    if (!shot) {
      throw new TypedError(
        'SHOT_NOT_FOUND',
        `Shot '${args.shotId}' not found`,
        `Verify the shot id with { tool: 'shot', action: 'get' }`,
      );
    }
    // Pivot Phase C: validation is provider-routed. ComfyUI validates node-graph
    // format; other backends validate their own request shape.
    provider.validateRequest?.(args.workflowJson);

    // D-PROV-33 (LANDMINE #8): lineage written at INSERT time, not via follow-up
    // UPDATE. A reader observing the row between INSERT and UPDATE would otherwise
    // briefly see `lineage_type: null` on a reproduce/iterate row.
    const lineage =
      args.parentVersionId && args.lineageType
        ? { parent_version_id: args.parentVersionId, lineage_type: args.lineageType }
        : undefined;
    // Pivot Phase B: stamp the originating provider on the version row.
    const row = this.versions.insertVersion(args.shotId, args.notes, lineage, provider.id);

    // Submit-event provenance BEFORE HTTP so D-PROV-04 holds even if ComfyUI rejects.
    this.provenanceWriter.writeSubmitEvent(row.id, args.workflowJson);

    try {
      const { prompt_id } = await provider.submit(args.workflowJson);
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
    // Timeout check (D-GEN-25) — runs BEFORE any network call so a stuck backend
    // cannot hold the row hostage. PROVIDER-AWARE (routing review): the engine
    // default (10 min) was sized for image jobs; a long-running video backend
    // (BytePlus/Seedance) declares a larger generationTimeoutMs on its adapter.
    // Best-effort lookup only — an unconfigured provider falls back to the
    // default window and still throws PROVIDER_MISCONFIGURED below when polled.
    const timeoutProvider =
      row.provider != null ? this.providers.get(row.provider) : (this.client ?? undefined);
    const timeoutMs = timeoutProvider?.generationTimeoutMs ?? GENERATION_TIMEOUT_MS;
    // When the row's provider is named but NOT configured, do not mislabel the
    // row GENERATION_TIMEOUT in append-only provenance — fall through to the
    // honest PROVIDER_MISCONFIGURED throw below (the row stays pending and can
    // recover on a future boot with restored credentials).
    const providerUnresolvable = row.provider != null && !this.providers.has(row.provider);
    if (!providerUnresolvable && Date.now() - row.created_at > timeoutMs) {
      const msg = `Generation did not complete within ${timeoutMs / 1000}s`;
      this.provenanceWriter.writeFailedEvent(row.id, 'GENERATION_TIMEOUT', msg);
      this.versions.markFailed(row.id, 'GENERATION_TIMEOUT', msg);
      const updated = this.versions.getVersion(versionId)!;
      return { entity: updated, breadcrumb: this.breadcrumb.resolve('version', row.id) };
    }
    // Multi-provider routing: poll the provider that produced this row (legacy
    // null-provider rows route to the default). Back-compat: when NOTHING is
    // configured, keep the historical missing-credentials error.
    if (!this.client && row.provider == null) {
      throw new TypedError(
        'COMFYUI_CREDENTIALS_MISSING',
        'COMFYUI_API_KEY is not set — cannot fetch status',
        'Set COMFYUI_API_KEY in .env at the repo root. See .env.example.',
      );
    }
    const provider = this.resolveProvider(row.provider ?? null, `fetch status for version '${versionId}'`);
    if (!row.job_id) {
      // Edge case: row inserted at submit-time but submit call failed before
      // setJobId (very rare — markFailed runs in the catch in submitGeneration).
      this.provenanceWriter.writeFailedEvent(row.id, 'COMFYUI_API_ERROR', 'Version has no job_id');
      this.versions.markFailed(row.id, 'COMFYUI_API_ERROR', 'Version has no job_id');
      const updated = this.versions.getVersion(versionId)!;
      return { entity: updated, breadcrumb: this.breadcrumb.resolve('version', row.id) };
    }
    const remote = await provider.status(row.job_id);
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

    // Multi-provider routing (10-ton P0): reproduce runs on the provider that
    // PRODUCED the source version — not the default. A stamped row routes to its
    // own provider (REPRODUCE_BLOCKED with an actionable message when that
    // provider is no longer configured); a legacy null-provider row is
    // ComfyUI-era: it must replay a resolved node graph, so it routes to the
    // configured resolved-graph provider — the default when it is one, else
    // blocked (feeding a node graph to a URL backend would fail deep inside the
    // backend with a confusing INVALID_REQUEST_FORMAT).
    const sourceProvider = this.resolveSourceProvider(source, sourceVersionId, 'REPRODUCE_BLOCKED');

    // 'request-replay' (URL providers — no embedded blob) re-submits the original
    // request recorded at submit time; 'resolved-graph' (ComfyUI) re-submits the
    // resolved prompt blob for a byte-identical result.
    if ((sourceProvider.reproduceStrategy ?? 'resolved-graph') === 'request-replay') {
      return this.reproduceViaRequestReplay(source, sourceVersionId, notes, sourceProvider.id);
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

    let promptBlob: Record<string, unknown>;
    try {
      promptBlob = JSON.parse(completedEvent.prompt_json) as Record<string, unknown>;
    } catch {
      // Symmetric with reproduceViaRequestReplay: a corrupt stored blob must surface
      // a typed, actionable error, not a raw SyntaxError out of reproduceVersion.
      throw new TypedError(
        'PROVENANCE_UNAVAILABLE',
        `Version '${sourceVersionId}' has a corrupt resolved prompt blob — cannot reproduce`,
      );
    }
    const result = await this.submitInternal({
      shotId: source.shot_id,
      workflowJson: promptBlob,
      notes,
      parentVersionId: sourceVersionId,
      lineageType: 'reproduce',
      // Route the re-submit to the SOURCE's provider (multi-provider routing).
      providerId: sourceProvider.id,
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
   * Pivot enhancement #2 — reproduce for 'request-replay' providers (URL backends
   * like Replicate that have no embedded prompt blob). The neutral reproduce is a
   * re-submit of the ORIGINAL request recorded on the submit event; submitInternal
   * re-runs the provider's validateRequest + stamps lineage='reproduce'. A
   * params-replay warning is always emitted because hosted models are not
   * byte-identical unless the request itself pins a seed.
   */
  private async reproduceViaRequestReplay(
    source: Version,
    sourceVersionId: string,
    notes: string | undefined,
    /** The SOURCE version's provider id — the replay submits to it (routing). */
    providerId: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb; reproduction_warnings: string[] }> {
    const submitEvent = this.provenanceRepo.getSubmitEvent(sourceVersionId);
    if (!submitEvent || submitEvent.workflow_json == null) {
      throw new TypedError(
        'PROVENANCE_UNAVAILABLE',
        `Version '${sourceVersionId}' has no captured request to replay`,
        `The originating request was not recorded (source predates request capture). Run a fresh { tool: 'generation', action: 'submit' } instead.`,
      );
    }
    let request: Record<string, unknown>;
    try {
      request = JSON.parse(submitEvent.workflow_json) as Record<string, unknown>;
    } catch {
      throw new TypedError(
        'PROVENANCE_UNAVAILABLE',
        `Version '${sourceVersionId}' has a corrupt captured request — cannot replay`,
      );
    }
    const warnings = [
      `Params-replay reproduce: re-submits the original ${providerId} request. Output is not byte-identical unless the request pins a seed — hosted models are non-deterministic.`,
    ];
    const result = await this.submitInternal({
      shotId: source.shot_id,
      workflowJson: request,
      notes,
      parentVersionId: sourceVersionId,
      lineageType: 'reproduce',
      providerId,
    });
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

    // Multi-provider routing: iterate is NODE-GRAPH surgery (applySeedShortcut/
    // applyOverrides key on node_id/class_type), so it only works on resolved-graph
    // sources. Guard request-replay (URL-provider) sources EARLY with an actionable
    // message instead of dead-ending later in ComfyUI-format validation; legacy
    // null rows route via the same resolved-graph fallback reproduce uses.
    const sourceProvider = this.resolveSourceProvider(source, sourceVersionId, 'PROVENANCE_UNAVAILABLE');
    if ((sourceProvider.reproduceStrategy ?? 'resolved-graph') === 'request-replay') {
      throw new TypedError(
        'ITERATE_INVALID_PATCH',
        `Version '${sourceVersionId}' was produced by '${sourceProvider.id}', a params-based backend — node-graph iterate does not apply.`,
        `Use { tool: 'generation', action: 'reproduce' } to replay it, or a fresh { action: 'submit', provider: '${sourceProvider.id}' } with edited params.`,
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
      // Multi-provider routing: submit to the RESOLVED source provider — for a
      // legacy null-provider row this is the resolved-graph fallback (never a
      // URL default that would reject the node graph).
      providerId: sourceProvider.id,
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
    // Multi-provider routing: download via the provider that produced the row
    // (its SSRF policy/allowlist is provider-specific). getGenerationStatus
    // already resolved this successfully before calling us; re-resolve here for
    // the same instance.
    const provider = this.resolveProvider(row.provider ?? null, 'persist outputs');
    // Resolve the disk path template using the hierarchy chain — need
    // shot/seq/project names. Single-pass walk.
    const shot = this.hierarchy.getShot(row.shot_id)!;
    const seq = this.hierarchy.getSequence(shot.sequence_id)!;
    const proj = this.hierarchy.getProject(seq.project_id)!;
    const vLabel = versionLabel(row.version_number);

    const stored: StoredOutput[] = [];
    for (const out of outputs) {
      // Pre-fetch path setup (buildOutputPath / ensureDir / resolveCollisionSuffix)
      // must be INSIDE a guard: a mkdir ENOSPC/EACCES, a readdir error, collision-
      // suffix exhaustion, or a malformed basename must route through markFailed —
      // never escape downloadAndPersist and strand the row non-terminal. This
      // mirrors the registerExternalOutput hardening (see that method), except the
      // outbound poll path markFails + returns rather than rethrowing, since
      // getGenerationStatus reports terminal state via the version row, not a throw.
      let dir: string;
      let finalName: string;
      let finalPath: string;
      try {
        const relPath = buildOutputPath({
          projectName: proj.name,
          sequenceName: seq.name,
          shotName: shot.name,
          versionLabel: vLabel,
          filename: out.filename,
          root: this.outputRoot,
        });
        dir = path.dirname(relPath);
        await ensureDir(dir);
        finalName = await resolveCollisionSuffix(dir, out.filename);
        finalPath = path.join(dir, finalName);
      } catch (err) {
        const code: ErrorCode = err instanceof TypedError ? err.code : 'DOWNLOAD_FAILED';
        const msg =
          err instanceof TypedError
            ? err.message
            : `Failed to prepare output path for ${out.filename}: ${(err as Error).message}`;
        this.provenanceWriter.writeFailedEvent(row.id, code, msg);
        this.versions.markFailed(row.id, code, msg);
        return;
      }

      let attempt = 0;
      let lastErr: unknown = null;
      while (attempt < DOWNLOAD_MAX_ATTEMPTS) {
        try {
          const dl = await provider.downloadToPath(
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
    if (firstPngPath) {
      promptBlob = await provider.fetchResolvedPrompt(firstPngPath);
    }
    // Pivot #2a — record neutral provenance for providers that describe it (URL
    // backends). Built from the ORIGINAL request on the submit event; ComfyUI omits
    // describeProvenance and keeps prompt_json as the source of truth (neutral null).
    // Best-effort: a corrupt/absent request never breaks the completion write.
    let neutralJson: string | null = null;
    if (provider.describeProvenance) {
      const submit = this.provenanceRepo.getSubmitEvent(row.id);
      if (submit?.workflow_json) {
        try {
          const request = JSON.parse(submit.workflow_json) as Record<string, unknown>;
          const neutral = provider.describeProvenance(request);
          if (neutral) neutralJson = JSON.stringify(neutral);
        } catch {
          neutralJson = null;
        }
      }
    }
    const outputsJson = JSON.stringify(stored);
    this.provenanceWriter.writeCompletedEvent(row.id, promptBlob, outputsJson, neutralJson);
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
        `vellum: fingerprint hook synchronous error for ${row.id}:`,
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
        // Routing review: configuration errors are PERMANENT for this process
        // (the provider map is fixed at construction). Retrying burns a poller
        // slot for the whole timeout window, starves queued healthy rows, and
        // ends by mislabeling the row GENERATION_TIMEOUT. Stop THIS row's
        // poller and leave it pending — a future boot with restored
        // credentials resumes it via the recovery scan.
        if (
          err instanceof TypedError &&
          (err.code === 'PROVIDER_MISCONFIGURED' ||
            err.code === 'COMFYUI_CREDENTIALS_MISSING' ||
            err.code === 'GENERATION_CREDENTIALS_MISSING')
        ) {
          console.error(
            `[recovery] version=${rowId} provider unavailable (${err.code}) — poller stopped; row stays pending until credentials return:`,
            err.message,
          );
          return;
        }
        console.error(
          `[recovery] version=${rowId} poll error:`,
          (err as Error).message,
        );
      }
    }
  }
}
