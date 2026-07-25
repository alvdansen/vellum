import { describe, it, expect } from 'vitest';
import { loadAnthropicConfigFromEnv } from '../utils/anthropic-config.js';
import { TypedError } from '../engine/errors.js';

/**
 * Phase 19 — SUM-06 (D-PRIV-4). Plan 19-01 Task 1.
 *
 * Boot-time validation tests for the ANTHROPIC_API_KEY env var. Mirrors the
 * 6-test shape of src/__tests__/c2pa-config.test.ts (Phase 14 blueprint).
 *
 * Covers:
 *  1. Unset env → null (feature disabled, graceful per D-FB-2).
 *  2. Empty string → null (treated as unset).
 *  3. Whitespace-only → null (treated as unset).
 *  4. Wrong prefix → throw ANTHROPIC_CONFIG_INVALID with last-4 hygiene.
 *  5. Too-short key → throw ANTHROPIC_CONFIG_INVALID with last-4 hygiene.
 *  6. Valid key → return { apiKey }.
 *
 * D-PRIV-4 last-4 hygiene: error messages emit ONLY ****<last-4>, never
 * the full key. Mirrors c2pa-config.ts basename-only path discipline.
 */

describe('loadAnthropicConfigFromEnv', () => {
  it('returns null when ANTHROPIC_API_KEY is unset (graceful disable)', () => {
    expect(loadAnthropicConfigFromEnv({})).toBeNull();
  });

  it('returns null when ANTHROPIC_API_KEY is empty string', () => {
    expect(loadAnthropicConfigFromEnv({ ANTHROPIC_API_KEY: '' })).toBeNull();
  });

  it('returns null when ANTHROPIC_API_KEY is whitespace-only', () => {
    expect(loadAnthropicConfigFromEnv({ ANTHROPIC_API_KEY: '   ' })).toBeNull();
  });

  it('throws ANTHROPIC_CONFIG_INVALID with last-4 hygiene when prefix is wrong', () => {
    const badKey = 'wrong-prefix-12345abcd';
    expect(() => loadAnthropicConfigFromEnv({ ANTHROPIC_API_KEY: badKey }))
      .toThrowError(TypedError);

    let thrown: TypedError | undefined;
    try {
      loadAnthropicConfigFromEnv({ ANTHROPIC_API_KEY: badKey });
    } catch (err) {
      thrown = err as TypedError;
    }
    expect(thrown).toBeInstanceOf(TypedError);
    expect(thrown!.code).toBe('ANTHROPIC_CONFIG_INVALID');
    // Last-4 only in error message — never the full key (D-PRIV-4).
    expect(thrown!.message).toContain('****abcd');
    expect(thrown!.message).not.toContain('wrong-prefix-12345');
  });

  it('throws ANTHROPIC_CONFIG_INVALID with last-4 hygiene when key is too short', () => {
    const shortKey = 'sk-ant-short';
    let thrown: TypedError | undefined;
    try {
      loadAnthropicConfigFromEnv({ ANTHROPIC_API_KEY: shortKey });
    } catch (err) {
      thrown = err as TypedError;
    }
    expect(thrown).toBeInstanceOf(TypedError);
    expect(thrown!.code).toBe('ANTHROPIC_CONFIG_INVALID');
    expect(thrown!.message).toContain('****hort');
    // Full key must NOT appear in message — only the last 4 chars (D-PRIV-4).
    expect(thrown!.message).not.toContain('sk-ant-short');
  });

  it('returns valid config when key is well-formed (sk-ant- prefix + length>=30)', () => {
    const fakeKey = 'sk-ant-' + 'A'.repeat(40); // 47 chars total
    const result = loadAnthropicConfigFromEnv({ ANTHROPIC_API_KEY: fakeKey });
    expect(result).toEqual({ apiKey: fakeKey });
  });
});
