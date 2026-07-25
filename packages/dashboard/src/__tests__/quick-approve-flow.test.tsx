/**
 * Phase 22 / Plan 22-07 — Quick-approve optimistic flow integration test.
 *
 * Covers REV-02 + D-12 + Pitfall 5 (timer guard):
 *  - Optimistic mutation: shotGrid.value.shots[idx].status='approved' fires
 *    BEFORE the PATCH resolves
 *  - On success: no extra mutation; SSE would converge in real env
 *  - On failure: revert shotGrid + set quickApproveError = shotId
 *  - Auto-dismiss after 5s with Pitfall 5 guard (no-op when value changed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { QuickApproveButton } from '../components/QuickApproveButton.js';
import { shotGrid, onShotStatusChanged } from '../state/shot-grid.js';
import {
  quickApproveError,
  activeOverlay,
  activeReviewShotId,
  compareSelection,
  compareModalOpen,
  actionInFlight,
} from '../state/review-panel.js';

const setShotStatusMock = vi.fn();
vi.mock('../lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js');
  return {
    ...actual,
    setShotStatus: (...args: unknown[]) => setShotStatusMock(...args),
  };
});

// Stub popover so confirm flows through cleanly without DOM machinery.
vi.mock('../components/StatusChangePopover.js', () => ({
  StatusChangePopover: (props: {
    isOpen: boolean;
    onConfirm: (note: string | null) => Promise<void>;
    onCancel: () => void;
  }) => {
    if (!props.isOpen) return null;
    return (
      <div data-testid="popover-stub">
        <button
          type="button"
          data-testid="popover-confirm"
          onClick={() => props.onConfirm(null)}
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

const SEQ_ID = 'seq-test';
function makeShotGridShape(shotId: string, status: string) {
  return {
    sequence: {
      id: SEQ_ID,
      name: 'TestSeq',
      project_id: 'proj-1',
      created_at: 0,
    },
    shots: [
      {
        id: shotId,
        name: 'SH_010',
        status,
        version_count: 1,
        latest_completed_version: null,
      },
    ],
    next_cursor: null,
    total_count: 1,
  };
}

beforeEach(() => {
  setShotStatusMock.mockReset();
  activeOverlay.value = null;
  activeReviewShotId.value = null;
  compareSelection.value = { a: null, b: null };
  compareModalOpen.value = false;
  quickApproveError.value = null;
  actionInFlight.value = null;
  shotGrid.value = makeShotGridShape('sh-A', 'wip') as never;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Quick-approve flow — optimistic + revert + WarningPill (REV-02, D-12)', () => {
  it('Confirm fires PATCH; shotGrid shot status flips to approved IMMEDIATELY (before PATCH resolves)', async () => {
    // Never-resolving promise so we can observe the optimistic-mutation state
    let resolveSetStatus: () => void = () => {};
    setShotStatusMock.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveSetStatus = r;
        }),
    );
    const { container, getByTestId } = render(
      <QuickApproveButton
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    fireEvent.click(getByTestId('popover-confirm'));
    // Optimistic mutation happened immediately
    expect(
      (shotGrid.value as unknown as { shots: { status: string }[] } | null)
        ?.shots[0].status,
    ).toBe('approved');
    expect(setShotStatusMock).toHaveBeenCalledWith('sh-A', {
      to_status: 'approved',
      note: null,
      changed_by: 'user',
    });
    // Resolve the pending PATCH; no further mutation expected.
    resolveSetStatus();
    await Promise.resolve();
    expect(
      (shotGrid.value as unknown as { shots: { status: string }[] } | null)
        ?.shots[0].status,
    ).toBe('approved');
  });

  it('SSE arrival after success is idempotent (no-op)', async () => {
    setShotStatusMock.mockResolvedValue({ status: 'approved', history: [] });
    const { container, getByTestId } = render(
      <QuickApproveButton
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    fireEvent.click(getByTestId('popover-confirm'));
    await waitFor(() => expect(setShotStatusMock).toHaveBeenCalled());
    // Simulate SSE
    onShotStatusChanged({
      sequenceId: SEQ_ID,
      shotId: 'sh-A',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });
    expect(
      (shotGrid.value as unknown as { shots: { status: string }[] } | null)
        ?.shots[0].status,
    ).toBe('approved');
  });

  it('on PATCH failure: shotGrid reverts to prior status AND quickApproveError = shotId', async () => {
    setShotStatusMock.mockRejectedValue(new Error('500'));
    const { container, getByTestId } = render(
      <QuickApproveButton
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    fireEvent.click(getByTestId('popover-confirm'));
    await waitFor(() => expect(quickApproveError.value).toBe('sh-A'));
    // Status reverted
    expect(
      (shotGrid.value as unknown as { shots: { status: string }[] } | null)
        ?.shots[0].status,
    ).toBe('wip');
  });

  it('quickApproveError auto-dismisses after 5s (Pitfall 5 guard active)', async () => {
    vi.useFakeTimers();
    setShotStatusMock.mockRejectedValue(new Error('500'));
    const { container, getByTestId } = render(
      <QuickApproveButton
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    fireEvent.click(getByTestId('popover-confirm'));
    // Allow the rejected Promise to flush its catch handler
    // Flush microtasks so the rejected PATCH's catch handler runs
    await Promise.resolve();
    await Promise.resolve();
    expect(quickApproveError.value).toBe('sh-A');
    // Advance 5s
    vi.advanceTimersByTime(5000);
    expect(quickApproveError.value).toBeNull();
  });

  it('Pitfall 5: stale timer no-ops when quickApproveError was cleared early', async () => {
    vi.useFakeTimers();
    setShotStatusMock.mockRejectedValue(new Error('500'));
    const { container, getByTestId } = render(
      <QuickApproveButton
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    fireEvent.click(getByTestId('popover-confirm'));
    // Flush microtasks so the rejected PATCH's catch handler runs
    await Promise.resolve();
    await Promise.resolve();
    expect(quickApproveError.value).toBe('sh-A');
    // Externally clear the error before the 5s timer fires
    quickApproveError.value = null;
    // Externally set it again to a DIFFERENT shotId (simulating another failure)
    quickApproveError.value = 'sh-B';
    // Advance original 5s timer — should NOT overwrite the 'sh-B' value
    vi.advanceTimersByTime(5000);
    expect(quickApproveError.value).toBe('sh-B');
  });

  it('Cancel closes popover without firing PATCH and without mutating state', async () => {
    setShotStatusMock.mockResolvedValue({ status: 'approved', history: [] });
    const { container, getByTestId } = render(
      <QuickApproveButton
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="wip"
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    fireEvent.click(getByTestId('popover-cancel'));
    expect(setShotStatusMock).not.toHaveBeenCalled();
    expect(
      (shotGrid.value as unknown as { shots: { status: string }[] } | null)
        ?.shots[0].status,
    ).toBe('wip');
  });
});
