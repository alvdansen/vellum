/**
 * Phase 22 / Plan 22-07 — QuickApproveButton unit tests.
 *
 * Covers D-10 (hover-only opacity) + popover anchor + ARIA contract.
 * The full optimistic-flow integration is in quick-approve-flow.test.tsx;
 * this file is the structural unit test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { QuickApproveButton } from '../QuickApproveButton.js';
import { quickApproveError } from '../../state/review-panel.js';
import { shotGrid } from '../../state/shot-grid.js';
import {
  REVIEW_QUICK_APPROVE_ARIA_PREFIX,
} from '../../lib/copy.js';

// Stub setShotStatus so click flow doesn't make real requests.
const setShotStatusMock = vi.fn();
vi.mock('../../lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api.js')>(
      '../../lib/api.js',
    );
  return {
    ...actual,
    setShotStatus: (...args: unknown[]) => setShotStatusMock(...args),
  };
});

// Stub the popover so click opens it without dragging in real popover DOM.
const popoverSpy = vi.fn();
vi.mock('../StatusChangePopover.js', () => ({
  StatusChangePopover: (props: { action: string; isOpen: boolean }) => {
    popoverSpy(props);
    return props.isOpen ? (
      <div data-testid="popover-stub" data-action={props.action} />
    ) : null;
  },
}));

beforeEach(() => {
  setShotStatusMock.mockReset();
  popoverSpy.mockClear();
  quickApproveError.value = null;
  shotGrid.value = null;
});

afterEach(() => {
  cleanup();
});

describe('QuickApproveButton — structure', () => {
  it('renders a button with REVIEW_QUICK_APPROVE_ARIA_PREFIX + shotName as aria-label', () => {
    const { container } = render(
      <QuickApproveButton
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    const btn = container.querySelector('button') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe(
      `${REVIEW_QUICK_APPROVE_ARIA_PREFIX}SH_010`,
    );
  });

  it('button has aria-haspopup="dialog" (command-button pattern per UI-SPEC L717)', () => {
    const { container } = render(
      <QuickApproveButton
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    const btn = container.querySelector('button');
    expect(btn?.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('button class contains opacity-0 + group-hover:opacity-100 (D-10 hover-only)', () => {
    const { container } = render(
      <QuickApproveButton
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('opacity-0');
    expect(btn?.className).toContain('group-hover:opacity-100');
  });
});

describe('QuickApproveButton — popover interaction', () => {
  it('click on button opens StatusChangePopover with action=approve', () => {
    const { container, getByTestId } = render(
      <QuickApproveButton
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    const btn = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(btn);
    const popover = getByTestId('popover-stub');
    expect(popover.getAttribute('data-action')).toBe('approve');
  });

  it('after click, button aria-expanded flips to true', () => {
    const { container } = render(
      <QuickApproveButton
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('popover initially closed (isOpen=false) — no popover-stub in DOM', () => {
    const { queryByTestId } = render(
      <QuickApproveButton
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    expect(queryByTestId('popover-stub')).toBeNull();
  });
});

describe('QuickApproveButton — positioned absolutely top-right', () => {
  it('button has absolute top-1 right-1 classes for thumbnail-corner positioning', () => {
    const { container } = render(
      <QuickApproveButton
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('absolute');
    expect(btn?.className).toContain('top-1');
    expect(btn?.className).toContain('right-1');
  });
});
