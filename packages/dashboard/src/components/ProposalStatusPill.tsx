/**
 * ProposalStatusPill — inline color-coded badge for a proposal's lifecycle
 * state (proposed | approved | rejected). Mirrors the StatusPill/ShotStatusPill
 * primitive: saturated pill background with --color-bg text for WCAG AA
 * contrast in both themes, uppercase tracking.
 *
 * Palette maps onto the existing shot-status tokens (theme.css) so the whole
 * dashboard reads as one system:
 *   - proposed → pending-review amber (an action is awaited)
 *   - approved → approved green (terminal success)
 *   - rejected → omit slate (a deliberate human decline — NOT an error; a
 *     failed *execution* of an approved proposal surfaces separately as a
 *     destructive callout on the card, never here).
 *
 * Pure component: props-in, no callbacks (read-only display).
 */

import type { ProposalStatus } from '../types/proposals.js';

const STATUS_STYLES: Record<ProposalStatus, string> = {
  proposed:
    'bg-[var(--color-shot-status-pending-review)] text-[var(--color-bg)]',
  approved:
    'bg-[var(--color-shot-status-approved)] text-[var(--color-bg)]',
  rejected:
    'bg-[var(--color-shot-status-omit)] text-[var(--color-bg)]',
};

export interface ProposalStatusPillProps {
  status: ProposalStatus;
}

export function ProposalStatusPill({ status }: ProposalStatusPillProps) {
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${STATUS_STYLES[status]}`}
      data-status={status}
      data-testid="proposal-status-pill"
    >
      {status}
    </span>
  );
}
