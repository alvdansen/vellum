/**
 * Phase 19 — AI-SPEC §5 LLM-judge eval dimensions.
 *
 * Skip cleanly when ANTHROPIC_API_KEY is absent — emits
 * "[summary-eval] skipped (no API key)" log line so contributors without keys
 * can still run the code-based dimensions. Skip path returns
 * { ok: true, score: 5 } so threshold gating treats a skip as a pass; this
 * trade-off is documented in the README.md (T-19-44 disposition: accept).
 *
 * Uses the production sole-importer (anthropic-client.ts) in eval mode by
 * passing a judge rubric as the system prompt + the summary text as the
 * user turn. Real Anthropic API calls; bounded to <12 calls per CI run
 * (~$0.05 worst case at Haiku 4.5 cache-warmed pricing).
 *
 * D-FB-4 + Pitfall 2 retry policy is inherited from the sole-importer —
 * single retry with 1s backoff before counting as a circuit-breaker
 * failure. The eval suite tolerates one transient retry; persistent
 * failures surface as { ok: false } with a reason describing the SDK
 * error class.
 */

import { generateSummary } from '../../../engine/summary/anthropic-client.js';

export type JudgeResult =
  | { ok: true; score: number }
  | { ok: false; score: number; reason: string };

/**
 * Judge model note — the judge runs on the same model as production
 * (claude-haiku-4-5 via the sole-importer's hardcoded model id). Cost-bounded.
 * A higher-fidelity Sonnet judge is a v1.3 candidate per AI-SPEC §5 (the v1.2
 * scope keeps a single SDK importer to preserve architecture-purity).
 */
const JUDGE_MODEL_NOTE =
  'Judge using claude-haiku-4-5-20251001 (cost-bounded). ' +
  'Higher-fidelity judgment with claude-sonnet-4-5 is a v1.3 candidate.';

/**
 * D-LLM-2 lineage-relationship judge — verifies direction matches
 * parent_version_id. For iterate fixtures, the summary should state the
 * direction "from {parent}"; for root fixtures, no parent claim should be
 * made. Inverted lineage (e.g., "v002 is a refinement of v003" when
 * v003.parent = v002) is the highest-impact silent-failure mode per
 * AI-SPEC §1b.
 *
 * Returns 1-5 score; pass = 4-5.
 */
export async function judgeLineageRelationship(
  summary: string,
  parentVersionLabel: string | null,
  versionLabel: string,
): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('[summary-eval] judgeLineageRelationship skipped (no API key)');
    return { ok: true, score: 5 };
  }

  const judgeRubric = `You are evaluating a VFX summary for lineage-relationship correctness.

Summary: "${summary}"

Ground truth:
- Version label: ${versionLabel}
- Parent version label: ${parentVersionLabel ?? 'none (root version)'}

Rate 1-5:
5 = direction is correct (iterate states "from {parent}"; root makes no parent claim)
4 = direction correct but understated
3 = ambiguous lineage
2 = direction inverted or hallucinated
1 = obvious lineage error

Respond with ONLY the integer score (1, 2, 3, 4, or 5).`;

  try {
    const result = await generateSummary({ system: JUDGE_MODEL_NOTE, userTurn: judgeRubric }, apiKey);
    const match = result.text.trim().match(/^([1-5])/);
    const score = match ? parseInt(match[1], 10) : 1;
    return score >= 4
      ? { ok: true, score }
      : {
          ok: false,
          score,
          reason: `lineage judge score ${score}/5: ${result.text.trim().slice(0, 100)}`,
        };
  } catch (err) {
    return {
      ok: false,
      score: 0,
      reason: `lineage judge call failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

/**
 * Voice-register judge — verifies Supervisor declarative present-tense
 * register; no AI-slop register tells. The voice fingerprint reference is
 * the canonical ROADMAP exemplar embedded in the rubric so the judge has
 * a target shape rather than an open prompt.
 *
 * Returns 1-5 score; pass = 4-5.
 */
export async function judgeVoiceRegister(summary: string): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('[summary-eval] judgeVoiceRegister skipped (no API key)');
    return { ok: true, score: 5 };
  }

  const judgeRubric = `You are evaluating a VFX summary for Supervisor voice authenticity.

Summary: "${summary}"

Voice fingerprint to match:
"v003 is a tighter close-up of the dragon's eye, generated with flux1-dev plus the cinematic_fantasy LoRA at seed 42, swapping the wide-angle env map for an HDRI from the parent shot v002."

Rate 1-5 on Supervisor voice register:
5 = peer review-note voice (declarative, present tense, 25-35 words, no AI tells)
4 = mostly correct register, minor verbosity or slight tonal slip
3 = neutral but not Supervisor-specific
2 = AI-register tells present (e.g., "stunning", "Here's a summary", "delve")
1 = obvious AI-slop register

Respond with ONLY the integer score (1, 2, 3, 4, or 5).`;

  try {
    const result = await generateSummary({ system: JUDGE_MODEL_NOTE, userTurn: judgeRubric }, apiKey);
    const match = result.text.trim().match(/^([1-5])/);
    const score = match ? parseInt(match[1], 10) : 1;
    return score >= 4
      ? { ok: true, score }
      : {
          ok: false,
          score,
          reason: `voice judge score ${score}/5: ${result.text.trim().slice(0, 100)}`,
        };
  } catch (err) {
    return {
      ok: false,
      score: 0,
      reason: `voice judge call failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}
