# VFX Familiar

## What This Is

An open-source MCP server that layers VFX production structure (project/sequence/shot/version, full provenance, asset management) over ComfyUI Cloud's API — making any MCP-compatible AI agent into an intelligent VFX pipeline manager. Ships with a light web UI for project hierarchy and provenance visibility. v1.0 MVP shipped 2026-04-28.

## Core Value

A VFX artist tells their AI familiar what they need in natural language, and it manages the entire production pipeline — routing, versioning, provenance, organization — so they never touch a folder structure or lose track of what generated what.

## Current State

**Shipped:** v1.0 MVP (2026-04-28) — 9 phases, 46 plans, ~25.5k LOC TypeScript (22,613 server + 2,930 dashboard), 760/763 test baseline, single-binary dual-transport (stdio + Streamable HTTP) MCP server with Preact dashboard. Six MCP tools (workspace, project, sequence, shot, generation, version) plus the asset tool, all under the 12-tool cap.

**Live API:** ComfyUI Cloud locked at `https://cloud.comfy.org` with healthcheck path `/api/system_stats`; live-smoke verified 2/2 green back-to-back via Phase 7.

## Requirements

### Validated

- ✓ Project hierarchy: workspace → project → sequence → shot → version — v1.0 (Phase 1: 76 unit tests + 56 live-client smoke checks; dual-transport parity locked)
- ✓ MCP server wraps ComfyUI Cloud API as structured tools (submit, status) with async non-blocking generation and exponential-backoff polling — v1.0 (Phase 2: GEN-01..07; SSRF-safe redirect gate; Phase 7 endpoint reconciliation made live-smoke green)
- ✓ Automatic versioning on every generation (never overwrites) — v1.0 (Phase 2: VersionRepo MAX(version_number)+1 + append-only markCompleted guard)
- ✓ Full provenance capture: workflow JSON, prompt JSON, seed, model names (checksums nullable), timestamp — v1.0 (Phase 3: PROV-01..06; append-only ProvenanceRepo + two-event submit/terminal model)
- ✓ Diff between versions — v1.0 (Phase 3: pure diffVersions returning structured {summary, changes:{params, models, seed, workflow, metadata}})
- ✓ Reproduce any version exactly — v1.0 (Phase 3: engine.reproduceVersion re-submits stored prompt_json verbatim with lineage_type='reproduce')
- ✓ Iterate from a version with specified changes — v1.0 (Phase 3: node-scoped overrides with FORBIDDEN_KEYS prototype-pollution guard + optional seed shortcut; lineage_type='iterate' + parent_version_id)
- ✓ Asset tagging and arbitrary metadata attachment — v1.0 (Phase 4: idempotent TagRepo/MetadataRepo; asset MCP tool with 7-action Zod discriminated union)
- ✓ Asset query/filter by tags, metadata, project hierarchy, date range — v1.0 (Phase 4: AND-only SQL filters with json_each tag membership, scope XOR, inclusive date range, paginated with total_count)
- ✓ Light web UI showing project hierarchy, provenance trail, and live generation status — v1.0 (Phase 5: 13 plans, Preact + Tailwind v4 + signals; SSE wire-shape adapter at Plan 05-13 unblocked WEBUI-03; Phase 6 closed wire-quality tech debt)
- ✓ Coarse-grained MCP tool design at or below 12-tool cap with structured envelope + actionable errors — v1.0 (TOOL-01..05 enforced by architecture-purity tests across all phases)

### Active

- [ ] Multi-backend routing (multiple ComfyUI instances by capability) — ROUTE-01..03 in v1.0 archive
- [ ] Function-calling adapter for non-MCP agents (OpenAI-compatible REST) — ADAPT-01..03 in v1.0 archive
- [ ] Demo video: full loop from natural language → structured VFX output at scale (still pending after v1.0)
- [ ] **C2PA provenance verification** (v1.1 candidate, SEED-001): signed manifests, model fingerprinting, ingredient graph, sidecar emission, redaction action, MCP `version.export_manifest` / `version.verify_manifest`. Driven by EU AI Act Art. 50 (effective Aug 2026) + California SB 942 (in effect Jan 2026). PROV-V-01..07 in v1.0-REQUIREMENTS.md archive. **Closes the `extractModels()` `model_hash: null` gap at `src/engine/provenance.ts:69`.**

### Out of Scope

- Local ComfyUI installation management — targeting Cloud API, not local venvs (validated by Phase 2/7 — Cloud is the ship target)
- Custom node development — we wrap existing ComfyUI functionality
- ShotGrid/Ftrack integration — v2+ opportunity
- Real-time collaboration — single-user pipeline management first
- Workflow authoring UI — users bring their own ComfyUI workflows
- AI-powered scheduling/optimization — adds complexity without demo value
- Review/approval workflow — production feature, not pipeline management
- Multi-user authentication — single-artist demo scope

## Context

**Industry Pain (from VFX conversations):**
- Studios can't adopt ComfyUI at scale (50-1000+ shots) due to asset management chaos
- They need Project → Sequence → Shot hierarchy with version control
- Full provenance is non-negotiable: workflow, params, seed, model version (checksummed), artist, machine, timestamp
- Doug Hogan (VFX industry): "We don't just care about the final image, we care about exactly HOW it was made"
- ComfyUI already embeds workflow in PNG metadata — we extend with project/shot/version context
- This pain point surfaces in every studio conversation — high-value, immediate need

**Technical Context (post-v1.0):**
- ComfyUI Cloud API base locked at `https://cloud.comfy.org`; healthcheck `/api/system_stats`; jobs at `/api/jobs` (Phase 7 D-EP-17)
- MCP SDK 1.29 — Zod inputSchema → structuredContent.code intercept caveat documented in 02-VERIFICATION.md (Phase 8)
- TypeScript MCP server avoids Python dependency conflicts with ComfyUI's environment
- SQLite WAL + busy_timeout=5000 + Drizzle ORM; 4 migrations (0001-0004); state lives at `~/.config/vfx-familiar/db.sqlite` by default
- Preact + Tailwind v4 dashboard, ~38.55 kB JS + 21.70 kB CSS
- Test baseline: 760/763 passing as of Phase 9 (3 pre-existing timing flakes; see Phase 4-5 SUMMARY notes)
- Cross-cutting regression guards: `architecture-purity.test.ts`, `phase-attribution.test.ts` (Phase 8), `validation-flags.test.ts` (Phase 9)

**Positioning:**
- Internal product feature proposal at ComfyUI org
- Demo targets the whole org (engineers + product + leadership)
- Open-source — community can extend, not locked to any AI provider
- The "VFX Familiar" brand: your AI assistant that knows your pipeline

## Constraints

- **API Target**: ComfyUI Cloud API (not local installs) — this is what the company ships
- **Language**: TypeScript — clean MCP SDK support, no Python conflicts, team familiarity
- **Demo Quality**: Must be taken seriously by the whole org — no hacky MVP vibes
- **Open Protocol**: MCP-native, with function-calling adapter — zero vendor lock-in
- **Portable Store**: SQLite — no external database dependency for the demo
- **Tool Cap**: 12 MCP tools max — coarse-grained `action` parameters; enforced at test layer

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | Avoids ComfyUI venv conflicts; better MCP SDK | ✓ Good — zero Python conflicts shipped |
| ComfyUI Cloud API (not local) | We work here; demo what we ship | ✓ Good — locked endpoint via Phase 7 |
| SQLite project store | Portable, serverless, embeddable | ✓ Good — WAL + busy_timeout=5000 production-ready |
| MCP as primary protocol | Open standard, multi-agent compatible | ✓ Good — works on Claude Desktop + Inspector |
| "VFX Familiar" branding | Resonant name for the AI pipeline assistant concept | ✓ Good |
| Light web UI included | Whole-org audience needs visual proof, not just CLI | ✓ Good — Preact + signals shipped under 60kB |
| GSD + Gstack harness | GSD parents lifecycle, Gstack gates quality at milestones | ✓ Good — 9 phases, 46 plans, full audit pipeline |
| Coarse-grained tool design (action params) | Stay under 12-tool cap; agent UX cleaner | ✓ Good — 6 of 12 cap consumed at v1.0 |
| Append-only provenance | Immutability is the core differentiator | ✓ Good — structurally enforced (4 public methods, no UPDATE/DELETE) |
| Dual-transport (stdio + Streamable HTTP) one process | Single binary; transport parity by construction | ✓ Good — buildServer factory; integration tests lock parity |
| Drizzle ORM + hand-authored migrations | Schema diff visibility + readable SQL | ✓ Good — 0003/0004 hand-prefixed; roundtrip parity confirmed |
| Inspector UI smoke replaced by programmatic MCP SDK client | UAT had to be wire-level, not vibe-level | ✓ Good — `scripts/inspector-smoke.mjs` 56/56 wire checks (memory: don't punt on tests) |
| Plan 05-13 SSE wire-shape adapter | Engine event vs render contract drift was a class of bug | ✓ Good — pure adapter at serialization boundary, locked WEBUI-03 |
| 4 gap-closure phases (06-09) before close | Audit-driven, not feature-driven; honest milestone | ✓ Good — re-audit flipped from `tech_debt` to `passed` |
| C2PA capability planted as v1.1 (SEED-001) | Regulatory deadlines (EU AI Act Aug 2026) make this load-bearing | — Pending v1.1 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-28 after v1.0 MVP milestone close — All 9 phases shipped (5 functional + 4 gap closure), 38/38 v1 requirements validated, audit re-audit flipped from `tech_debt` to `passed`. Next milestone candidate: v1.1 Provenance Verification (C2PA, SEED-001) — driven by EU AI Act Art. 50 + California SB 942.*
