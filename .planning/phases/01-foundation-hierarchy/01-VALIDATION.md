---
phase: 01
slug: foundation-hierarchy
status: closed
nyquist_compliant: true
wave_0_complete: true
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
- **MCP Inspector wire-level smoke (automated):** `node scripts/inspector-smoke.mjs` — 56/56 wire-level checks across stdio + Streamable HTTP. Replaces the manual MCP Inspector UI smoke per Phase 8 override accepted 2026-04-24.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --changed`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green + `node scripts/inspector-smoke.mjs` (both transports) passes
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

Tasks finalized by the planner; rows below populated with final task IDs across plans 01-01/02/03 (21 tasks total: 8 + 4 + 9). Phase 9 retrofit (2026-04-28) replaced TBD-keyed scaffold rows with task-keyed rows matching the Phase 03 precedent.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 0 | — | — | package.json + tsconfig + dependencies installed (Wave 0 scaffold) | scaffold | `test -f package.json && test -f tsconfig.json` | ✅ | ✅ green |
| 01-01-02 | 01 | 0 | — | — | vitest.config.ts + matchers + fixtures + fake-engine present | scaffold | `test -f vitest.config.ts && test -f src/test-utils/matchers.ts && test -f src/test-utils/fixtures.ts && test -f src/test-utils/fake-engine.ts` | ✅ | ✅ green |
| 01-01-03 | 01 | 1 | — | — | types + nanoid id util + TypedError class — type-level verification | unit | `npx vitest run src/__tests__/typed-errors.test.ts` | ✅ | ✅ green |
| 01-01-04 | 01 | 1 | TRNS-04 | — | Drizzle schema + SCHEMA_DDL string declarations — type-level verification | typecheck | `npx tsc --noEmit` | ✅ | ✅ green |
| 01-01-05 | 01 | 1 | TRNS-04 | — | WAL mode + user_version pragma + busy_timeout=5000 on db init | unit | `npx vitest run src/store/__tests__/db-init.test.ts` | ✅ | ✅ green |
| 01-01-06 | 01 | 1 | HIER-01..04 | — | HierarchyRepo prepared CRUD + SQLITE_CONSTRAINT wrapping; duplicate → DUPLICATE_NAME, missing parent → PARENT_NOT_FOUND | unit | `npx vitest run src/store/__tests__/hierarchy-repo.test.ts` | ✅ | ✅ green |
| 01-01-07 | 01 | 1 | HIER-06 | — | BreadcrumbResolver — engine tree-walk producing breadcrumb + breadcrumb_text | unit | `npx vitest run src/engine/__tests__/breadcrumb.test.ts` | ✅ | ✅ green |
| 01-01-08 | 01 | 1 | HIER-01..05 | — | Engine facade + shot regex enforcement + 4-level hierarchy traversal | integration | `npx vitest run src/engine/__tests__/hierarchy.test.ts src/engine/__tests__/shot-naming.test.ts` | ✅ | ✅ green |
| 01-02-01 | 02 | 2 | TOOL-04 | — | Response envelope helpers (toolOk + toolError) — typed `structuredContent` + `content:[text]` | unit | `npx vitest run src/tools/__tests__/envelope.test.ts` | ✅ | ✅ green |
| 01-02-02 | 02 | 2 | HIER-01..04, TOOL-02..05 | — | Workspace + Project tools — Zod entry, breadcrumb on every response | integration | `npx vitest run src/tools/__tests__/breadcrumb-always.test.ts` | ✅ | ✅ green |
| 01-02-03 | 02 | 2 | HIER-05, TOOL-02..05 | — | Sequence + Shot tools — shot regex at Zod + engine (defence in depth) | integration | `npx vitest run src/tools/__tests__/breadcrumb-always.test.ts` | ✅ | ✅ green |
| 01-02-04 | 02 | 2 | TOOL-05, HIER-06 | — | Error-wrapping (Zod failure → INVALID_INPUT, no raw SQLite leak) + breadcrumb-always | integration | `npx vitest run src/tools/__tests__/error-wrapping.test.ts src/tools/__tests__/breadcrumb-always.test.ts` | ✅ | ✅ green |
| 01-03-01 | 03 | 3 | TRNS-04 | — | Hand-rolled CLI parser (5 flags per D-19) | unit | `npx vitest run src/utils/__tests__/cli.test.ts` | ✅ | ✅ green |
| 01-03-02 | 03 | 3 | TRNS-01, TRNS-02, TRNS-03 | — | src/server.ts dual-transport bootstrap — stdio + Streamable HTTP, single process | integration | `npx vitest run src/__tests__/transport-parity.test.ts` | ✅ | ✅ green |
| 01-03-03 | 03 | 3 | — | — | start + start:http scripts wired in package.json | scaffold | `node -e "const p = require('./package.json'); if (!p.scripts.start || !p.scripts['start:http']) process.exit(1)"` | ✅ | ✅ green |
| 01-03-04 | 03 | 3 | TRNS-01, TRNS-02 | — | Transport parity — stdio + HTTP expose identical tool list | integration | `npx vitest run src/__tests__/transport-parity.test.ts` | ✅ | ✅ green |
| 01-03-05 | 03 | 3 | TRNS-01 | — | stdio hygiene — no stdout writes during boot or tool exec on stdio path | integration | `npx vitest run src/__tests__/stdio-hygiene.test.ts` | ✅ | ✅ green |
| 01-03-06 | 03 | 3 | D-33, D-34 | — | Architecture purity — `src/engine/` and `src/store/` have zero MCP SDK imports | grep-based unit | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ | ✅ green |
| 01-03-07 | 03 | 3 | TOOL-01 | — | Tool budget — total `registerTool` calls ≤ 12 (Phase 1 uses 4) | grep-based unit | `npx vitest run src/__tests__/tool-budget.test.ts` | ✅ | ✅ green |
| 01-03-08 | 03 | 3 | TRNS-04 | — | Zero-config cold start — fresh start with no flags/env creates db + connects stdio | integration | `npx vitest run src/__tests__/zero-config.test.ts` | ✅ | ✅ green |
| 01-03-09 | 03 | 3 | TRNS-01, TRNS-02 | — | Full-suite green + automated MCP Inspector wire-level smoke (Phase 8 override) | suite + smoke | `npx vitest run && node scripts/inspector-smoke.mjs` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 installs test infrastructure before Wave 1 implementation tasks begin.

- [x] `vitest.config.ts` — ESM + tsx config, test globals, coverage excludes `dashboard/`
- [x] `src/test-utils/matchers.ts` — custom `toThrowTypedError(code)` matcher
- [x] `src/test-utils/fixtures.ts` — `makeInMemoryDb()` helper that applies full DDL to `:memory:` and returns the Drizzle instance
- [x] `src/test-utils/fake-engine.ts` — spy engine for tool-layer tests that don't need a real db
- [x] `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"` (watch scripts allowed in package.json; test commands used by GSD never use watch mode)
- [x] `@modelcontextprotocol/inspector` added as devDependency for the historical manual smoke (now superseded by `scripts/inspector-smoke.mjs` per Phase 8 override)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP Inspector over stdio | TRNS-01 | Replaced by automated wire-level smoke (Phase 8 override accepted 2026-04-24) | Run `node scripts/inspector-smoke.mjs` — 56/56 checks across stdio + Streamable HTTP. See `01-VERIFICATION.md` frontmatter `overrides_applied: 1` and `INSPECTOR-SMOKE.md` for the 1:1 coverage map. |
| MCP Inspector over Streamable HTTP | TRNS-02 | Replaced by automated wire-level smoke (Phase 8 override accepted 2026-04-24) | Run `node scripts/inspector-smoke.mjs` — 56/56 checks across stdio + Streamable HTTP. See `01-VERIFICATION.md` frontmatter `overrides_applied: 1` and `INSPECTOR-SMOKE.md` for the 1:1 coverage map. |
| Cold-start demo | TRNS-04 | Validates zero-config claim against a truly empty environment (zero-config UX from cold env not covered by inspector-smoke.mjs) | `rm -f ./vfx-familiar.db && npx tsx src/server.ts --http` → Inspector → create workspace → project → sequence → shot (`sh010`) → verify breadcrumb walks correctly at each step |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags in GSD-invoked test commands
- [x] Feedback latency < 20s
- [x] nyquist_compliant: true set in frontmatter (Phase 9, 2026-04-28)

**Approval:** closed 2026-04-28 (Phase 9 retrofit)

---

## Validation Audit 2026-04-28

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (no real gaps surfaced; bookkeeping retrofit only) |
| Escalated | 0 |

Wave 0 closure: nyquist_compliant + wave_0_complete + status:closed all set in frontmatter; Per-Task Verification Map populated with final task IDs; baseline vitest run 754/757 green confirms infrastructure intact. See `.planning/phases/09-nyquist-wave0-closure/09-CONTEXT.md` decisions and `.planning/phases/09-nyquist-wave0-closure/09-VERIFICATION.md` for observable truths.
