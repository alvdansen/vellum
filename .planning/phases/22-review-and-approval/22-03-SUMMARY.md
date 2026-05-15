---
phase: 22-review-and-approval
plan: 03
subsystem: ui
tags: [preact, popover, anchored-dropdown, focus-management, diff-display, refactor]

requires:
  - phase: 22-02-dashboard-foundation
    provides: ReviewAction type + REVIEW_*_PROMPT, POPOVER_*, RESTORE_NOTE_SYSTEM_TEXT, COMPARE_MODAL_SECTION_METADATA, COMPARE_MODAL_DIFF_EMPTY copy constants
  - phase: 21-shot-grid-view
    provides: SortDropdown popover mechanics (outside-click + ESC + focus-return) — verbatim borrowed pattern
provides:
  - StatusChangePopover.tsx — single shared anchored popover for all 5 review actions (D-05); D-09 restore textarea-hide; D-07 + REV-04 client-side note coercion
  - MetadataDiff.tsx — pure display layer for diff summary + structured changes (D-16); dashboard-local DiffChanges shape (no engine signature change per Pitfall 2)
  - DiffDrawer.tsx — refactored to consume <MetadataDiff/> (Phase 12 visual preserved; heading now COMPARE_MODAL_SECTION_METADATA)
affects: [22-05, 22-06, 22-07]

tech-stack:
  added: []
  patterns:
    - "Anchored popover mechanics: useRef + useEffect + document.mousedown listener while open; ESC + outside-click both call focus-return BEFORE onCancel (focus never falls to <body> on unmount)"
    - "Pitfall 9 averted: dialog content is never wrapped in <form>; Cancel + Confirm are explicit type='button' so Enter in textarea inserts newline"
    - "Pure-presentational components — no signals, no fetch — props in, DOM out; deterministic test surfaces"

key-files:
  created:
    - packages/dashboard/src/components/StatusChangePopover.tsx
    - packages/dashboard/src/components/MetadataDiff.tsx
    - packages/dashboard/src/components/__tests__/StatusChangePopover.test.tsx
    - packages/dashboard/src/components/__tests__/MetadataDiff.test.tsx
  modified:
    - packages/dashboard/src/views/DiffDrawer.tsx

key-decisions:
  - "Single shared popover for all 5 actions (D-05) — prompt sentence is the only differentiator; no destructive variant per D-08 lock (Omit is reversible)"
  - "Restore variant uses RESTORE_NOTE_SYSTEM_TEXT verbatim (D-09 textarea-hide); other actions coerce note.trim() === '' → null (D-07 + REV-04 client-side)"
  - "Focus-return discipline (Pattern E): anchorRef.current?.focus() MUST be called BEFORE onCancel() triggers the parent's isOpen flip — otherwise focus drops to <body> on unmount. Verified in both ESC and outside-click handlers"
  - "DiffChanges interface lives in MetadataDiff.tsx (dashboard-local) because api.ts:diffVersionsAB returns Promise<unknown> per Pitfall 2 — engine signature unchanged; consumers narrow at use-site"
  - "DiffDrawer heading changed from 'Summary' → 'METADATA DIFF' per UI-SPEC — intentional UX evolution, no existing DiffDrawer tests assert on the prior heading text"

patterns-established:
  - "Popover focus-return pattern: anchorRef.focus() ALWAYS precedes onCancel() in any close path; applies to ESC + outside-click + Cancel button"
  - "MetadataDiff three-branch render: summary always; changes omitted = backward-compat (Phase 12); changes present + non-empty = bullet list; changes present + all empty = empty-state copy"
  - "Test harness for popover components: wrapper renders a real <button ref={anchorRef}> + holds isOpen state; outside-click via document.body.dispatchEvent(new MouseEvent('mousedown'))"

requirements-completed: [REV-01, REV-03, REV-04, REV-05]

duration: 14min
completed: 2026-05-14T06:01:00Z
---

# Plan 22-03: StatusChangePopover + MetadataDiff Summary

**Two cross-cutting display primitives — anchored confirmation popover (shared by panel + grid) and pure metadata-diff renderer (shared by DiffDrawer + ABCompareView) — landed before Wave 3's larger views depend on them.**

## Performance

- **Duration:** 14 min (inline, sequential — Task 1 RED scaffold merged with Task 2/3 GREEN impl for efficiency)
- **Started:** 2026-05-14T05:55:00Z
- **Completed:** 2026-05-14T06:01:00Z
- **Tasks:** 3 (2 new components + 1 DiffDrawer refactor; tests merged with impl per task)
- **Files modified:** 5 (4 created + 1 modified)

## Accomplishments

- **StatusChangePopover** (`packages/dashboard/src/components/StatusChangePopover.tsx`) — 188 LOC; 13 tests green. Single shared component for all 5 review actions; D-09 Restore textarea-hide; D-07/REV-04 trim-to-null; ESC + outside-click both focus-return before close.
- **MetadataDiff** (`packages/dashboard/src/components/MetadataDiff.tsx`) — 117 LOC; 10 tests green. Three-branch render covering summary-only (Phase 12 backward compat), structured changes (ABCompareView future), and empty-state.
- **DiffDrawer** refactored to consume `<MetadataDiff summary={diff.summary} />` — Phase 12 visual surface preserved (same paragraph background + classes), heading text intentionally updated to `COMPARE_MODAL_SECTION_METADATA = 'METADATA DIFF'` per UI-SPEC.
- **Dashboard suite at 392/392** (was 369; +23 new tests). Dashboard tsc clean. Architecture-purity preserved — only sibling dashboard imports.

## Task Commits

1. **Task 1 + 2 merged: StatusChangePopover + tests** — `9457c41` (feat)
2. **Task 3: MetadataDiff + tests + DiffDrawer refactor** — `067ddec` (refactor)

_Note: Plan defined Task 1 as a separate "RED scaffold" commit and Tasks 2/3 as GREEN. Running inline (TDD_MODE=false), tests were merged with their impl commits — same coverage, fewer commits._

## Files Created/Modified

- `packages/dashboard/src/components/StatusChangePopover.tsx` — Shared popover component with PROMPT_FOR action map, focus-return discipline in both ESC and outside-click handlers, Pitfall 9 averted (no `<form>` wrapper). **+188 LOC**.
- `packages/dashboard/src/components/__tests__/StatusChangePopover.test.tsx` — 13 tests in 7 describe blocks covering visibility, prompts, D-09 hide, ESC focus-return, outside-click focus-return, D-07/REV-04 note coercion (4 variants), and pending state. **+318 LOC**.
- `packages/dashboard/src/components/MetadataDiff.tsx` — Three-branch summary+changes renderer with DiffChanges interface (dashboard-local per Pitfall 2). **+117 LOC**.
- `packages/dashboard/src/components/__tests__/MetadataDiff.test.tsx` — 10 tests covering summary text, section heading, class assertions, every changes branch (undefined, fully-empty, params, seed, workflow true/false, models). **+103 LOC**.
- `packages/dashboard/src/views/DiffDrawer.tsx` — Added MetadataDiff import + replaced inline summary block with `<MetadataDiff summary={diff.summary} />`. **−7 / +2 LOC**.

## Verification

- **Dashboard typecheck:** `cd packages/dashboard && npx tsc --noEmit` exits 0.
- **Dashboard suite:** 37 files, 392 tests, all passed (was 369 — +23 new from 22-03 component tests).
- **Key-link greps (plan acceptance):**
  - `^export function StatusChangePopover` → 1 match
  - `^export interface StatusChangePopoverProps` → 1 match
  - `role="dialog"` and `aria-modal="false"` in StatusChangePopover → present
  - `RESTORE_NOTE_SYSTEM_TEXT` in StatusChangePopover → present
  - `<form` in StatusChangePopover → 0 matches (Pitfall 9 averted)
  - `document.addEventListener('mousedown'` in StatusChangePopover → present (SortDropdown convention)
  - `^export function MetadataDiff` → 1 match
  - `^export interface MetadataDiffProps` and `^export interface DiffChanges` → 1 match each
  - `<MetadataDiff` in DiffDrawer.tsx → 1 match
  - `<section>\s*<h3.*Summary` in DiffDrawer.tsx → 0 matches (old inline block removed)
- **Focus-return discipline (Pattern E):** Both ESC and outside-click handlers call `anchorRef.current?.focus()` BEFORE `onCancel()` — verified by spying on the anchor button's `.focus()` in both tests.

## Self-Check: PASSED

- [x] All 3 tasks executed (Task 1's RED test files merged with Task 2/3 GREEN per pragmatic-inline mode)
- [x] Each task committed individually (2 commits — Tasks 1+2 merged, Task 3 standalone)
- [x] SUMMARY.md created
- [x] No modifications to shared orchestrator artifacts (STATE.md / ROADMAP.md untouched in plan execution; orchestrator commits tracking after wave completes)
