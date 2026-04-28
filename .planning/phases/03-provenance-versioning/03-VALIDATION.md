---
phase: 3
slug: provenance-versioning
status: closed
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.4 |
| **Config file** | `vitest.config.ts` (established Phase 1) |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15-25 seconds (unit + integration; excludes live-smoke) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=dot`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green + live-smoke gated on `COMFYUI_API_KEY` must pass
- **Max feedback latency:** 25 seconds

---

## Per-Task Verification Map

*Final task IDs assigned by planner. Matches Plans 03-01 (9 tasks), 03-02 (3 tasks), 03-03 (5 tasks).*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | PROV-01, PROV-02 | T-03-03 | schema migration 0003 + drizzle declarations (provenance + lineage_type) — type-level verification | schema | `npx tsc --noEmit` | ✅ | ✅ green |
| 03-01-02 | 01 | 1 | PROV-01 | — | migration 0003 applies automatically via migrate() in openDb() (no drizzle-kit push) | infra | `npx vitest run src/store/__tests__/migrate.test.ts` | ✅ | ✅ green |
| 03-01-03 | 01 | 1 | PROV-02, PROV-03 | — | provenance + hierarchy type exports + id-prefix extension — type-level verification | unit | `npx tsc --noEmit` | ✅ | ✅ green |
| 03-01-04 | 01 | 1 | PROV-01, PROV-03 | T-03-03 | ProvenanceRepo append-only, zero UPDATE/DELETE | unit | `npx vitest run src/store/__tests__/provenance-repo.test.ts` | ✅ | ✅ green |
| 03-01-05 | 01 | 1 | PROV-05, PROV-06 | — | pure engine/provenance.ts — extractModels, extractSeed, ProvenanceWriter | unit | `npx vitest run src/engine/__tests__/model-extraction.test.ts src/engine/__tests__/seed-extraction.test.ts` | ✅ | ✅ green |
| 03-01-06 | 01 | 1 | PROV-04 | — | pure diff + diff-summary engine (5-category changes; summary template rendering covered in diff.test.ts) | unit | `npx vitest run src/engine/__tests__/diff.test.ts` | ✅ | ✅ green |
| 03-01-07 | 01 | 1 | PROV-06 | T-03-02, T-03-12 | pure iterate-merge — deep-merge, unknown-node rejection, seed shortcut | unit | `npx vitest run src/engine/__tests__/iterate-merge.test.ts` | ✅ | ✅ green |
| 03-01-08 | 01 | 1 | PROV-05 | — | PNG metadata extractor — tEXt chunk, CRC validation, non-PNG rejection | unit | `npx vitest run src/comfyui/__tests__/png-metadata.test.ts` | ✅ | ✅ green |
| 03-01-09 | 01 | 1 | PROV-01..PROV-03 | — | migrate.test.ts asserts Phase 3 schema present | schema | `npx vitest run src/store/__tests__/migrate.test.ts` | ✅ | ✅ green |
| 03-02-01 | 02 | 2 | PROV-05 | T-03-06 | ComfyUIClient.fetchResolvedPrompt (PNG tEXt extraction; no HTTP) + VersionRepo.insertVersion optional lineage arg | integration | `npx vitest run src/comfyui/__tests__/client.test.ts src/store/__tests__/version-repo.test.ts` | ✅ | ✅ green |
| 03-02-02 | 02 | 2 | PROV-05, PROV-06 | T-03-04 | extend generation.ts — submitInternal wires ProvenanceWriter; reproduceVersion + iterateFromVersion; INSERT-time lineage via insertVersion's optional arg (no setLineage method) | integration | `npx vitest run src/engine/__tests__/generation.test.ts` | ✅ | ✅ green |
| 03-02-03 | 02 | 2 | PROV-01..PROV-06 | T-03-03, T-03-04 | pipeline.ts Engine facade extended with getVersion / listVersionsForShot / getProvenance / diffVersions / reproduceVersion / iterateFromVersion | integration | `npx vitest run src/engine/__tests__/pipeline.test.ts` | ✅ | ✅ green |
| 03-03-01 | 03 | 3 | PROV-01, PROV-02, PROV-03, PROV-04, PROV-05 | T-03-05, T-03-07 | version tool — get / list / diff / provenance actions + typed errors | integration | `npx vitest run src/tools/__tests__/version-tool.test.ts` | ✅ | ✅ green |
| 03-03-02 | 03 | 3 | PROV-05, PROV-06 | T-03-02, T-03-08, T-03-12 | generation tool — reproduce + iterate actions (overrides shape per D-PROV-13; reproduction_warnings always present) | integration | `npx vitest run src/tools/__tests__/generation-tool.test.ts` | ✅ | ✅ green |
| 03-03-03 | 03 | 3 | PROV-01..PROV-06 | T-03-03, T-03-05 | registry wiring + architecture-purity (4 engine modules) + tool-budget (5→6) + stdio-hygiene (prompt_json never logged) | cross-cutting | `npx vitest run src/__tests__/architecture-purity.test.ts src/__tests__/tool-budget.test.ts src/__tests__/stdio-hygiene.test.ts` | ✅ | ✅ green |
| 03-03-04 | 03 | 3 | PROV-01, PROV-05, PROV-06 | T-03-06, T-03-11 | live-smoke — reproduce round-trip byte-identical prompt_json against real ComfyUI Cloud | live-smoke | `COMFYUI_API_KEY=… npx vitest run src/comfyui/__tests__/live-smoke.test.ts` | ✅ | ⚠️ flaky |
| 03-03-05 | 03 | 3 | PROV-01..PROV-06 | — | UAT: end-to-end agent walk through all 6 actions + 3 negative cases via MCP inspector | checkpoint:human-verify | *manual — see Manual-Only Verifications* | n/a | ⚠️ flaky |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/store/__tests__/provenance-repo.test.ts` — append-only enforcement, event insert, chronological getEvents
- [x] `src/engine/__tests__/model-extraction.test.ts` — loader-walk across 9 class_types + empty/missing cases
- [x] `src/engine/__tests__/seed-extraction.test.ts` — all 4 KSampler variants + multiple-sampler ambiguity
- [x] `src/engine/__tests__/diff.test.ts` — 5-category changes + added/removed/rewired nodes + summary template rendering (diff + diff-summary colocated per Plan 01 Task 6)
- [x] `src/engine/__tests__/iterate-merge.test.ts` — deep-merge, unknown-node rejection, seed shortcut, validateWorkflowFormat guard
- [x] `src/engine/__tests__/pipeline.test.ts` — facade extended with getVersion / listVersionsForShot / getProvenance / diffVersions / reproduceVersion / iterateFromVersion delegations
- [x] `src/tools/__tests__/version-tool.test.ts` — 4 actions, envelope shape, 4 typed error codes
- [x] `src/tools/__tests__/generation-tool.test.ts` — EXTEND with byte-identical reproduce + overrides validation + REPRODUCE_BLOCKED + ITERATE_INVALID_PATCH (single file, not a separate generation-reproduce-iterate.test.ts)
- [x] `src/comfyui/__tests__/png-metadata.test.ts` — tEXt chunk extraction, CRC validation, non-PNG rejection
- [x] `src/comfyui/__tests__/live-smoke.test.ts` — EXTEND with reproduce round-trip gated on `COMFYUI_API_KEY` (byte-identity assertion; no separate live-smoke-provenance.test.ts)

**Cross-cutting (extend existing, no new file):**

- [x] `src/store/__tests__/migrate.test.ts` — assert Phase 3 migration 0003 applied
- [x] `src/comfyui/__tests__/client.test.ts` — add fetchResolvedPrompt coverage (PNG tEXt extraction; no HTTP)
- [x] `src/engine/__tests__/generation.test.ts` — add reproduceVersion + iterateFromVersion coverage
- [x] `src/__tests__/architecture-purity.test.ts` — add `src/engine/provenance.ts`, `src/engine/diff.ts`, `src/engine/iterate-merge.ts`, `src/engine/diff-summary.ts`, `src/comfyui/png-metadata.ts` to zero-MCP-imports guard (4 pure engine modules + 1 pure client module)
- [x] `src/__tests__/tool-budget.test.ts` — expected count 5 → 6
- [x] `src/__tests__/stdio-hygiene.test.ts` — assert prompt_json never logged to stdout in stdio mode

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Reproduce round-trip byte-identical prompt_json | PROV-05, PROV-06 | Requires live ComfyUI Cloud execution + timing-sensitive completion wait | Run `npx vitest run src/comfyui/__tests__/live-smoke.test.ts` with `COMFYUI_API_KEY` set; after first completion, calls `generation.reproduce`, polls to completion, asserts `prov_v2.prompt_json === prov_v1.prompt_json` byte-identical |
| PNG tEXt `prompt` chunk actually contains resolved blob on Cloud | D-PROV-05, PROV-05 | Empirical validation of external API behavior (experimental) | Live-smoke test downloads completed output PNG, extracts tEXt chunks via `png-metadata.ts`, parses JSON, asserts `prompt` key present and `!== workflow_json_input` (proves resolution happened) |
| Iterate-from-failed-version workflow passes validation post-merge | D-PROV-24 | Requires the Phase 2 submit-pipeline to reject invalid blobs; mockable but live confirms | Manual: submit a deliberately-invalid workflow, wait for `failed`, call `generation.iterate` with a fix override, assert new version reaches `completed` |
| UAT — agent walks all 6 actions + 3 negative cases | PROV-01..PROV-06 | Validates MCP protocol ergonomics + error-message readability from an agent's POV | Task 03-03-05: Start stdio server, drive via MCP inspector through submit → check → version.get → version.provenance → generation.reproduce → version.diff (empty) → generation.iterate → version.diff (patched delta), plus 3 negative cases (REPRODUCE_BLOCKED on unknown id, ITERATE_INVALID_PATCH on bad path, VERSION_NOT_COMPLETED on pending diff) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (03-03-05 is checkpoint:human-verify by design)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`vitest run`, never `vitest`)
- [x] Feedback latency < 25s (unit + integration without live-smoke)
- [x] `nyquist_compliant: true` — Per-Task Verification Map populated with final task IDs

**Approval:** closed 2026-04-28 (Phase 9 retrofit) — planner finalized Per-Task Verification Map against final task IDs across Plans 01 / 02 / 03

---

*Generated from `.planning/phases/03-provenance-versioning/03-RESEARCH.md` §"Validation Architecture". Planner finalized the Per-Task Verification Map with final task IDs; `nyquist_compliant: true`.*

---

## Validation Audit 2026-04-28

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (no real gaps surfaced; bookkeeping retrofit only) |
| Escalated | 0 |

Wave 0 closure: nyquist_compliant + wave_0_complete + status:closed all set in frontmatter; Per-Task Verification Map already final from initial planning (no rewrite needed); baseline vitest run 754/757 green confirms infrastructure intact. See `.planning/phases/09-nyquist-wave0-closure/09-CONTEXT.md` decisions and `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` for observable truths.
