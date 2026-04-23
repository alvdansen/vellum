---
phase: 03-provenance-versioning
plan: 03
subsystem: mcp-tools
tags: [mcp, tools, zod, discriminated-union, reproduce, iterate, version, provenance, comfyui, live-smoke]

# Dependency graph
requires:
  - phase: 03-provenance-versioning
    plan: 02
    provides: Engine facade +6 methods (getVersion/listVersionsForShot/getProvenance/diffVersions/reproduceVersion/iterateFromVersion), VersionRepo.listByShot, ProvenanceRepo wired through server.ts, IterateOverride type, reproduction_warnings contract (always non-empty per D-PROV-28)
  - phase: 03-provenance-versioning
    plan: 01
    provides: DiffResponse shape (D-PROV-15), ProvenanceEvent type, ErrorCode union (PROVENANCE_UNAVAILABLE/REPRODUCE_BLOCKED/ITERATE_INVALID_PATCH/VERSION_NOT_COMPLETED)
  - phase: 02-comfyui-generation
    provides: registerGeneration 2-arm (submit/status) discriminated union, shapeVersionEntity helper, toolOk/toolError envelope, FakeComfyUIClient test harness, live-smoke gate pattern (COMFYUI_API_KEY + RUN_LIVE_SMOKE=1)
  - phase: 01-foundation-hierarchy
    provides: shapeList, shapeCreateOrGet, MAX_ID_LENGTH/MAX_PAGE_SIZE/DEFAULT_PAGE_SIZE/MAX_NOTES_LENGTH, RT-01 all-optional raw ZodRawShape pattern, RT-02 handler-side discriminated-union re-validate, D-25 content[0].text ↔ structuredContent JSON parity, architecture-purity + tool-budget cross-cutting tests, buildServer factory

provides:
  - src/tools/version-tool.ts NEW — `version` MCP tool with get/list/diff/provenance actions (209 lines)
  - src/tools/generation-tool.ts EXTENDED — 2-arm → 4-arm discriminated union; reproduce + iterate actions delegate to Engine facade
  - src/tools/index.ts — registerVersion re-export; header updated to "Phase 3 budgets 6 of 12 tools"
  - src/server.ts — registerVersion(server, engine) call in buildServer; instructions string lists all 6 tools + reproduce/iterate + get/list/diff/provenance
  - src/__tests__/tool-budget.test.ts — assertion updated from 5 to 6; new tool-name-set assertion = [generation, project, sequence, shot, version, workspace] (sorted); portable readFile + multi-line regex replacement for grep name capture
  - src/tools/__tests__/version-tool.test.ts NEW — 382-line direct-mirror suite (15 tests across 5 describe blocks: get × 4, list × 3, diff × 3, provenance × 3, Zod invariants × 2)
  - src/tools/__tests__/generation-tool.test.ts EXTENDED — +14 new tests (reproduce × 7, iterate × 9 including D-PROV-13 `patch` regression guard); invokeReproduce/invokeIterate helpers mirror tool handler shape; buildStack returns provenanceRepo + provenanceWriter for source seeding
  - src/comfyui/__tests__/live-smoke.test.ts EXTENDED — second test inside the existing describe.skipIf(SKIP) block: submit → poll → reproduce → poll → deep-equal prompt_json; reuses beforeEach/afterEach for tempDb + tempOutputRoot; poll budget 180s per phase, outer timeout 420s (2× Phase 2)

affects:
  - 04-asset-management (asset/collection/search tools will register against the same server factory; tool-budget assertion pattern reusable when count bumps from 6→N)
  - 05-web-dashboard (version tool get/list/diff/provenance actions are the agent-facing surface the dashboard will mirror; reproduction_warnings shape is the UI's honesty contract for the Phase 3 deferred-checksums state)

# Tech tracking
tech-stack:
  added: []  # pure composition over existing Phase 1/2 stack (MCP SDK 1.29, Zod v4, Vitest)
  patterns:
    - Thin-delegator tool layer (RT-01 all-optional raw ZodRawShape + RT-02 handler-side discriminated-union re-validate; every action → exactly one engine call; zero business logic at tool)
    - Pass-through shaper for already-flattened engine responses (diffVersions returns breadcrumb already flattened; shaper forwards verbatim, no re-flattening)
    - Layered-always-on response field pattern: ReproduceInput response spreads shapeVersionEntity envelope, then unconditionally appends `reproduction_warnings: string[]` at top level (D-PROV-28 honesty; never omitted, never silently empty in Phase 3)
    - Direct-mirror test helper per tool action (invokeGet/invokeList/invokeDiff/invokeProvenance/invokeReproduce/invokeIterate): reproduces handler body verbatim for unit tests because MCP SDK's registered handler is private
    - Extension-in-place for existing tools (EXTEND generation-tool.ts 2-arm → 4-arm discriminated union with SubmitInput/StatusInput preserved in order; EXTEND live-smoke.test.ts under existing describe.skipIf gate; EXTEND generation-tool.test.ts with new describe blocks; no duplicate files)
    - Portable tool-name discovery (readFile + multi-line `server\.registerTool\(\s*'name'` regex with `/gs` flag — replaces GNU-only `grep -Pzo` and survives the SDK's multi-line call shape)

key-files:
  created:
    - src/tools/version-tool.ts
    - src/tools/__tests__/version-tool.test.ts
    - .planning/phases/03-provenance-versioning/03-03-SUMMARY.md
  modified:
    - src/tools/generation-tool.ts (+80 / -5 lines: discriminated union extended, raw ZodRawShape gains overrides+seed, description updated, reproduce/iterate handler cases)
    - src/tools/index.ts (+3 / -1 lines: registerVersion export; header to 6/12)
    - src/server.ts (+16 / -8 lines: registerVersion call in buildServer; instructions lists 6 tools + reproduce/iterate + get/list/diff/provenance)
    - src/__tests__/tool-budget.test.ts (+47 / -9 lines: count 5→6; name-set assertion; portable regex)
    - src/tools/__tests__/generation-tool.test.ts (+315 / -3 lines: invokeReproduce/invokeIterate helpers + reproduce (7) + iterate (9) describe blocks)
    - src/comfyui/__tests__/live-smoke.test.ts (+108 / -0 lines: second test inside existing describe.skipIf(SKIP))

key-decisions:
  - "D-PROV-28 reproduction_warnings is a top-level field layered AFTER shapeVersionEntity (spread first, then `reproduction_warnings`). Keeps the existing envelope shape (entity / breadcrumb / breadcrumb_text) byte-stable AND guarantees the honesty field is always the last key. Missing key is a bug; empty array is the honest default (Phase 3 has no model checksums)."
  - "No VersionService / ProvenanceService class. Engine facade (from Plan 02) already exposes getVersion/listVersionsForShot/getProvenance/diffVersions/reproduceVersion/iterateFromVersion — the tool layer's job per Phase 1 D-33 is thin Zod validation + delegation. Inventing a service class would duplicate the facade and violate architecture-purity."
  - "NO JSON-Patch `patch` field on iterate. CONTEXT.md D-PROV-13 locks the shape as `overrides: Record<string, { inputs?, class_type? }>` with optional `seed: number` convenience shortcut. A D-PROV-13 regression test in generation-tool.test.ts explicitly asserts that a `patch:[...]` key on input is silently dropped by Zod (discriminated union rejects unknown fields via structural typing)."
  - "Tool layer has ZERO status branching on iterate. Engine branches internally on source.status (D-PROV-24: completed → prompt_json; failed → workflow_json; submitted/running → VERSION_NOT_COMPLETED). The tool just passes version_id + overrides + seed + notes through to engine.iterateFromVersion — keeps the tool layer honest and centralizes the behavior contract in the engine."
  - "Live-smoke extension lives in the SAME file under the existing describe.skipIf(SKIP) block — not a new file. Shared beforeEach/afterEach for tempDb + tempOutputRoot; shared MINIMAL_WORKFLOW fixture; one gate to maintain. Deep-equal (not byte-identity) for prompt_json because the PNG tEXt encoder may normalize whitespace; byte-identity is logged to stderr as observed evidence for follow-up."
  - "Tool-budget test switched from single-line grep to readFile + multi-line `/server\\.registerTool\\(\\s*'([a-z_-]+)'/gs` regex. Reason: the SDK call signature spreads the name literal to a separate line in all tool files (to keep the signature readable), so a single-line grep couldn't match and the previous assertion passed vacuously. Portable across BSD/GNU grep."
  - "Tool description strings mention D-PROV-28 reproduction_warnings explicitly. Agents inspecting the tool catalog need to know the field is always present (empty array is the default honest state in Phase 3, not an omitted key). Surfacing this in the description is discoverability, not documentation."

patterns-established:
  - "Tool layer is thin delegator (Phase 1 D-33 reinforced). If you find yourself writing business logic in a tool handler, that logic belongs in the engine facade. Repeat for each new tool added in Phase 4+."
  - "Always reuse existing shape helpers (shapeList, shapeCreateOrGet) plus a minimal pass-through shaper for response envelopes. Never re-invent breadcrumb flattening — the engine facade may return already-flattened breadcrumbs (diffVersions does) and a pass-through shaper is correct; or nested breadcrumbs (getVersion does) and a flatten-to-entries shaper is correct. Match the shape at the engine boundary."
  - "When extending an existing tool with new actions: the raw ZodRawShape (RT-01) grows with .optional() fields for every new parameter; the strict discriminated union grows in the handler-side parse() call. NEVER use the strict schema as the raw shape — the SDK's pre-handler validation will short-circuit the handler's ZodError catch branch (Phase 2 regression documented)."
  - "Layered optional response fields: spread the base shape first, then append conditional/always-on fields at the top level of the object literal. D-PROV-28 reproduction_warnings is the canonical example; Phase 4 asset tags and Phase 5 SSE progress fields will follow the same layering pattern."
  - "Direct-mirror test helpers (invoke<Action>) replicate the handler body per action for unit tests because the MCP SDK's registered handler is private. Keeps test scope tight and lets tests exercise individual Zod arms without going through the full server.registerTool → server.callTool round-trip. Complemented by the integration-level smoke test that exercises real registration."

requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06]

# Metrics
duration: 12min
completed: 2026-04-22
---

# Phase 3 Plan 3: MCP Surface — Version Tool + Generation Reproduce/Iterate Summary

**New `version` MCP tool (get/list/diff/provenance) + extended `generation` tool (reproduce/iterate) + live-smoke reproduce round-trip — closes PROV-01..PROV-06 at the agent boundary with tool budget at exactly 6 of 12**

## Performance

- **Duration:** ~12 min (first 03-03 commit 19:12:37 → last 19:24:28, plus UAT approval closeout)
- **Started:** 2026-04-23T02:12:37Z
- **Completed:** 2026-04-23T02:24:28Z (task commits); closeout 2026-04-23T02:43:00Z after UAT approval
- **Tasks:** 5 (4 auto + 1 UAT checkpoint, approved)
- **Files modified:** 8 (2 source new/extended + 3 registry/server extended + 3 test files)

## Accomplishments

- **`version` MCP tool lands with 4 actions** — get (cheap metadata with version_label + 5-entry breadcrumb), list (paginated version_number DESC + total_count), diff (D-PROV-15 five-category shape with deterministic summary), provenance (full chronological event timeline including heavy workflow_json/prompt_json/models_json). Every action → exactly one Engine facade call. Zero business logic at the tool layer.
- **`generation` tool extended from 2 arms to 4 arms** — submit/status preserved in order; reproduce + iterate added. Reproduce response always carries `reproduction_warnings: string[]` per D-PROV-28. Iterate accepts `overrides: Record<nodeId, { inputs?, class_type? }>` + optional `seed: number` shortcut; NO JSON-Patch `patch` field anywhere.
- **Tool budget at exactly 6 of 12** — tool-budget.test.ts asserts count == 6 AND name-set == `[generation, project, sequence, shot, version, workspace]` (sorted). Portable readFile + multi-line regex replaces the single-line grep that was passing vacuously.
- **Server wiring complete** — server.ts calls `registerVersion(server, engine)` inside `buildServer`; instructions string lists all 6 tools plus reproduce/iterate and get/list/diff/provenance actions. Both stdio and HTTP transports expose the same 6 tools in lockstep (single factory).
- **Live-smoke reproduce round-trip added** — second test inside the existing describe.skipIf(SKIP) block: submit → poll → reproduce → poll → deep-equal prompt_json. Asserts lineage_type=reproduce, parent_version_id points at source, reproduction_warnings is array, D-PROV-05 PNG tEXt extraction worked end-to-end. Skipped by default (COMFYUI_API_KEY + RUN_LIVE_SMOKE=1 double-gate).
- **462 unit tests green + 2 skipped** (live-smoke double-gate). TypeScript clean.
- **PROV-01..PROV-06 closed at the agent boundary** — agents can now inspect version history, walk provenance timelines, diff versions, reproduce verbatim with drift warnings, and iterate with node-scoped overrides from both completed and failed sources.

## Task Commits

Each task was committed atomically. TDD RED/GREEN split used for Tasks 1 and 2.

1. **Task 03-03-01: Implement `version` MCP tool (TDD)**
   - `d69f491` (test — RED gate: failing tests for all 4 actions)
   - `f9d93c9` (feat — GREEN gate: registerVersion + shapeVersionEntity/Diff/Provenance + registered discriminated union)
2. **Task 03-03-02: Extend `generation` tool with reproduce + iterate (TDD)**
   - `c8b4537` (test — RED gate: +14 tests for reproduce and iterate including D-PROV-13 patch regression guard)
   - `391d21d` (feat — GREEN gate: extended discriminated union 2-arm → 4-arm; reproduce layers reproduction_warnings; iterate passes overrides/seed through)
3. **Task 03-03-03: Wire version tool + tool-budget 5→6**
   - `35be1df` (feat: registerVersion added to index.ts barrel + server.ts buildServer; tool-budget count + name-set assertion; portable regex)
4. **Task 03-03-04: Extend live-smoke with reproduce round-trip**
   - `62152ec` (test: submit → poll → reproduce → poll → deep-equal prompt_json under existing describe.skipIf(SKIP))
5. **Task 03-03-05: UAT — End-to-end provenance via MCP client**
   - APPROVED on the basis of 15/15 protocol-level gates via `verify-phase3-uat.mts` + 462 unit tests + no regression in stdio hygiene. See "UAT Evidence" below.

**Plan metadata:** (this commit) — docs: complete plan + STATE/ROADMAP updates

## Files Created/Modified

### Created
- `src/tools/version-tool.ts` (209 lines) — registerVersion + Zod discriminated union (get | list | diff | provenance) + shapeVersionEntity/shapeProvenanceEnvelope/shapeDiffEnvelope helpers; zero repo or client imports; engine facade delegation only.
- `src/tools/__tests__/version-tool.test.ts` (382 lines) — 15 tests across 5 describe blocks; direct-mirror suite using invokeGet/invokeList/invokeDiff/invokeProvenance helpers mirroring the handler body; seedCompleted helper for provenance-seeded fixtures.

### Modified
- `src/tools/generation-tool.ts` (+80 / -5 lines) — ReproduceInput + IterateInput schemas; 4-arm discriminated union; raw ZodRawShape gains overrides + seed as .optional(); action enum grows to 4 literals; handler cases delegate to engine.reproduceVersion / engine.iterateFromVersion; tool description updated.
- `src/tools/index.ts` (+3 / -1 lines) — `export { registerVersion } from './version-tool.js';`; header comment updated to "Phase 3 budgets 6 of 12 tools" (D-PROV-07).
- `src/server.ts` (+16 / -8 lines) — import registerVersion; call inside buildServer; instructions string lists 6 tools + reproduce/iterate actions on generation + get/list/diff/provenance actions on version. ProvenanceRepo was already wired in Plan 02 Task 03-02-03 Rule-3 cascade; no new repo plumbing here.
- `src/__tests__/tool-budget.test.ts` (+47 / -9 lines) — assertion bumped from toBe(5) → toBe(6); new assertion that name-set equals `[generation, project, sequence, shot, version, workspace]` (alphabetical for stable snapshot); portable readFile + multi-line `/server\.registerTool\(\s*'([a-z_-]+)'/gs` regex replaces single-line grep.
- `src/tools/__tests__/generation-tool.test.ts` (+315 / -3 lines) — buildStack returns provenanceRepo + provenanceWriter for source seeding; seedCompletedSource + seedFailedSource helpers; invokeReproduce + invokeIterate helpers; reproduce describe (7 tests: happy path, JSON parity, VERSION_NOT_COMPLETED, REPRODUCE_BLOCKED, PROVENANCE_UNAVAILABLE, VERSION_NOT_FOUND, INVALID_INPUT); iterate describe (9 tests: overrides merge, seed shortcut, failed-source via workflow_json per D-PROV-24, VERSION_NOT_COMPLETED on submitted/running, ITERATE_INVALID_PATCH on unknown node + 0/>1 KSampler per D-PROV-22/23, VERSION_NOT_FOUND, D-PROV-13 patch-key silently-dropped regression).
- `src/comfyui/__tests__/live-smoke.test.ts` (+108 / -0 lines) — second test inside existing describe.skipIf(SKIP): submit → poll → reproduce → poll → deep-equal prompt_json. Same double-opt-in gate as the Phase 2 submit test. Poll budget 180s per phase; outer Vitest timeout 420s (2× Phase 2). Asserts reproduction_warnings presence, lineage_type='reproduce', parent_version_id points at source.

## Decisions Made

- **reproduction_warnings layered AFTER shapeVersionEntity spread.** The handler does `return toolOk({ ...shapeVersionEntity({...}), reproduction_warnings: result.reproduction_warnings })`. This preserves the existing envelope shape byte-stable AND makes the honesty field the last top-level key. Missing key is a bug; empty array is the honest default in Phase 3 (checksums deferred → warnings always non-empty, but structurally the field is an array either way).
- **No VersionService / ProvenanceService class invention.** Phase 1 D-33 and 03-RESEARCH.md §Architectural Responsibility Map both specify: MCP tool tier = thin Zod validation + delegation; engine facade tier = composition + method surface for tools. Inventing a service class at the tool layer would duplicate the engine facade and violate architecture-purity (grep asserts zero class names in version-tool.ts / generation-tool.ts).
- **NO JSON-Patch `patch` field on iterate.** CONTEXT.md D-PROV-13 locks the iterate shape as node-scoped `overrides: Record<string, { inputs?, class_type? }>` with optional `seed: number`. A regression test asserts that a `patch:[...]` key on input is silently dropped by Zod (the discriminated union rejects unknown fields structurally). Rationale: ComfyUI-native addressing (node ids are the natural key), no RFC 6902 `op/path/value` abstraction layer, cannot introduce prototype pollution since keys are structurally constrained to the source prompt blob.
- **Tool layer has zero status branching on iterate.** Engine branches internally on source.status per D-PROV-24: completed → prompt_json, failed → workflow_json, submitted/running → VERSION_NOT_COMPLETED. The tool passes version_id + overrides + seed + notes through unchanged. Centralizes the behavior contract in the engine; tool stays thin.
- **Live-smoke extension lives in the SAME file under the existing describe.skipIf(SKIP) block.** Shared beforeEach/afterEach for tempDb + tempOutputRoot; shared MINIMAL_WORKFLOW fixture; one gate to maintain. Deep-equal (not byte-identity) assertion on prompt_json because the PNG tEXt encoder may normalize whitespace; byte-identity probe is logged to stderr as observed evidence for follow-up.
- **Tool-budget test uses readFile + multi-line regex for name capture.** SDK's `server.registerTool(` call signature spreads the name literal to a separate line in all tool files (readability convention). Single-line grep couldn't match — the previous test passed vacuously. The `/server\.registerTool\(\s*'([a-z_-]+)'/gs` regex with `/gs` flags makes `.` span newlines and captures name cleanly. Portable across BSD grep (macOS default) and GNU grep.
- **Tool description strings mention D-PROV-28 reproduction_warnings explicitly.** Agents inspecting the tool catalog at startup need to know the field is always present (empty is the default honest state, not an omitted key). Surfacing this in the description is discoverability — the agent's introspection is the first line of self-documentation.

## Deviations from Plan

None — plan executed exactly as written. All 4 automatable tasks (1, 2, 3, 4) landed without Rule 1/2/3 fixes. Task 5 was a checkpoint:human-verify gate; UAT was approved on the basis of the evidence captured below.

## Issues Encountered

- **Tool-budget test was passing vacuously before this plan's rewrite.** Single-line grep for `server\.registerTool\(\s*'([a-z_-]+)'` couldn't capture names because the SDK call spreads the literal to a separate line in every tool file. The test asserted names.length === 0 (or similar) and "passed". The Plan 3 rewrite caught this and replaced the grep with readFile + multi-line regex. Resolved in the same commit that bumped the count to 6 (35be1df).
- **Live-smoke infrastructure drift — NOT a Phase 3 defect.** During UAT driver attempts to exercise the live reproduce round-trip against real ComfyUI Cloud:
  - With `COMFYUI_API_BASE=https://api.comfy.org` (current .env): `POST /api/prompt` returns 404 Not Found.
  - With `COMFYUI_API_BASE=https://cloud.comfy.org` (Phase 2 research default): returns 401 Unauthorized.
  - Diagnosis: the two hosts have diverged since Phase 2 research — either the prompt endpoint moved on api.comfy.org, or the current key was issued against a different host. Captured in project memory as `project_comfy_api_endpoint_drift.md`. See "Known Follow-ups" below.
  - This is pre-existing infrastructure concerning the live endpoint configuration — it predates Plan 03-03 and does not block acceptance. The live-smoke test is double-gated behind `RUN_LIVE_SMOKE=1` and skips cleanly by default; Plan 3 verification does not require it to run.

## UAT Evidence

Task 5 (UAT) was approved by the user on the strength of three classes of evidence:

### 1. Standard test suite: 462 unit tests passing + 2 live-smoke skipped

```
Test Files  31 passed | 1 skipped (32)
Tests       462 passed | 2 skipped (464)
Duration    ~20s
```

`npx tsc -p tsconfig.json --noEmit` exits 0 (TypeScript clean).

### 2. Protocol-level MCP SDK UAT — 15/15 gates passed

An ad-hoc driver `verify-phase3-uat.mts` at the repo root (kept untracked per user preference; user may re-run after the endpoint drift is resolved) exercised the full agent-facing surface via the real MCP SDK client over stdio:

| # | Gate | Result |
|---|------|--------|
| A | `ListTools` returns exactly 6 tools with names `[generation, project, sequence, shot, version, workspace]` | PASS |
| B | `generation` tool description mentions `reproduce`, `iterate`, and `reproduction_warnings` | PASS |
| C | `version` tool description mentions `get`, `list`, `diff`, `provenance` | PASS |
| D | `workspace` action=create through MCP → well-formed entity with `ws_` prefix | PASS |
| E | `project` action=create through MCP → well-formed entity with `proj_` prefix | PASS |
| F | `sequence` action=create through MCP → well-formed entity with `seq_` prefix | PASS |
| G | `shot` action=create through MCP → well-formed entity with `shot_` prefix | PASS |
| H | `version` action=list on empty shot → `{ items: [], total_count: 0, limit: 20, offset: 0 }` | PASS |
| I | `version` action=get with unknown id → typed VERSION_NOT_FOUND envelope | PASS |
| J | `generation` action=reproduce with unknown version_id → typed VERSION_NOT_FOUND envelope | PASS |
| K | `generation` action=iterate with unknown version_id → typed VERSION_NOT_FOUND envelope | PASS |
| L | `version` action=diff with unknown version_ids → typed VERSION_NOT_FOUND envelope | PASS |
| M | `version` action=list without shot_id (Zod failure) → typed INVALID_INPUT envelope | PASS |
| N | stderr hygiene — no COMFYUI_API_KEY, no prompt_json body, no workflow_json body leaked across any handler | PASS |
| O | Startup lines correct — `db=...`, `ComfyUI credentials loaded` (or silent if no key), no WARN lines | PASS |

All 15 gates exercised the live stdio transport via `@modelcontextprotocol/sdk/client/stdio` — this is the same transport path Claude Desktop and every other MCP client uses.

### 3. No regression in stdio hygiene or architecture purity

- `grep -rn "@modelcontextprotocol" src/engine/` — zero matches (architecture-purity invariant preserved).
- `grep -rn "applyPatch|prompt-diff" src/tools/` — zero matches (no JSON-Patch at tool layer).
- `grep -rn "VersionService|ProvenanceService" src/tools/` — zero matches (no class invention).
- `grep -c "patch:" src/tools/version-tool.ts src/tools/generation-tool.ts` — zero matches (no JSON-Patch `patch` field).
- `grep -rn "validateWorkflowFormat" src/tools/` — zero matches (engine owns validation).

## Known Follow-ups

- **ComfyUI Cloud API endpoint drift (pre-existing, not Plan 03-03 caused).** The live ComfyUI Cloud endpoint configuration in `.env` needs reconciling with current Cloud reality:
  - `api.comfy.org` returns 404 on `POST /api/prompt` — prompt endpoint may have moved or been deprecated on that host.
  - `cloud.comfy.org` (Phase 2 research default) returns 401 with the current key — suggests the key was issued against a different host.
  - Action: re-validate Cloud API host + auth against current Cloud docs; update `COMFYUI_API_BASE` and/or re-issue the key; then re-run `verify-phase3-uat.mts` and `RUN_LIVE_SMOKE=1 npx vitest run src/comfyui/__tests__/live-smoke.test.ts` for end-to-end PNG-tEXt-extraction confirmation. Memory: `project_comfy_api_endpoint_drift.md`.
  - Impact on Plan 3 acceptance: zero. Live-smoke is double-gated behind `RUN_LIVE_SMOKE=1` and skips by default; the 15 UAT gates above run against the in-memory FakeComfyUIClient at the engine layer and against a real stdio MCP server at the protocol layer — both paths are Plan-3-complete.
- **`verify-phase3-uat.mts` kept untracked.** User preference: the ad-hoc UAT driver stays at the repo root (not committed) so the user can re-run it after the endpoint drift is resolved. Not a CI gate; not a test-suite addition. The 462 unit tests cover the same behaviors at the unit level.
- **Offset overflow cap (T-03-03-05) and overrides size cap (T-03-03-06) deferred.** Both are defensive DoS limits noted in the plan's threat model. Current Zod shapes cap `limit` at `MAX_PAGE_SIZE` (100) and `notes` at `MAX_NOTES_LENGTH` (4000), but `offset` has no upper bound and `overrides` has no total-size cap. Deferred to a future phase (likely Phase 4 alongside asset search pagination hardening).

## User Setup Required

None for Plan 03-03 acceptance. The live-smoke tests require `COMFYUI_API_KEY` + `RUN_LIVE_SMOKE=1` and are skipped by default; exercising them requires resolving the endpoint drift above.

## Threat Flags

None. Every surface added in this plan matches the plan's threat model (T-03-03-01 through T-03-03-07):
- T-03-03-01 (MCP tool input injection): Zod validation at the boundary; INVALID_INPUT re-wrap on Zod failure per D-PROV-37.
- T-03-03-02 (JSON-Patch prototype pollution): Not applicable — no JSON-Patch shape at all (D-PROV-13). Regression test asserts `patch:[...]` is silently dropped.
- T-03-03-03 (provenance disclosure via tool layer): Tool layer imports zero repo types; engine owns all data access. Stderr hygiene verified by UAT gate N.
- T-03-03-04 (reproduce silent fallback): D-PROV-28 reproduction_warnings always present; Plan 2's engine contract (throws PROVENANCE_UNAVAILABLE on null prompt_json) is surfaced unchanged via toolError.
- T-03-03-05 (offset overflow): deferred (see Known Follow-ups).
- T-03-03-06 (overrides size DoS): deferred (see Known Follow-ups).
- T-03-03-07 (cross-shot diff): engine enforces D-PROV-20 INVALID_INPUT at the pure diff layer; tool forwards unchanged.

## Known Stubs

None. Every field on every tool response is either derived from engine data (entity, breadcrumb, events, changes, summary), forwarded from engine response (reproduction_warnings), or derived from a pure helper (version_label). No placeholder text, no hardcoded empty values, no "coming soon" strings.

## Next Phase Readiness

- **Phase 3 agent-facing surface is complete.** PROV-01..PROV-06 all close at the MCP tool boundary:
  - PROV-01 (full provenance capture) → `version provenance` returns the append-only event timeline.
  - PROV-02 (model names nullable) → `version provenance` returns models_json with nullable checksums per D-PROV-06.
  - PROV-03 (append-only) → Plan 01 enforced structurally in the repo; Plan 3 only reads.
  - PROV-04 (diff) → `version diff` returns the D-PROV-15 five-category shape with deterministic summary.
  - PROV-05 (reproduce) → `generation reproduce` submits the PNG-tEXt-extracted prompt blob verbatim with lineage_type=reproduce and reproduction_warnings always present.
  - PROV-06 (iterate) → `generation iterate` accepts node-scoped overrides + optional seed; succeeds from completed and failed sources; blocks on submitted/running.
- **Phase 3 verification readiness.** STATE.md status is "Phase complete — ready for verification". ROADMAP.md row 3 shows 3/3 Complete after this closeout. Verifier can proceed with the standard phase-completeness checks: architecture-purity, tool-budget, stdio-hygiene, all unit tests green, all three plan summaries present with Self-Check: PASSED.
- **Phase 4 (asset-management) is unblocked.** Tool budget is at 6/12 (headroom for ~6 more tools); extension-in-place pattern proven (generation-tool's 2→4 arm growth); tool-budget test pattern generalizes (readFile + multi-line regex). Asset tool will follow the same Zod discriminated-union + thin-delegator pattern.
- **Phase 5 (web-dashboard) has a clean agent-facing surface to mirror.** The dashboard's version timeline view will call `version list` + `version provenance`; the diff viewer will call `version diff`; the reproduce/iterate buttons will call `generation reproduce/iterate`. The existing endpoints expose everything the UI needs — no dashboard-specific tool additions required.

## Self-Check: PASSED (with UAT approval caveat)

All claimed artefacts exist and all claimed commits are in `git log`.

Verified files exist:
- `src/tools/version-tool.ts` — FOUND (209 lines)
- `src/tools/__tests__/version-tool.test.ts` — FOUND (382 lines)
- `src/tools/generation-tool.ts` — FOUND, EXTENDED (256 lines)
- `src/tools/index.ts` — FOUND, MODIFIED (10 lines)
- `src/server.ts` — FOUND, MODIFIED (309 lines)
- `src/__tests__/tool-budget.test.ts` — FOUND, REWRITTEN (83 lines)
- `src/tools/__tests__/generation-tool.test.ts` — FOUND, EXTENDED (720 lines)
- `src/comfyui/__tests__/live-smoke.test.ts` — FOUND, EXTENDED (314 lines)

Verified commits exist (6 total for Plan 03-03 tasks):
- `d69f491` (Task 1 RED — test: failing test for version MCP tool) — FOUND
- `f9d93c9` (Task 1 GREEN — feat: implement version MCP tool with get | list | diff | provenance) — FOUND
- `c8b4537` (Task 2 RED — test: add reproduce + iterate tests for generation tool) — FOUND
- `391d21d` (Task 2 GREEN — feat: extend generation tool with reproduce + iterate actions) — FOUND
- `35be1df` (Task 3 — feat: wire version tool + bump tool-budget from 5 to 6) — FOUND
- `62152ec` (Task 4 — test: extend live-smoke with reproduce round-trip) — FOUND

Verified invariants:
- `npx tsc -p tsconfig.json --noEmit` — clean (no output = success).
- `npx vitest run` — 462 passed + 2 skipped across 32 test files.
- `grep -rn "@modelcontextprotocol" src/engine/` — zero matches (architecture-purity preserved; only pipeline.test.ts self-checks its own absence via the assertion string).
- `grep -rn "applyPatch|prompt-diff" src/tools/` — zero matches.
- `grep -rn "VersionService|ProvenanceService" src/tools/` — zero matches.
- `grep -c "patch:" src/tools/version-tool.ts src/tools/generation-tool.ts` — zero matches.
- `grep -rn "validateWorkflowFormat" src/tools/` — zero matches.
- Tool-budget test: `expect(registerToolCount()).toBe(6)` and `expect(names).toEqual(['generation', 'project', 'sequence', 'shot', 'version', 'workspace'])` — both PASS.

**UAT approval caveat:** Task 5 was a `checkpoint:human-verify` gate. The user approved on the basis of (a) the standard 462-test suite + TypeScript clean, (b) the 15/15 protocol-level UAT gates via `verify-phase3-uat.mts`, and (c) the diagnosis that live-smoke failure is infrastructure drift on the ComfyUI Cloud endpoint configuration (not a Plan-3 defect). See "UAT Evidence" and "Known Follow-ups" above.

---
*Phase: 03-provenance-versioning*
*Completed: 2026-04-22 (task commits) + 2026-04-23 (UAT approval + closeout)*
