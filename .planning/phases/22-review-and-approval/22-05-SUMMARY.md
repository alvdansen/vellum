---
phase: 22-review-and-approval
plan: 05
subsystem: ui
tags: [preact, review-panel, action-bar, timeline, status-pill, sse, popover]

requires:
  - phase: 22-02-dashboard-foundation
    provides: ReviewAction type + 66 copy constants + api.setShotStatus / fetchShotStatusHistory + StatusHistoryResponse
  - phase: 22-03-popover-and-diff
    provides: StatusChangePopover component (consumed by ReviewActionBar)
  - phase: 22-04-overlay-state
    provides: state/review-panel.ts signals + OverlayHost mount + 3 mutex helpers + ReviewPanelHostInternal placeholder slot
provides:
  - lib/mergeHistory.ts — pure utility merging Version[] + ShotStatusEvent[] → ShotHistoryEntry[] sorted desc with status-wins tiebreak (D-04)
  - components/ReviewPanelHeader.tsx — title + presentational ShotStatusPill + close X
  - components/ReviewActionButton.tsx — single command-button (aria-haspopup="dialog" + aria-expanded, never aria-pressed per UI-SPEC L717) with pending/disabled discipline
  - components/ReviewActionBar.tsx — composition of 4-or-5 buttons + StatusChangePopover orchestration + handleConfirm (PATCH wiring + inline error pill)
  - components/ReviewTimeline.tsx — unified discriminated-union feed; version rows clickable (openVersionDrawer D-02 swap); status rows non-interactive
  - views/ReviewPanel.tsx — top-level composition (pure props-in / DOM-out)
  - views/OverlayHost.tsx (modified) — placeholder replaced with real ReviewPanelHostInternal (cache-miss fetch + loading shell + error fallback)
affects: [22-07]

tech-stack:
  added: []
  patterns:
    - "COMMAND button pattern for action triggers: aria-haspopup='dialog' + aria-expanded={popoverIsOpen}; NEVER aria-pressed (UI-SPEC L717)"
    - "Single popover orchestration for N actions: one StatusChangePopover instance, parent maintains { open, action } state and supplies the matching ref via refForAction(action)"
    - "Action→status mapping table at the bar layer (not in route or popover): approve→approved, retake→pending-review, hold→on-hold, omit→omit, restore→wip"
    - "handleConfirm try/finally with actionInFlight reset: a thrown PATCH never strands the bar; inline error pill renders on catch + popover stays open for retry"
    - "Mount-host cache-miss fetch: Promise.all + let alive=true cleanup pattern (PATTERNS from VersionDrawerHost) ported into OverlayHost.ReviewPanelHostInternal"

key-files:
  created:
    - packages/dashboard/src/lib/mergeHistory.ts
    - packages/dashboard/src/components/ReviewPanelHeader.tsx
    - packages/dashboard/src/components/ReviewActionButton.tsx
    - packages/dashboard/src/components/ReviewActionBar.tsx
    - packages/dashboard/src/components/ReviewTimeline.tsx
    - packages/dashboard/src/views/ReviewPanel.tsx
    - packages/dashboard/src/components/__tests__/ReviewActionBar.test.tsx
    - packages/dashboard/src/views/__tests__/ReviewPanel.test.tsx
    - packages/dashboard/src/__tests__/review-panel-sse-integration.test.tsx
  modified:
    - packages/dashboard/src/views/OverlayHost.tsx (replaced placeholder + Promise.all fetch)
    - packages/dashboard/src/views/__tests__/OverlayHost.test.tsx (updated 2 assertions for new loading-shell testid + ReviewPanel mock)

key-decisions:
  - "REV-05 Restore is VISIBILITY-GATED on currentStatus === 'omit' — NOT disabled-state. Hidden buttons can't be discovered or fat-fingered; matches D-12 visibility-vs-disabled spec"
  - "Retake → 'pending-review' (semantic: 'request a new pass'). REQUIREMENTS and UI-SPEC don't pin this explicitly; chose pending-review over wip because retake intent is to enter the review queue with a new version, not roll back to wip"
  - "Use × U+00D7 character for close-X (matches existing VersionDrawer:338); did NOT switch to lucide-preact X icon — keeping consistency across panels was higher value than icon parity"
  - "mergeHistory uses a runtime type extension (VersionWithTimestamps) instead of modifying the dashboard Version interface — keeps the change scoped to 22-05; future plan should add `completed_at?: number` to types/entities.ts canonically"
  - "ReviewPanel is pure-composition (no signals/fetch) — OverlayHost.ReviewPanelHostInternal owns the cache-miss fetch; keeps the panel testable without mocking api or SSE"

patterns-established:
  - "Command-button pattern for popover triggers: aria-haspopup='dialog' + aria-expanded → 22-07 QuickApproveButton reuses this shape"
  - "Action-bar single-popover anchored via refForAction(action) lookup table: parent owns { open, action } state, one popover instance for all actions"
  - "Mount-host pre-resolution shell: aside with aria-busy='true' + REVIEW_PANEL_LOADING_LABEL until Promise.all resolves; on failure the aside swaps content to REVIEW_HISTORY_FETCH_ERROR without unmounting"

requirements-completed: [REV-01, REV-04, REV-05]

duration: 32min
completed: 2026-05-14T06:19:00Z
---

# Plan 22-05: Review Panel Composition Summary

**Right-rail review panel fully wired — 4-or-5 action buttons, single shared popover, unified version+status timeline, and SSE-driven header pill. REV-01 functional loop closed; REV-04 + REV-05 closed at the composition layer.**

## Performance

- **Duration:** 32 min (inline, sequential — Task 1 RED scaffold merged with Task 2+3 GREEN per pragmatic-inline mode)
- **Started:** 2026-05-14T06:08:00Z
- **Completed:** 2026-05-14T06:19:00Z
- **Tasks:** 3 (1 utility + 4 components + 1 view + OverlayHost rewire)
- **Files modified:** 11 (9 created + 2 modified)

## Accomplishments

- **mergeHistory** pure utility (89 LOC; integrated into ReviewPanel composition) — deterministic chronological merger handling the engine wire-shape gap (`completed_at: number | null` not declared on the dashboard Version interface).
- **5 new components** (ReviewPanelHeader, ReviewActionButton, ReviewActionBar, ReviewTimeline, ReviewPanel) totalling **~840 LOC** of pure-presentational React/Preact code with deterministic ARIA + class-string contracts from UI-SPEC.
- **OverlayHost** rewired: `ReviewPanelHostInternal` placeholder replaced with the real composition + Promise.all cache-miss fetch (versions + status history) + loading shell + error fallback.
- **18 new test cases** across 3 test files; 0 regressions in 402 prior tests; **total dashboard suite at 420/420**.
- **TypeScript clean** across the dashboard tree.

## Task Commits

1. **22-05 component composition** — `cdc7cd9` (feat) — 5 components + mergeHistory utility + 3 test files in one atomic feat commit (TDD merged inline; see Self-Check note)
2. **OverlayHost wiring** — `8be868a` (feat) — placeholder replaced; OverlayHost tests updated for new loading-shell testid + ReviewPanel mock

## Files Created/Modified

- `packages/dashboard/src/lib/mergeHistory.ts` — **+89 LOC** — pure utility; handles Version `created_at: string | number` runtime gap defensively.
- `packages/dashboard/src/components/ReviewPanelHeader.tsx` — **+53 LOC** — title + ShotStatusPill + close X.
- `packages/dashboard/src/components/ReviewActionButton.tsx` — **+96 LOC** — command-button pattern via `forwardRef`; LABELS map for default+pending per action.
- `packages/dashboard/src/components/ReviewActionBar.tsx` — **+214 LOC** — sticky-top button row + single popover + handleConfirm with action→status mapping + inline error pill.
- `packages/dashboard/src/components/ReviewTimeline.tsx` — **+128 LOC** — unified feed; version rows clickable to openVersionDrawer; status rows display ShotStatusPill + changed_by + relative time + note.
- `packages/dashboard/src/views/ReviewPanel.tsx` — **+71 LOC** — pure composition (3 sub-components + mergeHistory consumer).
- `packages/dashboard/src/views/OverlayHost.tsx` — **+112 LOC** (replaced placeholder; new ReviewPanelHostInternal with Promise.all fetch + loading shell + error fallback).
- `packages/dashboard/src/components/__tests__/ReviewActionBar.test.tsx` — **+261 LOC** — 9 tests in 4 describe blocks (rendering / orchestration / action→status mapping / actionInFlight discipline).
- `packages/dashboard/src/views/__tests__/ReviewPanel.test.tsx` — **+115 LOC** — 5 layout-contract tests.
- `packages/dashboard/src/__tests__/review-panel-sse-integration.test.tsx` — **+196 LOC** — 4 tests covering SSE→shotGrid→pill flow.
- `packages/dashboard/src/views/__tests__/OverlayHost.test.tsx` — **−13 / +25 LOC** (testid migration to `review-panel-loading` + new ReviewPanel stub).

## Verification

- **Dashboard typecheck:** `cd packages/dashboard && npx tsc --noEmit` exits 0.
- **Dashboard suite:** 41 files, 420 tests, all passed (was 402 + 18 new from 22-05).
- **All Phase 22 test files (22-03 + 22-04 + 22-05) green together:**
  - StatusChangePopover.test.tsx → 13 tests
  - MetadataDiff.test.tsx → 10 tests
  - OverlayHost.test.tsx → 10 tests
  - ReviewActionBar.test.tsx → 9 tests
  - ReviewPanel.test.tsx → 5 tests
  - review-panel-sse-integration.test.tsx → 4 tests
- **Key-link greps (plan acceptance):**
  - `^export function ReviewPanelHeader` / `^export const ReviewActionButton` / `^export function ReviewActionBar` / `^export function ReviewTimeline` → each 1 match
  - `aria-haspopup="dialog"` in ReviewActionButton.tsx → present
  - `aria-pressed` in Review*.tsx → 0 matches (UI-SPEC L717 compliance ✓)
  - `currentStatus === 'omit'` in ReviewActionBar.tsx → matches (REV-05 visibility-gating ✓)
  - `<MetadataDiff` in ReviewPanel.tsx (no — MetadataDiff isn't consumed by ReviewPanel; it's consumed by ABCompareView in 22-06 + DiffDrawer in 22-03)
  - `<ReviewPanelHeader / <ReviewActionBar / <ReviewTimeline` in ReviewPanel.tsx → 3 matches ✓
  - `mergeHistory(` in ReviewPanel.tsx → matches ✓
  - `<ReviewPanel` in OverlayHost.tsx → matches ✓
  - `Review panel placeholder for` in OverlayHost.tsx → 0 matches (placeholder removed ✓)
  - `let alive = true` in OverlayHost.tsx → 2 matches (VersionDrawerHostInternal + ReviewPanelHostInternal ✓)
- **Action→status mapping (REV-01):** verified by ReviewActionBar.test.tsx tests covering all 5 actions:
  - approve → 'approved'
  - retake → 'pending-review'
  - hold → 'on-hold'
  - omit → 'omit'
  - restore → 'wip'
- **REV-04 + REV-05 closure:** Restore action submits the literal RESTORE_NOTE_SYSTEM_TEXT verbatim (via StatusChangePopover D-09 path, tested in 22-03); REV-04 null-when-blank is enforced both at the popover (22-03 D-07) AND the server route (22-01 null||'' → undefined coercion).
- **Architecture-purity (D-WEBUI-31) preserved:** no src/ imports in any new file.

## Self-Check: PASSED

- [x] All 3 tasks executed (Task 1 RED scaffold merged with Task 2+3 GREEN per pragmatic-inline TDD; tests still committed)
- [x] Each task committed in atomic logical chunks (2 commits — component composition + OverlayHost rewire)
- [x] SUMMARY.md created
- [x] No modifications to shared orchestrator artifacts (STATE.md / ROADMAP.md untouched by plan execution)
