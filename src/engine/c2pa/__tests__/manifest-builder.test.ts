import { describe, it, expect } from 'vitest';
import {
  buildManifestDefinition,
  type BuildManifestOptions,
  type ManifestDefinition,
  type PrimaryModel,
  // Phase 15 / Plan 15-02 — additive surface (Task 1: types; Task 2: function).
  type BuildManifestWithIngredientsOptions,
  type IngredientAssetRef,
  type IngredientSpec,
  type BuildManifestResult,
  type ManifestAssertion,
  type CreatedActionAssertion,
  type VendorInputAssertion,
  type VendorUnavailableIngredientAssertion,
} from '../manifest-builder.js';
import type {
  ParentIngredient,
  ComponentIngredient,
  InputAssertion,
} from '../ingredient-extractor.js';

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

/**
 * Phase 15 / Plan 15-02 narrowing helper — assertions[] is now a union over
 * three shapes (CreatedActionAssertion | VendorInputAssertion |
 * VendorUnavailableIngredientAssertion). Phase 14 tests drilled directly into
 * `def.assertions[0].data.actions` which only exists on CreatedActionAssertion.
 * This helper narrows by label, throwing if the assertion at the index is the
 * wrong shape — preserves the Phase 14 test ergonomics behind a single line.
 */
function pickCreatedAction(def: ManifestDefinition): CreatedActionAssertion {
  const a = def.assertions[0];
  if (!a || a.label !== 'c2pa.actions') {
    throw new Error(`expected assertions[0] to be c2pa.actions, got: ${a?.label ?? 'undefined'}`);
  }
  return a;
}

describe('buildManifestDefinition — D-CTX-4 c2pa.created shape', () => {
  it('Test 1: assertions[0].label is c2pa.actions and actions[0].action is c2pa.created', () => {
    const def: ManifestDefinition = buildManifestDefinition(BASE_OPTS);
    expect(def.assertions).toHaveLength(1);
    expect(def.assertions[0]?.label).toBe('c2pa.actions');
    const created = pickCreatedAction(def);
    expect(created.data.actions).toHaveLength(1);
    expect(created.data.actions[0]?.action).toBe('c2pa.created');
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
    expect(pickCreatedAction(def).data.actions[0]?.digitalSourceType).toBe(
      'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    );
  });

  it('Test 6: softwareAgent.name is exactly `ComfyUI`', () => {
    const def = buildManifestDefinition(BASE_OPTS);
    expect(pickCreatedAction(def).data.actions[0]?.softwareAgent.name).toBe('ComfyUI');
  });

  it('Test 7: softwareAgent.version equals supplied comfyuiVersion or null', () => {
    const def = buildManifestDefinition({ ...BASE_OPTS, comfyuiVersion: '0.4.2' });
    expect(pickCreatedAction(def).data.actions[0]?.softwareAgent.version).toBe('0.4.2');
    const nullDef = buildManifestDefinition({ ...BASE_OPTS, comfyuiVersion: null });
    expect(pickCreatedAction(nullDef).data.actions[0]?.softwareAgent.version).toBe(null);
  });
});

describe('buildManifestDefinition — describePrimaryModel branches', () => {
  it('Test 8: hash provided -> `model=NAME; hash=HASH`', () => {
    const def = buildManifestDefinition({
      ...BASE_OPTS,
      primaryModel: SAMPLE_MODEL_WITH_HASH,
    });
    expect(pickCreatedAction(def).data.actions[0]?.parameters.description).toBe(
      'model=sd_xl_1.0.safetensors; hash=abc123def456',
    );
  });

  it('Test 9: hash null + unavailable provided -> `model=NAME; hash_unavailable=REASON`', () => {
    const def = buildManifestDefinition({
      ...BASE_OPTS,
      primaryModel: SAMPLE_MODEL_HASH_UNAVAILABLE,
    });
    expect(pickCreatedAction(def).data.actions[0]?.parameters.description).toBe(
      'model=sd_xl_1.0.safetensors; hash_unavailable=models_dir_not_configured',
    );
  });

  it('Test 10: primaryModel null -> `model=unknown; hash_unavailable=no_models_recorded`', () => {
    const def = buildManifestDefinition({ ...BASE_OPTS, primaryModel: null });
    expect(pickCreatedAction(def).data.actions[0]?.parameters.description).toBe(
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
    const desc = pickCreatedAction(def).data.actions[0]?.parameters.description ?? '';
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

// ──────────────────────────────────────────────────────────────────────────
// Phase 15 / Plan 15-02 — Task 1: type-shape coverage for the additive
// IngredientSpec / BuildManifestResult / ManifestAssertion union surface.
// These tests are pure compile-time + structural shape locks; the runtime
// builder lives in Task 2. The point of having them isolated in their own
// describe block is that if Task 2's body regresses, the Task 1 type checks
// stay green (locking the contract) and ONLY the runtime assertions fail —
// makes regressions cheap to attribute.
// ──────────────────────────────────────────────────────────────────────────

describe('Plan 15-02 Task 1 — additive types compile + match expected shapes', () => {
  it('Type 1: BuildManifestOptions (Phase 14) shape preserved — legacy callers compile byte-unchanged', () => {
    // The Phase 14 BuildManifestOptions interface must accept its original
    // 5-field shape. If a future edit accidentally added a required field,
    // this assignment would fail the typecheck (caught by `npx tsc --noEmit`).
    const opts: BuildManifestOptions = {
      versionId: 'ver_abc',
      mimeType: 'image/png',
      primaryModel: null,
      comfyuiVersion: null,
      appVersion: '0.1.0',
    };
    // Runtime assertion: object spreads cleanly; no implicit fields the
    // interface gained that we forgot.
    expect(Object.keys(opts).sort()).toEqual([
      'appVersion',
      'comfyuiVersion',
      'mimeType',
      'primaryModel',
      'versionId',
    ]);
  });

  it('Type 2: IngredientAssetRef discriminated union — buffer / file / unavailable variants', () => {
    const buf: IngredientAssetRef = {
      kind: 'buffer',
      buffer: Buffer.from('test'),
      mimeType: 'image/png',
    };
    const file: IngredientAssetRef = {
      kind: 'file',
      path: '/abs/path/to/image.png',
      mimeType: 'image/png',
    };
    const unavailFnf: IngredientAssetRef = { kind: 'unavailable', reason: 'file_not_found' };
    const unavailUnreadable: IngredientAssetRef = {
      kind: 'unavailable',
      reason: 'file_unreadable',
    };
    const unavailParent: IngredientAssetRef = {
      kind: 'unavailable',
      reason: 'parent_manifest_pending',
    };
    // Discriminator preserved at runtime — narrowing via `kind` works.
    expect(buf.kind).toBe('buffer');
    expect(file.kind).toBe('file');
    expect(unavailFnf.kind).toBe('unavailable');
    expect(unavailUnreadable.kind).toBe('unavailable');
    expect(unavailParent.kind).toBe('unavailable');
  });

  it('Type 3: IngredientSpec compiles with required fields (relationship / title / assetRef / auditMetadata)', () => {
    const spec: IngredientSpec = {
      relationship: 'parentOf',
      title: 'Parent ver_v001',
      assetRef: { kind: 'unavailable', reason: 'parent_manifest_pending' },
      auditMetadata: {
        version_id: 'ver_v001',
        lineage_type: 'reproduce',
        manifest_hash: null,
      },
    };
    expect(spec.relationship).toBe('parentOf');
    // componentOf variant accepted too.
    const comp: IngredientSpec = {
      relationship: 'componentOf',
      title: 'control image (mask.png)',
      assetRef: { kind: 'file', path: '/abs/mask.png', mimeType: 'image/png' },
      auditMetadata: { node_id: '5', role: 'control', input_filename: 'mask.png' },
    };
    expect(comp.relationship).toBe('componentOf');
  });

  it('Type 4: BuildManifestResult compiles with definition + ingredientSpecs fields', () => {
    const result: BuildManifestResult = {
      definition: {
        claim_generator: 'vfx-familiar/0.1.0 c2pa-node/0.5.26',
        format: 'image/png',
        title: 'Version ver_abc',
        assertions: [],
      },
      ingredientSpecs: [],
    };
    // Both fields are required.
    expect(Object.keys(result).sort()).toEqual(['definition', 'ingredientSpecs']);
    expect(Array.isArray(result.ingredientSpecs)).toBe(true);
  });

  it('Type 5: VendorInputAssertion shape compiles + accepts the InputAssertion data shape verbatim', () => {
    const inputData: InputAssertion = {
      prompt_positive: 'a cat',
      prompt_negative: null,
      sampler: { name: 'euler', scheduler: 'normal', steps: 20, cfg: 7.5, denoise: null },
      seed: 42,
    };
    const assertion: VendorInputAssertion = {
      label: 'vfx_familiar.input',
      data: inputData,
    };
    expect(assertion.label).toBe('vfx_familiar.input');
    expect(assertion.data.prompt_positive).toBe('a cat');
  });

  it('Type 6: VendorUnavailableIngredientAssertion shape compiles with the audit metadata payload', () => {
    const assertion: VendorUnavailableIngredientAssertion = {
      label: 'vfx_familiar.unavailable_ingredient',
      data: {
        relationship: 'parentOf',
        title: 'Parent ver_v001',
        reason: 'parent_manifest_pending',
        metadata: {
          version_id: 'ver_v001',
          lineage_type: 'reproduce',
          manifest_hash: null,
        },
      },
    };
    expect(assertion.label).toBe('vfx_familiar.unavailable_ingredient');
    expect(assertion.data.reason).toBe('parent_manifest_pending');
  });

  it('Type 7: CreatedActionAssertion is a member of the ManifestAssertion union (Phase 14 narrows in)', () => {
    // The Phase 14 c2pa.actions assertion shape narrows to CreatedActionAssertion,
    // which IS a member of the broader ManifestAssertion union. Locks the
    // backward-compat invariant at the type system level.
    const created: CreatedActionAssertion = {
      label: 'c2pa.actions',
      data: {
        actions: [
          {
            action: 'c2pa.created',
            digitalSourceType: 'http://example/sourcetype',
            softwareAgent: { name: 'ComfyUI', version: null },
            parameters: { description: 'model=test' },
          },
        ],
      },
    };
    const asUnion: ManifestAssertion = created; // assignment proves union membership
    expect(asUnion.label).toBe('c2pa.actions');
  });

  it('Type 8: BuildManifestWithIngredientsOptions extends BuildManifestOptions with ingredients + ingredientAssetRefs', () => {
    const parent: ParentIngredient = {
      parent_version_id: 'ver_v001',
      lineage_type: 'reproduce',
      manifest_hash: 'sha256:abc123',
      parent_unavailable: null,
    };
    const components: ComponentIngredient[] = [
      { node_id: '5', class_type: 'LoadImage', role: 'control', input_filename: 'control.png' },
    ];
    const inputTo: InputAssertion = {
      prompt_positive: null,
      prompt_negative: null,
      sampler: { name: null, scheduler: null, steps: null, cfg: null, denoise: null },
      seed: null,
    };
    const refs = new Map<string, IngredientAssetRef>([
      ['parent', { kind: 'file', path: '/abs/parent.png', mimeType: 'image/png' }],
      ['5', { kind: 'unavailable', reason: 'file_not_found' }],
    ]);
    const opts: BuildManifestWithIngredientsOptions = {
      versionId: 'ver_v002',
      mimeType: 'image/png',
      primaryModel: null,
      comfyuiVersion: null,
      appVersion: '0.1.0',
      ingredients: { parentOf: parent, componentOf: components, inputTo },
      ingredientAssetRefs: refs,
    };
    // Inherited Phase 14 fields present.
    expect(opts.versionId).toBe('ver_v002');
    // New Phase 15 fields present.
    expect(opts.ingredients.componentOf).toHaveLength(1);
    expect(opts.ingredientAssetRefs.size).toBe(2);
  });

  it('Type 9: ManifestDefinition.assertions accepts the broadened ManifestAssertion union', () => {
    // Phase 14's c2pa.actions assertion + Phase 15's two vendor assertions all
    // members of the union. This test locks the broadening — if a future edit
    // narrowed the union, this assignment fails to typecheck.
    const def: ManifestDefinition = {
      claim_generator: 'vfx-familiar/0.1.0 c2pa-node/0.5.26',
      format: 'image/png',
      title: 'Version ver_v002',
      assertions: [
        {
          label: 'c2pa.actions',
          data: {
            actions: [
              {
                action: 'c2pa.created',
                digitalSourceType: 'http://example/sourcetype',
                softwareAgent: { name: 'ComfyUI', version: null },
                parameters: { description: 'model=test' },
              },
            ],
          },
        },
        {
          label: 'vfx_familiar.input',
          data: {
            prompt_positive: null,
            prompt_negative: null,
            sampler: { name: null, scheduler: null, steps: null, cfg: null, denoise: null },
            seed: null,
          },
        },
        {
          label: 'vfx_familiar.unavailable_ingredient',
          data: {
            relationship: 'componentOf',
            title: 'control image (missing.png)',
            reason: 'file_not_found',
            metadata: { node_id: '5', role: 'control', input_filename: 'missing.png' },
          },
        },
      ],
    };
    expect(def.assertions).toHaveLength(3);
    expect(def.assertions.map((a) => a.label)).toEqual([
      'c2pa.actions',
      'vfx_familiar.input',
      'vfx_familiar.unavailable_ingredient',
    ]);
  });

  it('Type 10: backward-compat invariant — buildManifestDefinition still returns assertions:[c2pa.actions] (length 1)', () => {
    // This is the Phase 14 invariant. If Plan 15-02 (or any later plan)
    // accidentally reshapes the legacy entry point, this fails immediately.
    const def = buildManifestDefinition(BASE_OPTS);
    expect(def.assertions).toHaveLength(1);
    expect(def.assertions[0]?.label).toBe('c2pa.actions');
  });
});
