/**
 * Phase 21 / Plan 21-03 — Task T02 — ShotGridFilterBar component tests.
 *
 * Covers REQ-GRID-03 + D-07/D-08/D-10/D-11 LOCKED decisions:
 *   - 5 pills (All, wip, pending-review, approved, on-hold) when showOmitted=false
 *   - 6 pills (the above + omit at end) when showOmitted=true (D-07)
 *   - Click on pill invokes onChangeStatusFilter with the pill value (D-11)
 *   - Click on Show omitted toggle invokes onToggleShowOmitted (D-10)
 *   - Active pill: aria-pressed='true' + bg-[var(--color-accent)] class (D-11)
 *   - Inactive pill: aria-pressed='false' + border class (D-11)
 *   - Show omitted toggle is <button role='switch'> with aria-checked (UI-SPEC line 305)
 *   - Container has sticky top-0 z-10 classes (D-10)
 *   - 'omit' pill is HIDDEN when showOmitted=false (D-07)
 *
 * Landmine guards (PATTERNS §20):
 *   - Use Array.from(...).find((b) => b.textContent === 'omit') not getByText
 *   - The Show omitted toggle is role='switch' not a checkbox
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ShotGridFilterBar } from '../ShotGridFilterBar.js';
import type { ShotStatus } from '../../types/shot-grid.js';

type FilterValue = 'all' | ShotStatus;

afterEach(() => cleanup());

interface RenderOpts {
  statusFilter?: FilterValue;
  showOmitted?: boolean;
  onChangeStatusFilter?: (next: FilterValue) => void;
  onToggleShowOmitted?: () => void;
}

function renderBar(opts: RenderOpts = {}) {
  const {
    statusFilter = 'all',
    showOmitted = false,
    onChangeStatusFilter = vi.fn(),
    onToggleShowOmitted = vi.fn(),
  } = opts;
  return render(
    <ShotGridFilterBar
      statusFilter={statusFilter}
      showOmitted={showOmitted}
      onChangeStatusFilter={onChangeStatusFilter}
      onToggleShowOmitted={onToggleShowOmitted}
    />,
  );
}

function getStatusPills(container: Element): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
  );
}

describe('ShotGridFilterBar (Phase 21 GRID-03)', () => {
  it('renders 5 pills when showOmitted=false; omit pill is absent (D-07)', () => {
    const { container } = renderBar({ showOmitted: false });
    const pills = getStatusPills(container);
    expect(pills.length).toBe(5);
    const labels = pills.map((p) => p.textContent);
    expect(labels).toEqual(['All', 'wip', 'pending-review', 'approved', 'on-hold']);
    // No omit pill rendered
    const omitPill = pills.find((p) => p.textContent === 'omit');
    expect(omitPill).toBeUndefined();
  });

  it('renders 6 pills when showOmitted=true; omit appears as 6th (D-07)', () => {
    const { container } = renderBar({ showOmitted: true });
    const pills = getStatusPills(container);
    expect(pills.length).toBe(6);
    expect(pills.map((p) => p.textContent)).toEqual([
      'All',
      'wip',
      'pending-review',
      'approved',
      'on-hold',
      'omit',
    ]);
  });

  it("click on 'approved' pill invokes onChangeStatusFilter('approved') (D-11)", () => {
    const onChangeStatusFilter = vi.fn();
    const { container } = renderBar({ onChangeStatusFilter });
    const approvedPill = getStatusPills(container).find(
      (p) => p.textContent === 'approved',
    )!;
    fireEvent.click(approvedPill);
    expect(onChangeStatusFilter).toHaveBeenCalledWith('approved');
  });

  it("click on 'All' pill invokes onChangeStatusFilter('all') (D-08)", () => {
    const onChangeStatusFilter = vi.fn();
    const { container } = renderBar({ onChangeStatusFilter });
    const allPill = getStatusPills(container).find(
      (p) => p.textContent === 'All',
    )!;
    fireEvent.click(allPill);
    expect(onChangeStatusFilter).toHaveBeenCalledWith('all');
  });

  it('click on Show omitted toggle invokes onToggleShowOmitted (no args)', () => {
    const onToggleShowOmitted = vi.fn();
    const { container } = renderBar({ onToggleShowOmitted });
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(onToggleShowOmitted).toHaveBeenCalledWith();
  });

  it("active pill has aria-pressed='true' + accent fill; inactive has 'false' + border (D-11)", () => {
    const { container } = renderBar({ statusFilter: 'approved' });
    const pills = getStatusPills(container);
    const approvedPill = pills.find((p) => p.textContent === 'approved')!;
    const wipPill = pills.find((p) => p.textContent === 'wip')!;

    expect(approvedPill.getAttribute('aria-pressed')).toBe('true');
    expect(approvedPill.className).toContain('bg-[var(--color-accent)]');
    expect(approvedPill.className).toContain('text-[var(--color-bg)]');

    expect(wipPill.getAttribute('aria-pressed')).toBe('false');
    expect(wipPill.className).toContain('border');
    expect(wipPill.className).toContain('border-[var(--color-border)]');
    expect(wipPill.className).not.toContain('bg-[var(--color-accent)]');
  });

  it("Show omitted toggle is <button role='switch'> with aria-checked reflecting prop", () => {
    // showOmitted=true → aria-checked='true'
    {
      const { container } = renderBar({ showOmitted: true });
      const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
      expect(toggle).toBeTruthy();
      // role='switch' was confirmed by the selector
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      cleanup();
    }
    // showOmitted=false → aria-checked='false'
    {
      const { container } = renderBar({ showOmitted: false });
      const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('container has sticky top-0 z-10 classes (D-10)', () => {
    const { container } = renderBar();
    // The outermost div in the component output
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.className).toContain('sticky');
    expect(root.className).toContain('top-0');
    expect(root.className).toContain('z-10');
  });

  it('does NOT use <input type="checkbox"> for Show omitted (semantic correctness)', () => {
    const { container } = renderBar({ showOmitted: true });
    // No checkbox input anywhere — toggle must be <button role='switch'>
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
