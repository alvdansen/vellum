---
phase: 05-web-dashboard
plan: 02
subsystem: engine
tags: [event-emitter, sse, downloader, typed-events, non-fatal, preact-dashboard]
dependency_graph:
  requires:
    - "phase-05 Plan 01 — FakeEngine.events field (narrowed here from EventEmitter to EngineEmitter)"
    - "phase-05 Plan 01 — buildStackWithOutputs() tmp-dir Engine stack for output-downloader tests"
    - "phase-05 Plan 01 — OUTPUT_UNAVAILABLE typed error code (reserved; not thrown in this plan)"
  provides:
    - "src/engine/events.ts — EngineEmitter + EngineEventMap (5 typed payloads) + createEngineEmitter factory"
    - "src/engine/output-downloader.ts — downloadOutput() non-fatal helper"
    - "Engine.events public field — SSE handler subscribes via engine.events.onEvent<T>"
    - "Engine mutation paths emit typed events: hierarchy.created x4, version.created x3, version.status_changed x1, tag.changed x2, metadata.changed x2 (NO value field, T-5-02)"
    - "Dashboard-stable download hook: Engine.getGenerationStatus writes outputsDir/versionId/<first-filename> on completion (D-WEBUI-26, non-fatal)"
    - "FakeEngine.events narrowed to EngineEmitter (no runtime change, SSE tests in Plan 03 get typed onEvent calls)"
  affects:
    - "Plan 05-03 (HTTP routes + SSE handler): subscribes to engine.events"
    - "Plan 05-04 (static mount + server.ts): /api/versions/:id/output reads outputsDir/versionId/filename"
    - "Plan 05-05+ (dashboard components): real-time updates driven by these events"
tech_stack:
  added: []
  patterns:
    - "Typed event emitter as EventEmitter subclass — generic emitEvent/onEvent/offEvent wrappers preserve structural compatibility with EventEmitter while giving SSE handler + tests type-safe subscription"
    - "Emit-after-success pattern — every mutation path emits AFTER the DB/delegate call returns, so a subscriber never sees a phantom version before it's readable"
    - "Fire-and-forget non-fatal download hook — void downloadOutput(...).catch(() => {}) inside getGenerationStatus; belt-and-suspenders with downloadOutput's internal try/catch"
    - "Status transition detection — getGenerationStatus wrapper captures pre-call row status, diffs against post-call, emits version.status_changed only on change"
    - "T-5-02 payload sanitisation — MetadataChangedPayload type deliberately omits `value`; type-level safety + runtime assertion in tests"
key_files:
  created:
    - src/engine/events.ts
    - src/engine/output-downloader.ts
    - src/engine/__tests__/events.test.ts
    - src/engine/__tests__/output-downloader.test.ts
    - src/engine/__tests__/pipeline-events.test.ts
  modified:
    - src/engine/pipeline.ts (imports + events field + outputRoot capture + nowIso + 12 emitEvent calls across 8 mutation paths + downloadOutput hook inside getGenerationStatus)
    - src/test-utils/fake-engine.ts (EventEmitter → EngineEmitter import + field narrow)
decisions:
  - "[Plan 05-02] Download hook lives inside Engine.getGenerationStatus wrapper (pipeline.ts), not inside GenerationEngine.downloadAndPersist (generation.ts). Rationale: generation.ts has zero events/emit surface; keeping the dashboard-stable download hook on the Engine facade preserves the existing VFX-structured download path untouched while adding the dashboard-stable versionId-keyed download as an additive second write. Both paths read from the same outputsDir root."
  - "[Plan 05-02] getGenerationStatus uses before/after status diff (versionRepo.getVersion before the delegate call) to decide when to emit version.status_changed. Emitting on every call would double-fire on terminal-cache hits (D-GEN-31). Diff-driven emission matches the D-WEBUI-06 contract: event fires ONLY on transitions, not on cached reads."
  - "[Plan 05-02] 12 emit calls total (plan required >=7). Extra emit calls: the plan's minimum count assumed one per path; we emit version.created for each of the 3 reproduce/iterate/submit paths (3 events, not 1), and hierarchy.created for each of the 4 create* methods (4 events, not 1)."
  - "[Plan 05-02] FakeComfyUIClient.cannedPromptBlob preloaded in pipeline-events test setup so reproduce/iterate paths walk the completed branch instead of hitting PROVENANCE_UNAVAILABLE. Rule 3 blocking fix — the fake defaults to null and the real completion path writes null prompt_json; tests would have failed with a typed error that has nothing to do with the events-wiring contract under test."
  - "[Plan 05-02] Architecture-purity comments in events.ts + output-downloader.ts phrased as 'MCP SDK imports' (not the sentinel '@modelcontextprotocol/sdk' string) to avoid tripping architecture-purity.test.ts substring grep. Plan 04-03 precedent (STATE.md decisions log line 119)."
  - "[Plan 05-02] downloadOutput resolves destPath via resolve(versionDir, basename(filename)) — basename strip prevents path traversal in case a malicious ComfyUI response supplies a filename with '../'. Non-MITRE belt-and-suspenders; SSRF is already covered by ComfyUIClient.downloadToPath's allowlist."
metrics:
  duration_minutes: 8
  task_count: 2
  file_count: 7
  commits: 4
  tests_added: 24
  tests_passing: 601
  tests_skipped: 2
  completed_date: "2026-04-23"
---

# Phase 5 Plan 2: Typed EngineEmitter + Non-Fatal Output Downloader + Pipeline Event Wiring Summary

**Typed engine event bus and dashboard-stable download hook — every mutation path publishes a T-5-02-safe SSE payload; markCompleted triggers a fire-and-forget download into versionId-keyed output tree.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-23T19:14:06Z
- **Completed:** 2026-04-23T19:23:12Z
- **Tasks:** 2 (TDD RED → GREEN → GREEN each)
- **Files created:** 5
- **Files modified:** 2

## Accomplishments

- **EngineEmitter + 5 payload types** published in `src/engine/events.ts`. `MetadataChangedPayload` omits `value` at the type level (T-5-02 mitigation). `createEngineEmitter()` raises maxListeners to 100 for multi-SSE-client scale.
- **Non-fatal `downloadOutput()`** in `src/engine/output-downloader.ts`. Every failure path returns null after `console.error`; never throws. Delegates to `ComfyUIClient.downloadToPath()` so SSRF guard + byte cap + bearer auth + allowlist are reused (T-5-03 mitigation).
- **Engine facade wired** with 12 `emitEvent` calls across 8 mutation paths (plan required >= 7). `Engine.events` is a public readonly `EngineEmitter`. `getGenerationStatus` detects status transitions via a before/after `versionRepo.getVersion()` diff and fires `version.status_changed` only on change.
- **Dashboard-stable download hook** inside `Engine.getGenerationStatus`. When the row transitions to `completed` and `outputs_json` was populated by `GenerationEngine.downloadAndPersist`, we fire `void downloadOutput(this.client, versionId, outputsDir, firstFilename).catch(() => {})` — write to `outputsDir/versionId/<filename>`, fire-and-forget, non-fatal.
- **FakeEngine.events narrowed** from `EventEmitter` to `EngineEmitter`. Zero runtime change (subclass compatibility); Plan 03 SSE tests get typed `.onEvent()` calls for free.
- **24 new tests** across 3 files (events: 6, output-downloader: 5, pipeline-events: 13). Full suite: **601 passed | 2 skipped** (up from 577 baseline). Zero `tsc` errors. Architecture-purity still green.

## Task Commits

1. **Task 1 RED** — `178e80c` `test(05-02): add failing tests for EngineEmitter + output-downloader (RED)`
2. **Task 1 GREEN** — `8667f79` `feat(05-02): implement EngineEmitter + non-fatal output-downloader (GREEN)`
3. **Task 2 RED** — `18ebc95` `test(05-02): add failing pipeline-events tests for 8 mutation paths (RED)`
4. **Task 2 GREEN** — `68772de` `feat(05-02): wire Engine facade to emit typed events on 8 mutation paths (GREEN)`

_Task 1 and Task 2 each went RED → GREEN; no REFACTOR commits needed — both implementations were minimal on first pass and stayed in-budget for the existing architecture-purity + single-responsibility checks._

## Files Created / Modified

### Created

- `src/engine/events.ts` — `EngineEmitter` class, `EngineEventMap`, 5 payload interfaces (`VersionStatusChangedPayload`, `VersionCreatedPayload`, `TagChangedPayload`, `MetadataChangedPayload` — no `value` field, `HierarchyCreatedPayload`), `createEngineEmitter()` factory (maxListeners=100).
- `src/engine/output-downloader.ts` — `downloadOutput(client, versionId, outputsDir, filename, opts?)` — mkdir + delegate to `ComfyUIClient.downloadToPath`, return null on any failure with stderr log.
- `src/engine/__tests__/events.test.ts` — 6 assertions: emitEvent roundtrip, offEvent removal, T-5-02 no-`value` runtime check, maxListeners >= 100, 5-event type coverage, emitEvent return value.
- `src/engine/__tests__/output-downloader.test.ts` — 5 assertions: happy-path writes file, client=null returns null + logs, `download-hopeless` scenario returns null, mkdir-before-write invariant, typed DOWNLOAD_FAILED caught without rethrow.
- `src/engine/__tests__/pipeline-events.test.ts` — 13 assertions covering every D-WEBUI-29 emit path: `engine.events` is EngineEmitter; `submitGeneration`/`reproduceVersion`/`iterateFromVersion` emit `version.created`; `getGenerationStatus` emits `version.status_changed=completed`; `addTag`/`removeTag` emit `tag.changed`; `setMetadata`/`removeMetadata` emit `metadata.changed` and the payload does NOT contain `value`; `createWorkspace`/`createProject`/`createSequence`/`createShot` emit `hierarchy.created` with correct `entity_type` and `parent_id`.

### Modified

- `src/engine/pipeline.ts`:
  - Imports: added `createEngineEmitter, type EngineEmitter` from `./events.js` and `downloadOutput` from `./output-downloader.js`.
  - Fields: added `public readonly events: EngineEmitter` and `private readonly outputRoot: string`.
  - Constructor: captures `outputRoot`, calls `createEngineEmitter()`.
  - `nowIso()` private helper centralises ISO timestamp.
  - Mutation methods extended with `emitEvent` calls (emit-after-success):
    - `createWorkspace` → `hierarchy.created` (parent_id=null) — **pipeline.ts:148**
    - `createProject` → `hierarchy.created` (parent_id=workspaceId) — **pipeline.ts:196**
    - `createSequence` → `hierarchy.created` (parent_id=projectId) — **pipeline.ts:239**
    - `createShot` → `hierarchy.created` (parent_id=sequenceId) — **pipeline.ts:282**
    - `submitGeneration` → `version.created` — **pipeline.ts:333**
    - `getGenerationStatus` → `version.status_changed` + fire-and-forget `downloadOutput` — **pipeline.ts:353..381**
    - `reproduceVersion` → `version.created` — **pipeline.ts:553**
    - `iterateFromVersion` → `version.created` — **pipeline.ts:568**
    - `addTag` → `tag.changed` (action='add') — **pipeline.ts:586**
    - `removeTag` → `tag.changed` (action='remove') — **pipeline.ts:599**
    - `setMetadata` → `metadata.changed` (action='set', no `value`) — **pipeline.ts:619**
    - `removeMetadata` → `metadata.changed` (action='remove', no `value`) — **pipeline.ts:631**
  - Total: **12 `this.events.emitEvent` calls** (plan verification required `>= 7`).
- `src/test-utils/fake-engine.ts`:
  - Import: `EventEmitter from 'node:events'` → `EngineEmitter from '../engine/events.js'`.
  - Field: `public readonly events: EventEmitter = new EventEmitter()` → `public readonly events: EngineEmitter = new EngineEmitter()`.
  - JSDoc updated to reflect the narrowed type; `reset()` unchanged (`removeAllListeners` inherited from EventEmitter).

## Decisions Made

- **Download hook on pipeline.ts, not generation.ts.** `GenerationEngine` has no events/emit surface and no knowledge of the dashboard. Keeping the dashboard-stable download as a separate Engine-facade hook preserves generation.ts's existing VFX-structured download path (`outputsDir/projectName/seqName/shotName/versionLabel/filename`) untouched, while adding the simpler `outputsDir/versionId/filename` path the dashboard needs for `/api/versions/:id/output`. Both writes, same root.
- **Before/after status diff for `version.status_changed`.** `getGenerationStatus` terminal-row reads are cached (D-GEN-31) — firing on every call would double-emit on cached hits. Capturing `before = versionRepo.getVersion(id)?.status` before the delegate call and comparing to `after = result.entity.status` emits ONLY on transitions, which matches D-WEBUI-06's contract.
- **12 emit calls, not the plan's minimum of 7.** Plan counted paths (5 categories) rather than call sites (8 methods × some cover multiple emits). Every path in D-WEBUI-29 got its dedicated emit, with `hierarchy.created` and `version.created` each wired on all their respective call sites (4 + 3).
- **`value` omission defence-in-depth.** T-5-02 lives at three layers now: (a) TypeScript type definition in events.ts deliberately omits the field; (b) NOTE comment in the type body documents the rule; (c) runtime test asserts `expect(payload).not.toHaveProperty('value')` on both `setMetadata` and `removeMetadata` emit paths.
- **Architecture-purity comment phrasing.** Wrote "Zero MCP SDK imports (enforced by architecture-purity.test.ts substring grep)" instead of the sentinel package name. Plan 04-03 established this convention; the test greps `@modelcontextprotocol/sdk` against file text, and docstrings that recite the sentinel false-positive the check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Architecture-purity false positive on sentinel string in comments**
- **Found during:** Task 1 GREEN — initial events.ts/output-downloader.ts comments referenced the MCP SDK package name verbatim to document the purity invariant. `architecture-purity.test.ts` greps file text for that exact string, so any mention (even in a comment asserting the invariant) fires the assertion.
- **Investigation:** STATE.md decisions log line 119 records the Plan 04-03 convention: use "MCP SDK imports" in docstrings, never the sentinel package string. The grep is substring match; surface-level distinction was already invented for this exact scenario.
- **Fix:** Rewrote the two offending comments in events.ts + output-downloader.ts to use "MCP SDK imports" phrasing. No functional change.
- **Files modified:** `src/engine/events.ts`, `src/engine/output-downloader.ts`
- **Verification:** `npx vitest run src/__tests__/architecture-purity.test.ts` — 10/10 green.
- **Committed in:** `8667f79` (Task 1 GREEN commit).

**2. [Rule 3 - Blocking] Reproduce/iterate path threw PROVENANCE_UNAVAILABLE in test setup**
- **Found during:** Task 2 first GREEN run — `pipeline-events.test.ts > reproduceVersion emits version.created` + `iterateFromVersion emits version.created` both failed with `TypedError: Version 'ver_XXX' has no resolved prompt blob`.
- **Investigation:** `FakeComfyUIClient.cannedPromptBlob` defaults to `null`. Setup submits a version and drives `getGenerationStatus` which completes via `downloadAndPersist` → writes `completed` provenance event with `prompt_json: null` (because `client.fetchResolvedPrompt()` returns the canned null). Reproduce/iterate both read that provenance row and see null prompt_json → throw PROVENANCE_UNAVAILABLE. This is a test-infrastructure gap, not a pipeline.ts wiring bug.
- **Fix:** In the test's `setup()` helper, assign `stack.client.cannedPromptBlob = {...}` before submitting so the completion path writes a real prompt_json, enabling reproduce/iterate to walk the happy path.
- **Files modified:** `src/engine/__tests__/pipeline-events.test.ts`
- **Verification:** All 13 pipeline-events tests green.
- **Committed in:** `68772de` (Task 2 GREEN commit).

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking).
**Impact on plan:** Both auto-fixes necessary to complete Task 1 / Task 2 verification. No scope creep — the wiring contract, emit call shape, and payload-type definitions all match the plan's `<behavior>` and `<action>` sections verbatim.

## Issues Encountered

- **Download-hook race in pipeline-events tests (cosmetic stderr).** The fire-and-forget `downloadOutput` call inside `getGenerationStatus` can survive test cleanup — `afterEach` calls `stack.cleanup()` which rms the tmp outputsDir before the download's `createWriteStream` opens `destPath.partial`. The download fails (ENOENT), returns null via the non-fatal path, and logs to stderr. Tests still pass because the contract is "never throw"; the stderr noise is cosmetic. This is the INTENDED behaviour of the non-fatal path — intentional noise in a shutdown race is preferable to suppressing legitimate download failure visibility in production.

## Auth Gates

None. This plan ships pure engine-layer wiring with zero external API calls beyond the existing (fake) ComfyUI client path.

## Known Stubs

None. `output-downloader.ts` is a real implementation. `events.ts` is a real typed wrapper. `pipeline.ts` wiring calls real methods on real instances. No placeholder data, no TODOs, no "coming soon" markers.

## Threat Flags

No new threat surface introduced beyond what's already in the plan's `<threat_model>`. All documented mitigations hold:

- **T-5-02 (Information Disclosure / metadata value in events):** MetadataChangedPayload type definition in events.ts omits `value`. `setMetadata` + `removeMetadata` emit calls in pipeline.ts never reference `value`. Runtime test in events.test.ts asserts the payload object does NOT contain the key "value". Runtime tests in pipeline-events.test.ts assert the same on both setMetadata and removeMetadata emit paths.
- **T-5-03 (SSRF via output downloader):** `output-downloader.ts` issues zero raw `fetch()` calls. `downloadOutput` delegates to `client.downloadToPath()`, which reuses the Phase 2 ComfyUI HTTP pipeline: bearer auth (env-sourced, not user-supplied), redirect:'manual' on signed URLs, byte cap (DEFAULT_DOWNLOAD_MAX_BYTES = 500 MiB), allowlisted base URL. Confirmed via `grep -n "fetch\\|new Request\\|undici" src/engine/output-downloader.ts` → 0 matches.

## Plan 03 / Plan 04 Handoff Note

**Plan 03** (HTTP routes + SSE) now has a typed `engine.events.onEvent<T>('type', cb)` surface. Tests can drive `FakeEngine.events.emitEvent('type', payload)` with full TypeScript inference — no untyped shims required. The SSE handler at `src/http/sse.ts` (Plan 03) should:

1. Subscribe to all 5 event types via `engine.events.onEvent('version.status_changed', ...)`, etc.
2. Write each received payload as `data: <JSON.stringify(payload)>\n\n` to the SSE response (D-WEBUI-03).
3. On connection close, call `engine.events.offEvent('type', listener)` for every subscribed type (D-WEBUI-29 listener cleanup).
4. Payload passes through unchanged — no filtering, no value-field leak (the type doesn't have one).

**Plan 04** (static mount + server.ts wiring) now has `outputsDir/versionId/<filename>` populated on every successful generation completion. The `GET /api/versions/:id/output` handler can:

1. Read `Engine.getVersion(id)` to find the first filename from `outputs_json`.
2. `fs.createReadStream(resolve(outputsDir, id, basename(filename)))`.
3. On `ENOENT` or empty `outputs_json` → 404 with `TypedError('OUTPUT_UNAVAILABLE', ...)` (reserved by Plan 05-01, D-WEBUI-34).

No further engine-layer work needed for either plan; the surface is frozen.

## Verification Evidence

- `npx vitest run src/engine/__tests__/events.test.ts src/engine/__tests__/output-downloader.test.ts src/engine/__tests__/pipeline-events.test.ts` — **24 passed** (0 skipped, 0 failed).
- `npx vitest run src/engine/__tests__/` — **216 passed** (up from 192 baseline; 24 new tests).
- `npx vitest run` (full root) — **601 passed | 2 skipped** (up from 577 baseline).
- `npx tsc --noEmit` — zero errors.
- `grep -c "this.events.emitEvent" src/engine/pipeline.ts` — **12** (>=7 required).
- `grep "EngineEmitter" src/test-utils/fake-engine.ts | head -3` — matches, events field narrowed.
- `npx vitest run src/__tests__/architecture-purity.test.ts` — 10/10 green (no MCP SDK imports leak into engine).

## Self-Check: PASSED

All created files verified on disk:

- `src/engine/events.ts` — FOUND
- `src/engine/output-downloader.ts` — FOUND
- `src/engine/__tests__/events.test.ts` — FOUND
- `src/engine/__tests__/output-downloader.test.ts` — FOUND
- `src/engine/__tests__/pipeline-events.test.ts` — FOUND

All commits verified in git log:

- `178e80c` — FOUND (Task 1 RED)
- `8667f79` — FOUND (Task 1 GREEN)
- `18ebc95` — FOUND (Task 2 RED)
- `68772de` — FOUND (Task 2 GREEN)

---

*Phase: 05-web-dashboard*
*Plan: 02*
*Completed: 2026-04-23*
