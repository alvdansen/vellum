// Phase 15 / Plan 15-03 Task 3 — Engine.signOutput ingredient integration tests.
//
// Architecture-purity: this test file does not import the native binding —
// it goes through Engine.signOutput which delegates to signer.ts (the SOLE
// native-binding consumer in src/). Round-trip read-back uses signer.c2pa.read
// via the loaded signer's exposed C2pa instance (already constructed inside
// the engine).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
import type { C2paConfig } from '../../types/c2pa.js';
import type { ManifestSignedPayloadFields } from '../../types/provenance.js';
import { __resetC2paNodeStateForTests, loadSigner } from '../c2pa/signer.js';

// c2pa-node bundled test cert chain (proper trust chain).
const BUNDLED_CERT_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pub');
const BUNDLED_KEY_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pem');

// Tiny 1x1 transparent PNG (matches signer.test.ts).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Distinct VALID 2x2 RGBA PNG so c2pa-rs does not deduplicate the
// ingredient against TINY_PNG. Generated via /tmp/gen-png.mjs (Node zlib);
// the previously-used base64 was a malformed PNG that c2pa-rs's parser
// rejected at sign time (the v1.0 base64 lacks a valid IDAT chunk).
const ALT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNBgAAEnICff5q7YNAAAAAElFTkSuQmCC',
  'base64',
);

const REAL_C2PA_CONFIG: C2paConfig = {
  certPemPath: BUNDLED_CERT_PATH,
  privateKeyPemPath: BUNDLED_KEY_PATH,
  // Real signing tests need a working TSA URL — c2pa-node v0.5.26 binding bug.
  tsaUrl: 'http://timestamp.digicert.com',
};

type Ctx = {
  engine: Engine;
  hierarchy: HierarchyRepo;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  shotId: string;
  outputsDir: string;
  cleanup: () => Promise<void>;
};

async function setupEngine(c2paConfig: C2paConfig | null = REAL_C2PA_CONFIG): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const fake = new FakeComfyUIClient();
  const outputsDir = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-ingr-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    outputsDir,
    {
      maxConcurrentPollers: 1,
      c2paConfig,
    },
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
    shotId: shot.id,
    outputsDir,
    cleanup: async (): Promise<void> => {
      await engine.stop();
      await fsp.rm(outputsDir, { recursive: true, force: true });
      __resetC2paNodeStateForTests();
    },
  };
}

/**
 * Seed a "completed" version with a populated prompt blob + outputs_json.
 * Mirrors the production path (submit -> mark completed) but without going
 * through the full submit/poll cycle (the wire-level UAT in Task 4 covers
 * that). For Task 3 we shortcut directly to the post-completion state.
 */
function seedCompletedVersion(
  ctx: Ctx,
  options: {
    promptBlob: Record<string, unknown>;
    seed: number | null;
    outputs?: Array<{ filename: string; path?: string; url?: string; content_type?: string; size_bytes?: number }>;
    parentVersionId?: string;
    lineageType?: 'reproduce' | 'iterate';
    filename?: string;
  },
): string {
  const lineage = options.parentVersionId !== undefined ? {
    parent_version_id: options.parentVersionId,
    lineage_type: options.lineageType ?? 'iterate',
  } : undefined;
  const ver = ctx.versions.insertVersion(ctx.shotId, undefined, lineage);
  const writer = new ProvenanceWriter(ctx.provenanceRepo);
  writer.writeSubmitEvent(ver.id, options.promptBlob);
  const filename = options.filename ?? 'out.png';
  const outputs = options.outputs ?? [{
    filename,
    path: pth.join(ctx.outputsDir, ver.id, filename),
    url: 'https://fake/' + filename,
    content_type: 'image/png',
    size_bytes: TINY_PNG.length,
  }];
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

/** Read the latest manifest_signed payload for a (versionId, filename). */
function readManifestSignedPayload(
  ctx: Ctx,
  versionId: string,
  filename: string,
): ManifestSignedPayloadFields | null {
  return ctx.provenanceRepo.getLatestManifestSignedEvent(versionId, filename);
}

function countManifestSignedEventsFor(
  ctx: Ctx,
  versionId: string,
  filename: string,
): number {
  const events = ctx.provenanceRepo.getEventsForVersion(versionId);
  return events.filter((e) => {
    if (e.event_type !== 'manifest_signed' || !e.manifest_signed_json) return false;
    try {
      const parsed = JSON.parse(e.manifest_signed_json) as ManifestSignedPayloadFields;
      return parsed.filename === filename;
    } catch {
      return false;
    }
  }).length;
}

/** Read back a signed buffer via createC2pa().read — exposes Manifest.ingredients. */
async function readManifestFromBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<{
  ingredients: Array<{ relationship?: string; title?: string; label?: string }>;
  assertions: Array<{ label?: string; data?: unknown }>;
} | null> {
  // Construct a fresh signer just for the read-back (no signing in this path —
  // the c2pa.read function is on the C2pa instance and works without a signer).
  const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
  const read = await signer.c2pa.read({ buffer, mimeType });
  if (!read?.active_manifest) return null;
  return {
    ingredients: (read.active_manifest.ingredients ?? []) as Array<{
      relationship?: string;
      title?: string;
      label?: string;
    }>,
    assertions: (read.active_manifest.assertions ?? []) as Array<{
      label?: string;
      data?: unknown;
    }>,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Sign-mutex tests (B4) — Tests M1, M2, M3
// ──────────────────────────────────────────────────────────────────────────

describe('Plan 15-03 B4 — per-version sign mutex', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await setupEngine(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('Test M1: two concurrent signOutput calls for the SAME versionId emit only ONE manifest_signed event', async () => {
    const versionId = seedCompletedVersion(ctx, { promptBlob: {}, seed: null });
    // Fire two concurrent signs on the same (version, filename) pair.
    const [r1, r2] = await Promise.all([
      ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG }),
      ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG }),
    ]);
    // Both got the same coalesced result. Only ONE produced a fresh signed
    // buffer; the other awaited the in-flight Promise. (If the alreadySigned
    // shortcut fired between the two, that's also coalesced behavior — the
    // contract is "only one manifest_signed event was emitted".)
    const eventCount = countManifestSignedEventsFor(ctx, versionId, 'out.png');
    expect(eventCount).toBe(1);
    // At least one of the two received a non-null signed buffer.
    expect(r1.signed !== null || r2.signed !== null).toBe(true);
  });

  it('Test M2: two concurrent signOutput calls for DIFFERENT versionIds run in parallel — both produce events', async () => {
    const v1 = seedCompletedVersion(ctx, { promptBlob: {}, seed: null });
    const v2 = seedCompletedVersion(ctx, { promptBlob: {}, seed: null });
    expect(v1).not.toBe(v2);
    const [, ] = await Promise.all([
      ctx.engine.signOutput(v1, 'out.png', { bytes: TINY_PNG }),
      ctx.engine.signOutput(v2, 'out.png', { bytes: TINY_PNG }),
    ]);
    expect(countManifestSignedEventsFor(ctx, v1, 'out.png')).toBe(1);
    expect(countManifestSignedEventsFor(ctx, v2, 'out.png')).toBe(1);
  });

  it('Test M3: mutex map cleared on settle — sequential signs on same version after first completes do NOT block', async () => {
    const versionId = seedCompletedVersion(ctx, { promptBlob: {}, seed: null });
    const first = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(first.signed !== null || first.alreadySigned).toBe(true);
    // Second sequential call — must hit alreadySigned (Concern #7) since the
    // first event landed signed=true. The mutex did NOT block the call.
    const second = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(second.alreadySigned).toBe(true);
    // Mutex is in-process state — no observable property to assert directly,
    // but the fact that we got here without timeout proves no entry leaked.
  });

  it('Test M4 (WR-01 regression): two concurrent signs for SAME versionId but DIFFERENT filenames execute as TWO sign operations', async () => {
    // WR-01 regression: the pre-fix mutex was keyed on versionId only, so a
    // concurrent signOutput(v, "a.png", ...) + signOutput(v, "b.png", ...)
    // would coalesce — the second caller silently received the first's signed
    // buffer + zero manifest_signed events for "b.png". With the compound key
    // `${versionId}::${filename}`, distinct filenames execute as two separate
    // sign operations.
    const versionId = seedCompletedVersion(ctx, { promptBlob: {}, seed: null });
    const [r1, r2] = await Promise.all([
      ctx.engine.signOutput(versionId, 'a.png', { bytes: TINY_PNG }),
      ctx.engine.signOutput(versionId, 'b.png', { bytes: TINY_PNG }),
    ]);
    // Both calls must produce their own signed buffers (no coalescing across
    // different filenames). Each sign op flows through _signOutputInner —
    // neither hits the alreadySigned shortcut (no prior event for either
    // filename) and neither returns the other's buffer.
    expect(r1.signed).not.toBeNull();
    expect(r2.signed).not.toBeNull();
    expect(r1.alreadySigned).not.toBe(true);
    expect(r2.alreadySigned).not.toBe(true);
    // ONE manifest_signed event per (versionId, filename) — TWO total for the
    // same versionId. Pre-fix this would have been ONE total (the second
    // filename would have inherited the first's event).
    expect(countManifestSignedEventsFor(ctx, versionId, 'a.png')).toBe(1);
    expect(countManifestSignedEventsFor(ctx, versionId, 'b.png')).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Engine integration (B3 + ingredients) — Tests E1..E10
// ──────────────────────────────────────────────────────────────────────────

describe('Plan 15-03 — Engine.signOutput ingredient integration', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await setupEngine(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('Test E1: v1 with no parent + no IMAGE_INPUT nodes → empty Manifest.ingredients[]; ingredients_summary all-zero except input_assertion', async () => {
    const versionId = seedCompletedVersion(ctx, {
      promptBlob: {
        '1': {
          class_type: 'KSampler',
          inputs: { seed: 42, steps: 20, cfg: 7.0, denoise: 1.0, sampler_name: 'euler', scheduler: 'normal' },
        },
      },
      seed: 42,
    });
    const result = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).not.toBeNull();
    const manifest = await readManifestFromBuffer(result.signed!, 'image/png');
    expect(manifest).not.toBeNull();
    expect(manifest!.ingredients).toHaveLength(0);
    // assertions[].label includes 'c2pa.actions' + 'vfx_familiar.input'.
    const labels = manifest!.assertions.map((a) => a.label);
    expect(labels.some((l) => l?.startsWith('c2pa.actions'))).toBe(true);
    expect(labels.some((l) => l?.startsWith('vfx_familiar.input'))).toBe(true);
    // Payload assertions.
    const payload = readManifestSignedPayload(ctx, versionId, 'out.png');
    expect(payload).not.toBeNull();
    expect(payload!.signed).toBe(true);
    expect(payload!.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(payload!.ingredients_summary).toEqual({
      parent_count: 0,
      component_count: 0,
      input_assertion: true,
      unavailable_count: 0,
    });
  });

  it('Test E2: v2 with reachable parent on disk → Manifest.ingredients[] includes parentOf; ingredients_summary.parent_count=1', async () => {
    // Step 1 — sign v1 first so its manifest_signed event has signed=true + manifest_sha256.
    const v1 = seedCompletedVersion(ctx, { promptBlob: {}, seed: null, filename: 'parent.png' });
    // Pre-write v1's signed bytes to outputRoot/<v1>/parent.png.
    const v1Dir = pth.join(ctx.outputsDir, v1);
    mkdirSync(v1Dir, { recursive: true });
    const v1Result = await ctx.engine.signOutput(v1, 'parent.png', { bytes: TINY_PNG });
    expect(v1Result.signed).not.toBeNull();
    // Write v1's signed bytes to disk so v2's child sign can read them.
    writeFileSync(pth.join(v1Dir, 'parent.png'), v1Result.signed!);

    // Step 2 — create v2 as iterate-lineage child of v1.
    const v2 = seedCompletedVersion(ctx, {
      promptBlob: {},
      seed: null,
      parentVersionId: v1,
      lineageType: 'iterate',
      filename: 'child.png',
    });
    const v2Result = await ctx.engine.signOutput(v2, 'child.png', { bytes: ALT_PNG });
    expect(v2Result.signed).not.toBeNull();
    const manifest = await readManifestFromBuffer(v2Result.signed!, 'image/png');
    expect(manifest).not.toBeNull();
    expect(manifest!.ingredients.length).toBeGreaterThanOrEqual(1);
    const parentIngredient = manifest!.ingredients.find((i) => i.relationship === 'parentOf');
    expect(parentIngredient).toBeDefined();
    const payload = readManifestSignedPayload(ctx, v2, 'child.png');
    expect(payload!.ingredients_summary?.parent_count).toBe(1);
    expect(payload!.ingredients_summary?.unavailable_count).toBe(0);
  });

  it('Test E3: parent has manifest_signed event but signed=false → assetRef=unavailable; vfx_familiar.unavailable_ingredient assertion in v2 manifest', async () => {
    const v1 = seedCompletedVersion(ctx, { promptBlob: {}, seed: null, filename: 'parent.png' });
    // Append a signed=false manifest_signed event for v1 (e.g., signing was disabled at v1's sign time).
    ctx.provenanceRepo.appendManifestSignedEvent(v1, {
      filename: 'parent.png', format: 'image/png', signed: false,
      cert_subject_summary: '', signed_at: new Date().toISOString(),
      status_reason: 'signing_disabled', algorithm: '',
    });
    const v2 = seedCompletedVersion(ctx, {
      promptBlob: {}, seed: null, parentVersionId: v1, lineageType: 'iterate',
    });
    const v2Result = await ctx.engine.signOutput(v2, 'out.png', { bytes: TINY_PNG });
    expect(v2Result.signed).not.toBeNull();
    const manifest = await readManifestFromBuffer(v2Result.signed!, 'image/png');
    // Parent surfaces in assertions[] as vfx_familiar.unavailable_ingredient.
    const unavail = manifest!.assertions.find((a) => a.label?.startsWith('vfx_familiar.unavailable_ingredient'));
    expect(unavail).toBeDefined();
    // ingredients[] does NOT carry the unavailable parent (signer skipped it).
    expect(manifest!.ingredients.find((i) => i.relationship === 'parentOf')).toBeUndefined();
    const payload = readManifestSignedPayload(ctx, v2, 'out.png');
    expect(payload!.ingredients_summary?.unavailable_count).toBe(1);
  });

  it('Test E4: parent has only completed event, no manifest_signed yet → parent_manifest_pending', async () => {
    const v1 = seedCompletedVersion(ctx, { promptBlob: {}, seed: null });
    // Note: NO manifest_signed event for v1.
    const v2 = seedCompletedVersion(ctx, {
      promptBlob: {}, seed: null, parentVersionId: v1, lineageType: 'iterate',
    });
    const v2Result = await ctx.engine.signOutput(v2, 'out.png', { bytes: TINY_PNG });
    const manifest = await readManifestFromBuffer(v2Result.signed!, 'image/png');
    expect(manifest!.ingredients.find((i) => i.relationship === 'parentOf')).toBeUndefined();
    const unavail = manifest!.assertions.find((a) => a.label?.startsWith('vfx_familiar.unavailable_ingredient'));
    expect(unavail).toBeDefined();
    const payload = readManifestSignedPayload(ctx, v2, 'out.png');
    expect(payload!.ingredients_summary?.unavailable_count).toBe(1);
  });

  it('Test E5: component reachable on disk (LoadImage) → Manifest.ingredients[] includes componentOf', async () => {
    // Pre-write the LoadImage source bytes to outputRoot/<versionId>/control.png BEFORE creating the version.
    const promptBlob = {
      '5': { class_type: 'LoadImage', inputs: { image: 'control.png' } },
      '6': { class_type: 'KSampler', inputs: { seed: 1, steps: 10, cfg: 7, denoise: 1, sampler_name: 'euler', scheduler: 'normal' } },
    };
    const versionId = seedCompletedVersion(ctx, { promptBlob, seed: 1 });
    const verDir = pth.join(ctx.outputsDir, versionId);
    mkdirSync(verDir, { recursive: true });
    writeFileSync(pth.join(verDir, 'control.png'), ALT_PNG);
    const result = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).not.toBeNull();
    const manifest = await readManifestFromBuffer(result.signed!, 'image/png');
    const compIngredient = manifest!.ingredients.find((i) => i.relationship === 'componentOf');
    expect(compIngredient).toBeDefined();
    const payload = readManifestSignedPayload(ctx, versionId, 'out.png');
    expect(payload!.ingredients_summary?.component_count).toBe(1);
    expect(payload!.ingredients_summary?.unavailable_count).toBe(0);
  });

  it('Test E6: component dangling (file missing) → vfx_familiar.unavailable_ingredient assertion', async () => {
    const promptBlob = {
      '5': { class_type: 'LoadImage', inputs: { image: 'missing.png' } },
    };
    const versionId = seedCompletedVersion(ctx, { promptBlob, seed: null });
    // Do NOT pre-write missing.png.
    const result = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    const manifest = await readManifestFromBuffer(result.signed!, 'image/png');
    expect(manifest!.ingredients.find((i) => i.relationship === 'componentOf')).toBeUndefined();
    const unavail = manifest!.assertions.find((a) => a.label?.startsWith('vfx_familiar.unavailable_ingredient'));
    expect(unavail).toBeDefined();
    const payload = readManifestSignedPayload(ctx, versionId, 'out.png');
    expect(payload!.ingredients_summary?.component_count).toBe(1);
    expect(payload!.ingredients_summary?.unavailable_count).toBe(1);
  });

  it('Test E7: inputTo populated with prompt + sampler params + seed', async () => {
    const promptBlob = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a beautiful sunset' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'low quality, blurry' } },
      '3': {
        class_type: 'KSampler',
        inputs: {
          positive: ['1', 0],
          negative: ['2', 0],
          seed: 7777,
          steps: 25,
          cfg: 7.5,
          denoise: 1.0,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
        },
      },
    };
    const versionId = seedCompletedVersion(ctx, { promptBlob, seed: 7777 });
    const result = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    const manifest = await readManifestFromBuffer(result.signed!, 'image/png');
    const inputAssertion = manifest!.assertions.find((a) => a.label?.startsWith('vfx_familiar.input'));
    expect(inputAssertion).toBeDefined();
    const data = inputAssertion!.data as {
      prompt_positive?: string;
      prompt_negative?: string;
      sampler?: { name: string; steps: number };
      seed?: number;
    };
    expect(data.prompt_positive).toBe('a beautiful sunset');
    expect(data.prompt_negative).toBe('low quality, blurry');
    expect(data.sampler?.name).toBe('dpmpp_2m');
    expect(data.sampler?.steps).toBe(25);
    expect(data.seed).toBe(7777);
    const payload = readManifestSignedPayload(ctx, versionId, 'out.png');
    expect(payload!.ingredients_summary?.input_assertion).toBe(true);
  });

  it('Test E8: signing_disabled (c2paConfig=null) — manifest_sha256 + ingredients_summary may be undefined OR all-zero', async () => {
    await ctx.cleanup();
    ctx = await setupEngine(null);
    const versionId = seedCompletedVersion(ctx, { promptBlob: {}, seed: null });
    const result = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).toBeNull();
    const payload = readManifestSignedPayload(ctx, versionId, 'out.png');
    expect(payload!.signed).toBe(false);
    expect(payload!.status_reason).toBe('signing_disabled');
    // The new fields are optional — accept undefined OR all-zero.
    if (payload!.manifest_sha256 !== undefined) {
      expect(payload!.manifest_sha256).toBeNull();
    }
    if (payload!.ingredients_summary !== undefined) {
      expect(payload!.ingredients_summary.parent_count).toBe(0);
      expect(payload!.ingredients_summary.component_count).toBe(0);
    }
  });

  it('Test E9: idempotency preserved — re-signing emits ZERO new manifest_signed events', async () => {
    const versionId = seedCompletedVersion(ctx, { promptBlob: {}, seed: null });
    const first = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(first.signed).not.toBeNull();
    const eventCountAfterFirst = countManifestSignedEventsFor(ctx, versionId, 'out.png');
    expect(eventCountAfterFirst).toBe(1);
    const second = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(second.alreadySigned).toBe(true);
    expect(countManifestSignedEventsFor(ctx, versionId, 'out.png')).toBe(1);
  });

  it('Test E10: architecture-purity — ingredient files have zero c2pa-node imports', () => {
    const extractor = readFileSync('src/engine/c2pa/ingredient-extractor.ts', 'utf8');
    const hasher = readFileSync('src/engine/c2pa/ingredient-hasher.ts', 'utf8');
    expect(/from\s+['"]c2pa-node/.test(extractor)).toBe(false);
    expect(/from\s+['"]c2pa-node/.test(hasher)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// outputs_json shape verification (B3) — Test B3-1
// ──────────────────────────────────────────────────────────────────────────

describe('Plan 15-03 B3 — outputs_json shape verification', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await setupEngine(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('Test B3-1: getStoredFilenameForVersion round-trips with a known StoredOutput[] payload', () => {
    // Uses the engine's private accessor through the typed cast escape hatch
    // (same pattern as pipeline-c2pa-config.test.ts Test 3). The accessor
    // mirrors the lineage-tree helper at line ~692 of pipeline.ts and is
    // the single source of truth for "extract parent's primary filename".
    const v = ctx.versions.insertVersion(ctx.shotId);
    const outputs = [
      { filename: 'first.png', path: '/tmp/first.png', url: 'https://x/first.png', content_type: 'image/png', size_bytes: 100 },
      { filename: 'second.png', path: '/tmp/second.png', url: 'https://x/second.png', content_type: 'image/png', size_bytes: 200 },
    ];
    ctx.versions.markCompleted(v.id, JSON.stringify(outputs));
    const access = (ctx.engine as unknown as {
      getStoredFilenameForVersion: (id: string) => string | null;
    });
    expect(access.getStoredFilenameForVersion(v.id)).toBe('first.png');
  });

  it('Test B3-2: returns null for malformed outputs_json', () => {
    const v = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.markCompleted(v.id, '{not-an-array}');
    const access = (ctx.engine as unknown as {
      getStoredFilenameForVersion: (id: string) => string | null;
    });
    expect(access.getStoredFilenameForVersion(v.id)).toBeNull();
  });

  it('Test B3-3: returns null when outputs_json is empty array', () => {
    const v = ctx.versions.insertVersion(ctx.shotId);
    ctx.versions.markCompleted(v.id, '[]');
    const access = (ctx.engine as unknown as {
      getStoredFilenameForVersion: (id: string) => string | null;
    });
    expect(access.getStoredFilenameForVersion(v.id)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Plan 15-03 Task 4 — wire-level UAT (C6) — Tests C6-1 + C6-2
//
// Per MEMORY.md feedback_dont_punt_on_tests: drive the integration through
// the same Engine API surface (provenance writer + insertEvent +
// markCompleted) the GenerationEngine itself uses post-completion. The
// integration point of interest — Engine.signOutput on completed bytes
// reading prompt_json + outputs_json + getLatestManifestSignedEvent — is
// exercised end-to-end without bypassing the prompt-resolution path.
// FakeComfyUIClient is wired into the Engine constructor so the dispatch
// path through the client is real.
// ──────────────────────────────────────────────────────────────────────────

describe('Plan 15-03 Task 4 — wire-level UAT (C6 follow-up to MEMORY.md feedback_dont_punt_on_tests)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await setupEngine(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('C6-1: end-to-end completed → sign emits componentOf for the LoadImage that ControlNetApply consumed via edge walk', async () => {
    // Workflow JSON shape: LoadImage(image='ref.png') →
    // ControlNetApply(image=['1', 0]) → CLIPTextEncode positive/negative →
    // KSampler(positive,negative). The wire-level scenario: the FakeComfyUIClient
    // is plumbed into the Engine; we replicate the post-completion state
    // (insertEvent + markCompleted) the GenerationEngine itself emits.
    const promptBlob = {
      '1': { class_type: 'LoadImage', inputs: { image: 'ref.png' } },
      '2': { class_type: 'ControlNetApply', inputs: { image: ['1', 0], strength: 1.0 } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'a control test' } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: 'noise, blur' } },
      '5': {
        class_type: 'KSampler',
        inputs: {
          positive: ['3', 0],
          negative: ['4', 0],
          seed: 99,
          steps: 20,
          cfg: 7.0,
          denoise: 1.0,
          sampler_name: 'euler',
          scheduler: 'normal',
        },
      },
    };
    const versionId = seedCompletedVersion(ctx, { promptBlob, seed: 99 });
    // Pre-write ref.png to outputRoot/<versionId>/ref.png so the LoadImage
    // node's image bytes are reachable. Engine.buildManifestForVersion's
    // component-resolution loop reads outputRoot/<versionId>/<filename>.
    const verDir = pth.join(ctx.outputsDir, versionId);
    mkdirSync(verDir, { recursive: true });
    writeFileSync(pth.join(verDir, 'ref.png'), ALT_PNG);
    const result = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).not.toBeNull();
    const manifest = await readManifestFromBuffer(result.signed!, 'image/png');
    // Manifest.ingredients[] carries componentOf with title containing 'ref.png'
    // — the buildManifestWithIngredients title format is "<role> image (<filename>)".
    const comp = manifest!.ingredients.find(
      (i) => i.relationship === 'componentOf' && (i.title ?? '').includes('ref.png'),
    );
    expect(comp).toBeDefined();
    // vfx_familiar.input carries prompt + sampler params + seed (E7 lock).
    const input = manifest!.assertions.find((a) => a.label?.startsWith('vfx_familiar.input'));
    expect(input).toBeDefined();
    const data = input!.data as {
      prompt_positive?: string;
      prompt_negative?: string;
      sampler?: { name?: string };
      seed?: number;
    };
    expect(data.prompt_positive).toBe('a control test');
    expect(data.prompt_negative).toBe('noise, blur');
    expect(data.seed).toBe(99);
    // ingredients_summary on the manifest_signed event reflects the cohort.
    // Both the LoadImage node AND the ControlNetApply node land as components
    // (LoadImage via direct 'image' string field, ControlNetApply via edge-
    // tuple one-hop to LoadImage's filename). Both reachable on disk →
    // component_count=2, unavailable_count=0.
    const payload = readManifestSignedPayload(ctx, versionId, 'out.png');
    expect(payload!.ingredients_summary?.component_count).toBe(2);
    expect(payload!.ingredients_summary?.unavailable_count).toBe(0);
    expect(payload!.ingredients_summary?.input_assertion).toBe(true);
  });

  it('C6-2: same wire-level cycle but LoadImage file missing — emits vfx_familiar.unavailable_ingredient (D-CTX-4 production-cloud-mode reality)', async () => {
    // D-CTX-4 production reality: ComfyUI Cloud LoadImage references files
    // that live on cloud storage; outputRoot/<versionId>/<filename> typically
    // does NOT exist locally. The expected outcome is dangling-reference —
    // vfx_familiar.unavailable_ingredient assertion fires, ingredients_summary.
    // unavailable_count increments. THIS IS THE EXPECTED PRODUCTION-MODE OUTCOME.
    const promptBlob = {
      '1': { class_type: 'LoadImage', inputs: { image: 'ref.png' } },
      '2': { class_type: 'ControlNetApply', inputs: { image: ['1', 0], strength: 1.0 } },
    };
    const versionId = seedCompletedVersion(ctx, { promptBlob, seed: null });
    // Do NOT pre-write ref.png — production cloud-mode reality.
    const result = await ctx.engine.signOutput(versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).not.toBeNull();
    const manifest = await readManifestFromBuffer(result.signed!, 'image/png');
    const unavail = manifest!.assertions.find((a) => a.label?.startsWith('vfx_familiar.unavailable_ingredient'));
    expect(unavail).toBeDefined();
    // ingredients[] does NOT carry the unavailable component (signer skipped it).
    expect(manifest!.ingredients.find((i) => i.relationship === 'componentOf')).toBeUndefined();
    // ingredients_summary on the manifest_signed event records the unavailable
    // count. Both LoadImage (node 1) AND ControlNetApply (node 2 — edge tuple
    // resolves to node 1's filename) become component ingredients pointing at
    // 'ref.png' which doesn't exist on disk → component_count=2,
    // unavailable_count=2 (both surface as vfx_familiar.unavailable_ingredient).
    const payload = readManifestSignedPayload(ctx, versionId, 'out.png');
    expect(payload!.ingredients_summary?.component_count).toBe(2);
    expect(payload!.ingredients_summary?.unavailable_count).toBe(2);
  });
});
