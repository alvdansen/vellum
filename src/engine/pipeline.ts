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
import { diffVersions as pureDiffVersions } from './diff.js';
import { TypedError } from './errors.js';
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
  // WORKSPACE
  // ================================================================

  createWorkspace(name: string): { entity: Workspace; breadcrumb: Breadcrumb } {
    const entity = this.repo.createWorkspace(name);
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
    return this.generation.submitGeneration(shotId, workflowJson, notes);
  }

  async getGenerationStatus(
    versionId: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    return this.generation.getGenerationStatus(versionId);
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
   */
  diffVersions(
    versionAId: string,
    versionBId: string,
  ): DiffResponse & { breadcrumb: BreadcrumbEntry[]; breadcrumb_text: string } {
    const snapA = this.loadDiffSnapshot(versionAId);
    const snapB = this.loadDiffSnapshot(versionBId);
    const result = pureDiffVersions({ a: snapA, b: snapB });
    const crumbs = this.breadcrumb.resolve('version', versionAId);
    return {
      summary: result.summary,
      changes: result.changes,
      breadcrumb: crumbs.entries,
      breadcrumb_text: crumbs.text,
    };
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
    return this.generation.reproduceVersion(sourceVersionId, notes);
  }

  /** PROV-06: iterate — delegates to GenerationEngine. */
  async iterateFromVersion(
    sourceVersionId: string,
    overrides?: Record<string, IterateOverride>,
    seed?: number,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    return this.generation.iterateFromVersion(sourceVersionId, overrides, seed, notes);
  }

  // ================================================================
  // PHASE 4 — ASSETS (delegates to composed AssetsEngine)
  // ================================================================

  /** D-ASST-03 + D-ASST-11: idempotent tag add + regex/cap validation. */
  addTag(versionId: string, tag: string) {
    return this.assets.addTag(versionId, tag);
  }

  /** D-ASST-03: idempotent tag remove. */
  removeTag(versionId: string, tag: string) {
    return this.assets.removeTag(versionId, tag);
  }

  /** D-ASST-03 + D-ASST-08 + D-ASST-11: upsert metadata + regex/cap validation. */
  setMetadata(versionId: string, key: string, value: string) {
    return this.assets.setMetadata(versionId, key, value);
  }

  /** D-ASST-03: idempotent metadata remove. */
  removeMetadata(versionId: string, key: string) {
    return this.assets.removeMetadata(versionId, key);
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
}
