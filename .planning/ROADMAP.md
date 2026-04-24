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
- [ ] **Phase 6: Dashboard Wire Quality** - [GAP CLOSURE] Phase 5 tech debt — WR-01/04/05 wire fixes + IN-01/02/04 robustness
- [ ] **Phase 7: ComfyUI Endpoint Reconciliation** - [GAP CLOSURE] Resolve COMFYUI_API_BASE 401/404 drift; live-smoke green
- [ ] **Phase 8: Documentation Attribution Backfill** - [GAP CLOSURE] Attribute HIER-06 + TOOL-02..05 in 01-02-SUMMARY; override + SDK caveat notes
- [ ] **Phase 9: Nyquist Wave 0 Closure** - [GAP CLOSURE] Retrofit VALIDATION.md Wave 0 for phases 01, 02, 03, 05

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
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Foundation (migration, schema, helpers, VersionRepo, fakes) [BLOCKING schema push]
- [x] 02-02-PLAN.md — ComfyUI client + engine generation (state machine, recovery poller, SSRF gate)
- [x] 02-03-PLAN.md — Generation MCP tool + server wiring + cross-cutting tests + live-smoke

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
- [x] 03-01: Provenance foundations — schema, pure engine modules, append-only repo
- [x] 03-02: Wire ProvenanceWriter into lifecycle + reproduce/iterate + Engine facade
- [x] 03-03: MCP tool surface — `version` tool + generation tool reproduce/iterate actions + live-smoke

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
**Plans**: 5 plans

Plans:
- [x] 04-01-PLAN.md — Schema migration 0004 + sqliteTable declarations + shape.ts bounds + types/assets.ts + id/error extensions [BLOCKING schema push covered in Plan 04]
- [x] 04-02-PLAN.md — TagRepo + MetadataRepo (idempotent insert/upsert, scope aggregation, json_group_array hydration)
- [x] 04-03-PLAN.md — AssetsEngine (7 actions + hydrateVersionWithAssets) + Engine facade constructor extended with db
- [x] 04-04-PLAN.md — asset MCP tool (7-action discriminated union) + wire-up + cross-cutting tests + [BLOCKING] schema-push verification
- [x] 04-05-PLAN.md — version-tool extension (inline tags/metadata on get, include flags on list) + 7 fixture helpers

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
**Plans**: 13 plans (12 original + 1 gap closure)
**UI hint**: yes

Plans:
- [x] 05-01-PLAN.md — Monorepo scaffold + dashboard config + Wave 0 test infra + OUTPUT_UNAVAILABLE error code
- [x] 05-02-PLAN.md — EngineEmitter + output-downloader + pipeline event wiring
- [x] 05-03-PLAN.md — HTTP error middleware (typedErrorHandler + statusForCode)
- [x] 05-04-PLAN.md — 18 REST dashboard routes + src/http/index.ts barrel
- [x] 05-05-PLAN.md — SSE handler (createSseHandler: 5 event types, keep-alive, origin check, cleanup)
- [x] 05-06-PLAN.md — Static asset handler + server.ts mount order (SSE → API → static)
- [x] 05-07-PLAN.md — Architecture purity tests (HTTP layer + dashboard boundary + tool budget)
- [x] 05-08-PLAN.md — Dashboard data layer (api.ts fetch wrappers + events.ts SSE client + signals)
- [x] 05-09-PLAN.md — Design system (theme.css Tailwind v4 + 7 primitive components)
- [x] 05-10-PLAN.md — Views (HomeView, VersionDrawer, DiffDrawer, ActiveGenerationsPanel) + App + Vite build
- [x] 05-11-PLAN.md — Cross-cutting dashboard tests (theme persistence + SSE→signal integration)
- [x] 05-12-PLAN.md — Build dist, commit, CI freshness gate, live smoke script
- [x] 05-13-PLAN.md — **[GAP CLOSURE]** SSE wire-shape adapter + seam test (closes CR-01, unblocks WEBUI-03)

### Phase 6: Dashboard Wire Quality
**Goal**: Close the six Phase 5 wire-quality tech debt items from the v1.0 audit so every dashboard surface the audit flagged behaves correctly end-to-end — accurate recent versions, configurable output root, typed error propagation, safe query parsing, spec-correct SSE keep-alive, and exhaustive status normalization
**Depends on**: Phase 5
**Requirements**: None (gap closure — all v1.0 requirements remain satisfied; closes deferred tech debt)
**Gap Closure**: Closes audit tech debt items WR-01, WR-04, WR-05, IN-01, IN-02, IN-04 from `.planning/v1.0-MILESTONE-AUDIT.md`
**Success Criteria** (what must be TRUE):
  1. `pipeline.getDashboardHome()` returns actual recent versions from the DB (query + limit), not the hardcoded `[]` at `pipeline.ts:676`
  2. The output-streaming route at `dashboard-routes.ts:227` uses the configured `outputRoot` (resolvable from any CWD), not the hardcoded `'outputs'` literal
  3. Dashboard `lib/api.ts fetchJson` preserves typed error bodies so codes like `VERSION_NOT_FOUND` and `OUTPUT_UNAVAILABLE` surface in the UI
  4. `qNum` parser rejects negatives and non-integer floats at the HTTP boundary with a typed error (no silent SQLite clamping)
  5. SSE keep-alive frame is emitted as a proper comment (`: ping\n\n`, no `data:` prefix); existing connection tests still pass
  6. `lib/shape.ts normalizeStatus` exhaustively handles the status union (no unknown→queued silent fallback) and regressions are caught by tests
**Plans**: 7 plans

Plans:
- [x] 06-01-PLAN.md — Wave 0 test scaffolds for SC-3 (api-error.test.ts) and SC-6 (shape.test.ts)
- [x] 06-02-PLAN.md — SC-1: VersionRepo.listRecentCompleted + Engine.getDashboardHome wiring (closes WR-04)
- [x] 06-03-PLAN.md — SC-2: Engine.outputRoot widened + path.resolve in dashboard output route (closes WR-01)
- [x] 06-04-PLAN.md — SC-3: DashboardApiError class + fetchJson rewrite (closes WR-05)
- [x] 06-05-PLAN.md — SC-4: qNum strict validation throws INVALID_INPUT (closes IN-01)
- [x] 06-06-PLAN.md — SC-5: SSE keep-alive uses raw stream.write for true comment frame (closes IN-02)
- [x] 06-07-PLAN.md — SC-6: normalizeStatus exhaustive switch + never-default arm (closes IN-04)

### Phase 7: ComfyUI Endpoint Reconciliation
**Goal**: Reconcile the COMFYUI_API_BASE endpoint drift so live-smoke authenticates and returns 200 across stdio + HTTP transports, closing the Phase 2 infrastructure tech debt captured in project memory
**Depends on**: Phase 2
**Requirements**: None (gap closure — GEN-01..07 remain satisfied by FakeEngine unit tests; closes live-runtime infra)
**Gap Closure**: Closes audit tech debt: "Phase 02 — ComfyUI Cloud API endpoint drift (.env COMFYUI_API_BASE reconciliation needed, both cloud.comfy.org and api.comfy.org fail live-smoke with 401/404)"
**Success Criteria** (what must be TRUE):
  1. `.env COMFYUI_API_BASE` points at a single endpoint that returns 200 for authenticated requests (documented rationale + credential source-of-truth)
  2. Live-smoke script exercises `generation.submit` + `generation.status` round-trip against the live endpoint and returns a completed job
  3. The endpoint decision, credential layout, and fallback-if-redirected behavior are documented in `02-VERIFICATION.md` (or a successor note) so the resolution survives future rotations
**Plans**: 8 plans

Plans:
- [x] 07-01-PLAN.md — Scaffold scripts/probe-comfy-endpoint.mts (read-only matrix probe + exit-code matrix)
- [x] 07-02-PLAN.md — Lock DEFAULT_COMFYUI_API_BASE + export HEALTHCHECK_PATH + wire ensureEndpointHealthy() + add COMFYUI_ENDPOINT_DRIFT
- [x] 07-03-PLAN.md — Update .env and .env.example with locked base + rotation comment (cross-file consistency check)
- [ ] 07-04-PLAN.md — Add 4 unit tests for ensureEndpointHealthy (cache-hit, drift-throws, race-safe, failure-retry)
- [ ] 07-05-PLAN.md — Create src/comfyui/__tests__/endpoint-probe.test.ts sentinel (RUN_PROBE gate)
- [ ] 07-06-PLAN.md — Run live-smoke twice; regression gate (stdio-hygiene + tool-budget + architecture-purity + transport-parity)
- [ ] 07-07-PLAN.md — Write 07-VERIFICATION.md (4 sections) + append supplement to 02-VERIFICATION.md
- [ ] 07-08-PLAN.md — Memory hygiene: remove/resolve drift memory; update reference + MEMORY.md index

### Phase 8: Documentation Attribution Backfill
**Goal**: Close the three Phase 1 documentation-only tech debt items so plan-level attribution matches what the Phase 1 VERIFICATION already verified, the inspector UI smoke override is visible in writeup, and the Zod inputSchema envelope caveat is findable
**Depends on**: Phase 1
**Requirements**: None (docs-only — HIER-06 and TOOL-02..05 are already verified satisfied; this closes the attribution gap)
**Gap Closure**: Closes audit tech debt: (a) five requirements (HIER-06, TOOL-02..05) verified in `01-VERIFICATION.md` but not in `01-02-SUMMARY.md` frontmatter; (b) inspector UI UX smoke override notation; (c) Zod `inputSchema` error envelope MCP SDK 1.29 intercept caveat
**Success Criteria** (what must be TRUE):
  1. `01-02-SUMMARY.md` frontmatter `requirements-completed` lists HIER-06, TOOL-02, TOOL-03, TOOL-04, TOOL-05 (matching what the VERIFICATION row already attributes to plan 01-02)
  2. `01-VERIFICATION.md` (or a linked note) records the inspector UI UX smoke override decision — programmatic `scripts/inspector-smoke.mjs` (56/56 wire-level checks) replaces manual browser UX check
  3. A Phase 2+ follow-up note captures the Zod `inputSchema` → `structuredContent.code` intercept behavior (MCP SDK 1.29) so the divergence is easy to find later
**Plans**: TBD

### Phase 9: Nyquist Wave 0 Closure
**Goal**: Retrofit Wave 0 Nyquist validation for phases 01, 02, 03, and 05 so `VALIDATION.md` reports `nyquist_compliant: true` + `wave_0_complete: true` across every v1.0 phase (Phase 04 already compliant)
**Depends on**: Phases 1, 2, 3, 5
**Requirements**: None (audit meta — validation retrofit, not new feature work)
**Gap Closure**: Closes the audit's "partial Nyquist" status for phases 01, 02, 03, 05 — each has a draft `VALIDATION.md` but did not close Wave 0
**Success Criteria** (what must be TRUE):
  1. Phase 01 `VALIDATION.md` reports `status: closed`, `nyquist_compliant: true`, `wave_0_complete: true` after running `/gsd-validate-phase 01`
  2. Phase 02 `VALIDATION.md` reports same three flags true after `/gsd-validate-phase 02`
  3. Phase 03 `VALIDATION.md` reports same three flags true after `/gsd-validate-phase 03` (phase already flags `nyquist_compliant: true`; only `wave_0_complete` needs closure)
  4. Phase 05 `VALIDATION.md` reports same three flags true after `/gsd-validate-phase 05`
  5. The audit frontmatter overall Nyquist status changes from `partial` to `compliant` on re-audit
**Plans**: TBD

## Future (v2)

The following are tracked in REQUIREMENTS.md v2 section and not part of the current execution roadmap:

- **Multi-Backend Routing** (ROUTE-01, ROUTE-02, ROUTE-03): Route generation to specific ComfyUI instances by capability with failover
- **Function-Calling Adapter** (ADAPT-01, ADAPT-02, ADAPT-03): OpenAI-compatible REST endpoint for non-MCP agents
- **Advanced Operations** (ADV-01, ADV-02, ADV-03, ADV-04): Batch queuing, webhooks, hierarchy export, lineage visualization

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9

Phases 6-9 were added 2026-04-23 as gap closure phases from `v1.0-MILESTONE-AUDIT.md` (audit Recommendation §B). All v1.0 functional requirements remain satisfied; these phases close deferred tech debt and Nyquist validation retrofits before archival.

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Foundation & Hierarchy | 3/3 | Complete | 2026-04-20 |
| 2. ComfyUI Generation | 3/3 | Complete | 2026-04-21 |
| 3. Provenance & Versioning | 3/3 | Complete | 2026-04-22 |
| 4. Asset Management | 5/5 | Complete | 2026-04-22 |
| 5. Web Dashboard | 13/13 | Complete | 2026-04-23 |
| 6. Dashboard Wire Quality | 0/7 | Planned (gap closure) | - |
| 7. ComfyUI Endpoint Reconciliation | 0/? | Planned (gap closure) | - |
| 8. Documentation Attribution Backfill | 0/? | Planned (gap closure) | - |
| 9. Nyquist Wave 0 Closure | 0/? | Planned (gap closure, optional) | - |
