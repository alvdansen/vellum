# Phase 1 — gstack Pre-Landing Review

**Scope:** Phase 1 source delta `f21c555..ef4c48e` (31 src/ files, 2966 lines — foundation + hierarchy + MCP tools + dual-transport bootstrap).

**Review pipeline:** 7 specialists in parallel — critical-pass, security, performance, testing, maintainability, data-migration, api-contract — plus red-team adversarial pass (qualified: diff > 200 lines).

**Headline:** **54 findings total — 2 CRITICAL (verified with live probe), 20 WARNING, 32 INFO.** Phase 1 passed all six specialists without any CRITICAL flag, but red-team's adversarial pass turned up **two structural contract breaks** the specialists missed: every tool's published JSON schema is empty, and the handler's input-validation error branch is dead code. Both confirmed against live `InMemoryTransport` — these are not theoretical.

---

## 🔴 CRITICAL (fix before any external agent integrates)

### RT-01 — Every tool publishes `inputSchema: { type: 'object', properties: {} }`
`src/tools/workspace-tool.ts:23, src/tools/project-tool.ts:26, src/tools/sequence-tool.ts:26, src/tools/shot-tool.ts:30` + generation-tool.

**Problem.** All 5 tools pass `inputSchema: <z.discriminatedUnion>` to `McpServer.registerTool`. The MCP SDK's `normalizeObjectSchema` returns `undefined` for any Zod schema whose `_zod.def.type !== 'object'` (discriminated unions are unions, not objects). The SDK then advertises an empty shape in `tools/list`. Every MCP client — Claude Desktop, Cursor, MCP Inspector — sees zero parameter metadata, no action discriminator, no `name`/`limit`/`offset` fields, no type hints. Runtime validation still fires (the SDK falls back to the raw Zod schema) but the discoverable contract is gone.

**Verified.** Live probe against `InMemoryTransport`:
```
RT-01 probe — tool inputSchemas:
  workspace: properties=[]
  project:   properties=[]
  sequence:  properties=[]
  shot:      properties=[]
```

**Fix (combined with RT-02).** Switch `inputSchema` from the discriminated-union directly to a raw `ZodRawShape`:
```ts
inputSchema: {
  action: z.enum(['create', 'list', 'get']),
  name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  id: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).optional(),
  offset: z.number().int().min(0).default(0).optional(),
}
```
The MCP SDK auto-wraps raw shapes into `z.object(...)` at registration time, so `tools/list` now publishes the real properties. Then re-validate with the discriminated union inside the handler body (`WorkspaceInput.parse(input)`) so the handler's existing `ZodError` catch becomes the real validation path. **This single change fixes RT-01 and RT-02 together.**

### RT-02 — Handler's `if (err instanceof z.ZodError)` branch is dead code; raw Zod JSON leaks to agents
All 5 tool handlers (`workspace-tool.ts:52`, `project-tool.ts:57`, `sequence-tool.ts:57`, `shot-tool.ts:63`, `generation-tool.ts`).

**Problem.** `McpServer.validateToolInput()` runs Zod **before** the handler callback. On validation failure it throws `McpError` (NOT `ZodError`) — the outer SDK catch wraps that as `{ isError: true, content: [{text: "Input validation error: <Zod issues as JSON>"}] }` with **no `structuredContent`, no `code` field**. The handler's `if (err instanceof z.ZodError)` branch never runs; `shot-tool.ts:69-76`'s `INVALID_SHOT_FORMAT` re-map is unreachable. Agents get raw Zod issue JSON (with implementation details like `origin`, `path`, `minimum`) and cannot detect `INVALID_INPUT` programmatically.

**Verified.** Live probe of `{action:'list', limit:-1}`:
```
isError: true
structuredContent: null
content[0].text: 'MCP error -32602: Input validation error: Invalid arguments for tool workspace: [
  {"origin":"number","code":"too_small","minimum":1,"inclusive":true,
   "path":["limit"],"message":"Too small: expected number to be >=1"}]'
```

**Fix.** Combined with RT-01 (switch to raw shape + re-validate inside handler). Also add a transport-parity test asserting `res.structuredContent.code === 'INVALID_INPUT'` for any Zod-failing input — this test would have caught both bugs.

---

## 🟡 WARNING (22 findings — ship-before-v1 tier)

### Input validation / trust boundaries
- **SEC-01, API-05 (dedupe)** — name/notes inputs use `z.string().min(1)` with **no `.max()`**. Unbounded strings land in SQLite TEXT and are replayed via breadcrumb on every descendant response, amplifying memory pressure. `workspace-tool.ts:11`, `project-tool.ts:13`, `sequence-tool.ts:13`, `generation-tool.ts:20`. **Fix:** add `.max(MAX_NAME_LENGTH=200)` for names, `.max(MAX_NOTES_LENGTH=4000)` for notes.
- **SEC-02** — `workflow_json: z.record(z.string(), z.unknown())` has no size/depth/node-count cap. A multi-MB workflow passes Zod and reaches `JSON.stringify`, potentially OOMing the process. `generation-tool.ts:19`. **Fix:** `.refine((obj) => Object.keys(obj).length <= MAX_WORKFLOW_NODES=2000)` plus a byte-size guard in `validateWorkflowFormat`.
- **SEC-03** — HTTP transport on `127.0.0.1` has **no Origin header check** → DNS-rebinding + CSRF vector. Malicious webpage in the user's browser can POST to `localhost:3000/mcp`; if `COMFYUI_API_KEY` is set, attacker triggers billable generation workloads. MCP Streamable HTTP spec explicitly recommends Origin validation. `server.ts:206-219`. **Fix:** Hono middleware that allowlists Origin header against `HTTP_ALLOWED_ORIGINS` env (default: empty → reject all cross-origin POSTs).
- **RT-05** — Breadcrumb `text` joins user-supplied names with ` > `; names containing ` > ` corrupt the D-22 separator contract. `breadcrumb.ts:79`. **Fix:** reject ` > ` in name Zod regex; document `breadcrumb.entries` as typed truth, `breadcrumb_text` as display-only.
- **DM-01** — Name UNIQUE constraints use SQLite BINARY collation; `"MyWorkspace"`, `"myworkspace"`, `"  MyWorkspace  "` all coexist. `schema.ts:9`. **Fix:** `.trim()` in Zod + `COLLATE NOCASE` on name columns (or application-layer `name.toLowerCase().trim()` for uniqueness comparison).

### Operational / Silent failure
- **RT-04** — HTTP bind errors (`EADDRINUSE`, `EACCES`, `ERR_SOCKET_BAD_PORT`) crash the whole process with an unhandled error **after** stderr logs "listening on ...". The already-working stdio transport dies too. `server.ts:219`. **Fix:** pass `listeningListener` to `serve()`, attach `.on('error', ...)` handler that logs + exits cleanly. Move the "listening" log into the listeningListener so it only fires on successful bind.
- **RT-06** — Per-request HTTP handler creates `McpServer` + `StreamableHTTPServerTransport`, calls `handleRequest`, but never calls `.close()`. V8 GC keeps up under 2k-req bursts empirically, but the pattern is fragile: throw in `handleRequest` (client disconnect) leaks the objects. `server.ts:206-215`. **Fix:** wrap handler in `try/finally` + `res.on('close', ...)` cleanup.
- **RT-03** — All four list queries **omit `ORDER BY`**. SQLite spec: rows returned in "arbitrary order"; pagination contract is undefined. Today SQLite returns rowid order by accident; future index or ANALYZE changes the order, silently breaking any agent that pages through results. `hierarchy-repo.ts:77, 143, 208, 275`. **Fix:** add `.orderBy(asc(table.created_at), asc(table.id))` to every list path.
- **DM-02** — On `user_version` mismatch, `openDb()` throws without calling `sqlite.close()`, leaking the fd and WAL lock. `db.ts:33`. **Fix:** capture error message, `sqlite.close()`, then throw.

### Contract
- **API-02** — Pagination envelope emits `total`; CLAUDE.md mandates `total_count`. Drift is cemented in tests. `shape.ts:36`. **Fix now (greenfield) or never** — rename `total` → `total_count` in shape.ts, engine return types, repo, tests.
- **API-01** — Tool input casing inconsistent: hierarchy tools use `workspaceId`/`projectId`/`sequenceId` (camelCase); generation tool uses `shot_id`/`version_id` (snake_case). **Entity outputs are uniformly snake_case**, so agents write `{workspaceId: X}` and read back `{workspace_id: Y}` on the same endpoint. ⚠️ **Breaking change — requires user decision** before normalization.
- **API-03** — Generation tool's "dual error model": same code (e.g., `COMFYUI_API_ERROR`) surfaces on `isError:true` during submit-phase, or on `isError:false` with `entity.error_code` during post-submit polling. Agent reading only `isError` silently treats failed generation as success. `generation-tool.ts:76-83, 113`. **Requires design decision**: unify under `isError` semantics, OR add explicit `domain_status: 'ok' | 'failed'` field.
- **API-04** — `limit.max(100)` rejects over-sized requests with `INVALID_INPUT`; cap is undocumented in tool descriptions. Agents discover by tripping it. **Fix:** add "limit: 1-100, default 20" to each tool description.

### Maintainability
- **MNT-01** — `src/test-utils/fake-engine.ts` has **zero importers repo-wide**. Scaffolded for Plan 02's tool tests but Plan 02 chose real-Engine + in-memory DB instead. ~144 LOC of dead test infra. **Fix:** delete it.

### Testing
- **TEST-01** — `parseCliFlags` has 5 flags, 3 `die()` paths, equals-form parsing — exercised only end-to-end via spawn for a single flag. No direct unit tests. Regression would not fail any test. `utils/cli.ts:22`.
- **TEST-02** — `BreadcrumbResolver` has no dedicated test file. 5 explicit `TypedError` throws are unreachable via current tests; orphan-shot `seq!` non-null assertion would crash at runtime, untested. `engine/breadcrumb.ts:19`.
- **TEST-03** — No test verifies **per-parent uniqueness positive case** — `createProject(wsA, 'p1') + createProject(wsB, 'p1')` both succeed. Tightening UNIQUE to global-name wouldn't fail any test. `hierarchy-repo.ts:94`.
- **TEST-04** — `transport-parity.test.ts:79` asserts only 4 tools; `generation` is registered live but absent. Stale since Phase 2.
- **TEST-05** — HTTP transport (Hono + 127.0.0.1 binding + /mcp routing) has **no end-to-end test**. Only InMemoryTransport simulation. `server.ts:203`.
- **TEST-06** — Zod `limit`/`offset` boundary values (0, 101, negative) untested at tool layer. Only one case exercised.
- **TEST-07** — List pagination edge cases (empty, offset-beyond-total, single-element, exact-fill, partial-final-page) untested.

---

## 🔵 INFO (30 findings — polish tier)

### Performance (all 6 collapse to one root cause — defer)
- **CP-01, PERF-01, PERF-02, PERF-03, PERF-04** — `BreadcrumbResolver.resolve()` walks the parent chain with 4 independent `SELECT WHERE id=?` queries instead of one JOIN. Every list method calls it inside `.map()` → N * 4 queries per page. Default `limit=20` = 82 queries; `limit=100` = 402 queries. **Defer** — not a bug, but a refactor for when list UIs get real traffic.
- **PERF-05** — `submitGeneration` refetches the row it just inserted (`getVersion(row.id)!`). Mutate `row.job_id = prompt_id` in-place instead. `engine/generation.ts:121`. Minor; defer.
- **PERF-06** — No `ORDER BY created_at` preparation for future time-sorted listings. Flagged for visibility.

### Contract polish
- **API-06** — Server capabilities block is implicit (SDK default). Pass `capabilities: { tools: { listChanged: false } }` explicitly.
- **API-07, RT-07** — GET/DELETE `/mcp` return Hono's default 404 HTML (not JSON-RPC-shaped 405). **Fix:** explicit 405 handlers with JSON-RPC error envelope.
- **RT-09** — Server advertises `tools.listChanged: true` (SDK default) but never sends the notification. Subscribed clients wait forever. **Fix:** explicit `listChanged: false`.
- **RT-08** — `requireInt` accepts non-TCP-legal ports (0, 65536+, hex `0x10`, `1e10`). Privileged ports <1024 also pass CLI but die at bind. `utils/cli.ts:89`. **Fix:** regex `/^[1-9]\d*$/` + range check `[1, 65535]`.
- **RT-11** — Every tool handler switch has no `default` clause. If a future 4th action is added to Zod but not the switch, handler returns `undefined`, SDK wraps as empty `CallToolResult` — silent invalid response. **Fix:** `const _exhaustive: never = input.action; throw …`.
- **RT-10** — `transport-parity.test.ts:104` asserts `not.toMatch(/ZodError|SQLITE_/)` — false-negative sentinel that matches neither actual leak surface. **Fix as part of RT-02 remediation.**

### Maintainability polish
- **MNT-02** — `listX` boilerplate (~88 LOC × 2 layers in repo + engine). Generic helper parameterized by Drizzle table + filter column folds 4 methods. Defer.
- **MNT-03** — ZodError catch + `GetInput` schema + pagination defaults duplicated across 4 tool files. **Fix opportunistically during RT-01/02 rewrite.**
- **MNT-04** — `SHOT_NAME_REGEX` declared in 3 places (engine, tool Zod, dead FakeEngine). Already noted as IN-01 in `01-REVIEW.md`. **Fix:** export from `types/hierarchy.ts`.
- **MNT-05** — `busy_timeout = 5000` duplicated across `db.ts`, `fixtures.ts`, test. **Fix:** `export const BUSY_TIMEOUT_MS = 5000`.
- **MNT-06** — `openDb()` docstring doesn't mention drizzle migrator (Phase 2 evolution). `cli.ts:82` help text claims "No environment variables are consulted" but server consults several. **Fix:** update docstrings.
- **MNT-07** — `execFileSync('grep', ...)` try/catch duplicated across two architecture tests. Unix-tool dependency. **Defer** (tests run on macOS CI only; flag for later portability).
- **MNT-08** — `schema.ts:5` preamble: "versions schema-only in Phase 1" — stale after Phase 2. **Fix:** rewrite preamble.

### Data migration
- **DM-03** — Four explicit single-column indexes (`idx_projects_workspace`, etc.) are redundant with SQLite's implicit UNIQUE autoindexes. EXPLAIN QUERY PLAN confirmed. Write-amplification with no query benefit. **Fix:** drop the redundant `index()` calls.
- **DM-04** — Test fixture calls `journal_mode = WAL` on `:memory:` where SQLite silently ignores it. Comment claims "Match prod init order" but WAL is a no-op. **Fix:** either skip WAL pragma on in-memory or amend the comment.

### Future-Phase concerns
- **CP-03** — Parent-exists pre-check not atomic with insert. Safe today (FK saves correctness, no deletes in Phase 1). Fix when Phase 2+ adds deletes.
- **CP-04** — `versions.status` default is `'submitted'` but no CHECK constraint. Fix in Phase 2 when version writes begin (already addressed by VersionRepo's atomic transitions).
- **CP-02** — Merged into RT-02 (Zod prose leaks via `first.message` — but `first.message` is never read because the catch branch is dead).
- **SEC-04** — Repo-layer name length guard. Defense-in-depth — optional if SEC-01 is fixed.

### Test coverage gaps (defer as a bundled follow-up PR)
- **TEST-08** — Unicode / special characters in names (emoji, ` > `, NUL) untested.
- **TEST-09** — Only `ws_` prefix asserted; `proj_`, `seq_`, `shot_`, `ver_` not directly tested.
- **TEST-10** — `listSequences(undefined, ...)` / `listShots(undefined, ...)` cross-parent paths untested.
- **TEST-11** — `openDb` corrupt-DB / readonly-fs / locked-DB paths untested.

---

## Fix plan

### Atomic commits to apply now (19 fixes)

| # | ID | Kind | Files | Test |
|---|----|------|-------|------|
| 1 | RT-01 + RT-02 | CRITICAL | All 5 tool files + transport-parity.test.ts | Assert `structuredContent.code === 'INVALID_INPUT'` + tools/list properties non-empty |
| 2 | SEC-01 + API-05 | WARN | All 5 tool files; new constants in `tools/shape.ts` | Boundary tests at 200/201 chars |
| 3 | SEC-02 | WARN | `generation-tool.ts`, `validateWorkflowFormat` | Reject 2001-node workflow + 10MB body |
| 4 | SEC-03 | WARN | `server.ts`, `.env.example` | Hono middleware unit test |
| 5 | RT-05 | WARN | Tool regex or `hierarchy-repo.ts` | Reject `a > b` names |
| 6 | DM-01 | WARN | `schema.ts` + Zod `.trim()` | Dup-case rejection test |
| 7 | RT-04 + RT-08 | WARN | `server.ts`, `cli.ts` | Port 65536 rejection, EADDRINUSE test |
| 8 | RT-06 | WARN | `server.ts` | Client disconnect cleanup |
| 9 | RT-03 | WARN | `hierarchy-repo.ts` (all 4 lists) | Deterministic page-ordering test |
| 10 | DM-02 | WARN | `db.ts` | Mismatch triggers close |
| 11 | MNT-01 | WARN | Delete `fake-engine.ts` | (none — delete) |
| 12 | API-02 | WARN | `shape.ts`, engine, repo, tests | Rename `total` → `total_count` repo-wide |
| 13 | RT-11 | INFO | All 5 tool switches | TypeScript exhaustiveness |
| 14 | RT-09 + API-06 | INFO | `server.ts` | `capabilities: { tools: { listChanged: false } }` |
| 15 | RT-07 + API-07 | INFO | `server.ts` | GET /mcp returns 405 JSON |
| 16 | MNT-04 | INFO | Export `SHOT_NAME_REGEX` from `types/hierarchy.ts` | Import-parity test |
| 17 | MNT-05 | INFO | `BUSY_TIMEOUT_MS` constant | (pragma assertion still passes) |
| 18 | MNT-06 + MNT-08 | INFO | Doc-string updates in `db.ts`, `schema.ts`, `cli.ts` | (none — comment) |
| 19 | DM-03 | INFO | `schema.ts` | EXPLAIN QUERY PLAN still uses autoindex |

### Deferred for later (documented, not lost)

- **API-01** (camelCase ↔ snake_case normalization) — **needs user decision**: breaking change.
- **API-03** (dual error model) — **needs design conversation**.
- **API-04** (document `limit` cap in tool descriptions) — Phase 3 DX polish.
- **PERF-01..04** (breadcrumb JOIN refactor) — single-user, low-traffic; defer until UI lands.
- **PERF-05, PERF-06** — minor polish.
- **MNT-02, MNT-03, MNT-07** — opportunistic refactors; low ROI.
- **CP-03, CP-04** — Phase 2+ concerns (already partly addressed).
- **TEST-* bulk** (TEST-01/02/03/04/05/06/07/08/09/10/11) — bundle as a dedicated regression-test PR after applying fixes above.

### Red-team findings NOT applied to fixes (explicit defer reasons)

- **RT-10** — will be implicitly fixed by RT-02 remediation (the positive assertion replaces the false-sentinel).

---

## Methodology note

Eight parallel reviewers, each given the raw Phase 1 diff + the production checklist for their specialty + full repo read access. Specialists agreed unanimously that Phase 1 had zero gstack-level CRITICALs on their own checklists. Red-team, given all 6 specialist reports + permission to break rules, found 2 CRITICALs — both structural bugs baked into the MCP-SDK integration. This is the fingerprint of an adversarial pass earning its keep: the checklists didn't have an entry for "your JSON schema is silently empty" because specialists don't probe live transports by default.

Lesson: for any phase that integrates a third-party SDK, a live-transport smoke test at review time catches contract drift that static review misses.

---

**Review baseline:** commit `ef4c48e` (last Phase 1 commit before Phase 2 source landed), diffed against `f21c555`.
**Review date:** 2026-04-21.
**Reviewer:** Claude Opus 4.7 (1M context) via 7 parallel `general-purpose` specialist agents + red-team adversarial pass.
**Live probe verification:** `verify-rt-01-02.mjs` (now deleted) confirmed RT-01 empty properties and RT-02 raw Zod leak.
