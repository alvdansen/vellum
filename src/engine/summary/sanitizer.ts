/**
 * Phase 19 — D-PRIV-1 + D-PRIV-3. Adversarial-review-class allow-list sanitizer.
 *
 * The summary template explicitly names which provenance fields may leave the
 * box. Anything not on the allow-list is stripped before the Anthropic API
 * call. Mirrors the Phase 14 c2pa-node "restricted module" precedent:
 * each new field surfaced in summaries is a code change, not a config tweak.
 *
 * Architecture-purity (Plan 01 grep guard): ZERO imports from anthropic SDK,
 * MCP SDK, SQLite-driver, ORM, or HTTP frameworks. This file MUST be readable
 * in isolation by an adversarial reviewer.
 *
 * Trust boundary (D-PRIV-2): User-authored prompt text (positive + negative
 * resolved via Phase 15 KSampler edge walk in `extractInputAssertion` from
 * src/engine/c2pa/ingredient-extractor.ts) is passed through verbatim. The
 * dashboard exposes a one-time first-use disclosure. The trust boundary
 * rationale is the same as for ComfyUI Cloud — the user already chose to
 * send this text upstream.
 *
 * IMPORTANT: This file is a pure helper. It does NOT call extractInputAssertion
 * directly — Plan 04 facade resolves the prompts upstream and threads the
 * resolved strings into SanitizeProvenanceInput.promptPositive /
 * SanitizeProvenanceInput.promptNegative. Keeping the resolution upstream
 * preserves architecture-purity (sanitizer has zero engine imports).
 *
 * Defence-in-depth (D-PRIV-3): assertNoApiKeyInPayload performs a
 * multi-encoding leak scan (UTF-8 / UTF-16LE / UTF-16BE / base64) on the
 * sanitized output to catch the cache-poisoning surface in case Anthropic
 * (or a future provider) returns content containing a key fragment. The
 * scan covers prompt_positive / prompt_negative as well — even D-PRIV-2
 * verbatim trust does NOT bypass D-PRIV-3 defence-in-depth (T-19-13b).
 *
 * ALLOW_LIST authorization rationale (revised per checker WARNING #9):
 *   - 6 fields enumerated by D-PRIV-1: model_name, prompt_positive,
 *     prompt_negative, seed, parent_version_id, ingredient_summary_counts.
 *   - 1 field added cross-authorized by D-VAL-3: `redacted`. The validator
 *     (validation.ts) needs to know whether to apply the redaction-marker
 *     regex (D-VAL-3 disclosure requirement). The boolean itself is not
 *     user-content — it is structural metadata. Adversarial review surface
 *     audited explicitly here so reviewers do not need to cross-reference
 *     CONTEXT.md to verify provenance.
 */

import type { ModelRef } from '../../types/provenance.js';
import type { ProvenanceCompletedPayload } from '../../store/provenance-repo.js';

/**
 * D-PRIV-1: explicit allow-list. Iteration uses these literal keys (never
 * input keys), defending against prototype pollution attacks where a
 * malicious provenance payload tries to surface attacker-controlled fields
 * via __proto__ or constructor pollution.
 *
 * Each field added below is a code change, not a runtime config — adversarial
 * review can audit the surface by reading this constant.
 */
export const ALLOW_LIST = [
  'model_name',                  // From models_json[].name (Phase 13 fingerprints) — D-PRIV-1
  'prompt_positive',             // KSampler edge walk (Phase 15 extractInputAssertion) — D-PRIV-1 + D-PRIV-2 trust boundary
  'prompt_negative',             // KSampler edge walk (Phase 15 extractInputAssertion) — D-PRIV-1 + D-PRIV-2 trust boundary
  'seed',                        // From prompt_json.KSampler.seed (Phase 3) — D-PRIV-1
  'parent_version_id',           // From version.parent_version_id (Phase 3) — D-PRIV-1
  'ingredient_summary_counts',   // From Phase 15 ingredient graph — D-PRIV-1
  'redacted',                    // From manifest_signed.redacted (Phase 16) — D-VAL-3 cross-authorization (validator needs to select redaction-marker regex mode)
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
  /** Phase 15 ingredient summary counts (e.g., { lora: 2, controlnet: 1 }). */
  ingredient_summary_counts: Record<string, number>;
  /** Phase 16 redacted boolean — drives D-VAL-3 redaction-marker requirement. */
  redacted: boolean;
  /** Version label (e.g., "v003") for the summary subject. */
  version_label: string;
}

/**
 * Input shape — Plan 04 facade pre-resolves prompt_positive / prompt_negative
 * via Phase 15's extractInputAssertion (src/engine/c2pa/ingredient-extractor.ts)
 * and threads the resolved strings here. Keeping the edge-walk logic upstream
 * preserves the sanitizer's architecture-purity (zero engine imports).
 *
 * REVISED per checker BLOCKER #1: promptPositive / promptNegative are now
 * REQUIRED input fields. Plan 04 must populate these from the KSampler edge
 * walk before invoking sanitizeProvenance. The earlier hardcoded null defaults
 * silently broke D-PRIV-2 + SUM-01 + SUM-02 + SUM-07.
 */
export interface SanitizeProvenanceInput {
  versionLabel: string;
  parentVersionLabel: string | null;
  completed: ProvenanceCompletedPayload | null;
  models: ModelRef[] | null;
  isRedacted: boolean;
  /** D-PRIV-2 trust boundary — pre-resolved by Plan 04 via extractInputAssertion. null when no KSampler edge resolves. */
  promptPositive: string | null;
  /** D-PRIV-2 trust boundary — pre-resolved by Plan 04 via extractInputAssertion. null when no KSampler edge resolves. */
  promptNegative: string | null;
  ingredientCounts?: Record<string, number>;
}

/**
 * Iterate over ALLOW_LIST keys, never input keys (prototype pollution defence).
 * Returns only fields on the allow-list; everything else is stripped.
 *
 * REVISED per BLOCKER #1: prompt_positive / prompt_negative now flow through
 * verbatim from input.promptPositive / input.promptNegative (D-PRIV-2 trust
 * boundary). Plan 04 facade is responsible for upstream resolution via
 * Phase 15's extractInputAssertion.
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
    prompt_positive: input.promptPositive,  // D-PRIV-2 trust boundary verbatim passthrough
    prompt_negative: input.promptNegative,  // D-PRIV-2 trust boundary verbatim passthrough
    seed,
    parent_version_label: input.parentVersionLabel,
    ingredient_summary_counts: input.ingredientCounts ?? {},
    redacted: input.isRedacted,
    version_label: input.versionLabel,
  };

  return out;
}

/**
 * Defence-in-depth (D-PRIV-3): multi-encoding leak scan on the OUTBOUND payload.
 * Mirrors the Phase 16 multi-encoding helper at
 * src/__tests__/c2pa-redaction-e2e.test.ts:76-92 verbatim.
 *
 * Throws Error if any encoding of the API key appears in the sanitized
 * payload — including the prompt_positive / prompt_negative fields (which now
 * carry user-authored content per D-PRIV-2). Adversarial review can verify
 * this by reading the file in isolation.
 *
 * The scan runs against TWO haystacks for completeness:
 *   1. JSON.stringify(payload) — catches UTF-8/ASCII fragments + base64.
 *   2. Concatenated string fields (binary view) — catches UTF-16LE/UTF-16BE
 *      binary fragments smuggled into string fields. JSON escapes control
 *      bytes (e.g., 0x00) so JSON-haystack alone misses these.
 *
 * Scanning both haystacks aligns with the Phase 16 cross-cutting invariant
 * (UTF-8 / UTF-16LE / UTF-16BE / base64 leak scan applies at every persistence
 * boundary). T-19-13b mitigation explicitly covers smuggled-key detection.
 */
export function assertNoApiKeyInPayload(payload: SanitizedProvenance): void {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (apiKey.length === 0) return;

  const haystackJson = JSON.stringify(payload);

  // Concatenate every string-typed field into one binary haystack. JS strings
  // are UTF-16 internally and preserve any code unit, so smuggled UTF-16LE/BE
  // bytes survive concatenation. Mirrors the Phase 16 file-bytes scan pattern
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

  const fragments = [
    apiKey,                                                       // UTF-8 / ASCII
    Buffer.from(apiKey, 'utf16le').toString('binary'),            // UTF-16LE
    Buffer.from(apiKey, 'utf16le').reverse().toString('binary'),  // UTF-16BE
    Buffer.from(apiKey).toString('base64'),                       // base64
  ];

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
