import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteClient } from 'better-sqlite3';
import type * as schema from '../store/schema.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
import { TagRepo } from '../store/tag-repo.js';
import { MetadataRepo } from '../store/metadata-repo.js';
import type { ComfyUIClient } from '../comfyui/client.js';
import { BreadcrumbResolver } from './breadcrumb.js';
import { GenerationEngine } from './generation.js';
import { ProvenanceWriter } from './provenance.js';
import { AssetsEngine } from './assets.js';
import { diffVersions as pureDiffVersions, buildReproductionDivergence } from './diff.js';
import { computeOutputSha256 } from './output-hash.js';
import { TypedError } from './errors.js';
import { createEngineEmitter, type EngineEmitter } from './events.js';
import { downloadOutput } from './output-downloader.js';
import {
  SHOT_NAME_REGEX,
  type Workspace,
  type Project,
  type Sequence,
  type Shot,
  type Version,
  type Breadcrumb,
  type BreadcrumbEntry,
} from '../types/hierarchy.js';
import type {
  ProvenanceEvent,
  DiffSnapshot,
  DiffResponse,
  ReproductionDivergence,
  ModelRef,
  IterateOverride,
} from '../types/provenance.js';
import type {
  AssetsQueryFilter,
  VersionWithAssets,
  ScopeFilter,
  MetadataKV,
} from '../types/assets.js';

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

  constructor(
    db: BaseDb,
    private repo: HierarchyRepo,
    private versionRepo: VersionRepo,
    private provenanceRepo: ProvenanceRepo,
    private client: ComfyUIClient | null = null,
    outputRoot: string = 'outputs',
    options: { maxConcurrentPollers?: number } = {},
  ) {
    // Widen once at the boundary — drizzle factory returns the intersection
    // at runtime, but the class-level type omits $client. Plan 04-02 pattern.
    this.db = db as Db;
    this.outputRoot = outputRoot;
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
  ): ListResult<Project> {
    const { items, total_count } = this.repo.listProjects(workspaceId, limit, offset);
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
  ): ListResult<Sequence> {
    const { items, total_count } = this.repo.listSequences(projectId, limit, offset);
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
  ): ListResult<Shot> {
    const { items, total_count } = this.repo.listShots(sequenceId, limit, offset);
    return {
      items: items.map((s) => ({ ...s, ...this.breadcrumb.resolve('shot', s.id) })),
      total_count,
      limit,
      offset,
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
          void downloadOutput(this.client, result.entity.id, this.outputRoot, firstFilename).catch(
            () => {},
          );
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
   * D-PROV-09 + D-ASST-20: paginated version list for a shot, version_number DESC.
   * Opt-in hydration via include_tags / include_metadata flags (default omit
   * keeps payload cheap for list-heavy reads). When neither flag is set, items
   * are plain Version (Phase 3 parity). Otherwise each item gains the requested
   * array(s) — tags only, metadata only, or both.
   */
  listVersionsForShot(
    shotId: string,
    limit: number,
    offset: number,
    options: { include_tags?: boolean; include_metadata?: boolean } = {},
  ): ListResult<VersionWithAssets | Version> {
    const { items, total_count } = this.versionRepo.listByShot(shotId, limit, offset);
    const hydrated = items.map((v) => {
      let withAssets: Version | VersionWithAssets = v;
      if (options.include_tags || options.include_metadata) {
        const full = this.assets.hydrateVersionWithAssets(v);
        if (options.include_tags && options.include_metadata) {
          withAssets = full;
        } else if (options.include_tags) {
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
    return { items: hydrated, total_count, limit, offset };
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
    let models: ModelRef[] | null = null;
    if (completed?.models_json) {
      try {
        models = JSON.parse(completed.models_json) as ModelRef[];
      } catch {
        models = null;
      }
    }
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
}
