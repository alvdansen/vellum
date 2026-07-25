/**
 * ProposalCard — rendering variants for the approvals queue.
 *
 * Uses the REAL state module (no mock): sets the proposalDecideError signal
 * directly to exercise the inline error pill, and never clicks a decision
 * (that flow is covered by ProposalDecisionBar.test.tsx), so no api call fires.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/preact';
import { ProposalCard } from '../ProposalCard.js';
import { proposalDecideError, proposalDecideInFlight } from '../../state/proposals.js';
import type { Proposal } from '../../types/proposals.js';

function makeProposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop_1',
    shot_id: 'shot_1',
    kind: 'submit',
    provider: 'replicate',
    request_json: '{"model":"flux"}',
    notes: null,
    cost_estimate: '$0.04',
    status: 'proposed',
    created_at: 1000,
    decided_at: null,
    decided_note: null,
    version_id: null,
    execution_error: null,
    ...over,
  };
}

const NOW = 1000 + 2 * 3600_000; // +2h for a stable relative time

beforeEach(() => {
  proposalDecideError.value = null;
  proposalDecideInFlight.value = null;
});

describe('ProposalCard', () => {
  it('renders kind, provider, cost, shot, and the parsed request', () => {
    const { getByTestId, getByText } = render(
      <ProposalCard proposal={makeProposal()} nowMs={NOW} />,
    );
    const card = getByTestId('proposal-card');
    expect(card).toHaveAttribute('data-status', 'proposed');
    expect(getByText('Submit')).toBeInTheDocument();
    expect(getByTestId('provider-badge').textContent).toBe('replicate');
    expect(getByText('$0.04')).toBeInTheDocument();
    expect(getByText('shot_1')).toBeInTheDocument();
    // Parsed request rendered via JsonBlock (pretty-printed)
    expect(card.textContent).toContain('"model": "flux"');
  });

  it('shows the decision bar for a pending proposal', () => {
    const { container } = render(
      <ProposalCard proposal={makeProposal()} nowMs={NOW} />,
    );
    expect(container.querySelector('[data-decision="approve"]')).toBeTruthy();
    expect(container.querySelector('[data-decision="reject"]')).toBeTruthy();
  });

  it('hides the decision bar and shows the version + decided note when approved', () => {
    const { container, getByText, queryByText } = render(
      <ProposalCard
        proposal={makeProposal({
          status: 'approved',
          decided_at: NOW,
          decided_note: 'greenlit',
          version_id: 'ver_9',
        })}
        nowMs={NOW}
      />,
    );
    expect(container.querySelector('[data-decision="approve"]')).toBeNull();
    expect(getByText('ver_9')).toBeInTheDocument();
    expect(getByText('greenlit')).toBeInTheDocument();
    expect(queryByText('Approve')).toBeNull();
  });

  it('surfaces an execution error as an alert on an approved-but-failed proposal', () => {
    const { getByTestId } = render(
      <ProposalCard
        proposal={makeProposal({
          status: 'approved',
          decided_at: NOW,
          execution_error: 'provider 500: upstream timeout',
        })}
        nowMs={NOW}
      />,
    );
    const alert = getByTestId('proposal-execution-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.textContent).toContain('provider 500: upstream timeout');
  });

  it('renders the raw request string when request_json is not valid JSON', () => {
    const { getByTestId } = render(
      <ProposalCard
        proposal={makeProposal({ request_json: 'not-json{' })}
        nowMs={NOW}
      />,
    );
    expect(getByTestId('proposal-card').textContent).toContain('not-json{');
  });

  it('renders no provider badge when provider is null', () => {
    const { queryByTestId } = render(
      <ProposalCard proposal={makeProposal({ provider: null })} nowMs={NOW} />,
    );
    expect(queryByTestId('provider-badge')).toBeNull();
  });

  it('shows the inline decide error pill for the matching proposal id', () => {
    proposalDecideError.value = { id: 'prop_1', message: 'already decided' };
    const { getByTestId } = render(
      <ProposalCard proposal={makeProposal()} nowMs={NOW} />,
    );
    expect(getByTestId('proposal-decide-error').textContent).toContain(
      'already decided',
    );
  });

  it('does NOT show the decide error pill when the error is for another proposal', () => {
    proposalDecideError.value = { id: 'other', message: 'nope' };
    const { queryByTestId } = render(
      <ProposalCard proposal={makeProposal()} nowMs={NOW} />,
    );
    expect(queryByTestId('proposal-decide-error')).toBeNull();
  });
});
