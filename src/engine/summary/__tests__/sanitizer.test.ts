/**
 * Phase 19 — sanitizer.ts adversarial-review-class unit tests.
 *
 * Coverage:
 * 1. Iteration over ALLOW_LIST emits only whitelisted fields (proto pollution defence)
 * 2. Empty models input → 'unknown_model' fallback
 * 3. Single-model input → primary model_name set, additional_models empty
 * 4. Multi-model input → primary + additional_models populated in order
 * 5. Redacted=true preserved in output
 * 6. promptPositive provided → output.prompt_positive matches verbatim (BLOCKER #1)
 * 7. promptNegative provided → output.prompt_negative matches verbatim (BLOCKER #1)
 * 8. promptPositive=null + promptNegative=null → output fields null (BLOCKER #1)
 * 9. promptPositive contains non-ASCII unicode → preserved verbatim (BLOCKER #1)
 * 10. assertNoApiKeyInPayload no-op when env unset
 * 11. assertNoApiKeyInPayload no-op when key not in payload
 * 12. assertNoApiKeyInPayload throws when raw key in summary-text-style field
 * 13. assertNoApiKeyInPayload throws for UTF-16LE fragment
 * 14. assertNoApiKeyInPayload throws for base64 fragment
 * 15. assertNoApiKeyInPayload throws when API key smuggled into promptPositive (BLOCKER #1 / T-19-13b)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOW_LIST,
  SanitizedProvenance,
  SanitizeProvenanceInput,
  assertNoApiKeyInPayload,
  sanitizeProvenance,
} from '../sanitizer.js';
import type { ModelRef } from '../../../types/provenance.js';
import type { ProvenanceCompletedPayload } from '../../../store/provenance-repo.js';

const baseInput: SanitizeProvenanceInput = {
  versionLabel: 'v003',
  parentVersionLabel: null,
  completed: null,
  models: null,
  isRedacted: false,
  promptPositive: null,
  promptNegative: null,
};

function makeCompleted(seed: number | null): ProvenanceCompletedPayload {
  return {
    prompt_json: '{}',
    seed,
    models_json: '[]',
    outputs_json: '[]',
  };
}

function makeModel(name: string, node_id = '4'): ModelRef {
  return {
    node_id,
    class_type: 'CheckpointLoaderSimple',
    model_name: name,
    model_hash: null,
    model_hash_unavailable: null,
  };
}

describe('sanitizeProvenance — allow-list iteration + prototype-pollution defence', () => {
  it('emits only whitelisted fields; rejects __proto__ / constructor pollution attempts', () => {
    // The TS interface SanitizeProvenanceInput already restricts what callers
    // can pass; this test simulates the surface via cast + mutation to assert
    // that the OUTPUT shape contains zero attacker-controlled keys.
    const malicious = {
      ...baseInput,
      // Attempt prototype pollution: surface attacker-controlled keys via
      // proto access. The sanitizer iterates ALLOW_LIST literals so these
      // never reach the output.
      __proto__: { malicious_field: 'leak' },
    } as unknown as SanitizeProvenanceInput;
    const out = sanitizeProvenance(malicious);
    const json = JSON.stringify(out);
    expect(json.includes('malicious_field')).toBe(false);
    expect(json.includes('leak')).toBe(false);
    // Sanity: the output keys are exactly the SanitizedProvenance shape.
    const keys = Object.keys(out).sort();
    expect(keys).toEqual([
      'additional_models',
      'ingredient_summary_counts',
      'model_name',
      'parent_version_label',
      'prompt_negative',
      'prompt_positive',
      'redacted',
      'seed',
      'version_label',
    ]);
  });

  it('Test 2: empty models input → model_name = "unknown_model"', () => {
    const out = sanitizeProvenance({ ...baseInput, models: [] });
    expect(out.model_name).toBe('unknown_model');
    expect(out.additional_models).toEqual([]);
  });

  it('Test 3: single-model input → primary model_name set, additional_models empty', () => {
    const out = sanitizeProvenance({
      ...baseInput,
      models: [makeModel('flux1-dev.safetensors')],
    });
    expect(out.model_name).toBe('flux1-dev.safetensors');
    expect(out.additional_models).toEqual([]);
  });

  it('Test 4: multi-model input → primary + additional_models populated in order', () => {
    const out = sanitizeProvenance({
      ...baseInput,
      models: [
        makeModel('flux1-dev.safetensors', '4'),
        makeModel('cinematic_fantasy.safetensors', '10'),
        makeModel('detail_boost.safetensors', '11'),
      ],
    });
    expect(out.model_name).toBe('flux1-dev.safetensors');
    expect(out.additional_models).toEqual([
      'cinematic_fantasy.safetensors',
      'detail_boost.safetensors',
    ]);
  });

  it('Test 5: redacted=true is preserved in output', () => {
    const out = sanitizeProvenance({ ...baseInput, isRedacted: true });
    expect(out.redacted).toBe(true);
  });
});

describe('sanitizeProvenance — D-PRIV-2 prompt content passthrough (BLOCKER #1)', () => {
  it('Test 6: promptPositive provided → output.prompt_positive matches verbatim', () => {
    const promptPositive = 'a tighter close-up of the dragon\'s eye';
    const out = sanitizeProvenance({ ...baseInput, promptPositive });
    expect(out.prompt_positive).toBe(promptPositive);
  });

  it('Test 7: promptNegative provided → output.prompt_negative matches verbatim', () => {
    const promptNegative = 'blurry, low quality, watermark, text';
    const out = sanitizeProvenance({ ...baseInput, promptNegative });
    expect(out.prompt_negative).toBe(promptNegative);
  });

  it('Test 8: promptPositive=null + promptNegative=null → output fields are null (no-edge-walk-resolution)', () => {
    const out = sanitizeProvenance({
      ...baseInput,
      promptPositive: null,
      promptNegative: null,
    });
    expect(out.prompt_positive).toBeNull();
    expect(out.prompt_negative).toBeNull();
  });

  it('Test 9: promptPositive non-ASCII unicode (e.g., café 🐉) → preserved verbatim', () => {
    const promptPositive = 'a café in Tokyo with a 🐉 dragon, cinematic 75mm';
    const out = sanitizeProvenance({ ...baseInput, promptPositive });
    expect(out.prompt_positive).toBe(promptPositive);
    // Verify byte-identical roundtrip.
    expect(out.prompt_positive?.length).toBe(promptPositive.length);
  });
});

describe('sanitizeProvenance — seed + lineage + ingredient counts wiring', () => {
  it('seed flows through from completed payload', () => {
    const out = sanitizeProvenance({
      ...baseInput,
      completed: makeCompleted(42),
    });
    expect(out.seed).toBe(42);
  });

  it('seed=null when completed is null', () => {
    const out = sanitizeProvenance({ ...baseInput, completed: null });
    expect(out.seed).toBeNull();
  });

  it('parent_version_label flows through verbatim', () => {
    const out = sanitizeProvenance({
      ...baseInput,
      parentVersionLabel: 'v002',
    });
    expect(out.parent_version_label).toBe('v002');
  });

  it('ingredient_summary_counts default to empty object', () => {
    const out = sanitizeProvenance(baseInput);
    expect(out.ingredient_summary_counts).toEqual({});
  });

  it('ingredient_summary_counts flow through when provided', () => {
    const out = sanitizeProvenance({
      ...baseInput,
      ingredientCounts: { lora: 2, controlnet: 1 },
    });
    expect(out.ingredient_summary_counts).toEqual({ lora: 2, controlnet: 1 });
  });
});

describe('ALLOW_LIST contents (D-PRIV-1 + D-VAL-3 cross-authorization)', () => {
  it('contains the 7 enumerated fields per D-PRIV-1 + D-VAL-3', () => {
    expect(ALLOW_LIST).toEqual([
      'model_name',
      'prompt_positive',
      'prompt_negative',
      'seed',
      'parent_version_id',
      'ingredient_summary_counts',
      'redacted',
    ]);
  });
});

describe('assertNoApiKeyInPayload — multi-encoding leak scan (D-PRIV-3 + T-19-13b)', () => {
  let prevKey: string | undefined;

  beforeEach(() => {
    prevKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  });

  function makePayload(overrides: Partial<SanitizedProvenance> = {}): SanitizedProvenance {
    return {
      model_name: 'flux1-dev',
      additional_models: [],
      prompt_positive: 'a dragon',
      prompt_negative: '',
      seed: 42,
      parent_version_label: null,
      ingredient_summary_counts: {},
      redacted: false,
      version_label: 'v001',
      ...overrides,
    };
  }

  it('Test 10: passes (no-op) when env unset', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => assertNoApiKeyInPayload(makePayload())).not.toThrow();
  });

  it('Test 11: passes when key not in payload', () => {
    process.env.ANTHROPIC_API_KEY =
      'sk-ant-test-key-1234567890abcdefghijklmnopqrstuv';
    expect(() => assertNoApiKeyInPayload(makePayload())).not.toThrow();
  });

  it('Test 12: throws when raw key appears in a summary-text-style field (manual injection)', () => {
    const apiKey =
      'sk-ant-test-key-1234567890abcdefghijklmnopqrstuv';
    process.env.ANTHROPIC_API_KEY = apiKey;
    const payload = makePayload({
      // Smuggled into model_name (simulating a malicious LLM response).
      model_name: `flux1-dev ${apiKey}`,
    });
    expect(() => assertNoApiKeyInPayload(payload)).toThrow(
      /API key fragment leaked/,
    );
  });

  it('Test 13: throws for UTF-16LE-encoded key fragment', () => {
    const apiKey =
      'sk-ant-test-key-1234567890abcdefghijklmnopqrstuv';
    process.env.ANTHROPIC_API_KEY = apiKey;
    const utf16le = Buffer.from(apiKey, 'utf16le').toString('binary');
    const payload = makePayload({
      additional_models: [utf16le],  // smuggled in as binary string
    });
    expect(() => assertNoApiKeyInPayload(payload)).toThrow(
      /API key fragment leaked/,
    );
  });

  it('Test 14: throws for base64-encoded key fragment', () => {
    const apiKey =
      'sk-ant-test-key-1234567890abcdefghijklmnopqrstuv';
    process.env.ANTHROPIC_API_KEY = apiKey;
    const b64 = Buffer.from(apiKey).toString('base64');
    const payload = makePayload({
      version_label: `v001 ${b64}`,
    });
    expect(() => assertNoApiKeyInPayload(payload)).toThrow(
      /API key fragment leaked/,
    );
  });

  it('Test 15 (BLOCKER #1 / T-19-13b): throws when API key smuggled into promptPositive', () => {
    // T-19-13b: D-PRIV-2 verbatim passthrough does NOT bypass D-PRIV-3
    // defence-in-depth. The leak scan covers prompt content as well.
    const apiKey =
      'sk-ant-test-key-1234567890abcdefghijklmnopqrstuv';
    process.env.ANTHROPIC_API_KEY = apiKey;
    const payload = makePayload({
      prompt_positive: `a dragon and the secret is ${apiKey}`,
    });
    expect(() => assertNoApiKeyInPayload(payload)).toThrow(
      /API key fragment leaked/,
    );
  });
});
