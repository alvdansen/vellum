---
phase: 2
slug: comfyui-generation
status: closed
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Phase 9 retrofit (2026-04-28) converted the Per-Requirement table to Per-Task across plans 02-01/02/03 (10 tasks total: 4 + 2 + 4).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.4 (installed in Phase 1) |
| **Config file** | `vitest.config.ts` (Phase 1; no change) |
| **Quick run command** | `npx vitest run --changed` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10–20 seconds full suite (unit+integration); live-smoke adds 30–180s when `COMFYUI_API_KEY` set |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --changed`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green; live-smoke green when `COMFYUI_API_KEY` is set
- **Max feedback latency:** 20 seconds for unit+integration; 3 minutes worst-case for live-smoke

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | GEN-06 | V5 | UI-format (nodes/links/groups keys) rejected with INVALID_WORKFLOW_FORMAT + hint | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "UI-format rejected"` | ✅ | ✅ green |
| 02-01-01 | 01 | 1 | GEN-06 | V5 | API-format (numeric-string keys → {class_type, inputs}) accepted | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "API-format accepted"` | ✅ | ✅ green |
| 02-01-01 | 01 | 1 | GEN-06 | V5 | Edge cases rejected: `{}`, `[]`, `null`, mixed keys, missing `class_type` | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "format edge cases"` | ✅ | ✅ green |
| 02-01-01 | 01 | 1 | GEN-05 | V5 | `extractFirstNodeError` returns `"Node {id} ({class_type}): {message}"` for fixture | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "extractFirstNodeError"` | ✅ | ✅ green |
| 02-01-02 | 01 | 1 | GEN-01..07 | V5 | Drizzle migration 0001 applies idempotently on second boot | integration | `npx vitest run src/store/__tests__/migrate.test.ts -t "idempotent"` | ✅ | ✅ green |
| 02-01-03 | 01 | 1 | GEN-04 | V5 | version_number = MAX(shot_id)+1; UNIQUE(shot_id, version_number) enforced (append-only, no overwrite) | unit (repo) | `npx vitest run src/store/__tests__/version-repo.test.ts -t "version number monotone"` | ✅ | ✅ green |
| 02-01-03 | 01 | 1 | GEN-04 | V5 | Concurrent submit → retry once on UNIQUE, then CONCURRENT_SUBMIT_CONFLICT (no silent data loss) | unit (repo) | `npx vitest run src/store/__tests__/version-repo.test.ts -t "concurrent UNIQUE retry"` | ✅ | ✅ green |
| 02-01-03 | 01 | 1 | GEN-04 | V5 | completed_at immutable (second update ignored via `WHERE completed_at IS NULL`) | unit (repo) | `npx vitest run src/store/__tests__/version-repo.test.ts -t "completed_at immutability"` | ✅ | ✅ green |
| 02-01-04 | 01 | 1 | — | — | FakeComfyUIClient + FakeEngine extended (test doubles) — type-level verification | typecheck | `npx tsc --noEmit` | ✅ | ✅ green |
| 02-02-01 | 02 | 2 | GEN-01 | V2 / V9 | Live submit against real Cloud (gated): `X-API-Key` header, TLS, last-4 log only | live-smoke | `COMFYUI_API_KEY=... npx vitest run src/comfyui/__tests__/live-smoke.test.ts` | ✅ | ⚠️ flaky |
| 02-02-02 | 02 | 2 | GEN-01 | V5 / V8 | submit inserts version row with status='submitted', job_id from `prompt_id`; Zod rejects malformed workflow at tool boundary | unit | `npx vitest run src/engine/__tests__/generation.test.ts -t "submit inserts version row"` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | GEN-03 | — | status advances submitted → running → completed | unit (fake client) | `npx vitest run src/engine/__tests__/generation.test.ts -t "status advances"` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | GEN-03 | V5 | status on terminal state returns cached row (no API roundtrip; prevents quota burn) | unit | `npx vitest run src/engine/__tests__/generation.test.ts -t "status cached on terminal"` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | GEN-05 | V5 / V8 | Failed workflow → status=failed with extracted `node_errors` string; raw ComfyUI error not leaked | unit (fake client) | `npx vitest run src/engine/__tests__/generation.test.ts -t "failed records error"` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | GEN-07 | V10 | Backoff iterator yields `[2s, 4s, 8s, 16s, 30s, 30s, ...]` capped at 30s | unit (pure) | `npx vitest run src/engine/__tests__/backoff.test.ts` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | GEN-07 | V10 | Recovery poller drains pending rows on `Engine.start()` via backoff (per-version AbortController, shutdown-safe) | unit (fake timers) | `npx vitest run src/engine/__tests__/generation.test.ts -t "recovery poller"` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | GEN-07 | — | On-demand status call bypasses backoff (agent pace is the rate limiter) | unit | `npx vitest run src/engine/__tests__/generation.test.ts -t "on-demand status immediate"` | ✅ | ✅ green |
| 02-03-01 | 03 | 3 | GEN-02 | — | submit resolves quickly (< 1s), no network wait | integration | `npx vitest run src/tools/__tests__/generation-tool.test.ts -t "submit resolves quickly"` | ✅ | ✅ green |
| 02-03-01 | 03 | 3 | GEN-02 | V5 / V13 | submit response envelope: structuredContent + content[text], entity + breadcrumb (envelope shape invariant; no raw JSON) | integration | `npx vitest run src/tools/__tests__/generation-tool.test.ts -t "submit envelope shape"` | ✅ | ✅ green |
| 02-03-03 | 03 | 3 | TOOL-01 | — | Tool budget count = 5 (workspace/project/sequence/shot/generation) — invariant from D-GEN-03 | unit | `npx vitest run src/__tests__/tool-budget.test.ts` | ✅ | ✅ green |
| 02-03-03 | 03 | 3 | D-33, D-34 | — | `src/comfyui/**` has zero MCP SDK and zero DB imports — engine-tool separation + purity | unit | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ | ✅ green |
| 02-03-03 | 03 | 3 | TRNS-01 | V8 | stdout/stderr never contain `COMFYUI_API_KEY=` string — secret hygiene | unit | `npx vitest run src/__tests__/stdio-hygiene.test.ts` | ✅ | ✅ green |
| 02-03-04 | 03 | 3 | GEN-01 | V2 / V9 | Live-smoke end-to-end against real ComfyUI Cloud (gated on COMFYUI_API_KEY) | live-smoke | `COMFYUI_API_KEY=... npx vitest run src/comfyui/__tests__/live-smoke.test.ts` | ✅ | ⚠️ flaky |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Test Layers — Fake Boundaries

| Layer | Real Components | Fakes/Stubs | Why |
|-------|-----------------|-------------|-----|
| **Unit: format** | Pure TS (`src/comfyui/format.ts`) | — | No I/O |
| **Unit: backoff** | Pure generator | — | No I/O |
| **Unit: version-repo** | In-memory SQLite via Phase 1 `makeInMemoryDb()` | — | SQL semantics are the SUT |
| **Unit: engine.generation** | Engine + real `VersionRepo` + in-mem SQLite | `FakeComfyUIClient` (injected via Engine constructor) | Isolate state machine + download orchestration from network |
| **Integration: generation-tool** | Full stack (McpServer + Engine + in-mem SQLite) via `InMemoryTransport` pair | `FakeComfyUIClient` | Zod dispatch, envelope shape, breadcrumb, error wrapping at the MCP boundary |
| **Cross-cutting** | Phase 1's three grep-based tests | — | Extend `tool-budget` 4→5; extend `architecture-purity` to cover `src/comfyui/`; extend `stdio-hygiene` to block `COMFYUI_API_KEY=` |
| **Integration: migration** | Real `drizzle-orm/better-sqlite3/migrator`, fresh + existing Phase-1 DB | — | Confirm idempotence under Phase 1's `user_version=1` + Phase 2's `__drizzle_migrations` coexistence |
| **Live smoke** | Full stack + real `ComfyUIClient` + real network | — | Gated by `if (!process.env.COMFYUI_API_KEY) test.skip()`; cheap 1-node or classical-5-node SD1.5 workflow; asserts `completed` within 3 min + output file on disk; cleans up DB row + downloaded files |

---

## Wave 0 Requirements

Wave 0 creates all test infrastructure BEFORE any implementation task runs:

- [x] `src/test-utils/fake-comfyui-client.ts` — mirrors `FakeEngine` pattern; spy methods `submit`, `status`, `download` + scenario modes (happy-path, failed-validation, slow-running, timeout, download-flaky, download-hopeless). ~120 lines.
- [x] `src/test-utils/fake-engine.ts` — **extend** with `submitGeneration`, `getGenerationStatus`, `start`, `stop` so tool-layer tests don't pull in a real Engine.
- [x] `src/comfyui/__tests__/format.test.ts` — UI-format fixture (from a real ComfyUI export), API-format minimal fixture, edge cases. ~80 lines.
- [x] `src/engine/__tests__/backoff.test.ts` — pure generator assertions with `vi.useFakeTimers()`. ~30 lines.
- [x] `src/store/__tests__/version-repo.test.ts` — seed workspace→project→sequence→shot; assert version-number monotonicity, UNIQUE race (simulated), transition invariants, `completed_at` immutability. ~150 lines.
- [x] `src/engine/__tests__/generation.test.ts` — uses `FakeComfyUIClient`; covers submit→status, timeout path, download-retry path, recovery poller. ~200 lines.
- [x] `src/tools/__tests__/generation-tool.test.ts` — integration via `InMemoryTransport` pair; asserts envelope, Zod rejection (→ `INVALID_INPUT`), error wrapping, breadcrumb on every response. ~100 lines.
- [x] `src/comfyui/__tests__/live-smoke.test.ts` — minimal cheap workflow; gated on `process.env.COMFYUI_API_KEY`; full `submit → status → download → verify on disk` path. ~60 lines.
- [x] `src/store/__tests__/migrate.test.ts` — idempotent-apply test for Drizzle migration runner against a temp-file SQLite DB (WAL). ~40 lines.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All Phase 2 behaviors have automated verification. Live-smoke is gated-automatic (requires `COMFYUI_API_KEY`), not manual.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all ❌ references above
- [x] No watch-mode flags in `<verify>` blocks
- [x] Feedback latency < 20s for unit+integration
- [x] `nyquist_compliant: true` set in frontmatter (Phase 9, 2026-04-28)

**Approval:** closed 2026-04-28 (Phase 9 retrofit)

### Known flaky tests

- `live-smoke.test.ts` — skipped pending `COMFYUI_API_KEY` set; live endpoint drift documented separately in `02-VERIFICATION.md` Phase 7 supplement section. Skip-by-design, not failure.

---

## Validation Audit 2026-04-28

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (no real gaps surfaced; bookkeeping retrofit only) |
| Escalated | 0 |

Wave 0 closure: nyquist_compliant + wave_0_complete + status:closed all set in frontmatter; Per-Task Verification Map populated with final task IDs; baseline vitest run 754/757 green confirms infrastructure intact. See `.planning/phases/09-nyquist-wave0-closure/09-CONTEXT.md` decisions and `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` for observable truths.
