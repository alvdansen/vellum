import { describe, expect, test } from 'vitest';
import { applyOverrides, applySeedShortcut, findKSamplerNodes } from '../iterate-merge.js';
import '../../test-utils/matchers.js';

const SOURCE = {
  '3': { class_type: 'KSampler', inputs: { seed: 42, cfg: 7, model: ['4', 0] } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'A.safetensors' } },
};

describe('applyOverrides (D-PROV-21, D-PROV-23)', () => {
  test('shallow-merges inputs + leaves other nodes untouched', () => {
    const merged = applyOverrides(SOURCE, { '3': { inputs: { seed: 999 } } });
    expect((merged['3'] as any).inputs.seed).toBe(999);
    expect((merged['3'] as any).inputs.cfg).toBe(7);
    expect((merged['4'] as any).inputs.ckpt_name).toBe('A.safetensors');
  });

  test('deep-clone — source blob is not mutated', () => {
    const before = JSON.stringify(SOURCE);
    applyOverrides(SOURCE, { '3': { inputs: { seed: 999 } } });
    expect(JSON.stringify(SOURCE)).toBe(before);
  });

  test('class_type override applied', () => {
    const merged = applyOverrides(SOURCE, { '3': { class_type: 'KSamplerAdvanced' } });
    expect((merged['3'] as any).class_type).toBe('KSamplerAdvanced');
  });

  test('unknown node id → ITERATE_INVALID_PATCH with valid ids listed', () => {
    expect(() =>
      applyOverrides(SOURCE, { '99': { inputs: { seed: 1 } } }),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('unknown node id hint includes valid source ids', () => {
    try {
      applyOverrides(SOURCE, { '99': { inputs: { seed: 1 } } });
    } catch (err) {
      const e = err as { hint?: string };
      expect(e.hint).toContain('3');
      expect(e.hint).toContain('4');
      return;
    }
    throw new Error('expected throw');
  });

  test('__proto__ in override key rejected (via JSON.parse which creates own-property)', () => {
    const malicious = JSON.parse('{"__proto__": {"inputs": {}}}');
    expect(() => applyOverrides(SOURCE, malicious)).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('__proto__ in inputs field rejected (via JSON.parse which creates own-property)', () => {
    const malicious = JSON.parse('{"3": {"inputs": {"__proto__": "x"}}}');
    expect(() => applyOverrides(SOURCE, malicious)).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('constructor in override key rejected', () => {
    expect(() =>
      applyOverrides(SOURCE, { constructor: { inputs: {} } } as any),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('function value rejected', () => {
    expect(() =>
      applyOverrides(SOURCE, { '3': { inputs: { cb: (() => {}) as any } } }),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('undefined value rejected', () => {
    expect(() =>
      applyOverrides(SOURCE, { '3': { inputs: { cfg: undefined } } } as any),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('non-object override value rejected', () => {
    expect(() =>
      applyOverrides(SOURCE, { '3': 'not-object' as any }),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('non-plain inputs rejected', () => {
    expect(() =>
      applyOverrides(SOURCE, { '3': { inputs: 'not-object' as any } }),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('non-string class_type rejected', () => {
    expect(() =>
      applyOverrides(SOURCE, { '3': { class_type: 123 as any } }),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });
});

describe('applySeedShortcut (D-PROV-22)', () => {
  test('single KSampler: seed updated', () => {
    const merged = applySeedShortcut(SOURCE, 999);
    expect((merged['3'] as any).inputs.seed).toBe(999);
  });

  test('single KSampler: source blob not mutated', () => {
    const before = JSON.stringify(SOURCE);
    applySeedShortcut(SOURCE, 999);
    expect(JSON.stringify(SOURCE)).toBe(before);
  });

  test('zero KSamplers → ITERATE_INVALID_PATCH', () => {
    expect(() =>
      applySeedShortcut({ '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } }, 1),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('multiple KSamplers → ITERATE_INVALID_PATCH with explicit hint', () => {
    expect(() =>
      applySeedShortcut(
        {
          '3': { class_type: 'KSampler', inputs: {} },
          '7': { class_type: 'KSamplerAdvanced', inputs: {} },
        },
        1,
      ),
    ).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('multiple KSamplers hint lists node ids', () => {
    try {
      applySeedShortcut(
        {
          '3': { class_type: 'KSampler', inputs: {} },
          '7': { class_type: 'KSamplerAdvanced', inputs: {} },
        },
        1,
      );
    } catch (err) {
      const e = err as { message: string };
      expect(e.message).toContain('3');
      expect(e.message).toContain('7');
      return;
    }
    throw new Error('expected throw');
  });

  test('negative seed rejected', () => {
    expect(() => applySeedShortcut(SOURCE, -1)).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('non-integer seed rejected', () => {
    expect(() => applySeedShortcut(SOURCE, 1.5)).toThrowTypedError('ITERATE_INVALID_PATCH');
  });

  test('node with missing inputs still gets inputs.seed set', () => {
    const blob = { '3': { class_type: 'KSampler' } };
    const merged = applySeedShortcut(blob, 42);
    expect((merged['3'] as any).inputs.seed).toBe(42);
  });
});

describe('findKSamplerNodes', () => {
  test('returns ids sorted numerically', () => {
    expect(
      findKSamplerNodes({
        '10': { class_type: 'KSampler', inputs: {} },
        '2': { class_type: 'KSamplerAdvanced', inputs: {} },
      }),
    ).toEqual(['2', '10']);
  });

  test('returns empty array when no KSamplers present', () => {
    expect(
      findKSamplerNodes({ '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } }),
    ).toEqual([]);
  });

  test('recognises all 4 sampler class_types', () => {
    const ids = findKSamplerNodes({
      '1': { class_type: 'KSampler', inputs: {} },
      '2': { class_type: 'KSamplerAdvanced', inputs: {} },
      '3': { class_type: 'SamplerCustom', inputs: {} },
      '4': { class_type: 'SamplerCustomAdvanced', inputs: {} },
    });
    expect(ids).toEqual(['1', '2', '3', '4']);
  });
});
