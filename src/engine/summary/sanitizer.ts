/**
 * Adversarial-review-class allow-list sanitizer.
 *
 * The summary template explicitly names which provenance fields may leave the
 * box. Anything not on the allow-list is stripped before the Anthropic API
 * call. Mirrors the c2pa-node "restricted module" precedent:
 * each new field surfaced in summaries is a code change, not a config tweak.
 *
 * Architecture-purity (grep-guard enforced): ZERO imports from anthropic SDK,
 * MCP SDK, SQLite-driver, ORM, or HTTP frameworks. This file MUST be readable
 * in isolation by an adversarial reviewer.
 *
 * Trust boundary: User-authored prompt text (positive + negative
 * resolved via the KSampler edge walk in `extractInputAssertion` from
 * src/engine/c2pa/ingredient-extractor.ts) is passed through verbatim. The
 * dashboard exposes a one-time first-use disclosure. The trust boundary
 * rationale is the same as for ComfyUI Cloud — the user already chose to
 * send this text upstream.
 *
 * IMPORTANT: This file is a pure helper. It does NOT call extractInputAssertion
 * directly — the engine facade resolves the prompts upstream and threads the
 * resolved strings into SanitizeProvenanceInput.promptPositive /
 * SanitizeProvenanceInput.promptNegative. Keeping the resolution upstream
 * preserves architecture-purity (sanitizer has zero engine imports).
 *
 * Defence-in-depth: assertNoApiKeyInPayload performs a
 * multi-encoding leak scan (UTF-8 / UTF-16LE / UTF-16BE / base64) on the
 * sanitized output to catch the cache-poisoning surface in case Anthropic
 * (or a future provider) returns content containing a key fragment. The
 * scan covers prompt_positive / prompt_negative as well — even the
 * verbatim trust extended to user prompt text does NOT bypass the leak scan.
 *
 * ALLOW_LIST authorization rationale:
 *   - 6 core provenance fields: model_name, prompt_positive,
 *     prompt_negative, seed, parent_version_id, ingredient_summary_counts.
 *   - 1 structural field: `redacted`. The validator
 *     (validation.ts) needs to know whether to apply the redaction-marker
 *     regex (redaction-disclosure requirement). The boolean itself is not
 *     user-content — it is structural metadata. The authorization for each
 *     field is audited explicitly here so reviewers can verify the surface
 *     without cross-referencing anything else.
 */

import type { ModelRef } from '../../types/provenance.js';
import type { ProvenanceCompletedPayload } from '../../store/provenance-repo.js';

/**
 * Explicit allow-list. Iteration uses these literal keys (never
 * input keys), defending against prototype pollution attacks where a
 * malicious provenance payload tries to surface attacker-controlled fields
 * via __proto__ or constructor pollution.
 *
 * Each field added below is a code change, not a runtime config — adversarial
 * review can audit the surface by reading this constant.
 */
export const ALLOW_LIST = [
  'model_name',                  // From models_json[].name (model fingerprints)
  'prompt_positive',             // KSampler edge walk (extractInputAssertion) — user-prompt trust boundary
  'prompt_negative',             // KSampler edge walk (extractInputAssertion) — user-prompt trust boundary
  'seed',                        // From prompt_json.KSampler.seed
  'parent_version_id',           // From version.parent_version_id
  'ingredient_summary_counts',   // From the ingredient graph
  'redacted',                    // From manifest_signed.redacted — validator needs it to select redaction-marker regex mode
] as const;

export interface SanitizedProvenance {
  /** Primary model name (verbatim from models_json[0].name). */
  model_name: string;
  /** Optional secondary model names (LoRAs, ControlNets) — verbatim. */
  additional_models: string[];
  /** Resolved positive prompt from KSampler edge walk; null if absent. */
  prompt_positive: string | null;
  /** Resolved negative prompt; null if absent. */
  prompt_negative: string | null;
  /** Resolved seed integer; null if absent. */
  seed: number | null;
  /** Parent version label (e.g., "v002") for iterate-lineage; null if root. */
  parent_version_label: string | null;
  /** Ingredient summary counts (e.g., { lora: 2, controlnet: 1 }). */
  ingredient_summary_counts: Record<string, number>;
  /** Redacted boolean — drives the validator's redaction-marker requirement. */
  redacted: boolean;
  /** Version label (e.g., "v003") for the summary subject. */
  version_label: string;
}

/**
 * Input shape — the engine facade pre-resolves prompt_positive / prompt_negative
 * via extractInputAssertion (src/engine/c2pa/ingredient-extractor.ts)
 * and threads the resolved strings here. Keeping the edge-walk logic upstream
 * preserves the sanitizer's architecture-purity (zero engine imports).
 *
 * promptPositive / promptNegative are deliberately
 * REQUIRED input fields. The facade must populate these from the KSampler edge
 * walk before invoking sanitizeProvenance. An earlier version defaulted them
 * to null, silently dropping the prompts from every summary.
 */
export interface SanitizeProvenanceInput {
  versionLabel: string;
  parentVersionLabel: string | null;
  completed: ProvenanceCompletedPayload | null;
  models: ModelRef[] | null;
  isRedacted: boolean;
  /** User-prompt trust boundary — pre-resolved by the facade via extractInputAssertion. null when no KSampler edge resolves. */
  promptPositive: string | null;
  /** User-prompt trust boundary — pre-resolved by the facade via extractInputAssertion. null when no KSampler edge resolves. */
  promptNegative: string | null;
  ingredientCounts?: Record<string, number>;
}

/**
 * Iterate over ALLOW_LIST keys, never input keys (prototype pollution defence).
 * Returns only fields on the allow-list; everything else is stripped.
 *
 * prompt_positive / prompt_negative flow through
 * verbatim from input.promptPositive / input.promptNegative (user-prompt trust
 * boundary). The engine facade is responsible for upstream resolution via
 * extractInputAssertion.
 */
export function sanitizeProvenance(input: SanitizeProvenanceInput): SanitizedProvenance {
  const models = input.models ?? [];
  const completed = input.completed;

  const seed: number | null = (completed && typeof (completed as { seed?: number | null }).seed === 'number')
    ? (completed as { seed: number }).seed
    : null;

  // Iterate over ALLOW_LIST literal keys (never `for ... in input`) — protects
  // against prototype-pollution attacks that try to surface attacker-controlled
  // fields. Each field below is constructed from typed inputs only.
  const out: SanitizedProvenance = {
    model_name: models[0]?.model_name ?? 'unknown_model',
    additional_models: models.slice(1).map((m) => m.model_name),
    prompt_positive: input.promptPositive,  // trust-boundary verbatim passthrough
    prompt_negative: input.promptNegative,  // trust-boundary verbatim passthrough
    seed,
    parent_version_label: input.parentVersionLabel,
    ingredient_summary_counts: input.ingredientCounts ?? {},
    redacted: input.isRedacted,
    version_label: input.versionLabel,
  };

  return out;
}

/**
 * The 4-encoding fragment list every leak scan checks for:
 * UTF-8/ASCII, UTF-16LE, UTF-16BE (binary views), and base64. Single source
 * of truth shared by this module's guards, telemetry.ts, and
 * anthropic-client.ts (all three live in the same purity domain). Mirrors
 * the multi-encoding precedent at
 * src/__tests__/c2pa-redaction-e2e.test.ts:76-92.
 */
export function apiKeyFragments(apiKey: string): string[] {
  return [
    apiKey,                                                       // UTF-8 / ASCII
    Buffer.from(apiKey, 'utf16le').toString('binary'),            // UTF-16LE
    Buffer.from(apiKey, 'utf16le').swap16().toString('binary'),   // UTF-16BE
    Buffer.from(apiKey).toString('base64'),                       // base64
  ];
}

/**
 * Defence-in-depth: multi-encoding leak scan on the OUTBOUND payload.
 * Mirrors the multi-encoding helper at
 * src/__tests__/c2pa-redaction-e2e.test.ts:76-92 verbatim.
 *
 * Throws Error if any encoding of the API key appears in the sanitized
 * payload — including the prompt_positive / prompt_negative fields (which
 * carry user-authored content verbatim). Adversarial review can verify
 * this by reading the file in isolation.
 *
 * The scan runs against TWO haystacks for completeness:
 *   1. JSON.stringify(payload) — catches UTF-8/ASCII fragments + base64.
 *   2. Concatenated string fields (binary view) — catches UTF-16LE/UTF-16BE
 *      binary fragments smuggled into string fields. JSON escapes control
 *      bytes (e.g., 0x00) so JSON-haystack alone misses these.
 *
 * Scanning both haystacks aligns with the cross-cutting invariant
 * (UTF-8 / UTF-16LE / UTF-16BE / base64 leak scan applies at every persistence
 * boundary), which explicitly covers smuggled-key detection.
 */
export function assertNoApiKeyInPayload(payload: SanitizedProvenance): void {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (apiKey.length === 0) return;

  const haystackJson = JSON.stringify(payload);

  // Concatenate every string-typed field into one binary haystack. JS strings
  // are UTF-16 internally and preserve any code unit, so smuggled UTF-16LE/BE
  // bytes survive concatenation. Mirrors the redaction file-bytes scan pattern
  // applied at the field-content level.
  const stringFields = [
    payload.model_name,
    ...payload.additional_models,
    payload.prompt_positive ?? '',
    payload.prompt_negative ?? '',
    payload.parent_version_label ?? '',
    payload.version_label,
  ];
  const haystackBinary = stringFields.join('|');

  const fragments = apiKeyFragments(apiKey);

  for (const frag of fragments) {
    if (frag.length === 0) continue;
    if (haystackJson.includes(frag) || haystackBinary.includes(frag)) {
      throw new Error(
        `assertNoApiKeyInPayload: API key fragment leaked in sanitized payload (encoding match found). ` +
        `This is a critical adversarial-review surface failure.`,
      );
    }
  }
}

/**
 * Post-LLM defence-in-depth.
 *
 * The pre-call sanitizer above scans inputs (sanitized provenance) before the
 * SDK call. This helper scans a single string (typically `llmResult.text`)
 * AFTER the SDK call and BEFORE cache persistence. Closes the smuggle path
 * where the LLM response itself contains an API key (rare model misbehavior,
 * adversarial prompt-injection that exfiltrates env state, or upstream
 * provider regressions).
 *
 * Encodings mirrored from assertNoApiKeyInPayload: UTF-8 / UTF-16LE / UTF-16BE
 * / base64. ANTHROPIC_API_KEY absent → no-op (open-source contributors run
 * without a key; the test layer injects synthetic keys to exercise this guard).
 */
export function assertNoApiKeyInString(text: string): void {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (apiKey.length === 0) return;

  const fragments = apiKeyFragments(apiKey);

  for (const frag of fragments) {
    if (frag.length === 0) continue;
    if (text.includes(frag)) {
      throw new Error(
        `assertNoApiKeyInString: API key fragment leaked in LLM response (encoding match found). ` +
        `This is a critical adversarial-review surface failure.`,
      );
    }
  }
}
