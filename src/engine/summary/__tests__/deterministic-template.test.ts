/**
 * Phase 19 — deterministic-template.ts pure-helper unit tests.
 *
 * Coverage (D-FB-1, D-FB-5):
 * 1. completed=null → "v003 provenance unavailable."
 * 2. Single model, no parent, seed=42 → "v003 generated with flux1-dev at seed 42."
 * 3. Iterate-lineage with parent → contains "Iterate from v002"
 * 4. Multi-model (3 models) → contains "Additional models: cinematic_fantasy, detail_boost"
 * 5. Redacted=true → contains "Some prompt fields were redacted"
 * 6. Redacted=true output passes validateSummary (round-trip — D-VAL-3)
 * 7. Output capped at HARD_CAP (320 chars)
 * 8. seed=null/undefined → "at seed unspecified"
 */

import { describe, expect, it } from 'vitest';
import { buildDeterministicSummary } from '../deterministic-template.js';
import { validateSummary } from '../validation.js';
import type { ModelRef } from '../../../types/provenance.js';
import type { ProvenanceCompletedPayload } from '../../../store/provenance-repo.js';

function model(name: string, node_id = '4'): ModelRef {
  return {
    node_id,
    class_type: 'CheckpointLoaderSimple',
    model_name: name,
    model_hash: null,
    model_hash_unavailable: null,
  };
}

function completed(seed: number | null): ProvenanceCompletedPayload {
  return {
    prompt_json: '{}',
    seed,
    models_json: '[]',
    outputs_json: '[]',
  };
}

describe('buildDeterministicSummary — fallback shapes', () => {
  it('Test 1: completed=null → "v003 provenance unavailable."', () => {
    const out = buildDeterministicSummary({
      completed: null,
      models: null,
      parentVersionLabel: null,
      isRedacted: false,
      versionLabel: 'v003',
    });
    expect(out).toBe('v003 provenance unavailable.');
  });

  it('Test 2: single model, no parent, seed=42 → "v003 generated with flux1-dev at seed 42."', () => {
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: [model('flux1-dev')],
      parentVersionLabel: null,
      isRedacted: false,
      versionLabel: 'v003',
    });
    expect(out).toBe('v003 generated with flux1-dev at seed 42.');
  });

  it('Test 3: iterate-lineage with parent v002 → contains "Iterate from v002"', () => {
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: [model('flux1-dev')],
      parentVersionLabel: 'v002',
      isRedacted: false,
      versionLabel: 'v003',
    });
    expect(out).toContain('Iterate from v002');
    // Also verify no "Additional models" sentence (single model only).
    expect(out).not.toContain('Additional models');
  });

  it('Test 4: multi-model (3 models) → contains "Additional models: cinematic_fantasy, detail_boost"', () => {
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: [
        model('flux1-dev', '4'),
        model('cinematic_fantasy', '10'),
        model('detail_boost', '11'),
      ],
      parentVersionLabel: null,
      isRedacted: false,
      versionLabel: 'v003',
    });
    expect(out).toContain('Additional models: cinematic_fantasy, detail_boost');
  });

  it('Test 5: redacted=true → contains "Some prompt fields were redacted"', () => {
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: [model('flux1-dev')],
      parentVersionLabel: null,
      isRedacted: true,
      versionLabel: 'v005',
    });
    expect(out).toContain('Some prompt fields were redacted');
  });
});

describe('buildDeterministicSummary — round-trip with validator (D-VAL-3)', () => {
  it('Test 6: redacted=true output passes validateSummary in redacted mode', () => {
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: [model('flux1-dev')],
      parentVersionLabel: null,
      isRedacted: true,
      versionLabel: 'v005',
    });
    // The deterministic-template emits 'Some prompt fields were redacted' which
    // contains the substring 'redacted' — validator's REDACTION_MARKERS array
    // matches this case-insensitively. The fallback path ALWAYS satisfies the
    // validator's redaction-marker requirement.
    const result = validateSummary(out, [], true);
    expect(result).toEqual({ ok: true });
  });

  it('Test 6b: non-redacted output containing model name passes validateSummary', () => {
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: [model('flux1-dev')],
      parentVersionLabel: null,
      isRedacted: false,
      versionLabel: 'v003',
    });
    // The deterministic-template includes the model_name verbatim in its
    // first sentence — validator's D-VAL-1 case-sensitive substring matches.
    const result = validateSummary(out, [model('flux1-dev')], false);
    expect(result).toEqual({ ok: true });
  });
});

describe('buildDeterministicSummary — bounds + edge cases', () => {
  it('Test 7: output capped at HARD_CAP (320 chars) on long inputs', () => {
    // Build up many extra models with long names to push past 320 chars.
    const longModelName = 'x'.repeat(80);
    const manyModels: ModelRef[] = Array.from({ length: 8 }, (_, i) =>
      model(`${longModelName}_${i}`, String(i)),
    );
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: manyModels,
      parentVersionLabel: 'v002',
      isRedacted: true,
      versionLabel: 'v003',
    });
    expect(out.length).toBeLessThanOrEqual(320);
    // Ensures it ends with the truncation ellipsis when actually truncated.
    if (out.length === 320) {
      expect(out.endsWith('…')).toBe(true);
    }
  });

  it('Test 8: seed=null → "at seed unspecified"', () => {
    const out = buildDeterministicSummary({
      completed: completed(null),
      models: [model('flux1-dev')],
      parentVersionLabel: null,
      isRedacted: false,
      versionLabel: 'v003',
    });
    expect(out).toContain('at seed unspecified');
  });

  it('models=null → "with an unknown model"', () => {
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: null,
      parentVersionLabel: null,
      isRedacted: false,
      versionLabel: 'v003',
    });
    expect(out).toContain('with an unknown model');
  });

  it('models=[] → "with an unknown model" (empty array same as null for primary)', () => {
    const out = buildDeterministicSummary({
      completed: completed(42),
      models: [],
      parentVersionLabel: null,
      isRedacted: false,
      versionLabel: 'v003',
    });
    expect(out).toContain('with an unknown model');
    expect(out).not.toContain('Additional models');
  });
});
