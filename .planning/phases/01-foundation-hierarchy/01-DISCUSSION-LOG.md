# Phase 1: Foundation & Hierarchy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 01-foundation-hierarchy
**Areas discussed:** Tool Surface Partitioning, VFX Naming Rules & Template, Server Startup & Zero-Config Contract, Response Envelope & Error Shape

---

## Pre-Discussion Area Selection

**Question:** Which implementation areas for Phase 1 do you want to discuss?

| Option | Description | Selected |
|--------|-------------|----------|
| Tool surface partitioning | How to carve 15 hierarchy operations into ≤12 coarse-grained tools | ✓ |
| VFX naming rules & template (HIER-05) | Default shot/version format, configurability, enforcement | ✓ |
| Server startup & zero-config contract (TRNS-04) | Transport selection, HTTP port, SQLite DB location, CLI flags | ✓ |
| Response envelope & error shape (HIER-06, TOOL-04, TOOL-05) | Breadcrumb format, pagination metadata, error model | ✓ |

**User's choice:** All four areas.

---

## Area 1: Tool Surface Partitioning

### Q1: How should the 4 hierarchy entities be partitioned into MCP tools?

| Option | Description | Selected |
|--------|-------------|----------|
| One tool per entity (4 tools) | `workspace`, `project`, `sequence`, `shot` — each takes `action: create\|list\|get`. Clean mental model, ~4 tools used, 8 left for later phases | ✓ |
| One unified `hierarchy` tool (1 tool) | Single tool with `action` + `type`. Max headroom but discriminated-union schema is hard for agents | |
| Two tools: entities + navigation (2 tools) | `hierarchy_write` + `hierarchy_read`. Similar union pain | |
| Per-op tools (6–7 tools) | `create_workspace`, `create_project`, etc. Tool-explosion risk (Pitfall #1) | |

**User's choice:** One tool per entity (4 tools).
**Notes:** Recommended option accepted. Matches domain language; preserves tool budget for later phases.

### Q2: What naming/casing style for tool identifiers?

| Option | Description | Selected |
|--------|-------------|----------|
| snake_case entity names | `workspace`, `project`, `sequence`, `shot` | ✓ |
| snake_case verb-entity | `manage_workspace`, `manage_project` | |
| dot-namespaced | `workspace.create`, `project.list` | |

**User's choice:** snake_case entity names.
**Notes:** Tool = noun, action is a parameter. Dominant MCP convention.

### Q3: Where should breadcrumb / "show me the current location" live?

| Option | Description | Selected |
|--------|-------------|----------|
| As `action: get` on each entity tool | Returns entity + full breadcrumb array; HIER-06 satisfied via response enrichment | ✓ |
| Separate `navigate` tool | Dedicated tool for breadcrumb resolution; burns a tool slot | |
| Auto-included in every response | Every create/list/get includes breadcrumb field | |

**User's choice:** As `action: get` on each entity tool.
**Notes:** No separate navigation tool — breadcrumb enrichment on get/list/create covers HIER-06.

### Q4: Do Phase 1 tools need `update` and `delete` actions, or create/list/get only?

| Option | Description | Selected |
|--------|-------------|----------|
| Create / list / get only | Matches HIER-01..04 wording exactly | ✓ |
| Include update (rename) from day 1 | Adds `action: update` for renames | |
| Full CRUD | Create/list/get/update/delete; cascading delete unsolved | |

**User's choice:** Create / list / get only.
**Notes:** Hierarchy mutation is create-only for v1. Update/delete deferred until later phases surface the need.

---

## Area 2: VFX Naming Rules & Template

### Q1: Which entity names need a strict template?

| Option | Description | Selected |
|--------|-------------|----------|
| Shots and versions only | Workspace/project/sequence accept any non-empty string; shots enforced as `sh###`; versions as `v###` | ✓ |
| Every level enforced | Regex-validate all levels; may reject legacy studio naming | |
| Everything free-form except versions | Only version numbers get zero-padded; shots are arbitrary strings | |

**User's choice:** Shots and versions only.
**Notes:** Matches Netflix baseline without over-constraining upper-level names that studios already have their own conventions for.

### Q2: Where should the naming template be stored/configured?

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded Phase 1 default, schema-ready for per-project override | Nullable `naming_template` column exists; no tool to set it yet | ✓ |
| Configurable from day 1 via tool field | User-facing configurability immediately | |
| Env var / config file override | Conflicts with TRNS-04 "no env vars" | |

**User's choice:** Hardcoded Phase 1 default, schema-ready for per-project override.
**Notes:** HIER-05 "configurable" satisfied structurally (column exists). Per-project override tool ships post-v1.

### Q3: How are version numbers assigned on shot creation?

| Option | Description | Selected |
|--------|-------------|----------|
| No versions created with the shot | Shot is a leaf in Phase 1; versions table exists but empty until Phase 2 | ✓ |
| Auto-create v001 placeholder on shot creation | Symmetric but creates "empty" version records | |
| Defer entirely — Phase 1 has no `versions` table | Purest boundary but conflicts with ARCHITECTURE.md schema | |

**User's choice:** No versions created with the shot.
**Notes:** Versions table exists in Phase 1 schema but receives no rows until Phase 2 first generation.

### Q4: How strict should the shot-name validator be?

| Option | Description | Selected |
|--------|-------------|----------|
| Regex on create, reject with helpful error | `^sh\d{3,}$` (e.g. sh010, sh020, sh0120) | ✓ |
| Accept anything, just document convention | Success criterion #4 becomes a guideline, not a guarantee | |
| Strict single format, no user override | `^sh\d{3}$` exactly — breaks past 999 shots | |

**User's choice:** Regex on create, reject with helpful error.
**Notes:** Supports Netflix increment-by-10 insertion (`sh015`) and large sequences (`sh0120`).

---

## Area 3: Server Startup & Zero-Config Contract

### Q1: Which transport(s) start when the server runs with no flags?

| Option | Description | Selected |
|--------|-------------|----------|
| stdio only — HTTP via `--http` | Default stdio matches Claude Desktop integration; `--http` adds dual transport | ✓ |
| Both transports by default | Binds port at startup; surprising side-effect for stdio clients | |
| HTTP only by default, `--stdio` flag | Inverts default; adds friction for most common integration | |

**User's choice:** stdio only — HTTP via `--http`.
**Notes:** Matches CLAUDE.md wording. MCP convention is stdio-default for local agents.

### Q2: When `--http` is active, how is the port picked?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed default 3000, `--port N` to override | Predictable for demos, overridable for conflicts | ✓ |
| Auto-pick free port, log to stdout | Stable against conflicts but unstable URLs break scripts | |
| Fixed 3000, no override at all | Cannot handle port collision | |

**User's choice:** Fixed default 3000, `--port N` to override.
**Notes:** No env var (honors TRNS-04). Port logged on startup.

### Q3: Where does the SQLite database file live by default?

| Option | Description | Selected |
|--------|-------------|----------|
| Current working directory: `./vfx-familiar.db` | Matches tsx-script ergonomics; portable for demos | ✓ |
| XDG data dir: `~/.local/share/vfx-familiar/db.sqlite` | Unix convention but non-obvious for demo audiences | |
| Home-rooted: `~/.vfx-familiar/db.sqlite` | Single canonical location; heavier reset | |

**User's choice:** Current working directory: `./vfx-familiar.db`.
**Notes:** Override via `--db <path>` flag. Easy to snapshot state by copying the folder.

### Q4: What CLI flag set is Phase 1 committed to?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: `--http`, `--port`, `--db`, `--help`, `--version` | Five flags, all optional; TRNS-04 holds | ✓ |
| Add logging flags too (`--log-level`, `--quiet`, `--verbose`) | Doubles CLI size before log output volume justifies it | |
| Add `--stdio` and `--no-stdio` for explicit transport selection | More flexible but rarely useful given stdio-default | |

**User's choice:** Minimal: `--http`, `--port`, `--db`, `--help`, `--version`.
**Notes:** Every flag optional; honors TRNS-04 zero-config.

---

## Area 4: Response Envelope & Error Shape

### Q1: What shape do breadcrumbs take in responses?

| Option | Description | Selected |
|--------|-------------|----------|
| Array of `{type, id, name}` objects | Machine-navigable; text can be rendered client-side | |
| Both: array + pre-rendered string | Array + `breadcrumb_text: 'a > b > c > d'` — zero-friction for either view | ✓ |
| String only (`a > b > c > d`) | Smallest payload but loses machine-readable benefit | |

**User's choice:** Both: array + pre-rendered string.
**Notes:** Deviates from the recommended option. Slightly higher token cost but zero-friction for both agent consumption and human display. Acceptable tradeoff given bounded depth (4 entries max).

### Q2: Where does the breadcrumb appear — always, or only on get?

| Option | Description | Selected |
|--------|-------------|----------|
| Every response (create, list items, get) | Always-on hierarchy context; HIER-06 strongest interpretation | ✓ |
| Only on `action: get` (single-entity reads) | Saves tokens on list entries but weakens HIER-06 | |
| Opt-in via `include: ['breadcrumb']` param | More control but adds API surface | |

**User's choice:** Every response (create, list items, get).
**Notes:** Bounded token cost (depth = 4). Hierarchy context is always present.

### Q3: What envelope shape for list/paginated responses?

| Option | Description | Selected |
|--------|-------------|----------|
| `{items: [...], total, limit, offset}` | Locked now; Phase 4 inherits without breaking change; matches ASST-04 | ✓ |
| `{items, next_cursor}` cursor-based | Scales better but requires server state; over-engineered for Phase 1 | |
| Raw array, no envelope | Forces a breaking change in Phase 4 | |

**User's choice:** `{items: [...], total, limit, offset}`.
**Notes:** Default `limit` is 20. Shape established in Phase 1 so Phase 4 doesn't force a breaking change.

### Q4: What error model do tools return?

| Option | Description | Selected |
|--------|-------------|----------|
| MCP `isError: true` + structured body (code, message, hint) | Typed codes + human-readable messages; agents can branch on code | ✓ |
| Throw Zod errors through directly | Zero wrapping but TOOL-05 compliance is hard | |
| Plain text error with no code | Human-friendly but agent-unfriendly | |

**User's choice:** MCP `isError: true` + structured body.
**Notes:** Typed codes defined in CONTEXT.md D-29. Zod errors re-wrapped as `INVALID_INPUT` at tool boundary.

---

## Closing Check

**Question:** Anything else unclear before I write CONTEXT.md?

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Generate CONTEXT.md + DISCUSSION-LOG.md; remaining gray areas go to Claude's Discretion | ✓ |
| Explore more gray areas | Schema migration strategy, testing boundaries, logging, file layout | |

**User's choice:** I'm ready for context.

---

## Claude's Discretion

Areas intentionally left to the planner/executor:

- Schema migration approach (`drizzle-kit push` programmatic vs. `CREATE TABLE IF NOT EXISTS`)
- Logging destination and format (stderr `console.error`; no structured logger yet)
- File layout under `src/` (follow ARCHITECTURE.md "Recommended Project Structure")
- Testing strategy (Vitest units + MCP Inspector smoke tests)
- TypeScript config values
- Package manager (npm)
- Hono + MCP bridge implementation (follow `mcp-hono-stateless` pattern)
- CLI parser implementation (hand-rolled for 5 flags — no dependency)

## Deferred Ideas

Mentioned or implied during discussion; belong to future phases or v1.x:

- Per-project naming template override UI/tool
- CLI logging flags (`--log-level`, `--quiet`, `--verbose`)
- Update / rename actions on hierarchy
- Delete actions with cascading rules
- Explicit `--stdio` / `--no-stdio` flags
- Slug auto-generation for filesystem-safe names
- Multi-connection pooling for SQLite
- Auth / API key on HTTP transport
- Monorepo / workspaces layout (`packages/dashboard` deferred to Phase 5)
