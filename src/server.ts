#!/usr/bin/env node
import 'dotenv/config';
/**
 * vfx-familiar entry point.
 *
 * Dual-transport bootstrap:
 *   - stdio transport ALWAYS, long-lived (D-15)
 *   - Streamable HTTP on 127.0.0.1:<port> when --http is passed (D-16, T-03-03)
 *
 * Both transports expose the SAME 5 tools (workspace, project, sequence, shot,
 * generation) against the SAME process-wide engine (so SQLite writes from either
 * path land in the same db). Tool identity is guaranteed by the shared
 * `buildServer()` factory — it's the only place the 5 register* functions are
 * called, and both transports route through it.
 *
 * Implementation note on MCP SDK 1.29 Protocol invariant:
 *   The SDK's Protocol._transport enforces a one-transport-per-server rule
 *   (see node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js#L215).
 *   We therefore create ONE long-lived McpServer for stdio and a FRESH
 *   McpServer per HTTP request (the canonical stateless pattern from the SDK
 *   examples at modelcontextprotocol/typescript-sdk). Both servers share the
 *   same Engine / HierarchyRepo / VersionRepo / db, so state is process-wide
 *   consistent.
 *
 * Phase 2 additions:
 *   - `import 'dotenv/config'` on line 2 (Pitfall 2 — must precede every
 *     relative import; module hoisting in Node ESM evaluates imports before
 *     top-level code).
 *   - Optional ComfyUIClient wiring from COMFYUI_API_KEY + COMFYUI_API_BASE env.
 *     When COMFYUI_API_KEY is absent, client is null; hierarchy tools still
 *     work; `generation submit` returns COMFYUI_CREDENTIALS_MISSING on first
 *     call (D-GEN-10, D-GEN-14 — silent-if-missing preserves TRNS-04).
 *   - engine.start() kicks the recovery poller for pending rows from prior
 *     runs before any transport accepts client traffic (D-GEN-29).
 *   - SIGINT/SIGTERM → engine.stop() → process.exit(0) (D-GEN-29 — abort all
 *     in-flight pollers gracefully).
 *   - Credential-presence stderr log at boot IF key is set. Format per D-GEN-12:
 *     `ComfyUI credentials loaded (key ****<last4>, base <base>)`.
 *
 * Deviation from literal D-GEN-12: CONTEXT.md says "on the first submit per
 * process", but the honest implementation logs at boot when the key is present.
 * Engine-side first-submit tracking would couple the engine to a logging
 * concern — violating architecture-purity (D-33). D-GEN-14 (silent if .env
 * missing) is preserved by the `if (apiKey)` branch; the presence-only intent
 * of D-GEN-12 is preserved by the exact format (last-4 only, never the key).
 *
 * Logging: stderr-only (D-21). stdout reserved for MCP JSON-RPC framing on stdio.
 * Credential hygiene: the KEY value is NEVER logged; only the last 4 chars +
 * the base URL (D-GEN-12). Extended stdio-hygiene test asserts no
 * `COMFYUI_API_KEY=` substring ever reaches stdout/stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { toReqRes, toFetchResponse } from 'fetch-to-node';
import { readFile } from 'node:fs/promises';
import { parseCliFlags, printHelp } from './utils/cli.js';
import { openDb } from './store/db.js';
import { HierarchyRepo } from './store/hierarchy-repo.js';
import { VersionRepo } from './store/version-repo.js';
import { ComfyUIClient, DEFAULT_COMFYUI_API_BASE } from './comfyui/client.js';
import { validateBaseUrlFromEnv } from './utils/validate-base-url.js';
import { Engine } from './engine/pipeline.js';
import {
  registerWorkspace,
  registerProject,
  registerSequence,
  registerShot,
  registerGeneration,
} from './tools/index.js';

/**
 * Read version from package.json — single source of truth, no hardcoded duplicate.
 * Resolves relative to the compiled/executed module url, so it works both when
 * run via `npx tsx src/server.ts` (from repo root) and from an installed bin.
 */
async function readVersion(): Promise<string> {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(await readFile(pkgUrl, 'utf8')) as { version: string };
  return pkg.version;
}

/**
 * Construct a fresh McpServer with the 5 Phase 1 + Phase 2 tools registered
 * against the supplied engine. Single source of tool identity — both stdio and
 * each HTTP request route through this factory, so transport parity is
 * guaranteed by construction (Pitfall #7). Zero transport-specific branching
 * inside.
 */
function buildServer(engine: Engine, version: string): McpServer {
  const server = new McpServer(
    { name: 'vfx-familiar', version },
    {
      instructions:
        'VFX project hierarchy management + ComfyUI generation. Hierarchy tools: workspace/project/sequence/shot with action: create | list | get. Generation tool: generation with action: submit | status. Every response carries a breadcrumb from workspace to the affected entity.',
    },
  );
  registerWorkspace(server, engine);
  registerProject(server, engine);
  registerSequence(server, engine);
  registerShot(server, engine);
  registerGeneration(server, engine);
  return server;
}

async function main(): Promise<void> {
  const args = parseCliFlags(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.error(await readVersion());
    process.exit(0);
  }

  // Db init — auto-creates if missing, applies WAL + schema (D-18, TRNS-04).
  // openDb() returns { db, sqlite } — always destructure. Passing the object
  // directly to HierarchyRepo crashes on first query (db.select undefined).
  const dbPath = args.db ?? './vfx-familiar.db';
  const { db } = openDb(dbPath);
  console.error(`vfx-familiar: db=${dbPath}`);

  const repo = new HierarchyRepo(db);
  const versionRepo = new VersionRepo(db);

  // Optional ComfyUI client — built only if COMFYUI_API_KEY is set (D-GEN-10,
  // D-GEN-14). Absent key ⇒ hierarchy tools work; `generation submit` surfaces
  // COMFYUI_CREDENTIALS_MISSING on first call.
  const apiKey = process.env.COMFYUI_API_KEY;
  const apiBase = process.env.COMFYUI_API_BASE ?? DEFAULT_COMFYUI_API_BASE;
  // IS-02: fail-fast on misconfigured base URL. Validates protocol, blocks
  // loopback / RFC1918 / link-local targets unless explicit env overrides are
  // set. Runs even when COMFYUI_API_KEY is absent so surprise misconfigs
  // surface immediately instead of on the first submit call.
  validateBaseUrlFromEnv(apiBase);
  const additionalAllowedHosts = (process.env.COMFYUI_ALLOWED_REDIRECT_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const client = apiKey
    ? new ComfyUIClient(apiKey, apiBase, { additionalAllowedHosts })
    : null;

  // Credential presence log — last 4 ONLY (D-GEN-12). Format is exact per
  // CONTEXT.md §Specifics. Emitted at boot when key is present; silent when
  // absent (D-GEN-14). Engine never reads process.env — credentials flow
  // through the ComfyUI client constructor.
  if (apiKey) {
    const last4 = apiKey.slice(-4);
    console.error(
      `vfx-familiar: ComfyUI credentials loaded (key ****${last4}, base ${apiBase})`,
    );
  }

  // C6: concurrency cap for the on-start recovery poller. Env override allows
  // Pro tier users to raise the ceiling. Default (3) matches the Creator tier.
  const maxConcurrentPollersRaw = process.env.COMFYUI_MAX_CONCURRENT_POLLS;
  const maxConcurrentPollers = maxConcurrentPollersRaw
    ? Number.parseInt(maxConcurrentPollersRaw, 10)
    : undefined;
  const engine = new Engine(repo, versionRepo, client, 'outputs', {
    maxConcurrentPollers: Number.isFinite(maxConcurrentPollers) ? maxConcurrentPollers : undefined,
  });
  const version = await readVersion();

  // Recovery poller (D-GEN-29) — runs once at boot, drains any pending rows
  // from prior runs. No-op if version table has no non-terminal rows.
  await engine.start();

  // Shutdown handlers (D-GEN-29) — abort all AbortControllers in the engine,
  // then exit 0. Stops the process cleanly even with in-flight pollers.
  const shutdown = async (signal: string): Promise<void> => {
    console.error(`vfx-familiar: ${signal} received — shutting down`);
    try {
      await engine.stop();
    } catch (err) {
      console.error('vfx-familiar: stop error:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // Transport 1 — stdio, always on (D-15). One long-lived McpServer.
  const stdio = new StdioServerTransport();
  const stdioServer = buildServer(engine, version);
  await stdioServer.connect(stdio);
  console.error('vfx-familiar: stdio transport connected');

  // Transport 2 — Streamable HTTP, opt-in via --http (D-16).
  // Per the MCP SDK stateless pattern, a fresh McpServer + transport is spawned
  // per request; all share the same engine/db for consistent state.
  if (args.http) {
    const port = args.port ?? 3000;
    const app = new Hono();
    app.post('/mcp', async (c) => {
      const { req, res } = toReqRes(c.req.raw);
      const requestServer = buildServer(engine, version);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode per STACK.md / mcp-hono-stateless
      });
      await requestServer.connect(transport);
      await transport.handleRequest(req, res);
      return toFetchResponse(res);
    });
    // NOTE: do not log request bodies here — future phases will carry ComfyUI
    // keys in headers (T-03-04 reminder).
    // Bind 127.0.0.1 explicitly (T-03-03) — no remote reachability until auth lands.
    serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
    console.error(
      `vfx-familiar: http transport listening on http://127.0.0.1:${port}/mcp`,
    );
  }
}

main().catch((err) => {
  // Any boot-time error to stderr, non-zero exit.
  console.error('vfx-familiar: fatal boot error:', err);
  process.exit(1);
});
