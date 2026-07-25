/**
 * state/proposals.ts — approval-gate signal-bag + orchestration tests.
 *
 * Mocks the api layer (fetchProposals / approveProposal / rejectProposal) and
 * drives the real state helpers, asserting signal transitions. DashboardApiError
 * is kept real (importActual) so proposalErrorMessage's instanceof check works.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Proposal, ProposalListResponse } from '../../types/proposals.js';

const fetchProposalsMock = vi.fn();
const approveMock = vi.fn();
const rejectMock = vi.fn();

vi.mock('../../lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api.js')>('../../lib/api.js');
  return {
    ...actual,
    fetchProposals: (...a: unknown[]) => fetchProposalsMock(...a),
    approveProposal: (...a: unknown[]) => approveMock(...a),
    rejectProposal: (...a: unknown[]) => rejectMock(...a),
  };
});

import {
  proposals,
  proposalsFilter,
  proposalsIsFetching,
  proposalsError,
  proposalCounts,
  proposalDecideInFlight,
  proposalDecideError,
  pendingProposalCount,
  loadProposals,
  loadProposalCounts,
  setProposalsFilter,
  approveProposalDecision,
  rejectProposalDecision,
  parseProposalRequest,
} from '../proposals.js';
import { DashboardApiError } from '../../lib/api.js';

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
  fetchProposalsMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
  proposals.value = null;
  proposalsFilter.value = 'proposed';
  proposalsIsFetching.value = false;
  proposalsError.value = null;
  proposalCounts.value = null;
  proposalDecideInFlight.value = null;
  proposalDecideError.value = null;
});

describe('loadProposals', () => {
  it('populates proposals + clears fetching on success', async () => {
    fetchProposalsMock.mockResolvedValueOnce(listOf([makeProposal()]));
    await loadProposals();
    expect(proposals.value?.items).toHaveLength(1);
    expect(proposalsIsFetching.value).toBe(false);
    expect(proposalsError.value).toBeNull();
  });

  it("collapses the 'all' filter to an undefined status param", async () => {
    proposalsFilter.value = 'all';
    fetchProposalsMock.mockResolvedValueOnce(listOf([]));
    await loadProposals();
    expect(fetchProposalsMock).toHaveBeenCalledWith({
      status: undefined,
      limit: 20,
      offset: 0,
    });
  });

  it('sets proposalsError and preserves the prior buffer on failure', async () => {
    proposals.value = listOf([makeProposal({ id: 'keep' })]);
    fetchProposalsMock.mockRejectedValueOnce(
      new DashboardApiError('BOOM', 'server exploded', 500),
    );
    await loadProposals();
    expect(proposalsError.value).toBe('server exploded');
    // prior buffer untouched
    expect(proposals.value?.items[0].id).toBe('keep');
    expect(proposalsIsFetching.value).toBe(false);
  });
});

describe('loadProposalCounts', () => {
  it('reads three total_counts into proposalCounts', async () => {
    fetchProposalsMock
      .mockResolvedValueOnce(listOf([], 3)) // proposed
      .mockResolvedValueOnce(listOf([], 5)) // approved
      .mockResolvedValueOnce(listOf([], 1)); // rejected
    await loadProposalCounts();
    expect(proposalCounts.value).toEqual({ proposed: 3, approved: 5, rejected: 1 });
  });

  it('leaves the prior counts intact on failure', async () => {
    proposalCounts.value = { proposed: 9, approved: 9, rejected: 9 };
    fetchProposalsMock.mockRejectedValue(new Error('net'));
    await loadProposalCounts();
    expect(proposalCounts.value).toEqual({ proposed: 9, approved: 9, rejected: 9 });
  });
});

describe('pendingProposalCount', () => {
  it('prefers the server-side counts', () => {
    proposalCounts.value = { proposed: 7, approved: 0, rejected: 0 };
    expect(pendingProposalCount.value).toBe(7);
  });

  it('falls back to total_count when filter=proposed and counts are null', () => {
    proposalCounts.value = null;
    proposalsFilter.value = 'proposed';
    proposals.value = listOf([makeProposal()], 4);
    expect(pendingProposalCount.value).toBe(4);
  });

  it('reports 0 (unknown → no badge) under other filters when counts are null', () => {
    // Deliberately does NOT count proposed rows within a filtered page — that
    // would flash a misleading number. Only the dedicated counts or the
    // 'proposed'-filter total_count are trusted.
    proposalCounts.value = null;
    proposalsFilter.value = 'all';
    proposals.value = listOf(
      [makeProposal({ status: 'proposed' }), makeProposal({ id: 'p2', status: 'approved' })],
      2,
    );
    expect(pendingProposalCount.value).toBe(0);
  });
});

describe('setProposalsFilter', () => {
  it('changes the filter and reloads', async () => {
    fetchProposalsMock.mockResolvedValueOnce(listOf([]));
    await setProposalsFilter('approved');
    expect(proposalsFilter.value).toBe('approved');
    expect(fetchProposalsMock).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the filter is unchanged and a buffer exists', async () => {
    proposals.value = listOf([]);
    proposalsFilter.value = 'proposed';
    await setProposalsFilter('proposed');
    expect(fetchProposalsMock).not.toHaveBeenCalled();
  });

  it('reloads on the same filter when the buffer is null (retry after a failed load)', async () => {
    // beforeEach already sets proposals=null + filter='proposed'; asserting the
    // retry path fires a fresh load rather than short-circuiting.
    fetchProposalsMock.mockResolvedValueOnce(listOf([makeProposal()]));
    await setProposalsFilter('proposed');
    expect(fetchProposalsMock).toHaveBeenCalledTimes(1);
    expect(proposals.value?.items).toHaveLength(1);
  });

  it('clears the buffer before reloading so the panel shows loading, not stale cards', async () => {
    proposals.value = listOf([makeProposal({ id: 'stale' })]);
    proposalsFilter.value = 'proposed';
    // A never-resolving fetch lets us observe the intermediate cleared state.
    let resolve: (v: ProposalListResponse) => void = () => {};
    fetchProposalsMock.mockReturnValueOnce(
      new Promise<ProposalListResponse>((r) => {
        resolve = r;
      }),
    );
    const p = setProposalsFilter('approved');
    // The buffer was cleared synchronously before the await settles.
    expect(proposals.value).toBeNull();
    resolve(listOf([]));
    await p;
    expect(proposals.value?.items).toHaveLength(0);
  });
});

describe('loadProposals request sequencing', () => {
  it('drops a stale response when a newer load supersedes it', async () => {
    // First load: slow, returns the 'approved' page. Second load: fast, returns
    // the 'rejected' page. The slow (older) response must NOT clobber the newer.
    let resolveSlow: (v: ProposalListResponse) => void = () => {};
    fetchProposalsMock
      .mockReturnValueOnce(
        new Promise<ProposalListResponse>((r) => {
          resolveSlow = r;
        }),
      )
      .mockResolvedValueOnce(listOf([makeProposal({ id: 'rejected_row', status: 'rejected' })], 1));

    const slow = loadProposals(); // token 1 (in flight)
    const fast = loadProposals(); // token 2 (resolves first)
    await fast;
    expect(proposals.value?.items[0].id).toBe('rejected_row');
    // Now the stale token-1 response arrives — it must be ignored.
    resolveSlow(listOf([makeProposal({ id: 'approved_row', status: 'approved' })], 1));
    await slow;
    expect(proposals.value?.items[0].id).toBe('rejected_row');
    expect(proposalsIsFetching.value).toBe(false);
  });
});

describe('approveProposalDecision', () => {
  it('calls approve then refreshes the queue + counts', async () => {
    approveMock.mockResolvedValueOnce({ proposal: makeProposal({ status: 'approved' }) });
    // refresh = loadProposals + 3 count fetches = 4 fetchProposals calls
    fetchProposalsMock.mockResolvedValue(listOf([]));
    await approveProposalDecision('prop_1', 'ok');
    expect(approveMock).toHaveBeenCalledWith('prop_1', 'ok');
    expect(proposalDecideInFlight.value).toBeNull();
    expect(proposalDecideError.value).toBeNull();
    // one list load + three count loads
    expect(fetchProposalsMock).toHaveBeenCalledTimes(4);
  });

  it('records a per-row error AND still refreshes on failure', async () => {
    approveMock.mockRejectedValueOnce(
      new DashboardApiError('PROPOSAL_ALREADY_DECIDED', 'already approved', 409),
    );
    fetchProposalsMock.mockResolvedValue(listOf([]));
    await approveProposalDecision('prop_1', null);
    expect(proposalDecideError.value).toEqual({
      id: 'prop_1',
      message: 'already approved',
    });
    expect(proposalDecideInFlight.value).toBeNull();
    // reconciliation refresh still ran
    expect(fetchProposalsMock).toHaveBeenCalledTimes(4);
  });

  it('is guarded by the in-flight signal (no double decide)', async () => {
    proposalDecideInFlight.value = 'other';
    await approveProposalDecision('prop_1', null);
    expect(approveMock).not.toHaveBeenCalled();
  });
});

describe('rejectProposalDecision', () => {
  it('calls reject then refreshes', async () => {
    rejectMock.mockResolvedValueOnce({ proposal: makeProposal({ status: 'rejected' }) });
    fetchProposalsMock.mockResolvedValue(listOf([]));
    await rejectProposalDecision('prop_1', 'off-model');
    expect(rejectMock).toHaveBeenCalledWith('prop_1', 'off-model');
    expect(proposalDecideError.value).toBeNull();
  });

  it('records a per-row error AND reconciles (refreshes) on failure', async () => {
    rejectMock.mockRejectedValueOnce(
      new DashboardApiError('PROPOSAL_ALREADY_DECIDED', 'already rejected', 409),
    );
    fetchProposalsMock.mockResolvedValue(listOf([]));
    await rejectProposalDecision('prop_1', null);
    expect(proposalDecideError.value).toEqual({
      id: 'prop_1',
      message: 'already rejected',
    });
    expect(proposalDecideInFlight.value).toBeNull();
    expect(fetchProposalsMock).toHaveBeenCalledTimes(4); // list + 3 counts
  });

  it('is guarded by the in-flight signal (no double decide)', async () => {
    proposalDecideInFlight.value = 'other';
    await rejectProposalDecision('prop_1', null);
    expect(rejectMock).not.toHaveBeenCalled();
  });
});

describe('parseProposalRequest', () => {
  it('returns {ok:true,value} for valid JSON', () => {
    const r = parseProposalRequest({ request_json: '{"model":"x"}' });
    expect(r).toEqual({ ok: true, value: { model: 'x' } });
  });

  it('returns {ok:false,raw} for non-JSON', () => {
    const r = parseProposalRequest({ request_json: 'not json{' });
    expect(r).toEqual({ ok: false, raw: 'not json{' });
  });
});
