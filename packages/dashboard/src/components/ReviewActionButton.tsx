/**
 * Phase 22 / Plan 22-05 — ReviewActionButton.
 *
 * Single reusable button used in the review-panel action bar (one per
 * action). Per UI-SPEC L717 these are COMMAND buttons (open a popover),
 * not toggle buttons — so the ARIA pattern is `aria-haspopup="dialog"` +
 * `aria-expanded={popoverIsOpen}`, NOT `aria-pressed`.
 *
 * Disabled discipline (D-12):
 *  - `disabled` (HTML attr) AND `aria-disabled={disabled || isPending}`
 *    so screen readers announce the state.
 *  - `aria-busy={isPending}` marks the originating button during its
 *    own PATCH. Sibling buttons get `disabled={true}` from the parent
 *    (ReviewActionBar) so the user can't fire two transitions in flight.
 *  - `onClick` guarded: when disabled or pending, undefined (no handler).
 *
 * Label switches to a per-action "Pending" copy when `isPending` is true.
 */

import { forwardRef } from 'preact/compat';
import type { JSX, Ref } from 'preact';
import type { ReviewAction } from '../types/review-panel.js';
import {
  REVIEW_ACTION_APPROVE_LABEL,
  REVIEW_ACTION_RETAKE_LABEL,
  REVIEW_ACTION_HOLD_LABEL,
  REVIEW_ACTION_OMIT_LABEL,
  REVIEW_ACTION_RESTORE_LABEL,
  REVIEW_ACTION_APPROVE_PENDING,
  REVIEW_ACTION_RETAKE_PENDING,
  REVIEW_ACTION_HOLD_PENDING,
  REVIEW_ACTION_OMIT_PENDING,
  REVIEW_ACTION_RESTORE_PENDING,
} from '../lib/copy.js';

const LABELS: Record<ReviewAction, { default: string; pending: string }> = {
  approve: {
    default: REVIEW_ACTION_APPROVE_LABEL,
    pending: REVIEW_ACTION_APPROVE_PENDING,
  },
  retake: {
    default: REVIEW_ACTION_RETAKE_LABEL,
    pending: REVIEW_ACTION_RETAKE_PENDING,
  },
  hold: {
    default: REVIEW_ACTION_HOLD_LABEL,
    pending: REVIEW_ACTION_HOLD_PENDING,
  },
  omit: {
    default: REVIEW_ACTION_OMIT_LABEL,
    pending: REVIEW_ACTION_OMIT_PENDING,
  },
  restore: {
    default: REVIEW_ACTION_RESTORE_LABEL,
    pending: REVIEW_ACTION_RESTORE_PENDING,
  },
};

export interface ReviewActionButtonProps {
  action: ReviewAction;
  ariaLabel: string;
  disabled: boolean;
  isPending: boolean;
  popoverIsOpen: boolean;
  onClick: () => void;
}

export const ReviewActionButton = forwardRef<
  HTMLButtonElement,
  ReviewActionButtonProps
>(function ReviewActionButton(
  { action, ariaLabel, disabled, isPending, popoverIsOpen, onClick }: ReviewActionButtonProps,
  ref: Ref<HTMLButtonElement>,
): JSX.Element {
  const isDisabled = disabled || isPending;
  return (
    <button
      ref={ref}
      type="button"
      data-action={action}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={popoverIsOpen}
      aria-disabled={isDisabled || undefined}
      aria-busy={isPending ? 'true' : 'false'}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-normal text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? LABELS[action].pending : LABELS[action].default}
    </button>
  );
});
