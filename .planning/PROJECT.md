# VFX Familiar

## What This Is

An open-source MCP server that layers VFX production structure (project/sequence/shot/version, full provenance, asset management) over ComfyUI Cloud's API — making any MCP-compatible AI agent into an intelligent VFX pipeline manager. Ships with a light web UI for project hierarchy and provenance visibility. Internal product feature proposal at ComfyUI, demonstrated via recorded video showing the full live generation pipeline.

## Core Value

A VFX artist tells their AI familiar what they need in natural language, and it manages the entire production pipeline — routing, versioning, provenance, organization — so they never touch a folder structure or lose track of what generated what.

## Requirements

### Validated

- [x] Project hierarchy: workspace → project → sequence → shot → version — *Validated in Phase 1: foundation-hierarchy (hierarchy + breadcrumbs live end-to-end over stdio + Streamable HTTP; 76 unit tests + 56 live-client smoke checks green)*
- [x] MCP server wraps ComfyUI Cloud API as structured tools (submit, status) with async non-blocking generation and exponential-backoff polling — *Validated in Phase 2: comfyui-generation (GEN-01..GEN-07, 188 tests + 1 gated live-smoke; tool budget 5/12; src/comfyui/** architecture-purity enforced)*
- [x] Automatic versioning on every generation (never overwrites) — *Validated in Phase 2 via VersionRepo MAX(version_number)+1 insert + append-only markCompleted guard*

### Active

- [ ] Full provenance capture: workflow JSON, parameters, seed, model checksums, timestamp, artist, machine — *Phase 2 captures workflow_json, prompt_json, job_id, status, outputs; PROV-* details land in Phase 3*
- [ ] Asset tagging and arbitrary metadata attachment
- [ ] Asset query/filter by tags, metadata, project hierarchy, date range
- [ ] Diff between versions ("what changed between v002 and v003?")
- [ ] Reproduce any version exactly (re-run with identical params)
- [ ] Iterate from a version (same params + specified changes)
- [ ] Multi-backend routing (multiple ComfyUI instances by capability)
- [ ] Function-calling adapter for non-Anthropic agents (open-source, not Claude-locked)
- [ ] Light web UI showing project hierarchy, provenance trail, and generation status
- [ ] Demo video: full loop from natural language → structured VFX output at scale

### Out of Scope

- Local ComfyUI installation management — targeting Cloud API, not local venvs
- Custom node development — we wrap existing ComfyUI functionality
- ShotGrid/Ftrack integration — v2 opportunity, not v1 demo
- Real-time collaboration features — single-user pipeline management first
- Workflow authoring — users bring their own ComfyUI workflows

## Context

**Industry Pain (from VFX conversations):**
- Studios can't adopt ComfyUI at scale (50-1000+ shots) due to asset management chaos
- They need Project → Sequence → Shot hierarchy with version control
- Full provenance is non-negotiable: workflow, params, seed, model version (checksummed), artist, machine, timestamp
- Doug Hogan (VFX industry): "We don't just care about the final image, we care about exactly HOW it was made"
- ComfyUI already embeds workflow in PNG metadata — we extend with project/shot/version context
- This pain point surfaces in every studio conversation — high-value, immediate need

**Technical Context:**
- ComfyUI Cloud API: https://docs.comfy.org/development/cloud/overview
- MCP is an open protocol — works with Claude, VS Code Copilot, Cursor, and any future MCP client
- TypeScript MCP server avoids Python dependency conflicts with ComfyUI's environment
- SQLite for project store (provenance, hierarchy, tags) — portable, no server dependency
- Timothy's Triad (Hermes/Meridian/Kallisti) used as development and demo rig

**Positioning:**
- Internal product feature proposal at ComfyUI org
- Demo targets the whole org (engineers + product + leadership)
- Open-source — community can extend, not locked to any AI provider
- The "VFX Familiar" brand: your AI assistant that knows your pipeline

## Constraints

- **API Target**: ComfyUI Cloud API (not local installs) — this is what the company ships
- **Language**: TypeScript — clean MCP SDK support, no Python conflicts, team familiarity
- **Timeline**: Days, not weeks — deliberate and deep, but fast execution
- **Demo Quality**: Must be taken seriously by the whole org — no hacky MVP vibes
- **Open Protocol**: MCP-native, with function-calling adapter — zero vendor lock-in
- **Portable Store**: SQLite — no external database dependency for the demo

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | Avoids ComfyUI venv conflicts; better MCP SDK | — Pending |
| ComfyUI Cloud API (not local) | We work here; demo what we ship | — Pending |
| SQLite project store | Portable, serverless, embeddable | — Pending |
| MCP as primary protocol | Open standard, multi-agent compatible | — Pending |
| "VFX Familiar" branding | Resonant name for the AI pipeline assistant concept | — Pending |
| Light web UI included | Whole-org audience needs visual proof, not just CLI | — Pending |
| GSD + Gstack harness | GSD parents lifecycle, Gstack gates quality at milestones | — Pending |

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
*Last updated: 2026-04-21 after Phase 2 completion (comfyui-generation)*
