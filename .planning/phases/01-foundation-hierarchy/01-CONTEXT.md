# Phase 1: Foundation & Hierarchy - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a dual-transport MCP server (stdio + Streamable HTTP, one process) with four hierarchy tools (`workspace`, `project`, `sequence`, `shot`) backed by a SQLite store in WAL mode. An MCP-compatible agent can connect via either transport, discover all four tools, create a full `workspace → project → sequence → shot` hierarchy following VFX naming conventions, and receive breadcrumb navigation context in every response.

**In scope:** MCP server bootstrap, dual transport, SQLite schema + WAL init, 4 entity tools (create/list/get only), VFX-conforming shot naming, breadcrumb responses, typed error model, zero-config startup with minimal CLI flags.

**Out of scope:** Generation (Phase 2), provenance capture (Phase 3), tagging/search (Phase 4), web dashboard (Phase 5), version CRUD, update/delete on hierarchy, ComfyUI Cloud API integration, authentication, multi-user concerns.

</domain>

<decisions>
## Implementation Decisions

### MCP Tool Surface (TOOL-01, TOOL-02, TOOL-03)

- **D-01:** Four MCP tools for Phase 1: `workspace`, `project`, `sequence`, `shot`. One tool per hierarchy entity (recommended option from discussion).
- **D-02:** Tool naming is snake_case, noun-only. Tool name equals entity name. Each tool accepts an `action` parameter: `'create' | 'list' | 'get'`.
- **D-03:** No `update` or `delete` actions in Phase 1. Hierarchy mutation is create-only for v1. Update/delete deferred — shot renames and cascading deletes need provenance-aware design that Phase 3 will surface.
- **D-04:** Tool budget accounting: Phase 1 uses **4 of 12** MCP tools. Remaining budget: 8 tools for Phases 2–5 (Phase 2 generation ~2, Phase 3 provenance ~3, Phase 4 query ~2, reserve ~1). Planner must not exceed this allocation without revisiting the budget.
- **D-05:** All tool inputs validated by Zod v4 schemas at the tool boundary. Invalid input returns error code `INVALID_INPUT` with the failed Zod path and expected type in the message.

### Naming Rules & Template (HIER-05)

- **D-06:** Workspace, project, and sequence names accept any non-empty string. Validation: `NOT NULL, length >= 1`. No regex. Studios bring their own naming at these levels.
- **D-07:** Shot names enforced by regex `^sh\d{3,}$` on create (examples: `sh010`, `sh020`, `sh0120`). Reject non-matching names with error code `INVALID_SHOT_FORMAT` and a hint showing the expected format. Allows Netflix-style insertion between shots (`sh015`) and supports sequences exceeding 999 shots.
- **D-08:** Version numbers are zero-padded `v` + minimum 3 digits (Phase 2+ will create versions). Phase 1 provisions the schema but creates no version rows.
- **D-09:** Phase 1 uses hardcoded default naming rules. Schema includes a nullable `naming_template` TEXT column on `workspaces` and `projects` for future per-project override. No tool in Phase 1 sets this column; it ships when first studio customization is requested.
- **D-10:** Creating a shot does NOT auto-create a placeholder version. Shot is a leaf entity in Phase 1 — the `versions` table exists and is empty until Phase 2's first successful generation.

### Hierarchy Data Model

- **D-11:** Entity IDs use `nanoid()` (per CLAUDE.md convention). Default 21-char URL-safe string. IDs are distinct from display names; both are returned in responses.
- **D-12:** UNIQUE constraints on `(parent_id, name)` for each level: `UNIQUE(workspace_id, name)` on projects, `UNIQUE(project_id, name)` on sequences, `UNIQUE(sequence_id, name)` on shots. Workspace names are globally unique: `UNIQUE(name)` on workspaces.
- **D-13:** On uniqueness violation, return error code `DUPLICATE_NAME` with the conflicting name and parent context in the message. Never let SQLite's raw constraint error reach the agent.
- **D-14:** Names stored verbatim — no slug generation, no lowercasing, no filesystem-safe transformation in Phase 1. Slug rules defer until output file storage surfaces the need (Phase 2+).

### Tables created in Phase 1

| Table | Purpose | Created when |
|-------|---------|--------------|
| `workspaces` | Top-level hierarchy container | Phase 1 |
| `projects` | Child of workspace | Phase 1 |
| `sequences` | Child of project | Phase 1 |
| `shots` | Child of sequence | Phase 1 |
| `versions` | Child of shot (empty in Phase 1, populated Phase 2+) | Phase 1 (schema only) |

Indexes: `idx_projects_workspace(workspace_id)`, `idx_sequences_project(project_id)`, `idx_shots_sequence(sequence_id)`, `idx_versions_shot(shot_id, version_number)`. Provenance/tags/metadata/jobs tables deferred to their owning phases.

### Server Startup & CLI Contract (TRNS-01, TRNS-02, TRNS-03, TRNS-04)

- **D-15:** Default invocation (`npx tsx src/server.ts` with no flags) starts **stdio transport only**. This is the primary path for Claude Desktop / Claude CLI / Cursor integration.
- **D-16:** Passing `--http` adds a Streamable HTTP server in the same process. Both transports share one `McpServer` instance. Server registers the same four tools for both transports.
- **D-17:** HTTP default port 3000. Override with `--port <N>`. No `PORT` env var — honors TRNS-04 ("no env vars"). The chosen port is printed on startup (e.g. `Listening on http://localhost:3000`).
- **D-18:** Default SQLite path `./vfx-familiar.db` in current working directory. Override with `--db <path>`. Auto-created on first run with schema installed. Path is logged on startup.
- **D-19:** Complete Phase 1 CLI flag contract: `--http`, `--port <N>`, `--port=N`, `--db <path>`, `--db=<path>`, `--help`, `--version`. No other flags recognized. Unknown flags exit with a clear error pointing to `--help`.
- **D-20:** SQLite initialization sequence (in `store/db.ts`), in this order: open connection → `PRAGMA journal_mode = WAL` → `PRAGMA busy_timeout = 5000` → `PRAGMA foreign_keys = ON` → run schema creation if tables missing (via `drizzle-kit push` programmatic or equivalent `CREATE TABLE IF NOT EXISTS`).
- **D-21:** Logging: stderr-only (`console.error`). **Never log to stdout** — stdout is reserved for JSON-RPC frames on stdio transport. Any stdout noise breaks MCP protocol parsing.

### Response Envelope (HIER-06, TOOL-04)

- **D-22:** Every tool response includes breadcrumb context in **two forms**:
  - `breadcrumb: [{type, id, name}, ...]` — machine-navigable array from root to the affected entity. Types are `'workspace' | 'project' | 'sequence' | 'shot'`.
  - `breadcrumb_text: 'workspace-name > project-name > sequence-name > shot-name'` — pre-rendered human string for display.
- **D-23:** Breadcrumbs appear on **every** response: create, get, and each item in list responses. Always-on hierarchy context satisfies HIER-06 without requiring the agent to ask.
- **D-24:** List responses use envelope `{items: [...], total: N, limit: 20, offset: 0}`. Default `limit` is 20 (matches the Phase 4 ASST-04 convention). Phase 1 lists are small but the shape is locked in now so Phase 4 inherits it without breaking change.
- **D-25:** Tool responses return **both** `content: [{type: 'text', text: JSON.stringify(structured)}]` AND `structuredContent: {...}`. MCP SDK clients that understand `structuredContent` use it; text content is the fallback. `structuredContent` is the source of truth.
- **D-26:** On `action: get`, the response includes the entity fields PLUS the full breadcrumb from root to that entity. On `action: list`, each item in `items[]` includes its own breadcrumb (parent context for each child).
- **D-27:** On `action: create`, the response includes the new entity fields PLUS the breadcrumb pointing at the new entity (so the agent has immediate navigation context for the thing it just created).

### Error Model (TOOL-05)

- **D-28:** Errors return via MCP's `isError: true` response flag with `structuredContent: {code, message, hint}`.
- **D-29:** Typed error codes reserved for Phase 1 (SCREAMING_SNAKE_CASE): `WORKSPACE_NOT_FOUND`, `PROJECT_NOT_FOUND`, `SEQUENCE_NOT_FOUND`, `SHOT_NOT_FOUND`, `PARENT_NOT_FOUND` (when creating a child under a missing parent), `DUPLICATE_NAME`, `INVALID_SHOT_FORMAT`, `INVALID_INPUT` (Zod validation failure).
- **D-30:** Error `message` is specific and names the offending identifier — `"Workspace 'my-workspace' not found"`, not `"Not found"`. Never return a bare error code as the message.
- **D-31:** Error `hint` points to a concrete recovery action — `"List workspaces with { tool: 'workspace', action: 'list' }"`, `"Shot names must match ^sh\\d{3,}$ — e.g. 'sh010', 'sh020'"`. If no meaningful hint exists, omit the field rather than filling with noise.
- **D-32:** Zod validation failures are caught at the tool entry, re-wrapped as `INVALID_INPUT` with the Zod `path` (e.g. `"input.workspaceId"`) and the expected type in the message. Raw Zod errors never reach the agent.

### Architecture Invariants (locked by CLAUDE.md + research — enforced in Phase 1)

- **D-33:** Tool-engine separation is mandatory. Files under `src/tools/` are thin Zod-validated delegates — maximum one call per action into the engine, no business logic. Files under `src/engine/` have **zero imports** from `@modelcontextprotocol/sdk`. Verified by grep at plan-check time.
- **D-34:** Repository pattern over SQLite: `src/store/hierarchy-repo.ts` owns all hierarchy CRUD. Repos return plain typed objects (per `src/types/hierarchy.ts`), never raw DB rows.
- **D-35:** Breadcrumb resolution lives in the engine (`src/engine/pipeline.ts` or a dedicated `src/engine/breadcrumb.ts`), not in tools and not in repos. Tools call `engine.getBreadcrumb(entityType, entityId)` → `BreadcrumbEntry[]`.
- **D-36:** Commands from CLAUDE.md that must work at Phase 1 completion: `npx tsx src/server.ts` (stdio), `npx tsx src/server.ts --http` (stdio + HTTP), `npx vitest` (tests pass).

### Claude's Discretion

Areas where the planner/executor has flexibility — no user input needed:

- **Schema migration approach:** Phase 1 can use `CREATE TABLE IF NOT EXISTS` at startup (simplest for zero-config) or `drizzle-kit push` programmatically. Formal `drizzle-kit generate` migrations become mandatory at the first schema change. Add `user_version` pragma from day one per Pitfall #10 so future migrations have a version to check against.
- **Logging volume:** stderr `console.error` for Phase 1. Structured logger (e.g. `pino`) can be added when logging surface area justifies it.
- **File layout under `src/`:** Follow `.planning/research/ARCHITECTURE.md` "Recommended Project Structure" verbatim — `server.ts`, `tools/`, `engine/`, `store/`, `types/`, `utils/`. Create empty subdirectories only as they're populated.
- **Testing strategy:** Vitest unit tests for engine and repos. MCP Inspector (`@modelcontextprotocol/inspector`) for manual smoke testing of both transports. No E2E harness in Phase 1; integration testing via Inspector is sufficient for the demo-scope target.
- **TypeScript config:** `"module": "NodeNext"`, `"target": "ES2022"`, `"strict": true`, `"moduleResolution": "NodeNext"`. Match MCP SDK expectations.
- **Package manager:** npm (lockfile in repo). No pnpm/yarn switch in Phase 1.
- **Hono + MCP bridge:** Follow `mcp-hono-stateless` pattern referenced in STACK.md — `toReqRes()` from `fetch-to-node` bridges Hono's `Request` to Node's `req/res` that MCP's `StreamableHTTPServerTransport` expects. Stateless mode (`sessionIdGenerator: undefined`).
- **CLI parser:** Hand-roll the 5-flag parser in `server.ts` (no `commander` / `yargs` dependency for 5 flags). Small, zero-dep.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, checker) MUST read these before acting.**

### Project research (MUST read — locks all macro decisions)

- `.planning/research/SUMMARY.md` — Executive summary; key technical decisions table; critical risks
- `.planning/research/STACK.md` — Locked library versions (MCP SDK 1.29, Hono 4.12, better-sqlite3 12.4, Drizzle 0.45, Zod 4.3, Vitest 4.1, Preact 10.25), installation commands, version compatibility matrix, what NOT to use
- `.planning/research/ARCHITECTURE.md` — System overview diagram, recommended project structure (`src/` tree), architectural patterns (tool-engine separation, append-only provenance, dual-transport MCP, ComfyUI job lifecycle), full database schema, build order by dependency chain
- `.planning/research/PITFALLS.md` — Seven critical pitfalls. Pitfall #1 (tool explosion), #5 (VFX naming), #6 (SQLite WAL), #7 (transport mismatch), #10 (schema migration) all apply to Phase 1. Read the "Looks Done But Isn't" checklist before declaring completion.
- `.planning/research/FEATURES.md` — Feature landscape, MVP v1 definition, competitor analysis (ShotGrid / ftrack / Kitsu / AYON / Scenario / VFX Familiar)

### Project instructions

- `CLAUDE.md` — Project conventions (12-tool cap, nanoid IDs, WAL init, prompt-blob-is-truth, VFX naming, commands for dev/test/build)
- `.planning/PROJECT.md` — Vision, core value, constraints, key decisions table
- `.planning/REQUIREMENTS.md` — All 38 v1 requirements with IDs. Phase 1 requirements: TRNS-01..04, HIER-01..06, TOOL-01..05
- `.planning/ROADMAP.md` — Phase 1 goal statement, five success criteria, full requirement mapping across phases

### External specs (referenced during discussion)

- MCP TypeScript SDK — https://github.com/modelcontextprotocol/typescript-sdk (v1.29 with Standard Schema / Zod v4 support; `McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport`)
- MCP Streamable HTTP transport spec — https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- `mcp-hono-stateless` reference pattern — https://github.com/mhart/mcp-hono-stateless (Hono + MCP Streamable HTTP integration using `fetch-to-node`)
- Netflix VFX Shot and Version Naming Recommendations — https://partnerhelp.netflixstudios.com/hc/en-us/articles/360057627473 (baseline for HIER-05)
- SQLite WAL mode official docs — https://www.sqlite.org/wal.html (journal_mode, busy_timeout guidance)
- Zod v4 JSON Schema — https://zod.dev/json-schema (native `z.toJSONSchema()`, replaces `zod-to-json-schema`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

None. The repository is greenfield — only `CLAUDE.md` and `.planning/` exist. Phase 1 creates the entire `src/` tree from scratch.

### Established Patterns

No code patterns exist yet. Phase 1 establishes the canonical patterns that all later phases inherit:

- **Tool file shape** — see `tools/` structure that will be created: thin Zod schema + delegate call
- **Engine shape** — pure TS classes with injected repos, no MCP SDK imports
- **Repo shape** — prepared statements via `better-sqlite3`, return typed plain objects
- **Response envelope** — `{structuredContent, content: [text]}` dual-form (D-25)
- **Error wrapping** — typed codes, `isError: true`, no raw Zod or SQLite errors (D-28..D-32)

### Integration Points

- **Node.js entrypoint:** `src/server.ts` is the only entrypoint. Package `main`/`bin` point here.
- **MCP connection surface:** stdio (always) and Streamable HTTP on port 3000 (when `--http`). Same `McpServer` instance serves both.
- **Future surfaces** (not wired in Phase 1, but structurally provisioned): `versions` table for Phase 2, REST API routes for Phase 5 dashboard. Leave `src/adapter/` and `src/web/` directories empty but ready.

### Build Order (from ARCHITECTURE.md, Phase 1 subset)

```
1. src/store/db.ts + src/store/schema.ts    (SQLite connection + table DDL)
2. src/types/hierarchy.ts                    (Workspace, Project, Sequence, Shot types)
3. src/utils/id.ts                           (nanoid wrapper with standard length)
4. src/store/hierarchy-repo.ts               (CRUD for 4 entities)
5. src/engine/pipeline.ts (subset)           (hierarchy ops + breadcrumb resolver)
6. src/tools/workspace-tool.ts               (Zod schema + delegate)
7. src/tools/project-tool.ts                 (    ")
8. src/tools/sequence-tool.ts                (    ")
9. src/tools/shot-tool.ts                    (    ")
10. src/server.ts                            (McpServer init, both transports, CLI flags)
```

</code_context>

<specifics>
## Specific Ideas

Concrete values the planner and executor must reproduce verbatim:

- **Tool names:** `workspace`, `project`, `sequence`, `shot` — lowercase, noun-only, snake_case.
- **Action values:** `"create"`, `"list"`, `"get"` — lowercase strings.
- **Shot regex:** `^sh\d{3,}$` — lowercase `sh`, at least three digits, no underscores or other chars.
- **Version format (Phase 2+):** `v` + zero-padded number, minimum 3 digits (`v001`, `v002`, ..., `v999`, `v1000`).
- **Breadcrumb text separator:** ` > ` (space, greater-than, space).
- **Error codes:** SCREAMING_SNAKE_CASE, prefix by entity where applicable (`WORKSPACE_NOT_FOUND`, `PROJECT_NOT_FOUND`, etc.). Cross-cutting codes have no prefix (`DUPLICATE_NAME`, `INVALID_INPUT`, `PARENT_NOT_FOUND`).
- **Default pagination:** `limit: 20`, `offset: 0`.
- **Default HTTP port:** `3000`.
- **Default DB path:** `./vfx-familiar.db` (relative to CWD).
- **CLI flags recognized (exhaustive Phase 1 list):** `--http`, `--port <N>`, `--port=<N>`, `--db <path>`, `--db=<path>`, `--help`, `--version`.
- **SQLite pragmas at init (in order):** `journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`.
- **ID generator:** `nanoid()` with default length (21 chars).

</specifics>

<deferred>
## Deferred Ideas

Captured during discussion. Not in Phase 1 scope — preserved here so they aren't lost.

- **Per-project naming template override UI/tool** — Schema provisions `naming_template` column on workspaces/projects; no tool in Phase 1 sets it. Ships when the first studio needs custom naming. Phase 4+ likely.
- **CLI logging flags** (`--log-level`, `--quiet`, `--verbose`) — Add when log output volume justifies them. Not in Phase 1 contract.
- **Update / rename actions on hierarchy** — Shot renames have provenance implications (file paths in later phases reference shot names). Defer to v1.x after provenance ships.
- **Delete actions with cascading rules** — Cascading delete (delete shot → delete versions → delete provenance) needs explicit design. v2.
- **Explicit `--stdio` / `--no-stdio` flags** — Stdio-default plus optional `--http` covers Phase 1 needs. Revisit if a use case for HTTP-only ever emerges.
- **Slug auto-generation for filesystem-safe names** — Defer until output file storage surfaces the need (Phase 2 when ComfyUI output files land per shot/version).
- **Multi-connection pooling for SQLite** — Single `better-sqlite3` connection is sufficient for Phase 1. Revisit if Phase 4 query volume justifies it.
- **Auth / API key on HTTP transport** — Out of scope. Single-user demo. Phase 5 dashboard runs locally; remote deployment is post-v1.
- **Module format migration (ESM vs. CJS)** — Locked to ESM (`"type": "module"` in package.json). Not revisited.
- **Monorepo / workspaces layout** — Flat package in Phase 1. CLAUDE.md mentions `packages/dashboard` for the Phase 5 dashboard; treat as a future split when Phase 5 ships.
- **Review / approval workflow, ShotGrid/ftrack sync, multi-user auth, AI scheduling** — Listed in FEATURES.md anti-features. Not part of v1 roadmap.

</deferred>

---

*Phase: 01-foundation-hierarchy*
*Context gathered: 2026-04-20 via /gsd-discuss-phase*
