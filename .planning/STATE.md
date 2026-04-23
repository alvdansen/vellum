---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Completed 03-03 — MCP surface for provenance lands (version tool get/list/diff/provenance + generation reproduce/iterate); Phase 3 ready for verification
last_updated: "2026-04-23T02:45:18.840Z"
last_activity: 2026-04-23
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 9
  completed_plans: 9
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** A VFX artist tells their AI familiar what they need in natural language, and it manages the entire production pipeline -- routing, versioning, provenance, organization -- so they never touch a folder structure or lose track of what generated what.
**Current focus:** Phase 03 — provenance-versioning

## Current Position

Phase: 03 (provenance-versioning) — EXECUTING
Plan: 3 of 3
Status: Phase complete — ready for verification
Last activity: 2026-04-23

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 6
- Average duration: --
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 02 | 3 | - | - |

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

Last session: 2026-04-23T02:45:18.835Z
Stopped at: Completed 03-03 — MCP surface for provenance lands (version tool get/list/diff/provenance + generation reproduce/iterate); Phase 3 ready for verification
Resume file: None

**Planned Phase:** 03 (provenance-versioning) — 3 plans — 2026-04-23T01:26:14.248Z
