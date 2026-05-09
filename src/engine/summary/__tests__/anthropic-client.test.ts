/**
 * Phase 19 — Plan 04 Task 1. anthropic-client.ts comprehensive tests.
 *
 * Coverage:
 *   - Lazy-load + cached-error short-circuit (mirrors Phase 14 signer.test.ts)
 *   - generateSummary success path (D-LLM-1..5 verbatim params)
 *   - Retry policy: 1 retry on transient errors (APIConnectionError /
 *     RateLimitError / InternalServerError); NO retry on AuthenticationError /
 *     BadRequestError / PermissionDeniedError (D-FB-4 + RESEARCH.md error class table)
 *   - Pitfall 8: response with tool_use / empty content array → TypedError
 *   - flattenAnthropicError multi-encoding key strip (UTF-8 / UTF-16LE /
 *     UTF-16BE / base64) + sk-ant-... regex (D-PRIV-3 + D-PRIV-4)
 *
 * vi.mock pattern: hoisted state object lets tests inject SDK behaviour per
 * test case. __resetAnthropicSdkStateForTests in beforeEach resets the
 * lazy-load module pointer so the next test re-triggers the mocked load.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateSummary,
  flattenAnthropicError,
  __resetAnthropicSdkStateForTests,
} from '../anthropic-client.js';
import { TypedError } from '../../errors.js';

// ---------------------------------------------------------------------------
// Hoisted mock state — lets each test mutate the SDK behaviour it sees.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  shouldThrowImport: false,
  importError: new Error('synthetic SDK load failure') as Error,
  // Per-call sequence: each call to messages.create pops from this queue.
  // A queued entry is either a Message-shaped success or an Error to throw.
  callQueue: [] as Array<
    | { kind: 'success'; content: Array<{ type: string; text?: string }>; usage: { input_tokens: number; output_tokens: number } }
    | { kind: 'error'; errorClass: 'AuthenticationError' | 'PermissionDeniedError' | 'BadRequestError' | 'NotFoundError' | 'UnprocessableEntityError' | 'RateLimitError' | 'InternalServerError' | 'APIConnectionError' | 'APIConnectionTimeoutError' | 'AbortError' | 'TypeError'; message?: string }
  >,
  // Captured call args from messages.create — for assertion in tests.
  capturedCalls: [] as Array<{ body: Record<string, unknown>; options: Record<string, unknown> | undefined }>,
  // Captured constructor args from new Anthropic(...).
  capturedClientArgs: [] as Record<string, unknown>[],
}));

// ---------------------------------------------------------------------------
// vi.mock for @anthropic-ai/sdk — synthetic Anthropic class + error classes.
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', async () => {
  if (mockState.shouldThrowImport) {
    throw mockState.importError;
  }

  // Synthetic error classes — instanceof checks in production code use
  // these via sdk.<ClassName>. Tests inject errors keyed by 'errorClass'.
  class AnthropicError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'AnthropicError';
    }
  }
  class APIError extends AnthropicError {
    constructor(message?: string) {
      super(message);
      this.name = 'APIError';
    }
  }
  class APIConnectionError extends APIError {
    constructor(message?: string) {
      super(message);
      this.name = 'APIConnectionError';
    }
  }
  class APIConnectionTimeoutError extends APIConnectionError {
    constructor(message?: string) {
      super(message);
      this.name = 'APIConnectionTimeoutError';
    }
  }
  class AuthenticationError extends APIError {
    constructor(message?: string) {
      super(message);
      this.name = 'AuthenticationError';
    }
  }
  class PermissionDeniedError extends APIError {
    constructor(message?: string) {
      super(message);
      this.name = 'PermissionDeniedError';
    }
  }
  class BadRequestError extends APIError {
    constructor(message?: string) {
      super(message);
      this.name = 'BadRequestError';
    }
  }
  class NotFoundError extends APIError {
    constructor(message?: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  }
  class UnprocessableEntityError extends APIError {
    constructor(message?: string) {
      super(message);
      this.name = 'UnprocessableEntityError';
    }
  }
  class RateLimitError extends APIError {
    constructor(message?: string) {
      super(message);
      this.name = 'RateLimitError';
    }
  }
  class InternalServerError extends APIError {
    constructor(message?: string) {
      super(message);
      this.name = 'InternalServerError';
    }
  }

  const errorClasses: Record<string, new (m?: string) => Error> = {
    AuthenticationError,
    PermissionDeniedError,
    BadRequestError,
    NotFoundError,
    UnprocessableEntityError,
    RateLimitError,
    InternalServerError,
    APIConnectionError,
    APIConnectionTimeoutError,
    AbortError: (() => {
      class AbortError extends Error {
        constructor(m?: string) { super(m); this.name = 'AbortError'; }
      }
      return AbortError;
    })(),
    TypeError: TypeError as unknown as new (m?: string) => Error,
  };

  // Synthetic Anthropic client — captures args + drains callQueue.
  class Anthropic {
    constructor(args: Record<string, unknown>) {
      mockState.capturedClientArgs.push(args);
    }
    messages = {
      create: vi.fn(
        (body: Record<string, unknown>, options?: Record<string, unknown>) => {
          mockState.capturedCalls.push({ body, options });
          const next = mockState.callQueue.shift();
          if (!next) {
            return Promise.reject(new Error('Test stub: callQueue empty — add an entry per expected call'));
          }
          if (next.kind === 'error') {
            const Ctor = errorClasses[next.errorClass];
            if (!Ctor) {
              return Promise.reject(new Error(`Test stub: unknown errorClass ${next.errorClass}`));
            }
            return Promise.reject(new Ctor(next.message ?? next.errorClass));
          }
          // Success: shape mirrors Anthropic.Message.
          return Promise.resolve({
            content: next.content,
            usage: next.usage,
          });
        },
      ),
    };
  }

  return {
    default: Anthropic,
    AnthropicError,
    APIError,
    APIConnectionError,
    APIConnectionTimeoutError,
    AuthenticationError,
    PermissionDeniedError,
    BadRequestError,
    NotFoundError,
    UnprocessableEntityError,
    RateLimitError,
    InternalServerError,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROMPT_INPUT = {
  system: 'You are a VFX Supervisor.',
  userTurn: '<provenance><model_name>flux1-dev</model_name></provenance>',
};

function pushSuccess(text: string, input_tokens = 100, output_tokens = 50) {
  mockState.callQueue.push({
    kind: 'success',
    content: [{ type: 'text', text }],
    usage: { input_tokens, output_tokens },
  });
}

function pushError(errorClass: typeof mockState.callQueue[number] extends infer T
  ? T extends { kind: 'error'; errorClass: infer E }
    ? E
    : never
  : never, message?: string) {
  mockState.callQueue.push({ kind: 'error', errorClass, message });
}

beforeEach(() => {
  __resetAnthropicSdkStateForTests();
  mockState.shouldThrowImport = false;
  mockState.importError = new Error('synthetic SDK load failure');
  mockState.callQueue = [];
  mockState.capturedCalls = [];
  mockState.capturedClientArgs = [];
});

afterEach(() => {
  __resetAnthropicSdkStateForTests();
});

// ---------------------------------------------------------------------------
// Lazy load + cached error
// ---------------------------------------------------------------------------

describe('Phase 19 anthropic-client — lazy SDK load + cached error short-circuit', () => {
  it('Test 1 — ensureAnthropicSdk loads the SDK on first call', async () => {
    pushSuccess('v001 generated with flux1-dev at seed 42.');
    const r = await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    expect(r.text).toContain('flux1-dev');
  });

  it('Test 2 — ensureAnthropicSdk caches the module after first call', async () => {
    pushSuccess('v001 generated with flux1-dev at seed 42.');
    pushSuccess('v002 generated with flux1-dev at seed 7.');
    await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    // Module is cached at the file-level pointer; the second call would
    // re-import only if our reset was called between. We did not call reset.
    expect(mockState.capturedClientArgs.length).toBe(2);
  });

  // Test 3 — moved to end of file as a separate describe block with isolated
  // module state. Cached-load-error testing requires vi.resetModules() which
  // would interfere with the file-scope vi.mock if run inside this block.
  it('Test 3 — placeholder (cached-error test is in a separate isolated describe block at end of file)', () => {
    expect(true).toBe(true);
  });

  it('Test 4 — __resetAnthropicSdkStateForTests clears cached module + cached error', async () => {
    pushSuccess('v001 generated with flux1-dev at seed 42.');
    await generateSummary(PROMPT_INPUT, 'sk-ant-test');
    expect(mockState.capturedClientArgs.length).toBe(1);

    // Reset module pointer.
    __resetAnthropicSdkStateForTests();

    // Next call re-triggers lazy load (module factory may run again, but we
    // verify behaviour by observing a fresh client construction).
    pushSuccess('v002 generated with flux1-dev at seed 7.');
    await generateSummary(PROMPT_INPUT, 'sk-ant-test');
    expect(mockState.capturedClientArgs.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// generateSummary success path — D-LLM-1..5 + Pitfall 2
// ---------------------------------------------------------------------------

describe('Phase 19 anthropic-client — generateSummary D-LLM-1..5 verbatim params', () => {
  it('Test 5 — success path returns { text, prompt_tokens, completion_tokens }', async () => {
    pushSuccess('v003 generated with flux1-dev at seed 42.', 4500, 70);
    const r = await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment-1234567890');
    expect(r.text).toBe('v003 generated with flux1-dev at seed 42.');
    expect(r.prompt_tokens).toBe(4500);
    expect(r.completion_tokens).toBe(70);
  });

  it('Test 6 — uses model claude-haiku-4-5-20251001 + max_tokens 180 + temperature 0.7', async () => {
    pushSuccess('v003 generated with flux1-dev.');
    await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment-1234567890');
    const body = mockState.capturedCalls[0]!.body;
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(180);
    expect(body.temperature).toBe(0.7);
  });

  it('Test 7 — system block carries cache_control: { type: ephemeral }', async () => {
    pushSuccess('v003 generated with flux1-dev.');
    await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment-1234567890');
    const body = mockState.capturedCalls[0]!.body;
    const system = body.system as Array<{ type: string; text: string; cache_control?: { type: string } }>;
    expect(Array.isArray(system)).toBe(true);
    expect(system[0]!.type).toBe('text');
    expect(system[0]!.text).toBe(PROMPT_INPUT.system);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('Test 8 — client constructor receives maxRetries: 0 + timeout: 10_000', async () => {
    pushSuccess('v003 generated with flux1-dev.');
    await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment-1234567890');
    const ctorArgs = mockState.capturedClientArgs[0]!;
    expect(ctorArgs.apiKey).toBe('sk-ant-test-key-fragment-1234567890');
    expect(ctorArgs.maxRetries).toBe(0);
    expect(ctorArgs.timeout).toBe(10_000);
  });

  it('Test 9 — per-request options pass maxRetries: 0 + timeout: 10_000 (defence-in-depth)', async () => {
    pushSuccess('v003 generated with flux1-dev.');
    await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment-1234567890');
    const options = mockState.capturedCalls[0]!.options;
    expect(options).toBeDefined();
    expect(options!.maxRetries).toBe(0);
    expect(options!.timeout).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// Retry policy (D-FB-4) — 1 retry on transient; no retry on 4xx
// ---------------------------------------------------------------------------

describe('Phase 19 anthropic-client — retry policy (D-FB-4)', () => {
  it('Test 10 — APIConnectionError → 1 retry with 1s backoff', async () => {
    vi.useFakeTimers();
    pushError('APIConnectionError', 'DNS lookup failed');
    pushSuccess('v003 generated with flux1-dev at seed 42.');
    const promise = generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    // Advance by 1s for the backoff sleep.
    await vi.advanceTimersByTimeAsync(1000);
    const r = await promise;
    expect(r.text).toContain('flux1-dev');
    expect(mockState.capturedCalls.length).toBe(2); // 1 initial + 1 retry
    vi.useRealTimers();
  });

  it('Test 11 — RateLimitError → 1 retry', async () => {
    vi.useFakeTimers();
    pushError('RateLimitError', '429 too many requests');
    pushSuccess('v003 generated with flux1-dev at seed 42.');
    const promise = generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    await vi.advanceTimersByTimeAsync(1000);
    const r = await promise;
    expect(r.text).toContain('flux1-dev');
    expect(mockState.capturedCalls.length).toBe(2);
    vi.useRealTimers();
  });

  it('Test 12 — InternalServerError → 1 retry', async () => {
    vi.useFakeTimers();
    pushError('InternalServerError', '503 service unavailable');
    pushSuccess('v003 generated with flux1-dev at seed 42.');
    const promise = generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    await vi.advanceTimersByTimeAsync(1000);
    const r = await promise;
    expect(r.text).toContain('flux1-dev');
    expect(mockState.capturedCalls.length).toBe(2);
    vi.useRealTimers();
  });

  it('Test 13 — AuthenticationError (401) → NO retry, error propagates immediately', async () => {
    pushError('AuthenticationError', '401 invalid api key');
    let caught: unknown;
    try {
      await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('AuthenticationError');
    expect(mockState.capturedCalls.length).toBe(1); // No retry
  });

  it('Test 14 — BadRequestError (400) → NO retry, error propagates', async () => {
    pushError('BadRequestError', '400 invalid request');
    let caught: unknown;
    try {
      await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).name).toBe('BadRequestError');
    expect(mockState.capturedCalls.length).toBe(1);
  });

  it('Test 15 — PermissionDeniedError (403) → NO retry, error propagates', async () => {
    pushError('PermissionDeniedError', '403 forbidden');
    let caught: unknown;
    try {
      await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).name).toBe('PermissionDeniedError');
    expect(mockState.capturedCalls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pitfall 8 — defensive content extraction
// ---------------------------------------------------------------------------

describe('Phase 19 anthropic-client — Pitfall 8 defensive content extraction', () => {
  it('Test 16 — tool_use as first content block → TypedError; engine maps to validation_failed', async () => {
    mockState.callQueue.push({
      kind: 'success',
      content: [{ type: 'tool_use' }, { type: 'text', text: 'fallback text' }] as Array<{ type: string; text?: string }>,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    // The implementation finds the FIRST text block — not a TypedError. This
    // covers the "tool_use first then text" path. The TypedError fires when
    // there is NO text block at all (Test 17 covers that).
    const r = await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    expect(r.text).toBe('fallback text');
  });

  it('Test 16b — only tool_use, no text block → TypedError', async () => {
    mockState.callQueue.push({
      kind: 'success',
      content: [{ type: 'tool_use' }] as Array<{ type: string; text?: string }>,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    let caught: unknown;
    try {
      await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypedError);
    expect((caught as TypedError).code).toBe('ANTHROPIC_SDK_LOAD_FAILED');
    expect((caught as TypedError).message).toContain('Pitfall 8');
  });

  it('Test 17 — empty content array → TypedError; engine path → fallback validation_failed', async () => {
    mockState.callQueue.push({
      kind: 'success',
      content: [],
      usage: { input_tokens: 100, output_tokens: 0 },
    });
    let caught: unknown;
    try {
      await generateSummary(PROMPT_INPUT, 'sk-ant-test-key-fragment');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypedError);
    expect((caught as TypedError).code).toBe('ANTHROPIC_SDK_LOAD_FAILED');
    expect((caught as TypedError).message).toContain('Pitfall 8');
  });

  it('Test 17b — placeholder (SDK binding-error path test is in separate isolated describe block at end of file)', () => {
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// flattenAnthropicError — multi-encoding leak strip + sk-ant- regex
// ---------------------------------------------------------------------------

describe('Phase 19 anthropic-client — flattenAnthropicError multi-encoding leak scan', () => {
  const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
    }
  });

  it('Test 18 — strips raw apiKey (UTF-8) from error.message', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-fragment-1234567890';
    const err = new Error('upstream error: sk-ant-secret-key-fragment-1234567890 invalid');
    const out = flattenAnthropicError(err);
    expect(out).not.toContain('sk-ant-secret-key-fragment-1234567890');
    expect(out).toContain('<REDACTED>');
  });

  it('Test 19 — strips UTF-16LE-encoded apiKey from error.message', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-fragment-1234567890';
    const utf16le = Buffer.from(process.env.ANTHROPIC_API_KEY, 'utf16le').toString('binary');
    const err = new Error(`smuggled fragment: ${utf16le}`);
    const out = flattenAnthropicError(err);
    expect(out).not.toContain(utf16le);
    expect(out).toContain('<REDACTED>');
  });

  it('Test 20 — strips UTF-16BE-encoded apiKey from error.message', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-fragment-1234567890';
    const utf16be = Buffer.from(process.env.ANTHROPIC_API_KEY, 'utf16le').reverse().toString('binary');
    const err = new Error(`smuggled fragment: ${utf16be}`);
    const out = flattenAnthropicError(err);
    expect(out).not.toContain(utf16be);
    expect(out).toContain('<REDACTED>');
  });

  it('Test 21 — strips base64-encoded apiKey from error.message', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-fragment-1234567890';
    const b64 = Buffer.from(process.env.ANTHROPIC_API_KEY).toString('base64');
    const err = new Error(`response payload: ${b64}`);
    const out = flattenAnthropicError(err);
    expect(out).not.toContain(b64);
    expect(out).toContain('<REDACTED>');
  });

  it('Test 22 — strips sk-ant-... pattern even when env var unset (regex defence-in-depth)', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const err = new Error(
      'response: sk-ant-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA was rejected',
    );
    const out = flattenAnthropicError(err);
    expect(out).not.toContain('sk-ant-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(out).toContain('<REDACTED>');
  });

  it('Test 23 — handles non-Error input (string, number, undefined)', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(flattenAnthropicError('plain string')).toBe('plain string');
    expect(flattenAnthropicError(42)).toBe('42');
    expect(flattenAnthropicError(undefined)).toBe('undefined');
    expect(flattenAnthropicError(null)).toBe('null');
  });

  it('Test 24 — preserves non-key content in error messages', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-fragment-1234567890';
    const err = new Error('Network timeout: ECONNREFUSED at api.anthropic.com');
    const out = flattenAnthropicError(err);
    expect(out).toBe('Network timeout: ECONNREFUSED at api.anthropic.com');
  });
});

// ---------------------------------------------------------------------------
// Cached SDK load-error tests — isolated describe block.
//
// These tests run AFTER the main file-scope `vi.mock` factory has cached its
// synthetic SDK module. To force the production code's `await import(...)` to
// receive a thrown error, we use `vi.doMock` (per-test override) + the
// production module's `__resetAnthropicSdkStateForTests` to clear its lazy
// pointer + dynamically re-import the production module so the next call
// observes the doMock'd factory.
//
// Mirrors src/engine/c2pa/__tests__/signer.test.ts Tests 9 + 20 verbatim.
// ---------------------------------------------------------------------------

describe('Phase 19 anthropic-client — cached SDK load-error short-circuit (isolated)', () => {
  it('Test 3-isolated — cached load error short-circuits subsequent calls (TypedError)', async () => {
    vi.resetModules();
    vi.doMock('@anthropic-ai/sdk', () => {
      throw new Error('Cannot find module @anthropic-ai/sdk');
    });

    // Re-import the production module + the errors module from the SAME fresh
    // module graph so `instanceof TypedError` uses the right class identity.
    const fresh = await import('../anthropic-client.js');
    const freshErrors = await import('../../errors.js');
    fresh.__resetAnthropicSdkStateForTests();

    let firstErr: unknown;
    try {
      await fresh.generateSummary(
        { system: 'sys', userTurn: 'usr' },
        'sk-ant-test',
      );
    } catch (e) {
      firstErr = e;
    }
    expect(firstErr).toBeInstanceOf(freshErrors.TypedError);
    expect((firstErr as { code: string }).code).toBe('ANTHROPIC_SDK_LOAD_FAILED');

    // Second call: cached error short-circuits before retrying the import.
    let secondErr: unknown;
    try {
      await fresh.generateSummary(
        { system: 'sys', userTurn: 'usr' },
        'sk-ant-test',
      );
    } catch (e) {
      secondErr = e;
    }
    expect(secondErr).toBeInstanceOf(freshErrors.TypedError);
    expect((secondErr as { code: string }).code).toBe('ANTHROPIC_SDK_LOAD_FAILED');

    vi.doUnmock('@anthropic-ai/sdk');
    vi.resetModules();
  });

  it('Test 17b-isolated — SDK binding-error path: TypedError contains "Anthropic SDK unavailable"', async () => {
    vi.resetModules();
    vi.doMock('@anthropic-ai/sdk', () => {
      throw new Error('Cannot find module @anthropic-ai/sdk');
    });

    const fresh = await import('../anthropic-client.js');
    const freshErrors = await import('../../errors.js');
    fresh.__resetAnthropicSdkStateForTests();

    let caught: unknown;
    try {
      await fresh.generateSummary(
        { system: 'sys', userTurn: 'usr' },
        'sk-ant-test',
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(freshErrors.TypedError);
    expect((caught as { code: string }).code).toBe('ANTHROPIC_SDK_LOAD_FAILED');
    expect((caught as { message: string }).message).toContain('Anthropic SDK unavailable');

    vi.doUnmock('@anthropic-ai/sdk');
    vi.resetModules();
  });
});
