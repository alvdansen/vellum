import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { ProvenanceWriter } from '../provenance.js';
import { Engine } from '../pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';

/**
 * Engine facade tests — Plan 03-02 Task 03-02-03.
 *
 * Covers:
 *  - getVersion / listVersionsForShot / getProvenance shape + breadcrumb
 *  - diffVersions loads snapshots + delegates to pure diff + attaches breadcrumb
 *  - reproduce/iterate delegation to GenerationEngine (smoke — full tests in generation.test.ts)
 *  - facade is composition-only (zero MCP imports asserted by grep on the source file)
 */

type Ctx = {
  engine: Engine;
  hierarchy: HierarchyRepo;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  provenanceWriter: ProvenanceWriter;
  fake: FakeComfyUIClient;
  shotId: string;
  shotBId: string;
  tempRoot: string;
};

async function setup(): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-pipe-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    tempRoot,
  );
  const ws = hierarchy.createWorkspace('ws1');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const shotB = hierarchy.createShot(seq.id, 'sh020');
  return {
    engine,
    hierarchy,
    versions,
    provenanceRepo,
    provenanceWriter,
    fake,
    shotId: shot.id,
    shotBId: shotB.id,
    tempRoot,
  };
}

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(async () => {
  await ctx.engine.stop();
  await fsp.rm(ctx.tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const BASE_BLOB = {
  '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
};

function seedCompleted(
  ctx: Ctx,
  shotId: string,
  blob: Record<string, unknown> = BASE_BLOB,
): string {
  const row = ctx.versions.insertVersion(shotId);
  ctx.provenanceWriter.writeSubmitEvent(row.id, blob);
  ctx.provenanceWriter.writeCompletedEvent(row.id, blob, '[]');
  ctx.versions.markCompleted(row.id, '[]');
  return row.id;
}

describe('Engine.getVersion', () => {
  test('returns entity + 5-entry breadcrumb', () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    const result = ctx.engine.getVersion(row.id);
    expect(result.entity.id).toBe(row.id);
    expect(result.breadcrumb.entries).toHaveLength(5);
    expect(result.breadcrumb.entries.map((e) => e.type)).toEqual([
      'workspace',
      'project',
      'sequence',
      'shot',
      'version',
    ]);
  });

  test('unknown id throws VERSION_NOT_FOUND', () => {
    try {
      ctx.engine.getVersion('ver_missing');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code: string }).code).toBe('VERSION_NOT_FOUND');
    }
  });
});

describe('Engine.listVersionsForShot', () => {
  test('returns items DESC by version_number, total_count, limit, offset', () => {
    ctx.versions.insertVersion(ctx.shotId); // v1
    ctx.versions.insertVersion(ctx.shotId); // v2
    ctx.versions.insertVersion(ctx.shotId); // v3
    const result = ctx.engine.listVersionsForShot(ctx.shotId, 20, 0);
    expect(result.items).toHaveLength(3);
    expect(result.items.map((i) => i.version_number)).toEqual([3, 2, 1]);
    expect(result.total_count).toBe(3);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    for (const i of result.items) {
      expect(i.entries).toBeDefined();
      expect(i.entries).toHaveLength(5);
    }
  });

  test('pagination works', () => {
    for (let i = 0; i < 5; i++) ctx.versions.insertVersion(ctx.shotId);
    const page = ctx.engine.listVersionsForShot(ctx.shotId, 2, 2);
    expect(page.items.map((i) => i.version_number)).toEqual([3, 2]);
    expect(page.total_count).toBe(5);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(2);
  });

  test('empty shot returns items:[] + total_count:0', () => {
    const result = ctx.engine.listVersionsForShot(ctx.shotBId, 20, 0);
    expect(result.items).toEqual([]);
    expect(result.total_count).toBe(0);
  });
});

describe('Engine.getProvenance', () => {
  test('returns chronological events + breadcrumb for a version with events', () => {
    const versionId = seedCompleted(ctx, ctx.shotId);
    const result = ctx.engine.getProvenance(versionId);
    expect(result.events.map((e) => e.event_type)).toEqual(['submitted', 'completed']);
    expect(result.breadcrumb.entries).toHaveLength(5);
  });

  test('returns events:[] for a Phase 2 row with no events (D-PROV-34 honesty)', () => {
    const row = ctx.versions.insertVersion(ctx.shotId);
    const result = ctx.engine.getProvenance(row.id);
    expect(result.events).toEqual([]);
    expect(result.breadcrumb.entries).toHaveLength(5);
  });

  test('unknown version id throws VERSION_NOT_FOUND', () => {
    try {
      ctx.engine.getProvenance('ver_missing');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code: string }).code).toBe('VERSION_NOT_FOUND');
    }
  });
});

describe('Engine.diffVersions', () => {
  test('two completed versions on same shot with seed change → diff returns seed change + breadcrumb', () => {
    const v1 = seedCompleted(ctx, ctx.shotId, {
      '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    });
    const v2 = seedCompleted(ctx, ctx.shotId, {
      '3': { class_type: 'KSampler', inputs: { seed: 99, steps: 20, cfg: 7 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    });
    const result = ctx.engine.diffVersions(v1, v2);
    expect(result.summary).toBeDefined();
    expect(typeof result.summary).toBe('string');
    expect(result.changes).toBeDefined();
    expect(result.breadcrumb).toBeDefined();
    expect(Array.isArray(result.breadcrumb)).toBe(true);
    expect(result.breadcrumb_text).toBeDefined();
    // Seed change is the headline field difference (node 3, inputs.seed 42→99).
    const seedField = result.changes.params.find((p) => p.field === 'seed');
    expect(seedField).toBeDefined();
    expect(seedField!.before).toBe(42);
    expect(seedField!.after).toBe(99);
  });

  test('cross-shot → INVALID_INPUT (D-PROV-20 enforced by pure diff.ts)', () => {
    const v1 = seedCompleted(ctx, ctx.shotId);
    const v2 = seedCompleted(ctx, ctx.shotBId);
    try {
      ctx.engine.diffVersions(v1, v2);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code: string }).code).toBe('INVALID_INPUT');
    }
  });

  test('unknown version id → VERSION_NOT_FOUND', () => {
    const v1 = seedCompleted(ctx, ctx.shotId);
    try {
      ctx.engine.diffVersions(v1, 'ver_missing');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code: string }).code).toBe('VERSION_NOT_FOUND');
    }
  });
});

describe('Engine delegation smoke: reproduceVersion + iterateFromVersion', () => {
  test('reproduceVersion delegates to GenerationEngine and returns reproduction_warnings', async () => {
    const sourceId = seedCompleted(ctx, ctx.shotId);
    const result = await ctx.engine.reproduceVersion(sourceId, 'reproduced');
    expect(result.entity.parent_version_id).toBe(sourceId);
    expect(result.entity.lineage_type).toBe('reproduce');
    expect(Array.isArray(result.reproduction_warnings)).toBe(true);
  });

  test('iterateFromVersion delegates to GenerationEngine and sets lineage_type=iterate', async () => {
    const sourceId = seedCompleted(ctx, ctx.shotId);
    const result = await ctx.engine.iterateFromVersion(
      sourceId,
      { '3': { inputs: { cfg: 9 } } },
      undefined,
      'tweak',
    );
    expect(result.entity.parent_version_id).toBe(sourceId);
    expect(result.entity.lineage_type).toBe('iterate');
  });
});

describe('Engine facade — composition invariants', () => {
  test('pipeline.ts contains zero MCP SDK imports (architecture purity)', async () => {
    const src = await fsp.readFile(
      pth.join(process.cwd(), 'src/engine/pipeline.ts'),
      'utf-8',
    );
    expect(src).not.toContain('@modelcontextprotocol');
  });
});
