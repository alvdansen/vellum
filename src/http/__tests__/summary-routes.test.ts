// Phase 19 / Plan 19-05 Task 1 — HTTP route tests for the AI conversational
// summary surface (SUM-01..06 + SUM-04 server-side throttle).
//
// Covers two routes added to src/http/dashboard-routes.ts:
//   - GET  /api/versions/:id/summary
//   - POST /api/versions/:id/summary/regenerate
//
// Strategy:
//   - Build a fresh Hono app + createDashboardRouter(engine) per test; mount
//     typedErrorHandler so TypedError throws convert to 4xx JSON.
//   - Use FakeEngine.cans.summaryOutcomes to control the engine's
//     SummaryOutcome discriminated union (cache_hit / live / fallback variants).
//   - Use vi.useFakeTimers() + vi.setSystemTime() for deterministic time-travel
//     across the 60s throttle window.
//
// Test coverage matrix:
//   1.  GET happy path — cache_hit outcome
//   2.  GET happy path — live outcome (with usage tokens)
//   3.  GET fallback path — api_key_missing (200, NOT 5xx)
//   4.  GET fallback path — circuit_open (200, NOT 5xx)
//   5.  GET 404 — engine throws TypedError(VERSION_NOT_FOUND)
//   6.  POST regenerate first call — 200 + throttle Map updated
//   7.  POST regenerate within throttle window — 429 SUMMARY_THROTTLED envelope
//   8.  POST regenerate after throttle window — 200 + throttle resets
//   9.  POST regenerate forces fresh LLM (regenerate: true verified via spy)
//  10.  GET response includes regenerate_available_at_ms even on first call
//  11.  Concurrent versions — throttle is per-versionId (A and B independent)
//  12.  Throttle Map lazy GC verified via Test 8 + concurrent versions

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { FakeEngine } from '../../test-utils/fake-engine.js';
import { createDashboardRouter } from '../dashboard-routes.js';
import { typedErrorHandler } from '../error-middleware.js';
import { TypedError } from '../../engine/errors.js';

function buildApp(engine: FakeEngine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}

describe('Phase 19 Plan 19-05 — summary HTTP routes', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    engine.reset();
    vi.useFakeTimers();
    // Anchor at a non-zero epoch so regenerate_available_at_ms calculations
    // are clearly distinguishable from the 0 default in lastReq.
    vi.setSystemTime(new Date('2026-05-09T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================================================
  // GET /api/versions/:id/summary — happy paths
  // ==========================================================================

  describe('GET /api/versions/:id/summary', () => {
    it('Test 1: returns 200 + envelope with source=cache_hit on cache_hit outcome', async () => {
      engine.cans.summaryOutcomes.set('ver_1', {
        source: 'cache_hit',
        text: 'v003 generated with flux1-dev at seed 42.',
        generated_at: '2026-05-09T11:30:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_1/summary');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        source: 'cache_hit',
        text: 'v003 generated with flux1-dev at seed 42.',
        generated_at: '2026-05-09T11:30:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
      });
      // Plan 19-05 contract — augmented with regenerate_available_at_ms.
      expect(body).toHaveProperty('regenerate_available_at_ms');
      expect(typeof body.regenerate_available_at_ms).toBe('number');
      expect(engine.calls).toContainEqual({
        method: 'summarizeVersion',
        args: ['ver_1', undefined],
      });
    });

    it('Test 2: returns 200 + envelope with source=live + usage tokens on live outcome', async () => {
      engine.cans.summaryOutcomes.set('ver_2', {
        source: 'live',
        text: 'v004 is a tighter close-up of the dragon.',
        generated_at: '2026-05-09T12:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        prompt_tokens: 4500,
        completion_tokens: 120,
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_2/summary');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        source: 'live',
        prompt_tokens: 4500,
        completion_tokens: 120,
      });
      expect(body).toHaveProperty('regenerate_available_at_ms');
    });

    it('Test 3: returns 200 (NOT 5xx) for fallback reason api_key_missing — D-FB-1 graceful degradation', async () => {
      engine.cans.summaryOutcomes.set('ver_3', {
        source: 'fallback',
        reason: 'api_key_missing',
        text: 'v003 generated with flux1-dev at seed 42.',
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_3/summary');
      // CRITICAL: fallback paths return 200, NOT 5xx. Per plan-frontmatter
      // truth #5 (D-FB-1) — engine fallback outcomes flow through to a 200
      // SummaryOutcome envelope; users always see something readable.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        source: 'fallback',
        reason: 'api_key_missing',
      });
      expect(typeof body.text).toBe('string');
    });

    it('Test 4: returns 200 (NOT 5xx) for fallback reason circuit_open', async () => {
      engine.cans.summaryOutcomes.set('ver_4', {
        source: 'fallback',
        reason: 'circuit_open',
        text: 'v003 generated with flux1-dev at seed 42.',
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_4/summary');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source).toBe('fallback');
      expect(body.reason).toBe('circuit_open');
    });

    it('Test 5: returns 404 envelope when engine throws TypedError(VERSION_NOT_FOUND) — Pattern G', async () => {
      engine.cans.summaryErrors.set(
        'ver_missing',
        new TypedError(
          'VERSION_NOT_FOUND',
          "Version 'ver_missing' not found",
          'Verify the versionId — Engine.summarizeVersion does not auto-create versions.',
        ),
      );
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_missing/summary');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { code: 'VERSION_NOT_FOUND' },
      });
    });

    it('Test 10: response includes regenerate_available_at_ms even on first-ever call', async () => {
      // No prior POST regenerate → throttle Map has no entry for ver_first;
      // lastReq defaults to 0 → regenerate_available_at_ms = 0 + 60000 = 60000
      // (a UTC epoch timestamp from 1970 — long in the past, so the dashboard
      // interprets as "available now"). The contract is that the field is
      // ALWAYS present for the dashboard countdown timer to read.
      engine.cans.summaryOutcomes.set('ver_first', {
        source: 'cache_hit',
        text: 'first',
        generated_at: '2026-05-09T11:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_first/summary');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.regenerate_available_at_ms).toBe(60_000);
    });
  });

  // ==========================================================================
  // POST /api/versions/:id/summary/regenerate — throttle behaviour
  // ==========================================================================

  describe('POST /api/versions/:id/summary/regenerate', () => {
    it('Test 6: first call returns 200 + envelope; throttle Map updated with regenerate_available_at_ms = now + 60000', async () => {
      engine.cans.summaryOutcomes.set('ver_post1', {
        source: 'live',
        text: 'fresh summary',
        generated_at: '2026-05-09T12:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        prompt_tokens: 4500,
        completion_tokens: 80,
      });
      const app = buildApp(engine);
      const now = Date.now();
      const res = await app.request('/api/versions/ver_post1/summary/regenerate', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source).toBe('live');
      // regenerate_available_at_ms = now + SUMMARY_THROTTLE_MS (60_000ms).
      expect(body.regenerate_available_at_ms).toBe(now + 60_000);
    });

    it('Test 7: second call within 60s window returns 429 + SUMMARY_THROTTLED envelope', async () => {
      engine.cans.summaryOutcomes.set('ver_post2', {
        source: 'live',
        text: 'fresh',
        generated_at: '2026-05-09T12:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        prompt_tokens: 4500,
        completion_tokens: 80,
      });
      const app = buildApp(engine);

      // First call seeds the throttle Map.
      const r1 = await app.request('/api/versions/ver_post2/summary/regenerate', {
        method: 'POST',
      });
      expect(r1.status).toBe(200);

      // Advance 30 seconds — still inside the 60s throttle window.
      vi.advanceTimersByTime(30_000);

      const r2 = await app.request('/api/versions/ver_post2/summary/regenerate', {
        method: 'POST',
      });
      expect(r2.status).toBe(429);
      const body = await r2.json();
      expect(body).toMatchObject({
        error: {
          code: 'SUMMARY_THROTTLED',
        },
      });
      // Message contains actionable retry-after seconds (~30s remaining).
      expect(body.error.message).toMatch(/try again in 30s/);
    });

    it('Test 8: call after throttle window (>60s elapsed) succeeds + Map entry overwritten (lazy GC)', async () => {
      engine.cans.summaryOutcomes.set('ver_post3', {
        source: 'live',
        text: 'fresh',
        generated_at: '2026-05-09T12:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        prompt_tokens: 4500,
        completion_tokens: 80,
      });
      const app = buildApp(engine);

      const r1 = await app.request('/api/versions/ver_post3/summary/regenerate', {
        method: 'POST',
      });
      expect(r1.status).toBe(200);

      // Advance 61 seconds — past the throttle window.
      vi.advanceTimersByTime(61_000);

      const r2 = await app.request('/api/versions/ver_post3/summary/regenerate', {
        method: 'POST',
      });
      expect(r2.status).toBe(200);
      const body = await r2.json();
      expect(body.source).toBe('live');
      // Lazy GC verification: regenerate_available_at_ms tracks the NEW now,
      // not the original first-call timestamp.
      expect(body.regenerate_available_at_ms).toBe(Date.now() + 60_000);
    });

    it('Test 9: POST forces fresh LLM call — engine.summarizeVersion called with { regenerate: true }', async () => {
      engine.cans.summaryOutcomes.set('ver_post4', {
        source: 'live',
        text: 'fresh',
        generated_at: '2026-05-09T12:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        prompt_tokens: 4500,
        completion_tokens: 80,
      });
      const app = buildApp(engine);
      await app.request('/api/versions/ver_post4/summary/regenerate', {
        method: 'POST',
      });

      // Engine call captured with regenerate: true option (Plan 19-04 step 2
      // skips cache lookup when this flag is set — invariant tested by
      // summarize-version.test.ts:Test 13).
      expect(engine.calls).toContainEqual({
        method: 'summarizeVersion',
        args: ['ver_post4', { regenerate: true }],
      });
    });

    it('Test 11: throttle Map is keyed by versionId — POST on A then POST on B succeed concurrently', async () => {
      engine.cans.summaryOutcomes.set('ver_A', {
        source: 'live',
        text: 'A',
        generated_at: '2026-05-09T12:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        prompt_tokens: 4500,
        completion_tokens: 80,
      });
      engine.cans.summaryOutcomes.set('ver_B', {
        source: 'live',
        text: 'B',
        generated_at: '2026-05-09T12:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        prompt_tokens: 4500,
        completion_tokens: 80,
      });
      const app = buildApp(engine);

      const rA = await app.request('/api/versions/ver_A/summary/regenerate', {
        method: 'POST',
      });
      expect(rA.status).toBe(200);

      // Same fake-timer instant — A is in throttle, B is not.
      const rB = await app.request('/api/versions/ver_B/summary/regenerate', {
        method: 'POST',
      });
      expect(rB.status).toBe(200);

      // Confirm A is throttled within its 60s window — re-attempt A returns 429.
      const rA2 = await app.request('/api/versions/ver_A/summary/regenerate', {
        method: 'POST',
      });
      expect(rA2.status).toBe(429);

      // B can also be throttled independently.
      const rB2 = await app.request('/api/versions/ver_B/summary/regenerate', {
        method: 'POST',
      });
      expect(rB2.status).toBe(429);
    });
  });

  // ==========================================================================
  // Test 12: throttle Map lazy GC integration — verifies Test 8's premise more
  // explicitly (entries older than 60s do NOT block new requests, no cron GC).
  // ==========================================================================

  describe('throttle Map lazy GC behaviour', () => {
    it('Test 12: entries older than 60s allow fresh requests without scheduled cleanup', async () => {
      engine.cans.summaryOutcomes.set('ver_gc', {
        source: 'live',
        text: 'gc-test',
        generated_at: '2026-05-09T12:00:00.000Z',
        template_version: '1.0.0',
        model_id: 'claude-haiku-4-5-20251001',
        prompt_tokens: 4500,
        completion_tokens: 80,
      });
      const app = buildApp(engine);

      const r1 = await app.request('/api/versions/ver_gc/summary/regenerate', {
        method: 'POST',
      });
      expect(r1.status).toBe(200);

      // Sweep across 5 minutes (5x throttle windows). No cleanup runs.
      vi.advanceTimersByTime(300_000);

      // Fresh request still succeeds — lazy GC at lookup overwrites the stale
      // entry rather than scheduling a timer.
      const r2 = await app.request('/api/versions/ver_gc/summary/regenerate', {
        method: 'POST',
      });
      expect(r2.status).toBe(200);
    });
  });
});
