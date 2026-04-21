# Phase 1: Foundation & Hierarchy - Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 12 files to create (all new)
**Analogs found:** 0 / 12 in-repo (greenfield); 12 / 12 via RESEARCH.md skeletons + canonical external refs

## Greenfield Verification

Executed at mapping time:

```bash
$ ls -la /Users/macapple/comfyui-vfx-mcp/src/
ls: /Users/macapple/comfyui-vfx-mcp/src/: No such file or directory

$ ls /Users/macapple/comfyui-vfx-mcp/
CLAUDE.md
# (plus .planning/ — hidden dirs omitted by non-`-a` ls)

$ ls /Users/macapple/comfyui-vfx-mcp/packages
ls: /Users/macapple/comfyui-vfx-mcp/packages: No such file or directory

$ find /Users/macapple/comfyui-vfx-mcp -name "*.ts" -not -path "*/node_modules/*" -not -path "*/.planning/*"
# (no matches)
```

**Conclusion:** The repository is greenfield. No `src/`, no `packages/`, no `.ts` files outside `.planning/`. There are zero in-repo analogs. Phase 1 is the canonical-pattern-establishing phase; all subsequent phases will look back at Phase 1 outputs as their analogs.

Since no in-repo analogs exist, the pattern seeds for each file are:

1. **Primary:** code skeletons in `01-RESEARCH.md` §"Code Skeletons" (5 skeletons: `db.ts`, `server.ts`, `workspace-tool.ts`, `breadcrumb.ts`, CLI parser)
2. **Secondary (external analogs):** `mcp-hono-stateless` (MCP + Hono bridge), Drizzle `better-sqlite3` getting-started, MCP SDK 1.29 examples, Netflix shot-naming spec
3. **Constraints:** CLAUDE.md (12-tool cap, nanoid IDs, WAL init, VFX naming, stderr-only logging) + CONTEXT.md locked decisions D-01..D-36

## File Classification

| New File | Role | Data Flow | Analog Seed | Match Quality |
|----------|------|-----------|-------------|---------------|
| `src/store/db.ts` | SQLite connection + pragma init + user_version bootstrap | init-time, sync | RESEARCH Skeleton #1; Drizzle better-sqlite3 docs | skeleton-exact |
| `src/store/schema.ts` | Drizzle table definitions for 5 tables + indexes | static DDL | RESEARCH Cluster B SQL block (DDL verbatim) | spec-exact |
| `src/types/hierarchy.ts` | Plain-TS type definitions (`Workspace`, `Project`, `Sequence`, `Shot`, `Version`, `BreadcrumbEntry`) | static types | RESEARCH Cluster C + schema DDL field list | spec-exact |
| `src/utils/id.ts` | `nanoid()` wrapper (21-char default) + `generateId(entity)` helper | pure function | CLAUDE.md D-11; nanoid README | spec-exact |
| `src/store/hierarchy-repo.ts` | Repository pattern: prepared statements, typed returns, zero MCP imports | CRUD (create/list/get only) | RESEARCH Cluster B; Drizzle query builder pattern | role-match (no in-repo) |
| `src/engine/breadcrumb.ts` | Pure engine service: tree-walk leaf→root via repo, produces `Breadcrumb` | request-response, sync | RESEARCH Skeleton #4 (verbatim) | skeleton-exact |
| `src/engine/pipeline.ts` (subset) | Engine facade: `createWorkspace`, `createProject`, `createSequence`, `createShot`, `list*`, `get*` — delegates to repo + breadcrumb | request-response | RESEARCH Skeleton #3 (tool calls into engine) + D-33/D-34 | role-match |
| `src/engine/errors.ts` (implied by D-28..D-32) | `TypedError` class with `code`, `message`, `hint` | pure class | RESEARCH Cluster E error table | spec-exact |
| `src/tools/envelope.ts` (implied by skeleton #3) | `toolOk()` / `toolError()` helpers: wrap payload into `{structuredContent, content:[{type:'text',text:...}]}` + map `TypedError`→`isError:true` | response-shaping | RESEARCH D-25, D-28; Skeleton #3 usage | spec-exact |
| `src/tools/workspace-tool.ts` | Thin MCP tool delegate: Zod discriminated union on `action`, one-line-per-action dispatch to engine | request-response | RESEARCH Skeleton #3 (canonical shape for all 4 tools) | skeleton-exact |
| `src/tools/project-tool.ts` | Same as workspace-tool; add `workspaceId` to create/list inputs | request-response | RESEARCH Skeleton #3 (parameterized by parent) | skeleton-exact |
| `src/tools/sequence-tool.ts` | Same; `projectId` on create/list | request-response | RESEARCH Skeleton #3 (parameterized) | skeleton-exact |
| `src/tools/shot-tool.ts` | Same; `sequenceId` on create/list; Zod regex `^sh\d{3,}$` on create.name → `INVALID_SHOT_FORMAT` | request-response | RESEARCH Skeleton #3 + Cluster B D-07 | skeleton-exact |
| `src/tools/index.ts` (implied by skeleton #2) | Barrel: re-exports `registerWorkspace`, `registerProject`, `registerSequence`, `registerShot` | static re-exports | RESEARCH Skeleton #2 import line | spec-exact |
| `src/server.ts` | Entry point: CLI parse → `openDb` → `HierarchyRepo` → `Engine` → `McpServer` → register 4 tools → stdio always + optional HTTP via Hono + `fetch-to-node` | bootstrap, dual-transport | RESEARCH Skeletons #2 and #5 (verbatim); `mcp-hono-stateless` external ref | skeleton-exact |

Total files: **15** (Planner may collapse `errors.ts` + `envelope.ts` into their consumer files if it prefers; they're listed separately because D-28..D-32 and D-25 both need dedicated attention.)

## Pattern Assignments

### `src/store/db.ts` — SQLite + pragma init + user_version

**Seed:** RESEARCH.md Skeleton #1 (verbatim — already production-ready shape)

**Imports pattern:**
```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';  // .js suffix for ESM/NodeNext
```

**Init-order contract (D-20, Pitfall #6, Pitfall #10):**
```typescript
const SCHEMA_VERSION = 1;

export function openDb(path: string) {
  const sqlite = new Database(path);
  // Order matters — pragmas before any schema work
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const existingVersion = sqlite.pragma('user_version', { simple: true }) as number;
  if (existingVersion === 0) {
    sqlite.exec(SCHEMA_DDL);  // all 5 CREATE TABLE IF NOT EXISTS + indexes
    sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
  } else if (existingVersion !== SCHEMA_VERSION) {
    throw new Error(`DB at ${path} is version ${existingVersion}, server expects ${SCHEMA_VERSION}`);
  }

  return drizzle(sqlite, { schema });
}
```

**Zero-MCP-imports invariant:** This file is under `src/store/` (D-33/D-34). Must not import `@modelcontextprotocol/sdk` — enforced by purity grep in tests.

---

### `src/store/schema.ts` — Drizzle table definitions

**Seed:** RESEARCH.md §"Cluster B" SQL DDL block (verbatim column list, constraints, indexes)

**Pattern (Drizzle `sqliteTable` shape):**
```typescript
import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  naming_template: text('naming_template'),                // nullable, D-09
  created_at: integer('created_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  naming_template: text('naming_template'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqueNamePerWorkspace: unique().on(t.workspace_id, t.name),
  idxWorkspace: index('idx_projects_workspace').on(t.workspace_id),
}));

// ... sequences, shots (same shape, parent swapped) ...
// ... versions (schema-only in Phase 1, D-10) ...
```

**Companion raw-SQL DDL string** (for the `db.ts` first-run path):
```typescript
export const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS workspaces (...);
  CREATE TABLE IF NOT EXISTS projects (..., UNIQUE(workspace_id, name));
  CREATE TABLE IF NOT EXISTS sequences (..., UNIQUE(project_id, name));
  CREATE TABLE IF NOT EXISTS shots (..., UNIQUE(sequence_id, name));
  CREATE TABLE IF NOT EXISTS versions (...);
  CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_sequences_project ON sequences(project_id);
  CREATE INDEX IF NOT EXISTS idx_shots_sequence ON shots(sequence_id);
  CREATE INDEX IF NOT EXISTS idx_versions_shot ON versions(shot_id, version_number);
`;
```

Take the DDL verbatim from RESEARCH.md §"Tables (all Phase 1...)". Any deviation is a bug.

---

### `src/types/hierarchy.ts` — Plain-TS types (no dependencies)

**Seed:** Derived from the schema DDL field list + RESEARCH Cluster C breadcrumb types

**Pattern:**
```typescript
export interface Workspace {
  id: string;
  name: string;
  naming_template: string | null;
  created_at: number;
}
export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  naming_template: string | null;
  created_at: number;
}
// Sequence, Shot — same shape
// Version — schema-only in Phase 1, type still exported

export type EntityType = 'workspace' | 'project' | 'sequence' | 'shot';
export interface BreadcrumbEntry { type: EntityType; id: string; name: string; }
export interface Breadcrumb { entries: BreadcrumbEntry[]; text: string; }
```

**Hard constraint:** Zero imports. Pure types file. No `zod`, no `drizzle`, nothing. Other files import *from* this.

---

### `src/utils/id.ts` — nanoid wrapper

**Seed:** CLAUDE.md "Use `nanoid()` for all entity IDs" + D-11 (21-char default)

**Pattern:**
```typescript
import { nanoid } from 'nanoid';

/** Generate a 21-char URL-safe id. Prefix with entity type when helpful for log reading. */
export function newId(prefix?: 'ws' | 'proj' | 'seq' | 'shot' | 'ver'): string {
  const core = nanoid();
  return prefix ? `${prefix}_${core}` : core;
}
```

**Decision point for planner:** CONTEXT.md D-11 says default length 21, distinct from display names. Prefix (`ws_`, `proj_`, …) is used in RESEARCH Cluster E error messages (`'ws_abc'`). Planner should lock: **use prefixed ids** to keep error messages grep-friendly. If the planner chooses raw nanoid with no prefix, update the error-message examples correspondingly.

---

### `src/store/hierarchy-repo.ts` — Repository pattern

**Seed:** RESEARCH Cluster B + Drizzle query builder patterns; no in-repo analog

**Pattern (canonical method shape — replicate for each of 4 entities):**
```typescript
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { workspaces, projects, sequences, shots } from './schema.js';
import type { Workspace, Project, Sequence, Shot } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';
import { TypedError } from '../engine/errors.js';

export class HierarchyRepo {
  constructor(private db: BetterSQLite3Database) {}

  createWorkspace(name: string): Workspace {
    const row = { id: newId('ws'), name, naming_template: null, created_at: Date.now() };
    try {
      this.db.insert(workspaces).values(row).run();
    } catch (err: any) {
      if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new TypedError(
          'DUPLICATE_NAME',
          `Workspace '${name}' already exists`,
          'Pick a different name or list existing workspaces'
        );
      }
      throw err;
    }
    return row;
  }

  getWorkspace(id: string): Workspace | null {
    const r = this.db.select().from(workspaces).where(eq(workspaces.id, id)).get();
    return r ?? null;
  }

  listWorkspaces(limit: number, offset: number): { items: Workspace[]; total: number } {
    const items = this.db.select().from(workspaces).limit(limit).offset(offset).all();
    const total = this.db.select({ n: sql`count(*)` }).from(workspaces).get()?.n ?? 0;
    return { items, total: Number(total) };
  }

  // Parent-aware variants: createProject checks workspace exists → PARENT_NOT_FOUND
  createProject(workspaceId: string, name: string): Project {
    const parent = this.getWorkspace(workspaceId);
    if (!parent) throw new TypedError(
      'PARENT_NOT_FOUND',
      `Parent workspace '${workspaceId}' not found for project creation`,
      `Verify the parent id with { tool: 'workspace', action: 'get' }`
    );
    // ... same insert + unique-constraint wrapping as createWorkspace
  }

  // ... sequence and shot follow the same shape
}
```

**Constraints (D-13, D-33, D-34):**
- Never let `SQLITE_CONSTRAINT_*` leak; always wrap into `TypedError`.
- No `@modelcontextprotocol/sdk` import (grep-enforced).
- Return plain `Workspace`/`Project`/... objects from `types/hierarchy.ts`, not raw Drizzle rows.

---

### `src/engine/errors.ts` — TypedError class

**Seed:** RESEARCH Cluster E (error-code table); D-28..D-32

**Pattern:**
```typescript
export type ErrorCode =
  | 'WORKSPACE_NOT_FOUND' | 'PROJECT_NOT_FOUND' | 'SEQUENCE_NOT_FOUND' | 'SHOT_NOT_FOUND'
  | 'PARENT_NOT_FOUND' | 'DUPLICATE_NAME' | 'INVALID_SHOT_FORMAT' | 'INVALID_INPUT';

export class TypedError extends Error {
  constructor(public code: ErrorCode, message: string, public hint?: string) {
    super(message);
    this.name = 'TypedError';
  }
}
```

**Usage invariant:** Every thrown error below the tool boundary is a `TypedError`. `envelope.toolError()` maps it to MCP's `{isError:true, structuredContent:{code,message,hint}}` (D-28). Any non-`TypedError` caught at the envelope is a bug and should be logged to stderr and re-wrapped as `INVALID_INPUT` with a generic message (defence in depth — prevents raw Zod/SQLite leaks per D-13, D-32).

---

### `src/engine/breadcrumb.ts` — Tree-walk resolver

**Seed:** RESEARCH Skeleton #4 (verbatim, but complete the three abbreviated branches)

**Pattern:**
```typescript
import type { HierarchyRepo } from '../store/hierarchy-repo.js';
import type { BreadcrumbEntry, Breadcrumb, EntityType } from '../types/hierarchy.js';
import { TypedError } from './errors.js';

const SEP = ' > ';  // D-22 separator — locked

export class BreadcrumbResolver {
  constructor(private repo: HierarchyRepo) {}

  resolve(type: EntityType, id: string): Breadcrumb {
    const entries: BreadcrumbEntry[] = [];
    switch (type) {
      case 'shot': {
        const shot = this.repo.getShot(id);
        if (!shot) throw new TypedError('SHOT_NOT_FOUND', `Shot '${id}' not found`);
        const seq = this.repo.getSequence(shot.sequence_id)!;
        const proj = this.repo.getProject(seq.project_id)!;
        const ws = this.repo.getWorkspace(proj.workspace_id)!;
        entries.push({ type: 'workspace', id: ws.id,   name: ws.name });
        entries.push({ type: 'project',   id: proj.id, name: proj.name });
        entries.push({ type: 'sequence',  id: seq.id,  name: seq.name });
        entries.push({ type: 'shot',      id: shot.id, name: shot.name });
        break;
      }
      case 'sequence': {
        const seq = this.repo.getSequence(id);
        if (!seq) throw new TypedError('SEQUENCE_NOT_FOUND', `Sequence '${id}' not found`);
        const proj = this.repo.getProject(seq.project_id)!;
        const ws = this.repo.getWorkspace(proj.workspace_id)!;
        entries.push({ type: 'workspace', id: ws.id,   name: ws.name });
        entries.push({ type: 'project',   id: proj.id, name: proj.name });
        entries.push({ type: 'sequence',  id: seq.id,  name: seq.name });
        break;
      }
      case 'project': {
        const proj = this.repo.getProject(id);
        if (!proj) throw new TypedError('PROJECT_NOT_FOUND', `Project '${id}' not found`);
        const ws = this.repo.getWorkspace(proj.workspace_id)!;
        entries.push({ type: 'workspace', id: ws.id,   name: ws.name });
        entries.push({ type: 'project',   id: proj.id, name: proj.name });
        break;
      }
      case 'workspace': {
        const ws = this.repo.getWorkspace(id);
        if (!ws) throw new TypedError('WORKSPACE_NOT_FOUND', `Workspace '${id}' not found`);
        entries.push({ type: 'workspace', id: ws.id, name: ws.name });
        break;
      }
    }
    return { entries, text: entries.map(e => e.name).join(SEP) };
  }
}
```

**Constraint (D-35):** Breadcrumb resolution lives here. Tools call `engine.getBreadcrumb(type, id)` (through `pipeline.ts`). Tools must never walk the repo themselves — plan checker greps for this.

---

### `src/engine/pipeline.ts` (Phase 1 subset) — Engine facade

**Seed:** RESEARCH Skeleton #3 shows tools calling `engine.createWorkspace(...)` etc. Shape is the delegate surface.

**Pattern:**
```typescript
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { BreadcrumbResolver } from './breadcrumb.js';
import { TypedError } from './errors.js';
import type { Workspace, Project, Sequence, Shot, Breadcrumb } from '../types/hierarchy.js';

export class Engine {
  private breadcrumb: BreadcrumbResolver;
  constructor(private repo: HierarchyRepo) {
    this.breadcrumb = new BreadcrumbResolver(repo);
  }

  // --- workspace ---
  createWorkspace(name: string): { entity: Workspace; breadcrumb: Breadcrumb } {
    const ws = this.repo.createWorkspace(name);
    const bc = this.breadcrumb.resolve('workspace', ws.id);
    return { entity: ws, breadcrumb: bc };
  }

  getWorkspace(id: string): { entity: Workspace; breadcrumb: Breadcrumb } {
    const ws = this.repo.getWorkspace(id);
    if (!ws) throw new TypedError(
      'WORKSPACE_NOT_FOUND',
      `Workspace '${id}' not found`,
      `List workspaces with { tool: 'workspace', action: 'list' }`
    );
    return { entity: ws, breadcrumb: this.breadcrumb.resolve('workspace', ws.id) };
  }

  listWorkspaces(limit: number, offset: number) {
    const { items, total } = this.repo.listWorkspaces(limit, offset);
    return {
      items: items.map(ws => ({ ...ws, ...this.breadcrumb.resolve('workspace', ws.id) })),
      total, limit, offset,   // D-24 envelope
    };
  }

  // --- project, sequence, shot: same shape, parameterized by parent ---
  // shot create enforces ^sh\d{3,}$ → INVALID_SHOT_FORMAT (D-07)

  createShot(sequenceId: string, name: string) {
    if (!/^sh\d{3,}$/.test(name)) {
      throw new TypedError(
        'INVALID_SHOT_FORMAT',
        `Shot name '${name}' does not match expected format`,
        `Shot names must match ^sh\\d{3,}$ — e.g. 'sh010', 'sh020'`
      );
    }
    const shot = this.repo.createShot(sequenceId, name);
    return { entity: shot, breadcrumb: this.breadcrumb.resolve('shot', shot.id) };
  }
}
```

**Constraint (D-33):** Zero `@modelcontextprotocol/sdk` imports. Engine can be consumed by tools, tests, or a future non-MCP caller (e.g., Phase 5 REST adapter).

**Planner decision point:** Shot regex check — engine-level here, OR Zod regex in tool-level schema. Research Cluster E says `INVALID_SHOT_FORMAT` surfaces at the tool boundary, but the engine is the single authority on validity. Recommend: **enforce in engine** (canonical), plus optional `.regex(/^sh\d{3,}$/, 'INVALID_SHOT_FORMAT')` in the shot tool's Zod for early rejection. Both paths produce the same `INVALID_SHOT_FORMAT` code.

---

### `src/tools/envelope.ts` — Response shaping

**Seed:** RESEARCH Skeleton #3 calls `toolOk(...)` and `toolError(err)`; D-25 locks the dual form; D-28 locks error shape

**Pattern:**
```typescript
import { TypedError } from '../engine/errors.js';

/** Wrap engine result into MCP dual-form response (D-25). */
export function toolOk(structured: unknown) {
  return {
    structuredContent: structured,
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
  };
}

/** Map TypedError → MCP error response (D-28). Unknown errors re-wrapped defensively. */
export function toolError(err: unknown) {
  if (err instanceof TypedError) {
    const payload = { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) };
    return {
      isError: true,
      structuredContent: payload,
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    };
  }
  // Defence-in-depth: no raw Zod/SQLite/Error leaks (D-13, D-32)
  console.error('Unwrapped error at tool boundary:', err);
  const fallback = { code: 'INVALID_INPUT', message: 'Unexpected internal error' };
  return { isError: true, structuredContent: fallback,
           content: [{ type: 'text' as const, text: JSON.stringify(fallback) }] };
}
```

---

### `src/tools/workspace-tool.ts` — Canonical tool shape (replicated for all 4)

**Seed:** RESEARCH Skeleton #3 (verbatim)

**Pattern (replicate per entity, swap parent-id fields):**
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/pipeline.js';
import { toolOk, toolError } from './envelope.js';

const CreateInput = z.object({ action: z.literal('create'), name: z.string().min(1) });
const ListInput   = z.object({
  action: z.literal('list'),
  limit: z.number().int().min(1).max(100).default(20),   // D-24 defaults
  offset: z.number().int().min(0).default(0),
});
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
        case 'create': return toolOk(engine.createWorkspace(input.name));
        case 'list':   return toolOk(engine.listWorkspaces(input.limit, input.offset));
        case 'get':    return toolOk(engine.getWorkspace(input.id));
      }
    } catch (err) {
      return toolError(err);
    }
  });
}
```

**Per-entity deltas:**

| File | CreateInput adds | ListInput adds | GetInput | Engine calls |
|------|------------------|----------------|----------|--------------|
| `project-tool.ts` | `workspaceId: z.string().min(1)` | `workspaceId: z.string().min(1).optional()` (filter) | unchanged | `engine.createProject(wsId, name)` / `listProjects` / `getProject` |
| `sequence-tool.ts` | `projectId: z.string().min(1)` | `projectId: z.string().min(1).optional()` | unchanged | `engine.createSequence(projId, name)` etc. |
| `shot-tool.ts` | `sequenceId: z.string().min(1)` + `name: z.string().regex(/^sh\d{3,}$/, 'INVALID_SHOT_FORMAT')` | `sequenceId` optional filter | unchanged | `engine.createShot(seqId, name)` etc. |

**Invariant (D-33):** Each tool file is ≤ ~40 lines. One engine call per action, no business logic, no repo access. Plan checker greps tool files for `@modelcontextprotocol/sdk/server/mcp.js` AND absence of `HierarchyRepo`/`nanoid` imports.

---

### `src/tools/index.ts` — Barrel

**Seed:** RESEARCH Skeleton #2 line `import { registerWorkspace, registerProject, registerSequence, registerShot } from './tools/index.js';`

**Pattern:**
```typescript
export { registerWorkspace } from './workspace-tool.js';
export { registerProject } from './project-tool.js';
export { registerSequence } from './sequence-tool.js';
export { registerShot } from './shot-tool.js';
```

---

### `src/server.ts` — Entry point, dual transport

**Seed:** RESEARCH Skeletons #2 (server) + #5 (CLI parser) — both verbatim. External ref: `mcp-hono-stateless`.

**Key structural pieces:**
1. Shebang + ESM imports (`@modelcontextprotocol/sdk/server/mcp.js`, stdio, streamableHttp, Hono, `@hono/node-server`, `fetch-to-node`, local modules with `.js` suffix).
2. CLI parse (Skeleton #5 verbatim, 5 flags: `--http`, `--port`, `--db`, `--help`, `--version`; unknown flag exits 2).
3. Bootstrap: `openDb` → `HierarchyRepo` → `Engine` → `McpServer` with `instructions` string.
4. Register all 4 tools against the SAME `McpServer` instance (D-16, Pitfall #7).
5. Always-on stdio: `new StdioServerTransport()` + `await server.connect(stdio)`.
6. Opt-in HTTP (`--http`): Hono app with `POST /mcp` using `toReqRes`/`toFetchResponse` + stateless `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` + `@hono/node-server` `serve({ fetch, port })`.
7. All startup messages via `console.error` (D-21). Zero `console.log`, zero stdout writes. (Pitfall: "breaks JSON-RPC framing otherwise.")
8. Log-printed on boot: DB path, "stdio transport connected", and (if HTTP) `Listening on http://localhost:${port}`.

**Shape to copy:**
```typescript
#!/usr/bin/env node
// ... imports ...

const args = parseCliFlags(process.argv.slice(2));
if (args.help) { printHelp(); process.exit(0); }
if (args.version) { console.error(pkg.version); process.exit(0); }

const dbPath = args.db ?? './vfx-familiar.db';
console.error(`DB: ${dbPath}`);
const db = openDb(dbPath);

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

const stdio = new StdioServerTransport();
await server.connect(stdio);
console.error('stdio transport connected');

if (args.http) {
  const port = args.port ?? 3000;
  const app = new Hono();
  app.post('/mcp', async (c) => {
    const { req, res } = toReqRes(c.req.raw);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);                 // same McpServer, both transports (D-16)
    await transport.handleRequest(req, res);
    return toFetchResponse(res);
  });
  serve({ fetch: app.fetch, port });
  console.error(`Listening on http://localhost:${port}`);
}
```

**External analog (canonical):** https://github.com/mhart/mcp-hono-stateless — consult for edge cases on `toReqRes`/`toFetchResponse` handshake with Hono's Fetch Request.

## Shared Patterns

### Pattern S1: Tool-Engine Purity (D-33)
**Rule:** Files under `src/tools/*.ts` MUST import from `@modelcontextprotocol/sdk/*`. Files under `src/engine/*.ts` and `src/store/*.ts` MUST NOT import from `@modelcontextprotocol/sdk/*`.
**Apply to:** All engine files, all store files, all tool files.
**Enforcement:** grep-based test in `src/__tests__/architecture-purity.test.ts` (RESEARCH §"Regression Detectors").

### Pattern S2: Dual-form Response Envelope (D-25)
**Rule:** Every successful tool response returns `{ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] }`.
**Apply to:** All 4 tool files (via `toolOk()` helper in `envelope.ts`).

### Pattern S3: TypedError Wrapping (D-28, D-13, D-32)
**Rule:** No raw error (Zod, SQLite, or `Error`) reaches the agent. All errors thrown below the tool boundary are `TypedError`. Envelope maps them to `{ isError: true, structuredContent: { code, message, hint? } }`.
**Apply to:** Every repo method, every engine method, every tool catch block.

### Pattern S4: Breadcrumb-on-Every-Response (D-22, D-23, D-35)
**Rule:** Every create/get response includes `{ entity, breadcrumb: BreadcrumbEntry[], breadcrumb_text: string }`. Every list item also carries its own breadcrumb. Resolution is always via `engine.breadcrumb.resolve()` — never in tools or repos.
**Apply to:** All 4 tool files, all engine mutation/query methods.

### Pattern S5: Pragma-before-schema DB Init (D-20, Pitfall #6, Pitfall #10)
**Rule:** Open SQLite → set `journal_mode=WAL` → `busy_timeout=5000` → `foreign_keys=ON` → check `user_version` → apply schema if 0 → set `user_version=1`. Order is invariant.
**Apply to:** `src/store/db.ts` only.

### Pattern S6: stderr-only Logging (D-21, Pitfall #7)
**Rule:** All diagnostic output via `console.error`. Zero `console.log`, zero `process.stdout.write`, zero `print*` outside of MCP-managed JSON-RPC frames on stdio. Test harness in `src/__tests__/stdio-hygiene.test.ts` asserts stdout silence during boot + tool call.
**Apply to:** Every file, enforced project-wide.

### Pattern S7: ESM `.js` import suffixes
**Rule:** TypeScript source imports target `.js` (even for `.ts` files). `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` in tsconfig (CONTEXT.md Claude's Discretion).
**Apply to:** Every TS file with a relative import.

### Pattern S8: List Envelope Shape (D-24)
**Rule:** List responses are `{ items: T[], total: number, limit: number, offset: number }`. Defaults `limit=20, offset=0`. Shape is locked in Phase 1; Phase 4 search inherits it.
**Apply to:** All 4 tool `list` actions (delegated through `engine.list*`).

## No Analog Found

All 15 files have a skeleton or spec-level seed from RESEARCH.md. No files require pattern-free invention. The greenfield "no in-repo analog" status is expected and neutral — Phase 1 *is* the analog for all future phases.

| File | Seed | Note |
|------|------|------|
| (none) | — | Every file is either a RESEARCH skeleton verbatim or a direct derivation from locked decisions. |

## External Pattern References

These are the external analogs the planner/executor should consult when the RESEARCH skeleton isn't enough:

| Concern | Reference | Used for |
|---------|-----------|----------|
| MCP + Hono + Streamable HTTP bridge | `https://github.com/mhart/mcp-hono-stateless` | `src/server.ts` HTTP path |
| MCP SDK 1.29 tool registration with Zod v4 Standard Schema | `https://github.com/modelcontextprotocol/typescript-sdk` | All `src/tools/*-tool.ts` |
| MCP Streamable HTTP transport spec | `https://modelcontextprotocol.io/specification/2025-03-26/basic/transports` | Validate stateless-mode behavior |
| Drizzle `better-sqlite3` getting-started | Context7 lookup `drizzle-orm` → `better-sqlite3` driver | `src/store/db.ts`, `src/store/schema.ts` |
| SQLite WAL semantics | `https://www.sqlite.org/wal.html` | Pragma-init rationale, testing |
| Netflix shot-naming recommendations | `https://partnerhelp.netflixstudios.com/hc/en-us/articles/360057627473` | Shot regex `^sh\d{3,}$` rationale |
| Zod v4 JSON Schema / Standard Schema | `https://zod.dev/json-schema` | Tool input schema construction |

## Metadata

**Analog search scope:** entire repo root + `/src` (confirmed absent) + `/packages` (confirmed absent).
**Files scanned:** 0 source files (greenfield). CONTEXT.md + RESEARCH.md consumed as authoritative seeds.
**Pattern extraction date:** 2026-04-20

## PATTERN MAPPING COMPLETE
