import { describe, it, expect, beforeEach } from 'vitest';
import {
  circuitBreaker,
  __resetCircuitBreakerStateForTests,
  FAILURE_THRESHOLD,
  FAILURE_WINDOW_MS,
  OPEN_DURATION_MS,
} from '../circuit-breaker.js';

/**
 * Phase 19 — D-FB-3 circuit breaker tests.
 *
 * Uses an injected fake clock (NOT vi.useFakeTimers) because the breaker
 * uses Date.now (passed as a function), not setTimeout. This is the
 * RESEARCH.md Pitfall 6 mitigation pattern — clock injection enables
 * deterministic time-travel without monkey-patching globals.
 *
 * __resetCircuitBreakerStateForTests is called in beforeEach to prevent
 * cross-test contamination of the module-scoped singleton state.
 */

class FakeClock {
  private now: number;

  constructor(start: number = 0) {
    this.now = start;
  }

  read = (): number => this.now;

  advance(ms: number): void {
    this.now += ms;
  }

  set(t: number): void {
    this.now = t;
  }
}

describe('SummaryCircuitBreaker', () => {
  beforeEach(() => {
    __resetCircuitBreakerStateForTests();
  });

  it('Test 1: initial state is CLOSED → canRequest returns true', () => {
    const clock = new FakeClock(1000);
    expect(circuitBreaker.canRequest(clock.read)).toBe(true);
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
  });

  it('Test 2: single failure does NOT trip the breaker → state still CLOSED', () => {
    const clock = new FakeClock(1000);
    circuitBreaker.recordFailure(clock.read);
    expect(circuitBreaker.canRequest(clock.read)).toBe(true);
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
  });

  it('Test 3: 4 consecutive failures within 60s window do NOT trip → state still CLOSED', () => {
    const clock = new FakeClock(0);
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      clock.advance(1_000); // 1s apart
      circuitBreaker.recordFailure(clock.read);
    }
    expect(circuitBreaker.canRequest(clock.read)).toBe(true);
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
  });

  it('Test 4: 5 consecutive failures within 60s window trip the breaker → state OPEN; subsequent canRequest returns false', () => {
    const clock = new FakeClock(0);
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      clock.advance(1_000); // 1s apart, all within 60s window
      circuitBreaker.recordFailure(clock.read);
    }
    expect(circuitBreaker.__peekState()).toBe('OPEN');
    expect(circuitBreaker.canRequest(clock.read)).toBe(false);
  });

  it('Test 5: failures more than 60s apart get pruned — 5 failures spaced 70s, 65s, 60s, 30s, 0s (relative offsets) → only 4 within window → state CLOSED', () => {
    const clock = new FakeClock(0);

    // Timestamps where each failure is recorded (absolute):
    // 0s, 70s, 135s, 195s, 225s
    // At time 225s, the 60s window is (165s, 225s].
    // Failures within window: 195s, 225s = only 2 fall inside the prune.
    // After pruning + this failure recorded: failures = [195, 225] → length 2 < threshold.
    const offsets = [0, 70_000, 135_000, 195_000, 225_000];
    for (const t of offsets) {
      clock.set(t);
      circuitBreaker.recordFailure(clock.read);
    }
    // At final time, after pruning the older entries fall outside the window.
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
    expect(circuitBreaker.canRequest(clock.read)).toBe(true);
  });

  it('Test 6: recordSuccess from CLOSED state resets the failure counter', () => {
    const clock = new FakeClock(0);
    // Record 4 failures (just below threshold).
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    expect(circuitBreaker.__peekState()).toBe('CLOSED');

    // Record success — should reset failures.
    circuitBreaker.recordSuccess(clock.read);
    expect(circuitBreaker.__peekState()).toBe('CLOSED');

    // Now record threshold-1 more failures — should still be CLOSED (counter was reset).
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
  });

  it('Test 7: after OPEN_DURATION_MS (5min), canRequest transitions OPEN → HALF_OPEN and returns true', () => {
    const clock = new FakeClock(0);
    // Trip the breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    expect(circuitBreaker.__peekState()).toBe('OPEN');

    // Advance past OPEN_DURATION_MS.
    clock.advance(OPEN_DURATION_MS);
    expect(circuitBreaker.canRequest(clock.read)).toBe(true);
    expect(circuitBreaker.__peekState()).toBe('HALF_OPEN');
  });

  it('Test 8: before OPEN_DURATION_MS expiry, canRequest returns false; state remains OPEN', () => {
    const clock = new FakeClock(0);
    // Trip the breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    const openedAtTime = clock.read();
    expect(circuitBreaker.__peekState()).toBe('OPEN');

    // Advance, but not past the duration.
    clock.advance(OPEN_DURATION_MS - 1);
    expect(circuitBreaker.canRequest(clock.read)).toBe(false);
    expect(circuitBreaker.__peekState()).toBe('OPEN');

    // Confirm not yet at duration boundary.
    expect(clock.read() - openedAtTime).toBeLessThan(OPEN_DURATION_MS);
  });

  it('Test 9: HALF_OPEN + recordSuccess → state CLOSED; failure counter reset', () => {
    const clock = new FakeClock(0);
    // Trip the breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    // Advance to HALF_OPEN.
    clock.advance(OPEN_DURATION_MS);
    circuitBreaker.canRequest(clock.read); // triggers OPEN → HALF_OPEN
    expect(circuitBreaker.__peekState()).toBe('HALF_OPEN');

    // Probe succeeds.
    circuitBreaker.recordSuccess(clock.read);
    expect(circuitBreaker.__peekState()).toBe('CLOSED');

    // Failure counter is fresh — record threshold-1 failures, still CLOSED.
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
  });

  it('Test 10: HALF_OPEN + recordFailure → state OPEN again; openedAt = now', () => {
    const clock = new FakeClock(0);
    // Trip the breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    // Advance to HALF_OPEN.
    clock.advance(OPEN_DURATION_MS);
    circuitBreaker.canRequest(clock.read);
    expect(circuitBreaker.__peekState()).toBe('HALF_OPEN');

    // Probe fails.
    const reopenedAt = clock.read();
    circuitBreaker.recordFailure(clock.read);
    expect(circuitBreaker.__peekState()).toBe('OPEN');

    // Verify another OPEN_DURATION_MS is required from the new openedAt.
    clock.advance(OPEN_DURATION_MS - 1);
    expect(circuitBreaker.canRequest(clock.read)).toBe(false);
    expect(clock.read() - reopenedAt).toBeLessThan(OPEN_DURATION_MS);
  });

  it('Test 11: after re-open from HALF_OPEN failure, requires another full 5min before next probe', () => {
    const clock = new FakeClock(0);
    // Trip the breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    // Advance to HALF_OPEN.
    clock.advance(OPEN_DURATION_MS);
    circuitBreaker.canRequest(clock.read);
    expect(circuitBreaker.__peekState()).toBe('HALF_OPEN');

    // Probe fails.
    circuitBreaker.recordFailure(clock.read);
    expect(circuitBreaker.__peekState()).toBe('OPEN');

    // Halfway through the new OPEN duration → still OPEN.
    clock.advance(Math.floor(OPEN_DURATION_MS / 2));
    expect(circuitBreaker.canRequest(clock.read)).toBe(false);

    // After the FULL second OPEN duration → HALF_OPEN.
    clock.advance(OPEN_DURATION_MS);
    expect(circuitBreaker.canRequest(clock.read)).toBe(true);
    expect(circuitBreaker.__peekState()).toBe('HALF_OPEN');
  });

  it('Test 12: __resetCircuitBreakerStateForTests resets to initial CLOSED state', () => {
    const clock = new FakeClock(0);
    // Trip the breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    expect(circuitBreaker.__peekState()).toBe('OPEN');

    // Reset.
    __resetCircuitBreakerStateForTests();
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
    expect(circuitBreaker.canRequest(clock.read)).toBe(true);
  });
});

describe('SummaryCircuitBreaker — cross-test isolation (RESEARCH.md Pitfall 6)', () => {
  // Two consecutive describe blocks verify state isolation.
  beforeEach(() => {
    __resetCircuitBreakerStateForTests();
  });

  it('Test 13a: state is CLOSED at the start of a fresh describe block', () => {
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
    // Trip it for the next test to consume.
    const clock = new FakeClock(0);
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      clock.advance(1_000);
      circuitBreaker.recordFailure(clock.read);
    }
    expect(circuitBreaker.__peekState()).toBe('OPEN');
  });

  it('Test 13b: beforeEach reset prevents OPEN state from leaking from prior test', () => {
    // If beforeEach reset did NOT fire, this test would inherit OPEN from 13a.
    expect(circuitBreaker.__peekState()).toBe('CLOSED');
  });
});

// FAILURE_WINDOW_MS is verified inline in tests above (e.g., Test 5 uses
// 60_000-aware offsets) but we also assert the constant exports at module
// load time so a refactor that changes the constant value surfaces immediately.
describe('SummaryCircuitBreaker — exported constants', () => {
  it('exports FAILURE_WINDOW_MS = 60_000', () => {
    expect(FAILURE_WINDOW_MS).toBe(60_000);
  });

  it('exports FAILURE_THRESHOLD = 5', () => {
    expect(FAILURE_THRESHOLD).toBe(5);
  });

  it('exports OPEN_DURATION_MS = 5 * 60_000', () => {
    expect(OPEN_DURATION_MS).toBe(5 * 60_000);
  });
});
