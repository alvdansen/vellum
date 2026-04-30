import { describe, expect, test } from 'vitest';
import {
  extractModels,
  LOADER_CLASS_TYPES,
  MODEL_DIR_BY_CLASS,
  IMAGE_INPUT_CLASS_TYPES,
  IMAGE_FIELD_BY_CLASS,
} from '../provenance.js';

const CASES: Array<{
  label: string;
  blob: Record<string, unknown>;
  expected: Array<{ node_id: string; class_type: string; model_name: string }>;
}> = [
  {
    label: 'SDXL 1 ckpt',
    blob: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } } },
    expected: [{ node_id: '4', class_type: 'CheckpointLoaderSimple', model_name: 'sd_xl_base_1.0.safetensors' }],
  },
  {
    label: 'multi-lora',
    blob: {
      '5': { class_type: 'LoraLoader', inputs: { lora_name: 'a.safetensors' } },
      '6': { class_type: 'LoraLoader', inputs: { lora_name: 'b.safetensors' } },
    },
    expected: [
      { node_id: '5', class_type: 'LoraLoader', model_name: 'a.safetensors' },
      { node_id: '6', class_type: 'LoraLoader', model_name: 'b.safetensors' },
    ],
  },
  {
    label: 'no-loader',
    blob: { '3': { class_type: 'KSampler', inputs: { seed: 42 } } },
    expected: [],
  },
  {
    label: 'missing-inputs',
    blob: { '4': { class_type: 'CheckpointLoaderSimple' } },
    expected: [],
  },
  {
    label: 'unknown class_type',
    blob: { '4': { class_type: 'MyCustomLoader', inputs: { ckpt_name: 'x' } } },
    expected: [],
  },
  {
    label: 'empty-string ckpt',
    blob: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '' } } },
    expected: [],
  },
  {
    label: 'VAE + UNET + CLIP + ControlNet + StyleModel',
    blob: {
      '4': { class_type: 'VAELoader', inputs: { vae_name: 'v.pt' } },
      '5': { class_type: 'UNETLoader', inputs: { unet_name: 'u.safetensors' } },
      '6': { class_type: 'CLIPLoader', inputs: { clip_name: 'c.safetensors' } },
      '7': { class_type: 'ControlNetLoader', inputs: { control_net_name: 'cn.pth' } },
      '8': { class_type: 'StyleModelLoader', inputs: { style_model_name: 'sm.safetensors' } },
    },
    expected: [
      { node_id: '4', class_type: 'VAELoader', model_name: 'v.pt' },
      { node_id: '5', class_type: 'UNETLoader', model_name: 'u.safetensors' },
      { node_id: '6', class_type: 'CLIPLoader', model_name: 'c.safetensors' },
      { node_id: '7', class_type: 'ControlNetLoader', model_name: 'cn.pth' },
      { node_id: '8', class_type: 'StyleModelLoader', model_name: 'sm.safetensors' },
    ],
  },
  {
    label: 'deterministic sort by node_id numeric',
    blob: {
      '10': { class_type: 'LoraLoader', inputs: { lora_name: 'x' } },
      '2': { class_type: 'LoraLoader', inputs: { lora_name: 'y' } },
    },
    expected: [
      { node_id: '2', class_type: 'LoraLoader', model_name: 'y' },
      { node_id: '10', class_type: 'LoraLoader', model_name: 'x' },
    ],
  },
];

describe('extractModels (D-PROV-06)', () => {
  test.each(CASES)('$label', ({ blob, expected }) => {
    const actual = extractModels(blob).map(({ node_id, class_type, model_name }) => ({
      node_id,
      class_type,
      model_name,
    }));
    expect(actual).toEqual(expected);
  });

  test('all ModelRef entries have model_hash AND model_hash_unavailable null on the pure path', () => {
    // D-CTX-1: pure extraction emits both fields null. Phase 13 fingerprinter
    // (impure) populates exactly one of them after async I/O completes.
    const refs = extractModels({
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x' } },
    });
    expect(refs[0]!.model_hash).toBeNull();
    expect(refs[0]!.model_hash_unavailable).toBeNull();
  });

  test('CLIPLoader falls through to clip_name1 when clip_name missing', () => {
    const refs = extractModels({
      '6': { class_type: 'CLIPLoader', inputs: { clip_name1: 'clip_g.safetensors' } },
    });
    expect(refs).toEqual([
      {
        node_id: '6',
        class_type: 'CLIPLoader',
        model_name: 'clip_g.safetensors',
        model_hash: null,
        model_hash_unavailable: null,
      },
    ]);
  });
});

describe('MODEL_DIR_BY_CLASS coverage of LOADER_CLASS_TYPES (Phase 13 D-CTX-2)', () => {
  test('every LOADER_CLASS_TYPES member is a key of MODEL_DIR_BY_CLASS (lockstep invariant)', () => {
    // Locks the lockstep invariant: a future class_type added to
    // LOADER_CLASS_TYPES without a MODEL_DIR_BY_CLASS entry surfaces here
    // before fingerprintModel falls into the defensive 'unsupported_class_type'
    // path in production.
    expect(Object.keys(MODEL_DIR_BY_CLASS).sort()).toEqual([...LOADER_CLASS_TYPES].sort());
  });
});

describe('IMAGE_INPUT_CLASS_TYPES + IMAGE_FIELD_BY_CLASS (Phase 15 D-CTX-1; v1.1 audit per Plan 15-01 REVISION C1/C2)', () => {
  test('IMAGE_INPUT_CLASS_TYPES contains exactly the v1.1 audit list (six entries)', () => {
    // REVISION C1/C2 — per the plan's <c1c2_audit_v1.1> section, these are
    // the canonical image-input nodes whose 'image' / 'pixels' field carries
    // a user-supplied image filename or upstream-edge tuple. Locked here so
    // any v1.2 audit additions surface as a deliberate test edit.
    expect([...IMAGE_INPUT_CLASS_TYPES].sort()).toEqual([
      'ControlNetApply',
      'ControlNetApplyAdvanced',
      'LoadImage',
      'LoadImageMask',
      'VAEEncode',
      'VAEEncodeForInpaint',
    ]);
  });

  test('IMAGE_INPUT_CLASS_TYPES does NOT contain model loaders (REVISION C1/C2)', () => {
    // IPAdapterModelLoader + CLIPVisionLoader are MODEL LOADERS — they
    // consume on-disk model files via *_file inputs, NOT user-supplied
    // image bytes. They belong on the LOADER side (Phase 13 fingerprinting
    // domain), NOT in this set.
    expect(IMAGE_INPUT_CLASS_TYPES.has('IPAdapterModelLoader')).toBe(false);
    expect(IMAGE_INPUT_CLASS_TYPES.has('CLIPVisionLoader')).toBe(false);
  });

  test('IMAGE_FIELD_BY_CLASS maps every IMAGE_INPUT_CLASS_TYPES entry to a non-empty string[]', () => {
    for (const classType of IMAGE_INPUT_CLASS_TYPES) {
      const fields = IMAGE_FIELD_BY_CLASS[classType];
      expect(fields, `IMAGE_FIELD_BY_CLASS['${classType}'] should be defined`).toBeDefined();
      expect(Array.isArray(fields)).toBe(true);
      expect(fields!.length).toBeGreaterThan(0);
      for (const f of fields!) {
        expect(typeof f).toBe('string');
        expect(f.length).toBeGreaterThan(0);
      }
    }
  });

  test('IMAGE_FIELD_BY_CLASS uses image for filename-bearing nodes; pixels for edge-tuple nodes', () => {
    // LoadImage / LoadImageMask / ControlNetApply* take their image as a
    // STRING filename in the 'image' field. VAEEncode / VAEEncodeForInpaint
    // take an EDGE TUPLE [node_id, output_index] in the 'pixels' field —
    // extractor walks the edge to the upstream LoadImage*-class node.
    expect(IMAGE_FIELD_BY_CLASS.LoadImage).toEqual(['image']);
    expect(IMAGE_FIELD_BY_CLASS.LoadImageMask).toEqual(['image']);
    expect(IMAGE_FIELD_BY_CLASS.ControlNetApply).toEqual(['image']);
    expect(IMAGE_FIELD_BY_CLASS.ControlNetApplyAdvanced).toEqual(['image']);
    expect(IMAGE_FIELD_BY_CLASS.VAEEncode).toEqual(['pixels']);
    expect(IMAGE_FIELD_BY_CLASS.VAEEncodeForInpaint).toEqual(['pixels']);
  });

  test('IMAGE_INPUT_CLASS_TYPES and LOADER_CLASS_TYPES are DISJOINT (architecture invariant)', () => {
    // Disjointness lock: a class_type in BOTH sets means we have ambiguous
    // domain boundaries (Phase 13 model fingerprinting vs Phase 15
    // ingredient hashing). The test surfaces the regression at compile-fail
    // time, before any prompt walk emits double-counted entries.
    const loaders = new Set(LOADER_CLASS_TYPES);
    for (const c of IMAGE_INPUT_CLASS_TYPES) {
      expect(loaders.has(c), `class_type '${c}' must NOT be in both sets`).toBe(false);
    }
    const images = new Set(IMAGE_INPUT_CLASS_TYPES);
    for (const c of LOADER_CLASS_TYPES) {
      expect(images.has(c), `class_type '${c}' must NOT be in both sets`).toBe(false);
    }
  });
});
