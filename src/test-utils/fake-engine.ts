import { TypedError } from '../engine/errors.js';
import type {
  Workspace,
  Project,
  Sequence,
  Shot,
  Version,
  Breadcrumb,
  BreadcrumbEntry,
  EntityType,
} from '../types/hierarchy.js';

export interface FakeCall {
  method: string;
  args: unknown[];
}

const SHOT_REGEX = /^sh\d{3,}$/;

/**
 * Minimal hand-rolled spy engine matching the Engine facade surface.
 * Each method records invocations and returns canned responses. Used by
 * tool-layer tests (Plan 02) that do not want a real SQLite instance.
 */
export class FakeEngine {
  calls: FakeCall[] = [];

  private bc(type: EntityType, id: string, name: string): Breadcrumb {
    return {
      entries: [{ type, id, name }],
      text: name,
    };
  }

  // --- workspace ---
  createWorkspace(name: string): { entity: Workspace; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'createWorkspace', args: [name] });
    const entity: Workspace = { id: 'ws_fake', name, naming_template: null, created_at: 0 };
    return { entity, breadcrumb: this.bc('workspace', entity.id, name) };
  }

  getWorkspace(id: string): { entity: Workspace; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getWorkspace', args: [id] });
    const entity: Workspace = { id, name: 'fake', naming_template: null, created_at: 0 };
    return { entity, breadcrumb: this.bc('workspace', id, 'fake') };
  }

  listWorkspaces(
    limit: number,
    offset: number,
  ): { items: (Workspace & Breadcrumb)[]; total: number; limit: number; offset: number } {
    this.calls.push({ method: 'listWorkspaces', args: [limit, offset] });
    return { items: [], total: 0, limit, offset };
  }

  // --- project ---
  createProject(
    workspaceId: string,
    name: string,
  ): { entity: Project; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'createProject', args: [workspaceId, name] });
    const entity: Project = {
      id: 'proj_fake',
      workspace_id: workspaceId,
      name,
      naming_template: null,
      created_at: 0,
    };
    return { entity, breadcrumb: this.bc('project', entity.id, name) };
  }

  getProject(id: string): { entity: Project; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getProject', args: [id] });
    const entity: Project = {
      id,
      workspace_id: 'ws_fake',
      name: 'fake',
      naming_template: null,
      created_at: 0,
    };
    return { entity, breadcrumb: this.bc('project', id, 'fake') };
  }

  listProjects(
    workspaceId: string | undefined,
    limit: number,
    offset: number,
  ): { items: (Project & Breadcrumb)[]; total: number; limit: number; offset: number } {
    this.calls.push({ method: 'listProjects', args: [workspaceId, limit, offset] });
    return { items: [], total: 0, limit, offset };
  }

  // --- sequence ---
  createSequence(
    projectId: string,
    name: string,
  ): { entity: Sequence; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'createSequence', args: [projectId, name] });
    const entity: Sequence = { id: 'seq_fake', project_id: projectId, name, created_at: 0 };
    return { entity, breadcrumb: this.bc('sequence', entity.id, name) };
  }

  getSequence(id: string): { entity: Sequence; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getSequence', args: [id] });
    const entity: Sequence = { id, project_id: 'proj_fake', name: 'fake', created_at: 0 };
    return { entity, breadcrumb: this.bc('sequence', id, 'fake') };
  }

  listSequences(
    projectId: string | undefined,
    limit: number,
    offset: number,
  ): { items: (Sequence & Breadcrumb)[]; total: number; limit: number; offset: number } {
    this.calls.push({ method: 'listSequences', args: [projectId, limit, offset] });
    return { items: [], total: 0, limit, offset };
  }

  // --- shot ---
  createShot(sequenceId: string, name: string): { entity: Shot; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'createShot', args: [sequenceId, name] });
    if (!SHOT_REGEX.test(name)) {
      throw new TypedError(
        'INVALID_SHOT_FORMAT',
        `Shot name '${name}' does not match expected format`,
        `Shot names must match ^sh\\d{3,}$ — e.g. 'sh010', 'sh020'`,
      );
    }
    const entity: Shot = { id: 'shot_fake', sequence_id: sequenceId, name, created_at: 0 };
    return { entity, breadcrumb: this.bc('shot', entity.id, name) };
  }

  getShot(id: string): { entity: Shot; breadcrumb: Breadcrumb } {
    this.calls.push({ method: 'getShot', args: [id] });
    const entity: Shot = { id, sequence_id: 'seq_fake', name: 'sh010', created_at: 0 };
    return { entity, breadcrumb: this.bc('shot', id, 'sh010') };
  }

  listShots(
    sequenceId: string | undefined,
    limit: number,
    offset: number,
  ): { items: (Shot & Breadcrumb)[]; total: number; limit: number; offset: number } {
    this.calls.push({ method: 'listShots', args: [sequenceId, limit, offset] });
    return { items: [], total: 0, limit, offset };
  }

  // ================================================================
  // PHASE 2 — GENERATION (Plans 02-02 and 02-03 consume these)
  // ================================================================

  /** Scenario knob for tool-layer tests: alter submit/status canned behavior. */
  cannedVersionScenario: 'happy' | 'not-found' | 'credentials-missing' | 'ui-format' = 'happy';

  submitGeneration(
    shotId: string,
    workflowJson: Record<string, unknown>,
    notes?: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    this.calls.push({ method: 'submitGeneration', args: [shotId, workflowJson, notes] });
    if (this.cannedVersionScenario === 'credentials-missing') {
      return Promise.reject(
        new TypedError(
          'COMFYUI_CREDENTIALS_MISSING',
          'COMFYUI_API_KEY is not set',
          'Set COMFYUI_API_KEY in .env at the repo root. See .env.example.',
        ),
      );
    }
    if (this.cannedVersionScenario === 'ui-format') {
      return Promise.reject(
        new TypedError(
          'INVALID_WORKFLOW_FORMAT',
          'Workflow is in ComfyUI UI format (contains nodes/links/groups)',
          "Export the workflow with 'Dev Mode > Save (API Format)' enabled in ComfyUI.",
        ),
      );
    }
    const entity: Version = {
      id: 'ver_fake',
      shot_id: shotId,
      version_number: 1,
      status: 'submitted',
      job_id: 'prompt_fake_123',
      parent_version_id: null,
      notes: notes ?? null,
      created_at: 0,
      completed_at: null,
      error_code: null,
      error_message: null,
      outputs_json: null,
    };
    // 5-entry breadcrumb ending at 'version' leaf labelled 'v001'
    const entries: BreadcrumbEntry[] = [
      { type: 'workspace', id: 'ws_fake', name: 'ws' },
      { type: 'project', id: 'proj_fake', name: 'proj' },
      { type: 'sequence', id: 'seq_fake', name: 'sq010' },
      { type: 'shot', id: shotId, name: 'sh010' },
      { type: 'version', id: entity.id, name: 'v001' },
    ];
    return Promise.resolve({
      entity,
      breadcrumb: { entries, text: entries.map((e) => e.name).join(' > ') },
    });
  }

  getGenerationStatus(
    versionId: string,
  ): Promise<{ entity: Version; breadcrumb: Breadcrumb }> {
    this.calls.push({ method: 'getGenerationStatus', args: [versionId] });
    if (this.cannedVersionScenario === 'not-found') {
      return Promise.reject(
        new TypedError('VERSION_NOT_FOUND', `Version '${versionId}' not found`),
      );
    }
    const entity: Version = {
      id: versionId,
      shot_id: 'shot_fake',
      version_number: 1,
      status: 'submitted',
      job_id: 'prompt_fake_123',
      parent_version_id: null,
      notes: null,
      created_at: 0,
      completed_at: null,
      error_code: null,
      error_message: null,
      outputs_json: null,
    };
    const entries: BreadcrumbEntry[] = [
      { type: 'workspace', id: 'ws_fake', name: 'ws' },
      { type: 'project', id: 'proj_fake', name: 'proj' },
      { type: 'sequence', id: 'seq_fake', name: 'sq010' },
      { type: 'shot', id: 'shot_fake', name: 'sh010' },
      { type: 'version', id: versionId, name: 'v001' },
    ];
    return Promise.resolve({
      entity,
      breadcrumb: { entries, text: entries.map((e) => e.name).join(' > ') },
    });
  }

  async start(): Promise<void> {
    this.calls.push({ method: 'start', args: [] });
  }

  async stop(): Promise<void> {
    this.calls.push({ method: 'stop', args: [] });
  }
}
