---
phase: 3
slug: provenance-versioning
status: draft
nyquist_compliant: false
wave_0_complete: false
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

*Populated during planning — planner writes task IDs + test file mappings. Draft placeholders below reflect research Dimension map.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | PROV-01, PROV-02 | — | migration creates provenance table + lineage_type | schema | `npx vitest run src/store/__tests__/schema.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | PROV-03 | — | ProvenanceRepo has no UPDATE/DELETE methods | unit | `npx vitest run src/store/__tests__/provenance-repo.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | PROV-06 | — | model extraction walks all 9 loader class_types | unit | `npx vitest run src/engine/__tests__/model-extraction.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | PROV-05 | — | seed extraction returns KSampler seed | unit | `npx vitest run src/engine/__tests__/seed-extraction.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | PROV-04 | — | diff engine emits 5-category changes | unit | `npx vitest run src/engine/__tests__/diff.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 2 | PROV-06 | — | iterate-merge rejects unknown nodes + ambiguous seed | unit | `npx vitest run src/engine/__tests__/iterate-merge.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 3 | PROV-04, PROV-05, PROV-06 | — | version tool get/list/diff/provenance actions | integration | `npx vitest run src/tools/__tests__/version-tool.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 3 | PROV-05, PROV-06 | — | generation tool reproduce + iterate actions | integration | `npx vitest run src/tools/__tests__/generation-reproduce-iterate.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 3 | PROV-01..PROV-06 | — | architecture-purity + tool-budget updates | cross-cutting | `npx vitest run src/__tests__/architecture-purity.test.ts src/__tests__/tool-budget.test.ts` | ✅ (extend) | ⬜ pending |
| 03-03-04 | 03 | 3 | PROV-01, PROV-05 | — | live-smoke asserts 2 provenance rows + seed populated + models non-empty | live-smoke | `COMFYUI_API_KEY=… npx vitest run src/comfyui/__tests__/live-smoke-provenance.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Final task IDs assigned by planner — this draft anchors the Nyquist dimensions.*

---

## Wave 0 Requirements

- [ ] `src/store/__tests__/provenance-repo.test.ts` — append-only enforcement, event insert, chronological getEvents
- [ ] `src/store/__tests__/schema.test.ts` — extend with provenance table + lineage_type column assertions
- [ ] `src/engine/__tests__/model-extraction.test.ts` — loader-walk across 9 class_types + empty/missing cases
- [ ] `src/engine/__tests__/seed-extraction.test.ts` — all 4 KSampler variants + multiple-sampler ambiguity
- [ ] `src/engine/__tests__/diff.test.ts` — 5-category changes, added/removed/rewired nodes, summary template
- [ ] `src/engine/__tests__/iterate-merge.test.ts` — deep-merge, unknown-node rejection, seed shortcut, validateWorkflowFormat guard
- [ ] `src/tools/__tests__/version-tool.test.ts` — 4 actions, envelope shape, breadcrumb, error codes
- [ ] `src/tools/__tests__/generation-reproduce-iterate.test.ts` — new version rows + lineage_type + parent_version_id + reproduction_warnings
- [ ] `src/comfyui/__tests__/png-metadata.test.ts` — tEXt chunk extraction, CRC validation, non-PNG rejection
- [ ] `src/comfyui/__tests__/live-smoke-provenance.test.ts` — gated on `COMFYUI_API_KEY`; round-trip submit + completion + provenance assertion

**Cross-cutting (extend existing, no new file):**

- [ ] `src/__tests__/architecture-purity.test.ts` — add `src/engine/diff.ts`, `src/engine/provenance.ts`, `src/engine/iterate-merge.ts`, `src/engine/diff-summary.ts` to zero-MCP-imports guard
- [ ] `src/__tests__/tool-budget.test.ts` — expected count 5 → 6
- [ ] `src/__tests__/stdio-hygiene.test.ts` — assert prompt blob never logged in stdio mode

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Reproduce round-trip byte-identical prompt_json | PROV-05 | Requires live ComfyUI Cloud execution + timing-sensitive completion wait | Run `npx vitest run src/comfyui/__tests__/live-smoke-provenance.test.ts` with `COMFYUI_API_KEY` set; after first completion, calls `generation.reproduce`, polls to completion, asserts `prov_v2.prompt_json === prov_v1.prompt_json` byte-identical |
| PNG tEXt `prompt` chunk actually contains resolved blob on Cloud | D-PROV-05, PROV-05 | Empirical validation of external API behavior (experimental) | Live-smoke test downloads completed output PNG, extracts tEXt chunks via `png-metadata.ts`, parses JSON, asserts `prompt` key present and `!== workflow_json_input` (proves resolution happened) |
| Iterate-from-failed-version workflow passes validation post-merge | D-PROV-24 | Requires the Phase 2 submit-pipeline to reject invalid blobs; mockable but live confirms | Manual: submit a deliberately-invalid workflow, wait for `failed`, call `generation.iterate` with a fix override, assert new version reaches `completed` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (10 new test files + 3 cross-cutting extensions)
- [ ] No watch-mode flags (`vitest run`, never `vitest`)
- [ ] Feedback latency < 25s (unit + integration without live-smoke)
- [ ] `nyquist_compliant: true` set in frontmatter once planner populates Per-Task Verification Map with final task IDs

**Approval:** pending — finalize after planner writes PLAN.md files with exact task IDs

---

*Draft generated from `.planning/phases/03-provenance-versioning/03-RESEARCH.md` §"Validation Architecture". Planner updates the Per-Task Verification Map with final task IDs, then flips `nyquist_compliant: true`.*
