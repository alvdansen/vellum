---
phase: 18-sortable-folder-dropdown
plan: 04
subsystem: dashboard
tags: [preact, wai-aria-apg, combobox, listbox, localStorage, url-state, lru-primitive, design-token-reuse, architecture-purity]

# Dependency graph
requires:
  - phase: 18-sortable-folder-dropdown
    plan: 01
    provides: src/store/sort.ts authoritative server-side enum (SortField/HierarchySortField/SortDirection/VersionSort/HierarchySort) — Plan 18-04 MIRRORS these types via packages/dashboard/src/lib/sortTypes.ts per D-WEBUI-31 architecture-purity
provides:
  - "packages/dashboard/src/lib/sortTypes.ts — type mirror with DUPLICATE OF comment-pin keeping the dashboard in lockstep with src/store/sort.ts"
  - "packages/dashboard/src/lib/sortHelpers.ts — 9 exports + SortOption interface: parseSortValue (D-16 graceful fallback), serializeSortValue (round-trip), hydrateSortState (D-13/D-15 state machine), persistGridSort/persistTreeSort (3-layer write), setBoundedLocalStorageEntry (D-25 LRU primitive), compareTreeNodes (client-side comparator), GRID_SORT_OPTIONS (3 entries — DEVIATION 1), TREE_SORT_OPTIONS (4 entries verbatim D-07)"
  - "packages/dashboard/src/components/SortDropdown.tsx — generic-typed Preact component implementing WAI-ARIA APG combobox 1.2 select-only pattern: 6 ARIA attributes + 8 keyboard handlers + outside-click + focus management"
  - "packages/dashboard/src/components/LoadMoreButton.tsx — pure pagination button with loading + error states; design-token reuse (--color-status-failed for error pill)"
  - "packages/dashboard/src/lib/copy.ts — 7 new Phase 18 copy constants (SORT_STRIP_LABEL, SORT_GRID_ARIA_LABEL, SORT_TREE_ARIA_LABEL, LOAD_MORE_LOADING_LABEL, LOAD_MORE_RETRY_LABEL, LOAD_MORE_ERROR_PREFIX_FAILED, LOAD_MORE_ERROR_PREFIX_NETWORK)"
affects:
  - Plan 18-05 (HomeView integration consumes SortDropdown × 2 + LoadMoreButton + GRID_SORT_OPTIONS + TREE_SORT_OPTIONS + hydrateSortState + persistGridSort + persistTreeSort + compareTreeNodes from this plan)

# Tech tracking
tech-stack:
  added: []  # No new dependencies; uses existing preact + lucide-preact + tailwindcss
  patterns:
    - "D-WEBUI-31 architecture-purity via type-mirror file: packages/dashboard/src/lib/sortTypes.ts MIRRORS src/store/sort.ts byte-equal — DUPLICATE OF comment-pin keeps the lockstep contract explicit"
    - "WAI-ARIA APG combobox 1.2 select-only pattern: role='combobox' + aria-haspopup='listbox' + aria-expanded + aria-controls + aria-activedescendant on trigger; role='listbox' + matching id on popover; role='option' + aria-selected on items"
    - "outside-click handler via useEffect-managed document mousedown listener (only attached while open); cleanup function detaches on close to avoid memory leak"
    - "focus management: triggerRef.current?.focus() on close-with-return preserves keyboard accessibility on Escape / Enter-on-option / Tab"
    - "hydrateSortState 3-layer state machine: URL → localStorage → defaults reconciliation per D-13/D-15; URL wins doesn't touch localStorage"
    - "setBoundedLocalStorageEntry LRU primitive with companion-key MRU-ordered string[]: cap=50; corrupt-companion rebuild; quota silent fall-through (Pitfall E from 18-RESEARCH.md)"
    - "history.replaceState (NOT pushState) per D-14: sort is a view setting, not navigation; back button must not replay sort toggles"
    - "design-token reuse: error pill in LoadMoreButton uses --color-status-failed (existing Phase 5 token), mirrors WarningPill design-token-reuse pattern from Phase 12 — zero new design tokens"

key-files:
  created:
    - packages/dashboard/src/lib/sortTypes.ts (52 lines, NEW)
    - packages/dashboard/src/lib/sortHelpers.ts (457 lines, NEW)
    - packages/dashboard/src/components/SortDropdown.tsx (280 lines, NEW)
    - packages/dashboard/src/components/LoadMoreButton.tsx (134 lines, NEW)
    - packages/dashboard/src/__tests__/sortHelpers.test.ts (466 lines, NEW)
    - packages/dashboard/src/__tests__/SortDropdown.test.tsx (306 lines, NEW)
    - packages/dashboard/src/__tests__/LoadMoreButton.test.tsx (197 lines, NEW)
  modified:
    - packages/dashboard/src/lib/copy.ts (+51 lines — 7 new Phase 18 copy constants appended after Phase 17 block)

key-decisions:
  - "DEVIATION 1 (this plan; lockstep with DEVIATION 2 in Plan 18-01): GRID_SORT_OPTIONS ships with 3 entries (Latest, Oldest, Version ↓); 'Name A→Z' DROPPED from grid options because the versions table has no name column. Engine SortField enum keeps `name` for whitelist completeness (falls back to versions.id, never reachable from UI). TREE_SORT_OPTIONS retains all 4 entries because projects/sequences/shots all have real `name` columns."
  - "D-08 LOCKED: SortDropdown is a single component reused for both grid + tree instances via TField generic — verified by Test 13 which exercises the same component with TREE_SORT_OPTIONS"
  - "D-13 / D-15 / D-16 LOCKED in hydrateSortState: URL wins (Test 7 — localStorage NOT touched when URL valid), URL always explicit (Test 8 — replaceState fills missing param), malformed URL → fallback (Test 10 — never throws)"
  - "D-23 / D-24 / D-25 LOCKED in sortHelpers: localStorage scope keys vfx-familiar:sort:grid + vfx-familiar:sort:tree (D-23); JSON object value shape with whitelist re-validation on read (D-24, Test 11); LRU primitive with cap=50 + companion `_lru` key (D-25, Tests 15-18)"
  - "Tab key APG editorial behavior (rather than 'cancel without selecting'): Tab inside listbox SELECTS the focused option + closes — researcher recommendation from 18-RESEARCH.md Pattern 5 reference implementation"
  - "@testing-library/user-event NOT added as a new dependency (UI-SPEC §Registry Safety): SortDropdown tests use fireEvent.keyDown directly, mirroring TreeSidebar.test.tsx + Thumbnail.test.tsx existing patterns"

patterns-established:
  - "Type-mirror pattern for D-WEBUI-31 architecture-purity: dashboard package mirrors server-side enum types via local re-declaration with DUPLICATE OF comment-pin — preserves byte-equal type identity without crossing the architecture boundary"
  - "Generic-typed component pattern for D-08 reuse: <SortDropdown<TField extends string>/> consumed twice with concrete TField (SortField for grid, HierarchySortField for tree) — single component, two parent-rendered instances"
  - "memory-storage polyfill + URL/history mock setup pattern: setupEnv(search, opts?) helper returns { storage, replaceStateSpy } for per-test isolation — extends the theme-persistence.test.ts polyfill to URL state mocking"
  - "Three-layer persistence write pattern: persistGridSort/persistTreeSort write URL via history.replaceState + localStorage via setBoundedLocalStorageEntry; both wrapped in try/catch for silent fall-through on quota/privacy errors"

requirements-completed: []  # SORT-02, SORT-03, SORT-04 cohort closure pending Plan 18-05 wiring
# (this plan provides the dashboard primitives; the requirements close cohort-level after HomeView wiring lands in Plan 18-05)

# Metrics
duration: 14min
completed: 2026-05-06
---

# Phase 18 Plan 04: Dashboard Primitives Summary

**Dashboard-side primitives for sortable folder dropdown — 4 NEW files (sortTypes/sortHelpers/SortDropdown/LoadMoreButton) + copy.ts extension — built INDEPENDENTLY of server wiring (Wave 2 parallel with Plan 18-02) per D-WEBUI-31 architecture-purity (zero src/ imports). 49 new tests cover URL parser + localStorage state machine + LRU primitive + tree comparator + WAI-ARIA APG combobox + pagination button. DEVIATION 1: GRID_SORT_OPTIONS ships 3 entries (Name A→Z dropped because versions table has no name column).**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-06T17:08:24Z
- **Completed:** 2026-05-06T17:22:00Z (approx)
- **Tasks:** 3 (TDD: each task RED + GREEN; Task 1 also had a small Rule 1 fix)
- **Files created:** 7 new files (4 production + 3 test)
- **Files modified:** 1 (packages/dashboard/src/lib/copy.ts)

## Accomplishments

- **D-WEBUI-31 architecture-purity preserved at every gate** — `grep -rE "from\s+['\"]\.\.\/\.\.\/src" packages/dashboard/src/lib/sortTypes.ts packages/dashboard/src/lib/sortHelpers.ts packages/dashboard/src/components/SortDropdown.tsx packages/dashboard/src/components/LoadMoreButton.tsx` returns zero matches. Type identity with src/store/sort.ts maintained via local mirror with `DUPLICATE OF` comment-pin.
- **WAI-ARIA APG combobox 1.2 select-only pattern complete** — 6 ARIA attributes on the trigger (combobox role, haspopup, expanded, controls, activedescendant, label), role='listbox' + matching id on popover, role='option' + aria-selected on items. 8 keyboard handlers cover Enter/Space/ArrowUp/ArrowDown/Home/End/Escape/Tab per APG editorial. Outside-click via document mousedown listener (only attached while open). Focus returns to trigger on Escape/Enter-on-option/Tab.
- **D-13 / D-15 / D-16 hydrateSortState state machine LOCKED** — URL wins doesn't touch localStorage (Test 7), URL always shows current sort via replaceState (Test 8), malformed URL → graceful fallback to default + console.warn (Test 10). hydrateSortState NEVER throws — wraps URL parse + localStorage read in try/catch.
- **D-23 / D-24 / D-25 localStorage contract LOCKED** — scope keys `vfx-familiar:sort:grid` + `vfx-familiar:sort:tree` (D-23); JSON `{field, dir}` value shape validated against the same whitelist as the URL boundary (D-24); LRU primitive with cap=50 + companion `_lru` key MRU-ordered (D-25). Tests 15-18 cover eviction, MRU touch, corrupt _lru rebuild, and quota silent fall-through.
- **DEVIATION 1 transparently documented** — GRID_SORT_OPTIONS has 3 entries (Latest / Oldest / Version ↓), 'Name A→Z' DROPPED because the versions table has no `name` column (verified at src/store/schema.ts:66-102). The engine SortField enum still includes `name` (falls back to versions.id) so the SORT-02 whitelist invariant holds engine-side; only the UI surface narrows. Test 23 asserts the 3-entry shape with explicit `expect(labels).not.toContain('Name A→Z')`.
- **D-08 reuse LOCKED via TField generic** — SortDropdown is consumed twice in Plan 18-05 (one with GRID_SORT_OPTIONS for the version grid, one with TREE_SORT_OPTIONS for the tree). Test 13 exercises the same component with TREE_SORT_OPTIONS to prove generic over field enum works.
- **Zero new dashboard dependencies** — `git diff packages/dashboard/package.json` returns empty diff. Component imports limited to `preact/hooks` (useState/useRef/useEffect/useId), `preact` types (VNode/JSX), `lucide-preact` (ChevronDown/Check icons) — all pre-existing. UI-SPEC §"Registry Safety" gate satisfied.
- **Tool budget unchanged at 7-of-12** — `tool-budget.test.ts` regression green; this plan adds zero MCP tools.
- **49 new tests across 3 files** — 25 sortHelpers (state machine + LRU + comparator + options shape) + 14 SortDropdown (ARIA + keyboard + focus + outside-click) + 10 LoadMoreButton (default/loading/error states + tabular nums + page-size default).

## Task Commits

Each task committed atomically with the TDD gate sequence (test → feat):

1. **Task 1 RED — failing sort helpers tests** — `576d708` (test): created sortHelpers.test.ts with 25 tests across 8 describe blocks. Tests fail with "Cannot find module" — RED gate confirmed.
2. **Task 1 GREEN — sortTypes.ts mirror + sortHelpers.ts implementation** — `0280419` (feat): created sortTypes.ts (52 lines) with DUPLICATE OF comment-pin and sortHelpers.ts (376 lines including documentation) with all 9 exports + SortOption interface. All 25 tests pass; tsc clean.
3. **Task 2 RED — failing SortDropdown tests** — `d585cbc` (test): created SortDropdown.test.tsx with 14 tests covering UI-SPEC §"<SortDropdown/> API contract". Tests fail with "Cannot find module" — RED gate confirmed.
4. **Task 2 GREEN — SortDropdown.tsx + Phase 18 copy strings** — `90dd0e1` (feat): created SortDropdown.tsx (251 lines) implementing WAI-ARIA APG combobox 1.2 + extended copy.ts with 7 Phase 18 constants. All 14 tests pass; tsc clean.
5. **Task 3 RED — failing LoadMoreButton tests** — `3dc222f` (test): created LoadMoreButton.test.tsx with 10 tests (9 from plan + 1 edge case for `min(pageSize, remaining)`). Tests fail with "Cannot find module" — RED gate confirmed.
6. **Task 3 GREEN — LoadMoreButton.tsx implementation** — `d26224d` (feat): created LoadMoreButton.tsx (122 lines) with default/loading/error states. All 10 tests pass; full dashboard suite 117 → 166 tests (+49 from this plan); tsc clean.
7. **Rule 1 fix — drop unused locals in sortHelpers.test.ts** — `fcde665` (fix): the dashboard's tsconfig has `noUnusedLocals=true` (project root tsc with `moduleResolution: bundler` skipped the dashboard package and didn't surface this); removed unused `LRU_KEY` const, `HierarchySort` type-only import, and `_MentionedTypes` dummy alias. No behavior change in tests.

## Plan-Level TDD Gate Compliance

Plan 18-04 has `type=execute` (not `type=tdd`) so Plan-Level TDD gate enforcement does not apply, but each individual task carries `tdd="true"` and the git log shows the proper RED → GREEN sequence per task:

| Task | RED commit | GREEN commit | Tests at GREEN |
|------|------------|--------------|----------------|
| 1    | 576d708    | 0280419      | 25/25 pass     |
| 2    | d585cbc    | 90dd0e1      | 14/14 pass     |
| 3    | 3dc222f    | d26224d      | 10/10 pass     |

## Architecture-Purity Verification

`grep -rE "from\\s+['\"]\\.\\.\\/\\.\\./src" <files>`:

```
packages/dashboard/src/lib/sortTypes.ts          0 matches
packages/dashboard/src/lib/sortHelpers.ts        0 matches
packages/dashboard/src/components/SortDropdown.tsx    0 matches
packages/dashboard/src/components/LoadMoreButton.tsx  0 matches
```

D-WEBUI-31 invariant preserved across all 4 new files. Type identity with `src/store/sort.ts` maintained via the `DUPLICATE OF` comment-pin in `sortTypes.ts`.

## WAI-ARIA APG Combobox Compliance

| Attribute / Handler | Required by APG 1.2 select-only | Present in SortDropdown.tsx |
|--------------------|--------------------------------|------------------------------|
| trigger `role="combobox"` | yes | yes (line 230) |
| trigger `aria-haspopup="listbox"` | yes | yes (line 234) |
| trigger `aria-expanded` | yes (true/false) | yes (line 232) |
| trigger `aria-controls` | yes (matches listbox id) | yes (line 233) |
| trigger `aria-activedescendant` | yes (when open) | yes (line 235) |
| trigger `aria-label` | yes (required prop) | yes (line 231) |
| popover `role="listbox"` | yes | yes (line 245) |
| popover `id` | yes (matches aria-controls) | yes (line 244) |
| option `role="option"` | yes | yes (line 257) |
| option `aria-selected` | yes (true on current) | yes (line 258) |
| Enter/Space on trigger | open/close toggle | yes (line 174) |
| ArrowDown on trigger | open with focus on selected | yes (line 174) |
| ArrowUp on trigger | open with focus on last | yes (line 178) |
| Escape on trigger / listbox | close with focus return | yes (lines 181, 203) |
| ArrowDown / ArrowUp in listbox | navigate with wrap | yes (lines 188, 191) |
| Home / End in listbox | jump to first / last | yes (lines 194, 197) |
| Enter / Space in listbox | select + close | yes (line 200) |
| Tab in listbox | APG editorial: select + close | yes (line 206) |
| Outside-click | close without selecting | yes (line 161 — document mousedown) |
| Focus return on close | trigger.focus() | yes (line 144) |

All 6 ARIA attributes + 8 keyboard handlers + outside-click + focus management present.

## LRU Primitive Coverage

`setBoundedLocalStorageEntry(prefix, key, value, maxKeys)` implements D-25 forward-compat with the following invariants (proven by Tests 15-18):

- **Eviction at cap (Test 15):** writing 51 keys with `maxKeys=50` evicts the oldest key (`k0`); the companion `_lru` key holds the most-recent 50 keys ordered MRU-first (`k50` at index 0).
- **MRU touch (Test 16):** rewriting an existing key moves it to the front of `_lru` without duplication — `lruList` shape `[k1, k2]` after touching `k1` again (no `[k1, k2, k1]`).
- **Corrupt companion rebuild (Test 17):** if `_lru` contains invalid JSON, the helper treats it as empty and rebuilds — never throws.
- **Quota silent fall-through (Test 18):** `localStorage.setItem` throwing `QuotaExceededError` results in a silent no-op — never throws (matches Pitfall E from 18-RESEARCH.md and the existing ThemeToggle.tsx precedent).

## Test Count Delta

| Suite              | Before | After | Δ    |
|--------------------|--------|-------|------|
| dashboard root     | 117    | 166   | +49  |
| - sortHelpers      | n/a    | 25    | +25  |
| - SortDropdown     | n/a    | 14    | +14  |
| - LoadMoreButton   | n/a    | 10    | +10  |
| server tool-budget | 3      | 3     |  0   |

Plan target: ~+48 tests. Actual: +49 (the extra is Test 10 in LoadMoreButton — `min(pageSize, remaining)` edge case).

## Pre-existing Failure Count vs Baseline

Baseline (before Plan 18-04): 117/117 dashboard tests passing; 0 failures.
After Plan 18-04: 166/166 dashboard tests passing; 0 failures. **No regressions.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused locals in sortHelpers.test.ts**
- **Found during:** Final verification (Task 3 complete)
- **Issue:** Dashboard's tsconfig has `noUnusedLocals=true`. The original test file declared three symbols that were never read in assertions: `LRU_KEY` const, `HierarchySort` type-only import, and `_MentionedTypes` dummy type alias. Project-root `npx tsc --noEmit` returned exit 0 (the dashboard subpackage uses `moduleResolution: bundler` which makes the root tsc skip it), but `cd packages/dashboard && npx tsc --noEmit` surfaced TS6133/TS6196 errors that would block dashboard builds.
- **Fix:** Removed the three unused symbols. No assertion behavior changed.
- **Files modified:** `packages/dashboard/src/__tests__/sortHelpers.test.ts`
- **Commit:** `fcde665`

No other deviations. The plan was executed exactly as written; DEVIATION 1 (3-entry GRID_SORT_OPTIONS) was a pre-recorded plan-level deviation, not a deviation from the plan.

## Plan Outputs

- `packages/dashboard/src/lib/sortTypes.ts` (52 lines, NEW) — Type mirror of server-side sort enums with DUPLICATE OF comment-pin. Exports 7 symbols: `SortField`, `HierarchySortField`, `SortDirection`, `VersionSort`, `HierarchySort`, `DEFAULT_VERSION_SORT`, `DEFAULT_HIERARCHY_SORT`.
- `packages/dashboard/src/lib/sortHelpers.ts` (457 lines, NEW) — 9 exports + `SortOption<F>` generic interface: `parseSortValue`, `serializeSortValue`, `hydrateSortState`, `persistGridSort`, `persistTreeSort`, `setBoundedLocalStorageEntry`, `compareTreeNodes`, `GRID_SORT_OPTIONS` (3 entries — DEVIATION 1), `TREE_SORT_OPTIONS` (4 entries verbatim D-07).
- `packages/dashboard/src/components/SortDropdown.tsx` (280 lines, NEW) — Generic-typed Preact component implementing WAI-ARIA APG combobox 1.2 select-only pattern. Exports `SortDropdown` function + `SortDropdownProps` and `SortOption` interfaces.
- `packages/dashboard/src/components/LoadMoreButton.tsx` (134 lines, NEW) — Pure pagination button with default/loading/error states. Exports `LoadMoreButton` function + `LoadMoreButtonProps` interface.
- `packages/dashboard/src/lib/copy.ts` (+51 lines) — 7 new Phase 18 constants appended after existing Phase 17 block: `SORT_STRIP_LABEL`, `SORT_GRID_ARIA_LABEL`, `SORT_TREE_ARIA_LABEL`, `LOAD_MORE_LOADING_LABEL`, `LOAD_MORE_RETRY_LABEL`, `LOAD_MORE_ERROR_PREFIX_FAILED`, `LOAD_MORE_ERROR_PREFIX_NETWORK`.
- `packages/dashboard/src/__tests__/sortHelpers.test.ts` (466 lines, NEW) — 25 unit tests across 8 describe blocks covering parse/serialize/hydrate/persist/LRU/comparator/options.
- `packages/dashboard/src/__tests__/SortDropdown.test.tsx` (306 lines, NEW) — 14 component tests covering ARIA + keyboard + focus + outside-click.
- `packages/dashboard/src/__tests__/LoadMoreButton.test.tsx` (197 lines, NEW) — 10 tests covering default/loading/error states + tabular nums + pageSize default.

## Plans This Unblocks

- **Plan 18-05** (HomeView integration) — consumes `<SortDropdown/>` × 2 (grid + tree, both reusing the same component per D-08), `<LoadMoreButton/>`, `GRID_SORT_OPTIONS`, `TREE_SORT_OPTIONS`, `hydrateSortState`, `persistGridSort`, `persistTreeSort`, `compareTreeNodes`, plus the Phase 18 copy constants from this plan. Plan 18-05 ALSO consumes the HTTP layer from Plan 18-03 — both Wave 2/3 prerequisites must be merged before 18-05 starts.

## Self-Check: PASSED

Verification of every artifact claimed:

```
[FOUND]  packages/dashboard/src/lib/sortTypes.ts (52 lines)
[FOUND]  packages/dashboard/src/lib/sortHelpers.ts (457 lines)
[FOUND]  packages/dashboard/src/components/SortDropdown.tsx (280 lines)
[FOUND]  packages/dashboard/src/components/LoadMoreButton.tsx (134 lines)
[FOUND]  packages/dashboard/src/__tests__/sortHelpers.test.ts (466 lines)
[FOUND]  packages/dashboard/src/__tests__/SortDropdown.test.tsx (306 lines)
[FOUND]  packages/dashboard/src/__tests__/LoadMoreButton.test.tsx (197 lines)
[MOD]    packages/dashboard/src/lib/copy.ts (+51 lines)

[FOUND] commit 576d708 (test 18-04: failing sortHelpers tests — RED)
[FOUND] commit 0280419 (feat 18-04: sortTypes + sortHelpers — GREEN)
[FOUND] commit d585cbc (test 18-04: failing SortDropdown tests — RED)
[FOUND] commit 90dd0e1 (feat 18-04: SortDropdown + copy.ts — GREEN)
[FOUND] commit 3dc222f (test 18-04: failing LoadMoreButton tests — RED)
[FOUND] commit d26224d (feat 18-04: LoadMoreButton — GREEN)
[FOUND] commit fcde665 (fix 18-04: drop unused locals — Rule 1)

[GATE] tsc --noEmit (project root): exit 0
[GATE] tsc --noEmit (packages/dashboard): exit 0
[GATE] vitest run (packages/dashboard, full suite): 166/166 passing
[GATE] grep "from '../../src" (4 new files): zero matches (architecture-purity)
[GATE] git diff packages/dashboard/package.json: empty (no new deps)
[GATE] tool-budget regression (npx vitest): 3/3 passing (no MCP tools added)
```
