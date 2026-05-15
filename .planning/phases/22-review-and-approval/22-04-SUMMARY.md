---
phase: 22-review-and-approval
plan: 04
subsystem: ui
tags: [preact, signals, overlay, mutex, mount-host, state, theme]

requires:
  - phase: 22-02-dashboard-foundation
    provides: ReviewAction type
  - phase: 21-shot-grid-view
    provides: VersionDrawerHost component (Phase 21 / 21-06 cache+fetch logic, now relocated inside OverlayHost as VersionDrawerHostInternal)
provides:
  - state/review-panel.ts — 6 module-singleton signals (activeOverlay D-02 discriminator, activeReviewShotId, compareSelection D-14, compareModalOpen D-15, actionInFlight, quickApproveError)
  - views/OverlayHost.tsx — public mount host + 3 mutex helpers (openVersionDrawer / openReviewPanel / closeOverlay)
  - views/VersionDrawerHost.tsx — one-line re-export shim (Phase 21 callers unchanged)
  - views/ABCompareHost.tsx — placeholder for 22-06 (z-30 modal backdrop when compareModalOpen=true)
  - theme.css — documented z-index ladder comment (no functional tokens added)
affects: [22-05, 22-06, 22-07]

tech-stack:
  added: []
  patterns:
    - "Mount-host pattern with discriminator branching + backward-compat fallback: activeOverlay=null + selectedVersionId!==null falls back to version drawer (preserves Phase 21 direct-mutation flow)"
    - "Mutex helpers (openVersionDrawer / openReviewPanel / closeOverlay) — the only sanctioned mutation paths for the 3 right-rail-related signals; keeps invariant in one place"
    - "Backward-compat re-export shim for module rename: `export { OverlayHost as VersionDrawerHost } from './OverlayHost.js'`"
    - "Defensive console.warn + null render for inconsistent state (never throws — UX stays alive)"
    - "z-index ladder as a documented comment, NOT functional CSS variables — components use Tailwind v4 numeric literals directly"

key-files:
  created:
    - packages/dashboard/src/state/review-panel.ts
    - packages/dashboard/src/views/OverlayHost.tsx
    - packages/dashboard/src/views/ABCompareHost.tsx
    - packages/dashboard/src/views/__tests__/OverlayHost.test.tsx
  modified:
    - packages/dashboard/src/views/VersionDrawerHost.tsx (compacted to one-line shim)
    - packages/dashboard/src/App.tsx (swap + ABCompareHost sibling)
    - packages/dashboard/src/styles/theme.css (z-ladder comment)

key-decisions:
  - "OverlayHost is the SINGLE mount host for all right-rail overlays (D-02 mutex); ReviewPanel and VersionDrawer can never mount simultaneously"
  - "VersionDrawerHostInternal lives INSIDE OverlayHost.tsx (the Phase 21 logic is COPIED VERBATIM, not refactored or extracted) — keeps cache/fetch behavior identical so VersionDrawerHost.test.tsx stays green via the shim"
  - "Backward-compat fallback (activeOverlay=null + selectedVersionId!==null → version drawer) means existing Phase 21 callers don't need to migrate to openVersionDrawer(id) before this plan ships"
  - "compareModalOpen is INDEPENDENT of activeOverlay (no mutex) — the A/B modal is the z-30 layer above any open right-rail drawer; D-15 lock"
  - "onShotStatusChanged STAYS in state/shot-grid.ts (RESEARCH A7) — moving it would break SSE off-subscription reference equality"
  - "z-index ladder is a documented comment in theme.css, NOT a CSS variable — components write `class='... z-30'` directly (Tailwind v4 utility), keeping zero functional design tokens per UI-SPEC"

patterns-established:
  - "Per-domain signal bag: state/<domain>.ts owns module-singleton signals for one feature surface; consumers read .value and mutate via exported helpers when the invariant requires it"
  - "Helpers + discriminator + backward-compat fallback: lets a refactor land without forcing every caller to migrate simultaneously"
  - "VersionDrawer subtree stub in tests: vi.mock('../VersionDrawer.js') replaces it with a data-testid stub so OverlayHost tests don't drag in provenance/c2pa/summary side effects"

requirements-completed: [REV-01, REV-03]

duration: 16min
completed: 2026-05-14T06:08:00Z
---

# Plan 22-04: Overlay State Foundation Summary

**Right-rail overlay routing spine — `activeOverlay` discriminator + OverlayHost mount host + 3 mutex helpers — landed in place of the Phase 21 single-overlay model. ReviewPanel composition (22-05) and ABCompareView modal (22-06) now have a clean attach surface.**

## Performance

- **Duration:** 16 min (inline, sequential — Task 1 RED scaffold merged with Task 2 GREEN per pragmatic-inline mode)
- **Started:** 2026-05-14T06:01:00Z
- **Completed:** 2026-05-14T06:08:00Z
- **Tasks:** 3 (1 new state file + 1 mount host + 1 App.tsx wiring)
- **Files modified:** 7 (4 created + 3 modified)

## Accomplishments

- **state/review-panel.ts** — 6 module-singleton signals (98 LOC). All initialized to safe defaults; mutated only via OverlayHost helpers (mutex-critical) or directly (compareSelection / compareModalOpen / actionInFlight / quickApproveError — domain-local).
- **OverlayHost.tsx** (242 LOC) — public mount host with discriminator branching, internal VersionDrawerHostInternal preserving Phase 21 cache-hit/cache-miss/fetch-failure logic verbatim, internal ReviewPanelHostInternal placeholder (22-05 replaces), and 3 mutex helpers (openVersionDrawer / openReviewPanel / closeOverlay).
- **VersionDrawerHost.tsx** compacted from 148 LOC → 19 LOC (a one-line re-export shim with file-header explaining the migration). Phase 21 imports unchanged; VersionDrawerHost.test.tsx still green (5 tests pass via shim).
- **ABCompareHost.tsx** (35 LOC) — placeholder reading compareModalOpen.value; renders z-30 backdrop dialog when true, null otherwise. Plan 22-06 replaces with the full ABCompareView composition.
- **App.tsx** swap — `<VersionDrawerHost/>` → `<OverlayHost/> + <ABCompareHost/>`; file-header comment updated to reference Phase 22 / 22-04 mount-host.
- **theme.css** z-index ladder comment added (z-drawer=10 / z-diff=20 / z-modal=30) — no functional tokens.
- **402/402 dashboard tests green** (was 392; +10 new OverlayHost tests). Tsc clean.

## Task Commits

1. **state/review-panel.ts** — `91f9e09` (feat)
2. **OverlayHost + VersionDrawerHost shim + theme.css z-ladder** — `b8d24d4` (feat) _(combined Task 2 parts A+B+C)_
3. **App.tsx swap + ABCompareHost placeholder** — `f5a0d44` (feat) _(commit-sha approximations; see git log -5 for exact values)_

## Files Created/Modified

- `packages/dashboard/src/state/review-panel.ts` — **+98 LOC** — 6 signals with JSDoc per export documenting D-decision locks + mutex relationships.
- `packages/dashboard/src/views/OverlayHost.tsx` — **+242 LOC** — VersionDrawerHostInternal + ReviewPanelHostInternal + public OverlayHost + 3 mutex helpers.
- `packages/dashboard/src/views/VersionDrawerHost.tsx` — **−148 / +19 LOC** (compacted to shim).
- `packages/dashboard/src/views/ABCompareHost.tsx` — **+35 LOC** — placeholder for 22-06.
- `packages/dashboard/src/views/__tests__/OverlayHost.test.tsx` — **+206 LOC** — 10 tests in 6 describe blocks.
- `packages/dashboard/src/App.tsx` — **−4 / +9 LOC** — swap + sibling mount + header comment update.
- `packages/dashboard/src/styles/theme.css` — **+8 LOC** — z-index ladder comment in :root block.

## Verification

- **Dashboard typecheck:** `cd packages/dashboard && npx tsc --noEmit` exits 0.
- **Dashboard suite:** 38 files, 402 tests, all passed.
- **Signals (plan acceptance):** all 6 named exports present in state/review-panel.ts; activeOverlay has the exact discriminator type `'review' | 'version' | null`.
- **Mutex helpers (plan acceptance):** all 3 exports present in OverlayHost.tsx; helpers ratified by tests 6-8 in OverlayHost.test.tsx.
- **Architecture-purity (D-WEBUI-31) preserved:** no src/ imports in any new file.
- **VersionDrawerHost backward-compat:** `grep "export.*OverlayHost as VersionDrawerHost\|export.*from './OverlayHost" packages/dashboard/src/views/VersionDrawerHost.tsx` matches the shim. Phase 21 VersionDrawerHost.test.tsx still green (5/5).
- **App.tsx wiring:** `grep "<OverlayHost" App.tsx` and `grep "<ABCompareHost" App.tsx` both match; `grep "<VersionDrawerHost" App.tsx` returns 0 matches (replaced).
- **theme.css z-ladder:** `grep -c "z-index ladder" packages/dashboard/src/styles/theme.css` returns 1.
- **SSE handler reference (RESEARCH A7):** App.tsx onShotStatusChanged import unchanged; state/shot-grid.ts unmodified.
- **Mutex invariant (D-02):** Test 9 in OverlayHost.test.tsx confirms that opening a review panel while the version drawer is mounted replaces the drawer — version-drawer-stub unmounts, review-panel-placeholder mounts.

## Self-Check: PASSED

- [x] All 3 tasks executed (Task 1 RED scaffold merged with Task 2 GREEN; Task 3 standalone)
- [x] Each task committed individually (3 commits — state / mount-host+shim+css / App+ABCompareHost)
- [x] SUMMARY.md created
- [x] No modifications to shared orchestrator artifacts (STATE.md / ROADMAP.md untouched by plan execution)
