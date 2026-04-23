# Requirements: VFX Familiar

**Defined:** 2026-04-15
**Core Value:** A VFX artist tells their AI familiar what they need in natural language, and it manages the entire production pipeline — routing, versioning, provenance, organization — so they never touch a folder structure or lose track of what generated what.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Transport & Server

- [x] **TRNS-01
**: MCP server exposes tools via stdio transport for Claude Desktop/CLI
- [x] **TRNS-02
**: MCP server exposes tools via Streamable HTTP transport for web agents
- [x] **TRNS-03
**: Both transports run in a single process
- [x] **TRNS-04
**: Server starts with zero configuration (sensible defaults, SQLite auto-created)

### Hierarchy

- [x] **HIER-01
**: User can create/list/get workspaces
- [x] **HIER-02
**: User can create/list/get projects within a workspace
- [x] **HIER-03
**: User can create/list/get sequences within a project
- [x] **HIER-04
**: User can create/list/get shots within a sequence
- [x] **HIER-05
**: Shots follow VFX naming convention (configurable template, default: zero-padded `v001`, underscore separators)
- [x] **HIER-06
**: Hierarchy supports arbitrary depth navigation (breadcrumb context in responses)

### Generation

- [ ] **GEN-01**: Agent can submit a ComfyUI workflow for generation within a shot context
- [ ] **GEN-02**: Submission returns immediately with a job ID (non-blocking)
- [ ] **GEN-03**: Agent can check generation status by job ID
- [ ] **GEN-04**: Completed generations automatically create a new version (never overwrites)
- [ ] **GEN-05**: Failed generations record error state with ComfyUI error message
- [ ] **GEN-06**: ComfyUI Cloud API client validates format (rejects UI-export JSON with clear error)
- [ ] **GEN-07**: Client uses exponential backoff for internal polling (no quota burn)

### Provenance

- [x] **PROV-01
**: Every version captures full provenance: workflow JSON, prompt JSON, seed, timestamp
- [x] **PROV-02
**: Provenance captures model names (checksums best-effort, nullable on Cloud)
- [x] **PROV-03
**: Provenance records are append-only (immutable once written)
- [x] **PROV-04
**: Agent can diff two versions (structured comparison of what changed)
- [x] **PROV-05
**: Agent can reproduce any version exactly (re-submit stored prompt blob)
- [x] **PROV-06
**: Agent can iterate from a version (load params + apply specified changes, track lineage)

### Assets & Query

- [x] **ASST-01
**: Agent can add/remove tags on any version
- [x] **ASST-02
**: Agent can attach arbitrary key-value metadata to versions
- [x] **ASST-03
**: Agent can search/filter versions by tags, metadata, hierarchy, date range
- [x] **ASST-04
**: Search results are paginated (default 20, with total count)
- [x] **ASST-05
**: Query responses include hierarchy breadcrumb (workspace > project > sequence > shot)

### Web UI

- [ ] **WEBUI-01**: Light web dashboard shows project hierarchy browser
- [ ] **WEBUI-02**: Dashboard shows version timeline with provenance detail drill-down
- [ ] **WEBUI-03**: Dashboard shows live generation status via SSE
- [ ] **WEBUI-04**: Dashboard is served as static build from the same Hono server
- [ ] **WEBUI-05**: No separate build step required to view dashboard (pre-built in dist)

### MCP Tool Design

- [x] **TOOL-01
**: Total MCP tool count stays at or below 12
- [x] **TOOL-02
**: Tools use coarse-grained design with `action` parameters where appropriate
- [x] **TOOL-03
**: All tool inputs validated via Zod schemas
- [x] **TOOL-04
**: Tool responses include structured data (not raw JSON dumps)
- [x] **TOOL-05
**: Error responses are human-readable with actionable guidance

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multi-Backend Routing

- **ROUTE-01**: Route generation to specific ComfyUI instances by capability
- **ROUTE-02**: Automatic fallback when preferred backend is busy/down
- **ROUTE-03**: Backend health monitoring with status reporting

### Function-Calling Adapter

- **ADAPT-01**: Expose MCP tools as OpenAI-compatible function definitions via REST
- **ADAPT-02**: `GET /v1/tools` returns JSON schema for all available tools
- **ADAPT-03**: `POST /v1/tools/call` invokes any tool with standard request/response

### Advanced Operations

- **ADV-01**: Batch shot queuing (generate across multiple shots in one call)
- **ADV-02**: Webhook notifications on generation completion/failure
- **ADV-03**: Hierarchy export in standard VFX formats
- **ADV-04**: Lineage graph visualization in web UI

### Provenance Verification (C2PA)

Target for v1.1 milestone. Thesis: v1.0 captures private provenance; v1.1 makes it signed, portable, and regulator-verifiable. Driven by EU AI Act Article 50 (effective Aug 2026), California SB 942 (effective Jan 2026 — already in effect at planting), and the industry gap analysis captured in SEED-001 (Matt Collie, "C2PA Content Provenance for VFX", 2026).

- **PROV-V-01**: Emit a signed C2PA manifest embedded in supported ComfyUI output formats (PNG, JPEG, MP4, WebP) at download time
- **PROV-V-02**: Explicit AI disclosure — `c2pa.created` action assertion with ComfyUI as the generator tool, surfaced in machine-readable form for regulatory scanning
- **PROV-V-03**: Model fingerprinting — SHA-256 hash for every checkpoint/LoRA/VAE referenced in the prompt blob (closes the `extractModels()` `model_hash: null` gap at `src/engine/provenance.ts:69`)
- **PROV-V-04**: Ingredient graph — emit `parentOf` (reproduce/iterate lineage), `componentOf` (prompt-referenced control images, reference images, input images from non-loader nodes), and `inputTo` (prompt text + params) assertions
- **PROV-V-05**: Sidecar `.c2pa` manifest emission for output formats not on C2PA's native-embed list (OpenEXR et al.), per the spec's sidecar mechanism
- **PROV-V-06**: Redaction action — strip sensitive prompt/metadata values while writing a `c2pa.redacted` assertion that preserves the fact-of-redaction for auditability
- **PROV-V-07**: MCP `version.export_manifest` / `version.verify_manifest` actions — extend the existing `version` tool (stays under the 12-tool cap) for outbound signing + inbound verification with gap detection

## Out of Scope

| Feature | Reason |
|---------|--------|
| Local ComfyUI installation management | Targeting Cloud API, not local venvs |
| Custom node development | We wrap existing ComfyUI functionality |
| ShotGrid/Ftrack integration | v2+ opportunity, not v1 demo |
| Real-time collaboration | Single-user pipeline management first |
| Workflow authoring UI | Users bring their own ComfyUI workflows |
| AI-powered scheduling/optimization | Adds complexity without demo value |
| Review/approval workflow | Production feature, not pipeline management |
| Multi-user authentication | Single-artist demo scope |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TRNS-01 | Phase 1: Foundation & Hierarchy | Pending |
| TRNS-02 | Phase 1: Foundation & Hierarchy | Pending |
| TRNS-03 | Phase 1: Foundation & Hierarchy | Pending |
| TRNS-04 | Phase 1: Foundation & Hierarchy | Pending |
| HIER-01 | Phase 1: Foundation & Hierarchy | Pending |
| HIER-02 | Phase 1: Foundation & Hierarchy | Pending |
| HIER-03 | Phase 1: Foundation & Hierarchy | Pending |
| HIER-04 | Phase 1: Foundation & Hierarchy | Pending |
| HIER-05 | Phase 1: Foundation & Hierarchy | Pending |
| HIER-06 | Phase 1: Foundation & Hierarchy | Pending |
| TOOL-01 | Phase 1: Foundation & Hierarchy | Pending |
| TOOL-02 | Phase 1: Foundation & Hierarchy | Pending |
| TOOL-03 | Phase 1: Foundation & Hierarchy | Pending |
| TOOL-04 | Phase 1: Foundation & Hierarchy | Pending |
| TOOL-05 | Phase 1: Foundation & Hierarchy | Pending |
| GEN-01 | Phase 2: ComfyUI Generation | Pending |
| GEN-02 | Phase 2: ComfyUI Generation | Pending |
| GEN-03 | Phase 2: ComfyUI Generation | Pending |
| GEN-04 | Phase 2: ComfyUI Generation | Pending |
| GEN-05 | Phase 2: ComfyUI Generation | Pending |
| GEN-06 | Phase 2: ComfyUI Generation | Pending |
| GEN-07 | Phase 2: ComfyUI Generation | Pending |
| PROV-01 | Phase 3: Provenance & Versioning | Pending |
| PROV-02 | Phase 3: Provenance & Versioning | Pending |
| PROV-03 | Phase 3: Provenance & Versioning | Pending |
| PROV-04 | Phase 3: Provenance & Versioning | Pending |
| PROV-05 | Phase 3: Provenance & Versioning | Pending |
| PROV-06 | Phase 3: Provenance & Versioning | Pending |
| ASST-01 | Phase 4: Asset Management | Pending |
| ASST-02 | Phase 4: Asset Management | Pending |
| ASST-03 | Phase 4: Asset Management | Pending |
| ASST-04 | Phase 4: Asset Management | Pending |
| ASST-05 | Phase 4: Asset Management | Pending |
| WEBUI-01 | Phase 5: Web Dashboard | Pending |
| WEBUI-02 | Phase 5: Web Dashboard | Pending |
| WEBUI-03 | Phase 5: Web Dashboard | Pending |
| WEBUI-04 | Phase 5: Web Dashboard | Pending |
| WEBUI-05 | Phase 5: Web Dashboard | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0

---
*Requirements defined: 2026-04-15*
*Last updated: 2026-04-20 after roadmap creation (fixed count from 35 to 38, added phase names to traceability)*
