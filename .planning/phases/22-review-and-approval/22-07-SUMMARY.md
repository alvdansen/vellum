---
phase: 22-review-and-approval
plan: 07
subsystem: ui
tags: [preact, shot-grid-card, quick-approve, optimistic, compare-mode, phase-gate]

requires:
  - phase: 22-03-popover-and-diff
    provides: StatusChangePopover (consumed by QuickApproveButton)
  - phase: 22-04-overlay-state
    provides: openVersionDrawer / openReviewPanel / closeOverlay helpers; compareSelection / compareModalOpen / quickApproveError signals
  - phase: 22-05-review-panel
    provides: ReviewTimeline (extended here with compare-mode UI)
  - phase: 22-06-ab-compare
    provides: ABCompareView modal (reachable now via the timeline Compare CTA)
provides:
  - components/ShotStatusPill.tsx — D-13 dual-mode (presentational <span> OR command <button> with aria-haspopup="dialog")
  - components/QuickApproveButton.tsx — hover-only Check icon button with Pattern 3 optimistic flow (D-10 + D-12 + Pitfall 5)
  - components/ShotGridCard.tsx — D-13 refactor: outer <div class="group">, 3 sibling buttons (thumbnail / pill / quick-approve), inline WarningPill on failure
  - components/ReviewTimeline.tsx — extended with compare-mode entry CTA + LRU-2 checkbox selection + Compare CTA (D-14, REV-03 entry path)
affects: [Phase 22 ships]

tech-stack:
  added: []
  patterns:
    - "Dual-mode component via optional props: undefined onClick → presentational; onClick provided → interactive (button wrapper). Lets the same component reuse across read-only and clickable contexts without prop-drilling a discriminator"
    - "Pattern 3 optimistic flow: mutate signal FIRST → await PATCH → on success no-op (SSE converges) → on failure revert + raise error signal + 5s setTimeout with signal-value guard for Pitfall 5"
    - "LRU-2 selection state: track selectionOrder.first; third click replaces the OLDER slot, keeping the more recent selection stable (UI-SPEC L520 verbatim)"
    - "Sibling buttons under div.group: eliminates HTML nested-button violation (Pitfall 4); group-hover class on outer div activates hover-only opacity on Check icon (D-10)"

key-files:
  created:
    - packages/dashboard/src/components/QuickApproveButton.tsx
    - packages/dashboard/src/components/__tests__/QuickApproveButton.test.tsx
    - packages/dashboard/src/__tests__/quick-approve-flow.test.tsx
  modified:
    - packages/dashboard/src/components/ShotStatusPill.tsx (dual-mode promotion)
    - packages/dashboard/src/components/ShotGridCard.tsx (D-13 refactor)
    - packages/dashboard/src/components/ReviewTimeline.tsx (compare-mode extension)
    - packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx (version_count helper updated for new pill wrapper)
    - packages/dashboard/src/views/__tests__/ShotGridView.test.tsx (opacity-40 ancestor lookup via .closest)
    - packages/dashboard/src/state/review-panel.ts (JSDoc rewording — `../../src/` literal in a comment tripped architecture-purity grep)

key-decisions:
  - "Pitfall 5 timer guard implemented as in-setTimeout signal-value check: `if (quickApproveError.value === shotId) quickApproveError.value = null`. Verified by quick-approve-flow.test.tsx Test 5 — when error displaces to a different shotId before the timer fires, the stale timeout is a no-op"
  - "ShotGridCard outer wrapper structure: when status==='omit', card is wrapped in `<div class=\"opacity-40\">` containing the `<div class=\"group\">` body. Test queries use `.closest('.opacity-40')` to walk past the inner group ancestor"
  - "QuickApproveButton positioned absolute top-1 right-1 with z-1 — sits on top of the thumbnail content but UNDER the right-rail drawer z-10 (no overlap; the drawer always wins focus)"
  - "ReviewTimeline ESC handler attached only while compareMode=true; checks e.defaultPrevented so popover-level ESC takes precedence when both surfaces are open"
  - "JSDoc comment in state/review-panel.ts triggered architecture-purity regex (`../../src/` literal in a comment). Rephrased to `no server-tree imports` — keeps the architectural intent without the literal pattern"

patterns-established:
  - "Hover-only affordance via group-hover + group-focus-within: opacity-0 default; opacity-100 when ancestor div.group is hovered OR contains focused element (keyboard a11y)"
  - "Optimistic-UI test pattern: render → fire confirm → assert signal mutated BEFORE awaiting; then resolve/reject the pending PATCH and assert success/revert behavior"
  - "Vitest fake-timer + signal-guard pattern: vi.useFakeTimers + vi.advanceTimersByTime(5000) verifies auto-dismissal; manually change signal value to test Pitfall 5 stale-timer no-op"

requirements-completed: [REV-01, REV-02, REV-03]

duration: 38min
completed: 2026-05-14T06:36:00Z
---

# Plan 22-07: Phase Integration + Phase Gate Summary

**Phase 22 is shippable. REV-01 + REV-02 + REV-03 functional loops closed end-to-end. All 8 automated phase-gate checks green; manual browser smoke (A–G) deferred to Timothy's UAT per autonomous-mode execution.**

## Performance

- **Duration:** 38 min (inline; 3 source tasks + phase-gate verification)
- **Started:** 2026-05-14T06:25:00Z
- **Completed:** 2026-05-14T06:36:00Z
- **Tasks:** 4 (3 implementation + 1 verification)
- **Files modified:** 8 (3 created + 5 modified, including 2 test file updates)

## Accomplishments

- **D-13 functional loop closed:** ShotGridCard is now a `<div class="group">` with 3 sibling buttons; ShotStatusPill is dual-mode (clickable on cards, presentational in panels); QuickApproveButton ships the optimistic flow with Pitfall 5 timer guard.
- **REV-02 integrated end-to-end:** click Check icon → popover → Confirm → instant card pill flip → PATCH; on failure inline WarningPill + auto-dismiss 5s with stale-timer guard.
- **REV-03 entry path live:** ReviewTimeline "Compare versions…" CTA + LRU-2 checkbox selection + Compare CTA that flips `compareModalOpen.value = true` → ABCompareHost mounts ABCompareView.
- **14 new tests** (8 QuickApproveButton + 6 quick-approve-flow); 2 pre-existing tests adapted to the D-13 structural change (no assertion weakening — only the locator queries updated for the new ancestor structure).
- **All 8 phase-gate automated checks PASS** (see Verification).

## Task Commits

1. **D-13 refactor: ShotGridCard + QuickApproveButton + ShotStatusPill dual-mode + tests** — combined feat commit
2. **ReviewTimeline compare-mode + LRU-2 + Compare CTA** — separate feat commit
3. **JSDoc rephrasing (state/review-panel.ts) to avoid architecture-purity regex collision** — bundled with phase-gate verification

## Files Created/Modified

- `packages/dashboard/src/components/ShotStatusPill.tsx` — **+30 LOC** — props extended with `onClick?` + `ariaLabel?`; render branches on onClick presence.
- `packages/dashboard/src/components/QuickApproveButton.tsx` — **+115 LOC** — full Pattern 3 optimistic flow.
- `packages/dashboard/src/components/ShotGridCard.tsx` — **−95 / +145 LOC** — full D-13 restructure.
- `packages/dashboard/src/components/ReviewTimeline.tsx` — **+151 LOC** — compare-mode state + toolbar + checkbox rows + ESC handler.
- `packages/dashboard/src/components/__tests__/QuickApproveButton.test.tsx` — **+148 LOC** — 8 tests.
- `packages/dashboard/src/__tests__/quick-approve-flow.test.tsx` — **+216 LOC** — 6 tests including fake-timer Pitfall 5 verification.
- `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` — **−2 / +5 LOC** — version_count helper walks up the new pill <button> wrapper.
- `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` — **−3 / +12 LOC** — opacity-40 ancestor lookup via .closest.
- `packages/dashboard/src/state/review-panel.ts` — **−2 / +2 LOC** — JSDoc rephrasing.

## Phase Gate Verification (all 8 automated checks GREEN)

| # | Check | Command | Result |
|---|-------|---------|--------|
| 1 | Server suite | `npx vitest run` | **1868 passed / 21 pre-existing failures** (matches Phase 21 baseline + 15 new 22-01 tests) |
| 2 | Dashboard suite | `cd packages/dashboard && npx vitest run` | **443/443 passed** (was 361 at Phase 21 — +82 across plans 22-03 through 22-07) |
| 3 | Tool-budget | `npx vitest run src/__tests__/tool-budget.test.ts` | **3/3 passed** — assertion `=== 7` holds (D-21) |
| 4 | Architecture-purity | `npx vitest run src/__tests__/architecture-purity.test.ts` | **54/54 passed** (D-WEBUI-31) |
| 5 | Append-only invariant | `grep -rn 'UPDATE shot_status_events' src/` | **0 matches** in production code (matches are confined to tests + documentation comments — Phase 20 STAT invariant intact) |
| 6 | TypeScript (server + dashboard) | `npx tsc --noEmit` both sides | **both exit 0** |
| 7 | Vite build | `cd packages/dashboard && npx vite build` | **✓ 229ms** / 154KB JS / 32KB CSS |
| 8 | copy.ts exports | `grep -c "^export const" packages/dashboard/src/lib/copy.ts` | **118** (≥ 104 ✓) |

## Pitfall Checklist

| Pitfall | Disposition |
|---------|-------------|
| 1 — engine.setShotStatus positional args | averted (22-01: explicit positional call site) |
| 2 — diffVersions accepts arbitrary pair | confirmed (22-01: no engine signature change) |
| 3 — copy constant casing collisions | averted (22-02: UI-SPEC verbatim values) |
| 4 — nested buttons | averted (22-07: sibling buttons under div.group; verified by `<button>` count = 3 max) |
| 5 — stale setTimeout overwrites | averted (22-07: signal-value guard in setTimeout; verified by quick-approve-flow Test 5) |
| 6 — compareSelection cross-shot leak | averted (22-06: useEffect on activeReviewShotId clears compareSelection + compareModalOpen) |
| 7 — .decode without .onerror fallback | averted (22-06: preloadOne wires BOTH .onload + .onerror; verified by ABCompareView Test 5 simulating onerror) |
| 8 — optimistic mutation + concurrent SSE divergence | accepted (idempotent SSE handler always converges to broadcast value) |
| 9 — popover wrapped in <form> | averted (22-03: StatusChangePopover root is <div>; verified by grep) |
| 10 — strict-equality copy export count assertion | averted (Phase 21 already uses ≥ floor; no assertions changed) |

## Human Verification Queue (deferred to Timothy's UAT per autonomous-mode)

The manual browser smoke (sections A–G of plan Task 4) was not executed inline. These items are persisted into the phase's HUMAN-UAT.md by the orchestrator after VERIFICATION runs.

| Section | Coverage |
|---------|----------|
| A | Review panel happy path (open via pill → Approve → popover → confirm → SSE update) |
| B | REV-05 Restore from omit (5th button visibility + textarea hidden) |
| C | REV-02 quick-approve (hover Check icon + optimistic flip + offline retry → WarningPill) |
| D | REV-03 A/B compare (open from timeline → checkboxes → Compare CTA → modal → ESC close) |
| E | Multi-tab SSE (D-20) |
| F | Reduced motion (D-22) |
| G | Keyboard accessibility (Tab order across 3 card buttons + drawer focus traps) |

## Self-Check: PASSED (automated gate); MANUAL smoke deferred

- [x] All 4 tasks executed (Tasks 1-3 implementation + Task 4 automated gate)
- [x] Each task committed atomically (2 source commits + tracking + summary)
- [x] SUMMARY.md created
- [x] No modifications to shared orchestrator artifacts (STATE.md / ROADMAP.md untouched by plan execution; orchestrator owns post-wave tracking writes)
- [ ] Manual browser smoke (A–G) — DEFERRED to user UAT
