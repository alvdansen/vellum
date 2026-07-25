/**
 * Phase 21 / Plan 21-03 — Task T03 — SequenceHeader component tests.
 *
 * Covers REQ-GRID-01 collapsible sequence header + D-14/D-15 LOCKED:
 *   - Renders sequence name in <h2> with font-display family (UI-SPEC line 76)
 *   - Chevron button has aria-expanded reflecting expanded prop (D-15)
 *   - expanded=true → ChevronDown icon; expanded=false → ChevronRight icon
 *   - Click on chevron invokes onToggleExpanded (no args)
 *   - aria-label format: 'Collapse {sequenceName}' (open) / 'Expand {sequenceName}' (closed)
 *   - Mini-pills render in fixed ORDER (wip → pending-review → approved → on-hold → omit)
 *   - Zero counts hidden (D-14 — only non-zero buckets render)
 *   - Aggregate counts container has role='group' + 'Status counts for {name}' label
 *
 * Landmine guards (PATTERNS §22):
 *   - font-display applied via inline style; assert via style attribute
 *   - Use [data-status] selector for collecting mini-pills
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { SequenceHeader } from '../SequenceHeader.js';
import type { ShotStatus } from '../../types/shot-grid.js';

afterEach(() => cleanup());

interface RenderOpts {
  sequenceName?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  counts?: Record<ShotStatus, number>;
}

function renderHeader(opts: RenderOpts = {}) {
  const {
    sequenceName = 'SEQ_010',
    expanded = true,
    onToggleExpanded = vi.fn(),
    counts = { wip: 5, 'pending-review': 3, approved: 12, 'on-hold': 1, omit: 2 },
  } = opts;
  return render(
    <SequenceHeader
      sequenceName={sequenceName}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      counts={counts}
    />,
  );
}

describe('SequenceHeader (Phase 21 GRID-01)', () => {
  it('renders sequence name in <h2> with font-display family', () => {
    const { container } = renderHeader({ sequenceName: 'SEQ_010' });
    const h2 = container.querySelector('h2');
    expect(h2).toBeTruthy();
    expect(h2!.textContent).toBe('SEQ_010');
    // font-display applied via inline style — assert via style attribute
    const style = h2!.getAttribute('style') ?? '';
    expect(style).toContain('var(--font-display)');
  });

  it('chevron button has aria-expanded reflecting prop value (D-15)', () => {
    // expanded=true
    {
      const { container } = renderHeader({ expanded: true });
      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-expanded')).toBe('true');
      cleanup();
    }
    // expanded=false
    {
      const { container } = renderHeader({ expanded: false });
      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('expanded=true → ChevronDown SVG; expanded=false → ChevronRight SVG', () => {
    // Lucide icons render <svg class="lucide lucide-chevron-down|right ...">.
    // We detect by class substring on the rendered <svg>.
    {
      const { container } = renderHeader({ expanded: true });
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      // Lucide preact v1.9.0 emits class="lucide lucide-chevron-down ..."
      const cls = svg!.getAttribute('class') ?? '';
      expect(cls.toLowerCase()).toContain('chevron-down');
      cleanup();
    }
    {
      const { container } = renderHeader({ expanded: false });
      const svg = container.querySelector('svg');
      const cls = svg!.getAttribute('class') ?? '';
      expect(cls.toLowerCase()).toContain('chevron-right');
    }
  });

  it('click on chevron invokes onToggleExpanded', () => {
    const onToggleExpanded = vi.fn();
    const { container } = renderHeader({ onToggleExpanded });
    const button = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);
    expect(onToggleExpanded).toHaveBeenCalled();
  });

  it("aria-label is 'Collapse {name}' when expanded; 'Expand {name}' when collapsed", () => {
    {
      const { container } = renderHeader({ sequenceName: 'SEQ_010', expanded: true });
      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBe('Collapse SEQ_010');
      cleanup();
    }
    {
      const { container } = renderHeader({ sequenceName: 'SEQ_010', expanded: false });
      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBe('Expand SEQ_010');
    }
  });

  it('renders mini-pills only for non-zero counts (D-14)', () => {
    const { container } = renderHeader({
      counts: { wip: 0, 'pending-review': 3, approved: 0, 'on-hold': 0, omit: 0 },
    });
    const pills = container.querySelectorAll('[data-status]');
    expect(pills.length).toBe(1);
    expect(pills[0]!.getAttribute('data-status')).toBe('pending-review');
  });

  it('renders zero pills when ALL counts are 0 (D-14 — every bucket hidden)', () => {
    const { container } = renderHeader({
      counts: { wip: 0, 'pending-review': 0, approved: 0, 'on-hold': 0, omit: 0 },
    });
    expect(container.querySelectorAll('[data-status]').length).toBe(0);
  });

  it('renders mini-pills in fixed ORDER (wip → pending-review → approved → on-hold → omit)', () => {
    const { container } = renderHeader({
      counts: { wip: 5, 'pending-review': 3, approved: 12, 'on-hold': 1, omit: 2 },
    });
    const order = Array.from(container.querySelectorAll('[data-status]')).map(
      (el) => el.getAttribute('data-status'),
    );
    expect(order).toEqual(['wip', 'pending-review', 'approved', 'on-hold', 'omit']);
  });

  it("aggregate counts container has role='group' + 'Status counts for {name}' label", () => {
    const { container } = renderHeader({ sequenceName: 'SEQ_030' });
    const group = container.querySelector('[role="group"]');
    expect(group).toBeTruthy();
    expect(group!.getAttribute('aria-label')).toBe('Status counts for SEQ_030');
  });

  it('each mini-pill carries its count + status label', () => {
    const { container } = renderHeader({
      counts: { wip: 5, 'pending-review': 0, approved: 12, 'on-hold': 0, omit: 0 },
    });
    const pills = Array.from(container.querySelectorAll('[data-status]'));
    expect(pills.length).toBe(2);
    // The 'wip' pill contains '5' and 'wip'
    const wipPill = pills.find((p) => p.getAttribute('data-status') === 'wip')!;
    expect(wipPill.textContent).toContain('5');
    expect(wipPill.textContent).toContain('wip');
    const approvedPill = pills.find((p) => p.getAttribute('data-status') === 'approved')!;
    expect(approvedPill.textContent).toContain('12');
    expect(approvedPill.textContent).toContain('approved');
  });
});
