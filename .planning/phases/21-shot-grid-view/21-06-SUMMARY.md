---
phase: 21-shot-grid-view
plan: 6
subsystem: ui
tags: [preact, signals, integration-test, vitest, drawer-overlay, view-routing, race-condition, audit-fix]

# Dependency graph
requires:
  - phase: 21-shot-grid-view
    provides: "Plans 21-01..21-04 — shot-grid signals, fetchShotGrid wire, ShotGridView + components, TreeSidebar grid-icon affordance"
provides:
  - "VersionDrawerHost — self-resolving overlay that fetches a Version by id when the local versions.value cache misses; mounts at App scope so it survives view changes"
  - "App.tsx boot useEffect — canonical place for all mount-time hydration (hydrateShotGridUrlState + hydrateSortState), runs BEFORE SSE subscription and BEFORE view body mounts"
  - "ShotGridView race-free + error-state — Load More guards against late cross-sequence responses; initial fetch clears stale grid before await; initial fetch rejection renders a full-pane retry surface"
  - "TreeSidebar aria-current gated on activeView — grid icon only marked 'page' when the user is actually on the shot-grid view"
  - "Integration test pattern catching cross-view-seam composition bugs (App.test.tsx URL deep-link test)"
affects: [22-review-approval, 23-production-overview, 24-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "View-independent overlay pattern: components that render conditionally on a global signal mount at App scope, not inside a view"
    - "Boot-scope hydration pattern: all hydrate* calls live in App.tsx useEffect BEFORE startSse() so mount-time URL state is authoritative for view routing"
    - "Race-safe async pattern in view handlers: capture dispatch-time seqId/version-id, compare after await, drop late responses (Bug 3 / Load More)"
    - "Synchronous-clear-before-await pattern: sequence changes that re-fire fetches must null the buffer signal synchronously so the next paint is a clean loading state, not stale data"
    - "Integration tests at App scope, not view scope: seed URL BEFORE render, mock fetch resolution, assert DOM consequences across the view-toggle seam"

key-files:
  created:
    - "packages/dashboard/src/views/VersionDrawerHost.tsx (T02)"
    - "packages/dashboard/src/views/__tests__/VersionDrawerHost.test.tsx (T05)"
  modified:
    - "packages/dashboard/src/App.tsx (T01 hoist hydrate + T02 mount overlay)"
    - "packages/dashboard/src/views/HomeView.tsx (T01 remove hydrate + T02 remove drawer + T04 gate aria-current)"
    - "packages/dashboard/src/views/ShotGridView.tsx (T01 headerExpanded signal + T03 seqId guard + T04 clear+error)"
    - "packages/dashboard/src/state/shot-grid.ts (T01 headerExpanded signal)"
    - "packages/dashboard/src/lib/copy.ts (T04 SHOT_GRID_FETCH_ERROR constant)"
    - "packages/dashboard/src/__tests__/App.test.tsx (T05 URL deep-link integration test + new mocks)"
    - "packages/dashboard/src/views/__tests__/ShotGridView.test.tsx (T05 sequence-switch + rejection cases)"
    - "packages/dashboard/dist/index.html + dist/assets/* (T06 production rebuild)"

key-decisions:
  - "VersionDrawerHost owns its own fetchVersion fallback with a local cache keyed by id (rapid open-A→B→A flow reuses prior fetch)"
  - "headerExpanded promoted from useState to module-singleton signal — matches D-15 'session-only, no localStorage' (signals reset on full page reload, survive view remounts)"
  - "Bug 6 retry button cycles selectedSequenceForGrid through null and back to bump the init-effect's dependency identity (signal assignment to current value is a no-op for subscribers; the null-then-set forces the rerun)"
  - "Bug 4 fix is synchronous-clear-before-await, not 'set to null in cleanup' — the latter would still flicker the previous sequence's shots through the brief instant before the new fetch's then resolves"
  - "Integration test in App.test.tsx seeds window.location.search AFTER beforeEach (which clears it); test-level URL seed pattern preserves the rest of the file's test isolation"

patterns-established:
  - "Overlay-at-App-scope pattern: any future Phase 22-24 overlay (review panel, approval popover, A/B compare, stats widget) that keys on a global signal mounts as a sibling of ActiveGenerationsPanel inside App.tsx — NEVER inside a view"
  - "VersionDrawerHost template: any future self-resolving overlay follows the same shape — read signal, fast-path cache check, fetch fallback, console.warn + clear-on-error for graceful degradation"
  - "Integration test gate: any Phase 22+ that adds a new view-toggle seam must add a URL-deep-link integration test catching the same hydrate / overlay / data-resolution bugs at the App-render boundary"

requirements-completed: [GRID-01, GRID-02, GRID-03, GRID-04, GRID-05]

# Metrics
duration: ~75 min (T01-T03 prior executor + T04-T06 + SUMMARY this executor)
completed: 2026-05-13
---

# Phase 21 Plan 6: Shot Grid Architectural Refactor (Audit Gap Closure) Summary

**Hoisted URL hydration + VersionDrawerHost overlay + race-safe ShotGridView lifecycle — closes all 7 bugs from 21-AUDIT.md so Phase 22-24 overlays can hang off App scope by construction.**

## Performance

- **Duration:** ~75 min total (T01-T03 by prior executor ~30 min; T04-T06 + SUMMARY this executor ~45 min)
- **Started:** 2026-05-13 (T01 first commit at af000dc merge base)
- **Completed:** 2026-05-13T11:55:00Z
- **Tasks:** 6 (all complete; this executor delivered T04, T05, T06 + SUMMARY)
- **Files modified:** 9 source files + 5 dist artifacts + 1 SUMMARY

## Accomplishments

- **Bug 1 (hydrate chicken-and-egg) closed** — App.tsx boot useEffect now calls `hydrateShotGridUrlState()` and `hydrateSortState()` BEFORE `startSse()` and BEFORE the body's view switch decides which subtree to mount. URL deep links like `?view=shot-grid&seq=seq_1` now flip activeView on first paint.
- **Bug 2 (VersionDrawer view-scoped) closed** — new `<VersionDrawerHost/>` component mounts at App scope as a sibling of `<ActiveGenerationsPanel/>`, surviving the `{isHome ? <HomeView/> : <ShotGridView/>}` mount switch.
- **Bug 3 (BLOCKING Load More race) closed** — ShotGridView's Load More handler captures dispatch-time `requestSeqId` and rejects late responses whose sequence no longer matches `selectedSequenceForGrid.value`. Idempotent under the existing `gridIsFetching` guard.
- **Bug 4 (sequence-switch stale grid) closed** — initial-fetch effect synchronously sets `shotGrid.value = null` + `gridLoadMoreError.value = null` BEFORE awaiting the new fetch. The next paint is a clean loading state, not the prior sequence's shots.
- **Bug 5 (drawer data model — grid clicks can't resolve version) closed** — VersionDrawerHost resolves the version via `versions.value` (home fast path) THEN falls back to `fetchVersion(id)` when the cache misses (typical for shot-grid card clicks).
- **Bug 6 (initial fetch failure blank pane) closed** — `.catch()` sets `gridLoadMoreError.value = SHOT_GRID_FETCH_ERROR` and a new full-pane render branch with `role="alert"` + Retry button fires when `shotGrid===null && !gridIsFetching && gridLoadMoreError`. Retry cycles `selectedSequenceForGrid` through null and back to re-fire the effect.
- **Bug 7 (aria-current persistence) closed** — HomeView gates `currentGridSequenceId` on `activeView.value === 'shot-grid'`, so the TreeSidebar grid-icon only carries `aria-current="page"` while the user is actually on the grid view.
- **Test coverage extended** — 8 new tests across 3 files (5 VersionDrawerHost unit cases, 1 App URL-deep-link integration case, 2 ShotGridView sequence-switch + rejection cases). Dashboard suite now 369/369 across 35 files (was 361/34).

## Task Commits

Each task was committed atomically. T01-T03 landed via the previous executor and merged into `main` at `af000dc`; T04-T06 landed on this executor's worktree branch (`worktree-agent-ad92270acb77f8234`).

1. **T01: Hoist hydrate calls + headerExpanded signal** — `c1524aa` (refactor) — _prior executor_
2. **T02: Create VersionDrawerHost + hoist overlay** — `3dc7688` (refactor) — _prior executor_
3. **T03: Add seqId guard to Load More handler** — `6908f03` (fix) — _prior executor_
4. **T04: Clear stale shotGrid on sequence change + error state + aria-current gate** — `884eac1` (fix)
5. **T05: URL deep-link integration test + VersionDrawerHost unit suite + ShotGridView extras** — `823c41f` (test)
6. **T06: Rebuild dashboard dist + verification sweep** — `7e2c691` (build)

**Plan metadata:** This commit (`docs(21-06): complete plan summary`) — closes the plan.

## Files Created/Modified

### Created (by prior executor in T01-T03)
- `packages/dashboard/src/views/VersionDrawerHost.tsx` — self-resolving overlay component, reads selectedVersionId + falls back to fetchVersion

### Created (this executor in T05)
- `packages/dashboard/src/views/__tests__/VersionDrawerHost.test.tsx` — 5 unit tests covering the 5 behaviors: closed state, cache hit, cache miss + fetch, fetch failure, priorVersion null

### Modified (T01-T03 prior + T04-T06 this executor)
- `packages/dashboard/src/App.tsx` — boot useEffect now calls both hydrate functions before SSE subscription; renders `<VersionDrawerHost/>` as sibling of body
- `packages/dashboard/src/views/HomeView.tsx` — removed the `<VersionDrawer/>` render and resolver; removed `hydrateSortState()` mount call; **T04**: gated `currentGridSequenceId` on activeView==='shot-grid'
- `packages/dashboard/src/views/ShotGridView.tsx` — `headerExpanded` now signal; removed local hydrate; **T03**: seqId guard on Load More; **T04**: synchronous clear at top of init effect + SHOT_GRID_FETCH_ERROR copy on .catch + new role="alert" error pane with Retry button
- `packages/dashboard/src/state/shot-grid.ts` — new exported `headerExpanded` signal (default true, D-15 session-only)
- `packages/dashboard/src/lib/copy.ts` — **T04**: new `SHOT_GRID_FETCH_ERROR` constant for the full-pane error copy
- `packages/dashboard/src/__tests__/App.test.tsx` — **T05**: extended api mock (fetchVersion + getProvenance + getC2paStatus + diffVersion + getOutputUrl); stubbed state/summaries; added URL deep-link integration test
- `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` — **T05**: added sequence-switch test (catches Bug 4) + initial-fetch-rejection test (catches Bug 6)
- `packages/dashboard/dist/index.html` + `dist/assets/index-DJbgjyy6.js` + `dist/assets/index-COrFnFrY.css` — **T06**: production rebuild via vite build (128.53 kB JS / 28.96 kB CSS, 197ms)

## Decisions Made

This executor (T04+T05+T06) followed the plan as written. Decisions worth recording:

- **T04 Retry button mechanic:** cycling `selectedSequenceForGrid` through `null` and back was chosen over a dedicated `retryToken` signal because the assignment is idempotent and the effect's dependency is already keyed on the sequence id. Adding a separate retry token would have required two effect deps, increasing the risk of cross-coupled re-fires.
- **T04 error copy:** the plan asked for `SHOT_GRID_FETCH_ERROR` to live in `lib/copy.ts`. The existing `SHOT_GRID_FETCH_ERROR_PREFIX` was preserved (inline-pill copy for the LoadMoreButton path) and the new constant (`"Couldn't load shots. Try refreshing the page."`) was added alongside as the full-pane copy. Both serve distinct render paths.
- **T05 test isolation:** App.test.tsx's beforeEach clears `window.location.search` and resets all module-singleton signals. The new URL-deep-link integration test seeds the URL AFTER beforeEach completes (in the test body) so the rest of the file's isolation is preserved.
- **T05 mock surface for App.test.tsx:** had to extend the api mock to cover `fetchVersion` + the four VersionDrawer mount-time fetches (`getProvenance`, `getC2paStatus`, `diffVersion`, `getOutputUrl`) plus the state/summaries module. The drawer fires these on every mount and would otherwise hit real network during the deep-link test's `<App/>` render.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree node_modules missing — ran `npm install`**
- **Found during:** T05 (first time the executor needed to run `npx vitest run`)
- **Issue:** Worktree's `node_modules` did not exist (matches a project memory note: "Run npm install after worktree merge — Worktree's npm install does not sync main's node_modules"). `@preact/preset-vite` could not be resolved by vitest.config.ts.
- **Fix:** Ran `npm install --workspaces --include-workspace-root` from the worktree root. Workspace hoisting populated `node_modules/@preact/signals` + `packages/dashboard/node_modules/@preact/preset-vite`.
- **Files modified:** node_modules only — no tracked files (npm install does not modify package.json or lockfile when nothing changes).
- **Verification:** `npx vitest run` proceeded normally, 369/369 passed.
- **Committed in:** N/A (node_modules is gitignored).

**2. [Rule 1 - Bug] Test fixture for `fetchSummary` mock returned undefined**
- **Found during:** T05 first run of VersionDrawerHost.test.tsx ("renders <VersionDrawer/> with the cached version" case)
- **Issue:** VersionDrawer mounts call `fetchSummary(version.id).then(...)`. The hoisted `vi.mock('../../state/summaries.js')` factory wired `fetchSummary: vi.fn()` which returns undefined → `.then` on undefined throws TypeError.
- **Fix:** Changed mock factory to `fetchSummary: vi.fn(() => new Promise(() => {}))` (never-resolving promise — drawer stays in loading state during the unit test, which is fine; we assert on dialog presence, not summary content).
- **Files modified:** `packages/dashboard/src/views/__tests__/VersionDrawerHost.test.tsx`
- **Verification:** Re-running the test file → 5/5 pass.
- **Committed in:** `823c41f` (T05 commit).

**3. [Rule 3 - Blocking] Missing `waitFor` import in App.test.tsx**
- **Found during:** T05 first run of App.test.tsx after adding the deep-link integration test
- **Issue:** Test used `await waitFor(...)` but the import line only had `render, fireEvent, cleanup`.
- **Fix:** Added `waitFor` to the import.
- **Files modified:** `packages/dashboard/src/__tests__/App.test.tsx`
- **Verification:** Re-run → 9/9 pass.
- **Committed in:** `823c41f` (T05 commit).

**4. [Rule 1 - Bug] Initially edited the wrong filesystem path (main repo, not worktree)**
- **Found during:** T04 first set of Edits
- **Issue:** The prompt context provided absolute paths like `/Users/macapple/comfyui-vfx-mcp/packages/...` which resolve to the **main repository**, not the worktree. A prior `cd` to that path in a bash session had also switched my working directory away from the worktree. Edits applied to the main repo's source files were silently invisible to git in the worktree.
- **Fix:** Discovered when `git status --short` showed no changes after edits. Restored main repo files with `git -C /Users/macapple/comfyui-vfx-mcp checkout -- <files>`, then re-applied each Edit using the explicit worktree path `/Users/macapple/comfyui-vfx-mcp/.claude/worktrees/agent-ad92270acb77f8234/packages/...`.
- **Files modified:** Same 3 files (copy.ts, HomeView.tsx, ShotGridView.tsx) but now in the worktree.
- **Verification:** Worktree `git status` showed the 3 modified files; main repo `git status` showed no source-file modifications (only the pre-existing dist + .gitignore + .claude/ noise).
- **Committed in:** `884eac1` (T04 commit, on worktree branch).

---

**Total deviations:** 4 auto-fixed (1 blocking dependency, 1 bug in test fixture, 1 missing import, 1 path-routing bug).
**Impact on plan:** No scope creep — all auto-fixes were either environmental (npm install, path routing) or test-scaffold defensiveness. The architectural fixes themselves followed the plan verbatim.

## Issues Encountered

- The previous executor was rejected by the user before writing the SUMMARY for T04-T06 (per the task brief). Recovery path: this executor re-ran T04, T05, T06 from scratch on a fresh worktree (`worktree-agent-ad92270acb77f8234`) starting from the merge base `af000dc` (where T01-T03 already landed on `main`). All 6 tasks now committed atomically on the executor branch awaiting merge.
- The worktree had no `node_modules`, blocking the test run. Resolved via `npm install --workspaces --include-workspace-root`. This is a known property of fresh Claude Code worktrees (see project memory `feedback_post_worktree_merge_install.md`).

## User Setup Required

None — no external service configuration required. Phase 21-06 is a purely architectural / test-coverage refactor over pre-existing dashboard surface.

## Self-Check: PASSED

Verifications performed before writing this summary:

- [x] T04 commit exists: `884eac1` (`git log --oneline | grep 884eac1` → OK)
- [x] T05 commit exists: `823c41f` (`git log --oneline | grep 823c41f` → OK)
- [x] T06 commit exists: `7e2c691` (`git log --oneline | grep 7e2c691` → OK)
- [x] T01-T03 commits present at base: `c1524aa`, `3dc7688`, `6908f03` (from `git log --oneline -8`)
- [x] VersionDrawerHost.test.tsx file exists at `packages/dashboard/src/views/__tests__/VersionDrawerHost.test.tsx`
- [x] SUMMARY.md is being written (this file)
- [x] All 7 audit-bug greps return expected counts (recorded in `7e2c691` commit body)
- [x] Dashboard test suite: 369/369 passed (5 new VersionDrawerHost + 1 App deep-link + 2 ShotGridView)
- [x] Dashboard typecheck clean
- [x] Root typecheck clean
- [x] Vite production build clean (128.53 kB JS, 28.96 kB CSS)

## Next Phase Readiness

- **Phase 22 (Review and Approval)** is now unblocked. The Overlay-at-App-scope pattern is established — review panel + quick-approve popover + A/B compare can all hang off `<App/>` as siblings of `<VersionDrawerHost/>` and `<ActiveGenerationsPanel/>`, each keyed on its own global signal.
- **Phase 23 (Production Overview)** can mount stat widgets either inside the view bodies (per-view stats) or at App scope (cross-view rolled-up stats) following the same composition guidance.
- **Phase 24 (Polish)** sticky filter persistence inherits the boot-scope hydration template established here — add new `hydrate*` calls to App.tsx's boot useEffect alongside the existing two.
- **No new blockers.** The 4-channel audit's 7 bugs are all closed; the new integration-test pattern in App.test.tsx provides the regression guard for the cross-view-seam class of bugs.

---
*Phase: 21-shot-grid-view*
*Plan: 6 (gap closure from 21-AUDIT.md)*
*Completed: 2026-05-13*
