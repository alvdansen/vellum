import { describe, test, expect, beforeEach, afterEach } from 'vitest';
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
import type { ModelRef } from '../../types/provenance.js';

/**
 * Engine.fingerprintModelsForVersion + completion-path-hook integration tests.
 *
 * Phase 13 (PROV-V-03) — Plan 13-02 Task 2.
 *
 * Covers:
 *  - Test 1: modelsDir=null → every entry records 'models_dir_not_configured'.
 *  - Test 2: modelsDir set with fixture files → model_hash populated (lowercase
 *            hex 64 chars).
 *  - Test 3: idempotency — second call is a no-op (only one fingerprinted event).
 *  - Test 4: hot-path isolation (criterion #4) — completion returns BEFORE the
 *            fingerprinted event row is appended.
 *  - Test 5: returns early on a pre-Phase-3 row (no completed event).
 *  - Test 6: empty models_json → records an empty fingerprinted event so
 *            idempotency holds even for the empty case.
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
  modelsDir: string | null;
  cleanup: () => Promise<void>;
};

async function setupEngine(options: { modelsDir?: string | null } = {}): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fp-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    tempRoot,
    { modelsDir: options.modelsDir ?? null, maxConcurrentPollers: 1 },
  );
  const ws = hierarchy.createWorkspace(`ws-${nanoid(4)}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  return {
    engine,
    hierarchy,
    versions,
    provenanceRepo,
    provenanceWriter,
    fake,
    shotId: shot.id,
    tempRoot,
    modelsDir: options.modelsDir ?? null,
    cleanup: async (): Promise<void> => {
      await engine.stop();
      await fsp.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

/** Seed a 'completed' provenance row for a fresh version with the given
 *  ModelRef[] in models_json. Returns the new versionId. */
function seedCompletedWithModels(ctx: Ctx, models: ModelRef[]): string {
  const row = ctx.versions.insertVersion(ctx.shotId);
  ctx.provenanceWriter.writeSubmitEvent(row.id, {});
  ctx.provenanceRepo.insertEvent(row.id, {
    event_type: 'completed',
    prompt_json: '{}',
    seed: null,
    models_json: JSON.stringify(models),
    outputs_json: '[]',
  });
  ctx.versions.markCompleted(row.id, '[]');
  return row.id;
}

describe('Engine.fingerprintModelsForVersion (Phase 13 PROV-V-03)', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('appends a sibling event when modelsDir is null — every entry records models_dir_not_configured', async () => {
    ctx = await setupEngine({ modelsDir: null });
    const models: ModelRef[] = [
      {
        node_id: '4',
        class_type: 'CheckpointLoaderSimple',
        model_name: 'sd_xl.safetensors',
        model_hash: null,
        model_hash_unavailable: null,
      },
      {
        node_id: '5',
        class_type: 'LoraLoader',
        model_name: 'a.safetensors',
        model_hash: null,
        model_hash_unavailable: null,
      },
    ];
    const versionId = seedCompletedWithModels(ctx, models);

    await ctx.engine.fingerprintModelsForVersion(versionId);

    const events = ctx.provenanceRepo.getEventsForVersion(versionId);
    const fp = events.find((e) => e.event_type === 'models_fingerprinted');
    expect(fp).toBeDefined();
    expect(fp!.models_json).not.toBeNull();
    const persisted = JSON.parse(fp!.models_json!) as ModelRef[];
    expect(persisted).toHaveLength(2);
    for (const entry of persisted) {
      expect(entry.model_hash).toBeNull();
      expect(entry.model_hash_unavailable).toBe('models_dir_not_configured');
    }
  });

  test('populates model_hash when modelsDir is set and files exist (content-addressed proof)', async () => {
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fp-models-${nanoid(6)}-`));
    try {
      // Build the D-CTX-2 layout: <modelsDir>/<subdir>/<modelName>
      await fsp.mkdir(pth.join(tmp, 'checkpoints'), { recursive: true });
      await fsp.mkdir(pth.join(tmp, 'loras'), { recursive: true });
      await fsp.writeFile(pth.join(tmp, 'checkpoints', 'sd.safetensors'), 'test');
      await fsp.writeFile(pth.join(tmp, 'loras', 'a.safetensors'), 'aaaa');

      ctx = await setupEngine({ modelsDir: tmp });
      const models: ModelRef[] = [
        {
          node_id: '4',
          class_type: 'CheckpointLoaderSimple',
          model_name: 'sd.safetensors',
          model_hash: null,
          model_hash_unavailable: null,
        },
        {
          node_id: '5',
          class_type: 'LoraLoader',
          model_name: 'a.safetensors',
          model_hash: null,
          model_hash_unavailable: null,
        },
      ];
      const versionId = seedCompletedWithModels(ctx, models);

      await ctx.engine.fingerprintModelsForVersion(versionId);

      const events = ctx.provenanceRepo.getEventsForVersion(versionId);
      const fp = events.find((e) => e.event_type === 'models_fingerprinted');
      expect(fp).toBeDefined();
      const persisted = JSON.parse(fp!.models_json!) as ModelRef[];
      expect(persisted).toHaveLength(2);
      for (const entry of persisted) {
        expect(entry.model_hash_unavailable).toBeNull();
        expect(entry.model_hash).not.toBeNull();
        // Lowercase hex SHA-256 — exactly 64 chars.
        expect(entry.model_hash).toMatch(/^[0-9a-f]{64}$/);
      }
      // Sanity: 'test' and 'aaaa' produce the well-known SHA-256 hashes.
      const checkpoint = persisted.find((p) => p.class_type === 'CheckpointLoaderSimple')!;
      const lora = persisted.find((p) => p.class_type === 'LoraLoader')!;
      expect(checkpoint.model_hash).toBe(
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      );
      expect(lora.model_hash).toBe(
        '61be55a8e2f6b4e172338bddf184d6dbee29c98853e0a0485ecee7f27b9af0b4',
      );
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  test('idempotent — second call is a no-op (exactly one models_fingerprinted event persists)', async () => {
    ctx = await setupEngine({ modelsDir: null });
    const versionId = seedCompletedWithModels(ctx, [
      {
        node_id: '4',
        class_type: 'CheckpointLoaderSimple',
        model_name: 'sd_xl.safetensors',
        model_hash: null,
        model_hash_unavailable: null,
      },
    ]);

    await ctx.engine.fingerprintModelsForVersion(versionId);
    await ctx.engine.fingerprintModelsForVersion(versionId);
    await ctx.engine.fingerprintModelsForVersion(versionId);

    const events = ctx.provenanceRepo.getEventsForVersion(versionId);
    const fingerprinted = events.filter((e) => e.event_type === 'models_fingerprinted');
    expect(fingerprinted).toHaveLength(1);
  });

  test('hot-path isolation (criterion #4) — completion returns BEFORE the fingerprint event is appended', async () => {
    // Build a fixture-filled modelsDir so the eventual hashes resolve.
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fp-hot-${nanoid(6)}-`));
    try {
      await fsp.mkdir(pth.join(tmp, 'checkpoints'), { recursive: true });
      await fsp.writeFile(pth.join(tmp, 'checkpoints', 'sd_xl.safetensors'), 'hotpath-fixture');

      ctx = await setupEngine({ modelsDir: tmp });
      // Configure the fake to return a resolved-prompt blob with one loader
      // node so extractModels emits exactly one ModelRef into the completed
      // event. The fingerprint hook will then resolve sd_xl.safetensors
      // against the fixture.
      ctx.fake.cannedPromptBlob = {
        '4': {
          class_type: 'CheckpointLoaderSimple',
          inputs: { ckpt_name: 'sd_xl.safetensors' },
        },
      };

      // Submit + status drive the completion path (downloadAndPersist).
      const submitted = await ctx.engine.submitGeneration(ctx.shotId, ctx.fake.cannedPromptBlob);
      const versionId = submitted.entity.id;

      // First status() → 'completed' (FakeComfyUIClient default scenario).
      const result = await ctx.engine.getGenerationStatus(versionId);
      expect(result.entity.status).toBe('completed');

      // CRITICAL ASSERTION (criterion #4): immediately after the await
      // resolves, no fingerprinted event must yet exist. The hook fired
      // from downloadAndPersist is `void`-wrapped, so the awaited call
      // returns before the Promise.all in fingerprintModelsForVersion
      // hits any microtask tick.
      const eventsAfterCompletion = ctx.provenanceRepo.getEventsForVersion(versionId);
      const fingerprintedAtCompletion = eventsAfterCompletion.filter(
        (e) => e.event_type === 'models_fingerprinted',
      );
      expect(fingerprintedAtCompletion).toHaveLength(0);

      // Now poll for the fingerprinted event (real interval, max 5s — this
      // is timing-resilient; we are NOT measuring "fingerprinter ran by
      // <wallclock-N-ms>" which would be flaky on slow CI).
      const start = Date.now();
      const TIMEOUT_MS = 5_000;
      const POLL_MS = 200;
      let appeared = false;
      while (Date.now() - start < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const e = ctx.provenanceRepo
          .getEventsForVersion(versionId)
          .filter((ev) => ev.event_type === 'models_fingerprinted');
        if (e.length === 1) {
          appeared = true;
          break;
        }
      }
      expect(appeared).toBe(true);
      // Final shape sanity — one entry, hash populated.
      const finalEvents = ctx.provenanceRepo.getEventsForVersion(versionId);
      const fp = finalEvents.find((e) => e.event_type === 'models_fingerprinted')!;
      const persisted = JSON.parse(fp.models_json!) as ModelRef[];
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.model_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(persisted[0]!.model_hash_unavailable).toBeNull();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  test('returns early on a pre-Phase-3 row (no completed event) — no fingerprinted event appended', async () => {
    ctx = await setupEngine({ modelsDir: null });
    const row = ctx.versions.insertVersion(ctx.shotId);
    // Only a 'submitted' event — never completed. Caller should be a no-op.
    ctx.provenanceWriter.writeSubmitEvent(row.id, {});

    await ctx.engine.fingerprintModelsForVersion(row.id);

    const events = ctx.provenanceRepo.getEventsForVersion(row.id);
    expect(events.map((e) => e.event_type)).toEqual(['submitted']);
  });

  test('records an empty fingerprinted event when models_json is an empty array (idempotency holds)', async () => {
    ctx = await setupEngine({ modelsDir: null });
    const versionId = seedCompletedWithModels(ctx, []);

    await ctx.engine.fingerprintModelsForVersion(versionId);
    const eventsFirst = ctx.provenanceRepo.getEventsForVersion(versionId);
    const fpFirst = eventsFirst.filter((e) => e.event_type === 'models_fingerprinted');
    expect(fpFirst).toHaveLength(1);
    expect(fpFirst[0]!.models_json).toBe('[]');

    // Second call — must remain a no-op.
    await ctx.engine.fingerprintModelsForVersion(versionId);
    const eventsSecond = ctx.provenanceRepo.getEventsForVersion(versionId);
    const fpSecond = eventsSecond.filter((e) => e.event_type === 'models_fingerprinted');
    expect(fpSecond).toHaveLength(1);
  });
});
