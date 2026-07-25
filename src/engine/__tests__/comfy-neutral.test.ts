import { describe, test, expect } from 'vitest';
import { comfyNeutralProvenance } from '../comfy-neutral.js';

describe('comfyNeutralProvenance', () => {
  const graph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a fox in a field' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, lowres' } },
    '4': {
      class_type: 'KSampler',
      inputs: {
        seed: 42,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        positive: ['2', 0],
        negative: ['3', 0],
      },
    },
  };

  test('reduces a resolved graph to model_id + flat params + models', () => {
    const n = comfyNeutralProvenance(graph, 'comfyui-cloud');
    expect(n).not.toBeNull();
    expect(n!.provider_id).toBe('comfyui-cloud');
    expect(n!.model_id).toBe('sd_xl.safetensors');
    expect(n!.params).toEqual({
      // prompt/seed use URL-provider-aligned names so cross-family diffs match.
      prompt: 'a fox in a field',
      negative_prompt: 'blurry, lowres',
      seed: 42,
      sampler_name: 'euler',
      scheduler: 'normal',
      steps: 20,
      cfg: 7,
      denoise: 1,
    });
    expect(n!.models).toContainEqual({ provider_model_id: 'sd_xl.safetensors', hash: null });
  });

  test('params bag is FLAT (no nested sampler.* paths) so diffParams compares leaves', () => {
    const n = comfyNeutralProvenance(graph, 'comfyui-cloud');
    expect(n!.params).not.toHaveProperty('sampler');
    expect(n!.params).toHaveProperty('sampler_name');
  });

  test('returns null for a graph with nothing comparable (no sampler, no models)', () => {
    expect(comfyNeutralProvenance({}, 'comfyui-cloud')).toBeNull();
    expect(
      comfyNeutralProvenance(
        { '1': { class_type: 'PreviewImage', inputs: { images: ['9', 0] } } },
        'comfyui-cloud',
      ),
    ).toBeNull();
  });

  test('omits absent keys rather than emitting null-valued noise', () => {
    // A KSampler with no resolvable prompt edges → prompt_* keys absent.
    const n = comfyNeutralProvenance(
      { '4': { class_type: 'KSampler', inputs: { seed: 7, steps: 10 } } },
      'comfyui-cloud',
    );
    expect(n!.params).toEqual({ seed: 7, steps: 10 });
    expect(n!.params).not.toHaveProperty('prompt');
    expect(n!.model_id).toBeUndefined();
  });

  test('model_id is a primary checkpoint/UNET only — never a LoRA/VAE loader', () => {
    // A graph with only a LoRA loader (no checkpoint) must not label the LoRA
    // as the base model_id.
    const n = comfyNeutralProvenance(
      {
        '1': { class_type: 'LoraLoader', inputs: { lora_name: 'style.safetensors' } },
        '4': { class_type: 'KSampler', inputs: { seed: 1 } },
      },
      'comfyui-cloud',
    );
    expect(n!.model_id).toBeUndefined();
    // …but the LoRA still appears in the models list.
    expect(n!.models).toContainEqual({ provider_model_id: 'style.safetensors', hash: null });
  });
});
