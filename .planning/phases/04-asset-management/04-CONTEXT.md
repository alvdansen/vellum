# Phase 4: Asset Management - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver tag + metadata attachment on versions and a paginated cross-hierarchy search that combines tag, metadata, hierarchy-scope, date-range, and status filters. One new MCP tool (`asset`) with seven actions; two new SQLite tables (`tags`, `metadata`) in plain-CRUD shape; existing `version.get` grows inline tags + metadata on its response; existing `version.list` grows opt-in `include_tags` / `include_metadata` flags. ASST-01..ASST-05.

**In scope:**
- New MCP tool `asset` with actions `add_tag | remove_tag | set_metadata | remove_metadata | query | list_tags | list_metadata_keys` (7 actions, +1 tool slot → 7 of 12 used)
- New `tags` table: `(id TEXT PK, version_id TEXT REFERENCES versions(id), tag TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(version_id, tag))` — plain CRUD (DELETE allowed)
- New `metadata` table: `(id TEXT PK, version_id TEXT REFERENCES versions(id), key TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(version_id, key))` — upsert on (version_id, key)
- Idempotent mutation semantics across all four mutators (add-on-existing = no-op; remove-on-missing = no-op; set_metadata = upsert)
- `asset.query` filter input: `{scope?, tags?, metadata?, date_from?, date_to?, status?, limit?, offset?}` with AND-only semantics (cross-field AND, within-field AND)
- Single-scope XOR on query: exactly one of `workspace_id | project_id | sequence_id | shot_id` (or none = global)
- Fixed result ordering `versions.created_at DESC`; response envelope `{items, total_count, limit, offset}` matching D-24 / shapeList (Phase 1)
- `asset.list_tags` / `asset.list_metadata_keys`: hierarchy-scoped discovery returning `{items: Array<{name: string, count: number}>, total_count, limit, offset}`
- `version.get` always returns `{entity, tags: string[], metadata: Array<{key, value}>, breadcrumb, breadcrumb_text}` — tags alphabetical ASC, metadata by key ASC
- `version.list` grows optional `include_tags?: boolean = false` + `include_metadata?: boolean = false` (keeps list reads cheap by default)
- Conservative input bounds (new shape.ts constants): tag/key 1-64 chars matching `/^[\w\-.:]+$/`; metadata value 1-2000 chars; MAX_TAGS_PER_VERSION=50; MAX_METADATA_PER_VERSION=100
- New typed error codes: `TAG_INVALID`, `METADATA_INVALID`, `TAG_LIMIT_EXCEEDED`, `METADATA_LIMIT_EXCEEDED`, `INVALID_SCOPE` (XOR violation)
- Schema migration `drizzle/0004_phase4_assets.sql` — additive-only (creates both tables + their indexes); follows the Phase 2/3 additive split pattern (SCHEMA_DDL in schema.ts does NOT declare the new tables — migrator lays them in every fresh DB)
- Indexes: `idx_tags_tag(tag)` for tag filter; `idx_metadata_key_value(key, value)` for metadata filter; implicit UNIQUE autoindexes on `(version_id, tag)` and `(version_id, key)` cover per-version reads (DM-03 lesson applies — no redundant fk-only indexes)

**Out of scope (belongs to later phases or deferred):**
- Append-only audit trail for tag/metadata changes — rejected per Area 2 decision; provenance stays the lone append-only surface
- FTS5 / full-text search on tag or metadata values — exact-match only in Phase 4; FTS5 is a layered enhancement
- Namespaced tags, category+value tags, typed metadata values, structured JSON values — tags are plain strings, metadata values are plain TEXT
- OR-grouping, nested boolean filters, NOT filters, tag-exclude — Phase 4 is AND-only
- Wildcard/glob hierarchy scope, breadcrumb-path shorthand — single-scope XOR only
- Multi-column ordering, `order_by` configurability — fixed `created_at DESC`
- Facet aggregation bundled into `query` response — if the dashboard (Phase 5) needs this, `list_tags` + `list_metadata_keys` with a filter mirror cover it then
- Tag rename operation — not required for v1 demo; remove + re-add is acceptable
- Cross-entity tagging (tagging a sequence or shot directly) — tags/metadata attach to `versions` only
- Web dashboard, SSE progress, static bundle — Phase 5
- Multi-backend routing, function-calling adapter — v2

</domain>

<decisions>
## Implementation Decisions

### Tool Surface (ASST-01..ASST-05 · TOOL-01..TOOL-05 continuity)

- **D-ASST-01:** One new MCP tool: `asset`. Matches Phase 1 D-02 naming (lowercase, noun, snake_case, no prefix). Tool count after Phase 4: **7 of 12** (`workspace`, `project`, `sequence`, `shot`, `generation`, `version`, `asset`). Remaining budget for Phase 5 + reserve: 5 slots. Justification for one-tool-for-everything vs separate `tag` / `metadata` / `query` tools: Pitfall #1 (tool explosion) + D-04 budget discipline + clean domain boundary ("assets" = tags + metadata + search over assets).
- **D-ASST-02:** `asset` actions (discriminated Zod union on `action`): `'add_tag' | 'remove_tag' | 'set_metadata' | 'remove_metadata' | 'query' | 'list_tags' | 'list_metadata_keys'`. Seven actions — larger than prior tools but each is coherent with the domain and most share the `version_id` / scope vocabulary.
- **D-ASST-03:** All mutators are **idempotent**:
  - `add_tag` on an already-existing `(version_id, tag)` → success, row unchanged (INSERT ... ON CONFLICT DO NOTHING or pre-check)
  - `remove_tag` on a missing `(version_id, tag)` → success, nothing deleted
  - `set_metadata` → upsert on `(version_id, key)` (INSERT ... ON CONFLICT(version_id, key) DO UPDATE SET value, created_at)
  - `remove_metadata` on a missing key → success, nothing deleted
  - Rationale: agent retry ergonomics — no "already exists" / "not found" branching on routine operations. Matches the same calendar-paving spirit as VersionRepo's `completed_at IS NULL` guard (write once) but in the opposite direction (idempotent instead of immutable) because tags/metadata are organization state, not lineage.
- **D-ASST-04:** Mutator response shape (add_tag, remove_tag, set_metadata, remove_metadata): `{ entity: Version & { version_label, tags: string[], metadata: Array<{key, value}> }, breadcrumb, breadcrumb_text }`. The refreshed version entity with its current tags + metadata is returned so the agent doesn't need a follow-up `version.get`. Wrapped in Phase 1 dual-form envelope (D-25).
- **D-ASST-05:** `asset.query` response shape: `{ items: Array<VersionItem>, total_count: number, limit: number, offset: number }` via the existing `shapeList` helper. Each `VersionItem` = `{ ...Version, version_label, tags: string[], metadata: Array<{key, value}>, breadcrumb: BreadcrumbEntry[], breadcrumb_text: string }`. Tags ASC alphabetical, metadata ASC by key. Satisfies ASST-05 (breadcrumb on every response) and Success Criterion 5 (every query response includes full hierarchy breadcrumb).
- **D-ASST-06:** `asset.list_tags` response: `{ items: Array<{ name: string, count: number }>, total_count, limit, offset }` — items ordered by `count DESC, name ASC` (most-used tags first, ties broken alphabetically). `asset.list_metadata_keys` same shape. Input includes the same optional single-scope field as `asset.query` so discovery matches the query context. No breadcrumb on the aggregate list itself (these are summary calls) — but the input scope is echoed in `structuredContent.scope` for clarity.

### Data Model (ASST-01, ASST-02)

- **D-ASST-07:** `tags` table columns:
  - `id TEXT PRIMARY KEY` — nanoid with `tag_` prefix (per Phase 1 D-11 pattern)
  - `version_id TEXT NOT NULL REFERENCES versions(id)`
  - `tag TEXT NOT NULL`
  - `created_at INTEGER NOT NULL` (epoch-ms)
  - `UNIQUE(version_id, tag)` — UNIQUE autoindex covers per-version reads
- **D-ASST-08:** `metadata` table columns:
  - `id TEXT PRIMARY KEY` — nanoid with `meta_` prefix
  - `version_id TEXT NOT NULL REFERENCES versions(id)`
  - `key TEXT NOT NULL`
  - `value TEXT NOT NULL`
  - `created_at INTEGER NOT NULL` (epoch-ms; renewed on upsert, documents last-touch time)
  - `UNIQUE(version_id, key)` — upsert target; UNIQUE autoindex covers per-version reads and per-key-per-version lookups
- **D-ASST-09:** Explicit secondary indexes (D-PROV-35 style decisions — named for intent):
  - `CREATE INDEX idx_tags_tag ON tags(tag)` — supports `WHERE tag IN (...)` for multi-tag AND queries + `list_tags` aggregation
  - `CREATE INDEX idx_metadata_key_value ON metadata(key, value)` — supports `WHERE key = ? AND value = ?` filters + `list_metadata_keys` aggregation
  - No `idx_tags_version` / `idx_metadata_version` — the UNIQUE autoindexes already cover version-scoped reads (DM-03 lesson applied)
- **D-ASST-10:** Mutability is **plain CRUD**, not append-only. DELETE is allowed on both tables. Provenance (PROV-03) remains the sole append-only surface in the project — tags/metadata are organization labels that reflect the current state, not immutable lineage.
  - Architecturally: repo layer for `tags`/`metadata` may expose `insertTag`, `deleteTag`, `upsertMetadata`, `deleteMetadata` — the architecture-purity test does NOT forbid DELETE on these repos (only on `provenance-repo.ts`).
  - Rationale: ASST-01 explicitly says "add and remove"; studios treat tags as live state ("approved" replaces "review"), not as an audit trail.
- **D-ASST-11:** Input bounds (extend `src/tools/shape.ts` constants):
  - `MAX_TAG_LENGTH = 64` · tag string length; new constant
  - `MAX_METADATA_KEY_LENGTH = 64` · key string length; new constant
  - `MAX_METADATA_VALUE_LENGTH = 2000` · value string length; new constant (distinct from MAX_NOTES_LENGTH = 4000 to discourage dumping long content into metadata)
  - `MAX_TAGS_PER_VERSION = 50` · enforced in the engine before INSERT (SELECT COUNT first; acceptable at demo scale)
  - `MAX_METADATA_PER_VERSION = 100` · enforced in the engine before INSERT/upsert
  - Tag and key regex: `/^[A-Za-z0-9_\-.:]+$/` (letters, digits, underscore, dash, dot, colon) — colon is explicitly allowed so users can namespace by convention (`status:approved`) per the Area 2 Q1 sub-decision
  - Value: no regex; any UTF-8 string up to the byte cap

### Search Query Shape (ASST-03, ASST-04)

- **D-ASST-12:** `asset.query` input schema (Zod v4 — all fields optional except `action`):
  ```ts
  {
    action: 'query',
    workspace_id?: string,
    project_id?: string,
    sequence_id?: string,
    shot_id?: string,
    tags?: string[],                    // length 1..20; each matches tag regex
    metadata?: Array<{ key: string; value: string }>,  // length 1..20
    date_from?: number,                 // epoch-ms, inclusive
    date_to?: number,                   // epoch-ms, inclusive
    status?: 'submitted' | 'running' | 'completed' | 'failed',
    limit?: number,                     // default 20, max 100 (MAX_PAGE_SIZE)
    offset?: number,                    // default 0
  }
  ```
- **D-ASST-13:** Single-scope XOR validation — **engine boundary**, not a Zod refinement. The tool passes the flat object down; the engine checks that AT MOST ONE of `workspace_id | project_id | sequence_id | shot_id` is present and rejects with `INVALID_SCOPE` + hint `"asset.query accepts at most one of workspace_id|project_id|sequence_id|shot_id — received [<list>]"`. Done in engine so any future non-MCP entry point (function-calling adapter, Phase 5 dashboard REST) inherits the rule.
- **D-ASST-14:** Filter semantics are **AND-only**, enforced both across fields and within fields:
  - Within `tags: ['hero', 'final']` → version must have BOTH tags (two INNER JOINs on `tags` or `EXISTS` subquery per tag)
  - Within `metadata: [{k1,v1}, {k2,v2}]` → version must have BOTH key/value pairs (two EXISTS subqueries)
  - Across fields → all must hold. No OR, no NOT, no nested groups in Phase 4.
  - Rationale: covers 90%+ of real VFX queries ("approved hero shots by Tim from last week"); keeps SQL simple; keeps agent mental model simple.
- **D-ASST-15:** Date range filter:
  - Column: `versions.created_at` (not `completed_at`) — matches VFX "I generated this yesterday" mental model and always-populated field
  - Bounds: `date_from <= created_at AND created_at <= date_to` — inclusive both ends
  - Either bound optional; if both omitted, no date filter applies
  - Rejection: `date_from > date_to` → `INVALID_INPUT` with hint `"date_from must be <= date_to"`
- **D-ASST-16:** Fixed ordering: `ORDER BY versions.created_at DESC, versions.id DESC` (id as tiebreaker for stability when timestamps collide — nanoid order is insertion order but not guaranteed). No `order_by` / `order_dir` input. Rationale: agents almost always want latest-first; configurable ordering inflates the Zod schema + SQL without clear use cases at demo scale.
- **D-ASST-17:** Optional `status` filter (single value, not array). Uses existing `idx_versions_status` index from Phase 2. If omitted, all statuses are returned. Matches the existing `versions.status` column vocabulary (`submitted | running | completed | failed` — no new enum).
- **D-ASST-18:** Pagination inherits D-24: `limit` default 20, cap `MAX_PAGE_SIZE = 100`; `offset` default 0, min 0. `total_count` is computed via a separate `SELECT COUNT(*)` query wrapped in the same transaction as the paged SELECT so the count matches the page state consistently.

### Visibility on version.get / version.list (Success Criterion 1)

- **D-ASST-19:** `version.get` response is **extended** (breaking change to D-PROV-08's shape — acceptable because it's additive: new keys, no removed or renamed keys). New shape:
  ```ts
  {
    entity: Version & { version_label, tags: string[], metadata: Array<{key, value}> },
    breadcrumb: BreadcrumbEntry[],
    breadcrumb_text: string,
  }
  ```
  Tags alphabetical ASC, metadata ASC by key. Always inline — satisfies Success Criterion 1 literally.
- **D-ASST-20:** `version.list` grows two new optional boolean flags on its input schema:
  ```ts
  {
    action: 'list',
    shot_id: string,
    limit?: number,
    offset?: number,
    include_tags?: boolean,      // default false
    include_metadata?: boolean,  // default false
  }
  ```
  When false/omitted, list items are identical to today (cheap payload). When true, each item gains `tags: string[]` and/or `metadata: Array<{key,value}>`. Engine uses GROUP_CONCAT or a follow-up query per page — planner chooses. List-heavy reads stay cheap by default.
- **D-ASST-21:** `version.provenance` (D-PROV-10) — **unchanged**. Tags/metadata are not provenance; they don't appear in the provenance event stream. An agent wanting "everything about this version" calls `version.get` (metadata + tags + entity) AND `version.provenance` (heavy history).
- **D-ASST-22:** `asset.query` result items mirror the `version.get` entity shape (tags + metadata always inline). Unlike `version.list`, the query result is paged-by-intent — if the agent asked `asset.query`, they wanted the asset context. No opt-in flag on `asset.query`; it always returns tags + metadata.

### Error Surface (TOOL-05, extends Phase 1 D-28..D-32 + Phase 2 D-GEN-40..D-GEN-41 + Phase 3 D-PROV-36..D-PROV-37)

- **D-ASST-23:** New typed error codes reserved for Phase 4 (SCREAMING_SNAKE_CASE):
  - `TAG_INVALID` — tag fails length or regex check; hint names the offending tag and the rule
  - `METADATA_INVALID` — key fails length/regex OR value exceeds length cap; hint names the offending key
  - `TAG_LIMIT_EXCEEDED` — >50 tags on a version; hint `"Version <id> already has 50 tags (max). Remove one before adding."`
  - `METADATA_LIMIT_EXCEEDED` — >100 metadata entries on a version; hint `"Version <id> already has 100 metadata entries (max). Remove one before adding."`
  - `INVALID_SCOPE` — `asset.query` / `asset.list_tags` / `asset.list_metadata_keys` received more than one scope field; hint names the conflicting fields
- **D-ASST-24:** Reused Phase 1/2/3 codes that apply: `VERSION_NOT_FOUND` (when mutator references a missing `version_id`); `INVALID_INPUT` (Zod failure, including regex failure on tag/key — re-wrapped per D-32); `DUPLICATE_NAME` does NOT apply (idempotent adds per D-ASST-03 make the concept irrelevant).
- **D-ASST-25:** All Phase 4 errors follow the Phase 1 envelope: `{isError: true, structuredContent: {code, message, hint?}}`. Hints must name the specific identifier that violated the rule (D-30/D-31 consistency).

### Architecture Invariants (extends Phase 1/2/3)

- **D-ASST-26:** Tool-engine separation continues. New `src/tools/asset-tool.ts` is a thin Zod-validated delegate to engine methods; zero business logic. Architecture-purity test is extended to assert `src/store/tag-repo.ts` and `src/store/metadata-repo.ts` have zero MCP imports.
- **D-ASST-27:** Engine composition: new `src/engine/assets.ts` (pure-ish — depends on repos, no MCP, no fs, no HTTP) exposes `addTag`, `removeTag`, `setMetadata`, `removeMetadata`, `queryAssets`, `listTags`, `listMetadataKeys`. `Engine` facade (src/engine/pipeline.ts) delegates. `version.get` and `version.list` hydration (tags/metadata inline) also lives in `src/engine/assets.ts` — exported helper `hydrateVersionWithAssets(version)` called from the existing version pipeline path.
- **D-ASST-28:** Repo pattern continues: new `src/store/tag-repo.ts` (insertTag, deleteTag, listTagsForVersion, listTagsInScope, countTagsForVersion) and `src/store/metadata-repo.ts` (upsertMetadata, deleteMetadata, listMetadataForVersion, listMetadataKeysInScope, countMetadataForVersion). Prepared statements, plain-object returns, typed errors. These are NOT structurally append-only — DELETE methods are expected.
- **D-ASST-29:** Tool-budget test bumps from 6 → 7. Architecture-purity test adds `src/engine/assets.ts` + `src/store/tag-repo.ts` + `src/store/metadata-repo.ts` to the "zero MCP imports" assertion.

### Schema Migration

- **D-ASST-30:** Migration file: `drizzle/0004_phase4_assets.sql`. Additive only:
  - `CREATE TABLE tags (...)` with columns per D-ASST-07 + UNIQUE constraint
  - `CREATE TABLE metadata (...)` with columns per D-ASST-08 + UNIQUE constraint
  - `CREATE INDEX idx_tags_tag ON tags(tag)`
  - `CREATE INDEX idx_metadata_key_value ON metadata(key, value)`
- **D-ASST-31:** Follows the Phase 2/3 additive-split pattern: `SCHEMA_DDL` in `schema.ts` does NOT declare the new tables. On fresh DB: SCHEMA_DDL runs Phase 1 bootstrap → `migrate()` applies 0001 (Phase 2 columns) → 0002 (idx_versions_status) → 0003 (provenance) → 0004 (tags + metadata). Keeps the Phase 1 zero-dep bootstrap path intact.
- **D-ASST-32:** Drizzle ORM declarations: add `tags` and `metadata` `sqliteTable` exports to `src/store/schema.ts` alongside `provenance`. Planner confirms exact column types match the migration DDL via `drizzle-kit` diff at plan-time.

### Testing Strategy

- **D-ASST-33:** Test layers:
  1. **Unit — tag-repo** (`src/store/__tests__/tag-repo.test.ts`): insert/delete/list/count, UNIQUE violation → typed error or idempotent no-op per D-ASST-03, scope-aware listTagsInScope aggregation.
  2. **Unit — metadata-repo** (`src/store/__tests__/metadata-repo.test.ts`): upsert semantics, delete, list, count, scope-aware listMetadataKeysInScope aggregation.
  3. **Unit — assets engine** (`src/engine/__tests__/assets.test.ts`): all 7 operations with valid + invalid inputs; XOR scope validation; AND-only filter semantics; pagination math; date range bounds inclusive; status filter; limit/max caps; `hydrateVersionWithAssets` behavior.
  4. **Integration — asset-tool** (`src/tools/__tests__/asset-tool.test.ts`): all 7 actions, envelope shape, breadcrumb on every response, error wrapping, Zod validation (tag regex, key regex, value cap, limit cap).
  5. **Integration — version-tool extension** (extend `src/tools/__tests__/version-tool.test.ts`): `version.get` returns inline tags + metadata when present and empty arrays when absent; `version.list` default excludes them; `version.list` with `include_tags=true` / `include_metadata=true` includes them.
  6. **Cross-cutting** (extend existing suites): `architecture-purity.test.ts` adds `src/engine/assets.ts`, `src/store/tag-repo.ts`, `src/store/metadata-repo.ts`; `tool-budget.test.ts` bumps 6 → 7; `stdio-hygiene.test.ts` asserts no logged tag/key/value strings (in case users put sensitive data in metadata).
  7. **Query correctness tests** — table-driven scenarios: multi-tag AND, multi-metadata AND, scope + status + date range combined, empty-filter (global) query, 0-result query, pagination across boundaries, scope XOR violation, limit overflow.
  8. **Live smoke** — not required for Phase 4 (no external API calls added). Phase 2/3 live-smoke tests still run; Phase 4 is DB-only work.

### Claude's Discretion

- **Drizzle sqliteTable shape** — planner writes the exact column types; must match the migration DDL one-for-one.
- **Exact SQL shape of AND filters** — pure INNER JOINs vs `EXISTS (SELECT ...)` vs `WHERE id IN (SELECT ...)` — planner picks whatever `EXPLAIN QUERY PLAN` shows best at demo scale. Prefer prepared statements with dynamic `ARRAY_AGG`-equivalent (multiple JOINs or parameterized IN lists) over raw-SQL string concatenation.
- **Engine facade delegation vs composition** — planner decides whether `src/engine/assets.ts` is a class with injected repos or a set of pure functions receiving `AssetsContext` (repos bag). Either fits the Phase 1/2/3 pattern.
- **`hydrateVersionWithAssets` implementation** — single-query with GROUP_CONCAT/json_group_array vs two follow-up queries — planner picks based on SQLite version availability (`json_group_array` is in `better-sqlite3`'s ship-with sqlite).
- **Tag regex exact pattern** — planner may choose `/^[A-Za-z0-9_\-.:]+$/` (locked by decision) and keep it as `TAG_REGEX` export in `shape.ts`.
- **`list_tags` / `list_metadata_keys` input pagination** — agents asking for "all tags in this project" rarely need paging, but the response follows the same `{items, total_count, limit, offset}` envelope for consistency; default `limit=100` acceptable here since the item is tiny.
- **`tags` vs `metadata` nanoid ID prefix exact strings** — `tag_` and `meta_` per Phase 1 D-11 naming pattern.
- **`asset.query` SQL count strategy** — `SELECT COUNT(*) FROM ...` with the same WHERE clause reused (prepared), or window-function `COUNT(*) OVER ()` appended to the paged SELECT. Either is fine; planner picks based on index behavior.
- **Error message phrasing** — planner writes the exact strings; must name specific identifiers per D-30..D-31.
- **When `include_tags` or `include_metadata` is true on `version.list`** — planner decides single GROUP-CONCAT query vs per-item follow-up. Prefer single query at demo scale.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, checker) MUST read these before acting.**

### Prior phase context (hard dependency — load-bearing for Phase 4)

- `.planning/phases/01-foundation-hierarchy/01-CONTEXT.md` — Phase 1 decisions D-01..D-36 all apply: tool naming (D-02), action discrimination (D-04), envelope dual-form (D-25), breadcrumb every response (D-22..D-27), default pagination (D-24), typed error model (D-28..D-32), repo pattern (D-34), tool-engine separation (D-33), nanoid id prefixes (D-11), list envelope `{items, total_count, limit, offset}`. Phase 4 extends, does not restate.
- `.planning/phases/02-comfyui-generation/02-CONTEXT.md` — Phase 2 decisions. Especially: migration tooling (D-GEN-38, D-GEN-39 — additive-only migrations via `drizzle-kit generate`), `idx_versions_status` index (Phase 2's second migration) that Phase 4's `status` filter reuses, DM-03 lesson (don't create redundant fk-only indexes).
- `.planning/phases/03-provenance-versioning/03-CONTEXT.md` — Phase 3 decisions. Especially: `version.get` / `version.list` shapes that Phase 4 extends (D-PROV-08, D-PROV-09); the append-only provenance surface that Phase 4 deliberately does NOT extend (tags/metadata are plain CRUD); the `lineage_type` column on `versions` (D-PROV-33) and `parent_version_id` — not filtered in Phase 4 query but available in response.
- `.planning/phases/01-foundation-hierarchy/01-PATTERNS.md` — Patterns Phase 4 files must reuse: tool shape, envelope, error wrapping, repo shape.

### Project research (MUST read — locks macro decisions)

- `.planning/research/ARCHITECTURE.md` §"MCP Tool Surface" (line 23 — `asset.query` is in the original sketch, confirming the tool name) + §"Database Schema" (lines 386-402 — the ARCHITECTURE.md schema shows `tags` and `metadata` with exactly the shape locked in D-ASST-07..D-ASST-09; Phase 4 is a faithful refinement).
- `.planning/research/PITFALLS.md` §"Pitfall #1 (tool explosion)" (locks D-ASST-01 "one tool, not five") + §"Performance traps" table (line 211 — "Storing all provenance in a single table... Normalize: separate tables for projects, shots, versions, tags" — tags get their own table per that advice).
- `.planning/research/FEATURES.md` §"Asset tagging and metadata" (line 18 — "Key-value metadata store per version. Predefined fields (status, artist, department) plus arbitrary user tags") + §"Search and filter" (line 19 — "SQLite full-text search on tags/metadata. Filter by hierarchy path, date range, status"; Phase 4 scopes to exact match + AND, FTS5 deferred).
- `.planning/research/STACK.md` — Phase 4 adds **no new dependencies**. Continue `better-sqlite3` + `drizzle-orm` + `zod` v4. No `fast-json-patch`, no FTS5 extension, no new query builder.
- `.planning/research/SUMMARY.md` — Executive summary; asset management is listed as a core v1 deliverable.

### Project instructions

- `CLAUDE.md` — Project conventions all still apply: 12-tool cap (D-ASST-01 stays 7/12), nanoid IDs (D-ASST-07/08 `tag_` / `meta_` prefixes), WAL + busy_timeout (already set by Phase 1), SQLite WAL mode, "Error responses must be human-readable with actionable guidance" (D-ASST-23..25), "Paginate all list queries (default 20, include total count)" (D-ASST-18 inherits D-24).
- `.planning/PROJECT.md` — "Asset tagging and arbitrary metadata attachment" + "Asset query/filter by tags, metadata, project hierarchy, date range" are both listed in Active requirements — Phase 4 completes them.
- `.planning/REQUIREMENTS.md` — ASST-01..ASST-05 canonical definitions. All five delivered by the decisions above.
- `.planning/ROADMAP.md` §"Phase 4: Asset Management" — Goal + five success criteria. All five addressed by D-ASST-01..D-ASST-33. Depends-on: Phase 3 (complete pending verification).
- `.planning/STATE.md` — Phase 3 complete; Phase 4 planned starts from the Phase 3 landed schema (0003_phase3_provenance.sql already applied).

### Reference only (not required reading — background)

- **ARCHITECTURE.md** original sketch used `asset.query | asset.search | tag.add | tag.remove | metadata.set` (5 tools). Phase 4's decision (D-ASST-01) consolidates to one `asset` tool with seven actions — matches the research doc's intent but respects D-04 tool budget.
- **FEATURES.md** mentioned FTS5 for search; Phase 4 uses exact match and `LIKE` only. FTS5 is deferred (see Deferred Ideas).

### External specs (no new external specs — Phase 4 is internal DB + MCP work)

- **MCP TypeScript SDK** — https://github.com/modelcontextprotocol/typescript-sdk — v1.29 (locked in Phase 1). No SDK changes needed for Phase 4; `registerTool` pattern reused for `asset`.
- **SQLite json_group_array** — https://www.sqlite.org/json1.html — may be used by the planner for `version.list include_tags` hydration (single-query approach). Available in `better-sqlite3`'s bundled SQLite; no extension load required.

### Project credentials

- None new in Phase 4. `.env` (COMFYUI_API_KEY, COMFYUI_API_BASE) remains untouched — Phase 4 makes no external API calls.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 1/2/3 artefacts Phase 4 builds on)

- **`src/engine/pipeline.ts` — `Engine` facade.** Phase 4 extends with `addTag`, `removeTag`, `setMetadata`, `removeMetadata`, `queryAssets`, `listTags`, `listMetadataKeys`. All delegate to the new `src/engine/assets.ts` module (planner decides class-vs-functions shape). Existing `Engine.getVersion` and `Engine.listVersionsForShot` are extended to hydrate tags/metadata via `hydrateVersionWithAssets` — no signature change, just richer returns.
- **`src/engine/breadcrumb.ts` — `BreadcrumbResolver`.** Already resolves `'version'` (Phase 2 D-GEN-05, Phase 3 reuse). Phase 4 adds no new entity types — tags and metadata inherit the version's breadcrumb on responses.
- **`src/engine/errors.ts` — `TypedError`.** Reused verbatim. Phase 4 adds five new string-literal codes (D-ASST-23).
- **`src/store/schema.ts` — Drizzle sqliteTable declarations.** Phase 4 adds `tags` and `metadata` table declarations alongside the existing `provenance` (Phase 3). `SCHEMA_DDL` below is NOT extended (additive-split pattern — D-ASST-31 matches Phase 2/3 convention).
- **`src/store/db.ts` — migrator hook.** Already runs migrations in order on startup. Phase 4's 0004 migration runs automatically; no db.ts changes needed.
- **`src/store/hierarchy-repo.ts` — hierarchy resolver.** `asset.query` with `project_id` (scope) needs a "find all shots under this project" walk — this is already exposed (used by breadcrumb). `list_tags` / `list_metadata_keys` scope expansion reuses the same scope→shots resolver. Planner adds a helper `resolveScopeToShotIds(scope): string[]` if one doesn't exist.
- **`src/store/version-repo.ts` — `VersionRepo`.** Reused read-only. New `listByFilter(filter)` method supports `asset.query` — planner decides whether this lives in `VersionRepo` or a new `AssetRepo`. `VersionRepo.getById` is the hot path for `version.get`.
- **`src/tools/version-tool.ts` — extend.** Zod input schema grows `include_tags?` / `include_metadata?` on the `list` arm (D-ASST-20). `get` response shape extended to carry tags + metadata inline (D-ASST-19). Handler delegates to the extended engine methods.
- **`src/tools/shape.ts` — shared constants.** New exports: `MAX_TAG_LENGTH = 64`, `MAX_METADATA_KEY_LENGTH = 64`, `MAX_METADATA_VALUE_LENGTH = 2000`, `MAX_TAGS_PER_VERSION = 50`, `MAX_METADATA_PER_VERSION = 100`, `TAG_REGEX = /^[A-Za-z0-9_\-.:]+$/`.
- **`src/tools/envelope.ts` + `shapeList` (in shape.ts).** Reused directly for all Phase 4 responses.
- **`src/test-utils/fake-engine.ts` + `fixtures.ts`.** Extended with tag/metadata fakes: fake `queryAssets`, fake `addTag`, sample version-with-tags fixtures, sample metadata maps.

### Established Patterns (Phase 4 must match)

- **Tool file shape** — Zod input schema, action-discriminated union, thin delegate to engine. New `asset-tool.ts` mirrors `generation-tool.ts` (7 actions — the largest union so far; still acceptable because each branch is a one-line delegate).
- **Repo shape** — `better-sqlite3` prepared statements, plain typed return objects, UNIQUE violation → typed error (D-13 reuses for idempotent path: `INSERT ... ON CONFLICT DO NOTHING` returns success; only real surprises raise). `tag-repo.ts` and `metadata-repo.ts` follow this exactly; both expose DELETE methods (unlike `provenance-repo.ts` which structurally does not).
- **Engine shape** — constructor-injected repos, zero MCP imports. New `src/engine/assets.ts` imports `TagRepo`, `MetadataRepo`, `VersionRepo`, `HierarchyRepo`. Architecture-purity asserts no MCP imports.
- **Response envelope** — Phase 1 D-25 dual-form with breadcrumb on every response. All seven Phase 4 actions emit `{structuredContent, content: [text]}`. `asset.query` envelope reuses `shapeList`; mutators reuse `shapeCreateOrGet`-style (but with extended version entity per D-ASST-04).
- **Error wrapping** — typed code, no raw Zod / SQLite errors leak (D-28..D-32 + D-GEN-41 + D-PROV-37). Zod validation failures continue to re-wrap as `INVALID_INPUT` per D-32.
- **Architecture-purity test** — extend `src/__tests__/architecture-purity.test.ts` to assert `src/engine/assets.ts`, `src/store/tag-repo.ts`, `src/store/metadata-repo.ts` have zero MCP imports.
- **Tool-budget test** — update expected count from 6 → 7.
- **Additive-split migration pattern** — `SCHEMA_DDL` in `schema.ts` stays at Phase 1 shape; migrations 0001, 0002, 0003, 0004 layer additively on both fresh and upgraded DBs. Phase 4 migration follows this exactly.

### Integration Points

- **`src/store/schema.ts` — extend.** Add `tags` and `metadata` `sqliteTable` declarations (alongside `provenance`). Do NOT extend `SCHEMA_DDL` (additive-split pattern).
- **`drizzle/0004_phase4_assets.sql` — NEW.** Creates `tags` + `metadata` tables + two indexes (`idx_tags_tag`, `idx_metadata_key_value`). Additive only. Planner runs `drizzle-kit generate` to produce this (adjusting the file name if drizzle-kit picks a slug).
- **`drizzle/meta/_journal.json` — extend.** Drizzle-kit adds the 0004 entry automatically on `generate`.
- **`src/store/tag-repo.ts` — NEW.** `TagRepo`: `insertTag(versionId, tag) → {id} (idempotent on UNIQUE)`, `deleteTag(versionId, tag) → void (no-op on missing)`, `listTagsForVersion(versionId) → string[]`, `listTagsInScope(scope) → Array<{name, count}>`, `countTagsForVersion(versionId) → number`. Prepared statements, plain objects, typed errors on FK violations (e.g. unknown version_id → `VERSION_NOT_FOUND`).
- **`src/store/metadata-repo.ts` — NEW.** `MetadataRepo`: `upsertMetadata(versionId, key, value) → {id}`, `deleteMetadata(versionId, key) → void (no-op on missing)`, `listMetadataForVersion(versionId) → Array<{key, value}>`, `listMetadataKeysInScope(scope) → Array<{name, count}>`, `countMetadataForVersion(versionId) → number`. Prepared statements, UPSERT via `INSERT ... ON CONFLICT(version_id, key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`.
- **`src/engine/assets.ts` — NEW.** Core engine module for Phase 4. Methods/functions: `addTag`, `removeTag`, `setMetadata`, `removeMetadata`, `queryAssets`, `listTags`, `listMetadataKeys`, and the helper `hydrateVersionWithAssets`. Validates inputs (scope XOR, caps, regex), applies AND-only filter logic, composes repos.
- **`src/engine/pipeline.ts` — extend.** `Engine` facade adds the seven `asset` operations + hydrates tags/metadata in `getVersion` and `listVersionsForShot` when applicable (list hydration gated by the new include flags).
- **`src/tools/asset-tool.ts` — NEW.** Registers `asset` MCP tool with the seven-action discriminated Zod union. Delegates to `engine.addTag` etc. Breadcrumb via existing envelope helpers. Follows the `generation-tool.ts` shape but for 7 actions.
- **`src/tools/version-tool.ts` — extend.** `get` response extended with tags + metadata arrays. `list` Zod schema extended with `include_tags?`/`include_metadata?`; when either is true, each item carries the array(s).
- **`src/tools/index.ts` — extend.** Export `registerAsset` alongside existing `registerGeneration`, `registerVersion`, etc.
- **`src/server.ts` — extend.** Register the new `asset` tool. No other changes.
- **`src/types/hierarchy.ts` — extend.** Add `Tag`, `MetadataEntry` types. `Version` type grows optional `tags?: string[]` and `metadata?: Array<{key,value}>` for the hydrated shape (or an extended `VersionWithAssets` type — planner picks).
- **`src/types/assets.ts` — NEW (optional).** `AssetsQueryFilter`, `AssetsQueryResult`, `TagCount`, `MetadataKeyCount` types. May be folded into hierarchy.ts if small enough.
- **`src/tools/shape.ts` — extend.** New max-length constants + TAG_REGEX (D-ASST-11).
- **`src/test-utils/fixtures.ts` — extend.** Sample versions-with-tags, metadata maps, filter combinations (AND multi-tag, AND multi-metadata, scope variants, date ranges, status filter).

### Build Order (Phase 4 subset — respects layering)

```
1. drizzle/0004_phase4_assets.sql + schema.ts sqliteTable declarations
2. src/tools/shape.ts (add new constants + TAG_REGEX)
3. src/types/hierarchy.ts (or new src/types/assets.ts) — Tag, MetadataEntry, AssetsQueryFilter types
4. src/store/tag-repo.ts (CRUD + idempotent insert + scope aggregation)
5. src/store/metadata-repo.ts (UPSERT + scope aggregation)
6. src/engine/assets.ts (validation, AND-only filter, hydration helper)
7. src/engine/pipeline.ts (extend Engine facade)
8. src/tools/asset-tool.ts (NEW tool registration, 7-action discriminated union)
9. src/tools/version-tool.ts (extend get response + list include flags)
10. src/tools/index.ts + src/server.ts (wire new tool)
11. Tests (unit first, then tool, then cross-cutting; no live-smoke for Phase 4)
```

</code_context>

<specifics>
## Specific Values (reproduce verbatim)

- **New tool name:** `asset` (lowercase, noun, snake_case, no prefix)
- **New `asset` actions:** `'add_tag' | 'remove_tag' | 'set_metadata' | 'remove_metadata' | 'query' | 'list_tags' | 'list_metadata_keys'`
- **Tool count after Phase 4:** 7 of 12 (`workspace`, `project`, `sequence`, `shot`, `generation`, `version`, `asset`)
- **New table names:** `tags` (plural), `metadata` (mass noun) — match ARCHITECTURE.md
- **New ID prefixes (per Phase 1 D-11):** `tag_` for tags table, `meta_` for metadata table
- **New typed error codes:** `TAG_INVALID`, `METADATA_INVALID`, `TAG_LIMIT_EXCEEDED`, `METADATA_LIMIT_EXCEEDED`, `INVALID_SCOPE`
- **New shape.ts constants:** `MAX_TAG_LENGTH = 64`, `MAX_METADATA_KEY_LENGTH = 64`, `MAX_METADATA_VALUE_LENGTH = 2000`, `MAX_TAGS_PER_VERSION = 50`, `MAX_METADATA_PER_VERSION = 100`, `TAG_REGEX = /^[A-Za-z0-9_\-.:]+$/`
- **Mutation semantics:** all mutators idempotent (add_tag no-op on dup; remove_tag no-op on missing; set_metadata upserts; remove_metadata no-op on missing)
- **Filter semantics:** AND-only, cross-field and within-field
- **Scope:** exactly one of `workspace_id | project_id | sequence_id | shot_id` (or none = global); validated at engine boundary
- **Date range column:** `versions.created_at` (NOT `completed_at`)
- **Date range bounds:** `date_from <= created_at AND created_at <= date_to` (inclusive both ends; either optional)
- **Fixed ordering:** `ORDER BY versions.created_at DESC, versions.id DESC`
- **Status filter values:** `'submitted' | 'running' | 'completed' | 'failed'` (reuses existing `versions.status` vocabulary)
- **Pagination defaults:** `limit = 20` (D-24); cap `MAX_PAGE_SIZE = 100`; `offset = 0` min 0
- **`version.get` response extension:** always `{entity: {...Version, version_label, tags: string[], metadata: Array<{key,value}>}, breadcrumb, breadcrumb_text}`; tags ASC alphabetical, metadata ASC by key
- **`version.list` new optional inputs:** `include_tags?: boolean` (default false), `include_metadata?: boolean` (default false)
- **`asset.query` input keys:** `action: 'query'`, optional `workspace_id | project_id | sequence_id | shot_id` (XOR), `tags?: string[]` (max 20), `metadata?: Array<{key, value}>` (max 20), `date_from?`, `date_to?`, `status?`, `limit?`, `offset?`
- **`asset.list_tags` response item shape:** `{name: string, count: number}`; ordered by `count DESC, name ASC`
- **`asset.list_metadata_keys` response item shape:** `{name: string, count: number}`; ordered by `count DESC, name ASC`
- **Migration file:** `drizzle/0004_phase4_assets.sql`
- **Recommended indexes:** `CREATE INDEX idx_tags_tag ON tags(tag)` + `CREATE INDEX idx_metadata_key_value ON metadata(key, value)` — no redundant fk-only indexes (DM-03 lesson)
- **Tag table DDL shape:** `CREATE TABLE tags (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES versions(id), tag TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(version_id, tag))`
- **Metadata table DDL shape:** `CREATE TABLE metadata (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES versions(id), key TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(version_id, key))`
- **Upsert SQL for `set_metadata`:** `INSERT INTO metadata (...) VALUES (...) ON CONFLICT(version_id, key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
- **Idempotent insert SQL for `add_tag`:** `INSERT INTO tags (...) VALUES (...) ON CONFLICT(version_id, tag) DO NOTHING`

</specifics>

<deferred>
## Deferred Ideas

Surfaced during discussion. Not in Phase 4 scope — preserved so they aren't lost.

- **FTS5 full-text search on tag + metadata values** — ARCHITECTURE.md mentioned SQLite FTS5. Phase 4 uses exact match only. FTS5 is an additive layer (virtual table + triggers) that can ship when the dashboard needs "search all versions mentioning 'fire'" — likely Phase 5+ or v1.x.
- **Namespaced tags / category+value tags / typed metadata values** — Users can namespace by convention today (`status:approved` as a plain string). Explicit namespace splitting or typed value columns ship when a real workflow demands them.
- **Tag rename operation** — v1 uses remove + re-add. A batch `rename_tag(old, new, scope)` ships if studios need to correct taxonomy across many versions.
- **OR-grouping and NOT filters on `asset.query`** — Phase 4 is AND-only. OR / NOT / nested boolean groups ship if real workflows hit the 10% case (e.g. "hero shots not yet approved"). Elasticsearch-style bool query is probably over-engineered.
- **Wildcard / glob hierarchy scope** — `project_id = '*'` or breadcrumb-path shorthand like `'ws/*/seq/*'`. Cute but fragile; single-scope XOR covers the 95% case.
- **Configurable ordering on `asset.query`** — `order_by: 'created_at'|'completed_at'|'version_number'` + `order_dir`. Fixed `created_at DESC` handles most cases; custom ordering ships if the dashboard exposes sortable columns.
- **Facet aggregation bundled into `asset.query` response** — `facets: true` returning `{tags: {name: count}, metadata_keys: {key: count}}` alongside items. Phase 4 exposes the two `list_*` actions instead; an explicit facet mode in `query` is a Phase 5 optimization if the dashboard hits the N+1 pattern.
- **Tag/metadata change audit trail** — `asset_events` table or `deleted_at` soft-delete on rows. Provenance (PROV-03) is append-only; tags/metadata are plain CRUD (D-ASST-10). If a studio needs "who changed this tag when" for compliance, a layered audit table is additive.
- **Cross-entity tagging** — Tagging a sequence or shot directly (not through versions). Phase 4 scopes to versions only (ASST-03 wording). Entity-level tagging is a schema expansion (new tables with FKs to shots/sequences/projects) shipped on demand.
- **Tag search from within a tag** — substring match (`LIKE '%hero%'`) on tag names. Phase 4 uses exact match; `LIKE` or FTS5 layered later.
- **Status filter as array** — `status?: Array<...>` for "completed OR failed". Phase 4 single-value; array ships with OR semantics if v1.x demands.
- **Multi-column `ORDER BY`** — e.g. `ORDER BY status, created_at DESC` for "failed at top, completed grouped below". Fixed ordering covers demo.
- **Tag hierarchy / inheritance** — shots inherit tags from their parent sequence, versions from their parent shot. Adds complexity; ASST-01 is explicit about tags on versions.
- **Auto-tag on submission** — "apply the tags from the current shot to every new version." Workflow automation; agent can do this today by calling add_tag after submit.
- **Metadata values as structured JSON** — Current `value TEXT NOT NULL` stores any string. Structured JSON with `json_extract()` queries ships if real workflows need typed values.
- **Per-version-type default metadata schema** — "Every version of type X must have metadata keys A, B, C." Schema-like constraints are a governance feature, not core v1.
- **`version.delete` / `version.archive`** — Still out of scope (Phase 3 deferred). Tags/metadata survive FK constraint intact because version rows stay.
- **Metadata value search by partial match** — `LIKE '%tim%'` on artist values. Phase 4 uses `= ?` exact match; partial match layered if workflows demand.
- **Atomic batch tag operations** — `add_tags(version_id, tags: string[])` single transaction. Phase 4 is one action per tag; batch ships if a real workflow batches tag operations.
- **Per-project tag vocabulary (allowed tag list)** — Tag governance is out of scope; any string matching the regex is allowed.
- **MCP tool descriptions that cite the tag regex and caps** — planner writes concise descriptions; Pitfall #1 (token budget) applies.
- **Structured logger** — Still `console.error`. Bump to `pino` when surface area justifies; same call as Phase 1/2/3.

</deferred>

---

*Phase: 04-asset-management*
*Context gathered: 2026-04-22 via /gsd-discuss-phase*
