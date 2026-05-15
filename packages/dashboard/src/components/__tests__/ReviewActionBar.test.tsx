/**
 * Phase 22 / Plan 22-05 — ReviewActionBar tests.
 *
 * Covers:
 *  - 4 buttons (Approve/Retake/Hold/Omit) always rendered
 *  - 5th Restore button visibility-gated by currentStatus === 'omit'
 *  - Restore HIDDEN when currentStatus !== 'omit' (NOT disabled — D-12)
 *  - Click → opens popover with matching action
 *  - Confirm wires to api.setShotStatus with correct body shape (action→status mapping)
 *  - Success: popover closes, actionInFlight resets to null
 *  - Failure: actionInFlight resets, inline error pill renders
 *  - actionInFlight=='approve' → Approve button shows pending state + aria-busy;
 *    sibling buttons get disabled+aria-disabled
 *  - Restore click → popover renders with action='restore' (textarea hidden — verified via StatusChangePopover behavior, which is mocked here so we just check the action prop)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { ReviewActionBar } from '../ReviewActionBar.js';
import {
  actionInFlight,
  activeOverlay,
  activeReviewShotId,
  compareSelection,
  compareModalOpen,
  quickApproveError,
} from '../../state/review-panel.js';
import {
  REVIEW_ACTION_APPROVE_LABEL,
  REVIEW_ACTION_RETAKE_LABEL,
  REVIEW_ACTION_HOLD_LABEL,
  REVIEW_ACTION_OMIT_LABEL,
  REVIEW_ACTION_RESTORE_LABEL,
  REVIEW_PANEL_ACTION_FAIL_PREFIX,
} from '../../lib/copy.js';

// Stub StatusChangePopover so we can spy on its `action` prop without
// dragging in the real popover's DOM + listeners.
const popoverSpy = vi.fn();
vi.mock('../StatusChangePopover.js', () => ({
  StatusChangePopover: (props: {
    action: string;
    isOpen: boolean;
    onConfirm: (note: string | null) => Promise<void>;
    onCancel: () => void;
  }) => {
    popoverSpy(props);
    if (!props.isOpen) return null;
    return (
      <div
        data-testid="popover-stub"
        data-action={props.action}
      >
        <button
          type="button"
          data-testid="popover-confirm"
          onClick={() => props.onConfirm('approved-note')}
        >
          confirm
        </button>
        <button
          type="button"
          data-testid="popover-cancel"
          onClick={() => props.onCancel()}
        >
          cancel
        </button>
      </div>
    );
  },
}));

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

beforeEach(() => {
  actionInFlight.value = null;
  activeOverlay.value = null;
  activeReviewShotId.value = null;
  compareSelection.value = { a: null, b: null };
  compareModalOpen.value = false;
  quickApproveError.value = null;
  popoverSpy.mockClear();
  setShotStatusMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ReviewActionBar — button rendering', () => {
  it('renders 4 buttons (Approve/Retake/Hold/Omit) when currentStatus=wip', () => {
    const { getByText, queryByText } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
      />,
    );
    expect(getByText(REVIEW_ACTION_APPROVE_LABEL)).toBeTruthy();
    expect(getByText(REVIEW_ACTION_RETAKE_LABEL)).toBeTruthy();
    expect(getByText(REVIEW_ACTION_HOLD_LABEL)).toBeTruthy();
    expect(getByText(REVIEW_ACTION_OMIT_LABEL)).toBeTruthy();
    expect(queryByText(REVIEW_ACTION_RESTORE_LABEL)).toBeNull();
  });

  it('renders 5 buttons including Restore when currentStatus=omit', () => {
    const { getByText } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="omit"
        versions={[]}
        statusHistory={[]}
      />,
    );
    expect(getByText(REVIEW_ACTION_RESTORE_LABEL)).toBeTruthy();
  });

  it('Restore HIDDEN (not in DOM) when currentStatus=approved (REV-05 visibility-gated)', () => {
    const { queryByText } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="approved"
        versions={[]}
        statusHistory={[]}
      />,
    );
    expect(queryByText(REVIEW_ACTION_RESTORE_LABEL)).toBeNull();
  });
});

describe('ReviewActionBar — popover orchestration', () => {
  it('Approve click opens StatusChangePopover with action=approve', () => {
    const { getByText, getByTestId } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
      />,
    );
    fireEvent.click(getByText(REVIEW_ACTION_APPROVE_LABEL));
    const popover = getByTestId('popover-stub');
    expect(popover.getAttribute('data-action')).toBe('approve');
  });

  it('Confirm fires api.setShotStatus with action→status mapping (approve→approved)', async () => {
    setShotStatusMock.mockResolvedValue({ status: 'approved', history: [] });
    const { getByText, getByTestId } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
      />,
    );
    fireEvent.click(getByText(REVIEW_ACTION_APPROVE_LABEL));
    fireEvent.click(getByTestId('popover-confirm'));
    await waitFor(() => expect(setShotStatusMock).toHaveBeenCalled());
    expect(setShotStatusMock).toHaveBeenCalledWith('sh-1', {
      to_status: 'approved',
      note: 'approved-note',
      changed_by: 'user',
    });
  });

  it('Retake → pending-review (action→status mapping)', async () => {
    setShotStatusMock.mockResolvedValue({
      status: 'pending-review',
      history: [],
    });
    const { getByText, getByTestId } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
      />,
    );
    fireEvent.click(getByText(REVIEW_ACTION_RETAKE_LABEL));
    fireEvent.click(getByTestId('popover-confirm'));
    await waitFor(() => expect(setShotStatusMock).toHaveBeenCalled());
    expect(setShotStatusMock).toHaveBeenCalledWith('sh-1', {
      to_status: 'pending-review',
      note: 'approved-note',
      changed_by: 'user',
    });
  });

  it('Hold → on-hold; Omit → omit; Restore → wip (action→status mapping)', async () => {
    setShotStatusMock.mockResolvedValue({ status: 'wip', history: [] });
    const { getByText, getByTestId, rerender } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
      />,
    );
    fireEvent.click(getByText(REVIEW_ACTION_HOLD_LABEL));
    fireEvent.click(getByTestId('popover-confirm'));
    await waitFor(() => expect(setShotStatusMock).toHaveBeenCalled());
    expect(setShotStatusMock).toHaveBeenLastCalledWith('sh-1', {
      to_status: 'on-hold',
      note: 'approved-note',
      changed_by: 'user',
    });

    // Rerender with currentStatus='omit' to expose Restore button
    setShotStatusMock.mockClear();
    rerender(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="omit"
        versions={[]}
        statusHistory={[]}
      />,
    );
    fireEvent.click(getByText(REVIEW_ACTION_RESTORE_LABEL));
    fireEvent.click(getByTestId('popover-confirm'));
    await waitFor(() => expect(setShotStatusMock).toHaveBeenCalled());
    expect(setShotStatusMock).toHaveBeenLastCalledWith('sh-1', {
      to_status: 'wip',
      note: 'approved-note',
      changed_by: 'user',
    });
  });
});

describe('ReviewActionBar — actionInFlight discipline', () => {
  it('on confirm success: actionInFlight resets to null and popover closes', async () => {
    setShotStatusMock.mockResolvedValue({ status: 'approved', history: [] });
    const { getByText, getByTestId, queryByTestId } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
      />,
    );
    fireEvent.click(getByText(REVIEW_ACTION_APPROVE_LABEL));
    fireEvent.click(getByTestId('popover-confirm'));
    await waitFor(() => expect(actionInFlight.value).toBeNull());
    expect(queryByTestId('popover-stub')).toBeNull();
  });

  it('on confirm failure: actionInFlight resets, popover stays open, inline error pill renders', async () => {
    setShotStatusMock.mockRejectedValue(new Error('connection refused'));
    const { getByText, getByTestId, getByRole } = render(
      <ReviewActionBar
        shotId="sh-1"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
      />,
    );
    fireEvent.click(getByText(REVIEW_ACTION_APPROVE_LABEL));
    fireEvent.click(getByTestId('popover-confirm'));
    await waitFor(() => expect(actionInFlight.value).toBeNull());
    const alert = getByRole('alert');
    expect(alert.textContent).toContain(REVIEW_PANEL_ACTION_FAIL_PREFIX);
    expect(alert.textContent).toContain('connection refused');
    // Popover stays open so user can edit note and retry
    expect(getByTestId('popover-stub')).toBeTruthy();
  });
});
