import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { openDb } from '../store/db.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { Engine } from '../engine/pipeline.js';
import {
  registerWorkspace,
  registerProject,
  registerSequence,
  registerShot,
} from '../tools/index.js';

/**
 * Asserts Pitfall #7 mitigation: both transports expose the same tool list.
 *
 * Uses InMemoryTransport pairs (one per "transport") to simulate stdio and
 * HTTP without binding a real socket or driving Hono.
 *
 * Important: the MCP SDK 1.29 Protocol enforces one transport per McpServer
 * instance (see node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js#L215).
 * src/server.ts therefore spawns a fresh server per HTTP request via a shared
 * `buildServer()` factory. This test mirrors that pattern — it creates two
 * servers, both registered via the same `makeServer()` factory backed by the
 * same Engine/repo, proving the factory produces identical tool lists
 * regardless of transport. Any future per-transport branching in the
 * registrars would break this test.
 *
 * Also covers T-03-06: malformed requests must surface isError without leaking
 * stack frames, Zod prose, or raw SQLite messages across the transport boundary.
 */

function makeEngine(): Engine {
  // openDb returns { db, sqlite } — always destructure (see Plan 01 contract).
  const { db } = openDb(':memory:');
  const repo = new HierarchyRepo(db);
  return new Engine(repo);
}

function makeServer(engine: Engine): McpServer {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { instructions: 'test' },
  );
  registerWorkspace(server, engine);
  registerProject(server, engine);
  registerSequence(server, engine);
  registerShot(server, engine);
  return server;
}

describe('transport parity', () => {
  it('stdio and HTTP transports expose the identical 4 tools', async () => {
    // Shared engine — mirrors src/server.ts process-wide engine.
    const engine = makeEngine();

    // Simulated transport A (stands in for stdio) — long-lived server.
    const serverA = makeServer(engine);
    const [clientATx, serverATx] = InMemoryTransport.createLinkedPair();
    const clientA = new Client({ name: 'client-a', version: '0.0.0' });
    await serverA.connect(serverATx);
    await clientA.connect(clientATx);

    // Simulated transport B (stands in for HTTP) — per-request server, same factory.
    const serverB = makeServer(engine);
    const [clientBTx, serverBTx] = InMemoryTransport.createLinkedPair();
    const clientB = new Client({ name: 'client-b', version: '0.0.0' });
    await serverB.connect(serverBTx);
    await clientB.connect(clientBTx);

    const toolsA = (await clientA.listTools()).tools.map((t) => t.name).sort();
    const toolsB = (await clientB.listTools()).tools.map((t) => t.name).sort();

    expect(toolsA).toEqual(['project', 'sequence', 'shot', 'workspace']);
    expect(toolsB).toEqual(toolsA);

    await clientA.close();
    await clientB.close();
  });

  it('malformed request returns isError without leaking stack frames', async () => {
    const engine = makeEngine();
    const server = makeServer(engine);
    const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'client', version: '0.0.0' });
    await server.connect(serverTx);
    await client.connect(clientTx);

    const res = await client.callTool({
      name: 'workspace',
      arguments: { action: 'list', limit: -1 }, // Zod will reject (limit.min=1)
    });

    expect(res.isError).toBe(true);
    const text = JSON.stringify(res);
    // Stack frame regex: "at something (/path/to/file.ts:123:45)"
    expect(text).not.toMatch(/at .+\.(ts|js):\d+:\d+/);
    // Neither raw Zod nor SQLite error prose should leak
    expect(text).not.toMatch(/ZodError|SQLITE_/);

    await client.close();
  });
});
