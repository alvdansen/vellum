---
phase: 11-recovery-poller-error-detail
verified: 2026-04-30T01:30:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 11: Recovery Poller Error Detail Verification Report

**Phase Goal:** Make async terminal-failure provenance match submit-time fidelity. Mirror the submit pattern in the recovery poller so failed-version provenance carries the actionable Cloud `node_errors` detail, not the generic `"ComfyUI reported failed"` collapse string.

**Verified:** 2026-04-30T01:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                                                                                                       | Status     | Evidence                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | When the recovery poller observes terminal `failed` Cloud status with a `node_errors` body, the resulting provenance failed-event row carries the extracted human-readable detail — not the generic collapse string.                                       | VERIFIED | `src/engine/generation.ts:207` calls `flattenComfyError(remote.error)` and writes the result via `provenanceWriter.writeFailedEvent` (line 208) and `versions.markFailed` (line 209). Parity test Arm 3 fixtures A/B prove `versions.error_message === 'Node <id> (<class_type>): <msg>'` byte-equal. |
| 2   | The submit-time and recovery-poller error-extraction paths share a single helper, proven by a same-fixture test that asserts both paths produce identical extracted detail.                                                                                | VERIFIED | Single helper `flattenComfyError` at `src/comfyui/format.ts:145`. Both call sites delegate: `src/comfyui/client.ts:436` (submit) and `src/engine/generation.ts:207` (status/recovery). Parity test at `src/comfyui/__tests__/error-extraction-parity.test.ts` (354 lines, 14/14 passing) drives 4 fixtures × 3 paths and asserts byte-equal output via cross-arm sweep. |
| 3   | Existing failed-version dashboard cards render the new actionable error string verbatim — no field renaming, no UI rework.                                                                                                                                  | VERIFIED | Field name `error_message` unchanged in `src/types/hierarchy.ts:64` and `src/store/version-repo.ts`. Zero dashboard files in Phase 11 commit diff (`git diff 0799b74^..8db2c73 -- packages/dashboard` returns empty). Dashboard StatusPill rendering path is untouched.                                                                                              |
| 4   | When `node_errors` is absent or unparseable, the path falls back gracefully to the generic `"ComfyUI reported failed"` string with no thrown error.                                                                                                          | VERIFIED | Helper branch 3 at `src/comfyui/format.ts:156` returns the literal. Helper unit tests (8 named cases in `format.test.ts:114-180` + property test sweep over 16 input shapes asserts never-throws/never-empty). Parity test Fixture D + IT-10 cross-check both pass. IT-10 regression at `generation.test.ts:308` still passes (2/2 IT-10 tests green). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                                                | Expected                                                                              | Status   | Details                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/comfyui/format.ts`                                 | flattenComfyError export with 3 documented branches                                   | VERIFIED | Line 145: `export function flattenComfyError(error: unknown): string`. JSDoc names DEMO-02. Branches at lines 147-152 / 154 / 156.    |
| `src/comfyui/client.ts`                                 | Submit-time 4xx branch delegates to flattenComfyError                                 | VERIFIED | Line 3 imports `flattenComfyError`; line 436 calls it with full parsed body; line 437 treats fallback literal as "no actionable detail". |
| `src/engine/generation.ts`                              | Status / recovery-poller failed branch delegates to flattenComfyError                 | VERIFIED | Line 10 imports `flattenComfyError`; line 207 calls it; lines 208-209 write the flattened string to provenance + markFailed.            |
| `src/comfyui/__tests__/format.test.ts`                  | Unit tests covering all 3 branches + edge cases + IT-10 contract + property test     | VERIFIED | Describe block at line 114; 8 named test cases (lines 115-174) + property test (line 175). Full file: 41/41 passing.                  |
| `src/comfyui/__tests__/error-extraction-parity.test.ts` | Same-fixture parity test driving 4 fixtures through 3 paths + cross-arm sweep + IT-10 | VERIFIED | 354 lines. Describe block at line 181. 14 named test cases. Test run: 14/14 passing.                                                  |
| `src/test-utils/fake-comfyui-client.ts`                 | Additive `cannedFailedError` escape hatch + OMIT_ERROR sentinel                       | VERIFIED | Field at line 97; sentinel at line 100; status() override at lines 145-152; reset() at line 274. Default null preserves legacy.       |

### Key Link Verification

| From                                                  | To                                              | Via                          | Status     | Details                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------- | ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `src/engine/generation.ts` (failed branch)            | `src/comfyui/format.ts:flattenComfyError`       | import + call at line 207    | WIRED    | Line 10 import + line 207 invocation; output flows to writeFailedEvent + markFailed.            |
| `src/comfyui/client.ts` (submit 4xx branch)           | `src/comfyui/format.ts:flattenComfyError`       | import + call at line 436    | WIRED    | Line 3 import + line 436 invocation; output passed via scrubAndTruncate to TypedError.message. |
| `error-extraction-parity.test.ts` (helper-direct arm) | `flattenComfyError` (helper)                    | direct call                  | WIRED    | `assertHelperParity()` invokes the helper with each fixture body.                              |
| `error-extraction-parity.test.ts` (submit-path arm)   | `ComfyUIClient.submit()` 4xx branch             | mocked fetch + real client   | WIRED    | `assertSubmitParity()` constructs real ComfyUIClient with mocked fetchImpl returning canned 4xx. |
| `error-extraction-parity.test.ts` (status-path arm)   | `GenerationEngine.getGenerationStatus()` failed | FakeComfyUIClient escape hatch | WIRED    | `assertStatusParity()` sets `cannedFailedError` per fixture and asserts `versions.error_message`. |

### Data-Flow Trace (Level 4)

| Artifact                                  | Data Variable      | Source                                              | Produces Real Data | Status      |
| ----------------------------------------- | ------------------ | --------------------------------------------------- | ------------------ | ----------- |
| `flattenComfyError` (format.ts:145)       | return string      | unknown error payload (3-branch logic)              | Yes              | FLOWING   |
| `client.ts:436` submit 4xx branch         | `flat` → TypedError | `flattenComfyError(parsed)` from JSON-parsed body  | Yes              | FLOWING   |
| `generation.ts:207` failed branch         | `flat` → DB write   | `flattenComfyError(remote.error)` from Cloud status | Yes              | FLOWING   |
| `versions.error_message` field            | DB field            | `markFailed(...,flat)` SQL UPDATE in version-repo   | Yes              | FLOWING (write-only at point of failure; field is v1.0-shipped, no schema change) |

### Behavioral Spot-Checks

| Behavior                                              | Command                                                                  | Result                                                  | Status |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- | ------ |
| Helper unit tests pass                                | `npx vitest run src/comfyui/__tests__/format.test.ts`                    | 41/41 passing                                           | PASS |
| Same-fixture parity test passes                       | `npx vitest run src/comfyui/__tests__/error-extraction-parity.test.ts`   | 14/14 passing                                           | PASS |
| IT-10 cancelled-status regression preserved           | `npx vitest run src/engine/__tests__/generation.test.ts -t "IT-10"`      | 2/2 passing (IT-10 + IT-10b)                            | PASS |
| Full test suite — no regressions                      | `npx vitest run`                                                         | 797 passing / 5 pre-existing failing / 3 skipped        | PASS |
| TypeScript compile clean                              | `npx tsc --noEmit`                                                       | exit 0 (no output)                                      | PASS |
| Architecture-purity: zero MCP imports in helper file  | `grep -c "@modelcontextprotocol/sdk" src/comfyui/format.ts`              | 0                                                       | PASS |
| Architecture-purity: zero MCP imports in parity test  | `grep -c "@modelcontextprotocol/sdk" src/comfyui/__tests__/error-extraction-parity.test.ts` | 0                                          | PASS |
| Append-only provenance: zero UPDATE on provenance     | `grep -nE "UPDATE\s+provenance" src/engine/provenance.ts src/store/provenance-repo.ts` | empty (no UPDATE statements found)        | PASS |

### Requirements Coverage

| Requirement | Source Plan       | Description                                                                                                                                                                                | Status      | Evidence                                                                                                                                                                                                                                                |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEMO-02     | 11-01-PLAN, 11-02-PLAN | The recovery poller surfaces rich ComfyUI Cloud error detail. Today async terminal failures all collapse to `"ComfyUI reported failed"` regardless of cause; mirror submit pattern so failed-version provenance carries actionable detail. | SATISFIED | Helper at `src/comfyui/format.ts:145`, dual call-site refactor at `src/comfyui/client.ts:436` and `src/engine/generation.ts:207`, byte-for-byte parity test at `src/comfyui/__tests__/error-extraction-parity.test.ts` (14/14 passing). REQUIREMENTS.md marks DEMO-02 complete. |

No orphaned requirements: ROADMAP maps DEMO-02 to Phase 11 only; both plans in this phase declare it.

### Anti-Patterns Found

| File                                              | Line | Pattern                                  | Severity | Impact                                                                                                                          |
| ------------------------------------------------- | ---- | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| _none_                                            | -    | _none_                                   | -        | Scanned all 6 modified files. No TODO/FIXME, no empty implementations, no stub patterns, no console.log placeholders, no hardcoded empty arrays/objects in user-visible flow. |

### Pre-existing Test Failures (Not Phase 11 Regressions)

| File                                                 | Failing test                                                                  | Status                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/__tests__/phase-attribution.test.ts`            | `parses ROADMAP.md and finds at least 9 phase blocks`                         | Pre-existed Plan 10-01 (origin commit `04d5f60`). Documented in `.planning/phases/10-migrate-on-boot-hardening/deferred-items.md`. v1.1 ROADMAP-shape mismatch. |
| `src/__tests__/phase-attribution.test.ts`            | `every non-skipped phase declares at least one REQ-ID in ROADMAP`             | Same — v1.1 REQ-ID format differs from v1.0 audit expectation.                                      |
| `src/__tests__/phase-attribution.test.ts`            | `SUMMARY requirements-completed: union ⊇ ROADMAP **Requirements**: per phase` | Same — v1.1 milestone-rollover housekeeping.                                                        |
| `src/__tests__/validation-flags.test.ts`             | `parses ROADMAP.md body progress table and finds at least 9 phases`           | Same — ROADMAP-shape mismatch.                                                                      |
| `src/__tests__/validation-flags.test.ts`             | `detects [GAP CLOSURE] phases (6, 7, 8, 9) from ROADMAP top-level checklist`  | Same — v1.1 ROADMAP has no GAP CLOSURE checklist.                                                  |

Count: 5/5 — exactly matching the Phase 10 baseline. No new failures introduced by Phase 11.

### Human Verification Required

None. All four ROADMAP success criteria are provable programmatically:

- Code paths verified by grep + read.
- Behavior verified by 14-case same-fixture parity test (helper + submit + status arms).
- Regression guard verified by IT-10 + IT-10b passing.
- No-UI-rework verified by zero dashboard files in Phase 11 diff.
- No-field-rename verified by unchanged `error_message` schema field.

### Gaps Summary

No gaps. Phase 11 delivers exactly what the ROADMAP success criteria + plan must_haves require:

1. **Single helper as source of truth** — `flattenComfyError` at `src/comfyui/format.ts:145` with 3 documented branches. Wraps the existing `extractFirstNodeError` primitive without modifying it (D-GEN-27 contract preserved).
2. **Both call sites delegate** — submit at `client.ts:436`, status/recovery at `generation.ts:207`. No more inline 3-branch chains. Direct `extractFirstNodeError(...)` calls eliminated from both call sites (still exported for backwards compatibility and use by `flattenComfyError` itself).
3. **Same-fixture parity test proves no drift** — 14 named cases (4 fixtures × 3 arms = 12) + 1 cross-arm sweep + 1 IT-10 cross-check. Byte-equality assertions across helper-direct, ComfyUIClient.submit() against mocked 4xx, and GenerationEngine.getGenerationStatus() failed branch.
4. **Zero schema/UI changes** — `version.error_message` field name unchanged. Zero dashboard files modified. Zero new MCP tools. Tool budget stays at 6 of 12.
5. **Architecture-purity preserved** — `src/comfyui/format.ts` and the new parity test file both have zero MCP imports.
6. **Append-only provenance preserved** — No UPDATE statements added; both call sites only write new failed-event rows via `writeFailedEvent`.
7. **IT-10 regression intact** — `error_message.toContain('ComfyUI reported failed')` at `generation.test.ts:308` still passes; literal `'ComfyUI reported failed'` is the third branch in `flattenComfyError`.
8. **5 pre-existing v1.1 audit-test failures unchanged at exactly 5** — origin commit `04d5f60` (pre-existed Phase 10), fully documented in `deferred-items.md`. No new failures introduced by Phase 11.

DEMO-02 cohort closure: helper landed in 11-01, parity test landed in 11-02, REQUIREMENTS.md marks DEMO-02 complete. Phase 11 ready for milestone progression to Phase 12.

---

_Verified: 2026-04-30T01:30:00Z_
_Verifier: Claude (gsd-verifier)_
