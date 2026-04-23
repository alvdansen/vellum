import { and, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteClient } from 'better-sqlite3';
import * as schema from './schema.js';
import { metadata } from './schema.js';
import type { MetadataKV, TagCount, ScopeFilter } from '../types/assets.js';
import type { VersionRepo } from './version-repo.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

/**
 * The `drizzle()` factory returns `BetterSQLite3Database<T> & { $client: Database }`;
 * the class itself doesn't surface `$client`. Widen the type so raw-SQL json
 * aggregation and scope JOINs can go through the underlying handle.
 */
type Db = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

/**
 * Build the scope JOIN + WHERE + params for metadata aggregation queries.
 * DUPLICATED VERBATIM from tag-repo.ts per RESEARCH.md §"Alternatives Considered
 * and Rejected" — repo files stay independent; cross-repo extraction is deferred
 * (Plan 05 may consolidate if complexity warrants).
 *
 * Security: every user-derived field is parameterized via `?` placeholders +
 * `scopeParams`. The returned strings contain only fixed column names and JOIN
 * clauses, zero user input — T-04-02-01 mitigation.
 *
 * Source: RESEARCH.md §Pattern 3 + §Operation 5.
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
 * Repository for VFX Familiar `metadata` table (Phase 4 — D-ASST-08, D-ASST-28).
 * Plain CRUD (DELETE allowed). Mutators are idempotent per D-ASST-03:
 * upsertMetadata uses INSERT ON CONFLICT DO UPDATE (value + created_at refresh
 * per D-ASST-08); deleteMetadata is a plain DELETE.
 *
 * Hard invariants (D-33, D-ASST-26, D-ASST-29):
 *  - Zero MCP SDK imports (store layer is engine-pure).
 *  - All inserts/selects use parameterized queries — no string concat with user input.
 *  - Key regex + length caps + value size enforced in the engine (Plan 04-03).
 *  - Pre-check version existence before INSERT (RESEARCH Pitfall #3) — surfaces
 *    VERSION_NOT_FOUND as a typed error, never letting SQLITE_CONSTRAINT_FOREIGNKEY leak.
 *
 * Threat-model anchors:
 *  - T-04-02-01 (SQL injection in raw SQL): buildScopeFragment fully parameterizes.
 *  - T-04-02-02 (raw SqliteError leak): pre-check + ON CONFLICT DO UPDATE = no throws.
 */
export class MetadataRepo {
  constructor(
    private db: Db,
    private versionRepo: VersionRepo,
  ) {}

  /**
   * Upsert a metadata entry on a version. Idempotent per D-ASST-03:
   *   - first call (version_id+key new) → INSERT path, returns new meta_ id.
   *   - subsequent calls with same (version_id, key) → UPDATE path, returns the
   *     SAME id as the first call, writes new value + new created_at.
   *
   * D-ASST-08 locks created_at as a "last-touch" timestamp — refreshes on every
   * upsert via `excluded.created_at`.
   *
   * Pre-check pattern (RESEARCH Pitfall #3, hierarchy-repo.ts:99): verify the
   * parent version exists first so we surface VERSION_NOT_FOUND rather than
   * SQLITE_CONSTRAINT_FOREIGNKEY. D-ASST-24 reuses VERSION_NOT_FOUND from Phase 1.
   *
   * SQL: INSERT ON CONFLICT(version_id, key) DO UPDATE SET value=excluded.value,
   * created_at=excluded.created_at RETURNING id. Unlike ON CONFLICT DO NOTHING
   * (Pitfall #1), DO UPDATE completes normally — RETURNING always yields one row.
   */
  upsertMetadata(versionId: string, key: string, value: string): { id: string } {
    if (!this.versionRepo.getVersion(versionId)) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    const id = newId('meta');
    const now = Date.now();
    const returned = this.db
      .insert(metadata)
      .values({ id, version_id: versionId, key, value, created_at: now })
      .onConflictDoUpdate({
        target: [metadata.version_id, metadata.key],
        set: {
          value: sql`excluded.value`,
          created_at: sql`excluded.created_at`,
        },
      })
      .returning({ id: metadata.id })
      .all() as Array<{ id: string }>;
    // DO UPDATE RETURNING always emits one row (insert or update path) — no
    // fallback SELECT needed. On UPDATE path, returned[0].id is the EXISTING
    // row's id (not the fresh id generated above), satisfying INV-ASST-03.
    return { id: returned[0]!.id };
  }

  /**
   * Delete a metadata entry by (version_id, key). Idempotent per D-ASST-03:
   * calling on a missing key is a no-op (0 rows affected, no throw).
   *
   * Does NOT pre-check version existence — DELETE on a missing row is already
   * a no-op (INV-ASST-04), so the extra SELECT would be wasted I/O.
   */
  deleteMetadata(versionId: string, key: string): void {
    this.db
      .delete(metadata)
      .where(and(eq(metadata.version_id, versionId), eq(metadata.key, key)))
      .run();
  }

  /**
   * Return all metadata entries on a version, sorted ASC by key
   * (D-ASST-04 / D-ASST-19).
   *
   * Uses raw SQL via `this.db.$client.prepare` with
   * `json_group_array(json_object('key', key, 'value', value) ORDER BY key)` —
   * correlated subquery-style that renders empty sets as `[]` (NOT `[null]` —
   * RESEARCH Pitfall #2). Requires SQLite 3.44+ for ORDER BY in aggregates;
   * better-sqlite3 12.9.0 bundles 3.53.0.
   */
  listMetadataForVersion(versionId: string): MetadataKV[] {
    const row = this.db.$client
      .prepare(
        `SELECT json_group_array(json_object('key', key, 'value', value) ORDER BY key) AS metadata_json FROM metadata WHERE version_id = ?`,
      )
      .get(versionId) as { metadata_json: string } | undefined;
    return JSON.parse(row?.metadata_json ?? '[]') as MetadataKV[];
  }

  /**
   * Count metadata entries for a version. Supports engine cap enforcement
   * (D-ASST-11 — MAX_METADATA_PER_VERSION=100 pre-upsert check). TOCTOU race
   * accepted at demo scale (RESEARCH Pitfall #6).
   */
  countMetadataForVersion(versionId: string): number {
    const row = this.db
      .select({ c: sql<number>`COUNT(*)` })
      .from(metadata)
      .where(eq(metadata.version_id, versionId))
      .get();
    return Number(row?.c ?? 0);
  }

  /**
   * Scope-aware metadata-key aggregation (D-ASST-06, RESEARCH Operation 5).
   * Counts KEYS (not key+value pairs) — an artist filtering "what metadata
   * keys are used on my project's versions" wants key names as the axis.
   *
   * Returns `{ items: Array<{name, count}>, total_count }` — items ordered
   * `count DESC, name ASC`, total_count = COUNT(DISTINCT key) under the scope.
   *
   * Scope modes handled by buildScopeFragment (workspace / project / sequence /
   * shot / empty-global). Engine enforces XOR (D-ASST-13); repo is
   * defensive-only (T-04-02-05 mitigation).
   *
   * Wrapped in db.transaction() so items + total_count come from a snapshot-
   * consistent view (D-ASST-18, RESEARCH Pattern 5).
   */
  listMetadataKeysInScope(
    scope: ScopeFilter,
    limit: number,
    offset: number,
  ): { items: TagCount[]; total_count: number } {
    const { scopeJoins, scopeWhere, scopeParams } = buildScopeFragment(scope);
    const itemsSql = `
      SELECT m.key AS name, COUNT(*) AS count
      FROM metadata m
      INNER JOIN versions v ON v.id = m.version_id
      ${scopeJoins}
      ${scopeWhere}
      GROUP BY m.key
      ORDER BY count DESC, name ASC
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(DISTINCT m.key) AS n
      FROM metadata m
      INNER JOIN versions v ON v.id = m.version_id
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
