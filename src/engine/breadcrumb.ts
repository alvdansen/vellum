import type { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { BreadcrumbEntry, Breadcrumb, EntityType } from '../types/hierarchy.js';
import { TypedError } from './errors.js';

/** Breadcrumb text separator — locked by D-22. */
const SEP = ' > ';

/**
 * Resolves breadcrumb context for any hierarchy entity by walking the parent chain
 * leaf→root via HierarchyRepo. Emits a root→leaf ordered BreadcrumbEntry[] plus a
 * pre-rendered text string. At most 4 SELECTs per resolve() call (shot case).
 *
 * Breadcrumb resolution must live here (D-35) — never in tools, never in repos.
 */
export class BreadcrumbResolver {
  constructor(private repo: HierarchyRepo) {}

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
    }
    return { entries, text: entries.map((e) => e.name).join(SEP) };
  }
}
