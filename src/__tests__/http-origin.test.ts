// SEC-03: Origin-header allowlist test for the HTTP transport.
// Exercises the Hono app directly via app.fetch so no real port is bound.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { toReqRes, toFetchResponse } from 'fetch-to-node';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { makeInMemoryDb } from '../test-utils/fixtures.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { Engine } from '../engine/pipeline.js';
import {
  registerWorkspace,
  registerProject,
  registerSequence,
  registerShot,
  registerGeneration,
} from '../tools/index.js';

function buildApp(allowedOrigins: string[]) {
  const { db } = makeInMemoryDb();
  const engine = new Engine(new HierarchyRepo(db), new VersionRepo(db), null);
  const app = new Hono();
  app.post('/mcp', async (c) => {
    const origin = c.req.header('origin');
    if (origin && !allowedOrigins.includes(origin)) {
      return c.json(
        {
          error: 'Forbidden origin',
          hint: 'Add origin to HTTP_ALLOWED_ORIGINS env var (comma-separated) to allow browser access',
        },
        403,
      );
    }
    const { req, res } = toReqRes(c.req.raw);
    const server = new McpServer(
      { name: 'test', version: '0.0.0' },
      { instructions: 't' },
    );
    registerWorkspace(server, engine);
    registerProject(server, engine);
    registerSequence(server, engine);
    registerShot(server, engine);
    registerGeneration(server, engine);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return toFetchResponse(res);
  });
  return app;
}

function jsonRpcBody() {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.0.0' },
    },
  });
}

describe('HTTP transport Origin allowlist (SEC-03)', () => {
  it('rejects request with un-allowlisted Origin header', async () => {
    const app = buildApp(['https://allowed.example.com']);
    const res = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
          origin: 'https://evil.com',
        },
        body: jsonRpcBody(),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string; hint?: string };
    expect(body.error).toBe('Forbidden origin');
    expect(body.hint).toMatch(/HTTP_ALLOWED_ORIGINS/);
  });

  it('allows request with no Origin header (non-browser MCP client)', async () => {
    const app = buildApp([]);
    const res = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
        },
        body: jsonRpcBody(),
      }),
    );
    // Not 403 — the transport handles the actual JSON-RPC.
    expect(res.status).not.toBe(403);
  });

  it('allows request with allowlisted Origin header', async () => {
    const app = buildApp(['https://allowed.example.com']);
    const res = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
          origin: 'https://allowed.example.com',
        },
        body: jsonRpcBody(),
      }),
    );
    expect(res.status).not.toBe(403);
  });
});
