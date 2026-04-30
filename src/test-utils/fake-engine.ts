import { EngineEmitter } from '../engine/events.js';
import type {
  Workspace, Project, Sequence, Shot, Version, Breadcrumb, BreadcrumbEntry,
} from '../types/hierarchy.js';
import type { VersionWithAssets, MetadataKV } from '../types/assets.js';
import type { ProvenanceEvent, DiffResponse } from '../types/provenance.js';

/**
 * Phase 5: shared empty Breadcrumb fixture — used by every fake getter so the
 * SSE/route tests that assert on the bare-domain shape (D-WEBUI-05) get a
 * predictable, easy-to-match value.
 */
const EMPTY_BREADCRUMB: Breadcrumb = { entries: [], text: '' };

type ListResult<T> = { items: (T & Breadcrumb)[]; total_count: number; limit: number; offset: number };

/**
 * Fake Engine for Phase 5 SSE / dashboard-route tests (D-WEBUI-37).
 *
 * Surface mirrors the real Engine facade methods that the dashboard REST routes
 * call. Each method returns canned fixtures by default but can be overridden via
 * the `cans` map for per-test scenarios. The `events` field is the typed
 * `EngineEmitter` (Plan 02, D-WEBUI-29) — SSE tests (Plan 03) get typed
 * `.onEvent('version.created', cb)` calls with no runtime change from Plan 01
 * (EngineEmitter extends EventEmitter → structural narrow).
 *
 * Test pattern:
 *   const engine = new FakeEngine();
 *   engine.cans.versions.set('ver_1', { entity: { ...fixture }, breadcrumb: EMPTY_BREADCRUMB });
 *   await myRoute(engine).handle(...);
 *   engine.events.emitEvent('version.created', { ... });   // simulate SSE event
 *   expect(engine.calls).toContainEqual({ method: 'getVersion', args: ['ver_1'] });
 */
export class FakeEngine {
  public readonly events: EngineEmitter = new EngineEmitter();
  public readonly calls: Array<{ method: string; args: unknown[] }> = [];
  /** SC-2 (Phase 6): mirror Engine.outputRoot so EngineForDashboard structural
   * Pick accepts FakeEngine without a cast. Default 'outputs' matches the
   * Engine constructor default; tests that need a tmp dir can re-assign by
   * widening the type at the test seam (see dashboard-routes.test.ts SC-2 block). */
  public outputRoot: string = 'outputs';

  /** Per-test override map. Tests populate the relevant entries before invoking routes. */
  public readonly cans = {
    workspaces: new Map<string, { entity: Workspace; breadcrumb: Breadcrumb }>(),
    workspaceList: { items: [] as (Workspace & Breadcrumb)[], total_count: 0, limit: 20, offset: 0 } as ListResult<Workspace>,
    projects: new Map<string, { entity: Project; breadcrumb: Breadcrumb }>(),
    projectList: { items: [] as (Project & Breadcrumb)[], total_count: 0, limit: 20, offset: 0 } as ListResult<Project>,
    sequences: new Map<string, { entity: Sequence; breadcrumb: Breadcrumb }>(),
    sequenceList: { items: [] as (Sequence & Breadcrumb)[], total_count: 0, limit: 20, offset: 0 } as ListResult<Sequence>,
    shots: new Map<string, { entity: Shot; breadcrumb: Breadcrumb }>(),
    shotList: { items: [] as (Shot & Breadcrumb)[], total_count: 0, limit: 20, offset: 0 } as ListResult<Shot>,
    versions: new Map<string, { entity: VersionWithAssets; breadcrumb: Breadcrumb }>(),
    versionList: { items: [] as (Version & Breadcrumb)[], total_count: 0, limit: 20, offset: 0 } as ListResult<Version>,
    provenance: new Map<string, { events: ProvenanceEvent[]; breadcrumb: Breadcrumb }>(),
    diffs: new Map<string, DiffResponse & { breadcrumb: BreadcrumbEntry[]; breadcrumb_text: string }>(),
    assetQuery: { items: [], total_count: 0, limit: 20, offset: 0 } as { items: unknown[]; total_count: number; limit: number; offset: number },
    tagList: { items: [], total_count: 0, limit: 20, offset: 0 } as { items: { name: string; count: number }[]; total_count: number; limit: number; offset: number },
    metadataKeys: { items: [], total_count: 0, limit: 20, offset: 0 } as { items: { name: string; count: number }[]; total_count: number; limit: number; offset: number },
    reproduceResult: null as { entity: Version; breadcrumb: Breadcrumb; reproduction_warnings: string[] } | null,
    dashboardHome: {
      active_versions: [] as Version[],
      recent_versions: [] as Version[],
      workspaces: [] as Workspace[],
    },
  };

  // ============== Hierarchy reads ==============
  getWorkspace(id: string): { entity: Workspace; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getWorkspace', args: [id] });
    return (
      this.cans.workspaces.get(id) ?? {
        entity: { id, name: 'fake-ws', naming_template: null, created_at: 0 } satisfies Workspace,
        breadcrumb: EMPTY_BREADCRUMB,
      }
    );
  }

  listWorkspaces(limit: number, offset: number): ListResult<Workspace> {
    this.calls.push({ method: 'listWorkspaces', args: [limit, offset] });
    return this.cans.workspaceList;
  }

  getProject(id: string): { entity: Project; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getProject', args: [id] });
    return (
      this.cans.projects.get(id) ?? {
        entity: {
          id,
          workspace_id: 'ws_1',
          name: 'fake-proj',
          naming_template: null,
          created_at: 0,
        } satisfies Project,
        breadcrumb: EMPTY_BREADCRUMB,
      }
    );
  }

  listProjects(
    workspaceId: string | undefined,
    limit: number,
    offset: number,
  ): ListResult<Project> {
    this.calls.push({ method: 'listProjects', args: [workspaceId, limit, offset] });
    return this.cans.projectList;
  }

  getSequence(id: string): { entity: Sequence; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getSequence', args: [id] });
    return (
      this.cans.sequences.get(id) ?? {
        entity: { id, project_id: 'proj_1', name: 'fake-seq', created_at: 0 } satisfies Sequence,
        breadcrumb: EMPTY_BREADCRUMB,
      }
    );
  }

  listSequences(
    projectId: string | undefined,
    limit: number,
    offset: number,
  ): ListResult<Sequence> {
    this.calls.push({ method: 'listSequences', args: [projectId, limit, offset] });
    return this.cans.sequenceList;
  }

  getShot(id: string): { entity: Shot; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getShot', args: [id] });
    return (
      this.cans.shots.get(id) ?? {
        entity: { id, sequence_id: 'seq_1', name: 'sh010', created_at: 0 } satisfies Shot,
        breadcrumb: EMPTY_BREADCRUMB,
      }
    );
  }

  listShots(
    sequenceId: string | undefined,
    limit: number,
    offset: number,
  ): ListResult<Shot> {
    this.calls.push({ method: 'listShots', args: [sequenceId, limit, offset] });
    return this.cans.shotList;
  }

  // ============== Version reads ==============
  getVersion(id: string): { entity: VersionWithAssets; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getVersion', args: [id] });
    return (
      this.cans.versions.get(id) ?? {
        entity: {
          id,
          shot_id: 'shot_1',
          version_number: 1,
          status: 'submitted',
          job_id: null,
          parent_version_id: null,
          notes: null,
          created_at: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: null,
          lineage_type: null,
          reproduction_warnings_json: null,
          tags: [],
          metadata: [] as MetadataKV[],
        } satisfies VersionWithAssets,
        breadcrumb: EMPTY_BREADCRUMB,
      }
    );
  }

  listVersionsForShot(
    shotId: string,
    limit: number,
    offset: number,
    options: { include_tags?: boolean; include_metadata?: boolean } = {},
  ): ListResult<Version> {
    this.calls.push({ method: 'listVersionsForShot', args: [shotId, limit, offset, options] });
    return this.cans.versionList;
  }

  getProvenance(versionId: string): { events: ProvenanceEvent[]; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getProvenance', args: [versionId] });
    return (
      this.cans.provenance.get(versionId) ?? {
        events: [],
        breadcrumb: EMPTY_BREADCRUMB,
      }
    );
  }

  diffVersions(
    a: string,
    b: string,
  ): DiffResponse & { breadcrumb: BreadcrumbEntry[]; breadcrumb_text: string } {
    this.calls.push({ method: 'diffVersions', args: [a, b] });
    return (
      this.cans.diffs.get(`${a}::${b}`) ?? {
        summary: 'no changes',
        changes: { params: [], models: [], seed: null, workflow: [], metadata: [] },
        breadcrumb: [] as BreadcrumbEntry[],
        breadcrumb_text: '',
      }
    );
  }

  // ============== Asset reads ==============
  queryAssets(filter: unknown): { items: unknown[]; total_count: number; limit: number; offset: number } {
    this.calls.push({ method: 'queryAssets', args: [filter] });
    return this.cans.assetQuery;
  }

  listTags(args: unknown): { items: { name: string; count: number }[]; total_count: number; limit: number; offset: number } {
    this.calls.push({ method: 'listTags', args: [args] });
    return this.cans.tagList;
  }

  listMetadataKeys(
    args: unknown,
  ): { items: { name: string; count: number }[]; total_count: number; limit: number; offset: number } {
    this.calls.push({ method: 'listMetadataKeys', args: [args] });
    return this.cans.metadataKeys;
  }

  // ============== Mutations exposed by REST ==============
  async reproduceVersion(
    sourceVersionId: string,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb; reproduction_warnings: string[] }> {
    this.calls.push({ method: 'reproduceVersion', args: [sourceVersionId, notes] });
    if (this.cans.reproduceResult) return this.cans.reproduceResult;
    return {
      entity: {
        id: 'ver_repro',
        shot_id: 'shot_1',
        version_number: 2,
        status: 'submitted',
        job_id: 'job_repro',
        parent_version_id: sourceVersionId,
        notes: notes ?? null,
        created_at: 0,
        completed_at: null,
        error_code: null,
        error_message: null,
        outputs_json: null,
        lineage_type: 'reproduce',
        reproduction_warnings_json: null,
      } satisfies Version,
      breadcrumb: EMPTY_BREADCRUMB,
      reproduction_warnings: [],
    };
  }

  // ============== Dashboard aggregate (D-WEBUI-01) ==============
  getDashboardHome(): {
    active_versions: Version[];
    recent_versions: Version[];
    workspaces: Workspace[];
  } {
    this.calls.push({ method: 'getDashboardHome', args: [] });
    return this.cans.dashboardHome;
  }

  reset(): void {
    this.calls.length = 0;
    this.events.removeAllListeners();
    this.cans.workspaces.clear();
    this.cans.projects.clear();
    this.cans.sequences.clear();
    this.cans.shots.clear();
    this.cans.versions.clear();
    this.cans.provenance.clear();
    this.cans.diffs.clear();
    this.cans.workspaceList = { items: [], total_count: 0, limit: 20, offset: 0 };
    this.cans.projectList = { items: [], total_count: 0, limit: 20, offset: 0 };
    this.cans.sequenceList = { items: [], total_count: 0, limit: 20, offset: 0 };
    this.cans.shotList = { items: [], total_count: 0, limit: 20, offset: 0 };
    this.cans.versionList = { items: [], total_count: 0, limit: 20, offset: 0 };
    this.cans.assetQuery = { items: [], total_count: 0, limit: 20, offset: 0 };
    this.cans.tagList = { items: [], total_count: 0, limit: 20, offset: 0 };
    this.cans.metadataKeys = { items: [], total_count: 0, limit: 20, offset: 0 };
    this.cans.reproduceResult = null;
    this.cans.dashboardHome = { active_versions: [], recent_versions: [], workspaces: [] };
  }
}

export function buildFakeEngine(): FakeEngine {
  return new FakeEngine();
}
