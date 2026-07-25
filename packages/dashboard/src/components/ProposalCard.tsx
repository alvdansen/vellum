/**
 * ProposalCard — one proposal row in the ApprovalsPanel queue (no silent
 * credit spend). Renders the reviewable facts of a proposed generation:
 * kind, provider, cost estimate, status, the shot it targets, the proposer's
 * note, and the VERBATIM request (parsed from request_json for review). For a
 * pending proposal it also renders the approve/reject decision bar; for a
 * decided proposal it surfaces the decision note, the linked version, and any
 * execution error.
 *
 * Pure-ish: reads the proposalDecideError signal to render the row's inline
 * failure pill, but owns no fetch. All decision side effects run through
 * ProposalDecisionBar → the state-layer helpers.
 *
 * SECURITY — T-5-06: every dynamic value (provider, cost, notes, request,
 * error) renders as a JSX text child or through JsonBlock (JSON.stringify in a
 * <pre>) — Preact auto-escapes; no dangerouslySetInnerHTML.
 */

import type { JSX } from 'preact';
import type { Proposal, ProposalKind } from '../types/proposals.js';
import { ProviderBadge } from './ProviderBadge.js';
import { ProposalStatusPill } from './ProposalStatusPill.js';
import { ProposalDecisionBar } from './ProposalDecisionBar.js';
import { JsonBlock } from './JsonBlock.js';
import { parseProposalRequest, proposalDecideError } from '../state/proposals.js';
import { formatRelativeTime } from '../lib/time.js';
import {
  PROPOSAL_KIND_SUBMIT,
  PROPOSAL_KIND_REPRODUCE,
  PROPOSAL_KIND_ITERATE,
  PROPOSAL_COST_LABEL,
  PROPOSAL_COST_UNKNOWN,
  PROPOSAL_SHOT_LABEL,
  PROPOSAL_NOTES_LABEL,
  PROPOSAL_REQUEST_LABEL,
  PROPOSAL_DECIDED_NOTE_LABEL,
  PROPOSAL_VERSION_LABEL,
  PROPOSAL_EXECUTION_ERROR_LABEL,
  PROPOSAL_CREATED_PREFIX,
  PROPOSAL_DECIDED_PREFIX,
  PROPOSAL_DECIDE_FAIL_PREFIX,
} from '../lib/copy.js';

const KIND_LABEL: Record<ProposalKind, string> = {
  submit: PROPOSAL_KIND_SUBMIT,
  reproduce: PROPOSAL_KIND_REPRODUCE,
  iterate: PROPOSAL_KIND_ITERATE,
};

export interface ProposalCardProps {
  proposal: Proposal;
  /** Reference time for the relative "Proposed 2h ago" label (testability). */
  nowMs?: number;
}

/** Small uppercase field label + value on one line. */
function Field({
  label,
  children,
}: {
  label: string;
  children: JSX.Element | string;
}): JSX.Element {
  return (
    <div class="flex items-baseline gap-2 text-sm">
      <span class="label-uppercase shrink-0 text-xs text-[var(--color-fg-muted)]">
        {label}
      </span>
      <span class="min-w-0 break-words text-[var(--color-fg)]">{children}</span>
    </div>
  );
}

export function ProposalCard({ proposal, nowMs }: ProposalCardProps): JSX.Element {
  const parsed = parseProposalRequest(proposal);
  const decideError = proposalDecideError.value;
  const rowError =
    decideError && decideError.id === proposal.id ? decideError.message : null;
  const isPending = proposal.status === 'proposed';
  const descriptor = `${KIND_LABEL[proposal.kind]} on ${proposal.shot_id}`;

  return (
    <article
      class="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      data-testid="proposal-card"
      data-proposal-id={proposal.id}
      data-status={proposal.status}
    >
      {/* Header row: kind + provider + status + cost + time */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold text-[var(--color-fg)]" style={{ fontFamily: 'var(--font-display)' }}>
          {KIND_LABEL[proposal.kind]}
        </span>
        <ProviderBadge provider={proposal.provider} />
        <ProposalStatusPill status={proposal.status} />
        <span class="ml-auto text-xs tabular-nums text-[var(--color-fg-muted)]">
          {PROPOSAL_CREATED_PREFIX}
          {formatRelativeTime(proposal.created_at, nowMs)}
        </span>
      </div>

      {/* Cost estimate — the number a reviewer authorizes */}
      <Field label={PROPOSAL_COST_LABEL}>
        <span class="tabular-nums">
          {proposal.cost_estimate ?? PROPOSAL_COST_UNKNOWN}
        </span>
      </Field>

      {/* Which shot this spends on */}
      <Field label={PROPOSAL_SHOT_LABEL}>
        <span class="font-mono text-xs" style={{ fontFamily: 'var(--font-mono)' }}>
          {proposal.shot_id}
        </span>
      </Field>

      {/* Proposer note */}
      {proposal.notes ? (
        <Field label={PROPOSAL_NOTES_LABEL}>{proposal.notes}</Field>
      ) : null}

      {/* Verbatim request — the exact payload that will spend credits */}
      <div class="flex flex-col gap-1">
        <span class="label-uppercase text-xs text-[var(--color-fg-muted)]">
          {PROPOSAL_REQUEST_LABEL}
        </span>
        {parsed.ok ? (
          <JsonBlock data={parsed.value} />
        ) : (
          <pre
            class="overflow-auto rounded bg-[var(--color-surface-alt)] p-3 font-mono text-xs text-[var(--color-fg-muted)] whitespace-pre-wrap"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {parsed.raw}
          </pre>
        )}
      </div>

      {/* Decided-state detail */}
      {!isPending ? (
        <div class="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-3">
          {proposal.decided_at !== null ? (
            <span class="text-xs tabular-nums text-[var(--color-fg-muted)]">
              {PROPOSAL_DECIDED_PREFIX}
              {formatRelativeTime(proposal.decided_at, nowMs)}
            </span>
          ) : null}
          {proposal.decided_note ? (
            <Field label={PROPOSAL_DECIDED_NOTE_LABEL}>
              {proposal.decided_note}
            </Field>
          ) : null}
          {proposal.version_id ? (
            <Field label={PROPOSAL_VERSION_LABEL}>
              <span class="font-mono text-xs" style={{ fontFamily: 'var(--font-mono)' }}>
                {proposal.version_id}
              </span>
            </Field>
          ) : null}
          {proposal.execution_error ? (
            <div
              role="alert"
              data-testid="proposal-execution-error"
              class="rounded border border-[var(--color-destructive)] bg-[var(--color-destructive)]/15 p-2 text-sm text-[var(--color-fg)]"
            >
              <span class="label-uppercase mr-2 text-xs text-[var(--color-destructive)]">
                {PROPOSAL_EXECUTION_ERROR_LABEL}
              </span>
              {proposal.execution_error}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Inline decide failure (approve/reject HTTP error) */}
      {rowError ? (
        <div
          role="alert"
          data-testid="proposal-decide-error"
          class="rounded bg-[var(--color-status-running)]/20 p-2 text-sm text-[var(--color-fg)]"
        >
          {PROPOSAL_DECIDE_FAIL_PREFIX}
          {rowError}
        </div>
      ) : null}

      {/* Decision actions (pending only) */}
      {isPending ? (
        <ProposalDecisionBar proposalId={proposal.id} descriptor={descriptor} />
      ) : null}
    </article>
  );
}
