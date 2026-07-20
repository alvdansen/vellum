# Vellum

## What This Is

An open-source MCP server that layers VFX production structure over ComfyUI Cloud's API. TypeScript, single process, dual transport (stdio + Streamable HTTP).

## Stack

- **Runtime**: Node.js (TypeScript, ESM)
- **MCP SDK**: `@modelcontextprotocol/sdk` ^1.29
- **HTTP**: Hono + `@hono/node-server`
- **Database**: `better-sqlite3` + Drizzle ORM (WAL mode)
- **Validation**: Zod v4
- **IDs**: nanoid
- **UI**: Preact + Vite (served as static build)
- **Test**: Vitest

## Architecture Rules

- **Tool-engine separation**: MCP tools are thin Zod-validated entry points that delegate to engine services. Engine has zero MCP dependency.
- **Tool cap**: Maximum 12 MCP tools. Use coarse-grained design with `action` parameters.
- **Append-only provenance**: Provenance records are never updated or deleted. States are separate rows.
- **Prompt blob is truth**: The ComfyUI prompt blob (not workflow blob) contains resolved seeds and actual model paths.
- **Async generation**: Submit returns immediately with job ID. Check is a separate tool. Exponential backoff for polling.
- **SQLite WAL**: Enable WAL mode + busy_timeout=5000 at database initialization.

## Project Management

- Planning docs: `.planning/`
- Current state: `.planning/STATE.md`
- Roadmap: `.planning/ROADMAP.md`
- Requirements: `.planning/REQUIREMENTS.md`
- Research: `.planning/research/`

## Commands

```bash
# Start server (stdio mode for MCP clients)
npx tsx src/server.ts

# Start server (HTTP mode for web + agents)
npx tsx src/server.ts --http

# Run tests
npx vitest

# Build dashboard
cd packages/dashboard && npx vite build
```

## Conventions

- Use `nanoid()` for all entity IDs
- VFX naming: zero-padded versions (`v001`), underscore separators
- Error responses must be human-readable with actionable guidance
- Never return raw JSON dumps to agents — structure responses with context
- Paginate all list queries (default 20, include total count)
