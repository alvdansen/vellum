---
phase: 04-asset-management
plan: 01
subsystem: database
tags: [sqlite, drizzle, migration, schema, types, typescript, nanoid]

# Dependency graph
requires:
  - phase: 01-foundation-hierarchy
    provides: "Base hierarchy tables (workspaces/projects/sequences/shots/versions), SCHEMA_DDL zero-dep bootstrap, nanoid prefix pattern, TypedError model, Zod tool-input bounds in shape.ts"
  - phase: 02-comfyui-generation
    provides: "drizzle-kit additive migration pattern (0001, 0002), idx_versions_status, versions status column vocabulary used by Phase 4 status filter"
  - phase: 03-provenance-versioning
    provides: "Migration 0003 precedent (hand-curated IDM-03 header + statement-breakpoint), provenance-repo structural append-only pattern (Phase 4 is opposite: plain CRUD), lineage_type column on versions"
provides:
  - "drizzle/0004_phase4_assets.sql — additive migration creating tags + metadata tables + idx_tags_tag + idx_metadata_key_value + two UNIQUE autoindexes"
  - "src/store/schema.ts — new tags + metadata sqliteTable declarations (additive-split pattern — NOT added to SCHEMA_DDL)"
  - "src/utils/id.ts — IdPrefix union extended with 'tag' and 'meta'"
  - "src/engine/errors.ts — ErrorCode union extended with TAG_INVALID, METADATA_INVALID, TAG_LIMIT_EXCEEDED, METADATA_LIMIT_EXCEEDED, INVALID_SCOPE"
  - "src/tools/shape.ts — six Phase 4 bounds constants + TAG_REGEX (MAX_TAG_LENGTH, MAX_METADATA_KEY_LENGTH, MAX_METADATA_VALUE_LENGTH, MAX_TAGS_PER_VERSION, MAX_METADATA_PER_VERSION, TAG_REGEX)"
  - "src/types/assets.ts — pure-TS type definitions (Tag, MetadataEntry, MetadataKV, VersionWithAssets, AssetsQueryFilter, ScopeFilter, TagCount, MetadataKeyCount) — zero drizzle/zod/mcp imports"
  - "Phase 4 foundational surface unblocking Plans 02-05 (repos, engine, tool layer)"
affects: [04-02, 04-03, 04-04, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-split migration pattern continues: Phase 4 tables live in migration SQL only; SCHEMA_DDL remains at Phase 1 shape"
    - "Pure-TS types file separation (src/types/assets.ts) — mirrors src/types/provenance.ts shape for Phase 3; zero drizzle/zod/mcp imports"
    - "drizzle-kit roundtrip parity: schema.ts → generate → 0004.sql → generate (no-op) confirms zero structural delta"

key-files:
  created:
    - "drizzle/0004_phase4_assets.sql"
    - "drizzle/meta/0004_snapshot.json"
    - "src/types/assets.ts"
  modified:
    - "drizzle/meta/_journal.json"
    - "src/store/schema.ts"
    - "src/utils/id.ts"
    - "src/engine/errors.ts"
    - "src/tools/shape.ts"
    - "src/store/__tests__/migrate.test.ts"

key-decisions:
  - "[Plan 04-01] drizzle-kit generated 0004_phase4_assets.sql accepted verbatim; IDM-03 header comment prepended to match Phase 3 precedent (no content change)"
  - "[Plan 04-01] EXPECTED_MIGRATIONS bumped from 3 to 4 in migrate.test.ts — Rule 3 blocking fix required by the new migration"
  - "[Plan 04-01] SQLite PRAGMA table_info returns column types uppercased (TEXT/INTEGER) regardless of DDL casing — Phase 4 test assertions use case-insensitive comparison (.toUpperCase())"
  - "[Plan 04-01] drizzle-kit roundtrip confirmed zero structural delta: schema.ts → generate → 0004.sql → generate says 'No schema changes, nothing to migrate'"
  - "[Plan 04-01] src/types/hierarchy.ts left UNCHANGED per D-ASST-21/D-ASST-22 — asset hydration uses VersionWithAssets extension type, not Version mutation"

patterns-established:
  - "Additive-split migration: Phase 4 tables in 0004.sql + schema.ts declarations, NEVER in SCHEMA_DDL — matches Phase 2/3 convention, confirmed by existing Phase 1-only upgrade regression test still passing"
  - "Pure-TS type co-location by phase: src/types/assets.ts mirrors src/types/provenance.ts (Phase 3), each phase gets its own types file; cross-phase types imported from hierarchy.ts"
  - "5-assertion migration regression test pattern: column list, PK/NOTNULL, explicit indexes, UNIQUE autoindexes (flexible on naming convention), FK constraints — mirrors Phase 3 migration test layout"

requirements-completed: [ASST-01, ASST-02, ASST-03, ASST-04, ASST-05]

# Metrics
duration: 10min
completed: 2026-04-23
---

# Phase 4 Plan 01: Schema Foundation Summary

**Additive Drizzle migration 0004 + tags/metadata sqliteTable declarations + Phase 4 bounds constants, error codes, ID prefixes, and pure-TS asset types — zero runtime behavior changes, full foundation for Plans 02-05.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-23T05:20:29Z
- **Completed:** 2026-04-23T05:30:20Z
- **Tasks:** 3
- **Files modified:** 9 (3 created, 6 extended)

## Accomplishments

- `drizzle/0004_phase4_assets.sql` generated via `drizzle-kit generate --name phase4_assets`; IDM-03 rollback header prepended; journal + snapshot auto-emitted by drizzle-kit
- `src/store/schema.ts` extended with `tags` and `metadata` sqliteTable declarations; `SCHEMA_DDL` intentionally untouched (additive-split pattern — D-ASST-31)
- `drizzle-kit` roundtrip confirmed zero structural delta: schema.ts ↔ 0004.sql in perfect parity (`No schema changes, nothing to migrate`)
- Phase 4 bounds constants + TAG_REGEX exported from `src/tools/shape.ts`; five new typed error codes in `src/engine/errors.ts`; two new nanoid prefixes (`tag`, `meta`) in `src/utils/id.ts`
- New `src/types/assets.ts` exports the seven Phase 4 type definitions downstream plans require: `Tag`, `MetadataEntry`, `MetadataKV`, `VersionWithAssets`, `AssetsQueryFilter`, `ScopeFilter`, `TagCount`, `MetadataKeyCount` (the alias) — zero drizzle/zod/mcp imports
- `src/store/__tests__/migrate.test.ts` extended with a `describe('phase 4 migration 0004', ...)` block of 5 new assertions covering tags + metadata column shape, explicit indexes, UNIQUE autoindexes, and FK constraints; all 17 migrate-suite tests pass
- `src/types/hierarchy.ts` confirmed UNCHANGED (`git diff` empty) per D-ASST-21/D-ASST-22
- Full vitest suite: **467 tests passing** (up from 462, +5 new Phase 4 assertions), **0 regressions**, 2 pre-existing skips unchanged
- `npx tsc --noEmit` passes

## Task Commits

Each task committed atomically:

1. **Task 1: Migration 0004 + schema.ts tags/metadata tables** — `29a317b` (feat)
2. **Task 2: id.ts, errors.ts, shape.ts, types/assets.ts extensions** — `214a548` (feat)
3. **Task 3: migrate.test.ts Phase 4 assertions** — `9010bbc` (test)

## Files Created/Modified

- `drizzle/0004_phase4_assets.sql` (created) — Additive migration: CREATE TABLE tags + metadata; CREATE INDEX idx_tags_tag + idx_metadata_key_value; UNIQUE autoindexes on (version_id, tag) and (version_id, key); FK version_id → versions(id) on both tables
- `drizzle/meta/0004_snapshot.json` (created) — Drizzle schema snapshot at post-0004 state (auto-generated by drizzle-kit)
- `drizzle/meta/_journal.json` (modified) — Append idx 4 entry `{tag: "0004_phase4_assets", when: 1776921667014}`
- `src/store/schema.ts` (modified) — Add `tags` and `metadata` sqliteTable declarations between provenance and SCHEMA_DDL; SCHEMA_DDL body unchanged
- `src/utils/id.ts` (modified) — Extend `IdPrefix` union with `'tag' | 'meta'`
- `src/engine/errors.ts` (modified) — Extend `ErrorCode` union with TAG_INVALID, METADATA_INVALID, TAG_LIMIT_EXCEEDED, METADATA_LIMIT_EXCEEDED, INVALID_SCOPE (Phase 4 — D-ASST-23 section)
- `src/tools/shape.ts` (modified) — Add MAX_TAG_LENGTH (64), MAX_METADATA_KEY_LENGTH (64), MAX_METADATA_VALUE_LENGTH (2000), MAX_TAGS_PER_VERSION (50), MAX_METADATA_PER_VERSION (100), TAG_REGEX (`/^[A-Za-z0-9_\-.:]+$/`) — no changes to existing exports or shapers
- `src/types/assets.ts` (created) — 72 lines of pure TypeScript type definitions; only import is `Version` from `./hierarchy.js`
- `src/store/__tests__/migrate.test.ts` (modified) — Bump EXPECTED_MIGRATIONS 3 → 4; import `it` alongside `test`; add `describe('phase 4 migration 0004', ...)` block with 5 assertions

## Decisions Made

- Accepted drizzle-kit's default statement ordering (metadata CREATE TABLE before tags CREATE TABLE, and explicit INDEX before UNIQUE autoindex) rather than re-ordering to match the plan's verbatim interface block. Rationale: drizzle-kit output is canonical; re-ordering would drift schema.ts ↔ SQL and fail the roundtrip parity check. Structural content matches plan exactly (4 tables, 2 explicit indexes, 2 UNIQUE autoindexes, 2 FK references) — only the statement order differs.
- Imported `it` alongside `test` in migrate.test.ts (Vitest aliases them identically). Phase 2/3 blocks continue using `test`; Phase 4 assertions use `it` — matches the shape of the test scaffold the plan's `<action>` block specified.
- Column-type assertions use `.toUpperCase()` comparison because SQLite normalizes `PRAGMA table_info` types to uppercase regardless of DDL casing. Existing Phase 2/3 tests follow the same convention (see line 50 — `.type.toUpperCase()`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest `--reporter=basic` no longer supported in Vitest 4.1.4**
- **Found during:** Task 1 verification
- **Issue:** The plan's `<verify>` block invoked `npx vitest run ... --reporter=basic`; Vitest 4 removed the `basic` reporter alias, producing `ERR_LOAD_URL: Failed to load url basic`
- **Fix:** Dropped the `--reporter=basic` flag — default reporter produces sufficient output for test verification. No code change required, just a test-invocation change.
- **Files modified:** none (invocation-only change, not a source edit)
- **Verification:** `npx vitest run src/store/__tests__/migrate.test.ts` executes cleanly and reports pass/fail per test
- **Committed in:** — (invocation adjustment, no file delta)

**2. [Rule 3 - Blocking] EXPECTED_MIGRATIONS hardcoded to 3 blocks Task 1 verification**
- **Found during:** Task 1 verification
- **Issue:** `src/store/__tests__/migrate.test.ts` line 14 defines `const EXPECTED_MIGRATIONS = 3`; three existing Phase 2/3 tests assert `row.n === EXPECTED_MIGRATIONS`. Adding migration 0004 makes `__drizzle_migrations` row count become 4, failing all three tests.
- **Fix:** Bump `EXPECTED_MIGRATIONS` from 3 to 4 and update the associated comment to reference the new Phase 4 migration. Bundled into Task 1 commit because the fix is directly caused by the new migration file.
- **Files modified:** `src/store/__tests__/migrate.test.ts`
- **Verification:** All 12 existing migrate tests pass post-fix; full suite at 462 green pre-Task-3
- **Committed in:** `29a317b` (Task 1 commit)

**3. [Rule 1 - Bug] PRAGMA table_info type case mismatch in new Phase 4 assertions**
- **Found during:** Task 3 verification
- **Issue:** Wrote `expect(byName.id.type).toBe('text')` but SQLite returns `'TEXT'` (uppercase). Two of the five new Phase 4 tests initially failed with `expected 'TEXT' to be 'text'`.
- **Fix:** Switch to `.toUpperCase().toBe('TEXT')` / `.toBe('INTEGER')` — matches the established convention in the Phase 2 migration test at line 50 (`.type.toUpperCase()`).
- **Files modified:** `src/store/__tests__/migrate.test.ts`
- **Verification:** All 17 migrate tests pass; full suite at 467 green
- **Committed in:** `9010bbc` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All three are minor execution adjustments that did not change the plan's shape. EXPECTED_MIGRATIONS and the reporter flag are tooling drift; PRAGMA case is a platform convention I should have matched from the existing Phase 2/3 tests. No scope creep; no deviation from the D-ASST-07 through D-ASST-32 locked decisions.

## Issues Encountered

- drizzle-kit's default ordering (metadata table before tags table, explicit index before UNIQUE autoindex) differs from the plan's verbatim interface block (which showed tags first). Structurally identical; accepted drizzle-kit output to preserve the schema.ts ↔ SQL roundtrip parity (plan Step C explicitly requires this parity check).

## Downstream Impact (Plans 02-05)

Plan 04-01's surface exports available to Plans 02-05:

- **Nanoid prefixes (2):** `tag`, `meta` via `newId('tag')` / `newId('meta')`
- **ErrorCodes (5):** `TAG_INVALID`, `METADATA_INVALID`, `TAG_LIMIT_EXCEEDED`, `METADATA_LIMIT_EXCEEDED`, `INVALID_SCOPE` via `TypedError('<code>', …)`
- **Shape constants (6):** `MAX_TAG_LENGTH`, `MAX_METADATA_KEY_LENGTH`, `MAX_METADATA_VALUE_LENGTH`, `MAX_TAGS_PER_VERSION`, `MAX_METADATA_PER_VERSION`, `TAG_REGEX`
- **Types (8):** `Tag`, `MetadataEntry`, `MetadataKV`, `VersionWithAssets`, `AssetsQueryFilter`, `ScopeFilter`, `TagCount`, `MetadataKeyCount` (alias)
- **Schema tables (2):** `tags` and `metadata` (imported from `src/store/schema.ts` by the upcoming tag-repo and metadata-repo)
- **Migration (1):** `drizzle/0004_phase4_assets.sql` auto-applied on every `openDb()` and `makeInMemoryDb()` — no test fixture changes required for downstream plans

## Next Phase Readiness

- Plan 04-02 (repos) is unblocked — can now create `src/store/tag-repo.ts` and `src/store/metadata-repo.ts` against live tables + types
- Plan 04-03 (engine) is unblocked — can compose `src/engine/assets.ts` against the type contracts in `src/types/assets.ts`
- Plan 04-04 (asset-tool) is unblocked — Zod schema can reference the shape.ts bounds + TAG_REGEX
- Plan 04-05 (version-tool extension + cross-cutting tests) is unblocked

No blockers or concerns carried forward.

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: /Users/macapple/comfyui-vfx-mcp/drizzle/0004_phase4_assets.sql
- FOUND: /Users/macapple/comfyui-vfx-mcp/drizzle/meta/0004_snapshot.json
- FOUND: /Users/macapple/comfyui-vfx-mcp/drizzle/meta/_journal.json
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/store/schema.ts (extended with tags + metadata sqliteTable)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/utils/id.ts (extended IdPrefix)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/engine/errors.ts (extended ErrorCode)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/tools/shape.ts (extended constants)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/types/assets.ts (72 lines, zero forbidden imports)
- FOUND: /Users/macapple/comfyui-vfx-mcp/src/store/__tests__/migrate.test.ts (17 tests, 5 new Phase 4)

**Commits verified:**
- FOUND: 29a317b (Task 1)
- FOUND: 214a548 (Task 2)
- FOUND: 9010bbc (Task 3)

**Unchanged file verified:**
- UNCHANGED: src/types/hierarchy.ts (git diff empty — 0 lines)

---

*Phase: 04-asset-management*
*Completed: 2026-04-23*
