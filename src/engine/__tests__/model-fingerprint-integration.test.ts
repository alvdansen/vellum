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
import { ProvenanceWriter } from '../provenance.js';
import { Engine } from '../pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';
import type { ModelRef } from '../../types/provenance.js';

/**
 * Phase 13 (PROV-V-03) — Plan 13-03 end-to-end integration tests.
 *
 * Drives the full submit→completed→fingerprint→diff chain against the
 * real Engine + ProvenanceRepo + ProvenanceWriter wiring with a fake
 * ComfyUI client. Proves:
 *  - Test 1: criterion #1 — populated model_hash when VELLUM_MODELS_DIR
 *            is set with fixture files.
 *  - Test 2: criterion #2 — every entry records 'models_dir_not_configured'
 *            when VELLUM_MODELS_DIR is unset.
 *  - Test 3: criterion #3 — content-addressed across versions (same bytes
 *            yield same hash regardless of version_id).
 *  - Test 4: diff path sees the post-fingerprint view (loadDiffSnapshot
 *            reads from getLatestFingerprints, so version.diff surfaces
 *            populated hashes).
 *  - Test 5: a hash → unavailable transition surfaces in version.diff
 *            after the fingerprinter persists differing reason codes
 *            across two versions.
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
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fp-int-${nanoid(6)}-`));
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

/** Insert a fresh version row + a 'completed' provenance event carrying
 *  the given ModelRef[] in models_json. Returns the new versionId. */
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

describe('Phase 13 (PROV-V-03) — submit→completed→fingerprint→diff integration', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('Test 1 (criterion #1): submit→completed→fingerprint flow populates model_hash when VELLUM_MODELS_DIR is set', async () => {
    // Build the D-CTX-2 layout: <modelsDir>/<subdir>/<basename(modelName)>
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fp-resolved-${nanoid(6)}-`));
    try {
      await fsp.mkdir(pth.join(tmp, 'checkpoints'), { recursive: true });
      await fsp.mkdir(pth.join(tmp, 'loras'), { recursive: true });
      await fsp.writeFile(pth.join(tmp, 'checkpoints', 'sd.safetensors'), 'test-bytes');
      await fsp.writeFile(pth.join(tmp, 'loras', 'style_a.safetensors'), 'lora-bytes');

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
          model_name: 'style_a.safetensors',
          model_hash: null,
          model_hash_unavailable: null,
        },
      ];
      const versionId = seedCompletedWithModels(ctx, models);

      // Drive the fingerprinter directly — Plan 13-02's hot-path-isolation
      // test already proves the hook fires; here we want a deterministic
      // post-fingerprint state to inspect.
      await ctx.engine.fingerprintModelsForVersion(versionId);

      const events = ctx.provenanceRepo.getEventsForVersion(versionId);
      const fp = events.find((e) => e.event_type === 'models_fingerprinted');
      expect(fp).toBeDefined();

      const persisted = ctx.provenanceRepo.getLatestFingerprints(versionId);
      expect(persisted).not.toBeNull();
      expect(persisted!).toHaveLength(2);
      for (const entry of persisted!) {
        expect(entry.model_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.model_hash_unavailable).toBeNull();
      }
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  test('Test 2 (criterion #2): submit→completed→fingerprint flow records models_dir_not_configured when VELLUM_MODELS_DIR is unset', async () => {
    ctx = await setupEngine({ modelsDir: null });
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
        model_name: 'style_a.safetensors',
        model_hash: null,
        model_hash_unavailable: null,
      },
    ];
    const versionId = seedCompletedWithModels(ctx, models);

    await ctx.engine.fingerprintModelsForVersion(versionId);

    const persisted = ctx.provenanceRepo.getLatestFingerprints(versionId);
    expect(persisted).not.toBeNull();
    expect(persisted!).toHaveLength(2);
    for (const entry of persisted!) {
      expect(entry.model_hash).toBeNull();
      expect(entry.model_hash_unavailable).toBe('models_dir_not_configured');
    }
  });

  test('Test 3 (criterion #3): two versions referencing the same checkpoint produce identical model_hash entries', async () => {
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fp-content-${nanoid(6)}-`));
    try {
      await fsp.mkdir(pth.join(tmp, 'checkpoints'), { recursive: true });
      // Stable bytes — same file referenced from both versions.
      await fsp.writeFile(pth.join(tmp, 'checkpoints', 'shared.safetensors'), 'shared-content');

      ctx = await setupEngine({ modelsDir: tmp });
      const refModels: ModelRef[] = [
        {
          node_id: '4',
          class_type: 'CheckpointLoaderSimple',
          model_name: 'shared.safetensors',
          model_hash: null,
          model_hash_unavailable: null,
        },
      ];
      const v1Id = seedCompletedWithModels(ctx, refModels);
      const v2Id = seedCompletedWithModels(ctx, refModels);

      await ctx.engine.fingerprintModelsForVersion(v1Id);
      await ctx.engine.fingerprintModelsForVersion(v2Id);

      const v1 = ctx.provenanceRepo.getLatestFingerprints(v1Id);
      const v2 = ctx.provenanceRepo.getLatestFingerprints(v2Id);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
      expect(v1![0]!.model_hash).toMatch(/^[0-9a-f]{64}$/);
      // Same bytes → same hash, regardless of version_id.
      expect(v1![0]!.model_hash).toBe(v2![0]!.model_hash);
      expect(v1![0]!.model_hash_unavailable).toBeNull();
      expect(v2![0]!.model_hash_unavailable).toBeNull();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  test('Test 4 (diff boundary): engine.diffVersions reads populated hashes after fingerprinter runs', async () => {
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fp-diff-${nanoid(6)}-`));
    try {
      await fsp.mkdir(pth.join(tmp, 'checkpoints'), { recursive: true });
      // Two distinct files so the model_name differs across versions.
      await fsp.writeFile(pth.join(tmp, 'checkpoints', 'sd_a.safetensors'), 'bytes-a');
      await fsp.writeFile(pth.join(tmp, 'checkpoints', 'sd_b.safetensors'), 'bytes-b');

      ctx = await setupEngine({ modelsDir: tmp });
      const wf = { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } };

      // Insert two version rows in the SAME shot, each with a 'completed'
      // event carrying its own loader. workflow_json (on the submit event)
      // and prompt_json (on the completed event) need to match the same
      // shape so diffVersions has comparable blobs to walk.
      const v1Row = ctx.versions.insertVersion(ctx.shotId);
      ctx.provenanceWriter.writeSubmitEvent(v1Row.id, wf);
      ctx.provenanceRepo.insertEvent(v1Row.id, {
        event_type: 'completed',
        prompt_json: JSON.stringify(wf),
        seed: null,
        models_json: JSON.stringify([
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd_a.safetensors',
            model_hash: null,
            model_hash_unavailable: null,
          },
        ]),
        outputs_json: '[]',
      });
      ctx.versions.markCompleted(v1Row.id, '[]');

      const v2Row = ctx.versions.insertVersion(ctx.shotId);
      ctx.provenanceWriter.writeSubmitEvent(v2Row.id, wf);
      ctx.provenanceRepo.insertEvent(v2Row.id, {
        event_type: 'completed',
        prompt_json: JSON.stringify(wf),
        seed: null,
        models_json: JSON.stringify([
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd_b.safetensors',
            model_hash: null,
            model_hash_unavailable: null,
          },
        ]),
        outputs_json: '[]',
      });
      ctx.versions.markCompleted(v2Row.id, '[]');

      // Run the fingerprinter for both versions so the sibling
      // 'models_fingerprinted' events exist with populated hashes.
      await ctx.engine.fingerprintModelsForVersion(v1Row.id);
      await ctx.engine.fingerprintModelsForVersion(v2Row.id);

      const result = await ctx.engine.diffVersions(v1Row.id, v2Row.id);
      expect(result.changes.models).toHaveLength(1);
      const change = result.changes.models[0]!;
      // CRITICAL: loadDiffSnapshot reads from getLatestFingerprints, so
      // BOTH sides have populated hashes (lowercase 64-hex) AND null
      // hash_unavailable. If loadDiffSnapshot still read raw
      // completed_event.models_json, both sides would carry hash=null.
      expect(change.before.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(change.after.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(change.before.hash_unavailable).toBeNull();
      expect(change.after.hash_unavailable).toBeNull();
      expect(change.before.name).toBe('sd_a.safetensors');
      expect(change.after.name).toBe('sd_b.safetensors');
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  test('Test 5 (mixed state in diff): a hash → unavailable transition surfaces in version.diff', async () => {
    // v1: modelsDir set with a fixture file → fingerprint populates model_hash.
    // v2: same shot, same loader; we directly persist a 'models_fingerprinted'
    //     event with model_hash_unavailable: 'models_dir_not_configured' to
    //     simulate the "Cloud-only / unset modelsDir" state. (A second engine
    //     instance with modelsDir=null could produce the same artifact, but
    //     persisting the sibling event directly makes the assertion crisp
    //     and avoids a dependency on per-engine env state.)
    const tmp = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-fp-mixed-${nanoid(6)}-`));
    try {
      await fsp.mkdir(pth.join(tmp, 'checkpoints'), { recursive: true });
      await fsp.writeFile(pth.join(tmp, 'checkpoints', 'sd.safetensors'), 'mixed-bytes');

      ctx = await setupEngine({ modelsDir: tmp });
      const wf = { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } };

      // v1 — full happy path through the fingerprinter.
      const v1Row = ctx.versions.insertVersion(ctx.shotId);
      ctx.provenanceWriter.writeSubmitEvent(v1Row.id, wf);
      ctx.provenanceRepo.insertEvent(v1Row.id, {
        event_type: 'completed',
        prompt_json: JSON.stringify(wf),
        seed: null,
        models_json: JSON.stringify([
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: null,
            model_hash_unavailable: null,
          },
        ]),
        outputs_json: '[]',
      });
      ctx.versions.markCompleted(v1Row.id, '[]');
      await ctx.engine.fingerprintModelsForVersion(v1Row.id);

      // v2 — submit + completed event, then directly persist the sibling
      // 'models_fingerprinted' event with the unavailable shape.
      const v2Row = ctx.versions.insertVersion(ctx.shotId);
      ctx.provenanceWriter.writeSubmitEvent(v2Row.id, wf);
      ctx.provenanceRepo.insertEvent(v2Row.id, {
        event_type: 'completed',
        prompt_json: JSON.stringify(wf),
        seed: null,
        models_json: JSON.stringify([
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: null,
            model_hash_unavailable: null,
          },
        ]),
        outputs_json: '[]',
      });
      ctx.versions.markCompleted(v2Row.id, '[]');
      ctx.provenanceRepo.appendModelsFingerprintedEvent(v2Row.id, [
        {
          node_id: '4',
          class_type: 'CheckpointLoaderSimple',
          model_name: 'sd.safetensors',
          model_hash: null,
          model_hash_unavailable: 'models_dir_not_configured',
        },
      ]);

      const result = await ctx.engine.diffVersions(v1Row.id, v2Row.id);
      expect(result.changes.models).toHaveLength(1);
      const change = result.changes.models[0]!;
      expect(change.before.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(change.before.hash_unavailable).toBeNull();
      expect(change.after.hash).toBeNull();
      expect(change.after.hash_unavailable).toBe('models_dir_not_configured');
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
