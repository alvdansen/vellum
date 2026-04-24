---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 7 context gathered
last_updated: "2026-04-24T17:59:20.498Z"
last_activity: 2026-04-24 -- Phase 07 execution started
progress:
  total_phases: 9
  completed_phases: 6
  total_plans: 42
  completed_plans: 34
  percent: 81
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** A VFX artist tells their AI familiar what they need in natural language, and it manages the entire production pipeline -- routing, versioning, provenance, organization -- so they never touch a folder structure or lose track of what generated what.
**Current focus:** Phase 07 — comfyui-endpoint-reconciliation

## Current Position

Phase: 07 (comfyui-endpoint-reconciliation) — EXECUTING
Plan: 2 of 8 (Wave 2 — 07-01 complete)
Status: Executing Phase 07
Last activity: 2026-04-24 -- 07-01 probe scaffold + winner captured (cloud.comfy.org/api/system_stats)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 21
- Average duration: --
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 02 | 3 | - | - |
| 03 | 3 | - | - |
| 04 | 5 | - | - |
| 06 | 7 | - | - |

**Recent Trend:**

- Last 5 plans: --
- Trend: --

*Updated after each plan completion*
| Phase 01 P01 | 13min | 8 tasks | 18 files |
| Phase 01 P02 | 9min | 4 tasks | 10 files |
| Phase 01 P03 | 11min | 9 tasks tasks | 8 files files |
| Phase 03 P01 | 11min | 9 tasks | 22 files |
| Phase 03 P02 | 17min | 3 tasks | 18 files |
| Phase 03 P03 | 12min | 5 tasks tasks | 8 files files |
| Phase 04 P01 | 10min | 3 tasks | 9 files |
| Phase 04 P02 | 10min | 3 tasks tasks | 4 files files |
| Phase 04 P03 | 11min | 2 tasks tasks | 15 files files |
| Phase 04 P04-04 | 15min | 4 tasks | 7 files |
| Phase 04 P05 | 11min | 3 tasks tasks | 3 files files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 5 v1 phases derived from 7 requirement categories; TOOL requirements folded into Phase 1 (tools are the transport surface, not a separate deliverable)
- [Roadmap]: v2 requirements (routing, adapter, advanced ops) tracked as Future, not executed in current roadmap
- [Research]: ComfyUI Cloud API is "experimental" -- validate endpoints against live API before Phase 2 client work
- [Plan 01-01] Adopted prefixed nanoid IDs (ws_, proj_, seq_, shot_) for log readability
- [Plan 01-01] isUniqueViolation tolerant of SQLITE_CONSTRAINT_UNIQUE, _PRIMARYKEY, and UNIQUE-in-message fallback
- [Plan 01-01] Shot regex ^sh\d{3,}$ enforced at Engine layer only; repo is regex-agnostic
- [Plan 01-01] fetch-to-node@^2.1.0 and @hono/node-server@^2.0.0 replace STACK.md's stale ^1.x pins (same API)
- [Plan 01-02] shape.ts shared helpers over per-tool duplication; keeps each tool ~60 lines and makes breadcrumb contract single-edit
- [Plan 01-02] Zod-failure handler branch re-wraps as TypedError(INVALID_INPUT) with input.<path> — keeps Zod stack invisible to agent (D-32)
- [Plan 01-02] shot-tool uses 'INVALID_SHOT_FORMAT' as Zod regex sentinel message; handler detects + re-maps to typed code with hint; engine enforces regex redundantly (T2 defence in depth)
- [Plan 01-02] Integration tests use direct-mirror pattern per plan-allowed fallback (MCP SDK _registeredTools is private) plus smoke test for live registration
- [Plan 01-02] toolOk typed as StructuredContent object (not unknown) to satisfy MCP SDK 1.29 CallToolResult
- [Plan 01-03] buildServer(engine, version) factory — MCP SDK 1.29 Protocol disallows one McpServer across two live transports; factory spawns a fresh server per HTTP request, shared engine/db for process-wide consistency
- [Plan 01-03] Tool-budget grep scoped to src/tools/ to avoid self-matching docstring; architecture-purity independently enforces that tools are the only MCP-importing layer
- [Plan 01-03] MCP Inspector UI deferred to local pre-release verification; every Inspector assertion maps 1:1 to an automated test; live HTTP curl roundtrip fills the wire-level gap
- [Plan 03-01] Discarded drizzle-kit auto-generated migration 0003_curious_violations.sql (contained extraneous DROP INDEX statements for DM-03 indexes); kept hand-authored 0003_phase3_provenance.sql with clean additive-only shape
- [Plan 03-01] ProvenanceRepo is structurally append-only — 4 public methods (insertEvent, getEventsForVersion, getLatestCompletedEvent, getSubmitEvent); structural prototype assertion in tests enforces T-03-01
- [Plan 03-01] Prototype-pollution tests use JSON.parse input because object-literal {__proto__: ...} syntax sets prototype (not own-property); real attack vector is MCP tool JSON input so tests mirror that path
- [Plan 03-01] VersionRepo.insertVersion seeds lineage_type: null on direct submits (Rule 3 blocking fix for exhaustive object check); Plan 2 extends with optional lineage arg for reproduce/iterate
- [Plan 03-02] Lineage (parent_version_id + lineage_type) written at INSERT time via extended insertVersion 3rd param — no setLineage method, no follow-up UPDATE (LANDMINE #8: closes the read-during-transaction null-lineage race)
- [Plan 03-02] fetchResolvedPrompt takes a file path (pure fs.readFile + PNG tEXt extract, zero HTTP); swap-ready for future /api/history HTTP variant with same signature (LANDMINE #3)
- [Plan 03-02] submitInternal is private shared helper for submit/reproduce/iterate; preserves submitGeneration public signature (LANDMINE #1) while three methods share the two-phase submit + provenance-write body
- [Plan 03-02] reproduce throws PROVENANCE_UNAVAILABLE on null prompt_json; iterate-from-failed uses workflow_json (D-PROV-24 asymmetry — reproduce is verbatim-replay contract, iterate is authored-intent-plus-patch contract)
- [Plan 03-02] reproduction_warnings[] always non-empty in Phase 3 — model hashes always null (checksums deferred), so every reproduce emits per-model 'not checksummed' warnings or the generic 'no model metadata' notice (T-03-02-03 spoofing mitigation, D-PROV-28)
- [Plan 03-03] D-PROV-28 reproduction_warnings layered AFTER shapeVersionEntity spread — missing key is bug; empty array is honest default in Phase 3 (checksums deferred)
- [Plan 03-03] NO JSON-Patch patch field on iterate — D-PROV-13 locks shape as node-scoped overrides Record<string, {inputs?, class_type?}> + optional seed shortcut; Zod discriminated union silently drops patch:[] (regression test asserts this)
- [Plan 03-03] Tool layer has zero status branching on iterate — engine branches internally per D-PROV-24 (completed→prompt_json, failed→workflow_json, submitted/running→VERSION_NOT_COMPLETED); tool passes version_id/overrides/seed/notes through unchanged
- [Plan 03-03] Tool-budget test rewritten to use readFile + multi-line regex /server\.registerTool\(\s*'([a-z_-]+)'/gs — single-line grep was passing vacuously because SDK call signature spreads name literal across lines; portable across BSD/GNU grep
- [Plan 03-03] Tool budget at exactly 6 of 12 (D-PROV-07) — workspace/project/sequence/shot/generation/version; assertion checks count AND name-set (alphabetically sorted for stable snapshot); zero asset/collection/search leakage
- [Plan 03-03 UAT] Approved on 462 unit tests + 15/15 protocol-level MCP SDK gates via verify-phase3-uat.mts (untracked driver at repo root); live-smoke endpoint drift (api.comfy.org 404, cloud.comfy.org 401) diagnosed as pre-existing infrastructure issue — not Plan 3 defect
- [Plan 04-01] drizzle-kit generate accepted verbatim; IDM-03 rollback header prepended to match Phase 3 precedent (drizzle-kit default ordering: metadata before tags, explicit INDEX before UNIQUE autoindex — structurally identical to planned shape)
- [Plan 04-01] EXPECTED_MIGRATIONS bumped 3 to 4 (Rule 3 blocking fix — existing Phase 2/3 migration-count assertions) bundled with Task 1 commit; a separate test fix commit would have left Task 1 verification red
- [Plan 04-01] drizzle-kit roundtrip parity confirmed: schema.ts --> generate --> 0004.sql --> generate says 'No schema changes, nothing to migrate' — zero structural delta between Drizzle ORM declarations and hand-prefixed SQL migration
- [Plan 04-01] src/types/hierarchy.ts UNCHANGED per D-ASST-21/D-ASST-22 — Phase 4 hydration uses VersionWithAssets extension type in src/types/assets.ts, not Version mutation
- [Plan 04-02] Widened Db type to BetterSQLite3Database<typeof schema> & { $client: SqliteClient } — drizzle 0.45.2 factory returns this intersection but class declaration omits $client; widening at repo type alias keeps json_group_array + scope-JOIN SQL type-clean
- [Plan 04-02] insertTag uses INSERT-then-fallback-SELECT (ON CONFLICT DO NOTHING RETURNING + follow-up SELECT when RETURNING empty); upsertMetadata uses single INSERT ON CONFLICT DO UPDATE RETURNING (no fallback — DO UPDATE always emits a row). Semantic asymmetry between idempotent-insert and upsert patterns
- [Plan 04-02] buildScopeFragment duplicated verbatim between tag-repo.ts and metadata-repo.ts per RESEARCH alternatives-rejected guidance — repo files stay independent, 30 lines each, zero cross-repo coupling
- [Plan 04-02] Pre-check parent pattern via constructor-injected VersionRepo — both TagRepo and MetadataRepo surface VERSION_NOT_FOUND as typed error before INSERT; never let SQLITE_CONSTRAINT_FOREIGNKEY leak (Pitfall #3)
- [Plan 04-03] Engine constructor's Db parameter uses BaseDb (narrow public) + this.db = db as Db (widened internal) — mirrors Plan 04-02 widening at the repo boundary; all 14 callers inherit clean behavior without type-level knowledge of the widening
- [Plan 04-03] server.ts Engine call site updated in Task 2 alongside 13 test harnesses (Rule 3 blocking fix for tsc-green acceptance criterion); Plan 04-04 still owns server.ts asset-tool wiring (registerAsset import + call)
- [Plan 04-03] INV-ASST-10 ordering test uses raw-SQL UPDATE to set distinct created_at timestamps (1000/2000/3000) then asserts primary DESC ordering; a second subcase forces all-equal timestamps and asserts the id-DESC tiebreaker via sort().reverse() — cleanly separates primary-sort and tiebreaker contracts of D-ASST-16
- [Plan 04-03] setMetadata cap check is upsert-aware: reads listMetadataForVersion to detect existing-key upserts (bypass cap) vs new-key inserts (cap enforced). Small indexed-read cost for correct upsert semantics when version is at MAX_METADATA_PER_VERSION=100
- [Plan 04-03] Architecture-purity test uses substring grep; JSDoc citing 'MCP SDK imports' (not the sentinel '@modelcontextprotocol/sdk' string) avoids false positives — same convention Phase 3 had to adopt
- [Plan 04-04] MCP Inspector visual check replaced by wire-level UAT driver verify-phase4-tool-surface.mts (6/6 pass) — follows Phase 3 precedent and MEMORY.md 'don't punt on tests' rule
- [Plan 04-04] SDK _registeredTools handler key is 'handler' not 'callback' in this SDK version; Rule 3 fix in 05d2f07; version-tool.test.ts uses same internal key
- [Plan 04-05] DbWithClient widening re-introduced at src/test-utils/fixtures.ts top-level to satisfy TagRepo/MetadataRepo constructor arity — mirrors Plan 04-02 test-layer pattern; Rule 3 blocking fix
- [Plan 04-05] Dropped unused Version type import from version-tool.ts after widening shapeVersionEntity to VersionWithAssets — type-level reference no longer needed
- [Plan 04-05] Added 8 test cases instead of planned 6 — split list-include-flags into truth-table coverage (default both-off, tags-only, metadata-only, both-on) for cross-flag leak regression protection
- [Plan 04-05] buildStack() exposes testDb (TestDb) so Phase 4 fixture helpers (versionWithTags/versionWithMetadata) can attach rows to the stack's in-memory database — non-breaking addition
- [Plan 04-05] No Phase 2/3 existing test assertions required update — 15/15 existing tests passed unchanged because toBe/toBeUndefined/toHaveLength assertions don't intersect with the new inline tags/metadata keys

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2 depends on live ComfyUI Cloud API access -- API key and endpoint validation needed before Phase 2 planning
- Model checksums may not be available from Cloud API (PROV-02 allows nullable, but should confirm during Phase 2)

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: --stopped-at
Stopped at: Phase 7 context gathered
Resume file: --resume-file

**Planned Phase:** 07 (comfyui-endpoint-reconciliation) — 8 plans — 2026-04-24T17:55:21.482Z
