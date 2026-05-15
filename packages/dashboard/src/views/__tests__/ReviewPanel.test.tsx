/**
 * Phase 22 / Plan 22-05 — ReviewPanel composition tests.
 *
 * Pure-composition smoke tests: ReviewPanel mounts the 3 sub-components
 * with the right props. Detailed behavior of each child is tested in
 * that child's own file (ReviewPanelHeader / ReviewActionBar /
 * ReviewTimeline). Here we verify the layout contract only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ReviewPanel } from '../ReviewPanel.js';
import {
  actionInFlight,
  activeOverlay,
  activeReviewShotId,
  compareSelection,
  compareModalOpen,
  quickApproveError,
} from '../../state/review-panel.js';
import {
  REVIEW_PANEL_ARIA_LABEL_PREFIX,
  REVIEW_PANEL_TITLE_PREFIX,
  REVIEW_PANEL_CLOSE_ARIA,
} from '../../lib/copy.js';

// Stub setShotStatus (ReviewActionBar imports it) so we don't trigger
// real fetch calls in the smoke test.
vi.mock('../../lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api.js')>(
      '../../lib/api.js',
    );
  return {
    ...actual,
    setShotStatus: vi.fn().mockResolvedValue({ status: 'approved', history: [] }),
  };
});

// Stub StatusChangePopover to keep the action-bar tree shallow.
vi.mock('../../components/StatusChangePopover.js', () => ({
  StatusChangePopover: () => null,
}));

beforeEach(() => {
  actionInFlight.value = null;
  activeOverlay.value = null;
  activeReviewShotId.value = null;
  compareSelection.value = { a: null, b: null };
  compareModalOpen.value = false;
  quickApproveError.value = null;
});

afterEach(() => {
  cleanup();
});

describe('ReviewPanel — layout contract', () => {
  it('renders aside with role=dialog and aria-label containing the shot name', () => {
    const { container } = render(
      <ReviewPanel
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
        onClose={() => {}}
      />,
    );
    const aside = container.querySelector('aside[role="dialog"]');
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute('aria-label')).toBe(
      `${REVIEW_PANEL_ARIA_LABEL_PREFIX}SH_010`,
    );
  });

  it('renders ReviewPanelHeader with shot name + title prefix', () => {
    const { getByText } = render(
      <ReviewPanel
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
        onClose={() => {}}
      />,
    );
    expect(getByText(/Review:\s*SH_010/)).toBeTruthy();
  });

  it('Close button has the REVIEW_PANEL_CLOSE_ARIA aria-label and fires onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ReviewPanel
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
        onClose={onClose}
      />,
    );
    const closeBtn = container.querySelector(
      `button[aria-label="${REVIEW_PANEL_CLOSE_ARIA}"]`,
    ) as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the timeline section even when empty', () => {
    const { container } = render(
      <ReviewPanel
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
        onClose={() => {}}
      />,
    );
    // The Shot history section <section> with aria-label exists
    const histSection = container.querySelector(
      'section[aria-label="Shot history"]',
    );
    expect(histSection).not.toBeNull();
  });

  it('renders action bar buttons (Approve at minimum)', () => {
    const { getByRole } = render(
      <ReviewPanel
        shotId="sh-1"
        shotName="SH_010"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
        onClose={() => {}}
      />,
    );
    expect(getByRole('button', { name: /Approve this shot$/ })).toBeTruthy();
  });
});

// Reuse the REVIEW_PANEL_TITLE_PREFIX import so linter doesn't strip it.
void REVIEW_PANEL_TITLE_PREFIX;
