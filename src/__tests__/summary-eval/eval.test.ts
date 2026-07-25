/**
 * Phase 19 — AI-SPEC §5 eval suite Vitest entry point.
 *
 * Runs `runEval` against the 12 fixtures and asserts pass-rate thresholds
 * (Critical 100%, High 95%, redaction-leak 100%). Code-based dimensions
 * execute unconditionally; LLM-judge dimensions skip cleanly when
 * ANTHROPIC_API_KEY is absent.
 *
 * CI hard-fail: any threshold violation fails this test, gating merge to
 * main per AI-SPEC §5 CI/CD Integration.
 *
 * Timeout: 60s — allows for the worst-case live-call path (12 fixtures ×
 * 1 generate + 2 judge calls = 36 API calls × 1s/call worst case + retry
 * budget). Cache-warmed Haiku 4.5 typically completes in <15s total.
 */

import { describe, it, expect } from 'vitest';
import { runEval } from './run-eval.js';

describe('Phase 19 — summary eval suite (AI-SPEC §5)', () => {
  it(
    'passes all dimension thresholds across 12 fixtures',
    async () => {
      const report = await runEval();

      // Always log the report for diagnostic visibility on CI.
      console.log('[summary-eval] pass rates:', report.passRates);
      if (report.thresholdViolations.length > 0) {
        console.error('[summary-eval] threshold violations:', report.thresholdViolations);
      }

      // Hard-fail on threshold violations.
      expect(
        report.thresholdViolations,
        `Threshold violations: ${report.thresholdViolations.join('; ')}`,
      ).toEqual([]);

      // Sanity check: 12 fixtures evaluated.
      expect(report.results.length).toBe(12);
    },
    60_000,
  );
});
