import { eq, sql, asc, and, isNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { workspaces, projects, sequences, shots } from './schema.js';
import {
  HierarchyEventsRepo,
  type HierarchyEntityType,
} from './hierarchy-events-repo.js';
import type { Workspace, Project, Sequence, Shot } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';
import { buildHierarchyOrderBy, type HierarchySort } from './sort.js';

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
 * Repository for Vellum hierarchy entities. Owns every SQL read/write for
 * workspaces/projects/sequences/shots. Returns plain typed objects (never raw
 * Drizzle rows). Wraps SQLite UNIQUE violations into TypedError('DUPLICATE_NAME')
 * and missing-parent pre-checks into TypedError('PARENT_NOT_FOUND').
 *
 * Hard invariants:
 *  - Zero MCP SDK imports (store is engine-pure).
 *  - All inserts/selects use Drizzle parameterized queries — no raw string concat with user input.
 *  - Shot regex validation is NOT performed here; it lives in the engine (store stays validation-free).
 */
/** The four hierarchy tables, keyed by the entity_type strings used in
 *  hierarchy_events. Lets rename/archive be written once instead of four times. */
const TABLES = {
  workspace: workspaces,
  project: projects,
  sequence: sequences,
  shot: shots,
} as const;

export type HierarchyEntity = Workspace | Project | Sequence | Shot;

/**
 * Combine a parent-scope filter with the default "live rows only" filter.
 *
 * Archived rows are excluded unless explicitly asked for. That default is the
 * whole point of archiving — a sequence dropped in a re-cut should stop
 * appearing in the grid AND stop being counted, not merely acquire a flag the
 * caller has to remember to check.
 */
function archiveFilter(
  table: { archived_at: SQLiteColumn },
  scope: SQL | undefined,
  includeArchived: boolean | undefined,
): SQL | undefined {
  if (includeArchived) return scope;
  const live = isNull(table.archived_at);
  return scope ? and(scope, live) : live;
}

export class HierarchyRepo {
  private events: HierarchyEventsRepo;

  constructor(private db: Db) {
    this.events = new HierarchyEventsRepo(db);
  }

  // ================================================================
  // MUTATION — rename + archive, each recorded in hierarchy_events
  // ================================================================

  /**
   * Rename an entity and append the mutation to hierarchy_events, atomically.
   *
   * Both writes share one transaction so history and the current value cannot
   * diverge: a rename that committed without its record would leave every
   * artifact naming the old value unexplainable.
   *
   * NOTE on outputs already on disk: renaming does NOT move existing files.
   * Output paths are resolved at persist time and stored per version, so takes
   * written before the rename stay resolvable under the old directory while new
   * ones land under the new name. That is deliberate — silently moving a tree of
   * finished renders on a metadata edit is the more dangerous behaviour.
   *
   * Name VALIDATION lives in the engine (repo stays validation-free, matching
   * createShot); the repo enforces existence and uniqueness only.
   */
  rename(
    entityType: HierarchyEntityType,
    id: string,
    newName: string,
    opts: { note?: string | null; changedBy?: string | null } = {},
  ): HierarchyEntity {
    const table = TABLES[entityType];
    const existing = this.getEntity(entityType, id);
    if (!existing) {
      throw new TypedError(
        `${entityType.toUpperCase()}_NOT_FOUND` as 'SHOT_NOT_FOUND',
        `${entityType} '${id}' not found`,
        `Verify the id with { tool: '${entityType}', action: 'get' }`,
      );
    }
    if (existing.name === newName) {
      // Not an error, but not an event either — recording a no-op rename would
      // pad the audit trail with entries that never changed anything.
      return existing;
    }
    try {
      this.db.transaction((tx) => {
        tx.update(table).set({ name: newName }).where(eq(table.id, id)).run();
        new HierarchyEventsRepo(tx as unknown as Db).insertEvent({
          entityType,
          entityId: id,
          eventType: 'renamed',
          fromValue: existing.name,
          toValue: newName,
          note: opts.note,
          changedBy: opts.changedBy,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TypedError(
          'DUPLICATE_NAME',
          `Cannot rename ${entityType} to '${newName}' — that name is already taken by a sibling`,
          'Pick a different name, or rename the other entity first.',
        );
      }
      throw err;
    }
    return this.getEntity(entityType, id)!;
  }

  /**
   * Archive or unarchive an entity, recorded in hierarchy_events.
   *
   * Soft and reversible by construction — there is no delete anywhere in this
   * repo, because provenance rows reference these ids and a record whose subject
   * can disappear is not a record. Archiving means "out of the cut": hidden from
   * default listings, refuses NEW work, still fully readable.
   *
   * Non-cascading. Archiving a sequence does not touch its shots — asking for
   * that sequence's shots explicitly should still return them. What changes is
   * that the sequence stops appearing in its project's listing.
   */
  setArchived(
    entityType: HierarchyEntityType,
    id: string,
    archived: boolean,
    opts: { note?: string | null; changedBy?: string | null } = {},
  ): HierarchyEntity {
    const table = TABLES[entityType];
    const existing = this.getEntity(entityType, id);
    if (!existing) {
      throw new TypedError(
        `${entityType.toUpperCase()}_NOT_FOUND` as 'SHOT_NOT_FOUND',
        `${entityType} '${id}' not found`,
        `Verify the id with { tool: '${entityType}', action: 'get' }`,
      );
    }
    const isArchived = existing.archived_at != null;
    if (isArchived === archived) return existing; // no-op, no event
    const at = archived ? Date.now() : null;
    this.db.transaction((tx) => {
      tx.update(table).set({ archived_at: at }).where(eq(table.id, id)).run();
      new HierarchyEventsRepo(tx as unknown as Db).insertEvent({
        entityType,
        entityId: id,
        eventType: archived ? 'archived' : 'unarchived',
        note: opts.note,
        changedBy: opts.changedBy,
      });
    });
    return this.getEntity(entityType, id)!;
  }

  /** Polymorphic read across the four levels — backs rename/archive and the
   *  engine's archived-parent guards. */
  getEntity(entityType: HierarchyEntityType, id: string): HierarchyEntity | null {
    const table = TABLES[entityType];
    const r = this.db.select().from(table).where(eq(table.id, id)).get();
    return (r as HierarchyEntity | undefined) ?? null;
  }

  /** Mutation history for one entity, newest first. */
  listHierarchyEvents(query: {
    entityType: HierarchyEntityType;
    entityId: string;
    limit: number;
    offset: number;
  }) {
    return this.events.listForEntity(query);
  }

  /** Every name an entity has had, oldest first. */
  nameHistory(entityType: HierarchyEntityType, entityId: string): string[] {
    return this.events.nameHistory(entityType, entityId);
  }

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
    opts?: { includeArchived?: boolean },
  ): { items: Workspace[]; total_count: number } {
    // Deterministic pagination ordering. created_at as primary sort (so
    // newer rows naturally land on later pages); id as a stable tiebreaker for
    // rows created in the same millisecond. Archived EXCLUDED by default.
    const where = archiveFilter(workspaces, undefined, opts?.includeArchived);
    const q = this.db.select().from(workspaces);
    const items = (where ? q.where(where) : q)
      .orderBy(asc(workspaces.created_at), asc(workspaces.id))
      .limit(limit)
      .offset(offset)
      .all() as Workspace[];
    const countQ = this.db.select({ n: sql<number>`count(*)` }).from(workspaces);
    const totalRow = (where ? countQ.where(where) : countQ).get();
    return { items, total_count: Number(totalRow?.n ?? 0) };
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

  /**
   * Set (or clear, with null) a project's Hybrid-v1 output-naming template. Plain
   * column update — the naming_template column exists from the base schema.
   * Throws PROJECT_NOT_FOUND when the project does not exist. Returns the updated row.
   */
  setProjectNamingTemplate(projectId: string, template: string | null): Project {
    const existing = this.getProject(projectId);
    if (!existing) {
      throw new TypedError(
        'PROJECT_NOT_FOUND',
        `Project '${projectId}' not found`,
        `Verify the id with { tool: 'project', action: 'get' }`,
      );
    }
    this.db
      .update(projects)
      .set({ naming_template: template })
      .where(eq(projects.id, projectId))
      .run();
    return { ...existing, naming_template: template };
  }

  listProjects(
    workspaceId: string | undefined,
    limit: number,
    offset: number,
    opts?: { sort?: HierarchySort; includeArchived?: boolean },
  ): { items: Project[]; total_count: number } {
    // Back-compat: when opts.sort is OMITTED, ORDER BY preserves the
    // original `created_at ASC, id ASC` shape so existing MCP tool callers
    // continue to receive byte-identical ordering. When opts.sort is provided,
    // buildHierarchyOrderBy emits `<col> <dir>, projects.id ASC`.
    // Archived rows are EXCLUDED by default.
    const where = archiveFilter(
      projects,
      workspaceId !== undefined ? eq(projects.workspace_id, workspaceId) : undefined,
      opts?.includeArchived,
    );
    const q = this.db.select().from(projects);
    const scoped = where ? q.where(where) : q;
    const items = (
      opts?.sort
        ? scoped.orderBy(buildHierarchyOrderBy(projects, opts.sort))
        : scoped.orderBy(asc(projects.created_at), asc(projects.id))
    )
      .limit(limit)
      .offset(offset)
      .all() as Project[];

    const countQ = this.db.select({ n: sql<number>`count(*)` }).from(projects);
    const totalRow = (where ? countQ.where(where) : countQ).get();
    return { items, total_count: Number(totalRow?.n ?? 0) };
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
    opts?: { sort?: HierarchySort; includeArchived?: boolean },
  ): { items: Sequence[]; total_count: number } {
    // Back-compat (see listProjects). Archived rows EXCLUDED by default —
    // this is the listing a sequence re-cut actually needs to change.
    const where = archiveFilter(
      sequences,
      projectId !== undefined ? eq(sequences.project_id, projectId) : undefined,
      opts?.includeArchived,
    );
    const q = this.db.select().from(sequences);
    const scoped = where ? q.where(where) : q;
    const items = (
      opts?.sort
        ? scoped.orderBy(buildHierarchyOrderBy(sequences, opts.sort))
        : scoped.orderBy(asc(sequences.created_at), asc(sequences.id))
    )
      .limit(limit)
      .offset(offset)
      .all() as Sequence[];

    const countQ = this.db.select({ n: sql<number>`count(*)` }).from(sequences);
    const totalRow = (where ? countQ.where(where) : countQ).get();
    return { items, total_count: Number(totalRow?.n ?? 0) };
  }

  // ================================================================
  // SHOT
  // ================================================================

  createShot(sequenceId: string, name: string): Shot {
    // Shot regex validation lives in the engine. Repo only enforces
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
      // Default 'wip' matches migration 0008 column
      // DEFAULT and shotStatusEvents history null-coalesce. Repo writes the
      // explicit value so SCHEMA_DDL bootstrap (which omits the status
      // column) stays compatible — the actual DB column lands via 0008.
      status: 'wip',
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
    opts?: { sort?: HierarchySort; includeArchived?: boolean },
  ): { items: Shot[]; total_count: number } {
    // Back-compat (see listProjects). Original ORDER BY preserved when
    // opts.sort is omitted; tool callers unaffected. Archived rows are
    // EXCLUDED by default — an archived shot is out of the cut and should not
    // pad the grid or the counts.
    const where = archiveFilter(
      shots,
      sequenceId !== undefined ? eq(shots.sequence_id, sequenceId) : undefined,
      opts?.includeArchived,
    );
    const q = this.db.select().from(shots);
    const scoped = where ? q.where(where) : q;
    const items = (
      opts?.sort
        ? scoped.orderBy(buildHierarchyOrderBy(shots, opts.sort))
        : scoped.orderBy(asc(shots.created_at), asc(shots.id))
    )
      .limit(limit)
      .offset(offset)
      .all() as Shot[];

    const countQ = this.db.select({ n: sql<number>`count(*)` }).from(shots);
    const totalRow = (where ? countQ.where(where) : countQ).get();
    return { items, total_count: Number(totalRow?.n ?? 0) };
  }
}
