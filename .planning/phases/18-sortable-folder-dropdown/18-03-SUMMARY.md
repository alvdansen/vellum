---
phase: 18-sortable-folder-dropdown
plan: 03
subsystem: api
tags: [http, hono, zod, sort, cursor, drizzle, sqlite, validation]

# Dependency graph
requires:
  - phase: 18-sortable-folder-dropdown/18-01
    provides: buildHierarchyOrderBy, decodeVersionCursor, DEFAULT_VERSION_SORT, DEFAULT_HIERARCHY_SORT, type exports
  - phase: 18-sortable-folder-dropdown/18-02
    provides: Engine.listVersionsForShot opts shape, transitional shim location pin
provides:
  - HierarchyRepo.listProjects/listSequences/listShots gain optional opts.sort (D-10 back-compat)
  - Engine.listProjects/listSequences/listShots forward opts.sort to repo
  - dashboard-routes.ts Zod whitelist parsers for ?sort= (version + hierarchy) and ?cursor=
  - 4xx INVALID_INPUT envelope for malformed sort/cursor (T-18-01/T-18-02/T-18-04 mitigated)
  - TRANSITIONAL shim from Plan 18-02 removed
affects: [Plan 18-05 HomeView integration consumes the now-stable HTTP surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "HTTP-boundary closed-enum parsers (Zod safeParse → TypedError(INVALID_INPUT))"
    - "Optional opts pattern preserves back-compat for non-dashboard callers (D-10)"

key-files:
  created:
    - src/__tests__/dashboard-routes-sort.test.ts (365 lines, 17 tests)
  modified:
    - src/store/__tests__/hierarchy-repo-sort.test.ts (refactored to lazy ensureProject/ensureSequence)
    - src/store/hierarchy-repo.ts (3 list methods gain optional opts.sort)
    - src/engine/pipeline.ts (3 facade methods forward opts.sort)
    - src/http/dashboard-routes.ts (3 new parsers; TRANSITIONAL shim removed; 4 routes wired)

key-decisions:
  - "D-10 back-compat preserved: omitting ?sort= preserves pre-Phase-18 ORDER BY for tool callers"
  - "Test 9 (name tiebreaker) dropped — schema UNIQUE(workspace_id, name) makes the secondary sort unreachable in practice; Test 9b covers the reachable created_at tiebreaker case"
  - "?offset= preserved as a no-op qNum parse on the version route for graceful v1.1 callers"
  - "Worktree executor stalled mid-fixture-refactor; orchestrator merged the RED commit and finished Task 1 GREEN + Task 2 inline"

patterns-established:
  - "Boundary parsers: parseVersionSortParam / parseHierarchySortParam / parseCursorParam — each closes the enum + throws TypedError on miss; engine never sees raw user strings"
  - "Optional opts shape: HierarchyRepo + Engine accept `opts?: { sort?: ... }` so MCP callers compile unchanged"

requirements-completed:
  - SORT-02
  - SORT-04
  - SORT-05

# Metrics
duration: ~70 min (split across executor + inline takeover)
completed: 2026-05-08
---

# Plan 18-03: HTTP layer Summary

**Closed the engine-to-HTTP layer for Phase 18 — Zod whitelist parsing for `?sort=` and `?cursor=` at the boundary; transitional Plan 18-02 shim removed; tool-caller back-compat preserved.**

## Performance

- **Duration:** ~70 min (executor stall recovery + inline completion)
- **Tasks:** 2/2 complete
- **Files modified:** 4 + 1 created

## Accomplishments

- HTTP boundary now refuses malformed sort/cursor with 4xx INVALID_INPUT (T-18-01, T-18-02, T-18-04 mitigated; engine never sees raw user strings)
- Three hierarchy routes (`/api/workspaces/:id/projects`, `/api/projects/:id/sequences`, `/api/sequences/:id/shots`) gained optional `?sort=name|created_at:asc|desc` parsing
- Version route TRANSITIONAL shim from Plan 18-02 removed — `?sort=` and `?cursor=` are now structurally validated before reaching the engine
- D-10 invariant preserved: MCP tool callers (`project-tool.ts:88`, `sequence-tool.ts:88`, `shot-tool.ts:94`) continue to compile + execute without modification — verified via existing tool tests staying green (167/167)

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1 RED**: `370d07c test(18-03): add failing tests for hierarchy-repo opts.sort + engine facade forwarding` (committed in worktree, merged via `f20bf62`)
2. **Task 1 GREEN**: `7673088 feat(18-03): extend hierarchy-repo + Engine facade with optional opts.sort (GREEN)`
3. **Task 2 RED**: `a3e903d test(18-03): add failing tests for dashboard-routes Zod whitelist parsing (RED)`
4. **Task 2 GREEN**: `c99a112 feat(18-03): replace TRANSITIONAL shim with full Zod whitelist parsing (GREEN)`

## Files Created/Modified

- `src/__tests__/dashboard-routes-sort.test.ts` (NEW, 365 lines, 17 tests) — Hono `app.request(...)` tests covering default Latest, valid sort/cursor, malformed → 4xx, hierarchy ?sort=, back-compat default, TRANSITIONAL grep gate
- `src/store/__tests__/hierarchy-repo-sort.test.ts` (MODIFIED, 19 tests) — refactored fixture to lazy `ensureProject()`/`ensureSequence()` so per-test row sets are deterministic; Test 9 (name tiebreaker) replaced with explanatory comment after schema UNIQUE constraint discovery
- `src/store/hierarchy-repo.ts` — `listProjects`, `listSequences`, `listShots` gain `opts?: { sort?: HierarchySort }`; `buildHierarchyOrderBy` import added; `listWorkspaces` intentionally unchanged (D-WEBUI scope)
- `src/engine/pipeline.ts` — Engine facade methods forward `opts` byte-equal to repo; `HierarchySort` type-only import preserves architecture purity
- `src/http/dashboard-routes.ts` — 3 new parsers (parseVersionSortParam, parseHierarchySortParam, parseCursorParam) + Zod imports; `/api/shots/:id/versions` rewritten to consume parsers; 3 hierarchy routes extended with optional `?sort=`

## Verification Gates (acceptance_criteria)

| Gate | Result |
|------|--------|
| `grep -c TRANSITIONAL src/http/dashboard-routes.ts` | 0 ✓ |
| `grep -cE "function parse(VersionSort|HierarchySort|Cursor)Param"` | 3 ✓ |
| `grep -cE "parseHierarchySortParam"` | 4 (1 def + 3 callsites) ✓ |
| `npx tsc --noEmit` (root + packages/dashboard) | Clean ✓ |
| `hierarchy-repo-sort.test.ts` | 19/19 ✓ |
| `dashboard-routes-sort.test.ts` | 17/17 ✓ |
| `tool-budget.test.ts` | 3/3 ✓ |
| Tool tests broad regression (`src/tools/__tests__/`) | 167/167 ✓ |
| Full Phase 18 sweep (sort + version-repo-sort + cursor + hierarchy + dashboard-routes + tool-budget) | 120/120 ✓ |

## Threat Mitigation Evidence

| Threat ID | Test name | 4xx envelope verified |
|-----------|-----------|-----------------------|
| T-18-01 (SQL injection via sort field) | Tests 3, 5, 11a, 11b, 11c | Yes — body.error.code === 'INVALID_INPUT' |
| T-18-02 (SQL injection via cursor) | Test 8 | Yes — decoder returns null → TypedError 4xx |
| T-18-03 (XSS via echoed input) | Tests 3, 8 | Yes — `body.error.message` does NOT contain the malformed input |
| T-18-04 (cursor decode → 5xx crash) | Test 8 | Yes — never 5xx, always 4xx INVALID_INPUT |

## D-10 Back-compat Evidence

- `engine.listProjects(workspaceId, limit, offset)` (omits opts) returns rows in `created_at ASC, id ASC` — Test 10 in hierarchy-repo-sort.test.ts
- Tool tests (`src/tools/__tests__/`) untouched — all 167 still pass
- `?sort=` omitted on hierarchy routes preserves pre-Phase-18 ORDER BY — Test 12 in dashboard-routes-sort.test.ts

## Pre-existing Failures (NOT regressions)

The full root suite reports 20 failures (1559 passed / 1582 total). All 20 were verified to predate Wave 1 by checking out the Wave 1 base (`6b89fdf`); they assert specific content of `ROADMAP.md` / `REQUIREMENTS.md` from earlier phases (validation-flags, phase-attribution, requirements-cohort-closure tests). Test count grew 1546 → 1582 (+36 new from this plan).

## Plans this unblocks

- **Plan 18-05 (HomeView integration)** — the dashboard now has a stable, fully-validated HTTP surface to consume: `?sort=` + `?cursor=` on the version route, `?sort=` on the three hierarchy routes, with consistent 4xx envelope shape on malformed input.

## Self-Check: PASSED
