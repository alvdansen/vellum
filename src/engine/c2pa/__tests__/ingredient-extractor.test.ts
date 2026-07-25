import { describe, it, expect } from 'vitest';
import {
  extractParentIngredient,
  extractComponentIngredients,
  extractInputAssertion,
  INPUT_PROMPT_MAX_CHARS,
  type ParentIngredient,
  type ComponentIngredient,
  type InputAssertion,
} from '../ingredient-extractor.js';

/**
 * Phase 15 Plan 15-01 Task 2 — pure ingredient extraction.
 *
 * Three pure functions:
 *  - extractParentIngredient (D-CTX-1, D-CTX-6)
 *  - extractComponentIngredients (D-CTX-1; v1.1 audit per REVISION C1/C2 —
 *    handles direct-filename and edge-tuple field shapes)
 *  - extractInputAssertion (T-15-01; REVISION B5 KSampler edge walk)
 *
 * Architecture-purity: zero MCP / native-binding / SQLite-driver / ORM
 * imports — locked by file-level grep gate in architecture-purity.test.ts.
 */

// ────────────────────────────────────────────────────────────────────────
// extractParentIngredient
// ────────────────────────────────────────────────────────────────────────

describe('extractParentIngredient (D-CTX-1, D-CTX-6)', () => {
  it('PI-1: returns null when version.parent_version_id is null (top-of-lineage)', () => {
    const result = extractParentIngredient(
      { parent_version_id: null, lineage_type: null },
      () => 'unused-hash',
    );
    expect(result).toBeNull();
  });

  it('PI-2: when parent_version_id set + getParentManifestHash returns a hash', () => {
    const result = extractParentIngredient(
      { parent_version_id: 'ver_parent_xyz', lineage_type: 'reproduce' },
      (id) => {
        expect(id).toBe('ver_parent_xyz');
        return 'sha256:abc123';
      },
    );
    expect(result).toEqual<ParentIngredient>({
      parent_version_id: 'ver_parent_xyz',
      lineage_type: 'reproduce',
      manifest_hash: 'sha256:abc123',
      parent_unavailable: null,
    });
  });

  it('PI-3: when getParentManifestHash returns null → parent_manifest_pending (D-CTX-6)', () => {
    const result = extractParentIngredient(
      { parent_version_id: 'ver_parent_pending', lineage_type: 'iterate' },
      () => null,
    );
    expect(result).toEqual<ParentIngredient>({
      parent_version_id: 'ver_parent_pending',
      lineage_type: 'iterate',
      manifest_hash: null,
      parent_unavailable: 'parent_manifest_pending',
    });
  });

  it('PI-defensive: lineage_type null is coerced to "iterate" (defensive default)', () => {
    // In production, every reproduce/iterate child has lineage_type set at
    // creation time. The defensive default exists for legacy / partially-
    // migrated rows. The parent itself carries the authoritative
    // lineage_type, so this default is a safe degradation.
    const result = extractParentIngredient(
      { parent_version_id: 'ver_legacy', lineage_type: null },
      () => 'sha256:legacy',
    );
    expect(result?.lineage_type).toBe('iterate');
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractComponentIngredients
// ────────────────────────────────────────────────────────────────────────

describe('extractComponentIngredients (D-CTX-1; v1.1 audit per REVISION C1/C2)', () => {
  it('CI-1: walks the prompt blob and emits one ingredient per IMAGE_INPUT_CLASS_TYPES node, sorted by node_id', () => {
    const blob = {
      '20': { class_type: 'LoadImage', inputs: { image: 'control_pose.png' } },
      '5': { class_type: 'LoadImage', inputs: { image: 'reference_a.png' } },
      '12': { class_type: 'LoadImageMask', inputs: { image: 'mask_inpaint.png' } },
    };
    const result = extractComponentIngredients(blob);
    expect(result.map((c) => c.node_id)).toEqual(['5', '12', '20']);
    expect(result[0]?.input_filename).toBe('reference_a.png');
    expect(result[1]?.input_filename).toBe('mask_inpaint.png');
    expect(result[2]?.input_filename).toBe('control_pose.png');
  });

  it('CI-2: skips loader nodes (LOADER_CLASS_TYPES is Phase 13 domain, not Phase 15)', () => {
    const blob = {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl.safetensors' } },
      '5': { class_type: 'LoraLoader', inputs: { lora_name: 'lora.safetensors' } },
      '6': { class_type: 'LoadImage', inputs: { image: 'real_input.png' } },
    };
    const result = extractComponentIngredients(blob);
    expect(result).toHaveLength(1);
    expect(result[0]?.class_type).toBe('LoadImage');
  });

  it('CI-3: LoadImage / LoadImageMask / ControlNetApply* read inputs.image as a STRING; missing/non-string skipped', () => {
    const blob = {
      '1': { class_type: 'LoadImage', inputs: { image: 'good.png' } },
      '2': { class_type: 'LoadImage', inputs: {} }, // missing image — skip
      '3': { class_type: 'LoadImage', inputs: { image: '' } }, // empty string — skip
      '4': { class_type: 'LoadImage', inputs: { image: 42 } }, // non-string — skip
      '5': { class_type: 'LoadImageMask', inputs: { image: 'mask.png' } },
      '6': { class_type: 'ControlNetApplyAdvanced', inputs: { image: 'control.png' } },
      '7': { class_type: 'ControlNetApply', inputs: { image: 'old_control.png' } },
    };
    const result = extractComponentIngredients(blob);
    expect(result.map((c) => c.node_id)).toEqual(['1', '5', '6', '7']);
  });

  it('CI-4: VAEEncode / VAEEncodeForInpaint follow the pixels edge to upstream LoadImage*', () => {
    const blob = {
      // Upstream LoadImage referenced by VAEEncode below
      '10': { class_type: 'LoadImage', inputs: { image: 'img2img_source.png' } },
      // VAEEncode reads pixels edge to LoadImage 10
      '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0] } },
      // VAEEncodeForInpaint reads pixels edge to LoadImageMask 12
      '12': { class_type: 'LoadImageMask', inputs: { image: 'inpaint_source.png' } },
      '13': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['12', 0] } },
    };
    const result = extractComponentIngredients(blob);
    // 10 and 12 are direct LoadImage* — included with their own filenames
    // 11 (VAEEncode) follows edge to 10 → 'img2img_source.png'
    // 13 (VAEEncodeForInpaint) follows edge to 12 → 'inpaint_source.png'
    expect(result.map((c) => ({ id: c.node_id, fname: c.input_filename }))).toEqual([
      { id: '10', fname: 'img2img_source.png' },
      { id: '11', fname: 'img2img_source.png' },
      { id: '12', fname: 'inpaint_source.png' },
      { id: '13', fname: 'inpaint_source.png' },
    ]);
  });

  it('CI-4b: VAEEncode whose upstream is NOT a LoadImage* (e.g., procedural EmptyLatentImage) is silently skipped', () => {
    const blob = {
      // EmptyLatentImage is procedural — has no canonical filename
      '20': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
      '21': { class_type: 'VAEEncode', inputs: { pixels: ['20', 0] } },
    };
    const result = extractComponentIngredients(blob);
    expect(result).toEqual([]);
  });

  it('CI-4c: VAEEncode with malformed pixels (not a tuple, not a string) is silently skipped', () => {
    const blob = {
      '21': { class_type: 'VAEEncode', inputs: { pixels: 42 } },
      '22': { class_type: 'VAEEncode', inputs: { pixels: { foo: 'bar' } } },
      '23': { class_type: 'VAEEncode', inputs: {} },
    };
    const result = extractComponentIngredients(blob);
    expect(result).toEqual([]);
  });

  it('CI-5: role mapping per class_type', () => {
    const blob = {
      '1': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
      '2': { class_type: 'LoadImageMask', inputs: { image: 'b.png' } },
      '3': { class_type: 'ControlNetApply', inputs: { image: 'c.png' } },
      '4': { class_type: 'ControlNetApplyAdvanced', inputs: { image: 'd.png' } },
      '5': { class_type: 'LoadImage', inputs: { image: 'e.png' } },
      '6': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0] } },
      '7': { class_type: 'LoadImageMask', inputs: { image: 'f.png' } },
      '8': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['7', 0] } },
    };
    const result = extractComponentIngredients(blob);
    const roles = Object.fromEntries(result.map((c) => [c.node_id, c.role]));
    expect(roles).toEqual({
      '1': 'image',
      '2': 'mask',
      '3': 'control',
      '4': 'control',
      '5': 'image',
      '6': 'reference',
      '7': 'mask',
      '8': 'reference',
    });
  });

  it('CI-6: deterministic ordering — same blob input twice produces identical output', () => {
    const blob = {
      '7': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'b.png' } },
      '15': { class_type: 'LoadImageMask', inputs: { image: 'c.png' } },
    };
    const a = extractComponentIngredients(blob);
    const b = extractComponentIngredients(blob);
    expect(a).toEqual(b);
    expect(a.map((c) => c.node_id)).toEqual(['2', '7', '15']);
  });

  it('CI-defensive: malformed entries are silently skipped (non-object value, missing class_type, missing inputs)', () => {
    const blob = {
      '1': null,
      '2': 'not-a-node',
      '3': { /* no class_type */ inputs: { image: 'x.png' } },
      '4': { class_type: 42, inputs: {} },
      '5': { class_type: 'LoadImage' /* no inputs */ },
      '6': { class_type: 'LoadImage', inputs: 'not-an-object' },
      '7': { class_type: 'LoadImage', inputs: { image: 'good.png' } },
    };
    const result = extractComponentIngredients(blob);
    expect(result).toHaveLength(1);
    expect(result[0]?.node_id).toBe('7');
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractInputAssertion (REVISION B5 — KSampler edge walk)
// ────────────────────────────────────────────────────────────────────────

describe('extractInputAssertion (T-15-01; REVISION B5 KSampler edge walk)', () => {
  it('IA-1: returns InputAssertion structure; never workflow_json verbatim (T-15-01)', () => {
    const blob = {
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: 42,
          steps: 20,
          cfg: 7.0,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1.0,
          positive: ['6', 0],
          negative: ['7', 0],
        },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, ugly' } },
    };
    const result = extractInputAssertion(blob, 42);
    // Has the four canonical fields
    expect(Object.keys(result).sort()).toEqual(['prompt_negative', 'prompt_positive', 'sampler', 'seed']);
    // Does NOT contain a workflow_json key (T-15-01)
    expect(Object.keys(result)).not.toContain('workflow_json');
    expect(Object.keys(result)).not.toContain('prompt');
  });

  it('IA-2: prompt_positive/negative resolved via KSampler edge walk', () => {
    const blob = {
      '5': {
        class_type: 'KSampler',
        inputs: { seed: 42, positive: ['6', 0], negative: ['7', 0] },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat in a hat' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, ugly' } },
    };
    const result = extractInputAssertion(blob, 42);
    expect(result.prompt_positive).toBe('a cat in a hat');
    expect(result.prompt_negative).toBe('blurry, ugly');
  });

  it('IA-3: unreferenced CLIPTextEncode nodes are IGNORED (locks REVISION B5 — edge walk, not positional)', () => {
    // THREE CLIPTextEncode nodes; KSampler only references nodes 6 and 7.
    // The unreferenced node (10) is an experimental/abandoned branch and
    // MUST NOT influence the inputTo assertion. The earlier "first/second
    // positional" heuristic would have surfaced node 6 (lowest ID) as
    // positive but might surface node 10 (next in some orderings) as
    // negative — which is wrong. Edge walk is the only correct semantic.
    const blob = {
      '5': {
        class_type: 'KSampler',
        inputs: { seed: 42, positive: ['6', 0], negative: ['7', 0] },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'good positive' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'good negative' } },
      '10': { class_type: 'CLIPTextEncode', inputs: { text: 'EXPERIMENTAL UNUSED — should not appear' } },
    };
    const result = extractInputAssertion(blob, 42);
    expect(result.prompt_positive).toBe('good positive');
    expect(result.prompt_negative).toBe('good negative');
    // Defensive: ensure the unreferenced node's text is nowhere in the result
    expect(JSON.stringify(result)).not.toContain('EXPERIMENTAL UNUSED');
  });

  it('IA-4: edge pointing at non-CLIPTextEncode (e.g., ConditioningCombine) → null prompt', () => {
    // Defensive: only direct CLIPTextEncode ancestors are recognised in v1.1.
    // Deeper traversal through ConditioningCombine / ConditioningConcat is
    // explicitly deferred to v1.2.
    const blob = {
      '5': {
        class_type: 'KSampler',
        inputs: { seed: 42, positive: ['9', 0], negative: ['7', 0] },
      },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'negative text' } },
      '9': { class_type: 'ConditioningCombine', inputs: { conditioning_1: ['6', 0], conditioning_2: ['8', 0] } },
    };
    const result = extractInputAssertion(blob, 42);
    expect(result.prompt_positive).toBeNull();
    expect(result.prompt_negative).toBe('negative text');
  });

  it('IA-5: no KSampler in the blob → both prompts null', () => {
    const blob = {
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'orphan positive' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'orphan negative' } },
    };
    const result = extractInputAssertion(blob, null);
    expect(result.prompt_positive).toBeNull();
    expect(result.prompt_negative).toBeNull();
    // No KSampler → sampler params all null
    expect(result.sampler.name).toBeNull();
    expect(result.sampler.steps).toBeNull();
  });

  it('IA-6: multiple KSamplers → uses the first resolvable (lowest node_id with valid edges)', () => {
    const blob = {
      '20': {
        class_type: 'KSampler',
        // FIRST in node-id order — edges resolve cleanly
        inputs: { seed: 42, positive: ['6', 0], negative: ['7', 0], sampler_name: 'euler' },
      },
      '30': {
        class_type: 'KSampler',
        // SECOND in node-id order — different sampler; should NOT be chosen
        inputs: { seed: 99, positive: ['8', 0], negative: ['9', 0], sampler_name: 'dpmpp_2m' },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'first positive' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'first negative' } },
      '8': { class_type: 'CLIPTextEncode', inputs: { text: 'second positive' } },
      '9': { class_type: 'CLIPTextEncode', inputs: { text: 'second negative' } },
    };
    const result = extractInputAssertion(blob, 42);
    expect(result.prompt_positive).toBe('first positive');
    expect(result.prompt_negative).toBe('first negative');
    expect(result.sampler.name).toBe('euler');
  });

  it('IA-7: prompt text is capped at INPUT_PROMPT_MAX_CHARS with truncation marker (T-15-01)', () => {
    expect(INPUT_PROMPT_MAX_CHARS).toBe(4096);
    const longPrompt = 'x'.repeat(INPUT_PROMPT_MAX_CHARS + 500);
    const blob = {
      '5': { class_type: 'KSampler', inputs: { seed: 42, positive: ['6', 0], negative: ['7', 0] } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: longPrompt } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'short' } },
    };
    const result = extractInputAssertion(blob, 42);
    expect(result.prompt_positive).not.toBeNull();
    expect(result.prompt_positive!.length).toBeGreaterThan(INPUT_PROMPT_MAX_CHARS);
    expect(result.prompt_positive).toContain('...[500 chars truncated]');
    expect(result.prompt_positive!.startsWith('xxxx')).toBe(true);
    expect(result.prompt_negative).toBe('short');
  });

  it('IA-8: KSampler params extracted from the chosen KSampler; missing fields → null', () => {
    const blob = {
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: 42, positive: ['6', 0], negative: ['7', 0],
          sampler_name: 'euler', scheduler: 'karras', steps: 25, cfg: 6.5, denoise: 0.85,
        },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'p' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'n' } },
    };
    const result = extractInputAssertion(blob, 42);
    expect(result.sampler).toEqual({
      name: 'euler', scheduler: 'karras', steps: 25, cfg: 6.5, denoise: 0.85,
    });
  });

  it('IA-8b: missing sampler fields surface as null', () => {
    const blob = {
      '5': {
        class_type: 'KSampler',
        // Only seed + edges; nothing else
        inputs: { seed: 42, positive: ['6', 0], negative: ['7', 0] },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'p' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'n' } },
    };
    const result = extractInputAssertion(blob, 42);
    expect(result.sampler).toEqual({
      name: null, scheduler: null, steps: null, cfg: null, denoise: null,
    });
  });

  it('IA-9: seed is the caller-supplied value (caller resolves seed; pure helper passes through)', () => {
    const blob = {
      '5': { class_type: 'KSampler', inputs: { seed: 42, positive: ['6', 0], negative: ['7', 0] } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'p' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'n' } },
    };
    expect(extractInputAssertion(blob, 999).seed).toBe(999);
    expect(extractInputAssertion(blob, null).seed).toBeNull();
  });

  it('IA-10: KSamplerAdvanced (uses noise_seed instead of seed) is recognised', () => {
    // KSAMPLER_CLASS_TYPES set membership covers all four sampler variants.
    // The test asserts the sampler is RECOGNISED (i.e., the chosen KSampler
    // for prompt edge walking) — caller resolves the actual seed param.
    const blob = {
      '5': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          noise_seed: 12345, positive: ['6', 0], negative: ['7', 0],
          sampler_name: 'dpmpp_2m', scheduler: 'karras', steps: 30, cfg: 8.0,
        },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'adv positive' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'adv negative' } },
    };
    const result = extractInputAssertion(blob, 12345);
    expect(result.prompt_positive).toBe('adv positive');
    expect(result.prompt_negative).toBe('adv negative');
    expect(result.sampler.name).toBe('dpmpp_2m');
    expect(result.sampler.steps).toBe(30);
    expect(result.seed).toBe(12345);
  });

  it('IA-defensive: malformed positive/negative edges (not tuples) → null prompts but sampler params still extracted from first KSampler', () => {
    const blob = {
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: 42, positive: 'not-a-tuple', negative: 42,
          sampler_name: 'euler', steps: 20,
        },
      },
    };
    const result = extractInputAssertion(blob, 42);
    expect(result.prompt_positive).toBeNull();
    expect(result.prompt_negative).toBeNull();
    expect(result.sampler.name).toBe('euler');
    expect(result.sampler.steps).toBe(20);
  });

  it('IA-defensive: CLIPTextEncodeSDXL with text_g / text_l fallback (no plain text)', () => {
    // CLIPTextEncodeSDXL has both text_g and text_l. When text is absent,
    // prefer text_g, then text_l. The extractor recognises the SDXL variant
    // class names alongside the canonical CLIPTextEncode.
    const blob = {
      '5': { class_type: 'KSampler', inputs: { seed: 42, positive: ['6', 0], negative: ['7', 0] } },
      '6': { class_type: 'CLIPTextEncodeSDXL', inputs: { text_g: 'sdxl global', text_l: 'sdxl local' } },
      '7': { class_type: 'CLIPTextEncodeSDXLRefiner', inputs: { text_l: 'refiner local only' } },
    };
    const result = extractInputAssertion(blob, 42);
    // text_g preferred over text_l when both exist
    expect(result.prompt_positive).toBe('sdxl global');
    // Fallback to text_l when text_g absent
    expect(result.prompt_negative).toBe('refiner local only');
  });

  it('IA-defensive: empty prompt blob → all-null structured result', () => {
    const result = extractInputAssertion({}, null);
    expect(result).toEqual<InputAssertion>({
      prompt_positive: null,
      prompt_negative: null,
      sampler: { name: null, scheduler: null, steps: null, cfg: null, denoise: null },
      seed: null,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cross-function consistency
// ────────────────────────────────────────────────────────────────────────

describe('consistency invariants', () => {
  it('extractComponentIngredients return type is properly typed (TS compile gate)', () => {
    const result: ComponentIngredient[] = extractComponentIngredients({
      '1': { class_type: 'LoadImage', inputs: { image: 'x.png' } },
    });
    // Compile-time check via type annotation; runtime smoke
    expect(result[0]?.role).toMatch(/control|reference|mask|image/);
  });
});
