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
  test('two completed versions on same shot with seed change → diff returns seed change + breadcrumb', async () => {
    const v1 = seedCompleted(ctx, ctx.shotId, {
      '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    });
    const v2 = seedCompleted(ctx, ctx.shotId, {
      '3': { class_type: 'KSampler', inputs: { seed: 99, steps: 20, cfg: 7 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    });
    const result = await ctx.engine.diffVersions(v1, v2);
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

  test('cross-shot → INVALID_INPUT (D-PROV-20 enforced by pure diff.ts)', async () => {
    const v1 = seedCompleted(ctx, ctx.shotId);
    const v2 = seedCompleted(ctx, ctx.shotBId);
    try {
      await ctx.engine.diffVersions(v1, v2);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code: string }).code).toBe('INVALID_INPUT');
    }
  });

  test('unknown version id → VERSION_NOT_FOUND', async () => {
    const v1 = seedCompleted(ctx, ctx.shotId);
    try {
      await ctx.engine.diffVersions(v1, 'ver_missing');
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

// ================================================================
// Phase 12 — DEMO-03 (D-CTX-4) integration tests for the
// reproduction_divergence field on Engine.diffVersions.
// ================================================================

/**
 * Test helper: wire a reproduce-lineage version pair into the in-memory DB.
 * - Creates parent (regular) + reproduction (lineage_type='reproduce') version
 *   rows on the test shot.
 * - Writes the supplied bytes to disk under <outputRoot>/<versionId>/<filename>
 *   so the engine's hash path can read them.
 * - Marks both rows completed with outputs_json containing the filename.
 * - Writes provenance events so loadDiffSnapshot() succeeds.
 * - Optionally writes reproduction_warnings_json on the reproduction row.
 */
async function seedReproducePair(
  ctx: Ctx,
  opts: {
    parentBytes: Buffer;
    reproductionBytes: Buffer;
    filename?: string;
    reproductionWarnings?: string[] | null;
  },
): Promise<{ parentId: string; reproductionId: string }> {
  const filename = opts.filename ?? 'out.png';
  const blob = BASE_BLOB;

  // 1. Parent row + provenance + outputs_json + on-disk file.
  const parent = ctx.versions.insertVersion(ctx.shotId);
  ctx.provenanceWriter.writeSubmitEvent(parent.id, blob);
  ctx.provenanceWriter.writeCompletedEvent(parent.id, blob, '[]');
  const parentDir = pth.join(ctx.tempRoot, parent.id);
  await fsp.mkdir(parentDir, { recursive: true });
  await fsp.writeFile(pth.join(parentDir, filename), opts.parentBytes);
  ctx.versions.markCompleted(parent.id, JSON.stringify([{ filename }]));

  // 2. Reproduction row — INSERT with lineage so D-PROV-33 holds.
  const reproduction = ctx.versions.insertVersion(ctx.shotId, undefined, {
    parent_version_id: parent.id,
    lineage_type: 'reproduce',
  });
  ctx.provenanceWriter.writeSubmitEvent(reproduction.id, blob);
  ctx.provenanceWriter.writeCompletedEvent(reproduction.id, blob, '[]');
  const reproDir = pth.join(ctx.tempRoot, reproduction.id);
  await fsp.mkdir(reproDir, { recursive: true });
  await fsp.writeFile(pth.join(reproDir, filename), opts.reproductionBytes);
  ctx.versions.markCompleted(reproduction.id, JSON.stringify([{ filename }]));

  // 3. Optional warnings persistence.
  if (opts.reproductionWarnings !== undefined && opts.reproductionWarnings !== null) {
    ctx.versions.setReproductionWarnings(reproduction.id, opts.reproductionWarnings);
  }

  return { parentId: parent.id, reproductionId: reproduction.id };
}

describe('Engine.diffVersions reproduction_divergence (Phase 12 — DEMO-03)', () => {
  test('non-reproduce-lineage diff returns reproduction_divergence: null (criterion #4)', async () => {
    // Two ordinary versions on the same shot — neither has lineage_type='reproduce'.
    const v1 = seedCompleted(ctx, ctx.shotId);
    const v2 = seedCompleted(ctx, ctx.shotId);
    const result = await ctx.engine.diffVersions(v1, v2);
    expect(result.reproduction_divergence).toBeNull();
  });

  test('reproduce-lineage with bytes matching + no warnings → reproduction_divergence: null', async () => {
    // criterion #4 negative path at the engine boundary.
    const same = Buffer.from('identical bytes');
    const { parentId, reproductionId } = await seedReproducePair(ctx, {
      parentBytes: same,
      reproductionBytes: same,
      reproductionWarnings: null, // legacy NULL semantics
    });
    const result = await ctx.engine.diffVersions(parentId, reproductionId);
    expect(result.reproduction_divergence).toBeNull();
  });

  test('reproduce-lineage with bytes differing populates sha256_mismatch with both hex strings', async () => {
    const { parentId, reproductionId } = await seedReproducePair(ctx, {
      parentBytes: Buffer.from('parent-bytes-aaaa'),
      reproductionBytes: Buffer.from('repro-bytes-bbbb'),
      reproductionWarnings: null,
    });
    const result = await ctx.engine.diffVersions(parentId, reproductionId);
    expect(result.reproduction_divergence).not.toBeNull();
    const div = result.reproduction_divergence!;
    expect(div.sha256_mismatch).not.toBeNull();
    expect(div.sha256_mismatch!.parent).not.toBe(div.sha256_mismatch!.reproduction);
    expect(div.sha256_mismatch!.parent).toMatch(/^[0-9a-f]{64}$/);
    expect(div.sha256_mismatch!.reproduction).toMatch(/^[0-9a-f]{64}$/);
    expect(div.warnings).toEqual([]);
    expect(div.parent_output_present).toBe(true);
    expect(div.reproduction_output_present).toBe(true);
  });

  test('reproduce-lineage with persisted warnings populates warnings array', async () => {
    const same = Buffer.from('identical bytes');
    const { parentId, reproductionId } = await seedReproducePair(ctx, {
      parentBytes: same,
      reproductionBytes: same,
      reproductionWarnings: [
        'Cloud API did not expose model metadata — reproduction is best-effort',
      ],
    });
    const result = await ctx.engine.diffVersions(parentId, reproductionId);
    expect(result.reproduction_divergence).not.toBeNull();
    const div = result.reproduction_divergence!;
    expect(div.warnings).toEqual([
      'Cloud API did not expose model metadata — reproduction is best-effort',
    ]);
    // Bytes match → sha256_mismatch is null even though warnings populated.
    expect(div.sha256_mismatch).toBeNull();
    expect(div.parent_output_present).toBe(true);
    expect(div.reproduction_output_present).toBe(true);
  });

  // Phase 12 WR-01: graceful degradation regression. When the on-disk path
  // exists but is unreadable as a file (e.g. it is a directory — EISDIR),
  // computeOutputSha256 throws. computeReproductionDivergence MUST swallow
  // the throw and surface the divergence object with *_output_present=false
  // and any warnings preserved — version.diff must NOT reject. The honesty
  // contract requires partner-API non-determinism warnings to remain
  // visible even when the disk state is broken.
  test('WR-01: EISDIR on reproduction output returns divergence with warnings preserved (no throw)', async () => {
    const same = Buffer.from('identical bytes');
    const { parentId, reproductionId } = await seedReproducePair(ctx, {
      parentBytes: same,
      reproductionBytes: same,
      reproductionWarnings: [
        'Partner API non-deterministic — reproduction is best-effort',
      ],
    });
    // Replace the reproduction's output FILE with a DIRECTORY at the same
    // path. stat() succeeds (so the ENOENT short-circuit does NOT fire),
    // but createReadStream throws EISDIR — the exact non-ENOENT case the
    // helper re-throws and the WR-01 guard must trap.
    const reproPath = pth.join(ctx.tempRoot, reproductionId, 'out.png');
    await fsp.rm(reproPath, { force: true });
    await fsp.mkdir(reproPath, { recursive: true });

    // Silence the expected console.error so test output stays clean while
    // capturing the call for operator-visibility assertion. Use a bound
    // capture instead of vi.spyOn so the capture is independent of any
    // module-cache identity quirks for the global console.error reference.
    const captured: unknown[][] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      captured.push(args);
    };
    let result;
    try {
      result = await ctx.engine.diffVersions(parentId, reproductionId);
    } finally {
      console.error = origErr;
    }

    // The diff envelope still surfaces — WR-01 success criterion.
    expect(result.reproduction_divergence).not.toBeNull();
    const div = result.reproduction_divergence!;
    // Warnings preserved — operator can still see partner-API non-determinism.
    expect(div.warnings).toEqual([
      'Partner API non-deterministic — reproduction is best-effort',
    ]);
    // Reproduction hash is null → output-not-present per the helper contract.
    expect(div.reproduction_output_present).toBe(false);
    // Parent file is intact and present.
    expect(div.parent_output_present).toBe(true);
    // sha256_mismatch should be null because reproductionHash is null
    // (per buildReproductionDivergence: needs both hashes to compare).
    expect(div.sha256_mismatch).toBeNull();
    // Operator visibility: console.error must have been called.
    expect(captured.length).toBeGreaterThan(0);
    const logged = String(captured[0]?.[0] ?? '');
    expect(logged).toContain('output-hash unreadable');
    expect(logged).toContain(reproductionId);
  });

  test('reproduceVersion persists reproduction_warnings_json on the new version row (Task 3.4)', async () => {
    // PROV-05: reproduce a parent that has no checksummed models so warnings
    // are emitted by GenerationEngine.reproduceVersion. The new version row's
    // reproduction_warnings_json column must carry JSON.stringify(warnings).
    const sourceId = seedCompleted(ctx, ctx.shotId);
    const result = await ctx.engine.reproduceVersion(sourceId, 'reproduced');

    // Read the row directly from the repo to inspect the column.
    const row = ctx.versions.getVersion(result.entity.id);
    expect(row).not.toBeNull();
    expect(row!.reproduction_warnings_json).not.toBeNull();
    const persisted = JSON.parse(row!.reproduction_warnings_json!) as string[];
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted).toEqual(result.reproduction_warnings);
  });
});

describe('Engine.getDashboardHome (SC-1)', () => {
  test('returns recent_versions: [] on empty DB', () => {
    const home = ctx.engine.getDashboardHome();
    expect(home.recent_versions).toEqual([]);
    expect(home.active_versions).toEqual([]);
  });

  test('returns 3 completed versions when 3 are seeded', () => {
    seedCompleted(ctx, ctx.shotId);
    seedCompleted(ctx, ctx.shotId);
    seedCompleted(ctx, ctx.shotId);
    const home = ctx.engine.getDashboardHome();
    expect(home.recent_versions).toHaveLength(3);
    home.recent_versions.forEach((v) => expect(v.status).toBe('completed'));
  });

  test('separates active (submitted) from recent (completed)', () => {
    // 2 completed + 1 submitted.
    seedCompleted(ctx, ctx.shotId);
    seedCompleted(ctx, ctx.shotId);
    ctx.versions.insertVersion(ctx.shotId); // status='submitted', not completed
    const home = ctx.engine.getDashboardHome();
    expect(home.recent_versions).toHaveLength(2);
    home.recent_versions.forEach((v) => expect(v.status).toBe('completed'));
    expect(home.active_versions).toHaveLength(1);
    expect(home.active_versions[0].status).toBe('submitted');
  });
});
