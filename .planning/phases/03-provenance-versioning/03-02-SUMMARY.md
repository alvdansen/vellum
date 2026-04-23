---
phase: 03-provenance-versioning
plan: 02
subsystem: engine+store+comfyui-client
tags: [provenance, lineage, reproduce, iterate, diff, engine-facade, png-metadata, append-only]

# Dependency graph
requires:
  - phase: 03-provenance-versioning
    plan: 01
    provides: ProvenanceRepo, ProvenanceWriter, extractModels, extractSeed, applyOverrides, applySeedShortcut, diffVersions (pure), extractTextChunk, ProvenanceEvent/ModelRef/DiffSnapshot/IterateOverride types, ErrorCode +4 (PROVENANCE_UNAVAILABLE/REPRODUCE_BLOCKED/ITERATE_INVALID_PATCH/VERSION_NOT_COMPLETED), provenance table + versions.lineage_type column
  - phase: 02-comfyui-generation
    provides: GenerationEngine (submitGeneration/getGenerationStatus/downloadAndPersist/start/stop), VersionRepo (insertVersion/setJobId/markFailed/markCompleted/transition/getVersion/listPendingVersions), ComfyUIClient (submit/status/download/downloadToPath), Engine facade with Phase 2 generation ops
  - phase: 01-foundation-hierarchy
    provides: HierarchyRepo, nanoid-prefixed IDs, BreadcrumbResolver, Breadcrumb shape, TypedError, validateWorkflowFormat

provides:
  - VersionRepo.insertVersion gains optional 3rd param `lineage?: { parent_version_id?, lineage_type? }` — INSERT-time write, no follow-up UPDATE (D-PROV-33 / LANDMINE #8)
  - VersionRepo.listByShot(shotId, limit, offset) — paginated version_number DESC result with total_count
  - ComfyUIClient.fetchResolvedPrompt(pngPath) — PNG tEXt `prompt` chunk + JSON.parse (D-PROV-05 primary path). Returns null on any failure. NO HTTP (LANDMINE #3).
  - GenerationEngine constructor takes ProvenanceRepo + ProvenanceWriter (8 positional args)
  - GenerationEngine.submitGeneration signature preserved (LANDMINE #1) — body delegates to private submitInternal shared with reproduce/iterate
  - GenerationEngine writes submitted event BEFORE HTTP POST (D-PROV-04); completed event with fetchResolvedPrompt-parsed blob + models + seed BEFORE markCompleted; failed event BEFORE markFailed at every terminal branch (HTTP reject, timeout, no-job-id, status=failed, DOWNLOAD_FAILED)
  - GenerationEngine.reproduceVersion(sourceId, notes?) — returns { entity, breadcrumb, reproduction_warnings: string[] } (warnings always present per D-PROV-28); throws VERSION_NOT_COMPLETED / REPRODUCE_BLOCKED / PROVENANCE_UNAVAILABLE / VERSION_NOT_FOUND
  - GenerationEngine.iterateFromVersion(sourceId, overrides?, seed?, notes?) — completed source → prompt_json, failed source → workflow_json (D-PROV-24), submitted/running → VERSION_NOT_COMPLETED (D-PROV-25); validates merged blob via validateWorkflowFormat (D-PROV-23)
  - Engine facade constructor takes ProvenanceRepo positional between versionRepo and client; constructs ProvenanceWriter internally
  - Engine facade +6 methods: getVersion, listVersionsForShot, getProvenance, diffVersions, reproduceVersion, iterateFromVersion — zero business logic, composition only
  - Engine.diffVersions delegates to pure diffVersions from Plan 01, attaches breadcrumb (BreadcrumbEntry[] + breadcrumb_text on the returned shape)

affects:
  - 03-03 (tool surface — Plan 3 wires Zod discriminated unions for `version` tool get/list/diff/provenance actions and extends generation tool with reproduce/iterate actions on top of the facade methods landed here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Facade-as-composer (zero business logic in Engine; all branching lives in GenerationEngine / pure modules / repos)
    - Private submitInternal shared helper (LANDMINE #1: keeps submitGeneration public signature stable while letting reproduce/iterate reuse the two-phase submit path)
    - INSERT-time lineage write (LANDMINE #8: no setLineage / no follow-up UPDATE — closes the race where a reader sees null lineage on a reproduce/iterate row mid-transaction)
    - Two-event provenance lifecycle (submitted before HTTP; completed OR failed after — never both, never more than one)
    - Best-effort prompt blob capture (fetchResolvedPrompt returns null on any failure → ProvenanceWriter accepts null → PROVENANCE_UNAVAILABLE surfaces on reproduce/iterate, never on submit)
    - Threat-model T-03-02-05 preserved: HTTP submit NEVER happens inside a SQLite transaction (insertVersion tx → writeSubmitEvent tx → client.submit NO tx → setJobId tx)

key-files:
  created:
    - src/engine/__tests__/pipeline.test.ts (14 tests, 6 describes — facade coverage)
  modified:
    - src/store/version-repo.ts (insertVersion gains optional 3rd lineage arg; listByShot added)
    - src/comfyui/client.ts (fetchResolvedPrompt + node:fs/promises + png-metadata imports)
    - src/engine/generation.ts (8-arg constructor; submitInternal extracted; provenance writes at submit/terminal; reproduceVersion + iterateFromVersion methods)
    - src/engine/pipeline.ts (4-arg constructor with provenanceRepo; 6 Phase 3 facade methods + loadDiffSnapshot helper)
    - src/server.ts (ProvenanceRepo wired into Engine construction)
    - src/test-utils/fake-comfyui-client.ts (cannedPromptBlob + fetchResolvedPrompt method)
    - src/store/__tests__/version-repo.test.ts (+6 lineage-param tests)
    - src/comfyui/__tests__/client.test.ts (+7 fetchResolvedPrompt tests with hand-built PNG fixtures)
    - src/engine/__tests__/generation.test.ts (setup() uses 8-arg ctor + ProvenanceRepo/Writer; 19 new tests across 3 describes: provenance writes / reproduce / iterate)
    - src/engine/__tests__/hierarchy.test.ts (Engine ctor +ProvenanceRepo)
    - src/engine/__tests__/shot-naming.test.ts (Engine ctor +ProvenanceRepo)
    - src/__tests__/http-origin.test.ts (Engine ctor +ProvenanceRepo)
    - src/__tests__/transport-parity.test.ts (Engine ctor +ProvenanceRepo)
    - src/comfyui/__tests__/live-smoke.test.ts (Engine ctor +ProvenanceRepo)
    - src/tools/__tests__/breadcrumb-always.test.ts (Engine ctor +ProvenanceRepo)
    - src/tools/__tests__/error-wrapping.test.ts (Engine ctor +ProvenanceRepo)
    - src/tools/__tests__/generation-tool.test.ts (Engine ctor +ProvenanceRepo, both construction sites)
    - src/tools/__tests__/input-bounds.test.ts (Engine ctor +ProvenanceRepo)

key-decisions:
  - "Rule 3 blocking: all Engine constructor callers updated in Task 2 rather than Task 3. The 8-arg GenerationEngine constructor immediately breaks pipeline.ts, which cascades to every test that constructs an Engine. Task 2's acceptance criterion says `npx tsc --noEmit` must pass — so the facade's minimal wiring (construct ProvenanceRepo internally + pass to GenerationEngine) lands in Task 2. Task 3 then layers the six new delegation methods + VersionRepo.listByShot on top."
  - "FakeComfyUIClient extended with cannedPromptBlob field + fetchResolvedPrompt method (Rule 3 blocking — engine tests need to exercise downloadAndPersist's new PNG-read path without hitting the filesystem). The real ComfyUIClient.fetchResolvedPrompt reads a PNG from disk; the fake skips that layer because PNG parsing is covered independently by png-metadata.test.ts + client.test.ts. Default cannedPromptBlob=null exercises the PROVENANCE_UNAVAILABLE-reserve path; tests assign a canned blob to exercise the captured-blob branch."
  - "reproduce and iterate diverge on null prompt_json. Reproduce throws PROVENANCE_UNAVAILABLE (contract: re-submit the resolved blob VERBATIM — no silent workflow_json fallback). Iterate from a completed source also throws PROVENANCE_UNAVAILABLE, but iterate from a FAILED source uses workflow_json per D-PROV-24 (the authored intent is still iterable when the source failed before generating a resolved blob)."
  - "reproduction_warnings always present, never empty in Phase 3. Since models.model_hash is always null in Phase 3 (checksums deferred), every reproduce either emits one warning per loader-model (unchecksummed) OR emits 'Cloud API did not expose model metadata' when the models list is empty. Honesty over silence per D-PROV-28."
  - "lineage written at INSERT — insertVersion's 3rd param is `lineage?: { parent_version_id?, lineage_type? }` (not a separate setLineage method). Rationale is LANDMINE #8: between INSERT and a follow-up UPDATE, a reader querying the row would see parent_version_id=null + lineage_type=null — a lie for a reproduce/iterate row. INSERT-time write closes that race window entirely."

patterns-established:
  - "Shared private helper for lifecycle: submitInternal(args) — private, takes a discriminated options object, called by submitGeneration (no lineage), reproduceVersion (lineage='reproduce'), iterateFromVersion (lineage='iterate'). Keeps the public surface of GenerationEngine stable while three methods share an identical two-phase submit + provenance-write + error-catch body."
  - "loadDiffSnapshot facade-internal helper assembles a DiffSnapshot from a version row + its submit event + its latest completed event. Private to the facade. Called twice by diffVersions. The pure diffVersions function (Plan 01) enforces same-shot + comparable-state guards; the facade only constructs the pair + attaches breadcrumb."
  - "Fake client mirrors real client's method surface. Adding fetchResolvedPrompt to FakeComfyUIClient establishes the pattern for Plan 3+4: the real client gains HTTP/IO methods, and the fake gains a canned-value mirror (no IO) so engine tests drive state transitions without filesystem or network."

requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06]

# Metrics
duration: 17min
completed: 2026-04-22
---

# Phase 3 Plan 2: Provenance Wiring + Reproduce/Iterate Summary

**Wire Plan 01's pure provenance primitives into the Phase 2 generation lifecycle — ProvenanceWriter fires at submit + terminal events, fetchResolvedPrompt captures PNG tEXt blobs for replay, reproduce/iterate create lineage-tagged children. Engine facade exposes six new read/diff/reproduce/iterate methods ready for Plan 3's tool surface.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-04-22T01:47:55Z
- **Completed:** 2026-04-22T02:03:45Z
- **Tasks:** 3 (all atomic commits)
- **Files modified:** 18 (5 source + 1 new test file + 12 test file extensions)

## Accomplishments

- **VersionRepo.insertVersion grows optional lineage arg.** Backward-compatible with Phase 2 callers (two-arg form still compiles). When `lineage` is passed, `parent_version_id` + `lineage_type` are written inside the existing allocate-version-number transaction — no follow-up UPDATE (LANDMINE #8 closed).
- **ComfyUIClient.fetchResolvedPrompt(pngPath) lands.** Pure filesystem read via `fs.promises.readFile` → Plan 01's `extractTextChunk` → `JSON.parse` → plain-object check. Returns null on ANY failure. Zero HTTP calls (LANDMINE #3). Body is swap-ready for a future /api/history-based HTTP variant with the same signature.
- **ProvenanceWriter wired into the full lifecycle.** submitGeneration writes the `submitted` event BEFORE the ComfyUI POST so D-PROV-04 holds (workflow captured even when ComfyUI rejects). getGenerationStatus writes `failed` events before markFailed at all three failure branches (timeout, no-job-id, ComfyUI-reported-fail). downloadAndPersist writes the `completed` event — first reading the resolved prompt blob from the downloaded PNG via fetchResolvedPrompt (null tolerated) — before markCompleted. DOWNLOAD_FAILED also writes the failed event before markFailed.
- **reproduceVersion** (PROV-05): loads source, enforces completed status + completed-provenance + non-null prompt_json, builds `reproduction_warnings[]` from the models list (Phase 3 emits one warning per unchecksummed model, or the generic "no model metadata" notice when empty), re-submits the stored prompt blob verbatim with `lineage_type='reproduce'` at INSERT. Returns `{ entity, breadcrumb, reproduction_warnings }` — the warnings array is ALWAYS present per D-PROV-28.
- **iterateFromVersion** (PROV-06): branches on source.status — `completed` → `prompt_json` (D-PROV-13), `failed` → `workflow_json` (D-PROV-24), `submitted`/`running` → VERSION_NOT_COMPLETED (D-PROV-25). Applies Plan 01's `applySeedShortcut` + `applyOverrides` to merge the blob, re-validates via `validateWorkflowFormat` (D-PROV-23), then calls the shared submitInternal with `lineage_type='iterate'`.
- **Engine facade six new methods.** getVersion / listVersionsForShot / getProvenance / diffVersions / reproduceVersion / iterateFromVersion. Zero business logic — pure composition over the GenerationEngine + ProvenanceRepo + pure diff module. `loadDiffSnapshot` is the internal helper that assembles a DiffSnapshot pair from repo state + provenance events; the pure diffVersions from Plan 01 enforces same-shot + comparable guards.
- **VersionRepo.listByShot** backs the new `listVersionsForShot` facade method with the expected DESC-by-version_number ordering + total_count for pagination.
- **46 new tests across 4 files.** 6 lineage-param + 7 fetchResolvedPrompt + 19 provenance/reproduce/iterate in generation.test.ts + 14 pipeline facade tests. Full suite 430/430 + 1 skip.
- **TypeScript clean end-to-end.** 14 test files + server.ts updated for the new constructor arities (Rule 3 blocking fix). Architecture-purity still green (zero `@modelcontextprotocol` imports in engine/); tool-budget still at 5.

## Task Commits

Each task was committed atomically:

1. **Task 03-02-01: VersionRepo lineage params + ComfyUIClient.fetchResolvedPrompt** — `4e4a92e` (feat)
2. **Task 03-02-02: Wire ProvenanceWriter into GenerationEngine + reproduce/iterate methods** — `6144f51` (feat)
3. **Task 03-02-03: Engine facade +6 methods, VersionRepo.listByShot, pipeline.test.ts** — `e4f02bc` (feat)

## Files Created/Modified

### Created
- `src/engine/__tests__/pipeline.test.ts` — 14 tests across 6 describe blocks (getVersion, listVersionsForShot, getProvenance, diffVersions, reproduce/iterate delegation smoke, zero-MCP-import invariant scan)

### Modified

**Source:**
- `src/store/version-repo.ts` — insertVersion 3rd optional lineage param; listByShot added
- `src/comfyui/client.ts` — fetchResolvedPrompt method + two new imports (readFile from node:fs/promises, extractTextChunk from ./png-metadata.js)
- `src/engine/generation.ts` — constructor +2 positional args (ProvenanceRepo, ProvenanceWriter); submitInternal private helper extracted; provenance writes at submit + all terminal branches; reproduceVersion + iterateFromVersion methods added
- `src/engine/pipeline.ts` — constructor +1 positional (ProvenanceRepo between versionRepo and client); constructs ProvenanceWriter internally; +6 new facade methods + loadDiffSnapshot private helper
- `src/server.ts` — ProvenanceRepo instantiation wired into the existing Engine construction path

**Test utilities:**
- `src/test-utils/fake-comfyui-client.ts` — cannedPromptBlob field + fetchResolvedPrompt method mirroring the real client; reset() clears the blob

**Tests:**
- `src/store/__tests__/version-repo.test.ts` — new describe "Phase 3 lineage params" with 6 tests
- `src/comfyui/__tests__/client.test.ts` — new describe "fetchResolvedPrompt (D-PROV-05)" with 7 tests (valid PNG, missing chunk, malformed JSON, non-object JSON, missing file, non-PNG, no-network invariant)
- `src/engine/__tests__/generation.test.ts` — setup() reworked for 8-arg GenerationEngine ctor; 3 new describes with 19 tests (provenance writes × 4, reproduce × 6, iterate × 9)
- Engine-ctor updates across `src/engine/__tests__/hierarchy.test.ts`, `src/engine/__tests__/shot-naming.test.ts`, `src/__tests__/http-origin.test.ts`, `src/__tests__/transport-parity.test.ts`, `src/comfyui/__tests__/live-smoke.test.ts`, `src/tools/__tests__/breadcrumb-always.test.ts`, `src/tools/__tests__/error-wrapping.test.ts`, `src/tools/__tests__/generation-tool.test.ts`, `src/tools/__tests__/input-bounds.test.ts` — every site that constructs `new Engine(...)` now passes `new ProvenanceRepo(db)` as the 3rd arg

## Decisions Made

- **Lineage written at INSERT time, not via follow-up UPDATE (LANDMINE #8 / D-PROV-33).** Extending `insertVersion` with an optional 3rd `lineage` parameter is the single INSERT-time write path. The alternative — a `setLineage(id, parentId, type)` method — was rejected because between INSERT and UPDATE a reader could briefly observe `lineage_type: null` on a reproduce/iterate row. That's a transient lie for an append-only audit surface. INSERT-time write closes the window structurally: the row is born with the right lineage metadata, or it isn't born at all.
- **fetchResolvedPrompt takes a file path, not a job_id or a ComfyOutput[] (LANDMINE #3).** Decoupling from the Phase 2 outputs shape keeps the method HTTP-free (D-PROV-05 primary path = PNG tEXt). If a future spike confirms `/api/history/{id}` returns the resolved blob on ComfyUI Cloud, the method body swaps for an HTTP call with the same signature — the caller contract is stable. Current implementation reads from disk via `fs.promises.readFile` and returns `null` on every failure mode (missing file, non-PNG, missing chunk, malformed JSON, array-not-object JSON). Never throws.
- **submitInternal is private (LANDMINE #1).** The Phase 2 `submitGeneration(shotId, workflowJson, notes?)` public signature is preserved verbatim — it now delegates to `submitInternal` which accepts an `args` discriminated options object with optional `parentVersionId + lineageType`. reproduceVersion/iterateFromVersion also call submitInternal. Net effect: three public methods share one two-phase-submit + provenance-write + error-catch body without any public-surface churn.
- **reproduce throws PROVENANCE_UNAVAILABLE on null prompt_json, but iterate-from-failed uses workflow_json (D-PROV-24).** Reproduce's contract is verbatim resubmit of the resolved prompt — there is no silent fallback. Iterate's contract is "start from the authored intent + patch" — on a failed source the authored intent is the original workflow_json, which is still meaningful to iterate from. This asymmetry is explicit per D-PROV-24 and preserves threat-model T-03-02-06 (failed-source iterate re-runs validateWorkflowFormat on the merged blob).
- **reproduction_warnings is never silently empty in Phase 3.** Since models[].model_hash is always null (checksums deferred), every reproduce emits at least one warning — either one per unchecksummed loader or the generic "Cloud API did not expose model metadata" notice. This is intentional per D-PROV-28 and guards against T-03-02-03 (spoofing byte-identical-output claims).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Engine constructor change cascades to pipeline.ts + 9 test files in Task 2**
- **Found during:** Task 2 (before finishing its commit)
- **Issue:** The plan split the Engine-facade wiring into Task 3, but Task 2's change to the GenerationEngine constructor (adding ProvenanceRepo + ProvenanceWriter as positional args 3 and 4) immediately breaks `src/engine/pipeline.ts` and its transitive test callers. Task 2's acceptance criterion requires `npx tsc -p tsconfig.json --noEmit` to exit 0 — so leaving pipeline.ts unchanged between Task 2 and Task 3 would fail the criterion.
- **Fix:** Updated `src/engine/pipeline.ts` constructor in Task 2 to accept ProvenanceRepo between versionRepo and client; it constructs a ProvenanceWriter internally and forwards both into the GenerationEngine constructor. Also updated `src/server.ts` + 9 test files that construct `new Engine(...)` to pass `new ProvenanceRepo(db)` as the 3rd arg. Task 3's job then became "add the six new facade methods + listByShot" without having to touch the constructor again.
- **Files modified:** `src/engine/pipeline.ts`, `src/server.ts`, `src/__tests__/http-origin.test.ts`, `src/__tests__/transport-parity.test.ts`, `src/engine/__tests__/hierarchy.test.ts`, `src/engine/__tests__/shot-naming.test.ts`, `src/comfyui/__tests__/live-smoke.test.ts`, `src/tools/__tests__/breadcrumb-always.test.ts`, `src/tools/__tests__/error-wrapping.test.ts`, `src/tools/__tests__/generation-tool.test.ts`, `src/tools/__tests__/input-bounds.test.ts`
- **Verification:** `npx tsc -p tsconfig.json --noEmit` exits 0; 430/430 (+ 1 skip) tests green.
- **Committed in:** `6144f51` (Task 2 commit includes all 11 cascading updates)

**2. [Rule 3 - Blocking] FakeComfyUIClient needs a fetchResolvedPrompt mirror**
- **Found during:** Task 2 (when writing the first completed-event provenance test)
- **Issue:** The real `ComfyUIClient.fetchResolvedPrompt` reads a PNG from disk. Engine tests that exercise `downloadAndPersist` need to drive both the captured-blob branch and the null-blob branch without putting real PNG files on disk per test. The FakeComfyUIClient from Phase 2 had no equivalent method.
- **Fix:** Added `cannedPromptBlob: Record<string, unknown> | null = null` field + `async fetchResolvedPrompt(pngPath): Promise<Record<string, unknown> | null>` method to `FakeComfyUIClient`. The fake method records the call and returns the canned blob regardless of path. Tests assign `fake.cannedPromptBlob = {...}` to exercise the captured-blob branch; default null exercises the PROVENANCE_UNAVAILABLE-reserve path. `reset()` clears the canned blob alongside the other state.
- **Files modified:** `src/test-utils/fake-comfyui-client.ts`
- **Verification:** All generation.test.ts tests (existing + new) pass; no changes to real-client behaviour or to `png-metadata.test.ts` / `client.test.ts` coverage.
- **Committed in:** `6144f51` (Task 2 commit — the fake is a test-support delta)

**3. [Rule 3 - Blocking] generation.test.ts C6 poller-cap test constructs GenerationEngine directly**
- **Found during:** Task 2
- **Issue:** Line 522+ of `generation.test.ts` constructs a dedicated GenerationEngine (outside the shared setup()) with `maxConcurrentPollers: 3` to test the C6 concurrency cap. That inline construction used the old 6-arg signature and needed to move to the new 8-arg signature.
- **Fix:** Created a local ProvenanceRepo + ProvenanceWriter pair inside the test's `try` scaffold and passed them as the 3rd and 4th positional args.
- **Files modified:** `src/engine/__tests__/generation.test.ts`
- **Verification:** C6 test still passes (10s runtime — real timers, status delay = 150ms, 10 rows drain at cap=3).
- **Committed in:** `6144f51` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking issues required to keep TypeScript green + test suite green through the Task 2 constructor change).
**Impact on plan:** None — all three are compile-time / test-infrastructure necessities. No scope creep, no architectural deviations. LANDMINE #1 (submitGeneration signature preserved), LANDMINE #3 (fetchResolvedPrompt takes path), LANDMINE #8 (lineage at INSERT), and LANDMINE #10 (no new engine class) all hold. Threat model T-03-02-01 through T-03-02-08 mitigations are in place structurally (see grep assertions in acceptance criteria: zero `setLineage`, zero `UPDATE.*provenance`, zero `@modelcontextprotocol` in engine/).

## Issues Encountered

- **FakeComfyUIClient extension was the cleanest option.** The plan suggested either extending the shared fake OR using `vi.spyOn(ctx.fake, 'fetchResolvedPrompt')` per test. Extending the shared fake won on ergonomics — tests read `fake.cannedPromptBlob = {...}` as one assignment, and `reset()` unifies teardown. No tests needed the spy approach.

## User Setup Required

None — the plan is pure engine/store/comfyui-client composition. No new env vars, no new migrations (Plan 01 already landed 0003), no new services. Live-smoke provenance validation (which DOES require `COMFYUI_API_KEY`) is Plan 3's Task 03-03-04, not this plan's concern.

## Threat Flags

None. Every surface added in this plan matches the plan's threat_model (T-03-02-01 through T-03-02-08):
- T-03-02-01 (lineage tampering): INSERT-time write, no UPDATE path exists (grep assertion passes).
- T-03-02-02 (prompt blob disclosure): unchanged from Plan 01 policy — blob lives in local SQLite with PNG access profile; stdio-hygiene test (Plan 03) will assert no stdout/stderr leak.
- T-03-02-03 (byte-identical-output spoofing): reproduction_warnings always present; never silently empty in Phase 3.
- T-03-02-04 (iterate DoS): Plan 01's applyOverrides FORBIDDEN_KEYS + non-object-inputs guards remain in force; post-merge validateWorkflowFormat re-runs.
- T-03-02-05 (HTTP in tx): submitInternal's order (insertVersion tx → writeSubmitEvent tx → client.submit NO tx → setJobId tx) explicitly documented in code comments.
- T-03-02-06 (failed-source iterate): D-PROV-24 intentional; validateWorkflowFormat re-runs on merged blob.
- T-03-02-07 (fetchResolvedPrompt path leak): method never throws, returns null on every failure.
- T-03-02-08 (reproduce null-prompt silent fallback): explicit PROVENANCE_UNAVAILABLE throw on `completedEvent.prompt_json === null`.

## Known Stubs

None. Every public method added is fully implemented. The two "not available" strings in `generation.ts` (lines 320, 331) are legitimate error-message hints for PROVENANCE_UNAVAILABLE throws on iterate, not placeholder text.

## Next Phase Readiness

- **Plan 3 (tool surface) is unblocked.** Every engine-layer operation Plan 3 needs is callable from the Engine facade. Plan 3's job is narrow:
  - Register a new `version` MCP tool with a Zod discriminated union for `get | list | diff | provenance` actions; each delegate to the corresponding facade method.
  - Extend `generation-tool.ts` Zod schema to add `reproduce` and `iterate` action arms; delegate to `engine.reproduceVersion` / `engine.iterateFromVersion`.
  - Wire the server registration + envelope mapping per Phase 1 D-25.
- **No open decisions blocking Plan 3.** D-PROV-12 reproduction_warnings shape is finalised (always-present array); D-PROV-15 diff response shape lands verbatim from pure diff.ts; D-PROV-13 iterate input is already the `{ version_id, overrides?, seed?, notes? }` shape the engine method accepts.
- **server.ts wiring is already done** (landed as part of the Task 2 Rule 3 fix). Plan 3 does not need to touch server.ts for provenance plumbing — only to register the new `version` tool.
- **Test count heading into Plan 3:** 430/430 green + 1 intentional skip (live-smoke).

## Self-Check: PASSED

Verified artefacts exist:
- `src/engine/__tests__/pipeline.test.ts` — FOUND (14 tests, all green)
- `src/engine/pipeline.ts` — MODIFIED (6 new methods + loadDiffSnapshot present)
- `src/engine/generation.ts` — MODIFIED (submitInternal / reproduceVersion / iterateFromVersion present)
- `src/comfyui/client.ts` — MODIFIED (fetchResolvedPrompt present; imports readFile + extractTextChunk)
- `src/store/version-repo.ts` — MODIFIED (insertVersion 3rd param + listByShot present)
- `src/test-utils/fake-comfyui-client.ts` — MODIFIED (cannedPromptBlob + fetchResolvedPrompt present)

Verified commits exist:
- `4e4a92e` (Task 1) — FOUND
- `6144f51` (Task 2) — FOUND
- `e4f02bc` (Task 3) — FOUND

Verified invariants:
- `npx tsc -p tsconfig.json --noEmit` — clean (no output = success)
- `npx vitest run` — 430 passed + 1 skipped across 31 test files
- `grep -rn "setLineage\|UPDATE.*provenance" src/ --include="*.ts"` — zero code matches (single hit in `version-repo.ts` is a JSDoc comment explaining WHY we DON'T UPDATE)
- `grep -rn "@modelcontextprotocol" src/engine/ --include="*.ts"` — zero code matches (single hit in `pipeline.test.ts` is the assertion string verifying its own absence)
- `grep -rn "asset_id" src/ --include="*.ts"` — zero matches
- `grep -c "provenanceWriter\.writeSubmitEvent\|provenanceWriter\.writeCompletedEvent\|provenanceWriter\.writeFailedEvent\|async reproduceVersion\|async iterateFromVersion\|submitInternal" src/engine/generation.ts` — 13+ matches (all expected call sites present)
- `grep -c "getVersion\|listVersionsForShot\|getProvenance\|diffVersions\|reproduceVersion\|iterateFromVersion\|pureDiffVersions\|loadDiffSnapshot\|new ProvenanceWriter" src/engine/pipeline.ts` — 19 matches (constructor + 6 facade methods + private helper)

---
*Phase: 03-provenance-versioning*
*Completed: 2026-04-22*
