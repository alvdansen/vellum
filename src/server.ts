#!/usr/bin/env node
/**
 * vfx-familiar entry point.
 *
 * Constructs a single McpServer, registers the 4 Phase 1 tools, and connects:
 *   - stdio transport ALWAYS (D-15)
 *   - Streamable HTTP on 127.0.0.1:<port> when --http is passed (D-16, T-03-03)
 *
 * Both transports share the SAME McpServer instance, so the tool list is
 * identical by construction (Pitfall #7).
 *
 * Logging: stderr-only (D-21). stdout is reserved for MCP JSON-RPC framing.
 * Environment: zero env vars consulted (TRNS-04).
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
import { Engine } from './engine/pipeline.js';
import {
  registerWorkspace,
  registerProject,
  registerSequence,
  registerShot,
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
  const engine = new Engine(repo);

  // Single McpServer instance — both transports serve the same tools (D-15/D-16).
  const server = new McpServer(
    { name: 'vfx-familiar', version: await readVersion() },
    {
      instructions:
        'VFX project hierarchy management. Use workspace/project/sequence/shot tools with action: create | list | get. Every response carries breadcrumb context from workspace to the affected entity.',
    },
  );

  registerWorkspace(server, engine);
  registerProject(server, engine);
  registerSequence(server, engine);
  registerShot(server, engine);

  // Transport 1 — stdio, always on (D-15).
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
  console.error('vfx-familiar: stdio transport connected');

  // Transport 2 — Streamable HTTP, opt-in via --http (D-16).
  if (args.http) {
    const port = args.port ?? 3000;
    const app = new Hono();
    app.post('/mcp', async (c) => {
      const { req, res } = toReqRes(c.req.raw);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode per STACK.md / mcp-hono-stateless
      });
      await server.connect(transport);
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
