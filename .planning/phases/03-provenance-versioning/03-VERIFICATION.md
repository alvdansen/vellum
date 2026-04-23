---
phase: 03-provenance-versioning
verified: 2026-04-22T20:00:00Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 3: Provenance & Versioning Verification Report

**Phase Goal:** Every generated version has complete, immutable provenance that an agent can diff, reproduce exactly, or iterate from with modifications

**Verified:** 2026-04-22T20:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every version record contains workflow JSON, prompt JSON, seed, timestamp, and model names (checksums nullable) | VERIFIED | `ProvenanceWriter.writeSubmitEvent` captures `workflow_json` pre-HTTP (generation.ts:140); `writeCompletedEvent` persists `prompt_json`, `seed` (via `extractSeed`), `models_json` (via `extractModels`), `outputs_json` at completion (generation.ts:451; provenance.ts:118-132); every `ProvenanceEvent` row has `timestamp: Date.now()` (provenance-repo.ts:66); `ModelRef.model_hash` is always null per D-PROV-06 (provenance.ts:69) |
| 2 | Provenance records are immutable — no UPDATE or DELETE operations exist in the provenance path | VERIFIED | `ProvenanceRepo` exposes only `insertEvent`, `getEventsForVersion`, `getLatestCompletedEvent`, `getSubmitEvent` (provenance-repo.ts:50-111); reflective prototype assertion in tests (provenance-repo.test.ts:198-208); migration 0003 is additive-only with zero UPDATE/DELETE DDL; foreign key set to `ON UPDATE no action ON DELETE no action` (0003_phase3_provenance.sql:21); grep for `setLineage\|UPDATE.*provenance\|DELETE.*provenance` across `src/` returns zero matches |
| 3 | Agent can diff two versions and see a structured comparison of exactly what changed (params, seed, models) | VERIFIED | `diffVersions` pure engine returns `DiffResponse { summary, changes: { params, models, seed, workflow, metadata } }` (diff.ts:156-168); `Engine.diffVersions` delegates to pure function and attaches breadcrumb (pipeline.ts:309-323); `version` tool exposes `diff` action (version-tool.ts:44-48, 183-186); same-shot guard enforced in `assertComparable` throws `INVALID_INPUT` for cross-shot (diff.ts:25-32); 13 unit tests in diff.test.ts |
| 4 | Agent can reproduce any version by re-submitting its stored prompt blob, creating a new version with lineage link | VERIFIED | `GenerationEngine.reproduceVersion` loads `completedEvent.prompt_json`, `JSON.parse`s into `promptBlob`, submits via `submitInternal` with `lineageType: 'reproduce'` and `parentVersionId: sourceVersionId` (generation.ts:224-290); `reproduction_warnings: string[]` always present per D-PROV-28 (generation.ts:227, 288); lineage written at INSERT time via `versionRepo.insertVersion(shotId, notes, lineage)` (version-repo.ts:56-112); `generation` tool exposes `reproduce` action spreading `reproduction_warnings` last (generation-tool.ts:212-224) |
| 5 | Agent can iterate from a version by loading its params, applying specified changes, and submitting as a new generation with parent lineage tracked | VERIFIED | `GenerationEngine.iterateFromVersion` branches on source.status: completed → prompt_json (D-PROV-13), failed → workflow_json (D-PROV-24), submitted/running → VERSION_NOT_COMPLETED (D-PROV-25) (generation.ts:298-361); applies `applySeedShortcut` + `applyOverrides` (iterate-merge.ts); re-validates merged blob via `validateWorkflowFormat` (generation.ts:352); submits with `lineageType: 'iterate'` and `parentVersionId` (generation.ts:354-360); `generation` tool exposes `iterate` action with `overrides: Record<nodeId, { inputs?, class_type? }>` + optional `seed` (generation-tool.ts:66-78); no JSON-Patch shape anywhere |

**Score:** 5/5 roadmap success criteria verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `drizzle/0003_phase3_provenance.sql` | Additive migration (provenance table + lineage_type column + covering index) | VERIFIED | Contains `CREATE TABLE provenance`, `CREATE INDEX idx_provenance_version_time`, `ALTER TABLE versions ADD lineage_type`; no UPDATE/DELETE DDL |
| `src/store/schema.ts` | Drizzle declarations for provenance table + versions.lineage_type | VERIFIED | `provenance` sqliteTable declared (schema.ts:106-125); `versions.lineage_type` added (schema.ts:88) |
| `src/store/provenance-repo.ts` | Append-only repo with only insert/get methods | VERIFIED | Public surface = `insertEvent`, `getEventsForVersion`, `getLatestCompletedEvent`, `getSubmitEvent` (111 lines); 12 unit tests including structural invariant assertion |
| `src/engine/provenance.ts` | `extractModels`, `extractSeed`, `ProvenanceWriter` | VERIFIED | All three exports present (141 lines); covers 9 loader class_types in `LOADER_CLASS_TYPES`, 4 KSampler variants in `KSAMPLER_CLASS_TYPES` |
| `src/engine/diff.ts` | Pure `diffVersions` with D-PROV-15 shape | VERIFIED | Returns `{ summary, changes: { params, models, seed, workflow, metadata } }`; same-shot + completed-state guards; 168 lines |
| `src/engine/diff-summary.ts` | Deterministic `buildSummary` template | VERIFIED | Present and imported by diff.ts |
| `src/engine/iterate-merge.ts` | `applyOverrides`, `applySeedShortcut`, `findKSamplerNodes`, FORBIDDEN_KEYS guard | VERIFIED | All four exports present; FORBIDDEN_KEYS ReadonlySet rejects `__proto__`, `constructor`, `prototype` at both outer node-id and inner field layers |
| `src/engine/generation.ts` | `GenerationEngine` with `submitInternal`, `reproduceVersion`, `iterateFromVersion` | VERIFIED | 8-arg constructor takes ProvenanceRepo + ProvenanceWriter; `submitInternal` private helper shared by submit/reproduce/iterate; 538 lines |
| `src/engine/pipeline.ts` | Engine facade +6 Phase 3 methods | VERIFIED | `getVersion`, `listVersionsForShot`, `getProvenance`, `diffVersions`, `reproduceVersion`, `iterateFromVersion` all present; `loadDiffSnapshot` private helper (pipeline.ts:253-391) |
| `src/comfyui/png-metadata.ts` | `extractTextChunk` PNG tEXt walker | VERIFIED | Pure function, returns null on malformed input; `PNG_MAGIC` exported |
| `src/comfyui/client.ts` | `fetchResolvedPrompt(pngPath)` | VERIFIED | Pure filesystem read via `readFile` → `extractTextChunk` → `JSON.parse`; returns null on any failure; zero HTTP (client.ts:479-492) |
| `src/store/version-repo.ts` | `insertVersion` optional lineage arg + `listByShot` | VERIFIED | 3rd optional `lineage` param writes `parent_version_id` + `lineage_type` at INSERT inside transaction (version-repo.ts:56-112); `listByShot` added (version-repo.ts:182-201) |
| `src/tools/version-tool.ts` | `version` MCP tool with get/list/diff/provenance actions | VERIFIED | 209 lines; Zod discriminated union; thin delegator; zero business logic |
| `src/tools/generation-tool.ts` | Extended to 4-arm union with reproduce/iterate | VERIFIED | `SubmitInput`, `StatusInput`, `ReproduceInput`, `IterateInput` all arms; tool description mentions `reproduction_warnings` explicitly |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/engine/provenance.ts` | `src/store/provenance-repo.ts` | `ProvenanceWriter` constructor takes `ProvenanceRepo` | WIRED | `constructor(private repo: ProvenanceRepo)` (provenance.ts:109); uses `this.repo.insertEvent(...)` in all 3 write methods |
| `src/engine/generation.ts` submit path | `ProvenanceWriter.writeSubmitEvent` | `this.provenanceWriter.writeSubmitEvent(row.id, args.workflowJson)` BEFORE HTTP POST | WIRED | generation.ts:140 — runs before `client.submit()` (D-PROV-04) |
| `src/engine/generation.ts` terminal paths | `ProvenanceWriter.writeCompletedEvent` / `writeFailedEvent` | 6 call sites at all terminal branches | WIRED | Submit-fail (149), timeout (179), no-job-id (194), comfy-fail (209), download-fail (433), completed (451) |
| `src/engine/generation.ts` downloadAndPersist | `ComfyUIClient.fetchResolvedPrompt` | `promptBlob = await this.client.fetchResolvedPrompt(firstPngPath)` before completed event | WIRED | generation.ts:447-448; blob passed to `writeCompletedEvent` which tolerates null |
| `src/engine/pipeline.ts` diffVersions | Pure `diffVersions` from diff.ts | `pureDiffVersions({ a: snapA, b: snapB })` after `loadDiffSnapshot` pair | WIRED | pipeline.ts:315; breadcrumb attached after the pure call |
| `src/engine/pipeline.ts` reproduce/iterate | `GenerationEngine.reproduceVersion` / `iterateFromVersion` | `this.generation.reproduceVersion(...)` / `this.generation.iterateFromVersion(...)` | WIRED | pipeline.ts:380, 390; zero business logic at facade |
| `src/tools/version-tool.ts` | `engine.getVersion` / `listVersionsForShot` / `getProvenance` / `diffVersions` | Switch on `input.action` → engine call | WIRED | version-tool.ts:174-196; every action → exactly one engine call |
| `src/tools/generation-tool.ts` reproduce | `engine.reproduceVersion` + spread with `reproduction_warnings` | `toolOk({ ...shapeVersionEntity(...), reproduction_warnings: result.reproduction_warnings })` | WIRED | generation-tool.ts:212-224; always-present field appended after spread |
| `src/tools/generation-tool.ts` iterate | `engine.iterateFromVersion` passing overrides + seed | Direct delegation with no branching on source.status | WIRED | generation-tool.ts:225-235; engine owns source.status branching per D-PROV-24 |
| `src/server.ts` | `registerVersion(server, engine)` | buildServer call | WIRED | Confirmed via tool-budget test (registers exactly 6 tools); ProvenanceRepo instantiated in server construction |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `generation.ts` reproduceVersion.promptBlob | `completedEvent.prompt_json` | `this.provenanceRepo.getLatestCompletedEvent(sourceVersionId)` → SQLite `provenance` table row | Yes (real DB query on indexed column) | FLOWING |
| `generation.ts` iterateFromVersion.baseBlob (completed) | `completedEvent.prompt_json` | Same as above | Yes | FLOWING |
| `generation.ts` iterateFromVersion.baseBlob (failed) | `submitEvent.workflow_json` | `this.provenanceRepo.getSubmitEvent(sourceVersionId)` → SQLite `provenance` table | Yes | FLOWING |
| `pipeline.ts` loadDiffSnapshot | `submit.workflow_json`, `completed.prompt_json`, `completed.models_json`, `v.outputs_json` | Repo reads via `getSubmitEvent` / `getLatestCompletedEvent` / `getVersion` | Yes (JSON.parse on DB rows) | FLOWING |
| `generation.ts` downloadAndPersist.promptBlob | `client.fetchResolvedPrompt(firstPngPath)` | PNG tEXt chunk on disk (D-PROV-05) | Yes — real PNG parsing | FLOWING (tolerates null → PROVENANCE_UNAVAILABLE later) |
| `provenance.ts` writeCompletedEvent.models / seed | `extractModels(promptBlob)` / `extractSeed(promptBlob)` | Pure walk over real prompt blob | Yes (deterministic extraction) | FLOWING |
| `version-tool.ts` provenance action | `engine.getProvenance(version_id)` → `provenanceRepo.getEventsForVersion` | SQLite ordered-by-timestamp read | Yes (covered by idx_provenance_version_time) | FLOWING |
| `generation-tool.ts` reproduce response | `result.reproduction_warnings` | Built from real models list during `reproduceVersion` | Yes (always non-empty in Phase 3 per D-PROV-28) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compile | `npx tsc -p tsconfig.json --noEmit` | exit 0, zero output | PASS |
| Full unit test suite | `npx vitest run --reporter=dot` | 462 passed + 2 skipped across 32 test files; duration 19.08s | PASS |
| Append-only structural invariant | `grep -E "update\|delete\|remove\|set" src/store/provenance-repo.ts` | Only JSDoc/literal refs; `Object.getOwnPropertyNames` test asserts prototype has no `update*`/`delete*`/`markCompleted`/`markFailed`/`setSeed` | PASS |
| No UPDATE/DELETE on provenance path | `grep -rn "setLineage\|UPDATE.*provenance\|DELETE.*provenance" src/` | 0 matches (architecture test file comment on line 32 of provenance-repo.ts is the only hit — explanatory) | PASS |
| No MCP imports in engine | `grep -rn "@modelcontextprotocol" src/engine/` | Only `src/engine/__tests__/pipeline.test.ts:255` — self-assertion string | PASS |
| Tool count exactly 6 | multi-line regex on `src/tools/*.ts` | `[generation, project, sequence, shot, version, workspace]` — 6 names, sorted | PASS |
| Phase 3 error codes present | grep `ErrorCode` in errors.ts | `PROVENANCE_UNAVAILABLE`, `REPRODUCE_BLOCKED`, `ITERATE_INVALID_PATCH`, `VERSION_NOT_COMPLETED` all present (errors.ts:24-27) | PASS |
| Tool-budget regression test | Included in vitest run above | `expect(registerToolCount()).toBe(6)` PASSES; name-set assertion PASSES | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| PROV-01 | 03-01, 03-02, 03-03 | Every version captures full provenance: workflow JSON, prompt JSON, seed, timestamp | SATISFIED | `ProvenanceWriter.writeSubmitEvent` (workflow) + `writeCompletedEvent` (prompt, seed, timestamp) wired into submit + terminal paths; `provenance` table persists all five fields; 92 unit tests across provenance-repo, model-extraction, seed-extraction modules |
| PROV-02 | 03-01, 03-03 | Provenance captures model names (checksums best-effort, nullable on Cloud) | SATISFIED | `extractModels` walks 9 LOADER_CLASS_TYPES → `ModelRef[]` with `model_hash: null` (Phase 3 deferred); `models_json` persisted on completed event; `version provenance` tool action returns `models_json` in events |
| PROV-03 | 03-01 | Provenance records are append-only (immutable once written) | SATISFIED | `ProvenanceRepo` structurally append-only — only insert/get methods on prototype; reflective assertion test enforces invariant; migration 0003 is additive; grep confirms zero UPDATE/DELETE on provenance path |
| PROV-04 | 03-01, 03-02, 03-03 | Agent can diff two versions (structured comparison of what changed) | SATISFIED | Pure `diffVersions` returns `{summary, changes: {params, models, seed, workflow, metadata}}`; Engine facade attaches breadcrumb; `version` tool `diff` action exposes it end-to-end; same-shot + completed-state guards |
| PROV-05 | 03-01, 03-02, 03-03 | Agent can reproduce any version exactly (re-submit stored prompt blob) | SATISFIED | `Engine.reproduceVersion` → `GenerationEngine.reproduceVersion` parses completedEvent.prompt_json and submits verbatim via `submitInternal` with lineage; `generation` tool `reproduce` action; `reproduction_warnings: string[]` always present; PNG tEXt path confirmed by fetchResolvedPrompt |
| PROV-06 | 03-01, 03-02, 03-03 | Agent can iterate from a version (load params + apply specified changes, track lineage) | SATISFIED | `iterateFromVersion` loads source blob (prompt_json for completed, workflow_json for failed), applies `applyOverrides` + `applySeedShortcut`, re-validates, submits with lineage; `generation` tool `iterate` action accepts `overrides: Record<nodeId, { inputs?, class_type? }>` + optional `seed` |

**Orphaned requirements:** None. REQUIREMENTS.md maps PROV-01..PROV-06 to Phase 3, and every ID appears in at least one plan's `requirements` field. No unclaimed IDs.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/engine/generation.ts` | 320, 331 | String literals containing "not available" | Info | Part of legitimate error-message hints for PROVENANCE_UNAVAILABLE throws on iterate (explicitly documented in 03-02-SUMMARY.md); NOT stub text |
| `src/engine/__tests__/generation.test.ts` | 254 | Test title claims `[2s,4s,8s]` backoff but actual cadence is `[2s,4s]` | Info | Documented in 03-REVIEW.md WR-01; cosmetic label only, test logic is correct |
| `src/tools/__tests__/generation-tool.test.ts` | 698 | Test title says "rejects" but body asserts Zod silently drops unknown keys | Info | Documented in 03-REVIEW.md WR-02; behavior matches spec (Zod strips), title is misleading |

All three are documented in the Phase 3 code review (03-REVIEW.md) with 0 critical + 2 warnings + 6 info findings — none block goal achievement. No TODO/FIXME/placeholder/stub patterns found in implementation files. No hardcoded empty returns where real data should flow. No disconnected props.

### Gaps Summary

No gaps. Every roadmap Success Criterion has code-backed evidence; every PROV requirement has wired implementation; all structural invariants hold; 462 unit tests pass; TypeScript compiles clean. The reproduction_warnings array is always present per D-PROV-28. Migration 0003 is additive-only. Zero MCP imports in engine. Tool count at 6 of 12 budget.

### Tracked Follow-ups (Non-gaps)

The following items are documented in `03-03-SUMMARY.md` and project memory but do NOT constitute Phase 3 defects:

1. **ComfyUI Cloud API endpoint drift** — `api.comfy.org` returns 404 on `POST /api/prompt`; `cloud.comfy.org` returns 401 with the current key. Pre-existing infrastructure/credential drift; predates Phase 3. Live-smoke tests are double-gated behind `RUN_LIVE_SMOKE=1` and skip cleanly by default. Captured in project memory `project_comfy_api_endpoint_drift.md`. Does not block Phase 3 acceptance — the 15/15 protocol-level UAT gates already validated the agent surface end-to-end via MCP SDK client over stdio.
2. **`verify-phase3-uat.mts` kept untracked at repo root** — Intentional per user preference; ad-hoc UAT driver for re-running against real ComfyUI after endpoint drift is resolved.
3. **Offset overflow cap + overrides size cap** — Deferred defensive DoS limits (T-03-03-05, T-03-03-06); not Phase 3 scope per plan threat model.

### Human Verification Required

None. Automated evidence fully covers all 5 roadmap Success Criteria and all 6 PROV requirements. The live-smoke round-trip test exists (under `describe.skipIf`) and would execute end-to-end against real ComfyUI Cloud once the endpoint drift is resolved, but that is infrastructure work, not a Phase 3 deliverable. The 15/15 protocol-level UAT gates via MCP SDK stdio transport already exercised the agent-facing surface verbatim.

---

_Verified: 2026-04-22T20:00:00Z_
_Verifier: Claude (gsd-verifier)_
