/**
 * Phase 19 — Plan 04 Task 2. summarizeVersion engine facade tests.
 *
 * Coverage: all 8 SummaryOutcome variants (cache_hit / live / 7 fallback
 * reasons) + cache-write gate (D-VAL-2) + circuit breaker integration +
 * leak-scan defence-in-depth + BLOCKER #1 KSampler edge walk + parent label
 * resolution.
 *
 * vi.mock pattern: stub generateSummary/flattenAnthropicError on
 * '../anthropic-client.js' so we can assert the engine's discriminated outcome
 * mapping without instantiating the real Anthropic SDK. Repos are plain
 * object stubs that satisfy the SummarizeVersionDeps interface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  summarizeVersion,
  SUMMARY_TEMPLATE_VERSION,
  SUMMARY_MODEL_ID,
  type SummarizeVersionDeps,
  type SummaryOutcome,
} from '../index.js';
import { TypedError } from '../../errors.js';
import {
  __resetCircuitBreakerStateForTests,
  FAILURE_THRESHOLD,
} from '../circuit-breaker.js';
import type { ModelRef, SummaryGeneratedPayloadFields } from '../../../types/provenance.js';

// ---------------------------------------------------------------------------
// Mock state — controls generateSummary behaviour per test.
// ---------------------------------------------------------------------------

const generateSummaryMock = vi.hoisted(() =>
  vi.fn() as ReturnType<typeof vi.fn>,
);
const flattenAnthropicErrorMock = vi.hoisted(() => vi.fn((e: unknown) => String(e)));

vi.mock('../anthropic-client.js', () => ({
  generateSummary: generateSummaryMock,
  flattenAnthropicError: flattenAnthropicErrorMock,
  __resetAnthropicSdkStateForTests: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Synthetic Anthropic-SDK error classes — for mapErrToReason coverage.
// constructor.name is the string discriminator the engine uses.
// ---------------------------------------------------------------------------

class AuthenticationError extends Error {
  constructor(m?: string) {
    super(m);
    this.name = 'AuthenticationError';
  }
}
class APIConnectionError extends Error {
  constructor(m?: string) {
    super(m);
    this.name = 'APIConnectionError';
  }
}
class APIConnectionTimeoutError extends Error {
  constructor(m?: string) {
    super(m);
    this.name = 'APIConnectionTimeoutError';
  }
}
class InternalServerError extends Error {
  constructor(m?: string) {
    super(m);
    this.name = 'InternalServerError';
  }
}
class RateLimitError extends Error {
  constructor(m?: string) {
    super(m);
    this.name = 'RateLimitError';
  }
}

// ---------------------------------------------------------------------------
// Repo stubs + dep builder
// ---------------------------------------------------------------------------

interface RepoStubArgs {
  versionMap?: Record<string, { id: string; version_number: number; parent_version_id?: string | null }>;
  events?: Array<{
    event_type: string;
    prompt_json?: string | null;
    seed?: number | null;
    models_json?: string | null;
    outputs_json?: string | null;
  }>;
  fingerprints?: ModelRef[] | null;
  manifestSigned?: { manifest_sha256?: string; redacted?: boolean } | null;
  cachedSummary?: SummaryGeneratedPayloadFields | null;
  apiKey?: string | null;
  clockNow?: number;
}

interface DepsHandle {
  deps: SummarizeVersionDeps;
  appendCalls: SummaryGeneratedPayloadFields[];
  versionLookups: string[];
}

function buildDeps(args: RepoStubArgs = {}): DepsHandle {
  const versionMap = args.versionMap ?? {
    ver_1: { id: 'ver_1', version_number: 3, parent_version_id: null },
  };
  const events = args.events ?? [
    {
      event_type: 'completed',
      prompt_json: null,
      seed: 42,
      models_json: '[]',
      outputs_json: JSON.stringify([{ filename: 'output.png' }]),
    },
  ];
  const fingerprints: ModelRef[] | null =
    args.fingerprints === undefined
      ? [
          {
            node_id: 'n1',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'flux1-dev',
            model_hash: 'abc',
            model_hash_unavailable: null,
          },
        ]
      : args.fingerprints;
  const manifestSigned =
    args.manifestSigned === undefined
      ? { manifest_sha256: 'mfh_001', redacted: false }
      : args.manifestSigned;
  const cachedSummary = args.cachedSummary ?? null;

  const appendCalls: SummaryGeneratedPayloadFields[] = [];
  const versionLookups: string[] = [];

  const deps: SummarizeVersionDeps = {
    versionRepo: {
      getVersion: (id: string) => {
        versionLookups.push(id);
        return versionMap[id] ?? null;
      },
    },
    provenanceRepo: {
      getEventsForVersion: () => events,
      getLatestFingerprints: () => fingerprints,
      getLatestManifestSignedEvent: () => manifestSigned,
      getLatestSummaryGeneratedEvent: () => cachedSummary,
      appendSummaryGeneratedEvent: (_id, payload) => {
        appendCalls.push(payload);
      },
    },
    anthropicConfig: args.apiKey === null ? null : { apiKey: args.apiKey ?? 'sk-ant-test-key-fragment' },
    clock: () => args.clockNow ?? 1000,
  };

  return { deps, appendCalls, versionLookups };
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  generateSummaryMock.mockReset();
  flattenAnthropicErrorMock.mockReset();
  flattenAnthropicErrorMock.mockImplementation((e: unknown) => String(e));
  __resetCircuitBreakerStateForTests();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 19 summarizeVersion — cache_hit + live outcomes', () => {
  it('Test 1 — cache_hit: cached row returns directly, no SDK call', async () => {
    const { deps, appendCalls } = buildDeps({
      cachedSummary: {
        manifest_sha256: 'mfh_001',
        template_version: SUMMARY_TEMPLATE_VERSION,
        model_id: SUMMARY_MODEL_ID,
        summary_text: 'v003 generated with flux1-dev at seed 42.',
        generated_at: '2026-05-09T12:00:00.000Z',
        prompt_tokens: 4500,
        completion_tokens: 70,
        outcome: 'live',
      },
    });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('cache_hit');
    if (r.source === 'cache_hit') {
      expect(r.text).toBe('v003 generated with flux1-dev at seed 42.');
      expect(r.template_version).toBe(SUMMARY_TEMPLATE_VERSION);
      expect(r.model_id).toBe(SUMMARY_MODEL_ID);
    }
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(appendCalls.length).toBe(0); // Cache_hit does NOT re-append.
  });

  it('Test 2 — live + cache write: validation passes → live outcome + append', async () => {
    generateSummaryMock.mockResolvedValueOnce({
      text: 'v003 generated with flux1-dev at seed 42.',
      prompt_tokens: 4500,
      completion_tokens: 70,
    });
    const { deps, appendCalls } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('live');
    if (r.source === 'live') {
      expect(r.text).toContain('flux1-dev');
      expect(r.prompt_tokens).toBe(4500);
      expect(r.completion_tokens).toBe(70);
    }
    expect(generateSummaryMock).toHaveBeenCalledTimes(1);
    expect(appendCalls.length).toBe(1);
    expect(appendCalls[0]!.outcome).toBe('live');
    expect(appendCalls[0]!.summary_text).toBe('v003 generated with flux1-dev at seed 42.');
    expect(appendCalls[0]!.manifest_sha256).toBe('mfh_001');
  });
});

describe('Phase 19 summarizeVersion — fallback variants', () => {
  it('Test 3 — fallback api_key_missing: anthropicConfig=null → no SDK call', async () => {
    const { deps, appendCalls } = buildDeps({ apiKey: null });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('api_key_missing');
      expect(r.text).toContain('flux1-dev'); // Deterministic-template uses model
      expect(r.text).toContain('v003');
    }
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(appendCalls.length).toBe(0);
  });

  it('Test 4 — fallback circuit_open: breaker tripped → no SDK call', async () => {
    // Trip the breaker by recording FAILURE_THRESHOLD failures.
    const { circuitBreaker } = await import('../circuit-breaker.js');
    const fakeClock = () => 1000;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      circuitBreaker.recordFailure(fakeClock);
    }
    expect(circuitBreaker.canRequest(fakeClock)).toBe(false);

    const { deps, appendCalls } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('circuit_open');
    }
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(appendCalls.length).toBe(0);
  });

  it('Test 5 — fallback sdk_load_failed: TypedError(ANTHROPIC_SDK_LOAD_FAILED) routes to sdk_load_failed', async () => {
    generateSummaryMock.mockRejectedValueOnce(
      new TypedError('ANTHROPIC_SDK_LOAD_FAILED', 'Anthropic SDK unavailable: load fail'),
    );
    const { deps, appendCalls } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('sdk_load_failed');
    }
    expect(appendCalls.length).toBe(0);
  });

  it('Test 5b — fallback validation_failed: TypedError with Pitfall 8 message routes to validation_failed', async () => {
    // anthropic-client.ts throws TypedError(ANTHROPIC_SDK_LOAD_FAILED) for both
    // SDK binding-load AND empty-content responses (Pitfall 8). The engine
    // disambiguates via err.message containing 'Pitfall 8'.
    generateSummaryMock.mockRejectedValueOnce(
      new TypedError(
        'ANTHROPIC_SDK_LOAD_FAILED',
        'Anthropic returned no text content block (Pitfall 8 — empty or non-text first block)',
      ),
    );
    const { deps, appendCalls } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('validation_failed');
    }
    expect(appendCalls.length).toBe(0);
  });

  it('Test 6 — fallback network_error: APIConnectionError → network_error', async () => {
    generateSummaryMock.mockRejectedValueOnce(new APIConnectionError('DNS lookup failed'));
    const { deps } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('network_error');
    }
  });

  it('Test 7 — fallback timeout: APIConnectionTimeoutError → timeout', async () => {
    generateSummaryMock.mockRejectedValueOnce(new APIConnectionTimeoutError('10s exceeded'));
    const { deps } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('timeout');
    }
  });

  it('Test 8 — fallback api_key_missing (401): AuthenticationError → api_key_missing', async () => {
    generateSummaryMock.mockRejectedValueOnce(new AuthenticationError('401 invalid key'));
    const { deps } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('api_key_missing');
    }
  });

  it('Test 9 — fallback http_error (5xx): InternalServerError → http_error', async () => {
    generateSummaryMock.mockRejectedValueOnce(new InternalServerError('503 unavailable'));
    const { deps } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('http_error');
    }
  });

  it('Test 9b — fallback http_error (429): RateLimitError → http_error', async () => {
    generateSummaryMock.mockRejectedValueOnce(new RateLimitError('429 too many'));
    const { deps } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('http_error');
    }
  });

  it('Test 10 — fallback validation_failed: missing model name in summary → no cache write', async () => {
    generateSummaryMock.mockResolvedValueOnce({
      text: 'A nice picture without any verbatim model name reference.',
      prompt_tokens: 4500,
      completion_tokens: 50,
    });
    const { deps, appendCalls } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('validation_failed');
    }
    expect(appendCalls.length).toBe(0); // D-VAL-2 cache-write gate
  });

  it('Test 11 — fallback validation_failed (redacted): LLM omits redaction marker → no cache write', async () => {
    generateSummaryMock.mockResolvedValueOnce({
      text: 'v003 generated with flux1-dev at seed 42.', // No marker!
      prompt_tokens: 4500,
      completion_tokens: 50,
    });
    const { deps, appendCalls } = buildDeps({
      manifestSigned: { manifest_sha256: 'mfh_002', redacted: true },
    });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('validation_failed');
    }
    expect(appendCalls.length).toBe(0);
  });
});

describe('Phase 19 summarizeVersion — cache-write gate (D-VAL-2)', () => {
  it('Test 12 — every fallback variant produces zero appendSummaryGeneratedEvent calls', async () => {
    // Cycle through the 7 fallback paths — no cache row written on any.
    const setups = [
      { rejectWith: new AuthenticationError('401') },
      { rejectWith: new APIConnectionError('DNS') },
      { rejectWith: new APIConnectionTimeoutError('timeout') },
      { rejectWith: new InternalServerError('503') },
      { rejectWith: new TypedError('ANTHROPIC_SDK_LOAD_FAILED', 'binding') },
      {
        rejectWith: new TypedError(
          'ANTHROPIC_SDK_LOAD_FAILED',
          'Anthropic returned no text content block (Pitfall 8)',
        ),
      },
    ];
    for (const setup of setups) {
      generateSummaryMock.mockReset();
      __resetCircuitBreakerStateForTests();
      generateSummaryMock.mockRejectedValueOnce(setup.rejectWith);
      const { deps, appendCalls } = buildDeps();
      const r = await summarizeVersion('ver_1', deps);
      expect(r.source).toBe('fallback');
      expect(appendCalls.length).toBe(0);
    }
  });
});

describe('Phase 19 summarizeVersion — regenerate=true', () => {
  it('Test 13 — regenerate=true skips cache lookup even when cached row exists', async () => {
    generateSummaryMock.mockResolvedValueOnce({
      text: 'v003 generated with flux1-dev at seed 99.',
      prompt_tokens: 4500,
      completion_tokens: 70,
    });
    const { deps, appendCalls } = buildDeps({
      cachedSummary: {
        manifest_sha256: 'mfh_001',
        template_version: SUMMARY_TEMPLATE_VERSION,
        model_id: SUMMARY_MODEL_ID,
        summary_text: 'OLD CACHED SUMMARY',
        generated_at: '2026-05-08T00:00:00.000Z',
        prompt_tokens: 1000,
        completion_tokens: 30,
        outcome: 'live',
      },
    });
    const r = await summarizeVersion('ver_1', deps, { regenerate: true });
    expect(r.source).toBe('live'); // NOT cache_hit
    if (r.source === 'live') {
      expect(r.text).toContain('seed 99');
    }
    expect(generateSummaryMock).toHaveBeenCalledTimes(1);
    expect(appendCalls.length).toBe(1);
  });
});

describe('Phase 19 summarizeVersion — circuit breaker integration', () => {
  it('Test 14 — recordSuccess fires on live success (clears prior failures)', async () => {
    const { circuitBreaker } = await import('../circuit-breaker.js');
    __resetCircuitBreakerStateForTests();
    const fakeClock = () => 1000;
    // Pre-load a few failures (below threshold).
    circuitBreaker.recordFailure(fakeClock);
    circuitBreaker.recordFailure(fakeClock);

    generateSummaryMock.mockResolvedValueOnce({
      text: 'v003 generated with flux1-dev at seed 42.',
      prompt_tokens: 4500,
      completion_tokens: 70,
    });
    const { deps } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('live');
    // After success, breaker is CLOSED + counter reset.
    expect(circuitBreaker.canRequest(fakeClock)).toBe(true);
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
  });

  it('Test 15 — recordFailure fires on every Anthropic error path', async () => {
    const { circuitBreaker } = await import('../circuit-breaker.js');
    __resetCircuitBreakerStateForTests();

    // 5 consecutive failures should trip the breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      generateSummaryMock.mockRejectedValueOnce(new APIConnectionError('flaky'));
      const { deps } = buildDeps();
      const r = await summarizeVersion('ver_1', deps);
      expect(r.source).toBe('fallback');
      if (r.source === 'fallback') {
        expect(r.reason).toBe('network_error');
      }
    }
    expect(circuitBreaker.__peekState()).toBe('OPEN');
  });
});

describe('Phase 19 summarizeVersion — manifest_sha256 unavailable', () => {
  it('Test 16 — no signed event → live path runs, returns live, NO cache write', async () => {
    generateSummaryMock.mockResolvedValueOnce({
      text: 'v003 generated with flux1-dev at seed 42.',
      prompt_tokens: 4500,
      completion_tokens: 70,
    });
    const { deps, appendCalls } = buildDeps({ manifestSigned: null });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('live');
    if (r.source === 'live') {
      expect(r.text).toContain('flux1-dev');
    }
    expect(appendCalls.length).toBe(0); // No manifest_sha256 → cannot write cache key
  });
});

describe('Phase 19 summarizeVersion — error surface', () => {
  it('Test 17 — throws TypedError(VERSION_NOT_FOUND) when version doesn\'t exist', async () => {
    const { deps } = buildDeps({ versionMap: {} });
    let caught: unknown;
    try {
      await summarizeVersion('ver_missing', deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypedError);
    expect((caught as TypedError).code).toBe('VERSION_NOT_FOUND');
  });
});

describe('Phase 19 summarizeVersion — leak-scan defence-in-depth', () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  it('Test 18 — assertNoApiKeyInPayload failure → fallback validation_failed (defence-in-depth)', async () => {
    // Smuggle the API key into the user prompt content via the prompt blob.
    // The sanitizer's leak-scan should catch the verbatim key in
    // prompt_positive (D-PRIV-3 + T-19-13b mitigation).
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-fragment-1234567890';
    const promptBlob = {
      '1': {
        class_type: 'KSampler',
        inputs: { positive: ['2', 0], negative: ['3', 0], seed: 42 },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'beautiful scene with sk-ant-secret-key-fragment-1234567890 hidden inside' },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'blurry' },
      },
    };
    const { deps, appendCalls } = buildDeps({
      events: [
        {
          event_type: 'completed',
          prompt_json: JSON.stringify(promptBlob),
          seed: 42,
          models_json: '[]',
          outputs_json: JSON.stringify([{ filename: 'out.png' }]),
        },
      ],
    });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.reason).toBe('validation_failed');
    }
    expect(generateSummaryMock).not.toHaveBeenCalled(); // SDK never called
    expect(appendCalls.length).toBe(0); // No cache write
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it('Test 19 — flattenAnthropicError used on the leak-scan failure log line', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-fragment-1234567890';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const promptBlob = {
      '1': {
        class_type: 'KSampler',
        inputs: { positive: ['2', 0], negative: ['3', 0], seed: 42 },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'sk-ant-secret-key-fragment-1234567890' },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'blurry' },
      },
    };
    const { deps } = buildDeps({
      events: [
        {
          event_type: 'completed',
          prompt_json: JSON.stringify(promptBlob),
          seed: 42,
          models_json: '[]',
          outputs_json: JSON.stringify([{ filename: 'out.png' }]),
        },
      ],
    });
    await summarizeVersion('ver_1', deps);
    // flattenAnthropicError mock was called at least once during the failure path.
    expect(flattenAnthropicErrorMock).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('sanitization leak-scan FAILED'),
      expect.anything(),
    );
    consoleErrorSpy.mockRestore();
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });
});

describe('Phase 19 summarizeVersion — BLOCKER #1 KSampler edge walk + parent label', () => {
  it('Test 20 — extractInputAssertion is invoked: prompt_positive flows through sanitizer', async () => {
    let capturedSystemBlock = '';
    generateSummaryMock.mockImplementationOnce(async (promptInput: { system: string; userTurn: string }) => {
      capturedSystemBlock = promptInput.userTurn;
      return {
        text: 'v003 generated with flux1-dev at seed 42.',
        prompt_tokens: 4500,
        completion_tokens: 70,
      };
    });
    const promptBlob = {
      '1': {
        class_type: 'KSampler',
        inputs: { positive: ['2', 0], negative: ['3', 0], seed: 42 },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'a tighter close-up of the dragon eye' },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'blurry, low quality' },
      },
    };
    const { deps } = buildDeps({
      events: [
        {
          event_type: 'completed',
          prompt_json: JSON.stringify(promptBlob),
          seed: 42,
          models_json: '[]',
          outputs_json: JSON.stringify([{ filename: 'out.png' }]),
        },
      ],
    });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('live');
    expect(capturedSystemBlock).toContain('a tighter close-up of the dragon eye');
    expect(capturedSystemBlock).toContain('blurry, low quality');
  });

  it('Test 21 — parent_version_id resolves to v002 label format', async () => {
    let capturedUserTurn = '';
    generateSummaryMock.mockImplementationOnce(
      async (promptInput: { system: string; userTurn: string }) => {
        capturedUserTurn = promptInput.userTurn;
        return {
          text: 'v003 generated with flux1-dev at seed 42.',
          prompt_tokens: 4500,
          completion_tokens: 70,
        };
      },
    );
    const { deps, versionLookups } = buildDeps({
      versionMap: {
        ver_1: { id: 'ver_1', version_number: 3, parent_version_id: 'ver_parent' },
        ver_parent: { id: 'ver_parent', version_number: 2, parent_version_id: null },
      },
    });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('live');
    expect(capturedUserTurn).toContain('<parent_version_label>v002</parent_version_label>');
    // Verify versionRepo.getVersion was called for both the version + parent.
    expect(versionLookups).toContain('ver_1');
    expect(versionLookups).toContain('ver_parent');
  });

  it('Test 22 — root version (parent_version_id=null) → parent label is "none" in user turn', async () => {
    let capturedUserTurn = '';
    generateSummaryMock.mockImplementationOnce(
      async (promptInput: { system: string; userTurn: string }) => {
        capturedUserTurn = promptInput.userTurn;
        return {
          text: 'v003 generated with flux1-dev at seed 42.',
          prompt_tokens: 4500,
          completion_tokens: 70,
        };
      },
    );
    const { deps } = buildDeps();
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('live');
    expect(capturedUserTurn).toContain('<parent_version_label>none</parent_version_label>');
  });
});

describe('Phase 19 summarizeVersion — fallback text content (deterministic-template)', () => {
  it('Test 23 — every fallback outcome carries non-empty deterministic-template text', async () => {
    const { deps } = buildDeps({ apiKey: null });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.text).toContain('v003');
    }
  });

  it('Test 24 — fallback (redacted) text carries the redaction marker', async () => {
    const { deps } = buildDeps({
      apiKey: null,
      manifestSigned: { manifest_sha256: 'mfh_red', redacted: true },
    });
    const r = await summarizeVersion('ver_1', deps);
    expect(r.source).toBe('fallback');
    if (r.source === 'fallback') {
      expect(r.text.toLowerCase()).toContain('redacted'); // D-VAL-3 round-trip
    }
  });
});

// ---------------------------------------------------------------------------
// Type-level smoke check — verify the SummaryOutcome union is structurally
// what consumers expect (Plan 05 HTTP route reads `source` discriminator).
// ---------------------------------------------------------------------------

describe('Phase 19 summarizeVersion — discriminated union shape', () => {
  it('SummaryOutcome union includes all 3 source values + 7 fallback reasons', () => {
    // Compile-time enumeration check via type guards.
    const variants: SummaryOutcome[] = [
      {
        source: 'cache_hit',
        text: '',
        generated_at: '',
        template_version: '',
        model_id: '',
      },
      {
        source: 'live',
        text: '',
        generated_at: '',
        template_version: '',
        model_id: '',
        prompt_tokens: 0,
        completion_tokens: 0,
      },
      { source: 'fallback', text: '', reason: 'api_key_missing' },
      { source: 'fallback', text: '', reason: 'circuit_open' },
      { source: 'fallback', text: '', reason: 'sdk_load_failed' },
      { source: 'fallback', text: '', reason: 'http_error' },
      { source: 'fallback', text: '', reason: 'network_error' },
      { source: 'fallback', text: '', reason: 'validation_failed' },
      { source: 'fallback', text: '', reason: 'timeout' },
    ];
    expect(variants.length).toBe(9);
  });
});
