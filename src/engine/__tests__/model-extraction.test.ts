import { describe, expect, test } from 'vitest';
import { extractModels } from '../provenance.js';

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

  test('all ModelRef entries have model_hash: null (checksums deferred)', () => {
    const refs = extractModels({
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x' } },
    });
    expect(refs[0]!.model_hash).toBeNull();
  });

  test('CLIPLoader falls through to clip_name1 when clip_name missing', () => {
    const refs = extractModels({
      '6': { class_type: 'CLIPLoader', inputs: { clip_name1: 'clip_g.safetensors' } },
    });
    expect(refs).toEqual([
      { node_id: '6', class_type: 'CLIPLoader', model_name: 'clip_g.safetensors', model_hash: null },
    ]);
  });
});
