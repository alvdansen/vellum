# Phase 4: Asset Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 04-asset-management
**Areas discussed:** Tool surface design, Data model (tags + metadata), Search query shape, Visibility on version.get/list

---

## Gray Area Selection

**Question:** Which Phase 4 gray areas do you want to discuss for Asset Management?

| Option | Description | Selected |
|--------|-------------|----------|
| Tool surface design | One coarse tool vs extending version vs three separate tools | ✓ |
| Data model (tags + metadata) | Tag shape, metadata shape, mutability, caps | ✓ |
| Search query shape | Filter semantics, scope, date range, ordering | ✓ |
| Visibility on version.get/list | How tags + metadata surface on existing responses | ✓ |

**User's choice:** All four areas selected.

---

## Tool surface design

### Q1: How should Phase 4's tool surface be organized?

| Option | Description | Selected |
|--------|-------------|----------|
| One `asset` tool | Single tool with 5 actions (add_tag, remove_tag, set_metadata, remove_metadata, query); tool count 7/12 | ✓ |
| `version` extension + `query` tool | Extend version tool with tag/metadata actions + new query tool | |
| Separate `tag` + `metadata` + `query` | 3 separate tools; tool count 9/12 — closer to Pitfall #1 warning | |

**User's choice:** One `asset` tool.
**Notes:** Clean domain boundary, minimal tool footprint, respects D-04 budget (~2 reserved for Phase 4 query).

### Q2: Should `asset` expose discovery (list_tags / list_metadata_keys)?

| Option | Description | Selected |
|--------|-------------|----------|
| Add `list_tags` + `list_metadata_keys` | Two extra actions, hierarchy-scoped, distinct names + counts; 7 total actions | ✓ |
| Fold into `query` | `facets: boolean` flag on query; heavier query response | |
| Defer | No discovery in Phase 4; agent guesses or scans | |

**User's choice:** Add `list_tags` + `list_metadata_keys`.
**Notes:** Agent ergonomics — autocomplete before filtering. Final action count: 7.

### Q3: Semantics for mutating actions — idempotent or strict?

| Option | Description | Selected |
|--------|-------------|----------|
| Idempotent | add no-op on dup, remove no-op on missing, set_metadata upserts | ✓ |
| Strict | Typed errors on "already exists" / "not found" | |
| Hybrid | Adds idempotent, removes strict | |

**User's choice:** Idempotent.
**Notes:** Retry-safe, no branching on routine ops. Provenance stays the lone immutable surface; tags/metadata are state, not lineage.

---

## Data model (tags + metadata)

### Q1: Tag data model — what shape goes in the `tags` table?

| Option | Description | Selected |
|--------|-------------|----------|
| Plain string tags | `tags(id, version_id, tag, created_at, UNIQUE(version_id, tag))` | ✓ |
| Namespaced by convention | Same schema, internal split on `:` for indexing | |
| Explicit category + value | Separate category + value columns | |

**User's choice:** Plain string tags.
**Notes:** Users can namespace by convention (`status:approved`) since colon is in the allowed regex. Matches ARCHITECTURE.md.

### Q2: Metadata value representation — how are key-value pairs stored?

| Option | Description | Selected |
|--------|-------------|----------|
| Flat TEXT value | `value TEXT NOT NULL`, always string | ✓ |
| value_json with typed coercion | JSON-encoded values, `json_extract()` queries | |
| Typed columns | value_text / value_number / value_bool / value_json | |

**User's choice:** Flat TEXT value.
**Notes:** Spec says "arbitrary key-value", not "arbitrary JSON". Simplest, supports common exact-match queries.

### Q3: Append-only audit trail for tag/metadata changes, or plain CRUD?

| Option | Description | Selected |
|--------|-------------|----------|
| Plain CRUD | Tags/metadata are mutable; DELETE allowed; no history | ✓ |
| Append-only with soft-delete | `deleted_at` column; query filters `WHERE deleted_at IS NULL` | |
| Append-only event table | `asset_events` mirroring `provenance` pattern | |

**User's choice:** Plain CRUD.
**Notes:** ASST-01 explicitly says "add and remove"; provenance (PROV-03) remains the lone append-only surface.

### Q4: Bounds on tag/metadata inputs

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative demo caps | Tag/key 1-64 chars, value 2000, max 50 tags / 100 metadata per version | ✓ |
| Permissive (shape.ts defaults) | Tag/key 1-200, value 4000, no per-version cap | |
| Minimal — just non-empty | Tag/key 1-200 any chars, value 10000, no caps | |

**User's choice:** Conservative demo caps.
**Notes:** New shape.ts constants: MAX_TAG_LENGTH=64, MAX_METADATA_KEY_LENGTH=64, MAX_METADATA_VALUE_LENGTH=2000, MAX_TAGS_PER_VERSION=50, MAX_METADATA_PER_VERSION=100. Regex `[A-Za-z0-9_\-.:]+` allows namespace-by-convention.

---

## Search query shape

### Q1: Filter combination semantics

| Option | Description | Selected |
|--------|-------------|----------|
| AND-only (cross-field + within-field) | All filters AND; multi-tag means "has BOTH" | ✓ |
| AND across fields, OR within field | Multi-tag means "has ONE OF" | |
| Explicit boolean grouping | `{any: [...]}, {all: [...]}` Elasticsearch-style | |

**User's choice:** AND-only (cross-field + within-field).
**Notes:** Covers 90% of real VFX queries; simplest SQL; simplest agent mental model.

### Q2: Hierarchy scoping on `asset.query`

| Option | Description | Selected |
|--------|-------------|----------|
| Single scope field (most-specific wins) | XOR of workspace_id / project_id / sequence_id / shot_id; or none | ✓ |
| Multiple scope fields (all ANDed) | All optional, all ANDed, must validate consistency | |
| Breadcrumb-path shorthand | `scope: 'ws/proj/seq/shot'` with wildcards | |

**User's choice:** Single scope field (most-specific wins).
**Notes:** XOR validated at engine boundary; new error `INVALID_SCOPE` on violation.

### Q3: Date range filter

| Option | Description | Selected |
|--------|-------------|----------|
| `created_at` only, `date_from` + `date_to` | Epoch-ms inclusive bounds | ✓ |
| Choice of column + range | `date_field` picks `created_at` or `completed_at` | |
| Relative strings | `'7d'`, `'24h'` server-parsed | |

**User's choice:** `created_at` only, `date_from` + `date_to`.
**Notes:** Inclusive both ends; either bound optional.

### Q4: Result ordering + status filter

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed: created_at DESC, status filter optional | Single status value; fixed order | ✓ |
| Configurable ordering + status array | `order_by`, `order_dir`, status OR list | |
| Fixed ordering, no status filter | No status at all | |

**User's choice:** Fixed: created_at DESC, status filter optional.
**Notes:** ORDER BY created_at DESC, versions.id DESC (tiebreaker). Status single-value, reuses `idx_versions_status`.

---

## Visibility on version.get / version.list

### Q1: How do tags and metadata appear on existing `version.get` / `version.list` responses?

| Option | Description | Selected |
|--------|-------------|----------|
| Always inline on `version.get`; opt-in on `version.list` | `include_tags` / `include_metadata` flags on list | ✓ |
| Always inline on both | Every list item always has tags/metadata | |
| Separate actions only (no inline) | `asset.query {version_id}` | |

**User's choice:** Always inline on `version.get`; opt-in on `version.list`.
**Notes:** Satisfies Success Criterion 1 literally; list reads stay cheap by default.

### Q2: Shape of tags/metadata inside results

| Option | Description | Selected |
|--------|-------------|----------|
| Arrays of simple shapes | `tags: string[]`, `metadata: Array<{key, value}>` | ✓ |
| Tags array + metadata as object | `metadata: Record<string, string>` | |
| Full rows | `metadata: Array<{id, key, value, created_at}>` | |

**User's choice:** Arrays of simple shapes.
**Notes:** Tags ASC alphabetical, metadata ASC by key. Stable ordering, JSON-friendly, no reserved-word issues.

---

## Claude's Discretion

- Drizzle sqliteTable shape — planner writes exact column types
- Exact SQL of AND filters (INNER JOIN vs EXISTS vs IN) — planner picks based on EXPLAIN QUERY PLAN
- Engine facade delegation vs composition
- `hydrateVersionWithAssets` implementation (single query with json_group_array vs follow-up queries)
- Tag regex exact pattern (locked to `/^[A-Za-z0-9_\-.:]+$/` by decision)
- `list_tags` / `list_metadata_keys` input pagination defaults
- `asset.query` count strategy (separate COUNT vs window function)
- Exact error message phrasing
- `version.list` hydration strategy when include_* is true

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. Notable items:
- FTS5 full-text search on tag/metadata values
- Namespaced tags / typed metadata values
- Tag rename operation
- OR-grouping, NOT filters, nested boolean groups
- Configurable ordering, facet aggregation in query response
- Cross-entity tagging (shot/sequence tags)
- Tag/metadata change audit trail
- Status filter as array
- Atomic batch tag operations
- Per-project tag vocabulary governance
