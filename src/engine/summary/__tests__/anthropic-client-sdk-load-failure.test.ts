/**
 * Phase 19 — anthropic-client SDK load-failure paths.
 *
 * These two tests live in their OWN file, deliberately.
 *
 * They need the production module's lazy `await import('@anthropic-ai/sdk')`
 * (anthropic-client.ts) to REJECT, which means registering a throwing mock via
 * `vi.doMock` and re-importing the module from a fresh graph. In the sibling
 * `anthropic-client.test.ts` that is impossible to do safely: that file's
 * hoisted `vi.mock` factory is evaluated once and cached, so the only way to
 * swap it per-test is `vi.doMock` + `vi.doUnmock` — and `vi.doUnmock`
 * deregisters the file-level mock for the REST OF THE RUN. Because the SDK is
 * imported lazily at call time, every test that ran after such an unmock
 * resolved the REAL SDK and fired live HTTPS requests at api.anthropic.com
 * from a unit suite (invisible under the default order, where the block ran
 * last; reproducible under `--sequence.shuffle.tests`).
 *
 * Vitest gives each test FILE its own module + mock registry, so keeping these
 * here contains the registry surgery completely. Nothing in this file ever
 * wants the real SDK, and no `vi.doUnmock` is needed at all.
 *
 * Mirrors src/engine/c2pa/__tests__/signer.test.ts Tests 9 + 20.
 */

import { describe, it, expect, vi } from 'vitest';

const SDK_LOAD_ERROR = 'Cannot find module @anthropic-ai/sdk';

/**
 * STRUCTURAL FLOOR: the real SDK is unreachable from this file even if a future
 * test forgets the per-test helper below. @anthropic-ai/sdk is installed, so
 * without this a test that imported ../anthropic-client.js and called
 * generateSummary directly would issue a live HTTPS request to
 * api.anthropic.com — the exact incident this file was split out to contain.
 * Nothing here ever wants the real SDK, so failing the import is the default.
 */
vi.mock('@anthropic-ai/sdk', () => {
  throw new Error(SDK_LOAD_ERROR);
});

/**
 * Register a throwing SDK factory and re-import the production module from a
 * fresh graph, so `instanceof TypedError` uses the same class identity as the
 * errors module returned alongside it.
 */
async function freshClientWithFailingSdk(): Promise<{
  client: typeof import('../anthropic-client.js');
  errors: typeof import('../../errors.js');
}> {
  vi.resetModules();
  vi.doMock('@anthropic-ai/sdk', () => {
    throw new Error(SDK_LOAD_ERROR);
  });
  const client = await import('../anthropic-client.js');
  const errors = await import('../../errors.js');
  client.__resetAnthropicSdkStateForTests();
  return { client, errors };
}

describe('Phase 19 anthropic-client — cached SDK load-error short-circuit (isolated)', () => {
  it('Test 3-isolated — cached load error short-circuits subsequent calls (TypedError)', async () => {
    const { client, errors } = await freshClientWithFailingSdk();

    let firstErr: unknown;
    try {
      await client.generateSummary({ system: 'sys', userTurn: 'usr' }, 'sk-ant-test');
    } catch (e) {
      firstErr = e;
    }
    expect(firstErr).toBeInstanceOf(errors.TypedError);
    expect((firstErr as { code: string }).code).toBe('ANTHROPIC_SDK_LOAD_FAILED');

    // Second call: cached error short-circuits before retrying the import.
    let secondErr: unknown;
    try {
      await client.generateSummary({ system: 'sys', userTurn: 'usr' }, 'sk-ant-test');
    } catch (e) {
      secondErr = e;
    }
    expect(secondErr).toBeInstanceOf(errors.TypedError);
    expect((secondErr as { code: string }).code).toBe('ANTHROPIC_SDK_LOAD_FAILED');
  });

  it('Test 17b-isolated — SDK binding-error path: TypedError contains "Anthropic SDK unavailable"', async () => {
    const { client, errors } = await freshClientWithFailingSdk();

    let caught: unknown;
    try {
      await client.generateSummary({ system: 'sys', userTurn: 'usr' }, 'sk-ant-test');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(errors.TypedError);
    expect((caught as { code: string }).code).toBe('ANTHROPIC_SDK_LOAD_FAILED');
    expect((caught as { message: string }).message).toContain('Anthropic SDK unavailable');
  });
});
