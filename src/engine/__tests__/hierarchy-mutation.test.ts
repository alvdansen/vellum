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
 * Hierarchy mutability — rename and archive.
 *
 * The hierarchy used to be create-only, so a typo'd name was permanent and a
 * sequence dropped in a re-cut had to sit in the grid pretending to be live.
 *
 * The invariants under test:
 *  1. Rename works at every level and is RECORDED — the old name stays
 *     traceable, so artifacts naming it are still explainable.
 *  2. Archive is soft, reversible, and actually means something: hidden from
 *     default listings AND counts, and refuses new work.
 *  3. Nothing is ever deleted, because provenance points at these ids.
 */

type Ctx = {
  engine: Engine;
  hierarchy: HierarchyRepo;
  fake: FakeComfyUIClient;
  wsId: string;
  projId: string;
  seqId: string;
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
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vellum-hier-${nanoid(6)}-`));
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
  const ctx: Ctx = {
    engine,
    hierarchy,
    fake,
    wsId: ws.entity.id,
    projId: proj.entity.id,
    seqId: seq.entity.id,
    shotId: shot.entity.id,
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

describe('rename', () => {
  test('works at every level and updates the breadcrumb', async () => {
    const ctx = await setup();
    expect(ctx.engine.renameEntity('workspace', ctx.wsId, 'wsRenamed').entity.name).toBe('wsRenamed');
    expect(ctx.engine.renameEntity('project', ctx.projId, 'pRenamed').entity.name).toBe('pRenamed');
    expect(ctx.engine.renameEntity('sequence', ctx.seqId, 'sq020').entity.name).toBe('sq020');
    const shot = ctx.engine.renameEntity('shot', ctx.shotId, 'SH014');
    expect(shot.entity.name).toBe('SH014');
    expect(shot.breadcrumb.text).toBe('wsRenamed > pRenamed > sq020 > SH014');
  });

  test('the typo fix: the old name stays traceable', async () => {
    const ctx = await setup();
    ctx.engine.renameEntity('shot', ctx.shotId, 'sh011', { note: 'typo — was meant to be 011' });
    const hist = ctx.engine.listEntityHistory('shot', ctx.shotId);
    expect(hist.total_count).toBe(1);
    expect(hist.items[0]).toMatchObject({
      event_type: 'renamed',
      from_value: 'sh010',
      to_value: 'sh011',
      note: 'typo — was meant to be 011',
    });
    // The lookup that makes an old filename or pipeline log explainable.
    expect(hist.name_history).toEqual(['sh010', 'sh011']);
  });

  test('successive renames accumulate a full name history', async () => {
    const ctx = await setup();
    ctx.engine.renameEntity('shot', ctx.shotId, 'sh011');
    ctx.engine.renameEntity('shot', ctx.shotId, 'sh012');
    ctx.engine.renameEntity('shot', ctx.shotId, 'EP101_SH012');
    expect(ctx.engine.listEntityHistory('shot', ctx.shotId).name_history).toEqual([
      'sh010', 'sh011', 'sh012', 'EP101_SH012',
    ]);
  });

  test('a no-op rename records nothing', async () => {
    const ctx = await setup();
    ctx.engine.renameEntity('shot', ctx.shotId, 'sh010');
    expect(ctx.engine.listEntityHistory('shot', ctx.shotId).total_count).toBe(0);
  });

  test('renaming a shot still enforces the safety rules', async () => {
    const ctx = await setup();
    expect(() => ctx.engine.renameEntity('shot', ctx.shotId, '../escape')).toThrowTypedError(
      'INVALID_SHOT_FORMAT',
    );
    // …and the row is untouched.
    expect(ctx.engine.getShot(ctx.shotId).entity.name).toBe('sh010');
  });

  test('renaming a project still enforces folder-name safety', async () => {
    const ctx = await setup();
    expect(() => ctx.engine.renameEntity('project', ctx.projId, 'a/b')).toThrowTypedError(
      'INVALID_INPUT',
    );
  });

  test('colliding with a sibling name is DUPLICATE_NAME, not a raw SQLite error', async () => {
    const ctx = await setup();
    ctx.engine.createShot(ctx.seqId, 'sh020');
    let caught: unknown;
    try {
      ctx.engine.renameEntity('shot', ctx.shotId, 'sh020');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code: string }).code).toBe('DUPLICATE_NAME');
    expect(JSON.stringify(caught)).not.toMatch(/SQLITE_CONSTRAINT/);
    // The failed rename left no event behind.
    expect(ctx.engine.listEntityHistory('shot', ctx.shotId).total_count).toBe(0);
  });

  test('renaming an unknown entity is a typed not-found', async () => {
    const ctx = await setup();
    expect(() => ctx.engine.renameEntity('shot', 'shot_nope', 'sh011')).toThrowError(/not found/i);
  });

  test('renaming does NOT move files already written — old takes stay resolvable', async () => {
    const ctx = await setup();
    const { entity } = await ctx.engine.submitGeneration(ctx.shotId, GRAPH);
    ctx.engine.renameEntity('shot', ctx.shotId, 'sh999');
    // The version row is untouched by the rename; its stored outputs still
    // point where they were written.
    const after = ctx.engine.getVersion(entity.id);
    expect(after.entity.id).toBe(entity.id);
    expect(after.breadcrumb.text).toContain('sh999');
  });
});

describe('archive', () => {
  test('archived rows drop out of default listings AND counts', async () => {
    const ctx = await setup();
    ctx.engine.createShot(ctx.seqId, 'sh020');
    expect(ctx.engine.listShots(ctx.seqId, 20, 0).total_count).toBe(2);

    ctx.engine.setEntityArchived('shot', ctx.shotId, true, { note: 'cut in v3 edit' });
    const live = ctx.engine.listShots(ctx.seqId, 20, 0);
    expect(live.total_count).toBe(1);
    expect(live.items.map((s) => s.name)).toEqual(['sh020']);
  });

  test('include_archived brings them back', async () => {
    const ctx = await setup();
    ctx.engine.setEntityArchived('shot', ctx.shotId, true);
    const all = ctx.engine.listShots(ctx.seqId, 20, 0, { includeArchived: true });
    expect(all.total_count).toBe(1);
    expect(all.items[0]!.archived_at).toBeGreaterThan(0);
  });

  test('an archived entity is still directly readable', async () => {
    const ctx = await setup();
    ctx.engine.setEntityArchived('shot', ctx.shotId, true);
    expect(ctx.engine.getShot(ctx.shotId).entity.name).toBe('sh010');
  });

  test('archiving refuses NEW work but never deletes', async () => {
    const ctx = await setup();
    ctx.engine.setEntityArchived('shot', ctx.shotId, true);
    await expect(ctx.engine.submitGeneration(ctx.shotId, GRAPH)).rejects.toThrowError(/archived/i);
    // Nothing was spent.
    expect(ctx.fake.calls.filter((c) => c.method === 'submit')).toHaveLength(0);
  });

  test('registering an output that ALREADY exists still works while archived', async () => {
    const ctx = await setup();
    ctx.engine.setEntityArchived('shot', ctx.shotId, true);
    // Recording something already produced is not new work — and it is exactly
    // what a late webhook for a cut shot needs to do.
    const res = await ctx.engine.registerExternalOutput({
      shotId: ctx.shotId,
      providerId: 'unreal-mcp',
      outputs: [{ bytes: Buffer.from('bytes'), filename: 'late.png' }],
    });
    expect(res.entity.id).toBeTruthy();
  });

  test('child creation under an archived parent is refused at every level', async () => {
    const ctx = await setup();
    ctx.engine.setEntityArchived('sequence', ctx.seqId, true);
    expect(() => ctx.engine.createShot(ctx.seqId, 'sh030')).toThrowTypedError('ENTITY_ARCHIVED');

    ctx.engine.setEntityArchived('project', ctx.projId, true);
    expect(() => ctx.engine.createSequence(ctx.projId, 'sq020')).toThrowTypedError('ENTITY_ARCHIVED');

    ctx.engine.setEntityArchived('workspace', ctx.wsId, true);
    expect(() => ctx.engine.createProject(ctx.wsId, 'pB')).toThrowTypedError('ENTITY_ARCHIVED');
  });

  test('archiving is reversible and both transitions are recorded', async () => {
    const ctx = await setup();
    ctx.engine.setEntityArchived('shot', ctx.shotId, true, { note: 'cut' });
    ctx.engine.setEntityArchived('shot', ctx.shotId, false, { note: 'back in' });
    const hist = ctx.engine.listEntityHistory('shot', ctx.shotId);
    expect(hist.items.map((e) => e.event_type)).toEqual(['unarchived', 'archived']);
    expect(ctx.engine.getShot(ctx.shotId).entity.archived_at).toBeNull();
    // …and work flows again.
    return expect(ctx.engine.submitGeneration(ctx.shotId, GRAPH)).resolves.toBeDefined();
  });

  test('a no-op archive records nothing', async () => {
    const ctx = await setup();
    ctx.engine.setEntityArchived('shot', ctx.shotId, false);
    expect(ctx.engine.listEntityHistory('shot', ctx.shotId).total_count).toBe(0);
  });

  test('archive is non-cascading — asking for the sequence explicitly still lists its shots', async () => {
    const ctx = await setup();
    ctx.engine.setEntityArchived('sequence', ctx.seqId, true);
    // The sequence leaves its project's listing…
    expect(ctx.engine.listSequences(ctx.projId, 20, 0).total_count).toBe(0);
    // …but its shots are not secretly archived.
    expect(ctx.engine.listShots(ctx.seqId, 20, 0).total_count).toBe(1);
  });

  test('reproduce and iterate are blocked on an archived shot', async () => {
    const ctx = await setup();
    const { entity } = await ctx.engine.submitGeneration(ctx.shotId, GRAPH);
    ctx.engine.setEntityArchived('shot', ctx.shotId, true);
    await expect(ctx.engine.reproduceVersion(entity.id)).rejects.toThrowError(/archived/i);
    await expect(ctx.engine.iterateFromVersion(entity.id)).rejects.toThrowError(/archived/i);
  });
});

describe('history', () => {
  test('mixes renames and archive transitions, newest first', async () => {
    const ctx = await setup();
    ctx.engine.renameEntity('shot', ctx.shotId, 'sh011');
    ctx.engine.setEntityArchived('shot', ctx.shotId, true);
    ctx.engine.renameEntity('shot', ctx.shotId, 'sh012');
    const hist = ctx.engine.listEntityHistory('shot', ctx.shotId);
    expect(hist.total_count).toBe(3);
    expect(hist.items.map((e) => e.event_type)).toEqual(['renamed', 'archived', 'renamed']);
    expect(hist.items[0]!.to_value).toBe('sh012');
  });

  test('unknown entity throws rather than returning an empty history', async () => {
    const ctx = await setup();
    expect(() => ctx.engine.listEntityHistory('shot', 'shot_nope')).toThrowError(/not found/i);
  });

  test('history is empty (not absent) for an untouched entity', async () => {
    const ctx = await setup();
    const hist = ctx.engine.listEntityHistory('shot', ctx.shotId);
    expect(hist.total_count).toBe(0);
    expect(hist.name_history).toEqual([]);
  });
});
