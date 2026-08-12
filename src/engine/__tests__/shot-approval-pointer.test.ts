import { describe, test, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';

/**
 * Shot approval — WHICH version was approved.
 *
 * Approval used to be a bare status value: it recorded THAT a shot was approved
 * and nothing about what, and a new take landing afterwards did not disturb it.
 * A shot could read 'approved' while the newest version was something nobody
 * had ever looked at, and the record could not tell that apart from a genuine,
 * current approval.
 *
 * The invariants under test:
 *  1. An approval can name its version, and that pointer is validated.
 *  2. A new take does NOT silently un-approve — but staleness becomes VISIBLE.
 *  3. Staleness is derived at read time, so it cannot itself go stale.
 *  4. Leaving 'approved' clears the pointer; the history keeps it.
 */

type Ctx = {
  engine: Engine;
  hierarchy: HierarchyRepo;
  shotId: string;
  otherShotId: string;
  tempRoot: string;
};

const active: Ctx[] = [];

async function setup(): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vellum-appr-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    tempRoot,
  );
  const ws = engine.createWorkspace('wsA');
  const proj = engine.createProject(ws.entity.id, 'pA');
  const seq = engine.createSequence(proj.entity.id, 'sq010');
  const shot = engine.createShot(seq.entity.id, 'sh010');
  const other = engine.createShot(seq.entity.id, 'sh020');
  const ctx: Ctx = {
    engine,
    hierarchy,
    shotId: shot.entity.id,
    otherShotId: other.entity.id,
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

async function take(ctx: Ctx, shotId = ctx.shotId) {
  const { entity } = await ctx.engine.submitGeneration(shotId, GRAPH, undefined, undefined, true);
  return entity;
}

describe('approving a specific version', () => {
  test('records which version was approved', async () => {
    const ctx = await setup();
    const v1 = await take(ctx);
    const res = ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', 'looks good', v1.id);
    expect(res.approvedVersionId).toBe(v1.id);

    const status = ctx.engine.getShotStatus(ctx.shotId);
    expect(status.status).toBe('approved');
    expect(status.approvedVersionId).toBe(v1.id);
    expect(status.approvalStale).toBe(false);
    expect(status.versionsSinceApproval).toBe(0);
  });

  test('the pointer is written to the append-only history too', async () => {
    const ctx = await setup();
    const v1 = await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', undefined, v1.id);
    const hist = ctx.engine.listShotStatusHistory(ctx.shotId, 10);
    expect(hist.history[0]).toMatchObject({ to_status: 'approved', approved_version_id: v1.id });
  });

  test('approving without a pointer still works and is reported as unrecorded', async () => {
    const ctx = await setup();
    await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor');
    const status = ctx.engine.getShotStatus(ctx.shotId);
    expect(status.approvedVersionId).toBeNull();
    // No pointer means no claim about staleness — not a false "current".
    expect(status.approvalStale).toBe(false);
  });

  test('a version from another shot is refused', async () => {
    const ctx = await setup();
    const foreign = await take(ctx, ctx.otherShotId);
    expect(() =>
      ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', undefined, foreign.id),
    ).toThrowTypedError('INVALID_INPUT');
    // Nothing was recorded.
    expect(ctx.engine.getShotStatus(ctx.shotId).status).toBe('wip');
  });

  test('an unknown version is refused', async () => {
    const ctx = await setup();
    expect(() =>
      ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', undefined, 'ver_nope'),
    ).toThrowTypedError('VERSION_NOT_FOUND');
  });

  test('a pointer on a non-approved status is refused rather than silently dropped', async () => {
    const ctx = await setup();
    const v1 = await take(ctx);
    expect(() =>
      ctx.engine.setShotStatus(ctx.shotId, 'pending-review', 'supervisor', undefined, v1.id),
    ).toThrowTypedError('INVALID_INPUT');
  });
});

describe('staleness — a new take does not silently un-approve', () => {
  test('approval SURVIVES a new take but is reported as stale', async () => {
    const ctx = await setup();
    const v1 = await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', undefined, v1.id);

    await take(ctx); // v2 lands after the sign-off

    const status = ctx.engine.getShotStatus(ctx.shotId);
    // The supervisor's decision is intact — we did not overwrite it…
    expect(status.status).toBe('approved');
    expect(status.approvedVersionId).toBe(v1.id);
    // …but the situation is no longer implied to be current.
    expect(status.approvalStale).toBe(true);
    expect(status.versionsSinceApproval).toBe(1);
  });

  test('staleness counts every take since, and is derived (never cached)', async () => {
    const ctx = await setup();
    const v1 = await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', undefined, v1.id);
    await take(ctx);
    await take(ctx);
    expect(ctx.engine.getShotStatus(ctx.shotId).versionsSinceApproval).toBe(2);

    // Re-approving at the newest take clears it, with no cache to invalidate.
    const latest = await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', 're-approved', latest.id);
    const after = ctx.engine.getShotStatus(ctx.shotId);
    expect(after.approvalStale).toBe(false);
    expect(after.approvedVersionId).toBe(latest.id);
  });

  test('re-approving leaves the earlier approval intact in the history', async () => {
    const ctx = await setup();
    const v1 = await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', 'first pass', v1.id);
    const v2 = await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', 'second pass', v2.id);

    const hist = ctx.engine.listShotStatusHistory(ctx.shotId, 10);
    const approvals = hist.history.filter((e) => e.to_status === 'approved');
    expect(approvals.map((e) => e.approved_version_id)).toEqual([v2.id, v1.id]);
  });
});

describe('leaving approved', () => {
  test('clears the current pointer but keeps the history', async () => {
    const ctx = await setup();
    const v1 = await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', undefined, v1.id);
    ctx.engine.setShotStatus(ctx.shotId, 'wip', 'supervisor', 'reopened for notes');

    const status = ctx.engine.getShotStatus(ctx.shotId);
    expect(status.status).toBe('wip');
    // No lingering pointer claiming an approved version on an unapproved shot.
    expect(status.approvedVersionId).toBeNull();
    expect(status.approvalStale).toBe(false);

    const hist = ctx.engine.listShotStatusHistory(ctx.shotId, 10);
    expect(hist.history.find((e) => e.to_status === 'approved')?.approved_version_id).toBe(v1.id);
  });
});

describe('pipeline log', () => {
  test('names the approved take and flags newer ones', async () => {
    const ctx = await setup();
    const v1 = await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor', undefined, v1.id);
    expect(ctx.engine.getShotPipelineLog(ctx.shotId).markdown).toMatch(
      /\*\*Approved take:\*\* v001 _\(latest\)_/,
    );

    await take(ctx);
    const after = ctx.engine.getShotPipelineLog(ctx.shotId).markdown;
    expect(after).toMatch(/\*\*Approved take:\*\* v001 — .*1 newer take since/);
  });

  test('says so plainly when an approval recorded no version', async () => {
    const ctx = await setup();
    await take(ctx);
    ctx.engine.setShotStatus(ctx.shotId, 'approved', 'supervisor');
    expect(ctx.engine.getShotPipelineLog(ctx.shotId).markdown).toContain(
      '**Approved take:** _not recorded_',
    );
  });

  test('an unapproved shot gets no approved-take line at all', async () => {
    const ctx = await setup();
    await take(ctx);
    expect(ctx.engine.getShotPipelineLog(ctx.shotId).markdown).not.toContain('**Approved take:**');
  });
});
