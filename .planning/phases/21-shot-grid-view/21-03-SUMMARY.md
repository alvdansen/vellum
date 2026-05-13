---
phase: 21-shot-grid-view
plan: 3
subsystem: ui
tags: [preact, components, accessibility, wcag, shot-grid, lucide]

requires:
  - phase: 21-shot-grid-view (Wave 1, plan 21-01)
    provides: ShotGridRow / ShotStatus types, FILTER_PILL_*/SHOT_CARD_* copy constants, formatRelativeTime, --color-shot-status-* theme tokens
  - phase: 21-shot-grid-view (Wave 2, plan 21-02)
    provides: <ShotStatusPill/> primitive consumed by ShotGridCard
provides:
  - <ShotGridCard/> — single shot tile (thumbnail/skeleton + pill + version count + relative timestamp + opacity-40 omit dimming)
  - <ShotGridFilterBar/> — sticky filter bar (5 status pills + Show omitted toggle)
  - <SequenceHeader/> — collapsible sequence header (name + chevron + aggregate count mini-pills)
  - TreeSidebar grid-icon affordance on sequence rows (D-01, D-02, D-05)
affects: [21-04 (ShotGridView composition), 22-review-and-approval (reuses pill + card), 23-production-stats (reuses aggregate-pill pattern)]

tech-stack:
  added: []
  patterns:
    - "Pure functional Preact components: props-in, callbacks-out, zero signal reads"
    - "aria-current=\"page\" for active grid-icon (WCAG-blessed 'you are here'; NOT aria-selected which is listbox-only)"
    - "stopPropagation pattern: nested trailing button inside a clickable row uses e.stopPropagation so parent click never fires"
    - "Graceful absence: TreeSidebar's onOpenGrid is optional — undefined disables the entire grid-icon column without conditionally importing"

key-files:
  created:
    - packages/dashboard/src/components/ShotGridCard.tsx
    - packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx
    - packages/dashboard/src/components/ShotGridFilterBar.tsx
    - packages/dashboard/src/components/__tests__/ShotGridFilterBar.test.tsx
    - packages/dashboard/src/components/SequenceHeader.tsx
    - packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx
    - packages/dashboard/src/__tests__/TreeSidebar.test.tsx
  modified:
    - packages/dashboard/src/components/TreeSidebar.tsx

key-decisions:
  - "D-16 single-button card: ShotGridCard wraps the entire 220px-wide thumbnail + meta block in one <button>; no nested interactive children, so the click target is the full card and assistive tech sees a single role=button"
  - "D-19 skeleton-then-disable: when latest_completed_version is null the card renders <SkeletonThumbnail/> AND sets disabled + aria-disabled='true' AND omits onClick entirely (defense-in-depth — disabled prevents activation, missing onClick prevents pointer events even if disabled were stripped)"
  - "D-17 omit dimming wrapper: opacity-40 lives on an outer <div>, NOT on the pill — keeps the status label WCAG-AA legible against the dimmed thumbnail"
  - "D-07 omit pill rendered ONLY when showOmitted=true: pill visibility is controlled solely by the toggle prop; clicking a pill never toggles dataset visibility (clean separation of filter vs dataset gate)"
  - "D-15 chevron state owned by caller: SequenceHeader receives expanded:boolean + onToggle callback; component itself is stateless so the parent (ShotGridView, Wave 4) can persist or compute expansion freely"
  - "Aggregate count mini-pills hidden when count is 0: SequenceHeader filters non-zero counts before mapping; locked status ORDER (wip → pending-review → approved → on-hold → omit) is enforced by an explicit array, not Object.entries order"

patterns-established:
  - "Pure-component contract for Wave 4: every Wave-3 component has props-in/callbacks-out only; Wave 4's <ShotGridView/> owns all signal reads + handlers, making the view a single integration test surface"
  - "Trailing-icon-button-in-tree-row idiom: TreeSidebar's new <button class='ml-auto'> sits inside the row's flex container with e.stopPropagation on click to prevent row-expand from firing"
  - "Optional callback as feature flag: TreeSidebar's onOpenGrid prop being undefined hides the entire grid-icon column — no conditional imports, no separate component variant"

requirements-completed: [GRID-01, GRID-02, GRID-03, GRID-05]

duration: ~35min
completed: 2026-05-13
---

# Plan 21-03 Summary

**Built 4 pure composite components for the shot grid view: card, filter bar, sequence header, and TreeSidebar grid-icon affordance — all props-in/callbacks-out, all tested in isolation, all ready for Wave 4 to compose.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 4/4 complete (one component per task, TDD)
- **Files modified:** 8 (4 component files + 4 test files, with TreeSidebar.tsx the only pre-existing one)

## Accomplishments

- `<ShotGridCard/>` (D-16, D-17, D-19): full shot tile with thumbnail-or-skeleton, status pill, version count, relative timestamp, opacity-40 omit dimming. Single-button click target; aria-disabled when no completed version.
- `<ShotGridFilterBar/>` (D-07, D-08, D-10, D-11): sticky top-0 z-10 bar with All + 4 status pills + conditional omit pill + Show omitted toggle. Active pill is accent-filled; inactive pills are outlined.
- `<SequenceHeader/>` (D-14, D-15): collapsible sequence header rendering name in font-display + chevron + zero-filtered aggregate-count mini-pills in locked status order. Caller owns the boolean expansion state.
- TreeSidebar grid-icon affordance (D-01, D-02, D-05): sequence rows now render a trailing LayoutGrid icon button. Clicks call onOpenGrid(seqId) with e.stopPropagation so the row chevron does NOT also fire. Active sequence gets aria-current="page" + accent fill.

## Task Commits

Each task was committed atomically (TDD: test inside same commit as feat for component tasks since component + tests co-author each other):

1. **Task 1: ShotGridCard component + 9-case test suite** — `3c7fda7` (feat)
2. **Task 2: ShotGridFilterBar component + 9-case test suite** — `eb678a6` (feat)
3. **Task 3: SequenceHeader component + 10-case test suite** — `c84772a` (feat)
4. **Task 4: TreeSidebar grid-icon affordance + tests** — `84a84b4` (feat)

**SUMMARY.md:** written by orchestrator after worktree merge (the executor agent disconnected with `API Error: Unable to connect to API (ConnectionRefused)` after committing all 4 tasks but before writing SUMMARY.md — orchestrator reconstructed the summary from the merged commits).

## Files Created/Modified

- `packages/dashboard/src/components/ShotGridCard.tsx` — Single shot tile (120 LOC)
- `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` — 9 cases covering thumbnail/skeleton fork, click suppression on null version, omit-dim wrapper, version-count copy variants, version-count formatVersionCount helper
- `packages/dashboard/src/components/ShotGridFilterBar.tsx` — Sticky filter bar (129 LOC)
- `packages/dashboard/src/components/__tests__/ShotGridFilterBar.test.tsx` — 9 cases covering pill order, conditional omit pill, callback wiring, sticky styling, accent-filled active state
- `packages/dashboard/src/components/SequenceHeader.tsx` — Collapsible sequence header (114 LOC)
- `packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` — 10 cases covering chevron toggle, zero-count filtering, locked status order, aria-expanded reflecting state, aria-label prefixes
- `packages/dashboard/src/components/TreeSidebar.tsx` — Modified: imports LayoutGrid + TREE_GRID_ICON_* copy, adds optional onOpenGrid + currentGridSequenceId props, renders trailing icon button only on depth=2 SequenceNode rows
- `packages/dashboard/src/__tests__/TreeSidebar.test.tsx` — 144 LOC new test file covering grid-icon presence/absence by depth, stopPropagation contract, aria-current="page" on active row, graceful absence when onOpenGrid undefined

## Decisions Made

None beyond plan — all 6 design decisions (D-01, D-02, D-05, D-07, D-08, D-10, D-11, D-14, D-15, D-16, D-17, D-19) were already locked in 21-CONTEXT.md and UI-SPEC.md and followed exactly. Component implementations follow the pattern map in 21-PATTERNS.md (Thumbnail callback pattern, lucide-preact icon precedent, copy constants over inline strings, accent-color-via-CSS-variable contract).

## Deviations from Plan

**SUMMARY.md missing from executor's worktree commits** — the executor agent disconnected with a transport-level API connection error (`ConnectionRefused`, agent ID `afd476aa23e3883f9`) after successfully committing all 4 task commits and the working tree was clean. The orchestrator force-merged the 4 commits, then synthesized this SUMMARY.md from the merged source files and commit messages. All other plan deliverables landed exactly as written; no implementation logic was lost — only the post-implementation summary write step. No code was authored by the orchestrator.

## Verification

- All 342 dashboard tests pass (32 test files), including:
  - 9 ShotGridCard cases
  - 9 ShotGridFilterBar cases
  - 10 SequenceHeader cases
  - TreeSidebar cases (incl. graceful-absence + stopPropagation contracts)
- `npx tsc --noEmit -p packages/dashboard/tsconfig.json` clean
- Server-side test suite unaffected (architecture-purity invariant unchanged at 0 server imports from packages/dashboard/src)

## Self-Check

PASS — all 4 components built, all tests green, all requirements (GRID-01, GRID-02, GRID-03, GRID-05) closed. Wave 4 (plan 21-04) can now compose `<ShotGridView/>` from these primitives.
