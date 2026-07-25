// Cost actuals — the generation tool's record_cost arm exercised through the
// live InMemoryTransport + McpServer + Client JSON-RPC path, plus an engine-level
// check of register's cost_actual (byte-ingest path, no network). Adds NO new
// tool — record_cost is an action on the existing generation tool.
import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { ProvenanceWriter } from '../../engine/provenance.js';
import { Engine } from '../../engine/pipeline.js';
import { registerGeneration } from '../generation-tool.js';

async function spinUp() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const engine = new Engine(db, repo, versions, provenanceRepo, null);
  const server = new McpServer({ name: 'gen-cost-test', version: '0.0.0' }, { instructions: 'test' });
  registerGeneration(server, engine);
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await server.connect(serverTx);
  await client.connect(clientTx);

  const ws = engine.createWorkspace('Demo Show');
  const proj = engine.createProject(ws.entity.id, 'DEMO01');
  const seq = engine.createSequence(proj.entity.id, 'SEQ010');
  const shot = engine.createShot(seq.entity.id, 'sh010');
  // A completed take to attach cost to.
  const v = versions.insertVersion(shot.entity.id, 'take', undefined, 'byteplus');
  versions.markCompleted(v.id, '[]');
  provenanceWriter.writeCompletedEvent(v.id, null, '[]');

  return { client, engine, provenanceRepo, versionId: v.id };
}

describe('generation tool — record_cost arm', () => {
  it('records an actual cost and returns it via toolOk', async () => {
    const { client, provenanceRepo, versionId } = await spinUp();
    const res = await client.callTool({
      name: 'generation',
      arguments: { action: 'record_cost', version_id: versionId, amount: 0.18, currency: 'USD', note: 'seedance fast' },
    });
    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as { version_id?: string; cost?: { amount?: number; currency?: string } };
    expect(payload.version_id).toBe(versionId);
    expect(payload.cost?.amount).toBe(0.18);
    expect(payload.cost?.currency).toBe('USD');
    // Persisted as an append-only cost_recorded event.
    const latest = provenanceRepo.getLatestCostRecorded(versionId);
    expect(latest?.amount).toBe(0.18);
    expect(latest?.recorded_by).toBe('record_cost');
  });

  it('rejects a negative amount at the tool boundary', async () => {
    const { client, versionId } = await spinUp();
    const res = await client.callTool({
      name: 'generation',
      arguments: { action: 'record_cost', version_id: versionId, amount: -1, currency: 'USD' },
    });
    expect(res.isError).toBe(true);
  });

  it('an unknown version is an error envelope (VERSION_NOT_FOUND)', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({
      name: 'generation',
      arguments: { action: 'record_cost', version_id: 'ver_missing', amount: 1, currency: 'USD' },
    });
    expect(res.isError).toBe(true);
  });
});

describe('register with cost_actual (engine byte path)', () => {
  it('registers an external output and records its actual cost in one call', async () => {
    const { db } = makeInMemoryDb();
    const repo = new HierarchyRepo(db);
    const versions = new VersionRepo(db);
    const provenanceRepo = new ProvenanceRepo(db);
    const engine = new Engine(db, repo, versions, provenanceRepo, null, 'outputs');
    const ws = engine.createWorkspace('W');
    const proj = engine.createProject(ws.entity.id, 'P');
    const seq = engine.createSequence(proj.entity.id, 'SC01');
    const shot = engine.createShot(seq.entity.id, 'sh010');

    const res = await engine.registerExternalOutput({
      shotId: shot.entity.id,
      providerId: 'google-ai-studio',
      outputs: [{ bytes: Buffer.from('PNGDATA'), filename: 'out.png', content_type: 'image/png' }],
      costActual: { amount: 0, currency: 'USD', note: 'free tier', recorded_by: 'register' },
    });
    expect(res.entity.status).toBe('completed');
    const cost = provenanceRepo.getLatestCostRecorded(res.entity.id);
    expect(cost?.amount).toBe(0);
    expect(cost?.currency).toBe('USD');
    expect(cost?.recorded_by).toBe('register');
  });
});
