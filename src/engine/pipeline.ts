import { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
import type { ComfyUIClient } from '../comfyui/client.js';
import { BreadcrumbResolver } from './breadcrumb.js';
import { GenerationEngine } from './generation.js';
import { ProvenanceWriter } from './provenance.js';
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

type WithBreadcrumb<T> = T & Breadcrumb;
type ListResult<T> = {
  items: WithBreadcrumb<T>[];
  total_count: number;
  limit: number;
  offset: number;
};

/**
 * Engine facade — Phase 1 hierarchy ops + Phase 2 generation ops.
 *
 * Phase 2 constructor takes the extra repos (VersionRepo) and an optional
 * ComfyUIClient. Missing client is handled at the call site (submitGeneration
 * throws COMFYUI_CREDENTIALS_MISSING). The BreadcrumbResolver now takes both
 * repos to support the 'version' leaf (D-GEN-05).
 *
 * Invariants:
 *  - Zero MCP SDK imports (D-33).
 *  - Shot regex is enforced here before delegating to the repo (D-07, D-33).
 *  - Missing entities surface as typed {WORKSPACE,PROJECT,SEQUENCE,SHOT,VERSION}_NOT_FOUND.
 *  - Phase 2 generation ops are delegated to a composed GenerationEngine instance.
 */
export class Engine {
  private breadcrumb: BreadcrumbResolver;
  private generation: GenerationEngine;

  constructor(
    private repo: HierarchyRepo,
    private versionRepo: VersionRepo,
    private provenanceRepo: ProvenanceRepo,
    private client: ComfyUIClient | null = null,
    outputRoot: string = 'outputs',
    options: { maxConcurrentPollers?: number } = {},
  ) {
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

  /** D-PROV-08: cheap version metadata (no provenance blobs). */
  getVersion(versionId: string): { entity: Version; breadcrumb: Breadcrumb } {
    const entity = this.versionRepo.getVersion(versionId);
    if (!entity) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    return { entity, breadcrumb: this.breadcrumb.resolve('version', entity.id) };
  }

  /** D-PROV-09: paginated version list for a shot, version_number DESC. */
  listVersionsForShot(
    shotId: string,
    limit: number,
    offset: number,
  ): ListResult<Version> {
    const { items, total_count } = this.versionRepo.listByShot(shotId, limit, offset);
    return {
      items: items.map((v) => ({
        ...v,
        ...this.breadcrumb.resolve('version', v.id),
      })),
      total_count,
      limit,
      offset,
    };
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
}
