---
phase: 18-sortable-folder-dropdown
status: human_needed
verified_at: 2026-05-08
must_haves_verified: 5
must_haves_total: 5
score: 5/5
human_verification_count: 6
---

# Phase 18 Verification

**Goal**: VFX artists can pull up latest generations quickly via a sort dropdown that defaults to "latest first" on the version grid and "A→Z" on the tree sidebar, with sort preference persisted across browser sessions.

## Goal-Backward Codebase Verification

### Must-have 1 — Latest-first version-grid default (SORT-01)

| Check | Evidence |
|-------|----------|
| `DEFAULT_VERSION_SORT` exports `{ field: 'completed_at', dir: 'desc' }` | `src/store/sort.ts:71` |
| Engine consumes default when no sort specified | `src/store/version-repo.ts:listByShot` opts.sort threads through `buildVersionOrderBy` |
| HTTP route applies default when `?sort=` omitted | `src/http/dashboard-routes.ts` `parseVersionSortParam(undefined) → DEFAULT_VERSION_SORT` |
| Dashboard signal initializes to default | `packages/dashboard/src/state/versions.ts:43` `gridSort = signal<VersionSort>(DEFAULT_VERSION_SORT)` |
| Tests | `dashboard-routes-sort.test.ts:Test 1` Latest band first; `HomeView-sort-defaults.test.tsx` 9 tests |

✅ **Verified.**

### Must-have 2 — Whitelist enum + dropdown control (SORT-02)

| Check | Evidence |
|-------|----------|
| Closed enum `SortField = 'completed_at' \| 'created_at' \| 'name' \| 'version_number'` | `src/store/sort.ts:50` |
| Engine `buildVersionOrderBy` rejects out-of-whitelist via TypeScript exhaustive check | `src/store/sort.ts` `VERSION_COL_REF` map |
| HTTP boundary refuses with 4xx INVALID_INPUT | `src/http/dashboard-routes.ts` `parseVersionSortParam` Zod safeParse → TypedError |
| SortDropdown component | `packages/dashboard/src/components/SortDropdown.tsx` (280 lines, WAI-ARIA APG combobox) |
| Mounted in HomeView | `grep -c SortDropdown packages/dashboard/src/views/HomeView.tsx` → 7 |
| Tests | `dashboard-routes-sort.test.ts:Tests 3,4,5,6` (T-18-01 mitigation); `SortDropdown.test.tsx` |

✅ **Verified.**

### Must-have 3 — Persistent sort preference (SORT-03)

| Check | Evidence |
|-------|----------|
| `lib/sortHelpers.ts` exports `hydrateSortState`, `persistGridSort`, `persistTreeSort` | `packages/dashboard/src/lib/sortHelpers.ts:7` |
| Reconciliation order: URL → localStorage → defaults (D-13/D-15) | `packages/dashboard/src/lib/sortHelpers.ts:6` |
| LRU bounded keys for localStorage | `packages/dashboard/src/lib/sortHelpers.ts` (Wave 2 evidence) |
| URL state mirror via `replaceState` | `state/versions.ts` `gridSort` + `state/hierarchy.ts:treeSort` writes |
| Hydration on HomeView mount | `HomeView.tsx` calls `hydrateSortState()` |
| Tests | `state-sort-signals.test.ts` 9 tests; `HomeView-sort-toggle.test.tsx` Tests 4+11 |

✅ **Verified.**

### Must-have 4 — Tree A→Z default (SORT-04)

| Check | Evidence |
|-------|----------|
| `DEFAULT_HIERARCHY_SORT = { field: 'name', dir: 'asc' }` | `src/store/sort.ts:74` |
| Hierarchy repo uses `buildHierarchyOrderBy` when opts.sort provided | `src/store/hierarchy-repo.ts` listProjects/listSequences/listShots |
| HTTP boundary parses `?sort=` for hierarchy routes | `parseHierarchySortParam` × 3 routes |
| Dashboard treeSort signal | `packages/dashboard/src/state/hierarchy.ts:53` |
| Tree dropdown mounts | `HomeView.tsx` (2 dropdown instances per UI-SPEC) |
| Tests | `hierarchy-repo-sort.test.ts:Tests 6,7`; `dashboard-routes-sort.test.ts:Test 10`; `HomeView-sort-toggle.test.tsx:Test 10` |

✅ **Verified.**

### Must-have 5 — Cursor stability across sort changes (SORT-05)

| Check | Evidence |
|-------|----------|
| Composite cursor shape `{ cna, sv, vid }` | `src/store/sort.ts:61` `VersionCursor` |
| `encodeVersionCursor` / `decodeVersionCursor` round-trip | `src/store/sort.ts:169-200` |
| `buildAfterCursorWhere` constructs WHERE with NULL-bit + tiebreaker | `src/store/sort.ts` |
| Engine uses cursor pagination | `src/store/version-repo.ts:listByShot` returns `{items, next_cursor, total_count}` |
| HTTP boundary validates cursor (decode failure → 4xx, never 5xx — T-18-04) | `parseCursorParam` |
| Sort change resets cursor + scrolls to top (D-19) | `HomeView.tsx` `handleGridSortChange` calls `gridCursor.value = null` + `scrollTop = 0` |
| LoadMoreButton append + isFetching guard | `LoadMoreButton.tsx` + `state/versions.ts:gridCursor` |
| Tests | `version-repo-cursor.test.ts` 17 tests; `dashboard-routes-sort.test.ts:Test 7,8`; `HomeView-sort-toggle.test.tsx:Tests 1,5,6,7,8` |

✅ **Verified.**

## Test Suite Summary

| Suite | Result |
|-------|--------|
| Root vitest | 1559 passed / 20 failed / 3 skipped (1582) |
| Dashboard vitest | 204 passed / 0 failed (was 166 baseline; +38 from Plan 18-05; +49 from Plan 18-04) |
| Phase 18 sweep (sort + version-repo-sort + cursor + hierarchy + dashboard-routes + tool-budget) | 120/120 ✓ |
| Tool budget regression | 3/3 ✓ |
| TypeScript | tsc --noEmit clean (root + packages/dashboard) |
| Schema drift | None (verify.schema-drift returns drift_detected: false) |

The 20 root-suite failures are pre-existing baseline noise (verified by checking out Wave 1 base `6b89fdf` and observing the same 20 failures). They assert specific historical content of `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` from earlier phases (validation-flags, phase-attribution, requirements-cohort-closure). NOT regressions caused by Phase 18.

## Threat Model Closure

| Threat ID | Description | Mitigation Verified |
|-----------|-------------|---------------------|
| T-18-01 | SQL injection via sort field | Closed Zod enum at HTTP boundary; tests 3, 5, 11a-c |
| T-18-02 | SQL injection via cursor | Decoder returns null on garbage; tests 8 |
| T-18-03 | XSS via echoed input | Error messages do NOT contain malformed input; tests 3, 8 |
| T-18-04 | Cursor decode → 5xx crash | TypedError 4xx; test 8 (status 400, not 500) |
| T-18-05 | URL parse failure on dashboard | Hydrate wraps URL parse in try/catch with localStorage fallback (sortHelpers.ts) |
| T-18-08 | Tool budget breach | tool-budget.test.ts 3/3 passing (7-of-12 holds; zero new MCP tools) |

## Architecture Purity

| Boundary | Result |
|----------|--------|
| `src/store/sort.ts` — no MCP/HTTP/native-driver imports | ✓ (sort.test.ts inline grep) |
| Engine layer — type-only imports of VersionSort/HierarchySort | ✓ |
| `packages/dashboard/src/lib/sortTypes.ts` — mirror, no `from '../../src` | ✓ (Plan 18-04 grep gate) |
| `dashboard-routes.ts` — only zod + ../store/sort.js + Hono/TypedError additions | ✓ |
| TRANSITIONAL shim from Plan 18-02 | Removed; `grep -c TRANSITIONAL src/http/dashboard-routes.ts` → 0 |

## D-10 Back-compat Invariant

MCP tool callers (`src/tools/project-tool.ts:88`, `src/tools/sequence-tool.ts:88`, `src/tools/shot-tool.ts:94`) call `engine.listProjects/listSequences/listShots` with 3 arguments (no opts). After Plan 18-03 added optional `opts?: { sort?: HierarchySort }`, those calls still compile and use the pre-Phase-18 default ORDER BY (`created_at ASC, id ASC`). Verified by tool-budget.test.ts 3/3 passing and `src/tools/__tests__/` 167/167 passing without modification.

## Human Verification Items

The following were intentionally deferred to executor sign-off (visual / interaction checks not amenable to unit tests):

1. **Visual fidelity of SortDropdown across themes** — Confirm dark/light themes render dropdown with correct contrast + focus rings.
2. **Keyboard navigation through SortDropdown** — Tab/Arrow Up/Down/Enter/Escape behavior matches WAI-ARIA APG combobox spec.
3. **URL share-link round-trip** — Copy URL with `?gridSort=&treeSort=` and paste in fresh tab; observe identical sort state on hydrate.
4. **In-progress band visual** — When versions have NULL completed_at (queued/running), confirm they appear in their own band at the top regardless of sort direction.
5. **"Load more" perceived latency** — On real database with 100+ versions, confirm `LoadMoreButton` click feels responsive and shows loading state correctly.
6. **Tree re-sort propagation** — Toggle treeSort dropdown; confirm sort applies across workspace → project → sequence → shot levels in real time without page reload.

## Verdict

**Status: human_needed** — All 5 must-haves are verified at the codebase level. 6 visual/interaction items remain for human UAT.
