/**
 * Phase 15 / Plan 15-04 Task 1 — End-to-end ingredient-graph traceback.
 *
 * ROADMAP success criterion #4 closure at the integration boundary:
 *   v1 (top-of-lineage) → v2 (iterate-from-v1 + LoadImage control image) →
 *   v3 (iterate-from-v2). Read v3's signed bytes via createC2pa().read() and
 *   walk `manifest.ingredients[]` to verify the chain back through v2 → v1.
 *
 * REVISION (per plan-checker B1): the previous draft tried to walk
 * assertions[] looking for entries whose label matched the legacy ingredient
 * label string. That was wrong — c2pa-node v0.5.x exposes ingredients via
 * `manifest.ingredients[]` (a top-level ResolvedIngredient array on the
 * Manifest object), NOT inside assertions[]. This test reads through the
 * CORRECT API surface:
 *
 *   const c2pa = createC2pa();
 *   const result = await c2pa.read({ buffer, mimeType: 'image/png' });
 *   const manifest = result!.active_manifest;
 *   const ingredients = manifest!.ingredients ?? [];
 *   const parentOf = ingredients.find((i) => i.relationship === 'parentOf');
 *   const componentOf = ingredients.find((i) => i.relationship === 'componentOf');
 *
 * The vellum.input + vellum.unavailable_ingredient assertions
 * stay in `manifest.assertions[]` — that's the audit channel. parentOf +
 * componentOf flow via c2pa-node's manifestBuilder.addIngredient so they
 * surface on `manifest.ingredients[]` instead.
 *
 * Architectural note: the GenerationEngine post-completion path normally
 * produces the `completed` event + outputs_json + the on-disk file. For
 * this fixture we shortcut through Engine API surfaces (insertVersion +
 * markCompleted + provenanceRepo.insertEvent) to drive the post-completion
 * state directly. The Plan 15-03 wire-level UAT (C6-1/C6-2) already proves
 * the FakeComfyUIClient submit-cycle path. This e2e test focuses on the
 * v1→v2→v3 lineage traceback through the manifest read-back surface.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { createC2pa } from 'c2pa-node';
import { makeInMemoryDb } from '../test-utils/fixtures.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { ProvenanceRepo } from '../store/provenance-repo.js';
import { ProvenanceWriter } from '../engine/provenance.js';
import { Engine } from '../engine/pipeline.js';
import { FakeComfyUIClient } from '../test-utils/fake-comfyui-client.js';
import { __resetC2paNodeStateForTests } from '../engine/c2pa/signer.js';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { C2paConfig } from '../types/c2pa.js';

const haveOpenssl = (() => {
  try {
    execFileSync('which', ['openssl'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// c2pa-node bundled test cert chain (proper trust chain — c2pa-rs rejects
// self-signed dev certs).
const BUNDLED_CERT_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pub');
const BUNDLED_KEY_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pem');

const REAL_C2PA_CONFIG: C2paConfig = {
  certPemPath: BUNDLED_CERT_PATH,
  privateKeyPemPath: BUNDLED_KEY_PATH,
  // c2pa-node v0.5.26 binding bug — needs valid TSA URL or omitted property.
  tsaUrl: 'http://timestamp.digicert.com',
};

// Distinct VALID PNGs for v1, v2, v3, and the control image. Generated via
// Node zlib (proper PNG signature + IHDR + valid IDAT chunk + IEND with CRC32).
// Distinct sizes (2x2, 3x3, 4x4, 2x2-gray) ensure c2pa-rs computes distinct
// labeled hashes for each ingredient and signing asset; distinct bytes also
// prevent ingredient-graph hash deduplication. Mirrors the ALT_PNG generation
// pattern from Plan 15-03's pipeline-c2pa-ingredients.test.ts.
const V1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=',
  'base64',
);
const V2_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAADklEQVR4nGNg+I8EcXIAVOAR72v4UrQAAAAASUVORK5CYII=',
  'base64',
);
const V3_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEUlEQVR4nGNgYPj/HxWTLAAAHGAf4baQ7OcAAAAASUVORK5CYII=',
  'base64',
);
const CONTROL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNoaGj4D8IMMAYAVvQJ/UtL6SwAAAAASUVORK5CYII=',
  'base64',
);

interface TestCtx {
  engine: Engine;
  hierarchy: HierarchyRepo;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  shotId: string;
  outputsDir: string;
  cleanup: () => Promise<void>;
}

async function setupTestEngine(): Promise<TestCtx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const fake = new FakeComfyUIClient();
  const outputsDir = await mkdtemp(join(tmpdir(), `vfx-c2pa-e2e-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    outputsDir,
    {
      maxConcurrentPollers: 1,
      c2paConfig: REAL_C2PA_CONFIG,
    },
  );
  const ws = hierarchy.createWorkspace(`ws-e2e-${nanoid(4)}`);
  const proj = hierarchy.createProject(ws.id, 'p_e2e');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  return {
    engine,
    hierarchy,
    versions,
    provenanceRepo,
    shotId: shot.id,
    outputsDir,
    cleanup: async (): Promise<void> => {
      await engine.stop();
      await rm(outputsDir, { recursive: true, force: true });
      __resetC2paNodeStateForTests();
    },
  };
}

/**
 * Seed a "completed" version with the given prompt blob + outputs_json.
 * Mirrors the production post-completion state (Plan 15-03 pattern):
 * insertVersion + ProvenanceWriter.writeSubmitEvent + insertEvent('completed')
 * + markCompleted(outputsJson). Returns the version id.
 */
function seedCompletedVersion(
  ctx: TestCtx,
  options: {
    promptBlob: Record<string, unknown>;
    seed: number | null;
    filename: string;
    parentVersionId?: string;
    lineageType?: 'reproduce' | 'iterate';
  },
): string {
  const lineage = options.parentVersionId !== undefined
    ? { parent_version_id: options.parentVersionId, lineage_type: options.lineageType ?? 'iterate' }
    : undefined;
  const ver = ctx.versions.insertVersion(ctx.shotId, undefined, lineage);
  const writer = new ProvenanceWriter(ctx.provenanceRepo);
  writer.writeSubmitEvent(ver.id, options.promptBlob);
  const outputs = [
    {
      filename: options.filename,
      path: join(ctx.outputsDir, ver.id, options.filename),
      url: `https://fake/${options.filename}`,
      content_type: 'image/png',
      size_bytes: V1_PNG.length,
    },
  ];
  ctx.provenanceRepo.insertEvent(ver.id, {
    event_type: 'completed',
    prompt_json: JSON.stringify(options.promptBlob),
    seed: options.seed,
    models_json: '[]',
    outputs_json: JSON.stringify(outputs),
  });
  ctx.versions.markCompleted(ver.id, JSON.stringify(outputs));
  return ver.id;
}

// ──────────────────────────────────────────────────────────────────────────
// E2E v1 → v2 → v3 traceback (criterion #4)
// ──────────────────────────────────────────────────────────────────────────

describe.skipIf(!haveOpenssl)('Phase 15 Plan 15-04 E2E — v1 → v2 → v3 ingredient-graph traceback (criterion #4)', () => {
  let ctx: TestCtx;
  let v1Id: string;
  let v2Id: string;
  let v3Id: string;
  let v1Signed: Buffer;
  let v2Signed: Buffer;
  let v3Signed: Buffer;

  beforeAll(async () => {
    ctx = await setupTestEngine();

    // ── v1: top-of-lineage. No parent, no components. Just a KSampler +
    // CLIPTextEncode pair so the inputTo lands cleanly.
    const v1Prompt = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a regulator-verifiable image' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'low quality' } },
      '3': {
        class_type: 'KSampler',
        inputs: {
          positive: ['1', 0],
          negative: ['2', 0],
          seed: 1001,
          steps: 20,
          cfg: 7.0,
          denoise: 1.0,
          sampler_name: 'euler',
          scheduler: 'normal',
        },
      },
    };
    v1Id = seedCompletedVersion(ctx, { promptBlob: v1Prompt, seed: 1001, filename: 'out.png' });
    const v1Result = await ctx.engine.signOutput(v1Id, 'out.png', { bytes: V1_PNG });
    expect(v1Result.signed).not.toBeNull();
    v1Signed = v1Result.signed!;

    // Persist v1's signed bytes at outputRoot/<v1>/out.png so v2's parentOf
    // createIngredient can read them. (The downloader hook does this in
    // production — the test mirrors the production flow.)
    const v1Dir = join(ctx.outputsDir, v1Id);
    await mkdir(v1Dir, { recursive: true });
    await writeFile(join(v1Dir, 'out.png'), v1Signed);

    // ── v2: iterate-from-v1 with a LoadImage control + ControlNetApply edge
    // walk. Pre-write the control image to outputRoot/<v2>/control.png so the
    // componentOf createIngredient can read it.
    const v2Prompt = {
      '4': { class_type: 'LoadImage', inputs: { image: 'control.png' } },
      '5': { class_type: 'ControlNetApply', inputs: { image: ['4', 0], strength: 1.0 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'iteration with control' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'unwanted artifacts' } },
      '8': {
        class_type: 'KSampler',
        inputs: {
          positive: ['6', 0],
          negative: ['7', 0],
          seed: 1002,
          steps: 25,
          cfg: 7.5,
          denoise: 0.85,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
        },
      },
    };
    v2Id = seedCompletedVersion(ctx, {
      promptBlob: v2Prompt,
      seed: 1002,
      filename: 'out.png',
      parentVersionId: v1Id,
      lineageType: 'iterate',
    });
    const v2Dir = join(ctx.outputsDir, v2Id);
    await mkdir(v2Dir, { recursive: true });
    await writeFile(join(v2Dir, 'control.png'), CONTROL_PNG);

    const v2Result = await ctx.engine.signOutput(v2Id, 'out.png', { bytes: V2_PNG });
    expect(v2Result.signed).not.toBeNull();
    v2Signed = v2Result.signed!;
    // Persist v2's signed bytes at outputRoot/<v2>/out.png for v3's parentOf
    // lookup.
    await writeFile(join(v2Dir, 'out.png'), v2Signed);

    // ── v3: iterate-from-v2 with seed override. No new component image —
    // just lineage + inputTo. Verifies the parentOf chain reaches v2.
    const v3Prompt = {
      '9': { class_type: 'CLIPTextEncode', inputs: { text: 'final iteration' } },
      '10': { class_type: 'CLIPTextEncode', inputs: { text: 'discard' } },
      '11': {
        class_type: 'KSampler',
        inputs: {
          positive: ['9', 0],
          negative: ['10', 0],
          seed: 999,
          steps: 30,
          cfg: 8.0,
          denoise: 1.0,
          sampler_name: 'euler_ancestral',
          scheduler: 'normal',
        },
      },
    };
    v3Id = seedCompletedVersion(ctx, {
      promptBlob: v3Prompt,
      seed: 999,
      filename: 'out.png',
      parentVersionId: v2Id,
      lineageType: 'iterate',
    });
    const v3Result = await ctx.engine.signOutput(v3Id, 'out.png', { bytes: V3_PNG });
    expect(v3Result.signed).not.toBeNull();
    v3Signed = v3Result.signed!;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 1 (criterion #4): v3 manifest carries parentOf → v2 via manifest.ingredients[] (NOT assertions[])', async () => {
    const c2pa = createC2pa();
    const v3Store = await c2pa.read({ buffer: v3Signed, mimeType: 'image/png' });
    expect(v3Store).not.toBeNull();
    const v3Manifest = v3Store!.active_manifest;
    expect(v3Manifest).not.toBeNull();

    const v3Ingredients = v3Manifest!.ingredients ?? [];
    expect(v3Ingredients.length).toBeGreaterThanOrEqual(1);

    const v3Parent = v3Ingredients.find((i) => i.relationship === 'parentOf');
    expect(v3Parent).toBeDefined();
    // Title format from buildManifestWithIngredients: "Parent <version_id>".
    expect(v3Parent!.title).toContain(v2Id);
    // c2pa-rs labels addIngredient-emitted entries as c2pa.ingredient.v2 (with
    // a __N suffix when multiple ingredients exist) — proves the ingredient
    // came from manifestBuilder.addIngredient (NOT from a legacy c2pa.ingredient
    // assertion in assertions[]).
    expect(v3Parent!.label).toMatch(/^c2pa\.ingredient\.v2(?:__\d+)?$/);
    // instance_id is xmp:iid:<uuid> — c2pa-rs autogenerates per ingredient.
    // The xmp:iid acts as the binding instance identifier (the labeled SHA is
    // computed at sign time but is NOT surfaced on the resolved ingredient by
    // c2pa-node v0.5.x — the cryptographic binding lives in the JUMBF box's
    // c2pa.hash.data assertion which c2pa-rs validates internally).
    expect(v3Parent!.instance_id).toMatch(/^xmp:iid:/);
    // format reflects the parent asset's MIME type (image/png).
    expect(v3Parent!.format).toBe('image/png');
  });

  it('Test 2 (criterion #4): v2 manifest carries parentOf → v1 AND componentOf → control.png via manifest.ingredients[]', async () => {
    const c2pa = createC2pa();
    const v2Store = await c2pa.read({ buffer: v2Signed, mimeType: 'image/png' });
    expect(v2Store).not.toBeNull();
    const v2Manifest = v2Store!.active_manifest;
    expect(v2Manifest).not.toBeNull();

    const v2Ingredients = v2Manifest!.ingredients ?? [];
    // v2 has BOTH a parentOf (v1) AND componentOf entries (the LoadImage and the
    // ControlNetApply edge-tuple resolve to the same filename, but each lands as
    // its own ingredient since they're indexed by node_id in the spec map).
    expect(v2Ingredients.length).toBeGreaterThanOrEqual(2);

    const v2Parent = v2Ingredients.find((i) => i.relationship === 'parentOf');
    expect(v2Parent).toBeDefined();
    expect(v2Parent!.title).toContain(v1Id);
    expect(v2Parent!.label).toMatch(/^c2pa\.ingredient\.v2(?:__\d+)?$/);
    expect(v2Parent!.instance_id).toMatch(/^xmp:iid:/);

    // componentOf — at least one entry pointing at control.png.
    const v2Components = v2Ingredients.filter((i) => i.relationship === 'componentOf');
    expect(v2Components.length).toBeGreaterThanOrEqual(1);
    const controlIngredient = v2Components.find((i) => (i.title ?? '').includes('control.png'));
    expect(controlIngredient).toBeDefined();
    // c2pa-rs labels multi-ingredient entries with a `__N` suffix on subsequent
    // entries (the first is c2pa.ingredient.v2; the second becomes
    // c2pa.ingredient.v2__1, etc.). Match the prefix so any suffix is accepted.
    expect(controlIngredient!.label).toMatch(/^c2pa\.ingredient\.v2(?:__\d+)?$/);
    expect(controlIngredient!.instance_id).toMatch(/^xmp:iid:/);
  });

  it('Test 3 (criterion #4): v2 manifest_signed event ingredients_summary records parent_count=1 + component_count>=1 + unavailable_count=0', () => {
    const v2Event = ctx.engine.getC2paStatusForVersion(v2Id, 'out.png');
    expect(v2Event).not.toBeNull();
    expect(v2Event!.signed).toBe(true);
    expect(v2Event!.ingredients_summary).toBeDefined();
    expect(v2Event!.ingredients_summary!.parent_count).toBe(1);
    expect(v2Event!.ingredients_summary!.component_count).toBeGreaterThanOrEqual(1);
    expect(v2Event!.ingredients_summary!.input_assertion).toBe(true);
    expect(v2Event!.ingredients_summary!.unavailable_count).toBe(0);
  });

  it('Test 4 (criterion #4): v1 manifest has NO parentOf (top-of-lineage)', async () => {
    const c2pa = createC2pa();
    const v1Store = await c2pa.read({ buffer: v1Signed, mimeType: 'image/png' });
    expect(v1Store).not.toBeNull();
    const v1Manifest = v1Store!.active_manifest;
    expect(v1Manifest).not.toBeNull();
    const v1Ingredients = v1Manifest!.ingredients ?? [];
    const v1Parent = v1Ingredients.find((i) => i.relationship === 'parentOf');
    expect(v1Parent).toBeUndefined();
  });

  it('Test 5 (criterion #4): v1, v2, v3 all carry vellum.input in assertions[] (audit channel separate from ingredients[])', async () => {
    const c2pa = createC2pa();
    const v1Store = await c2pa.read({ buffer: v1Signed, mimeType: 'image/png' });
    const v2Store = await c2pa.read({ buffer: v2Signed, mimeType: 'image/png' });
    const v3Store = await c2pa.read({ buffer: v3Signed, mimeType: 'image/png' });

    for (const store of [v1Store, v2Store, v3Store]) {
      expect(store).not.toBeNull();
      const manifest = store!.active_manifest;
      expect(manifest).not.toBeNull();
      const assertions = (manifest!.assertions ?? []) as Array<{ label?: string; data?: unknown }>;
      const inputAssertion = assertions.find((a) => a.label?.startsWith('vellum.input'));
      expect(inputAssertion).toBeDefined();
    }
  });

  it('Test 6 (criterion #4): v3 inputTo data carries v3-specific seed + sampler params (proves per-version inputTo, not parent leakage)', async () => {
    const c2pa = createC2pa();
    const v3Store = await c2pa.read({ buffer: v3Signed, mimeType: 'image/png' });
    const assertions = (v3Store!.active_manifest!.assertions ?? []) as Array<{
      label?: string;
      data?: {
        prompt_positive?: string;
        prompt_negative?: string;
        sampler?: { name?: string; steps?: number };
        seed?: number;
      };
    }>;
    const inputAssertion = assertions.find((a) => a.label?.startsWith('vellum.input'));
    expect(inputAssertion).toBeDefined();
    const data = inputAssertion!.data!;
    expect(data.prompt_positive).toBe('final iteration');
    expect(data.prompt_negative).toBe('discard');
    expect(data.sampler?.name).toBe('euler_ancestral');
    expect(data.sampler?.steps).toBe(30);
    expect(data.seed).toBe(999);
  });

  it('Test 7 (criterion #4): v3 manifest_signed event records manifest_sha256 + ingredients_summary.parent_count=1', () => {
    const v3Event = ctx.engine.getC2paStatusForVersion(v3Id, 'out.png');
    expect(v3Event).not.toBeNull();
    expect(v3Event!.signed).toBe(true);
    expect(v3Event!.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(v3Event!.ingredients_summary).toBeDefined();
    expect(v3Event!.ingredients_summary!.parent_count).toBe(1);
    expect(v3Event!.ingredients_summary!.input_assertion).toBe(true);
    expect(v3Event!.ingredients_summary!.unavailable_count).toBe(0);
  });

  it('Test 8 (criterion #4): per-child parent binding is distinct — v2 binds to v1, v3 binds to v2 (NOT the same instance)', async () => {
    // v2's manifest carries parentOf bound to v1's signed bytes; v3's manifest
    // carries parentOf bound to v2's signed bytes. Each child's parentOf is
    // independently constructed at sign time via c2pa-node's createIngredient
    // (which computes a labeledSha against the parent's signed bytes — but
    // that hash is NOT surfaced on the resolved ingredient by c2pa-node v0.5.x;
    // the cryptographic binding lives in the JUMBF box's c2pa.hash.data
    // assertion that c2pa-rs internally validates).
    //
    // What we CAN observe at the resolved-manifest layer: each child's parentOf
    // gets a unique instance_id (xmp:iid:<uuid> — c2pa-rs autogenerates per
    // ingredient at createIngredient time) AND its title points at a different
    // version_id. v2's parentOf.title contains v1Id; v3's parentOf.title
    // contains v2Id. This proves the parentOf chain is a real chain (NOT a
    // shared static reference).
    //
    // The cryptographic-hash binding is closed by Plan 14-05 c2pa-verification.test.ts
    // (Test 4 / Concern #8 + Test 17 tamper detection — proves c2pa.hash.data
    // binds the manifest to the asset bytes). Plan 15-04's job is to prove the
    // INGREDIENT GRAPH structure surfaces correctly to an independent reader.
    const c2pa = createC2pa();
    const v2Store = await c2pa.read({ buffer: v2Signed, mimeType: 'image/png' });
    const v3Store = await c2pa.read({ buffer: v3Signed, mimeType: 'image/png' });
    const v2Parent = (v2Store!.active_manifest!.ingredients ?? []).find(
      (i) => i.relationship === 'parentOf',
    );
    const v3Parent = (v3Store!.active_manifest!.ingredients ?? []).find(
      (i) => i.relationship === 'parentOf',
    );
    expect(v2Parent).toBeDefined();
    expect(v3Parent).toBeDefined();
    // Distinct instance_ids — c2pa-rs autogenerates a fresh xmp:iid per ingredient.
    expect(v2Parent!.instance_id).toMatch(/^xmp:iid:/);
    expect(v3Parent!.instance_id).toMatch(/^xmp:iid:/);
    expect(v2Parent!.instance_id).not.toBe(v3Parent!.instance_id);
    // Distinct titles — each child points at the correct parent version_id.
    expect(v2Parent!.title).toContain(v1Id);
    expect(v3Parent!.title).toContain(v2Id);
    expect(v2Parent!.title).not.toBe(v3Parent!.title);
  });

  it('Test 9 (criterion #4): architectural contract — manifest.assertions[] never carries the legacy c2pa-ingredient label form', async () => {
    // Lock the architectural contract that ingredients flow ONLY via
    // manifest.ingredients[] (c2pa-node's manifestBuilder.addIngredient path).
    // The plan-checker B1 caught the wrong-API draft of this plan; this test
    // makes the contract regression-proof at the cohort-test layer.
    //
    // We sweep manifest.assertions[] for any entry whose label starts with
    // 'c2pa.ingredient' — the legacy assertion-based ingredient form. None
    // should ever appear because Plan 15-02's manifest builder never emits
    // them and Plan 15-03's signer wires reachable ingredients through
    // manifestBuilder.addIngredient. (The vendor namespace
    // 'vellum.unavailable_ingredient' is intentionally distinct and
    // is the audit-channel for unreachable ingredient bytes.)
    const c2pa = createC2pa();
    const forbiddenPrefix = 'c2pa.ingredient';
    for (const buf of [v1Signed, v2Signed, v3Signed]) {
      const store = await c2pa.read({ buffer: buf, mimeType: 'image/png' });
      const assertions = (store!.active_manifest!.assertions ?? []) as Array<{
        label?: string;
      }>;
      const wrongShape = assertions.find(
        (a) => typeof a.label === 'string' && a.label.startsWith(forbiddenPrefix),
      );
      expect(wrongShape).toBeUndefined();
    }
  });
});
