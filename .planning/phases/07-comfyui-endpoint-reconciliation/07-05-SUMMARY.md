---
phase: 07-comfyui-endpoint-reconciliation
plan: 05
subsystem: comfyui-client
tags: [phase-07, tests, sentinel, endpoint-reconciliation, drift-detection]

# Dependency graph
requires:
  - phase: 07-02
    provides: "HEALTHCHECK_PATH export + DEFAULT_COMFYUI_API_BASE in src/comfyui/client.ts (commit 7d34586) — the two named imports the sentinel depends on"
  - phase: 02-comfyui-generation
    provides: "live-smoke.test.ts IT-19 double-opt-in gate pattern (describe.skipIf + env-var present + explicit flag) — sentinel mirrors this shape verbatim with RUN_PROBE substituted for RUN_LIVE_SMOKE"
provides:
  - "src/comfyui/__tests__/endpoint-probe.test.ts — drift sentinel test, default-skipped (D-EP-13 invariant: +1 to skipped count)"
  - "Operator command for 2-second drift check: RUN_PROBE=1 npx vitest run endpoint-probe (reuses loaded .env COMFYUI_API_KEY)"
  - "Post-plan test-count baseline: 739 passed / 3 skipped (was 2 skipped) — locks the regression gate for Phase 7 plans 06/07/08 and all future plans"
affects: [07-06, 07-07, comfyui-client, operator-diagnostics, ci-future-hook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-EP-13 sentinel-test shape — deep-shrunk live-smoke analog: one describe.skipIf, one test, one fetch, one status assertion. ~20 LOC body under a ~30-line JSDoc banner documenting the gate, the decision lineage, and the recovery runbook hook"
    - "D-EP-14 shared-constant consumption — sentinel imports HEALTHCHECK_PATH + DEFAULT_COMFYUI_API_BASE from ../client.js (NOT hardcoded) so a future Plan 02-level constant change auto-propagates to the sentinel without a second-place edit"
    - "Separate-gate-per-category — RUN_PROBE (read-only, zero credits, drift-only) distinct from RUN_LIVE_SMOKE (full round-trip, burns credits). RUN_LIVE_SMOKE=1 alone does NOT fire the sentinel — the two env flags are orthogonal by design"
    - "Single-statement test body + generous timeout — 10s outer timeout for a sub-second healthcheck gives room for cold-start network variance without false negatives; plan-prescribed verbatim"

key-files:
  created:
    - "src/comfyui/__tests__/endpoint-probe.test.ts (59 lines: ~30 lines JSDoc + ~20 LOC body) — the drift sentinel; default-skipped unless RUN_PROBE=1 + COMFYUI_API_KEY"
  modified: []

key-decisions:
  - "Verbatim adherence to plan <action> block — the sentinel content is the exact TypeScript from 07-05-PLAN.md lines 113-172 (JSDoc + imports + gate + describe.skipIf + test body), no personal-style edits. This is deliberate: Plan 02's SUMMARY locked HEALTHCHECK_PATH=/api/system_stats and DEFAULT_COMFYUI_API_BASE=https://cloud.comfy.org; Plan 05's only job is wiring the sentinel to those exports."
  - "Gate variable named SKIP_PROBE (not SKIP) to disambiguate from live-smoke's SKIP if anyone ever greps both files together — minor defense-in-depth choice called out in the plan."
  - "10s outer timeout (not 5s matching Wave 1 probe, not 30s matching live-smoke polling) — plan-prescribed. Healthcheck is fast; too-tight timeout risks false negatives on cold start, too-long timeout hides real drift."
  - "T-DRIFT-01 mitigation implemented by construction — no console.* calls in the file; apiKey is used ONLY in the headers object of the single fetch; response body is never read (only res.status is asserted). Grep-verifiable: `! grep 'console\\.' src/comfyui/__tests__/endpoint-probe.test.ts` returns true."
  - "T-DRIFT-02 mitigation implemented by construction — redirect: 'manual' on the sentinel's fetch (matches the 6 other manual-redirect sites in src/comfyui/client.ts per Plan 02 SUMMARY). A drifted base URL cannot bounce the request (with key header) to an attacker-controlled host."

patterns-established:
  - "Sentinel-test shape for future drift-detection needs — gated on a domain-specific flag (RUN_<DOMAIN>=1) + domain-specific secret env var; shares constants with the runtime code path being sentineled (HEALTHCHECK_PATH pattern); single-status assertion; deep-shrunk relative to any full round-trip test. Reusable template for future external-API sentinels (e.g., if status/download paths needed their own sentinels in v2)."

requirements-completed: []

# Metrics
duration: ~2min (1 task, type=auto, no deviations, no checkpoint)
completed: 2026-04-24
tasks: 1
files_created: 1
files_modified: 0
---

# Phase 7 Plan 05: Drift Sentinel Test Summary

**Created the D-EP-13 drift sentinel `src/comfyui/__tests__/endpoint-probe.test.ts` — a single-assertion, double-opt-in (`RUN_PROBE=1` + `COMFYUI_API_KEY`) gated test that issues one raw GET against `${apiBase}${HEALTHCHECK_PATH}` and asserts status 200, deep-shrunk from live-smoke (~315 lines → 59 lines). Post-plan test-count invariant locked: 739 passed / 3 skipped (+1 new default-skipped sentinel).**

## Performance

- **Duration:** ~2 min (single task, straight-through execution — the plan's `<action>` block specified the file contents verbatim, so execution was essentially a typed Write + run verification)
- **Completed:** 2026-04-24
- **Tasks:** 1 (type=auto; no checkpoints; no deviations)
- **Files created:** 1 (`src/comfyui/__tests__/endpoint-probe.test.ts`)
- **Files modified:** 0
- **Self-check files present:** SUMMARY.md this file

## Accomplishments

- **Sentinel file exists** at `src/comfyui/__tests__/endpoint-probe.test.ts` — 59 lines total (~30 lines JSDoc banner documenting D-EP-13 + D-EP-14 provenance, gate strategy, manual run command, and recovery-runbook link; ~20 LOC body with imports, gate constant, and one `describe.skipIf` + one `test` + one `expect(res.status).toBe(200)`).
- **Double opt-in gate** — `SKIP_PROBE = !process.env.COMFYUI_API_KEY || process.env.RUN_PROBE !== '1'` wired to `describe.skipIf(SKIP_PROBE)`. The distinct `RUN_PROBE` flag (not `RUN_LIVE_SMOKE`) matches D-EP-13 verbatim so a `RUN_LIVE_SMOKE=1 npx vitest run` does NOT also fire the sentinel — the two categories are orthogonal by design.
- **Shared-constant consumption** — sentinel imports `HEALTHCHECK_PATH` and `DEFAULT_COMFYUI_API_BASE` from `../client.js` (Plan 02 exports, commit `7d34586`). If those constants ever move or their values change, the sentinel auto-adjusts without a second-place edit (D-EP-14 contract).
- **X-API-Key leakage mitigation** — `redirect: 'manual'` on the fetch matches the 6 other manual-redirect sites in `src/comfyui/client.ts` per Plan 02. T-DRIFT-02 is mitigated by construction: a drifted base URL cannot bounce the request with its attached key header to an attacker-controlled host.
- **Zero console logging** — no `console.*` calls anywhere in the file. `apiKey` is referenced exactly once, as the value of the `'X-API-Key'` header in the request object. T-DRIFT-01 is mitigated by construction: the key cannot leak to stdout/stderr even on test failure since nothing is logged.
- **Test-count baseline advanced** — `npx vitest run` now reports **739 passed / 3 skipped** (was 2 skipped pre-plan). Test files count went 45 passed / 1 skipped → 45 passed / 2 skipped (new file is gated-skipped under default conditions). The +1 skipped delta matches the D-EP-13 invariant specified in 07-RESEARCH.md §Test-Count Invariants lines 391-413.
- **Isolated sentinel run** — `npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts` reports `1 skipped` in 128ms (essentially zero work when no opt-in).
- **TypeScript clean** — `npx tsc --noEmit` exits 0 (no output). The named imports from `../client.js` resolve to types exported by Plan 02.

## Task Commits

One atomic commit:

1. **Task 1: Create src/comfyui/__tests__/endpoint-probe.test.ts with gated single-assertion test** — `6302a0a` (test)

**Plan metadata:** this SUMMARY commit (docs) — created after the task commit lands.

## Files Created/Modified

### Created

- `src/comfyui/__tests__/endpoint-probe.test.ts` — 59 lines.
  - Top-of-file JSDoc (~30 lines) cites D-EP-13 + D-EP-14, documents the gate strategy, explains why the sentinel exists (contrasts with runtime `ensureEndpointHealthy()` which only fires on MCP agent submits), provides the manual run command, and includes the recovery runbook pointer (run `scripts/probe-comfy-endpoint.mts` + update `.env` per 07-VERIFICATION.md §Rotation Procedure).
  - Imports `describe, test, expect` from vitest + `DEFAULT_COMFYUI_API_BASE, HEALTHCHECK_PATH` from `../client.js` (D-EP-14 shared-constant contract).
  - `SKIP_PROBE` gate constant at module scope (D-EP-13 separate-gate invariant — distinct from live-smoke's `SKIP` / `RUN_LIVE_SMOKE`).
  - One `describe.skipIf(SKIP_PROBE)('endpoint-probe sentinel (D-EP-13)', ...)` block containing one `test('healthcheck endpoint returns 200 for the current key', ...)` with a 10-second outer timeout.
  - Test body: 6 LOC (resolve `apiKey` + `apiBase`, construct `url`, issue `fetch` with `X-API-Key` header + `redirect: 'manual'`, assert `res.status === 200`).

### Modified

None. No changes to `src/comfyui/client.ts`, `src/comfyui/__tests__/client.test.ts`, `src/comfyui/__tests__/live-smoke.test.ts`, `STATE.md`, `ROADMAP.md`, or any other file.

## Verification

Plan `<verify>` one-liner assertions (all green):

| Assertion | Result |
| --------- | ------ |
| `test -f src/comfyui/__tests__/endpoint-probe.test.ts` | OK — file exists |
| `grep -q "describe.skipIf" ...` | OK — 2 hits (import-site mention in JSDoc + actual use) |
| `grep -q "RUN_PROBE" ...` | OK — 6 hits (JSDoc documentation + gate constant) |
| `grep -q "HEALTHCHECK_PATH" ...` | OK — 4 hits (JSDoc + import + URL construction) |
| `grep -q "redirect: 'manual'" ...` | OK — 1 hit (the single fetch call) |
| `! grep "console\\." ...` (T-DRIFT-01 mitigation) | OK — no console.* calls |
| `npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts` | OK — 1 skipped / 0 failed / 0 passed (default, no RUN_PROBE) |
| `npx vitest run` (full suite) | OK — **739 passed / 3 skipped** (was 2 skipped; +1 from sentinel) |
| `npx tsc --noEmit` | OK — exits 0, no output |

### Test-Count Invariant Evidence

**Pre-plan baseline** (measured by this agent before any changes):
```
 Test Files  45 passed | 1 skipped (46)
      Tests  739 passed | 2 skipped (741)
```

**Post-plan baseline** (same agent, same session, after commit `6302a0a`):
```
 Test Files  45 passed | 2 skipped (47)
      Tests  739 passed | 3 skipped (742)
```

Delta: `+0 passed`, `+1 skipped`, `+1 skipped file`. Exactly the D-EP-13 invariant.

## Decisions Made

- **Exact verbatim adherence to the plan's `<action>` block.** The plan spelled the file contents character-by-character between lines 113-172 of 07-05-PLAN.md. The executor's value-add here is zero stylistic re-authoring: Plan 02 (commit `7d34586`) already locked `HEALTHCHECK_PATH = '/api/system_stats'` and `DEFAULT_COMFYUI_API_BASE = 'https://cloud.comfy.org'`; Plan 05's only job is to connect the sentinel to those exports via named import and assert status 200 under the double-opt-in gate. No deviation needed.
- **Gate variable named `SKIP_PROBE` (not `SKIP`).** Plan-prescribed to disambiguate from live-smoke's `SKIP` if a future maintainer greps both files side-by-side. Cosmetic but per the plan's "Key adherences" §1.
- **10-second outer timeout.** Plan-prescribed. A healthcheck on a healthy endpoint returns in <1s in practice (Plan 01 probe observations); 10s is generous headroom for cold-start latency without masking real drift. Wave 1 probe script uses 5s fetch timeout internally; the sentinel's outer timeout wraps that with margin.
- **No `beforeEach` / `afterEach` / DB / Engine / ComfyUIClient setup.** The sentinel is raw-fetch against the wire — testing the wire-level endpoint contract, NOT the runtime client wiring. Keeping it narrow + fast was a plan-prescribed "Key adherence" §8. The runtime client's healthcheck already has unit coverage from Plan 04 (`client.test.ts` DRIFT scenarios, commit from Wave 2).
- **Response body is NEVER read, only `res.status` is asserted.** Plan-prescribed + T-DRIFT-01 mitigation. `res.status` flows through even on a body-read error; keeping the assertion minimal avoids flakes and any accidental surface for key leakage.

## Deviations from Plan

None. Plan executed exactly as written. No deviation rules fired (1-Bug, 2-Missing-critical, 3-Blocking, 4-Architectural).

## Auth Gates Encountered

None. The sentinel test is DEFAULT-SKIPPED in every execution context of this plan — the test body never runs under the executor's vitest invocation because `RUN_PROBE` is unset. Creating and verifying a gated-skipped test does not require a live API key. The opt-in verification ("1 passed when `RUN_PROBE=1 COMFYUI_API_KEY=<key>` are both set") is manual per the Manual-Only Verifications row in `07-VALIDATION.md` and is out of scope for an executor agent.

## Issues Encountered

None.

## Success Criteria Status

- **SC-1 (Endpoint lock + sentinel automation for drift detection):** ✅ sentinel-side complete. An operator (or future CI cron) can now run `RUN_PROBE=1 npx vitest run endpoint-probe` in ~sub-second wall time and learn whether the locked `https://cloud.comfy.org/api/system_stats` base still returns 200 for the current key. Combined with Plan 01's one-shot probe script and Plan 02's runtime healthcheck, the drift-detection seam now has three tiered tools: probe (manual, matrix-style, diagnostic) → sentinel (opt-in, 1-assertion, fast) → runtime healthcheck (automatic, throws DRIFT on first submit). Code-side + env-side + test-side locks from Plans 02 + 03 are also complete; Plan 06 (Wave 4 live-smoke) is the remaining end-to-end gate for SC-1.

## User Setup Required

None. No external service configuration introduced by this plan. A developer or CI job that wants to fire the sentinel uses their existing `.env` `COMFYUI_API_KEY` value plus a transient `RUN_PROBE=1` shell env flag — no new secrets, no new accounts.

## Next Plan Readiness

- **Plan 07-06 (Wave 4, live-smoke end-to-end) unblocked.** Plan 06 exercises the same `HEALTHCHECK_PATH + DEFAULT_COMFYUI_API_BASE + COMFYUI_API_KEY` triple that Plan 05's sentinel consumes, but under the full submit → poll → download → disk assertion. The sentinel is not a dependency of Plan 06 — it is a sibling observation surface. Both can be run in any order post-Wave 3.
- **Plan 07-07 (Wave 5, resolution doc) unblocked.** The doc's §Credential Layout section cites `RUN_PROBE=1 npx vitest run endpoint-probe` as the cheap drift-check command; Plan 05 locks that command verbatim.
- **Plan 07-08 (Wave 5, memory hygiene) unblocked.** Independent of Plan 05.
- **No blockers.** All remaining plans can proceed.

## Self-Check

- [x] `src/comfyui/__tests__/endpoint-probe.test.ts` exists (verified: `test -f` OK; `wc -l` = 59)
- [x] File contains `describe.skipIf` (verified: grep hit count = 2 — JSDoc docs + use site)
- [x] File contains `RUN_PROBE` (verified: grep hit count = 6 — documentation + gate)
- [x] File contains `HEALTHCHECK_PATH` (verified: grep hit count = 4 — JSDoc + import + URL construction)
- [x] File contains `redirect: 'manual'` (verified: grep hit count = 1)
- [x] File has NO `console.*` calls (verified: `! grep 'console\\.' ...` returns true — T-DRIFT-01 mitigation)
- [x] File imports only `describe, test, expect` from vitest (verified by read)
- [x] File imports `DEFAULT_COMFYUI_API_BASE` + `HEALTHCHECK_PATH` from `../client.js` (verified by read)
- [x] `SKIP_PROBE` gate constant uses the exact D-EP-13 double-opt-in shape (verified by read)
- [x] `describe.skipIf(SKIP_PROBE)` wraps the single test (verified by read)
- [x] Test asserts `expect(res.status).toBe(200)` exactly (verified by read)
- [x] 10-second outer timeout on the test (verified by read: `}, 10_000);`)
- [x] `npx vitest run src/comfyui/__tests__/endpoint-probe.test.ts` → 1 skipped (verified)
- [x] `npx vitest run` full suite → 739 passed / 3 skipped (verified — was 739/2)
- [x] `npx tsc --noEmit` → exit 0 (verified)
- [x] Task 1 commit `6302a0a` in `git log --oneline` (verified)
- [x] Commit stages only the new file (verified: `git status` post-add showed single staged addition)
- [x] No STATE.md or ROADMAP.md edits in this plan (verified — git diff for commit `6302a0a` shows only the new test file)
- [x] No stubs, no placeholders, no TODO/FIXME in the new file (verified by read)
- [x] Existing `live-smoke.test.ts` + `client.test.ts` untouched (verified — commit diff shows only the new file)

## Self-Check: PASSED

---
*Phase: 07-comfyui-endpoint-reconciliation*
*Plan: 05*
*Completed: 2026-04-24*
