# Stack Research

**Domain:** MCP server wrapping cloud API (ComfyUI Cloud) with VFX production structure
**Researched:** 2026-04-15
**Confidence:** HIGH (all core libraries verified via official sources + npm)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP protocol server implementation | Official TypeScript SDK. v1.29 adds Standard Schema support (Zod v4 works natively). Includes `McpServer`, `StreamableHTTPServerTransport`, `StdioServerTransport`. 43K+ dependents on npm -- the ecosystem standard. |
| `hono` | ^4.12.14 | HTTP framework for REST API + MCP transport host | 14KB, zero-dep, Web Standards-based. Already proven pattern for hosting MCP Streamable HTTP (see `mcp-hono-stateless` reference). 2.8M weekly downloads. Runs on Node.js, Bun, Cloudflare Workers with identical code. |
| `@hono/node-server` | ^1.19.12 | Node.js adapter for Hono | Required to run Hono on Node.js. Converts Web Standard Request/Response to Node HTTP. |
| `better-sqlite3` | ^12.4.1 | SQLite database driver | Synchronous API (no async overhead for local DB), fastest SQLite driver for Node.js, widely adopted. Perfect for portable, serverless-compatible storage. |
| `drizzle-orm` | ^0.45.2 | Type-safe SQL query builder and ORM | Lightweight (no runtime overhead), SQL-like syntax with full TypeScript inference, first-class `better-sqlite3` driver. Migrations via `drizzle-kit`. No heavy ORM abstraction -- you write SQL, it types it. |
| `zod` | ^4.3.6 | Schema validation and type inference | MCP SDK v1.29+ accepts Standard Schema -- Zod v4 implements this natively. Also provides `z.toJSONSchema()` for OpenAI function-calling adapter (no external converter needed). Single validation library for MCP tools, API inputs, and function-calling schemas. |
| TypeScript | ^5.7 | Language | Project constraint. Type safety across MCP tool definitions, database schemas, and API contracts. |
| Node.js | >=20.0.0 | Runtime | LTS baseline. Required by Vitest. Node 25 available on target machine. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-kit` | ^0.31.0 | Database migration tooling | Schema changes: `drizzle-kit generate` creates SQL migrations, `drizzle-kit push` applies them. Dev-time only. |
| `@types/better-sqlite3` | ^7.6.12 | TypeScript definitions for better-sqlite3 | Always -- better-sqlite3 is plain JS. |
| `nanoid` | ^5.1.0 | Collision-resistant ID generation | Entity IDs (projects, shots, versions). URL-safe, short, no UUID bloat. |
| `date-fns` | ^4.1.0 | Date formatting and manipulation | Provenance timestamps, version dating, human-readable display. Treeshakeable (import only what you use). |
| `fetch-to-node` | ^1.0.0 | Convert Hono fetch requests to Node.js req/res | Required for MCP SDK's `StreamableHTTPServerTransport` which expects Node.js-style objects. Proven pattern from `mcp-hono-stateless`. |

### Web UI (Light Dashboard)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `preact` | ^10.25.0 | UI framework for dashboard SPA | 3KB gzipped. React-compatible API. For a "light web UI showing project hierarchy and provenance," Preact is the right weight class -- full React is overkill. |
| `@preact/preset-vite` | ^2.10.0 | Vite plugin for Preact | HMR, automatic Preact inject, DevTools removal in prod. |
| `vite` | ^8.0.9 | Build tool for dashboard | Instant HMR, native TS support via Oxc, Rolldown bundler. Build outputs static files served by Hono. |

### Testing

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `vitest` | ^4.1.4 | Test runner | Vite-native, ESM-first, Jest-compatible API. Covers unit + integration tests for MCP tools, database operations, API client. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` v4.21.0 | TypeScript execution | Zero-config TS runner. Use for development: `tsx watch src/index.ts`. Not needed in production (compile with `tsc`). |
| `@modelcontextprotocol/inspector` | MCP server testing | Official tool to test MCP servers interactively. Connect via stdio or HTTP to verify tool definitions, test calls. Essential during development. |
| `tsconfig.json` | TypeScript config | Target: `ES2022`, Module: `NodeNext`, strict mode. Match MCP SDK expectations. |

## Installation

```bash
# Core MCP + HTTP
npm install @modelcontextprotocol/sdk hono @hono/node-server

# Database
npm install better-sqlite3 drizzle-orm

# Validation + utilities
npm install zod nanoid date-fns

# Hono-to-MCP bridge
npm install fetch-to-node

# Dashboard UI
npm install preact

# Dev dependencies
npm install -D typescript @types/better-sqlite3 @types/node
npm install -D drizzle-kit
npm install -D vitest
npm install -D tsx
npm install -D vite @preact/preset-vite
npm install -D @modelcontextprotocol/inspector
```

## Architecture Rationale: Why This Stack Fits

### Single-process server, dual interface

Hono hosts both the MCP Streamable HTTP endpoint (`POST /mcp`) and the REST API for the dashboard (`GET /api/projects`, etc.) in one process. The Preact dashboard builds to static files served by Hono's `serveStatic`. No separate frontend server.

### MCP SDK + Hono integration pattern

The proven pattern from `mcp-hono-stateless` and `streamable-mcp-server-template`:

```typescript
// Mount MCP on Hono
app.post('/mcp', async (c) => {
  const { req, res } = toReqRes(c.req.raw);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
  return toFetchResponse(res);
});

// Mount REST API on same Hono instance
app.get('/api/projects', async (c) => { /* ... */ });

// Serve dashboard static files
app.use('/dashboard/*', serveStatic({ root: './dashboard/dist' }));
```

### Function-calling adapter (non-Anthropic agents)

The adapter is a thin REST endpoint that:
1. Lists tools as OpenAI-compatible function definitions (using `z.toJSONSchema()` from Zod v4)
2. Accepts OpenAI `tool_calls` format and routes to MCP tool handlers
3. Returns results in OpenAI `tool` message format

This is NOT a separate service -- it is additional Hono routes on the same server:
- `GET /v1/tools` -- list tools as OpenAI function schemas
- `POST /v1/tools/call` -- execute a tool call, return result

No need for MCP-Bridge (Python) or external middleware. The Zod schemas are already defined for MCP tools; `z.toJSONSchema()` converts them to OpenAI-compatible JSON Schema directly.

### SQLite + Drizzle for provenance

The VFX hierarchy (workspace/project/sequence/shot/version) and provenance data (workflow JSON, params, seed, model checksums) live in SQLite via Drizzle. Schema-as-code with type-safe queries. Migrations tracked in version control.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hono | Express | Never for new projects. Express 4 lacks native async/await, TS support is bolted on. Express 5 exists but Hono is smaller, faster, and Web Standards-native. |
| Hono | Fastify | If you need a plugin ecosystem (rate limiting, auth). Overkill for this project's scope. Fastify's schema validation overlaps with Zod. |
| Drizzle ORM | Raw better-sqlite3 | If you want zero abstraction. But you lose type-safe queries, migration tooling, and schema-as-code. Not worth it for a project with 8+ tables. |
| Drizzle ORM | Prisma | Never for SQLite + MCP server. Prisma adds a Rust query engine binary, increases cold start, and its schema DSL is redundant when Zod already defines types. |
| Preact | React | If you need a large component library ecosystem (Material UI, etc.). The dashboard is 3-5 views -- Preact's 3KB vs React's 40KB+ is the right call. |
| Preact | Vanilla HTML + HTMX | If you want zero JS framework. Viable for simpler dashboards, but project hierarchy tree + provenance drill-down benefits from component composition. |
| Vitest | Jest | Never for new TypeScript ESM projects. Jest's ESM support is still experimental. Vitest is Vite-native and faster. |
| Zod v4 | Zod v3 | Never. MCP SDK v1.29 supports Standard Schema (Zod v4 native). Zod v4 adds `z.toJSONSchema()` eliminating `zod-to-json-schema` dependency. |
| better-sqlite3 | libsql | If you need edge/serverless replication (Turso). For a local-first MCP server, better-sqlite3 is simpler and faster. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `sqlite3` (npm) | Async callback API, slower than better-sqlite3, more complex setup | `better-sqlite3` |
| `typeorm` | Heavy, decorator-based, poor SQLite support, unmaintained feel | `drizzle-orm` |
| `prisma` | Adds Rust binary, slow cold starts, overkill for embedded SQLite | `drizzle-orm` |
| `zod-to-json-schema` | Unmaintained as of Nov 2025. Zod v4 has native `z.toJSONSchema()` | `zod` v4 native |
| `express` | Legacy API design, no native TS, large for what we need | `hono` |
| `ts-node` | Slow startup, ESM configuration headaches | `tsx` |
| `SSEServerTransport` | Deprecated in MCP spec (March 2025). No resumable streams, requires long-lived connections | `StreamableHTTPServerTransport` |
| MCP-Bridge (Python) | External Python middleware for function-calling. Adds Python dependency, separate process, deployment complexity | Build the adapter as Hono routes (same process) |
| Next.js / Remix | Full-stack frameworks. Massive overkill for a light dashboard served from an MCP server | `vite` + `preact` static build |
| `uuid` | 36-char strings, no URL safety | `nanoid` |

## Stack Patterns by Variant

**If targeting Claude Desktop / CLI (stdio transport):**
- Use `StdioServerTransport` from MCP SDK
- Same `McpServer` instance, different transport
- No Hono needed for MCP (but still needed for dashboard/REST)
- This is the default for local MCP servers

**If targeting remote agents (Streamable HTTP transport):**
- Use `StreamableHTTPServerTransport` mounted on Hono
- Stateless mode (`sessionIdGenerator: undefined`) for simplicity
- Add API key auth via Hono middleware

**If demo needs both local + remote:**
- Run both transports simultaneously
- Stdio for Claude Desktop integration
- Streamable HTTP for web-connected agents and the dashboard
- This is the recommended approach for the demo

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@modelcontextprotocol/sdk@^1.29` | `zod@^4.3` | SDK v1.29+ uses Standard Schema; Zod v4 implements it natively. Backwards compatible with Zod v3.25+. |
| `drizzle-orm@^0.45` | `better-sqlite3@^12` | First-class driver support. Import from `drizzle-orm/better-sqlite3`. |
| `drizzle-kit@^0.31` | `drizzle-orm@^0.45` | Must match major generation. Kit generates migrations for ORM schemas. |
| `vitest@^4.1` | `vite@>=6.0` | Vitest 4 requires Vite 6+. Vite 8 works. |
| `@preact/preset-vite@^2.10` | `vite@^8`, `preact@^10` | Preset handles JSX transform, HMR, devtools stripping. |
| `hono@^4.12` | `@hono/node-server@^1.19` | Node adapter must match Hono major version. |
| Node.js | >=20.0.0 | Required by Vitest. Node 25 on target machine is fine. |

## ComfyUI Cloud API Notes

The API this server wraps is documented at `https://docs.comfy.org/development/cloud/api-reference`.

Key integration points:
- **Auth**: `X-API-Key` header on all requests (key from `platform.comfy.org`)
- **Queue workflow**: `POST /api/prompt` with API-format JSON, returns `prompt_id`
- **Poll status**: `GET /api/job/{prompt_id}/status` (pending/in_progress/completed/failed/cancelled)
- **WebSocket**: `/ws` with `clientId` + `token` for real-time progress
- **Download outputs**: `GET /api/view` with filename params (returns 302 to signed URL)
- **Upload inputs**: `POST /api/upload/image` (multipart form data)
- **Concurrent limits**: Free/Standard: 1, Creator: 3, Pro: 5 simultaneous jobs

**WARNING**: The API is marked "experimental and subject to change." Wrap all API calls behind an abstraction layer so endpoint changes don't cascade through the codebase.

## Sources

- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) -- v1.29.0 confirmed, Standard Schema support verified
- [MCP TypeScript SDK server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) -- McpServer API, transport patterns, tool registration
- [MCP SDK Zod v4 issue #555](https://github.com/modelcontextprotocol/typescript-sdk/issues/555) -- CLOSED/COMPLETED Feb 2026, Zod v4 natively supported
- [Hono official site](https://hono.dev/) -- v4.12.14, 2.8M weekly downloads
- [mcp-hono-stateless](https://github.com/mhart/mcp-hono-stateless) -- Proven Hono + MCP Streamable HTTP pattern
- [streamable-mcp-server-template](https://github.com/iceener/streamable-mcp-server-template) -- Production-ready Hono + MCP template with auth
- [MCP Transports spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) -- Streamable HTTP replaces deprecated SSE
- [Drizzle ORM SQLite getting started](https://orm.drizzle.team/docs/get-started-sqlite) -- better-sqlite3 driver setup
- [Zod v4 JSON Schema](https://zod.dev/json-schema) -- Native `z.toJSONSchema()`, replaces zod-to-json-schema
- [ComfyUI Cloud API Reference](https://docs.comfy.org/development/cloud/api-reference) -- All endpoints, auth, workflow format
- [ComfyUI Cloud API Overview](https://docs.comfy.org/development/cloud/overview) -- Capabilities, limits, experimental status
- [OpenAI Function Calling Guide](https://developers.openai.com/api/docs/guides/function-calling) -- JSON schema format for tool definitions
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- v12.4.1, synchronous API
- [Vitest](https://vitest.dev/) -- v4.1.4, ESM-first testing
- [Preact](https://preactjs.com/) -- v10.x, 3KB gzipped

---
*Stack research for: VFX pipeline MCP server wrapping ComfyUI Cloud*
*Researched: 2026-04-15*
