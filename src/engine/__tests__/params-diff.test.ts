import { describe, test, expect } from 'vitest';
import { diffParams, summarizeParamsDiff } from '../params-diff.js';

describe('diffParams', () => {
  test('identical bags produce no changes', () => {
    const r = diffParams({ prompt: 'a', seed: 1 }, { prompt: 'a', seed: 1 });
    expect(r.identical).toBe(true);
    expect(r.changes).toHaveLength(0);
  });

  test('key ordering does not matter', () => {
    const r = diffParams({ a: 1, b: 2 }, { b: 2, a: 1 });
    expect(r.identical).toBe(true);
  });

  test('detects added / removed / changed leaves', () => {
    const r = diffParams({ seed: 42, steps: 20 }, { seed: 99, guidance: 7 });
    const byPath = Object.fromEntries(r.changes.map((c) => [c.path, c]));
    expect(byPath.seed).toMatchObject({ kind: 'changed', before: 42, after: 99 });
    expect(byPath.steps).toMatchObject({ kind: 'removed', before: 20 });
    expect(byPath.guidance).toMatchObject({ kind: 'added', after: 7 });
    expect(r.identical).toBe(false);
  });

  test('recurses into nested objects by dot-path', () => {
    const r = diffParams(
      { controlnet: { scale: 0.5, model: 'canny' } },
      { controlnet: { scale: 0.8, model: 'canny' } },
    );
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ path: 'controlnet.scale', kind: 'changed', before: 0.5, after: 0.8 });
  });

  test('arrays are compared as leaves (order-sensitive)', () => {
    expect(diffParams({ loras: ['a', 'b'] }, { loras: ['a', 'b'] }).identical).toBe(true);
    const r = diffParams({ loras: ['a', 'b'] }, { loras: ['b', 'a'] });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].path).toBe('loras');
  });

  test('deterministic ordering of changes (sorted by path)', () => {
    const r = diffParams({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(r.changes.map((c) => c.path)).toEqual(['a', 'z']);
  });

  test('tolerates empty / nullish bags', () => {
    expect(diffParams({}, {}).identical).toBe(true);
    // @ts-expect-error — defensive: null coerces to {}
    expect(diffParams(null, { a: 1 }).changes[0]).toMatchObject({ path: 'a', kind: 'added' });
  });
});

describe('summarizeParamsDiff', () => {
  test('summarizes an empty diff', () => {
    expect(summarizeParamsDiff(diffParams({ a: 1 }, { a: 1 }))).toBe('No parameter changes.');
  });

  test('summarizes changed/added/removed with counts', () => {
    const s = summarizeParamsDiff(diffParams({ seed: 42, drop: 1 }, { seed: 99, add: 2 }));
    expect(s).toMatch(/3 parameter changes/);
    expect(s).toContain('seed 42→99');
    expect(s).toContain('+add');
    expect(s).toContain('-drop');
  });

  test('truncates long string leaves', () => {
    const long = 'x'.repeat(50);
    const s = summarizeParamsDiff(diffParams({ p: 'short' }, { p: long }));
    expect(s).toContain('…');
  });
});
