---
phase: 07-comfyui-endpoint-reconciliation
plan: 02
subsystem: comfyui-client
tags: [phase-07, healthcheck, endpoint-reconciliation, error-taxonomy, comfyui-client]

# Dependency graph
requires:
  - phase: 07-01
    provides: "Authoritative (base, path) winner locked by probe matrix — DEFAULT_COMFYUI_API_BASE=https://cloud.comfy.org + HEALTHCHECK_PATH=/api/system_stats substituted verbatim into Plan 02 code"
  - phase: 02-comfyui-generation
    provides: "ComfyUIClient class shape (fetchImpl injection seam, scrubAndTruncate helper, manual-redirect X-API-Key leakage gate); TypedError + ErrorCode union infrastructure; D-GEN-40 typed-error family"
provides:
  - "COMFYUI_ENDPOINT_DRIFT literal in ErrorCode union (src/engine/errors.ts) — joins D-GEN-40 family per D-EP-08"
  - "export const HEALTHCHECK_PATH = '/api/system_stats' in src/comfyui/client.ts — shared constant that Plan 05 (sentinel test) consumes verbatim (D-EP-14)"
  - "ComfyUIClient.ensureEndpointHealthy() private method — Promise-memoized first-submit healthcheck (D-EP-07) with race-safe concurrent-submit handling (D-EP-10) and actionable hint naming the probe script (D-EP-08)"
  - "submit() first-line wire-up — await this.ensureEndpointHealthy() fires exactly once per ComfyUIClient instance for process lifetime on success; resets to null on failure so later submit can retry"
  - "Test helper evolution — mockFetch auto-intercepts the healthcheck GET so existing 49 tests pass without per-case retrofits; mockFetchRaw escape hatch reserved for Plan 04 DRIFT coverage"
affects: [07-04, 07-05, 07-06, comfyui-client, live-smoke, endpoint-probe-sentinel, generation-tool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Promise-as-cache memoization for instance-level lazy initialization (healthCheckResult: Promise<void> | null) — race-safe for concurrent first-submit callers; null-on-failure enables retry after env edit"
    - "D-EP-14 shared-constant pattern — HEALTHCHECK_PATH exported so runtime healthcheck and sentinel test point at the exact same string (one source of truth)"
    - "Auto-healthcheck mockFetch wrapper — intercepts GET HEALTHCHECK_PATH → 200, delegates everything else to the user-supplied handler; preserves existing test semantics without per-case retrofit"
    - "TypedError(code, message, hint) three-arg form with actionable hint for operator-recoverable errors — mirrors existing COMFYUI_RATE_LIMITED pattern (D-EP-08)"

key-files:
  created: []
  modified:
    - "src/engine/errors.ts (Task 1, commit afead5c) — +3/-1: add COMFYUI_ENDPOINT_DRIFT to ErrorCode union, move terminator semicolon from OUTPUT_UNAVAILABLE"
    - "src/comfyui/client.ts (Task 2, commit 7d34586) — +76/-0: HEALTHCHECK_PATH export, healthCheckResult private field, ensureEndpointHealthy() method, submit() wire-up, JSDoc audit-trail line on DEFAULT_COMFYUI_API_BASE"
    - "src/comfyui/__tests__/client.test.ts (Task 2, commit 7d34586) — +58/-0: mockFetch auto-healthcheck wrapper + mockFetchRaw escape hatch + HEALTHCHECK_PATH import"

key-decisions:
  - "HEALTHCHECK_PATH = '/api/system_stats' (not '/api/queue' per original D-EP-07 sketch) — Plan 01 probe matrix forced the revision because /api/queue + /api/history 401 with the SAME key that /api/system_stats accepts with 200 on cloud.comfy.org. Auth-method-per-endpoint quirk captured as in-code JSDoc note on the HEALTHCHECK_PATH export so future maintainers don't naively switch back to /api/queue."
  - "DEFAULT_COMFYUI_API_BASE value unchanged (still https://cloud.comfy.org) — probe confirmed this was already correct. JSDoc updated with @since 2026-04-24 (Phase 7, D-EP-06) line to create an in-code audit trail even though the literal value did not change. Satisfies SC-1 code-side lock."
  - "Promise-as-cache (not boolean) for healthCheckResult — concurrent first-submit callers share one in-flight Promise; on failure reset to null so a later submit can retry after an operator .env edit. Per Pitfall 2 in 07-RESEARCH.md — standard promise-memoization anti-pattern avoided."
  - "Failure path throws COMFYUI_ENDPOINT_DRIFT (not COMFYUI_API_ERROR) so drift is surfaceable distinct from transient upstream errors — joins D-GEN-40 typed-error family with actionable hint naming scripts/probe-comfy-endpoint.mts and .env COMFYUI_API_BASE per D-EP-08."
  - "Auto-healthcheck wrapper inside mockFetch (not a per-test opt-in) — preserves existing 49 tests' semantics with zero per-case retrofit. mockFetchRaw escape hatch is reserved for Plan 04 which must drive DRIFT paths directly."

patterns-established:
  - "D-EP-07 first-submit healthcheck seam — await this.ensureEndpointHealthy() as FIRST line of any ComfyUI-facing method that consumes credits / queues work. Not wired to status() or download() per D-EP-07 explicit scope (drift on those paths surfaces as COMFYUI_API_ERROR, acceptable)"
  - "Shared constant export for multi-consumer paths — when runtime code and sentinel/probe tests must agree on a literal, export it as a named module-level const with JSDoc citing the source-of-truth (probe winner, D-EP-14). Plan 05 sentinel imports HEALTHCHECK_PATH directly (no hardcoding)"
  - "Test-fixture co-evolution with new invariants — when a new code invariant (healthcheck GET before every submit) would break existing tests wholesale, add the invariant handling INSIDE the shared test helper (mockFetch) rather than retrofitting every test case. Keeps test intent unchanged"

requirements-completed: []

# Metrics
duration: ~4min (both tasks, including mockFetch wrapper fix for 7 existing tests)
completed: 2026-04-24
---

# Phase 7 Plan 02: Client Healthcheck + Error Taxonomy Summary

**Wired the first-submit healthcheck (D-EP-07) into ComfyUIClient.submit() with Promise-memoized race-safe caching, added HEALTHCHECK_PATH shared constant (D-EP-14), appended COMFYUI_ENDPOINT_DRIFT to the ErrorCode union (D-EP-08), and locked the DEFAULT_COMFYUI_API_BASE audit trail — all backed by the Plan 01 probe matrix that identified /api/system_stats as the ONLY path on cloud.comfy.org that authenticates with the current key format.**

## Performance

- **Duration:** ~4 min (~3 min coding + ~1 min auto-fix for 7 retrofit-needed existing tests)
- **Completed:** 2026-04-24
- **Tasks:** 2 (both `type="auto"`; no checkpoints)
- **Files created:** 0
- **Files modified:** 3 (src/engine/errors.ts, src/comfyui/client.ts, src/comfyui/__tests__/client.test.ts)
- **New untracked generated files:** 0
- **Self-check files present:** SUMMARY.md this file

## Accomplishments

- **ErrorCode union extended** — `COMFYUI_ENDPOINT_DRIFT` added to `src/engine/errors.ts` with a `// Phase 7 — endpoint reconciliation (D-EP-08)` comment header, following the existing phase-grouping convention (NOT alphabetical). Terminator semicolon moved from `'OUTPUT_UNAVAILABLE'` to the new entry cleanly — TypeScript `--noEmit` exits 0 across all consumers (tool envelopes, Zod rewrap, error-wrapping tests).
- **HEALTHCHECK_PATH exported** as a module-level constant in `src/comfyui/client.ts` — value `/api/system_stats` (Plan 01 probe winner). JSDoc block captures the auth-method-per-endpoint quirk observed in Plan 01 so future maintainers understand why `/api/queue` is NOT a drop-in alternative even though it's a documented ComfyUI Cloud endpoint.
- **ensureEndpointHealthy() private method** added per the 07-RESEARCH.md code sketch (lines 197-234 verbatim). Promise-memoized via `healthCheckResult: Promise<void> | null` instance field, race-safe for concurrent first-submit callers, failure resets cache to null enabling `.env` edit + retry flow. `redirect: 'manual'` maintained (matches submit/status/download) to prevent X-API-Key leakage on drifted/hostile redirects.
- **submit() wire-up** — single new line `await this.ensureEndpointHealthy();` as the first statement of `submit()`, per D-EP-07 lazy-invocation semantics. Not wired to `status()` or `download()` per the explicit scope lock in D-EP-07.
- **DEFAULT_COMFYUI_API_BASE audit trail** — value unchanged (still `https://cloud.comfy.org`, already correct per Plan 01 probe) but JSDoc block updated with `@since 2026-04-24 (Phase 7, D-EP-06)` citing the probe script. Satisfies SC-1 code-side lock.
- **Test-helper evolution** — `mockFetch` in `client.test.ts` transparently intercepts GET `HEALTHCHECK_PATH` → 200 and delegates every other call to the user handler. Preserves all 49 existing test semantics (submit 429, 302, 500, network errors, IS-03/IS-04 scrubbing, etc.) with zero per-case retrofit. A new `mockFetchRaw` escape hatch is exposed for Plan 04's DRIFT test coverage.
- **Regression baseline held** — full `npx vitest run` reports **735 passed / 2 skipped** (same as Plan 01 research baseline). `npx tsc --noEmit` exits 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Append COMFYUI_ENDPOINT_DRIFT to ErrorCode union** — `afead5c` (feat)
2. **Task 2: HEALTHCHECK_PATH + ensureEndpointHealthy() + submit() wire-up + test helper patch** — `7d34586` (feat)

**Plan metadata:** this SUMMARY commit (docs) — created after both task commits land.

## Files Created/Modified

### Created

None.

### Modified

- `src/engine/errors.ts` — +3/-1 lines. Append `'COMFYUI_ENDPOINT_DRIFT'` as the new union terminator; move trailing semicolon from `'OUTPUT_UNAVAILABLE'`; add `// Phase 7 — endpoint reconciliation (D-EP-08)` comment header matching the existing phase-grouping convention.
- `src/comfyui/client.ts` — +76 lines (net insert). Three insertions: (1) `@since 2026-04-24 (Phase 7, D-EP-06)` JSDoc line on `DEFAULT_COMFYUI_API_BASE`; (2) new `HEALTHCHECK_PATH` export with JSDoc citing D-EP-14 and auth-method-per-endpoint quirk; (3) new `healthCheckResult` private field with JSDoc citing D-EP-07; (4) new `ensureEndpointHealthy()` private method (39 LOC including JSDoc); (5) one-line `await this.ensureEndpointHealthy();` insertion at the top of `submit()` with 3-line comment citing D-EP-07 + D-GEN-41. No existing method body touched; `scrubAndTruncate`, `DEFAULT_ALLOWED_HOST_PATTERNS`, `status()`, `download()`, `downloadToPath()`, `fetchResolvedPrompt()` all unchanged.
- `src/comfyui/__tests__/client.test.ts` — +58 lines. Add `HEALTHCHECK_PATH` to the existing import from `../client.js`. Rewrite `mockFetch` helper as a wrapper that intercepts GET `HEALTHCHECK_PATH` → 200-with-`{}`-body and delegates all other calls to the user handler (preserves every existing test's intent). Add new `mockFetchRaw` helper that does NO interception, reserved for Plan 04's DRIFT coverage.

## Locked Values (for Plans 03 + 05 consumers)

| Constant                       | Value                        | Site                                            | Consumer                                   |
| ------------------------------ | ---------------------------- | ----------------------------------------------- | ------------------------------------------ |
| `DEFAULT_COMFYUI_API_BASE`     | `https://cloud.comfy.org`    | `src/comfyui/client.ts:36`                      | Plan 03 (`.env` + `.env.example` writes)   |
| `HEALTHCHECK_PATH`             | `/api/system_stats`          | `src/comfyui/client.ts:51` (exported)           | Plan 05 (sentinel test imports verbatim)   |
| ErrorCode `COMFYUI_ENDPOINT_DRIFT` | literal type   | `src/engine/errors.ts:37`                       | Plan 04 (new DRIFT unit tests)             |

Plan 03 and Plan 05 MUST import these by name (no re-derivation). Plan 04 extends `client.test.ts` using `mockFetchRaw` to drive DRIFT paths directly.

## Verification

Plan `<verify>` assertions (all green):

| Task | Assertion | Result |
| ---- | --------- | ------ |
| T1 | `grep -q "'COMFYUI_ENDPOINT_DRIFT'" src/engine/errors.ts` | OK |
| T1 | `grep -q "// Phase 7 — endpoint reconciliation (D-EP-08)" src/engine/errors.ts` | OK |
| T1 | `! grep -q "'OUTPUT_UNAVAILABLE';$" src/engine/errors.ts` | OK |
| T1 | `grep -q "'COMFYUI_ENDPOINT_DRIFT';$" src/engine/errors.ts` | OK |
| T1 | `npx tsc --noEmit` exits 0 | OK |
| T2 | `grep -q '^export const DEFAULT_COMFYUI_API_BASE = ' src/comfyui/client.ts` | OK |
| T2 | `grep -q '^export const HEALTHCHECK_PATH = ' src/comfyui/client.ts` | OK |
| T2 | `grep -q 'private healthCheckResult: Promise<void> \| null = null;' src/comfyui/client.ts` | OK |
| T2 | `grep -q 'private async ensureEndpointHealthy' src/comfyui/client.ts` | OK |
| T2 | `grep -q 'await this.ensureEndpointHealthy()' src/comfyui/client.ts` | OK |
| T2 | `grep -q "'COMFYUI_ENDPOINT_DRIFT'" src/comfyui/client.ts` | OK |
| T2 | `grep -q 'scripts/probe-comfy-endpoint.mts' src/comfyui/client.ts` (hint names probe script) | OK |
| T2 | `npx tsc --noEmit` exits 0 | OK |
| Plan | `grep -c "redirect: 'manual'" src/comfyui/client.ts` ≥ 4 | 6 (exceeds threshold — submit, status, download first-hop, download second-hop, ensureEndpointHealthy, AND the download-second-hop's SSRF comment block) |
| Plan | `npx vitest run src/comfyui/__tests__/` | 111 passed / 2 skipped (client + format + live-smoke gate + png-metadata) |
| Plan | `npx vitest run src/__tests__/architecture-purity.test.ts` | passed (no new MCP/DB imports in src/comfyui/) |
| Plan | `npx vitest run src/__tests__/stdio-hygiene.test.ts` | passed (healthcheck does not alter boot behavior) |
| Plan | `npx vitest run` (full suite) | 735 passed / 2 skipped — baseline match |

## Decisions Made

- **HEALTHCHECK_PATH locked to `/api/system_stats`, not `/api/queue`.** The original D-EP-07 sketch (07-RESEARCH.md §Healthcheck Implementation Sketch) suggested `/api/queue` as the canonical candidate because it's documented, read-only, cheap, and returns JSON. The Plan 01 probe matrix forced the revision: on `cloud.comfy.org` the SAME X-API-Key that authenticates against `/api/system_stats` (200) is rejected by `/api/queue` (401 "invalid API key") and `/api/history` (401 "authentication method not allowed"). If the healthcheck had shipped against `/api/queue`, every submit would throw `COMFYUI_ENDPOINT_DRIFT` spuriously — breaking the phase's own SC-2. The auth-method-per-endpoint quirk is captured in an in-code JSDoc note on `HEALTHCHECK_PATH` so future maintainers understand the non-obvious path choice.
- **DEFAULT_COMFYUI_API_BASE value NOT changed.** Plan 01 probe confirmed `https://cloud.comfy.org` was already correct — the drift memory's 2026-04-22 observation was a key-vs-endpoint-path mismatch, not a host-level drift. JSDoc updated with `@since 2026-04-24 (Phase 7, D-EP-06) — value confirmed by scripts/probe-comfy-endpoint.mts winner` to create an audit trail even when the literal value does not change. Plan prescribed this exact behavior in Step 2 ("If `<WINNING_BASE>` equals the prior value, still make this JSDoc edit so the audit trail exists").
- **Test helper evolution over test-by-test retrofit.** The plan's `<done>` criteria stated "Existing tests still pass (run `npx vitest run src/comfyui/__tests__/client.test.ts` — should still be green because existing submit tests use `fetchImpl` that returns 200 on every call, which the new healthcheck happily accepts)." That premise turned out to be optimistic: 7 of the 49 existing tests exercise non-200 paths (302 redirect, 429, 400-with-node_errors, 500, network errors, IS-04 scrub) by returning those statuses from every `fetchImpl` call — so the new healthcheck GET (which runs BEFORE the POST submit) consumed the first mocked response and threw `COMFYUI_ENDPOINT_DRIFT` before the test's intended code path executed. Rather than retrofit every one of those 7 tests individually, I updated the shared `mockFetch` helper to transparently pre-route GET `HEALTHCHECK_PATH` to 200 and delegate everything else. This keeps every existing test's intent unchanged (they assert on submit-time errors, which is still what they test) while making the new healthcheck invariant invisible to their mocks. A new `mockFetchRaw` escape hatch is reserved for Plan 04 which WILL need to observe and drive the healthcheck GET directly.
- **No new imports; no TypedError class change.** Per plan Step 9, `TypedError` is already imported at `src/comfyui/client.ts:2` and the three-arg constructor `(code, message, hint?)` already supports every new throw site. Zero wiring beyond the union-literal addition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated mockFetch helper to transparently handle new healthcheck GET**

- **Found during:** Task 2 post-change `npx vitest run src/comfyui/__tests__/client.test.ts`.
- **Issue:** 7 of 49 existing tests failed because their `fetchImpl` mocks return the test-specific non-200 response on EVERY call. After the new `ensureEndpointHealthy()` wire-up, the FIRST call from any `submit()` is now the healthcheck GET — which consumed the mock's non-200 response and threw `COMFYUI_ENDPOINT_DRIFT` before the test-intended code path ran. Failing tests: `429 surfaces COMFYUI_RATE_LIMITED`, `4xx with node_errors flattens`, `500 falls through`, `IS-04 API-key scrub`, `IS-03 error-body read cap`, `C4 redirect:manual 302 reject`, `IT-02 submit network error`.
- **Fix:** Updated the shared `mockFetch` helper in `src/comfyui/__tests__/client.test.ts` to transparently intercept GET requests to `HEALTHCHECK_PATH` → return 200 with `{}` body; delegate all other requests to the user handler. Added a new `mockFetchRaw` escape hatch with no interception, reserved for Plan 04 which needs to observe/drive the healthcheck GET directly. No existing test case bodies were modified.
- **Files modified:** `src/comfyui/__tests__/client.test.ts` (+58 lines — helper rewrite + new mockFetchRaw + HEALTHCHECK_PATH import).
- **Commit:** `7d34586` (bundled with Task 2).
- **Why Rule 3 (Blocking) not Rule 1 (Bug):** The 7 failing tests were NOT buggy before this plan — they correctly asserted pre-healthcheck behavior against a single-call `fetchImpl`. They broke because the current task introduced a new invariant (healthcheck GET before submit) that their mocks didn't anticipate. The plan's `<done>` criterion "Existing tests still pass" required this fix to achieve green. Per Rule 3: "Something prevents completing current task" — auto-fix without user permission.

### Plan-driven / expected findings (not deviations)

None — both tasks matched the plan's prescriptions verbatim except for the one Rule 3 auto-fix noted above.

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking — test helper retrofit for new healthcheck invariant)
**Impact on plan:** Zero scope creep. The fix preserves all 49 existing tests' original intent and leaves a named escape hatch (`mockFetchRaw`) for Plan 04's DRIFT coverage.

## Issues Encountered

**1. Plan's `<done>` premise was optimistic (captured above as Rule 3 deviation)**

- **What:** The plan stated existing tests would pass unchanged because they "return 200 on every call." 7 of 49 tests return non-200 on every call by design (they exercise error paths).
- **Why this matters:** A naive execution would have either (a) skipped the Rule 3 auto-fix and left 7 tests red, violating the plan's own `<done>` criterion, or (b) retrofitted 7 test cases individually (verbose + brittle). The helper-level fix is narrowest and preserves test intent.
- **Resolution:** mockFetch wrapper handles the new invariant transparently; mockFetchRaw escape hatch reserved for Plan 04.
- **Follow-up:** Plan 04 should use `mockFetchRaw` for every DRIFT test case (including the 4 listed in 07-VALIDATION.md: success-cache-hit-on-second-submit, failure-throws-DRIFT-with-hint, concurrent-submits-memoize-one-healthcheck, failure-does-not-poison-cache-new-instance-can-recover).

## Success Criteria Status

- **SC-1 (DEFAULT_COMFYUI_API_BASE locked to probe winner; HEALTHCHECK_PATH exported):** ✅ code-side lock complete. Value unchanged (`https://cloud.comfy.org`) with audit-trail JSDoc. `HEALTHCHECK_PATH = '/api/system_stats'` exported for Plan 05 consumption. Env-side lock is Plan 03.
- **SC-2 (First-submit healthcheck fires exactly once per instance; throws COMFYUI_ENDPOINT_DRIFT on failure):** ✅ infrastructure complete. `ensureEndpointHealthy()` method exists, Promise-memoized, race-safe, failure resets cache, actionable hint names probe script. Test coverage of the 4 DRIFT scenarios is Plan 04; live-smoke gate is Plan 06.

## User Setup Required

None — no external service configuration introduced by this plan. Consumers (Plans 03, 04, 05) pick up the new exports automatically.

## Next Phase Readiness

- **Plan 07-03 (Wave 2, `.env` + `.env.example` updates) unblocked.** Consumes `DEFAULT_COMFYUI_API_BASE=https://cloud.comfy.org`. No code changes blocking it.
- **Plan 07-04 (Wave 2, DRIFT unit tests) unblocked.** Consumes `COMFYUI_ENDPOINT_DRIFT`, `HEALTHCHECK_PATH`, and `mockFetchRaw` helper. 4 test cases specified in 07-VALIDATION.md.
- **Plan 07-05 (Wave 3, sentinel test) unblocked.** Imports `HEALTHCHECK_PATH` and `DEFAULT_COMFYUI_API_BASE` verbatim from `../client.js`.
- **Plan 07-06 (Wave 4, live-smoke end-to-end) unblocked.** Healthcheck fires on first submit against the real `/api/system_stats` endpoint — probe confirmed 200, so live-smoke's first submit should pass the healthcheck cleanly.
- **No blockers.** All three remaining waves can proceed as planned.

## Self-Check

- [x] `src/engine/errors.ts` contains `'COMFYUI_ENDPOINT_DRIFT'` as the new union terminator (verified with grep)
- [x] `src/engine/errors.ts` has `// Phase 7 — endpoint reconciliation (D-EP-08)` comment (verified with grep)
- [x] `src/comfyui/client.ts` exports `HEALTHCHECK_PATH = '/api/system_stats'` (verified with grep)
- [x] `src/comfyui/client.ts` `DEFAULT_COMFYUI_API_BASE` still exported; JSDoc has `@since 2026-04-24 (Phase 7, D-EP-06)` line (verified with read)
- [x] `src/comfyui/client.ts` has `private healthCheckResult: Promise<void> | null = null;` field (verified with grep)
- [x] `src/comfyui/client.ts` has `private async ensureEndpointHealthy` method (verified with grep)
- [x] `submit()` awaits `ensureEndpointHealthy()` as its first statement (verified with grep)
- [x] `status()` and `download()` NOT modified (verified by diff — zero line changes outside submit + new method + field insertion)
- [x] `npx tsc --noEmit` exits 0 (verified)
- [x] Task 1 commit `afead5c` in `git log --oneline` (verified)
- [x] Task 2 commit `7d34586` in `git log --oneline` (verified)
- [x] `redirect: 'manual'` count in client.ts ≥ 4 (6 occurrences — submit, status, download hop-1, download hop-2, ensureEndpointHealthy, and the second-hop SSRF commentary — verified with grep -c)
- [x] Existing client.test.ts suite (49 tests) all green (verified: `Test Files 1 passed (1), Tests 49 passed (49)`)
- [x] Full suite matches Plan 01 baseline (735 passed / 2 skipped — verified)
- [x] No STATE.md or ROADMAP.md edits in this plan (verified: `git show --stat` for both task commits shows only src/ file changes)
- [x] No stubs or placeholders introduced (grep scan of TODO/FIXME/placeholder/coming soon returned empty)

## Self-Check: PASSED

---
*Phase: 07-comfyui-endpoint-reconciliation*
*Plan: 02*
*Completed: 2026-04-24*
