import { describe, test, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';

/**
 * The approval gate, generalized from SPEND to IRREVERSIBILITY.
 *
 * The original gate exists so no credits are spent without a human. But a free
 * action can still be unrecoverable — relighting a scene in a DCC, overwriting
 * a working file, publishing to a tracker. kind='external' records that action
 * verbatim, gets it decided exactly once, and produces a durable authorization
 * record. Vellum never executes it.
 *
 * The invariants under test:
 *  1. An external proposal touches no provider and creates no version.
 *  2. Approval is still decide-exactly-once — the claim is the deliverable.
 *  3. Approving one records NO execution_error, because nothing was attempted.
 *  4. It is refused unless the action is actually described.
 */

type Ctx = {
  engine: Engine;
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
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vellum-extgate-${nanoid(6)}-`));
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
  const ctx: Ctx = { engine, fake, shotId: shot.id, tempRoot };
  active.push(ctx);
  return ctx;
}

afterEach(async () => {
  for (const c of active.splice(0)) {
    await c.engine.stop();
    await fsp.rm(c.tempRoot, { recursive: true, force: true });
  }
});

const RELIGHT = 'Relight sh010: place KEY 45deg camera-left + RIM opposite. Overwrites Lighting.umap.';

describe('propose kind=external', () => {
  test('records the action verbatim with zero provider calls', async () => {
    const ctx = await setup();
    const res = ctx.engine.proposeGeneration({
      kind: 'external',
      shotId: ctx.shotId,
      action: RELIGHT,
      tool: 'unreal-mcp',
      request: { op: 'place_light', type: 'RectLight', temperature: 3800 },
      costEstimate: 'no credits — destructive scene edit',
    });
    expect(res.proposal.kind).toBe('external');
    expect(res.proposal.status).toBe('proposed');
    // The tool being driven is disclosed the way a provider would be, so the
    // approver can see WHERE the action lands.
    expect(res.proposal.provider).toBe('unreal-mcp');
    const recorded = JSON.parse(res.proposal.request_json);
    expect(recorded.action).toBe(RELIGHT);
    expect(recorded.tool).toBe('unreal-mcp');
    expect(recorded.request).toEqual({ op: 'place_light', type: 'RectLight', temperature: 3800 });
    expect(res.breadcrumb.text).toContain('sh010');
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(0);
  });

  test('refuses an action with no description', async () => {
    const ctx = await setup();
    expect(() =>
      ctx.engine.proposeGeneration({ kind: 'external', shotId: ctx.shotId, action: '   ' }),
    ).toThrowError(/non-empty action/i);
    expect(ctx.engine.listProposals().total_count).toBe(0);
  });

  test('refuses an unknown shot', async () => {
    const ctx = await setup();
    expect(() =>
      ctx.engine.proposeGeneration({ kind: 'external', shotId: 'shot_nope', action: RELIGHT }),
    ).toThrowError(/not found/i);
  });

  test('needs no provider configured — an engine with no backend can still gate', async () => {
    const { db } = makeInMemoryDb();
    const hierarchy = new HierarchyRepo(db);
    const versions = new VersionRepo(db);
    const provenanceRepo = new ProvenanceRepo(db);
    const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vellum-extgate-nb-${nanoid(6)}-`));
    // No client at all: gating irreversible external work is not a generation
    // feature and must not require a generation backend.
    const engine = new Engine(db, hierarchy, versions, provenanceRepo, null, tempRoot);
    const ws = hierarchy.createWorkspace('wsA');
    const proj = hierarchy.createProject(ws.id, 'pA');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    try {
      const res = engine.proposeGeneration({
        kind: 'external',
        shotId: shot.id,
        action: RELIGHT,
      });
      expect(res.proposal.status).toBe('proposed');
      const approved = await engine.approveProposal(res.proposal.id);
      expect(approved.proposal.status).toBe('approved');
      expect(approved.entity).toBeUndefined();
    } finally {
      await engine.stop();
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('approve kind=external — authorize without executing', () => {
  test('approval creates no version and records no execution error', async () => {
    const ctx = await setup();
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'external',
      shotId: ctx.shotId,
      action: RELIGHT,
      tool: 'unreal-mcp',
    });
    const res = await ctx.engine.approveProposal(proposal.id, 'reviewed the diff, go');

    expect(res.proposal.status).toBe('approved');
    expect(res.proposal.decided_note).toBe('reviewed the diff, go');
    expect(res.proposal.decided_at).not.toBeNull();
    expect(res.entity).toBeUndefined();
    expect(res.proposal.version_id).toBeNull();
    // Nothing was attempted, so nothing can have failed.
    expect(res.proposal.execution_error).toBeNull();
    expect(res.breadcrumb.text).toContain('sh010');
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(0);
  });

  test('decide-exactly-once still holds — a second approve is refused', async () => {
    const ctx = await setup();
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'external',
      shotId: ctx.shotId,
      action: RELIGHT,
    });
    await ctx.engine.approveProposal(proposal.id);
    await expect(ctx.engine.approveProposal(proposal.id)).rejects.toThrowError(
      /already (approved|decided)/i,
    );
  });

  test('concurrent approvals authorize exactly once', async () => {
    const ctx = await setup();
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'external',
      shotId: ctx.shotId,
      action: RELIGHT,
    });
    const results = await Promise.allSettled([
      ctx.engine.approveProposal(proposal.id),
      ctx.engine.approveProposal(proposal.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  test('reject leaves it unauthorized and undoable', async () => {
    const ctx = await setup();
    const { proposal } = ctx.engine.proposeGeneration({
      kind: 'external',
      shotId: ctx.shotId,
      action: RELIGHT,
    });
    const rejected = ctx.engine.rejectProposal(proposal.id, 'not on a dirty tree');
    expect(rejected.proposal.status).toBe('rejected');
    await expect(ctx.engine.approveProposal(proposal.id)).rejects.toThrowError(/already/i);
  });

  test('external proposals appear in the same queue as spend proposals', async () => {
    const ctx = await setup();
    ctx.engine.proposeGeneration({ kind: 'external', shotId: ctx.shotId, action: RELIGHT });
    ctx.engine.proposeGeneration({
      kind: 'submit',
      shotId: ctx.shotId,
      workflowJson: { '3': { class_type: 'KSampler', inputs: { seed: 1 } } },
    });
    const queue = ctx.engine.listProposals({ status: 'proposed' });
    expect(queue.total_count).toBe(2);
    expect(queue.items.map((p) => p.kind).sort()).toEqual(['external', 'submit']);
  });
});
