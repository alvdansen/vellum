// Engine-layer Anthropic Messages API wrapper.
//
// This is the ONLY file in the codebase that imports @anthropic-ai/sdk. The
// architecture-purity test asserts:
//   grep -rE "from\s*['\"]@anthropic-ai/sdk|import\s*\(\s*['\"]@anthropic-ai/sdk" src/
//   (excluding __tests__) returns matches ONLY in src/engine/summary/anthropic-client.ts.
//
// Mirrors the c2pa-node sole-importer discipline (src/engine/c2pa/signer.ts:1-225).
// Exposes generateSummary, flattenAnthropicError, __resetAnthropicSdkStateForTests;
// the Engine facade in src/engine/summary/index.ts is the SOLE caller.
//
// Lazy + try/catch'd binding load — the FIRST invocation attempts the dynamic
// import; subsequent invocations reuse the cached module OR throw the cached
// load error wrapped in TypedError('ANTHROPIC_SDK_LOAD_FAILED'). Server boot
// NEVER calls this path.
//
// Retry budget: single retry with 1s backoff
// at the engine layer. SDK retries DISABLED via maxRetries: 0 on BOTH the
// client constructor AND every per-request options arg (defence-in-depth —
// SDK-level retries would silently multiply the engine's retry budget).
//
// Error hygiene: flattenAnthropicError strips API key
// fragments in 4 encodings (UTF-8 / UTF-16LE / UTF-16BE / base64) + the
// sk-ant-... regex pattern. Mirrors the multi-encoding leak scan precedent
// at src/__tests__/c2pa-redaction-e2e.test.ts:76-92.

import { TypedError } from '../errors.js';
import { apiKeyFragments } from './sanitizer.js';

// Type-only import is allowed (erased at compile; no runtime load).
// Runtime load happens inside ensureAnthropicSdk via dynamic import.
type AnthropicSdkModule = typeof import('@anthropic-ai/sdk');

let anthropicModule: AnthropicSdkModule | null = null;
let anthropicLoadError: Error | null = null;

/**
 * Lazy SDK loader with cached error short-circuit. Mirrors
 * src/engine/c2pa/signer.ts:39-71 verbatim.
 */
async function ensureAnthropicSdk(): Promise<AnthropicSdkModule> {
  if (anthropicModule !== null) return anthropicModule;
  if (anthropicLoadError !== null) {
    throw new TypedError(
      'ANTHROPIC_SDK_LOAD_FAILED',
      `Anthropic SDK unavailable: ${anthropicLoadError.message}`,
      'Reinstall @anthropic-ai/sdk@0.95.1; verify Node >=20 and ESM-compatible runtime.',
    );
  }
  try {
    anthropicModule = await import('@anthropic-ai/sdk');
    return anthropicModule;
  } catch (err) {
    anthropicLoadError = err as Error;
    throw new TypedError(
      'ANTHROPIC_SDK_LOAD_FAILED',
      `Anthropic SDK unavailable: ${(err as Error).message}`,
      'Reinstall @anthropic-ai/sdk@0.95.1; verify Node >=20.',
    );
  }
}

/**
 * Test-only — resets the module-scoped lazy-load state so a vi.mock on
 * @anthropic-ai/sdk can take effect in subsequent test cases. Production
 * code MUST NOT call this — it deliberately re-triggers the lazy import path.
 *
 * Mirrors __resetC2paNodeStateForTests at src/engine/c2pa/signer.ts:94-97.
 */
export function __resetAnthropicSdkStateForTests(): void {
  anthropicModule = null;
  anthropicLoadError = null;
}

/**
 * Public API — call Anthropic Messages API with the assembled prompt input.
 * Returns text + token-usage metadata on success; throws TypedError or
 * Anthropic.APIError subclass on failure. The engine facade
 * (src/engine/summary/index.ts) maps thrown errors to SummaryOutcome variants.
 */
export async function generateSummary(
  promptInput: { system: string; userTurn: string },
  apiKey: string,
  options?: { signal?: AbortSignal },
): Promise<{ text: string; prompt_tokens: number; completion_tokens: number }> {
  const sdk = await ensureAnthropicSdk();
  const Anthropic = sdk.default;

  const client = new Anthropic({
    apiKey,
    maxRetries: 0,    // engine owns retry; disable SDK retry
    timeout: 10_000,  // 10s per-call timeout (SDK default is 10 minutes)
  });

  // First attempt.
  try {
    return await invokeAnthropic(client, promptInput, options?.signal);
  } catch (err) {
    // Retry once on transient errors only.
    if (isTransient(err, sdk)) {
      await sleep(1000);  // 1s backoff
      return await invokeAnthropic(client, promptInput, options?.signal);
    }
    throw err;
  }
}

async function invokeAnthropic(
  client: InstanceType<AnthropicSdkModule['default']>,
  promptInput: { system: string; userTurn: string },
  signal: AbortSignal | undefined,
): Promise<{ text: string; prompt_tokens: number; completion_tokens: number }> {
  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',  // dated pin — never a floating alias
      max_tokens: 180,                      // hard ceiling on summary length
      temperature: 0.7,
      system: [
        {
          type: 'text',
          text: promptInput.system,
          cache_control: { type: 'ephemeral' },  // 5min TTL prefix cache
        },
      ],
      messages: [{ role: 'user', content: promptInput.userTurn }],
    },
    {
      maxRetries: 0,    // Defence-in-depth: also pass per-request
      timeout: 10_000,
      signal,           // Optional cancellation support
    },
  );

  // Never index content[0] blindly; SDK may return tool_use or other blocks.
  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new TypedError(
      'ANTHROPIC_SDK_LOAD_FAILED',  // Engine maps this to the fallback 'validation_failed' outcome
      'Anthropic returned no text content block (Pitfall 8 — empty or non-text first block)',
      'Engine wrapper degrades to deterministic-template fallback via validateSummary empty branch.',
    );
  }
  return {
    text: textBlock.text,
    prompt_tokens: message.usage.input_tokens,
    completion_tokens: message.usage.output_tokens,
  };
}

/** Determine whether an error is eligible for the engine's single retry. */
function isTransient(err: unknown, sdk: AnthropicSdkModule): boolean {
  // APIConnectionError (includes APIConnectionTimeoutError subclass) — network
  if (err instanceof sdk.APIConnectionError) return true;
  // 429 RateLimitError — back off and try once more
  if (err instanceof sdk.RateLimitError) return true;
  // 5xx InternalServerError — transient server issue
  if (err instanceof sdk.InternalServerError) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip API key from any error string in 4 encodings.
 *
 * The fragment list is the shared apiKeyFragments helper from sanitizer.ts
 * (single source of truth for the 4-encoding scan; mirrors the precedent at
 * src/__tests__/c2pa-redaction-e2e.test.ts:76-92).
 *
 * The Anthropic SDK auto-redacts auth headers in error messages, but
 * historical 0.x versions have leaked partial keys via debug-mode message
 * strings. flattenAnthropicError is the defence-in-depth gate before any
 * error string reaches a log line or a cache row.
 */
export function flattenAnthropicError(err: unknown): string {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  let raw = err instanceof Error ? err.message : String(err);

  if (apiKey.length > 0) {
    for (const frag of apiKeyFragments(apiKey)) {
      if (frag.length === 0) continue;
      while (raw.includes(frag)) raw = raw.replaceAll(frag, '<REDACTED>');
    }
  }

  // Defence-in-depth: strip any sk-ant-... pattern even if env-var diverges.
  raw = raw.replace(/sk-ant-[A-Za-z0-9_-]{40,}/g, '<REDACTED>');
  return raw;
}
