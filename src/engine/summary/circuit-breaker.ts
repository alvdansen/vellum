/**
 * Half-open circuit breaker for the Anthropic API.
 *
 * Architecture-purity (grep-guarded): ZERO imports beyond pure JS/TS.
 * No SDK, no DB, no HTTP — the breaker is module-scoped and pure logic.
 *
 * State machine:
 *   CLOSED   — normal operation. Failures counted within FAILURE_WINDOW_MS.
 *   OPEN     — after FAILURE_THRESHOLD failures in window; refuses ALL calls
 *              for OPEN_DURATION_MS. After expiry, transitions to HALF_OPEN.
 *   HALF_OPEN — allows ONE probe call. Success → CLOSED; failure → OPEN.
 *
 * Scope: in-memory per-process; single 'anthropic' unit key
 * (NOT per-model_id). Resets on process restart (acceptable at current scale).
 *
 * Clock injection: every transition method accepts a `clock: () => number`
 * function so tests can use a fake clock for deterministic time-travel
 * (module-scoped singleton state leaks across tests in Vitest otherwise).
 * Production callers pass `Date.now`.
 *
 * Test-only reset hook __resetCircuitBreakerStateForTests mirrors
 * __resetC2paNodeStateForTests at src/engine/c2pa/signer.ts:94-97.
 */

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export const FAILURE_WINDOW_MS = 60_000; // 1 min sliding window
export const FAILURE_THRESHOLD = 5; // 5 failures in window → OPEN
export const OPEN_DURATION_MS = 5 * 60_000; // 5 min OPEN duration

class SummaryCircuitBreaker {
  private state: State = 'CLOSED';
  private failures: number[] = [];
  private openedAt = 0;

  /** Check whether the next call may proceed. Side-effect: OPEN→HALF_OPEN transition. */
  canRequest(clock: () => number): boolean {
    const now = clock();
    if (this.state === 'OPEN') {
      if (now - this.openedAt >= OPEN_DURATION_MS) {
        this.state = 'HALF_OPEN';
        return true; // Allow ONE probe call
      }
      return false;
    }
    return true; // CLOSED or HALF_OPEN already allow
  }

  recordSuccess(_clock: () => number): void {
    this.state = 'CLOSED';
    this.failures = [];
    this.openedAt = 0;
  }

  recordFailure(clock: () => number): void {
    const now = clock();
    if (this.state === 'HALF_OPEN') {
      // Probe failed — re-OPEN for another 5 min
      this.state = 'OPEN';
      this.openedAt = now;
      return;
    }
    // CLOSED: prune failures outside 60s window, then count.
    this.failures = this.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    this.failures.push(now);
    if (this.failures.length >= FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      this.openedAt = now;
      this.failures = [];
    }
  }

  /** Test-only — mirrors __resetC2paNodeStateForTests in the c2pa signer. */
  __reset(): void {
    this.state = 'CLOSED';
    this.failures = [];
    this.openedAt = 0;
  }

  /** Test-only inspector — exposes state for assertions. */
  __peekState(): State {
    return this.state;
  }
}

// Module-scoped singleton — per-process scope (no per-model_id keying).
export const circuitBreaker = new SummaryCircuitBreaker();

/** Test-only — production code MUST NOT call. Naming starts with __ to discourage usage. */
export function __resetCircuitBreakerStateForTests(): void {
  circuitBreaker.__reset();
}
