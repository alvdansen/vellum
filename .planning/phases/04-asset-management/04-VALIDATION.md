---
phase: 4
slug: asset-management
status: closed
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-22
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (inherited from Phase 1/2/3) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run --reporter=basic <changed-file>` |
| **Full suite command** | `npx vitest run --reporter=basic` |
| **Estimated runtime** | ~8-12 seconds (Phase 3 baseline ~7s; Phase 4 adds ~2-5s for asset/query suites) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command scoped to the file being changed, e.g. `npx vitest run src/store/__tests__/tag-repo.test.ts`
- **After every plan wave:** Run the full suite (`npx vitest run`)
- **Before `/gsd-verify-work`:** Full suite must be green + live smoke confirms nothing regressed in Phase 2/3 surface
- **Max feedback latency:** 12 seconds (full suite); <2 seconds (per-file quick run)

---

## Per-Task Verification Map

*Populated by the planner once PLAN.md files exist. The gsd-planner will append rows per task using the Nyquist schema below.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-T1 | 01 | 1 | ASST-01, ASST-02 | T-04-01-01, T-04-01-02 | Additive migration safety; SCHEMA_DDL unchanged | unit | `npx vitest run src/store/__tests__/migrate.test.ts` | ⬜ pending | ⬜ pending |
| 04-01-T2 | 01 | 1 | ASST-01, ASST-02, ASST-03 | T-04-01-05 | IdPrefix + ErrorCode + shape constants + assets types — pure declarations | typecheck | `npx tsc --noEmit` | ⬜ pending | ⬜ pending |
| 04-01-T3 | 01 | 1 | ASST-01, ASST-02 | T-04-01-04 | migrate.test.ts assertions: tables + indexes present on fresh DB | unit | `npx vitest run src/store/__tests__/migrate.test.ts` | ⬜ pending | ⬜ pending |
| 04-02-T1 | 02 | 2 | ASST-01, ASST-03 | T-04-02-02 | tag-repo tests RED (INV-ASST-01, INV-ASST-02) | unit | `npx vitest run src/store/__tests__/tag-repo.test.ts` | ⬜ pending | ⬜ pending |
| 04-02-T2 | 02 | 2 | ASST-01, ASST-03 | T-04-02-01, T-04-02-02 | TagRepo GREEN — idempotent insert, scope aggregation, json_group_array | unit | `npx vitest run src/store/__tests__/tag-repo.test.ts` | ⬜ pending | ⬜ pending |
| 04-02-T3 | 02 | 2 | ASST-02, ASST-03 | T-04-02-01, T-04-02-02 | MetadataRepo RED+GREEN — INV-ASST-03 upsert + INV-ASST-04 idempotent delete | unit | `npx vitest run src/store/__tests__/metadata-repo.test.ts` | ⬜ pending | ⬜ pending |
| 04-03-T1 | 03 | 3 | ASST-01, ASST-02, ASST-03, ASST-04, ASST-05 | T-04-03-01, T-04-03-02, T-04-03-03 | AssetsEngine tests RED — 25+ cases covering INV-ASST-05..14, 17-19, 23-24 | unit | `npx vitest run src/engine/__tests__/assets.test.ts` | ⬜ pending | ⬜ pending |
| 04-03-T2 | 03 | 3 | ASST-01, ASST-02, ASST-03, ASST-04, ASST-05 | T-04-03-01, T-04-03-02, T-04-03-03, T-04-03-04, T-04-03-07, T-04-03-08 | AssetsEngine GREEN — Pattern 3 filter SQL + Pattern 5 transaction + Pattern 4 hydration; Engine facade constructor extended | unit | `npx vitest run src/engine/__tests__/assets.test.ts src/engine/__tests__/pipeline.test.ts src/engine/__tests__/generation.test.ts` | ⬜ pending | ⬜ pending |
| 04-04-T1 | 04 | 4 | ASST-01, ASST-02, ASST-03, ASST-04, ASST-05 | T-04-04-01, T-04-04-02 | asset-tool tests RED — 20+ integration cases covering all 7 actions | integration | `npx vitest run src/tools/__tests__/asset-tool.test.ts` | ⬜ pending | ⬜ pending |
| 04-04-T2 | 04 | 4 | ASST-01, ASST-02, ASST-03, ASST-04, ASST-05 | T-04-04-01, T-04-04-02, T-04-04-03, T-04-04-05 | asset-tool GREEN — 7-action discriminated union delegates to engine; server.ts wiring | integration | `npx vitest run src/tools/__tests__/asset-tool.test.ts` | ⬜ pending | ⬜ pending |
| 04-04-T3 | 04 | 4 | ASST-01 | T-04-04-04, T-04-04-05, T-04-04-06 | Cross-cutting: tool-budget 6→7; architecture-purity for 3 files; stdio-hygiene SQL-leak | unit | `npx vitest run src/__tests__/` | ⬜ pending | ⬜ pending |
| 04-04-T4 | 04 | 4 | ASST-01, ASST-02 | T-04-04-07 | [BLOCKING] schema-push verification: migration applies, drizzle-kit zero delta, Inspector shows 7 tools | manual-blocking | `npm test` + `npx drizzle-kit generate --name phase4_sync_check` + MCP Inspector | ⬜ pending | ⬜ pending |
| 04-05-T1 | 05 | 4 | ASST-01, ASST-02 | (none — fixture code) | 7 test fixture helpers for Phase 4 seeding (RESEARCH §Test Fixtures Needed) | typecheck | `npx tsc --noEmit` | ⬜ pending | ⬜ pending |
| 04-05-T2 | 05 | 4 | ASST-01, ASST-02, ASST-05 | T-04-05-03 | version-tool extended: get always hydrates; list gets include flags | typecheck | `npx tsc --noEmit` | ⬜ pending | ⬜ pending |
| 04-05-T3 | 05 | 4 | ASST-01, ASST-02, ASST-05 | T-04-05-03, T-04-05-04 | version-tool.test.ts assertions: INV-ASST-15, 16, 17, 22, 23, 25 | integration | `npx vitest run src/tools/__tests__/version-tool.test.ts` | ⬜ pending | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test infrastructure is mature (Phase 1/2/3 established vitest + fake-engine + fixtures). Phase 4 adds new test files rather than infrastructure:

- [ ] `src/store/__tests__/tag-repo.test.ts` — TagRepo CRUD + idempotent insert + scope aggregation
- [ ] `src/store/__tests__/metadata-repo.test.ts` — MetadataRepo UPSERT + delete + scope aggregation
- [ ] `src/engine/__tests__/assets.test.ts` — all 7 asset operations, AND-only filter semantics, scope XOR, pagination math, date bounds, hydration
- [ ] `src/tools/__tests__/asset-tool.test.ts` — 7 actions × envelope shape × breadcrumb × error wrapping × Zod validation
- [ ] Extend `src/tools/__tests__/version-tool.test.ts` — `version.get` inline tags+metadata; `version.list include_tags/include_metadata`
- [ ] Extend `src/test-utils/fixtures.ts` — versions-with-tags fixtures, metadata maps, filter-combination fixtures
- [ ] Extend `src/__tests__/architecture-purity.test.ts` — assert `src/engine/assets.ts`, `src/store/tag-repo.ts`, `src/store/metadata-repo.ts` have zero MCP imports
- [ ] Extend `src/__tests__/tool-budget.test.ts` — bump expected count 6 → 7

Infrastructure gaps: none. `vitest`, `better-sqlite3` in-memory fixtures, and fake-engine scaffolding already carry Phase 1/2/3 tests. No new test frameworks or runners.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent narrative read — error hint ergonomics | D-ASST-23..25 (error surface) | LLM-facing copy quality is subjective; regex alone can't judge "Does this tell the agent what to do next?" | Trigger each of TAG_INVALID / METADATA_INVALID / TAG_LIMIT_EXCEEDED / METADATA_LIMIT_EXCEEDED / INVALID_SCOPE through the MCP inspector or a live agent, confirm the hint names the specific identifier AND suggests the next action. Record verdict in UAT.md. |
| MCP tool description token budget | PITFALLS §"Pitfall #1 (token budget)" | Only observable by loading the server into an MCP client and inspecting tools/list; no grep-level check of "description is concise". | Start server via `npx tsx src/server.ts`, use `mcp-inspector` (or `tools/list` JSON-RPC), verify all 7 asset actions render with <=2 sentence descriptions that cite the tag regex + caps succinctly. |

*Note: the rest of Phase 4 behaviors (SQL correctness, idempotency, pagination, breadcrumb, error codes, scope XOR, date bounds, AND-only semantics) have automated verification below via the Business Logic Invariants table.*

---

## Business Logic Invariants (source: RESEARCH.md §Validation Architecture)

26 invariants extracted from CONTEXT.md D-ASST-01..D-ASST-33 via the phase researcher. Every invariant maps to an automated assertion. The gsd-planner will wire each invariant to a concrete task under `## Per-Task Verification Map`.

| ID | Invariant | Source | Test File (expected) |
|----|-----------|--------|----------------------|
| INV-ASST-01 | `add_tag` on existing `(version_id, tag)` returns success, row count unchanged | D-ASST-03 | tag-repo.test.ts |
| INV-ASST-02 | `remove_tag` on missing `(version_id, tag)` returns success, no error | D-ASST-03 | tag-repo.test.ts |
| INV-ASST-03 | `set_metadata` upserts on `(version_id, key)` — second call with new value replaces value + updates `created_at` | D-ASST-03, D-ASST-08 | metadata-repo.test.ts |
| INV-ASST-04 | `remove_metadata` on missing key returns success, no error | D-ASST-03 | metadata-repo.test.ts |
| INV-ASST-05 | `asset.query` with `tags: ['hero', 'final']` returns versions having BOTH tags (within-field AND) | D-ASST-14 | assets.test.ts |
| INV-ASST-06 | `asset.query` with `metadata: [{k1,v1},{k2,v2}]` returns versions having BOTH pairs (within-field AND) | D-ASST-14 | assets.test.ts |
| INV-ASST-07 | `asset.query` with `tags` + `metadata` + `date_from` all applied — all filters AND-composed | D-ASST-14 | assets.test.ts |
| INV-ASST-08 | `asset.query` rejects multiple scope fields with `INVALID_SCOPE` (engine boundary validation) | D-ASST-13 | assets.test.ts + asset-tool.test.ts |
| INV-ASST-09 | `asset.query` without scope fields returns global results | D-ASST-12, D-ASST-13 | assets.test.ts |
| INV-ASST-10 | `asset.query` ordering: `created_at DESC, id DESC` (stable on timestamp tie) | D-ASST-16 | assets.test.ts |
| INV-ASST-11 | Date range inclusive: `date_from == created_at` included, `date_to == created_at` included | D-ASST-15 | assets.test.ts |
| INV-ASST-12 | Date range rejects `date_from > date_to` with `INVALID_INPUT` hint `"date_from must be <= date_to"` | D-ASST-15 | assets.test.ts |
| INV-ASST-13 | `asset.query` pagination: `total_count` matches the number of rows that would be returned absent `limit`/`offset`; wrapped in same transaction as paged SELECT | D-ASST-18 | assets.test.ts |
| INV-ASST-14 | `asset.query` limit default 20; cap at `MAX_PAGE_SIZE = 100`; offset min 0 | D-ASST-18 | asset-tool.test.ts |
| INV-ASST-15 | Tag regex `/^[A-Za-z0-9_\-.:]+$/` — accepts `status:approved`, rejects whitespace/emoji | D-ASST-11 | tag-repo.test.ts or shape validation test |
| INV-ASST-16 | Key regex same as tag; value length max 2000 bytes (UTF-8) | D-ASST-11 | metadata-repo.test.ts + shape validation test |
| INV-ASST-17 | MAX_TAGS_PER_VERSION=50 enforced → `TAG_LIMIT_EXCEEDED` with version id in hint | D-ASST-11, D-ASST-23 | assets.test.ts |
| INV-ASST-18 | MAX_METADATA_PER_VERSION=100 enforced → `METADATA_LIMIT_EXCEEDED` with version id in hint | D-ASST-11, D-ASST-23 | assets.test.ts |
| INV-ASST-19 | Unknown `version_id` on any mutator → `VERSION_NOT_FOUND` (pre-check pattern, no FK leak) | D-ASST-24 | assets.test.ts |
| INV-ASST-20 | All Phase 4 errors wrap into `{isError:true, structuredContent:{code,message,hint?}}` (Phase 1 D-28..D-32 envelope) | D-ASST-25 | asset-tool.test.ts |
| INV-ASST-21 | `version.get` response: tags ASC alphabetical, metadata ASC by key, always inline (even when empty = `[]`) | D-ASST-19 | version-tool.test.ts |
| INV-ASST-22 | `version.list` default: no `tags`/`metadata` keys on items (cheap payload) | D-ASST-20 | version-tool.test.ts |
| INV-ASST-23 | `version.list include_tags=true` OR `include_metadata=true` adds the respective array(s) per item | D-ASST-20 | version-tool.test.ts |
| INV-ASST-24 | `asset.query` result items always include tags + metadata inline (no opt-in flag) | D-ASST-22 | assets.test.ts |
| INV-ASST-25 | Every response carries `breadcrumb` + `breadcrumb_text` (asset mutators, query, list_tags, list_metadata_keys); aggregate lists echo scope in `structuredContent.scope` | D-ASST-04, D-ASST-05, D-ASST-06 | asset-tool.test.ts |
| INV-ASST-26 | Architecture purity: `src/engine/assets.ts`, `src/store/tag-repo.ts`, `src/store/metadata-repo.ts` have ZERO imports from `@modelcontextprotocol/sdk` | D-ASST-26, D-ASST-29 | architecture-purity.test.ts |

---

## Boundary Conditions

| Condition | Expected | Test |
|-----------|----------|------|
| Empty filter (`asset.query {action:'query'}`) | Returns all versions, global scope | assets.test.ts |
| 0-result query | `{items: [], total_count: 0, limit: 20, offset: 0}` | assets.test.ts |
| `date_from == date_to` (same instant) | Returns versions with `created_at` equal to that instant | assets.test.ts |
| `offset > total_count` | `items: []`, `total_count` preserved | assets.test.ts |
| `limit = 101` | Rejected by Zod (cap 100) | asset-tool.test.ts |
| Tag with leading/trailing whitespace | Rejected with `TAG_INVALID` hint | asset-tool.test.ts |
| Key starting with `:` (colon-only allowed mid-string) | Rejected if regex anchored strictly | shape validation test |
| Status filter omitted | All statuses returned | assets.test.ts |
| Status filter `'completed'` | Uses `idx_versions_status` per EQP | assets.test.ts |
| Version deleted mid-transaction | Not applicable — Phase 4 adds no delete ops on versions | — |
| Concurrency: two add_tag at same time for same `(version_id, tag)` | Both succeed, one row (WAL + ON CONFLICT DO NOTHING) | assets.test.ts (optional stress) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies → gsd-planner fills `## Per-Task Verification Map`
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify → gsd-planner respects sampling rule
- [ ] Wave 0 covers all MISSING references → 8 new/extended test files listed above
- [ ] No watch-mode flags (all commands use `vitest run`, never `vitest --watch`)
- [ ] Feedback latency < 12s (full suite target)
- [ ] `nyquist_compliant: true` set in frontmatter once `## Per-Task Verification Map` is filled

**Approval:** closed 2026-04-28 (Phase 9 retrofit) — both Nyquist flags already true (compliant template); status flipped from draft to closed for v1.0 functional phase consistency.

---

## Validation Audit 2026-04-28

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (no real gaps surfaced; cosmetic status flip only) |
| Escalated | 0 |

Wave 0 closure: nyquist_compliant + wave_0_complete already true (compliant template); status flipped draft → closed for v1.0 functional phase consistency. See `.planning/phases/09-nyquist-wave0-closure/09-CONTEXT.md` decisions and `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` for observable truths.
