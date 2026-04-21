import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { workspaces, projects, sequences, shots } from './schema.js';
import type { Workspace, Project, Sequence, Shot } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Detect SQLite unique-constraint violations across better-sqlite3 versions.
 * better-sqlite3 surfaces err.code like 'SQLITE_CONSTRAINT_UNIQUE' or 'SQLITE_CONSTRAINT_PRIMARYKEY';
 * we also guard against messages that mention `UNIQUE` as a belt-and-suspenders check.
 */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  const code = e.code ?? '';
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
    const msg = e.message ?? '';
    if (/UNIQUE/i.test(msg)) return true;
  }
  return false;
}

/**
 * Repository for VFX Familiar hierarchy entities. Owns every SQL read/write for
 * workspaces/projects/sequences/shots. Returns plain typed objects (never raw
 * Drizzle rows). Wraps SQLite UNIQUE violations into TypedError('DUPLICATE_NAME')
 * and missing-parent pre-checks into TypedError('PARENT_NOT_FOUND').
 *
 * Hard invariants (D-33, D-34):
 *  - Zero MCP SDK imports (store is engine-pure).
 *  - All inserts/selects use Drizzle parameterized queries — no raw string concat with user input.
 *  - Shot regex validation is NOT performed here; it lives in the engine (D-07, D-33).
 */
export class HierarchyRepo {
  constructor(private db: Db) {}

  // ================================================================
  // WORKSPACE
  // ================================================================

  createWorkspace(name: string): Workspace {
    const row: Workspace = {
      id: newId('ws'),
      name,
      naming_template: null,
      created_at: Date.now(),
    };
    try {
      this.db.insert(workspaces).values(row).run();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TypedError(
          'DUPLICATE_NAME',
          `Workspace '${name}' already exists`,
          `Pick a different name or list existing workspaces with { tool: 'workspace', action: 'list' }`,
        );
      }
      throw err;
    }
    return row;
  }

  getWorkspace(id: string): Workspace | null {
    const r = this.db.select().from(workspaces).where(eq(workspaces.id, id)).get();
    return (r as Workspace | undefined) ?? null;
  }

  listWorkspaces(
    limit: number,
    offset: number,
  ): { items: Workspace[]; total: number } {
    const items = this.db
      .select()
      .from(workspaces)
      .limit(limit)
      .offset(offset)
      .all() as Workspace[];
    const totalRow = this.db
      .select({ n: sql<number>`count(*)` })
      .from(workspaces)
      .get();
    return { items, total: Number(totalRow?.n ?? 0) };
  }

  // ================================================================
  // PROJECT
  // ================================================================

  createProject(workspaceId: string, name: string): Project {
    if (!this.getWorkspace(workspaceId)) {
      throw new TypedError(
        'PARENT_NOT_FOUND',
        `Parent workspace '${workspaceId}' not found for project creation`,
        `Verify the parent id with { tool: 'workspace', action: 'get' }`,
      );
    }
    const row: Project = {
      id: newId('proj'),
      workspace_id: workspaceId,
      name,
      naming_template: null,
      created_at: Date.now(),
    };
    try {
      this.db.insert(projects).values(row).run();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TypedError(
          'DUPLICATE_NAME',
          `Project '${name}' already exists in workspace '${workspaceId}'`,
          `Pick a different name or list existing projects`,
        );
      }
      throw err;
    }
    return row;
  }

  getProject(id: string): Project | null {
    const r = this.db.select().from(projects).where(eq(projects.id, id)).get();
    return (r as Project | undefined) ?? null;
  }

  listProjects(
    workspaceId: string | undefined,
    limit: number,
    offset: number,
  ): { items: Project[]; total: number } {
    const itemsQuery =
      workspaceId !== undefined
        ? this.db
            .select()
            .from(projects)
            .where(eq(projects.workspace_id, workspaceId))
            .limit(limit)
            .offset(offset)
        : this.db.select().from(projects).limit(limit).offset(offset);
    const items = itemsQuery.all() as Project[];

    const totalQuery =
      workspaceId !== undefined
        ? this.db
            .select({ n: sql<number>`count(*)` })
            .from(projects)
            .where(eq(projects.workspace_id, workspaceId))
        : this.db.select({ n: sql<number>`count(*)` }).from(projects);
    const totalRow = totalQuery.get();
    return { items, total: Number(totalRow?.n ?? 0) };
  }

  // ================================================================
  // SEQUENCE
  // ================================================================

  createSequence(projectId: string, name: string): Sequence {
    if (!this.getProject(projectId)) {
      throw new TypedError(
        'PARENT_NOT_FOUND',
        `Parent project '${projectId}' not found for sequence creation`,
        `Verify the parent id with { tool: 'project', action: 'get' }`,
      );
    }
    const row: Sequence = {
      id: newId('seq'),
      project_id: projectId,
      name,
      created_at: Date.now(),
    };
    try {
      this.db.insert(sequences).values(row).run();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TypedError(
          'DUPLICATE_NAME',
          `Sequence '${name}' already exists in project '${projectId}'`,
          `Pick a different name or list existing sequences`,
        );
      }
      throw err;
    }
    return row;
  }

  getSequence(id: string): Sequence | null {
    const r = this.db.select().from(sequences).where(eq(sequences.id, id)).get();
    return (r as Sequence | undefined) ?? null;
  }

  listSequences(
    projectId: string | undefined,
    limit: number,
    offset: number,
  ): { items: Sequence[]; total: number } {
    const itemsQuery =
      projectId !== undefined
        ? this.db
            .select()
            .from(sequences)
            .where(eq(sequences.project_id, projectId))
            .limit(limit)
            .offset(offset)
        : this.db.select().from(sequences).limit(limit).offset(offset);
    const items = itemsQuery.all() as Sequence[];

    const totalQuery =
      projectId !== undefined
        ? this.db
            .select({ n: sql<number>`count(*)` })
            .from(sequences)
            .where(eq(sequences.project_id, projectId))
        : this.db.select({ n: sql<number>`count(*)` }).from(sequences);
    const totalRow = totalQuery.get();
    return { items, total: Number(totalRow?.n ?? 0) };
  }

  // ================================================================
  // SHOT
  // ================================================================

  createShot(sequenceId: string, name: string): Shot {
    // Shot regex validation lives in the engine (D-07, D-33). Repo only enforces
    // parent existence and uniqueness.
    if (!this.getSequence(sequenceId)) {
      throw new TypedError(
        'PARENT_NOT_FOUND',
        `Parent sequence '${sequenceId}' not found for shot creation`,
        `Verify the parent id with { tool: 'sequence', action: 'get' }`,
      );
    }
    const row: Shot = {
      id: newId('shot'),
      sequence_id: sequenceId,
      name,
      created_at: Date.now(),
    };
    try {
      this.db.insert(shots).values(row).run();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TypedError(
          'DUPLICATE_NAME',
          `Shot '${name}' already exists in sequence '${sequenceId}'`,
          `Pick a different name or list existing shots`,
        );
      }
      throw err;
    }
    return row;
  }

  getShot(id: string): Shot | null {
    const r = this.db.select().from(shots).where(eq(shots.id, id)).get();
    return (r as Shot | undefined) ?? null;
  }

  listShots(
    sequenceId: string | undefined,
    limit: number,
    offset: number,
  ): { items: Shot[]; total: number } {
    const itemsQuery =
      sequenceId !== undefined
        ? this.db
            .select()
            .from(shots)
            .where(eq(shots.sequence_id, sequenceId))
            .limit(limit)
            .offset(offset)
        : this.db.select().from(shots).limit(limit).offset(offset);
    const items = itemsQuery.all() as Shot[];

    const totalQuery =
      sequenceId !== undefined
        ? this.db
            .select({ n: sql<number>`count(*)` })
            .from(shots)
            .where(eq(shots.sequence_id, sequenceId))
        : this.db.select({ n: sql<number>`count(*)` }).from(shots);
    const totalRow = totalQuery.get();
    return { items, total: Number(totalRow?.n ?? 0) };
  }
}
