/**
 * ProposalDecisionBar — approve/reject popover orchestration + in-flight
 * disabling. Mocks the state-layer decide helpers with spies (keeping the real
 * signals via importActual) and drives the real ProposalNotePopover.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';

const approveSpy = vi.fn();
const rejectSpy = vi.fn();

vi.mock('../../state/proposals.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../state/proposals.js')>(
      '../../state/proposals.js',
    );
  return {
    ...actual,
    approveProposalDecision: (...a: unknown[]) => approveSpy(...a),
    rejectProposalDecision: (...a: unknown[]) => rejectSpy(...a),
  };
});

import { ProposalDecisionBar } from '../ProposalDecisionBar.js';
import { proposalDecideInFlight } from '../../state/proposals.js';

beforeEach(() => {
  approveSpy.mockReset().mockResolvedValue(undefined);
  rejectSpy.mockReset().mockResolvedValue(undefined);
  proposalDecideInFlight.value = null;
});

describe('ProposalDecisionBar', () => {
  it('opens the approve popover and confirms → approveProposalDecision(id, note)', async () => {
    const { container, getByLabelText, getByText } = render(
      <ProposalDecisionBar proposalId="prop_1" descriptor="Submit on shot_1" />,
    );
    fireEvent.click(container.querySelector('[data-decision="approve"]')!);
    // Popover textarea appears
    const textarea = getByLabelText('Decision note') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'ship it' } });
    fireEvent.click(getByText('Confirm'));
    await waitFor(() =>
      expect(approveSpy).toHaveBeenCalledWith('prop_1', 'ship it'),
    );
    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it('opens the reject popover and confirms with a null note when blank', async () => {
    const { container, getByText } = render(
      <ProposalDecisionBar proposalId="prop_2" descriptor="Iterate on shot_2" />,
    );
    fireEvent.click(container.querySelector('[data-decision="reject"]')!);
    fireEvent.click(getByText('Confirm'));
    await waitFor(() => expect(rejectSpy).toHaveBeenCalledWith('prop_2', null));
  });

  it('disables both buttons while another row is deciding', () => {
    proposalDecideInFlight.value = 'some-other-id';
    const { container } = render(
      <ProposalDecisionBar proposalId="prop_3" descriptor="Submit on shot_3" />,
    );
    const approve = container.querySelector(
      '[data-decision="approve"]',
    ) as HTMLButtonElement;
    const reject = container.querySelector(
      '[data-decision="reject"]',
    ) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(reject.disabled).toBe(true);
    // Not THIS row → no pending label, aria-busy false
    expect(approve.textContent).toBe('Approve');
    expect(approve).toHaveAttribute('aria-busy', 'false');
  });

  it('shows the pending label + aria-busy on the button of the deciding row', async () => {
    // A never-resolving approve keeps the row in-flight so we can observe the
    // originating button's pending state (label swap + aria-busy='true').
    let resolve: () => void = () => {};
    approveSpy.mockImplementation(() => {
      proposalDecideInFlight.value = 'prop_5';
      return new Promise<void>((r) => {
        resolve = r;
      });
    });
    const { container, getByText } = render(
      <ProposalDecisionBar proposalId="prop_5" descriptor="Submit on shot_5" />,
    );
    fireEvent.click(container.querySelector('[data-decision="approve"]')!);
    fireEvent.click(getByText('Confirm'));
    const approve = container.querySelector(
      '[data-decision="approve"]',
    ) as HTMLButtonElement;
    await waitFor(() => expect(approve.textContent).toBe('Approving…'));
    expect(approve).toHaveAttribute('aria-busy', 'true');
    // The sibling reject button does NOT show the pending label.
    const reject = container.querySelector(
      '[data-decision="reject"]',
    ) as HTMLButtonElement;
    expect(reject.textContent).toBe('Reject');
    resolve();
  });

  it('cancel closes the popover without deciding', () => {
    const { container, getByText, queryByText } = render(
      <ProposalDecisionBar proposalId="prop_4" descriptor="Submit on shot_4" />,
    );
    fireEvent.click(container.querySelector('[data-decision="approve"]')!);
    expect(getByText('Cancel')).toBeInTheDocument();
    fireEvent.click(getByText('Cancel'));
    expect(queryByText('Cancel')).toBeNull();
    expect(approveSpy).not.toHaveBeenCalled();
  });
});
