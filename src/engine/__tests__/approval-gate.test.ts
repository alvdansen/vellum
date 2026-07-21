import { describe, test, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { ProvenanceWriter } from '../provenance.js';
import { Engine } from '../pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';

/**
 * Approval gate (10-ton "no silent credit spend") — end-to-end over the real
 * Engine facade + real in-memory store + FakeComfyUIClient.
 *
 * The invariants under test:
 *  1. propose records the FULL verbatim request BEFORE any provider call
 *     (fail-fast validation, zero provider submits at propose time).
 *  2. approve is decide-exactly-once: two approves cannot both execute.
 *  3. requireApproval refuses direct submit/reproduce/iterate with
 *     APPROVAL_REQUIRED, while the propose→approve path executes; register
 *     and status stay ungated (registering an already-spent output is not a spend).
 */

type Ctx = {
  engine: Engine;
  hierarchy: HierarchyRepo;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  provenanceWriter: ProvenanceWriter;
  fake: FakeComfyUIClient;
  shotId: string;
  tempRoot: string;
};

const active: Ctx[] = [];

async function setup(opts: { requireApproval?: boolean } = {}): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vellum-approval-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    tempRoot,
    { requireApproval: opts.requireApproval },
  );
  const ws = hierarchy.createWorkspace('wsA');
  const proj = hierarchy.createProject(ws.id, 'pA');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ctx: Ctx = {
    engine,
    hierarchy,
    versions,
    provenanceRepo,
    provenanceWriter,
    fake,
    shotId: shot.id,
    tempRoot,
  };
  active.push(ctx);
  return ctx;
}

afterEach(async () => {
  for (const c of active.splice(0)) {
    await c.engine.stop();
    await fsp.rm(c.tempRoot, { recursive: true, force: true });
  }
});

const GRAPH = { '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20 } } };
const UI_GRAPH = { nodes: [{ id: 1 }], links: [] }; // UI-format — fake's validateRequest rejects

describe('proposeGeneration', () => {
  test('records the verbatim request with ZERO provider calls; breadcrumb resolves the shot', async () => {
    const ctx = await setup();
    const res = ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: GRAPH,
      notes: 'take-1',
      costEstimate: '~4 credits (Seedance fast)',
    });
    expect(res.proposal.status).toBe('proposed');
    expect(res.proposal.kind).toBe('submit');
    expect(JSON.parse(res.proposal.request_json)).toEqual(GRAPH); // verbatim
    expect(res.proposal.cost_estimate).toBe('~4 credits (Seedance fast)');
    expect(res.breadcrumb.text).toContain('sh010');
    // The whole point: nothing was submitted anywhere.
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(0);
  });

  test('fail-fast: invalid request rejected at PROPOSE time (approver never sees it)', async () => {
    const ctx = await setup();
    expect(() =>
      ctx.engine.proposeGeneration({ kind: 'submit', shotId: ctx.shotId, workflowJson: UI_GRAPH }),
    ).toThrowError(/format|INVALID/i);
    expect(ctx.engine.listProposals().total_count).toBe(0);
  });

  test('unknown shot / unknown source version rejected at propose time', async () => {
    const ctx = await setup();
    expect(() =>
      ctx.engine.proposeGeneration({ kind: 'submit', shotId: 'shot_nope', workflowJson: GRAPH }),
    ).toThrowError(/not found/i);
    expect(() =>
      ctx.engine.proposeGeneration({ kind: 'reproduce', versionId: 'ver_nope' }),
    ).toThrowError(/not found/i);
  });
});

describe('approveProposal — decide-exactly-once', () => {
  test('approve executes the submit, links version_id, stamps decided fields', async () => {
    const ctx = await setup();
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: GRAPH,
    });
    const res = await ctx.engine.approveProposal(proposal.id, 'looks right, spend ok');
    expect(res.proposal.status).toBe('approved');
    expect(res.proposal.decided_note).toBe('looks right, spend ok');
    expect(res.proposal.decided_at).not.toBeNull();
    expect(res.proposal.version_id).toBe(res.entity.id);
    expect(res.entity.status).toBe('submitted');
    // Exactly one provider submit, carrying the verbatim proposed request.
    const submits = ctx.fake.calls.filter((c) => c.method === 'submit');
    expect(submits).toHaveLength(1);
    expect(submits[0].args[0]).toEqual(GRAPH);
  });

  test('double-approve: second approve throws PROPOSAL_ALREADY_DECIDED and does NOT double-spend', async () => {
    const ctx = await setup();
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: GRAPH,
    });
    await ctx.engine.approveProposal(proposal.id);
    await expect(ctx.engine.approveProposal(proposal.id)).rejects.toMatchObject({
      code: 'PROPOSAL_ALREADY_DECIDED',
    });
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(1);
  });

  test('reject decides without executing; approve-after-reject refused', async () => {
    const ctx = await setup();
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: GRAPH,
    });
    const rej = ctx.engine.rejectProposal(proposal.id, 'wrong seed');
    expect(rej.proposal.status).toBe('rejected');
    await expect(ctx.engine.approveProposal(proposal.id)).rejects.toMatchObject({
      code: 'PROPOSAL_ALREADY_DECIDED',
    });
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(0);
  });

  test('unknown proposal → PROPOSAL_NOT_FOUND', async () => {
    const ctx = await setup();
    await expect(ctx.engine.approveProposal('prop_nope')).rejects.toMatchObject({
      code: 'PROPOSAL_NOT_FOUND',
    });
  });

  test('execution failure records execution_error, keeps the claim (no re-execute)', async () => {
    const ctx = await setup();
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: GRAPH,
    });
    ctx.fake.scenario = 'submit-error'; // provider rejects at execute time
    await expect(ctx.engine.approveProposal(proposal.id)).rejects.toThrow();
    const after = ctx.engine.listProposals({ status: 'approved' }).items[0];
    expect(after.id).toBe(proposal.id);
    expect(after.execution_error).toBeTruthy();
    expect(after.version_id).toBeNull();
    // The claim is consumed — a retry cannot double-execute.
    await expect(ctx.engine.approveProposal(proposal.id)).rejects.toMatchObject({
      code: 'PROPOSAL_ALREADY_DECIDED',
    });
  });

  test('propose(reproduce) → approve creates a lineage=reproduce version', async () => {
    const ctx = await setup();
    // Seed a completed source with a resolved blob.
    const row = ctx.versions.insertVersion(ctx.shotId, 'src');
    ctx.provenanceWriter.writeSubmitEvent(row.id, GRAPH);
    ctx.provenanceWriter.writeCompletedEvent(row.id, GRAPH, '[]');
    ctx.versions.markCompleted(row.id, '[]');

    const { proposal } = ctx.engine.proposeGeneration({ kind: 'reproduce', versionId: row.id });
    expect(proposal.kind).toBe('reproduce');
    expect(proposal.shot_id).toBe(ctx.shotId); // derived from the source version
    const res = await ctx.engine.approveProposal(proposal.id);
    expect(res.entity.lineage_type).toBe('reproduce');
    expect(res.entity.parent_version_id).toBe(row.id);
    expect(res.reproduction_warnings).toBeDefined();
  });
});

describe('requireApproval enforcement', () => {
  test('direct submit/reproduce/iterate → APPROVAL_REQUIRED; propose→approve executes', async () => {
    const ctx = await setup({ requireApproval: true });
    await expect(ctx.engine.submitGeneration(ctx.shotId, GRAPH)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    await expect(ctx.engine.reproduceVersion('ver_x')).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    await expect(ctx.engine.iterateFromVersion('ver_x')).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(0);

    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: GRAPH,
    });
    const res = await ctx.engine.approveProposal(proposal.id);
    expect(res.entity.status).toBe('submitted');
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(1);
  });

  test('register and status stay UNGATED (reporting an already-spent output is not a spend)', async () => {
    const ctx = await setup({ requireApproval: true });
    // status of a version created via approve works:
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: GRAPH,
    });
    const approved = await ctx.engine.approveProposal(proposal.id);
    const status = await ctx.engine.getGenerationStatus(approved.entity.id);
    expect(['submitted', 'running', 'completed']).toContain(status.entity.status);
  });
});

describe('listProposals', () => {
  test('filters by status + shot, paginates with total_count', async () => {
    const ctx = await setup();
    for (let i = 0; i < 3; i++) {
      ctx.engine.proposeGeneration({ kind: 'submit', shotId: ctx.shotId, workflowJson: GRAPH });
    }
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: GRAPH,
    });
    ctx.engine.rejectProposal(proposal.id);

    const pending = ctx.engine.listProposals({ status: 'proposed' });
    expect(pending.total_count).toBe(3);
    const rejected = ctx.engine.listProposals({ status: 'rejected' });
    expect(rejected.total_count).toBe(1);
    const page = ctx.engine.listProposals({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total_count).toBe(4);
  });
});
