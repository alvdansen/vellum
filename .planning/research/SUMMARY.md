# Project Research Summary

**Project:** VFX Familiar — MCP server layering VFX production structure over ComfyUI Cloud
**Domain:** AI-native VFX pipeline management (MCP server + async cloud generation API)
**Researched:** 2026-04-15
**Confidence:** HIGH

## Executive Summary

VFX Familiar occupies a genuinely novel niche: the first open-source MCP server that brings production VFX pipeline structure (workspace/project/sequence/shot/version) to AI-powered generative content. The closest competitor is Scenario's proprietary MCP server, which has 19 generation tools but no pipeline management. Traditional tools (ShotGrid, ftrack, AYON) manage human artists using DCCs — VFX Familiar manages AI agents using ComfyUI. These complement rather than compete.

The product's core value is provenance: capturing the full ComfyUI dual-blob (workflow + prompt) plus seed, model checksums, and timestamps, then making that provenance actionable via version diff, exact reproduction, and iteration-from-version. No existing tool does this.

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Single process, dual transport (stdio + Streamable HTTP) | Simplest deployment; MCP SDK supports both |
| 8-12 coarse-grained MCP tools max | Over 12 collapses agent accuracy below 14% |
| Zod v4 (not v3) | Native Standard Schema, `z.toJSONSchema()` eliminates deprecated `zod-to-json-schema` |
| Hono (not Express) | 14KB, Web Standards, proven `mcp-hono-stateless` pattern |
| `better-sqlite3` + Drizzle ORM | Synchronous, type-safe, WAL mode, migration tooling |
| Preact (not React) | 3KB, React-compatible, right-sized for 3-5 views |
| Prompt blob as source of truth | Contains resolved seeds and actual model paths (workflow blob has "randomize") |
| Append-only provenance records | Never overwrite; submitted/completed/failed are separate states |

## Critical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tool explosion destroys agent accuracy | Fatal — unusable by agents | Hard cap at 12 tools; action-parameterized design |
| ComfyUI API format confusion (UI vs API JSON) | Broken generation | Format detection + rejection with clear error in client |
| Provenance gaps (randomized seeds, string model names) | Core differentiator fails | Capture prompt blob (has resolved values); model hash nullable |
| Polling burns API quota | Rate limited during demo | Submit/check as separate tools; exponential backoff |
| SQLite BUSY during demo | Demo crashes | WAL mode + busy_timeout=5000 from init |
| ComfyUI Cloud API is "experimental" | Breaking changes | Abstraction layer; validate against live API before Phase 2 |

## Recommended Phase Structure

1. **Foundation** — Schema, transport, tool surface (all zero-day decisions)
2. **ComfyUI Integration** — Async generation client with gotchas handled
3. **Provenance and Versioning** — Core differentiator, append-only capture
4. **Asset Management** — Tagging, paginated search, hierarchy navigation
5. **Web UI** — Preact dashboard over stable engine REST + SSE
6. **Adapter and Extensions** — Function-calling adapter, batch ops, webhooks

## Research Flags

- **Phase 2:** ComfyUI Cloud API is "experimental." Validate endpoints against live API before writing client.
- **Phase 3:** Model hash availability unconfirmed on Cloud. Schema column must be nullable.
- **Phases 1, 5, 6:** Standard patterns with official examples — skip research-phase.

## Conflicts and Tensions

None identified. All four research documents are internally consistent. The stack validates the architecture; the pitfalls inform the phase ordering; the features define scope boundaries cleanly.

---
*Synthesized from: ARCHITECTURE.md, FEATURES.md, STACK.md, PITFALLS.md*
