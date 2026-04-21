---
phase: 01
slug: foundation-hierarchy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1 (per STACK.md) |
| **Config file** | `vitest.config.ts` (created in Wave 0) |
| **Quick run command** | `npx vitest run --changed` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds (unit + in-memory SQLite integration) |

Additional non-unit harnesses:
- **MCP Inspector (manual smoke):** `npx @modelcontextprotocol/inspector npx tsx src/server.ts` and `--http` variant. Used before declaring phase complete.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --changed`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green + MCP Inspector smoke (both transports) passes
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

Tasks are finalized by the planner. This section is seeded with the invariants from RESEARCH.md §Validation Architecture and will be expanded to one row per task after PLAN.md files exist.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-WAVE0-01 | 00 | 0 | — | — | vitest config + fixtures exist | scaffold | `test -f vitest.config.ts && test -f src/test-utils/matchers.ts` | ❌ W0 | ⬜ pending |
| 01-DB-WAL | TBD | TBD | TRNS-04 | — | WAL mode active after `openDb()` | unit | `npx vitest run src/store/__tests__/db-init.test.ts` | ❌ W0 | ⬜ pending |
| 01-DB-VERSION | TBD | TBD | — (pitfall #10) | — | `user_version` pragma set on fresh db | unit | `npx vitest run src/store/__tests__/db-init.test.ts` | ❌ W0 | ⬜ pending |
| 01-HIER-CREATE | TBD | TBD | HIER-01..04 | — | create returns entity + breadcrumb | integration | `npx vitest run src/engine/__tests__/hierarchy.test.ts` | ❌ W0 | ⬜ pending |
| 01-HIER-DUP | TBD | TBD | HIER-01..04 | — | duplicate name → `DUPLICATE_NAME` (not raw SQLite) | integration | `npx vitest run src/engine/__tests__/hierarchy.test.ts` | ❌ W0 | ⬜ pending |
| 01-HIER-PARENT | TBD | TBD | HIER-01..04 | — | missing parent → `PARENT_NOT_FOUND` | integration | same | ❌ W0 | ⬜ pending |
| 01-SHOT-REGEX | TBD | TBD | HIER-05 | — | `sh010`/`sh0120`/`sh1000` pass; `SH010`/`sh1`/`sh_010` fail `INVALID_SHOT_FORMAT` | unit (parameterized) | `npx vitest run src/engine/__tests__/shot-naming.test.ts` | ❌ W0 | ⬜ pending |
| 01-BREADCRUMB | TBD | TBD | HIER-06 | — | every create/get/list item has `breadcrumb` + `breadcrumb_text` | integration | `npx vitest run src/tools/__tests__/breadcrumb-always.test.ts` | ❌ W0 | ⬜ pending |
| 01-TOOL-ENVELOPE | TBD | TBD | TOOL-04 | — | every success returns both `structuredContent` and `content:[text]` | unit | `npx vitest run src/tools/__tests__/envelope.test.ts` | ❌ W0 | ⬜ pending |
| 01-TOOL-ERRORS | TBD | TBD | TOOL-05 | — | errors use typed codes with `isError:true`; raw Zod/SQLite never leaks | unit | `npx vitest run src/tools/__tests__/error-wrapping.test.ts` | ❌ W0 | ⬜ pending |
| 01-ZOD-REWRAP | TBD | TBD | TOOL-03, TOOL-05 | — | Zod failure → `INVALID_INPUT` with path in message | unit | same | ❌ W0 | ⬜ pending |
| 01-TRANSPORT-PARITY | TBD | TBD | TRNS-01, TRNS-02 | — | stdio + HTTP expose identical tool list | integration | `npx vitest run src/__tests__/transport-parity.test.ts` | ❌ W0 | ⬜ pending |
| 01-STDIO-HYGIENE | TBD | TBD | TRNS-01 | — | no stdout writes during boot or tool exec on stdio path | integration | `npx vitest run src/__tests__/stdio-hygiene.test.ts` | ❌ W0 | ⬜ pending |
| 01-ARCH-PURITY | TBD | TBD | D-33, D-34 | — | `src/engine/` and `src/store/` have zero MCP SDK imports | grep-based unit | `npx vitest run src/__tests__/architecture-purity.test.ts` | ❌ W0 | ⬜ pending |
| 01-TOOL-BUDGET | TBD | TBD | TOOL-01 | — | total `registerTool` calls ≤ 12 (Phase 1 uses 4) | grep-based unit | `npx vitest run src/__tests__/tool-budget.test.ts` | ❌ W0 | ⬜ pending |
| 01-ZERO-CONFIG | TBD | TBD | TRNS-04 | — | fresh start with no flags/env creates db + connects stdio | integration | `npx vitest run src/__tests__/zero-config.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*After planner completes, each row's `Plan` and `Wave` columns must be populated, `Task ID` aligned to `{phase}-{plan}-{task}` form, and added task rows must map 1:1 to plan tasks.*

---

## Wave 0 Requirements

Wave 0 installs test infrastructure before Wave 1 implementation tasks begin.

- [ ] `vitest.config.ts` — ESM + tsx config, test globals, coverage excludes `dashboard/`
- [ ] `src/test-utils/matchers.ts` — custom `toThrowTypedError(code)` matcher
- [ ] `src/test-utils/fixtures.ts` — `makeInMemoryDb()` helper that applies full DDL to `:memory:` and returns the Drizzle instance
- [ ] `src/test-utils/fake-engine.ts` — spy engine for tool-layer tests that don't need a real db
- [ ] `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"` (watch scripts allowed in package.json; test commands used by GSD never use watch mode)
- [ ] `@modelcontextprotocol/inspector` added as devDependency for manual smoke

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP Inspector over stdio | TRNS-01 | Real MCP client roundtrip — protocol framing, capability negotiation, tool discovery | `npx @modelcontextprotocol/inspector npx tsx src/server.ts` → open Inspector UI → verify 4 tools listed → invoke `workspace action=create name=test` → see breadcrumb in response |
| MCP Inspector over Streamable HTTP | TRNS-02 | Transport-specific integration — session handshake, HTTP transport framing | `npx tsx src/server.ts --http` in one terminal; `npx @modelcontextprotocol/inspector` → select HTTP, URL `http://localhost:3000/mcp` → verify same 4 tools → invoke `workspace action=list` → see envelope |
| Cold-start demo | TRNS-04 | Validates zero-config claim against a truly empty environment | `rm -f ./vfx-familiar.db && npx tsx src/server.ts --http` → Inspector → create workspace → project → sequence → shot (`sh010`) → verify breadcrumb walks correctly at each step |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags in GSD-invoked test commands
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner populates per-task rows + auditor confirms coverage)

**Approval:** pending
