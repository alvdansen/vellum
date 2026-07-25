// AssetsEngine — Phase 4 core business logic.
//
// Owns ALL Phase 4 validation (tag/key regex + length caps, scope XOR, date
// range bounds, pagination defaults), AND-only filter SQL composition, raw-SQL
// hydration (tags + metadata inline), and repo delegation.
//
// Invariants (D-ASST-26 + Plan 04-03 acceptance):
//  - Zero MCP SDK imports — architecture purity test asserts this.
//  - Zero Zod imports — Zod defence-in-depth lives at the tool layer (Plan 04-04).
//    Engine validation is raw JavaScript: regex checks, length caps, XOR presence.
//  - Scope XOR enforced at engine boundary (D-ASST-13) — future non-MCP adapters
//    inherit the rule.
//  - AND-only filter composition (D-ASST-14). No OR / NOT / nested groups.
//  - Date range bounds inclusive on both ends (D-ASST-15).
//  - Pagination defaults applied here (D-ASST-18). Zod also caps in tool layer.
//  - Fixed ORDER BY versions.created_at DESC, versions.id DESC (D-ASST-16).
//
// Responsibility map (RESEARCH §Architectural Responsibility):
//  - Tool layer (Plan 04-04): Zod schema validation, envelope shaping, breadcrumb split.
//  - THIS LAYER: regex + caps + scope XOR + date range + pagination resolution +
//    AND filter composition + repo delegation + hydration.
//  - Repo layer (Plan 04-02): CRUD mutators (idempotent insert, upsert, delete),
//    per-version tag/metadata queries, scope-aware aggregation.

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteClient } from 'better-sqlite3';
import type * as schema from '../store/schema.js';
import type { TagRepo } from '../store/tag-repo.js';
import type { MetadataRepo } from '../store/metadata-repo.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { BreadcrumbResolver } from './breadcrumb.js';
import type {
  AssetsQueryFilter,
  VersionWithAssets,
  TagCount,
  ScopeFilter,
  MetadataKV,
} from '../types/assets.js';
import type { Version, Breadcrumb } from '../types/hierarchy.js';
import { TypedError } from './errors.js';
import { versionLabel } from '../utils/outputs.js';
import {
  MAX_TAG_LENGTH,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
  MAX_TAGS_PER_VERSION,
  MAX_METADATA_PER_VERSION,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  TAG_REGEX,
} from '../tools/shape.js';

/** Widened Db type — drizzle() factory returns the $client intersection. */
type Db = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

/** Mutation response shape (D-ASST-04) — entity with inline tags + metadata + breadcrumb. */
export type AssetMutationResponse = {
  entity: VersionWithAssets & { version_label: string };
  breadcrumb: Breadcrumb;
};

/** Paginated scope input (listTags / listMetadataKeys). */
type ScopeFilterWithPage = ScopeFilter & {
  limit: number | undefined;
  offset: number | undefined;
};

/** Response for listTags / listMetadataKeys (D-ASST-06). */
export type TagListResponse = {
  items: TagCount[];
  total_count: number;
  limit: number;
  offset: number;
  scope: ScopeFilter;
};

/** Response for queryAssets (D-ASST-05). */
export type QueryResponse = {
  items: (VersionWithAssets & { version_label: string; breadcrumb: Breadcrumb })[];
  total_count: number;
  limit: number;
  offset: number;
};

// ================================================================
// Module-local validation helpers (not exported from AssetsEngine).
// Defence in depth: Plan 04-04 Zod also validates the same inputs.
// ================================================================

/**
 * D-ASST-11 tag validation: 1..MAX_TAG_LENGTH chars, TAG_REGEX match.
 * Whitespace is special-cased for a better hint (RESEARCH Pitfall #7).
 */
function validateTag(tag: string): void {
  if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) {
    throw new TypedError(
      'TAG_INVALID',
      `Tag '${tag}' length ${tag.length} exceeds allowed range 1..${MAX_TAG_LENGTH}`,
      `Tag must be 1..${MAX_TAG_LENGTH} characters`,
    );
  }
  if (/\s/.test(tag)) {
    throw new TypedError(
      'TAG_INVALID',
      `Tag '${tag}' contains whitespace`,
      `Tags cannot contain spaces — use underscores or dashes (e.g., 'hero_shot', 'v-001')`,
    );
  }
  if (!TAG_REGEX.test(tag)) {
    throw new TypedError(
      'TAG_INVALID',
      `Tag '${tag}' contains characters outside the allowed set`,
      `Tags must match ^[A-Za-z0-9_\\-.:]+$ — letters, digits, underscore, dash, dot, colon only`,
    );
  }
}

/** D-ASST-11 metadata key validation — same regex + length as tags but different error code. */
function validateMetadataKey(key: string): void {
  if (key.length === 0 || key.length > MAX_METADATA_KEY_LENGTH) {
    throw new TypedError(
      'METADATA_INVALID',
      `Metadata key '${key}' length ${key.length} exceeds allowed range 1..${MAX_METADATA_KEY_LENGTH}`,
      `Key must be 1..${MAX_METADATA_KEY_LENGTH} characters`,
    );
  }
  if (/\s/.test(key)) {
    throw new TypedError(
      'METADATA_INVALID',
      `Metadata key '${key}' contains whitespace`,
      `Keys cannot contain spaces — use underscores or dashes`,
    );
  }
  if (!TAG_REGEX.test(key)) {
    throw new TypedError(
      'METADATA_INVALID',
      `Metadata key '${key}' contains characters outside the allowed set`,
      `Keys must match ^[A-Za-z0-9_\\-.:]+$ — letters, digits, underscore, dash, dot, colon only`,
    );
  }
}

/**
 * D-ASST-11 metadata value: non-empty, ≤ MAX_METADATA_VALUE_LENGTH.
 * Value is NOT interpolated into error messages (D-ASST-25 info-disclosure mitigation —
 * only the key is cited; see T-04-03-03).
 */
function validateMetadataValue(key: string, value: string): void {
  if (value.length === 0) {
    throw new TypedError(
      'METADATA_INVALID',
      `Metadata value for key '${key}' is empty`,
      `Provide a non-empty value`,
    );
  }
  if (value.length > MAX_METADATA_VALUE_LENGTH) {
    throw new TypedError(
      'METADATA_INVALID',
      `Metadata value for key '${key}' exceeds ${MAX_METADATA_VALUE_LENGTH} chars`,
      `Trim the value or store it out-of-band`,
    );
  }
}

/**
 * D-ASST-13 scope XOR — exactly 0 or 1 of the four scope fields may be set.
 * Engine-boundary check so any future non-MCP adapter inherits the rule.
 */
function validateScopeXor(scope: ScopeFilter): void {
  const present: string[] = [];
  if (scope.workspace_id) present.push('workspace_id');
  if (scope.project_id) present.push('project_id');
  if (scope.sequence_id) present.push('sequence_id');
  if (scope.shot_id) present.push('shot_id');
  if (present.length > 1) {
    throw new TypedError(
      'INVALID_SCOPE',
      `asset.query accepts at most one of workspace_id|project_id|sequence_id|shot_id — received [${present.join(', ')}]`,
      `Remove all but one scope field from the request`,
    );
  }
}

/**
 * D-ASST-18 pagination: limit default 20, cap MAX_PAGE_SIZE=100; offset default 0, min 0.
 * Tool layer (Plan 04-04) also caps via Zod; this is defence-in-depth.
 */
function resolvePagination(
  limit: number | undefined,
  offset: number | undefined,
): { limit: number; offset: number } {
  const l = limit === undefined ? DEFAULT_PAGE_SIZE : Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
  const o = offset === undefined ? 0 : Math.max(0, offset);
  return { limit: l, offset: o };
}

/**
 * buildQuery — RESEARCH §Pattern 3 verbatim. Composes AssetsQueryFilter into two
 * parameterized SQL strings (items + count) sharing whereParams. AND-only; never
 * OR. Scope JOIN variants per buildScopeFragment shape (identical to tag-repo /
 * metadata-repo helpers but kept module-local to avoid cross-layer coupling).
 *
 * Security anchors (T-04-03-01 mitigation):
 *  - Every user-derived field binds via `?` placeholder.
 *  - Tag array + metadata array round-trip through `json_each(?)` — SQLite's own
 *    JSON parser; injection-impossible.
 *  - No string concatenation of user input into SQL text.
 */
function buildQuery(f: AssetsQueryFilter): {
  itemsSql: string;
  countSql: string;
  whereParams: unknown[];
} {
  const where: string[] = [];
  const params: unknown[] = [];
  const joins: string[] = [];

  // Scope — XOR enforced upstream; buildQuery trusts at-most-one field set.
  if (f.workspace_id) {
    joins.push('INNER JOIN shots sh ON sh.id = v.shot_id');
    joins.push('INNER JOIN sequences sq ON sq.id = sh.sequence_id');
    joins.push('INNER JOIN projects p ON p.id = sq.project_id');
    where.push('p.workspace_id = ?');
    params.push(f.workspace_id);
  } else if (f.project_id) {
    joins.push('INNER JOIN shots sh ON sh.id = v.shot_id');
    joins.push('INNER JOIN sequences sq ON sq.id = sh.sequence_id');
    where.push('sq.project_id = ?');
    params.push(f.project_id);
  } else if (f.sequence_id) {
    joins.push('INNER JOIN shots sh ON sh.id = v.shot_id');
    where.push('sh.sequence_id = ?');
    params.push(f.sequence_id);
  } else if (f.shot_id) {
    where.push('v.shot_id = ?');
    params.push(f.shot_id);
  }

  // D-ASST-17 status filter (uses idx_versions_status per EQP)
  if (f.status) {
    where.push('v.status = ?');
    params.push(f.status);
  }

  // D-ASST-15 date range — inclusive on both ends.
  if (f.date_from !== undefined) {
    where.push('v.created_at >= ?');
    params.push(f.date_from);
  }
  if (f.date_to !== undefined) {
    where.push('v.created_at <= ?');
    params.push(f.date_to);
  }

  // D-ASST-14 tags AND — RESEARCH Pattern 1 (json_each + HAVING COUNT)
  if (f.tags && f.tags.length > 0) {
    where.push(
      `v.id IN (
         SELECT version_id FROM tags
         WHERE tag IN (SELECT value FROM json_each(?))
         GROUP BY version_id HAVING COUNT(DISTINCT tag) = ?
       )`,
    );
    params.push(JSON.stringify(f.tags), f.tags.length);
  }

  // D-ASST-14 metadata AND — RESEARCH Pattern 2 (composite (key,value) pairs)
  if (f.metadata && f.metadata.length > 0) {
    where.push(
      `v.id IN (
         SELECT version_id FROM metadata
         WHERE (key, value) IN (
           SELECT json_extract(value, '$.key'), json_extract(value, '$.value')
           FROM json_each(?)
         )
         GROUP BY version_id HAVING COUNT(*) = ?
       )`,
    );
    params.push(JSON.stringify(f.metadata), f.metadata.length);
  }

  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const joinSql = joins.join('\n      ');

  // RESEARCH §Pattern 4 correlated subqueries render empty tag/metadata sets as []
  // (not [null]) — Pitfall #2. ORDER BY in json_group_array requires SQLite ≥ 3.44
  // (better-sqlite3 12.x bundles 3.53+, so safe).
  const itemsSql = `
    SELECT
      v.*,
      (SELECT json_group_array(tag ORDER BY tag)
       FROM tags WHERE version_id = v.id) AS tags_json,
      (SELECT json_group_array(json_object('key', key, 'value', value) ORDER BY key)
       FROM metadata WHERE version_id = v.id) AS metadata_json
    FROM versions v
    ${joinSql}
    ${whereSql}
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT ? OFFSET ?
  `;

  const countSql = `
    SELECT COUNT(*) AS n
    FROM versions v
    ${joinSql}
    ${whereSql}
  `;

  return { itemsSql, countSql, whereParams: params };
}

// ================================================================
// AssetsEngine
// ================================================================

/**
 * AssetsEngine — Phase 4 business logic for tag + metadata mutations + asset.query
 * + list_tags / list_metadata_keys + hydrateVersionWithAssets.
 *
 * All seven asset operations plus the hydration helper live here. Engine facade
 * (src/engine/pipeline.ts) composes an instance + delegates via one-line methods.
 *
 * Architecture-purity invariants:
 *  - Zero MCP SDK imports (D-33, D-ASST-26, D-ASST-29) — enforced by grep-based
 *    architecture-purity.test.ts.
 *  - Zero zod imports — raw-JS validation (defence-in-depth with Plan 04-04 Zod).
 *  - Delegates to injected TagRepo, MetadataRepo, VersionRepo, BreadcrumbResolver.
 *  - Raw SQL only for queryAssets + hydrateVersionWithAssets (drizzle builder is
 *    too restrictive for correlated-subquery aggregation).
 */
export class AssetsEngine {
  constructor(
    private db: Db,
    private tagRepo: TagRepo,
    private metadataRepo: MetadataRepo,
    private versionRepo: VersionRepo,
    private breadcrumb: BreadcrumbResolver,
  ) {}

  /**
   * Add a tag to a version. Idempotent (D-ASST-03): re-adding a tag is a no-op
   * on the row count; entity.tags still includes that tag exactly once.
   *
   * Validates tag regex + length + MAX_TAGS_PER_VERSION cap BEFORE repo call
   * (D-ASST-11). Cap check uses countTagsForVersion pre-insert; TOCTOU race
   * accepted at demo scale per RESEARCH Pitfall #6.
   */
  addTag(versionId: string, tag: string): AssetMutationResponse {
    validateTag(tag);
    const currentCount = this.tagRepo.countTagsForVersion(versionId);
    if (currentCount >= MAX_TAGS_PER_VERSION) {
      throw new TypedError(
        'TAG_LIMIT_EXCEEDED',
        `Version '${versionId}' already has ${MAX_TAGS_PER_VERSION} tags (max). Remove one before adding.`,
        `Remove an existing tag with { tool: 'asset', action: 'remove_tag', version_id, tag }`,
      );
    }
    // insertTag pre-checks VERSION_NOT_FOUND internally (RESEARCH Pitfall #3).
    this.tagRepo.insertTag(versionId, tag);
    return this.buildMutationResponse(versionId);
  }

  /**
   * Remove a tag from a version. Idempotent (D-ASST-03): missing tag is a no-op.
   * No regex check on the tag (removing an invalid tag is harmless).
   *
   * Pre-checks version existence so the response contract (D-ASST-04 refreshed
   * entity) can be honored — a deleted-then-missing version can't return tags+metadata.
   */
  removeTag(versionId: string, tag: string): AssetMutationResponse {
    if (!this.versionRepo.getVersion(versionId)) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    this.tagRepo.deleteTag(versionId, tag);
    return this.buildMutationResponse(versionId);
  }

  /**
   * Set (upsert) a metadata entry on a version. Second call with same key
   * replaces the value (D-ASST-03 + D-ASST-08). Cap + regex + value-length
   * enforced pre-upsert.
   */
  setMetadata(versionId: string, key: string, value: string): AssetMutationResponse {
    validateMetadataKey(key);
    validateMetadataValue(key, value);
    // Cap applies only when inserting a NEW key; upserting an existing key is
    // free. Pre-check via countMetadataForVersion + existence-lookup would
    // double-query — but a simple "would this be a new key?" check is to see
    // if the count would cross the cap post-upsert. At demo scale, the
    // conservative cap-pre-check (count >= cap without distinguishing insert
    // vs update) is acceptable when over cap; however to avoid blocking upserts
    // on an existing key when already at cap, we check listMetadataForVersion
    // for the key presence. Simpler: count + check if key already exists.
    const currentCount = this.metadataRepo.countMetadataForVersion(versionId);
    if (currentCount >= MAX_METADATA_PER_VERSION) {
      // Check whether this key is already present (upsert path = free, insert
      // path = rejected). listMetadataForVersion is cheap (indexed per-version).
      const existing = this.metadataRepo.listMetadataForVersion(versionId);
      const alreadyPresent = existing.some((m) => m.key === key);
      if (!alreadyPresent) {
        throw new TypedError(
          'METADATA_LIMIT_EXCEEDED',
          `Version '${versionId}' already has ${MAX_METADATA_PER_VERSION} metadata entries (max). Remove one before adding.`,
          `Remove an existing key with { tool: 'asset', action: 'remove_metadata', version_id, key }`,
        );
      }
    }
    // upsertMetadata pre-checks VERSION_NOT_FOUND internally (RESEARCH Pitfall #3).
    this.metadataRepo.upsertMetadata(versionId, key, value);
    return this.buildMutationResponse(versionId);
  }

  /**
   * Remove a metadata entry. Idempotent (D-ASST-03): missing key is a no-op.
   * No regex check on the key. Pre-checks version existence for the response contract.
   */
  removeMetadata(versionId: string, key: string): AssetMutationResponse {
    if (!this.versionRepo.getVersion(versionId)) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    this.metadataRepo.deleteMetadata(versionId, key);
    return this.buildMutationResponse(versionId);
  }

  /**
   * asset.query — AND-only cross-hierarchy filter (D-ASST-12..18).
   *
   * Engine responsibilities:
   *  - D-ASST-13 scope XOR validation.
   *  - D-ASST-15 date range bounds rejection (date_from > date_to → INVALID_INPUT).
   *  - D-ASST-14 tags + metadata AND within each field + across fields.
   *  - D-ASST-16 fixed ORDER BY created_at DESC, id DESC.
   *  - D-ASST-18 pagination: count + paged SELECT wrapped in db.transaction()
   *    for snapshot-consistent total_count (RESEARCH Pattern 5).
   *  - D-ASST-22 hydration: every item gets tags + metadata inline.
   *
   * Defence-in-depth (Plan 04-04 Zod also caps): tags[] ≤ 20, metadata[] ≤ 20,
   * each tag + metadata key validated against TAG_REGEX.
   */
  queryAssets(filter: AssetsQueryFilter): QueryResponse {
    validateScopeXor(filter);

    // D-ASST-15: date range validation
    if (
      filter.date_from !== undefined &&
      filter.date_to !== undefined &&
      filter.date_from > filter.date_to
    ) {
      throw new TypedError(
        'INVALID_INPUT',
        `date_from (${filter.date_from}) must be <= date_to (${filter.date_to})`,
        `date_from must be <= date_to`,
      );
    }

    // D-ASST-12: tag array + metadata array cap (max 20 each) — Zod in tool
    // layer also caps, this is defence-in-depth (T-04-03-04 DoS mitigation).
    if (filter.tags && filter.tags.length > 20) {
      throw new TypedError(
        'INVALID_INPUT',
        `tags array length ${filter.tags.length} exceeds 20`,
        `Supply at most 20 tags per query`,
      );
    }
    if (filter.metadata && filter.metadata.length > 20) {
      throw new TypedError(
        'INVALID_INPUT',
        `metadata array length ${filter.metadata.length} exceeds 20`,
        `Supply at most 20 metadata entries per query`,
      );
    }

    // Validate each tag + metadata key against regex (defence-in-depth).
    for (const t of filter.tags ?? []) {
      validateTag(t);
    }
    for (const kv of filter.metadata ?? []) {
      validateMetadataKey(kv.key);
      validateMetadataValue(kv.key, kv.value);
    }

    const { itemsSql, countSql, whereParams } = buildQuery(filter);

    // Pattern 5: both queries share the same transaction so total_count matches
    // the paged state under concurrent writes (WAL snapshot isolation).
    return this.db.transaction(() => {
      const rawRows = this.db.$client
        .prepare(itemsSql)
        .all(...whereParams, filter.limit, filter.offset) as Array<
        Version & { tags_json: string; metadata_json: string }
      >;
      const countRow = this.db.$client.prepare(countSql).get(...whereParams) as {
        n: number;
      };
      const items = rawRows.map((r) => {
        const { tags_json, metadata_json, ...version } = r;
        const tags = JSON.parse(tags_json ?? '[]') as string[];
        const metadata = JSON.parse(metadata_json ?? '[]') as MetadataKV[];
        const crumb = this.breadcrumb.resolve('version', version.id);
        return {
          ...version,
          version_label: versionLabel(version.version_number),
          tags,
          metadata,
          breadcrumb: crumb,
        };
      });
      return {
        items,
        total_count: Number(countRow.n),
        limit: filter.limit,
        offset: filter.offset,
      };
    });
  }

  /**
   * asset.list_tags — scope-aware aggregation (D-ASST-06).
   *
   * Delegates to TagRepo.listTagsInScope after scope XOR + pagination resolution.
   * Response echoes the scope (D-ASST-06 clarity) so the agent can verify the
   * intended scope was used.
   */
  listTags(scope: ScopeFilterWithPage): TagListResponse {
    validateScopeXor(scope);
    const { limit, offset } = resolvePagination(scope.limit, scope.offset);
    const scopeFilter: ScopeFilter = {
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
      sequence_id: scope.sequence_id,
      shot_id: scope.shot_id,
    };
    const result = this.tagRepo.listTagsInScope(scopeFilter, limit, offset);
    return {
      items: result.items,
      total_count: result.total_count,
      limit,
      offset,
      scope: scopeFilter,
    };
  }

  /**
   * asset.list_metadata_keys — same shape as listTags but aggregating by key
   * (not key+value — D-ASST-06). Delegates to MetadataRepo.listMetadataKeysInScope.
   */
  listMetadataKeys(scope: ScopeFilterWithPage): TagListResponse {
    validateScopeXor(scope);
    const { limit, offset } = resolvePagination(scope.limit, scope.offset);
    const scopeFilter: ScopeFilter = {
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
      sequence_id: scope.sequence_id,
      shot_id: scope.shot_id,
    };
    const result = this.metadataRepo.listMetadataKeysInScope(scopeFilter, limit, offset);
    return {
      items: result.items,
      total_count: result.total_count,
      limit,
      offset,
      scope: scopeFilter,
    };
  }

  /**
   * D-ASST-19: return a Version entity extended with tags: string[] and
   * metadata: MetadataKV[]. Tags ASC alphabetical; metadata ASC by key.
   * Empty sets render as [] (RESEARCH Pitfall #2).
   *
   * Public so pipeline.ts can call it from getVersion / listVersionsForShot.
   * Exported helper for Plan 04-05 reuse.
   *
   * Single raw-SQL query with two correlated subqueries (RESEARCH Pattern 4 /
   * Operation 3) — cheaper than two repo calls.
   */
  hydrateVersionWithAssets(version: Version): VersionWithAssets {
    const row = this.db.$client
      .prepare(
        `SELECT
          (SELECT json_group_array(tag ORDER BY tag)
           FROM tags WHERE version_id = ?) AS tags_json,
          (SELECT json_group_array(json_object('key', key, 'value', value) ORDER BY key)
           FROM metadata WHERE version_id = ?) AS metadata_json`,
      )
      .get(version.id, version.id) as { tags_json: string; metadata_json: string };
    return {
      ...version,
      tags: JSON.parse(row.tags_json ?? '[]') as string[],
      metadata: JSON.parse(row.metadata_json ?? '[]') as MetadataKV[],
    };
  }

  /**
   * Private helper: rebuild the mutation response after tagRepo/metadataRepo
   * writes. Runs a fresh getVersion (to pick up any concurrent changes) + the
   * hydrate helper + breadcrumb resolution.
   */
  private buildMutationResponse(versionId: string): AssetMutationResponse {
    const version = this.versionRepo.getVersion(versionId);
    if (!version) {
      // Should not happen in normal flow (repo pre-check caught VERSION_NOT_FOUND).
      // Defence-in-depth only — if a row vanished between repo call and this
      // re-read (impossible in single-process demo scale), surface cleanly.
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    const withAssets = this.hydrateVersionWithAssets(version);
    return {
      entity: {
        ...withAssets,
        version_label: versionLabel(version.version_number),
      },
      breadcrumb: this.breadcrumb.resolve('version', versionId),
    };
  }
}
