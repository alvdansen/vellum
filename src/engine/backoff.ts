/**
 * Exponential backoff + sleep helpers for the recovery poller (D-GEN-24, D-GEN-28).
 * Pure: zero DB / network / MCP dependencies.
 */

/**
 * Exponential backoff delay sequence per D-GEN-24: 2s, 4s, 8s, 16s, then cap at 30s.
 * Reset semantics: a new iterator per job = reset.
 *
 * Usage:
 *   const it = createBackoffIterator();
 *   const delay = (await it.next()).value;  // 2000 first call
 *   await sleep(delay, signal);
 */
export async function* createBackoffIterator(): AsyncGenerator<number> {
  const schedule = [2_000, 4_000, 8_000, 16_000];
  for (const delay of schedule) yield delay;
  while (true) yield 30_000;
}

/**
 * Promise-based sleep that honors an AbortSignal. Rejects with an
 * `AbortError` DOMException if the signal is already aborted or aborts mid-sleep.
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, rejectSleep) => {
    if (signal?.aborted) {
      rejectSleep(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolveSleep, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        rejectSleep(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
