import { and, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteClient } from 'better-sqlite3';
import * as schema from './schema.js';
import { tags } from './schema.js';
import type { TagCount, ScopeFilter } from '../types/assets.js';
import type { VersionRepo } from './version-repo.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

/**
 * The `drizzle()` factory returns `BetterSQLite3Database<T> & { $client: Database }`,
 * but the class declaration itself doesn't surface `$client`. Repo layer needs the
 * raw handle for json_group_array + scope-JOIN SQL (Drizzle builder is too
 * restrictive for aggregation), so we widen the type here to match what the
 * factory actually hands out.
 */
type Db = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

/**
 * Build the scope JOIN + WHERE + params for tag/metadata scope aggregation queries.
 * Engine (Plan 04-03) validates scope XOR (D-ASST-13); this helper trusts the input
 * and branches in workspace → project → sequence → shot order, ignoring extra fields.
 *
 * Module-local (not exported) — duplicated verbatim in metadata-repo.ts per
 * RESEARCH.md §"Alternatives Considered and Rejected" (repo files stay independent;
 * no cross-repo helper extraction in Phase 4).
 *
 * Source: RESEARCH.md §Pattern 3 + §Operation 5.
 * Security: buildScopeFragment parameterizes every user-derived field via `?`
 * placeholders + `scopeParams`. The returned strings contain zero user input —
 * only fixed column names and JOIN clauses (T-04-02-01 mitigation).
 */
function buildScopeFragment(scope: ScopeFilter): {
  scopeJoins: string;
  scopeWhere: string;
  scopeParams: unknown[];
} {
  const joins: string[] = [];
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (scope.workspace_id) {
    joins.push('INNER JOIN shots sh ON sh.id = v.shot_id');
    joins.push('INNER JOIN sequences sq ON sq.id = sh.sequence_id');
    joins.push('INNER JOIN projects p ON p.id = sq.project_id');
    wheres.push('p.workspace_id = ?');
    params.push(scope.workspace_id);
  } else if (scope.project_id) {
    joins.push('INNER JOIN shots sh ON sh.id = v.shot_id');
    joins.push('INNER JOIN sequences sq ON sq.id = sh.sequence_id');
    wheres.push('sq.project_id = ?');
    params.push(scope.project_id);
  } else if (scope.sequence_id) {
    joins.push('INNER JOIN shots sh ON sh.id = v.shot_id');
    wheres.push('sh.sequence_id = ?');
    params.push(scope.sequence_id);
  } else if (scope.shot_id) {
    wheres.push('v.shot_id = ?');
    params.push(scope.shot_id);
  }
  return {
    scopeJoins: joins.join('\n      '),
    scopeWhere: wheres.length > 0 ? 'WHERE ' + wheres.join(' AND ') : '',
    scopeParams: params,
  };
}

/**
 * Repository for Vellum `tags` table (Phase 4 — D-ASST-07, D-ASST-28).
 * Plain CRUD (DELETE allowed, unlike provenance-repo which is structurally
 * append-only). Idempotent mutators per D-ASST-03: insertTag uses ON CONFLICT
 * DO NOTHING, deleteTag is a plain DELETE (0 rows affected = success).
 *
 * Hard invariants (D-33, D-ASST-26, D-ASST-29):
 *  - Zero MCP SDK imports (store layer is engine-pure).
 *  - All inserts/selects use parameterized queries — no string concat with user input.
 *  - Tag regex + length caps enforced in the engine (Plan 04-03); repo trusts input.
 *  - Pre-check version existence before INSERT (RESEARCH Pitfall #3) — surfaces
 *    VERSION_NOT_FOUND as a typed error, never letting SQLITE_CONSTRAINT_FOREIGNKEY leak.
 *
 * Threat-model anchors:
 *  - T-04-02-01 (SQL injection in raw SQL): buildScopeFragment fully parameterizes.
 *  - T-04-02-02 (raw SqliteError leak): pre-check + ON CONFLICT DO NOTHING = no throws.
 */
export class TagRepo {
  constructor(
    private db: Db,
    private versionRepo: VersionRepo,
  ) {}

  /**
   * Insert a tag on a version. Idempotent per D-ASST-03: re-adding an existing
   * (version_id, tag) pair is a no-op (returns { inserted: false } with the
   * existing row's id).
   *
   * Pre-check pattern (RESEARCH Pitfall #3, hierarchy-repo.ts:99): verify the
   * parent version exists first so we surface VERSION_NOT_FOUND rather than
   * SQLITE_CONSTRAINT_FOREIGNKEY. D-ASST-24 reuses VERSION_NOT_FOUND from
   * Phase 1.
   *
   * SQL: single-statement INSERT ON CONFLICT DO NOTHING with RETURNING id.
   * Empty RETURNING array indicates the UNIQUE(version_id, tag) path fired;
   * we then SELECT the existing id to honor the return contract. No transaction
   * wrapper (RESEARCH Pitfall #1 — ON CONFLICT + transaction can auto-rollback;
   * single INSERT is atomic).
   */
  insertTag(versionId: string, tag: string): { id: string; inserted: boolean } {
    if (!this.versionRepo.getVersion(versionId)) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    const id = newId('tag');
    const now = Date.now();
    const returned = this.db
      .insert(tags)
      .values({ id, version_id: versionId, tag, created_at: now })
      .onConflictDoNothing({ target: [tags.version_id, tags.tag] })
      .returning({ id: tags.id })
      .all() as Array<{ id: string }>;
    if (returned.length > 0) {
      return { id: returned[0]!.id, inserted: true };
    }
    // ON CONFLICT DO NOTHING fired — fetch the existing row's id to honor the
    // return contract (INV-ASST-01: second call returns same id as first).
    const existing = this.db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.version_id, versionId), eq(tags.tag, tag)))
      .get() as { id: string } | undefined;
    return { id: existing!.id, inserted: false };
  }

  /**
   * Delete a tag from a version. Idempotent per D-ASST-03: calling on a missing
   * (version_id, tag) pair is a no-op (0 rows affected, no throw).
   *
   * Does NOT pre-check version existence — DELETE on a missing row is already
   * a no-op (INV-ASST-02), so the extra SELECT would be wasted I/O.
   */
  deleteTag(versionId: string, tag: string): void {
    this.db
      .delete(tags)
      .where(and(eq(tags.version_id, versionId), eq(tags.tag, tag)))
      .run();
  }

  /**
   * Return all tags on a version, sorted alphabetical ASC (D-ASST-04 / D-ASST-19).
   *
   * Uses raw SQL via `this.db.$client.prepare` to leverage
   * `json_group_array(tag ORDER BY tag)` — correlated subquery-style semantics
   * that render empty sets as `[]` (NOT `[null]` — RESEARCH Pitfall #2). SQLite
   * 3.44+ required for ORDER BY inside aggregates; better-sqlite3 12.9.0 bundles
   * SQLite 3.53.0.
   */
  listTagsForVersion(versionId: string): string[] {
    const row = this.db.$client
      .prepare(
        `SELECT json_group_array(tag ORDER BY tag) AS tags_json FROM tags WHERE version_id = ?`,
      )
      .get(versionId) as { tags_json: string } | undefined;
    return JSON.parse(row?.tags_json ?? '[]') as string[];
  }

  /**
   * Count tags for a version. Supports engine cap enforcement (D-ASST-11 —
   * MAX_TAGS_PER_VERSION=50 pre-insert check). TOCTOU race between count →
   * compare → insert is accepted at demo scale (RESEARCH Pitfall #6).
   */
  countTagsForVersion(versionId: string): number {
    const row = this.db
      .select({ c: sql<number>`COUNT(*)` })
      .from(tags)
      .where(eq(tags.version_id, versionId))
      .get();
    return Number(row?.c ?? 0);
  }

  /**
   * Scope-aware tag aggregation (D-ASST-06, RESEARCH Operation 5).
   * Returns `{ items: Array<{name, count}>, total_count }` — items ordered
   * `count DESC, name ASC`, total_count = COUNT(DISTINCT tag) under the scope.
   *
   * Scope branches (buildScopeFragment):
   *   - {}                       → global (no scope JOIN / WHERE)
   *   - { workspace_id }         → JOIN shots → sequences → projects; filter p.workspace_id
   *   - { project_id }           → JOIN shots → sequences; filter sq.project_id
   *   - { sequence_id }          → JOIN shots; filter sh.sequence_id
   *   - { shot_id }              → filter v.shot_id directly
   *
   * Engine enforces scope XOR (D-ASST-13). Repo is defensive-only: buildScopeFragment
   * branches on first-match and ignores extra fields (T-04-02-05 mitigation).
   *
   * Wrapped in db.transaction() so items + total_count come from a snapshot-consistent
   * view (D-ASST-18, RESEARCH Pattern 5).
   */
  listTagsInScope(
    scope: ScopeFilter,
    limit: number,
    offset: number,
  ): { items: TagCount[]; total_count: number } {
    const { scopeJoins, scopeWhere, scopeParams } = buildScopeFragment(scope);
    const itemsSql = `
      SELECT t.tag AS name, COUNT(*) AS count
      FROM tags t
      INNER JOIN versions v ON v.id = t.version_id
      ${scopeJoins}
      ${scopeWhere}
      GROUP BY t.tag
      ORDER BY count DESC, name ASC
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(DISTINCT t.tag) AS n
      FROM tags t
      INNER JOIN versions v ON v.id = t.version_id
      ${scopeJoins}
      ${scopeWhere}
    `;
    return this.db.transaction(() => {
      const items = this.db.$client
        .prepare(itemsSql)
        .all(...scopeParams, limit, offset) as Array<{ name: string; count: number }>;
      const countRow = this.db.$client.prepare(countSql).get(...scopeParams) as { n: number };
      return {
        items: items.map((r) => ({ name: r.name, count: Number(r.count) })),
        total_count: Number(countRow.n),
      };
    });
  }
}
