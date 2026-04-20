# Architecture Research

**Domain:** VFX Pipeline MCP Server (AI-driven asset management over ComfyUI Cloud)
**Researched:** 2026-04-15
**Confidence:** HIGH

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                    │
│  │ Claude Code  │  │ Cursor/Copilot│  │ OpenAI Agent │                    │
│  │  (MCP stdio) │  │  (MCP stdio)  │  │ (fn-calling) │                    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                    │
│         │                 │                  │                            │
│      MCP stdio         MCP stdio      Function-calling                   │
│         │                 │              adapter                          │
├─────────┴─────────────────┴──────────────┴───────────────────────────────┤
│                         SERVER LAYER                                      │
│  ┌─────────────────────────────────────────────────────────────────┐      │
│  │                    MCP Tool Surface                              │      │
│  │  project.create | shot.generate | version.diff | asset.query    │      │
│  └──────────┬──────────────────────────────────────────────────────┘      │
│             │                                                             │
│  ┌──────────┴──────────┐  ┌─────────────────┐  ┌───────────────────┐     │
│  │  Pipeline Engine    │  │ Provenance Engine│  │ ComfyUI Client    │     │
│  │  (hierarchy, vers.) │  │ (lineage, repro) │  │ (API, polling, WS)│     │
│  └──────────┬──────────┘  └────────┬────────┘  └────────┬──────────┘     │
│             │                      │                     │                │
│  ┌──────────┴──────────────────────┴─────────────────────┘               │
│  │                  Project Store (SQLite)                                │
│  │  hierarchy | versions | provenance | tags | jobs                      │
│  └───────────────────────────────────────────────────────┘               │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │              Web UI Server (Hono + SSE)                          │     │
│  │  project tree | provenance trail | generation status             │     │
│  └─────────────────────────────────────────────────────────────────┘     │
├──────────────────────────────────────────────────────────────────────────┤
│                       EXTERNAL SERVICES                                   │
│  ┌─────────────────────────────────────┐  ┌──────────────────────┐       │
│  │  ComfyUI Cloud API                  │  │  File Storage (local)│       │
│  │  POST /api/prompt                   │  │  outputs, thumbnails │       │
│  │  GET /api/job/{id}/status           │  │                      │       │
│  │  GET /api/view?filename=...         │  │                      │       │
│  │  WSS /ws?clientId=...&token=...     │  │                      │       │
│  └─────────────────────────────────────┘  └──────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **MCP Tool Surface** | Exposes structured tools to AI agents via MCP protocol; Zod-validated schemas, tool annotations | `McpServer` from `@modelcontextprotocol/sdk` with `registerTool()` per operation |
| **Pipeline Engine** | Manages hierarchy (workspace/project/sequence/shot/version), auto-versioning, shot lifecycle | Service class wrapping SQLite queries, enforces hierarchy constraints |
| **Provenance Engine** | Captures full generation lineage (workflow JSON, prompt JSON, seed, model checksums, timestamps); enables diff and reproduce | Append-only provenance table, JSON storage for workflow/prompt blobs, SHA-256 hashing |
| **ComfyUI Client** | HTTP client for Cloud API; job submission, polling, WebSocket progress, output retrieval | Typed HTTP client wrapping `POST /api/prompt`, `GET /api/job/{id}/status`, WebSocket listener |
| **Project Store** | SQLite database with WAL mode; hierarchy tables, provenance records, tag associations, job tracking | `better-sqlite3` with prepared statements, WAL mode, foreign keys enforced |
| **Function-Calling Adapter** | Translates MCP tools to OpenAI function-calling JSON schema format; bridges non-MCP agents | Thin HTTP layer that auto-discovers MCP tools and exposes as `/v1/chat/completions`-compatible tools |
| **Web UI Server** | Serves static dashboard + SSE for real-time generation status, project tree, provenance viewer | Hono with `streamSSE`, serves static build from `dashboard/dist/` |

## Recommended Project Structure

```
src/
├── server.ts               # Entry point: creates McpServer, registers tools, starts transports
├── tools/                   # MCP tool definitions (one file per tool group)
│   ├── project-tools.ts     # workspace.create, project.create, sequence.create, shot.create
│   ├── generation-tools.ts  # shot.generate, shot.iterate, version.reproduce
│   ├── query-tools.ts       # asset.query, asset.search, version.diff
│   └── metadata-tools.ts    # tag.add, tag.remove, metadata.set
├── engine/                  # Core business logic (no MCP dependency)
│   ├── pipeline.ts          # Hierarchy management, auto-versioning
│   ├── provenance.ts        # Lineage capture, diff computation, reproduce logic
│   └── comfyui-client.ts    # ComfyUI Cloud API wrapper (HTTP + WebSocket)
├── store/                   # Data layer
│   ├── db.ts                # SQLite connection (better-sqlite3, WAL, pragmas)
│   ├── schema.ts            # Table definitions, migrations
│   ├── hierarchy-repo.ts    # CRUD for workspace/project/sequence/shot/version
│   ├── provenance-repo.ts   # Append-only provenance records
│   ├── tag-repo.ts          # Tag associations
│   └── job-repo.ts          # ComfyUI job tracking
├── adapter/                 # Non-MCP access layer
│   ├── function-calling.ts  # OpenAI function-calling schema translator
│   └── http-api.ts          # REST endpoints for the web UI
├── web/                     # Web UI server
│   └── routes.ts            # Hono routes: static files + SSE + API endpoints
├── types/                   # Shared TypeScript types
│   ├── hierarchy.ts         # Workspace, Project, Sequence, Shot, Version
│   ├── provenance.ts        # ProvenanceRecord, WorkflowBlob, PromptBlob
│   ├── comfyui.ts           # API request/response types
│   └── jobs.ts              # Job status, progress events
└── utils/                   # Shared utilities
    ├── hash.ts              # SHA-256 for model checksums, content hashing
    └── id.ts                # ULID or nanoid generation
dashboard/                   # Separate build (Vite + vanilla TS or Preact)
├── src/
│   ├── views/
│   │   ├── project-tree.ts  # Hierarchy navigator
│   │   ├── provenance.ts    # Lineage trail viewer
│   │   └── generation.ts    # Live job status
│   ├── sse-client.ts        # EventSource wrapper
│   └── main.ts              # Entry point
├── index.html
└── vite.config.ts
```

### Structure Rationale

- **tools/:** Thin wrappers that validate input (Zod) and delegate to engine. One file per tool group keeps MCP surface scannable. Tools never contain business logic.
- **engine/:** Pure business logic with zero MCP dependency. Testable in isolation. The pipeline and provenance engines are separate because they serve different invariants (hierarchy consistency vs. lineage immutability).
- **store/:** Repository pattern over SQLite. Each repo owns its tables. `db.ts` handles connection lifecycle, WAL mode, and pragma configuration. Repos return plain objects, not database rows.
- **adapter/:** The function-calling adapter is deliberately separate from MCP tools. It reads tool schemas from the MCP surface and translates them -- it does not duplicate tool logic.
- **web/:** Hono routes serve the dashboard static build and expose SSE streams for real-time job updates. REST endpoints back the UI (project tree data, provenance queries).
- **dashboard/:** Separate build artifact. Lightweight -- Preact or vanilla TS with a tiny bundled footprint. The dashboard is a visibility tool, not a control surface.

## Architectural Patterns

### Pattern 1: Tool-Engine Separation

**What:** MCP tools are thin schema-validated entry points that delegate all logic to engine services. Tools never access the database directly.
**When to use:** Always. This is the foundational pattern for the entire server.
**Trade-offs:** Adds one layer of indirection, but ensures tools are testable, engine is reusable across MCP and function-calling adapter, and business logic changes never require MCP schema updates.

**Example:**
```typescript
// tools/generation-tools.ts -- THIN
server.registerTool('shot_generate', {
  title: 'Generate Shot Version',
  description: 'Submit a ComfyUI workflow for a shot, creating a new version with full provenance',
  inputSchema: z.object({
    shotId: z.string().describe('Shot identifier'),
    workflowJson: z.record(z.unknown()).describe('ComfyUI API-format workflow'),
    notes: z.string().optional().describe('Version notes'),
  }),
  annotations: { destructiveHint: false, idempotentHint: false },
}, async ({ shotId, workflowJson, notes }) => {
  const result = await pipeline.generateVersion(shotId, workflowJson, notes);
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
});

// engine/pipeline.ts -- ALL THE LOGIC
async generateVersion(shotId: string, workflowJson: object, notes?: string) {
  const shot = this.hierarchyRepo.getShot(shotId);
  const nextVersion = this.hierarchyRepo.nextVersionNumber(shotId);
  const jobId = await this.comfyuiClient.submitWorkflow(workflowJson);
  const version = this.hierarchyRepo.createVersion(shotId, nextVersion, jobId, notes);
  this.provenanceRepo.captureSubmission(version.id, workflowJson, jobId);
  return { versionId: version.id, versionNumber: nextVersion, jobId };
}
```

### Pattern 2: Append-Only Provenance

**What:** Provenance records are immutable. Never update or delete. Each generation event appends a new record with full context. Versions themselves are immutable once created.
**When to use:** Every generation, iteration, and reproduction event.
**Trade-offs:** Database grows monotonically. Worth it -- provenance is the core value proposition. Older records can be archived (moved to cold table) but never deleted.

**Example:**
```typescript
// store/provenance-repo.ts
captureSubmission(versionId: string, workflowJson: object, jobId: string) {
  this.db.prepare(`
    INSERT INTO provenance (id, version_id, event_type, workflow_json, prompt_json, 
                            job_id, timestamp)
    VALUES (?, ?, 'submitted', ?, NULL, ?, ?)
  `).run(ulid(), versionId, JSON.stringify(workflowJson), jobId, Date.now());
}

captureCompletion(versionId: string, promptJson: object, outputs: object, 
                  modelChecksums: Record<string, string>, seed: number) {
  this.db.prepare(`
    INSERT INTO provenance (id, version_id, event_type, prompt_json, outputs,
                            model_checksums, seed, timestamp)
    VALUES (?, ?, 'completed', ?, ?, ?, ?, ?)
  `).run(ulid(), versionId, JSON.stringify(promptJson), 
         JSON.stringify(outputs), JSON.stringify(modelChecksums), seed, Date.now());
}
```

### Pattern 3: Dual-Transport MCP Server

**What:** The server runs simultaneously on stdio (for Claude Code, Cursor, etc.) and Streamable HTTP (for the web UI and function-calling adapter). Same `McpServer` instance, two transports.
**When to use:** When you need both local agent integration and network accessibility.
**Trade-offs:** Streamable HTTP adds a port listener, but the MCP SDK supports this natively. Stdio remains the primary agent transport; HTTP is secondary for the dashboard and adapter.

**Example:**
```typescript
// server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer(
  { name: 'vfx-familiar', version: '1.0.0' },
  { instructions: 'VFX pipeline management. Use project tools to create hierarchy, generation tools to produce versions, query tools to find assets.' }
);

// Register all tools...
registerProjectTools(server, pipeline);
registerGenerationTools(server, pipeline);
registerQueryTools(server, pipeline);
registerMetadataTools(server, pipeline);

// Primary: stdio for MCP clients
const stdioTransport = new StdioServerTransport();
await server.connect(stdioTransport);

// Secondary: Hono serves web UI + REST API + SSE (separate from MCP transport)
// The web UI talks to the same engine instances, not through MCP
```

### Pattern 4: ComfyUI Job Lifecycle Bridge

**What:** A dedicated client that manages the async gap between submitting a workflow and receiving outputs. Handles polling, WebSocket progress, output download, and provenance capture on completion.
**When to use:** Every generation request. The client bridges synchronous MCP tool calls with async ComfyUI job execution.
**Trade-offs:** The MCP tool returns immediately with a job ID. Completion is tracked in the background. The web UI shows real-time progress via SSE. Agent can poll status via a separate tool.

## Data Flow

### Generation Request Flow

```
Agent says: "Generate a new version for shot SQ010_SH020"
    |
    v
[MCP Tool: shot_generate]
    | validates input (Zod)
    v
[Pipeline Engine: generateVersion()]
    | 1. Validates shot exists in hierarchy
    | 2. Computes next version number (v003)
    | 3. Creates version record (status: submitted)
    v
[ComfyUI Client: submitWorkflow()]
    | POST /api/prompt with workflow JSON
    | Returns prompt_id
    v
[Provenance Engine: captureSubmission()]
    | Appends immutable provenance record:
    |   workflow_json, job_id, timestamp
    v
[Return to agent: { versionId, versionNumber: 3, jobId }]
    |
    | (async, in background)
    v
[ComfyUI Client: pollJobStatus() or WebSocket listener]
    | Monitors: pending -> in_progress -> completed
    | Emits SSE events to web UI during progress
    v
[On completion:]
    | 1. GET /api/view to download output files
    | 2. Extract prompt_json from ComfyUI response
    | 3. Compute model checksums from prompt_json paths
    v
[Provenance Engine: captureCompletion()]
    | Appends completion record:
    |   prompt_json, outputs, model_checksums, seed, timestamp
    v
[Pipeline Engine: updateVersionStatus()]
    | version status: submitted -> completed
    | Links output file paths to version
    v
[SSE: push status update to web UI]
```

### Provenance Query Flow

```
Agent says: "What changed between v002 and v003 of shot SQ010_SH020?"
    |
    v
[MCP Tool: version_diff]
    | validates shotId, versionA, versionB
    v
[Provenance Engine: diffVersions()]
    | 1. Load provenance for both versions
    | 2. JSON-diff the workflow_json blobs
    | 3. JSON-diff the prompt_json blobs (execution params)
    | 4. Compare seeds, model checksums, timestamps
    v
[Return structured diff to agent]
    {
      workflowChanges: [...],   // nodes added/removed/modified
      parameterChanges: [...],  // seed, cfg, steps, etc.
      modelChanges: [...],      // different model versions
      metadata: { v002_timestamp, v003_timestamp, artist }
    }
```

### Version Reproduction Flow

```
Agent says: "Reproduce version v002 exactly"
    |
    v
[MCP Tool: version_reproduce]
    | validates versionId
    v
[Provenance Engine: getReproductionParams()]
    | Loads original: workflow_json + seed + all params
    | Verifies model checksums are still available
    v
[Pipeline Engine: generateVersion()]
    | Creates NEW version (v004) with parent_version = v002
    | Submits identical workflow to ComfyUI
    v
[Provenance Engine: captureSubmission()]
    | Records with reproduction_source = v002
    | (lineage preserved: v004 is a reproduction of v002)
```

### Key Data Flows

1. **Hierarchy creation:** Agent creates workspace -> project -> sequence -> shot. Each level validates parent exists. IDs are ULIDs (sortable, unique). Names are slugified for filesystem-safe identifiers.
2. **Generation lifecycle:** Tool call -> version created -> job submitted -> background polling -> completion captured -> provenance sealed. The version record is the anchor; provenance records are the audit trail.
3. **Web UI data:** Hono REST endpoints serve hierarchy tree and provenance data. SSE stream pushes job progress events in real time. No MCP protocol involved -- the web UI talks to the engine directly.
4. **Function-calling bridge:** Adapter reads tool schemas from MCP, translates to OpenAI `functions` array format, exposes HTTP endpoint. On tool call, routes to the same engine (not through MCP).

## Database Schema

```sql
-- Hierarchy
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,         -- ULID
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL  -- epoch ms
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE sequences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,           -- e.g., "SQ010"
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE shots (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences(id),
  name TEXT NOT NULL,           -- e.g., "SH020"
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(sequence_id, name)
);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id),
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',  -- submitted|processing|completed|failed
  job_id TEXT,                               -- ComfyUI prompt_id
  parent_version_id TEXT REFERENCES versions(id),  -- for reproduce/iterate lineage
  notes TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(shot_id, version_number)
);

-- Provenance (append-only)
CREATE TABLE provenance (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id),
  event_type TEXT NOT NULL,    -- submitted|completed|failed
  workflow_json TEXT,          -- ComfyUI workflow (the blueprint)
  prompt_json TEXT,            -- ComfyUI prompt (the execution plan)
  outputs TEXT,                -- JSON: output file references
  model_checksums TEXT,        -- JSON: { model_path: sha256 }
  seed INTEGER,
  timestamp INTEGER NOT NULL
);

-- Tags and metadata
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id),
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(version_id, tag)
);

CREATE TABLE metadata (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(version_id, key)
);

-- Job tracking (for background polling)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,          -- ComfyUI prompt_id
  version_id TEXT NOT NULL REFERENCES versions(id),
  status TEXT NOT NULL DEFAULT 'pending',
  progress REAL DEFAULT 0,     -- 0.0 to 1.0
  error TEXT,
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_versions_shot ON versions(shot_id, version_number);
CREATE INDEX idx_provenance_version ON provenance(version_id, timestamp);
CREATE INDEX idx_tags_tag ON tags(tag);
CREATE INDEX idx_tags_version ON tags(version_id);
CREATE INDEX idx_metadata_key ON metadata(key, value);
CREATE INDEX idx_jobs_status ON jobs(status);
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 projects (demo) | Single SQLite file, stdio transport, polling for job status. This is the v1 target. |
| 10-100 projects (studio) | Add WAL mode pragmas (already default), background job manager with WebSocket instead of polling, consider read replicas via Litestream backup. |
| 100+ projects (enterprise) | Migrate project store to PostgreSQL, add job queue (BullMQ or similar), separate web UI into its own service, add auth layer. This is v2+ territory. |

### Scaling Priorities

1. **First bottleneck: ComfyUI API concurrency.** Free tier = 1 concurrent job. The job manager must queue internally and dispatch as slots free. This is a subscription limitation, not an architecture problem.
2. **Second bottleneck: SQLite write contention under high generation volume.** WAL mode handles this well up to dozens of concurrent writes. Beyond that, move to PostgreSQL. Not a v1 concern.
3. **Third bottleneck: Output file storage.** Local filesystem works for demo. Production would use S3-compatible storage with signed URLs. The version/provenance records store references (paths/URLs), not file contents.

## Anti-Patterns

### Anti-Pattern 1: MCP Tools Containing Business Logic

**What people do:** Put hierarchy validation, versioning logic, and provenance capture directly inside tool handlers.
**Why it's wrong:** Tools become untestable without an MCP client. Logic gets duplicated when the function-calling adapter needs the same behavior. Changes to business rules require touching MCP schema files.
**Do this instead:** Tools are one-liner delegates to engine services. All logic lives in `engine/`. Both MCP tools and the function-calling adapter call the same engine.

### Anti-Pattern 2: Mutable Provenance Records

**What people do:** Update provenance records in-place when a job completes (overwrite the submitted record with completion data).
**Why it's wrong:** Destroys the audit trail. If a job is resubmitted after failure, you lose the record of the failed attempt. Provenance must capture the full lifecycle, including failures.
**Do this instead:** Append-only. Each lifecycle event (submitted, progress, completed, failed) is a separate row. Query provenance by version_id + timestamp order to reconstruct the full history.

### Anti-Pattern 3: Storing Output Files in SQLite

**What people do:** BLOB the generated images/videos into the database for "simplicity."
**Why it's wrong:** SQLite performance degrades with large BLOBs. Backups become enormous. File access requires database round-trips instead of direct filesystem reads.
**Do this instead:** Store output files on the filesystem (or object storage). Store the file path/URL in the version and provenance records. The database is the index, not the file store.

### Anti-Pattern 4: Web UI as MCP Client

**What people do:** Have the web dashboard connect to the MCP server as an MCP client to get data.
**Why it's wrong:** MCP is designed for AI agents, not web UIs. The protocol adds unnecessary complexity (JSON-RPC, capability negotiation) for what is a simple REST + SSE use case. Also creates a circular dependency.
**Do this instead:** The web UI talks directly to the engine via Hono REST endpoints. Same engine instances, simpler protocol. The web UI is a viewer, not an agent.

### Anti-Pattern 5: Synchronous Job Completion in MCP Tools

**What people do:** Have the `shot_generate` tool block until ComfyUI finishes (could be 30+ seconds for image gen, minutes for video).
**Why it's wrong:** MCP tools should return promptly. Agents have timeouts. Long-running tools block the agent from doing other work.
**Do this instead:** Return the job ID immediately. Provide a `job_status` tool for the agent to check progress. Push real-time updates to the web UI via SSE. The agent decides when to poll.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **ComfyUI Cloud API** | HTTP client (`fetch`) with API key auth via `X-API-Key` header. WebSocket for real-time progress. | API is experimental and subject to change. Abstract behind a client interface to isolate changes. Concurrent job limits vary by subscription tier (1-5). |
| **File Storage** | Filesystem writes via `node:fs`. Outputs downloaded from ComfyUI signed URLs and stored locally. | v1: local `./outputs/{project}/{sequence}/{shot}/{version}/`. v2: S3-compatible with pre-signed URLs. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| MCP Tools <-> Engine | Direct function calls (same process) | Tools import engine, call methods. No serialization. |
| Engine <-> Store | Direct function calls (same process) | Engine imports repos, calls methods. Repos return plain objects. |
| Engine <-> ComfyUI Client | Direct function calls + async callbacks | Client methods are async (network I/O). Background job polling runs on interval/WebSocket. |
| Web UI Server <-> Engine | Direct function calls (same process) | Hono routes import engine, call methods. SSE pushes come from engine event emitter. |
| Function-Calling Adapter <-> Engine | Direct function calls (same process) | Adapter translates schemas, routes calls to engine. Same process, no network hop. |
| Web Dashboard <-> Web UI Server | HTTP (REST + SSE) | Dashboard is a static build served by Hono. Fetches data via REST, receives updates via SSE. Only network boundary in the system. |

### Event Flow (Engine EventEmitter)

The engine emits events that multiple consumers subscribe to:

```typescript
// engine/pipeline.ts
class PipelineEngine extends EventEmitter {
  async onJobProgress(jobId: string, progress: number) {
    this.emit('job:progress', { jobId, progress });
  }
  async onJobComplete(jobId: string, outputs: object) {
    this.emit('job:complete', { jobId, outputs });
  }
}

// web/routes.ts -- SSE subscriber
app.get('/api/events', (c) => {
  return streamSSE(c, async (stream) => {
    pipeline.on('job:progress', (data) => {
      stream.writeSSE({ event: 'progress', data: JSON.stringify(data) });
    });
    pipeline.on('job:complete', (data) => {
      stream.writeSSE({ event: 'complete', data: JSON.stringify(data) });
    });
  });
});
```

## Build Order (Dependency Chain)

The components have clear dependencies that dictate build order:

```
Phase 1: Foundation (no external dependencies)
  store/db.ts + store/schema.ts          -- SQLite connection, table creation
  types/*                                -- All shared types
  utils/*                                -- ID generation, hashing
      |
      v
Phase 2: Data Layer (depends on store)
  store/hierarchy-repo.ts                -- CRUD for hierarchy entities
  store/provenance-repo.ts               -- Append-only provenance
  store/tag-repo.ts                      -- Tag associations
  store/job-repo.ts                      -- Job tracking
      |
      v
Phase 3: ComfyUI Integration (independent of store, but builds here)
  engine/comfyui-client.ts               -- HTTP client, WebSocket, output download
  types/comfyui.ts                       -- API types
      |
      v
Phase 4: Core Engine (depends on store + ComfyUI client)
  engine/pipeline.ts                     -- Hierarchy + versioning + generation
  engine/provenance.ts                   -- Diff, reproduce, lineage queries
      |
      v
Phase 5: MCP Surface (depends on engine)
  tools/*.ts                             -- All MCP tool registrations
  server.ts                              -- McpServer init, transport setup
      |
      v
Phase 6: Web Visibility (depends on engine, independent of MCP)
  web/routes.ts                          -- Hono REST + SSE
  dashboard/*                            -- Static build
      |
      v
Phase 7: Adapter Layer (depends on engine + tool schemas)
  adapter/function-calling.ts            -- OpenAI format translator
  adapter/http-api.ts                    -- HTTP endpoint for non-MCP agents
```

**Key insight:** The engine layer is the center of gravity. Everything else -- MCP tools, web UI, function-calling adapter -- is a thin interface over the engine. Build the engine right, and the interfaces are straightforward.

## Sources

- [ComfyUI Cloud API Overview](https://docs.comfy.org/development/cloud/overview) -- Official API documentation, job lifecycle, endpoints
- [MCP TypeScript SDK Server Docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) -- McpServer, tool/resource/prompt registration, transports
- [Why MCP Deprecated SSE for Streamable HTTP](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/) -- Transport evolution rationale
- [ComfyUI PNG Metadata: Two JSON Blobs](https://www.numonic.ai/blog/ai-dam-comfyui-two-json-blobs) -- Workflow vs. prompt JSON structure, provenance gaps
- [VFX Database Design](https://vfxpiper.blogspot.com/2018/05/vfx-database-design.html) -- VFX hierarchy data model (Project/Sequence/Shot/Version)
- [CG Pipeline File Hierarchy Proposal](https://medium.com/cgwire/cg-pipeline-a-proposal-for-your-file-hierarchy-7825a163de1e) -- Standard VFX directory structure
- [MCP-Bridge: OpenAI to MCP Translation](https://github.com/SecretiveShell/MCP-Bridge) -- Function-calling adapter architecture pattern
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- Synchronous SQLite driver for Node.js, WAL mode
- [Hono Streaming Helper](https://hono.dev/docs/helpers/streaming) -- SSE support in Hono framework
- [MCP Transport Comparison](https://mcpcat.io/guides/comparing-stdio-sse-streamablehttp/) -- stdio vs. Streamable HTTP trade-offs

---
*Architecture research for: VFX Pipeline MCP Server (VFX Familiar)*
*Researched: 2026-04-15*
