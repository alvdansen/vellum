import { describe, it, expect } from 'vitest';
import {
  buildManifestDefinition,
  type BuildManifestOptions,
  type ManifestDefinition,
  type PrimaryModel,
  // Phase 15 / Plan 15-02 — additive surface (Task 1: types; Task 2: function).
  buildManifestWithIngredients,
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

  it('Test 2: claim_generator format `vellum/<appVersion> c2pa-node/0.5.26`', () => {
    const def = buildManifestDefinition(BASE_OPTS);
    expect(def.claim_generator).toBe('vellum/0.1.0 c2pa-node/0.5.26');
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
        claim_generator: 'vellum/0.1.0 c2pa-node/0.5.26',
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
      label: 'vellum.input',
      data: inputData,
    };
    expect(assertion.label).toBe('vellum.input');
    expect(assertion.data.prompt_positive).toBe('a cat');
  });

  it('Type 6: VendorUnavailableIngredientAssertion shape compiles with the audit metadata payload', () => {
    const assertion: VendorUnavailableIngredientAssertion = {
      label: 'vellum.unavailable_ingredient',
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
    expect(assertion.label).toBe('vellum.unavailable_ingredient');
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
      claim_generator: 'vellum/0.1.0 c2pa-node/0.5.26',
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
          label: 'vellum.input',
          data: {
            prompt_positive: null,
            prompt_negative: null,
            sampler: { name: null, scheduler: null, steps: null, cfg: null, denoise: null },
            seed: null,
          },
        },
        {
          label: 'vellum.unavailable_ingredient',
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
      'vellum.input',
      'vellum.unavailable_ingredient',
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

// ──────────────────────────────────────────────────────────────────────────
// Phase 15 / Plan 15-02 — Task 2: buildManifestWithIngredients runtime
// behavior. Asserts the BuildManifestResult shape, the assertions[] order,
// the ingredientSpecs ordering, the discriminated assetRef variants, the
// vendor-assertion emit semantics, and the T-15-04 stripToBasename defence.
// ──────────────────────────────────────────────────────────────────────────

import type {
  ParentIngredient as ParentIngredientType,
  ComponentIngredient as ComponentIngredientType,
  InputAssertion as InputAssertionType,
} from '../ingredient-extractor.js';

const SAMPLE_INPUT_TO: InputAssertionType = {
  prompt_positive: 'a serene mountain',
  prompt_negative: 'no people',
  sampler: { name: 'euler', scheduler: 'normal', steps: 20, cfg: 7.5, denoise: null },
  seed: 42,
};

const SAMPLE_PARENT_REACHABLE: ParentIngredientType = {
  parent_version_id: 'ver_v001',
  lineage_type: 'reproduce',
  manifest_hash: 'sha256:parentmanifesthash',
  parent_unavailable: null,
};

const SAMPLE_PARENT_PENDING: ParentIngredientType = {
  parent_version_id: 'ver_v001',
  lineage_type: 'iterate',
  manifest_hash: null,
  parent_unavailable: 'parent_manifest_pending',
};

const SAMPLE_COMPONENT_LOADIMAGE: ComponentIngredientType = {
  node_id: '5',
  class_type: 'LoadImage',
  role: 'image',
  input_filename: 'control.png',
};

const SAMPLE_COMPONENT_CONTROLNET: ComponentIngredientType = {
  node_id: '7',
  class_type: 'ControlNetApplyAdvanced',
  role: 'control',
  input_filename: 'edges.png',
};

function buildOptsWithIngredients(overrides: {
  parentOf?: ParentIngredientType | null;
  componentOf?: ComponentIngredientType[];
  inputTo?: InputAssertionType;
  refs?: ReadonlyMap<string, IngredientAssetRef>;
}): BuildManifestWithIngredientsOptions {
  return {
    versionId: 'ver_v002',
    mimeType: 'image/png',
    primaryModel: SAMPLE_MODEL_WITH_HASH,
    comfyuiVersion: '0.4.2',
    appVersion: '0.1.0',
    ingredients: {
      parentOf: overrides.parentOf === undefined ? null : overrides.parentOf,
      componentOf: overrides.componentOf ?? [],
      inputTo: overrides.inputTo ?? SAMPLE_INPUT_TO,
    },
    ingredientAssetRefs: overrides.refs ?? new Map(),
  };
}

describe('Plan 15-02 Task 2 — buildManifestWithIngredients (BuildManifestResult shape)', () => {
  it('Test 1: returns BuildManifestResult with definition + ingredientSpecs fields', () => {
    const result = buildManifestWithIngredients(buildOptsWithIngredients({}));
    expect(result).toHaveProperty('definition');
    expect(result).toHaveProperty('ingredientSpecs');
    expect(result.definition).toHaveProperty('assertions');
    expect(Array.isArray(result.ingredientSpecs)).toBe(true);
  });

  it('Test 2: definition.claim_generator + format + title match Phase 14 contract', () => {
    const result = buildManifestWithIngredients(buildOptsWithIngredients({}));
    expect(result.definition.claim_generator).toBe('vellum/0.1.0 c2pa-node/0.5.26');
    expect(result.definition.format).toBe('image/png');
    expect(result.definition.title).toBe('Version ver_v002');
  });
});

describe('Plan 15-02 Task 2 — c2pa.created assertion is unchanged in shape', () => {
  it('Test 3: definition.assertions[0] is c2pa.actions with c2pa.created action carrying primary-model description', () => {
    const result = buildManifestWithIngredients(buildOptsWithIngredients({}));
    const first = result.definition.assertions[0];
    expect(first?.label).toBe('c2pa.actions');
    if (first?.label !== 'c2pa.actions') throw new Error('expected c2pa.actions');
    expect(first.data.actions[0]?.action).toBe('c2pa.created');
    expect(first.data.actions[0]?.softwareAgent.name).toBe('ComfyUI');
    expect(first.data.actions[0]?.parameters.description).toBe(
      'model=sd_xl_1.0.safetensors; hash=abc123def456',
    );
  });
});

describe('Plan 15-02 Task 2 — vellum.input assertion (T-15-01 mitigation)', () => {
  it('Test 4: definition.assertions[1] is vellum.input with the inputTo data verbatim', () => {
    const result = buildManifestWithIngredients(buildOptsWithIngredients({}));
    const second = result.definition.assertions[1];
    expect(second?.label).toBe('vellum.input');
    if (second?.label !== 'vellum.input') throw new Error('expected vellum.input');
    expect(second.data).toEqual(SAMPLE_INPUT_TO);
  });

  it('Test 5: with no ingredients, assertions are exactly [c2pa.actions, vellum.input]', () => {
    const result = buildManifestWithIngredients(buildOptsWithIngredients({}));
    expect(result.definition.assertions.map((a) => a.label)).toEqual([
      'c2pa.actions',
      'vellum.input',
    ]);
  });
});

describe('Plan 15-02 Task 2 — parentOf reachable', () => {
  it('Test 6: parent reachable -> ingredientSpecs has 1 entry, assertions does NOT contain unavailable assertion', () => {
    const refs = new Map<string, IngredientAssetRef>([
      ['parent', { kind: 'file', path: '/abs/path/parent.png', mimeType: 'image/png' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({ parentOf: SAMPLE_PARENT_REACHABLE, refs }),
    );
    expect(result.ingredientSpecs).toHaveLength(1);
    const spec = result.ingredientSpecs[0]!;
    expect(spec.relationship).toBe('parentOf');
    expect(spec.title).toBe('Parent ver_v001');
    expect(spec.assetRef.kind).toBe('file');
    if (spec.assetRef.kind !== 'file') throw new Error('expected file kind');
    expect(spec.assetRef.path).toBe('/abs/path/parent.png');
    expect(spec.auditMetadata).toEqual({
      version_id: 'ver_v001',
      lineage_type: 'reproduce',
      manifest_hash: 'sha256:parentmanifesthash',
    });
    // No unavailable assertion when reachable.
    expect(
      result.definition.assertions.some((a) => a.label === 'vellum.unavailable_ingredient'),
    ).toBe(false);
  });

  it('Test 7: parent reachable via buffer asset -> ingredientSpecs assetRef.kind === buffer', () => {
    const refs = new Map<string, IngredientAssetRef>([
      ['parent', { kind: 'buffer', buffer: Buffer.from('test'), mimeType: 'image/jpeg' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({ parentOf: SAMPLE_PARENT_REACHABLE, refs }),
    );
    expect(result.ingredientSpecs).toHaveLength(1);
    const spec = result.ingredientSpecs[0]!;
    expect(spec.assetRef.kind).toBe('buffer');
    if (spec.assetRef.kind !== 'buffer') throw new Error('expected buffer kind');
    expect(Buffer.isBuffer(spec.assetRef.buffer)).toBe(true);
    expect(spec.assetRef.mimeType).toBe('image/jpeg');
  });
});

describe('Plan 15-02 Task 2 — parentOf unavailable (parent_manifest_pending)', () => {
  it('Test 8: parent_manifest_pending -> spec assetRef.kind=unavailable + vellum.unavailable_ingredient assertion emitted', () => {
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({ parentOf: SAMPLE_PARENT_PENDING, refs: new Map() }),
    );
    // Spec is recorded with assetRef='unavailable' so signer can skip cleanly.
    expect(result.ingredientSpecs).toHaveLength(1);
    const spec = result.ingredientSpecs[0]!;
    expect(spec.relationship).toBe('parentOf');
    expect(spec.assetRef.kind).toBe('unavailable');
    if (spec.assetRef.kind !== 'unavailable') throw new Error('expected unavailable kind');
    expect(spec.assetRef.reason).toBe('parent_manifest_pending');
    // Audit assertion ALSO appears in definition.assertions.
    const unavail = result.definition.assertions.find(
      (a) => a.label === 'vellum.unavailable_ingredient',
    );
    expect(unavail).toBeDefined();
    if (unavail?.label !== 'vellum.unavailable_ingredient') {
      throw new Error('expected vellum.unavailable_ingredient');
    }
    expect(unavail.data).toEqual({
      relationship: 'parentOf',
      title: 'Parent ver_v001',
      reason: 'parent_manifest_pending',
      metadata: {
        version_id: 'ver_v001',
        lineage_type: 'iterate',
        manifest_hash: null,
      },
    });
  });

  it('Test 9: parentOf null -> ZERO parent specs and ZERO unavailable assertions for parent', () => {
    const result = buildManifestWithIngredients(buildOptsWithIngredients({ parentOf: null }));
    // No parent in specs.
    expect(result.ingredientSpecs.filter((s) => s.relationship === 'parentOf')).toHaveLength(0);
    // No unavailable assertion for parent.
    expect(
      result.definition.assertions.some((a) => a.label === 'vellum.unavailable_ingredient'),
    ).toBe(false);
  });
});

describe('Plan 15-02 Task 2 — componentOf reachable + unavailable', () => {
  it('Test 10: component reachable (file) -> ingredientSpecs entry with relationship=componentOf and matching auditMetadata', () => {
    const refs = new Map<string, IngredientAssetRef>([
      ['5', { kind: 'file', path: '/abs/inputs/control.png', mimeType: 'image/png' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({ componentOf: [SAMPLE_COMPONENT_LOADIMAGE], refs }),
    );
    expect(result.ingredientSpecs).toHaveLength(1);
    const spec = result.ingredientSpecs[0]!;
    expect(spec.relationship).toBe('componentOf');
    expect(spec.title).toBe('image image (control.png)');
    expect(spec.assetRef.kind).toBe('file');
    expect(spec.auditMetadata).toEqual({
      node_id: '5',
      role: 'image',
      input_filename: 'control.png',
      class_type: 'LoadImage',
    });
  });

  it('Test 11: component unavailable (file_not_found) -> spec assetRef.kind=unavailable + assertion emitted', () => {
    const refs = new Map<string, IngredientAssetRef>([
      ['5', { kind: 'unavailable', reason: 'file_not_found' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({ componentOf: [SAMPLE_COMPONENT_LOADIMAGE], refs }),
    );
    expect(result.ingredientSpecs).toHaveLength(1);
    const spec = result.ingredientSpecs[0]!;
    expect(spec.assetRef.kind).toBe('unavailable');
    if (spec.assetRef.kind !== 'unavailable') throw new Error('expected unavailable kind');
    expect(spec.assetRef.reason).toBe('file_not_found');
    const unavail = result.definition.assertions.find(
      (a) => a.label === 'vellum.unavailable_ingredient',
    );
    expect(unavail).toBeDefined();
    if (unavail?.label !== 'vellum.unavailable_ingredient') {
      throw new Error('expected vellum.unavailable_ingredient');
    }
    expect(unavail.data.relationship).toBe('componentOf');
    expect(unavail.data.reason).toBe('file_not_found');
    expect(unavail.data.metadata).toEqual({
      node_id: '5',
      role: 'image',
      input_filename: 'control.png',
      class_type: 'LoadImage',
    });
  });

  it('Test 12: component without an entry in ingredientAssetRefs -> falls back to file_not_found unavailable', () => {
    // Map is empty, so refs.get('5') is undefined. Builder treats this as the
    // bytes-unreachable case (file_not_found).
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({
        componentOf: [SAMPLE_COMPONENT_LOADIMAGE],
        refs: new Map(),
      }),
    );
    expect(result.ingredientSpecs).toHaveLength(1);
    const spec = result.ingredientSpecs[0]!;
    expect(spec.assetRef.kind).toBe('unavailable');
    if (spec.assetRef.kind !== 'unavailable') throw new Error('expected unavailable kind');
    expect(spec.assetRef.reason).toBe('file_not_found');
  });

  it('Test 13: empty componentOf + null parentOf -> assertions length === 2 (c2pa.actions + vellum.input ONLY)', () => {
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({ parentOf: null, componentOf: [] }),
    );
    expect(result.definition.assertions).toHaveLength(2);
    expect(result.ingredientSpecs).toHaveLength(0);
  });
});

describe('Plan 15-02 Task 2 — ordering invariants (assertions + ingredientSpecs)', () => {
  it('Test 14: assertions order with parent unavailable + 2 components (1 unavailable) is [c2pa.actions, vellum.input, vellum.unavailable_ingredient*]', () => {
    const refs = new Map<string, IngredientAssetRef>([
      ['5', { kind: 'file', path: '/abs/inputs/control.png', mimeType: 'image/png' }],
      ['7', { kind: 'unavailable', reason: 'file_not_found' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({
        parentOf: SAMPLE_PARENT_PENDING,
        componentOf: [SAMPLE_COMPONENT_LOADIMAGE, SAMPLE_COMPONENT_CONTROLNET],
        refs,
      }),
    );
    // c2pa.actions FIRST (Phase 14 invariant), vendor assertions follow.
    expect(result.definition.assertions.map((a) => a.label)).toEqual([
      'c2pa.actions',
      'vellum.input',
      'vellum.unavailable_ingredient', // parent's unavailable (emitted first)
      'vellum.unavailable_ingredient', // component 7 (ControlNet) unavailable
    ]);
  });

  it('Test 15: ingredientSpecs ordering — parent at index 0, components in extractor node-id order following', () => {
    const refs = new Map<string, IngredientAssetRef>([
      ['parent', { kind: 'file', path: '/abs/parent.png', mimeType: 'image/png' }],
      ['5', { kind: 'file', path: '/abs/control.png', mimeType: 'image/png' }],
      ['7', { kind: 'file', path: '/abs/edges.png', mimeType: 'image/png' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({
        parentOf: SAMPLE_PARENT_REACHABLE,
        componentOf: [SAMPLE_COMPONENT_LOADIMAGE, SAMPLE_COMPONENT_CONTROLNET],
        refs,
      }),
    );
    expect(result.ingredientSpecs).toHaveLength(3);
    expect(result.ingredientSpecs[0]?.relationship).toBe('parentOf');
    expect(result.ingredientSpecs[0]?.title).toBe('Parent ver_v001');
    expect(result.ingredientSpecs[1]?.relationship).toBe('componentOf');
    expect(result.ingredientSpecs[1]?.title).toBe('image image (control.png)');
    expect(result.ingredientSpecs[2]?.relationship).toBe('componentOf');
    expect(result.ingredientSpecs[2]?.title).toBe('control image (edges.png)');
  });
});

describe('Plan 15-02 Task 2 — architectural contract (no c2pa.ingredient in assertions[])', () => {
  it('Test 16: definition.assertions NEVER contains a c2pa.ingredient label, even with reachable parent + components', () => {
    const refs = new Map<string, IngredientAssetRef>([
      ['parent', { kind: 'file', path: '/abs/parent.png', mimeType: 'image/png' }],
      ['5', { kind: 'file', path: '/abs/control.png', mimeType: 'image/png' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({
        parentOf: SAMPLE_PARENT_REACHABLE,
        componentOf: [SAMPLE_COMPONENT_LOADIMAGE],
        refs,
      }),
    );
    // Architectural contract: ingredients flow via manifestBuilder.addIngredient
    // at the impure signer (Plan 15-03), NOT via assertions[].
    expect(
      result.definition.assertions.every((a) => (a.label as string) !== 'c2pa.ingredient'),
    ).toBe(true);
  });
});

describe('Plan 15-02 Task 2 — T-15-04 stripToBasename defence-in-depth', () => {
  it('Test 17: input_filename containing absolute POSIX path -> auditMetadata.input_filename is basename only', () => {
    const componentWithAbsPath: ComponentIngredientType = {
      node_id: '5',
      class_type: 'LoadImage',
      role: 'control',
      input_filename: '/abs/path/to/control.png',
    };
    const refs = new Map<string, IngredientAssetRef>([
      ['5', { kind: 'file', path: '/abs/path/to/control.png', mimeType: 'image/png' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({ componentOf: [componentWithAbsPath], refs }),
    );
    expect(result.ingredientSpecs[0]?.auditMetadata.input_filename).toBe('control.png');
    expect(String(result.ingredientSpecs[0]?.auditMetadata.input_filename)).not.toContain('/');
  });

  it('Test 18: input_filename containing Windows backslashes -> auditMetadata.input_filename is basename only', () => {
    const componentWithWinPath: ComponentIngredientType = {
      node_id: '5',
      class_type: 'LoadImage',
      role: 'control',
      input_filename: 'C:\\Users\\Foo\\Pictures\\control.png',
    };
    const refs = new Map<string, IngredientAssetRef>([
      ['5', { kind: 'unavailable', reason: 'file_not_found' }],
    ]);
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({ componentOf: [componentWithWinPath], refs }),
    );
    expect(result.ingredientSpecs[0]?.auditMetadata.input_filename).toBe('control.png');
    expect(String(result.ingredientSpecs[0]?.auditMetadata.input_filename)).not.toContain('\\');
    // The unavailable assertion ALSO carries the basename only.
    const unavail = result.definition.assertions.find(
      (a) => a.label === 'vellum.unavailable_ingredient',
    );
    if (unavail?.label !== 'vellum.unavailable_ingredient') {
      throw new Error('expected vellum.unavailable_ingredient');
    }
    expect(unavail.data.metadata.input_filename).toBe('control.png');
  });

  it('Test 19: input_filename without any separators -> stripToBasename is identity', () => {
    const result = buildManifestWithIngredients(
      buildOptsWithIngredients({
        componentOf: [SAMPLE_COMPONENT_LOADIMAGE], // input_filename: 'control.png'
        refs: new Map([
          ['5', { kind: 'file', path: '/abs/control.png', mimeType: 'image/png' }],
        ]),
      }),
    );
    expect(result.ingredientSpecs[0]?.auditMetadata.input_filename).toBe('control.png');
  });
});

describe('Plan 15-02 Task 2 — purity (idempotency + no I/O)', () => {
  it('Test 20: deeply-equal inputs produce deeply-equal outputs (idempotency)', () => {
    const refs = new Map<string, IngredientAssetRef>([
      ['parent', { kind: 'file', path: '/abs/parent.png', mimeType: 'image/png' }],
    ]);
    const a = buildManifestWithIngredients(
      buildOptsWithIngredients({ parentOf: SAMPLE_PARENT_REACHABLE, refs }),
    );
    const b = buildManifestWithIngredients(
      buildOptsWithIngredients({ parentOf: SAMPLE_PARENT_REACHABLE, refs }),
    );
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a).not.toBeInstanceOf(Promise);
  });
});
