/**
 * Phase 22 / Plan 22-05 — ReviewActionBar.
 *
 * Sticky-top button row inside ReviewPanel. Composes 4 action buttons
 * (Approve / Request Retake / Hold / Omit) + a conditional Restore button
 * when currentStatus === 'omit' (REV-05 visibility-gated, NOT disabled).
 *
 * Single popover orchestration: clicking any action button opens the
 * shared StatusChangePopover anchored to that button. Confirm wires to
 * api.setShotStatus → server-side engine path; on success the popover
 * closes; on error the popover stays open with an inline error pill above
 * the action bar.
 *
 * Action → ShotStatus mapping (REV-01 + REV-05):
 *   approve  → 'approved'
 *   retake   → 'pending-review'   (semantic: "request a new pass")
 *   hold     → 'on-hold'
 *   omit     → 'omit'
 *   restore  → 'wip'              (REV-05 lock)
 *
 * Pending discipline: actionInFlight signal holds the verb mid-PATCH;
 * the originating button shows aria-busy + pending label; sibling buttons
 * receive disabled=true. Reset to null in try/finally so a thrown error
 * never strands the bar.
 */

import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Version } from '../types/entities.js';
import type {
  ReviewAction,
  ShotStatusEvent,
} from '../types/review-panel.js';
import type { ShotStatus } from '../types/shot-grid.js';
import { ReviewActionButton } from './ReviewActionButton.js';
import { StatusChangePopover } from './StatusChangePopover.js';
import { actionInFlight } from '../state/review-panel.js';
import { setShotStatus } from '../lib/api.js';
import {
  REVIEW_ACTION_APPROVE_ARIA,
  REVIEW_ACTION_RETAKE_ARIA,
  REVIEW_ACTION_HOLD_ARIA,
  REVIEW_ACTION_OMIT_ARIA,
  REVIEW_ACTION_RESTORE_ARIA,
  REVIEW_PANEL_ACTION_FAIL_PREFIX,
} from '../lib/copy.js';

const ARIA: Record<ReviewAction, string> = {
  approve: REVIEW_ACTION_APPROVE_ARIA,
  retake: REVIEW_ACTION_RETAKE_ARIA,
  hold: REVIEW_ACTION_HOLD_ARIA,
  omit: REVIEW_ACTION_OMIT_ARIA,
  restore: REVIEW_ACTION_RESTORE_ARIA,
};

function actionToStatus(action: ReviewAction): ShotStatus {
  switch (action) {
    case 'approve':
      return 'approved';
    case 'retake':
      return 'pending-review';
    case 'hold':
      return 'on-hold';
    case 'omit':
      return 'omit';
    case 'restore':
      return 'wip';
  }
}

export interface ReviewActionBarProps {
  shotId: string;
  currentStatus: ShotStatus;
  versions: readonly Version[];
  statusHistory: readonly ShotStatusEvent[];
}

export function ReviewActionBar({
  shotId,
  currentStatus,
}: ReviewActionBarProps): JSX.Element {
  // One ref per action (stable hook order — refs declared even when the
  // corresponding button is hidden so the hook count is consistent).
  const approveRef = useRef<HTMLButtonElement>(null);
  const retakeRef = useRef<HTMLButtonElement>(null);
  const holdRef = useRef<HTMLButtonElement>(null);
  const omitRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);

  const [popover, setPopover] = useState<{
    open: boolean;
    action: ReviewAction | null;
  }>({ open: false, action: null });
  const [error, setError] = useState<{ message: string } | null>(null);

  const pending = actionInFlight.value;
  const showRestore = currentStatus === 'omit';

  function refForAction(action: ReviewAction) {
    switch (action) {
      case 'approve':
        return approveRef;
      case 'retake':
        return retakeRef;
      case 'hold':
        return holdRef;
      case 'omit':
        return omitRef;
      case 'restore':
        return restoreRef;
    }
  }

  function openPopover(action: ReviewAction): void {
    if (pending !== null) return;
    setError(null);
    setPopover({ open: true, action });
  }

  async function handleConfirm(note: string | null): Promise<void> {
    const action = popover.action;
    if (!action) return;
    const toStatus = actionToStatus(action);
    actionInFlight.value = action;
    try {
      await setShotStatus(shotId, {
        to_status: toStatus,
        note,
        changed_by: 'user',
      });
      setPopover({ open: false, action: null });
      setError(null);
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message ? err.message : 'server error';
      setError({
        message: `${REVIEW_PANEL_ACTION_FAIL_PREFIX}${msg} — retry`,
      });
      // Popover stays open so the user can edit the note and retry.
    } finally {
      actionInFlight.value = null;
    }
  }

  function handleCancel(): void {
    setPopover({ open: false, action: null });
  }

  // Anchor ref for the currently-open popover (defensive fallback when no
  // action is selected — uses approveRef so the popover never crashes
  // when isOpen=false; it doesn't render anyway).
  const anchorRef = popover.action
    ? refForAction(popover.action)
    : approveRef;

  return (
    <div class="flex flex-col gap-2">
      {error ? (
        <div
          role="alert"
          class="rounded bg-[var(--color-status-running)]/20 p-2 text-sm text-[var(--color-fg)]"
        >
          {error.message}
        </div>
      ) : null}
      <div class="sticky top-0 z-1 flex flex-wrap gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] py-2 relative">
        <ReviewActionButton
          ref={approveRef}
          action="approve"
          ariaLabel={ARIA.approve}
          disabled={pending !== null && pending !== 'approve'}
          isPending={pending === 'approve'}
          popoverIsOpen={popover.open && popover.action === 'approve'}
          onClick={() => openPopover('approve')}
        />
        <ReviewActionButton
          ref={retakeRef}
          action="retake"
          ariaLabel={ARIA.retake}
          disabled={pending !== null && pending !== 'retake'}
          isPending={pending === 'retake'}
          popoverIsOpen={popover.open && popover.action === 'retake'}
          onClick={() => openPopover('retake')}
        />
        <ReviewActionButton
          ref={holdRef}
          action="hold"
          ariaLabel={ARIA.hold}
          disabled={pending !== null && pending !== 'hold'}
          isPending={pending === 'hold'}
          popoverIsOpen={popover.open && popover.action === 'hold'}
          onClick={() => openPopover('hold')}
        />
        <ReviewActionButton
          ref={omitRef}
          action="omit"
          ariaLabel={ARIA.omit}
          disabled={pending !== null && pending !== 'omit'}
          isPending={pending === 'omit'}
          popoverIsOpen={popover.open && popover.action === 'omit'}
          onClick={() => openPopover('omit')}
        />
        {showRestore ? (
          <ReviewActionButton
            ref={restoreRef}
            action="restore"
            ariaLabel={ARIA.restore}
            disabled={pending !== null && pending !== 'restore'}
            isPending={pending === 'restore'}
            popoverIsOpen={popover.open && popover.action === 'restore'}
            onClick={() => openPopover('restore')}
          />
        ) : null}
        <StatusChangePopover
          action={popover.action ?? 'approve'}
          anchorRef={anchorRef}
          isOpen={popover.open && popover.action !== null}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}
