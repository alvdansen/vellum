/**
 * ApprovalsPanel — mount fetch, states (loading / empty / error / list),
 * stat tiles, and filter-tab wiring.
 *
 * Mocks the state-layer orchestration functions (refreshProposals /
 * loadProposals / setProposalsFilter) with spies while keeping the real
 * signals (importActual), which the test sets directly to drive each state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

const refreshSpy = vi.fn();
const loadSpy = vi.fn();
const setFilterSpy = vi.fn();

vi.mock('../state/proposals.js', async () => {
  const actual =
    await vi.importActual<typeof import('../state/proposals.js')>(
      '../state/proposals.js',
    );
  return {
    ...actual,
    refreshProposals: (...a: unknown[]) => refreshSpy(...a),
    loadProposals: (...a: unknown[]) => loadSpy(...a),
    setProposalsFilter: (...a: unknown[]) => setFilterSpy(...a),
  };
});

import { ApprovalsPanel } from '../views/ApprovalsPanel.js';
import {
  proposals,
  proposalsFilter,
  proposalsIsFetching,
  proposalsError,
  proposalCounts,
  proposalDecideError,
  proposalDecideInFlight,
} from '../state/proposals.js';
import type { Proposal, ProposalListResponse } from '../types/proposals.js';

function makeProposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop_1',
    shot_id: 'shot_1',
    kind: 'submit',
    provider: 'replicate',
    request_json: '{"a":1}',
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

function listOf(items: Proposal[], total = items.length): ProposalListResponse {
  return { items, total_count: total, limit: 20, offset: 0 };
}

beforeEach(() => {
  refreshSpy.mockReset().mockResolvedValue(undefined);
  loadSpy.mockReset().mockResolvedValue(undefined);
  setFilterSpy.mockReset().mockResolvedValue(undefined);
  proposals.value = null;
  proposalsFilter.value = 'proposed';
  proposalsIsFetching.value = false;
  proposalsError.value = null;
  proposalCounts.value = null;
  proposalDecideError.value = null;
  proposalDecideInFlight.value = null;
});

describe('ApprovalsPanel', () => {
  it('calls refreshProposals on mount', () => {
    render(<ApprovalsPanel />);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the loading skeleton before the first fetch resolves', () => {
    proposals.value = null;
    proposalsIsFetching.value = true;
    const { getByTestId } = render(<ApprovalsPanel />);
    expect(getByTestId('approvals-loading')).toBeInTheDocument();
  });

  it('renders the filter-specific empty state', () => {
    proposals.value = listOf([]);
    proposalsFilter.value = 'proposed';
    const { getByText } = render(<ApprovalsPanel />);
    expect(
      getByText('No pending proposals — nothing is waiting to spend credits.'),
    ).toBeInTheDocument();
  });

  it('renders the full-screen error surface with Retry when nothing was ever loaded', () => {
    proposals.value = null;
    proposalsError.value = 'boom';
    const { getByText, queryByTestId } = render(<ApprovalsPanel />);
    // No preserved buffer → the whole body is the error surface, no list.
    expect(queryByTestId('approvals-inline-error')).toBeNull();
    const retry = getByText('Retry');
    fireEvent.click(retry);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the preserved list and shows an inline error banner on a transient refresh failure', () => {
    // loadProposals preserves the prior buffer on error; the panel must show
    // that buffer with a banner, NOT blank it with a full-screen error (e.g. a
    // successful decide whose follow-up refresh timed out).
    proposals.value = listOf([makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })]);
    proposalsError.value = 'refresh failed';
    const { getAllByTestId, getByTestId } = render(<ApprovalsPanel />);
    // The 2 cached cards are still visible.
    expect(getAllByTestId('proposal-card')).toHaveLength(2);
    // And an inline banner (with its own Retry) sits above them.
    const banner = getByTestId('approvals-inline-error');
    expect(banner).toBeInTheDocument();
    fireEvent.click(banner.querySelector('button')!);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('renders one card per proposal', () => {
    proposals.value = listOf([
      makeProposal({ id: 'p1' }),
      makeProposal({ id: 'p2', kind: 'iterate' }),
    ]);
    const { getAllByTestId } = render(<ApprovalsPanel />);
    expect(getAllByTestId('proposal-card')).toHaveLength(2);
  });

  it('renders the three stat tiles with counts', () => {
    proposalCounts.value = { proposed: 3, approved: 7, rejected: 2 };
    proposals.value = listOf([]);
    const { getAllByTestId, getByText } = render(<ApprovalsPanel />);
    expect(getAllByTestId('approvals-stat-tile')).toHaveLength(3);
    expect(getByText('3')).toBeInTheDocument();
    expect(getByText('7')).toBeInTheDocument();
    expect(getByText('2')).toBeInTheDocument();
  });

  it('renders a dash in a stat tile when counts are unavailable', () => {
    proposalCounts.value = null;
    proposals.value = listOf([]);
    const { getAllByText } = render(<ApprovalsPanel />);
    // three tiles, all showing the em-dash placeholder
    expect(getAllByText('—').length).toBe(3);
  });

  it('clicking a filter tab calls setProposalsFilter', () => {
    proposals.value = listOf([]);
    const { container } = render(<ApprovalsPanel />);
    fireEvent.click(container.querySelector('[data-filter="approved"]')!);
    expect(setFilterSpy).toHaveBeenCalledWith('approved');
  });

  it('marks the active filter tab with aria-pressed', () => {
    proposals.value = listOf([]);
    proposalsFilter.value = 'rejected';
    const { container } = render(<ApprovalsPanel />);
    const rejected = container.querySelector('[data-filter="rejected"]')!;
    const proposed = container.querySelector('[data-filter="proposed"]')!;
    expect(rejected).toHaveAttribute('aria-pressed', 'true');
    expect(proposed).toHaveAttribute('aria-pressed', 'false');
  });
});
