/**
 * Phase 19 — SUM-01..06 Engine facade for the AI conversational summary feature.
 *
 * Architecture-purity (Plan 01 grep guard): Imports limited to pure helpers
 * (sanitizer, validation, deterministic-template, template, circuit-breaker,
 * anthropic-client) + repos (versionRepo, provenanceRepo). NO direct
 * @anthropic-ai/sdk import — that lives in anthropic-client.ts only.
 *
 * Mirrors Phase 14 Engine.signOutput discriminated-outcome shape
 * (src/engine/pipeline.ts:1133-1395). Engine method NEVER throws to HTTP
 * layer for failure paths — every error path is a typed outcome variant.
 *
 * 8-step pipeline:
 *   1. Load version + completed event + model fingerprints + manifest_signed event + redact-state.
 *   2. Cache lookup (skipped when options.regenerate === true).
 *   3. Pre-flight gates → fallback paths (api_key_missing, circuit_open).
 *   3.5 BLOCKER #1 (revision-1): Resolve prompt_positive / prompt_negative via
 *       Phase 15 extractInputAssertion KSampler edge walk + parent_version_label
 *       via versionRepo.getVersion(parent).version_number.
 *   4. Sanitize + leak-scan defence-in-depth + assemble prompt input.
 *   5. Call Anthropic via lazy SDK + 1-retry-on-transient wrapper.
 *   6. Validate output (D-VAL-2 gates the cache write).
 *   7. Append-only cache write — ONLY on validated live responses.
 *   8. Return SummaryOutcome.
 */

import type { ModelRef, SummaryGeneratedPayloadFields } from '../../types/provenance.js';
import type { ProvenanceCompletedPayload } from '../../store/provenance-repo.js';
import { TypedError } from '../errors.js';
import {
  sanitizeProvenance,
  assertNoApiKeyInPayload,
  assertNoApiKeyInString,
} from './sanitizer.js';
import { validateSummary } from './validation.js';
import { buildDeterministicSummary } from './deterministic-template.js';
import {
  SUMMARY_TEMPLATE_VERSION,
  SUMMARY_MODEL_ID,
  assemblePromptInput,
} from './template.js';
import { circuitBreaker } from './circuit-breaker.js';
import { generateSummary, flattenAnthropicError } from './anthropic-client.js';
import { logSummaryEvent } from './telemetry.js';

// BLOCKER #1 (revision-1): wire Phase 15 KSampler edge walk for prompt resolution.
// extractInputAssertion (src/engine/c2pa/ingredient-extractor.ts:310) lives in the
// Phase 15 ingredient graph — it walks KSampler.positive / .negative edges to the
// upstream CLIPTextEncode nodes and returns { prompt_positive, prompt_negative,
// sampler, seed }. Cap = INPUT_PROMPT_MAX_CHARS (4096) is enforced by the helper.
// We import here (not inside sanitizer.ts) to preserve the sanitizer's pure-helper
// architecture-purity invariant — engine facade owns the resolver wiring.
import { extractInputAssertion } from '../c2pa/ingredient-extractor.js';

// Re-export for consumers (HTTP route in Plan 05, dashboard signal contract).
export { SUMMARY_TEMPLATE_VERSION, SUMMARY_MODEL_ID } from './template.js';

/**
 * Discriminated outcome union mirroring Phase 14 Engine.signOutput shape.
 * The dashboard branches on `source` to render success vs fallback UI.
 *
 * WARNING #10 (revision-1): pruned 'output_too_short' (folded into
 * validation_failed since the deterministic-template fallback always passes
 * validateSummary on the empty-content branch via Pitfall 8 surface) and
 * 'manifest_sha256_unavailable' (the live path returns outcome='live'
 * without persistence when manifestSha256 is null — see step 8 below —
 * rather than emitting a fallback). Final union: 7 reasons.
 */
export type SummaryOutcome =
  | {
      source: 'cache_hit';
      text: string;
      generated_at: string;
      template_version: string;
      model_id: string;
    }
  | {
      source: 'live';
      text: string;
      generated_at: string;
      template_version: string;
      model_id: string;
      prompt_tokens: number;
      completion_tokens: number;
    }
  | {
      source: 'fallback';
      text: string;
      reason:
        | 'api_key_missing'         // D-FB-2 — config null OR AuthenticationError (401)
        | 'circuit_open'            // D-FB-3 — breaker tripped (pre-flight gate, never reaches mapErrToReason)
        | 'sdk_load_failed'         // TypedError('ANTHROPIC_SDK_LOAD_FAILED') — pre-flight detection
        | 'http_error'              // 4xx (excluding 401/403) + 5xx after retry exhausted
        | 'network_error'           // APIConnectionError after retry
        | 'validation_failed'       // D-VAL-2 — regex miss / leak-scan failure / Pitfall 8 empty content
        | 'timeout';                // 10s per-call exceeded (APIConnectionTimeoutError)
    };

/**
 * Repo interface narrowed to the surface summarizeVersion needs.
 *
 * BLOCKER #1 (revision-1): getVersion returns { id, version_number,
 * parent_version_id } as the canonical structure (label is derived from
 * version_number at the use site via `v${pad}` formatting per Phase 3
 * PROJECT.md naming). This avoids forcing the Engine facade caller to
 * pre-compute a `label` field.
 */
export interface SummarizeVersionDeps {
  versionRepo: {
    getVersion: (id: string) => {
      id: string;
      version_number: number;
      parent_version_id?: string | null;
    } | null;
  };
  provenanceRepo: {
    getEventsForVersion: (id: string) => Array<{
      event_type: string;
      prompt_json?: string | null;
      seed?: number | null;
      models_json?: string | null;
      outputs_json?: string | null;
    }>;
    getLatestFingerprints: (id: string) => ModelRef[] | null;
    getLatestManifestSignedEvent: (
      id: string,
      filename: string,
    ) => { manifest_sha256?: string | null; redacted?: boolean | null } | null;
    getLatestSummaryGeneratedEvent: (
      id: string,
      manifestSha256: string,
      templateVersion: string,
      modelId: string,
    ) => SummaryGeneratedPayloadFields | null;
    appendSummaryGeneratedEvent: (
      id: string,
      payload: SummaryGeneratedPayloadFields,
    ) => void;
  };
  anthropicConfig: { apiKey: string } | null;
  /** Injectable for deterministic tests (Pitfall 6 + circuit-breaker contract). */
  clock: () => number;
}

export interface SummarizeVersionOptions {
  /** When true, skip cache lookup at step 2 (forces fresh LLM call). */
  regenerate?: boolean;
  /** Optional cancellation signal (HTTP route may pass AbortController.signal). */
  signal?: AbortSignal;
}

/** Format a version_number as the canonical zero-padded label (`v001`, `v003`). */
function formatVersionLabel(versionNumber: number): string {
  return `v${String(versionNumber).padStart(3, '0')}`;
}

export async function summarizeVersion(
  versionId: string,
  deps: SummarizeVersionDeps,
  options: SummarizeVersionOptions = {},
): Promise<SummaryOutcome> {
  // WARNING #5 (revision-1): performance.now() at function entry; threaded
  // into every logSummaryEvent call site so cache_hit / live / fallback all
  // emit accurate duration_ms (cache_hit is sub-100ms; live is ~600ms;
  // fallback varies by reason — operational visibility relies on accurate
  // timings per AI-SPEC §7 monitoring contract).
  const startedAt = performance.now();

  // Step 1: Load version + provenance + model fingerprints + manifest_signed event.
  const version = deps.versionRepo.getVersion(versionId);
  if (!version) {
    throw new TypedError(
      'VERSION_NOT_FOUND',
      `Version ${versionId} not found`,
      'Verify the versionId — Engine.summarizeVersion does not auto-create versions.',
    );
  }

  const versionLabel = formatVersionLabel(version.version_number);

  const events = deps.provenanceRepo.getEventsForVersion(versionId);
  const completedRow = events.find((e) => e.event_type === 'completed');
  const completed: ProvenanceCompletedPayload | null = completedRow
    ? {
        prompt_json: completedRow.prompt_json ?? null,
        seed: completedRow.seed ?? null,
        models_json: completedRow.models_json ?? '[]',
        outputs_json: completedRow.outputs_json ?? '[]',
      }
    : null;
  const models = deps.provenanceRepo.getLatestFingerprints(versionId);

  // Read primary output filename from completed.outputs_json — needed for manifest_signed lookup.
  let primaryFilename = '';
  if (completed?.outputs_json) {
    try {
      const outputs = JSON.parse(completed.outputs_json) as Array<{ filename?: string }>;
      primaryFilename = outputs[0]?.filename ?? '';
    } catch {
      /* malformed JSON — primaryFilename stays empty */
    }
  }
  const signedEvent = primaryFilename
    ? deps.provenanceRepo.getLatestManifestSignedEvent(versionId, primaryFilename)
    : null;
  const isRedacted = signedEvent?.redacted === true;
  const manifestSha256 = signedEvent?.manifest_sha256 ?? null;

  // Helper closure variable — initially null; rebound after Step 3.5 resolution
  // so the deterministic-template fallback also benefits from BLOCKER #1's
  // parent-label wiring. The closure pattern lets us declare the helper before
  // the resolution block but pick up the resolved value when invoked.
  let resolvedParentLabelForFallback: string | null = null;

  // Helper to build a fallback outcome with the deterministic template
  // content. Emits a telemetry event at the SAME call site so every fallback
  // path is logged in full per AI-SPEC §7 (the diagnostic surface).
  // WARNING #5 (revision-1): duration_ms threaded from startedAt at the
  // function entry above — not a hardcoded zero.
  const buildFallbackOutcome = (
    reason: Extract<SummaryOutcome, { source: 'fallback' }>['reason'],
  ): SummaryOutcome => {
    logSummaryEvent({
      event: 'summary_generated',
      version_id: versionId,
      manifest_sha256: manifestSha256 ?? null,
      model_id: SUMMARY_MODEL_ID,
      template_version: SUMMARY_TEMPLATE_VERSION,
      duration_ms: Math.round(performance.now() - startedAt),
      prompt_tokens: 0,
      completion_tokens: 0,
      outcome: 'fallback',
      reason,
    });
    return {
      source: 'fallback',
      reason,
      text: buildDeterministicSummary({
        completed: completed ?? null,
        models: models ?? null,
        parentVersionLabel: resolvedParentLabelForFallback,
        isRedacted,
        versionLabel,
      }),
    };
  };

  // Step 2: Cache lookup (skipped on regenerate).
  if (!options.regenerate && manifestSha256) {
    const cached = deps.provenanceRepo.getLatestSummaryGeneratedEvent(
      versionId,
      manifestSha256,
      SUMMARY_TEMPLATE_VERSION,
      SUMMARY_MODEL_ID,
    );
    if (cached !== null) {
      // AI-SPEC §7: cache_hit emits on 1% deterministic sample; sampling
      // logic owned by logSummaryEvent (shouldSampleCacheHit). duration_ms
      // is threaded from startedAt — cache hits are sub-100ms but the
      // value is still operationally useful for p99 latency tracking.
      logSummaryEvent({
        event: 'summary_generated',
        version_id: versionId,
        manifest_sha256: manifestSha256 ?? null,
        model_id: SUMMARY_MODEL_ID,
        template_version: SUMMARY_TEMPLATE_VERSION,
        duration_ms: Math.round(performance.now() - startedAt),
        prompt_tokens: 0,
        completion_tokens: 0,
        outcome: 'cache_hit',
      });
      return {
        source: 'cache_hit',
        text: cached.summary_text,
        generated_at: cached.generated_at,
        template_version: SUMMARY_TEMPLATE_VERSION,
        model_id: SUMMARY_MODEL_ID,
      };
    }
  }

  // Step 3: Pre-flight gates → fallback paths.
  if (deps.anthropicConfig === null) {
    return buildFallbackOutcome('api_key_missing');
  }
  if (!circuitBreaker.canRequest(deps.clock)) {
    return buildFallbackOutcome('circuit_open');
  }

  // Step 3.5 (BLOCKER #1 revision-1): Resolve user-authored prompt content via
  // Phase 15 KSampler edge walk + parent label via versionRepo. These resolutions
  // live in the engine facade (NOT the sanitizer) so the pure-helper architecture-
  // purity invariant is preserved (sanitizer.ts has zero engine imports).
  //
  // extractInputAssertion (src/engine/c2pa/ingredient-extractor.ts) walks the
  // KSampler.positive / .negative edges to the upstream CLIPTextEncode nodes
  // and returns { prompt_positive, prompt_negative, sampler, seed }. Cap =
  // INPUT_PROMPT_MAX_CHARS (4096 chars) is already enforced by the helper.
  //
  // Parent label resolution: when version.parent_version_id is non-null,
  // versionRepo.getVersion(parent).version_number → format as 'v{NNN}' for
  // the Supervisor-voice "iterate from v002" reference. NULL on root versions.
  let promptPositive: string | null = null;
  let promptNegative: string | null = null;
  if (completed?.prompt_json) {
    try {
      const promptBlob = JSON.parse(completed.prompt_json) as Record<string, unknown>;
      const resolvedSeed = typeof completed.seed === 'number' ? completed.seed : null;
      const inputAssertion = extractInputAssertion(promptBlob, resolvedSeed);
      promptPositive = inputAssertion.prompt_positive;
      promptNegative = inputAssertion.prompt_negative;
    } catch {
      // Malformed prompt_json — leave both null. validateSummary + deterministic-template
      // both handle null gracefully; cache write proceeds on validation pass.
    }
  }

  let parentVersionLabel: string | null = null;
  if (version.parent_version_id) {
    const parent = deps.versionRepo.getVersion(version.parent_version_id);
    if (parent) {
      // Phase 3 convention: zero-padded `v001` labels (PROJECT.md naming convention).
      parentVersionLabel = `v${String(parent.version_number).padStart(3, '0')}`;
    }
  }
  // Bind closure for any subsequent buildFallbackOutcome call (BLOCKER #1).
  resolvedParentLabelForFallback = parentVersionLabel;

  // Step 4: Sanitize (D-PRIV-1) + leak-scan defence-in-depth + assemble prompt input.
  // BLOCKER #1: promptPositive / promptNegative / parentVersionLabel are now
  // threaded from upstream resolvers (extractInputAssertion + versionRepo.getVersion)
  // — no more hardcoded null silently breaking D-PRIV-2 + SUM-01.
  const sanitized = sanitizeProvenance({
    versionLabel,
    parentVersionLabel,
    completed: completed ?? null,
    models: models ?? null,
    isRedacted,
    promptPositive,
    promptNegative,
    ingredientCounts: {},
  });

  try {
    assertNoApiKeyInPayload(sanitized); // D-PRIV-3 defence-in-depth
  } catch (err) {
    // Adversarial-review surface — log loudly via flattenAnthropicError, then fallback.
    console.error('vellum: sanitization leak-scan FAILED:', flattenAnthropicError(err));
    return buildFallbackOutcome('validation_failed'); // Treat as validation failure for cache-write gate
  }

  const promptInput = assemblePromptInput(sanitized);

  // Step 5: Call Anthropic via lazy SDK + 1-retry-on-transient wrapper.
  let llmResult: { text: string; prompt_tokens: number; completion_tokens: number };
  try {
    llmResult = await generateSummary(promptInput, deps.anthropicConfig.apiKey, {
      signal: options.signal,
    });
    circuitBreaker.recordSuccess(deps.clock);
  } catch (err) {
    circuitBreaker.recordFailure(deps.clock);
    // Map error to fallback reason. Use TypedError narrowing first; then SDK class hierarchy.
    if (err instanceof TypedError && err.code === 'ANTHROPIC_SDK_LOAD_FAILED') {
      // The Pitfall 8 empty/non-text-block path also surfaces as TypedError(
      // ANTHROPIC_SDK_LOAD_FAILED) with message containing 'Pitfall 8'.
      // Disambiguate so the engine returns the correct fallback reason —
      // 'sdk_load_failed' for binding load failures, 'validation_failed' for
      // empty-content responses (per WARNING #10 pruning rationale).
      if (err.message.includes('Pitfall 8')) {
        return buildFallbackOutcome('validation_failed');
      }
      return buildFallbackOutcome('sdk_load_failed');
    }
    return buildFallbackOutcome(mapErrToReason(err));
  }

  // Step 6: Validate output (D-VAL-2 — gates the cache write).
  const validation = validateSummary(llmResult.text, models ?? [], isRedacted);
  if (!validation.ok) {
    return buildFallbackOutcome('validation_failed');
  }

  // Step 6.5: Post-LLM API key leak scan (D-PRIV-3 defence-in-depth). Closes
  // the smuggle path where the LLM response itself contains an API key
  // fragment (rare model misbehavior, adversarial prompt-injection, or
  // upstream provider regressions). Routes to validation_failed fallback so
  // the cache row is never written with leaked content.
  try {
    assertNoApiKeyInString(llmResult.text);
  } catch (err) {
    console.error('vellum: post-LLM leak-scan FAILED:', flattenAnthropicError(err));
    return buildFallbackOutcome('validation_failed');
  }

  // Step 7: Append-only cache write — ONLY on validated live responses.
  if (manifestSha256) {
    const generatedAt = new Date(deps.clock()).toISOString();
    deps.provenanceRepo.appendSummaryGeneratedEvent(versionId, {
      manifest_sha256: manifestSha256,
      template_version: SUMMARY_TEMPLATE_VERSION,
      model_id: SUMMARY_MODEL_ID,
      summary_text: llmResult.text,
      generated_at: generatedAt,
      prompt_tokens: llmResult.prompt_tokens,
      completion_tokens: llmResult.completion_tokens,
      outcome: 'live',
    });

    // AI-SPEC §7: live emits in full (cost-projection flywheel input).
    // duration_ms is threaded from startedAt for accurate p95/p99 tracking.
    logSummaryEvent({
      event: 'summary_generated',
      version_id: versionId,
      manifest_sha256: manifestSha256,
      model_id: SUMMARY_MODEL_ID,
      template_version: SUMMARY_TEMPLATE_VERSION,
      duration_ms: Math.round(performance.now() - startedAt),
      prompt_tokens: llmResult.prompt_tokens,
      completion_tokens: llmResult.completion_tokens,
      outcome: 'live',
    });

    return {
      source: 'live',
      text: llmResult.text,
      generated_at: generatedAt,
      template_version: SUMMARY_TEMPLATE_VERSION,
      model_id: SUMMARY_MODEL_ID,
      prompt_tokens: llmResult.prompt_tokens,
      completion_tokens: llmResult.completion_tokens,
    };
  }

  // Step 8 (no manifest_sha256): live response but cache write blocked — return live without persistence.
  // Per RESEARCH.md Open Question 3: skip cache write when manifest_sha256 is null;
  // every view of these edge cases is a fresh LLM call (acceptable cost).
  // Telemetry still emits — manifest_sha256 is null but the live call cost
  // is the same; cost-projection flywheel needs the metadata regardless.
  logSummaryEvent({
    event: 'summary_generated',
    version_id: versionId,
    manifest_sha256: null,
    model_id: SUMMARY_MODEL_ID,
    template_version: SUMMARY_TEMPLATE_VERSION,
    duration_ms: Math.round(performance.now() - startedAt),
    prompt_tokens: llmResult.prompt_tokens,
    completion_tokens: llmResult.completion_tokens,
    outcome: 'live',
  });

  return {
    source: 'live',
    text: llmResult.text,
    generated_at: new Date(deps.clock()).toISOString(),
    template_version: SUMMARY_TEMPLATE_VERSION,
    model_id: SUMMARY_MODEL_ID,
    prompt_tokens: llmResult.prompt_tokens,
    completion_tokens: llmResult.completion_tokens,
  };
}

/**
 * Map an Anthropic API error to a SummaryOutcome.fallback reason. Uses the
 * SDK error class hierarchy (RESEARCH.md error class table) — caller has
 * already loaded the SDK (so `instanceof` checks would need the module
 * reference). For Plan 04 simplicity, use err.constructor.name string match
 * as the discriminator. This is the documented contract (Anthropic class
 * names are stable across 0.95.x).
 *
 * WARNING #10 (revision-1): the 7-reason union handled by this function:
 *   - 'api_key_missing'    AuthenticationError (401), PermissionDeniedError (403)
 *   - 'timeout'            APIConnectionTimeoutError, AbortError
 *   - 'network_error'      APIConnectionError (DNS / TCP), TypeError (fetch fail)
 *   - 'http_error'         RateLimitError (429), InternalServerError (5xx),
 *                          BadRequestError (400), UnprocessableEntityError (422),
 *                          NotFoundError (404)
 *
 * Three reasons NEVER reach this function (handled at higher precedence):
 *   - 'circuit_open'       Pre-flight gate (Step 3) returns before the SDK call
 *   - 'sdk_load_failed'    Caller short-circuits via `if (err instanceof TypedError
 *                          && err.code === 'ANTHROPIC_SDK_LOAD_FAILED')` BEFORE
 *                          delegating to mapErrToReason
 *   - 'validation_failed'  Returned by Step 6 (validation gate) AFTER the SDK
 *                          call succeeds; never raised as an exception
 */
function mapErrToReason(err: unknown): Extract<SummaryOutcome, { source: 'fallback' }>['reason'] {
  const name = err instanceof Error ? err.constructor.name : '';
  switch (name) {
    case 'AuthenticationError':
    case 'PermissionDeniedError':
      return 'api_key_missing';
    case 'APIConnectionTimeoutError':
    case 'AbortError':
      return 'timeout';
    case 'APIConnectionError':
      return 'network_error';
    case 'TypeError':
      // Native fetch failures (DNS resolve / connection refused) surface as TypeError
      // when the SDK uses Node's built-in fetch with no special wrapping.
      return 'network_error';
    case 'RateLimitError':
    case 'InternalServerError':
    case 'BadRequestError':
    case 'UnprocessableEntityError':
    case 'NotFoundError':
      return 'http_error';
    default:
      return 'http_error';
  }
}
