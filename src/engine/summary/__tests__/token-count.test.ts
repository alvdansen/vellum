/**
 * Phase 19 — BLOCKER #2 second-half. Runtime token-count assertion for the
 * Haiku 4.5 cache threshold (RESEARCH.md Pitfall 1 + D-LLM-5).
 *
 * Plan 03's char-length proxy (system.length >= 18000) is a structural smoke
 * test. This test is the LOAD-BEARING CI gate — it asks the Anthropic SDK for
 * the authoritative token count and verifies the cached prefix clears 4096
 * tokens with a safety margin.
 *
 * Skip cleanly when ANTHROPIC_API_KEY is absent so contributors without keys
 * can still run the rest of the suite. CI environments with the key set must
 * gate merge on this test.
 *
 * Architecture note: this test is part of the eval suite (npm run test:eval)
 * because it requires a real API key. Plan 07's eval-suite Vitest config
 * decides which tests run when the key is present vs absent. Until that
 * config lands, this test runs as part of the regular suite but skips
 * cleanly when no key is set.
 */

import { describe, it, expect } from 'vitest';
import {
  SUMMARY_MODEL_ID,
  SYSTEM_PROMPT,
  assemblePromptInput,
} from '../template.js';
import { FEW_SHOT_EXAMPLES } from '../templates/few-shot-examples.js';

describe('Phase 19 — Haiku 4.5 cached-prefix token-count assertion (BLOCKER #2)', () => {
  it('cached prefix clears Haiku 4.5\'s 4096-token threshold (D-LLM-5)', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('[token-count.test] skipped (no ANTHROPIC_API_KEY)');
      return;
    }

    // Lazy import to keep architecture-purity allowed-set tests stable —
    // this test file is in the SDK allowed-set (extends Plan 04's grep allow
    // via the existing __tests__/ exclusion the allowed-set uses).
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    // Build the EXACT cached prefix structure Plan 04 sends to messages.create:
    // system block = SYSTEM_PROMPT + few-shot examples interleaved as user/assistant
    // turns. Mirror assemblePromptInput's composition with a placeholder sanitized
    // input (the user turn is per-request and not part of the cached prefix).
    const placeholderSanitized = {
      model_name: 'flux1-dev',
      additional_models: [],
      prompt_positive: 'placeholder',
      prompt_negative: null,
      seed: 42,
      parent_version_label: null,
      ingredient_summary_counts: {},
      redacted: false,
      version_label: 'v001',
    };
    const { system: cachedPrefix } = assemblePromptInput(placeholderSanitized);

    // Run the actual SDK count — authoritative source per Anthropic.
    const result = await client.messages.countTokens({
      model: SUMMARY_MODEL_ID,
      system: [{ type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'placeholder' }],
    });

    // Hard floor: 4096 (the Haiku 4.5 cache threshold per Anthropic docs).
    // Below this, cache_control silently no-ops and D-LLM-5's ~90% cost
    // reduction becomes fictional.
    expect(result.input_tokens).toBeGreaterThanOrEqual(4096);

    // Safety margin: 4500. Without margin, future SYSTEM_PROMPT edits could
    // accidentally drift below the floor between releases. The 5000-6000
    // target (BLOCKER #2 first-half structural fix) gives ~500 tokens of headroom.
    expect(result.input_tokens).toBeGreaterThanOrEqual(4500);

    // Sanity log so CI surfaces drift before it becomes a regression.
    console.error(`[token-count.test] cached prefix = ${result.input_tokens} tokens (target: 5000-6000)`);
  }, 30_000); // 30s timeout — countTokens is fast but allow for cold-start

  it('SYSTEM_PROMPT + few-shot examples count is reproducible (deterministic prefix)', () => {
    // Sanity that the prefix construction produces stable output given stable
    // inputs — protects against accidental cache-key drift if assemblePromptInput
    // ever introduces non-determinism.
    const placeholderA = {
      model_name: 'flux1-dev',
      additional_models: [],
      prompt_positive: 'a',
      prompt_negative: null,
      seed: 1,
      parent_version_label: null,
      ingredient_summary_counts: {},
      redacted: false,
      version_label: 'v001',
    };
    const placeholderB = { ...placeholderA, prompt_positive: 'b', seed: 2 }; // Different per-request data

    const { system: prefixA } = assemblePromptInput(placeholderA);
    const { system: prefixB } = assemblePromptInput(placeholderB);

    // The CACHED prefix (system) is identical across requests — only the
    // userTurn varies. This is the prerequisite for cache_control to work.
    expect(prefixA).toBe(prefixB);
    expect(prefixA).toContain('art director'); // SYSTEM_PROMPT anchor
    expect(prefixA).toContain('flux1-dev'); // Few-shot example #1 anchor
    expect(prefixA).toContain('cinematic_fantasy'); // Few-shot example #2 anchor (voice fingerprint)
    expect(prefixA).toContain('<example_notes>'); // BLOCKER #2 expansion anchor (5 occurrences)
    expect(FEW_SHOT_EXAMPLES.length).toBe(5);
    // Sanity check that SYSTEM_PROMPT itself is included.
    expect(prefixA.startsWith(SYSTEM_PROMPT)).toBe(true);
  });
});
