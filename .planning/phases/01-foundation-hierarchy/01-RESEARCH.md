# Phase 1: Foundation & Hierarchy — Research

**Researched:** 2026-04-20
**Confidence:** HIGH (all library versions locked in STACK.md; Phase 1 maps 1:1 to PITFALLS #1/#5/#6/#7/#10)
**Source:** Synthesis of CONTEXT.md (31 locked decisions), STACK.md, ARCHITECTURE.md, PITFALLS.md, REQUIREMENTS.md

## Executive Summary

Phase 1 is the foundation for the entire VFX Familiar server: dual-transport MCP (stdio + Streamable HTTP, one `McpServer` instance, one process) backed by SQLite in WAL mode, exposing 4 coarse-grained tools (`workspace`, `project`, `sequence`, `shot`) each with `action: 'create' | 'list' | 'get'`. Hierarchy is enforced at the DB layer via `UNIQUE(parent_id, name)` composites; shot names are constrained by `^sh\d{3,}$`; every tool response carries a `breadcrumb` array + `breadcrumb_text` string resolved from the engine. All 31 CONTEXT.md decisions are treated as locked requirements. Estimated plan count: **3 plans across 2 waves** — Wave 1 builds store/types/engine foundations in parallel with the server bootstrap scaffold; Wave 2 wires the 4 tools and verifies both transports.

Key integrations pinned:
- **MCP SDK 1.29 + Zod v4** — Standard Schema support lets the SDK consume Zod v4 schemas directly. No `zod-to-json-schema` needed.
- **Hono 4.12 + `fetch-to-node`** — the `mcp-hono-stateless` pattern (stateless mode, `sessionIdGenerator: undefined`) bridges Hono's `Request` to the Node `req/res` that `StreamableHTTPServerTransport` expects.
- **better-sqlite3 12.4 + Drizzle 0.45** — synchronous driver; init sequence: open → `journal_mode=WAL` → `busy_timeout=5000` → `foreign_keys=ON` → `user_version` check → schema push.

Critical failure modes if botched: tool explosion (Pitfall #1 — capped at 4 for Phase 1), SQLite lock contention under concurrent read/write (Pitfall #6 — WAL is non-negotiable), transport lockout (Pitfall #7 — both transports share the same `McpServer` instance), stdout pollution on stdio (breaks JSON-RPC framing).

## Implementation Approach

### Cluster A — Transport (TRNS-01, TRNS-02, TRNS-03, TRNS-04)

**TRNS-01 (stdio):** Default invocation `npx tsx src/server.ts` constructs one `McpServer`, registers all 4 tools, and connects `StdioServerTransport`. Stdio is synchronous from the SDK's perspective — the transport reads JSON-RPC frames line-delimited from stdin, writes frames to stdout. Tools execute on the event loop.

**TRNS-02 (Streamable HTTP):** `--http` flag adds a second transport in the **same process**. Hono mounts `POST /mcp` which does: `toReqRes(c.req.raw)` → instantiate `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` (stateless — no session persistence) → `server.connect(transport)` → `transport.handleRequest(req, res)` → `return toFetchResponse(res)`. This is the `mcp-hono-stateless` pattern verbatim. **Both transports register the same 4 tools against the same `McpServer` instance** — not two servers.

**TRNS-03 (single process):** Confirmed by construction: one `McpServer`, one `@hono/node-server` listener (when `--http`), one `better-sqlite3` connection, all in `src/server.ts`.

**TRNS-04 (zero-config):** No env vars honored at all (D-17 forbids `PORT`). Defaults: stdio-only, port 3000 (if `--http`), DB at `./vfx-familiar.db`. DB auto-created on first run via `CREATE TABLE IF NOT EXISTS`. CLI flag surface is exhaustive per D-19: `--http`, `--port <N>`, `--port=N`, `--db <path>`, `--db=<path>`, `--help`, `--version`. Unknown flags exit non-zero with pointer to `--help`.

**Reference pattern:** https://github.com/mhart/mcp-hono-stateless

### Cluster B — Hierarchy & Naming (HIER-01..05)

**HIER-01..04 (CRUD for 4 entities, create+list+get only):** Each entity maps to a table; each tool handles its entity. `create` inserts after parent-existence check (throws `PARENT_NOT_FOUND` if parent id is missing) and UNIQUE name check (throws `DUPLICATE_NAME` if collision). `list` accepts optional parent id filter + `limit`/`offset` (defaults 20/0). `get` accepts entity id, throws `{ENTITY}_NOT_FOUND` on miss. `update`/`delete` are deliberately absent in Phase 1 (D-03).

**HIER-05 (VFX naming):**
- Workspace/project/sequence names: `NOT NULL, length >= 1`. No regex. (D-06)
- Shot names: regex `^sh\d{3,}$`. Lowercase `sh` prefix, at least 3 digits. Allows `sh010`, `sh020`, `sh015` (Netflix-style insertion), `sh1000` (sequences beyond 999). Rejects `SH010`, `sh1`, `sh_010`, `sh0010a`. (D-07)
- Version format: `v` + zero-padded minimum 3 digits. Phase 1 provisions `versions` schema but creates no rows (D-08, D-10).

**Tables (all Phase 1 — schema only for `versions`):**

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  naming_template TEXT,          -- D-09, nullable, unused in Phase 1
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  naming_template TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences(id),
  name TEXT NOT NULL,            -- validated against ^sh\d{3,}$ at tool boundary
  created_at INTEGER NOT NULL,
  UNIQUE(sequence_id, name)
);

CREATE TABLE IF NOT EXISTS versions (  -- schema only; empty in Phase 1
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id),
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  job_id TEXT,
  parent_version_id TEXT REFERENCES versions(id),
  notes TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(shot_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sequences_project ON sequences(project_id);
CREATE INDEX IF NOT EXISTS idx_shots_sequence ON shots(sequence_id);
CREATE INDEX IF NOT EXISTS idx_versions_shot ON versions(shot_id, version_number);
```

IDs via `nanoid()` (D-11, 21-char default). Names stored verbatim — no slugification (D-14).

### Cluster C — Response Envelope (HIER-06, TOOL-04)

Every tool response returns **both** `structuredContent` (source of truth) and `content: [{ type: 'text', text: JSON.stringify(structured) }]` (fallback) (D-25). The payload shape is action-dependent:

- **`create`:** `{entity: {...fields}, breadcrumb: [...], breadcrumb_text: '...'}` — breadcrumb points at the just-created entity (D-27).
- **`get`:** `{entity: {...fields}, breadcrumb: [...], breadcrumb_text: '...'}` — same shape as create (D-26).
- **`list`:** `{items: [{...fields, breadcrumb, breadcrumb_text}], total: N, limit: 20, offset: 0}` — each item carries its own breadcrumb (D-24, D-26).

**Breadcrumb structure:** machine-form `[{type: 'workspace'|'project'|'sequence'|'shot', id, name}, ...]` from root → leaf. Human-form: `workspace-name > project-name > sequence-name > shot-name` (space-greater-space separator) (D-22).

**Breadcrumb resolution lives in the engine** — `src/engine/breadcrumb.ts`, not in tools or repos (D-35). Tree-walk from leaf id upward: at most 4 SELECTs (shot → sequence → project → workspace), each by primary key.

### Cluster D — Tool Surface (TOOL-01, TOOL-02, TOOL-03)

**TOOL-01 (≤12 tools):** Phase 1 uses exactly 4 (D-04). Remaining budget for Phases 2–5: 8.

**TOOL-02 (coarse-grained):** One tool per entity, action dispatch at the tool boundary. Tool name = entity name, lowercase snake_case, noun-only (D-02).

**TOOL-03 (Zod validation):** Every tool's `inputSchema` is a discriminated union on `action`. MCP SDK 1.29 accepts Zod v4 schemas natively via Standard Schema (STACK.md, Zod v4 + SDK 1.29 verified compatibility). Invalid input → `INVALID_INPUT` error with Zod `path` + expected type in message (D-05, D-32).

Canonical tool shape — each of the 4 tools follows this structure. Action inputs differ per entity (workspace has no parent; project needs workspaceId; sequence needs projectId; shot needs sequenceId).

### Cluster E — Error Model (TOOL-05)

Errors return via MCP's `isError: true` flag with `structuredContent: {code, message, hint}` (D-28). Typed codes (SCREAMING_SNAKE_CASE):

| Code | When | Message example | Hint example |
|------|------|-----------------|---------------|
| `WORKSPACE_NOT_FOUND` | `get`/child-create with missing workspace id | `"Workspace 'ws_abc' not found"` | `"List workspaces with { tool: 'workspace', action: 'list' }"` |
| `PROJECT_NOT_FOUND` | same, project | same pattern | same pattern |
| `SEQUENCE_NOT_FOUND` | same, sequence | same pattern | same pattern |
| `SHOT_NOT_FOUND` | same, shot | same pattern | same pattern |
| `PARENT_NOT_FOUND` | create child under missing parent | `"Parent workspace 'ws_abc' not found for project creation"` | `"Verify the parent id with { tool: 'workspace', action: 'get' }"` |
| `DUPLICATE_NAME` | UNIQUE violation on `(parent_id, name)` | `"Project 'my-project' already exists in workspace 'ws_abc'"` | `"Pick a different name or list existing items"` |
| `INVALID_SHOT_FORMAT` | shot name fails `^sh\d{3,}$` | `"Shot name 'SH1' does not match expected format"` | `"Shot names must match ^sh\\d{3,}$ — e.g. 'sh010', 'sh020'"` |
| `INVALID_INPUT` | Zod validation failure | `"Invalid input at 'input.workspaceId' — expected string"` | omit if not actionable |

Raw Zod errors and raw `SQLITE_CONSTRAINT` messages must NEVER reach the agent (D-13, D-32). Wrapping happens at the tool boundary.

## Code Skeletons

### 1. `src/store/db.ts` — WAL init sequence (D-20)

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const SCHEMA_VERSION = 1;

export function openDb(path: string) {
  const sqlite = new Database(path);
  // Order matters — pragmas first, then schema
  sqlite.pragma('journal_mode = WAL');       // Pitfall #6
  sqlite.pragma('busy_timeout = 5000');      // 5s — survives concurrent reads/writes
  sqlite.pragma('foreign_keys = ON');        // enforces REFERENCES constraints

  const existingVersion = sqlite.pragma('user_version', { simple: true }) as number;
  if (existingVersion === 0) {
    // First-run schema install
    sqlite.exec(readSchemaDDL());            // CREATE TABLE IF NOT EXISTS ... (all 5 tables + indexes)
    sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);  // Pitfall #10
  } else if (existingVersion !== SCHEMA_VERSION) {
    throw new Error(`DB at ${path} is version ${existingVersion}, server expects ${SCHEMA_VERSION}`);
  }

  return drizzle(sqlite, { schema });
}
```

### 2. `src/server.ts` — dual-transport bootstrap

```typescript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { toReqRes, toFetchResponse } from 'fetch-to-node';
import { openDb } from './store/db.js';
import { HierarchyRepo } from './store/hierarchy-repo.js';
import { Engine } from './engine/pipeline.js';
import { registerWorkspace, registerProject, registerSequence, registerShot } from './tools/index.js';

const args = parseCliFlags(process.argv.slice(2));  // hand-rolled 5-flag parser (D-19)
if (args.help) { printHelp(); process.exit(0); }
if (args.version) { console.error(pkg.version); process.exit(0); }

const db = openDb(args.db ?? './vfx-familiar.db');
console.error(`DB: ${args.db ?? './vfx-familiar.db'}`);  // stderr only — D-21

const repo = new HierarchyRepo(db);
const engine = new Engine(repo);

const server = new McpServer(
  { name: 'vfx-familiar', version: pkg.version },
  { instructions: 'VFX project hierarchy management. Use workspace/project/sequence/shot tools with action: create | list | get.' }
);

registerWorkspace(server, engine);
registerProject(server, engine);
registerSequence(server, engine);
registerShot(server, engine);

// Transport 1: stdio (always)
const stdio = new StdioServerTransport();
await server.connect(stdio);
console.error('stdio transport connected');

// Transport 2: HTTP (opt-in via --http)
if (args.http) {
  const port = args.port ?? 3000;
  const app = new Hono();
  app.post('/mcp', async (c) => {
    const { req, res } = toReqRes(c.req.raw);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return toFetchResponse(res);
  });
  serve({ fetch: app.fetch, port });
  console.error(`Listening on http://localhost:${port}`);
}
```

### 3. `src/tools/workspace-tool.ts` — canonical tool shape

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { toolError, toolOk } from './envelope.js';

const CreateInput = z.object({ action: z.literal('create'), name: z.string().min(1) });
const ListInput   = z.object({ action: z.literal('list'), limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) });
const GetInput    = z.object({ action: z.literal('get'), id: z.string().min(1) });
const WorkspaceInput = z.discriminatedUnion('action', [CreateInput, ListInput, GetInput]);

export function registerWorkspace(server: McpServer, engine: Engine) {
  server.registerTool('workspace', {
    title: 'Workspace',
    description: 'Manage workspaces (top-level hierarchy container). Actions: create, list, get.',
    inputSchema: WorkspaceInput,
  }, async (input) => {
    try {
      switch (input.action) {
        case 'create': return toolOk(await engine.createWorkspace(input.name));
        case 'list':   return toolOk(await engine.listWorkspaces(input.limit, input.offset));
        case 'get':    return toolOk(await engine.getWorkspace(input.id));
      }
    } catch (err) {
      return toolError(err);  // maps TypedError → { code, message, hint } + isError:true
    }
  });
}
```

### 4. `src/engine/breadcrumb.ts` — tree-walk resolver (D-35)

```typescript
import type { HierarchyRepo } from '../store/hierarchy-repo.js';

export type EntityType = 'workspace' | 'project' | 'sequence' | 'shot';
export interface BreadcrumbEntry { type: EntityType; id: string; name: string; }
export interface Breadcrumb { entries: BreadcrumbEntry[]; text: string; }

const SEP = ' > ';

export class BreadcrumbResolver {
  constructor(private repo: HierarchyRepo) {}

  async resolve(type: EntityType, id: string): Promise<Breadcrumb> {
    const entries: BreadcrumbEntry[] = [];
    switch (type) {
      case 'shot': {
        const shot = await this.repo.getShot(id);
        if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${id}' not found`);
        const seq = await this.repo.getSequence(shot.sequence_id);
        const proj = await this.repo.getProject(seq!.project_id);
        const ws = await this.repo.getWorkspace(proj!.workspace_id);
        entries.push({ type: 'workspace', id: ws!.id, name: ws!.name });
        entries.push({ type: 'project',   id: proj!.id, name: proj!.name });
        entries.push({ type: 'sequence',  id: seq!.id, name: seq!.name });
        entries.push({ type: 'shot',      id: shot.id, name: shot.name });
        break;
      }
      case 'sequence': { /* walk project + workspace, then push sequence */ break; }
      case 'project':  { /* walk workspace, then push project */ break; }
      case 'workspace':{ /* push workspace only */ break; }
    }
    return { entries, text: entries.map(e => e.name).join(SEP) };
  }
}
```

### 5. CLI flag parser — hand-rolled per D-19 (no commander/yargs)

```typescript
interface CliArgs { http: boolean; port?: number; db?: string; help: boolean; version: boolean; }

export function parseCliFlags(argv: string[]): CliArgs {
  const out: CliArgs = { http: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--http') { out.http = true; continue; }
    if (a === '--help') { out.help = true; continue; }
    if (a === '--version') { out.version = true; continue; }
    if (a === '--port') { out.port = requireInt(argv[++i], '--port'); continue; }
    if (a.startsWith('--port=')) { out.port = requireInt(a.slice(7), '--port'); continue; }
    if (a === '--db') { out.db = argv[++i]; if (!out.db) die(`--db requires a path`); continue; }
    if (a.startsWith('--db=')) { out.db = a.slice(5); continue; }
    die(`Unknown flag: ${a}. See --help.`);
  }
  return out;
}
function requireInt(s: string | undefined, flag: string): number {
  const n = Number(s); if (!Number.isInteger(n) || n <= 0) die(`${flag} requires a positive integer`); return n;
}
function die(msg: string): never { console.error(msg); process.exit(2); }
```

## Validation Architecture

Nyquist validation is enabled for this project. This section defines the test fixtures, critical behavioral assertions, and regression detectors required for Phase 1 plans to pass Dimension 8.

### Test Fixtures & Harnesses

| Fixture | Purpose | Library | Location |
|---------|---------|---------|----------|
| **In-memory SQLite** | Repo + engine unit tests with zero filesystem state | `better-sqlite3` (`:memory:` path) | `src/store/__tests__/fixtures.ts` |
| **Schema bootstrap helper** | Apply full DDL to a fresh in-memory db for each test | Same DDL string used in production `openDb()` | same file |
| **MCP Inspector** | Manual smoke test — connect to stdio + HTTP, verify tool list, invoke each action | `@modelcontextprotocol/inspector` (dev-dep) | `npx @modelcontextprotocol/inspector npx tsx src/server.ts` |
| **Typed error matcher** | `expect.toThrowTypedError('DUPLICATE_NAME')` custom Vitest matcher | Vitest | `src/test-utils/matchers.ts` |
| **Fake engine for tool tests** | Tool tests don't need a real db — inject a spy engine | hand-rolled | inline per test file |

### Critical Behavioral Assertions

Each assertion maps to a failing test that must exist before the phase can be declared complete.

1. **Transport parity** — Both stdio and HTTP transports expose the IDENTICAL tool list. Test: start server with `--http`, list tools via both, assert equal sets. (Pitfall #7)
2. **Breadcrumb on every response** — `create`, `get`, and each item in `list` responses include `breadcrumb: BreadcrumbEntry[]` AND `breadcrumb_text: string`. Test: hit each action on each of 4 tools, assert both fields present. (D-22, D-23)
3. **Shot regex enforcement** — `sh010`, `sh0120`, `sh1000` accepted; `SH010`, `sh1`, `sh_010`, `shot010`, `sh01` rejected with `INVALID_SHOT_FORMAT`. Test: parameterized test over valid+invalid cases. (D-07, Pitfall #5)
4. **Duplicate name wrapping** — Creating a project with a duplicate name under the same workspace returns `DUPLICATE_NAME`, NOT a raw SQLite error. Same for sequence-in-project and shot-in-sequence. Test: create twice, catch error, assert code and that message does not contain `SQLITE_CONSTRAINT`. (D-13)
5. **Missing parent wrapping** — Creating a child under a non-existent parent returns `PARENT_NOT_FOUND`. Test: attempt project creation with fake workspaceId, assert error code and identifier appears in message.
6. **Zod error rewrapping** — Invalid input (e.g., `action: 'list'` with `limit: -1`) returns `INVALID_INPUT` with the Zod `path` in the message. Raw Zod error structure must not leak. (D-32)
7. **Stdout silence on stdio** — No `console.log` or stdout write happens on the stdio code path from server boot through tool execution. Test: capture `process.stdout` writes during startup + one tool call; assert only JSON-RPC frames are written. (D-21, breaks MCP protocol otherwise)
8. **WAL mode active after init** — After `openDb()` returns, `PRAGMA journal_mode` returns `wal`. Test: direct pragma query. (Pitfall #6)
9. **`structuredContent` AND `content:[text]` both present** — Every successful tool response has both forms. Test: invoke each action on each tool, assert both keys present and `JSON.parse(content[0].text)` equals `structuredContent`. (D-25)
10. **Engine has zero MCP SDK imports** — Grep-level invariant. Test: `grep -r '@modelcontextprotocol/sdk' src/engine/ src/store/` returns zero matches. (D-33, D-34)
11. **Tool count ≤ 12** — Test: `grep -r 'server.registerTool' src/ | wc -l` ≤ 12. Phase 1 value: 4. (D-04, Pitfall #1)
12. **Zero-config startup** — Test: delete `./vfx-familiar.db`, run `npx tsx src/server.ts` with no flags, no env vars, assert db is created, schema applied, stdio connected. (TRNS-04)

### Regression Detectors (one failing test per invariant)

| Invariant | Breaks if… | Test file |
|-----------|------------|-----------|
| Transport parity | A tool is registered only on one server instance | `src/__tests__/transport-parity.test.ts` |
| Breadcrumb on every response | A new action forgets to call `engine.getBreadcrumb()` | `src/tools/__tests__/breadcrumb-always.test.ts` |
| Shot regex | Regex is loosened or removed | `src/engine/__tests__/shot-naming.test.ts` |
| Error wrapping | A repo throw leaks to tool caller unwrapped | `src/tools/__tests__/error-wrapping.test.ts` |
| stdout silence | Someone adds `console.log` | `src/__tests__/stdio-hygiene.test.ts` |
| Engine/store purity | Someone imports MCP SDK into engine or store | `src/__tests__/architecture-purity.test.ts` (grep-based) |
| Tool count cap | Phase 2+ adds a 13th tool | `src/__tests__/tool-budget.test.ts` (grep-based) |

## Requirement → Research Map

Every Phase 1 requirement maps to at least one research section. Plans MUST reference the covering section for each REQ-ID in their `requirements:` frontmatter.

| REQ-ID | Description | Covered in |
|--------|-------------|------------|
| TRNS-01 | stdio transport | Cluster A, Skeleton #2 |
| TRNS-02 | Streamable HTTP transport | Cluster A, Skeleton #2 |
| TRNS-03 | single process | Cluster A, Skeleton #2 |
| TRNS-04 | zero-config startup | Cluster A, Skeleton #2, Skeleton #5 |
| HIER-01 | workspace CRUD (create/list/get) | Cluster B, Skeleton #3 |
| HIER-02 | project CRUD | Cluster B |
| HIER-03 | sequence CRUD | Cluster B |
| HIER-04 | shot CRUD | Cluster B |
| HIER-05 | VFX naming (shot regex, version format) | Cluster B (D-07, D-08) |
| HIER-06 | breadcrumb in every response | Cluster C, Skeleton #4 |
| TOOL-01 | ≤12 tools (uses 4) | Cluster D (D-04) |
| TOOL-02 | coarse-grained action-based | Cluster D, Skeleton #3 |
| TOOL-03 | Zod input validation | Cluster D, Skeleton #3 |
| TOOL-04 | structured responses (not raw JSON) | Cluster C (D-25), Skeleton #3 |
| TOOL-05 | typed, actionable errors | Cluster E |

**All 15 Phase 1 REQ-IDs accounted for.**

## Looks Done But Isn't — Pre-completion Checklist

Derived from PITFALLS.md + CONTEXT.md D-01..D-36. Plan checker enforces; executor verifies.

- [ ] **Tool count verified ≤ 12** — grep `server.registerTool` in `src/` returns exactly 4 lines. (Pitfall #1, D-04)
- [ ] **Shot regex verified** — `^sh\d{3,}$` accepts `sh010`/`sh0120`/`sh1000`; rejects `SH010`/`sh1`/`sh_010`. (Pitfall #5, D-07)
- [ ] **WAL mode applied BEFORE any write** — test queries `PRAGMA journal_mode` and sees `wal`. (Pitfall #6, D-20)
- [ ] **busy_timeout = 5000** set. (Pitfall #6, D-20)
- [ ] **foreign_keys = ON** set. (D-20)
- [ ] **Stdio + HTTP tool lists match** — integration test. (Pitfall #7, D-16)
- [ ] **user_version pragma set to 1** — schema migration ready for Phase 2 changes. (Pitfall #10)
- [ ] **stdout silent on stdio** — no `console.log` anywhere in server boot or tool path. (D-21)
- [ ] **`console.error` only** for all logging. (D-21)
- [ ] **Engine has zero MCP SDK imports** — grep `@modelcontextprotocol/sdk` in `src/engine/` returns zero. (D-33)
- [ ] **Store has zero MCP SDK imports** — grep in `src/store/` returns zero. (D-33)
- [ ] **nanoid() used for all IDs** — grep `nanoid()` appears ≥ 4 times (one per entity create); no `uuid`, `crypto.randomUUID`, or hand-rolled id gen. (D-11)
- [ ] **Every response has `breadcrumb` + `breadcrumb_text`** — test each action on each tool. (D-22, D-23)
- [ ] **`structuredContent` AND `content: [{type:'text',...}]` both present** on every success. (D-25)
- [ ] **Typed error codes — no raw errors leak** — no test catches a raw Zod or SQLite message at the tool boundary. (D-13, D-28, D-32)
- [ ] **List envelope shape `{items, total, limit, offset}`** with defaults `limit: 20, offset: 0`. (D-24)
- [ ] **Default port 3000** when `--http` and no `--port`. (D-17)
- [ ] **No `PORT` env var honored** — spec-compliant zero-env-var policy. (D-17, TRNS-04)
- [ ] **Default DB path `./vfx-familiar.db`** in CWD when no `--db`. (D-18)
- [ ] **CLI flag surface is exhaustive** — `--http`, `--port`, `--db` (both space and `=` forms), `--help`, `--version`. No other flags. (D-19)
- [ ] **Unknown flag → exit non-zero with help pointer.** (D-19)
- [ ] **UNIQUE constraints at DB layer, not just app code** — inspect `.schema` output. (D-12)
- [ ] **Breadcrumb resolved in engine, not tools/repos** — grep: tool files call `engine.getBreadcrumb`/`breadcrumb.resolve`, never walk the repo themselves. (D-35)
- [ ] **MCP Inspector smoke**: `npx @modelcontextprotocol/inspector npx tsx src/server.ts` connects, lists 4 tools, can call each action end-to-end. (pre-ship manual verification)
- [ ] **`npx tsx src/server.ts --http` + Inspector over HTTP connects** to `http://localhost:3000/mcp` and lists the same 4 tools. (Pitfall #7 verification)
- [ ] **`npx vitest` exits 0** — all unit + integration tests pass. (CLAUDE.md convention)
- [ ] **Fresh-start demo works** — delete `./vfx-familiar.db`, start server, create workspace→project→sequence→shot, all succeed, breadcrumb walks correctly at each step. (Pitfall: "cold start" scenario)

## RESEARCH COMPLETE
