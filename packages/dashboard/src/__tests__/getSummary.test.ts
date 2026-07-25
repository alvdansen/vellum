/**
 * Phase 19 Plan 19-05 Task 2 — getSummary + regenerateSummary helper tests.
 *
 * Mirrors the Phase 14 getC2paStatus.test.ts shape: stub global fetch,
 * import helpers AFTER stubbing, assert defensive error-collapse contract
 * (NEVER throws — collapses every error path to { state: 'error' }).
 *
 * Test coverage matrix (15 tests):
 *  1.  getSummary success — cache_hit envelope → state='success', source='cache_hit'
 *  2.  getSummary success — live envelope → state='success', source='live'
 *  3.  getSummary fallback — engine returned fallback → state='fallback', reason populated
 *  4.  getSummary 4xx → state='error', message='HTTP 4xx'
 *  5.  getSummary 5xx → state='error', message='HTTP 5xx'
 *  6.  getSummary network error (fetch throws) → state='error'
 *  7.  getSummary malformed JSON (json() throws) → state='error'
 *  8.  getSummary unexpected source value → state='error', message='unexpected source'
 *  9.  getSummary missing regenerate_available_at_ms → regenerateAvailableAtMs=null
 *  10. regenerateSummary success → state='success' with regenerateAvailableAtMs > 0
 *  11. regenerateSummary 429 throttle → state='error', message='HTTP 429'
 *  12. regenerateSummary network error → state='error'
 *  13. encodeURIComponent on versionId — versionId with special chars
 *  14. regenerateSummary uses POST method
 *  15. NEVER throws (smoke test): every covered path returns rather than throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import AFTER stubbing — Plan 19-05 adds getSummary + regenerateSummary to lib/api.ts.
import { getSummary, regenerateSummary } from '../lib/api.js';

describe('Phase 19 Plan 19-05 — getSummary + regenerateSummary helpers', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ==========================================================================
  // getSummary
  // ==========================================================================

  describe('getSummary', () => {
    it("Test 1: cache_hit envelope → state='success', source='cache_hit'", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: 'cache_hit',
            text: 'v003 generated with flux1-dev at seed 42.',
            generated_at: '2026-05-09T11:30:00.000Z',
            template_version: '1.0.0',
            model_id: 'claude-haiku-4-5-20251001',
            regenerate_available_at_ms: 1746792060000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const result = await getSummary('ver_abc');
      expect(result).toEqual({
        state: 'success',
        text: 'v003 generated with flux1-dev at seed 42.',
        source: 'cache_hit',
        generated_at: '2026-05-09T11:30:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        regenerateAvailableAtMs: 1746792060000,
      });
    });

    it("Test 2: live envelope → state='success', source='live'", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: 'live',
            text: 'fresh summary',
            generated_at: '2026-05-09T12:00:00.000Z',
            template_version: '1.0.0',
            model_id: 'claude-haiku-4-5-20251001',
            prompt_tokens: 4500,
            completion_tokens: 80,
            regenerate_available_at_ms: 1746792120000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const result = await getSummary('ver_def');
      expect(result.state).toBe('success');
      if (result.state === 'success') {
        expect(result.source).toBe('live');
        expect(result.generated_at).toBe('2026-05-09T12:00:00.000Z');
        expect(result.regenerateAvailableAtMs).toBe(1746792120000);
      }
    });

    it("Test 3: fallback envelope → state='fallback', reason populated", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: 'fallback',
            reason: 'api_key_missing',
            text: 'AI summary unavailable; showing structured details.',
            regenerate_available_at_ms: 60000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const result = await getSummary('ver_xyz');
      expect(result).toEqual({
        state: 'fallback',
        source: 'fallback',
        text: 'AI summary unavailable; showing structured details.',
        reason: 'api_key_missing',
        regenerateAvailableAtMs: 60000,
      });
    });

    it("Test 4: 4xx response → state='error', message='HTTP 404'", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 404 }),
      );
      const result = await getSummary('ver_404');
      expect(result).toEqual({ state: 'error', message: 'HTTP 404' });
    });

    it("Test 5: 5xx response → state='error', message='HTTP 500'", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Error', { status: 500 }),
      );
      const result = await getSummary('ver_500');
      expect(result).toEqual({ state: 'error', message: 'HTTP 500' });
    });

    it("Test 6: network error (fetch rejects) → state='error', message=err.message", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await getSummary('ver_net');
      expect(result.state).toBe('error');
      if (result.state === 'error') {
        expect(result.message).toBe('Failed to fetch');
      }
    });

    it("Test 7: malformed JSON (json() throws) → state='error'", async () => {
      // Construct a Response with body that fails to parse as JSON.
      mockFetch.mockResolvedValueOnce(
        new Response('not-json-{', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const result = await getSummary('ver_malformed');
      expect(result.state).toBe('error');
    });

    it("Test 8: unexpected source value → state='error', message='unexpected source'", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: 'rogue_source_value',
            text: 'whatever',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const result = await getSummary('ver_rogue');
      expect(result).toEqual({
        state: 'error',
        message: 'unexpected source',
      });
    });

    it('Test 9: missing regenerate_available_at_ms → regenerateAvailableAtMs=null', async () => {
      // Defence in depth: server contract guarantees the field but we tolerate
      // a malformed envelope without crashing the dashboard.
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: 'cache_hit',
            text: 'no regen field',
            generated_at: '2026-05-09T11:30:00.000Z',
            template_version: '1.0.0',
            model_id: 'claude-haiku-4-5-20251001',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const result = await getSummary('ver_no_regen');
      expect(result.state).toBe('success');
      if (result.state === 'success') {
        expect(result.regenerateAvailableAtMs).toBeNull();
      }
    });

    it("Test 13: encodes versionId for URL safety", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 200 }),
      );
      await getSummary('ver/with slash');
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toMatch(/ver%2Fwith%20slash/);
    });
  });

  // ==========================================================================
  // regenerateSummary
  // ==========================================================================

  describe('regenerateSummary', () => {
    it('Test 14: uses POST method', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: 'live',
            text: 't',
            generated_at: '2026-05-09T12:00:00.000Z',
            template_version: '1.0.0',
            model_id: 'claude-haiku-4-5-20251001',
            regenerate_available_at_ms: 1746792120000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      await regenerateSummary('ver_post');
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(
        /\/api\/versions\/ver_post\/summary\/regenerate$/,
      );
      expect(init?.method).toBe('POST');
    });

    it("Test 10: success envelope → state='success' with regenerateAvailableAtMs populated", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: 'live',
            text: 'fresh!',
            generated_at: '2026-05-09T12:00:00.000Z',
            template_version: '1.0.0',
            model_id: 'claude-haiku-4-5-20251001',
            regenerate_available_at_ms: 1746792120000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const result = await regenerateSummary('ver_regen_ok');
      expect(result.state).toBe('success');
      if (result.state === 'success') {
        expect(result.regenerateAvailableAtMs).toBe(1746792120000);
      }
    });

    it("Test 11: 429 throttle → state='error', message='HTTP 429'", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'SUMMARY_THROTTLED',
              message: 'Regenerate throttled — try again in 30s',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const result = await regenerateSummary('ver_429');
      expect(result).toEqual({ state: 'error', message: 'HTTP 429' });
    });

    it("Test 12: network error → state='error', message=err.message", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await regenerateSummary('ver_regen_net');
      expect(result.state).toBe('error');
      if (result.state === 'error') {
        expect(result.message).toBe('Failed to fetch');
      }
    });
  });

  // ==========================================================================
  // Defence-in-depth contract
  // ==========================================================================

  describe('NEVER throws', () => {
    it('Test 15: every error surface returns rather than throws', async () => {
      // Cycle through 5 error scenarios and assert no rejection on any of them.
      const scenarios: Array<() => void> = [
        () => mockFetch.mockRejectedValueOnce(new Error('boom')),
        () =>
          mockFetch.mockResolvedValueOnce(
            new Response('', { status: 502 }),
          ),
        () =>
          mockFetch.mockResolvedValueOnce(
            new Response('not-json', {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        () =>
          mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ source: 'unknown' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        () =>
          mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(null), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      ];

      for (const seed of scenarios) {
        seed();
        await expect(getSummary('v')).resolves.toBeDefined();
        seed();
        await expect(regenerateSummary('v')).resolves.toBeDefined();
      }
    });
  });
});
