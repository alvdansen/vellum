import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { projectSpecs } from './schema.js';
import { newId } from '../utils/id.js';
import { hashSpecContent } from '../utils/spec-hash.js';
import { TypedError } from '../engine/errors.js';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Append-only store for project spec revisions.
 *
 * A spec is the standing context an agent reads BEFORE it submits — a style
 * bible, a look book, a palette-and-naming contract. Vellum's provenance
 * already answers "what was this generation"; the spec answers "what was it
 * supposed to be", and binding the two is what lets a wrong output be fixed at
 * the SPEC rather than one shot at a time.
 *
 * Structural append-only invariant, mirroring ProvenanceRepo: this class
 * exposes ONLY inserts and reads. There is no update path and no delete path,
 * so a revision that an agent acted on can never be rewritten underneath the
 * record that cites it. An architecture-purity test greps this file for the
 * Drizzle mutation builders and fails the build if either ever appears — which
 * is also why the content hash lives in utils/spec-hash.ts (crypto's streaming
 * update call would trip the same grep).
 */

export interface ProjectSpec {
  id: string;
  project_id: string;
  revision: number;
  content: string;
  content_hash: string;
  note: string | null;
  authored_by: string;
  created_at: number;
}

/** What gets stamped into provenance when a version is bound to a spec. */
export interface SpecBinding {
  spec_id: string;
  project_id: string;
  revision: number;
  content_hash: string;
}

/** Re-exported so callers can verify a binding against spec content they hold
 *  without re-reading the row. Implementation lives in utils/spec-hash.ts. */
export { hashSpecContent };

export class SpecRepo {
  constructor(private db: Db) {}

  /**
   * Append the next revision for a project.
   *
   * The revision number is derived inside the caller's transaction boundary as
   * `max(revision) + 1`. That read-then-write is only safe because
   * UNIQUE(project_id, revision) turns a lost race into a constraint violation
   * rather than a silent overwrite — two concurrent writers cannot both land
   * revision N. The loser is surfaced as a typed, retryable error.
   */
  insertRevision(input: {
    projectId: string;
    content: string;
    note?: string | null;
    authoredBy?: string | null;
  }): ProjectSpec {
    const latest = this.getLatestRevision(input.projectId);
    const row: ProjectSpec = {
      id: newId('spec'),
      project_id: input.projectId,
      revision: (latest?.revision ?? 0) + 1,
      content: input.content,
      content_hash: hashSpecContent(input.content),
      note: input.note ?? null,
      authored_by: input.authoredBy ?? 'user',
      created_at: Date.now(),
    };
    try {
      this.db.insert(projectSpecs).values(row).run();
    } catch (err) {
      const e = err as { code?: string };
      if (typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')) {
        throw new TypedError(
          'INVALID_INPUT',
          `Spec revision ${row.revision} for project '${input.projectId}' already exists`,
          'Another writer created a revision concurrently. Re-read the latest revision and set the spec again.',
        );
      }
      throw err;
    }
    return row;
  }

  /** Newest revision for a project, or null when the project has no spec. */
  getLatestRevision(projectId: string): ProjectSpec | null {
    const rows = this.db
      .select()
      .from(projectSpecs)
      .where(eq(projectSpecs.project_id, projectId))
      .orderBy(desc(projectSpecs.revision))
      .limit(1)
      .all();
    return (rows[0] as ProjectSpec | undefined) ?? null;
  }

  /** A specific revision, or null. */
  getRevision(projectId: string, revision: number): ProjectSpec | null {
    const rows = this.db
      .select()
      .from(projectSpecs)
      .where(and(eq(projectSpecs.project_id, projectId), eq(projectSpecs.revision, revision)))
      .limit(1)
      .all();
    return (rows[0] as ProjectSpec | undefined) ?? null;
  }

  /**
   * Paginated revision history, newest first.
   *
   * `content` is deliberately excluded — a spec can be hundreds of kilobytes
   * and a history listing is a browse surface, not a fetch surface. Callers
   * read one revision's body with getRevision().
   */
  listRevisions(query: {
    projectId: string;
    limit: number;
    offset: number;
  }): { items: Omit<ProjectSpec, 'content'>[]; total_count: number } {
    const where = eq(projectSpecs.project_id, query.projectId);

    const countRows = this.db
      .select({ n: sql<number>`count(*)` })
      .from(projectSpecs)
      .where(where)
      .all();

    const items = this.db
      .select({
        id: projectSpecs.id,
        project_id: projectSpecs.project_id,
        revision: projectSpecs.revision,
        content_hash: projectSpecs.content_hash,
        note: projectSpecs.note,
        authored_by: projectSpecs.authored_by,
        created_at: projectSpecs.created_at,
      })
      .from(projectSpecs)
      .where(where)
      .orderBy(desc(projectSpecs.revision))
      .limit(query.limit)
      .offset(query.offset)
      .all() as Omit<ProjectSpec, 'content'>[];

    return { items, total_count: countRows[0]?.n ?? 0 };
  }
}
