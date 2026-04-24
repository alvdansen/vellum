---
phase: 07-comfyui-endpoint-reconciliation
plan: 04
subsystem: comfyui-client
tags: [phase-07, tests, healthcheck, endpoint-reconciliation, drift-coverage]

# Dependency graph
requires:
  - phase: 07-02
    provides: "ensureEndpointHealthy() method + HEALTHCHECK_PATH export + COMFYUI_ENDPOINT_DRIFT error code + mockFetchRaw test-helper escape hatch (all consumed verbatim by Plan 04's 4 unit tests)"
provides:
  - "Regression gate on `ensureEndpointHealthy()` semantics: any future change that breaks cache-hit memoization, race-safety, DRIFT error code, or failure-retry cache reset will fail at least one of the 4 new tests"
  - "Coverage of D-EP-07 (first-submit lazy healthcheck + cache hit), D-EP-08 (DRIFT error with probe-script hint), D-EP-10 (race-safe Promise memoization), Pitfall #2 (failure does not poison cache)"
affects: [07-05, 07-06, comfyui-client-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mockFetchRaw usage pattern — tests that need to observe or drive the healthcheck GET itself (count invocations, return 401 for DRIFT coverage, defer resolution for race-safety verification) bypass the auto-200 interception that mockFetch provides for legacy tests"
    - "Promise-deferred race-safety test — concurrent submits kicked off before an externally-held resolver completes the shared healthcheck Promise; a 5ms event-loop tick synchronizes the assertion point between kickoff and resolution"
    - "Counter-based memoization assertions — explicit healthGets / promptPosts counters incremented inside the fetchImpl prove both the wire-level fetch count AND the functional short-circuit (prompt POST never fires on DRIFT)"

key-files:
  created: []
  modified:
    - "src/comfyui/__tests__/client.test.ts (Task 1, commit 292f5c2) — +140/-0: new describe('ComfyUIClient.ensureEndpointHealthy (D-EP-07, D-EP-08, D-EP-10)') block appended at end of file, containing 4 tests"

key-decisions:
  - "Used mockFetchRaw (not mockFetch) for all 4 tests — the plan's example code snippet showed mockFetch, but both the Plan 02 SUMMARY.md (`mockFetchRaw escape hatch is reserved for Plan 04 which must drive DRIFT paths directly`) and the executor objective (`use it when your test needs to see the healthcheck request itself`) make mockFetchRaw the correct helper. All 4 tests either count healthcheck GETs (tests 1, 3) or return non-200 on the healthcheck (tests 2, 4) — both behaviors require seeing the healthcheck request, which mockFetch would hide. This is a code-fidelity improvement, not a deviation."
  - "No top-of-file changes needed — HEALTHCHECK_PATH was already imported by Plan 02's test helper retrofit (line 9 of client.test.ts). The plan's STEP 1 had already been done in Plan 02."
  - "Kept test-case structure verbatim from plan <action>.STEP_2 — same counter names (healthGets, promptPosts), same workflow node names ({class_type: 'A', inputs: {}}), same 5ms setTimeout for race-safety coordination, same inline comments citing D-EP-07/08/10 + Pitfall #2. Only substantive change: `mockFetchRaw` instead of `mockFetch` (see decision above)."

patterns-established:
  - "D-EP-07 regression gate — any change to `ensureEndpointHealthy()` that (a) removes the `if (this.healthCheckResult) return` short-circuit, (b) changes the error code from COMFYUI_ENDPOINT_DRIFT to something else, (c) removes the `this.healthCheckResult = null` reset on failure, or (d) removes Promise-based memoization in favor of boolean flag will fail one of the 4 tests. Test 1 guards (a); Test 2 guards (b); Test 3 guards (d); Test 4 guards (c)."
  - "When a shared test helper is augmented with a new invariant (mockFetch auto-200 healthcheck), provide an explicit escape hatch (mockFetchRaw) for future tests that need to observe/drive that invariant. This Plan 04 validates the pattern — 4 tests each use mockFetchRaw and the helper contract holds."

requirements-completed: []

# Metrics
duration: ~2.5min
completed: 2026-04-24
---

# Phase 7 Plan 04: Healthcheck Unit Coverage Summary

**Added 4 targeted unit tests for `ComfyUIClient.ensureEndpointHealthy()` covering the four D-EP-07/08/10 behaviors Plan 02 wired (cache hit, DRIFT-with-hint, race-safe memoization, failure-retry) — closing the test-coverage gap that the Plan 02 SUMMARY flagged as "test coverage of the 4 DRIFT scenarios is Plan 04." All 4 tests use the `mockFetchRaw` escape hatch Plan 02 left for this exact purpose.**

## Performance

- **Duration:** ~2.5 min (one-file append; no scaffold work; 4 tests green on first run)
- **Completed:** 2026-04-24
- **Tasks:** 1 (`type="auto" tdd="true"` — combined RED+GREEN in one commit since the behavior under test already exists from Plan 02)
- **Files created:** 0
- **Files modified:** 1 (`src/comfyui/__tests__/client.test.ts`)
- **New untracked generated files:** 0
- **Self-check files present:** this SUMMARY.md

## Accomplishments

- **Four new tests, all green on first run:**
  1. **`first-submit healthcheck fires exactly once; second submit skips it (cache hit)`** — proves D-EP-07 lazy-cache semantics. Two sequential `client.submit()` calls, counts `healthGets === 1` and `promptPosts === 2`.
  2. **`healthcheck 401 throws COMFYUI_ENDPOINT_DRIFT with probe-script hint; /api/prompt never called`** — proves D-EP-08 typed-error discrimination (DRIFT vs COMFYUI_API_ERROR) AND the hint's actionable-guidance contract (names `scripts/probe-comfy-endpoint.mts`). Asserts `promptPosts === 0` — the submit short-circuits on healthcheck failure before any POST.
  3. **`concurrent submits share one in-flight healthcheck Promise (race-safe memoization, D-EP-10)`** — proves the Promise-as-cache pattern. Uses an externally-held resolver + 5ms event-loop tick to validate that both concurrent submits `await` the SAME in-flight Promise (single `healthGets === 1` with two `promptPosts === 2`). Without Promise memoization, this test would observe `healthGets === 2` (N+1 probe anti-pattern).
  4. **`failed healthcheck does not poison cache; next submit retries cleanly (Pitfall #2)`** — proves the failure-path `this.healthCheckResult = null` reset. First submit 401 → DRIFT rejection; second submit on the SAME client sees a fresh healthcheck GET (counter goes 1 → 2), which returns 200 this time, and the submit proceeds successfully. Without cache-reset, the second submit would reuse the rejected Promise (the "memoized rejection" anti-pattern RESEARCH called out).
- **New `describe` block appended after the last existing block** (`ComfyUIClient.fetchResolvedPrompt`) — preserves the existing 49 tests unchanged (now 53 total). No retrofits required; Plan 02's auto-healthcheck `mockFetch` wrapper keeps the old tests green while the 4 new tests use `mockFetchRaw` to see the healthcheck GET directly.
- **Test count deltas match plan projections:**
  - `client.test.ts`: 49 → 53 (+4 new, 0 regressions)
  - Full suite: 735 → 739 passed / 2 skipped (exact match to plan's projected baseline)
  - Skipped count unchanged at 2 (live-smoke gate only; Plan 05 will add the sentinel skip to bring it to 3)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add describe('ComfyUIClient.ensureEndpointHealthy (D-EP-07)') with 4 tests** — `292f5c2` (test)

**Plan metadata:** this SUMMARY commit (docs) — created after Task 1 commit lands.

## Files Created/Modified

### Created

None.

### Modified

- `src/comfyui/__tests__/client.test.ts` — +140/-0 lines. New `describe('ComfyUIClient.ensureEndpointHealthy (D-EP-07, D-EP-08, D-EP-10)', () => { ... })` block appended at end of file (after the `describe('ComfyUIClient.fetchResolvedPrompt')` block). Contains 4 `test()` entries, each using the `mockFetchRaw` escape hatch + `jsonResponse` helper + `KEY` / `BASE` constants already at module scope. Zero changes to any of the 49 pre-existing tests. Zero changes to the top-of-file import block (HEALTHCHECK_PATH was already imported by Plan 02's test helper retrofit).

## Verification

Plan `<verify>` assertions (all green):

| Assertion | Result |
| --- | --- |
| `grep -q "describe('ComfyUIClient.ensureEndpointHealthy" src/comfyui/__tests__/client.test.ts` | OK |
| `grep -q "HEALTHCHECK_PATH" src/comfyui/__tests__/client.test.ts` | OK (pre-existing import + 4 new references) |
| `grep -q "code: 'COMFYUI_ENDPOINT_DRIFT'" src/comfyui/__tests__/client.test.ts` | OK |
| `grep -q "scripts/probe-comfy-endpoint.mts" src/comfyui/__tests__/client.test.ts` | OK |
| `npx vitest run src/comfyui/__tests__/client.test.ts` | **53 passed** (was 49; +4) |
| `npx vitest run` (full suite) | **739 passed / 2 skipped** (plan baseline target) |
| `npx tsc --noEmit` | exits 0 |
| No deletions in Task 1 commit | OK (`git diff --diff-filter=D HEAD~1 HEAD` empty) |
| No stubs / TODO / placeholder / "coming soon" introduced | OK (grep empty) |

## Decisions Made

- **Used `mockFetchRaw` (not `mockFetch`) for all 4 tests.** The plan's STEP 2 example code showed `mockFetch`, but that helper transparently intercepts GET `HEALTHCHECK_PATH` → 200 — which would hide the very thing these tests need to observe. Plan 02's SUMMARY explicitly states "mockFetchRaw escape hatch is reserved for Plan 04 which must drive DRIFT paths directly" (line 18 of 07-02-SUMMARY.md frontmatter and line 170-171 of Plan 02's "Issues Encountered > Follow-up"). The executor prompt also reinforced this: "Plan 02 added a `mockFetchRaw` escape hatch specifically for Plan 04's new tests — use it when your test needs to see the healthcheck request itself (cache-hit counter verification, drift-throws 401/500 simulation, race-safe concurrent-submit verification, failure-retry after first fail)." All 4 test cases match one of those explicit uses. This is a code-fidelity clarification, not a plan deviation — the plan's test intent (count healthcheck GETs, observe DRIFT responses) REQUIRES mockFetchRaw.
- **No top-of-file import changes.** The plan's STEP 1 said to add `HEALTHCHECK_PATH` to the imports, but Plan 02 had already done that during its test-helper retrofit. Verified: line 9 of client.test.ts already has `HEALTHCHECK_PATH,` in the import block from `../client.js`. No-op step, skipped cleanly.
- **Task 1 committed as `test(...)`** per the task_commit_protocol's RED/GREEN rules for test-only changes. Behavior under test (`ensureEndpointHealthy`) was implemented in Plan 02 commit `7d34586` — the RED phase for that behavior was implicit in Plan 02's implementation-before-test flow. Plan 04 is pure-test-addition (regression gate for a working feature), so `test(...)` is the correct commit type per the protocol table.

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed exactly as written, with the one explicit-decision refinement noted above (mockFetchRaw vs mockFetch — this is an explicit Plan 02 handoff, not a plan modification).

### Plan-driven / expected findings (not deviations)

- **STEP 1 was already done in Plan 02.** No code change needed. The plan's projected delta assumed Plan 04 would be the site of the HEALTHCHECK_PATH import addition, but Plan 02's test-helper retrofit had already made the import present. This is consistent with Plan 02's own documented "Test-fixture co-evolution" pattern and flagged in its SUMMARY. No scope or outcome change.

---

**Total deviations:** 0
**Impact on plan:** Zero scope creep. 4 tests added, all passing, full suite baseline matches plan's projected 739/2 target exactly.

## Issues Encountered

None. Plan executed cleanly end-to-end. The only judgment call was the `mockFetchRaw` vs `mockFetch` helper selection (resolved by treating the executor prompt's explicit guidance as authoritative), which was documented in the Plan 02 SUMMARY's handoff section.

## Success Criteria Status

- **SC-2 (Healthcheck unit coverage verifies memoization, drift detection, race-safety, and failure-retry semantics):** ✅ complete. All 4 behaviors have a dedicated unit test that fails if the corresponding code path breaks. Regression gate in place.
- **Plan-local test-count invariants:**
  - `client.test.ts` passed count: 49 → 53 (✅ +4 as specified)
  - Full suite passed count: 735 → 739 (✅ exact match to plan's `passed_count ≥ 739` target)
  - Full suite skipped count: 2 → 2 (✅ no new skips — Plan 05 adds skip #3, not this plan)
  - `npx tsc --noEmit`: exits 0 (✅ TypeScript clean)

## User Setup Required

None — pure test addition. Plans 05 (sentinel test) and 06 (live-smoke end-to-end) remain unblocked.

## Next Phase Readiness

- **Plan 07-05 (Wave 3, sentinel test) unblocked.** Can be executed in parallel with this plan since Plan 05 only depends on Plan 02's `HEALTHCHECK_PATH` export (already landed), not Plan 04's test-side coverage.
- **Plan 07-06 (Wave 4, live-smoke) unblocked.** Orthogonal to this plan; live-smoke was already passing in Plan 02's regression baseline (735 passed + live-smoke gated OFF). Plan 06 will flip the gate ON and confirm end-to-end.
- **No follow-up work surfaced.** The 4 tests run deterministically (no flaky-timing concerns — the 5ms setTimeout in Test 3 is a well-bounded event-loop tick that Vitest's default retry/timeout settings handle cleanly).

## Behavioral Clarifications

A few notes for future maintainers inspecting the 4 tests:

- **Test 3's `setTimeout(r, 5)` is intentional, not a bug.** It exists to let the V8 microtask queue drain both `submit()` calls to the point where they're `await`-ing inside `ensureEndpointHealthy()`. Without the pause, the `expect(healthGets).toBe(1)` assertion would race the first submit's synchronous prefix (before any `await`) and could see `healthGets === 0`. 5ms is arbitrary but generous; any value ≥ 1ms works.
- **Test 2's `try/catch` after the main assertion is a hint-inspection probe, not a redundancy.** The primary assertion uses `rejects.toMatchObject` which only checks `name` and `code` (the non-enumerable hint field doesn't round-trip through `toMatchObject` cleanly in all vitest configs). A fresh `client.submit()` call is made inside the try/catch to re-trigger the error (the first submit's DRIFT reset `healthCheckResult = null`, so the second call fires a fresh healthcheck, which returns 401 again), and the hint is read directly off the thrown error.
- **No integration with `architecture-purity.test.ts` or `stdio-hygiene.test.ts` needed.** These 4 tests are pure unit tests using the `fetchImpl` injection seam — no MCP surface, no stdout writes, no new engine imports. Both purity/hygiene tests stayed green in the full-suite run.

## Self-Check

- [x] `src/comfyui/__tests__/client.test.ts` contains `describe('ComfyUIClient.ensureEndpointHealthy (D-EP-07, D-EP-08, D-EP-10)'` (verified with grep)
- [x] 4 new `test('...')` entries present inside that block (verified by eye + vitest test count delta of +4)
- [x] `mockFetchRaw` helper used in all 4 tests (verified with grep — 4 occurrences in new block)
- [x] `COMFYUI_ENDPOINT_DRIFT` literal present in assertions (verified with grep)
- [x] `scripts/probe-comfy-endpoint.mts` present in hint-assertion (verified with grep)
- [x] `HEALTHCHECK_PATH` import at top of file (pre-existing from Plan 02, no change needed — verified with grep line 9)
- [x] No modifications to any of the 49 pre-existing tests (verified via `git diff` — only additions in the new block)
- [x] `npx vitest run src/comfyui/__tests__/client.test.ts` reports 53 passed (was 49 baseline)
- [x] `npx vitest run` full suite reports 739 passed / 2 skipped (exact plan match)
- [x] `npx tsc --noEmit` exits 0 (verified)
- [x] Task 1 commit `292f5c2` in `git log --oneline` (verified via `git rev-parse --short HEAD`)
- [x] No STATE.md or ROADMAP.md edits in this plan (verified — commit stat shows only `src/comfyui/__tests__/client.test.ts`)
- [x] No stubs / TODO / placeholder introduced (grep scan returned empty)
- [x] No deletions in the Task 1 commit (`git diff --diff-filter=D HEAD~1 HEAD` empty)

## Self-Check: PASSED

---
*Phase: 07-comfyui-endpoint-reconciliation*
*Plan: 04*
*Completed: 2026-04-24*
