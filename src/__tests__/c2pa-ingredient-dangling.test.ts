/**
 * Phase 15 / Plan 15-04 Task 2 — Dangling-reference test (criterion #5).
 *
 * ROADMAP success criterion #5 closure at the integration boundary:
 *   When an ingredient's source artifact is unreachable (e.g., the control
 *   image was deleted from disk after generation), the manifest records the
 *   dangling-reference state via the vendor-namespaced
 *   `vellum.unavailable_ingredient` custom assertion in
 *   `manifest.assertions[]` — NOT silently dropping the ingredient.
 *
 * Architectural reasoning (Plan 15-02 + 15-03):
 *   c2pa-node v0.5.x's createIngredient REQUIRES asset bytes (BufferAsset or
 *   FileAsset — bindings.create_ingredient(asset) is always called, even when
 *   a precomputed `hash` is supplied). NO public API exists to construct a
 *   c2pa.ingredient entry purely from a hash. Therefore, when bytes are
 *   unreachable, the dangling state CANNOT be recorded in
 *   `manifest.ingredients[]` — the vendor `vellum.unavailable_ingredient`
 *   assertion in `manifest.assertions[]` is the only viable audit channel.
 *
 * This test asserts:
 *   1. The vendor unavailable_ingredient assertion EXISTS in assertions[].
 *   2. The assertion's data carries relationship='componentOf',
 *      reason='file_not_found', and metadata.input_filename='control.png'
 *      (basename only — T-15-04 stripToBasename defence-in-depth).
 *   3. manifest.ingredients[] does NOT carry a componentOf entry for the
 *      missing file (architectural constraint).
 *   4. The manifest_signed event payload's ingredients_summary records
 *      component_count=1 + unavailable_count=1 (audit reconstructable
 *      without parsing the full bytes).
 *
 * The Plan 15-03 engine-layer test pipeline-c2pa-ingredients.test.ts (Test E6
 * + C6-2) already proves the same outcome at the engine layer; this test
 * exercises it at the cohort-test (read-back) layer.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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

const BUNDLED_CERT_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pub');
const BUNDLED_KEY_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pem');

const REAL_C2PA_CONFIG: C2paConfig = {
  certPemPath: BUNDLED_CERT_PATH,
  privateKeyPemPath: BUNDLED_KEY_PATH,
  tsaUrl: 'http://timestamp.digicert.com',
};

// Valid 2x2 RGBA PNG fixture — proper IHDR + valid IDAT + IEND.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=',
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
  const outputsDir = await mkdtemp(join(tmpdir(), `vfx-c2pa-dangling-${nanoid(6)}-`));
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
  const ws = hierarchy.createWorkspace(`ws-dangling-${nanoid(4)}`);
  const proj = hierarchy.createProject(ws.id, 'p_dangling');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh020');
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
 * Seed a "completed" version whose prompt blob references a LoadImage node
 * pointing at a filename that is NOT pre-written to disk. The dangling-
 * reference outcome is the criterion #5 invariant being exercised.
 */
function seedDanglingVersion(
  ctx: TestCtx,
  options: { promptBlob: Record<string, unknown>; seed: number | null; filename: string },
): string {
  const ver = ctx.versions.insertVersion(ctx.shotId);
  const writer = new ProvenanceWriter(ctx.provenanceRepo);
  writer.writeSubmitEvent(ver.id, options.promptBlob);
  const outputs = [
    {
      filename: options.filename,
      path: join(ctx.outputsDir, ver.id, options.filename),
      url: `https://fake/${options.filename}`,
      content_type: 'image/png',
      size_bytes: TINY_PNG.length,
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
// Dangling-reference test (criterion #5)
// ──────────────────────────────────────────────────────────────────────────

describe.skipIf(!haveOpenssl)('Phase 15 Plan 15-04 Test 2 — dangling-reference (criterion #5)', () => {
  let ctx: TestCtx;
  let signedBytes: Buffer;
  let versionId: string;

  beforeAll(async () => {
    ctx = await setupTestEngine();
    // Workflow with a LoadImage node referencing 'control.png' but NO file is
    // pre-written to outputRoot/<versionId>/control.png. The signOutput call
    // must record the dangling state via vellum.unavailable_ingredient.
    const promptBlob = {
      '5': { class_type: 'LoadImage', inputs: { image: 'control.png' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a missing-control test' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'noise' } },
      '8': {
        class_type: 'KSampler',
        inputs: {
          positive: ['6', 0],
          negative: ['7', 0],
          seed: 42,
          steps: 10,
          cfg: 7.0,
          denoise: 1.0,
          sampler_name: 'euler',
          scheduler: 'normal',
        },
      },
    };
    versionId = seedDanglingVersion(ctx, { promptBlob, seed: 42, filename: 'out.png' });
    // Sign WITHOUT writing control.png to disk — the dangling-reference state.
    const result = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).not.toBeNull();
    signedBytes = result.signed!;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 1 (criterion #5): manifest.assertions[] carries vellum.unavailable_ingredient with reason=file_not_found', async () => {
    const c2pa = createC2pa();
    const store = await c2pa.read({ buffer: signedBytes, mimeType: 'image/png' });
    expect(store).not.toBeNull();
    const manifest = store!.active_manifest;
    expect(manifest).not.toBeNull();

    const assertions = (manifest!.assertions ?? []) as Array<{
      label?: string;
      data?: {
        relationship?: string;
        title?: string;
        reason?: string;
        metadata?: Record<string, unknown>;
      };
    }>;

    // Find the vendor unavailable_ingredient assertion. Plan 15-02 emits one
    // entry per unreachable ingredient — the LoadImage that referenced
    // 'control.png' lands here.
    const unavailable = assertions.find(
      (a) => a.label?.startsWith('vellum.unavailable_ingredient'),
    );
    expect(unavailable).toBeDefined();
    expect(unavailable!.data).toBeDefined();
    expect(unavailable!.data!.relationship).toBe('componentOf');
    expect(unavailable!.data!.reason).toBe('file_not_found');
    expect(unavailable!.data!.metadata).toBeDefined();
    expect(unavailable!.data!.metadata!.input_filename).toBe('control.png');
  });

  it('Test 2 (criterion #5): manifest.ingredients[] does NOT carry a componentOf entry for the missing file', async () => {
    // Architectural constraint — c2pa-node's createIngredient REQUIRES asset
    // bytes. When the file is missing, the dangling state CANNOT live in
    // manifest.ingredients[]; the vendor unavailable_ingredient assertion is
    // the audit channel. This test locks that contract.
    const c2pa = createC2pa();
    const store = await c2pa.read({ buffer: signedBytes, mimeType: 'image/png' });
    const ingredients = store!.active_manifest!.ingredients ?? [];
    const componentOf = ingredients.find((i) => i.relationship === 'componentOf');
    expect(componentOf).toBeUndefined();
  });

  it('Test 3 (criterion #5): manifest_signed event ingredients_summary records component_count=1 + unavailable_count=1', () => {
    const event = ctx.engine.getC2paStatusForVersion(versionId, 'out.png');
    expect(event).not.toBeNull();
    expect(event!.signed).toBe(true);
    expect(event!.ingredients_summary).toBeDefined();
    expect(event!.ingredients_summary!.component_count).toBe(1);
    expect(event!.ingredients_summary!.unavailable_count).toBe(1);
    expect(event!.ingredients_summary!.parent_count).toBe(0);
    // input_assertion is always true on success paths (Plan 15-03 contract).
    expect(event!.ingredients_summary!.input_assertion).toBe(true);
  });

  it('Test 4 (criterion #5): manifest still carries vellum.input — dangling-component does NOT poison inputTo', async () => {
    // Defensive check: the unavailable component must not corrupt the input
    // assertion. Both should coexist in assertions[] independently.
    const c2pa = createC2pa();
    const store = await c2pa.read({ buffer: signedBytes, mimeType: 'image/png' });
    const assertions = (store!.active_manifest!.assertions ?? []) as Array<{
      label?: string;
      data?: { prompt_positive?: string; prompt_negative?: string; seed?: number };
    }>;
    const inputAssertion = assertions.find((a) => a.label?.startsWith('vellum.input'));
    expect(inputAssertion).toBeDefined();
    expect(inputAssertion!.data!.prompt_positive).toBe('a missing-control test');
    expect(inputAssertion!.data!.prompt_negative).toBe('noise');
    expect(inputAssertion!.data!.seed).toBe(42);
  });

  it('Test 5 (criterion #5): vendor assertion metadata records the basename only (T-15-04 stripToBasename defence-in-depth)', async () => {
    // The unavailable assertion's metadata.input_filename is the basename of
    // the LoadImage's image field — never an absolute path or path-traversal
    // construct, even if a future caller passed something unexpected. Plan
    // 15-02's stripToBasename helper enforces this; this test locks the
    // contract at the read-back layer.
    const c2pa = createC2pa();
    const store = await c2pa.read({ buffer: signedBytes, mimeType: 'image/png' });
    const assertions = (store!.active_manifest!.assertions ?? []) as Array<{
      label?: string;
      data?: { metadata?: { input_filename?: string } };
    }>;
    const unavailable = assertions.find(
      (a) => a.label?.startsWith('vellum.unavailable_ingredient'),
    );
    const filename = unavailable!.data!.metadata!.input_filename!;
    expect(filename).not.toContain('/');
    expect(filename).not.toContain('\\');
    expect(filename).not.toContain('..');
    expect(filename).toBe('control.png');
  });
});
