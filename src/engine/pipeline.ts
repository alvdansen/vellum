import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as nodepath from 'node:path';
import { nanoid } from 'nanoid';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteClient } from 'better-sqlite3';
import type * as schema from '../store/schema.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
// Phase 18 / Plan 18-02 — composite-cursor sort tuple types forwarded
// through Engine.listVersionsForShot. Plan 18-03 will Zod-parse these at
// the HTTP boundary; the engine layer trusts the structurally-validated
// VersionCursor (decoded by Plan 18-01 helper) on entry.
import type { VersionSort, VersionCursor, HierarchySort } from '../store/sort.js';
import { TagRepo } from '../store/tag-repo.js';
import { MetadataRepo } from '../store/metadata-repo.js';
import type { GenerationProvider } from '../providers/provider.js';
import { BreadcrumbResolver } from './breadcrumb.js';
import { GenerationEngine } from './generation.js';
import { ProvenanceWriter } from './provenance.js';
import { AssetsEngine } from './assets.js';
import { diffVersions as pureDiffVersions, buildReproductionDivergence } from './diff.js';
import { computeOutputSha256 } from './output-hash.js';
import { fingerprintModel } from './model-fingerprint.js';
import { TypedError } from './errors.js';
import { createEngineEmitter, type EngineEmitter } from './events.js';
import { downloadOutput } from './output-downloader.js';
import {
  buildManifestDefinition,
  // Phase 15 / Plan 15-03 — ingredients-aware manifest builder.
  buildManifestWithIngredients,
  BUFFER_SIGNING_MAX_BYTES,
  loadSigner,
  routeFormat,
  // Phase 15 WR-02 — supported-MIME helper for ingredient asset refs.
  getMimeForExtensionOrNull,
  signEmbedBuffer,
  signEmbedFile,
  // Phase 15 / Plan 15-03 — ingredient-aware signers.
  signEmbedBufferWithIngredients,
  signEmbedFileWithIngredients,
  type LoadedSigner,
  type ManifestDefinition,
  type PrimaryModel,
  type BuildManifestResult,
  type IngredientAssetRef,
  // Phase 15 / Plan 15-01 — pure ingredient extractors + hasher.
  extractParentIngredient,
  extractComponentIngredients,
  extractInputAssertion,
  // Phase 16 / Plan 16-01 — agent-surface types (PROV-V-07).
  type ExporterResult,
  type VerificationReport,
  // Phase 16 / Plan 16-02 — redaction facade type (PROV-V-06).
  type RedactionResult,
} from './c2pa/index.js';
// Phase 17 / Plan 17-03 — thumbnail derivation surface. The engine delegates
// through this barrel so pipeline.ts has ZERO direct sharp / ffmpeg imports
// (D-23 / D-24 architecture-purity invariants preserved). The barrel also
// exports the cache helpers (cachePathFor / sentinelPathFor / writeFailedSentinel
// / invalidateCache / isCacheFresh / computeETag) used by deriveThumbnail.
import * as Thumbnails from './thumbnails/index.js';
import {
  SHOT_NAME_REGEX,
  type Workspace,
  type Project,
  type Sequence,
  type Shot,
  type Version,
  type Breadcrumb,
  type BreadcrumbEntry,
  type ShotStatus,
} from '../types/hierarchy.js';
// Phase 20 / Plan 20-04 — STAT-04 facade dependencies. The repo functions write
// the dual-mutation atomically (UPDATE shots + INSERT shot_status_events) inside
// one transaction; getStatusHistory is the canonical read for both
// listShotStatusHistory and lastChangedAt in getShotStatus.
import {
  insertStatusEvent,
  getStatusHistory,
  type ShotStatusEvent,
  // Phase 21 / Plan 21-02 — GRID-04 denormalized shot grid reader. The repo
  // does the single-pass window-function CTE join (shots + latest-completed
  // version + status null-coalesce); the engine facade re-maps the row shape
  // into the dashboard's payload contract (D-13) and builds thumbnail_url
  // server-side per RESEARCH Example 1 + PATTERNS §10.
  listShotsForGrid,
  // Phase 23 / Plan 23-02 — D-01 + D-14: whole-sequence GROUP BY counts +
  // EXISTS-clause stale_count. Engine composes the raw repo result with
  // approved_pct math (Math.round in TypeScript) into the dashboard's
  // SequenceStats wire shape before returning from `listShotGrid`.
  getSequenceStats,
  type ShotGridCursor,
} from '../store/shot-status-repo.js';
import type {
  ProvenanceEvent,
  DiffSnapshot,
  DiffResponse,
  ReproductionDivergence,
  ManifestSignedPayloadFields,
  ModelRef,
  IterateOverride,
} from '../types/provenance.js';
import type {
  AssetsQueryFilter,
  VersionWithAssets,
  ScopeFilter,
  MetadataKV,
} from '../types/assets.js';
import type { C2paConfig } from '../types/c2pa.js';

/**
 * Widened Db type — drizzle() factory returns `BetterSQLite3Database<T> & { $client: Database }`,
 * but the class declaration itself omits `$client`. Plan 04-02 established the
 * widening convention at the repo boundary (tag-repo.ts, metadata-repo.ts); this
 * file mirrors it. The constructor signature accepts the narrower public-class
 * type (`BaseDb`) and casts once to the widened `Db` for internal use — callers
 * (server.ts, test harnesses) do not need to know about the widening.
 */
type BaseDb = BetterSQLite3Database<typeof schema>;
type Db = BaseDb & { $client: SqliteClient };

/**
 * Phase 14 — Concern #6 mitigation. Re-exported from src/engine/c2pa/constants.ts
 * to preserve the existing public-symbol contract (`Engine`-adjacent imports
 * use it for sign-time pre-stat). The single source of truth lives in the
 * c2pa module so output-downloader.ts can import without creating a circular
 * dependency on this file. See MR-03 fix in 14-REVIEW-FIX.md.
 */
export { BUFFER_SIGNING_MAX_BYTES };

/**
 * Phase 14 — Plan 14-02 manifest-builder claim_generator includes the
 * vfx-familiar app version. Read from package.json once at module load to
 * keep the signOutput hot path allocation-free. Mirrors the appVersion field
 * surfaced via the buildManifestDefinition contract.
 *
 * Pinned-string fallback ('0.1.0') guarantees the manifest_signed event
 * still records a populated algorithm + cert summary even on environments
 * where package.json is unreadable (e.g., minified bundles in the future).
 */
const APP_VERSION = '0.1.0';

/**
 * Phase 14 — Plan 14-03 helper. Selects a single PrimaryModel from the latest
 * fingerprinted models for a version + maps the Phase 13 ModelRef shape
 * (with the discriminated `model_hash` / `model_hash_unavailable` fields)
 * onto the c2pa manifest-builder PrimaryModel union.
 *
 * Pure function — no I/O. Returns NULL when the input is null or empty,
 * which the manifest-builder describes as
 * "model=unknown; hash_unavailable=no_models_recorded".
 *
 * Picks the FIRST entry in the array as primary. v1.1 ships a single
 * primary model assertion; multi-model assertion graphs land in Phase 15
 * (PROV-V-04 ingredient graph).
 */
function derivePrimaryModel(models: ModelRef[] | null): PrimaryModel | null {
  if (!models || models.length === 0) return null;
  const m = models[0]!;
  if (m.model_hash !== null) {
    return { name: m.model_name, hash: m.model_hash };
  }
  // Hash absent — surface the typed unavailable reason. NULL / empty
  // unavailable falls back to a stable string so the manifest description
  // is never empty.
  return {
    name: m.model_name,
    hash: null,
    unavailable: m.model_hash_unavailable ?? 'fingerprint_pending',
  };
}

/**
 * Phase 15 — stream-hash a file's SHA-256 without loading bytes into memory.
 * Used by Engine._signOutputInner's embed-file branch when the signed bytes
 * land on disk (signedToPath) rather than in memory (signed Buffer).
 * Returns null on read failure — caller persists null in manifest_signed.
 */
async function streamSha256(filePath: string): Promise<string | null> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  } catch {
    return null;
  }
}

/**
 * Phase 15 — count ingredients_summary fields from a BuildManifestResult.
 * unavailable_count = number of vfx_familiar.unavailable_ingredient
 * assertions emitted (parent + components combined). Lockstep with
 * buildManifestWithIngredients (Plan 15-02): every spec lands in
 * ingredientSpecs[]; specs with assetRef.kind='unavailable' also have a
 * matching vfx_familiar.unavailable_ingredient assertion in
 * definition.assertions[] (the audit channel).
 */
function summariseIngredientsFromResult(
  result: BuildManifestResult,
): {
  parent_count: 0 | 1;
  component_count: number;
  input_assertion: boolean;
  unavailable_count: number;
} {
  let parent_count: 0 | 1 = 0;
  let component_count = 0;
  let unavailable_count = 0;
  for (const spec of result.ingredientSpecs) {
    if (spec.relationship === 'parentOf') parent_count = 1;
    else component_count += 1;
    if (spec.assetRef.kind === 'unavailable') unavailable_count += 1;
  }
  return {
    parent_count,
    component_count,
    input_assertion: true,
    unavailable_count,
  };
}

type WithBreadcrumb<T> = T & Breadcrumb;
type ListResult<T> = {
  items: WithBreadcrumb<T>[];
  total_count: number;
  limit: number;
  offset: number;
};

/**
 * Engine facade — Phase 1 hierarchy + Phase 2 generation + Phase 3 provenance
 * + Phase 4 assets.
 *
 * Phase 4 constructor change (D-ASST-27): `db` is now the FIRST constructor
 * argument so TagRepo / MetadataRepo / AssetsEngine can be wired inside without
 * requiring callers to construct them. All `new Engine(...)` call sites get
 * `db` prepended — server.ts + every test harness that builds an Engine.
 *
 * Invariants (D-33 + D-ASST-26):
 *  - Zero MCP SDK imports (architecture-purity test asserts this).
 *  - Shot regex is enforced here before delegating to the repo (D-07, D-33).
 *  - Missing entities surface as typed {WORKSPACE,PROJECT,SEQUENCE,SHOT,VERSION}_NOT_FOUND.
 *  - Phase 2 generation ops delegate to a composed GenerationEngine.
 *  - Phase 4 asset ops delegate to a composed AssetsEngine.
 *  - getVersion ALWAYS hydrates with tags+metadata (D-ASST-19); listVersionsForShot
 *    hydrates opt-in (D-ASST-20).
 */
export class Engine {
  private db: Db;
  private breadcrumb: BreadcrumbResolver;
  private generation: GenerationEngine;
  private assets: AssetsEngine;
  /**
   * Phase 5 (D-WEBUI-29): typed event bus for the SSE handler + route tests.
   * Public readonly — subscribers call `engine.events.onEvent('type', cb)`.
   * Published to by each mutation path below (see the emit* private helpers
   * and the wrapped delegates on submit/reproduce/iterate/status/tag/metadata).
   */
  public readonly events: EngineEmitter;
  /** Dashboard-stable download root (D-WEBUI-26 + SC-2 Phase 6). Public-readonly
   * so the HTTP layer can resolve output file paths against it via
   * EngineForDashboard structural Pick (Plan 06-03 / gap_closure WR-01). */
  public readonly outputRoot: string;
  /** Phase 13 — PROV-V-03 (D-CTX-2). Optional models root for SHA-256
   *  fingerprinting at completion. NULL in production (ComfyUI Cloud has
   *  no local model files) → every entry records 'models_dir_not_configured'
   *  per D-CTX-5. Set via VFX_FAMILIAR_MODELS_DIR env var in src/server.ts. */
  private readonly modelsDir: string | null;
  /** Phase 14 — PROV-V-01 / PROV-V-02 / PROV-V-05 (D-CTX-2). Optional C2PA
   *  signing config. NULL means signing is disabled — graceful degradation
   *  per D-CTX-2: download paths return original bytes unchanged. Both paths
   *  on the C2paConfig are post-realpath, post-allowlist absolute paths
   *  validated at boot by src/utils/c2pa-config.ts. NEVER read here — the
   *  signer wrapper (Plan 14-02) is the SOLE consumer of the file bytes. */
  private readonly c2paConfig: C2paConfig | null;
  /** Phase 19 — SUM-01..06. Optional Anthropic config for the AI conversational
   *  summary feature. NULL means summarization is disabled — graceful degradation
   *  per D-FB-2: Engine.summarizeVersion returns SummaryOutcome=fallback
   *  reason='api_key_missing' on every call, dashboards see deterministic-template
   *  content. Never read here — the engine/summary/anthropic-client.ts wrapper
   *  is the SOLE consumer of the API key. Boot validation in
   *  src/utils/anthropic-config.ts throws TypedError('ANTHROPIC_CONFIG_INVALID')
   *  BEFORE Engine construction on malformed env-var input. */
  private readonly anthropicConfig: { apiKey: string } | null;
  /** Phase 14 — Plan 14-03 lazy-load cache. The c2pa-node native binding +
   *  cert/key are loaded ONCE per process on the first signOutput call. The
   *  cache holds either the loaded signer OR a typed errorCode (cert_load_failed
   *  vs native_binding_unavailable per Concern #11). Reset only via a process
   *  restart — the load is monotonic. */
  private signerCache: { signer: LoadedSigner } | null = null;
  private signerLoadFailedReason: {
    code: 'cert_load_failed' | 'native_binding_unavailable';
    message: string;
  } | null = null;
  /**
   * Phase 15 (B4 mitigation) — per-(version, filename) sign mutex. Concurrent
   * signOutput calls for the SAME (versionId, filename) pair coalesce to a
   * single in-flight Promise; the second caller awaits the first's result.
   * Different (versionId, filename) pairs remain parallel — the map is keyed
   * on `${versionId}::${filename}`.
   *
   * Why compound key (Phase 15 WR-01 fix):
   *   - Concurrent signs of the SAME (versionId, filename) MUST coalesce —
   *     this preserves the re-sign idempotency intent from Plan 14-03 / B4
   *     (the second caller receives the first's signed buffer / alreadySigned
   *     shortcut without producing a duplicate manifest_signed event).
   *   - Concurrent signs of the SAME versionId but DIFFERENT filenames are a
   *     legitimate use case (e.g., a future Phase 16 re-derive feature signing
   *     multiple outputs of one version in parallel). Returning the first
   *     filename's signed buffer to a caller that asked for a different
   *     filename was a silent-correctness bug — the second filename never got
   *     a manifest_signed event of its own. Keying on the (versionId, filename)
   *     pair lets distinct filenames execute as TWO independent sign operations
   *     while same-pair concurrency still coalesces.
   *
   * Cleared on settle (try/finally). The mutex is in-process only — multi-
   * process coordination is out-of-scope for v1.1 (single-server design).
   *
   * Threat model: T-15-06 — bounded growth. Each entry lives until the
   * promise settles. Recovery-poller storms cannot leak entries; settle
   * cleanup is unconditional.
   */
  private readonly signMutex = new Map<
    string,
    Promise<{ signed: Buffer | null; signedToPath: string | null; alreadySigned?: boolean }>
  >();

  /**
   * Phase 17 / Plan 17-03 (D-21) — per-(versionId, filename) COALESCING
   * mutex for thumbnail derivation. SAME shape as signMutex above (NOT
   * the FIFO assetWriterMutex). Concurrent same-key requests share one
   * in-flight Promise; different keys run in parallel. Pure derivation
   * from immutable source bytes is safe to coalesce — the derivation
   * result is a pure function of the source bytes' mtime / sha256.
   *
   * Settle cleanup in try/finally — entry deleted on success or failure.
   * In-process only (single-server design; threat T-15-06 — bounded growth).
   */
  private readonly thumbnailMutex = new Map<
    string,
    Promise<{ filePath: string; contentType: string; etag: string } | null>
  >();

  /**
   * Phase 16 / Plan 16-02 (D-PLAN-2-4 / C-04) — UNIFIED per-(versionId, filename)
   * asset-writer mutex. SERIALIZING FIFO semantics — concurrent acquires
   * QUEUE behind prior holders rather than coalescing.
   *
   * Strategy (a) from the C-04 review: TWO maps. signOutput retains its
   * COALESCING signMutex above (preserves Phase 14 / 15 idempotent-retry
   * intent — a second sign call for the same (versionId, filename) shares
   * the first's in-flight result). The new assetWriterMutex is the OUTER
   * serializer that prevents signOutput AND redactManifestForVersion from
   * running concurrently on the same compound key — without it, redaction
   * could either coalesce with a sign (wrong-shape result) OR interleave
   * with it (non-deterministic event-row ordering, breaking T-15-08 audit
   * invariants).
   *
   * Both Engine.signOutput and Engine.redactManifestForVersion acquire this
   * mutex on entry. acquireAssetWriterLock chains the new task onto the
   * latest in-flight promise for that key (FIFO). 30s acquire timeout maps
   * to REDACT_TIMEOUT (T-16-15a mitigation).
   *
   * Map<key, Promise<void>> — each key's Promise resolves when the most
   * recent task on that key completes (success OR failure). Acquire chains
   * onto the existing Promise so tasks run FIFO.
   */
  private readonly assetWriterMutex = new Map<string, Promise<void>>();

  /**
   * FIFO-serializing acquire — runs `task` AFTER all prior holders for the
   * same compound key release. 30-second timeout maps to REDACT_TIMEOUT.
   * Map entry self-cleans when the in-flight chain settles AND no later
   * acquire chained behind it (T-15-06 bounded-growth).
   */
  private async acquireAssetWriterLock<T>(
    versionId: string,
    filename: string,
    task: () => Promise<T>,
    timeoutMs: number = 30_000,
  ): Promise<T> {
    const key = `${versionId}::${filename}`;
    const prior = this.assetWriterMutex.get(key) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((res) => { release = res; });
    // Chain — next acquire on this key waits for `slot` to resolve.
    const ownChain = prior.then(() => slot);
    this.assetWriterMutex.set(key, ownChain);
    // Wait for the prior, with timeout guarding against hung callers.
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(() => {
        rej(
          new TypedError(
            'REDACT_TIMEOUT',
            `assetWriterMutex acquire timed out after ${timeoutMs}ms for ${key}`,
            'A prior signOutput or redactManifestForVersion call on the same (version_id, filename) is hung. Investigate the in-flight task.',
          ),
        );
      }, timeoutMs);
    });
    // Suppress unhandled-rejection on the timeout promise (in the success
    // path the timer is cleared but the Promise was attached to a race that
    // doesn't keep its rejection handler alive after Promise.race settles).
    timeout.catch(() => { /* swallow when not won */ });
    try {
      await Promise.race([prior, timeout]);
      // Acquire succeeded — clear the pending timer so it doesn't linger.
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      return await task();
    } finally {
      // Defensive — if Promise.race rejected via the timeout, the handle
      // is already fired but we defensively clear in case the race won by
      // task() throwing before the timer cleared. No-op when already null.
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      release();
      // Self-cleanup: only delete the map entry if our own chain is STILL
      // the latest (i.e., no concurrent acquire chained behind us). Done in
      // a microtask so the chain has time to be replaced if needed.
      queueMicrotask(() => {
        if (this.assetWriterMutex.get(key) === ownChain) {
          this.assetWriterMutex.delete(key);
        }
      });
    }
  }

  constructor(
    db: BaseDb,
    private repo: HierarchyRepo,
    private versionRepo: VersionRepo,
    private provenanceRepo: ProvenanceRepo,
    private client: GenerationProvider | null = null,
    outputRoot: string = 'outputs',
    options: {
      maxConcurrentPollers?: number;
      modelsDir?: string | null;
      c2paConfig?: C2paConfig | null;
      anthropicConfig?: { apiKey: string } | null;
    } = {},
  ) {
    // Widen once at the boundary — drizzle factory returns the intersection
    // at runtime, but the class-level type omits $client. Plan 04-02 pattern.
    this.db = db as Db;
    this.outputRoot = outputRoot;
    this.modelsDir = options.modelsDir ?? null;
    this.c2paConfig = options.c2paConfig ?? null;
    this.anthropicConfig = options.anthropicConfig ?? null;
    this.events = createEngineEmitter();
    this.breadcrumb = new BreadcrumbResolver(repo, versionRepo);
    const provenanceWriter = new ProvenanceWriter(provenanceRepo);
    this.generation = new GenerationEngine(
      repo,
      versionRepo,
      provenanceRepo,
      provenanceWriter,
      client,
      this.breadcrumb,
      outputRoot,
      { maxConcurrentPollers: options.maxConcurrentPollers },
      // Phase 13 — fire-and-forget hook delegates to the async background
      // fingerprinter. The hook itself returns synchronously (returns a void
      // expression of a Promise.catch) so GenerationEngine.downloadAndPersist
      // is never delayed by hash work (criterion #4). Background errors are
      // logged via console.error in the .catch() — never re-thrown.
      (versionId: string) => {
        void this.fingerprintModelsForVersion(versionId).catch((err) => {
          console.error(
            `vfx-familiar: background fingerprint failed for ${versionId}:`,
            (err as Error).message,
          );
        });
      },
    );
    // Phase 4 asset wiring — repos constructed internally so callers don't
    // shoulder the layering. Engine owns asset-repo construction (D-ASST-27).
    const tagRepo = new TagRepo(this.db, versionRepo);
    const metadataRepo = new MetadataRepo(this.db, versionRepo);
    this.assets = new AssetsEngine(
      this.db,
      tagRepo,
      metadataRepo,
      versionRepo,
      this.breadcrumb,
    );
  }

  // ================================================================
  // PHASE 5 — EVENT EMISSION HELPERS (D-WEBUI-29)
  // ================================================================

  /** Current ISO timestamp — one place so tests can be time-travel-friendly. */
  private nowIso(): string {
    return new Date().toISOString();
  }

  // ================================================================
  // WORKSPACE
  // ================================================================

  createWorkspace(name: string): { entity: Workspace; breadcrumb: Breadcrumb } {
    const entity = this.repo.createWorkspace(name);
    // D-WEBUI-29: hierarchy.created fires AFTER the row is inserted so
    // a listener can safely call engine.getWorkspace(entity.id) without race.
    this.events.emitEvent('hierarchy.created', {
      entity_type: 'workspace',
      entity_id: entity.id,
      parent_id: null,
      at: this.nowIso(),
    });
    return { entity, breadcrumb: this.breadcrumb.resolve('workspace', entity.id) };
  }

  getWorkspace(id: string): { entity: Workspace; breadcrumb: Breadcrumb } {
    const entity = this.repo.getWorkspace(id);
    if (!entity) {
      throw new TypedError(
        'WORKSPACE_NOT_FOUND',
        `Workspace '${id}' not found`,
        `List workspaces with { tool: 'workspace', action: 'list' }`,
      );
    }
    return { entity, breadcrumb: this.breadcrumb.resolve('workspace', entity.id) };
  }

  listWorkspaces(limit: number, offset: number): ListResult<Workspace> {
    const { items, total_count } = this.repo.listWorkspaces(limit, offset);
    return {
      items: items.map((ws) => ({ ...ws, ...this.breadcrumb.resolve('workspace', ws.id) })),
      total_count,
      limit,
      offset,
    };
  }

  // ================================================================
  // PROJECT
  // ================================================================

  createProject(
    workspaceId: string,
    name: string,
  ): { entity: Project; breadcrumb: Breadcrumb } {
    const entity = this.repo.createProject(workspaceId, name);
    this.events.emitEvent('hierarchy.created', {
      entity_type: 'project',
      entity_id: entity.id,
      parent_id: workspaceId,
      at: this.nowIso(),
    });
    return { entity, breadcrumb: this.breadcrumb.resolve('project', entity.id) };
  }

  getProject(id: string): { entity: Project; breadcrumb: Breadcrumb } {
    const entity = this.repo.getProject(id);
    if (!entity) {
      throw new TypedError(
        'PROJECT_NOT_FOUND',
        `Project '${id}' not found`,
        `List projects with { tool: 'project', action: 'list' }`,
      );
    }
    return { entity, breadcrumb: this.breadcrumb.resolve('project', entity.id) };
  }

  listProjects(
    workspaceId: string | undefined,
    limit: number,
    offset: number,
    opts?: { sort?: HierarchySort },
  ): ListResult<Project> {
    // Phase 18 / Plan 18-03: opts.sort is optional. When provided, the repo
    // applies the whitelisted sort (Plan 18-01 buildHierarchyOrderBy). When
    // omitted, the repo preserves pre-Phase-18 ORDER BY (D-10 back-compat for
    // MCP tool callers — src/tools/project-tool.ts:88 calls without opts).
    const { items, total_count } = this.repo.listProjects(workspaceId, limit, offset, opts);
    return {
      items: items.map((p) => ({ ...p, ...this.breadcrumb.resolve('project', p.id) })),
      total_count,
      limit,
      offset,
    };
  }

  // ================================================================
  // SEQUENCE
  // ================================================================

  createSequence(
    projectId: string,
    name: string,
  ): { entity: Sequence; breadcrumb: Breadcrumb } {
    const entity = this.repo.createSequence(projectId, name);
    this.events.emitEvent('hierarchy.created', {
      entity_type: 'sequence',
      entity_id: entity.id,
      parent_id: projectId,
      at: this.nowIso(),
    });
    return { entity, breadcrumb: this.breadcrumb.resolve('sequence', entity.id) };
  }

  getSequence(id: string): { entity: Sequence; breadcrumb: Breadcrumb } {
    const entity = this.repo.getSequence(id);
    if (!entity) {
      throw new TypedError(
        'SEQUENCE_NOT_FOUND',
        `Sequence '${id}' not found`,
        `List sequences with { tool: 'sequence', action: 'list' }`,
      );
    }
    return { entity, breadcrumb: this.breadcrumb.resolve('sequence', entity.id) };
  }

  listSequences(
    projectId: string | undefined,
    limit: number,
    offset: number,
    opts?: { sort?: HierarchySort },
  ): ListResult<Sequence> {
    // Phase 18 / Plan 18-03: see listProjects for the back-compat invariant.
    const { items, total_count } = this.repo.listSequences(projectId, limit, offset, opts);
    return {
      items: items.map((s) => ({ ...s, ...this.breadcrumb.resolve('sequence', s.id) })),
      total_count,
      limit,
      offset,
    };
  }

  // ================================================================
  // SHOT
  // ================================================================

  createShot(sequenceId: string, name: string): { entity: Shot; breadcrumb: Breadcrumb } {
    // Regex FIRST, before any DB work. Engine is the single authority on shot naming.
    if (!SHOT_NAME_REGEX.test(name)) {
      throw new TypedError(
        'INVALID_SHOT_FORMAT',
        `Shot name '${name}' does not match expected format`,
        `Shot names must match ^sh\\d{3,}$ — e.g. 'sh010', 'sh020'`,
      );
    }
    const entity = this.repo.createShot(sequenceId, name);
    this.events.emitEvent('hierarchy.created', {
      entity_type: 'shot',
      entity_id: entity.id,
      parent_id: sequenceId,
      at: this.nowIso(),
    });
    return { entity, breadcrumb: this.breadcrumb.resolve('shot', entity.id) };
  }

  getShot(id: string): { entity: Shot; breadcrumb: Breadcrumb } {
    const entity = this.repo.getShot(id);
    if (!entity) {
      throw new TypedError(
        'SHOT_NOT_FOUND',
        `Shot '${id}' not found`,
        `List shots with { tool: 'shot', action: 'list' }`,
      );
    }
    return { entity, breadcrumb: this.breadcrumb.resolve('shot', entity.id) };
  }

  listShots(
    sequenceId: string | undefined,
    limit: number,
    offset: number,
    opts?: { sort?: HierarchySort },
  ): ListResult<Shot> {
    // Phase 18 / Plan 18-03: see listProjects for the back-compat invariant.
    const { items, total_count } = this.repo.listShots(sequenceId, limit, offset, opts);
    return {
      items: items.map((s) => ({ ...s, ...this.breadcrumb.resolve('shot', s.id) })),
      total_count,
      limit,
      offset,
    };
  }

  // ================================================================
  // PHASE 20 — SHOT STATUS (STAT-04 facade over shot-status-repo + SSE event)
  // ================================================================

  /**
   * STAT-04 — transition a shot to `toStatus`, emitting 'shot.status_changed'.
   *
   * The repo writes BOTH (UPDATE shots.status + INSERT shot_status_events) in
   * one transaction so partial writes are impossible. The previousStatus is
   * read from the in-memory shot.status (null-coalesced to 'wip' per the
   * STAT-03 default) BEFORE the repo mutates it — this keeps the event payload
   * accurate for cross-status transitions. Throws SHOT_NOT_FOUND when the shot
   * does not exist.
   */
  setShotStatus(
    shotId: string,
    toStatus: ShotStatus,
    changedBy: string,
    note?: string,
  ): {
    shotId: string;
    name: string;
    previousStatus: ShotStatus;
    newStatus: ShotStatus;
    eventId: string;
  } {
    const shot = this.repo.getShot(shotId);
    if (!shot) {
      throw new TypedError(
        'SHOT_NOT_FOUND',
        `Shot '${shotId}' not found`,
        `List shots with { tool: 'shot', action: 'list' }`,
      );
    }
    const previousStatus = (shot.status as ShotStatus) ?? 'wip';
    const event = insertStatusEvent(
      this.db,
      shotId,
      previousStatus,
      toStatus,
      changedBy,
      note,
    );
    this.events.emitEvent('shot.status_changed', {
      shot_id: shotId,
      sequence_id: shot.sequence_id,
      from_status: previousStatus,
      to_status: toStatus,
      changed_by: changedBy,
      note: note ?? null,
      at: this.nowIso(),
    });
    return {
      shotId,
      name: shot.name,
      previousStatus,
      newStatus: toStatus,
      eventId: event.id,
    };
  }

  /**
   * STAT-04 — read the current status of a shot plus the timestamp of the most
   * recent status event. `status` is null-coalesced to 'wip' so callers never
   * need to handle a null state. `lastChangedAt` is null for shots that have
   * never been transitioned. Throws SHOT_NOT_FOUND when the shot does not exist.
   */
  getShotStatus(shotId: string): {
    shotId: string;
    name: string;
    status: ShotStatus;
    lastChangedAt: number | null;
  } {
    const shot = this.repo.getShot(shotId);
    if (!shot) {
      throw new TypedError(
        'SHOT_NOT_FOUND',
        `Shot '${shotId}' not found`,
        `List shots with { tool: 'shot', action: 'list' }`,
      );
    }
    const history = getStatusHistory(this.db, shotId, 1);
    return {
      shotId,
      name: shot.name,
      status: (shot.status as ShotStatus) ?? 'wip',
      lastChangedAt: history[0]?.created_at ?? null,
    };
  }

  /**
   * STAT-04 — list up to `limit` shot status events for a shot, newest-first.
   * Repo `getStatusHistory` uses the idx_shot_status_events_shot_time covering
   * index for O(log n) bounded reads. Throws SHOT_NOT_FOUND when the shot does
   * not exist.
   */
  listShotStatusHistory(
    shotId: string,
    limit: number,
  ): { shotId: string; history: ShotStatusEvent[]; total: number } {
    const shot = this.repo.getShot(shotId);
    if (!shot) {
      throw new TypedError(
        'SHOT_NOT_FOUND',
        `Shot '${shotId}' not found`,
        `List shots with { tool: 'shot', action: 'list' }`,
      );
    }
    const history = getStatusHistory(this.db, shotId, limit);
    return { shotId, history, total: history.length };
  }

  // ===== Phase 21 — GRID-04 denormalized shot grid (Engine.listShotGrid) =====

  /**
   * `listShotGrid` — GRID-04 facade — return a denormalized shot grid payload for the
   * dashboard's ShotGridView. Delegates the single-pass window-function CTE
   * join to `listShotsForGrid` (shot-status-repo) and re-maps the raw repo
   * rows into the wire contract locked by 21-CONTEXT.md D-13 (server builds
   * `thumbnail_url` so the dashboard never assembles URL strings; see
   * 21-PATTERNS.md §10 for the rationale and 21-RESEARCH.md Example 1 for
   * the verbatim facade body).
   *
   * The repo's `status` field is null-coalesced to 'wip' at the repo layer
   * (shot-status-repo:getCurrentStatus inheritance); the facade does NOT
   * re-coalesce. Shots with zero completed versions surface as
   * `latest_completed_version: null` (D-19 / Phase 17 SkeletonThumbnail
   * fallback path).
   *
   * Throws TypedError('SEQUENCE_NOT_FOUND') for unknown sequenceId — the
   * HTTP layer (dashboard-routes.ts) translates this to 404 via the
   * global typedErrorHandler (no try/catch needed in the route).
   */
  listShotGrid(
    sequenceId: string,
    opts: { cursor: ShotGridCursor | null; limit: number },
  ): {
    sequence: { id: string; name: string };
    shots: Array<{
      id: string;
      name: string;
      status: ShotStatus;
      version_count: number;
      // Phase 23 — D-03 per-row staleness flag, coerced from the repo's
      // SQLite 0|1 to a real boolean before emitting on the wire.
      is_stale: boolean;
      latest_completed_version: {
        id: string;
        thumbnail_url: string;
        completed_at: number;
      } | null;
    }>;
    // Phase 23 — D-02 LOCKED SequenceStats envelope shape. Inlined mirror of
    // `SequenceStats` from packages/dashboard/src/types/shot-grid.ts — the
    // architecture-purity test (src/__tests__/architecture-purity.test.ts)
    // forbids dashboard→server imports; we keep the server tree free of
    // cross-tree imports in BOTH directions by inlining here. Keep in sync
    // with the dashboard type definition.
    stats: {
      total: number;
      approved_pct: number;
      counts: Record<ShotStatus, number>;
      pending_review_backlog: number;
      stale_count: number;
    };
    next_cursor: string | null;
    total_count: number;
  } {
    const sequence = this.repo.getSequence(sequenceId);
    if (!sequence) {
      throw new TypedError(
        'SEQUENCE_NOT_FOUND',
        `Sequence '${sequenceId}' not found`,
        `List sequences with { tool: 'sequence', action: 'list' }`,
      );
    }
    const { items, next_cursor, total_count } = listShotsForGrid(
      this.db,
      sequenceId,
      opts,
    );
    // Phase 23 / Plan 23-02 — D-01 single-endpoint composition: alongside the
    // paginated `listShotsForGrid` result, run the whole-sequence
    // getSequenceStats query and assemble the wire-shape envelope. The
    // dashboard's `sequenceStats` signal seeds from `body.stats` on every
    // fetchShotGrid call (independent of `shots[]` pagination).
    const rawStats = getSequenceStats(this.db, sequenceId);
    // D-14 — approved_pct is computed in TypeScript (not SQL) with explicit
    // divide-by-zero guard. `Math.round((approved/total)*100)` yields an
    // integer in [0..100]; `total === 0 → 0` (never NaN). The repo function
    // initializes all 5 ShotStatus keys to 0, so `rawStats.counts.approved`
    // is always defined.
    const approved = rawStats.counts.approved;
    const approved_pct =
      rawStats.total === 0 ? 0 : Math.round((approved / rawStats.total) * 100);
    // Pitfall 10 — `pending-review` is a hyphenated ShotStatus key so it
    // MUST use bracket access (dot access would parse as `counts.pending`
    // followed by a subtraction `- review`).
    const stats = {
      total: rawStats.total,
      approved_pct,
      counts: rawStats.counts,
      pending_review_backlog: rawStats.counts['pending-review'],
      stale_count: rawStats.stale_count,
    };
    const shots = items.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      version_count: r.version_count,
      // D-03 + Phase 23 wire-shape coercion: SQLite returns is_stale as
      // 0|1 (number); the wire shape is `is_stale: boolean`. Boolean(0) ===
      // false; Boolean(1) === true.
      is_stale: Boolean(r.is_stale),
      latest_completed_version:
        r.lcv_id !== null && r.lcv_completed_at !== null
          ? {
              id: r.lcv_id,
              thumbnail_url: `/api/versions/${encodeURIComponent(r.lcv_id)}/thumbnail`,
              completed_at: r.lcv_completed_at,
            }
          : null,
    }));
    return {
      sequence: { id: sequence.id, name: sequence.name },
      shots,
      stats,
      next_cursor,
      total_count,
    };
  }

  // ================================================================
  // PHASE 2 — GENERATION (delegates to composed GenerationEngine)
  // ================================================================

  async submitGeneration(
    shotId: string,
    workflowJson: Record<string, unknown>,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    const result = await this.generation.submitGeneration(shotId, workflowJson, notes);
    // D-WEBUI-29: version.created fires AFTER the row is inserted. The
    // result.breadcrumb.text is the 5-entry breadcrumb_text from the resolver.
    this.events.emitEvent('version.created', {
      version_id: result.entity.id,
      shot_id: result.entity.shot_id,
      breadcrumb: result.breadcrumb.text,
      at: this.nowIso(),
    });
    return result;
  }

  /**
   * Phase 5 wrapper around GenerationEngine.getGenerationStatus:
   *  - Captures the pre-call status so we can detect transitions.
   *  - On status change, emits version.status_changed (D-WEBUI-29).
   *  - On transition to `completed`, fires the dashboard-stable download hook
   *    (D-WEBUI-26) — writes the first output to `outputsDir/versionId/filename`
   *    so `/api/versions/:id/output` (Plan 04) has a stable lookup path.
   *    Non-fatal: downloadOutput swallows failures and returns null.
   */
  async getGenerationStatus(
    versionId: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    const before = this.versionRepo.getVersion(versionId);
    const beforeStatus = before?.status ?? null;
    const result = await this.generation.getGenerationStatus(versionId);
    const afterStatus = result.entity.status;
    if (beforeStatus !== afterStatus) {
      this.events.emitEvent('version.status_changed', {
        version_id: result.entity.id,
        shot_id: result.entity.shot_id,
        status: afterStatus,
        breadcrumb: result.breadcrumb.text,
        at: this.nowIso(),
      });
    }
    // D-WEBUI-26: non-fatal dashboard-stable download on completion.
    // outputs_json is populated by GenerationEngine.downloadAndPersist BEFORE
    // markCompleted flips the status; we re-use the first stored filename.
    if (afterStatus === 'completed' && beforeStatus !== 'completed' && result.entity.outputs_json) {
      try {
        const parsed = JSON.parse(result.entity.outputs_json) as Array<{ filename?: string }>;
        const firstFilename = Array.isArray(parsed) ? parsed[0]?.filename ?? null : null;
        if (firstFilename) {
          // Fire-and-forget — explicit catch silences any late rejection the
          // helper may surface (the helper already catches internally, but
          // .catch(() => {}) is belt-and-suspenders per the plan contract).
          // Phase 14 — pass `this` so the downloader's signing hook can call
          // engine.signOutput post-download. Structural Pick (EngineForC2pa)
          // means the downloader sees only the signOutput method surface.
          void downloadOutput(
            this.client,
            result.entity.id,
            this.outputRoot,
            firstFilename,
            {},
            this,
          ).catch(() => {});
        }
      } catch {
        // outputs_json malformed — non-fatal. Dashboard renders placeholder.
      }
    }
    return result;
  }

  async start(): Promise<void> {
    return this.generation.start();
  }

  async stop(): Promise<void> {
    return this.generation.stop();
  }

  // ================================================================
  // PHASE 3 — VERSION READS + PROVENANCE + DIFF
  // ================================================================

  /**
   * D-PROV-08 + D-ASST-19: always-hydrated version entity. Plan 04-03 extended
   * this to return VersionWithAssets (tags + metadata inline). Plan 04-05 updates
   * the tool layer (version-tool.ts) to surface tags + metadata in the response.
   */
  getVersion(versionId: string): { entity: VersionWithAssets; breadcrumb: Breadcrumb } {
    const entity = this.versionRepo.getVersion(versionId);
    if (!entity) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    const withAssets = this.assets.hydrateVersionWithAssets(entity);
    return { entity: withAssets, breadcrumb: this.breadcrumb.resolve('version', entity.id) };
  }

  /**
   * D-PROV-09 + D-ASST-20 + Phase 18 (Plan 18-02): paginated version list for
   * a shot via composite-cursor pagination (SORT-01 default Latest with
   * NULL-pin; SORT-02 whitelist enum surface; SORT-05 stable cursor).
   * Opt-in hydration via include_tags / include_metadata flags (default omit
   * keeps payload cheap for list-heavy reads). When neither flag is set, items
   * are plain Version (Phase 3 parity). Otherwise each item gains the requested
   * array(s) — tags only, metadata only, or both.
   *
   * The legacy `offset` field on the ListResult shape is preserved as a
   * constant 0 transitional artifact for the v1.2 dashboard surface — it is
   * no longer meaningful under cursor pagination, but downstream callers
   * (Plan 18-04 lib/api.ts) will drop it from the dashboard's TypeScript
   * shape. The `next_cursor` field is the canonical pagination signal.
   */
  listVersionsForShot(
    shotId: string,
    opts: {
      sort: VersionSort;
      cursor: VersionCursor | null;
      limit: number;
      include_tags?: boolean;
      include_metadata?: boolean;
    },
  ): ListResult<VersionWithAssets | Version> & { next_cursor: string | null } {
    const { sort, cursor, limit, include_tags, include_metadata } = opts;
    const { items, next_cursor, total_count } = this.versionRepo.listByShot(shotId, {
      sort,
      cursor,
      limit,
    });
    const hydrated = items.map((v) => {
      let withAssets: Version | VersionWithAssets = v;
      if (include_tags || include_metadata) {
        const full = this.assets.hydrateVersionWithAssets(v);
        if (include_tags && include_metadata) {
          withAssets = full;
        } else if (include_tags) {
          // tags only
          const { metadata: _m, ...rest } = full;
          withAssets = rest as Version & { tags: string[] };
        } else {
          // metadata only
          const { tags: _t, ...rest } = full;
          withAssets = rest as Version & { metadata: MetadataKV[] };
        }
      }
      return { ...withAssets, ...this.breadcrumb.resolve('version', v.id) };
    });
    return { items: hydrated, total_count, limit, offset: 0, next_cursor };
  }

  /** D-PROV-10: full chronological event history. Empty events[] for pre-Phase-3 rows. */
  getProvenance(
    versionId: string,
  ): { events: ProvenanceEvent[]; breadcrumb: Breadcrumb } {
    // Assert the version exists before exposing provenance reads.
    const exists = this.versionRepo.getVersion(versionId);
    if (!exists) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    const events = this.provenanceRepo.getEventsForVersion(versionId);
    return { events, breadcrumb: this.breadcrumb.resolve('version', versionId) };
  }

  /**
   * D-PROV-11, D-PROV-20: same-shot field-level diff. The pure diffVersions
   * function enforces same-shot + comparable-state guards — this method only
   * builds the DiffSnapshot pair from repo state + attaches the breadcrumb.
   *
   * Phase 12 (DEMO-03): when B is reproduce-lineage, attaches a
   * reproduction_divergence field carrying SHA-256 mismatch detail and any
   * persisted partner-API non-determinism warnings (D-CTX-4). NULL for
   * non-reproduce-lineage diffs OR when bytes match AND no warnings recorded.
   * Now async because hash computation reads from disk via streaming SHA-256.
   */
  async diffVersions(
    versionAId: string,
    versionBId: string,
  ): Promise<DiffResponse & { breadcrumb: BreadcrumbEntry[]; breadcrumb_text: string }> {
    const snapA = this.loadDiffSnapshot(versionAId);
    const snapB = this.loadDiffSnapshot(versionBId);
    const result = pureDiffVersions({ a: snapA, b: snapB });
    const crumbs = this.breadcrumb.resolve('version', versionAId);

    // Phase 12 — only compute reproduction_divergence when B is reproduce-lineage.
    // Non-reproduce diffs always carry reproduction_divergence: null (criterion #4).
    let reproduction_divergence: ReproductionDivergence | null = null;
    const versionB = this.versionRepo.getVersion(versionBId);
    if (versionB && versionB.lineage_type === 'reproduce') {
      reproduction_divergence = await this.computeReproductionDivergence(
        versionAId,
        versionBId,
        versionB.reproduction_warnings_json,
      );
    }

    return {
      summary: result.summary,
      changes: result.changes,
      reproduction_divergence,
      breadcrumb: crumbs.entries,
      breadcrumb_text: crumbs.text,
    };
  }

  /**
   * Phase 12 — DEMO-03. Resolve the divergence inputs (warnings + hashes) and
   * delegate to the pure helper. Reads outputs_json on each version to find
   * the first stored filename, hashes the file at <outputRoot>/<versionId>/<filename>.
   * Hashes are independent: if either file is missing we still call the pure
   * helper, which returns sha256_mismatch=null when either hash is null.
   */
  private async computeReproductionDivergence(
    parentVersionId: string,
    reproductionVersionId: string,
    warningsJson: string | null,
  ): Promise<ReproductionDivergence | null> {
    let warnings: string[] = [];
    if (warningsJson) {
      try {
        const parsed = JSON.parse(warningsJson);
        if (Array.isArray(parsed)) warnings = parsed.filter((w) => typeof w === 'string');
      } catch {
        warnings = [];
      }
    }
    const parentFilename = this.firstStoredFilename(parentVersionId);
    const reproductionFilename = this.firstStoredFilename(reproductionVersionId);
    // Phase 12 WR-01: graceful degradation. computeOutputSha256 returns null
    // for the ENOENT (missing file) case but re-throws other I/O errors —
    // EACCES (permission flipped mid-flight), EISDIR (a directory exists at
    // the expected file path), EBUSY (locked), EMFILE (fd exhaustion), etc.
    // The honesty contract treats divergence as best-effort transparency: a
    // hash failure must degrade to "output unreadable" (same downstream UX
    // as missing) so the divergence object still surfaces (warnings still
    // visible, *_output_present=false). Without this guard, version.diff
    // rejects, surfacing a 500 to HTTP and a tool error to MCP — silently
    // erasing partner-API non-determinism warnings the user needs to see.
    const safeHash = async (
      vid: string,
      fname: string | null,
    ): Promise<string | null> => {
      if (!fname) return null;
      try {
        return await computeOutputSha256(this.outputRoot, vid, fname);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
        const msg = (err as Error).message;
        // Low-frequency event (per-disk failures). Log once via console.error
        // for operator visibility; never throw — the diff envelope must
        // still return so the user can see the warnings array.
        console.error(
          `vfx-familiar: output-hash unreadable: ${vid}/${fname} (${code}): ${msg}`,
        );
        return null;
      }
    };
    const parentHash = await safeHash(parentVersionId, parentFilename);
    const reproductionHash = await safeHash(reproductionVersionId, reproductionFilename);
    return buildReproductionDivergence({ warnings, parentHash, reproductionHash });
  }

  /** Internal: read outputs_json on a version row and return the first stored
   *  filename, or null if outputs_json is empty/malformed. Mirrors the
   *  filename-extraction in pipeline.ts:369-384 (download-on-completion path). */
  private firstStoredFilename(versionId: string): string | null {
    const v = this.versionRepo.getVersion(versionId);
    if (!v?.outputs_json) return null;
    try {
      const parsed = JSON.parse(v.outputs_json) as Array<{ filename?: string }>;
      return Array.isArray(parsed) ? parsed[0]?.filename ?? null : null;
    } catch {
      return null;
    }
  }

  /** Internal helper: assemble a DiffSnapshot for a single version. */
  private loadDiffSnapshot(versionId: string): DiffSnapshot {
    const v = this.versionRepo.getVersion(versionId);
    if (!v) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    const submit = this.provenanceRepo.getSubmitEvent(versionId);
    const completed = this.provenanceRepo.getLatestCompletedEvent(versionId);
    const workflow_json = submit?.workflow_json
      ? (JSON.parse(submit.workflow_json) as Record<string, unknown>)
      : null;
    const prompt_json = completed?.prompt_json
      ? (JSON.parse(completed.prompt_json) as Record<string, unknown>)
      : null;
    // Phase 13 — PROV-V-03. Prefer the latest fingerprinted models so diff
    // sees populated hashes after the background fingerprinter ran. Falls
    // through to completed_event.models_json (legacy / pre-fingerprint state)
    // when no 'models_fingerprinted' event exists yet. Returns null on
    // malformed JSON in either source — diff degrades gracefully.
    const models: ModelRef[] | null = this.provenanceRepo.getLatestFingerprints(versionId);
    let outputCount = 0;
    if (v.outputs_json) {
      try {
        const parsed = JSON.parse(v.outputs_json) as unknown[];
        outputCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        outputCount = 0;
      }
    }
    return {
      version_id: v.id,
      shot_id: v.shot_id,
      version_number: v.version_number,
      status: v.status,
      created_at: v.created_at,
      completed_at: v.completed_at,
      workflow_json,
      prompt_json,
      models_json: models,
      seed: completed?.seed ?? null,
      output_count: outputCount,
    };
  }

  /** PROV-05: reproduce — delegates to GenerationEngine. */
  async reproduceVersion(
    sourceVersionId: string,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb; reproduction_warnings: string[] }> {
    const result = await this.generation.reproduceVersion(sourceVersionId, notes);
    this.events.emitEvent('version.created', {
      version_id: result.entity.id,
      shot_id: result.entity.shot_id,
      breadcrumb: result.breadcrumb.text,
      at: this.nowIso(),
    });
    return result;
  }

  /** PROV-06: iterate — delegates to GenerationEngine. */
  async iterateFromVersion(
    sourceVersionId: string,
    overrides?: Record<string, IterateOverride>,
    seed?: number,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    const result = await this.generation.iterateFromVersion(sourceVersionId, overrides, seed, notes);
    this.events.emitEvent('version.created', {
      version_id: result.entity.id,
      shot_id: result.entity.shot_id,
      breadcrumb: result.breadcrumb.text,
      at: this.nowIso(),
    });
    return result;
  }

  // ================================================================
  // PHASE 13 — MODEL FINGERPRINTING (PROV-V-03)
  // ================================================================

  /**
   * Phase 13 — PROV-V-03. Fingerprint every loader-resolved model on the
   * completed prompt blob, persist as a sibling 'models_fingerprinted'
   * event (append-only — never UPDATEs the original 'completed' row).
   *
   * Idempotent (D-CTX `Claude's Discretion` clause): if a fingerprinted
   * event already exists for this version, returns immediately. Used by
   * crash-recovery on boot — re-running on an already-fingerprinted row
   * is a cheap no-op (events scan only, no hashing).
   *
   * Production / ComfyUI Cloud reality: when this.modelsDir is null,
   * every entry records `model_hash_unavailable: 'models_dir_not_configured'`
   * per D-CTX-5. Local-dev / self-host paths populate `model_hash` for
   * any model resolvable under the configured root.
   *
   * Background path: called from a `void`-fired callback at the
   * GenerationEngine.downloadAndPersist completion site. Errors are
   * logged via console.error in the caller's `.catch(...)` — never thrown
   * upward into the generation hot path (criterion #4).
   */
  async fingerprintModelsForVersion(versionId: string): Promise<void> {
    // Idempotency check — read events directly so we don't trigger the
    // fall-through-to-completed branch in getLatestFingerprints.
    const events = this.provenanceRepo.getEventsForVersion(versionId);
    const alreadyFingerprinted = events.some(
      (e) => e.event_type === 'models_fingerprinted',
    );
    if (alreadyFingerprinted) return;

    const source = this.provenanceRepo.getLatestFingerprints(versionId);
    if (!source) return; // pre-Phase-13 row or no completed event yet — skip
    if (source.length === 0) {
      // Empty models array — still record an explicit fingerprinted event
      // so the idempotency check above sees the work as done. Phase 14
      // can then rely on "fingerprinted event exists" as the signal that
      // the background path ran for this version.
      this.provenanceRepo.appendModelsFingerprintedEvent(versionId, []);
      return;
    }

    const fingerprinted: ModelRef[] = await Promise.all(
      source.map(async (m) => {
        const result = await fingerprintModel(
          this.modelsDir,
          m.class_type,
          m.model_name,
        );
        // Discriminated-union narrowing — exactly one of the two fields
        // is non-null per D-CTX-1.
        if ('model_hash' in result) {
          return {
            node_id: m.node_id,
            class_type: m.class_type,
            model_name: m.model_name,
            model_hash: result.model_hash,
            model_hash_unavailable: null,
          };
        }
        return {
          node_id: m.node_id,
          class_type: m.class_type,
          model_name: m.model_name,
          model_hash: null,
          model_hash_unavailable: result.model_hash_unavailable,
        };
      }),
    );

    this.provenanceRepo.appendModelsFingerprintedEvent(versionId, fingerprinted);
  }

  // ================================================================
  // PHASE 14 — C2PA SIGNING (PROV-V-01 / PROV-V-02 / PROV-V-05)
  // ================================================================

  /**
   * Phase 14 — PROV-V-01. Sign one output for a version. Always fires a
   * manifest_signed provenance event (success OR failure path). EXCEPTION:
   * the alreadySigned short-circuit (Concern #7) emits zero events to avoid
   * log spam from recovery-poller retries.
   *
   * Two input modes:
   *   - bytes: Buffer  -> sign via buffer-API (PNG/JPEG) OR temp-file API
   *                        (MP4/WebP/TIFF, src temp written from bytes).
   *                        Returns the signed bytes as `signed: Buffer`.
   *   - filePath: string -> sign via file-API directly (no full buffer load).
   *                        Returns `signedToPath: <dest temp path>`. The
   *                        CALLER (output-downloader.signFileInPlace) is
   *                        responsible for renaming the dest temp into place
   *                        AND unlinking it after the rename. signOutput's
   *                        try/finally cleans the SRC temp regardless.
   *
   * Failure modes (D-CTX-9 graceful — never throws upward):
   *   - signing disabled (no c2paConfig)            -> status_reason='signing_disabled'
   *   - unsupported format (EXR/PSD/unknown)        -> status_reason='unsupported_format'
   *   - cert load failed                            -> status_reason='cert_load_failed'
   *   - native binding unavailable (Concern #11)    -> status_reason='native_binding_unavailable'
   *   - sign call threw (corrupted asset, etc.)     -> status_reason='sign_call_failed'
   *   - bytes oversized for buffer API (Concern #6) -> status_reason='asset_too_large_for_buffer_api'
   *   - already signed (Concern #7)                 -> { ..., alreadySigned: true } + zero events
   */
  async signOutput(
    versionId: string,
    filename: string,
    input: { bytes: Buffer } | { filePath: string },
  ): Promise<{
    signed: Buffer | null;
    signedToPath: string | null;
    alreadySigned?: boolean;
  }> {
    // Phase 15 / B4 — coalesce concurrent sign calls for the SAME
    // (versionId, filename) pair. Concurrent calls with the SAME versionId but
    // DIFFERENT filenames execute as TWO independent sign operations (Phase 15
    // WR-01 fix — the prior versionId-only key returned filename A's signed
    // buffer to callers asking for filename B with no manifest_signed event
    // for B). The compound key preserves re-sign idempotency for matching
    // (version, filename) pairs while letting distinct filenames sign in
    // parallel.
    //
    // Phase 16 / Plan 16-02 (D-PLAN-2-4 / C-04): the COALESCING signMutex is
    // checked OUTSIDE the FIFO-serializing assetWriterMutex so two concurrent
    // signOutput calls for the same key still share an in-flight Promise
    // (the existing Phase 14 idempotent-retry intent is preserved). Only the
    // first caller to acquire the signMutex enters acquireAssetWriterLock —
    // which serializes against any in-flight redactManifestForVersion call
    // on the same (versionId, filename) key.
    const mutexKey = `${versionId}::${filename}`;
    const inflight = this.signMutex.get(mutexKey);
    if (inflight !== undefined) {
      return await inflight;
    }
    const promise = this.acquireAssetWriterLock(versionId, filename, () =>
      this._signOutputInner(versionId, filename, input),
    );
    this.signMutex.set(mutexKey, promise);
    try {
      return await promise;
    } finally {
      // Clear the mutex entry on settle — both success and failure paths.
      this.signMutex.delete(mutexKey);
    }
  }

  private async _signOutputInner(
    versionId: string,
    filename: string,
    input: { bytes: Buffer } | { filePath: string },
  ): Promise<{ signed: Buffer | null; signedToPath: string | null; alreadySigned?: boolean }> {
    const signedAt = new Date().toISOString();

    // Concern #7 — idempotency on re-sign. Read the latest manifest_signed
    // event for this version+filename pair. If the prior event was a SUCCESS,
    // skip the re-sign + return alreadySigned. Re-trying after a signed=false
    // (skip / fail) IS allowed — that's the desired behavior when transient
    // cert misconfig is fixed.
    const prior = this.provenanceRepo.getLatestManifestSignedEvent(versionId, filename);
    if (prior && prior.signed === true) {
      return { signed: null, signedToPath: null, alreadySigned: true };
    }

    // Path 1: signing disabled — c2paConfig is null.
    if (this.c2paConfig === null) {
      this.provenanceRepo.appendManifestSignedEvent(versionId, {
        filename,
        format: '',
        signed: false,
        cert_subject_summary: '',
        signed_at: signedAt,
        status_reason: 'signing_disabled',
        algorithm: '',
      });
      return { signed: null, signedToPath: null };
    }

    // Path 2: format routing.
    const route = routeFormat(filename);
    if (route.mode === 'unsupported') {
      this.provenanceRepo.appendManifestSignedEvent(versionId, {
        filename,
        // For native-handler-missing (EXR/PSD) the router returns a mimeType;
        // for unknown extensions it does NOT. Surface '' rather than 'undefined'.
        format: route.mimeType ?? '',
        signed: false,
        cert_subject_summary: '',
        signed_at: signedAt,
        status_reason: 'unsupported_format',
        algorithm: '',
      });
      return { signed: null, signedToPath: null };
    }

    // Path 3: lazy signer load.
    const signerOrCode = await this.getOrLoadSigner();
    if ('errorCode' in signerOrCode) {
      this.provenanceRepo.appendManifestSignedEvent(versionId, {
        filename,
        format: route.mimeType,
        signed: false,
        cert_subject_summary: '',
        signed_at: signedAt,
        status_reason: signerOrCode.errorCode,
        algorithm: '',
      });
      return { signed: null, signedToPath: null };
    }
    const signer = signerOrCode.signer;

    // Path 4: build manifest definition + ingredients (Phase 15). Primary
    // model derived from the latest fingerprints (Phase 13). NULL
    // fingerprints -> "model=unknown; hash_unavailable=no_models_recorded".
    const fingerprints = this.provenanceRepo.getLatestFingerprints(versionId);
    const primaryModel = derivePrimaryModel(fingerprints);

    // Resolve ingredients (parent + components + inputTo + asset refs).
    const built = await this.buildManifestForVersion(
      versionId,
      filename,
      route.mimeType,
      primaryModel,
    );
    let manifestForSigning: BuildManifestResult;
    let ingredientsSummary: {
      parent_count: 0 | 1;
      component_count: number;
      input_assertion: boolean;
      unavailable_count: number;
    };
    if (built !== null) {
      manifestForSigning = built;
      ingredientsSummary = summariseIngredientsFromResult(built);
    } else {
      // No completed event — Phase 14 single-c2pa.created shape, no ingredients.
      manifestForSigning = {
        definition: buildManifestDefinition({
          versionId,
          mimeType: route.mimeType,
          primaryModel,
          comfyuiVersion: null,
          appVersion: APP_VERSION,
        }),
        ingredientSpecs: [],
      };
      ingredientsSummary = {
        parent_count: 0,
        component_count: 0,
        input_assertion: false,
        unavailable_count: 0,
      };
    }

    // Path 5: route to embed-buffer or embed-file with ingredient-aware signers.
    try {
      if (route.mode === 'embed-buffer') {
        // Concern #6 — pre-stat / size-cap. If caller passed bytes, check
        // the buffer length. If caller passed filePath, stat the file.
        const bytes = await this.resolveBufferInput(input);
        if (bytes.length > BUFFER_SIGNING_MAX_BYTES) {
          this.provenanceRepo.appendManifestSignedEvent(versionId, {
            filename,
            format: route.mimeType,
            signed: false,
            cert_subject_summary: signer.certSubjectSummary,
            signed_at: signedAt,
            status_reason: 'asset_too_large_for_buffer_api',
            algorithm: signer.algorithm,
          });
          return { signed: null, signedToPath: null };
        }
        const signedBytes = await signEmbedBufferWithIngredients(
          bytes,
          route.mimeType,
          manifestForSigning,
          signer,
        );
        const manifestSha256 = createHash('sha256').update(signedBytes).digest('hex');
        this.provenanceRepo.appendManifestSignedEvent(versionId, {
          filename,
          format: route.mimeType,
          signed: true,
          cert_subject_summary: signer.certSubjectSummary,
          signed_at: signedAt,
          status_reason: '',
          algorithm: signer.algorithm,
          manifest_sha256: manifestSha256,
          ingredients_summary: ingredientsSummary,
        });
        return { signed: signedBytes, signedToPath: null };
      }
      // mode === 'embed-file' — MP4 / WebP / TIFF. Drive c2pa-node's file API
      // via signViaTempFilesWithIngredients which manages the temp dir +
      // 0700/0600 modes + nanoid-suffixed unique partial paths (Concerns #5
      // and #9). The filename's extension MUST be preserved on the temp paths
      // so c2pa-rs selects the correct asset handler (BMFF for .mp4, RIFF for
      // .webp, TIFF for .tif/.tiff). Without the extension, c2pa-rs silently
      // emits unsigned output (a Rule 1 silent-failure bug discovered Plan 14-05).
      const result = await this.signViaTempFilesWithIngredients(
        versionId,
        input,
        filename,
        route.mimeType,
        manifestForSigning,
        signer,
      );
      let manifestSha256: string | null = null;
      if (result.signed) {
        manifestSha256 = createHash('sha256').update(result.signed).digest('hex');
      } else if (result.signedToPath) {
        manifestSha256 = await streamSha256(result.signedToPath);
      }
      this.provenanceRepo.appendManifestSignedEvent(versionId, {
        filename,
        format: route.mimeType,
        signed: true,
        cert_subject_summary: signer.certSubjectSummary,
        signed_at: signedAt,
        status_reason: '',
        algorithm: signer.algorithm,
        manifest_sha256: manifestSha256,
        ingredients_summary: ingredientsSummary,
      });
      return result;
    } catch (err) {
      console.error(
        `vfx-familiar: C2PA signing failed for ${versionId}/${filename}: ${(err as Error).message}`,
      );
      this.provenanceRepo.appendManifestSignedEvent(versionId, {
        filename,
        format: route.mimeType,
        signed: false,
        cert_subject_summary: signer.certSubjectSummary,
        signed_at: signedAt,
        status_reason: 'sign_call_failed',
        algorithm: signer.algorithm,
      });
      return { signed: null, signedToPath: null };
    }
  }

  /**
   * Phase 14 — read accessor for the HTTP layer (Plan 14-04). Returns the
   * latest manifest_signed event payload for a (versionId, filename) pair,
   * or null. The HTTP route uses this to populate the X-C2PA-Signing-Status
   * header on serve.
   */
  getC2paStatusForVersion(
    versionId: string,
    filename: string,
  ): ManifestSignedPayloadFields | null {
    return this.provenanceRepo.getLatestManifestSignedEvent(versionId, filename);
  }

  // ================================================================
  // Phase 19 — SUM-01..06. AI Conversational Summary engine facade.
  // Delegates to the pure orchestration in src/engine/summary/index.ts.
  // ================================================================

  /**
   * Phase 19 — SUM-01..06. Engine facade for the AI conversational summary feature.
   * Delegates to the pure orchestration in src/engine/summary/index.ts. Returns
   * a discriminated SummaryOutcome union — never throws to the HTTP layer for
   * fallback paths (mirrors Engine.signOutput shape).
   *
   * options.regenerate=true skips the cache lookup (forces fresh LLM call) but
   * still respects circuit breaker + sanitization + validation. On success,
   * INSERTs a NEW summary_generated event row; the OLD row is untouched per
   * append-only invariant.
   *
   * Lazy `await import` — defers loading the summary module (and transitively
   * the Anthropic SDK) until first call, preserving boot-resilience. Mirrors
   * the Phase 14 c2pa-node lazy-import discipline.
   */
  async summarizeVersion(
    versionId: string,
    options?: { regenerate?: boolean; signal?: AbortSignal },
  ): Promise<import('./summary/index.js').SummaryOutcome> {
    const { summarizeVersion } = await import('./summary/index.js');
    return summarizeVersion(
      versionId,
      {
        versionRepo: this.versionRepo,
        provenanceRepo: this.provenanceRepo,
        anthropicConfig: this.anthropicConfig,
        clock: () => Date.now(),
      },
      options,
    );
  }

  // ================================================================
  // Phase 16 / Plan 16-01 — PROV-V-07 agent surface (export + verify).
  // The redaction primitive (PROV-V-06) lives in Plan 16-02's
  // Engine.redactManifestForVersion.
  // ================================================================

  /**
   * Phase 16 — D-CTX-3 export facade. Reads the latest manifest_signed event
   * for the version's primary output + the embedded-manifest file bytes,
   * returns base64-encoded snapshot. Plan 16-03's version.export_manifest
   * tool action consumes this verbatim.
   *
   * Throws TypedError VERSION_NOT_FOUND when the version row does not exist.
   * Returns manifest_status='absent' when no manifest_signed event OR signed=false
   * (graceful-fail). Returns manifest_status='unsupported_format' when the
   * format is EXR/PSD/unknown ext.
   *
   * Lazy import — the exporter has zero c2pa-node dependency, but the lazy
   * pattern keeps pipeline.ts free of static engine-c2pa load coupling.
   */
  async exportManifestForVersion(
    versionId: string,
  ): Promise<ExporterResult> {
    const { exportManifest } = await import('./c2pa/exporter.js');
    return await exportManifest(
      versionId,
      this.versionRepo,
      this.provenanceRepo,
      this.outputRoot,
    );
  }

  /**
   * Phase 16 — D-CTX-2 verify facade. Discriminated input: either a versionId
   * (engine resolves disk bytes + mimeType internally) or a (manifestBytes,
   * format) pair (pure-bytes verification path for redaction round-trips +
   * agent payloads received via base64).
   *
   * Returns a VerificationReport. NEVER throws on c2pa-rs failures (those
   * map to discriminated signature_status). Throws TypedError VERSION_NOT_FOUND
   * when versionId-form input refers to a missing version.
   */
  async verifyManifestForVersion(
    input: { versionId: string } | { manifestBytes: Buffer; format: string },
  ): Promise<VerificationReport> {
    const { verifyManifest } = await import('./c2pa/verifier.js');
    if ('versionId' in input) {
      return await verifyManifest({
        versionId: input.versionId,
        versionRepo: this.versionRepo,
        provenanceRepo: this.provenanceRepo,
        outputsDir: this.outputRoot,
      });
    }
    return await verifyManifest({
      manifestBytes: input.manifestBytes,
      format: input.format,
    });
  }

  /**
   * Phase 16 / Plan 16-02 — D-CTX-1 redaction facade. Delegates to
   * redactManifestForVersionImpl (lazy-imported). The engine threads:
   *   - this.versionRepo, this.provenanceRepo, this.outputRoot — same as
   *     Plan 16-01's export/verify facades
   *   - the loaded signer (Phase 14 lazy-load — D-PLAN-2-1)
   *   - acquireAssetWriterLock — D-PLAN-2-4 unified FIFO mutex
   *
   * D-PLAN-2-1: same cert chain (signer reused). D-PLAN-2-2: algorithm
   * detected once at signer-load time; reused. D-PLAN-2-3: ingredient
   * pass-through deferred (parent ingredients not re-mirrored in v1.1;
   * tracked deferred-items.md).
   *
   * Throws TypedError REDACT_SIGNING_DISABLED when c2paConfig is null,
   * REDACT_NO_MANIFEST when no signed manifest_signed event exists,
   * REDACT_PARENT_UNREADABLE when c2pa-rs read fails, REDACT_POLICY_INVALID
   * when applyRedactionPolicy rejects the policy, REDACT_TIMEOUT when the
   * mutex acquire times out (30s), VERSION_NOT_FOUND when the version row
   * does not exist, and EXPORT_PATH_TRAVERSAL_REJECTED on traversal chars.
   */
  async redactManifestForVersion(
    versionId: string,
    redactionPolicy: readonly string[],
  ): Promise<RedactionResult> {
    // C-06 fix: c2paConfig === null is "signing disabled" — distinct
    // semantic from "no manifest". Use the dedicated REDACT_SIGNING_DISABLED
    // code (was REDACT_NO_MANIFEST pre-revision — wrong semantic).
    if (this.c2paConfig === null) {
      throw new TypedError(
        'REDACT_SIGNING_DISABLED',
        'C2PA signing is not configured — cannot redact',
        'Set VFX_FAMILIAR_C2PA_CERT_PEM_PATH + VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH and restart. Redaction requires a signing key to re-sign the redacted manifest.',
      );
    }
    const signerOrCode = await this.getOrLoadSigner();
    if ('errorCode' in signerOrCode) {
      throw new TypedError(
        'REDACT_SIGNING_DISABLED',
        `Cannot load signer for redaction (${signerOrCode.errorCode})`,
        'Verify the cert + private key paths are valid and the native binding is available.',
      );
    }
    const { redactManifestForVersionImpl } = await import('./c2pa/redaction.js');
    return await redactManifestForVersionImpl(
      versionId,
      redactionPolicy,
      this.versionRepo,
      this.provenanceRepo,
      this.outputRoot,
      signerOrCode.signer,
      this.acquireAssetWriterLock.bind(this),
      // Phase 17 / Plan 17-03 (D-05) — bind engine.invalidateThumbnail so the
      // redact path's atomic-rename hook scrubs the cached thumbnail before
      // the next /thumbnail GET serves stale bytes. The structural callback
      // pattern keeps the c2pa → engine boundary composition-friendly.
      this.invalidateThumbnail.bind(this),
    );
  }

  /**
   * Lazy-load the signer + native binding ONCE per process. Distinguishes
   * 'cert_load_failed' from 'native_binding_unavailable' by inspecting the
   * thrown error message — Plan 14-02's signer.ts wraps the native binding
   * load failure with a unique substring ('c2pa-node native binding
   * unavailable') so we can map it precisely.
   *
   * Caches both success and failure; subsequent calls short-circuit. Reset
   * only via process restart (the load is monotonic — re-attempting on the
   * same broken environment is a waste of time).
   */
  private async getOrLoadSigner(): Promise<
    { signer: LoadedSigner } | { errorCode: 'cert_load_failed' | 'native_binding_unavailable' }
  > {
    if (this.signerCache !== null) return { signer: this.signerCache.signer };
    if (this.signerLoadFailedReason !== null) {
      return { errorCode: this.signerLoadFailedReason.code };
    }
    if (this.c2paConfig === null) return { errorCode: 'cert_load_failed' };

    try {
      // Phase 14 fix MR-01: thread tsaUrl through C2paConfig so the operator
      // can opt in to a TSA via VFX_FAMILIAR_C2PA_TSA_URL without source-level
      // changes. Default is null (no TSA — fully offline-friendly).
      const signer = await loadSigner(
        this.c2paConfig.certPemPath,
        this.c2paConfig.privateKeyPemPath,
        this.c2paConfig.tsaUrl,
      );
      this.signerCache = { signer };
      return { signer };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const code: 'cert_load_failed' | 'native_binding_unavailable' = msg.includes(
        'c2pa-node native binding unavailable',
      )
        ? 'native_binding_unavailable'
        : 'cert_load_failed';
      this.signerLoadFailedReason = { code, message: msg };
      console.error(`vfx-familiar: C2PA signer load failed (${code}): ${msg}`);
      return { errorCode: code };
    }
  }

  /**
   * Concern #5 + #9 — temp file orchestration for the file-API signing path.
   *
   *   Layout:  <outputsDir>/.tmp-c2pa/<versionId>/{src,dest}-<nanoid8>
   *   Modes:   dir 0700, files 0600 (POSIX-only — Windows ignores mode bits)
   *   Unique:  nanoid(8) suffix per call avoids concurrent-writer collision
   *   Cleanup: try/finally unlinks the SRC temp regardless. The DEST temp is
   *            either consumed (read into Buffer for the bytes-input path) OR
   *            handed to the caller via signedToPath (filePath-input path);
   *            in the latter case the caller must rename + unlink it.
   *
   * Two branches:
   *   - bytes input:    write src temp from bytes -> signEmbedFile(src, dest)
   *                      -> read dest into Buffer -> return { signed }
   *   - filePath input: skip src temp (caller's path is the src) -> signEmbedFile
   *                      (caller's path, dest temp) -> return { signedToPath: dest }
   */
  private async signViaTempFiles(
    versionId: string,
    input: { bytes: Buffer } | { filePath: string },
    filename: string,
    mimeType: string,
    manifestDef: ManifestDefinition,
    signer: LoadedSigner,
  ): Promise<{ signed: Buffer | null; signedToPath: string | null }> {
    const tmpRoot = nodepath.join(this.outputRoot, '.tmp-c2pa', versionId);
    await mkdir(tmpRoot, { mode: 0o700, recursive: true });
    const suffix = nanoid(8);
    // Preserve the original file extension on temp paths so c2pa-rs's asset
    // handler selection (BMFF / RIFF / TIFF) succeeds. nodepath.extname
    // returns '' if no extension; in that case the temp paths inherit no
    // extension, matching the format-router's 'unknown-extension' route
    // which never reaches this helper.
    const ext = nodepath.extname(filename);
    const srcTempPath = nodepath.join(tmpRoot, `src-${suffix}${ext}`);
    const destTempPath = nodepath.join(tmpRoot, `dest-${suffix}${ext}`);
    let usedSrcTemp = false;
    try {
      if ('bytes' in input) {
        await writeFile(srcTempPath, input.bytes, { mode: 0o600 });
        usedSrcTemp = true;
        await signEmbedFile(srcTempPath, destTempPath, mimeType, manifestDef, signer);
        const signedBytes = await readFile(destTempPath);
        return { signed: signedBytes, signedToPath: null };
      }
      // filePath input — skip src temp; sign caller's file directly.
      await signEmbedFile(input.filePath, destTempPath, mimeType, manifestDef, signer);
      return { signed: null, signedToPath: destTempPath };
    } finally {
      // Concern #5 — unconditional src cleanup. force:true makes the unlink
      // a no-op when the file does not exist (e.g., write threw before we
      // got here, or filePath input branch never wrote a src temp).
      if (usedSrcTemp) {
        await rm(srcTempPath, { force: true });
      }
      // For the bytes-input branch, dest was already read into Buffer —
      // unlink it so the temp dir stays clean.
      if ('bytes' in input) {
        await rm(destTempPath, { force: true });
      }
      // For the filePath branch, dest is handed back to the caller; do NOT
      // unlink here. The caller (output-downloader.signFileInPlace) renames
      // it into place + unlinks any leftover.
    }
  }

  /**
   * Concern #6 — pre-stat / size-cap helper. For bytes input this is a
   * trivial pass-through. For filePath input we read the bytes (the
   * embed-buffer path requires bytes; the embed-file path streams via
   * signEmbedFile + does NOT call this helper).
   */
  private async resolveBufferInput(
    input: { bytes: Buffer } | { filePath: string },
  ): Promise<Buffer> {
    if ('bytes' in input) return input.bytes;
    return await readFile(input.filePath);
  }

  /**
   * Phase 15 (D-CTX-3 / D-CTX-4 / D-CTX-6) — derive ingredients + asset
   * refs for a version, then call buildManifestWithIngredients.
   *
   * Returns null when there is no completed event yet (no prompt blob to
   * walk) — the caller falls back to the Phase 14 single-c2pa.created shape.
   *
   * Asset-ref resolution policy:
   *   - parentOf:    look up parent's outputs_json, take parsed[0]?.filename
   *                  (B3 — StoredOutput shape verified), check
   *                  outputRoot/<parentId>/<parentFilename> existence + mime
   *                  via routeFormat. If reachable, assetRef={kind:'file',
   *                  path, mimeType}. If parent's manifest_signed has
   *                  signed=false OR no manifest_signed event exists,
   *                  assetRef={kind:'unavailable', reason:'parent_manifest_pending'}.
   *                  If file missing, assetRef={kind:'unavailable',
   *                  reason:'file_not_found'}.
   *   - componentOf: walk extractComponentIngredients results; for each,
   *                  check outputRoot/<versionId>/<input_filename> via
   *                  stat(). Map present → assetRef={kind:'file', path,
   *                  mimeType derived via filename ext}; map missing →
   *                  assetRef={kind:'unavailable', reason}.
   *
   * Hot-path safety: bounded by the prompt blob's IMAGE_INPUT_CLASS_TYPES
   * count (typically <= 5). Each component lookup is one stat() call.
   */
  private async buildManifestForVersion(
    versionId: string,
    _filename: string,
    mimeType: string,
    primaryModel: PrimaryModel | null,
  ): Promise<BuildManifestResult | null> {
    const version = this.versionRepo.getVersion(versionId);
    if (!version) return null;
    const completed = this.provenanceRepo.getLatestCompletedEvent(versionId);
    if (!completed?.prompt_json) return null;

    let promptBlob: Record<string, unknown>;
    try {
      const parsed = JSON.parse(completed.prompt_json) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      promptBlob = parsed as Record<string, unknown>;
    } catch {
      return null;
    }

    // parentOf — extractor delegates parent-hash lookup to a callback.
    const parentOf = extractParentIngredient(version, (parentId) => {
      const parentFilename = this.getStoredFilenameForVersion(parentId);
      if (parentFilename === null) return null;
      const event = this.provenanceRepo.getLatestManifestSignedEvent(parentId, parentFilename);
      if (!event || event.signed !== true || !event.manifest_sha256) return null;
      return event.manifest_sha256;
    });

    const componentOf = extractComponentIngredients(promptBlob);
    const inputTo = extractInputAssertion(promptBlob, completed.seed ?? null);

    // Build asset-ref map.
    const ingredientAssetRefs = new Map<string, IngredientAssetRef>();

    // Parent asset ref.
    if (parentOf !== null) {
      if (parentOf.parent_unavailable !== null) {
        ingredientAssetRefs.set('parent', {
          kind: 'unavailable',
          reason: parentOf.parent_unavailable,
        });
      } else {
        // Parent manifest_signed signaled a successful sign; locate the file.
        const parentFilename = this.getStoredFilenameForVersion(parentOf.parent_version_id);
        if (parentFilename === null) {
          ingredientAssetRefs.set('parent', { kind: 'unavailable', reason: 'file_not_found' });
        } else {
          // Phase 15 WR-02 — when routeFormat cannot classify the parent's
          // extension, do NOT fall back to 'application/octet-stream'.
          // c2pa-rs dispatches asset handlers by MIME type and rejects
          // octet-stream inside addIngredientsToBuilder, which would propagate
          // as C2PA_SIGNING_FAILED / status_reason='sign_call_failed'. Routing
          // to unavailable lets the manifest still sign cleanly with a clear
          // audit (vfx_familiar.unavailable_ingredient + reason
          // 'mime_type_unsupported').
          const parentMime = getMimeForExtensionOrNull(parentFilename);
          if (parentMime === null) {
            ingredientAssetRefs.set('parent', {
              kind: 'unavailable',
              reason: 'mime_type_unsupported',
            });
          } else {
            const parentPath = nodepath.join(this.outputRoot, parentOf.parent_version_id, parentFilename);
            try {
              await stat(parentPath);
              ingredientAssetRefs.set('parent', { kind: 'file', path: parentPath, mimeType: parentMime });
            } catch (err) {
              const code = (err as NodeJS.ErrnoException).code;
              ingredientAssetRefs.set('parent', {
                kind: 'unavailable',
                reason: code === 'ENOENT' ? 'file_not_found' : 'file_unreadable',
              });
            }
          }
        }
      }
    }

    // Component asset refs — file-based for c2pa-node createIngredient.
    // (We rely on c2pa-rs's broader format support for ingredient assets;
    // the buffer-API constraint applies only to the SIGNING asset.)
    for (const c of componentOf) {
      // Defensive — same path-traversal guard as hashComponentBytes.
      const fname = c.input_filename;
      if (
        fname.length === 0 ||
        fname.includes('..') ||
        fname.includes('/') ||
        fname.includes('\\') ||
        fname.includes('\0')
      ) {
        ingredientAssetRefs.set(c.node_id, { kind: 'unavailable', reason: 'file_not_found' });
        continue;
      }
      const safe = nodepath.basename(fname);
      // Phase 15 WR-02 — same defence-in-depth as parent path: do NOT fall
      // through to 'application/octet-stream' for unclassifiable extensions
      // (c2pa-rs would reject inside addIngredientsToBuilder).
      const compMime = getMimeForExtensionOrNull(safe);
      if (compMime === null) {
        ingredientAssetRefs.set(c.node_id, {
          kind: 'unavailable',
          reason: 'mime_type_unsupported',
        });
        continue;
      }
      const fullPath = nodepath.join(this.outputRoot, versionId, safe);
      try {
        await stat(fullPath);
        ingredientAssetRefs.set(c.node_id, { kind: 'file', path: fullPath, mimeType: compMime });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        ingredientAssetRefs.set(c.node_id, {
          kind: 'unavailable',
          reason: code === 'ENOENT' ? 'file_not_found' : 'file_unreadable',
        });
      }
    }

    return buildManifestWithIngredients({
      versionId,
      mimeType,
      primaryModel,
      comfyuiVersion: null,
      appVersion: APP_VERSION,
      ingredients: { parentOf, componentOf, inputTo },
      ingredientAssetRefs,
    });
  }

  /**
   * Phase 15 / B3 — extract a parent's first stored filename from its
   * outputs_json. StoredOutput shape (src/comfyui/types.ts):
   * { filename, path, url, content_type, size_bytes }. parsed[0]?.filename
   * is the canonical primary output filename. Mirrors the lineage-tree
   * filename helper at ~line 692 of this file (firstStoredFilename, now
   * promoted to a separately-named accessor for the Phase 15 ingredient
   * resolution path so the Plan 15-03 grep gate locks it explicitly).
   *
   * Marked private but reachable via the typed-cast escape hatch the
   * Phase 14 c2paConfig wiring tests already use (see
   * pipeline-c2pa-config.test.ts Test 3) so the B3 unit-test in
   * pipeline-c2pa-ingredients.test.ts can prove the round-trip.
   */
  private getStoredFilenameForVersion(versionId: string): string | null {
    const v = this.versionRepo.getVersion(versionId);
    if (!v?.outputs_json) return null;
    try {
      const parsed = JSON.parse(v.outputs_json) as Array<{ filename?: string }>;
      if (!Array.isArray(parsed)) return null;
      return parsed[0]?.filename ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Phase 15 — mirror of signViaTempFiles for the ingredients-aware embed-file
   * branch. Same try/finally cleanup. Same temp dir + 0700/0600 modes +
   * nanoid-suffixed partial paths. Differs only in calling
   * signEmbedFileWithIngredients (which threads BuildManifestResult through
   * the createIngredient + addIngredient API) instead of signEmbedFile.
   */
  private async signViaTempFilesWithIngredients(
    versionId: string,
    input: { bytes: Buffer } | { filePath: string },
    filename: string,
    mimeType: string,
    result: BuildManifestResult,
    signer: LoadedSigner,
  ): Promise<{ signed: Buffer | null; signedToPath: string | null }> {
    const tmpRoot = nodepath.join(this.outputRoot, '.tmp-c2pa', versionId);
    await mkdir(tmpRoot, { mode: 0o700, recursive: true });
    const suffix = nanoid(8);
    const ext = nodepath.extname(filename);
    const srcTempPath = nodepath.join(tmpRoot, `src-${suffix}${ext}`);
    const destTempPath = nodepath.join(tmpRoot, `dest-${suffix}${ext}`);
    let usedSrcTemp = false;
    try {
      if ('bytes' in input) {
        await writeFile(srcTempPath, input.bytes, { mode: 0o600 });
        usedSrcTemp = true;
        await signEmbedFileWithIngredients(srcTempPath, destTempPath, mimeType, result, signer);
        const signedBytes = await readFile(destTempPath);
        return { signed: signedBytes, signedToPath: null };
      }
      // filePath input — skip src temp; sign caller's file directly.
      await signEmbedFileWithIngredients(input.filePath, destTempPath, mimeType, result, signer);
      return { signed: null, signedToPath: destTempPath };
    } finally {
      if (usedSrcTemp) {
        await rm(srcTempPath, { force: true });
      }
      if ('bytes' in input) {
        await rm(destTempPath, { force: true });
      }
    }
  }

  // ================================================================
  // PHASE 4 — ASSETS (delegates to composed AssetsEngine)
  // ================================================================

  /** D-ASST-03 + D-ASST-11: idempotent tag add + regex/cap validation. */
  addTag(versionId: string, tag: string) {
    const result = this.assets.addTag(versionId, tag);
    this.events.emitEvent('tag.changed', {
      action: 'add',
      version_id: versionId,
      shot_id: result.entity.shot_id,
      tag,
      at: this.nowIso(),
    });
    return result;
  }

  /** D-ASST-03: idempotent tag remove. */
  removeTag(versionId: string, tag: string) {
    const result = this.assets.removeTag(versionId, tag);
    this.events.emitEvent('tag.changed', {
      action: 'remove',
      version_id: versionId,
      shot_id: result.entity.shot_id,
      tag,
      at: this.nowIso(),
    });
    return result;
  }

  /**
   * D-ASST-03 + D-ASST-08 + D-ASST-11: upsert metadata + regex/cap validation.
   *
   * T-5-02: emitted payload must NOT contain `value` — MetadataChangedPayload
   * type deliberately omits it (see events.ts). Only the key is safe to
   * broadcast over SSE.
   */
  setMetadata(versionId: string, key: string, value: string) {
    const result = this.assets.setMetadata(versionId, key, value);
    this.events.emitEvent('metadata.changed', {
      action: 'set',
      version_id: versionId,
      shot_id: result.entity.shot_id,
      key,
      at: this.nowIso(),
    });
    return result;
  }

  /** D-ASST-03: idempotent metadata remove. */
  removeMetadata(versionId: string, key: string) {
    const result = this.assets.removeMetadata(versionId, key);
    this.events.emitEvent('metadata.changed', {
      action: 'remove',
      version_id: versionId,
      shot_id: result.entity.shot_id,
      key,
      at: this.nowIso(),
    });
    return result;
  }

  /** D-ASST-12..18 + D-ASST-22: AND-only filter + pagination + always-hydrated items. */
  queryAssets(filter: AssetsQueryFilter) {
    return this.assets.queryAssets(filter);
  }

  /** D-ASST-06: scope-aware tag aggregation. */
  listTags(scope: ScopeFilter & { limit: number | undefined; offset: number | undefined }) {
    return this.assets.listTags(scope);
  }

  /** D-ASST-06: scope-aware metadata-key aggregation. */
  listMetadataKeys(
    scope: ScopeFilter & { limit: number | undefined; offset: number | undefined },
  ) {
    return this.assets.listMetadataKeys(scope);
  }

  // ================================================================
  // PHASE 5 — DASHBOARD AGGREGATE (D-WEBUI-01)
  // ================================================================

  /**
   * D-WEBUI-01: dashboard landing-page aggregate. Returns the three rails the
   * Preact home view renders: non-terminal versions (submitted/running),
   * recently-completed versions, and top-level workspaces.
   *
   * Keeps the landing page a single REST round-trip instead of N small calls.
   * Plan 05-06 (server.ts mount) exposes this at GET /api/dashboard/home.
   */
  getDashboardHome(): {
    active_versions: Version[];
    recent_versions: Version[];
    workspaces: Workspace[];
  } {
    // Active = non-terminal rows (submitted | running). listPendingVersions
    // already exists (recovery poller uses it on boot) and returns exactly the
    // same subset; we reuse it to avoid adding a second DB method.
    const active = this.versionRepo.listPendingVersions();
    // SC-1 (Phase 6 gap_closure WR-04): real DB-backed recent-completed list,
    // limit=10 for the home rail. Repo helper handles the SQL; engine stays
    // composition-only (no raw Drizzle here).
    const recent = this.versionRepo.listRecentCompleted(10);
    const { items: workspaces } = this.repo.listWorkspaces(50, 0);
    return {
      active_versions: active,
      recent_versions: recent,
      workspaces,
    };
  }

  // ================================================================
  // PHASE 17 / Plan 17-03 — THUMBNAIL DERIVATION FACADE (VIS-01..03/06)
  // ================================================================

  /**
   * Phase 17 / Plan 17-03 — D-21 COALESCING facade for thumbnail derivation.
   *
   * Returns the cached `.thumb.webp` filePath + Content-Type + ETag for
   * `(versionId, filename)`, or `null` when the source format is unsupported
   * OR sharp/ffmpeg derivation failed (engine writes a `.thumb.failed`
   * sentinel; the HTTP route surfaces as 503 + THUMBNAIL_FAILED envelope; the
   * dashboard fallback path renders a skeleton).
   *
   * Concurrent calls for the SAME `(versionId, filename)` share one in-flight
   * Promise via `thumbnailMutex` (signMutex shape). Calls for DIFFERENT keys
   * run in parallel. The mutex entry is deleted on settle (try/finally).
   *
   * Called from src/http/dashboard-routes.ts GET/HEAD `/api/versions/:id/thumbnail`
   * (Plan 17-03 Task 3). NEVER throws on derivation failure — the failure path
   * returns null + writes the sentinel.
   */
  async generateThumbnail(
    versionId: string,
    filename: string,
  ): Promise<{ filePath: string; contentType: string; etag: string } | null> {
    const key = `${versionId}::${filename}`;
    const inflight = this.thumbnailMutex.get(key);
    if (inflight) return inflight;
    const promise = (async () => {
      try {
        return await this.deriveThumbnail(versionId, filename);
      } finally {
        this.thumbnailMutex.delete(key);
      }
    })();
    this.thumbnailMutex.set(key, promise);
    return promise;
  }

  /**
   * Phase 17 / Plan 17-03 — D-05 idempotent thumbnail-cache invalidation.
   *
   * Removes both `<filename>.thumb.webp` and `<filename>.thumb.failed` for
   * `(versionId, filename)` if either exists. Both unlinks are best-effort
   * (ENOENT swallowed) so the call is safe to invoke after every redact +
   * regenerate cycle.
   *
   * Called from src/engine/c2pa/redaction.ts AFTER `atomicRename(tempPathFresh,
   * fullPath)` inside the try block (D-05 ordering — see Plan 17-03 Task 2).
   * Calling BEFORE the rename creates a window where the old thumb is deleted
   * but the rewrite failed — UI shows skeleton until next request retries.
   * Calling AFTER ensures invalidation only happens for actually-rewritten
   * bytes.
   *
   * Pure FS unlink — does NOT acquire `thumbnailMutex` because:
   *  (a) the redact caller already holds `assetWriterMutex` on this key, AND
   *  (b) invalidate is idempotent — concurrent invalidate calls compose
   *      correctly without coordination.
   */
  async invalidateThumbnail(versionId: string, filename: string): Promise<void> {
    await Thumbnails.invalidateCache(this.outputRoot, versionId, filename);
  }

  /**
   * Phase 17 / Plan 17-03 — private dispatcher. Reads source mtime + sha256
   * (when available from outputs_json[0].sha256), checks cache freshness via
   * isCacheFresh, dispatches to format-router, and writes a sentinel on
   * failure paths. Public surface is generateThumbnail (above) which wraps
   * this in the coalescing mutex.
   *
   * Failure semantics — engine on sharp/ffmpeg failure writes a `.thumb.failed`
   * sentinel and returns null. NO exception bubbles to the HTTP route on the
   * failure path. The route surfaces null as 503 + THUMBNAIL_FAILED envelope.
   */
  private async deriveThumbnail(
    versionId: string,
    filename: string,
  ): Promise<{ filePath: string; contentType: string; etag: string } | null> {
    const sourcePath = nodepath.resolve(this.outputRoot, versionId, filename);
    const cachePath = Thumbnails.cachePathFor(this.outputRoot, versionId, filename);
    const sentinelPath = Thumbnails.sentinelPathFor(this.outputRoot, versionId, filename);

    // Read sha256 from outputs_json[0].sha256 if present — provides a strong
    // ETag validator. Parse defensively; never let a JSON-parse error escape.
    let sha256: string | null = null;
    try {
      const version = this.versionRepo.getVersion(versionId);
      if (version?.outputs_json) {
        const parsed = JSON.parse(version.outputs_json) as Array<{
          filename?: string;
          sha256?: string;
        }>;
        if (Array.isArray(parsed) && parsed[0]?.sha256) {
          sha256 = parsed[0].sha256 as string;
        }
      }
    } catch {
      // outputs_json parse failure or version not found — fall back to
      // mtime-based ETag derivation.
      sha256 = null;
    }

    // Cache freshness check — D-07 (cache | sentinel | miss).
    let fresh: Thumbnails.CacheFreshness;
    try {
      fresh = await Thumbnails.isCacheFresh(cachePath, sentinelPath, sourcePath);
    } catch {
      // Source file is unreadable — treat as a derivation failure: write
      // sentinel and return null. The HTTP route surfaces 503.
      try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(nodepath.dirname(sentinelPath), { recursive: true });
        await Thumbnails.writeFailedSentinel(sentinelPath);
      } catch {
        // best-effort
      }
      return null;
    }

    if (fresh.via === 'cache') {
      const etag = await Thumbnails.computeETag(sourcePath, sha256);
      return { filePath: cachePath, contentType: 'image/webp', etag };
    }
    if (fresh.via === 'sentinel') {
      // Last derivation failed AFTER source last changed; do NOT retry.
      return null;
    }

    // Cache miss — format-route + dispatch.
    const route = Thumbnails.routeFormat(filename);
    if (route.mode === 'unsupported') {
      // Ensure parent dir exists for the sentinel write.
      try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(nodepath.dirname(sentinelPath), { recursive: true });
        await Thumbnails.writeFailedSentinel(sentinelPath);
      } catch {
        // best-effort
      }
      return null;
    }

    try {
      if (route.mode === 'image') {
        await Thumbnails.generateImageThumbnail(sourcePath, cachePath);
      } else {
        // route.mode === 'video'
        await Thumbnails.generateVideoThumbnail(sourcePath, cachePath);
      }
    } catch (err) {
      console.warn(
        `vfx-familiar: thumbnail derivation failed for ${versionId}/${filename}: ${
          (err as Error).message
        }`,
      );
      try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(nodepath.dirname(sentinelPath), { recursive: true });
        await Thumbnails.writeFailedSentinel(sentinelPath);
      } catch {
        // best-effort
      }
      return null;
    }

    const etag = await Thumbnails.computeETag(sourcePath, sha256);
    return { filePath: cachePath, contentType: 'image/webp', etag };
  }
}
