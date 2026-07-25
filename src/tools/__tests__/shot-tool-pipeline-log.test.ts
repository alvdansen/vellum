// Pipeline log — the shot tool's `pipeline_log` arm exercised through the live
// InMemoryTransport + McpServer + Client JSON-RPC path (RT-01/RT-02 boundary),
// mirroring shot-tool-status.test.ts. Adds NO new tool — the arm lives on the
// existing 'shot' tool, so the registerToolCount===7 budget is unchanged.
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
import { registerShot } from '../shot-tool.js';

async function spinUp() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const engine = new Engine(db, repo, versions, provenanceRepo, null);
  const server = new McpServer({ name: 'shot-pipeline-log-test', version: '0.0.0' }, { instructions: 'test' });
  registerShot(server, engine);
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await server.connect(serverTx);
  await client.connect(clientTx);

  const ws = engine.createWorkspace('Demo Show');
  const proj = engine.createProject(ws.entity.id, 'DEMO01');
  const seq = engine.createSequence(proj.entity.id, 'SEQ010');
  const shot = engine.createShot(seq.entity.id, 'sh010');

  return { client, engine, versions, provenanceWriter, shotId: shot.entity.id };
}

type PipelineLogPayload = {
  markdown?: string;
  breadcrumb_text?: string;
  shot_id?: string;
  take_count?: number;
};

describe('shot tool — pipeline_log arm', () => {
  it('returns a markdown log for an empty shot via toolOk', async () => {
    const { client, shotId } = await spinUp();
    const res = await client.callTool({ name: 'shot', arguments: { action: 'pipeline_log', id: shotId } });
    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as PipelineLogPayload;
    expect(payload.shot_id).toBe(shotId);
    expect(payload.take_count).toBe(0);
    expect(payload.markdown).toContain('# Pipeline Log — DEMO01 / SEQ010 / sh010');
    expect(payload.markdown).toContain('_No takes recorded yet._');
  });

  it('renders a seeded take with provider + outputs', async () => {
    const { client, versions, provenanceWriter, shotId } = await spinUp();
    const v = versions.insertVersion(shotId, 'a take', undefined, 'comfyui-cloud');
    versions.setJobId(v.id, 'job-xyz');
    const outputs = JSON.stringify([
      { filename: 'out.png', path: '/x/out.png', url: 'https://cdn/out.png', content_type: 'image/png', size_bytes: 2048 },
    ]);
    versions.markCompleted(v.id, outputs);
    provenanceWriter.writeCompletedEvent(v.id, null, outputs);

    const res = await client.callTool({ name: 'shot', arguments: { action: 'pipeline_log', id: shotId } });
    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as PipelineLogPayload;
    expect(payload.take_count).toBe(1);
    expect(payload.markdown).toContain('| v001 | completed | comfyui-cloud |');
    expect(payload.markdown).toContain('`job-xyz`');
    expect(payload.markdown).toContain('`out.png` — 2.0 KB — image/png');
  });

  it('unknown shot returns an isError envelope (SHOT_NOT_FOUND)', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({ name: 'shot', arguments: { action: 'pipeline_log', id: 'shot_missing' } });
    expect(res.isError).toBe(true);
  });
});
