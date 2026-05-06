---
phase: 18
slug: sortable-folder-dropdown
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 18-RESEARCH.md §"Validation Architecture" — 19 requirement-mapped tests + 11 architecture/cross-cutting tests.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 (root + dashboard packages) |
| **Config file** | `vitest.config.ts` (root) + `packages/dashboard/vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=basic --no-coverage src/store/__tests__/sort.test.ts src/store/__tests__/version-repo-sort.test.ts src/store/__tests__/version-repo-cursor.test.ts src/store/__tests__/hierarchy-repo-sort.test.ts src/__tests__/dashboard-routes-sort.test.ts` (sub-30s on M1) |
| **Full suite command** | `npx vitest run && cd packages/dashboard && npx vitest run` (~2 min) |
| **Architecture-purity command** | `npx vitest run src/__tests__/architecture-purity.test.ts` |
| **Tool budget command** | `npx vitest run src/__tests__/tool-budget.test.ts` |
| **Dashboard suite command** | `cd packages/dashboard && npx vitest run` |
| **Estimated runtime** | ~20s root, ~10s dashboard, ~30s combined for sort-touched files; ~2 min full |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=basic --no-coverage <task-touched test file(s)>` (sub-30s)
- **After every plan wave:** Run combined sort-suite `npx vitest run --reporter=basic src/store/__tests__/sort*.test.ts src/store/__tests__/version-repo-sort.test.ts src/store/__tests__/version-repo-cursor.test.ts src/store/__tests__/hierarchy-repo-sort.test.ts src/__tests__/dashboard-routes-sort.test.ts && cd packages/dashboard && npx vitest run --reporter=basic src/__tests__/SortDropdown.test.tsx src/__tests__/LoadMoreButton.test.tsx src/__tests__/sortHelpers.test.ts src/__tests__/HomeView-sort-defaults.test.tsx src/__tests__/HomeView-sort-toggle.test.tsx`
- **Before `/gsd-verify-work`:** Full suite green (root + dashboard) AND `npx tsc --noEmit` clean AND `npx vitest run src/__tests__/tool-budget.test.ts src/__tests__/architecture-purity.test.ts` green
- **Max feedback latency:** ~30 seconds for sort-suite quick run; ~2 minutes for full combined suite

---

## Per-Task Verification Map

> Populated by the planner. Every task in Phase 18 must declare an `<automated>` verify command (Nyquist-compliant). Wave 0 stubs are created INSIDE the plan-owning tasks (TDD RED step), not as a separate pre-wave.

| Plan | Task | Wave | Test/Verify Command | Notes |
|------|------|------|---------------------|-------|
| TBD  | TBD  | TBD  | TBD                 | Filled by gsd-planner |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — populated during execution after each task commit.*

---

## Validation Architecture (from RESEARCH §"Validation Architecture")

### Requirement-Mapped Tests (19)

1. **SORT-01 grid default = `completed_at DESC` with NULL-pin** — `versionRepo.listByShot(shotId, {})` returns rows ordered by `(completed_at IS NULL) DESC, completed_at DESC, version_id ASC`; in-progress versions surface at top of page 1 regardless of grid sort direction (D-01/D-02). Command: `npx vitest run src/store/__tests__/version-repo-sort.test.ts -t "default Latest"`.
2. **SORT-01 tree default = `name ASC`** — first-load TreeSidebar with no localStorage and no URL query renders children sorted A→Z (D-06/D-07). Command: `cd packages/dashboard && npx vitest run src/__tests__/HomeView-sort-defaults.test.tsx -t "tree A-Z"`.
3. **SORT-02 engine whitelist enum** — `versionRepo.listByShot` accepts ONLY `{completed_at, created_at, name, version_number} × {asc, desc}`; TypeScript exhaustive switch + Zod 4xx at HTTP boundary refuses anything else (no SQL injection surface). Command: `npx vitest run src/store/__tests__/version-repo-sort.test.ts -t "whitelist"`.
4. **SORT-02 HTTP boundary refuses malformed sort** — `GET /api/shots/:id/versions?sort=DROP_TABLE` → 4xx `INVALID_INPUT` (NOT 500); same for non-colon-separated values, unknown fields, unknown directions. Command: `npx vitest run src/__tests__/dashboard-routes-sort.test.ts -t "INVALID_INPUT"`.
5. **SORT-02 SortDropdown renders 4 options each** — grid: Latest / Oldest / Name A→Z / Version ↓; tree: A→Z / Z→A / Newest / Oldest. Command: `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "options render"`.
6. **SORT-03 localStorage write persistence** — toggling sort writes JSON `{ field, dir }` to `vfx-familiar:sort:grid` (or `:tree`). Reload re-hydrates. Command: `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "localStorage write"`.
7. **SORT-03 URL state mirror always explicit** — `?gridSort=…&treeSort=…` is set on every render after hydrate, even when both panes are at defaults (D-15). Command: `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "URL always explicit"`.
8. **SORT-03 URL wins on first load (localStorage untouched)** — when URL has a valid `?gridSort=oldest:asc` and localStorage holds a different value, render uses URL value AND localStorage stays bit-identical. User toggle then writes BOTH (D-13). Command: `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "URL wins"`.
9. **SORT-03 LRU eviction primitive** — `setBoundedLocalStorageEntry(prefix, key, value, maxKeys=50)` evicts least-recently-used `<prefix>:*` key when count exceeds cap; companion key `<prefix>:_lru` tracks recency. Command: `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "LRU eviction"`.
10. **SORT-03 quota / privacy fall-through** — `localStorage.setItem` throwing (private mode, quota exceeded) does NOT unwind the user's sort change; helper silently catches; UI state still updates. Command: `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "quota fall-through"`.
11. **SORT-03 URL parse fallback** — malformed `?gridSort=garbage` → fallback to default + `console.warn`; never throws to error boundary (D-16). Command: `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "malformed URL"`.
12. **SORT-04 hierarchy `sort` parameter back-compat** — `listProjects(parentId)` (no opts) preserves existing `created_at ASC, id ASC` ordering exactly; existing tool callers (`asset-tool.ts`, `project-tool.ts`, etc.) continue to work without modification. Command: `npx vitest run src/store/__tests__/hierarchy-repo-sort.test.ts -t "back-compat" && npx vitest run src/tools/__tests__/project-tool.test.ts src/tools/__tests__/sequence-tool.test.ts src/tools/__tests__/shot-tool.test.ts`.
13. **SORT-04 hierarchy whitelist enum** — `{name, created_at} × {asc, desc}` only; HTTP route enforces same whitelist via Zod. Command: `npx vitest run src/store/__tests__/hierarchy-repo-sort.test.ts -t "whitelist"`.
14. **SORT-05 cursor pagination — no duplicates / no skips** — page 2 starts AFTER page 1's last row; round-trip walks every row exactly once across all four sort fields. Command: `npx vitest run src/store/__tests__/version-repo-cursor.test.ts -t "no duplicates no skips"`.
15. **SORT-05 cursor stability under inserts** — new row inserted after page 1 fetched but before page 2 → page 2 still excludes that row (acceptable; matches GitHub/Linear/Stripe semantics); no duplicate or shifted row. Command: `npx vitest run src/store/__tests__/version-repo-cursor.test.ts -t "insert race"`.
16. **SORT-05 cursor stability under deletes** — row deleted between pages → no duplicate of page-1 row in page 2; pagination reaches end cleanly. Command: `npx vitest run src/store/__tests__/version-repo-cursor.test.ts -t "delete race"`.
17. **SORT-05 sort change → cursor reset + scroll-to-top** — toggling `gridSort` resets `gridCursor` to `null` AND sets `<main>.scrollTop = 0` (D-19). Command: `cd packages/dashboard && npx vitest run src/__tests__/HomeView-sort-toggle.test.tsx -t "scroll to top"`.
18. **SORT-05 "Load more" button visibility + click** — button visible iff `next_cursor !== null`; click triggers next-page fetch with the encoded cursor; disabled while `gridIsFetching === true`. Command: `cd packages/dashboard && npx vitest run src/__tests__/LoadMoreButton.test.tsx -t "visibility"`.
19. **SORT-05 cursor decode failure → 4xx INVALID_INPUT** — malformed `?cursor=` → 4xx with structured error (NOT 500); dashboard fetch error handler catches gracefully. Command: `npx vitest run src/__tests__/dashboard-routes-sort.test.ts -t "cursor decode error"`.

### Architecture / Cross-Cutting Tests (11)

20. **Architecture-purity: dashboard zero server imports** — `packages/dashboard/src/**` mirrors `SortField`/`HierarchySortField`/`SortDirection` types in `lib/sortTypes.ts`; never imports from `src/store/`. Existing test at `architecture-purity.test.ts` covers this without modification. Command: `npx vitest run src/__tests__/architecture-purity.test.ts -t "zero imports from server"`.
21. **Architecture-purity: tool count holds at 7-of-12** — Phase 18 adds NO new MCP tools. `tool-budget.test.ts` regression. Command: `npx vitest run src/__tests__/tool-budget.test.ts`.
22. **Append-only invariant on `provenance`** — sort code paths never `UPDATE`/`DELETE` on `provenance`; grep regression: `grep -rE "this\.db\.(update|delete).*provenance" src/store/version-repo.ts src/store/hierarchy-repo.ts src/store/sort.ts src/http/dashboard-routes.ts` returns empty. (Sort is read-only re-projection.)
23. **WAI-ARIA combobox compliance** — `<SortDropdown/>` trigger has `role="combobox"` + `aria-expanded` + `aria-haspopup="listbox"` + `aria-controls`; popover has `role="listbox"` + stable `id`; items have `role="option"` + `aria-selected`. Command: `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "ARIA roles"`.
24. **Keyboard navigation** — Enter/Space/ArrowDown opens; ArrowUp/ArrowDown navigates; Home/End jump to first/last; Escape closes + returns focus to trigger; Enter selects + closes. Command: `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "keyboard"`.
25. **Outside-click closes the listbox** — mousedown outside trigger and listbox closes the popover without selecting. Command: `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "outside click"`.
26. **Focus return on close** — Escape, outside-click, and after-select all return focus to the trigger element. Command: `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "focus return"`.
27. **Tree comparator parity** — client-side `compareTreeNodes(a, b, sort)` produces the same row order as server `listProjects(opts)` on an ASCII fixture (Unicode collation tested separately as MEDIUM). Command: `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "comparator parity"`.
28. **Cursor `total_count` parity** — `total_count` field surfaces correctly across the cursor walk (NOT mid-page-walk drift). Command: `npx vitest run src/store/__tests__/version-repo-cursor.test.ts -t "total_count"`.
29. **Drizzle ORDER BY parameterized SQL** — `buildVersionOrderBy` and `buildHierarchyOrderBy` emit parameterized SQL with quoted identifiers; never concatenate user input. Command: `npx vitest run src/store/__tests__/sort.test.ts -t "parameterized SQL"`.
30. **`latestCompletedForSelectedShot` derivation regression** — `HomeView.tsx` derivation continues to work after fetchVersions return-shape migration (page 1 with NULL-pin still typically contains a `complete` row; documented edge case for >20 in-progress versions deferred to v1.3 prefetch). Command: `cd packages/dashboard && npx vitest run src/__tests__/HomeView-sort-toggle.test.tsx -t "latest completed"`.

---

## Wave 0 Test File Inventory

> Wave 0 stubs are created in the OWNING task (TDD RED step) of each plan, not as a separate pre-wave. Every path below matches what the plans will create.

- [ ] `src/store/__tests__/sort.test.ts` — `buildVersionOrderBy` + `buildHierarchyOrderBy` + cursor encode/decode unit tests
- [ ] `src/store/__tests__/version-repo-sort.test.ts` — `listByShot` whitelist enum + NULL-pin + default page size
- [ ] `src/store/__tests__/version-repo-cursor.test.ts` — composite cursor stability under inserts/deletes; `total_count` parity
- [ ] `src/store/__tests__/hierarchy-repo-sort.test.ts` — `listProjects/listSequences/listShots` `opts.sort` param + back-compat
- [ ] `src/__tests__/dashboard-routes-sort.test.ts` — Zod whitelist enforcement at HTTP boundary; `INVALID_INPUT` on malformed sort/cursor
- [ ] `packages/dashboard/src/__tests__/SortDropdown.test.tsx` — render + ARIA + keyboard + focus management + outside-click
- [ ] `packages/dashboard/src/__tests__/LoadMoreButton.test.tsx` — visibility + click + disabled-while-fetching
- [ ] `packages/dashboard/src/__tests__/sortHelpers.test.ts` — `parseSortValue` + `hydrateSortState` + `persistGridSort`/`persistTreeSort` + `setBoundedLocalStorageEntry` + `compareTreeNodes`
- [ ] `packages/dashboard/src/__tests__/HomeView-sort-defaults.test.tsx` — default sort on first load (no URL, no localStorage)
- [ ] `packages/dashboard/src/__tests__/HomeView-sort-toggle.test.tsx` — toggle → cursor reset + scroll-to-top + URL replaceState + localStorage write
- [ ] (modify) `packages/dashboard/src/__tests__/api.test.ts` — `fetchVersions` return-shape change to `{ items, next_cursor, total_count }`

*Existing infrastructure (vitest, @testing-library/preact, jsdom from Phase 5+) covers framework needs — no installs required.*

**Path convention note:** Dashboard tests live at the top-level `packages/dashboard/src/__tests__/` directory (NOT `packages/dashboard/src/components/__tests__/`), per Phase 17 PATTERNS.md inventory. Server tests live at `src/store/__tests__/` (existing `__tests__` siblings) or `src/__tests__/` (top-level). The planner re-confirms paths during plan derivation.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity of `<SortDropdown/>` open/close on real dashboard | SORT-02 | Subjective — "does the popover position correctly under the trigger, does it animate without jank, does it cover/uncover content cleanly on dark + light themes" | Open dashboard, toggle theme via `<ThemeToggle/>`, click dropdown trigger on grid AND tree, verify popover positioning + theme-token rendering at 1× and 2× DPR |
| Keyboard-only navigation end-to-end | SORT-02 (ARIA) | Real-DOM focus rings + AT screen-reader announcements not fully simulatable in jsdom | Tab to trigger → Enter opens → ArrowDown to "Oldest" → Enter selects → focus returns to trigger; verify `aria-activedescendant` announces correctly with VoiceOver / NVDA |
| URL share-link round-trip | SORT-03 | Cross-window state flow not exercisable in unit tests | User A: change grid sort to "Oldest", copy URL. Open in new window (no localStorage entry yet); verify grid renders Oldest AND localStorage still empty for that window. User A then clicks dropdown → BOTH URL and localStorage update |
| In-progress band visual on real renders | SORT-01 + D-04 | Full visual stack (skeleton thumbnail + version-card layout) | Submit 2-3 generations on an active shot, verify skeleton cards pin to top of grid; switch to "Oldest" — pinned band MUST stay at top (D-01: "in-flight work is never buried") |
| "Load more" button perceived latency | SORT-05 | UX feel — does the click feel responsive even on slow networks | DevTools throttling → "Slow 4G", scroll to button, click; verify spinner/disabled state engages immediately and result appends within reasonable time without scroll jump |
| TreeSidebar tree-wide re-sort propagation | SORT-04 + D-09 | All 4 hierarchy levels (workspaces / projects / sequences / shots) must respect new sort instantly without refetch | Toggle tree sort to "Newest" — verify all 4 levels update in place via client-side comparator (no network call), then collapse + re-expand a node to verify cached children also obey new sort |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or are explicit checkpoints
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references — every test file path above matches what the plans create
- [ ] No watch-mode flags — all verify commands use `vitest run --reporter=basic --no-coverage`
- [ ] Feedback latency < 30s for sort-suite quick run; < 2 min for full combined suite
- [ ] `nyquist_compliant: true` set in frontmatter (after `/gsd-validate-phase` confirms during execution)
- [ ] `wave_0_complete: true` set in frontmatter (after Wave 0 stubs land RED)

**Approval:** pending
