/**
 * Phase 23 / Plan 23-02 — Task 02-02 — ProgressBar component tests.
 *
 * Covers OVR-01 / D-06 / D-21 / A6: progress bar primitive renders the
 * required WCAG 2.1 AA `role="progressbar"` + `aria-value{now,min,max}` +
 * `aria-label` attribute set, performs defensive clamp + integer rounding,
 * honors `prefers-reduced-motion` via Tailwind v4
 * `motion-reduce:transition-none` variant on the fill, and references the
 * locked theme tokens (`--color-shot-status-approved` for fill,
 * `--color-border` for track).
 *
 * Landmine guards (mirrors ShotStatusPill.test.tsx PATTERNS §16):
 *   - Use `container.querySelector('[role="progressbar"]')` for the bar
 *     element (no `data-testid` on the spec).
 *   - Tailwind v4 emits `bg-[var(--color-shot-status-approved)]` and
 *     `motion-reduce:transition-none` as literal class strings — assert
 *     via `className.includes(...)` not hashed-class comparison.
 *   - Preact serializes the `style` object to a string attribute; assert
 *     via `getAttribute('style')` containing `width: 25%` (or similar).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ProgressBar } from '../ProgressBar.js';

afterEach(() => {
  cleanup();
});

describe('ProgressBar (Phase 23 D-06 / OVR-01)', () => {
  it('renders role="progressbar" with full aria-* attribute set', () => {
    const { container } = render(
      <ProgressBar value={60} ariaLabel="Approval progress for SEQ_010" />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeTruthy();
    expect(bar!.getAttribute('aria-valuenow')).toBe('60');
    expect(bar!.getAttribute('aria-valuemin')).toBe('0');
    expect(bar!.getAttribute('aria-valuemax')).toBe('100');
    expect(bar!.getAttribute('aria-label')).toBe(
      'Approval progress for SEQ_010',
    );
  });

  it('clamps over-max value (>100) to 100', () => {
    const { container } = render(
      <ProgressBar value={120} ariaLabel="x" />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar!.getAttribute('aria-valuenow')).toBe('100');
  });

  it('clamps under-min value (<0) to 0', () => {
    const { container } = render(
      <ProgressBar value={-5} ariaLabel="x" />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar!.getAttribute('aria-valuenow')).toBe('0');
  });

  it('rounds float values to integers (42.7 → 43)', () => {
    const { container } = render(
      <ProgressBar value={42.7} ariaLabel="x" />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar!.getAttribute('aria-valuenow')).toBe('43');
  });

  it('supports custom max — value=50 max=200 → aria-valuenow=50, fill width=25%', () => {
    const { container } = render(
      <ProgressBar value={50} max={200} ariaLabel="x" />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar!.getAttribute('aria-valuenow')).toBe('50');
    expect(bar!.getAttribute('aria-valuemax')).toBe('200');
    // Fill width = (50 / 200) * 100 = 25%.
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill).toBeTruthy();
    expect(fill!.getAttribute('style')).toContain('width: 25%');
  });

  it('renders optional label span when label prop provided; omits when absent', () => {
    const { container, rerender } = render(
      <ProgressBar value={60} label="60% approved" ariaLabel="x" />,
    );
    // Label span rendered as a sibling next to the bar wrapper.
    let span = container.querySelector('span');
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe('60% approved');

    // Re-render without label — no <span> sibling.
    rerender(<ProgressBar value={60} ariaLabel="x" />);
    span = container.querySelector('span');
    expect(span).toBeNull();
  });

  it('fill element includes motion-reduce:transition-none Tailwind variant (D-21 + A6)', () => {
    const { container } = render(
      <ProgressBar value={60} ariaLabel="x" />,
    );
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill).toBeTruthy();
    // Tailwind v4 emits this as a literal class string; we assert on the
    // raw className substring (prefers-reduced-motion compliance signal).
    expect(fill!.className).toContain('motion-reduce:transition-none');
  });

  it('references the locked theme tokens — fill=approved, track=border', () => {
    const { container } = render(
      <ProgressBar value={60} ariaLabel="x" />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeTruthy();
    // Track wrapper class references the existing --color-border token.
    expect(bar!.className).toContain('bg-[var(--color-border)]');
    const fill = container.querySelector('[role="progressbar"] > div');
    // Fill class references the Phase 21 --color-shot-status-approved token.
    expect(fill!.className).toContain('bg-[var(--color-shot-status-approved)]');
  });
});
