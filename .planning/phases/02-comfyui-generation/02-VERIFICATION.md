---
phase: 02-comfyui-generation
verified: 2026-04-21T10:35:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: null
---

# Phase 2: ComfyUI Generation Verification Report

**Phase Goal:** An agent can submit ComfyUI workflows for generation within a shot context and track them through completion or failure, with completed jobs automatically creating new versions.
**Verified:** 2026-04-21T10:35:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Phase-level Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent can submit a workflow to a specific shot and gets back a job ID immediately (non-blocking) | VERIFIED | `src/tools/generation-tool.ts:85` delegates to `engine.submitGeneration(input.shot_id, input.workflow_json)`. Engine inserts a version row, POSTs to ComfyUI, sets `job_id` — returns immediately. `generation-tool.test.ts` "submit resolves quickly (< 1s for fake)" passes. |
| 2 | Agent can check job status and sees it progress through submitted/running/completed/failed states | VERIFIED | `src/engine/generation.ts:100-152` — `getGenerationStatus` maps ComfyUI status strings via `mapState()` to submitted/running/completed/failed; transitions non-terminal rows; returns cached for terminal. `generation.test.ts` covers all four state transitions and timeout path. |
| 3 | Completed generation automatically creates a new version under the shot (never overwrites) | VERIFIED | `VersionRepo.insertVersion` (version-repo.ts:50-66) wraps MAX+1 allocation and INSERT in a single transaction; UNIQUE(shot_id, version_number) prevents duplicates. `markCompleted` (lines 120-128) uses `WHERE completed_at IS NULL` — terminal writes are one-shot. `version-repo.test.ts` asserts monotonicity and immutability. |
| 4 | Submitting UI-format JSON returns a clear rejection error explaining the difference | VERIFIED | `src/comfyui/format.ts:60-76` — `validateWorkflowFormat` detects UI-format sentinel keys (nodes/links/groups/last_node_id) and throws `TypedError('INVALID_WORKFLOW_FORMAT')` with hint: "Export the workflow with 'Dev Mode > Save (API Format)'". `format.test.ts` + `generation-tool.test.ts` "UI-format workflow → INVALID_WORKFLOW_FORMAT with hint" pass. |
| 5 | Internal polling uses exponential backoff — no quota burn visible in request logs | VERIFIED | `src/engine/backoff.ts:15-18` — `createBackoffIterator` yields [2000, 4000, 8000, 16000, 30000, 30000, …] capped at 30 s. Used in `generation.ts:262` (`drivePoller`). `backoff.test.ts` line 14 asserts `[2000, 4000, 8000, 16000, 30000, 30000]`. |

**Score: 5/5 truths verified**

---

### Required Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| `drizzle/0001_phase2_version_lifecycle.sql` | VERIFIED | Three `ALTER TABLE versions ADD` columns: error_code, error_message, outputs_json. Applied by `migrate(db, { migrationsFolder: './drizzle' })` in `db.ts:45`. |
| `src/store/schema.ts` | VERIFIED | `versions` table includes `error_code`, `error_message`, `outputs_json` as nullable text columns (lines 66-68). UNIQUE(shot_id, version_number) constraint at line 70. |
| `src/store/version-repo.ts` | VERIFIED | `VersionRepo` class with `insertVersion`, `setJobId`, `markFailed`, `markCompleted`, `transition`, `getVersion`, `listPendingVersions`. All state transitions use `completed_at IS NULL` guard for immutability. |
| `src/engine/backoff.ts` | VERIFIED | `createBackoffIterator` async generator and `sleep(ms, signal?)` exported. AbortSignal-aware; correct cap at 30 s. |
| `src/comfyui/format.ts` | VERIFIED | `isUiFormat`, `isApiFormat`, `validateWorkflowFormat`, `extractFirstNodeError` all exported. UI-format detection runs before API check; throws INVALID_WORKFLOW_FORMAT with actionable hint. |
| `src/comfyui/client.ts` | VERIFIED | `ComfyUIClient` with `submit` (POST /api/prompt + X-API-Key), `status` (GET /api/job/{id}/status), `download` (manual-redirect SSRF gate), `downloadToPath` (temp-then-rename atomic write). 429 → COMFYUI_RATE_LIMITED. |
| `src/engine/generation.ts` | VERIFIED | `GenerationEngine` with `submitGeneration` (two-phase: insert → POST → setJobId), `getGenerationStatus` (terminal cache + 10-min timeout + download-then-flip), `start` (recovery poller), `stop` (abort all controllers), `drivePoller` (backoff loop). |
| `src/engine/pipeline.ts` | VERIFIED | `Engine` facade composes `GenerationEngine`; exposes `submitGeneration`, `getGenerationStatus`, `start`, `stop`. Constructor takes `(HierarchyRepo, VersionRepo, ComfyUIClient|null, outputRoot?)`. |
| `src/engine/breadcrumb.ts` | VERIFIED | `case 'version'` walks versions → shots → sequences → projects → workspaces (5 levels); renders version leaf via `versionLabel()` as `'ws > proj > seq > shot > v001'`. |
| `src/tools/generation-tool.ts` | VERIFIED | MCP tool `generation` with Zod discriminated union (submit | status). Delegates to `engine.submitGeneration` / `engine.getGenerationStatus`. `shapeVersionEntity` adds `version_label`, `progress: null`, `error` alias. `toolError` envelope handles all TypedError and ZodError paths. |
| `src/tools/index.ts` | VERIFIED | Barrel re-exports `registerGeneration`; comment says "5 of 12". |
| `src/server.ts` | VERIFIED | `import 'dotenv/config'` on line 2; `VersionRepo` + optional `ComfyUIClient` wired; `engine.start()` before transport connect; SIGINT/SIGTERM → `engine.stop()` → exit 0; credential-presence stderr log in exact D-GEN-12 format (`****last4`). |
| `.env.example` | VERIFIED | Contains `COMFYUI_API_KEY`, `COMFYUI_API_BASE=https://cloud.comfy.org`, `COMFYUI_ALLOWED_REDIRECT_HOSTS`. |
| `src/comfyui/__tests__/live-smoke.test.ts` | VERIFIED | `describe.skipIf(!process.env.COMFYUI_API_KEY)` gate. Cleanly skips in CI; counted as 1 skipped in the 189-test suite. |
| `src/__tests__/architecture-purity.test.ts` | VERIFIED | 7 assertions: engine/store/utils/types/comfyui free of @modelcontextprotocol/sdk; comfyui free of better-sqlite3 and drizzle-orm. All pass. |
| `src/__tests__/tool-budget.test.ts` | VERIFIED | Counts `server.registerTool(` calls in src/tools/; asserts ≤ 12 and == 5. Passes. |
| `src/__tests__/stdio-hygiene.test.ts` | VERIFIED | 4 tests: zero stdout on boot; COMFYUI_API_KEY= never in stderr; silent if no key; exact D-GEN-12 format with key. All pass. Uses `DOTENV_CONFIG_PATH` override for determinism. |

---

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `src/engine/generation.ts` | `src/comfyui/client.ts` | `this.client.submit` / `this.client.status` / `this.client.downloadToPath` | WIRED |
| `src/engine/generation.ts` | `src/store/version-repo.ts` | `this.versions.insertVersion` / `setJobId` / `markFailed` / `markCompleted` / `transition` / `getVersion` / `listPendingVersions` | WIRED |
| `src/engine/generation.ts` | `src/engine/backoff.ts` | `createBackoffIterator()` + `sleep(delayMs, signal)` in `drivePoller` | WIRED |
| `src/engine/generation.ts` | `src/utils/outputs.ts` | `buildOutputPath`, `ensureDir`, `resolveCollisionSuffix`, `versionLabel` in `downloadAndPersist` | WIRED |
| `src/engine/pipeline.ts` | `src/engine/generation.ts` | `new GenerationEngine(repo, versionRepo, client, breadcrumb, outputRoot)` | WIRED |
| `src/tools/generation-tool.ts` | `src/engine/pipeline.ts` | `engine.submitGeneration(...)` + `engine.getGenerationStatus(...)` | WIRED |
| `src/server.ts` | `src/tools/generation-tool.ts` | `registerGeneration(server, engine)` | WIRED |
| `src/server.ts` | `src/comfyui/client.ts` | `new ComfyUIClient(apiKey, apiBase, { additionalAllowedHosts })` | WIRED |
| `src/server.ts` | dotenv | `import 'dotenv/config'` on line 2 (before all relative imports) | WIRED |
| `src/store/db.ts` | `drizzle/0001_phase2_version_lifecycle.sql` | `migrate(db, { migrationsFolder: './drizzle' })` | WIRED |
| `src/comfyui/format.ts` | `src/engine/errors.ts` | `TypedError('INVALID_WORKFLOW_FORMAT', ..., 'Dev Mode > Save (API Format)' hint)` | WIRED |
| `src/store/version-repo.ts` | `src/engine/errors.ts` | `TypedError('CONCURRENT_SUBMIT_CONFLICT', ...)` | WIRED |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `generation-tool.ts` | `entity` (Version) | `engine.submitGeneration` → `VersionRepo.insertVersion` → SQLite `versions` table | Yes — DB row with version_number, status, job_id | FLOWING |
| `generation-tool.ts` | `entity` (status check) | `engine.getGenerationStatus` → `VersionRepo.getVersion` → ComfyUIClient.status → state machine | Yes — DB row updated with real remote status | FLOWING |
| `generation.ts` | `stored` (StoredOutput[]) | `downloadToPath` → `pipeline(Readable.fromWeb(body), createWriteStream(dest.partial))` → rename → `markCompleted(outputsJson)` | Yes — disk files + JSON serialized to `outputs_json` column | FLOWING |
| `version-repo.ts` | `version_number` | `MAX(version_number)` SQL query inside transaction → +1 | Yes — DB-derived integer, monotone per shot | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite exits 0 | `npx vitest run` | 188 passed, 1 skipped, 0 failed | PASS |
| TypeScript type check exits 0 | `npx tsc --noEmit` | No output (exit 0) | PASS |
| `dotenv/config` import is first (line 2) | `grep -n "import 'dotenv/config'" src/server.ts` | Line 2 confirmed | PASS |
| Backoff yields [2000,4000,8000,16000,30000,30000,...] | `backoff.test.ts` line 14 assertion | `expect(first6).toEqual([2000, 4000, 8000, 16000, 30000, 30000])` passes | PASS |
| `completed_at IS NULL` guards both terminal writes | `grep "completed_at IS NULL" src/store/version-repo.ts` | Lines 112, 126 confirmed | PASS |
| Live-smoke gated — skips without key | `describe.skipIf(!process.env.COMFYUI_API_KEY)` in live-smoke.test.ts | Counted as 1 skipped in suite | PASS (gated) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GEN-01 | 02-02, 02-03 | Agent can submit a ComfyUI workflow for generation within a shot context | SATISFIED | `generation` tool `submit` action → `engine.submitGeneration(shot_id, workflow_json)` → inserts version row, POSTs to ComfyUI. `generation-tool.test.ts` "submit happy path" passes. |
| GEN-02 | 02-02, 02-03 | Submission returns immediately with a job ID (non-blocking) | SATISFIED | Two-phase submit: insert row first, then async POST, then `setJobId`. Tool returns version entity with `job_id` populated. `generation-tool.test.ts` "submit resolves quickly (< 1s for fake)" confirms non-blocking behavior. |
| GEN-03 | 02-02, 02-03 | Agent can check generation status by job ID | SATISFIED | `generation status {version_id}` → `engine.getGenerationStatus` → fetches remote status, applies state machine, returns updated entity with status/progress/error fields. `generation-tool.test.ts` "status on submitted row returns full entity + breadcrumb". |
| GEN-04 | 02-01 | Completed generations automatically create a new version (never overwrites) | SATISFIED | `VersionRepo.insertVersion` allocates `MAX(version_number)+1` in a transaction; UNIQUE(shot_id, version_number) prevents collisions. `markCompleted` is gated by `WHERE completed_at IS NULL`. `version-repo.test.ts` "version-number MAX+1 monotonicity" + "completed_at immutability" pass. |
| GEN-05 | 02-01, 02-02 | Failed generations record error state with ComfyUI error message | SATISFIED | `VersionRepo.markFailed(id, code, message)` stores `error_code` + `error_message` + sets `status='failed'`. Engine calls this on ComfyUI errors, timeout, and download failures. `generation.test.ts` + `version-repo.test.ts` cover failure paths. |
| GEN-06 | 02-01, 02-03 | ComfyUI Cloud API client validates format (rejects UI-export JSON with clear error) | SATISFIED | `validateWorkflowFormat` in `format.ts` detects UI-format sentinels first; throws `INVALID_WORKFLOW_FORMAT` with "Dev Mode > Save (API Format)" hint. Tool surfaces as `{isError: true, code: 'INVALID_WORKFLOW_FORMAT'}`. `format.test.ts` + `generation-tool.test.ts` "UI-format workflow → INVALID_WORKFLOW_FORMAT with hint" pass. |
| GEN-07 | 02-01, 02-02 | Client uses exponential backoff for internal polling (no quota burn) | SATISFIED | `createBackoffIterator` yields [2000, 4000, 8000, 16000, 30000, 30000, …]. Used in `drivePoller` via `sleep(delayMs, signal)`. `backoff.test.ts` validates the exact sequence. Recovery poller tests confirm AbortController teardown on `stop()`. |

**All 7 requirements (GEN-01..GEN-07) satisfied.**

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/comfyui/client.ts:158` | 158 | `raw.outputs` cast without per-element validation — missing `filename` would raise raw TypeError in `sanitizeRelativeSegment` | Warning (WR-01 from REVIEW.md) | Non-blocking for Phase 2: the outer `toolError` envelope catches and re-wraps as INVALID_INPUT; no security exposure. State consistency is partial (row left in in-flight state; `.partial` file may remain). Tracked as Phase 2.1 polish. |
| `src/engine/generation.ts` (drivePoller) | 261-290 | No deduplication between recovery poller and concurrent agent-driven `getGenerationStatus` calls for the same row — can cause double download attempts | Warning (WR-02 from REVIEW.md) | Non-blocking: `WHERE completed_at IS NULL` guard prevents double-transition in the DB. Duplicate download attempts are idempotent at the file level (atomic rename). Tracked as Phase 2.1 polish. |
| `src/tools/generation-tool.ts` `shapeVersionEntity` | 40-53 | `outputs_json` (raw JSON string) flows into the entity returned to agents — violates CLAUDE.md "no raw JSON dumps to agents" | Warning (WR-07 from REVIEW.md) | The field is present in the shaped entity but not highlighted. Phase 3 (provenance) will parse and structure this. Non-blocking for Phase 2. |

**Blockers: 0. All 7 warnings from REVIEW.md are non-blocking per the review's own classification (0 critical). None prevent phase goal achievement.**

---

### Human Verification Required

None. All success criteria are fully verifiable programmatically:

- Submit path: covered by `generation-tool.test.ts` with FakeEngine + real McpServer wiring.
- Status progression: covered by `generation.test.ts` driving all state-machine transitions via FakeComfyUIClient.
- Version append-only: covered by `version-repo.test.ts` MAX+1 monotonicity and immutability tests.
- UI-format rejection: covered by `format.test.ts` and `generation-tool.test.ts`.
- Backoff sequence: covered by `backoff.test.ts` asserting exact [2000, 4000, 8000, 16000, 30000, 30000] sequence.
- Credential hygiene: covered by `stdio-hygiene.test.ts` (4 tests, including exact format check).
- Architecture purity: covered by `architecture-purity.test.ts` (7 assertions, all green).
- Tool budget: covered by `tool-budget.test.ts` (exactly 5 of 12).
- Live-smoke: gated on COMFYUI_API_KEY; implementation is present and the test driver exists. Treat as "implementation complete, production verification on first live run."

---

## Gaps Summary

No gaps. All 5 phase-level success criteria are verified. All 7 requirements (GEN-01..GEN-07) are satisfied by substantive, wired, and data-flowing implementation. The 7 warnings from the code review are documented anti-patterns scheduled for Phase 2.1 polish — none are security exploitable or prevent the stated phase goal.

Test state confirmed: 188 passing, 1 skipped (gated live-smoke), 0 failed. `npx tsc --noEmit` exits 0.

---

_Verified: 2026-04-21T10:35:00Z_
_Verifier: Claude (gsd-verifier)_

---

## Endpoint Reconciliation (Phase 7, 2026-04-24)

The Phase 2 live-smoke entry (see §"Behavioral Spot-Checks > Live-smoke gated") remained untested end-to-end until Phase 7 resolved the `COMFYUI_API_BASE` drift observed on 2026-04-22. As of 2026-04-24, the locked `COMFYUI_API_BASE` is `https://cloud.comfy.org`, with `HEALTHCHECK_PATH=/api/system_stats` exported from `src/comfyui/client.ts` and a first-submit healthcheck wired into `ComfyUIClient.submit()` to catch future drift as `TypedError('COMFYUI_ENDPOINT_DRIFT')`. Phase 7 additionally surfaced two Phase 2 tech-debt items fixed in-flight — D-EP-16 (`normalizeCloudStatus` translates Cloud's `'success'`/`'error'` terminals to canonical vocabulary) and D-EP-17 (status fetch switched from the singular `/api/job/{id}/status` endpoint, which omits outputs, to the plural `/api/jobs/{id}` endpoint with a nested-outputs flattener). See [`07-VERIFICATION.md`](../07-comfyui-endpoint-reconciliation/07-VERIFICATION.md) for the probe matrix, credential layout, rotation procedure, and fallback-if-redirected behaviour.

---

## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)

**Runtime behavior.** MCP SDK 1.29 runs each tool's `inputSchema` validator before the tool handler is invoked. Any `z.ZodError` thrown by the schema surfaces at the SDK boundary, not inside the handler's `try/catch`. Concrete example: a `shot action=create` request with `name: "SH010"` triggers Zod's `^sh\d{3,}$` regex check at `src/tools/shot-tool.ts:32` and fails BEFORE the handler's catch block at `:106-118` ever runs. The handler's sentinel-detection path (which would emit `TypedError('INVALID_SHOT_FORMAT')` via `toolError`) is shadowed by the SDK's intercept on this code path.

**Visible symptom.** The wire-level response shape is `{ isError: true, content: [{ type: "text", text: "MCP error -32602: Input validation error: ..." }] }`. The sentinel message (`INVALID_SHOT_FORMAT`) is embedded inside `content[0].text` via the SDK's error message; `structuredContent.code` is **not populated** for SDK-intercepted Zod errors. Live decoded JSON-RPC response captured in `../01-foundation-hierarchy/INSPECTOR-SMOKE.md` §3:

```json
{
  "result": {
    "content": [{ "type": "text", "text": "MCP error -32602: Input validation error: Invalid arguments for tool shot: [{..., \"path\": [\"name\"], \"message\": \"INVALID_SHOT_FORMAT\"}]" }],
    "isError": true
  },
  "jsonrpc": "2.0",
  "id": 2
}
```

This diverges from the typed-envelope contract (`src/tools/envelope.ts:13-18` `toolOk` and `src/tools/envelope.ts:32-60` `toolError`) where `structuredContent.code` IS populated for handler-thrown TypedErrors. See `01-VERIFICATION.md` `inspector_smoke_automation.notes[0]` for the original observation.

**Engine-layer contrast.** TypedErrors thrown inside the handler body — e.g. `DUPLICATE_NAME` from `src/store/hierarchy-repo.ts:55-63` (unique-violation wrapping) and `PARENT_NOT_FOUND` from `src/store/hierarchy-repo.ts:95-101` (parent pre-check) — DO populate `structuredContent.code` correctly. The defense-in-depth shot-regex enforcement at `src/engine/pipeline.ts:19,275-284` still fires for non-SDK callers (direct engine calls, test harnesses, alternative adapters), so `INVALID_SHOT_FORMAT` via the typed envelope is still **reachable** — just not via the MCP handler path on the current SDK version. The Phase 1 T2 pattern (Zod-at-tool + regex-at-engine, established in `01-02-SUMMARY.md` line 58) holds end-to-end for non-SDK callers; SDK-intercept is a single-layer regression on the MCP handler path only. Follow-up for Phase 2+ (non-blocking): wrap the SDK boundary so Zod errors flow through the typed envelope. Documented as future work in `01-VERIFICATION.md` `inspector_smoke_automation.notes[1]`; not in scope for Phase 8.
