---
phase: 2
slug: comfyui-generation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `02-RESEARCH.md` §"Validation Architecture". Per-task plan/task IDs resolved when `02-XX-PLAN.md` files land.

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

## Per-Requirement Verification Map

| Req ID | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| GEN-01 | submit inserts version row with status='submitted', job_id from `prompt_id` | V5 / V8 | Zod rejects malformed workflow at tool boundary; no raw ComfyUI errors surfaced | unit | `npx vitest run src/engine/__tests__/generation.test.ts -t "submit inserts version row"` | ❌ W0 | ⬜ pending |
| GEN-01 | live submit against real Cloud (gated) | V2 / V9 | `X-API-Key` header, TLS, last-4 log only | live-smoke | `COMFYUI_API_KEY=... npx vitest run src/comfyui/__tests__/live-smoke.test.ts` | ❌ W0 | ⬜ pending |
| GEN-02 | submit resolves quickly (< 1s), no network wait | — | N/A | integration | `npx vitest run src/tools/__tests__/generation-tool.test.ts -t "submit resolves quickly"` | ❌ W0 | ⬜ pending |
| GEN-02 | submit response envelope: structuredContent + content[text], entity + breadcrumb | V5 / V13 | Envelope shape invariant; no raw JSON | integration | `npx vitest run src/tools/__tests__/generation-tool.test.ts -t "submit envelope shape"` | ❌ W0 | ⬜ pending |
| GEN-03 | status advances submitted → running → completed | — | N/A | unit (fake client) | `npx vitest run src/engine/__tests__/generation.test.ts -t "status advances"` | ❌ W0 | ⬜ pending |
| GEN-03 | status on terminal state returns cached row (no API roundtrip) | — | Prevents quota burn on terminal reads | unit | `npx vitest run src/engine/__tests__/generation.test.ts -t "status cached on terminal"` | ❌ W0 | ⬜ pending |
| GEN-04 | version_number = MAX(shot_id)+1; UNIQUE(shot_id, version_number) enforced | V5 | Append-only, no overwrite | unit (repo) | `npx vitest run src/store/__tests__/version-repo.test.ts -t "version number monotone"` | ❌ W0 | ⬜ pending |
| GEN-04 | Concurrent submit → retry once on UNIQUE, then CONCURRENT_SUBMIT_CONFLICT | V5 | No silent data loss | unit (repo) | `npx vitest run src/store/__tests__/version-repo.test.ts -t "concurrent UNIQUE retry"` | ❌ W0 | ⬜ pending |
| GEN-04 | completed_at immutable (second update ignored via `WHERE completed_at IS NULL`) | V5 | Provenance-compatible | unit (repo) | `npx vitest run src/store/__tests__/version-repo.test.ts -t "completed_at immutability"` | ❌ W0 | ⬜ pending |
| GEN-05 | Failed workflow → status=failed with extracted `node_errors` string | V5 / V8 | Raw ComfyUI error object not leaked to agent | unit (fake client) | `npx vitest run src/engine/__tests__/generation.test.ts -t "failed records error"` | ❌ W0 | ⬜ pending |
| GEN-05 | `extractFirstNodeError` returns `"Node {id} ({class_type}): {message}"` for fixture | V5 | Flattening is deterministic | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "extractFirstNodeError"` | ❌ W0 | ⬜ pending |
| GEN-06 | UI-format (nodes/links/groups keys) rejected with INVALID_WORKFLOW_FORMAT + hint | V5 | Guards against prompt-blob confusion | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "UI-format rejected"` | ❌ W0 | ⬜ pending |
| GEN-06 | API-format (numeric-string keys → {class_type, inputs}) accepted | V5 | N/A | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "API-format accepted"` | ❌ W0 | ⬜ pending |
| GEN-06 | Edge cases rejected: `{}`, `[]`, `null`, mixed keys, missing `class_type` | V5 | Robust against malformed agent input | unit | `npx vitest run src/comfyui/__tests__/format.test.ts -t "format edge cases"` | ❌ W0 | ⬜ pending |
| GEN-07 | Backoff iterator yields `[2s, 4s, 8s, 16s, 30s, 30s, ...]` capped at 30s | V10 | No quota burn under rate limit | unit (pure) | `npx vitest run src/engine/__tests__/backoff.test.ts` | ❌ W0 | ⬜ pending |
| GEN-07 | Recovery poller drains pending rows on `Engine.start()` via backoff | V10 | Per-version `AbortController`, shutdown-safe | unit (fake timers) | `npx vitest run src/engine/__tests__/generation.test.ts -t "recovery poller"` | ❌ W0 | ⬜ pending |
| GEN-07 | On-demand status call bypasses backoff (agent pace is the rate limiter) | — | N/A | unit | `npx vitest run src/engine/__tests__/generation.test.ts -t "on-demand status immediate"` | ❌ W0 | ⬜ pending |
| Cross-cutting | Tool budget count = 5 (workspace/project/sequence/shot/generation) | — | Invariant from D-GEN-03 | unit | `npx vitest run src/__tests__/tool-budget.test.ts` | ✅ (extend) | ⬜ pending |
| Cross-cutting | `src/comfyui/**` has zero MCP SDK and zero DB imports | — | Engine–tool separation + purity | unit | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ (extend) | ⬜ pending |
| Cross-cutting | stdout/stderr never contain `COMFYUI_API_KEY=` string | V8 | Secret hygiene | unit | `npx vitest run src/__tests__/stdio-hygiene.test.ts` | ✅ (extend) | ⬜ pending |
| Migration | Drizzle migration 0001 applies idempotently on second boot | V5 | Schema push gate (blocking) | integration | `npx vitest run src/store/__tests__/migrate.test.ts -t "idempotent"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Plan/task IDs resolved when `02-XX-PLAN.md` files land; planner updates this table per task.*

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

- [ ] `src/test-utils/fake-comfyui-client.ts` — mirrors `FakeEngine` pattern; spy methods `submit`, `status`, `download` + scenario modes (happy-path, failed-validation, slow-running, timeout, download-flaky, download-hopeless). ~120 lines.
- [ ] `src/test-utils/fake-engine.ts` — **extend** with `submitGeneration`, `getGenerationStatus`, `start`, `stop` so tool-layer tests don't pull in a real Engine.
- [ ] `src/comfyui/__tests__/format.test.ts` — UI-format fixture (from a real ComfyUI export), API-format minimal fixture, edge cases. ~80 lines.
- [ ] `src/engine/__tests__/backoff.test.ts` — pure generator assertions with `vi.useFakeTimers()`. ~30 lines.
- [ ] `src/store/__tests__/version-repo.test.ts` — seed workspace→project→sequence→shot; assert version-number monotonicity, UNIQUE race (simulated), transition invariants, `completed_at` immutability. ~150 lines.
- [ ] `src/engine/__tests__/generation.test.ts` — uses `FakeComfyUIClient`; covers submit→status, timeout path, download-retry path, recovery poller. ~200 lines.
- [ ] `src/tools/__tests__/generation-tool.test.ts` — integration via `InMemoryTransport` pair; asserts envelope, Zod rejection (→ `INVALID_INPUT`), error wrapping, breadcrumb on every response. ~100 lines.
- [ ] `src/comfyui/__tests__/live-smoke.test.ts` — minimal cheap workflow; gated on `process.env.COMFYUI_API_KEY`; full `submit → status → download → verify on disk` path. ~60 lines.
- [ ] `src/store/__tests__/migrate.test.ts` — idempotent-apply test for Drizzle migration runner against a temp-file SQLite DB (WAL). ~40 lines.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All Phase 2 behaviors have automated verification. Live-smoke is gated-automatic (requires `COMFYUI_API_KEY`), not manual.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all ❌ references above
- [ ] No watch-mode flags in `<verify>` blocks
- [ ] Feedback latency < 20s for unit+integration
- [ ] `nyquist_compliant: true` set in frontmatter once planner resolves all plan/task IDs

**Approval:** pending
