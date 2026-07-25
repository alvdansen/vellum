/**
 * ProposalDecisionBar — the approve / reject action pair for a pending
 * proposal (no silent credit spend). Rendered only for
 * status === 'proposed' proposals inside ProposalCard.
 *
 * Single-popover orchestration (mirrors ReviewActionBar): clicking Approve or
 * Reject opens the shared ProposalNotePopover anchored to that button with the
 * matching prompt. Confirm wires to the state-layer decide helpers
 * (approveProposalDecision / rejectProposalDecision), which reload the queue
 * and record any per-row error.
 *
 * Pending discipline: `proposalDecideInFlight` holds the id of the proposal
 * whose decide is in flight (module-global — one decide at a time keeps the
 * at-most-once model honest). While any decide is in flight, BOTH buttons on
 * every card are disabled; the originating button shows its pending label +
 * aria-busy.
 */

import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { ProposalNotePopover } from './ProposalNotePopover.js';
import {
  proposalDecideInFlight,
  approveProposalDecision,
  rejectProposalDecision,
} from '../state/proposals.js';
import {
  PROPOSAL_APPROVE_LABEL,
  PROPOSAL_APPROVE_PENDING,
  PROPOSAL_REJECT_LABEL,
  PROPOSAL_REJECT_PENDING,
  PROPOSAL_APPROVE_ARIA_PREFIX,
  PROPOSAL_REJECT_ARIA_PREFIX,
  PROPOSAL_APPROVE_PROMPT,
  PROPOSAL_REJECT_PROMPT,
  PROPOSAL_DECIDE_CONFIRM,
} from '../lib/copy.js';

type Decision = 'approve' | 'reject';

export interface ProposalDecisionBarProps {
  proposalId: string;
  /** Human descriptor for aria-labels, e.g. "Submit on SH_020". */
  descriptor: string;
}

export function ProposalDecisionBar({
  proposalId,
  descriptor,
}: ProposalDecisionBarProps): JSX.Element {
  const approveRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<Decision | null>(null);

  const inFlight = proposalDecideInFlight.value;
  // Any decide anywhere disables the buttons; the row whose id matches shows
  // the pending label on its originating button.
  const anyPending = inFlight !== null;
  const thisPending = inFlight === proposalId;

  function openPopover(decision: Decision): void {
    if (anyPending) return;
    setOpen(decision);
  }

  async function handleConfirm(note: string | null): Promise<void> {
    const decision = open;
    if (!decision) return;
    if (decision === 'approve') {
      await approveProposalDecision(proposalId, note);
    } else {
      await rejectProposalDecision(proposalId, note);
    }
    // The state helper already reloaded the queue; close regardless of outcome
    // (an error surfaces as the card's inline pill, not a stuck popover).
    setOpen(null);
  }

  return (
    <div class="relative flex flex-wrap gap-2">
      <button
        ref={approveRef}
        type="button"
        data-decision="approve"
        aria-label={`${PROPOSAL_APPROVE_ARIA_PREFIX}${descriptor}`}
        aria-haspopup="dialog"
        aria-expanded={open === 'approve'}
        aria-busy={thisPending ? 'true' : 'false'}
        disabled={anyPending}
        onClick={anyPending ? undefined : () => openPopover('approve')}
        class="rounded border border-[var(--color-shot-status-approved)] bg-[var(--color-shot-status-approved)] px-3 py-1.5 text-sm font-normal text-[var(--color-bg)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {thisPending && open === 'approve'
          ? PROPOSAL_APPROVE_PENDING
          : PROPOSAL_APPROVE_LABEL}
      </button>
      <button
        ref={rejectRef}
        type="button"
        data-decision="reject"
        aria-label={`${PROPOSAL_REJECT_ARIA_PREFIX}${descriptor}`}
        aria-haspopup="dialog"
        aria-expanded={open === 'reject'}
        aria-busy={thisPending ? 'true' : 'false'}
        disabled={anyPending}
        onClick={anyPending ? undefined : () => openPopover('reject')}
        class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-normal text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {thisPending && open === 'reject'
          ? PROPOSAL_REJECT_PENDING
          : PROPOSAL_REJECT_LABEL}
      </button>
      <ProposalNotePopover
        prompt={open === 'reject' ? PROPOSAL_REJECT_PROMPT : PROPOSAL_APPROVE_PROMPT}
        anchorRef={open === 'reject' ? rejectRef : approveRef}
        isOpen={open !== null}
        confirmLabel={PROPOSAL_DECIDE_CONFIRM}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(null)}
      />
    </div>
  );
}
