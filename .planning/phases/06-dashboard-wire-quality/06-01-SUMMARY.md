---
phase: 06-dashboard-wire-quality
plan: 01
subsystem: testing
tags: [vitest, dashboard, wave-0, tdd-red, typed-errors, exhaustive-switch]

# Dependency graph
requires:
  - phase: 05-webui-preact-vite
    provides: "dashboard scaffold (lib/api.ts fetchJson helper, lib/shape.ts normalizeStatus helper, __tests__/ dir + vitest+jsdom setup, events.test.ts / active-generations.test.ts analogs)"
provides:
  - "RED-state test scaffold for SC-3 (DashboardApiError typed-error preservation, 6 cases)"
  - "RED-state test scaffold for SC-6 (normalizeStatus exhaustive switch, 9 cases — 7 pass / 2 fail intentionally)"
  - "Wave 0 file gate closed: both MISSING files from 06-VALIDATION.md now exist and commit the exact assertion shapes that Wave 1 production plans must satisfy"
affects: [06-02, 06-03, 06-04, 06-05, 06-06, 06-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 RED scaffold: commit failing tests BEFORE production code so Plan 04/07 executors see the exact contract"
    - "vi.stubGlobal('fetch')-then-import idiom for DashboardApiError tests (analog: events.test.ts + EventSource)"
    - "Force-cast unknown inputs (as unknown as Version['status']) to exercise exhaustive switch _exhaustive: never default arm"

key-files:
  created:
    - packages/dashboard/src/__tests__/api-error.test.ts
    - packages/dashboard/src/__tests__/shape.test.ts
  modified: []

key-decisions:
  - "Wave 0 RED state is intentional: api-error.test.ts fails with module-load error (fetchJson/DashboardApiError not exported) — Plan 04 lands exports; shape.test.ts shows 7 pass + 2 fail (throws-on-unknown) — Plan 07 lands the throw"
  - "Exact assertion shapes + exact regex /normalizeStatus: unhandled status: <name>/ pinned in tests so Plan 04 and Plan 07 implementers see the contract verbatim (no fuzzy matching, no wiggle room)"
  - "Case count pinned at 6 (SC-3) and 9 (SC-6) per 06-RESEARCH.md contract — no drift, no over-engineering"
  - "No production code touched in Wave 0 (git diff packages/dashboard/src/lib/ clean); Plans 04 + 07 own those files exclusively"
  - "Fetch stub uses vi.stubGlobal + mockResolvedValueOnce-per-case (test-scoped reset via mockReset in beforeEach) — mirrors events.test.ts module-load-caching guard"

patterns-established:
  - "Wave 0 contract-first test scaffolds: phase validation surfaces MISSING test files, Wave 0 plan commits them RED, Wave 1 plans turn them GREEN editing only production modules"
  - "Test-scoped fetch stub reset (vi.fn().mockReset in beforeEach) — safe default for any dashboard test using mockResolvedValueOnce queues"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-04-24
---

# Phase 06 Plan 01: Wave 0 Dashboard Test Scaffolds Summary

**SC-3 (DashboardApiError) and SC-6 (normalizeStatus exhaustive) RED test scaffolds committed ahead of Plans 04/07 with exact assertion shapes + regex contracts pinned**

## Performance

- **Duration:** 3 min (~141 seconds from start to final commit)
- **Started:** 2026-04-24T00:21:20Z
- **Completed:** 2026-04-24T00:23:41Z
- **Tasks:** 2 (both TDD, both RED as intended)
- **Files modified:** 2 created, 0 modified, 0 deleted

## Accomplishments

- Closed the Wave 0 file gate from 06-VALIDATION.md: both MISSING dashboard test files now exist at HEAD
- SC-3 contract pinned at six cases (VERSION_NOT_FOUND 404 envelope, INVALID_INPUT 400, OUTPUT_UNAVAILABLE 404, HTML 502 fallback, empty-body 500 fallback, 200 happy path) — all currently failing with module-load error (intentional RED for Plan 04)
- SC-6 contract pinned at nine cases (every Version['status'] union member + undefined defensive default + two force-cast unknowns expecting throw) — 7 pass / 2 fail intentionally (the two "throws on unknown" cases await Plan 07's exhaustive switch)
- Zero regressions: existing dashboard tests still 15/15 green (events.test.ts + active-generations.test.ts + theme-persistence.test.ts baseline preserved)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create packages/dashboard/src/__tests__/api-error.test.ts (SC-3 Wave 0)** — `0e8a0ef` (test)
2. **Task 2: Create packages/dashboard/src/__tests__/shape.test.ts (SC-6 Wave 0)** — `41d4940` (test)

_TDD gate: both tasks are RED-phase commits with `test(...)` prefix. GREEN gates are owned by downstream plans (Plan 04 satisfies SC-3 by exporting DashboardApiError + fetchJson from lib/api.ts; Plan 07 satisfies SC-6 by replacing the silent fallback in lib/shape.ts with an exhaustive switch + throw). This is by design per the plan's Wave 0 frontmatter and is NOT a TDD-gate violation — the overall phase-level RED→GREEN→REFACTOR cycle spans multiple plans._

## Files Created/Modified

- `packages/dashboard/src/__tests__/api-error.test.ts` — NEW: 140 lines, 6 `it()` cases covering DashboardApiError contract from 06-RESEARCH.md §SC-3. Uses `vi.stubGlobal('fetch', mockFetch)` BEFORE `import { fetchJson, DashboardApiError } from '../lib/api.js'` so the module-under-test picks up the mock even if it caches `fetch` at load time. Per-test `mockFetch.mockReset()` in `beforeEach`.
- `packages/dashboard/src/__tests__/shape.test.ts` — NEW: 69 lines, 9 `it()` cases covering normalizeStatus contract from 06-RESEARCH.md §SC-6. Pure-import (no globals to stub). Every union member mapped + undefined default + two force-cast unknowns (`'aborted'`, `'cancelled'`) with exact regex `/normalizeStatus: unhandled status: <name>/`.

## Decisions Made

- **Wave 0 RED is the product.** Committing failing tests to HEAD looks wrong in isolation but is the entire point: downstream Plan 04/07 executors open the repo, see the red assertions, and write the minimal implementation that turns them green. No test churn needed when the impl lands.
- **Exact contract shapes, no generalization.** Tests pin `err.code === 'VERSION_NOT_FOUND'` (not `expect.stringContaining('VERSION')`) and `/normalizeStatus: unhandled status: aborted/` (not a loose regex). This removes ambiguity for Plan 04/07 implementers.
- **No production code changes.** `git diff packages/dashboard/src/lib/` is clean after both task commits. Plans 04 + 07 own those files exclusively.
- **Case counts match RESEARCH contract.** Six cases for SC-3 and nine for SC-6, not "at least six" with bonus assertions. Avoids scope drift and keeps the diff reviewable.

## Deviations from Plan

None — plan executed exactly as written. Both tasks followed the EXACT skeleton provided in the plan's `<action>` blocks (verbatim TypeScript source, identical comment headers, same case ordering). No auto-fixes were needed because there was no production code to break.

## Issues Encountered

None. Both tasks are pure file creations with Zod/TypeScript-clean assertions. Baseline dashboard tests remained 15/15 green throughout.

## User Setup Required

None — this plan creates test scaffolds only. No env vars, no external services, no dashboard config.

## Next Phase Readiness

- **Plan 04 (SC-3 impl) ready to execute.** api-error.test.ts pins the exact contract: `DashboardApiError` class export + `fetchJson` export with typed-envelope rethrow + HTTP_ERROR fallback for non-JSON bodies. Plan 04 edits only `packages/dashboard/src/lib/api.ts`; running `npm run test:dashboard -- --run src/__tests__/api-error.test.ts` after Plan 04 lands MUST return 6 pass / 0 fail.
- **Plan 07 (SC-6 impl) ready to execute.** shape.test.ts pins the exhaustive-switch contract with regex `/normalizeStatus: unhandled status: <name>/`. Plan 07 edits only `packages/dashboard/src/lib/shape.ts`; running `npm run test:dashboard -- --run src/__tests__/shape.test.ts` after Plan 07 lands MUST return 9 pass / 0 fail.
- **Other Wave 1 plans (02, 03, 05, 06) unaffected** — this plan only closes the Wave 0 gap, no API or type surface was touched.
- **No blockers** for downstream phase execution. The 2 failing test files + 8 failing test cases visible in CI are the intentional, planned Wave 0 state. If CI gates on green tests at HEAD, downstream plans 04/07 must land before a green-tests gate runs — which matches the phase's wave ordering.

---

## Self-Check: PASSED

File existence:
- FOUND: `packages/dashboard/src/__tests__/api-error.test.ts`
- FOUND: `packages/dashboard/src/__tests__/shape.test.ts`

Commits on branch:
- FOUND: `0e8a0ef` — `test(06-01): add SC-3 Wave 0 test scaffold for DashboardApiError`
- FOUND: `41d4940` — `test(06-01): add SC-6 Wave 0 test scaffold for normalizeStatus exhaustive mapping`

Success criteria:
- [x] api-error.test.ts: 6 `it(` cases (≥6 required) ✓
- [x] shape.test.ts: 9 `it(` cases (≥9 required) ✓
- [x] Both files use the exact assertion shapes from 06-RESEARCH.md §SC-3 + §SC-6 ✓
- [x] `git diff packages/dashboard/src/lib/` is clean (no production code modified) ✓
- [x] Existing dashboard tests still pass: 3/3 test files, 15/15 tests (no regression) ✓

---
*Phase: 06-dashboard-wire-quality*
*Completed: 2026-04-24*
