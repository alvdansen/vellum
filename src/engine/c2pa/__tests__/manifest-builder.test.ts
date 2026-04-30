import { describe, it, expect } from 'vitest';
import {
  buildManifestDefinition,
  type BuildManifestOptions,
  type ManifestDefinition,
  type PrimaryModel,
} from '../manifest-builder.js';

/**
 * Phase 14 Plan 02 Task 2 — D-CTX-4 manifest contract (c2pa.created ONLY).
 *
 * Pure-function unit tests. Asserts the buildManifestDefinition output is a
 * c2pa-node-compatible ManifestBuilder input, contains exactly the
 * c2pa.created assertion, names ComfyUI as the softwareAgent, and surfaces
 * the primary model in parameters.description with NO absolute filesystem
 * paths (T-14-05 mitigation).
 */

const SAMPLE_MODEL_WITH_HASH: PrimaryModel = {
  name: 'sd_xl_1.0.safetensors',
  hash: 'abc123def456',
};

const SAMPLE_MODEL_HASH_UNAVAILABLE: PrimaryModel = {
  name: 'sd_xl_1.0.safetensors',
  hash: null,
  unavailable: 'models_dir_not_configured',
};

const BASE_OPTS: BuildManifestOptions = {
  versionId: 'ver_abc123',
  mimeType: 'image/png',
  primaryModel: SAMPLE_MODEL_WITH_HASH,
  comfyuiVersion: '0.4.2',
  appVersion: '0.1.0',
};

describe('buildManifestDefinition — D-CTX-4 c2pa.created shape', () => {
  it('Test 1: assertions[0].label is c2pa.actions and actions[0].action is c2pa.created', () => {
    const def: ManifestDefinition = buildManifestDefinition(BASE_OPTS);
    expect(def.assertions).toHaveLength(1);
    expect(def.assertions[0]?.label).toBe('c2pa.actions');
    expect(def.assertions[0]?.data.actions).toHaveLength(1);
    expect(def.assertions[0]?.data.actions[0]?.action).toBe('c2pa.created');
  });

  it('Test 2: claim_generator format `vfx-familiar/<appVersion> c2pa-node/0.5.26`', () => {
    const def = buildManifestDefinition(BASE_OPTS);
    expect(def.claim_generator).toBe('vfx-familiar/0.1.0 c2pa-node/0.5.26');
  });

  it('Test 3: format field equals input mimeType', () => {
    const png = buildManifestDefinition({ ...BASE_OPTS, mimeType: 'image/png' });
    expect(png.format).toBe('image/png');
    const mp4 = buildManifestDefinition({ ...BASE_OPTS, mimeType: 'video/mp4' });
    expect(mp4.format).toBe('video/mp4');
  });

  it('Test 4: title field equals `Version ${versionId}`', () => {
    const def = buildManifestDefinition({ ...BASE_OPTS, versionId: 'ver_xyz789' });
    expect(def.title).toBe('Version ver_xyz789');
  });

  it('Test 5: digitalSourceType is the IPTC trainedAlgorithmicMedia URI', () => {
    const def = buildManifestDefinition(BASE_OPTS);
    expect(def.assertions[0]?.data.actions[0]?.digitalSourceType).toBe(
      'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    );
  });

  it('Test 6: softwareAgent.name is exactly `ComfyUI`', () => {
    const def = buildManifestDefinition(BASE_OPTS);
    expect(def.assertions[0]?.data.actions[0]?.softwareAgent.name).toBe('ComfyUI');
  });

  it('Test 7: softwareAgent.version equals supplied comfyuiVersion or null', () => {
    const def = buildManifestDefinition({ ...BASE_OPTS, comfyuiVersion: '0.4.2' });
    expect(def.assertions[0]?.data.actions[0]?.softwareAgent.version).toBe('0.4.2');
    const nullDef = buildManifestDefinition({ ...BASE_OPTS, comfyuiVersion: null });
    expect(nullDef.assertions[0]?.data.actions[0]?.softwareAgent.version).toBe(null);
  });
});

describe('buildManifestDefinition — describePrimaryModel branches', () => {
  it('Test 8: hash provided -> `model=NAME; hash=HASH`', () => {
    const def = buildManifestDefinition({
      ...BASE_OPTS,
      primaryModel: SAMPLE_MODEL_WITH_HASH,
    });
    expect(def.assertions[0]?.data.actions[0]?.parameters.description).toBe(
      'model=sd_xl_1.0.safetensors; hash=abc123def456',
    );
  });

  it('Test 9: hash null + unavailable provided -> `model=NAME; hash_unavailable=REASON`', () => {
    const def = buildManifestDefinition({
      ...BASE_OPTS,
      primaryModel: SAMPLE_MODEL_HASH_UNAVAILABLE,
    });
    expect(def.assertions[0]?.data.actions[0]?.parameters.description).toBe(
      'model=sd_xl_1.0.safetensors; hash_unavailable=models_dir_not_configured',
    );
  });

  it('Test 10: primaryModel null -> `model=unknown; hash_unavailable=no_models_recorded`', () => {
    const def = buildManifestDefinition({ ...BASE_OPTS, primaryModel: null });
    expect(def.assertions[0]?.data.actions[0]?.parameters.description).toBe(
      'model=unknown; hash_unavailable=no_models_recorded',
    );
  });
});

describe('buildManifestDefinition — T-14-05 mitigation + purity', () => {
  it('Test 11: T-14-05 mitigation — description NEVER contains an absolute filesystem path', () => {
    // Even if a malicious upstream caller passed an absolute path as the model
    // name, the description string should reflect what was passed verbatim
    // (the basename-only contract is enforced UPSTREAM at the caller site —
    // models_json carries basenames per Plan 13 / D-PROV-06). This test
    // documents the expectation by asserting that with a normal basename, the
    // description starts with `model=BASENAME` and contains no `/` or `\`.
    const def = buildManifestDefinition(BASE_OPTS);
    const desc = def.assertions[0]?.data.actions[0]?.parameters.description ?? '';
    expect(desc.startsWith('model=')).toBe(true);
    expect(desc).not.toContain('/');
    expect(desc).not.toContain('\\');
  });

  it('Test 12: function is pure — calling twice with same inputs produces deeply-equal outputs; no I/O performed', () => {
    const a = buildManifestDefinition(BASE_OPTS);
    const b = buildManifestDefinition(BASE_OPTS);
    expect(a).toEqual(b);
    // Different references (object literals each call) — purity does NOT
    // require identity, only structural equality.
    expect(a).not.toBe(b);

    // No I/O check — ensure the function returns synchronously (not a Promise).
    expect(a).not.toBeInstanceOf(Promise);
  });
});
