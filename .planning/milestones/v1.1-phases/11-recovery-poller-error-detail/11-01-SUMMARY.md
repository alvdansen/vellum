---
phase: 11-recovery-poller-error-detail
plan: 01
subsystem: api
tags: [comfyui, error-handling, refactor, demo-02, node_errors, vitest]

# Dependency graph
requires:
  - phase: 02-comfyui-cloud-integration
    provides: extractFirstNodeError primitive at src/comfyui/format.ts:110 (D-GEN-27)
provides:
  - flattenComfyError(error: unknown): string single-source helper for the 3-branch ComfyUI error flatten chain
  - Submit-time 4xx branch (src/comfyui/client.ts:417-447) and recovery-poller failed branch (src/engine/generation.ts:201-209) both delegate to one shared helper — no more drift surface
  - Recovery poller now surfaces actionable node_errors detail (was generic "ComfyUI reported failed" collapse) — closes ROADMAP success criteria #1, #2, #3, #4 at the helper level
affects: [11-02-recovery-poller-error-detail, 12-reproduce-divergence-transparency]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-source-of-truth helper wraps existing primitive (extractFirstNodeError stays unchanged; flattenComfyError adds the fallback chain)"
    - "Architecture-purity preserved: src/comfyui/format.ts remains zero-MCP-imports; helper lives engine-side per D-GEN-21"

key-files:
  created: []
  modified:
    - src/comfyui/format.ts
    - src/comfyui/client.ts
    - src/engine/generation.ts
    - src/comfyui/__tests__/format.test.ts

key-decisions:
  - "flattenComfyError ALWAYS returns a non-empty string — never null, never throws — so call sites simplify from null-coalescing chains to single-line delegation."
  - "Submit-time call site treats the helper's 'ComfyUI reported failed' literal as 'no actionable detail' so 5xx / empty-body responses keep the existing 'ComfyUI request failed: {status} {statusText}' fallback. This preserves the existing client.test.ts:178 assertion shape for 500-with-no-body and matches v1.0 dashboard rendering for non-node_errors failures."
  - "extractFirstNodeError stays unchanged (returns string|null). flattenComfyError WRAPS it. No signature breakage; D-GEN-27 contract preserved verbatim."
  - "TDD discipline: 16 failing tests landed in commit 09d9f73 (RED) before commit 1168940 (GREEN) implemented the helper. Verified by re-running format.test.ts on the RED commit (16 fails / 25 passes), then GREEN commit (41 passes / 0 fails)."

patterns-established:
  - "Pattern: 3-branch error-flatten via single helper — object.node_errors → string → fallback. Reusable for any future Cloud error shape."
  - "Pattern: helper test class — branch coverage + property test (never throws, always non-empty) + IT-level regression guard test. The property test catches future shape regressions cheaply."

requirements-completed: []  # DEMO-02 is cohort-level (Plans 11-01 + 11-02). Mark complete after Plan 11-02 lands the same-fixture parity test.

# Metrics
duration: 5min
completed: 2026-04-30
---

# Phase 11 Plan 1: flattenComfyError Helper + Dual Call-Site Refactor Summary

**Single shared `flattenComfyError(error: unknown): string` helper consolidates the 3-branch ComfyUI error flatten chain (node_errors / string / fallback) across both submit-time and recovery-poller paths — eliminating the duplicated extraction shape that previously caused recovery-poller dashboard cards to collapse to "ComfyUI reported failed" when the submit path would have decoded actionable detail.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-30T08:06:01Z
- **Completed:** 2026-04-30T08:10:24Z
- **Tasks:** 2 (TDD: RED → GREEN, then refactor)
- **Files modified:** 4

## Accomplishments

- Added `flattenComfyError` exported from `src/comfyui/format.ts:145` — the single source of truth for the 3-branch flatten chain (`node_errors` object → string → `'ComfyUI reported failed'` fallback). JSDoc names DEMO-02 explicitly so future readers can trace the helper's origin.
- Refactored `src/comfyui/client.ts:417-447` (submit-time 4xx branch) to delegate to `flattenComfyError`. Existing 4xx-with-node_errors fixture (`client.test.ts:154`) still produces `'Node 3 (KSampler): bad input'` verbatim. Existing 5xx empty-body fallback (`client.test.ts:178`) still emits `'ComfyUI request failed: <status> <statusText>'` shape.
- Refactored `src/engine/generation.ts:201-209` (status / recovery-poller failed branch) to delegate to `flattenComfyError`. The recovery poller (`drivePoller → getGenerationStatus`) inherits this — closing ROADMAP success criterion #1.
- Added 16 new unit tests for `flattenComfyError` in `src/comfyui/__tests__/format.test.ts` covering all 3 branches, edge cases (empty object, errors array empty, null/undefined/empty-string/number/boolean/array fallback), the IT-10 contract, and a property test asserting the helper never throws and always returns a non-empty string.
- IT-10 cancelled-status regression guard at `src/engine/__tests__/generation.test.ts:301-309` continues to pass — the literal `'ComfyUI reported failed'` string is preserved in the third branch.
- Architecture purity preserved: `src/comfyui/format.ts` retains zero MCP imports (verified by `src/__tests__/architecture-purity.test.ts:52`).

## Task Commits

Each task was committed atomically. Task 1 followed TDD discipline (RED then GREEN as separate commits per the project's TDD policy):

1. **Task 1 RED — failing tests for the helper:** `09d9f73` (test) — 16 new test cases land before any implementation. All fail with `'flattenComfyError is not a function'`.
2. **Task 1 GREEN — helper implementation:** `1168940` (feat) — `flattenComfyError` exported from `src/comfyui/format.ts`. All 16 RED tests pass; full format.test.ts suite goes 41/41.
3. **Task 2 — call-site refactor:** `31ed35e` (refactor) — both `src/comfyui/client.ts` and `src/engine/generation.ts` switch from `extractFirstNodeError` (direct call) to `flattenComfyError` (single helper). All call-site tests still pass; full suite 783/5/3.

**Phase 11 setup commit:** `0799b74` (docs) — committed Phase 11 plans + STATE/ROADMAP setup before task execution. (Was uncommitted state inherited from the planner; rolling it into Plan 11-01's commit history keeps the executor's diff view clean.)

## Files Created/Modified

- `src/comfyui/format.ts` — Appended `flattenComfyError` export (34 added lines starting at line 124). `extractFirstNodeError` body and signature byte-for-byte unchanged. JSDoc names DEMO-02 + ROADMAP success criterion #2.
- `src/comfyui/client.ts` — Import line 3 swapped from `extractFirstNodeError` → `flattenComfyError`. Submit-time 4xx branch (was lines 417-436, now 417-447) replaces the `extractFirstNodeError(parsed.node_errors)` chain with a `flattenComfyError(parsed)` delegation. Comment block documents the literal-fallback treatment for 5xx-empty-body cases.
- `src/engine/generation.ts` — Import line 10 swapped from `extractFirstNodeError` → `flattenComfyError`. Status-failed branch (was lines 200-213, now 201-209) replaces the inline 3-branch chain with a single-line `flattenComfyError(remote.error)` delegation. Comment block names DEMO-02 and notes the recovery-poller inheritance.
- `src/comfyui/__tests__/format.test.ts` — Added `flattenComfyError` to import list. New `describe` block (89 added lines) covers all 3 branches + IT-10 contract + property test. Pre-existing `extractFirstNodeError` describe block untouched.

## Decisions Made

1. **Helper return type is `string`, not `string | null`.** Forcing the helper to always emit a non-empty string lets call sites simplify to single-line delegation. The submit-time call site uses an `=== 'ComfyUI reported failed' ? null : flat` guard to preserve the existing 5xx-empty-body fallback shape; the engine's failed-branch call site no longer needs any guard at all.

2. **Submit-time call site passes `parsed` (the full body) to the helper, not `parsed.node_errors`.** This widens the submit-time path so it produces identical output to the status path for identical bodies — which is exactly what Plan 11-02's same-fixture parity test will assert. As a side effect, submit-time will now also extract a top-level string `parsed.error` when present (today this would silently fall to the status/statusText line). No existing test asserts the negative — verified via the full client.test.ts run.

3. **Existing client.ts JSDoc reference to `extractFirstNodeError` (line 29) was kept unchanged.** It describes the underlying flatten primitive (which still exists and is still the workhorse). `flattenComfyError` wraps it; the doc-level statement stays accurate. Touching it is scope creep.

4. **No DB schema changes, no field renames, no new MCP tools, tool budget unchanged at 6 of 12.** Plan-frontmatter contract honored.

## Deviations from Plan

None — plan executed exactly as written.

The plan's three TDD-discipline commits (test → feat → refactor) all landed in the documented order. All grep-verifiable acceptance criteria pass. The pre-existing 5 v1.1 audit-test failures remain at exactly 5 (no regressions, no new failures introduced by this plan).

## Issues Encountered

None.

## Verification

All grep-verifiable acceptance criteria from the plan pass:

- `grep "export function flattenComfyError" src/comfyui/format.ts` → 1 match (line 145) ✓
- `grep "export function extractFirstNodeError(nodeErrors: unknown): string | null" src/comfyui/format.ts` → 1 match (line 110, unchanged) ✓
- `grep "DEMO-02" src/comfyui/format.ts` → 2 matches in JSDoc ✓
- `grep -c "@modelcontextprotocol/sdk" src/comfyui/format.ts` → 0 (architecture-purity preserved) ✓
- `grep -E "extractFirstNodeError\(" src/engine/generation.ts` → 0 matches (no direct calls) ✓
- `grep -E "extractFirstNodeError\(" src/comfyui/client.ts` → 0 matches (no direct calls) ✓
- `grep -nE "flattenComfyError\(" src/engine/generation.ts` → 1 match (line 207) ✓
- `grep -nE "flattenComfyError\(" src/comfyui/client.ts` → 1 match (line 436) ✓
- `grep -n "import.*flattenComfyError" src/engine/generation.ts` → 1 match (line 10) ✓
- `grep -n "import.*flattenComfyError" src/comfyui/client.ts` → 1 match (line 3) ✓

Test suite results:

- `npx vitest run src/comfyui/__tests__/format.test.ts` → 41/41 passing (was 25 pre-existing + 16 new from Task 1) ✓
- `npx vitest run src/comfyui/__tests__/client.test.ts` → 61/61 passing (no regressions in submit-error scenarios) ✓
- `npx vitest run src/engine/__tests__/generation.test.ts -t IT-10` → 2/2 passing (IT-10 + IT-10b) — the cancelled-status `'ComfyUI reported failed'` literal is preserved ✓
- `npx vitest run src/engine/__tests__/generation.test.ts` → 46/46 passing ✓
- `npx vitest run src/__tests__/architecture-purity.test.ts` → 18/18 passing — `src/comfyui/format.ts` zero-MCP guarantee intact ✓
- `npx vitest run` (full suite) → **783 passing / 5 pre-existing failing / 3 skipped (791 total)** — was 767 baseline, gain of 16 matches Task 1's new test count exactly. Failing count unchanged at 5 (the documented pre-existing v1.1 audit-test failures) ✓
- `npx tsc --noEmit` → exit 0 ✓

## TDD Gate Compliance

Plan 11-01 has `tdd="true"` on both Task 1 and Task 2. The required gate sequence in git log is:

1. **RED gate** — `09d9f73 test(11-01): add failing tests for flattenComfyError helper (RED)` — 16 tests fail with `'flattenComfyError is not a function'`. Verified pre-implementation.
2. **GREEN gate** — `1168940 feat(11-01): add flattenComfyError helper to comfyui/format.ts (GREEN)` — minimal implementation makes all 16 RED tests pass.
3. **REFACTOR gate (Task 2)** — `31ed35e refactor(11-01): route both error-flatten call sites through flattenComfyError` — call-site refactor consumed by the now-shared helper. Tests stay green throughout (specifically the call-site behavioral tests in client.test.ts:154-194 and generation.test.ts:301-360).

All 3 gates present, in correct order.

## Threat Model Compliance

The plan declares 5 STRIDE threats (T-11-01 through T-11-05). All `mitigate`-disposition threats are honored:

- **T-11-01 (Tampering — input shape):** Helper accepts `unknown`; never trusts shape. Property test (`property: never throws, always returns non-empty string`) drives 16 input shapes through the helper and asserts no throw / no null. ✓
- **T-11-02 (Information Disclosure — API key echo):** Pre-existing `scrubAndTruncate` (submit) and `scrubErrorValue` (status) wrap the helper output. flattenComfyError introduces no new disclosure surface. Existing IS-04 test (`client.test.ts:196`) still passes. ✓
- **T-11-04 (Repudiation — append-only provenance):** Refactor changes only the string written by `writeFailedEvent` for new rows. Zero UPDATE statements added. Verified by grep on the diff: only the `flat` value passed to `writeFailedEvent`/`markFailed` changed; calls are identical signatures. ✓

`accept`-disposition threats (T-11-03, T-11-05) are noted in the plan and require no mitigation.

## Next Phase Readiness

Plan 11-02 ready to execute. The helper is in place; both call sites delegate. Plan 11-02 will add the same-fixture parity test that drives identical Cloud bodies through both `client.submit()` and `getGenerationStatus()` and asserts byte-for-byte string equality — proving ROADMAP success criterion #2 by integration test (this plan proved it at the helper level only).

DEMO-02 requirement closure happens at the cohort level (after Plan 11-02 lands). Do NOT mark DEMO-02 complete in REQUIREMENTS.md after this plan.

## Self-Check: PASSED

All claimed files exist:

- `/Users/macapple/comfyui-vfx-mcp/src/comfyui/format.ts` — FOUND (modified, line 145 has `flattenComfyError` export)
- `/Users/macapple/comfyui-vfx-mcp/src/comfyui/client.ts` — FOUND (modified, line 3 import + line 436 call)
- `/Users/macapple/comfyui-vfx-mcp/src/engine/generation.ts` — FOUND (modified, line 10 import + line 207 call)
- `/Users/macapple/comfyui-vfx-mcp/src/comfyui/__tests__/format.test.ts` — FOUND (modified, new `describe('flattenComfyError'` block)

All claimed commits exist in `git log --oneline --all`:

- `09d9f73` (test 11-01 RED) — FOUND
- `1168940` (feat 11-01 GREEN) — FOUND
- `31ed35e` (refactor 11-01 dual call sites) — FOUND
- `0799b74` (docs 11 setup) — FOUND

---
*Phase: 11-recovery-poller-error-detail*
*Completed: 2026-04-30*
