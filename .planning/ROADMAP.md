# Roadmap: VFX Familiar

## Overview

VFX Familiar delivers an MCP server that brings production VFX pipeline structure to AI-powered generative content via ComfyUI Cloud. The roadmap progresses from a working server with hierarchy management, through live ComfyUI generation, provenance capture (the core differentiator), asset management, and finally a visual dashboard for the demo audience. Each phase delivers a complete, independently verifiable capability that builds on the previous.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Hierarchy** - Dual-transport MCP server with VFX hierarchy tools and SQLite store
- [ ] **Phase 2: ComfyUI Generation** - Async generation client with format validation, backoff, and auto-versioning
- [ ] **Phase 3: Provenance & Versioning** - Append-only provenance capture with diff, reproduce, and iterate-from-version
- [ ] **Phase 4: Asset Management** - Tagging, metadata, paginated search/filter across hierarchy
- [ ] **Phase 5: Web Dashboard** - Preact UI with hierarchy browser, version timeline, and live generation status

## Phase Details

### Phase 1: Foundation & Hierarchy
**Goal**: An MCP-compatible agent can connect to the server and create/navigate a full VFX project hierarchy (workspace > project > sequence > shot) with proper naming conventions
**Depends on**: Nothing (first phase)
**Requirements**: TRNS-01, TRNS-02, TRNS-03, TRNS-04, HIER-01, HIER-02, HIER-03, HIER-04, HIER-05, HIER-06, TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05
**Success Criteria** (what must be TRUE):
  1. An MCP client can connect via stdio and discover available tools
  2. An MCP client can connect via Streamable HTTP and discover the same tools
  3. Agent can create a workspace, then project, sequence, and shot within it, and navigate back up with breadcrumbs
  4. Shots follow VFX naming convention with zero-padded version numbers and underscore separators
  5. Server starts with zero configuration -- no env vars, no config file, SQLite auto-created on first run
**Plans**: TBD

Plans:
- [x] 01-01: Foundation types + SQLite store + Engine facade
- [x] 01-02: MCP tool surface (workspace, project, sequence, shot)
- [x] 01-03: Dual-transport MCP server bootstrap + cross-cutting invariant tests

### Phase 2: ComfyUI Generation
**Goal**: An agent can submit ComfyUI workflows for generation within a shot context and track them through completion or failure, with completed jobs automatically creating new versions
**Depends on**: Phase 1
**Requirements**: GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, GEN-06, GEN-07
**Success Criteria** (what must be TRUE):
  1. Agent can submit a workflow to a specific shot and gets back a job ID immediately (non-blocking)
  2. Agent can check job status and sees it progress through submitted/running/completed/failed states
  3. Completed generation automatically creates a new version under the shot (never overwrites previous versions)
  4. Submitting UI-format JSON (instead of API format) returns a clear rejection error explaining the difference
  5. Internal polling uses exponential backoff -- no quota burn visible in request logs
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Provenance & Versioning
**Goal**: Every generated version has complete, immutable provenance that an agent can diff, reproduce exactly, or iterate from with modifications
**Depends on**: Phase 2
**Requirements**: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06
**Success Criteria** (what must be TRUE):
  1. Every version record contains workflow JSON, prompt JSON, seed, timestamp, and model names (checksums nullable)
  2. Provenance records are immutable -- no UPDATE or DELETE operations exist in the provenance path
  3. Agent can diff two versions and see a structured comparison of exactly what changed (params, seed, models)
  4. Agent can reproduce any version by re-submitting its stored prompt blob, creating a new version with lineage link
  5. Agent can iterate from a version by loading its params, applying specified changes, and submitting as a new generation with parent lineage tracked
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Asset Management
**Goal**: An agent can organize and find versions across the entire hierarchy using tags, metadata, and filtered search with pagination
**Depends on**: Phase 3
**Requirements**: ASST-01, ASST-02, ASST-03, ASST-04, ASST-05
**Success Criteria** (what must be TRUE):
  1. Agent can add and remove tags on any version, and tags appear in version detail responses
  2. Agent can attach arbitrary key-value metadata to versions and retrieve it
  3. Agent can search/filter versions by any combination of tags, metadata keys, hierarchy level, and date range
  4. Search results are paginated with a default page size of 20 and include total count for UI rendering
  5. Every query response includes the full hierarchy breadcrumb (workspace > project > sequence > shot) for context
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Web Dashboard
**Goal**: A non-technical viewer (or the demo audience) can open a browser and see the project hierarchy, version history with provenance details, and live generation progress -- no CLI required
**Depends on**: Phase 4
**Requirements**: WEBUI-01, WEBUI-02, WEBUI-03, WEBUI-04, WEBUI-05
**Success Criteria** (what must be TRUE):
  1. Opening the server URL in a browser shows a project hierarchy that can be browsed from workspace down to shot level
  2. Clicking a shot shows a version timeline with drill-down into provenance details for any version
  3. Active generations show live progress updates via SSE without manual refresh
  4. Dashboard is served as a pre-built static bundle from the same Hono server process -- no separate dev server
  5. Viewer can see the dashboard immediately after server start with no build step required
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

## Future (v2)

The following are tracked in REQUIREMENTS.md v2 section and not part of the current execution roadmap:

- **Multi-Backend Routing** (ROUTE-01, ROUTE-02, ROUTE-03): Route generation to specific ComfyUI instances by capability with failover
- **Function-Calling Adapter** (ADAPT-01, ADAPT-02, ADAPT-03): OpenAI-compatible REST endpoint for non-MCP agents
- **Advanced Operations** (ADV-01, ADV-02, ADV-03, ADV-04): Batch queuing, webhooks, hierarchy export, lineage visualization

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Foundation & Hierarchy | 2/3 | In progress | - |
| 2. ComfyUI Generation | 0/2 | Not started | - |
| 3. Provenance & Versioning | 0/2 | Not started | - |
| 4. Asset Management | 0/2 | Not started | - |
| 5. Web Dashboard | 0/2 | Not started | - |
