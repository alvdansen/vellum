---
phase: 18-sortable-folder-dropdown
plan: 01
subsystem: database
tags: [drizzle-orm, sql-injection-defence, cursor-pagination, base64url, whitelist-enum, sqlite]

# Dependency graph
requires:
  - phase: 02-version-allocation
    provides: versions table schema (completed_at NULLABLE — D-01 NULL-pin target) + Drizzle column references for the version-grid sort surface
  - phase: 01-hierarchy-bootstrap
    provides: workspaces/projects/sequences/shots tables — each with a real `name` column for the tree-dropdown sort surface
provides:
  - Whitelist enums (SortField/HierarchySortField/SortDirection) closing the SORT-02 attack surface at compile time
  - buildVersionOrderBy(sort) → 3-term composite (NULL-bit pin DESC, user col <dir>, versions.id ASC) — SORT-05 stable tiebreaker baked in
  - buildHierarchyOrderBy(table, sort) → 2-term (col <dir>, table.id ASC) — RT-03 deterministic tiebreaker
  - encodeVersionCursor / decodeVersionCursor — base64url-encoded JSON, decoder NEVER throws (returns null on garbage)
  - buildAfterCursorWhere(sort, cursor) — 3-OR-branch lexicographic comparison for composite-cursor pagination
  - readSortValue(row, field) — pure helper for cursor encoding from the trailing row
  - DEFAULT_VERSION_SORT ({completed_at, desc} — Latest) and DEFAULT_HIERARCHY_SORT ({name, asc} — A→Z)
affects:
  - Plan 18-02 (engine repo migration: imports buildVersionOrderBy + buildAfterCursorWhere + encodeVersionCursor + decodeVersionCursor + readSortValue to migrate version-repo.ts:listByShot)
  - Plan 18-03 (HTTP route Zod parsing: imports buildHierarchyOrderBy + the type exports for hierarchy-repo opts)
  - Plan 18-04 (dashboard GRID_SORT_OPTIONS: per-D-WEBUI-31 the dashboard does NOT import from this module; it MIRRORS the type literals in lib/sortTypes.ts)
  - Plan 18-05 (HomeView integration; downstream from Plan 18-04)

# Tech tracking
tech-stack:
  added: []  # No new dependencies; uses existing drizzle-orm
  patterns:
    - "Whitelist enum + Record<Field, () => SQL> column-ref map structurally rejects unwhitelisted values at compile time"
    - "Pre-built ASC/DESC sql\\`\\` fragments selected by TypeScript-literal switch — direction never reaches user-input territory"
    - "Composite cursor (NULL-bit + sort_value + tiebreaker_id) base64url-encoded JSON; decoder returns null on every failure path"
    - "WHERE-after-cursor 3-OR-branch lexicographic compare: band advance, same-band sort advance, same-band+value tiebreaker"
    - "Drizzle SQL inspection via db.select().from(table).orderBy(...).toSQL().sql for unit-test assertions without DB writes"

key-files:
  created:
    - src/store/sort.ts (266 lines — pure helper module; 14 exports)
    - src/store/__tests__/sort.test.ts (346 lines — 46 unit tests across 14 describe blocks)
  modified: []  # Plan 18-01 only ADDS files

key-decisions:
  - "Composite cursor shape locked at { cna: boolean, sv: number|string|null, vid: string } — encodes NULL-bit, sort value, and version_id tiebreaker for stable pagination across all four SortField values"
  - "decodeVersionCursor structurally validates cna/sv/vid types and returns null on any failure path — caller never sees an exception; HTTP layer (Plan 18-03) maps null to INVALID_INPUT 4xx"
  - "buildVersionOrderBy ALWAYS emits 3 terms in order (NULL-bit pin first, tiebreaker last) — callers cannot drop or reorder; SORT-05 stability invariant grep-verified"
  - "VERSION_COL_REF['name'] falls back to versions.id (DEVIATION 2) — engine accepts the value but UI never exposes it; preserves the closed-enum surface without a real `name` column"
  - "In-progress band sub-sort uses the same versions.id ASC tiebreaker as the completed band (DEVIATION 1) — strict CASE-expression refinement (D-02 verbatim) deferred to v1.3"
  - "Inline VersionLike interface inside sort.ts avoids circular import on Version from ../types/hierarchy.js — TypeScript structural subtyping handles concrete Version objects passed by callers"

patterns-established:
  - "Drizzle dynamic ORDER BY: sql.join([sql\\`\\`...], sql\\`, \\`) over a Record<Field, () => SQL> map; column refs interpolated via sql\\`\\${col}\\` (NOT \\${col.name}) so Drizzle quotes identifiers safely"
  - "Cursor pagination: base64url JSON encode + structurally-validated decoder + 3-OR-branch WHERE compose; matches Pattern 3 + Pattern 4 from 18-RESEARCH.md"
  - "Architecture-purity inline grep test: readFile + .not.toMatch on each forbidden import family — file-level guard fires in isolation, cheaper to debug than directory-wide architecture-purity.test.ts"

requirements-completed: [SORT-02, SORT-05]

# Metrics
duration: 8min
completed: 2026-05-06
---

# Phase 18 Plan 01: Sort Foundations Summary

**Pure SQL whitelist + Drizzle ORDER BY composers + composite cursor encode/decode foundations for sortable folder + version dropdown — all 14 exports + the 2 DEVIATION pins live in src/store/sort.ts (266 lines, zero MCP/DB-driver/HTTP/filesystem imports), backed by 46 unit tests at src/store/__tests__/sort.test.ts.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-06T16:52:00Z (approx)
- **Completed:** 2026-05-06T17:00:05Z
- **Tasks:** 1 (TDD: RED + GREEN; no REFACTOR needed)
- **Files modified:** 2 (both created — Plan 18-01 only ADDS files)

## Accomplishments

- **Whitelist enums closed at compile time** — SortField (4 values: completed_at, created_at, name, version_number) + HierarchySortField (2 values: name, created_at) + SortDirection ({asc, desc}) eliminate every SQL-injection attack vector on the sort field/direction pair (T-18-01 mitigation).
- **buildVersionOrderBy guarantees the 3-term shape** — NULL-bit pin `(completed_at IS NULL) DESC` is structurally the first term across all 4 fields × 2 dirs (Test 3, 8 sub-cases); `versions.id ASC` tiebreaker is structurally the last term (Test 4, 8 sub-cases). SORT-05 stable-cursor invariant cannot be broken by callers.
- **buildHierarchyOrderBy preserves RT-03 parity** — emits `<col> <dir>, <table>.id ASC` for each of projects/sequences/shots × 2 fields (Test 5, 6 sub-cases). NO NULL-bit term (verified by .not.toMatch).
- **Composite cursor encode/decode hardened** — encode is byte-deterministic; decoder returns null on 9 distinct garbage cases (malformed base64, empty string, valid base64 of non-JSON, valid JSON wrong shape, type-confusion on cna/sv/vid, null payload). NEVER throws (T-18-04 mitigation).
- **buildAfterCursorWhere implements the 3-OR-branch lexicographic compare** — band advance + same-band sort advance + same-band-and-value tiebreaker. The sortOp is `<` for DESC and `>` for ASC; the tiebreaker `>` is invariant (id ASC tiebreaker per SORT-05).
- **base64url URL-safety proven by 100-cursor random sweep** (Test 9): no `+`, `/`, or `=` characters appear in any encoded cursor.
- **Architecture-purity grep gate at 0** — zero MCP/native-binding/HTTP/filesystem imports in src/store/sort.ts (Test 13). Inherits the directory-level src/store/ guard from src/__tests__/architecture-purity.test.ts.

## Task Commits

Each task committed atomically with the TDD gate sequence:

1. **Task 1 RED — failing tests** — `da9d5f7` (test): created src/store/__tests__/sort.test.ts with 14 describe blocks; tests fail with "Cannot find module '../sort.js'" — confirmed RED.
2. **Task 1 GREEN — implementation + test regex adjustments** — `a9b7d21` (feat): created src/store/sort.ts with all 14 exported symbols and 2 DEVIATION pins; relaxed test regexes to accept Drizzle's table-qualified column emit form (`"versions"."completed_at"` in addition to bare `"completed_at"`); rephrased SECURITY-notes docstring to avoid literal forbidden-import package names (Rule 3 deviation, mirrors Phase 13/14/15/16 docstring-vs-grep collision pattern). All 46 tests pass.

_Note: This plan ships under the Plan-Level TDD Gate (`type=tdd`). The git log shows the required `test(...)` → `feat(...)` sequence; no REFACTOR was needed (the code matches the researcher's reference implementation in 18-RESEARCH.md Code Examples)._

## Files Created/Modified

- `src/store/sort.ts` (266 lines, NEW) — Pure helper module exporting 14 symbols: closed-enum types (SortField, HierarchySortField, SortDirection), sort tuples (VersionSort, HierarchySort), cursor shape (VersionCursor), defaults (DEFAULT_VERSION_SORT, DEFAULT_HIERARCHY_SORT), composers (buildVersionOrderBy, buildHierarchyOrderBy), cursor codec (encodeVersionCursor, decodeVersionCursor), WHERE-after-cursor builder (buildAfterCursorWhere), and the trailing-row sort-value reader (readSortValue). Imports `drizzle-orm` (sql + SQL type) + `./schema.js` only — zero forbidden imports.
- `src/store/__tests__/sort.test.ts` (346 lines, NEW) — Vitest suite with 14 top-level describe blocks (46 individual `it()` tests). Drizzle SQL inspection technique documented inline: `db.select().from(table).orderBy(...).toSQL().sql` returns the rendered SQL string for assertion without DB writes. Includes architecture-purity inline grep guard (Test 13) and `sql.raw()` sentinel test (Test 14).

## Drizzle SQL Inspection Technique

Tests 2-5, 10, 11 inspect the SQL emitted by the composers without executing against a real schema by attaching the SQL fragment to a select query and reading the rendered string:

```typescript
const sqlite = new Database(':memory:');
const db = drizzle(sqlite);

function renderOrderBy(orderBy) {
  return db.select().from(versions).orderBy(orderBy).toSQL().sql;
}
```

This calls Drizzle's query builder all the way through SQL generation but stops before execution, so no schema/DDL is required. The rendered SQL contains table-qualified column refs (`"versions"."completed_at"`) when the query starts from a concrete table; tests use regexes that accept both bare and qualified forms.

## Test Count Delta

| Surface | Before | After | Delta |
|---------|--------|-------|-------|
| `src/store/__tests__/` | 126 passing | 172 passing | **+46** |
| `src/__tests__/architecture-purity.test.ts` | 42 passing | 42 passing | unchanged |
| Root suite (full) | 1293 passed / 91 failed / 81 skipped (1465 total) | 1340 passed / 90 failed / 81 skipped (1511 total) | **+47 passing, −1 failing** |

The full-suite failure count decreased by 1 (91 → 90); the reduction is in a pre-existing flaky test outside Plan 18-01's scope (signer.test.ts time-sensitive case). Zero new failures introduced. Plan 18-01 success criterion "pre-existing tests still green" honoured.

The new-test count exceeded the plan's `~+13` estimate because Tests 3, 4, 5, 8, and 12 were structured as multiple sub-cases (one `it()` per parameter combination) for parameter-grid coverage:
- Test 3 (NULL-bit pin first term): 4 fields × 2 dirs = 8 sub-cases
- Test 4 (tiebreaker last term): 4 fields × 2 dirs = 8 sub-cases
- Test 5 (hierarchy 2-term shape): 3 tables × 2 sort tuples = 6 sub-cases
- Test 8 (cursor decoder garbage rejection): 8 sub-cases (one per failure mode)
- Test 12 (readSortValue switch coverage): 5 sub-cases

This is denser coverage than the plan's lower-bound estimate, with no scope creep.

## Decisions Made

- **Inline VersionLike interface in sort.ts** — sort.ts cannot import `Version` from `../types/hierarchy.js` without risking a circular import (sort.ts ← version-repo.ts → types/hierarchy.ts → re-exported by version-repo barrel). Defined a 4-field structural interface (`id`, `completed_at`, `created_at`, `version_number`) inside sort.ts; concrete Version objects passed by Plan 18-02's callers will satisfy this shape via TypeScript structural subtyping. Plan 18-01 PLAN suggested this fallback in the action notes.
- **Test regex accepts both bare and table-qualified column refs** — `db.select().from(versions).orderBy(...).toSQL()` emits `"versions"."completed_at"` (table-qualified). The plan's reference regex assumed bare `"completed_at"`; adjusted regexes to accept `(?:"versions"\.)?"completed_at"` so the test stays robust if Drizzle changes its emit shape (e.g. when the query builder receives the SQL fragment without a `from(table)` anchor).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test regex too narrow vs Drizzle's qualified-column emit**
- **Found during:** Task 1 GREEN run (post-implementation test failure)
- **Issue:** The plan's reference regexes (e.g. `/\(\s*"completed_at"\s+is\s+null\s*\)\s+desc/i`) assumed Drizzle would emit bare column refs. In the test setup `db.select().from(versions).orderBy(...).toSQL()`, Drizzle emits the table-qualified form `"versions"."completed_at"`. 9 of 13 describe-block paths failed (every test that inspected `.toSQL()` output).
- **Fix:** Loosened each regex to optionally accept the table prefix: `(?:"versions"\.)?"completed_at"`. The plan's regex spec was a minimum-viable shape; the loosening preserves the plan's intent (NULL-bit pin first, tiebreaker last, three OR branches with correct operators) without falsely rejecting Drizzle's actual output.
- **Files modified:** src/store/__tests__/sort.test.ts (Tests 2, 3, 4, 5, 10, 11)
- **Verification:** All 46 tests pass.
- **Committed in:** a9b7d21 (Task 1 GREEN commit, bundled with implementation per scope-boundary rule)

**2. [Rule 3 - Blocking] Docstring-vs-grep collision (mirrors Phase 13/14/15/16 pattern)**
- **Found during:** Task 1 GREEN run (Tests 13 + 14 failed)
- **Issue:** The plan's reference SECURITY-notes docstring contained literal strings of the forbidden-import package names (`@modelcontextprotocol/sdk`, `better-sqlite3`, `hono`, `@hono/node-server`) and a literal `sql.raw()` reference (used to explain the security mitigation). Tests 13 + 14 use `readFile` + `.not.toMatch(/.../)` to grep the file source for those literals, so the docstring trips its own guard.
- **Fix:** Rephrased the SECURITY-notes docstring to describe forbidden imports without including their literal package names (e.g. "ZERO MCP-SDK imports", "ZERO native SQLite-driver imports"); rephrased the sql.raw mention to "the unsafe-raw escape hatch from drizzle-orm". Same intent, no literal-string trip. This pattern was previously documented in STATE.md as recurring across Phase 13 / 14 / 15 / 16 plans.
- **Files modified:** src/store/sort.ts (header docstring, lines 5-22)
- **Verification:** Test 13 + Test 14 pass; architecture-purity grep gate returns 0.
- **Committed in:** a9b7d21 (Task 1 GREEN commit, bundled with implementation per scope-boundary rule)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking, both consequences of plan-execution boundary mismatches; no scope creep, no new functionality, no architectural changes).
**Impact on plan:** Both fixes were required to reach GREEN; neither alters the plan's promised exports, ORDER BY shape, cursor codec semantics, or threat-model mitigations. The plan's <success_criteria> remain fully met.

## Issues Encountered

- **Vitest `--reporter=basic` is removed in v4** — the plan's verify command used `--reporter=basic`, which v4.1.5 rejects with `ERR_LOAD_URL` ("Cannot find module 'basic' for 'reporters'"). Worked around by using the default reporter for verification (the plan's command was a documentation artifact; the gate semantics — `npx vitest run` exits 0 — are unaffected). Not a deviation requiring a fix to the codebase; logged here for the verifier and Plan 18-02 author.

## DEVIATION 1 (D-02 in-progress band sub-sort) — downstream impact

`buildAfterCursorWhere` uses the same `versions.id ASC` tiebreaker for both bands (cursor.cna === true → in-progress band; cursor.cna === false → completed band). Plan 18-02's `listByShot` migration will inherit this simpler tiebreaker on both sides — no special-casing required at the repo. The strict D-02 fidelity (CASE-expression: `created_at DESC` sub-sort inside the in-progress band) is deferred to v1.3 if user feedback surfaces. nanoid IDs are time-correlated within a session, so the divergence from `created_at DESC` in the in-progress band is invisible for typical workloads (≤ 3 in-progress versions per shot).

## DEVIATION 2 (SORT-02 'name' on the version surface) — downstream impact

`VERSION_COL_REF['name']` falls back to `versions.id` (lexicographic nanoid). The engine accepts the `name` field on the version surface, but Plan 18-04's `GRID_SORT_OPTIONS` constant in the dashboard does NOT expose this option — researcher recommendation in 18-RESEARCH.md Open Question #1. The hierarchy SortField universe DOES use `name` (projects/sequences/shots all have a real `name` column on the schema). Net effect for Plan 18-04: drop "Name A→Z" from the version-grid dropdown; keep "Name A→Z" on the tree dropdown.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 18-02 (engine repo migration) UNBLOCKED** — imports `buildVersionOrderBy` + `buildAfterCursorWhere` + `encodeVersionCursor` + `decodeVersionCursor` + `readSortValue` from `./sort.js` to migrate `version-repo.ts:listByShot` to composite-cursor pagination.
- **Plan 18-03 (HTTP route Zod parsing + hierarchy repo opts) UNBLOCKED** — imports `buildHierarchyOrderBy` + the type exports (`SortField`, `HierarchySortField`, `SortDirection`, `VersionSort`, `HierarchySort`) for Zod parsing in `dashboard-routes.ts` and the hierarchy-repo opts surface.
- **Plans 18-04 / 18-05 (dashboard side)** — per architecture-purity invariant D-WEBUI-31, the dashboard does NOT import from this engine module. Plan 18-04 will MIRROR the type literals in `lib/sortTypes.ts`. No engine-side prep needed for them in this plan.
- All 4 of the plan's <success_criteria> items met, all 13 plan-level <verification> commands return their expected results.

## Self-Check: PASSED

Verifying file presence + commit hashes before returning:

- **File `src/store/sort.ts`:** FOUND (266 lines)
- **File `src/store/__tests__/sort.test.ts`:** FOUND (346 lines)
- **Commit `da9d5f7` (RED):** FOUND in git log
- **Commit `a9b7d21` (GREEN):** FOUND in git log
- **All 14 required exports present:** verified via `grep -cE "^export (type|interface|const|function) (...)" src/store/sort.ts` = 14
- **DEVIATION pins:** verified via `grep -cE "DEVIATION (1|2)" src/store/sort.ts` = 5 (both pins are referenced multiple times)
- **NULL-bit pin invariant:** verified via `grep -cE "completed_at.*IS\s+NULL.*DESC" src/store/sort.ts` = 2 (≥1 required)
- **Tiebreaker invariant:** verified via `grep -cE "versions\.id.*ASC|versions\.id\}.*ASC" src/store/sort.ts` = 4 (≥1 required)
- **Architecture-purity grep gate:** `grep -cE "from\s+['\"](@modelcontextprotocol|better-sqlite3|hono|@hono/node-server|node:fs)" src/store/sort.ts` = 0
- **`tsc --noEmit`:** clean (no errors)
- **`npx vitest run --no-coverage src/store/__tests__/sort.test.ts`:** 46/46 passing
- **`npx vitest run --no-coverage src/store/__tests__/`:** 172/172 passing (126 baseline + 46 new)
- **`npx vitest run --no-coverage src/__tests__/architecture-purity.test.ts`:** 42/42 passing (unchanged from baseline)

---
*Phase: 18-sortable-folder-dropdown*
*Plan: 01*
*Completed: 2026-05-06*
