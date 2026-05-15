---
phase: 22-review-and-approval
plan: 02
subsystem: ui
tags: [preact, typescript, fetch, types, copy-constants, dashboard]

requires:
  - phase: 22-01-server-routes
    provides: PATCH /api/shots/:id/status + GET /api/shots/:id/status-history + GET /api/versions/:a/diff-with/:b — the 3 routes this plan's fetch helpers consume
  - phase: 21-shot-grid-view
    provides: api.ts fetch pattern + fetchJson + DashboardApiError + copy.ts section convention
provides:
  - types/review-panel.ts — ShotStatusEvent + ShotHistoryEntry (D-04 unified-timeline discriminated union) + ReviewAction + SetShotStatusBody + SetShotStatusResponse + StatusHistoryResponse
  - lib/api.ts — setShotStatus + fetchShotStatusHistory + diffVersionsAB (3 typed fetch helpers, each mirroring existing api.ts patterns 1:1)
  - lib/copy.ts — 66 new named-constant exports in 11 sub-sections (Action bar / aria-labels / in-flight / popover prompts / popover controls / quick-approve / panel header / timeline / compare mode / compare modal / error+loading)
affects: [22-03, 22-04, 22-05, 22-06, 22-07]

tech-stack:
  added: []
  patterns:
    - "Discriminated union for unified timeline: { kind: 'version' | 'status', ... } — D-04, future-proof for additional event sources"
    - "Wire-shape types live dashboard-side (sibling-only imports), engine-side types stay engine-side — D-WEBUI-31 architecture-purity invariant"
    - "Copy constants prefixed by surface (REVIEW_ / POPOVER_ / TIMELINE_ / COMPARE_) so the grep audit can verify zero inline literals in component files"

key-files:
  created:
    - packages/dashboard/src/types/review-panel.ts
  modified:
    - packages/dashboard/src/lib/api.ts
    - packages/dashboard/src/lib/copy.ts

key-decisions:
  - "ShotStatusEvent mirrors src/store/shot-status-repo.ts:38 row shape with snake_case fields (wire alignment — no translation layer)"
  - "StatusHistoryResponse uses camelCase shotId verbatim (engine pipeline.ts:785 returns camelCase here — intentionally, per RESEARCH Example 3 verification)"
  - "diffVersionsAB returns Promise<unknown> (mirrors existing diffVersion); ABCompareView (22-06) narrows at use-site — RESEARCH Pitfall 2 means no engine signature change, no new shared return-type extracted"
  - "REV-05 Restore note materialized as a single named constant RESTORE_NOTE_SYSTEM_TEXT = 'Restored from omit' — D-09 lock; route layer in 22-01 writes this verbatim, timeline row in 22-05 renders this verbatim"

patterns-established:
  - "Fetch helper JSDoc convention: numbered (1..N globally), names the route, links the D-decision, enumerates the DashboardApiError envelopes for that route"
  - "Copy block convention: top-level '=' ruler comment + per-sub-section '----------' rulers; surface-prefixed names allow whole-prefix audits"

requirements-completed: [REV-01, REV-02, REV-03, REV-04, REV-05]

duration: 12min
completed: 2026-05-14T05:55:00Z
---

# Plan 22-02: Dashboard Foundation Summary

**Three plumbing artifacts — wire types, fetch helpers, and 66 named copy constants — that every later Phase 22 plan depends on. Zero new behavior; pure foundation.**

## Performance

- **Duration:** 12 min (Tasks 2 & 3 inline; Task 1 had completed before SSE timeout)
- **Started:** 2026-05-14T03:30:00Z (worktree dispatch; Task 1 committed at 03:30, then SSE-stalled)
- **Completed:** 2026-05-14T05:55:00Z
- **Tasks:** 3 (1 new file + 1 file extension + 1 file extension)
- **Files modified:** 3 (1 created + 2 modified)

## Accomplishments

- **Types module** lives at `packages/dashboard/src/types/review-panel.ts` — 6 exports (ShotStatusEvent, ShotHistoryEntry, ReviewAction, SetShotStatusBody, SetShotStatusResponse, StatusHistoryResponse). Architecture-purity preserved: only `./shot-grid.js` and `./entities.js` sibling-imports.
- **3 fetch helpers** appended to `lib/api.ts` — typed against the 22-02 wire shapes, each mirroring an existing api.ts mutation/fetch pattern verbatim. setShotStatus uses `reproduceVersion`'s pattern (PATCH + Content-Type + JSON body); the two GETs use the default fetchJson path.
- **66 named copy constants** appended to `lib/copy.ts` across 11 sub-sections; total exports now 118 (up from 52). All values verbatim from UI-SPEC §"Copywriting Contract" — including U+2026 ellipsis in 5 pending labels and U+2014 em-dash in `Approve failed — retry`.
- **Dashboard tsc clean** + **dashboard suite green at 369/369** (no regressions — was 361 in STATE.md baseline; intervening Phase 21 polish added 8 tests).

## Task Commits

1. **Task 1: types/review-panel.ts** — `75f761a` (feat) — cherry-picked from stalled worktree-agent-a8d4…
2. **Task 2: 3 fetch helpers in lib/api.ts** — `0671e52` (feat)
3. **Task 3: Phase 22 copy block in lib/copy.ts** — `8811ae6` (feat)

## Files Created/Modified

- `packages/dashboard/src/types/review-panel.ts` — 6 exported interfaces/aliases. **+140 LOC**.
- `packages/dashboard/src/lib/api.ts` — Added Phase 22 imports (3 type-only) + 3 fetch helpers + a section ruler. **+81 LOC**.
- `packages/dashboard/src/lib/copy.ts` — Appended Phase 22 copy block: 11 sub-sections, 66 new exports, full ruler comments. **+124 LOC**.

## Verification

- **Dashboard typecheck:** `cd packages/dashboard && npx tsc --noEmit` exits 0.
- **Dashboard suite:** 35 files, 369 tests, all passed.
- **Export counts (plan acceptance):**
  - `grep -c "^export const" packages/dashboard/src/lib/copy.ts` → **118** (>= 104 ✓)
  - `grep -c "^export const \(REVIEW_\|POPOVER_\|TIMELINE_\|COMPARE_\|RESTORE_NOTE\)" packages/dashboard/src/lib/copy.ts` → **66** (>= 50 ✓)
- **Architecture-purity (D-WEBUI-31) preserved:**
  - `grep "from '../../src/'" packages/dashboard/src/{types/review-panel,lib/api,lib/copy}.ts` → 0 matches
  - `grep "from '../src/'" packages/dashboard/src/{types/review-panel,lib/api,lib/copy}.ts` → 0 matches
- **Key-link greps (plan acceptance):**
  - `^export function setShotStatus` → 1 match
  - `^export function fetchShotStatusHistory` → 1 match
  - `^export function diffVersionsAB` → 1 match
  - `method: 'PATCH'` → 1 match (the new setShotStatus)
  - `\${encodeURIComponent(a)}/diff-with/\${encodeURIComponent(b)}` — present
  - `REVIEW_APPROVE_PROMPT = 'Approve this shot?'` — present verbatim
  - `REVIEW_RESTORE_PROMPT = 'Restore this shot to wip?'` — present verbatim
  - `RESTORE_NOTE_SYSTEM_TEXT = 'Restored from omit'` — present verbatim
  - `REVIEW_QUICK_APPROVE_FAIL_LABEL = 'Approve failed — retry'` — present verbatim (U+2014)
  - 5+ U+2026 occurrences in pending labels (Approving…, Holding…, Submitting…, Loading thumbnails…, Compare versions…) — present verbatim

## Self-Check: PASSED

- [x] All 3 tasks executed
- [x] Each task committed individually (3 commits — all feat, all atomic)
- [x] SUMMARY.md created
- [x] No modifications to shared orchestrator artifacts (STATE.md / ROADMAP.md untouched)

## Recovery Note (Phase 22 Wave 1 SSE Timeout)

This plan's executor worktree (worktree-agent-a8d4…) stalled at Task 2 partway through — Task 1 (types file) committed cleanly, then the agent began Task 2 (added imports to lib/api.ts) and SSE-stalled before adding helper bodies. The orchestrator:
1. Cherry-picked Task 1's `feat(22-02): add types/review-panel.ts` commit from the worktree back to main.
2. Applied the partial Task 2 import-only WIP (18 lines) as a starting patch.
3. Implemented Task 2's 3 fetch helper bodies inline — committed as `0671e52`.
4. Implemented Task 3 (copy block) inline — committed as `8811ae6`.

Plan outcome is unchanged versus the subagent path — same diff would have landed.
