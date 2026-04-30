// Phase 15 / Plan 15-03 Task 2 — signer.ts ingredient-aware entry points.
//
// Architecture-purity claim header (per recurring Phase 13 / Plan 15-01 / 15-02
// docstring-vs-grep pattern): zero MCP / native-binding-import / SQLite-driver
// / ORM imports in the test file. The wire-up uses the public test utilities
// already in place (the bundled cert chain at node_modules/c2pa-node/tests/
// fixtures/certs/) and `signer.c2pa.read` for the round-trip read-back.

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadSigner,
  signEmbedBufferWithIngredients,
  signEmbedFileWithIngredients,
  __resetC2paNodeStateForTests,
} from '../signer.js';
import { buildManifestDefinition } from '../manifest-builder.js';
import type { BuildManifestResult, IngredientSpec } from '../manifest-builder.js';

// c2pa-node bundled test cert chain (proper trust chain — c2pa-rs rejects
// self-signed certs at read-time, so the .c2pa-dev/ cert from Plan 14-01
// cannot be used). Same path as signer.test.ts.
const BUNDLED_CERT_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pub');
const BUNDLED_KEY_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pem');

// Tiny 1x1 transparent PNG fixture — same as signer.test.ts.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Tiny 2x2 alternate PNG fixture — distinct bytes from TINY_PNG so c2pa-rs
// does not deduplicate ingredients sharing the same labeled hash.
const ALT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8//8/AyMDAxMDFAAAJgAB/kCxN0wAAAAASUVORK5CYII=',
  'base64',
);

afterEach(() => {
  __resetC2paNodeStateForTests();
});

/** Build the BuildManifestResult shape the new entry points consume. */
function buildResult(opts: {
  versionId: string;
  mimeType: string;
  ingredientSpecs: IngredientSpec[];
}): BuildManifestResult {
  const definition = buildManifestDefinition({
    versionId: opts.versionId,
    mimeType: opts.mimeType,
    primaryModel: { name: 'sd_xl.safetensors', hash: 'abc123' },
    comfyuiVersion: '0.4.2',
    appVersion: '0.1.0',
  });
  return { definition, ingredientSpecs: opts.ingredientSpecs };
}

describe('signEmbedBufferWithIngredients — Test S1: no-ingredients backward-compat', () => {
  it('Test S1: empty ingredientSpecs round-trips with Manifest.ingredients empty', async () => {
    const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
    const result = buildResult({
      versionId: 'ver_s1',
      mimeType: 'image/png',
      ingredientSpecs: [],
    });
    const signed = await signEmbedBufferWithIngredients(TINY_PNG, 'image/png', result, signer);
    expect(Buffer.isBuffer(signed)).toBe(true);
    expect(signed.length).toBeGreaterThan(TINY_PNG.length);
    // Round-trip via createC2pa().read.
    const read = await signer.c2pa.read({ buffer: signed, mimeType: 'image/png' });
    expect(read).not.toBeNull();
    const ingredients = (read?.active_manifest?.ingredients ?? []) as Array<unknown>;
    expect(ingredients).toHaveLength(0);
  });
});

describe('signEmbedBufferWithIngredients — Test S2: one parentOf via file asset', () => {
  it('Test S2: parentOf spec lands in Manifest.ingredients[] with relationship=parentOf', async () => {
    const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
    // Write parent fixture to a temp file path (the parentOf assetRef is 'file').
    const tempDir = mkdtempSync(join(tmpdir(), 'c2pa-s2-'));
    const parentPath = join(tempDir, 'parent.png');
    writeFileSync(parentPath, TINY_PNG);
    const result = buildResult({
      versionId: 'ver_s2',
      mimeType: 'image/png',
      ingredientSpecs: [
        {
          relationship: 'parentOf',
          title: 'Parent ver_s2_parent',
          assetRef: { kind: 'file', path: parentPath, mimeType: 'image/png' },
          auditMetadata: { version_id: 'ver_s2_parent', lineage_type: 'iterate', manifest_hash: 'abc' },
        },
      ],
    });
    const signed = await signEmbedBufferWithIngredients(TINY_PNG, 'image/png', result, signer);
    const read = await signer.c2pa.read({ buffer: signed, mimeType: 'image/png' });
    const ingredients = (read?.active_manifest?.ingredients ?? []) as Array<{
      relationship?: string;
      title?: string;
      label?: string;
      instance_id?: string;
    }>;
    expect(ingredients.length).toBe(1);
    const parentIngredient = ingredients.find((i) => i.relationship === 'parentOf');
    expect(parentIngredient).toBeDefined();
    expect(parentIngredient?.title).toBe('Parent ver_s2_parent');
    // c2pa-rs assigns a c2pa.ingredient.v2 label to ingredients added via
    // addIngredient — proves the entry came from our addIngredient path
    // rather than a v1 legacy assertion.
    expect(parentIngredient?.label).toBe('c2pa.ingredient.v2');
    // instance_id is xmp:iid:<uuid> — c2pa-rs autogenerates per ingredient.
    expect(parentIngredient?.instance_id).toMatch(/^xmp:iid:/);
  });
});

describe('signEmbedBufferWithIngredients — Test S3: one componentOf via file asset', () => {
  it('Test S3: componentOf spec lands in Manifest.ingredients[] with relationship componentOf', async () => {
    const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
    const tempDir = mkdtempSync(join(tmpdir(), 'c2pa-s3-'));
    const compPath = join(tempDir, 'control.png');
    writeFileSync(compPath, TINY_PNG);
    const result = buildResult({
      versionId: 'ver_s3',
      mimeType: 'image/png',
      ingredientSpecs: [
        {
          relationship: 'componentOf',
          title: 'control image (control.png)',
          assetRef: { kind: 'file', path: compPath, mimeType: 'image/png' },
          auditMetadata: {
            node_id: '5',
            role: 'control',
            input_filename: 'control.png',
            class_type: 'ControlNetApply',
          },
        },
      ],
    });
    const signed = await signEmbedBufferWithIngredients(TINY_PNG, 'image/png', result, signer);
    const read = await signer.c2pa.read({ buffer: signed, mimeType: 'image/png' });
    const ingredients = (read?.active_manifest?.ingredients ?? []) as Array<{
      relationship?: string;
      hash?: string;
    }>;
    expect(ingredients.length).toBe(1);
    expect(ingredients[0]?.relationship).toBe('componentOf');
  });
});

describe('signEmbedBufferWithIngredients — Test S4: parent + component reachable', () => {
  it('Test S4: two reachable specs (distinct bytes) produce two ingredients[] entries', async () => {
    const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
    const tempDir = mkdtempSync(join(tmpdir(), 'c2pa-s4-'));
    const parentPath = join(tempDir, 'parent.png');
    const compPath = join(tempDir, 'comp.png');
    // Distinct bytes are required — c2pa-rs deduplicates ingredients that
    // share the same labeled hash (a real workflow's parent + component
    // would never be byte-identical). Tested in /tmp/probe-s4.mts.
    writeFileSync(parentPath, TINY_PNG);
    writeFileSync(compPath, ALT_PNG);
    const result = buildResult({
      versionId: 'ver_s4',
      mimeType: 'image/png',
      ingredientSpecs: [
        {
          relationship: 'parentOf',
          title: 'Parent ver_s4_parent',
          assetRef: { kind: 'file', path: parentPath, mimeType: 'image/png' },
          auditMetadata: {},
        },
        {
          relationship: 'componentOf',
          title: 'comp image',
          assetRef: { kind: 'file', path: compPath, mimeType: 'image/png' },
          auditMetadata: {},
        },
      ],
    });
    const signed = await signEmbedBufferWithIngredients(TINY_PNG, 'image/png', result, signer);
    const read = await signer.c2pa.read({ buffer: signed, mimeType: 'image/png' });
    const ingredients = (read?.active_manifest?.ingredients ?? []) as Array<{
      relationship?: string;
      label?: string;
      instance_id?: string;
    }>;
    expect(ingredients.length).toBe(2);
    expect(ingredients.find((i) => i.relationship === 'parentOf')).toBeDefined();
    expect(ingredients.find((i) => i.relationship === 'componentOf')).toBeDefined();
    // Both came through addIngredient (c2pa.ingredient.v2 family of labels —
    // c2pa-rs adds a __N suffix to disambiguate sibling ingredients) and
    // have c2pa-rs-assigned instance_ids. The cryptographic binding lives
    // in the claim's hash data assertions, not at the top of the resolved
    // ingredient object.
    for (const i of ingredients) {
      expect(i.label).toMatch(/^c2pa\.ingredient\.v2(?:__\d+)?$/);
      expect(i.instance_id).toMatch(/^xmp:iid:/);
    }
  });
});

describe('signEmbedBufferWithIngredients — Test S5: unavailable spec skipped at signer', () => {
  it('Test S5: assetRef.kind=unavailable → skipped; reachable still produces an ingredient', async () => {
    const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
    const tempDir = mkdtempSync(join(tmpdir(), 'c2pa-s5-'));
    const compPath = join(tempDir, 'reachable.png');
    writeFileSync(compPath, TINY_PNG);
    const result = buildResult({
      versionId: 'ver_s5',
      mimeType: 'image/png',
      ingredientSpecs: [
        // Unavailable parent — signer must skip; assertion already in definition.assertions[]
        // (the buildManifestWithIngredients caller would emit it; here we only test the
        // signer's skip behavior, so definition.assertions is the Phase 14 default).
        {
          relationship: 'parentOf',
          title: 'Unavailable parent',
          assetRef: { kind: 'unavailable', reason: 'parent_manifest_pending' },
          auditMetadata: {},
        },
        {
          relationship: 'componentOf',
          title: 'reachable comp',
          assetRef: { kind: 'file', path: compPath, mimeType: 'image/png' },
          auditMetadata: {},
        },
      ],
    });
    const signed = await signEmbedBufferWithIngredients(TINY_PNG, 'image/png', result, signer);
    const read = await signer.c2pa.read({ buffer: signed, mimeType: 'image/png' });
    const ingredients = (read?.active_manifest?.ingredients ?? []) as Array<{
      relationship?: string;
      hash?: string;
    }>;
    // Only the reachable componentOf landed.
    expect(ingredients.length).toBe(1);
    expect(ingredients[0]?.relationship).toBe('componentOf');
  });
});

describe('signEmbedBufferWithIngredients — Test S6: Relationship enum import works at runtime', () => {
  it('Test S6: enum import resolves — both ParentOf and ComponentOf reachable', async () => {
    // Sanity test for the enum import path. Imports are dynamic via ensureC2paNode,
    // so this exercises the runtime resolution. If the import path were wrong,
    // signer.c2pa would fail to construct.
    const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
    expect(signer.c2pa).toBeDefined();
    // ParentOf + ComponentOf are checked indirectly via Tests S2/S3 — those tests
    // pass only if the enum mapping inside signEmbedBufferWithIngredients works.
    const result = buildResult({
      versionId: 'ver_s6',
      mimeType: 'image/png',
      ingredientSpecs: [],
    });
    const signed = await signEmbedBufferWithIngredients(TINY_PNG, 'image/png', result, signer);
    expect(Buffer.isBuffer(signed)).toBe(true);
  });
});

describe('signEmbedBufferWithIngredients — Test S7: createIngredient labeled hash binding', () => {
  it('Test S7: ingredient passes cryptographic-binding validation (clean validation_status)', async () => {
    const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
    const tempDir = mkdtempSync(join(tmpdir(), 'c2pa-s7-'));
    const compPath = join(tempDir, 'asset.png');
    writeFileSync(compPath, TINY_PNG);
    const result = buildResult({
      versionId: 'ver_s7',
      mimeType: 'image/png',
      ingredientSpecs: [
        {
          relationship: 'componentOf',
          title: 'asset',
          assetRef: { kind: 'file', path: compPath, mimeType: 'image/png' },
          auditMetadata: {},
        },
      ],
    });
    const signed = await signEmbedBufferWithIngredients(TINY_PNG, 'image/png', result, signer);
    const read = await signer.c2pa.read({ buffer: signed, mimeType: 'image/png' });
    const ingredients = (read?.active_manifest?.ingredients ?? []) as Array<{
      relationship?: string;
      validation_status?: Array<{ code?: string }> | null;
    }>;
    expect(ingredients.length).toBe(1);
    // c2pa-rs computed its labeled hash at sign time; on read the labeled
    // hash binds the ingredient bytes to the manifest. validation_status is
    // null (or empty) when the binding is intact; non-empty when tampered.
    // Proving the labeled-hash chain is intact is stronger than asserting
    // a regex on the hash field itself.
    const status = ingredients[0]?.validation_status;
    expect(status === undefined || status === null || (Array.isArray(status) && status.length === 0)).toBe(true);
  });
});

describe('signEmbedFileWithIngredients — file-API entry point', () => {
  /**
   * Reuse the tiny MP4 fixture pattern from signer.test.ts; if ffmpeg is
   * unavailable, the test skips trivially.
   */
  function maybeMakeTinyMp4(): Buffer | null {
    const FIXTURE_ROOT = resolve('tests/fixtures/c2pa/algorithms');
    const cachedPath = join(FIXTURE_ROOT, 'tiny.mp4');
    if (existsSync(cachedPath)) return readFileSync(cachedPath);
    return null;
  }

  it('Test SFile: signEmbedFileWithIngredients writes signed bytes to destPath', async () => {
    const srcMp4 = maybeMakeTinyMp4();
    if (!srcMp4) {
      console.warn('Test SFile skipped — tiny.mp4 fixture not present (signer.test.ts ffmpeg-gen)');
      return;
    }
    const signer = await loadSigner(BUNDLED_CERT_PATH, BUNDLED_KEY_PATH);
    const tempDir = mkdtempSync(join(tmpdir(), 'c2pa-sfile-'));
    const srcPath = join(tempDir, 'tiny.mp4');
    const destPath = join(tempDir, 'tiny-signed.mp4');
    writeFileSync(srcPath, srcMp4);
    // Empty ingredients → backward-compat with signEmbedFile.
    const result: BuildManifestResult = {
      definition: buildManifestDefinition({
        versionId: 'ver_sfile',
        mimeType: 'video/mp4',
        primaryModel: { name: 'video.safetensors', hash: 'h' },
        comfyuiVersion: '0.4.2',
        appVersion: '0.1.0',
      }),
      ingredientSpecs: [],
    };
    await signEmbedFileWithIngredients(srcPath, destPath, 'video/mp4', result, signer);
    expect(existsSync(destPath)).toBe(true);
    const destBytes = readFileSync(destPath);
    expect(destBytes.length).toBeGreaterThan(srcMp4.length);
  });
});
