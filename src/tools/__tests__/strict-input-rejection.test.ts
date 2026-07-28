// Unknown-key rejection at the tool boundary, exercised through the live
// InMemoryTransport + McpServer + Client JSON-RPC path (same harness as
// shot-tool-pipeline-log.test.ts).
//
// Why this exists: the hierarchy tools spell parent ids camelCase
// (sequenceId) while asset/version/generation spell the same concepts
// snake_case (sequence_id). Before every input arm was .strict(), Zod
// silently STRIPPED an unknown key — so `shot list {sequence_id: X}` (the
// asset tool's spelling) dropped the filter and returned every project's
// shots with a confident total_count, byte-identical to passing no filter.
// A scope filter that can be silently ignored is a correctness bug, not a
// convenience. These tests pin the fail-closed behaviour and that the
// error names the offending key.
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
import { registerAsset } from '../asset-tool.js';
import { registerVersion } from '../version-tool.js';

type ErrorPayload = { code?: string; message?: string; hint?: string };
type ListPayload = { items?: unknown[]; total_count?: number };

async function spinUp() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const engine = new Engine(db, repo, versions, provenanceRepo, null);
  const server = new McpServer(
    { name: 'strict-input-test', version: '0.0.0' },
    { instructions: 'test' },
  );
  registerShot(server, engine);
  registerAsset(server, engine);
  registerVersion(server, engine);
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await server.connect(serverTx);
  await client.connect(clientTx);

  // Two projects, each with one sequence and one shot — the rows a dropped
  // filter used to leak across.
  const ws = engine.createWorkspace('leakws');
  const pA = engine.createProject(ws.entity.id, 'projA');
  const pB = engine.createProject(ws.entity.id, 'projB');
  const sA = engine.createSequence(pA.entity.id, 'sq010');
  const sB = engine.createSequence(pB.entity.id, 'sq020');
  engine.createShot(sA.entity.id, 'sh010');
  engine.createShot(sB.entity.id, 'sh020');

  return { client, seqA: sA.entity.id };
}

describe('unknown keys are rejected, not silently dropped', () => {
  it('shot list with snake_case sequence_id errors instead of returning every shot', async () => {
    const { client, seqA } = await spinUp();

    // The correct spelling scopes to one shot.
    const ok = await client.callTool({
      name: 'shot',
      arguments: { action: 'list', sequenceId: seqA },
    });
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as ListPayload).total_count).toBe(1);

    // The sibling tools' spelling must fail closed, naming the key.
    const res = await client.callTool({
      name: 'shot',
      arguments: { action: 'list', sequence_id: seqA },
    });
    expect(res.isError).toBe(true);
    const err = res.structuredContent as ErrorPayload;
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain("'sequence_id'");
    expect(err.hint).toBeTruthy();
  });

  it('asset query with camelCase sequenceId errors instead of widening scope', async () => {
    const { client, seqA } = await spinUp();
    const res = await client.callTool({
      name: 'asset',
      arguments: { action: 'query', sequenceId: seqA },
    });
    expect(res.isError).toBe(true);
    const err = res.structuredContent as ErrorPayload;
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain("'sequenceId'");
  });

  it('version diff missing version_b names the field, not "input."', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({
      name: 'version',
      arguments: { action: 'diff', version_a: 'ver_x' },
    });
    expect(res.isError).toBe(true);
    const err = res.structuredContent as ErrorPayload;
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain('version_b');
    // The old copy-pasted mapping produced exactly this useless string.
    expect(err.message).not.toBe("Invalid input at 'input.'");
  });

  it('out-of-range limit keeps the Zod reason instead of discarding it', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({
      name: 'shot',
      arguments: { action: 'list', limit: 101 },
    });
    expect(res.isError).toBe(true);
    const err = res.structuredContent as ErrorPayload;
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain('input.limit');
    // The reason ("<=100") must survive to the agent, not just the path.
    expect(err.message).toMatch(/100/);
  });
});
