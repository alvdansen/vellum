import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBackoffIterator, sleep } from '../backoff.js';

/**
 * Tests for src/engine/backoff.ts per D-GEN-24.
 * Schedule: [2s, 4s, 8s, 16s, 30s, 30s, ...] capped at 30_000 ms.
 * Reset semantics: new iterator per job.
 */
describe('backoff iterator (D-GEN-24)', () => {
  test('yields [2s, 4s, 8s, 16s, 30s, 30s] then caps at 30s', async () => {
    const it = createBackoffIterator();
    const first6: number[] = [];
    for (let i = 0; i < 6; i++) first6.push((await it.next()).value!);
    expect(first6).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    // Iteration 100 still caps at 30000
    for (let i = 0; i < 94; i++) await it.next();
    const later = (await it.next()).value;
    expect(later).toBe(30000);
  });

  test('new iterator resets to 2s', async () => {
    const a = createBackoffIterator();
    await a.next();
    await a.next();
    const b = createBackoffIterator();
    expect((await b.next()).value).toBe(2000);
  });
});

describe('sleep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('resolves after the delay', async () => {
    const p = sleep(100);
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBeUndefined();
  });

  test('rejects immediately when signal is already aborted', async () => {
    const c = new AbortController();
    c.abort();
    await expect(sleep(1000, c.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('IT-09: mid-sleep abort rejects with AbortError', async () => {
    // Start a long sleep with a signal, advance partway, then abort — the
    // promise must reject immediately with AbortError (not wait for the
    // remaining delay to elapse).
    const c = new AbortController();
    const p = sleep(10_000, c.signal);
    // Advance timers 1s — sleep is still pending.
    vi.advanceTimersByTime(1_000);
    // Attach the rejection expectation BEFORE aborting so we do not race
    // the microtask queue.
    const rejection = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    c.abort();
    await rejection;
  });
});
