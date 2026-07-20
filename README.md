<p align="center">
  <img src="docs/assets/hero.png" alt="Vellum — Structured production for AI pipelines" width="900" />
</p>

<h1 align="center">Vellum</h1>

<p align="center">
  <strong>Provider-agnostic production structure + provenance for AI asset generation, surfaced as MCP tools.</strong><br/>
  <em>Workspace → project → sequence → shot → version. Append-only provenance. Reproduce anything.</em>
</p>

<p align="center">
  <a href="#license"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-ff6b5a?style=flat-square" /></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/Node-20%2B-0c2a3a?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-0c2a3a?style=flat-square" />
  <img alt="MCP SDK 1.29" src="https://img.shields.io/badge/MCP%20SDK-1.29-ff6b5a?style=flat-square" />
  <img alt="Tests 760/763" src="https://img.shields.io/badge/tests-760%2F763-0c2a3a?style=flat-square" />
  <img alt="v1.0" src="https://img.shields.io/badge/release-v1.0-ff6b5a?style=flat-square" />
</p>

---

## Why this exists

Studios can't adopt ComfyUI at scale (50 to 1000+ shots) because **the asset graph collapses**. Files spill across folders, seeds get lost, model versions drift, and "which workflow made this frame?" turns into a half-day archaeology dig. ComfyUI already embeds workflow JSON in PNG metadata — Vellum extends that with the structure a production needs: project, sequence, shot, version, immutable provenance, and lineage you can diff and reproduce.

> *"We don't just care about the final image — we care about exactly **how** it was made."*
> &nbsp;&nbsp;&nbsp;— a recurring theme in every studio conversation

## What it does

**One Node.js process. Two transports. One coherent surface.**

Vellum is an [MCP](https://modelcontextprotocol.io) server that exposes seven coarse-grained tools (under the 12-tool MCP cap), runs over both **stdio** and **Streamable HTTP** simultaneously, and ships with a Preact dashboard served from the same process. Any MCP-compatible AI agent — Claude Desktop, Claude Code, Cursor, MCP Inspector — gets the same tool surface. Every generation auto-creates a versioned record. Every record is immutable. Every record can be diffed, reproduced verbatim, or iterated from with overrides.

### The seven tools

| Tool         | Purpose                                                                 | Actions                                                       |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `workspace`  | Top-level container (one studio, one client, one project group)        | `create`, `list`, `get`                                       |
| `project`    | A film, episode, spot, or campaign within a workspace                  | `create`, `list`, `get`                                       |
| `sequence`   | A scene or shot group within a project                                 | `create`, `list`, `get`                                       |
| `shot`       | An individual shot — zero-padded version naming (`v001`, underscore-separated) | `create`, `list`, `get`                              |
| `generation` | Submit + check ComfyUI Cloud jobs; reproduce or iterate from a version | `submit`, `status`, `reproduce`, `iterate`                   |
| `version`    | Read versions, full provenance, and structured diffs between any two    | `get`, `list`, `provenance`, `diff`                          |
| `asset`      | Tag versions, attach arbitrary metadata, and query across the hierarchy | `add_tag`, `remove_tag`, `set_metadata`, `remove_metadata`, `query`, `list_tags`, `list_metadata_keys` |

Every response carries the full hierarchy breadcrumb (`workspace > project > sequence > shot`), every tool input is Zod-validated, every error is human-readable with actionable guidance.

## Architecture

<p align="center">
  <img src="docs/assets/architecture.png" alt="Four-tier architecture: MCP tools, Engine facade, ComfyUI Cloud client, SQLite WAL store" width="780" />
</p>

Four layers, each independently testable:

- **MCP tools** (`src/tools/*-tool.ts`) — thin Zod-validated entry points. Discriminated unions on `action`. Zero business logic.
- **Engine facade** (`src/engine/`) — pure TypeScript, **zero MCP dependency**. `HierarchyRepo`, `VersionRepo`, `ProvenanceRepo`, `AssetsEngine`. Architecture-purity tests enforce this boundary at the type-level on every commit.
- **ComfyUI Cloud client** (`src/comfyui/`) — SSRF-safe redirect gate, healthcheck on first submit, two-phase submit with AbortController-wired recovery poller, atomic streaming downloads.
- **SQLite + WAL** (`drizzle/`) — Drizzle ORM, four hand-prefixed migrations, `busy_timeout=5000`. Append-only provenance is *structurally* enforced (the repo has no `update` or `delete` methods — there is no path to mutate the truth).

## Provenance — the differentiator

<p align="center">
  <img src="docs/assets/provenance.png" alt="Provenance lineage tree: v001 branches into reproduce and iterate children, recursively" width="640" />
</p>

Every generation captures the full provenance:

- `workflow_json` — the API-format ComfyUI workflow you submitted
- `prompt_json` — the **resolved** prompt with seeds and model paths baked in
- `seed`, `model_names`, `timestamp`, lineage links, optional checksums

You can:

- **`version diff`** any two versions and get a structured comparison of what changed (params, seed, models, workflow shape, metadata)
- **`generation reproduce`** any version verbatim — re-submits the stored `prompt_json` exactly, creating a new version with `lineage_type='reproduce'` and a parent pointer
- **`generation iterate`** from any version with node-scoped overrides + an optional new seed, creating a new version with `lineage_type='iterate'` and the parent tracked

Provenance records are **immutable by construction**. The `ProvenanceRepo` exposes only `insertEvent`, `getEventsForVersion`, `getLatestCompletedEvent`, and `getSubmitEvent`. There are no setters. Prototype-assertion tests fail the build if anyone ever adds one.

## Quickstart

### 1. Install

```bash
git clone https://github.com/alvdansen/vellum.git
cd vellum
npm install
```

Node 20+ required. SQLite database (`vellum.db`) auto-creates on first server start.

### 2. Configure ComfyUI Cloud

```bash
cp .env.example .env
# Edit .env to add your COMFYUI_API_KEY from https://platform.comfy.org
```

The endpoint is locked at `https://cloud.comfy.org` with healthcheck path `/api/system_stats` — audited as the only working combination as of v1.0, with the rationale captured by the read-only probe matrix at `scripts/probe-comfy-endpoint.mts`.

### 3. Smoke test (~5 seconds, no human watching)

```bash
npm run smoke
```

This drives the live MCP SDK client (`scripts/inspector-smoke.mjs`) over stdio and runs **56 wire-level assertions** — full hierarchy walk, breadcrumbs at every level, error envelopes, shot-format validation, pagination, get-by-id round-trips. If this is green, the entire MCP transport + tool registration + engine wiring works end-to-end.

### 4. Full test suite

```bash
npm test
```

Expected: **760 of 763 passing** (3 documented pre-existing timing flakes under full-suite load). The suite covers hierarchy CRUD, ComfyUI client SSRF guards, append-only provenance invariants, asset query/filter composition, dashboard signal store, SSE wire-shape, and three cross-cutting regression guards (`architecture-purity`, `phase-attribution`, `validation-flags`).

### 5. Live, end-to-end with the dashboard

```bash
# Terminal 1 — start the HTTP server (also serves the dashboard)
npm run start:http

# Browser
open http://localhost:3000
```

```bash
# Terminal 2 — drive the server with the MCP Inspector
npm run inspect
```

Now create a workspace → project → sequence → shot, submit a `generation`, and watch the active-generations panel update via SSE as the job moves `submitted → running → completed`. When it finishes, a new version card appears in the timeline with full provenance drill-down.

## Connecting an MCP client

### Claude Code

```bash
claude mcp add vellum --scope user -- bash -c "cd $(pwd) && exec npx -y tsx src/server.ts"
```

Then in any Claude Code session: `/mcp` lists the seven tools, or just ask Claude to `"create a workspace called 'demo' using vellum"`.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vellum": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/vellum/src/server.ts"]
    }
  }
}
```

### Streamable HTTP (web agents, custom clients)

Start the HTTP transport:

```bash
npm run start:http
```

The MCP endpoint is `POST http://127.0.0.1:3000/mcp` (loopback only by default). The dashboard, REST API, and SSE feed share the same Hono app — same port, no separate dev server.

## Project structure

```
vellum/
├── src/
│   ├── server.ts              # dual-transport entry point (stdio + Streamable HTTP)
│   ├── tools/                 # 7 MCP tools — Zod-validated, thin
│   ├── engine/                # pure-TS facade, zero MCP dependency
│   ├── comfyui/               # ComfyUI Cloud client (SSRF-safe, healthchecked)
│   ├── http/                  # Hono REST routes + SSE handler + error middleware
│   └── __tests__/             # cross-cutting invariants (purity, attribution, validation)
├── packages/
│   └── dashboard/             # Preact + Tailwind v4 + signals; built into dist/
├── drizzle/                   # SQLite migrations (4 of them, hand-prefixed)
├── scripts/
│   ├── inspector-smoke.mjs    # 56-check programmatic UAT — the canonical smoke test
│   └── probe-comfy-endpoint.mts  # read-only matrix probe for endpoint discovery
└── docs/                      # diagrams + decision records
```

## Quality bars

This is a v1.0 audit-passed milestone, not a sprint demo.

- **Audit:** `passed` per the v1.0 milestone re-audit. 38 of 38 v1 requirements verified, 9 of 9 phases verified, 5 critical end-to-end flows green, 4 prior tech-debt categories closed by audit-driven gap-closure phases before archival.
- **Cross-cutting regression guards:**
  - `architecture-purity.test.ts` — no MCP imports outside `src/tools/`, no engine-layer Zod, no test-only sentinel strings in production code
  - `phase-attribution.test.ts` — every shipped phase's frontmatter `requirements-completed:` is a superset of the ROADMAP attribution
  - `validation-flags.test.ts` — Nyquist Wave 0 status flags hold across every phase
- **Tool budget:** 7 of 12 MCP tools used at v1.0 (`workspace`, `project`, `sequence`, `shot`, `generation`, `version`, `asset`) — coarse-grained `action` parameters keep the surface lean.
- **Live-smoke:** ComfyUI Cloud round-trip (`generation submit` → `generation status` → completed → `version provenance`) green twice back-to-back as of 2026-04-24.

## Roadmap

### v1.0 — MVP *(shipped 2026-04-28)*

Hierarchy, async ComfyUI generation, append-only provenance with reproduce/iterate lineage, asset tagging and query, Preact dashboard, dual-transport MCP server.

### v1.1 — Provenance Verification (C2PA) *(in design)*

Driven by **EU AI Act Article 50** (effective Aug 2026) and **California SB 942** (in effect Jan 2026). v1.0 captures private provenance; v1.1 makes it signed, portable, and regulator-verifiable.

- Signed C2PA manifests embedded in supported output formats (PNG, JPEG, MP4, WebP)
- Explicit AI disclosure (`c2pa.created` action assertion)
- Model fingerprinting — SHA-256 for every checkpoint, LoRA, VAE referenced (closes the `model_hash: null` gap at `src/engine/provenance.ts:69`)
- Ingredient graph — `parentOf` (lineage), `componentOf` (control/reference images), `inputTo` (prompt + params) assertions
- Sidecar `.c2pa` manifests for non-native-embed formats (OpenEXR et al.)
- Redaction action — strip sensitive values while preserving the *fact* of redaction
- New tool actions: `version export_manifest` / `version verify_manifest`

### Future

- **Multi-backend routing** — route generation to specific ComfyUI instances by capability with failover
- **Function-calling adapter** — OpenAI-compatible REST endpoint for non-MCP agents
- **Advanced operations** — batch shot queuing, webhooks on completion, hierarchy export, lineage graph visualization in the dashboard

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- **[Alvdansen Labs](https://github.com/alvdansen)** — for hosting this drop and for being a place where production-grade open-source AI tooling can land
- **[ComfyUI](https://www.comfy.org)** — for building the most extensible generative pipeline software in the field, and for the Cloud API that makes this whole thing possible
- **[Anthropic](https://www.anthropic.com)** and **[Model Context Protocol](https://modelcontextprotocol.io)** — for the open protocol that makes this server portable across clients

---

<p align="center">
  <em>Built deliberately for production. Designed to feel inevitable.</em>
</p>
