import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { buildStackWithOutputs } from '../../test-utils/fixtures.js';
import { registerWorkspace, registerProject, registerSequence, registerShot, registerVersion } from '../index.js';
import type { Engine } from '../../engine/pipeline.js';

/**
 * REGRESSION — `version.list` must be able to reach page 2.
 *
 * It published an `offset` parameter in its MCP input schema and then threw it
 * away: the handler passed `cursor: null` unconditionally and `shapeList`
 * dropped `next_cursor` from the envelope. An agent paging through a shot's
 * history therefore received page 1 every time, believing it was advancing —
 * a silent wrong answer, and one that loops forever if the agent pages until
 * it sees something new.
 */

interface ListEnvelope {
  items: Array<{ id: string; version_number: number }>;
  total_count: number;
  limit: number;
  offset: number;
  next_cursor?: string | null;
}

async function spinUp(): Promise<{
  client: Client;
  engine: Engine;
  shotId: string;
  cleanup: () => void;
}> {
  const stack = buildStackWithOutputs();
  const server = new McpServer({ name: 'page-test', version: '0.0.0' }, { instructions: 'test' });
  registerWorkspace(server, stack.engine);
  registerProject(server, stack.engine);
  registerSequence(server, stack.engine);
  registerShot(server, stack.engine);
  registerVersion(server, stack.engine);
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await server.connect(serverTx);
  await client.connect(clientTx);

  const ws = stack.engine.createWorkspace('ws1');
  const proj = stack.engine.createProject(ws.entity.id, 'p1');
  const seq = stack.engine.createSequence(proj.entity.id, 'sq010');
  const shot = stack.engine.createShot(seq.entity.id, 'sh010');
  // Five takes, so two pages of two leave a third page.
  for (let i = 0; i < 5; i++) {
    await stack.engine.submitGeneration(shot.entity.id, {
      '3': { class_type: 'KSampler', inputs: { seed: i, steps: 20, cfg: 7 } },
    });
  }
  return { client, engine: stack.engine, shotId: shot.entity.id, cleanup: stack.cleanup };
}

async function list(
  client: Client,
  args: Record<string, unknown>,
): Promise<{ envelope: ListEnvelope | null; isError: boolean; text: string }> {
  const res = (await client.callTool({ name: 'version', arguments: { action: 'list', ...args } })) as {
    isError?: boolean;
    structuredContent?: ListEnvelope;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
  return { envelope: res.structuredContent ?? null, isError: res.isError === true, text };
}

describe('version.list pagination', () => {
  it('issues a next_cursor and that cursor returns the NEXT page', async () => {
    const { client, shotId, cleanup } = await spinUp();
    try {
      const page1 = await list(client, { shot_id: shotId, limit: 2 });
      expect(page1.isError).toBe(false);
      expect(page1.envelope?.items).toHaveLength(2);
      const cursor = page1.envelope?.next_cursor;
      // The envelope has to carry the handle at all — it used to be dropped.
      expect(typeof cursor).toBe('string');
      expect(cursor).toBeTruthy();

      const page2 = await list(client, { shot_id: shotId, limit: 2, cursor });
      expect(page2.isError).toBe(false);
      expect(page2.envelope?.items).toHaveLength(2);

      const idsA = page1.envelope!.items.map((i) => i.id);
      const idsB = page2.envelope!.items.map((i) => i.id);
      // Page 2 is genuinely different work, not page 1 handed back again.
      expect(idsB).not.toEqual(idsA);
      expect(idsA.some((id) => idsB.includes(id))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('walks every version exactly once across pages', async () => {
    const { client, shotId, cleanup } = await spinUp();
    try {
      const seen: string[] = [];
      let cursor: string | null | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await list(client, {
          shot_id: shotId,
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.envelope!.items.map((i) => i.id));
        cursor = page.envelope?.next_cursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5); // no duplicates, no skips
    } finally {
      cleanup();
    }
  });

  it('refuses a non-zero offset instead of silently ignoring it', async () => {
    const { client, shotId, cleanup } = await spinUp();
    try {
      const res = await list(client, { shot_id: shotId, limit: 2, offset: 2 });
      expect(res.isError).toBe(true);
      // And it says what to use instead.
      expect(res.text).toMatch(/cursor/i);
    } finally {
      cleanup();
    }
  });

  it('offset 0 still works (page 1 is a legitimate request)', async () => {
    const { client, shotId, cleanup } = await spinUp();
    try {
      const res = await list(client, { shot_id: shotId, limit: 2, offset: 0 });
      expect(res.isError).toBe(false);
      expect(res.envelope?.items).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it('a malformed cursor is a 4xx-shaped error, not a silent reset to page 1', async () => {
    const { client, shotId, cleanup } = await spinUp();
    try {
      const res = await list(client, { shot_id: shotId, limit: 2, cursor: 'not-a-cursor' });
      expect(res.isError).toBe(true);
      // Silently restarting is the failure that made `offset` useless: an agent
      // paging on a bad cursor would re-read page 1 forever.
      expect(res.text).toMatch(/cursor/i);
    } finally {
      cleanup();
    }
  });
});
