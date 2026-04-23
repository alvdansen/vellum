import { describe, expect, test } from 'vitest';
import { extractSeed } from '../provenance.js';

describe('extractSeed (D-PROV-06, D-PROV-22 seed discovery)', () => {
  test('no KSampler returns null', () => {
    expect(
      extractSeed({ '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x' } } }),
    ).toBeNull();
  });

  test('single KSampler returns its integer seed', () => {
    expect(extractSeed({ '3': { class_type: 'KSampler', inputs: { seed: 42 } } })).toBe(42);
  });

  test('multiple KSamplers return null (engine layer surfaces ambiguity)', () => {
    expect(
      extractSeed({
        '3': { class_type: 'KSampler', inputs: { seed: 1 } },
        '7': { class_type: 'KSamplerAdvanced', inputs: { seed: 2 } },
      }),
    ).toBeNull();
  });

  test('KSampler with non-integer seed returns null', () => {
    expect(
      extractSeed({ '3': { class_type: 'KSampler', inputs: { seed: 'abc' } } }),
    ).toBeNull();
  });

  test('KSampler with missing seed returns null', () => {
    expect(extractSeed({ '3': { class_type: 'KSampler', inputs: {} } })).toBeNull();
  });

  test('KSampler with negative seed returns null (ComfyUI uses >=0 convention)', () => {
    expect(
      extractSeed({ '3': { class_type: 'KSampler', inputs: { seed: -1 } } }),
    ).toBeNull();
  });

  test('SamplerCustom recognised', () => {
    expect(extractSeed({ '3': { class_type: 'SamplerCustom', inputs: { seed: 123 } } })).toBe(123);
  });

  test('KSamplerAdvanced recognised', () => {
    expect(
      extractSeed({ '3': { class_type: 'KSamplerAdvanced', inputs: { seed: 7 } } }),
    ).toBe(7);
  });

  test('SamplerCustomAdvanced recognised', () => {
    expect(
      extractSeed({ '3': { class_type: 'SamplerCustomAdvanced', inputs: { seed: 0 } } }),
    ).toBe(0);
  });

  test('KSampler with non-plain inputs returns null', () => {
    expect(extractSeed({ '3': { class_type: 'KSampler' } })).toBeNull();
  });
});
