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
import { hashSpecContent } from '../../utils/spec-hash.js';
import { MAX_SPEC_CONTENT_BYTES } from '../../types/hierarchy.js';

/**
 * Project specs — versioned standing context, and the binding that dates a take
 * against the spec revision it was actually made under.
 *
 * The invariants under test:
 *  1. set_spec APPENDS. Revision N is never rewritten, so a citation to it
 *     stays true forever.
 *  2. Every version created records the spec revision active AT THAT MOMENT.
 *     Revising the spec afterwards does not retro-date earlier takes — that is
 *     the property that makes "fix the spec, not the shot" auditable.
 *  3. No spec means no event, never a wrong event.
 *  4. Binding is advisory: it can never fail a generation that already ran.
 */

type Ctx = {
  engine: Engine;
  hierarchy: HierarchyRepo;
  provenanceRepo: ProvenanceRepo;
  fake: FakeComfyUIClient;
  projectId: string;
  shotId: string;
  tempRoot: string;
};

const active: Ctx[] = [];

async function setup(): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vellum-spec-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    tempRoot,
  );
  const ws = hierarchy.createWorkspace('wsA');
  const proj = hierarchy.createProject(ws.id, 'pA');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ctx: Ctx = {
    engine,
    hierarchy,
    provenanceRepo,
    fake,
    projectId: proj.id,
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
const LOOK_V1 = '# Look: Night Interior\nKey 45deg camera-left, 3800K, 4:1.';
const LOOK_V2 = '# Look: Night Interior\nKey 40-50deg camera-left, 3800K, 4:1, exposure anchor EV 6.';

describe('setProjectSpec — append-only revisions', () => {
  test('first set is revision 1; each set appends the next revision', async () => {
    const ctx = await setup();
    const r1 = ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1, { note: 'initial' });
    expect(r1.entity.revision).toBe(1);
    expect(r1.entity.content_hash).toBe(hashSpecContent(LOOK_V1));
    expect(r1.entity.note).toBe('initial');
    expect(r1.breadcrumb.text).toContain('pA');

    const r2 = ctx.engine.setProjectSpec(ctx.projectId, LOOK_V2, { note: 'pin the exposure anchor' });
    expect(r2.entity.revision).toBe(2);
    expect(r2.entity.id).not.toBe(r1.entity.id);

    // Revision 1 is untouched — the whole point.
    const back = ctx.engine.getProjectSpec(ctx.projectId, 1);
    expect(back.entity.content).toBe(LOOK_V1);
    expect(back.entity.id).toBe(r1.entity.id);
  });

  test('get_spec with no revision returns the LATEST', async () => {
    const ctx = await setup();
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V2);
    expect(ctx.engine.getProjectSpec(ctx.projectId).entity.content).toBe(LOOK_V2);
  });

  test('list_spec_revisions pages newest-first and omits bodies', async () => {
    const ctx = await setup();
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V2);
    const list = ctx.engine.listProjectSpecRevisions(ctx.projectId);
    expect(list.total_count).toBe(2);
    expect(list.items.map((i) => i.revision)).toEqual([2, 1]);
    // A history listing is a browse surface — bodies are fetched one at a time.
    expect(list.items[0]).not.toHaveProperty('content');
  });

  test('unknown project throws PROJECT_NOT_FOUND, not a raw FK violation', async () => {
    const ctx = await setup();
    expect(() => ctx.engine.setProjectSpec('proj_nope', LOOK_V1)).toThrowError(/not found/i);
    expect(() => ctx.engine.getProjectSpec('proj_nope')).toThrowError(/not found/i);
  });

  test('a project with no spec reports SPEC_NOT_FOUND with an actionable hint', async () => {
    const ctx = await setup();
    expect(() => ctx.engine.getProjectSpec(ctx.projectId)).toThrowError(/no spec/i);
  });

  test('missing revision is distinguished from missing spec', async () => {
    const ctx = await setup();
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    expect(() => ctx.engine.getProjectSpec(ctx.projectId, 7)).toThrowError(/revision 7/i);
  });

  test('empty and oversize content are refused before any write', async () => {
    const ctx = await setup();
    expect(() => ctx.engine.setProjectSpec(ctx.projectId, '   ')).toThrowError(/empty/i);
    expect(() =>
      ctx.engine.setProjectSpec(ctx.projectId, 'x'.repeat(MAX_SPEC_CONTENT_BYTES + 1)),
    ).toThrowError(/exceeds/i);
    expect(() => ctx.engine.getProjectSpec(ctx.projectId)).toThrowError(/no spec/i);
  });

  test('two projects keep independent revision sequences', async () => {
    const ctx = await setup();
    const ws = ctx.hierarchy.createWorkspace('wsB');
    const other = ctx.hierarchy.createProject(ws.id, 'pB');
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V2);
    const first = ctx.engine.setProjectSpec(other.id, 'other show bible');
    expect(first.entity.revision).toBe(1);
  });
});

describe('spec binding — which revision produced this take', () => {
  test('a version records the spec revision active at creation', async () => {
    const ctx = await setup();
    const spec = ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    const { entity } = await ctx.engine.submitGeneration(ctx.shotId, GRAPH);

    const bound = ctx.provenanceRepo.getSpecBound(entity.id);
    expect(bound).toEqual({
      spec_id: spec.entity.id,
      project_id: ctx.projectId,
      revision: 1,
      content_hash: hashSpecContent(LOOK_V1),
    });
  });

  test('revising the spec does NOT retro-date takes made under the old revision', async () => {
    const ctx = await setup();
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    const early = await ctx.engine.submitGeneration(ctx.shotId, GRAPH);

    // The look book entry turned out to be ambiguous — fix the SPEC.
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V2, { note: 'ratios need an exposure anchor' });
    const late = await ctx.engine.submitGeneration(ctx.shotId, GRAPH, undefined, undefined, true);

    expect(ctx.provenanceRepo.getSpecBound(early.entity.id)?.revision).toBe(1);
    expect(ctx.provenanceRepo.getSpecBound(late.entity.id)?.revision).toBe(2);
  });

  test('no spec on the project means NO spec_bound event (absence is meaningful)', async () => {
    const ctx = await setup();
    const { entity } = await ctx.engine.submitGeneration(ctx.shotId, GRAPH);
    expect(ctx.provenanceRepo.getSpecBound(entity.id)).toBeNull();
    const events = ctx.engine.getProvenance(entity.id).events;
    expect(events.filter((e) => e.event_type === 'spec_bound')).toHaveLength(0);
  });

  test('the binding surfaces on the normal provenance read', async () => {
    const ctx = await setup();
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    const { entity } = await ctx.engine.submitGeneration(ctx.shotId, GRAPH);
    const events = ctx.engine.getProvenance(entity.id).events;
    const specEvents = events.filter((e) => e.event_type === 'spec_bound');
    expect(specEvents).toHaveLength(1);
    expect(JSON.parse(specEvents[0]!.spec_bound_json!)).toMatchObject({ revision: 1 });
  });

  test('an externally registered output binds too', async () => {
    const ctx = await setup();
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    const { entity } = await ctx.engine.registerExternalOutput({
      shotId: ctx.shotId,
      providerId: 'unreal-mcp',
      outputs: [{ bytes: Buffer.from('fake-png-bytes'), filename: 'start_frame.png' }],
    });
    expect(ctx.provenanceRepo.getSpecBound(entity.id)?.revision).toBe(1);
  });

  test('binding never fails a generation that already ran', async () => {
    const ctx = await setup();
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    // Break the append so the binder throws internally. The take must survive:
    // the record is advisory, the spend is not.
    const boom = new Error('provenance append exploded');
    const original = ctx.provenanceRepo.appendSpecBoundEvent.bind(ctx.provenanceRepo);
    ctx.provenanceRepo.appendSpecBoundEvent = () => {
      throw boom;
    };
    const { entity } = await ctx.engine.submitGeneration(ctx.shotId, GRAPH);
    expect(entity.id).toBeTruthy();
    ctx.provenanceRepo.appendSpecBoundEvent = original;
    expect(ctx.provenanceRepo.getSpecBound(entity.id)).toBeNull();
  });

  test('the per-shot pipeline log shows which spec revision each take used', async () => {
    const ctx = await setup();
    ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    await ctx.engine.submitGeneration(ctx.shotId, GRAPH);
    const log = ctx.engine.getShotPipelineLog(ctx.shotId);
    expect(log.markdown).toMatch(/\*\*Spec:\*\* revision 1/);
    expect(log.markdown).toContain(hashSpecContent(LOOK_V1).slice(0, 12));
  });

  test('the pipeline log says nothing about specs when the project has none', async () => {
    const ctx = await setup();
    await ctx.engine.submitGeneration(ctx.shotId, GRAPH);
    expect(ctx.engine.getShotPipelineLog(ctx.shotId).markdown).not.toContain('**Spec:**');
  });

  test('a duplicate binding cannot re-date a take to a later revision', async () => {
    const ctx = await setup();
    const first = ctx.engine.setProjectSpec(ctx.projectId, LOOK_V1);
    const { entity } = await ctx.engine.submitGeneration(ctx.shotId, GRAPH);
    const second = ctx.engine.setProjectSpec(ctx.projectId, LOOK_V2);
    // Simulate a buggy second write. The OLDEST valid binding must still win.
    ctx.provenanceRepo.appendSpecBoundEvent(entity.id, {
      spec_id: second.entity.id,
      project_id: ctx.projectId,
      revision: second.entity.revision,
      content_hash: second.entity.content_hash,
    });
    const bound = ctx.provenanceRepo.getSpecBound(entity.id);
    expect(bound?.revision).toBe(1);
    expect(bound?.spec_id).toBe(first.entity.id);
  });
});
