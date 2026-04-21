# Phase 1 — gstack Review Fix Summary

**Review source:** `.planning/phases/01-foundation-hierarchy/01-GSTACK-REVIEW.md`
**Fix plan target:** 19 atomic commits applying the full "Fix plan → Atomic commits to apply now" table.
**Completion date:** 2026-04-21.

---

## Headline

- **18 commits applied** (the planned 19th — RT-11 exhaustiveness — was already landed as a side-effect of commit 1).
- **Test delta: 267 → 300 passing** (+33 net), 1 skipped (unchanged).
- **TypeScript `tsc --noEmit`:** clean at every commit.
- **Working tree:** clean; linear additive history from HEAD `63d1b57` → `0a6596f`.
- **Zero deferrals** beyond what the review had already flagged for later (API-01, API-03, API-04, PERF-*, MNT-02/03/07, CP-03/04, TEST-* bundle).

---

## Commit trace (chronological)

| # | Commit | Finding(s) | Files | Tests added |
|---|--------|-----------|-------|-------------|
| 1 | `3825785` | RT-01, RT-02, RT-10 | 5 tool files + `tools/shape.ts` + `transport-parity.test.ts` | 2 (inputSchema.properties non-empty; INVALID_INPUT envelope shape) |
| 2 | `43e5ff9` | SEC-01, API-05 | 5 tool files + new `tools/__tests__/input-bounds.test.ts` | 6 (name/notes at/over max across tools) |
| 3 | `2b88f32` | SEC-02 | `generation-tool.ts`, `comfyui/format.ts`, `tools/shape.ts`, two test files | 2 (2001-node rejection; 5MB+ serialized) |
| 4 | `c21241c` | SEC-03 | `server.ts`, `.env.example`, new `__tests__/http-origin.test.ts` | 3 (evil/missing/allowed Origin) |
| 5 | `7f14e1f` | RT-05 | 3 hierarchy tool files + `input-bounds.test.ts` | 3 (names with " > " rejected) |
| 6 | `13abb69` | DM-01 (partial — trim only) | 4 tool files + `input-bounds.test.ts` | 1 (whitespace-normalized insert + dup reject) |
| 7 | `c46e1bd` | RT-04, RT-08 | `server.ts`, `utils/cli.ts`, new `utils/__tests__/cli.test.ts` | 11 (port boundary + rejection cases) |
| 8 | `00cb670` | RT-06 | `server.ts` | 0 (structural cleanup) |
| 9 | `cda9a37` | RT-03 | `store/hierarchy-repo.ts`, `engine/__tests__/hierarchy.test.ts` | 1 (deterministic pagination across 3 pages) |
| 10 | `7eaf9a9` | DM-02 | `store/db.ts` | 0 (existing test still passes) |
| 11 | `0420523` | MNT-01 | delete `test-utils/fake-engine.ts` | 0 (delete only) |
| 12 | `288367c` | API-02 | `shape.ts`, `pipeline.ts`, `hierarchy-repo.ts`, 2 test files | 0 (renamed, not added) |
| — | (folded into #1) | RT-11 | — | — |
| 13 | `d483640` | RT-09, API-06 | `server.ts`, `transport-parity.test.ts` | 1 (listChanged: false advertised) |
| 14 | `c4c4706` | RT-07, API-07 | `server.ts`, `http-origin.test.ts` | 4 (GET/DELETE/PUT/PATCH → 405 JSON-RPC) |
| 15 | `c3df1c8` | MNT-04 | `types/hierarchy.ts`, `engine/pipeline.ts`, `tools/shot-tool.ts` | 0 (structural; existing tests cover) |
| 16 | `ed0b18f` | MNT-05 | `store/db.ts`, `test-utils/fixtures.ts` | 0 (constant extract) |
| 17 | `3a2a7bb` | MNT-06, MNT-08 | `store/db.ts`, `store/schema.ts`, `utils/cli.ts` | 0 (doc-only) |
| 18 | `0a6596f` | DM-03 | `store/schema.ts`, `store/__tests__/db-init.test.ts` | 0 (inverted existing test) |

---

## Commit-by-commit notes

### 1 — RT-01 + RT-02 + RT-10 (CRITICAL)

The MCP SDK's `normalizeObjectSchema` returned `undefined` for every tool because each registered a `z.discriminatedUnion` directly. Two root causes:

1. **Empty JSON Schema leaked to agents.** `tools/list` returned `{type:"object", properties:{}}` for all 5 tools.
2. **Zod pre-validation short-circuited the handler.** The SDK's own `validateToolInput` fired before the handler callback, so the `instanceof z.ZodError` catch branch was dead code; raw Zod issue JSON leaked to agents with no `structuredContent.code`.

**Fix.** Switched every tool's `inputSchema` to a raw `ZodRawShape` with permissive optional fields (string/number without `.min`/`.max` at this layer). The SDK wraps the shape into `z.object(...)` at registration time, producing real JSON Schema properties. Handler-side `<Tool>InputSchema.parse(rawInput)` (the preserved discriminated union) is now the authoritative validator — it fires on every call and triggers the `z.ZodError` catch cleanly.

**Unexpected finding.** Naive first attempt (leaving `.max()` on the raw shape) regressed: the SDK's pre-validation still fired and the handler's catch remained unreachable for max-exceeding input. Pulled all bounds down to the handler layer only — the tool-boundary re-validation is now the single source of truth.

Also added the RT-11 exhaustiveness check (`const _exhaustive: never = input; throw new TypedError('INVALID_INPUT', ...)`) in every tool's `default:` branch as part of this commit; this is why a standalone RT-11 commit (#13 in the planned list) was not necessary.

### 2 — SEC-01 + API-05

Name fields now carry `.max(MAX_NAME_LENGTH=200)` and notes fields `.max(MAX_NOTES_LENGTH=4000)` inside every discriminated-union schema. New `input-bounds.test.ts` exercises the boundary via live `InMemoryTransport` for all 5 tools.

### 3 — SEC-02

Two-layer defence:
- Tool boundary: Zod `.refine()` on `workflow_json` rejects >2000 top-level node keys with `INVALID_INPUT`.
- Engine boundary: `validateWorkflowFormat` computes `JSON.stringify(payload).length` once and rejects >5MB with `INVALID_INPUT`.

### 4 — SEC-03

Hono middleware rejects un-allowlisted Origin headers with 403 + actionable hint. Non-browser MCP clients (no Origin header) are always allowed. New `HTTP_ALLOWED_ORIGINS` env var documented in `.env.example`.

### 5 — RT-05

`Zod .refine()` on every name field rejects `" > "` substring. Shot names already excluded the separator via `^sh\d{3,}$`.

### 6 — DM-01 (partial)

`z.string().trim()` added before `.min/.max/.refine` chain so UNIQUE comparison runs against the trimmed value. Case-insensitive uniqueness intentionally deferred (requires COLLATE NOCASE table rebuild).

### 7 — RT-04 + RT-08

- `requireInt` tightened to `/^[1-9]\d*$/` + explicit [1, 65535] range (rejects `0x10`, `1e10`, 0, 65536, negatives).
- `serve()` now takes a listeningListener (so the "listening" log only fires on successful bind) AND an `.on('error', ...)` handler that logs + `process.exit(1)` on `EADDRINUSE`/`EACCES`/`ERR_SOCKET_BAD_PORT`.
- New `cli.test.ts` with 11 parameterized cases.

### 8 — RT-06

`try/finally` + `res.on('close', …)` cleanup for the per-request `McpServer` + `StreamableHTTPServerTransport`.

### 9 — RT-03

`.orderBy(asc(<table>.created_at), asc(<table>.id))` added to every list query (4 methods × 2 branches = 8 call sites). New pagination test asserts no duplicates/gaps across 3 pages.

### 10 — DM-02

`sqlite.close()` now runs before the mismatch throw in `openDb`. Handle + WAL lock release cleanly.

### 11 — MNT-01

`src/test-utils/fake-engine.ts` deleted (zero importers, 149 LOC).

### 12 — API-02

`total` → `total_count` renamed through shape.ts, pipeline.ts ListResult type, hierarchy-repo.ts, hierarchy.test.ts, breadcrumb-always.test.ts.

### 13 — RT-09 + API-06

`server.server.registerCapabilities({ tools: { listChanged: false } })` after all `registerTool` calls. **Deviation from plan:** the review's suggested approach of passing `capabilities` to the `McpServer` constructor was unworkable because the SDK's `registerTool` *merges* `{tools: {listChanged: true}}` *over* the constructor option. The only override point is via `server.server.registerCapabilities` AFTER registration but BEFORE transport connect.

### 14 — RT-07 + API-07

`app.on(['GET','DELETE','PUT','PATCH'], '/mcp', ...)` returns JSON-RPC 2.0 error envelope with code -32000 and status 405.

### 15 — MNT-04

`SHOT_NAME_REGEX` exported from `src/types/hierarchy.ts`. Engine and tool layers both import the single constant (defence-in-depth preserved, drift eliminated).

### 16 — MNT-05

`BUSY_TIMEOUT_MS = 5000` exported from `src/store/db.ts`; test fixture imports it.

### 17 — MNT-06 + MNT-08

Doc-only update to:
- `openDb()` docstring (now mentions Drizzle migrator + Phase 2 migrations)
- `schema.ts` preamble (describes Phase 1 bootstrap / Phase 2 additive split)
- `cli.ts` module comment + help text (qualifies "no env vars" to "the CLI parser itself" + points to `.env.example`)

### 18 — DM-03

Four redundant FK indexes (`idx_projects_workspace`, `idx_sequences_project`, `idx_shots_sequence`, `idx_versions_shot`) removed from schema.ts and SCHEMA_DDL. `idx_versions_status` kept. `db-init.test.ts` flipped to assert the redundants DO NOT exist on a fresh install.

Existing DBs retain the indexes as harmless leftovers — migration SQL files (0001/0002) created them and are never re-run / never auto-revised. Documented in the commit message.

---

## Deviations from the plan

1. **RT-11 landed in commit 1 instead of a standalone commit #13.** The exhaustiveness check was part of the same file rewrite as RT-01/RT-02; splitting it out would have been artificial. Net: 18 actual commits vs. 19 planned. No deferred work.

2. **RT-09 (capabilities) required a different mechanism.** The planned `new McpServer(info, { capabilities: ... })` path is overridden by the SDK's own `registerTool`. Used `server.server.registerCapabilities(...)` AFTER registration instead (documented in-commit).

3. **RT-01/RT-02 raw-shape bounds.** First attempt kept `.max()` on the raw shape; the SDK's pre-validation fired on oversized input and skipped the handler. Moved all bounds to the handler-side discriminated-union schema only. This is why the commit description specifies "optional fields only" at the raw-shape layer.

4. **DM-01 deferred case-folding.** Trim-only. Case-insensitive uniqueness (e.g., `Foo` vs `foo`) would require a table rebuild (SQLite ALTER COLLATION limitation). Documented in the commit.

5. **DM-03 retained existing-DB indexes.** Dropping from schema.ts + SCHEMA_DDL covers fresh installs. Existing DBs keep the redundant indexes until the next re-baseline — no rollback risk, no test change beyond `db-init.test.ts`.

---

## Test delta

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| Test files passing | 20 | 23 | +3 |
| Tests passing | 267 | 300 | +33 |
| Tests skipped | 1 | 1 | 0 |
| TSC `--noEmit` exit code | 0 | 0 | 0 |

New test files:
- `src/tools/__tests__/input-bounds.test.ts` (12 tests — SEC-01/API-05/SEC-02/RT-05/DM-01)
- `src/utils/__tests__/cli.test.ts` (11 tests — RT-08)
- `src/__tests__/http-origin.test.ts` (7 tests — SEC-03, RT-07, API-07)

Tests added to existing files:
- `transport-parity.test.ts` — RT-01/RT-02/RT-10/RT-09 (+3 tests)
- `comfyui/__tests__/format.test.ts` — SEC-02 (+1 test)
- `engine/__tests__/hierarchy.test.ts` — RT-03 (+1 test)

---

## Follow-ups (documented, intentionally deferred per the review)

- **API-01** — camelCase vs snake_case in tool inputs. Requires user decision.
- **API-03** — generation dual error model. Requires design conversation.
- **API-04** — document `limit.max(100)` cap in tool descriptions. DX polish.
- **DM-01 case-folding** — requires COLLATE NOCASE table rebuild migration.
- **PERF-01..04** — BreadcrumbResolver N+4 queries per row; defer until UI traffic warrants.
- **PERF-05, PERF-06** — minor polish.
- **MNT-02, MNT-03, MNT-07** — opportunistic refactors.
- **CP-03, CP-04** — Phase 2+ concerns (already partly addressed by VersionRepo).
- **TEST-*** — bundle as a dedicated regression-test PR.
- **DM-03 existing-DB cleanup** — drop leftover indexes at next schema re-baseline.

All findings are either applied above, documented here as deferred with reason, or explicitly flagged as "defer" in the original review.
