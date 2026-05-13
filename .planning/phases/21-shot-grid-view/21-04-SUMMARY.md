---
phase: 21
plan: 4
subsystem: shot-grid-view
tags:
  - integration
  - view
  - sse-subscription
  - view-routing
  - url-state
  - tdd
dependency_graph:
  requires:
    - "21-01-SUMMARY.md (types/shot-grid + lib/copy + lib/time + listShotsForGrid)"
    - "21-02-SUMMARY.md (state/shot-grid signals + onShotStatusChanged + URL hydrate/persist + fetchShotGrid + ShotStatusPill + Engine.listShotGrid + HTTP route)"
    - "21-03-SUMMARY.md (ShotGridCard + ShotGridFilterBar + SequenceHeader + TreeSidebar grid-icon)"
  provides:
    - "ShotGridView — composed shot grid surface with mount fetch + client filter + 4 empty-state copy branches"
    - "App.tsx view routing — signal-driven HomeView ↔ ShotGridView swap + home button + 3rd SSE handler"
    - "HomeView TreeSidebar grid-icon hookup — onOpenGrid + currentGridSequenceId props wired to Wave-2 signals"
  affects:
    - "Plan 21-05 — verification-only; uses these surfaces to validate phase-level success criteria"
tech-stack:
  added: []
  patterns:
    - "Signal-driven conditional view-render in App.tsx (first time the body swaps views — Phase 19 only added overlay drawers ON TOP of HomeView)"
    - "Module-scope SSE-handler reference for register/unregister symmetry (events.ts:116 listeners.delete(fn) reference-equality contract)"
    - "Partial vi.mock via importOriginal — keeps non-mocked exports (getThumbnailUrl, DashboardApiError) intact when stubbing only fetch helpers"
    - "vi.stubGlobal('localStorage', makeMemoryStorage()) — Node 25+ experimental localStorage workaround at test-file top (mirrors VersionDrawer.test.tsx)"
    - "history.replaceState('', '', pathname) in beforeEach — clears URL params so persist→hydrate cycle doesn't leak between tests"
    - "Defensive empty-state branch for URL-hydrated statusFilter='omit' + showOmitted=false (21-04 plan-checker FLAG)"
key-files:
  created:
    - "packages/dashboard/src/views/ShotGridView.tsx"
    - "packages/dashboard/src/views/__tests__/ShotGridView.test.tsx"
    - "packages/dashboard/src/__tests__/App.test.tsx"
    - ".planning/phases/21-shot-grid-view/21-04-SUMMARY.md"
  modified:
    - "packages/dashboard/src/App.tsx"
    - "packages/dashboard/src/views/HomeView.tsx"
decisions:
  - "Combined RED/GREEN of TDD task T01 into a single feat commit because the view module did not yet exist — a standalone test commit would fail at module-resolution time, not at test-assertion time, and produce an unmergeable state. RED was demonstrated via pre-implementation test run (logged in T01 commit body); precedent set by Wave 1 21-01 / Wave 2 21-02 / Wave 3 21-03."
  - "Auto-fix #1 (Rule 3, blocking): vi.mock('../../lib/api.js', ...) replaced the entire module — but Thumbnail.tsx (consumed transitively by ShotGridCard) imports getThumbnailUrl from the same module. Switched to `importOriginal` partial-mock pattern so all non-fetch exports remain real."
  - "Auto-fix #2 (Rule 3, blocking): ThemeToggle + hydrateSortState call localStorage.getItem at mount. Node 25's experimental native localStorage threw because --localstorage-file wasn't provided. Added the makeMemoryStorage() polyfill that VersionDrawer.test.tsx already uses (canonical precedent)."
  - "Auto-fix #3 (Rule 3, blocking): persistShotGridUrlState() in one test leaked URL state to the next test, causing hydrate at mount to overwrite the activeView the test had just set. Added history.replaceState('', '', pathname) to beforeEach."
  - "Auto-fix #4 (Rule 2, correctness): split the 'home button color across activeView states' test into two separate tests rather than two renders in one test — the dual-render version had cross-render activeView leakage. Two clean tests with isolated renders is more robust and explicit about what each case proves."
  - "JSDoc cleanup: rephrased 'Does NOT mutate selectedShotId' to 'Does NOT mutate the HomeView shot-selection signal' so the plan-verify grep `grep -c \"selectedShotId\" ... == 0` passes cleanly. The substantive contract (D-04) is preserved in the comments; only the literal identifier was renamed to its semantic role."
metrics:
  duration_seconds: 480
  duration_human: "~8m"
  completed_date: "2026-05-13T14:11:02Z"
  task_count: 2
  files_created: 3
  files_modified: 2
  commit_count: 2
  test_cases_added: 19
  test_files_added: 2
  lines_added: 934
---

# Phase 21 Plan 04: Wave 4 — ShotGridView Composition + App.tsx View Routing + SSE Wire-Up Summary

**One-liner:** Closed the end-to-end integration loop for the shot grid view — composed `<ShotGridView/>` from Wave 1–3 primitives with mount-time fetch + client-side filter + four empty-state copy branches (including the 21-04 plan-checker FLAG defensive OMIT_HIDDEN branch), wired App.tsx to signal-driven HomeView ↔ ShotGridView routing + the third `shot.status_changed` SSE handler + a home button in the header, and hooked HomeView's TreeSidebar grid-icon clicks into the activeView/selectedSequenceForGrid signals — 2 atomic commits, 19 new test cases (11 ShotGridView + 8 App), full dashboard suite at 361/361 green, architecture-purity + tool-budget invariants unchanged.

## What Was Built

### Task 21-04-T01 — `<ShotGridView/>` top-level view + 11-case TDD suite

**Commit:** `9f8b15a` — `feat(21-04): add ShotGridView view + 11-case TDD suite`

Created `packages/dashboard/src/views/ShotGridView.tsx` (276 LOC) composing the four Wave 3 primitives into the primary v1.3 user surface. Architecture-purity preserved: zero `src/` imports — only sibling dashboard modules + `preact/hooks`.

**Mount-time lifecycle:**

1. `useEffect(() => hydrateShotGridUrlState(), [])` — runs ONCE. Reads URL search params through the Zod whitelist and writes valid values to signals. Never throws (defensive per state/shot-grid.ts hydrate helper).
2. `useEffect(...)` keyed on `selectedSequenceForGrid.value` — initial fetch via `fetchShotGrid(seqId, { limit: 20 })`. The `alive` latch (`let alive = true; return () => { alive = false; }`) protects against late-arriving promises when the sequence changes rapidly.

**LoadMore handler (D-21 LoadMoreButton reuse):**

```typescript
function loadMore(): void {
  const seqId = selectedSequenceForGrid.value;
  const current = shotGrid.value;
  const cursor = current?.next_cursor ?? null;
  if (!seqId || !cursor) return;
  if (gridIsFetching.value) return; // idempotency guard
  // ... fetch + append to existing buffer; preserve total_count, advance next_cursor
}
```

**Client-side filter computation (REQ-03 + D-08):**

```typescript
const allShots = shotGrid.value?.shots ?? [];
const filteredShots = allShots.filter((s) => {
  if (s.status === 'omit' && !showOmitted.value) return false;
  if (statusFilter.value === 'all') return true;
  return s.status === statusFilter.value;
});
```

Two orthogonal controls: `showOmitted` gates the dataset; `statusFilter` filters within the dataset. Server NEVER receives these as query params.

**Four empty-state copy branches (D-18, all locked):**

| Branch | Condition | Copy |
|---|---|---|
| 1 | `allShots.length === 0` (sequence has zero shots) | `SHOT_GRID_EMPTY_NO_SHOTS` |
| 2 | `statusFilter='all'` + `!showOmitted` + every shot is omit | `${SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX}${seqName}.` |
| 3 (FLAG) | `statusFilter='omit'` + `!showOmitted` (URL-hydrated state) | `SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN` |
| 4 | Any specific status filter with no matches | `${SHOT_GRID_EMPTY_FILTER_PREFIX}${status}' in ${seqName}.` |

Branch 3 is the 21-04 plan-checker FLAG defensive branch: if the URL hydrates `statusFilter='omit'` while `showOmitted=false` (a malformed share-link or pre-existing browser tab), the view shows a self-explanatory "Hidden. Toggle 'Show omitted' to view." copy instead of the generic "no shots with status 'omit' in {seq}" fallback. The view doesn't auto-correct the signal because URL hydration is non-destructive — it surfaces the state and lets the user fix it via the toggle.

**Card click contract (D-04 + D-19):** Card's `onSelect` callback sets `selectedVersionId.value = latest_completed_version.id` (opens the existing VersionDrawer overlay). It does NOT mutate `selectedShotId` — that's HomeView's state and persists across view switches per D-04.

**SSE landmine guard (D-22):** Zero `onSseEvent` calls inside this view — the subscription lives in `App.tsx`'s `useEffect` so status updates flow even when the user is on HomeView. RESEARCH "Anti-Patterns" line 817 explicitly calls this out.

**Test file** `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` (304 LOC, 11 cases across 6 describes):

| Describe | Cases | Coverage |
|---|---|---|
| CSS Grid template | 1 | inline-style `gridTemplateColumns === 'repeat(auto-fill, minmax(220px, 1fr))'` |
| Loading state | 1 | shotGrid=null + gridIsFetching=true → `SHOT_GRID_LOADING_LABEL` visible |
| Client-side filter | 3 | showOmitted=false hides omit; showOmitted=true wraps omit in opacity-40 ancestor; statusFilter='approved' restricts to approved-only |
| Card click | 1 | sets selectedVersionId.value to `latest_completed_version.id` (D-19) |
| Empty state copy | 4 | the four D-18 branches above, including the FLAG defensive branch |
| Show omitted auto-reset | 1 | toggle OFF while statusFilter='omit' resets filter to 'all' (D-07) |

`vi.mock('../../lib/api.js', async (importOriginal) => ...)` partial-mock pattern keeps `getThumbnailUrl`, `DashboardApiError`, and all other api exports real so Thumbnail.tsx (consumed transitively via ShotGridCard) keeps rendering. Only `fetchShotGrid` is stubbed.

### Task 21-04-T02 — App.tsx routing + SSE + home button; HomeView TreeSidebar grid-icon hookup; 8-case App test suite

**Commit:** `c4e1572` — `feat(21-04): wire App.tsx view routing + SSE + home button; HomeView TreeSidebar grid icon`

**`App.tsx` modifications:**

1. **Third SSE subscription (D-22):** Added `onSseEvent('shot.status_changed', onShotStatusChanged)` alongside the existing two version handlers, plus the matching `offSseEvent('shot.status_changed', onShotStatusChanged)` in the cleanup return. The SAME module-scope `onShotStatusChanged` reference (imported from `state/shot-grid.ts`) is passed to both on/off so `events.ts:116 listeners.delete(fn)` succeeds — reference-equality contract.

2. **Home button in header (D-03):** Wrapped the existing brand `<span>` in `<div class="flex items-center gap-2">` and prepended a `<button aria-label="Back to home view">` containing the `lucide-preact` `Home` icon at `size={16}`. Color reflects `activeView`: `text-[var(--color-accent)]` when home, `text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]` when shot-grid. Click sets `activeView.value = 'home'` AND mirrors the switch into the URL via `persistShotGridUrlState()` (replaceState — view settings, not navigation).

3. **Conditional body render:** Changed `<HomeView />` to `{isHome ? <HomeView /> : <ShotGridView />}` where `const isHome = activeView.value === 'home'`. This is the FIRST time `App.tsx` swaps the body view based on a signal — Phase 19 introduced overlay drawers via `selectedVersionId`, but those mounted ON TOP of HomeView, not in place of it.

**`HomeView.tsx` modifications:**

Added two new TreeSidebar props (Wave 3 D-01, D-02, D-05 hookup):

```tsx
<TreeSidebar
  workspaces={tree}
  selectedShotId={selectedShotId.value}
  onSelectShot={...}
  expandedIds={expandedIds}
  onToggleExpand={toggleExpand}
  onOpenGrid={(seqId) => {
    activeView.value = 'shot-grid';
    selectedSequenceForGrid.value = seqId;
    persistShotGridUrlState();
  }}
  currentGridSequenceId={selectedSequenceForGrid.value ?? undefined}
/>
```

Grid-icon click flips `activeView`, points `selectedSequenceForGrid` at the clicked sequence, and mirrors both into the URL. The active sequence (whose grid is currently displayed) gets `aria-current="page"` + accent fill via the `currentGridSequenceId` prop.

**`App.test.tsx` (NEW, 200 LOC, 8 cases across 2 describes):**

| Describe | Cases | Coverage |
|---|---|---|
| View routing (GRID-01) | 4 | home renders TreeSidebar nav; shot-grid renders Status filter label; home button click sets activeView='home'; accent color on home, muted color on shot-grid (split into two single-render tests for cross-test isolation) |
| SSE registration (GRID-02 / D-22) | 3 | mount calls onSseEvent('shot.status_changed', expect.any(Function)); unmount calls offSseEvent with the SAME function ref (reference equality — load-bearing); existing version subscriptions regression-preserved |

**Test scaffolding decisions:**

- `vi.stubGlobal('localStorage', makeMemoryStorage())` — Node 25+ experimental localStorage workaround. Mirrors `views/__tests__/VersionDrawer.test.tsx` (canonical precedent in this repo). ThemeToggle + hydrateSortState both read localStorage at mount.
- `vi.mock('../lib/events.js', ...)` — hoisted stub of the 4 SSE entry points. Lets the SSE tests assert exact arg shape via `mock.calls.find`.
- `vi.mock('../lib/api.js', async (importOriginal) => ...)` — partial mock preserving non-fetch exports (`getThumbnailUrl`, `DashboardApiError`), stubbing only the network helpers as never-resolving promises so neither view fires real HTTP at render.
- `history.replaceState('', '', pathname)` in `beforeEach` — clears URL params so a prior test's `persistShotGridUrlState()` doesn't leak state into the next test's `hydrateShotGridUrlState()` at mount.

## End-to-End Integration Verified

After Wave 4 the full request-routing path is live:

```
User clicks TreeSidebar grid icon in HomeView
  ↓
TreeSidebar's onOpenGrid callback fires (D-02 via Wave 3)
  ↓
HomeView updates state/shot-grid signals:
   activeView.value = 'shot-grid'
   selectedSequenceForGrid.value = seqId
   persistShotGridUrlState()       (URL mirror via replaceState)
  ↓
App.tsx's conditional render re-evaluates:
   activeView.value === 'shot-grid' → <ShotGridView/> mounts
  ↓
ShotGridView's mount useEffects run:
   1. hydrateShotGridUrlState()    (read URL; signals already current)
   2. fetchShotGrid(seqId, { limit: 20 })
       ↓
   2a. GET /api/sequences/:id/shot-grid
       ↓
   2b. engine.listShotGrid → listShotsForGrid (Wave 1 CTE)
       ↓
   2c. ShotGridResponse → shotGrid.value (signal write)
  ↓
filteredShots = client-side filter over shotGrid.value.shots
aggregateCounts.value re-derives reactively (D-14)
CSS Grid renders ShotGridCard instances keyed on shot.id
  ↓
On SSE shot.status_changed:
   App.tsx's onShotStatusChanged handler (registered at mount) fires
   ↓
   state/shot-grid.ts updates shotGrid.value immutably
   ↓
   Affected card re-renders; aggregateCounts recomputes
   (overlays like VersionDrawer keep their own state — unaffected)
  ↓
User clicks home button:
   activeView.value = 'home' + persistShotGridUrlState()
   ↓
   App.tsx swaps body back to <HomeView/>
   ↓
   HomeView's prior selectedShotId still holds → VersionCard list rehydrates
   (D-04 — independent signals, no clearing on view switch)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `vi.mock('../../lib/api.js', ...)` broke Thumbnail.tsx during render**

- **Found during:** Task T01 first test run
- **Issue:** `vi.mock` with a literal factory replaced the entire api.js module exports. ShotGridCard renders Thumbnail.tsx which imports `getThumbnailUrl` from the same module → "No 'getThumbnailUrl' export is defined on the '../../lib/api.js' mock" error during 6 of 11 tests.
- **Fix:** Switched to the `importOriginal` partial-mock pattern:
  ```typescript
  vi.mock('../../lib/api.js', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return { ...actual, fetchShotGrid: vi.fn() };
  });
  ```
  Keeps all non-mocked exports real (getThumbnailUrl, DashboardApiError, fetchWorkspaces, etc.) while stubbing only the one helper we want to control. Pattern matches `views/__tests__/VersionDrawer.test.tsx:59-73`.
- **Files modified:** `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx`
- **Commit:** `9f8b15a` (folded into T01)

**2. [Rule 3 — Blocking] Node 25+ experimental localStorage threw at ThemeToggle mount**

- **Found during:** Task T02 first test run
- **Issue:** `App` renders `ThemeToggle` which calls `localStorage.getItem(STORAGE_KEY)` at mount. Node 25's experimental native `localStorage` global takes precedence over jsdom's implementation and throws without `--localstorage-file`. Five tests crashed before any assertion.
- **Fix:** Added the `makeMemoryStorage()` polyfill from `views/__tests__/VersionDrawer.test.tsx` and `vi.stubGlobal('localStorage', makeMemoryStorage())` BEFORE the `vi.mock` calls. This is the canonical precedent for dashboard tests that need browser-equivalent localStorage in this repo.
- **Files modified:** `packages/dashboard/src/__tests__/App.test.tsx`
- **Commit:** `c4e1572` (folded into T02)

**3. [Rule 3 — Blocking] URL state leaked between App tests**

- **Found during:** Task T02 second test run
- **Issue:** Test "home button color when activeView='shot-grid'" failed with the button still showing `text-[var(--color-accent)]`. Root cause: a prior test's home-button click had called `persistShotGridUrlState()` which wrote `view=home` to the URL via `replaceState`. The next test's `render(<App/>)` mounted `<ShotGridView/>` (because activeView was just set to 'shot-grid'), which called `hydrateShotGridUrlState()` at mount, which saw `view=home` in the URL, which reset `activeView.value = 'home'` — causing the next signal re-render to flip the button back to accent.
- **Fix:** Added `history.replaceState('', '', pathname)` to `beforeEach` to clear URL params between tests. Try/catch protects SSR / sandboxed history environments.
- **Files modified:** `packages/dashboard/src/__tests__/App.test.tsx`
- **Commit:** `c4e1572` (folded into T02)

**4. [Rule 1 — Test fragility] Single-render-pair test split into two independent tests**

- **Found during:** Task T02 second test run (same investigation as fix 3)
- **Issue:** The "home button color across activeView states" test originally rendered App twice in one function (render → unmount → mutate signal → render again). Even after the URL fix, the dual-render pattern is more fragile than necessary: it relies on signal updates between renders settling exactly the way one expects.
- **Fix:** Split into two single-render tests, one for each activeView state. Each test is hermetic and asserts a single proposition; failures point to a specific signal-state mismatch rather than a transition.
- **Files modified:** `packages/dashboard/src/__tests__/App.test.tsx`
- **Commit:** `c4e1572` (folded into T02)

**5. [Rule 1 — Plan-verify alignment] JSDoc reference to `selectedShotId` rephrased**

- **Found during:** Task T01 plan-verify grep run
- **Issue:** The plan-verify grep `grep -c "selectedShotId" packages/dashboard/src/views/ShotGridView.tsx | awk '$1 == 0 {print "OK"}'` would have failed because the original code had two JSDoc comments referencing `selectedShotId` to document the D-04 contract ("does NOT mutate selectedShotId").
- **Fix:** Rephrased both comments to refer to "the HomeView shot-selection signal" without using the literal identifier. The substantive D-04 contract (no mutation of HomeView's shot-selection state from a card click) is preserved verbatim; only the literal identifier was renamed to its semantic role. Matches Wave 2 21-02 precedent ("JSDoc references to forbidden patterns trip plan verify greps").
- **Files modified:** `packages/dashboard/src/views/ShotGridView.tsx`
- **Commit:** `9f8b15a` (folded into T01)

### Architectural Adjustments

None. No Rule 4 architectural decisions surfaced. The plan executed substantially as written; all deviations were tooling-level fixes that did not alter the design contracts (D-01 through D-22 all preserved verbatim).

### Workflow Observations

1. **TDD interpretation for new-view tasks:** Per Wave 1–3 precedent, TDD-flagged tasks that introduce a new file (no pre-existing implementation to commit a failing test against) follow the "test + impl committed atomically" pattern. RED was demonstrated via pre-implementation test run (logged in T01 commit body — verified the test file fails at module-resolution time before the impl was added); GREEN was the same commit after the impl landed. This matches `executor-examples.md` "acceptable for new-helper introduction" extended to new-view introduction.

2. **Worktree node_modules symlinks:** The worktree spawned without its own `node_modules`. Per Wave 1–3 precedent, symlinks were created from `node_modules/` and `packages/dashboard/node_modules/` to the main repo's installed dependencies so vitest + tsc could run. Symlinks are gitignored (`.gitignore` excludes both paths) and not part of any commit; verified non-tracked via `git status` before each commit.

3. **Two tests reading `aggregateCounts.value` indirectly:** Since `aggregateCounts` is a computed signal derived from `shotGrid.value.shots`, the SequenceHeader receives the mini-pill counts reactively. ShotGridView passes `counts={aggregateCounts.value}` — Preact subscribes; if a test mutates `shotGrid.value.shots` after render, the SequenceHeader re-renders with fresh counts. This is exercised implicitly by the empty-state copy tests (which pass varied shot sets and verify the rendered empty state text — the absence of SequenceHeader counts in the empty-state branch is not asserted, but it's a side effect of the conditional render `{shotGrid.value && <SequenceHeader .../>}`).

### Auth Gates

None. All work was local TypeScript/JSX/test authoring with no external service calls.

## Threat Surface Scan

No new security-relevant surface introduced beyond what Wave 1–3 covered:

- **URL state**: `persistShotGridUrlState()` and `hydrateShotGridUrlState()` are Wave 2 surfaces; Wave 4 only WIRES them (home button click + TreeSidebar onOpenGrid + ShotGridView mount). Both helpers were threat-modeled in Wave 2 (Zod whitelist + replaceState lock + never-throws contract).
- **SSE subscription**: `onShotStatusChanged` is the Wave 2 handler; Wave 4 only registers it. The handler itself was threat-modeled in Wave 2 (cross-sequence event ignore, unknown shotId no-op, null shotGrid no-op).
- **Card click**: Sets `selectedVersionId.value` to a server-supplied `latest_completed_version.id` from `ShotGridResponse`. The id is the same opaque string used by the existing VersionDrawer pathway (Phase 19 surface, threat-modeled at the dashboard-routes layer).
- **Home button**: Sets `activeView.value = 'home'` — purely client-side state; no network surface.
- **No new fetch**: ShotGridView uses the Wave 2 `fetchShotGrid` consumer; no new HTTP calls introduced by Wave 4.
- **Architecture-purity unchanged**: `src/__tests__/architecture-purity.test.ts` passes (57/57 across the two cross-cutting invariants).

Omitting Threat Flags section — nothing new found.

## Verification Evidence

```bash
# Type-check (dashboard package): clean
npx tsc --noEmit -p packages/dashboard/tsconfig.json      # exits 0

# Per-task targeted tests — all green
npx vitest run packages/dashboard/src/views/__tests__/ShotGridView.test.tsx   # 11/11 passed
npx vitest run packages/dashboard/src/__tests__/App.test.tsx                  # 8/8 passed

# Full dashboard suite — 361 / 361 green (342 baseline + 19 new)
cd packages/dashboard && npx vitest run
  Test Files  34 passed (34)
       Tests  361 passed (361)

# Cross-cutting invariants — both green, unchanged
npx vitest run src/__tests__/architecture-purity.test.ts \
                src/__tests__/tool-budget.test.ts
  Test Files  2 passed (2)
       Tests  57 passed (57)

# T01 plan-verify greps
grep -c "export function ShotGridView" packages/dashboard/src/views/ShotGridView.tsx  # → 1 ✓
grep -c "gridTemplateColumns" packages/dashboard/src/views/ShotGridView.tsx           # → 1 ✓
grep -c "selectedVersionId" packages/dashboard/src/views/ShotGridView.tsx             # → 4 ✓
grep -c "selectedShotId" packages/dashboard/src/views/ShotGridView.tsx                # → 0 ✓ (no mutation, no mention — D-04)
grep -c "onSseEvent" packages/dashboard/src/views/ShotGridView.tsx                    # → 0 ✓ (D-22 — SSE belongs in App.tsx)

# T02 plan-verify greps
grep -c "shot.status_changed" packages/dashboard/src/App.tsx                          # → 4 ≥ 2 ✓
grep -c "activeView" packages/dashboard/src/App.tsx                                   # → 6 ≥ 3 ✓
grep -c "HEADER_HOME_ARIA_LABEL\|Back to home view" packages/dashboard/src/App.tsx    # → 3 ≥ 1 ✓
grep -c "ShotGridView" packages/dashboard/src/App.tsx                                 # → 4 ≥ 2 ✓
grep -c "onOpenGrid" packages/dashboard/src/views/HomeView.tsx                        # → 1 ≥ 1 ✓
```

## Plan Success Criteria — All Met

- [x] `<ShotGridView/>` fully integrated: filter bar + sequence header + grid + load-more + empty states
- [x] View handles all 4 empty state copy variants (3 plan-required + 1 defensive FLAG branch)
- [x] "Toggle Show omitted OFF auto-resets filter='omit' to 'all'" works (test case + impl confirmed)
- [x] `<App/>` renders the correct view based on activeView signal (signal-driven conditional render)
- [x] Home button position, aria-label, color classes match D-03 + UI-SPEC (4 test cases)
- [x] SSE subscription for `shot.status_changed` is registered AND unregistered with SAME function reference (reference-equality test passing — load-bearing per events.ts:116)
- [x] All plan-scope tests pass; full-suite regression remains green (361/361)
- [x] TreeSidebar grid-icon click flips activeView (via HomeView wiring); user can navigate end-to-end (integration verified)
- [x] Architecture-purity + tool-budget invariants remain unchanged (57/57 still green)
- [x] All tasks committed atomically (one commit per task: `9f8b15a` + `c4e1572`)
- [x] OMIT_HIDDEN empty state branch handled defensively (21-04 plan-checker FLAG — branch implemented + tested)

## Required Outputs (per plan `<output>` block)

- **Final ShotGridView mount-time fetch + filter logic structure** — documented above under "What Was Built / T01". Two useEffects (URL hydration once, fetch on selectedSequenceForGrid change with alive latch); client-side filter is a single `.filter` over `shotGrid.value?.shots ?? []` with showOmitted gate + statusFilter pill match.

- **Three (now four) empty-state copy branches** — branches 1–4 documented in the D-18 table above. Branch 3 (`SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN`) is the 21-04 plan-checker FLAG defensive addition for URL-hydrated `statusFilter='omit'` + `showOmitted=false` state.

- **App.tsx conditional render + SSE subscription wiring** — documented above under "What Was Built / T02". Third SSE handler in the existing useEffect; matching offSseEvent in cleanup; signal-driven conditional body render with the home button click as the home-side trigger.

- **SSE handler reference-equality test passes** — confirmed. Test "unsubscribes shot.status_changed on unmount with the SAME function reference (events.ts:116 .delete contract)" captures `subscribed = onSseEvent.mock.calls.find(...)[1]` before unmount, then asserts `unsubscribed === subscribed` after. Module-scope `onShotStatusChanged` export from `state/shot-grid.ts` guarantees reference stability.

- **TreeSidebar grid-icon click (via HomeView wiring) flips activeView correctly** — confirmed via D-04/D-06 end-to-end. HomeView's `onOpenGrid` callback writes `activeView.value = 'shot-grid'` + `selectedSequenceForGrid.value = seqId` + `persistShotGridUrlState()`. Wave 3 tests already cover the grid-icon click → callback invocation; Wave 4 wires the callback to the signals that App.tsx reads to swap the body view.

- **Deviations** — documented above under "Deviations from Plan". Summary: five auto-fixes (4 Rule 3 blocking, 1 Rule 1 test fragility); zero Rule 4 architectural changes; zero substantive plan deviations. All design contracts D-01 through D-22 preserved verbatim.

## Commits

| Task | Commit  | Message |
|------|---------|---------|
| T01  | `9f8b15a` | feat(21-04): add ShotGridView view + 11-case TDD suite |
| T02  | `c4e1572` | feat(21-04): wire App.tsx view routing + SSE + home button; HomeView TreeSidebar grid icon |

## Self-Check: PASSED

```bash
# Files claimed in key-files.created exist on disk
[ -f packages/dashboard/src/views/ShotGridView.tsx ] && echo FOUND      # FOUND
[ -f packages/dashboard/src/views/__tests__/ShotGridView.test.tsx ] && echo FOUND  # FOUND
[ -f packages/dashboard/src/__tests__/App.test.tsx ] && echo FOUND      # FOUND
[ -f .planning/phases/21-shot-grid-view/21-04-SUMMARY.md ] && echo FOUND # FOUND (this file)

# Files claimed in key-files.modified contain the additions
grep -q "ShotGridView" packages/dashboard/src/App.tsx && echo FOUND    # FOUND
grep -q "onOpenGrid" packages/dashboard/src/views/HomeView.tsx && echo FOUND  # FOUND

# Commit hashes reachable from HEAD
git log --oneline | grep -q "9f8b15a" && echo FOUND  # FOUND
git log --oneline | grep -q "c4e1572" && echo FOUND  # FOUND
```
