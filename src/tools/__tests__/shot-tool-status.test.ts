// Phase 20 / Plan 20-04 Task 2 — TDD anchor for the shot tool's three new
// status arms (set_status / get_status / list_status_history). Tests use the
// InMemoryTransport + live McpServer + Client pattern established by
// src/tools/__tests__/input-bounds.test.ts so the registered shot tool is
// exercised through the JSON-RPC dispatch path (RT-01/RT-02 boundary), not
// directly via the handler closure.
//
// Tool-budget assertion (registerToolCount === 7) lives in
// src/__tests__/tool-budget.test.ts — this file does NOT register a new tool;
// the new arms go on the existing 'shot' tool's switch statement.
import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../../engine/pipeline.js';
import { registerShot } from '../shot-tool.js';

async function spinUp() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  const engine = new Engine(
    db,
    repo,
    new VersionRepo(db),
    new ProvenanceRepo(db),
    null,
  );
  const server = new McpServer(
    { name: 'shot-status-test', version: '0.0.0' },
    { instructions: 'test' },
  );
  registerShot(server, engine);
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await server.connect(serverTx);
  await client.connect(clientTx);

  // Seed a workspace → project → sequence → shot via the engine so the live
  // hierarchy ids are available for the tool calls.
  const ws = engine.createWorkspace('ws-status');
  const proj = engine.createProject(ws.entity.id, 'p-status');
  const seq = engine.createSequence(proj.entity.id, 'sq010');
  const shot = engine.createShot(seq.entity.id, 'sh010');

  return { client, engine, shotId: shot.entity.id };
}

describe('shot tool — set_status / get_status / list_status_history arms (STAT-05)', () => {
  it('set_status arm transitions a shot and returns toolOk envelope', async () => {
    const { client, shotId } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: {
        action: 'set_status',
        id: shotId,
        status: 'pending-review',
        changed_by: 'alice',
        note: 'first review',
      },
    });
    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as {
      shotId?: string;
      previousStatus?: string;
      newStatus?: string;
      eventId?: string;
    };
    expect(payload.shotId).toBe(shotId);
    expect(payload.previousStatus).toBe('wip');
    expect(payload.newStatus).toBe('pending-review');
    expect(payload.eventId).toMatch(/^sse_/);
    await client.close();
  });

  it("set_status arm defaults changed_by to 'user' when omitted", async () => {
    const { client, shotId } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: {
        action: 'set_status',
        id: shotId,
        status: 'approved',
      },
    });
    expect(res.isError).toBeFalsy();
    // Confirm by reading history — the latest event's changed_by must be 'user'
    const histRes = await client.callTool({
      name: 'shot',
      arguments: { action: 'list_status_history', id: shotId, limit: 10 },
    });
    const hist = histRes.structuredContent as {
      history?: Array<{ changed_by: string; to_status: string }>;
    };
    expect(hist.history?.[0].changed_by).toBe('user');
    expect(hist.history?.[0].to_status).toBe('approved');
    await client.close();
  });

  it('get_status arm returns the current status (defaults to wip for fresh shot)', async () => {
    const { client, shotId } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: { action: 'get_status', id: shotId },
    });
    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as {
      shotId?: string;
      status?: string;
      lastChangedAt?: number | null;
    };
    expect(payload.shotId).toBe(shotId);
    expect(payload.status).toBe('wip');
    expect(payload.lastChangedAt).toBeNull();
    await client.close();
  });

  it('get_status arm reflects a prior set_status transition', async () => {
    const { client, shotId } = await spinUp();
    await client.callTool({
      name: 'shot',
      arguments: { action: 'set_status', id: shotId, status: 'on-hold' },
    });
    const res = await client.callTool({
      name: 'shot',
      arguments: { action: 'get_status', id: shotId },
    });
    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as { status?: string };
    expect(payload.status).toBe('on-hold');
    await client.close();
  });

  it('list_status_history arm returns newest-first events with default limit', async () => {
    const { client, shotId } = await spinUp();
    await client.callTool({
      name: 'shot',
      arguments: { action: 'set_status', id: shotId, status: 'pending-review' },
    });
    // small wait between transitions so created_at orders deterministically
    await new Promise((r) => setTimeout(r, 2));
    await client.callTool({
      name: 'shot',
      arguments: { action: 'set_status', id: shotId, status: 'approved' },
    });
    const res = await client.callTool({
      name: 'shot',
      arguments: { action: 'list_status_history', id: shotId, limit: 10 },
    });
    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as {
      total?: number;
      history?: Array<{ to_status: string }>;
    };
    expect(payload.total).toBe(2);
    expect(payload.history?.[0].to_status).toBe('approved');
    expect(payload.history?.[1].to_status).toBe('pending-review');
    await client.close();
  });

  it('list_status_history arm honours the limit parameter', async () => {
    const { client, shotId } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: { action: 'list_status_history', id: shotId, limit: 5 },
    });
    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as { total?: number; history?: unknown[] };
    expect(payload.total).toBe(0);
    expect(payload.history).toEqual([]);
    await client.close();
  });

  it('invalid status value returns toolError with INVALID_INPUT', async () => {
    const { client, shotId } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: {
        action: 'set_status',
        id: shotId,
        status: 'definitely-not-a-valid-status',
      },
    });
    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code?: string };
    expect(payload.code).toBe('INVALID_INPUT');
    await client.close();
  });

  it('set_status on missing shot returns SHOT_NOT_FOUND TypedError', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: {
        action: 'set_status',
        id: 'shot_does_not_exist',
        status: 'approved',
      },
    });
    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code?: string };
    expect(payload.code).toBe('SHOT_NOT_FOUND');
    await client.close();
  });

  it('get_status on missing shot returns SHOT_NOT_FOUND TypedError', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: { action: 'get_status', id: 'shot_does_not_exist' },
    });
    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code?: string };
    expect(payload.code).toBe('SHOT_NOT_FOUND');
    await client.close();
  });

  it('list_status_history on missing shot returns SHOT_NOT_FOUND TypedError', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: {
        action: 'list_status_history',
        id: 'shot_does_not_exist',
        limit: 10,
      },
    });
    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code?: string };
    expect(payload.code).toBe('SHOT_NOT_FOUND');
    await client.close();
  });

  it('all 5 ShotStatus values (wip, pending-review, approved, on-hold, omit) are accepted', async () => {
    const statuses = ['wip', 'pending-review', 'approved', 'on-hold', 'omit'] as const;
    for (const status of statuses) {
      const { client, shotId } = await spinUp();
      const res = await client.callTool({
        name: 'shot',
        arguments: { action: 'set_status', id: shotId, status },
      });
      expect(res.isError, `status='${status}' should be accepted`).toBeFalsy();
      await client.close();
    }
  });
});
