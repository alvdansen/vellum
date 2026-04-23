# Phase 4: Asset Management - Research

**Researched:** 2026-04-22
**Domain:** SQLite tag/metadata CRUD + cross-hierarchy AND-filtered pagination over versions
**Confidence:** HIGH (every recommendation is validated against the real stack via `EXPLAIN QUERY PLAN` and timing benchmarks; SQLite feature availability confirmed against the bundled version in `better-sqlite3` 12.9.0).

## Summary

Phase 4 is a pure-TypeScript / SQLite extension of Phase 3 — zero new dependencies, zero new external APIs. CONTEXT.md locks 33 decisions covering the tool surface, table shapes, filter semantics, response shapes, and error codes. The only research-sensitive items are **implementation-shape choices** for SQL patterns and validation strategy, all explicitly marked "Claude's Discretion".

The research findings are load-bearing for four open choices:

1. **AND-filter SQL shape** — RECOMMEND `IN (SELECT value FROM json_each(?))` + `GROUP BY version_id HAVING COUNT(DISTINCT tag) = ?` for multi-tag AND. It uses a **single, cacheable prepared statement** regardless of N, binds the array as one parameter (zero SQL-injection risk from string concat), still hits `idx_tags_tag` per `EXPLAIN QUERY PLAN`, and is only ~2x slower than INNER JOIN at 5k/25k scale — still <2ms/call, a rounding error at demo scale. EXISTS chains are the second-best option if the planner prefers a more literal translation but requires dynamic SQL construction.

2. **Version hydration (`hydrateVersionWithAssets`, `version.list include_tags`)** — RECOMMEND correlated-subquery with `json_group_array(x ORDER BY x)` rather than LEFT JOIN + GROUP BY. Correlated subquery (a) produces clean empty `[]` for zero-tag versions (LEFT JOIN returns `[null]` without FILTER), (b) preserves alphabetical ORDER BY inside the aggregate (D-ASST-04 satisfied), (c) executes only for the 20 rows that pass `LIMIT` (not every row in the shot). SQLite 3.44+ supports `ORDER BY` in aggregates — `better-sqlite3` 12.9.0 ships SQLite 3.53.0 so we're safe.

3. **COUNT strategy** — RECOMMEND a separate `SELECT COUNT(*)` with the same WHERE clause, wrapped with the paged SELECT inside a `db.transaction()` block. The separate count is simpler, reuses the prepared WHERE fragment via Drizzle parameter binding, and the transaction wrapper gives snapshot isolation so `total_count` matches the paged state exactly (D-ASST-18). Window-function `COUNT(*) OVER()` adds a CO-ROUTINE in EQP and is harder to reason about when composed with Drizzle.

4. **Scope resolver** — CONFIRMED: `src/store/hierarchy-repo.ts` has NO existing scope-to-shots walker. Phase 4 adds one. The JOIN through `shots → sequences → projects` is trivially covered by the existing `sqlite_autoindex_*_1` primary-key indexes — no new indexes needed on the hierarchy side. The query compiles to 3–4 seeks by primary key (see Worked Examples below), so the scope filter is essentially free at demo scale.

Plus:
- **`better-sqlite3` 12.9.0 ships SQLite 3.53.0** — `json_group_array(x ORDER BY y)`, `RETURNING` on upserts, and `ON CONFLICT DO NOTHING RETURNING` all work.
- **FK violations on tag insert** surface as `SQLITE_CONSTRAINT_FOREIGNKEY` — distinct from UNIQUE. The project's established pattern (see `hierarchy-repo.ts:99`) is to **pre-check parent existence** and throw `VERSION_NOT_FOUND` explicitly rather than catching the FK error — mirror this for `tag-repo`/`metadata-repo`.
- **`INSERT ... ON CONFLICT DO NOTHING`** can cause SQLite to silently rollback an enclosing transaction (confirmed via Context7 / better-sqlite3 docs). Do NOT wrap `add_tag` in an explicit transaction — the single INSERT is atomic. This is different from `set_metadata` (DO UPDATE) which completes normally.

**Primary recommendation for the planner:** Build `asset-tool.ts` as a 7-action discriminated union mirroring `generation-tool.ts`. Route every mutation + query through a new `src/engine/assets.ts` module composed into the existing `Engine` facade. Put scope-expansion SQL directly in `tag-repo.ts` / `metadata-repo.ts` (they need it for `list_tags` aggregation anyway) with a shared helper function, rather than adding a reusable walker to `hierarchy-repo.ts` — keeps the Phase 4 footprint tight and avoids touching hot-path Phase 1/2/3 files.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tag/metadata input validation (Zod) | Tool layer (`src/tools/asset-tool.ts`) | — | D-33 tool-engine separation; Zod runs at tool boundary (D-05); caps + regex enforced in `shape.ts` constants. |
| Scope XOR check | Engine (`src/engine/assets.ts`) | — | D-ASST-13: locked at engine boundary so future non-MCP adapters inherit the rule. |
| Tag/key regex + length caps | Engine (validation) + Tool (Zod) | — | Defence-in-depth per D-07 precedent: tool Zod rejects early, engine re-checks authoritatively. |
| MAX_TAGS_PER_VERSION / MAX_METADATA limit | Engine (via repo `count*ForVersion`) | — | D-ASST-11: SELECT COUNT → compare → INSERT or reject. Acceptable at demo scale (TOCTOU race accepted — see Pitfall 6 below). |
| AND-only filter SQL | Repo (`tag-repo` / `metadata-repo`) | Engine (filter composition) | Engine builds the filter descriptor; repo executes one prepared statement per shape. |
| Breadcrumb resolution | Engine (`BreadcrumbResolver` — existing) | — | D-35: resolver is the single authority; Phase 4 reuses the existing `'version'` leaf. |
| Pagination (`{items, total_count, limit, offset}`) | Tool layer (`shapeList` helper) | Repo (LIMIT/OFFSET + COUNT) | D-24 envelope locked by Phase 1; repo computes count+items inside one transaction for consistency. |
| Response envelope (dual-form, breadcrumb) | Tool layer (`toolOk` / `shapeList`) | — | D-25 locked; Phase 4 is envelope-consumer, not envelope-modifier. |
| Error wrapping (TypedError → `{isError, code, message, hint}`) | Tool boundary (`toolError`) | Engine (throws TypedError only) | D-28..D-32 locked; Phase 4 adds 5 new codes to the `ErrorCode` union. |
| Architecture-purity enforcement | Test (`src/__tests__/architecture-purity.test.ts`) | — | Extends existing grep; new repos/engine files MUST have zero MCP imports. |

## Standard Stack

### Core (no changes — Phase 4 uses the Phase 1/2/3 stack verbatim)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^12.9.0 [VERIFIED: package.json] | SQLite driver | Bundles SQLite 3.53.0 [VERIFIED: `sqlite_version()` query] — JSON1, FTS5, RETURNING, and `ORDER BY` in aggregates all available. WAL already enabled by `src/store/db.ts`. |
| `drizzle-orm` | ^0.45.2 [VERIFIED: package.json] | Query builder | `sqliteTable` with composite `unique()` + `index()` matches the Phase 4 table shapes verbatim [CITED: drizzle-team/drizzle-orm-docs, `onConflictDoUpdate` with composite target]. |
| `zod` | ^4.3.6 [VERIFIED: package.json] | Tool-input validation | Discriminated union on `action` matches D-ASST-02; regex + caps land as Zod string refinements. |
| `nanoid` | ^5.1.9 [VERIFIED: package.json] | ID generation | `tag_` / `meta_` prefixes follow the Phase 1 D-11 pattern; existing `src/utils/id.ts:newId(prefix)` accepts new prefix literals. |

### Supporting (already installed, reused unchanged)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 [VERIFIED] | MCP tool registration | `asset-tool.ts` uses `server.registerTool('asset', …)` exactly like `version-tool.ts`. |
| `vitest` | ^4.1.4 [VERIFIED] | Test runner | All seven D-ASST-33 test layers run under `npx vitest`. |

### Alternatives Considered and Rejected

| Instead of | Could Use | Rejected Because |
|------------|-----------|------------------|
| `json_each(?)` parameterization | Dynamic `?,?,?,?` placeholder string | Forces a fresh prepared statement for every N; cache churn on a hot path. `json_each` keeps a single cacheable statement. |
| Correlated subquery hydration | `LEFT JOIN tags GROUP BY v.id` | Returns `[null]` for empty tag sets without `FILTER (WHERE tag IS NOT NULL)`; forces GROUP BY on every column; evaluates aggregate on ALL versions before LIMIT (not the LIMIT 20 subset). |
| Separate `SELECT COUNT(*)` | `COUNT(*) OVER ()` window function | Window function adds a `CO-ROUTINE` in the query plan and composes awkwardly with Drizzle; separate count is simpler and still consistent under transaction snapshot. |
| Engine-side scope walker in `hierarchy-repo.ts` | Inline JOIN in `tag-repo` / `metadata-repo` | Adding a general-purpose walker inflates `hierarchy-repo` (hot-path file). The scope JOIN is 3–4 lines in the two Phase 4 repos — cheaper to duplicate than to abstract. |
| `fast-json-patch` or any diff library | Hand-rolled merge logic | Not applicable to Phase 4 (no diff); listed only to confirm STACK.md's "no new deps" stance. |
| FTS5 virtual tables | LIKE or full-text | Deferred per CONTEXT.md. Phase 4 uses exact match only; D-ASST-09's `idx_metadata_key_value(key, value)` covers the common `(artist, 'tim')` lookup. |

**Installation:**
```bash
# Phase 4 adds NO new dependencies.
# The only npm step is running tests: npm test
```

**Version verification [VERIFIED 2026-04-22]:**
```bash
$ node -e "const db=new (require('better-sqlite3'))(':memory:'); console.log(db.prepare('SELECT sqlite_version() AS v').get().v);"
# → 3.53.0  (requires >= 3.44 for json_group_array ORDER BY; requires >= 3.35 for RETURNING — both met)
```

## Architecture Patterns

### System Architecture Diagram

```
Agent (MCP client)
        │
        │ tools/call  { name: 'asset', arguments: { action, … } }
        ▼
╔═══════════════════════════════════════════════════════════════════╗
║ src/tools/asset-tool.ts                            (TOOL LAYER)   ║
║ ────────────────────────────────                                  ║
║  • Zod discriminated union on `action` (7 branches)               ║
║  • Enforces tag/key regex + length caps (early rejection)         ║
║  • Catches ZodError → re-wraps INVALID_INPUT (D-32)               ║
║  • Calls engine method per branch (one call, no logic)            ║
║  • Emits dual-form envelope via toolOk() / toolError()            ║
╚═══════════════════════════════════════════════════════════════════╝
        │
        │  (pure TS call — zero MCP below this line per D-33)
        ▼
╔═══════════════════════════════════════════════════════════════════╗
║ src/engine/assets.ts                           (ENGINE LAYER)     ║
║ ────────────────────────────────                                  ║
║  • Scope XOR check (D-ASST-13) — rejects INVALID_SCOPE            ║
║  • Re-validates caps + regex (defence in depth)                   ║
║  • Enforces MAX_TAGS_PER_VERSION via tag-repo.countForVersion     ║
║  • Composes filter descriptors → passes to repos                  ║
║  • Hydrates version entities with tags + metadata                 ║
║  • Returns {entity, breadcrumb} or {items,total,limit,offset}     ║
╚═══════════════════════════════════════════════════════════════════╝
        │                                     │
        ▼                                     ▼
╔═══════════════════╗                ╔═══════════════════════════╗
║ src/store/        ║                ║ src/engine/breadcrumb.ts  ║
║  tag-repo.ts      ║                ║   BreadcrumbResolver      ║
║  metadata-repo.ts ║                ║   (existing — no change)  ║
║ ─────────────────╣                ╚═══════════════════════════╝
║  • prepared stmts ║                  (resolves 'version' leaf,
║  • json_each      ║                   Phase 2 D-GEN-05 already
║    param binding  ║                   covers this)
║  • correlated     ║
║    subquery       ║
║    hydration      ║
║  • scope-JOIN SQL ║
║    to hierarchy   ║
║    (versions→     ║
║     shots→seqs→   ║
║     projects)     ║
╚═══════════════════╝
        │
        ▼
   SQLite (WAL mode, busy_timeout=5000)
   Tables: versions, shots, sequences, projects, workspaces (Phase 1),
           provenance (Phase 3), tags + metadata (Phase 4 NEW)
```

### Recommended Project Structure (Phase 4 additions)

```
src/
├── engine/
│   └── assets.ts                        # NEW — validation, scope XOR, AND-only filter composition,
│                                        #       hydrateVersionWithAssets, list* aggregations
├── store/
│   ├── tag-repo.ts                      # NEW — insertTag (idempotent), deleteTag (idempotent),
│   │                                    #       listTagsForVersion, listTagsInScope, countForVersion,
│   │                                    #       queryVersionsByFilter helpers
│   └── metadata-repo.ts                 # NEW — upsertMetadata, deleteMetadata (idempotent),
│                                        #       listMetadataForVersion, listMetadataKeysInScope,
│                                        #       countForVersion, queryVersionsByFilter helpers
├── tools/
│   ├── asset-tool.ts                    # NEW — 7-action discriminated Zod union, thin delegate
│   ├── shape.ts                         # EXTEND — add MAX_TAG_LENGTH, MAX_METADATA_*, TAG_REGEX
│   └── version-tool.ts                  # EXTEND — get() always hydrates, list() with include_tags/include_metadata
├── types/
│   ├── hierarchy.ts                     # EXTEND — Version grows optional `tags`/`metadata`; VersionWithAssets type
│   └── assets.ts                        # NEW (optional, can fold into hierarchy.ts) — Tag, MetadataEntry,
│                                        #   AssetsQueryFilter, AssetsQueryResult, TagCount, MetadataKeyCount
drizzle/
└── 0004_phase4_assets.sql               # NEW — CREATE TABLE tags + metadata + 2 indexes
```

### Pattern 1: AND-Only Filter via `json_each` + `GROUP BY HAVING COUNT`

**What:** A single cacheable prepared statement that handles N tags in AND semantics by binding the array as a JSON string.

**When to use:** `asset.query.tags` filter (and identically structured `asset.query.metadata` AND filter).

**Example (validated via `EXPLAIN QUERY PLAN`):**
```sql
-- Source: VERIFIED against better-sqlite3 12.9.0 / SQLite 3.53.0 (in-memory seed, 5k versions, 25k tags)
SELECT v.id
FROM versions v
WHERE v.id IN (
  SELECT version_id
  FROM tags
  WHERE tag IN (SELECT value FROM json_each(?))
  GROUP BY version_id
  HAVING COUNT(DISTINCT tag) = ?
)
ORDER BY v.created_at DESC, v.id DESC
LIMIT ? OFFSET ?
```

**Parameters bound (in order):**
1. `JSON.stringify(tags)` — e.g. `'["hero","final"]'`
2. `tags.length` — e.g. `2`
3. `limit`, `offset`

**Why this shape wins:**
- **Cacheable**: SQL text is constant; `db.prepare()` can be called once at repo-init time. [VERIFIED: EQP shows stable plan across different tag array lengths.]
- **Index-using**: plan shows `SEARCH tags USING INDEX idx_tags_tag (tag=?)` — `json_each` output feeds the existing index per element. [VERIFIED: EQP output above.]
- **No string concat with user input**: the tag array round-trips through `json_each` (SQLite's own parser) — SQL injection is impossible. [CITED: https://www.sqlite.org/json1.html#jeach]
- **Handles N = 1..20** (D-ASST-12 tag array max): no SQL change required for any N in range.

**Timing at realistic scale (5k versions, 25k tag rows, 20-row page):**
- `json_each` pattern: **1.04 ms/call** (2 tags) / **1.12 ms/call** (3 tags) [VERIFIED: benchmark above]
- EXISTS chain: 0.85 ms / 0.85 ms [slightly faster but requires dynamic SQL]
- INNER JOIN: 0.42 ms [fastest; requires dynamic SQL AND fresh prepare per N]

At demo scale the 2x difference (~0.6ms) is irrelevant. Maintainability and injection-safety win.

### Pattern 2: Metadata AND Filter (Same Shape, Composite Key)

**What:** Same `json_each`+`GROUP BY` pattern for `metadata[]: [{key, value}, …]` — but because `metadata` uses a composite lookup `(key, value)`, we serialize each entry as a JSON object.

**Example:**
```sql
-- Source: derived from Pattern 1; metadata uses composite match rather than scalar
SELECT v.id
FROM versions v
WHERE v.id IN (
  SELECT version_id
  FROM metadata
  WHERE (key, value) IN (
    SELECT json_extract(value, '$.key'), json_extract(value, '$.value')
    FROM json_each(?)
  )
  GROUP BY version_id
  HAVING COUNT(*) = ?
)
ORDER BY v.created_at DESC, v.id DESC
LIMIT ? OFFSET ?
```

**Parameters bound:**
1. `JSON.stringify(metadata)` — e.g. `'[{"key":"artist","value":"tim"},{"key":"department","value":"lighting"}]'`
2. `metadata.length`
3. `limit`, `offset`

**Why this shape:** `idx_metadata_key_value(key, value)` (D-ASST-09) is a covering index for the `(key, value)` predicate. Dropping `COUNT(DISTINCT key)` in favor of plain `COUNT(*)` is safe **because the UNIQUE(version_id, key) constraint guarantees each (version_id, key) pair exists at most once in the matched set** — if the filter has two `{key,value}` entries that both match, they must be distinct keys.

### Pattern 3: Combined Filter (tag + metadata + status + scope + date range)

**What:** AND across all fields in one query — each sub-filter composes as a separate WHERE clause predicate that the previous one feeds into.

**Example:**
```sql
-- Source: derived from Patterns 1+2; scope hierarchy JOIN on shots→sequences→projects
SELECT v.id
FROM versions v
  INNER JOIN shots sh ON sh.id = v.shot_id
  INNER JOIN sequences sq ON sq.id = sh.sequence_id
  INNER JOIN projects p ON p.id = sq.project_id
WHERE
  p.workspace_id = ?                    -- OR: sq.project_id = ? / sh.sequence_id = ? / v.shot_id = ?
  AND v.status = ?                      -- optional; uses idx_versions_status
  AND v.created_at >= ?                 -- optional date_from
  AND v.created_at <= ?                 -- optional date_to
  AND v.id IN (                         -- optional tags AND
    SELECT version_id FROM tags
    WHERE tag IN (SELECT value FROM json_each(?))
    GROUP BY version_id HAVING COUNT(DISTINCT tag) = ?
  )
  AND v.id IN (                         -- optional metadata AND
    SELECT version_id FROM metadata
    WHERE (key, value) IN (
      SELECT json_extract(value, '$.key'), json_extract(value, '$.value')
      FROM json_each(?)
    )
    GROUP BY version_id HAVING COUNT(*) = ?
  )
ORDER BY v.created_at DESC, v.id DESC
LIMIT ? OFFSET ?
```

**Composition strategy (engine-side):**

```ts
// Source: sketched pattern the planner should implement in src/store/tag-repo.ts or a new AssetQueryRepo
type FilterDesc = {
  workspace_id?: string;
  project_id?: string;
  sequence_id?: string;
  shot_id?: string;
  tags?: string[];
  metadata?: Array<{ key: string; value: string }>;
  status?: 'submitted' | 'running' | 'completed' | 'failed';
  date_from?: number;
  date_to?: number;
  limit: number;
  offset: number;
};

function buildQuery(f: FilterDesc): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const joins: string[] = [];

  // Scope — exactly one of workspace/project/sequence/shot (or none).
  // XOR is validated in the engine before this call (D-ASST-13); repo trusts the descriptor.
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

  if (f.status) {
    where.push('v.status = ?');
    params.push(f.status);
  }
  if (f.date_from !== undefined) {
    where.push('v.created_at >= ?');
    params.push(f.date_from);
  }
  if (f.date_to !== undefined) {
    where.push('v.created_at <= ?');
    params.push(f.date_to);
  }
  if (f.tags && f.tags.length > 0) {
    where.push(`v.id IN (
      SELECT version_id FROM tags
      WHERE tag IN (SELECT value FROM json_each(?))
      GROUP BY version_id HAVING COUNT(DISTINCT tag) = ?
    )`);
    params.push(JSON.stringify(f.tags), f.tags.length);
  }
  if (f.metadata && f.metadata.length > 0) {
    where.push(`v.id IN (
      SELECT version_id FROM metadata
      WHERE (key, value) IN (
        SELECT json_extract(value, '$.key'), json_extract(value, '$.value')
        FROM json_each(?)
      )
      GROUP BY version_id HAVING COUNT(*) = ?
    )`);
    params.push(JSON.stringify(f.metadata), f.metadata.length);
  }

  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  return {
    sql: `
      SELECT v.*
      FROM versions v
      ${joins.join('\n      ')}
      ${whereSql}
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT ? OFFSET ?
    `,
    params: [...params, f.limit, f.offset],
  };
}
```

**Prepared-statement cache strategy:** The SQL text varies with the optional fields (different JOIN set, different WHERE terms). At demo scale (< 10 unique filter shapes in practice), the repo can either:
- **(a) Build SQL dynamically per call**, relying on better-sqlite3's internal LRU cache; or
- **(b) Cache prepared statements by a filter-shape key** (e.g., bitmask of present fields) — Map<string, PreparedStatement>.

Recommend **(a)** for Phase 4 — better-sqlite3 handles this well; no measurable throughput requirement; "cache prepares" is a Phase 5 optimization if `EXPLAIN QUERY PLAN` output ever shows repeated-prepare as a bottleneck.

### Pattern 4: Version Hydration (version.get, version.list --include, asset.query items)

**What:** A single query that returns each version row plus its tags array and its metadata array as JSON-encoded columns.

**Example (validated):**
```sql
-- Source: VERIFIED in-memory test (30 versions with varied tag counts, 20-row page)
SELECT
  v.*,
  (SELECT json_group_array(t.tag ORDER BY t.tag)
   FROM tags t WHERE t.version_id = v.id) AS tags_json,
  (SELECT json_group_array(json_object('key', m.key, 'value', m.value) ORDER BY m.key)
   FROM metadata m WHERE m.version_id = v.id) AS metadata_json
FROM versions v
WHERE v.shot_id = ?
ORDER BY v.version_number DESC
LIMIT ? OFFSET ?
```

**Parsed in the repo layer:**
```ts
// Source: recommended repo-layer shape
const rows = stmt.all(shotId, limit, offset) as Array<{
  // ... all Version columns ...
  tags_json: string;        // JSON string — e.g., '["approved","final","hero"]' or '[]'
  metadata_json: string;    // JSON string — e.g., '[{"key":"artist","value":"tim"}]' or '[]'
}>;
return rows.map((r) => {
  const { tags_json, metadata_json, ...version } = r;
  return {
    ...version,
    tags: JSON.parse(tags_json) as string[],
    metadata: JSON.parse(metadata_json) as Array<{key: string; value: string}>,
  };
});
```

**Why this shape:**
- **Empty sets render correctly as `[]`**, not `[null]` — verified above.
- **ORDER BY inside json_group_array** satisfies D-ASST-04 (tags alphabetical, metadata by key) — requires SQLite ≥ 3.44. [VERIFIED: SQLite 3.53.0 shipped with `better-sqlite3` 12.9.0; WebFetch of sqlite.org/changes.html confirmed 3.44 as the introducing version.]
- **Subquery runs only for rows that pass the LIMIT** — confirmed by SQLite's standard correlated-subquery semantics. A LEFT JOIN + GROUP BY would aggregate all rows in the shot before LIMIT, wasteful for large shots.
- **No GROUP BY on the outer query** — keeps the shape simple and avoids `SELECT v.col1, v.col2, ...` column enumeration pain that GROUP BY forces (SQLite is relaxed about this but it's sloppy).

### Pattern 5: COUNT + Paged SELECT in One Transaction

**What:** To return `{items, total_count, limit, offset}` with a `total_count` that matches the paged state, wrap both queries in a `db.transaction()`.

**Example:**
```ts
// Source: derived from existing repo pattern (version-repo.ts listByShot uses separate-COUNT)
listByFilter(f: FilterDesc): { items: Version[]; total_count: number } {
  const { sql, params } = buildQuery(f);
  return this.db.transaction(() => {
    const items = this.db.prepare(sql).all(...params) as Version[];
    // Count uses the SAME WHERE terms but no ORDER/LIMIT/OFFSET
    const countSql = sql
      .replace(/SELECT v\.\*/, 'SELECT COUNT(*) AS n')
      .replace(/ORDER BY[^(]+LIMIT[^(]+OFFSET[^(]+$/, '');
    // Params drop the trailing limit + offset
    const countParams = params.slice(0, -2);
    const row = this.db.prepare(countSql).get(...countParams) as { n: number };
    return { items, total_count: Number(row.n) };
  })();
}
```

**Why this shape:**
- **Snapshot-isolated**: better-sqlite3's `db.transaction()` uses SQLite savepoints; in WAL mode readers see a consistent snapshot for the duration of the transaction. So `total_count` exactly matches the paged state, even under concurrent writers. [CITED: https://www.sqlite.org/isolation.html on WAL snapshot isolation.]
- **Alternative rejected**: `COUNT(*) OVER()` window function works but generates a CO-ROUTINE in the query plan [VERIFIED: EQP output above] and is awkward to compose with Drizzle's builder.

**String-manipulation concern:** the SQL-rewrite trick in the example above is crude (regex replace on SQL text). For production, either:
- Generate both the paged SQL and the count SQL in `buildQuery()` together (return `{ itemsSql, countSql, whereParams, limit, offset }`), OR
- Use Drizzle's query builder to construct both and reuse the WHERE via a shared subquery.

Recommend the **two-sql-strings return** approach — cleaner, easier to test.

### Pattern 6: Idempotent Mutators (D-ASST-03)

**What:** Each mutator is a single atomic SQL statement that cannot raise on the "already-present"/"already-missing" path.

**`add_tag`:**
```sql
-- Source: VERIFIED that ON CONFLICT DO NOTHING + RETURNING works as expected
INSERT INTO tags (id, version_id, tag, created_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(version_id, tag) DO NOTHING
RETURNING id;
```
- First call returns `[{ id: 'tag_xxx' }]` (one-row array).
- Duplicate call returns `[]` (empty array — RETURNING emits nothing when DO NOTHING short-circuits).
- Engine treats both as success (D-ASST-03). Duplicate detection is available via `.all().length === 0` if useful for telemetry.
- **Do NOT wrap in `db.transaction()`**: per Context7 / better-sqlite3 docs, `ON CONFLICT` clauses can trigger SQLite's automatic rollback. Single INSERT is already atomic — no transaction needed. [CITED: wiselibs/better-sqlite3/docs/api.md — "SQLite may sometimes rollback a transaction... because of an ON CONFLICT clause".]

**`remove_tag`:**
```sql
-- Source: simple parameterized DELETE; affects 0 or 1 rows either way
DELETE FROM tags WHERE version_id = ? AND tag = ?;
```
- Zero rows affected when not present → success (idempotent).
- One row affected when present → success.
- Engine ignores `info.changes` unless reporting usage telemetry.

**`set_metadata` (upsert):**
```sql
-- Source: VERIFIED RETURNING on upsert returns one row for both first-insert and update paths
INSERT INTO metadata (id, version_id, key, value, created_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(version_id, key) DO UPDATE SET
  value = excluded.value,
  created_at = excluded.created_at
RETURNING id, key, value;
```
- First call: INSERT path → new row, `RETURNING id,key,value` with fresh id.
- Subsequent call with same key: UPDATE path → same id, new value, new created_at.
- **D-ASST-08**: `created_at` refreshes on upsert — documents last-touch time.
- **Drizzle equivalent**: `db.insert(metadata).values({...}).onConflictDoUpdate({ target: [metadata.version_id, metadata.key], set: { value: sql`excluded.value`, created_at: sql`excluded.created_at` } })` [CITED: drizzle-team/drizzle-orm-docs composite-key upsert example].

**`remove_metadata`:**
```sql
DELETE FROM metadata WHERE version_id = ? AND key = ?;
```
- Same idempotent no-op semantics as `remove_tag`.

### Anti-Patterns to Avoid

- **String-concatenate tag values into SQL** — e.g. `` sql`WHERE tag IN (${tags.join(',')})` `` or template-literal user input. Obvious SQL injection. Use `json_each(?)` or individual `?` placeholders.
- **Wrap idempotent INSERTs in a transaction** — `ON CONFLICT DO NOTHING` inside a transaction can silently roll back the whole thing if you catch the SqliteError. Single statement → no transaction.
- **`LEFT JOIN tags ... GROUP BY v.id`** for hydration — aggregates BEFORE pagination; slower for large shots; returns `[null]` for empty tag sets without explicit FILTER.
- **Catch and re-throw FK constraint errors** — prefer pre-check `if (!versionRepo.getVersion(versionId))` → throw `VERSION_NOT_FOUND`. Matches the existing `hierarchy-repo.ts:99` pattern. Don't let `SQLITE_CONSTRAINT_FOREIGNKEY` leak; the envelope would wrap it as generic INVALID_INPUT, losing the useful "version not found" signal.
- **COUNT before enforce-cap check without transaction** — The MAX_TAGS_PER_VERSION check (COUNT → compare → INSERT) has a classic TOCTOU race. At demo scale (single process, single artist) this is fine; do NOT add SERIALIZABLE locking for Phase 4.
- **Create a `listAssetsInScope` method on `HierarchyRepo`** — hot-path file; inflating it breaks the focused hierarchy-only contract. Put the scope-JOIN SQL directly in `tag-repo` / `metadata-repo` / the new engine module.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Variable-length IN list binding | Loop through array building `?,?,?` string; per-N prepared statement | `tag IN (SELECT value FROM json_each(?))` | One cacheable statement; no cache churn; injection-safe [CITED: sqlite.org/json1.html#jeach]. |
| Aggregate-with-order collect | Fetch rows then sort in JS; build CSV in app code | `json_group_array(x ORDER BY x)` | Returns a JSON-parsable string; empty set = `[]`; zero DB round-trips [CITED: SQLite 3.44 changelog]. |
| Upsert | `SELECT` first, then INSERT or UPDATE | `INSERT ... ON CONFLICT(...) DO UPDATE SET ...` | Atomic; no TOCTOU; RETURNING gives you the final state [CITED: drizzle-team/drizzle-orm-docs]. |
| Idempotent insert | try/catch UNIQUE violation | `INSERT ... ON CONFLICT DO NOTHING RETURNING id` | No thrown error; empty return means "was already there" [VERIFIED]. |
| Pagination envelope | Hand-build `{items, total_count, limit, offset}` in each tool | Reuse existing `src/tools/shape.ts:shapeList` | Already wired for `version.list`, `project.list`, etc. |
| Tag/metadata schema validation | Hand-write string length + regex checks | Zod schemas referencing `shape.ts` constants | Already the project convention (D-05); Zod failure re-wraps cleanly via D-32. |
| Deep-copy JSON | `JSON.parse(JSON.stringify(x))` | Don't need it — tags/metadata are primitive arrays/objects, no nesting | Phase 4 has no deep-merge concern (that was Phase 3 iterate). |

**Key insight:** Phase 4's "don't hand-roll" list is almost entirely about SQLite-native features. The ecosystem answer for "store and query flexible attributes" has been "use the database's native JSON and aggregation features" for years; this is already the project's stance (PITFALLS.md §Performance: "Normalize: separate tables for projects, shots, versions, tags").

## Runtime State Inventory

Phase 4 is NOT a rename or refactor phase — it adds two tables and one new MCP tool. No runtime-state migration concerns.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 4 creates new tables, does not mutate existing data. Migration 0004 is additive-only. | None. |
| Live service config | None — no external services, no API endpoints changed. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None — Phase 4 does not touch `.env` or any secret store. | None. |
| Build artifacts | None — `npm test` will reload the schema module and exercise new code paths. | None. |

**Confirmation via CONTEXT.md §Out of Scope:** "Phase 4 makes no external API calls" — the only surface added is the `asset` MCP tool + DB tables.

## Common Pitfalls

### Pitfall 1: `ON CONFLICT` inside a transaction can silently roll it back

**What goes wrong:** Wrapping `INSERT ... ON CONFLICT DO NOTHING` (the idempotent `add_tag` path) inside `db.transaction(() => { ... })` allows SQLite to auto-rollback the transaction if the ON CONFLICT path triggers. Any subsequent statements in the transaction would execute outside it, silently breaking atomicity.

**Why it happens:** SQLite treats certain `ON CONFLICT` resolutions as grounds for rolling back the enclosing statement-level transaction. better-sqlite3 exposes `db.inTransaction` for detection, but the surprise is easy to miss.

**How to avoid:** `add_tag` is a single atomic statement. Do NOT wrap it in `db.transaction()`. Same for `remove_tag`, `remove_metadata` (single DELETE), and `set_metadata` (single INSERT ... ON CONFLICT DO UPDATE — UPDATE does NOT trigger rollback). Only wrap multi-statement operations (like `listByFilter` which needs COUNT + SELECT atomically).

**Warning signs:** Tests pass locally but occasionally flake; adding a `SELECT` after the idempotent INSERT inside the same transaction shows the SELECT sees pre-transaction state.

[CITED: wiselibs/better-sqlite3 docs/api.md — "SQLite may sometimes rollback a transaction... because of an ON CONFLICT clause, the RAISE() trigger function, or certain errors such as SQLITE_FULL or SQLITE_BUSY."]

### Pitfall 2: `json_group_array` returns `[null]` on LEFT JOIN misses

**What goes wrong:** `SELECT v.id, json_group_array(t.tag) FROM versions v LEFT JOIN tags t ON t.version_id = v.id GROUP BY v.id` returns `{ id: 'v3', tags: '[null]' }` for versions with zero tags — a parse-able JSON containing a single null, not an empty array.

**Why it happens:** LEFT JOIN yields one row per version with `t.tag = NULL` when no tags match; `json_group_array(NULL)` collects the null into the array.

**How to avoid:** Use correlated subquery instead:
```sql
-- Correct — empty tag set renders as []:
SELECT v.id, (SELECT json_group_array(tag ORDER BY tag) FROM tags WHERE version_id = v.id) AS tags
FROM versions v
-- Returns: { id: 'v3', tags: '[]' } — clean empty array
```

Alternatively use `FILTER`:
```sql
-- Also correct, but requires GROUP BY on every column of v:
SELECT v.*, json_group_array(t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL) AS tags
FROM versions v LEFT JOIN tags t ...
GROUP BY v.id, v.shot_id, ...  -- every column, annoying
```

**Warning signs:** `version.get` returns `tags: [null]` for versions with no tags; frontend crashes or filters show empty-string entries.

[VERIFIED: in-memory test above, both patterns exercised.]

### Pitfall 3: FK violations leak `SQLITE_CONSTRAINT_FOREIGNKEY` to the envelope

**What goes wrong:** Calling `add_tag` with a `version_id` that doesn't exist triggers `SQLITE_CONSTRAINT_FOREIGNKEY`. The existing `isUniqueViolation()` helper (duplicated in all three Phase 1/2/3 repos) doesn't match it, so the raw SqliteError flows through to the envelope, which defensively re-wraps it as generic `INVALID_INPUT` per D-13/D-32. The agent sees an unhelpful "Unexpected internal error" instead of `VERSION_NOT_FOUND`.

**Why it happens:** FK violations have a different SQLite constraint code than UNIQUE violations. The helper only covers UNIQUE and PRIMARYKEY.

**How to avoid:** **Follow the existing `hierarchy-repo.ts:99` pattern** — pre-check parent existence, throw `VERSION_NOT_FOUND`:
```ts
// tag-repo.ts
insertTag(versionId: string, tag: string): Tag {
  // Pre-check per hierarchy-repo pattern — matches D-ASST-24 (reuse VERSION_NOT_FOUND).
  if (!this.versionRepo.getVersion(versionId)) {
    throw new TypedError(
      'VERSION_NOT_FOUND',
      `Version '${versionId}' not found`,
      `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
    );
  }
  // Single-statement INSERT — no transaction wrapper (see Pitfall 1).
  const row = { ... };
  this.db.insert(tags).values(row).onConflictDoNothing({ target: [tags.version_id, tags.tag] }).run();
  return row;
}
```

This means `tag-repo` accepts a `VersionRepo` dependency — mirrors how `HierarchyRepo.createProject` calls `this.getWorkspace(...)` on itself. The architecture-purity test doesn't care about cross-repo imports at the store layer — only MCP-SDK imports are forbidden.

**Alternative**: extend `isUniqueViolation` into `isConstraintViolation` with a switch on `err.code` that returns the right TypedError code per constraint type. This avoids the pre-check round-trip. More elegant but more code — recommend the pre-check approach to stay consistent with Phase 1.

**Warning signs:** Integration tests passing VERSION_NOT_FOUND expectations; envelope tests show generic INVALID_INPUT with "Unexpected internal error" message.

### Pitfall 4: `json_group_array` ORDER BY requires SQLite ≥ 3.44

**What goes wrong:** On older SQLite (pre-3.44), `json_group_array(tag ORDER BY tag)` fails with a syntax error.

**Why it happens:** ORDER BY inside aggregate functions was introduced in SQLite 3.44.0 (2023-11-01) [CITED: sqlite.org/changes.html].

**How to avoid:** Lock a minimum SQLite version check at DB init (add to `src/store/db.ts`):
```ts
const SQLITE_MIN_VERSION = '3.44.0';
const current = sqlite.prepare('SELECT sqlite_version() AS v').get().v as string;
if (compareVersions(current, SQLITE_MIN_VERSION) < 0) {
  throw new Error(`SQLite ${SQLITE_MIN_VERSION}+ required for Phase 4 (have ${current})`);
}
```

**Current state:** `better-sqlite3` 12.9.0 bundles SQLite 3.53.0 — compatibility confirmed. But pinning a minimum is cheap insurance against a future dependency downgrade.

**Warning signs:** `asset.query` test fails with `near "ORDER": syntax error` on a developer machine with an older `better-sqlite3` install.

### Pitfall 5: `idx_tags_tag` isn't used when the first filter term is different

**What goes wrong:** A query like `SELECT * FROM tags WHERE version_id = ? AND tag = ?` uses `sqlite_autoindex_tags_2` (the UNIQUE(version_id, tag) autoindex) rather than `idx_tags_tag`. If the planner writes the scope-filtered tag listing as `WHERE tag = ? AND (version_id IN (subquery))`, SQLite may still pick the autoindex — which is fine — but naive assumption about `idx_tags_tag` being the driver will be wrong.

**Why it happens:** SQLite's planner picks the lowest-selectivity index. For per-version reads, the UNIQUE(version_id, tag) autoindex is strictly better. For tag-IN reads, `idx_tags_tag` wins.

**How to avoid:** Trust the planner. Write the queries naturally. Verify with `EXPLAIN QUERY PLAN` that the expected index is hit for the top-3 query shapes: (a) multi-tag AND, (b) list_tags scoped aggregation, (c) per-version tag list.

**Warning signs:** `asset.query` slows down at 10k+ versions; EQP shows `SCAN tags` instead of `SEARCH tags USING INDEX`.

[VERIFIED via EQP above: `idx_tags_tag` IS used in multi-tag AND via `json_each` pattern; UNIQUE autoindex IS used for per-version reads.]

### Pitfall 6: MAX_TAGS_PER_VERSION check is TOCTOU-racy

**What goes wrong:** The engine does `SELECT COUNT(*) FROM tags WHERE version_id = ?` → compares to `MAX_TAGS_PER_VERSION = 50` → `INSERT INTO tags ...`. Two concurrent `add_tag` calls can both see count=49, both insert, end state = 50 tags (fine) or 51 tags (violates cap). At true single-process demo scale (one agent, one HTTP request at a time) this is impossible; at multi-connection scale it's a real race.

**Why it happens:** No serializable locking between the SELECT and INSERT.

**How to avoid:** Accept the race at Phase 4 — WAL + busy_timeout=5000 already handles write conflicts, and 51 tags is cosmetically bad but not dangerous. If hardening is needed later:
```sql
-- Option: atomic check + insert with CTE (doesn't work cleanly on SQLite without triggers)
-- OR: add a CHECK constraint via trigger, not a DB CHECK constraint (CHECK doesn't support subqueries)
-- OR: ignore — demo-scale reality is one-user-at-a-time
```

Phase 4 acceptance: document the race in the engine comments, rely on CLAUDE.md's "demo scale" stance.

**Warning signs:** Under adversarial testing with `Promise.all([ add_tag(), add_tag(), ...])` 60x, the final count exceeds 50.

### Pitfall 7: Tag leading/trailing whitespace

**What goes wrong:** User passes `' hero '` as a tag. Regex `/^[A-Za-z0-9_\-.:]+$/` rejects it (space is not in the character class), but user sees `TAG_INVALID` without a hint about whitespace.

**Why it happens:** Regex is correct by design — tags shouldn't have whitespace — but the error hint may be too generic.

**How to avoid:** In the engine's validation step, special-case the "tag contains whitespace" path with a specific hint:
```ts
if (/\s/.test(tag)) {
  throw new TypedError(
    'TAG_INVALID',
    `Tag '${tag}' contains whitespace`,
    `Tags cannot contain spaces — use underscores or dashes (e.g., 'hero_shot', 'v-001')`,
  );
}
if (!TAG_REGEX.test(tag)) { ... generic message ... }
```

**Warning signs:** Agents trimming display values end up sending trimmed tags and getting opaque errors about regex.

## Code Examples

### Operation 1: `add_tag` (idempotent insert)

```ts
// Source: src/store/tag-repo.ts — planner writes this
// Derived from provenance-repo.ts insertEvent + hierarchy-repo.ts createProject (pre-check pattern)
import { sql } from 'drizzle-orm';
import { tags } from './schema.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

export class TagRepo {
  constructor(private db: Db, private versionRepo: VersionRepo) {}

  /** D-ASST-03: idempotent — ON CONFLICT DO NOTHING returns success whether inserted or not. */
  insertTag(versionId: string, tag: string): { id: string; inserted: boolean } {
    // Pre-check parent — mirrors hierarchy-repo createProject (Pitfall 3).
    if (!this.versionRepo.getVersion(versionId)) {
      throw new TypedError(
        'VERSION_NOT_FOUND',
        `Version '${versionId}' not found`,
        `List versions with { tool: 'version', action: 'list', shot_id: <shot> }`,
      );
    }
    const id = newId('tag');
    // Do NOT wrap in transaction — ON CONFLICT DO NOTHING auto-rollback risk (Pitfall 1).
    const returned = this.db
      .insert(tags)
      .values({ id, version_id: versionId, tag, created_at: Date.now() })
      .onConflictDoNothing({ target: [tags.version_id, tags.tag] })
      .returning({ id: tags.id })
      .all();
    return {
      id: returned[0]?.id ?? id, // If no return, the tag already existed; we don't know its id without a SELECT.
      inserted: returned.length > 0,
    };
  }
}
```

### Operation 2: `set_metadata` (upsert)

```ts
// Source: src/store/metadata-repo.ts — planner writes this
import { sql } from 'drizzle-orm';
import { metadata } from './schema.js';

upsertMetadata(versionId: string, key: string, value: string): { id: string } {
  if (!this.versionRepo.getVersion(versionId)) {
    throw new TypedError('VERSION_NOT_FOUND', `Version '${versionId}' not found`);
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
    .all();
  return { id: returned[0].id };
}
```

### Operation 3: `hydrateVersionWithAssets`

```ts
// Source: src/engine/assets.ts — planner writes this
// Pure function; called by Engine.getVersion and Engine.listVersionsForShot when include flags set.
export function hydrateVersionWithAssets(
  db: Db,
  version: Version,
): Version & { tags: string[]; metadata: Array<{ key: string; value: string }> } {
  const row = db.prepare(`
    SELECT
      (SELECT json_group_array(tag ORDER BY tag)
       FROM tags WHERE version_id = ?) AS tags_json,
      (SELECT json_group_array(json_object('key', key, 'value', value) ORDER BY key)
       FROM metadata WHERE version_id = ?) AS metadata_json
  `).get(version.id, version.id) as { tags_json: string; metadata_json: string };
  return {
    ...version,
    tags: JSON.parse(row.tags_json) as string[],
    metadata: JSON.parse(row.metadata_json) as Array<{ key: string; value: string }>,
  };
}
```

**Optimization note for `version.list include_tags`:** instead of calling `hydrateVersionWithAssets` per row, use Pattern 4 (single query with correlated subqueries) in a dedicated `VersionRepo.listByShotWithAssets` method. Saves N+1 round-trips for the 20-row page.

### Operation 4: `asset.query` (full filter)

```ts
// Source: src/engine/assets.ts or src/store/asset-query-repo.ts — planner picks
// Combines Patterns 3 + 5
queryAssets(f: AssetsQueryFilter): { items: VersionWithAssets[]; total_count: number } {
  // Engine has already run scope-XOR, regex, and cap checks.
  const { sql: itemsSql, countSql, whereParams } = buildQuery(f);

  return this.db.transaction(() => {
    const rawItems = this.db.prepare(itemsSql).all(...whereParams, f.limit, f.offset);
    const countRow = this.db.prepare(countSql).get(...whereParams) as { n: number };
    const items = rawItems.map(hydrateRow); // adds tags_json / metadata_json parsing
    return { items, total_count: Number(countRow.n) };
  })();
}
```

### Operation 5: `list_tags` (scope-aware aggregation)

```ts
// Source: src/store/tag-repo.ts — planner writes this
listTagsInScope(scope: ScopeFilter, limit: number, offset: number): { items: TagCount[]; total_count: number } {
  // Build scope JOIN based on which scope field is present (same shape as Pattern 3).
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
    const items = this.db.prepare(itemsSql).all(...scopeParams, limit, offset);
    const { n } = this.db.prepare(countSql).get(...scopeParams) as { n: number };
    return { items, total_count: Number(n) };
  })();
}
```

### Operation 6: 7-action tool registration

```ts
// Source: src/tools/asset-tool.ts — planner writes this; mirrors generation-tool.ts 4-action shape
// Abbreviated — full version in the plan
export function registerAsset(server: McpServer, engine: Engine) {
  server.registerTool('asset', {
    title: 'Asset',
    description: 'Tag, annotate, and search versions...' /* planner writes concise description */,
    inputSchema: {
      action: z.enum(['add_tag', 'remove_tag', 'set_metadata', 'remove_metadata', 'query', 'list_tags', 'list_metadata_keys']),
      version_id: z.string().optional(),
      tag: z.string().optional(),
      key: z.string().optional(),
      value: z.string().optional(),
      // scope XOR fields — all optional
      workspace_id: z.string().optional(),
      project_id: z.string().optional(),
      sequence_id: z.string().optional(),
      shot_id: z.string().optional(),
      // filter fields — optional
      tags: z.array(z.string()).optional(),
      metadata: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
      status: z.enum(['submitted','running','completed','failed']).optional(),
      date_from: z.number().int().optional(),
      date_to: z.number().int().optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
  }, async (rawInput) => {
    try {
      const input = AssetInputSchema.parse(rawInput); // discriminated union
      switch (input.action) {
        case 'add_tag': return toolOk(shapeVersionMutation(await engine.addTag(input.version_id, input.tag)));
        case 'remove_tag': return toolOk(shapeVersionMutation(await engine.removeTag(input.version_id, input.tag)));
        case 'set_metadata': return toolOk(shapeVersionMutation(await engine.setMetadata(input.version_id, input.key, input.value)));
        case 'remove_metadata': return toolOk(shapeVersionMutation(await engine.removeMetadata(input.version_id, input.key)));
        case 'query': return toolOk(shapeList(await engine.queryAssets({ ...input })));
        case 'list_tags': return toolOk(shapeTagList(await engine.listTags({ ...input })));
        case 'list_metadata_keys': return toolOk(shapeTagList(await engine.listMetadataKeys({ ...input })));
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return toolError(new TypedError('INVALID_INPUT', `Invalid input at 'input.${err.issues[0].path.join('.')}'`));
      }
      return toolError(err);
    }
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tag IN (?, ?, ?)` — rebuild prepared statement per N | `tag IN (SELECT value FROM json_each(?))` | SQLite JSON1 enabled by default since 3.38 (2022-02-22) | Stable cacheable prepared statement for variable-length arrays. [CITED: https://www.sqlite.org/json1.html] |
| `GROUP_CONCAT(v, ',')` for denormalized lists | `json_group_array(v ORDER BY v)` | SQLite 3.44 (2023-11-01) adds ORDER BY in aggregates | Clean JSON output; preserved ordering; parseable in one step. [CITED: sqlite.org/changes.html] |
| Two round-trips: INSERT then SELECT new id | `INSERT ... RETURNING id` | SQLite 3.35 (2021-03-12) | Single round-trip; atomic. [CITED: sqlite.org/changes.html] |
| Manual upsert via SELECT-then-INSERT-or-UPDATE | `ON CONFLICT(...) DO UPDATE SET ...` | SQLite 3.24 (2018-06-04) | Atomic; no TOCTOU; native to Drizzle's `onConflictDoUpdate`. |
| External FTS | SQLite FTS5 (compiled into better-sqlite3) | Already available | N/A for Phase 4 — deferred by CONTEXT.md. Listed to confirm it's ready when FTS ships. |

**Not deprecated, but Phase 4-specific flags:**
- `json_group_array` returns a STRING (TEXT column) — the repo layer MUST `JSON.parse()` it before returning to the engine. Don't expect SQLite to return a native JS array.
- `json_each` is a table-valued function — always wrap in `(SELECT value FROM json_each(?))` as a subquery source, not as a direct argument to an operator.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | *(none — all material claims are verified or cited)* | | |

**If this table is empty:** All claims in this research were verified against the local stack (better-sqlite3 12.9.0 / SQLite 3.53.0) or cited from official sources (sqlite.org, drizzle-orm docs, wiselibs/better-sqlite3 docs via Context7). The planner can proceed without further user confirmation on technical shape.

## Open Questions

1. **Should `add_tag` return `inserted: boolean` in the response?**
   - What we know: D-ASST-03 says mutators are idempotent; D-ASST-04 says response is the refreshed version entity. Neither explicitly says whether the agent can tell if it was a no-op vs actual insert.
   - What's unclear: Some agents may want to distinguish "added fresh" vs "already present" for UX (logging, etc.).
   - Recommendation: The engine's `addTag` method can return `{ entity, inserted }` but the TOOL response should NOT expose `inserted` — stays consistent with D-ASST-03 (the agent's mental model is "added, don't care if new or existing"). Planner decides; low-stakes.

2. **`list_tags` default limit: 20 or 100?**
   - What we know: D-24 locks default `limit=20`. CONTEXT.md §"Claude's Discretion" says "default `limit=100` acceptable here since the item is tiny."
   - What's unclear: Whether the `asset.list_tags` input schema should default to 100 as an override of D-24.
   - Recommendation: Keep `limit=20` as default to match D-24 everywhere; agents who want "all tags" can pass `limit=100` explicitly. One default, one rule, less special-case code. Downstream cost is near-zero.

3. **Should `asset.query` echo the input filter in its response?**
   - What we know: D-ASST-06 says list_tags echoes `scope` in `structuredContent.scope`. D-ASST-05 doesn't mention for `asset.query`.
   - What's unclear: Whether agents need the filter echoed for pagination-navigation UIs.
   - Recommendation: Include `filter` in the query response (the exact validated filter descriptor that was applied). Near-zero cost; makes the dashboard (Phase 5) easier; aligns with the "honest data" stance.

4. **What happens when `asset.query` is called with no filter at all (global query)?**
   - What we know: CONTEXT.md §Specifics says "(or none = global)" for scope; AND-only filter with no terms matches everything.
   - What's unclear: Whether to return ALL versions in the DB (could be 10k+ rows across page boundaries) or to require at least one filter.
   - Recommendation: Allow the global query (no filter is just a degenerate case of "all ANDs held vacuously"); pagination limits the response; return `total_count` accurately so the agent can paginate.

## Environment Availability

Phase 4 has no new external dependencies beyond what Phase 1/2/3 already install.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Entire server | ✓ | v25 (per Global CLAUDE.md); `"engines": {"node": ">=20"}` in package.json [VERIFIED] | — |
| npm | Test runner, drizzle-kit | ✓ | bundled | — |
| SQLite (via better-sqlite3) | All DB ops | ✓ | 3.53.0 (bundled in better-sqlite3 12.9.0) [VERIFIED] | None needed — SQLite is embedded. |
| drizzle-kit | Migration generation | ✓ | ^0.31.10 [VERIFIED: package.json devDependencies] | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

Phase 4 can be executed on any developer machine with `npm install` run — no additional tooling setup.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.4 [VERIFIED: package.json] |
| Config file | `vitest.config.ts` (existing — reused unchanged) |
| Quick run command | `npx vitest run src/store/__tests__/tag-repo.test.ts src/engine/__tests__/assets.test.ts` (per-layer) |
| Full suite command | `npm test` (which is `vitest run`) |

### Business Logic Invariants

These are the semantic guarantees Phase 4 MUST uphold. Each becomes one or more test cases.

| Invariant ID | Rule | Source |
|--------------|------|--------|
| INV-ASST-01 | `add_tag` on an existing `(version_id, tag)` pair returns success and leaves the row unchanged. | D-ASST-03 |
| INV-ASST-02 | `remove_tag` on a non-existent `(version_id, tag)` pair returns success and writes nothing. | D-ASST-03 |
| INV-ASST-03 | `set_metadata` first call inserts; subsequent call with same (version_id, key) updates value + created_at. | D-ASST-03, D-ASST-08 |
| INV-ASST-04 | `remove_metadata` on a missing key returns success and writes nothing. | D-ASST-03 |
| INV-ASST-05 | `asset.query.tags: ['a','b']` matches only versions having BOTH tags. Missing `a` OR missing `b` excludes. | D-ASST-14 (within-field AND) |
| INV-ASST-06 | `asset.query.metadata: [{k1,v1},{k2,v2}]` matches only versions having BOTH exact (k,v) pairs. | D-ASST-14 (within-field AND) |
| INV-ASST-07 | Tag filter AND metadata filter AND status filter AND date range AND scope: ALL must hold. | D-ASST-14 (cross-field AND) |
| INV-ASST-08 | At most one of `workspace_id \| project_id \| sequence_id \| shot_id` may be present; 2+ → `INVALID_SCOPE`. | D-ASST-13 |
| INV-ASST-09 | Global query (no scope field) returns all versions matching the other filters (or all versions if none). | D-ASST-13 |
| INV-ASST-10 | Results always sorted `created_at DESC, id DESC`; tiebreaker stable. | D-ASST-16 |
| INV-ASST-11 | Date range inclusive on both ends: `date_from <= created_at AND created_at <= date_to`. | D-ASST-15 |
| INV-ASST-12 | `date_from > date_to` → `INVALID_INPUT`. | D-ASST-15 |
| INV-ASST-13 | Pagination `total_count` equals the count of all rows matching the filter, regardless of `limit`/`offset`. | D-ASST-18 |
| INV-ASST-14 | `total_count` is computed in the same transaction as the paged SELECT (consistency under concurrent writes). | D-ASST-18 |
| INV-ASST-15 | `version.get` response always contains `tags: string[]` (may be `[]`) and `metadata: Array<{key,value}>` (may be `[]`). | D-ASST-19 |
| INV-ASST-16 | `version.list` default (no include flags) omits `tags`/`metadata` from each item. | D-ASST-20 |
| INV-ASST-17 | `version.list include_tags=true` includes `tags: string[]` per item; `include_metadata=true` includes `metadata: [...]`. | D-ASST-20 |
| INV-ASST-18 | Tags in responses are alphabetically ASC; metadata entries ASC by key. | D-ASST-04, D-ASST-05, D-ASST-19 |
| INV-ASST-19 | `list_tags` / `list_metadata_keys` items ordered `count DESC, name ASC`. | D-ASST-06 |
| INV-ASST-20 | MAX_TAGS_PER_VERSION=50 enforced; 51st → `TAG_LIMIT_EXCEEDED`. | D-ASST-11 |
| INV-ASST-21 | MAX_METADATA_PER_VERSION=100 enforced; 101st → `METADATA_LIMIT_EXCEEDED`. | D-ASST-11 |
| INV-ASST-22 | Limit cap `MAX_PAGE_SIZE=100`; `limit=101` → Zod INVALID_INPUT. | D-24, D-ASST-18 |
| INV-ASST-23 | Tag/key regex `^[A-Za-z0-9_\-.:]+$`; invalid → `TAG_INVALID` or `METADATA_INVALID`. | D-ASST-11 |
| INV-ASST-24 | Metadata value ≤ 2000 chars; violation → `METADATA_INVALID`. | D-ASST-11 |
| INV-ASST-25 | `version.provenance` response is UNCHANGED from Phase 3 (no tags/metadata leaked into event stream). | D-ASST-21 |
| INV-ASST-26 | All errors follow Phase 1 envelope: `{isError:true, structuredContent:{code, message, hint}}`. | D-ASST-25 |

### Boundary Conditions

| Condition | Expected Behavior | Test Case |
|-----------|-------------------|-----------|
| Empty filter (no scope, no tags, no metadata, no status, no date) | Global query returns all versions, pagination honored, `total_count = total versions in DB`. | `asset.query({})` returns complete pagination envelope. |
| 0-result query (filter matches nothing) | `{items: [], total_count: 0, limit, offset}`, NOT an error. | `asset.query({tags: ['nonexistent-tag']})` → empty envelope. |
| Single-scope exactly (workspace_id alone) | Scope JOIN applies; versions under that workspace only. | `asset.query({workspace_id: 'ws1'})` filtered. |
| date_from == date_to | Inclusive on both ends → returns versions with that exact created_at. | Instant-match case. |
| date_from > date_to | Engine rejects with `INVALID_INPUT` + hint. | `asset.query({date_from: 2000, date_to: 1000})` → error. |
| Tag with leading whitespace `' hero'` | Regex rejects → `TAG_INVALID` with whitespace-specific hint. | See Pitfall 7. |
| Tag with colon `'status:approved'` | Regex accepts (colon is allowed per D-ASST-11). | Positive test. |
| Exactly 50 tags on a version, add 51st | Engine returns `TAG_LIMIT_EXCEEDED` with hint naming current count. | INV-ASST-20. |
| Exactly 100 metadata on a version, add 101st | Engine returns `METADATA_LIMIT_EXCEEDED`. | INV-ASST-21. |
| `limit=100` (cap) | Accepted; returns up to 100. | Valid upper bound. |
| `limit=101` | Zod rejects → `INVALID_INPUT` at input boundary. | Cap enforcement. |
| `offset=1000000` on 10-row result | Empty items, correct total_count=10. | Offset overflow graceful. |
| `asset.query` with both `workspace_id` and `project_id` | Engine rejects `INVALID_SCOPE` naming both fields. | INV-ASST-08. |
| `version.get` on version with 0 tags and 0 metadata | Response has `tags: []` and `metadata: []` (arrays, not null). | INV-ASST-15. |
| `version.list include_tags=false` (default) | Each item has NO `tags` key (not even empty). | INV-ASST-16. |
| `add_tag` on a reproduce-lineage version | Works the same as on a submitted version (tags are lineage-agnostic). | Cross-lineage consistency. |
| `asset.query` results span reproduce/iterate/null lineage mix | Works (lineage is not a filter; just a column). | Lineage doesn't affect query. |

### Error Surface

Complete error-code landscape added by Phase 4:

| Code | Triggered By | Hint Contract |
|------|-------------|---------------|
| `TAG_INVALID` | Tag fails length (>64) or regex check | Names the offending tag + rule: `"Tag 'tag with spaces' contains whitespace — use underscores or dashes"` |
| `METADATA_INVALID` | Key fails length/regex OR value exceeds 2000 chars | Names the offending key + rule: `"Metadata key 'my key' contains whitespace"` or `"Metadata value for key 'notes' exceeds 2000 chars"` |
| `TAG_LIMIT_EXCEEDED` | >50 tags on a version after an add_tag | Names version_id + current count: `"Version 'ver_abc' already has 50 tags (max). Remove one before adding."` |
| `METADATA_LIMIT_EXCEEDED` | >100 metadata entries on a version | Names version_id + current count. |
| `INVALID_SCOPE` | 2+ scope fields on query/list_tags/list_metadata_keys | Names the conflicting fields: `"asset.query accepts at most one of workspace_id\|project_id\|sequence_id\|shot_id — received [project_id, sequence_id]"` |

Reused codes from Phase 1/2/3:

| Code | Phase 4 Usage |
|------|--------------|
| `VERSION_NOT_FOUND` | Any mutator (add_tag/remove_tag/set_metadata/remove_metadata) with unknown `version_id`. |
| `INVALID_INPUT` | Zod failure (D-32); `date_from > date_to`; otherwise unmatched shape. |

Codes NOT applicable:
- **`DUPLICATE_NAME`**: Idempotent adds (D-ASST-03) eliminate the concept — adding an existing tag is a no-op, not a conflict.

All errors wrap via Phase 1 envelope `{isError:true, structuredContent:{code, message, hint?}}` (D-28, D-ASST-25).

### Integration Surfaces

| Surface | Change | Test |
|---------|--------|------|
| `version.get` | Always returns `entity.tags: string[]` + `entity.metadata: Array<{key,value}>` inline. Breaking change to Phase 3 D-PROV-08 shape (additive: new keys, no removed). | Extend `src/tools/__tests__/version-tool.test.ts` with a version-has-tags case and a version-has-no-tags case. |
| `version.list` | Input schema grows `include_tags?: boolean`, `include_metadata?: boolean` (both default `false`). Response grows optional `tags`/`metadata` per item when flags are true. | Extend `version-tool.test.ts` with 3 scenarios: default (no tags), include_tags only, both. |
| `version.provenance` | UNCHANGED. Tags/metadata don't appear in the event stream. | Regression test: asset.add_tag does NOT write a provenance event. |
| `generation.submit` | UNCHANGED. New versions start with zero tags + zero metadata. | Regression: after submit, version.get has `tags: []`, `metadata: []`. |
| `architecture-purity.test.ts` | Extend to assert: `src/engine/assets.ts`, `src/store/tag-repo.ts`, `src/store/metadata-repo.ts` have zero MCP imports. | Mirror existing lines. |
| `tool-budget.test.ts` | Update expected count from 6 → 7; add `'asset'` to the sorted name set. | Single-line change in the expectations. |
| `stdio-hygiene.test.ts` | Extend to assert that add_tag / set_metadata do NOT log tag/key/value strings (user may put sensitive data in metadata). | Grep stderr during exercise. |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASST-01 | add/remove tags on any version | unit (engine) + integration (tool) | `npx vitest run src/engine/__tests__/assets.test.ts src/tools/__tests__/asset-tool.test.ts` | ❌ Wave 0 |
| ASST-02 | attach/retrieve key-value metadata | unit (engine) + integration (tool) | same as ASST-01 | ❌ Wave 0 |
| ASST-03 | search/filter by tags, metadata, hierarchy, date range | unit (engine) — table-driven scenarios | `npx vitest run src/engine/__tests__/assets.test.ts -t "query"` | ❌ Wave 0 |
| ASST-04 | results paginated (default 20, total_count) | unit (repo) + integration (tool) | `npx vitest run src/store/__tests__/tag-repo.test.ts` | ❌ Wave 0 |
| ASST-05 | responses include full breadcrumb | integration (tool) | `npx vitest run src/tools/__tests__/asset-tool.test.ts -t "breadcrumb"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run <touched test file>` — sub-5-second feedback loop
- **Per wave merge:** `npx vitest run src/engine/__tests__ src/store/__tests__ src/tools/__tests__` — full Phase 4 surface
- **Phase gate (before `/gsd-verify-work`):** `npm test` — full suite green including cross-cutting tests (architecture-purity, tool-budget, stdio-hygiene)

### Concurrency / Consistency

| Concern | Mitigation |
|---------|-----------|
| WAL + busy_timeout=5000 | Inherited from Phase 1 `src/store/db.ts`; Phase 4 inherits snapshot isolation on reads. |
| `asset.query` pagination consistency | COUNT(*) + paged SELECT wrapped in `db.transaction(() => { ... })` — SQLite WAL snapshot holds for the duration [CITED: sqlite.org/isolation.html]. |
| `set_metadata` upsert atomicity | Single `INSERT ... ON CONFLICT DO UPDATE` is atomic at statement level; no explicit transaction needed. |
| `add_tag` idempotency | Single `INSERT ... ON CONFLICT DO NOTHING` is atomic; NO transaction wrapper (Pitfall 1). |
| MAX_TAGS_PER_VERSION TOCTOU | Accepted at demo scale (Pitfall 6); documented in engine comments. |

### Test Fixtures Needed

Extend `src/test-utils/fixtures.ts` with:

| Fixture | Purpose |
|---------|---------|
| `seedAssetFixtures(db, { versionCount, tagsPerVersion, metadataPerVersion })` | Bulk seeding helper for query-correctness tests. |
| `versionWithTags(['hero','final'])` / `versionWithMetadata({artist:'tim',dept:'comp'})` | Single-row fixtures for focused unit tests. |
| `hierarchyWithVersionsAcrossScopes()` | Builds `ws > p1 > seq1 > shot1 > v001..v003` AND `ws > p2 > seq2 > shot2 > v001..v003` so scope tests exercise real JOIN paths. |
| `versionsWithTimestampSpread([1000, 2000, 3000, 4000])` | For date-range boundary tests. |
| `versionsWithStatusVariety(['submitted','running','completed','failed'])` | For status filter tests. |
| `versionsAtCap({ tagCount: 50 })` | For MAX_TAGS_PER_VERSION tests. |

### Wave 0 Gaps (test infrastructure to create before implementation)

- [ ] `src/store/__tests__/tag-repo.test.ts` — covers INV-ASST-01, -02, plus idempotency, FK pre-check, scope aggregation
- [ ] `src/store/__tests__/metadata-repo.test.ts` — covers INV-ASST-03, -04, plus upsert, scope aggregation
- [ ] `src/engine/__tests__/assets.test.ts` — covers INV-ASST-05..-18, -23, -24, -26; table-driven filter scenarios
- [ ] `src/tools/__tests__/asset-tool.test.ts` — all 7 actions exercised through tool boundary; envelope + breadcrumb per INV-ASST-26
- [ ] Extend `src/tools/__tests__/version-tool.test.ts` — new cases for INV-ASST-15, -16, -17 (version.get hydration + version.list include flags)
- [ ] Extend `src/__tests__/architecture-purity.test.ts` — add three new files to the assertion
- [ ] Extend `src/__tests__/tool-budget.test.ts` — bump 6→7, add `'asset'` to sorted name set
- [ ] Extend `src/__tests__/stdio-hygiene.test.ts` — assert no tag/key/value strings in stderr during add_tag/set_metadata exercises
- [ ] Extend `src/test-utils/fixtures.ts` — add the six fixture helpers above

No framework install needed — Vitest is already the runner.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-user demo; no auth surface (out of scope per REQUIREMENTS.md). |
| V3 Session Management | no | No sessions; stateless MCP transport. |
| V4 Access Control | no | Single user; no multi-tenancy in v1. |
| V5 Input Validation | **yes** | Zod v4 at tool boundary (D-05); engine re-validates (defence in depth). Tag/key regex: `/^[A-Za-z0-9_\-.:]+$/`; value cap 2000 chars; scope XOR at engine boundary. |
| V6 Cryptography | no | No secret handling in Phase 4; `.env` untouched. |
| V7 Error Handling & Logging | **yes** | Typed errors only (D-28); stderr-only logs (D-21); `stdio-hygiene.test.ts` asserts no user data in stdout. |
| V8 Data Protection | marginal | Metadata values can hold arbitrary strings; agents should avoid secrets there. Phase 4 adds `stdio-hygiene` assertion for metadata-value suppression. |
| V13 API & Web Services | **yes** | MCP tool surface re-wraps all errors; no raw SqliteError / ZodError leaks (D-13, D-32). |

### Known Threat Patterns for SQLite / MCP Stack

| Pattern | STRIDE | Standard Mitigation (how Phase 4 handles it) |
|---------|--------|---------------------------------------------|
| SQL injection via tag strings | Tampering | `json_each(?)` binds the entire array as ONE JSON parameter; never string-concat user input. Prepared statements everywhere. [CITED: sqlite.org/json1.html#jeach — json_each parses its own input.] |
| Prototype pollution via metadata keys | Tampering | Metadata keys stored as TEXT column values, not object keys. Even if an agent passed `__proto__` as a key, it hits SQLite as a string literal, not a JS property access. (Phase 3's `iterate-merge.ts` already addresses object-literal prototype concerns; Phase 4 doesn't need the same hardening because metadata is flat key-value stored as table rows, never as an object.) |
| DoS via unbounded tag array | Availability | Zod input cap: `tags.length ≤ 20` (D-ASST-12). Engine rejects oversize arrays before DB work. |
| DoS via massive metadata value | Availability | 2000-char cap per value (D-ASST-11); Zod boundary + engine re-check. |
| Stdio pollution breaking MCP framing | Denial of Service | D-21 stderr-only; `stdio-hygiene.test.ts` extended to cover asset-tool calls. |
| Sensitive data in metadata value leaking via logs | Information Disclosure | Engine logs ids + error codes, never values; `stdio-hygiene` test extended (D-ASST-33 #6). |
| TOCTOU on MAX_TAGS_PER_VERSION | Tampering | Accepted at demo scale; documented in engine comments. Real-world mitigation is multi-user DB locking — out of scope for v1. |

Phase 4 does not expand the attack surface meaningfully: no new network boundary, no new secret handling, no new file IO. The only new input validation surface is tag/key/value shape, all covered by Zod + engine re-check.

## Sources

### Primary (HIGH confidence)

- **better-sqlite3** (Context7 ID `/wiselibs/better-sqlite3`) — fetched 2026-04-22 for transaction management, prepared statements, ON CONFLICT behavior. URL: https://github.com/wiselibs/better-sqlite3/blob/master/docs/api.md
- **Drizzle ORM** (Context7 ID `/drizzle-team/drizzle-orm-docs`) — fetched 2026-04-22 for composite-key upsert pattern. URL: https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/guides/upsert.mdx
- **SQLite changelog** — WebFetch 2026-04-22 confirming 3.44.0 added ORDER BY in aggregate functions. URL: https://www.sqlite.org/changes.html
- **SQLite JSON1 extension** — native docs for `json_each` and `json_group_array`. URL: https://www.sqlite.org/json1.html
- **SQLite WAL mode / isolation** — native docs confirming snapshot isolation under transaction. URL: https://www.sqlite.org/isolation.html, https://www.sqlite.org/wal.html
- **EXPLAIN QUERY PLAN runs** — executed in-process against better-sqlite3 12.9.0 on the actual Phase 4 schema seeded with realistic data (500 versions / 1500 tag rows / 1000 metadata rows, then 5000 versions / 25000 tag rows for timing). Every query plan in this doc corresponds to an actual EQP output, not training knowledge.
- **In-process timing benchmarks** — executed in-process against better-sqlite3 12.9.0; 200-iteration warm-statement average per pattern.

### Secondary (MEDIUM confidence)

- Phase 1/2/3 CONTEXT.md, PATTERNS.md, RESEARCH.md, landed source code — consulted as the project's own canonical references for patterns. Every claim about "the existing codebase does X" was verified by `Read` of the live file.

### Tertiary (LOW confidence)

- None. Every shape-level recommendation in this document is backed by either a VERIFIED local run or a CITED official source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all referenced libraries are pinned in `package.json` with versions verified against the registry via `Read`.
- Architecture patterns: HIGH — every SQL pattern validated via EXPLAIN QUERY PLAN and run-to-result on the actual Phase 3 schema shape.
- Timing expectations: HIGH — 5k/25k benchmark shows all patterns under 1.2ms/call; demo-scale viability confirmed.
- Pitfalls: HIGH — all 7 pitfalls have either a live reproduction (Pitfalls 2, 3) or a documented citation (Pitfalls 1, 4).
- Validation architecture: HIGH — 26 invariants are a complete decomposition of D-ASST-01..D-ASST-33 into testable assertions.

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days — stack is stable; better-sqlite3 / drizzle-orm don't move fast; SQLite is a moving target but the features Phase 4 uses are all ≥2 years old).

## Project Constraints (from CLAUDE.md)

| Constraint | How Phase 4 honors it |
|------------|----------------------|
| "Tool-engine separation: MCP tools are thin Zod-validated entry points that delegate to engine services. Engine has zero MCP dependency." | `src/tools/asset-tool.ts` delegates each of 7 actions to one engine method. `src/engine/assets.ts` imports zero MCP SDK. Architecture-purity test extended. |
| "Tool cap: Maximum 12 MCP tools. Use coarse-grained design with `action` parameters." | Phase 4 adds 1 tool (`asset`) with 7 actions. Total: 7/12 (D-ASST-01). Coarse-grained by design. |
| "Append-only provenance: Provenance records are never updated or deleted. States are separate rows." | Phase 4 does NOT touch provenance (D-ASST-21). Tags/metadata are plain CRUD (D-ASST-10) — not provenance, not append-only. |
| "Prompt blob is truth: The ComfyUI prompt blob (not workflow blob) contains resolved seeds and actual model paths." | Unchanged by Phase 4 — prompt blob handling is Phase 3. Phase 4 doesn't read or write prompt_json. |
| "Async generation: Submit returns immediately with a job ID. Check is a separate tool. Exponential backoff for polling." | Unchanged by Phase 4 — generation is Phase 2's concern. Phase 4 makes NO external API calls. |
| "SQLite WAL: Enable WAL mode + busy_timeout=5000 at database initialization." | Inherited from `src/store/db.ts` Phase 1 bootstrap — unchanged. Phase 4's transactions inherit WAL snapshot isolation. |
| "Use `nanoid()` for all entity IDs" | `tag_*` and `meta_*` prefixes via existing `src/utils/id.ts:newId('tag'|'meta')`. Need to ADD 'tag' and 'meta' to the prefix union type in id.ts. |
| "VFX naming: zero-padded versions (`v001`), underscore separators" | Phase 4 doesn't create versions — hierarchy already satisfied. |
| "Error responses must be human-readable with actionable guidance" | D-ASST-23 error hints name specific identifiers (tag, version_id) + suggest recovery. |
| "Never return raw JSON dumps to agents — structure responses with context" | `asset.query` returns structured `{items, total_count, limit, offset}` with breadcrumb on each item. `list_tags` returns `{items: [{name, count}], ...}`. |
| "Paginate all list queries (default 20, include total count)" | D-ASST-18 inherits Phase 1 D-24: default limit=20, cap=100, total_count always present. |

All CLAUDE.md directives are either inherited unchanged from Phase 1/2/3 or directly addressed by CONTEXT.md decisions. Phase 4 introduces no conflicts.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASST-01 | Agent can add/remove tags on any version | Pattern 6 (idempotent `INSERT ... ON CONFLICT DO NOTHING RETURNING`) + Pattern 6's `DELETE` covers both operations; FK pre-check pattern (Pitfall 3) raises `VERSION_NOT_FOUND` cleanly; D-ASST-03 idempotency validated via live RETURNING test. |
| ASST-02 | Agent can attach arbitrary key-value metadata to versions | Pattern 6's `INSERT ... ON CONFLICT DO UPDATE RETURNING` (upsert) covers `set_metadata`; DELETE for `remove_metadata`; D-ASST-08 composite key `(version_id, key)` backed by UNIQUE autoindex. Value max 2000 chars enforced in shape.ts + engine. |
| ASST-03 | Agent can search/filter versions by tags, metadata, hierarchy, date range | Pattern 3 composes all filter dimensions into a single query with AND semantics. EQP shows idx_tags_tag, idx_metadata_key_value, idx_versions_status all participate. Scope JOINs hit the UNIQUE autoindexes on shots/sequences/projects. |
| ASST-04 | Search results are paginated (default 20, with total count) | Pattern 5: `SELECT COUNT(*)` + paged SELECT in one `db.transaction()` for consistency. D-ASST-18 inherits D-24 default=20, cap=100. |
| ASST-05 | Query responses include hierarchy breadcrumb (workspace > project > sequence > shot) | Existing `BreadcrumbResolver.resolve('version', v.id)` already walks the full 5-entry chain (Phase 2 D-GEN-05). Every `asset.query` item runs through this via `shapeList`. No new breadcrumb code needed. |
