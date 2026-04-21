// SEC-01 + API-05: assert name/notes inputs are capped at the documented max
// via live InMemoryTransport dispatch. Exercises the handler's re-validation
// path (RT-02) since the raw-shape ZodRawShape is permissive by design.
import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { Engine } from '../../engine/pipeline.js';
import {
  registerWorkspace,
  registerProject,
  registerSequence,
  registerShot,
  registerGeneration,
} from '../index.js';
import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from '../shape.js';

async function spinUp() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const engine = new Engine(repo, versions, null);
  const server = new McpServer(
    { name: 'bounds-test', version: '0.0.0' },
    { instructions: 'test' },
  );
  registerWorkspace(server, engine);
  registerProject(server, engine);
  registerSequence(server, engine);
  registerShot(server, engine);
  registerGeneration(server, engine);
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await server.connect(serverTx);
  await client.connect(clientTx);
  return { client, repo };
}

describe('input bounds (SEC-01, API-05)', () => {
  it('workspace name at MAX_NAME_LENGTH accepted', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({
      name: 'workspace',
      arguments: { action: 'create', name: 'a'.repeat(MAX_NAME_LENGTH) },
    });
    expect(res.isError).toBeFalsy();
    await client.close();
  });

  it('workspace name at MAX_NAME_LENGTH + 1 rejected with INVALID_INPUT', async () => {
    const { client } = await spinUp();
    const res = await client.callTool({
      name: 'workspace',
      arguments: { action: 'create', name: 'a'.repeat(MAX_NAME_LENGTH + 1) },
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code?: string; message?: string };
    expect(sc.code).toBe('INVALID_INPUT');
    expect(sc.message ?? '').toMatch(/input\.name/);
    await client.close();
  });

  it('project name > MAX_NAME_LENGTH rejected', async () => {
    const { client, repo } = await spinUp();
    const ws = repo.createWorkspace('ws-for-bounds');
    const res = await client.callTool({
      name: 'project',
      arguments: {
        action: 'create',
        workspaceId: ws.id,
        name: 'p'.repeat(MAX_NAME_LENGTH + 1),
      },
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code?: string }).code).toBe('INVALID_INPUT');
    await client.close();
  });

  it('sequence name > MAX_NAME_LENGTH rejected', async () => {
    const { client, repo } = await spinUp();
    const ws = repo.createWorkspace('ws-for-seq-bounds');
    const proj = repo.createProject(ws.id, 'proj-for-seq');
    const res = await client.callTool({
      name: 'sequence',
      arguments: {
        action: 'create',
        projectId: proj.id,
        name: 's'.repeat(MAX_NAME_LENGTH + 1),
      },
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code?: string }).code).toBe('INVALID_INPUT');
    await client.close();
  });

  it('generation notes at MAX_NOTES_LENGTH accepted (submit fails on missing creds, not bounds)', async () => {
    const { client, repo } = await spinUp();
    const ws = repo.createWorkspace('ws-notes');
    const proj = repo.createProject(ws.id, 'p-notes');
    const seq = repo.createSequence(proj.id, 'sq010');
    const shot = repo.createShot(seq.id, 'sh010');
    const res = await client.callTool({
      name: 'generation',
      arguments: {
        action: 'submit',
        shot_id: shot.id,
        workflow_json: { '1': { class_type: 'X', inputs: {} } },
        notes: 'n'.repeat(MAX_NOTES_LENGTH),
      },
    });
    expect(res.isError).toBe(true);
    // Fails because client is null (COMFYUI_CREDENTIALS_MISSING), not because
    // of the input bound — proves the bound accepted MAX_NOTES_LENGTH chars.
    expect((res.structuredContent as { code?: string }).code).toBe(
      'COMFYUI_CREDENTIALS_MISSING',
    );
    await client.close();
  });

  it('generation notes at MAX_NOTES_LENGTH + 1 rejected with INVALID_INPUT', async () => {
    const { client, repo } = await spinUp();
    const ws = repo.createWorkspace('ws-notes-bad');
    const proj = repo.createProject(ws.id, 'p-notes-bad');
    const seq = repo.createSequence(proj.id, 'sq010');
    const shot = repo.createShot(seq.id, 'sh010');
    const res = await client.callTool({
      name: 'generation',
      arguments: {
        action: 'submit',
        shot_id: shot.id,
        workflow_json: { '1': { class_type: 'X', inputs: {} } },
        notes: 'n'.repeat(MAX_NOTES_LENGTH + 1),
      },
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code?: string; message?: string };
    expect(sc.code).toBe('INVALID_INPUT');
    expect(sc.message ?? '').toMatch(/input\.notes/);
    await client.close();
  });

  it('SEC-02: workflow_json with > 2000 nodes rejected with INVALID_INPUT', async () => {
    const { client, repo } = await spinUp();
    const ws = repo.createWorkspace('ws-nodes');
    const proj = repo.createProject(ws.id, 'p-nodes');
    const seq = repo.createSequence(proj.id, 'sq010');
    const shot = repo.createShot(seq.id, 'sh010');
    const tooManyNodes: Record<string, unknown> = {};
    for (let i = 0; i < 2001; i++) {
      tooManyNodes[String(i)] = { class_type: 'K', inputs: {} };
    }
    const res = await client.callTool({
      name: 'generation',
      arguments: {
        action: 'submit',
        shot_id: shot.id,
        workflow_json: tooManyNodes,
      },
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { code?: string; message?: string };
    expect(sc.code).toBe('INVALID_INPUT');
    expect(sc.message ?? '').toMatch(/workflow_json|nodes/);
    await client.close();
  });
});
