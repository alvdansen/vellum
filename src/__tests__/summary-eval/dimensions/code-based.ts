/**
 * Phase 19 — AI-SPEC §5 code-based eval dimensions.
 * Run unconditionally — no Anthropic API access required.
 *
 * Dimensions implemented:
 *   - assertModelNameFidelity (D-VAL-1 verbatim case-sensitive substring)
 *   - assertSentenceCountAndLength (2-4 sentences, 20-50 words per D-LLM-3)
 *   - assertAntiFeatureRegression (pixel-content banned-substring scan;
 *     Critical-tier per AI-SPEC §5 anti-feature dimension)
 *   - assertNoBannedLexicon (AI-slop register tells per AI-SPEC §5 voice
 *     dimension; Critical-tier as code-based hard-fail)
 *   - assertApiKeyLeakScan (multi-encoding key scan over summary text +
 *     cache-row JSON + log buffer per AI-SPEC §5 leak-scan dimension;
 *     mirrors flattenAnthropicError 4-encoding strip)
 *   - assertRedactionMarker (D-VAL-3 disclosure requirement on redacted
 *     fixtures)
 *   - assertNoRedactedPromptLeak (>15-token redacted-prompt fragment scan)
 */

export type DimensionResult = { ok: true } | { ok: false; reason: string };

/**
 * Banned-lexicon constants — AI-slop register tells per AI-SPEC §5 voice
 * dimension. Hard-fail if any term appears in the summary (case-insensitive).
 * Mirrors the SYSTEM_PROMPT banned list at src/engine/summary/template.ts:98.
 */
export const BANNED_LEXICON = [
  'stunning',
  'vibrant',
  'captivating',
  'delve',
  'in conclusion',
  'here is a summary',
  'this impressive',
  'fascinating',
  'remarkable',
] as const;

/**
 * Pixel-content banned substring set — anti-feature dimension per AI-SPEC §5.
 * Vision-model summaries are THE v1.2 anti-feature; the structured provenance
 * graph IS the ground truth. Any pixel-content vocabulary is a Critical-tier
 * regression that must hard-fail (100% pass threshold).
 */
export const PIXEL_CONTENT_BANNED: readonly RegExp[] = [
  /the (dragon|character|subject)('s)? (eye|face|expression) (gleams|shines|smiles|glows)/i,
  /fierce expression/i,
  /dramatic lighting/i,
  /vibrant colors/i,
  /the image (shows|depicts|portrays)/i,
  /composition (leads|guides) the eye/i,
  /color grading/i,
] as const;

/**
 * D-VAL-1 verbatim model-name fidelity check. Case-sensitive substring match
 * because models_json names are the canonical strings flowing into the C2PA
 * manifest (Phase 13 PROV-V-03 surface).
 *
 * Redacted fixtures pass this gate vacuously — they evaluate redaction-marker
 * instead per D-VAL-3. The caller routes redacted fixtures to
 * assertRedactionMarker; this helper is only called on non-redacted fixtures.
 */
export function assertModelNameFidelity(text: string, expectedNames: string[]): DimensionResult {
  if (expectedNames.length === 0) return { ok: true };
  const hasMatch = expectedNames.some((name) => name.length > 0 && text.includes(name));
  return hasMatch
    ? { ok: true }
    : {
        ok: false,
        reason: `model name fidelity: expected one of [${expectedNames.join(', ')}] verbatim; got: ${text.slice(0, 80)}...`,
      };
}

/**
 * D-LLM-3 sentence-count + word-count envelope check. 2-4 sentences,
 * 20-50 words per AI-SPEC §5 sentence-count + length dimension. Sentence
 * splitter mirrors the Plan 04 post-processing splitter:
 *   text.split(/[.!?]+/).filter(s => s.trim()).slice(0, 4)
 */
export function assertSentenceCountAndLength(text: string): DimensionResult {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (sentences.length < 2 || sentences.length > 4) {
    return { ok: false, reason: `sentence count out of range: ${sentences.length} (expected 2-4)` };
  }
  if (words.length < 20 || words.length > 50) {
    return { ok: false, reason: `word count out of range: ${words.length} (expected 20-50)` };
  }
  return { ok: true };
}

/**
 * Anti-feature regression check — Critical-tier per AI-SPEC §5. Vision-model
 * summaries are THE v1.2 anti-feature (REQUIREMENTS.md OUT-OF-SCOPE). Even one
 * pixel-content vocabulary match is a load-bearing regression.
 */
export function assertAntiFeatureRegression(text: string): DimensionResult {
  for (const re of PIXEL_CONTENT_BANNED) {
    const match = text.match(re);
    if (match) {
      return {
        ok: false,
        reason: `anti-feature regression: pixel-content vocabulary "${match[0]}" detected`,
      };
    }
  }
  return { ok: true };
}

/**
 * Banned-lexicon hard-fail — AI-SPEC §5 voice dimension code-based gate.
 * The LLM-judge dimension provides the soft 1-5 score; this code-based check
 * is the Critical-tier 100% pass threshold (any banned term is fail).
 */
export function assertNoBannedLexicon(text: string): DimensionResult {
  const lower = text.toLowerCase();
  for (const term of BANNED_LEXICON) {
    if (lower.includes(term)) {
      return {
        ok: false,
        reason: `banned-lexicon hit: "${term}" (AI-slop register tell per AI-SPEC §5 voice dimension)`,
      };
    }
  }
  return { ok: true };
}

/**
 * Multi-encoding API-key leak scan — Critical-tier per AI-SPEC §5. Scans over
 * arbitrary haystacks (summary text, cache-row JSON, log lines) for any API
 * key fragment in 4 encodings:
 *   - UTF-8 / ASCII (raw apiKey)
 *   - UTF-16LE (Buffer.from(apiKey, 'utf16le').toString('binary'))
 *   - UTF-16BE (.reverse() of UTF-16LE buffer per Phase 14/16 precedent)
 *   - base64
 *
 * When ANTHROPIC_API_KEY is absent, the scan still runs against the synthetic
 * sk-ant- pattern as defence-in-depth (catches a key fragment leaking from a
 * different test process or fixture into the haystack).
 *
 * Mirrors flattenAnthropicError at src/engine/summary/anthropic-client.ts:176-196
 * verbatim for the encoding set.
 */
export function assertApiKeyLeakScan(haystacks: string[]): DimensionResult {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (apiKey.length === 0) {
    // No key — defence-in-depth pattern check only.
    for (const haystack of haystacks) {
      if (/sk-ant-[A-Za-z0-9_-]{40,}/.test(haystack)) {
        return { ok: false, reason: 'sk-ant- pattern leaked' };
      }
    }
    return { ok: true };
  }
  const fragments = [
    apiKey,
    Buffer.from(apiKey, 'utf16le').toString('binary'),
    Buffer.from(apiKey, 'utf16le').reverse().toString('binary'),
    Buffer.from(apiKey).toString('base64'),
  ];
  for (const haystack of haystacks) {
    for (const frag of fragments) {
      if (frag.length === 0) continue;
      if (haystack.includes(frag)) {
        return {
          ok: false,
          reason: 'API key fragment leaked across multi-encoding scan',
        };
      }
    }
    if (/sk-ant-[A-Za-z0-9_-]{40,}/.test(haystack)) {
      return { ok: false, reason: 'sk-ant- pattern leaked' };
    }
  }
  return { ok: true };
}

/**
 * D-VAL-3 redaction-marker code-based check — used on redacted fixtures.
 * Mirrors validateSummary at src/engine/summary/validation.ts:36-43. Markers
 * are case-insensitive substrings: 'redacted', 'partial', 'redaction'.
 */
export function assertRedactionMarker(text: string): DimensionResult {
  const lower = text.toLowerCase();
  const hasMarker = ['redacted', 'partial', 'redaction'].some((m) => lower.includes(m));
  return hasMarker
    ? { ok: true }
    : { ok: false, reason: 'redaction marker absent on redacted fixture (D-VAL-3 violation)' };
}

/**
 * D-VAL-3 redaction-leak — assert no >15-token contiguous prompt-positive
 * substring leaks into the summary. Sliding-window scan of the redacted prompt
 * tokens against the summary text. This is the second half of the redaction
 * disclosure contract: not only must the summary contain the marker, it must
 * NOT contain >15 contiguous redacted tokens (NDA / IP exposure surface).
 */
export function assertNoRedactedPromptLeak(text: string, redactedPrompt: string): DimensionResult {
  if (redactedPrompt.trim().length === 0) return { ok: true };
  const tokens = redactedPrompt.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 15) return { ok: true };
  for (let i = 0; i + 15 <= tokens.length; i++) {
    const window = tokens.slice(i, i + 15).join(' ');
    if (text.includes(window)) {
      return {
        ok: false,
        reason: `>15-token redacted-prompt fragment leaked: "${window.slice(0, 40)}..."`,
      };
    }
  }
  return { ok: true };
}
