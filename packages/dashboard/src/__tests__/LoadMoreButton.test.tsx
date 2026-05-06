/**
 * Phase 18 / Plan 18-04 Task 3 — LoadMoreButton component tests.
 *
 * 9 tests covering UI-SPEC §"<LoadMoreButton/> API contract" + the
 * §"Render contract" matrix:
 *   - Test 1: default state renders 'Load N more (M remaining)'
 *   - Test 2: loading state — disabled + aria-busy='true' + 'Loading…' label
 *   - Test 3: loading state has opacity-50 wrapper class
 *   - Test 4: error pill renders below button (role='alert' + aria-live='polite')
 *   - Test 5: error pill design-token reuse (--color-status-failed bg)
 *   - Test 6: button stays clickable when error present (Retry == re-click)
 *   - Test 7: Retry inside error pill fires same onClick handler
 *   - Test 8: pageSize defaults to 20 (CLAUDE.md + D-18)
 *   - Test 9: tabular-nums applied via 'num' class on the remaining-count span
 *
 * Mirrors Thumbnail.test.tsx + WarningPill.test.tsx test setup.
 *
 * Architecture-purity (D-WEBUI-31): zero server-tree imports. Imports only
 * from the dashboard tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { LoadMoreButton } from '../components/LoadMoreButton.js';
import {
  LOAD_MORE_LOADING_LABEL,
  LOAD_MORE_RETRY_LABEL,
} from '../lib/copy.js';

describe('LoadMoreButton — Plan 18-04 Task 3', () => {
  it('Test 1: default state renders "Load N more (M remaining)"', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={32}
        pageSize={20}
        isFetching={false}
        onClick={onClick}
      />,
    );
    // Single visible button with the load-more text + remaining count
    const button = screen.getByRole('button');
    expect(button.textContent).toMatch(/Load 20 more/);
    expect(button.textContent).toContain('(32 remaining)');
  });

  it('Test 2: loading state — disabled + aria-busy="true" + Loading… label', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={32}
        pageSize={20}
        isFetching={true}
        onClick={onClick}
      />,
    );
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain(LOAD_MORE_LOADING_LABEL);
  });

  it('Test 3: loading state has opacity-50 class for visual cue', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={32}
        pageSize={20}
        isFetching={true}
        onClick={onClick}
      />,
    );
    const button = screen.getByRole('button');
    const cls = button.getAttribute('class') ?? '';
    expect(cls).toContain('opacity-50');
  });

  it('Test 4: error pill renders below button — role="alert" + aria-live="polite"', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={32}
        pageSize={20}
        isFetching={false}
        onClick={onClick}
        errorMessage="Failed to load"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.getAttribute('aria-live')).toBe('polite');
    expect(alert.textContent).toContain('Failed to load');
    expect(alert.textContent).toContain(LOAD_MORE_RETRY_LABEL);
  });

  it('Test 5: error pill uses --color-status-failed design token (no new tokens)', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={32}
        pageSize={20}
        isFetching={false}
        onClick={onClick}
        errorMessage="Failed to load"
      />,
    );
    const alert = screen.getByRole('alert');
    const cls = alert.getAttribute('class') ?? '';
    expect(cls).toContain('color-status-failed');
  });

  it('Test 6: button stays clickable when error is present (Retry == re-click)', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={32}
        pageSize={20}
        isFetching={false}
        onClick={onClick}
        errorMessage="Failed to load"
      />,
    );
    const buttons = screen.getAllByRole('button');
    // The first button is the main 'Load more' (NOT the Retry inside the pill)
    const main = buttons[0] as HTMLButtonElement;
    expect(main.disabled).toBe(false);
    fireEvent.click(main);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Test 7: Retry button inside error pill fires the same onClick handler', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={32}
        pageSize={20}
        isFetching={false}
        onClick={onClick}
        errorMessage="Failed to load"
      />,
    );
    // The Retry button lives inside the role='alert' pill
    const alert = screen.getByRole('alert');
    const retry = alert.querySelector('button');
    expect(retry).toBeTruthy();
    expect(retry?.textContent).toContain(LOAD_MORE_RETRY_LABEL);
    fireEvent.click(retry!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Test 8: pageSize defaults to 20 (CLAUDE.md + D-18)', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={32}
        // pageSize omitted — should default to 20
        isFetching={false}
        onClick={onClick}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toMatch(/Load 20 more/);
    expect(button.textContent).toContain('(32 remaining)');
  });

  it('Test 9: tabular-nums applied via "num" class on the remaining-count span', () => {
    const onClick = vi.fn();
    const { container } = render(
      <LoadMoreButton
        remaining={32}
        pageSize={20}
        isFetching={false}
        onClick={onClick}
      />,
    );
    // The count span carries the .num utility for tabular numerics
    const countSpan = container.querySelector('span.num');
    expect(countSpan).toBeTruthy();
    expect(countSpan?.textContent).toContain('(32 remaining)');
  });

  it('Test 10 (extra): renders the smaller of pageSize and remaining when remaining < pageSize', () => {
    const onClick = vi.fn();
    render(
      <LoadMoreButton
        remaining={5}
        pageSize={20}
        isFetching={false}
        onClick={onClick}
      />,
    );
    // 'Load 5 more (5 remaining)' — min(20, 5) = 5
    const button = screen.getByRole('button');
    expect(button.textContent).toMatch(/Load 5 more/);
    expect(button.textContent).toContain('(5 remaining)');
  });
});
