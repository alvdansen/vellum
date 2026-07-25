/**
 * RegenerateButton component tests (Phase 19 / Plan 19-06 Task 1).
 *
 * Covers the 3-render-state pure presentational button used inside
 * SummarySection's header strip:
 *   1. default  — no cooldown, not fetching      → "Regenerate", enabled
 *   2. cooldown — regenerateAvailableAtMs > now  → "Regenerate (Ns)", disabled
 *   3. fetching — isFetching=true                → "Regenerating…", disabled
 *
 * Plus interaction + ARIA + interval-cleanup invariants:
 *   - Click handler called when enabled; NOT called when disabled
 *   - aria-label / aria-busy / disabled wired correctly
 *   - 1Hz countdown ticks down via vi.useFakeTimers
 *   - Interval cleared on unmount (no memory leak)
 *   - Tabular-nums applied (digit-jitter prevention)
 *
 * Mirrors the WarningPill.test.tsx + C2paBadge.test.tsx structural shape
 * (props-in tests; no module mocks needed because RegenerateButton is pure).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { RegenerateButton } from '../RegenerateButton.js';

describe('RegenerateButton (Phase 19 — Plan 19-06 Task 1)', () => {
  beforeEach(() => {
    // Pin Date.now to a deterministic epoch so cooldown math is reproducible.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ==========================================================================
  // Render state 1 — default (no cooldown, not fetching)
  // ==========================================================================

  it("Test 1: default state — label='Regenerate', disabled=false, aria-busy='false'", () => {
    render(
      <RegenerateButton
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.textContent).toBe('Regenerate');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBe('false');
  });

  // ==========================================================================
  // Render state 2 — cooldown
  // ==========================================================================

  it("Test 2: cooldown — label='Regenerate (Ns)' with correct seconds, disabled=true, aria-busy='false'", () => {
    // Cooldown ends 30 seconds in the future.
    const future = Date.now() + 30_000;
    render(
      <RegenerateButton
        regenerateAvailableAtMs={future}
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.textContent).toBe('Regenerate (30s)');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('false');
  });

  // ==========================================================================
  // Render state 3 — fetching
  // ==========================================================================

  it("Test 3: fetching — label='Regenerating…', disabled=true, aria-busy='true'", () => {
    render(
      <RegenerateButton
        isFetching={true}
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    // Use literal U+2026 to match the constant verbatim.
    expect(btn.textContent).toBe('Regenerating…');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  // ==========================================================================
  // Render state 4 — fetching wins over cooldown
  // ==========================================================================

  it("Test 4: fetching wins over cooldown — both true → label='Regenerating…' (fetching priority)", () => {
    const future = Date.now() + 30_000;
    render(
      <RegenerateButton
        regenerateAvailableAtMs={future}
        isFetching={true}
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.textContent).toBe('Regenerating…');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  // ==========================================================================
  // Click handler — enabled path
  // ==========================================================================

  it('Test 5: click handler is called when enabled', () => {
    const onClick = vi.fn();
    render(
      <RegenerateButton
        onClick={onClick}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Click handler — disabled paths (cooldown + fetching)
  // ==========================================================================

  it('Test 6: click handler NOT called when disabled (cooldown)', () => {
    const onClick = vi.fn();
    const future = Date.now() + 30_000;
    render(
      <RegenerateButton
        regenerateAvailableAtMs={future}
        onClick={onClick}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    // .click() on a disabled button is a no-op in jsdom; defence-in-depth: the
    // component additionally passes onClick=undefined when disabled.
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // ARIA contract
  // ==========================================================================

  it('Test 7: ARIA label matches the passed prop verbatim', () => {
    render(
      <RegenerateButton
        onClick={() => {}}
        ariaLabel="Regenerate summary for v007"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Regenerate summary for v007');
  });

  // ==========================================================================
  // 1Hz countdown — text updates on every interval tick
  // ==========================================================================

  it('Test 8: cooldown countdown ticks down — vi.advanceTimersByTime(1000) → label updates to (n-1)s', async () => {
    const future = Date.now() + 5_000; // 5 seconds out
    render(
      <RegenerateButton
        regenerateAvailableAtMs={future}
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.textContent).toBe('Regenerate (5s)');

    // Advance 1000ms — countdown digit should drop by 1. Preact batches state
    // updates from the interval callback; flushing microtasks via the async
    // timer-advance variant lets the DOM observe the resulting re-render.
    await vi.advanceTimersByTimeAsync(1000);
    expect(btn.textContent).toBe('Regenerate (4s)');

    // Advance another 2000ms — should now show (2s).
    await vi.advanceTimersByTimeAsync(2000);
    expect(btn.textContent).toBe('Regenerate (2s)');
  });

  // ==========================================================================
  // Interval cleanup — no memory leak on unmount
  // ==========================================================================

  it('Test 9: cooldown clears the interval when component unmounts (no memory leak)', () => {
    const future = Date.now() + 30_000;
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(
      <RegenerateButton
        regenerateAvailableAtMs={future}
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    unmount();
    // clearInterval was called at least once during teardown (the useEffect
    // cleanup callback fires on unmount).
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  // ==========================================================================
  // Default-enabled — null cooldown
  // ==========================================================================

  it('Test 10: regenerateAvailableAtMs=null → disabled=false (button enabled by default)', () => {
    render(
      <RegenerateButton
        regenerateAvailableAtMs={null}
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Regenerate');
  });

  // ==========================================================================
  // Default-enabled — past cooldown
  // ==========================================================================

  it('Test 11: regenerateAvailableAtMs in past → disabled=false (cooldown elapsed)', () => {
    const past = Date.now() - 30_000;
    render(
      <RegenerateButton
        regenerateAvailableAtMs={past}
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Regenerate');
  });

  // ==========================================================================
  // Tabular-nums — digit-jitter prevention
  // ==========================================================================

  it('Test 12: tabular-nums applied — class composition includes the visual style for digit-jitter prevention', () => {
    render(
      <RegenerateButton
        onClick={() => {}}
        ariaLabel="Regenerate summary for v003"
      />,
    );
    const btn = screen.getByTestId('regenerate-button') as HTMLButtonElement;
    expect(btn.className).toMatch(/tabular-nums/);
  });
});
