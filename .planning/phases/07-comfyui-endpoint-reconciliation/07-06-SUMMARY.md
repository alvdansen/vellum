---
phase: 07-comfyui-endpoint-reconciliation
plan: 06
subsystem: integration
tags: [phase-07, live-smoke, acceptance-gate, endpoint-reconciliation, D-EP-16, D-EP-17]

# Dependency graph
requires:
  - phase: 07-comfyui-endpoint-reconciliation
    provides: "Plans 02 (client healthcheck + DEFAULT_COMFYUI_API_BASE), 03 (.env + .env.example locked), 04 (ensureEndpointHealthy unit tests), 05 (drift sentinel)"
provides:
  - "Phase 7 SC-2 acceptance: live-smoke green twice back-to-back against https://cloud.comfy.org with first-submit healthcheck firing once (D-EP-07)"
  - "Two Rule 3 blocking fixes that surface Phase 2 tech debt: D-EP-16 normalizeCloudStatus (b06d097), D-EP-17 /api/jobs endpoint switch + nested outputs flattening (b94a8df)"
  - "Observed Cloud signed-URL host: storage.googleapis.com — inside existing DEFAULT_ALLOWED_HOST_PATTERNS, no allowlist widening needed"
affects: [07-07, 07-08, 02-VERIFICATION, client.ts, live-smoke]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cloud-API translation at client boundary: normalizeCloudStatus() + extractOutputs() helpers keep the engine vocabulary-free; Cloud's on-the-wire vocabulary ('success'/'error', nested outputs maps) never leaks past src/comfyui/client.ts"
    - "Endpoint probing for per-endpoint auth/shape asymmetry: .singular /api/job/{id}/status returns dispatch-state only; plural /api/jobs/{id} returns full execution record — use the latter for completion detection"
    - "D-EP-17 defense-in-depth: normalizeCloudStatus retained even after switching to the canonical-vocabulary plural endpoint, so undocumented intermediate states map to 'pending' not 'completed'"

key-files:
  created:
    - ".planning/phases/07-comfyui-endpoint-reconciliation/07-06-SUMMARY.md"
  modified:
    - "src/comfyui/client.ts (b06d097 + b94a8df) — normalizeCloudStatus, extractOutputs, status() endpoint switch, error_message fallback"
    - "src/comfyui/__tests__/client.test.ts (b06d097 + b94a8df) — 7 new tests: D-EP-16 terminal mapping (2), normalizeCloudStatus unit table (3), D-EP-17 nested-outputs flattening (1), D-EP-17 error_message fallback (1); existing happy-path test renamed + URL assertion updated"

key-decisions:
  - "D-EP-16 normalizeCloudStatus kept as defense-in-depth AFTER D-EP-17 switched to the canonical-vocabulary plural endpoint — cheap insurance against undocumented intermediate states"
  - "D-EP-17 endpoint: /api/jobs/{id} (plural) is the correct status endpoint, not /api/job/{id}/status (singular) — singular omits outputs entirely, guaranteeing the engine never flips a version to completed"
  - "extractOutputs accepts both flat-array (legacy stock ComfyUI + existing test mocks) and nested-map (Cloud /api/jobs) shapes — zero test-mock churn; new D-EP-17 tests cover the nested shape explicitly"
  - "Cloud download redirect target: storage.googleapis.com — matched by existing /(^|\\.)googleapis\\.com$/ DEFAULT_ALLOWED_HOST_PATTERNS; no runtime override needed"

patterns-established:
  - "Cloud vocabulary translation pattern: module-level helper (normalizeCloudStatus, extractOutputs) called from client boundary; the engine never sees 'success'/'error' or nested output maps. Mirrors D-GEN-18's intent of a stable state-machine interface"
  - "Phase 7 bug-triage workflow: probe the live endpoint directly (node one-liners against process.env.COMFYUI_API_BASE) BEFORE assuming client-side correctness. The probe matrix in Plan 01 stopped at read-only endpoints — this plan demonstrates why broader endpoint coverage matters"

requirements-completed:
  - "SC-2: Live-smoke green twice back-to-back end-to-end against the locked endpoint"

# Metrics
duration: ~60min (pre-flight + triage + 2 Rule 3 fixes + 2 green live-smoke runs + sentinel)
completed: 2026-04-24
---

# Phase 7 Plan 06: Live-Smoke Acceptance Gate Summary

**SC-2 MET — live-smoke green twice back-to-back after two Rule 3 blocking fixes (D-EP-16 normalizeCloudStatus, D-EP-17 /api/jobs endpoint switch + nested outputs flattening) resolved Phase 2 tech debt that Plan 01's read-only probe matrix couldn't detect.**

## Performance

- **Duration:** ~60 min pre-flight + bug triage + 2 Rule 3 fixes + live-smoke x2 + sentinel
- **Completed:** 2026-04-24
- **Tasks:** 3 (Task 1 pre-flight auto + Task 2 checkpoint:human-action + Task 3 sentinel auto)
- **Files modified:** 2 source (`src/comfyui/client.ts`, `src/comfyui/__tests__/client.test.ts`) — outside plan's declared `files_modified: []`, applied as Rule 3 blocking fixes
- **ComfyUI credits burned:** ~4 (2 diagnostic iterations during bug triage + 2 acceptance runs; threat model budget was 2, overspend documented as justified by the bug discovery)

## Accomplishments

- Pre-flight confirmed Plan 01-05 artifacts intact: 739 passed / 3 skipped baseline, TSC clean, architecture-purity + tool-budget (= 7) + transport-parity + stdio-hygiene all green.
- Live-smoke Run 1 (2026-04-24T21:27:13Z → 21:28:18Z, 64.63s): 2 tests passed, 0 skipped, exit 0. First-poll entity snapshot: `{"status":"running","job_id":"<cloud-uuid>","version_number":1}`.
- Live-smoke Run 2 (2026-04-24T21:28:25Z → 21:28:49Z, 23.11s): 2 tests passed, 0 skipped, exit 0. Warm-worker path — no cold-start penalty.
- Sentinel opt-in (2026-04-24T21:28:56Z, 307ms): `RUN_PROBE=1 npx vitest run endpoint-probe.test.ts` — 1 passed, confirms `HEALTHCHECK_PATH=/api/system_stats` alignment between Plan 02 runtime and Plan 05 sentinel.
- Observed signed-URL host: `storage.googleapis.com` — inside existing `DEFAULT_ALLOWED_HOST_PATTERNS` at `src/comfyui/client.ts` (matches `/(^|\.)googleapis\.com$/`). No allowlist widening needed for Phase 7.
- Two Rule 3 blocking fixes committed atomically:
  - `b06d097 fix(07-06): normalize Cloud status strings for terminal state detection` (D-EP-16)
  - `b94a8df fix(07-06): switch status fetch to /api/jobs/{id} and flatten nested outputs` (D-EP-17)
- Rotated `COMFYUI_API_KEY` mid-plan — old key (`****43da`) authenticated `/api/system_stats` but was rejected by `/api/prompt` (scope asymmetry); new key (`****749d`) authenticates both. `.env` chmod 600 preserved.

## Task Commits

1. **Task 1: Pre-flight** — no code commit (read-only gates).
2. **Task 2: Checkpoint** — operator-driven, no code commit for the runs themselves. Two Rule 3 blocking fixes committed as separate atomic commits:
   - `b06d097` — `fix(07-06): normalize Cloud status strings for terminal state detection` (D-EP-16)
   - `b94a8df` — `fix(07-06): switch status fetch to /api/jobs/{id} and flatten nested outputs` (D-EP-17)
3. **Task 3: Sentinel opt-in** — no code commit (verification-only).

**Plan metadata:** this SUMMARY commit (docs).

## Live-Smoke Evidence (for 07-VERIFICATION.md §1)

| Run | Timestamp (UTC) | Duration | Exit | Tests | Cold/Warm | Notes |
|-----|-----------------|----------|------|-------|-----------|-------|
| 1 | 2026-04-24T21:27:13Z → 21:28:18Z | 64.63s | 0 | 2 passed / 0 skipped | cold | First-poll snapshot observed `status: "running"` — proves D-EP-16 `'running'` → `'in_progress'` mapping correct |
| 2 | 2026-04-24T21:28:25Z → 21:28:49Z | 23.11s | 0 | 2 passed / 0 skipped | warm | Same infra-assigned worker, 41s faster end-to-end |

**Sentinel (opt-in, read-only):** `RUN_PROBE=1 npx vitest run endpoint-probe.test.ts` — 1 passed, 307ms, zero credit burn. Confirms `HEALTHCHECK_PATH=/api/system_stats` shared literal between runtime (Plan 02) and sentinel (Plan 05).

**Observed signed-URL host:** `storage.googleapis.com` (captured via post-run direct probe of `/api/view` 302 target for the completed job's preview output filename). Inside `DEFAULT_ALLOWED_HOST_PATTERNS` — no widening needed.

## Decisions Made

- **Accepted `COMFYUI_SMOKE_CHECKPOINT` override** per plan's remediation guidance. Default `v1-5-pruned-emaonly.safetensors` is no longer in this Cloud account's checkpoint list; available replacements are `realismIllustriousBy_v55FP16.safetensors` (SDXL Illustrious) and `sd15-lcm-icbinpICantBelieveIts.safetensors` (SD 1.5 LCM). Used the SD 1.5 LCM variant — closer in architecture to the test's original target, fast (10-step LCM denoise), and zero test-contract ambiguity (the test only asserts "did a file land on disk", not visual quality).
- **Applied both Rule 3 fixes inside Plan 06 rather than spawning a sub-phase.** Both fixes are one-file-plus-tests, both are direct blockers for SC-2, both share the same commit narrative (Phase 2 client targeted the wrong status endpoint). Spawning 07.1 would have left Phase 7 open indefinitely for equivalent surgery.
- **Kept D-EP-16 normalizeCloudStatus even after D-EP-17.** Defense in depth: the plural `/api/jobs/{id}` endpoint uses canonical vocabulary (`"completed"` / `"failed"`), but undocumented intermediate states (queued, dispatching, streaming, etc.) may emit non-canonical strings; the normalizer collapses them to `'pending'` so the poll loop keeps trying instead of prematurely flipping state.
- **Credit overspend accepted (~4 vs 2 budgeted).** The 2 extra credits funded the D-EP-16/D-EP-17 discovery — diagnostic iterations showed the Phase 2 client targeted the wrong endpoint. The alternative was to halt and ship a Phase 7.1 for a single wire-level bug, burning equivalent credits (+1 ceremony round-trip) in a second visit.

## Deviations from Plan

### Rule 3 blocking fixes (outside `files_modified: []`)

**1. [Rule 3 #1] D-EP-16 normalizeCloudStatus — status string mapping**

- **Found during:** Task 2 live-smoke iteration — first live-key run returned `status: "success"` from `/api/job/{id}/status`, which the engine's `mapState()` (`src/engine/generation.ts:364`) collapsed to `'pending'`. Poll loop spun until 180s deadline.
- **Fix:** Added module-level `normalizeCloudStatus(raw: unknown): StatusResponse['status']` in `src/comfyui/client.ts`; called from `client.status()` in place of the raw cast. Maps `'success'/'completed'` → `'completed'`, `'error'/'failed'` → `'failed'`, `'running'/'in_progress'` → `'in_progress'`, `'cancelled'/'canceled'` → `'cancelled'`, anything else → `'pending'`.
- **Tests:** 5 new in `client.test.ts` — 2 integration-style in `ComfyUIClient.status` describe (`success` and `error` mock responses); 3 unit-table in `normalizeCloudStatus (D-EP-16)` describe (terminal / intermediate / unknown inputs).
- **Commit:** `b06d097`
- **Impact:** Isolated; no engine or test-fixture changes required.

**2. [Rule 3 #2] D-EP-17 endpoint switch + nested outputs flattening**

- **Found during:** Task 2 live-smoke iteration — after D-EP-16 fix, `status` mapped correctly but `outputs` was always `undefined`. Direct endpoint probing revealed that Cloud's `/api/job/{id}/status` (singular) returns dispatch-layer state only (no outputs, no workflow prompt); the `/api/jobs/{id}` (plural) endpoint returns the full execution record.
- **Fix:** Switched `ComfyUIClient.status()` URL from `/api/job/${id}/status` to `/api/jobs/${id}`. Added `extractOutputs(raw: unknown): ComfyOutput[] | undefined` helper to flatten the nested `outputs[nodeId][mediaType][]` shape to a flat `ComfyOutput[]`; accepts both flat-array input (legacy / test mocks) and nested-map input (Cloud plural endpoint). Added `error_message` top-level fallback so failed jobs' worker tracebacks are persisted to `versions.error_message`.
- **Tests:** 2 new in `client.test.ts` — `D-EP-17 nested-map outputs shape flattens` (multi-node + multi-media type) and `D-EP-17 error_message fallback`. Existing happy-path test renamed + URL pathname assertion updated from `/api/job/job-1/status` to `/api/jobs/job-1`.
- **Commit:** `b94a8df`
- **Impact:** Isolated to `src/comfyui/client.ts` + its test file; the engine's `downloadAndPersist` and `fetchResolvedPrompt` chain already expected a populated `ComfyOutput[]` — no engine changes required once `outputs` was no longer empty.

### Parameter-override deviations (in-scope)

**3. `COMFYUI_SMOKE_CHECKPOINT` override used** — the default `v1-5-pruned-emaonly.safetensors` isn't available on this Cloud account. Override set to `sd15-lcm-icbinpICantBelieveIts.safetensors` (from the available list). This was a plan-anticipated path (see 07-06 Task 2 "If the failure is `COMFYUI_API_ERROR` with an unrelated message … Override with `COMFYUI_SMOKE_CHECKPOINT=<available-ckpt>` and retry").

**4. `COMFYUI_API_KEY` rotated mid-plan** — old key (`****43da`) authenticated `/api/system_stats` but was rejected by `/api/prompt` with 401. Rotated to a fresh key (`****749d`) issued at https://platform.comfy.org. `.env` chmod 600 preserved, backup `.env.bak` removed post-swap to avoid stale-key sprawl. `.env` was NOT committed (gitignored). This deviation surfaces a **Plan 01 probe-matrix gap** that is explicitly called out in the Next Phase Readiness section below for the Plan 07-07 VERIFICATION narrative.

### Auto-fixed Issues

None — both deviations were Rule 3 blocking fixes requiring user-visible code commits.

---

**Total deviations:** 2 Rule 3 blocking fixes (D-EP-16, D-EP-17), 2 plan-anticipated parameter overrides (checkpoint, key rotation)
**Impact on plan:** SC-2 met as intended. Scope creep: 2 files changed outside `files_modified: []`, both tightly scoped to the symptom. No Phase 7 timeline extension — Plans 07-07 and 07-08 remain unblocked.

## Issues Encountered

**1. Plan 01 probe matrix scope gap — read-only endpoints only**

- **What:** Plan 01's probe tested `GET /api/queue`, `/api/system_stats`, `/api/history`, `/` against 3 hardcoded bases. Neither the submit endpoint (`POST /api/prompt`) nor the status endpoint (`GET /api/job/{id}/status` or `/api/jobs/{id}`) was probed.
- **Consequence:** Two latent issues shipped that only surfaced during Phase 7's acceptance gate:
  - Per-endpoint auth asymmetry — a key with read-only scope authenticates `/api/system_stats` (200) but is rejected by `/api/prompt` (401). The healthcheck (D-EP-07) catches "endpoint moved" drift but not "key lost submit privilege on specific routes" drift.
  - Endpoint shape mismatch — `/api/job/{id}/status` exists and authenticates but returns dispatch-state only, not the completion record. Phase 2's client targeted the wrong endpoint from Phase 2 inception.
- **Resolution for Phase 7:** D-EP-17 switches to `/api/jobs/{id}`. The root cause is documented in the 07-06-SUMMARY commit narrative and will be called out in `07-VERIFICATION.md §1` (Plan 07-07) so future maintainers understand why the plural endpoint is load-bearing.
- **Follow-up recommendation:** A future probe revision should test `POST /api/prompt` with a minimal workflow (e.g., empty-prompt rejection) to catch per-endpoint scope asymmetry before live-smoke. Out of scope for Phase 7; captured here for Plan 07-07 to surface as a known limitation.

**2. Old COMFYUI_API_KEY scope asymmetry**

- **What:** Key `****43da` (issued earlier) authenticated read endpoints (`/api/system_stats` 200) but was rejected by `POST /api/prompt` with 401 Unauthorized.
- **Hypothesis (not verified in Phase 7):** ComfyUI Cloud may scope keys by endpoint tier (read-only vs submit). Alternatively, the account may have been in a transitional verification state. Out of scope to verify mechanistically — for Phase 7 purposes, the rotation to `****749d` resolved the symptom.
- **Resolution:** Rotated key to `****749d` in `.env`, preserved chmod 600, removed `.env.bak`. `.env` is gitignored.
- **Follow-up recommendation:** `07-VERIFICATION.md §3 Rotation Procedure` (Plan 07-07) should include a diagnostic step: "if `/api/system_stats` 200s but `POST /api/prompt` 401s, the key itself is the problem (likely scope) — rotate to a fresh key before assuming the endpoint drifted."

**3. Flaky `IT-20` pre-existing regression test**

- **What:** `src/tools/__tests__/generation-tool.test.ts > IT-20: status on a completed row ...` intermittently fails with `ENOTEMPTY: directory not empty, rmdir '/var/folders/.../vfx-gen-tool-.../ver_...'`. Filesystem race in the test's teardown — an async download operation is still writing when `fsp.rm` fires.
- **Impact on Phase 7:** None. The test passes on re-run; no correlation with Phase 7 code changes (same flaky failure observed in the pre-flight step before any Phase 7 code edits).
- **Follow-up recommendation:** Out of scope for Phase 7. File a backlog entry for a teardown fix (wait-for-in-flight-downloads or atomic `fsp.rm` with retry).

## User Setup Required

- **Post-Phase-7 key rotation recommended** (user's own policy) — the fresh key used here was exchanged to this session. Rotate at https://platform.comfy.org after Phase 7 close-out to establish a clean operational baseline for v1.0. Procedure captured in `07-VERIFICATION.md §3` (Plan 07-07).

## Next Phase Readiness

- **Plan 07-07 (wave 5, docs — 07-VERIFICATION.md + 02-VERIFICATION.md supplement) is unblocked.** This SUMMARY provides:
  - §1 Probe Matrix + chosen base (via 07-01-SUMMARY.md) and live-smoke evidence table (above)
  - §3 Rotation Procedure context: the per-endpoint scope asymmetry diagnostic step (Issue #2 follow-up)
  - §4 observed signed-URL host (`storage.googleapis.com`) — confirms allowlist alignment
- **Plan 07-08 (wave 5, memory hygiene) is unblocked.** Pitfall #5 (live-smoke green twice) confirmed, so the drift memory can be removed (preferred per D-EP-15 second-consecutive-green criterion) rather than marked RESOLVED.

## Self-Check

- [x] Full suite 739+ passed / 3 skipped — pre-flight baseline match
- [x] TSC clean (exit 0) both before and after D-EP-16 / D-EP-17 fixes
- [x] Architecture + regression suites green (stdio-hygiene 8, architecture-purity 18, tool-budget 3, transport-parity 4)
- [x] Tool count still = 7 (Phase 6 baseline preserved)
- [x] Live-smoke Run 1: 2 passed / 0 skipped, exit 0, 64.63s
- [x] Live-smoke Run 2: 2 passed / 0 skipped, exit 0, 23.11s
- [x] Sentinel opt-in: 1 passed, 307ms
- [x] Both live-smoke runs' first-submit healthcheck fired exactly once (D-EP-07 cached across polls, no DRIFT errors emitted)
- [x] Observed signed-URL host captured for Plan 07-07 §1 documentation
- [x] Both Rule 3 blocking fixes committed atomically with D-EP assignments (b06d097, b94a8df)
- [x] Updated test suite: 749 tests total (745 passed + 3 skipped + 1 flaky IT-20 confirmed passing on re-run)
- [x] `.env` not committed (gitignored, chmod 600 preserved)
- [x] No `COMFYUI_API_KEY` values in any committed artifact (verified — SUMMARY uses `****last4` format)

## Self-Check: PASSED

---
*Phase: 07-comfyui-endpoint-reconciliation*
*Plan: 06*
*Completed: 2026-04-24*
