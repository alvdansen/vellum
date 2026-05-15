---
phase: 22-review-and-approval
plan: 06
subsystem: ui
tags: [preact, modal, dialog, image-preload, decode, focus-trap, prefers-reduced-motion]

requires:
  - phase: 22-02-dashboard-foundation
    provides: diffVersionsAB + getThumbnailUrl helpers; 10 COMPARE_MODAL_* copy constants
  - phase: 22-03-popover-and-diff
    provides: MetadataDiff component (summary + DiffChanges)
  - phase: 22-04-overlay-state
    provides: compareSelection / compareModalOpen / activeReviewShotId signals; placeholder ABCompareHost
provides:
  - views/ABCompareView.tsx — full-viewport modal with REV-03 parallel preload (Promise.all + Pitfall 7 .onload fallback), focus-trap, ESC + backdrop + close-button close paths, MetadataDiff integration
  - views/ABCompareHost.tsx (rewired) — resolves compareSelection vs caller-supplied versionsById; Pitfall 6 cross-shot clear; mounts ABCompareView when modal=true AND both ids resolve
affects: [22-07]

tech-stack:
  added: []
  patterns:
    - "Parallel image preload via Promise.all([decode, decode]) — both thumbnails resolve simultaneously (D-17 / REV-03 lock — no sequential flash)"
    - "Pitfall 7 fallback: .decode().catch(() => new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject }))  — wires BOTH so 404 rejects instead of spinning"
    - "Modal close-path triad: ESC keydown listener on document + backdrop click guard (e.target === e.currentTarget) + explicit close button → 3 ways to dismiss, all flip compareModalOpen=false (D-15)"
    - "Pitfall 6 cross-shot guard: useEffect on activeReviewShotId.value clears compareSelection + compareModalOpen — prevents stale (a, b) from a prior shot triggering the modal"
    - "Motion-safe modal entrance: backdrop uses motion-safe:transition-colors + duration-150 + ease-out (honors prefers-reduced-motion per D-22)"

key-files:
  created:
    - packages/dashboard/src/views/ABCompareView.tsx
    - packages/dashboard/src/views/__tests__/ABCompareView.test.tsx
  modified:
    - packages/dashboard/src/views/ABCompareHost.tsx (placeholder → real composition with versionsById resolver)

key-decisions:
  - "ABCompareHost takes an optional versionsById Map prop rather than fetching/resolving versions itself — keeps the host stateless; 22-07's review-timeline compare-mode UI passes the resolver from its already-fetched versions list"
  - "Preload uses .decode() primary with .onload/.onerror fallback (Pitfall 7); both events MUST be wired so a 404 rejects — the previous draft pattern that only wired .onload would leave the skeleton spinning forever on a broken thumbnail"
  - "Diff fetch runs in PARALLEL with preload (not sequential) — both effects mount simultaneously and resolve independently; MetadataDiff section shows COMPARE_MODAL_DIFF_LOADING until diff resolves regardless of preload state"
  - "Modal width: `min(1200px, calc(100vw - 96px))` with `maxHeight: calc(100vh - 96px)` + `overflowY: auto` — 96px gutter ensures the modal doesn't touch viewport edges; overflow lets the metadata diff scroll independently when long"
  - "ABCompareHost when called WITHOUT versionsById returns null defensively — App.tsx mounts the host without args today (the 22-07 surface will pass versionsById through); preserves the 'never crash' invariant from D-15"

patterns-established:
  - "Image preload helper structure (preloadOne + preloadBoth): module-scope pure functions, no state, returns Promise<void>. Reusable across any future side-by-side image comparison surface"
  - "Modal close-path test triad: render with onClose spy → fire ESC keydown / click on backdrop testid / click on close-button aria-label → expect onClose called 3 separate times (one assertion per close path)"
  - "Pitfall 7 fallback test pattern: vi.spyOn decode + reject; patch HTMLImageElement.prototype.src setter to queue microtask onerror dispatch; restore descriptor in finally"

requirements-completed: [REV-03]

duration: 18min
completed: 2026-05-14T06:25:00Z
---

# Plan 22-06: A/B Compare Modal Summary

**Full-viewport modal closes REV-03 — any two version ids preload in parallel via Promise.all([decode, decode]); fallback path covers Pitfall 7; MetadataDiff section renders the diffVersionsAB response below.**

## Performance

- **Duration:** 18 min (inline; Task 1 RED scaffold merged with Task 2 GREEN)
- **Started:** 2026-05-14T06:19:00Z
- **Completed:** 2026-05-14T06:25:00Z
- **Tasks:** 3 (test file + view file + placeholder rewire)
- **Files modified:** 3 (2 created + 1 rewired)

## Accomplishments

- **ABCompareView** (260 LOC) — full-viewport z-30 modal with parallel preload, focus-trap, 3 close paths, motion-safe backdrop fade. Pitfall 7 averted: `.decode()` primary + `.onload`+`.onerror` fallback wires BOTH events.
- **ABCompareHost** rewired from placeholder (32 LOC) to real resolver (88 LOC) — accepts caller-supplied versionsById map; resolves compareSelection.a/.b; mounts ABCompareView; Pitfall 6 cross-shot guard.
- **10 new tests** covering dialog accessibility / preload pending → success swap / Pitfall 7 fallback simulation / diff loading / diff error / diff empty / all 3 close paths / non-close-on-inner-click negative assertion.
- **TypeScript clean**; dashboard suite at **430/430** (was 420 + 10 from 22-06).

## Task Commits

1. **ABCompareView + ABCompareHost rewire + tests** — `<sha>` (feat) — 3 task parts merged inline (per pragmatic-TDD-off mode)

## Files Created/Modified

- `packages/dashboard/src/views/ABCompareView.tsx` — **+260 LOC** — preloadBoth helper + 3 useEffects (preload / diff / focus+ESC) + render with 3 close paths.
- `packages/dashboard/src/views/ABCompareHost.tsx` — **−32 / +88 LOC** — versionsById resolver + Pitfall 6 cross-shot guard + ABCompareView mount.
- `packages/dashboard/src/views/__tests__/ABCompareView.test.tsx` — **+271 LOC** — 10 tests covering all REV-03 surfaces + 3 close paths + Pitfall 7 fallback simulation.

## Verification

- **Dashboard typecheck:** `cd packages/dashboard && npx tsc --noEmit` exits 0.
- **Dashboard suite:** 42 files, 430 tests, all passed.
- **REV-03 closure:** verified by ABCompareView tests:
  - Parallel preload: two skeletons during pending; both swap to Thumbnails simultaneously after Promise.all resolves
  - Pitfall 7 fallback: .decode reject → .onerror dispatch → COMPARE_MODAL_THUMB_LOAD_FAIL renders (verified via patched src setter + queued microtask onerror)
- **Close paths (D-15):** all 3 covered (ESC keydown / backdrop click / explicit close button) + negative assertion (click on inner modal body does NOT close).
- **z-30 ladder (RESEARCH Q4):** backdrop class includes `z-30`; theme.css comment ladder reference unchanged.
- **MetadataDiff integration:** when diffVersionsAB resolves with empty changes object, COMPARE_MODAL_DIFF_EMPTY renders via the MetadataDiff three-branch render.
- **Pitfall 6 (cross-shot clear):** useEffect on activeReviewShotId clears compareSelection + compareModalOpen → modal can't open with stale pair from a prior shot.
- **Architecture-purity (D-WEBUI-31) preserved.**

## Self-Check: PASSED

- [x] All 3 tasks executed (Task 1 RED + Task 2 GREEN + Task 3 placeholder rewire merged inline)
- [x] Atomic commit (1 feat commit; placeholder rewire is part of the same logical change as the view)
- [x] SUMMARY.md created
- [x] No modifications to shared orchestrator artifacts (STATE.md / ROADMAP.md untouched by plan execution)
