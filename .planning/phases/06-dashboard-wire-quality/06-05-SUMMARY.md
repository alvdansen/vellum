---
phase: 06-dashboard-wire-quality
plan: 05
subsystem: http
tags: [dashboard, input-validation, typed-errors, http-boundary, invalid-input]

# Dependency graph
requires:
  - phase: 06-dashboard-wire-quality
    plan: 03
    provides: "src/http/dashboard-routes.ts in a known-good state post-SC-2 widening (qNum helper untouched by 06-03 — line-range stability preserved for this plan's edit)"
  - phase: 05-web-dashboard
    provides: "TypedError('INVALID_INPUT', ...) → HTTP 400 envelope via typedErrorHandler at error-middleware.ts:85 (code.startsWith('INVALID_') prefix rule) — the wiring this plan's new throw sites rely on"
provides:
  - "qNum(raw, fallback, name) — third `name: string` parameter threaded through every call site, error message names which param failed"
  - "Strict Number.isInteger(n) && n >= 0 guard replaces the lax Number.isFinite check — negatives, non-integer floats, and non-numeric strings all fail closed at the HTTP boundary with HTTP 400 + INVALID_INPUT envelope"
  - "10 dashboard list-route call sites updated (5 limit + 5 offset across /workspaces, /workspaces/:id/projects, /projects/:id/sequences, /sequences/:id/shots, /shots/:id/versions) — uniform third-arg propagation"
  - "6 new SC-4 tests: 3 invalid-input rejections (negative/float/non-numeric) + 1 name-propagation proof (?offset=-5 → message contains 'offset') + 2 happy-path guards (absent params → fallback, zero → valid non-negative integer)"
affects:
  - "Any future list-style route added to dashboard-routes.ts — the qNum(raw, fallback, name) signature now enforces that every caller names the param; adding a limit/offset-like param without the third arg is a tsc error, not a silent bug"
  - "Phase 07 reconciliation (real ComfyUI load on the dashboard) — clients (packages/dashboard/src/lib/api.ts) that pass bad query params now get a deterministic 400 + INVALID_INPUT instead of a silently-clamped empty page; dashboard UX can surface the typed error envelope directly"
  - "Future HTTP routes that parse numeric query params — the plan's pitfall-4 pattern (absent → fallback; present-but-bad → throw with name) is the documented precedent"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Strict-integer input validation at HTTP boundary: Number.isInteger(n) && n >= 0 is the correct check for pagination params — isFinite() admits negatives and floats, isInteger() rejects both plus Infinity/NaN/strings"
    - "Named-parameter error-propagation pattern for string-to-typed coercion helpers: coercion helpers that can throw should accept a `name: string` arg so the thrown TypedError message names WHICH param failed (mirror of the ?against pattern at dashboard-routes.ts:161-170)"
    - "Existing-test-as-regression-guard pattern for TDD: when a rewritten helper preserves a happy-path subset of the old surface (here: any non-negative integer), the existing happy-path test acts as a non-regression gate for the implementation step, and the new test block only covers the newly-added rejection surface"

key-files:
  created:
    - .planning/phases/06-dashboard-wire-quality/06-05-SUMMARY.md
  modified:
    - "src/http/dashboard-routes.ts (+14/-6 lines — qNum helper rewrite + 10 call-site updates; no other symbols touched)"
    - "src/http/__tests__/dashboard-routes.test.ts (+59 lines — new describe('qNum validation (SC-4)') block with 6 it() cases, placed between the SC-2 outputRoot-resolution block and the REPRODUCE block)"

key-decisions:
  - "`Number.isInteger(n)` is the strict-rejection primitive (not `Number.isSafeInteger(n)`): IN-01's audit concern is negatives + non-integer floats + non-numeric, not integer-overflow-past-MAX_SAFE_INTEGER. MAX_SAFE_INTEGER is 2^53-1 ≈ 9e15 — practically unreachable via pagination query params, and SQLite's INTEGER column type handles the range natively. isInteger() is the minimum-change, maximum-signal choice. A future DoS-hardening pass (e.g. explicit `n > 10000` cap) is marked out of scope in the plan's threat_model T-06-05-02."
  - "Hint string 'Use a positive integer like ?limit=20' is intentionally permissive about '0': 0 is a valid non-negative integer per the spec and the boundary test in Task 2 asserts it; the hint uses 'positive' as colloquial shorthand because 'Use a non-negative integer like ?limit=20' reads awkwardly and the error message itself says 'non-negative integer'. The hint is a suggestion, the message is the spec."
  - "All 10 call-site updates landed in Task 1's single commit alongside the helper rewrite — not split into a separate refactor commit. Rationale: the signature change and the call-site updates are a single atomic tsc-green unit; landing them separately would make Task 1's intermediate state tsc-red (10 compile errors on the unused third parameter demand) and violate the atomic-commit rule."
  - "Existing test 'parses limit/offset query params' (dashboard-routes.test.ts:95-99) was NOT modified — `5` and `10` are valid non-negative integers, so the assertion `engine.calls contains listWorkspaces([5, 10])` passes unchanged. This satisfies the TDD non-regression gate for Task 1 without requiring a pre-implementation RED commit (same pragmatic TDD pattern 06-03 used)."
  - "Named-arg propagation test uses `?offset=-5` (not `?offset=-1`): -5 is distinct from -1 across the test outputs and avoids any accidental off-by-one collision with other tests in the file that happen to use -1. Purely a test-readability choice; contract is the same."

patterns-established:
  - "Strict-integer-at-boundary pattern: for every numeric query/path param parsed from HTTP, use Number.isInteger(n) && n >= 0 (or explicit lower-bound) + TypedError('INVALID_INPUT', ...) with a `name`-bearing message. DO NOT let SQLite silently clamp — that converts garbage-in into success-with-empty-results, which is indistinguishable from 'the page really is empty' on the client side."
  - "Named-coercion-helper pattern: any helper that can throw INVALID_INPUT during string→typed coercion MUST accept the param name as a string argument; error messages that don't name the field are un-debuggable in logs when 5+ params come through the same helper."
  - "Existing-test regression gate for TDD-tagged implementation tasks: if a rewrite's happy-path surface is a strict subset of the old surface's happy-path (e.g. 'any non-negative integer' is a subset of 'any finite number'), the existing happy-path test IS the non-regression gate. No need for a separate RED-first commit — the plan's behavior contract and the existing test together define the gate."

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-04-24
---

# Phase 06 Plan 05: qNum Strict Integer Validation (SC-4 / IN-01) Summary

**`qNum(raw, fallback, name)` now rejects negatives, non-integer floats, and non-numeric strings with HTTP 400 + `{ error: { code: 'INVALID_INPUT', message: "Query parameter '<name>' must be a non-negative integer (got '<raw>')" } }` at the HTTP boundary — SQLite no longer silently clamps bad pagination input into success-with-empty-results.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-24T15:47:39Z
- **Completed:** 2026-04-24T15:51:11Z
- **Tasks:** 2 (both TDD-tagged; Task 1 relies on the existing `parses limit/offset query params` test at dashboard-routes.test.ts:95-99 as the regression gate, Task 2 adds the +6 SC-4 surface tests)
- **Files modified:** 2 (1 production, 1 test)
- **Files created:** 1 (SUMMARY.md)

## Accomplishments

- Closed audit item IN-01 (STATE.md Phase 6 gap_closure): the `qNum` helper in `src/http/dashboard-routes.ts:87-104` now rejects negative values (`?limit=-1`), non-integer floats (`?limit=1.5`), and non-numeric strings (`?limit=foo`) with HTTP 400 + `{ error: { code: 'INVALID_INPUT', message: ... } }` envelope BEFORE the engine layer is called. The previous `Number.isFinite(n)` check admitted all of these, then SQLite's LIMIT/OFFSET clauses silently clamped the value at the statement boundary, producing success-with-empty-results responses that were indistinguishable from genuinely-empty pages on the client side.
- Widened the `qNum` signature from `(raw, fallback)` to `(raw, fallback, name)` — the third `name: string` argument is named in the thrown TypedError's `message` ("Query parameter '`<name>`' must be a non-negative integer") so callers can see WHICH param failed. Tested directly via the `?offset=-5 → message contains 'offset'` assertion.
- Updated every one of the 10 existing call sites across 5 list routes (`/api/workspaces`, `/api/workspaces/:id/projects`, `/api/projects/:id/sequences`, `/api/sequences/:id/shots`, `/api/shots/:id/versions`) to pass the string-literal param name. Signature change is tsc-enforced — future list routes cannot accidentally omit the third arg.
- Added a new `describe('qNum validation (SC-4)')` block with 6 it() cases: 3 rejection cases (negative/float/non-numeric), 1 name-propagation case, 2 happy-path guards (absent param → fallback preserved; `?limit=0&offset=0` → 200 with zero as a valid non-negative integer). All 6 pass green against Task 1's implementation.

## Task Commits

Both tasks landed atomically on the worktree branch:

1. **Task 1 — qNum helper rewrite + call-site updates** — `8203af4` (feat)
   - `feat(06-05): qNum throws INVALID_INPUT on negatives/floats/non-numeric (SC-4 IN-01)`
   - Files: `src/http/dashboard-routes.ts` (+14/-6 lines)
2. **Task 2 — SC-4 test block** — `d4a0f3e` (test)
   - `test(06-05): add SC-4 qNum validation test block (6 cases)`
   - Files: `src/http/__tests__/dashboard-routes.test.ts` (+59 lines)

_No REFACTOR commits — both changes were single-pass minimal and required no cleanup._

## Files Created/Modified

**Production code:**
- `src/http/dashboard-routes.ts` — Two changes in one edit: (1) the helper at the prior line 86-92 (2-arg lax check) is replaced by an 11-line helper (lines 87-104) with strict `Number.isInteger(n) && n >= 0` guard + `throw new TypedError('INVALID_INPUT', ...)` with param name in the message; (2) all 10 existing `qNum(c.req.query('<param>'), <default>)` call sites are updated to pass the literal `'<param>'` as a third argument. The helper docstring cites both the SC-4 / IN-01 linkage and the `RESEARCH.md §Pitfall 4` absent-vs-present-but-bad split. No other symbols in the file were touched — EngineForDashboard Pick untouched, output route (Plan 06-03's work) untouched, existing /diff `INVALID_INPUT` throw pattern untouched (it's now structurally mirrored by the qNum thrower, not replaced).

**Tests:**
- `src/http/__tests__/dashboard-routes.test.ts` — Added a new `describe('qNum validation (SC-4)')` block between the Plan 06-03 SC-2 block (ends at `line ~578`) and the REPRODUCE block. The 6 it() cases follow the exact analog of the existing `returns 400 INVALID_INPUT when ?against is missing` test at line ~295 (same `app.request()` call shape, same `body.error.code` assertion). No existing test modified — 38 prior dashboard-route tests continue to pass, now 44 total (38 + 6).

## Decisions Made

- **`Number.isInteger(n)` over `Number.isSafeInteger(n)`:** IN-01's audit concern is the narrow rejection set (negatives + non-integer floats + non-numeric strings), not integer overflow past `Number.MAX_SAFE_INTEGER` (2^53−1). `MAX_SAFE_INTEGER ≈ 9e15` is practically unreachable via a pagination query param, and SQLite's `INTEGER` column type handles the positive-integer range natively. The plan's threat_model T-06-05-02 explicitly marks any explicit upper bound (e.g. `n > 10000`) as out of scope; `isInteger()` is the minimum-change, maximum-signal choice.
- **Hint string uses 'positive integer' as colloquial shorthand:** The error message is precise ("non-negative integer"), but the hint ("Use a positive integer like ?limit=20") uses 'positive' in the loose sense. 0 is a valid non-negative integer — the boundary test `?limit=0&offset=0 → 200` asserts this. The hint is a suggestion, not a spec; the message is the spec.
- **All 10 call-site updates landed in Task 1's single commit:** The signature change and the call-site updates are a single atomic tsc-green unit. Landing the helper change first and the call-site sweep second would make the intermediate state tsc-red (10 errors: `Expected 3 arguments, but got 2`) and break the atomic-commit-gate rule.
- **Existing `parses limit/offset query params` test NOT modified:** The assertion `engine.calls contains listWorkspaces([5, 10])` passes unchanged because `5` and `10` are valid non-negative integers. This preserves the TDD non-regression gate without requiring a separate pre-implementation RED commit — same pragmatic TDD pattern Plan 06-03 used (`feat → test` ordering with existing tests as the regression guard for the implementation step).
- **Named-arg propagation test uses `?offset=-5` (not `?offset=-1`):** −5 is distinct from −1 across the test file and avoids any accidental off-by-one collision with other tests that happen to use −1. Purely a test-readability choice; the contract is the same.

## Deviations from Plan

None — plan executed exactly as written. Task 1 action (Step A rewrite + Step B 10-call-site sweep + verification grep) and Task 2 action (6 it() cases in a new describe block, placed after the SC-2 block) landed line-for-line per the plan's `<action>` descriptions. All 11 acceptance criteria across both tasks pass their grep + test checks.

## Issues Encountered

No unexpected issues. The baseline was clean (tsc green, 729/731 full suite pre-change per 06-03 SUMMARY, 38/38 on the target dashboard-routes suite). Post-change: tsc still green, full suite now 735/737 (2 skipped) — exactly +6 for the new SC-4 it() cases, no regressions anywhere.

## User Setup Required

None — no external service configuration required.

## Next Wave Readiness

- Wave 3 is this plan (06-05) as the sole wave-3 member — no sibling coordination needed.
- The fix is confined to the HTTP-boundary validation path; no engine-surface change, no schema change, no test-utility change. Plan 06-06 (Wave 4) and Plan 06-07 (Wave 4) — which cover SSE and dashboard-side normalizeStatus — are unaffected.
- The plan's threat_model register notes T-06-05-04 (repudiation: bad requests not logged) as `accept`/out-of-scope — whether Hono's logger middleware picks up 400 responses is a server.ts-level concern unchanged by this plan.

## Self-Check: PASSED

- FOUND: `src/http/dashboard-routes.ts:93` — `const qNum = (raw: string | undefined, fallback: number, name: string)`
- FOUND: `src/http/dashboard-routes.ts:96-101` — `if (!Number.isInteger(n) || n < 0) { throw new TypedError('INVALID_INPUT', ...`
- FOUND: `src/http/dashboard-routes.ts:87` — `// SC-4 (Phase 6 gap_closure IN-01):`
- FOUND: 10 call sites at lines 108/109/118/119/129/130/140/141/151/152 — all have the third string-literal arg (regex `qNum\(c\.req\.query\('[^']*'\), [0-9]*, '[^']*'\)` matches exactly 10 times)
- FOUND: 0 call sites missing the third arg (regex `qNum\(c\.req\.query\('[^']*'\), [0-9]+\)` matches 0 times)
- FOUND: `src/http/__tests__/dashboard-routes.test.ts` — `describe('qNum validation (SC-4)', ...)` block exists with 6 it() cases
- FOUND: SC-4 test rejection patterns: `limit=-1` + `limit=1.5` + `limit=foo` all present, `non-negative integer` regex-match assertion appears 4 times (3 rejection tests + 1 name-propagation test)
- FOUND: Name-propagation assertion: `offset=-5` + `toContain('offset')` both present
- FOUND commit `8203af4` in `git log` (Task 1 feat)
- FOUND commit `d4a0f3e` in `git log` (Task 2 test)
- FOUND: target test suite passes 44/44 (`npx vitest run src/http/__tests__/dashboard-routes.test.ts`)
- FOUND: full server suite passes 735/737 (2 skipped, 0 failed)
- FOUND: `npx tsc --noEmit` is green (exit 0)

## TDD Gate Compliance

Plan 06-05 uses the same pragmatic 2-task TDD layout as Plan 06-03: Task 1 implements the surface change while the existing happy-path test (`parses limit/offset query params` at `dashboard-routes.test.ts:95-99`) acts as the non-regression gate (5 and 10 are valid non-negative integers, so the test passes unchanged against the new helper). Task 2 then adds the 6 SC-4 tests that exercise the NEW behavior (negative/float/non-numeric rejection + name propagation + zero-boundary happy path).

- Task 1: `feat(06-05)` commit `8203af4` — qNum rewritten + 10 call sites updated; 38 pre-existing dashboard-route tests stayed green as the regression guard.
- Task 2: `test(06-05)` commit `d4a0f3e` — 6 new SC-4 tests landed and pass green against Task 1's surface; full suite 735/737.

Gate sequence in git log: `feat(06-05)` → `test(06-05)`. This ordering matches the plan's task ordering (Task 1 before Task 2) and the 06-03 precedent. A pure RED-first sequence would have been possible (commit `test(06-05)` first with the 3 rejection cases failing against the old lax-isFinite helper, then `feat(06-05)` to fix) but the plan's action text explicitly orders implementation → tests, and the existing `?limit=5&offset=10` test provides the non-regression floor for the implementation step. No REFACTOR commits — both changes are single-pass minimal.

---
*Phase: 06-dashboard-wire-quality*
*Completed: 2026-04-24*
