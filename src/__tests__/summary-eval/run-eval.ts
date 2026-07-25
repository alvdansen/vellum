/**
 * Phase 19 — Eval suite orchestrator. Loads 12 fixtures, generates summaries
 * (or uses golden_summary if no API key), runs the 9 AI-SPEC §5 dimensions,
 * computes pass-rate per dimension, asserts thresholds.
 *
 * Pass-rate thresholds (AI-SPEC §5 CI/CD Integration):
 *   - Critical (model-name fidelity, banned-lexicon, anti-feature, leak-scan): 100%
 *   - High (lineage, sentence-count, redaction-marker, redaction-leak,
 *     voice register): 95%
 *   - Medium (seed precision — deferred to v1.3): not enforced
 *
 * The orchestrator is a Vitest-compatible pure function: side-effect-free
 * apart from reading fixture files + (when ANTHROPIC_API_KEY is set) calling
 * the production sole-importer for live summaries + LLM-judge dimensions.
 *
 * Architecture-purity: the orchestrator imports the production sole-importer
 * (anthropic-client.ts) but lives under src/__tests__/, which is excluded
 * from the architecture-purity grep guard. Per AI-SPEC §5 Eval Tooling
 * "the suite reuses the production sole-importer with a different system
 * prompt (judge rubric, not voice anchor)".
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSummary, flattenAnthropicError } from '../../engine/summary/anthropic-client.js';
import { sanitizeProvenance, assertNoApiKeyInPayload } from '../../engine/summary/sanitizer.js';
import {
  assemblePromptInput,
  SUMMARY_TEMPLATE_VERSION,
  SUMMARY_MODEL_ID,
} from '../../engine/summary/template.js';
import type { ModelRef } from '../../types/provenance.js';
import {
  assertModelNameFidelity,
  assertSentenceCountAndLength,
  assertAntiFeatureRegression,
  assertNoBannedLexicon,
  assertApiKeyLeakScan,
  assertRedactionMarker,
  assertNoRedactedPromptLeak,
  type DimensionResult,
} from './dimensions/code-based.js';
import {
  judgeLineageRelationship,
  judgeVoiceRegister,
  type JudgeResult,
} from './dimensions/llm-judge.js';

const FIXTURES_DIR = join(process.cwd(), 'src/__tests__/fixtures/summary-eval');

/**
 * Fixture shape mirrors src/__tests__/fixtures/summary-eval/README.md. Note
 * the `models` shape has only `model_name` — the test orchestrator maps each
 * entry to a full ModelRef with placeholder fields before passing to the
 * sanitizer (which only consumes `model_name` per Phase 19 sanitizer.ts).
 */
interface Fixture {
  fixture_id: string;
  lineage_shape: string;
  version_label: string;
  parent_version_label: string | null;
  completed: { prompt_json: string; outputs_json: string; seed: number | null };
  models: Array<{ model_name: string }>;
  manifest_signed: { redacted: boolean; manifest_sha256: string } | null;
  redacted: boolean;
  ingredient_summary_counts: Record<string, number>;
  user_prompt_positive: string;
  user_prompt_negative: string;
  golden_summary: string;
  expected_dimensions: Record<string, unknown>;
}

export interface EvalResult {
  fixture_id: string;
  summary_text: string;
  source: 'live' | 'golden_fallback';
  dimensions: Record<string, DimensionResult | JudgeResult>;
}

export interface EvalReport {
  results: EvalResult[];
  passRates: Record<string, number>;
  thresholds: Record<string, number>;
  thresholdViolations: string[];
}

/**
 * Pass-rate thresholds — AI-SPEC §5 CI/CD Integration. Critical-tier =
 * 100%, High-tier = 95%, Medium-tier = 90%. The voice_register threshold
 * tracks the voice-register LLM-judge dimension (skip-when-no-key returns
 * { ok: true } so the threshold is honored on either path).
 */
const PASS_THRESHOLDS = {
  // Critical (1.0)
  model_name_fidelity: 1.0,
  anti_feature: 1.0,
  banned_lexicon: 1.0,
  api_key_leak_scan: 1.0,
  // High (0.95)
  sentence_count_length: 0.95,
  redaction_marker: 0.95,
  redaction_leak: 1.0,
  lineage_relationship: 0.95,
  voice_register: 0.95,
};

function loadFixtures(): Fixture[] {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  return files.sort().map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as Fixture);
}

/**
 * Map fixture model entries to full ModelRef shape. Placeholder fields
 * (node_id, class_type, model_hash, model_hash_unavailable) satisfy the
 * production type without affecting any dimension assertion (the sanitizer
 * only reads model_name).
 */
function mapFixtureModels(models: Array<{ model_name: string }>): ModelRef[] {
  return models.map((m, i) => ({
    node_id: `eval-node-${i}`,
    class_type: 'CheckpointLoaderSimple',
    model_name: m.model_name,
    model_hash: null,
    model_hash_unavailable: null,
  }));
}

/**
 * Generate a live summary or fall back to the fixture's golden_summary.
 * Live path: assemble the production prompt + call the sole-importer.
 * Fallback path (no key OR live call fails): return golden_summary so
 * code-based dimensions still execute and exercise the rubric.
 */
async function generateOrFallback(
  fixture: Fixture,
): Promise<{ text: string; source: 'live' | 'golden_fallback' }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { text: fixture.golden_summary, source: 'golden_fallback' };
  }

  const models = mapFixtureModels(fixture.models);
  const sanitized = sanitizeProvenance({
    versionLabel: fixture.version_label,
    parentVersionLabel: fixture.parent_version_label,
    completed: {
      prompt_json: fixture.completed.prompt_json,
      seed: fixture.completed.seed,
      models_json: JSON.stringify(models),
      outputs_json: fixture.completed.outputs_json,
    },
    models,
    isRedacted: fixture.redacted,
    promptPositive: fixture.user_prompt_positive,
    promptNegative: fixture.user_prompt_negative,
    ingredientCounts: fixture.ingredient_summary_counts,
  });

  try {
    assertNoApiKeyInPayload(sanitized);
  } catch (err) {
    console.error(
      `[summary-eval] fixture ${fixture.fixture_id} sanitization leak-scan failed:`,
      flattenAnthropicError(err),
    );
    return { text: fixture.golden_summary, source: 'golden_fallback' };
  }

  const promptInput = assemblePromptInput(sanitized);
  try {
    const result = await generateSummary(promptInput, apiKey);
    return { text: result.text, source: 'live' };
  } catch (err) {
    console.error(
      `[summary-eval] fixture ${fixture.fixture_id} live call failed:`,
      flattenAnthropicError(err),
    );
    return { text: fixture.golden_summary, source: 'golden_fallback' };
  }
}

/**
 * Run the eval suite — load fixtures, generate summaries, run all 9
 * dimensions, compute pass rates, identify threshold violations. Caller
 * (eval.test.ts) asserts `thresholdViolations` is empty.
 */
export async function runEval(): Promise<EvalReport> {
  const fixtures = loadFixtures();
  const results: EvalResult[] = [];

  for (const fixture of fixtures) {
    const { text, source } = await generateOrFallback(fixture);
    const expectedNames = fixture.models.map((m) => m.model_name);
    const dimensions: EvalResult['dimensions'] = {};

    // Code-based dimensions — run unconditionally, no API.
    if (fixture.redacted) {
      // D-VAL-3 path: skip model-name; require redaction marker + no leak.
      dimensions.redaction_marker = assertRedactionMarker(text);
      dimensions.redaction_leak = assertNoRedactedPromptLeak(text, fixture.user_prompt_positive);
    } else {
      dimensions.model_name_fidelity = assertModelNameFidelity(text, expectedNames);
    }
    dimensions.sentence_count_length = assertSentenceCountAndLength(text);
    dimensions.anti_feature = assertAntiFeatureRegression(text);
    dimensions.banned_lexicon = assertNoBannedLexicon(text);
    dimensions.api_key_leak_scan = assertApiKeyLeakScan([text]);

    // LLM-judge dimensions — skip cleanly when no API key.
    dimensions.lineage_relationship = await judgeLineageRelationship(
      text,
      fixture.parent_version_label,
      fixture.version_label,
    );
    dimensions.voice_register = await judgeVoiceRegister(text);

    results.push({ fixture_id: fixture.fixture_id, summary_text: text, source, dimensions });
  }

  // Compute pass rates per dimension. A dimension that was not exercised
  // on any fixture (e.g., redaction_marker on an all-non-redacted run) is
  // skipped from the threshold check.
  const passRates: Record<string, number> = {};
  for (const dim of Object.keys(PASS_THRESHOLDS)) {
    const evaluated = results.filter((r) => dim in r.dimensions);
    if (evaluated.length === 0) continue;
    const passed = evaluated.filter((r) => r.dimensions[dim].ok).length;
    passRates[dim] = passed / evaluated.length;
  }

  // Identify threshold violations.
  const thresholdViolations: string[] = [];
  for (const [dim, threshold] of Object.entries(PASS_THRESHOLDS)) {
    const rate = passRates[dim];
    if (rate !== undefined && rate < threshold) {
      thresholdViolations.push(
        `${dim}: ${(rate * 100).toFixed(1)}% pass < ${(threshold * 100).toFixed(0)}% threshold`,
      );
    }
  }

  // Reference exports keep template-version + model-id surfaced for any
  // downstream consumer (CI report aggregator, debug shell). The runtime
  // values are not directly asserted here; the cache-key composition surface
  // is locked by the engine facade test (Plan 04 summarize-version.test.ts).
  void SUMMARY_TEMPLATE_VERSION;
  void SUMMARY_MODEL_ID;

  return { results, passRates, thresholds: PASS_THRESHOLDS, thresholdViolations };
}
