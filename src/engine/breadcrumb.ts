import type { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { BreadcrumbEntry, Breadcrumb, EntityType } from '../types/hierarchy.js';
import { TypedError } from './errors.js';
import { versionLabel } from '../utils/outputs.js';

/** Breadcrumb text separator — locked by D-22. */
const SEP = ' > ';

/**
 * Resolves breadcrumb context for any hierarchy entity by walking the parent chain
 * leaf→root. Phase 1: workspace/project/sequence/shot (4 levels). Phase 2: extends
 * with a `'version'` leaf that walks versions → shots → sequences → projects →
 * workspaces (5 levels). 5-entry breadcrumb text pattern: 'ws > proj > seq > shot > v001'
 * (D-GEN-05).
 *
 * Breadcrumb resolution must live here (D-35) — never in tools, never in repos.
 */
export class BreadcrumbResolver {
  constructor(
    private repo: HierarchyRepo,
    private versions: VersionRepo,
  ) {}

  resolve(type: EntityType, id: string): Breadcrumb {
    const entries: BreadcrumbEntry[] = [];
    switch (type) {
      case 'shot': {
        const shot = this.repo.getShot(id);
        if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${id}' not found`);
        const seq = this.repo.getSequence(shot.sequence_id)!;
        const proj = this.repo.getProject(seq.project_id)!;
        const ws = this.repo.getWorkspace(proj.workspace_id)!;
        entries.push({ type: 'workspace', id: ws.id, name: ws.name });
        entries.push({ type: 'project', id: proj.id, name: proj.name });
        entries.push({ type: 'sequence', id: seq.id, name: seq.name });
        entries.push({ type: 'shot', id: shot.id, name: shot.name });
        break;
      }
      case 'sequence': {
        const seq = this.repo.getSequence(id);
        if (!seq) throw new TypedError('SEQUENCE_NOT_FOUND', `Sequence '${id}' not found`);
        const proj = this.repo.getProject(seq.project_id)!;
        const ws = this.repo.getWorkspace(proj.workspace_id)!;
        entries.push({ type: 'workspace', id: ws.id, name: ws.name });
        entries.push({ type: 'project', id: proj.id, name: proj.name });
        entries.push({ type: 'sequence', id: seq.id, name: seq.name });
        break;
      }
      case 'project': {
        const proj = this.repo.getProject(id);
        if (!proj) throw new TypedError('PROJECT_NOT_FOUND', `Project '${id}' not found`);
        const ws = this.repo.getWorkspace(proj.workspace_id)!;
        entries.push({ type: 'workspace', id: ws.id, name: ws.name });
        entries.push({ type: 'project', id: proj.id, name: proj.name });
        break;
      }
      case 'workspace': {
        const ws = this.repo.getWorkspace(id);
        if (!ws) throw new TypedError('WORKSPACE_NOT_FOUND', `Workspace '${id}' not found`);
        entries.push({ type: 'workspace', id: ws.id, name: ws.name });
        break;
      }
      case 'version': {
        const ver = this.versions.getVersion(id);
        if (!ver) throw new TypedError('VERSION_NOT_FOUND', `Version '${id}' not found`);
        const shot = this.repo.getShot(ver.shot_id)!;
        const seq = this.repo.getSequence(shot.sequence_id)!;
        const proj = this.repo.getProject(seq.project_id)!;
        const ws = this.repo.getWorkspace(proj.workspace_id)!;
        entries.push({ type: 'workspace', id: ws.id, name: ws.name });
        entries.push({ type: 'project', id: proj.id, name: proj.name });
        entries.push({ type: 'sequence', id: seq.id, name: seq.name });
        entries.push({ type: 'shot', id: shot.id, name: shot.name });
        entries.push({ type: 'version', id: ver.id, name: versionLabel(ver.version_number) });
        break;
      }
    }
    return { entries, text: entries.map((e) => e.name).join(SEP) };
  }
}
