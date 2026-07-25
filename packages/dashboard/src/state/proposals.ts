/**
 * Approval-gate signal bag + load/decide orchestration (no silent credit
 * spend). Backs the <ApprovalsPanel/> view.
 *
 * Module pattern mirrors state/shot-grid.ts (Phase 21 convention): module-
 * singleton signals + a load helper + decide handlers, zero src/ traversals
 * for architecture-purity (D-WEBUI-31). SSE is NOT wired for proposals (there
 * is no proposal SSE channel today); the panel refreshes explicitly after each
 * decide and on mount / filter change.
 *
 * Landmine preserved: DO NOT subscribe to SSE or call load() at module top
 * level — the view owns the mount-time fetch (matches the shot-grid convention).
 */

import { signal, computed } from '@preact/signals';
import {
  fetchProposals,
  approveProposal as apiApprove,
  rejectProposal as apiReject,
  DashboardApiError,
} from '../lib/api.js';
import type {
  Proposal,
  ProposalListResponse,
  ProposalStatusFilter,
} from '../types/proposals.js';

/** Page size for the proposal queue. Matches CLAUDE.md "Paginate all list queries". */
export const PROPOSALS_PAGE_SIZE = 20;

// ============================================================================
// SIGNALS
// ============================================================================

/**
 * The paginated proposal buffer — fetched via load() on mount, on filter
 * change, and after each decide. `null` is the pre-fetch / fetch-failed state;
 * the view renders a loading or empty surface in that branch. Items are the
 * RAW rows (request_json is a string); the card parses per-render.
 */
export const proposals = signal<ProposalListResponse | null>(null);

/**
 * Current status-filter tab. Default 'proposed' — the panel opens on the
 * actionable pending-spend queue (the whole point of the gate), not the full
 * decided history. 'all' is a dashboard-only sentinel collapsed to no query
 * param in load().
 */
export const proposalsFilter = signal<ProposalStatusFilter>('proposed');

/** Loading flag for the list fetch. Drives the panel's aria-busy + skeleton. */
export const proposalsIsFetching = signal<boolean>(false);

/**
 * Most-recent list-fetch error message, or null when the last fetch succeeded.
 * Distinct from `proposalDecideError` (per-row decide failures) so a list-load
 * failure and a decide failure never clobber each other's surface.
 */
export const proposalsError = signal<string | null>(null);

/**
 * The proposal id whose approve|reject PATCH is currently in flight, or null.
 * Non-null disables that row's action buttons (and, defensively, sibling rows'
 * — a single decide at a time keeps the "at-most-once" mental model honest).
 */
export const proposalDecideInFlight = signal<string | null>(null);

/**
 * Per-proposal decide failure — `{ id, message }` or null. Surfaces an inline
 * error pill on the offending card; cleared on the next decide attempt or a
 * successful retry. Never persisted.
 */
export const proposalDecideError = signal<{ id: string; message: string } | null>(
  null,
);

/**
 * Server-side status counts (each is a `total_count` from a cheap `limit=1`
 * fetch), or null before the first counts load. Drives the stat-tile row and
 * the header nav badge — accurate regardless of the active filter, since the
 * filtered list's total_count only covers one status. Null on a counts-fetch
 * failure (the tiles degrade to a dash rather than a wrong number).
 */
export const proposalCounts = signal<{
  proposed: number;
  approved: number;
  rejected: number;
} | null>(null);

// ============================================================================
// COMPUTED — queue headline count (drives the header nav badge)
// ============================================================================

/**
 * The live pending-spend backlog — the count of `proposed` proposals awaiting
 * a decision. Prefers the accurate server-side count (`proposalCounts`); falls
 * back to the loaded page's total_count when the active filter is 'proposed',
 * else the loaded-page tally (mirrors shot-grid aggregateCounts Pitfall 8:
 * never a misleadingly-full-history number).
 */
export const pendingProposalCount = computed<number>(() => {
  const counts = proposalCounts.value;
  if (counts) return counts.proposed;
  // Fallback ONLY when it is unambiguously correct: on the 'proposed' filter,
  // the loaded page's total_count IS the pending backlog. Under any other
  // filter the loaded page contains no reliable pending tally, so report 0
  // (unknown → no badge) rather than a misleading filtered-page count that
  // would flash a false "all clear" on the very signal the gate exists for.
  const buf = proposals.value;
  if (buf && proposalsFilter.value === 'proposed') return buf.total_count;
  return 0;
});

// ============================================================================
// LOAD — fetch the queue for the current filter
// ============================================================================

/**
 * Map a fetch/decide error to a user-readable message. A DashboardApiError
 * carries the server's typed message (already actionable); a bare TypeError is
 * a network failure; anything else degrades to a generic string. Never throws.
 */
export function proposalErrorMessage(err: unknown): string {
  if (err instanceof DashboardApiError) return err.message;
  if (err instanceof TypeError) return 'Network error — check the connection and retry.';
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong — retry.';
}

/**
 * Monotonic load token — the last-issued loadProposals() call wins. A rapid
 * tab switch fires two concurrent fetches; without this, whichever resolves
 * LAST would clobber the list even if it is for a now-inactive filter. Each
 * load captures its token and drops its result if a newer load has started.
 */
let loadSeq = 0;

/**
 * Fetch the proposal queue for the current `proposalsFilter`, replacing
 * `proposals.value`. The 'all' sentinel is collapsed to an undefined status
 * param (server returns every status). Errors set `proposalsError` and leave
 * the prior buffer intact so a transient failure does not blank the list.
 *
 * Request sequencing: a stale response (superseded by a newer load) is dropped
 * — it neither overwrites the list nor clears the fetching flag the newer load
 * now owns.
 */
export async function loadProposals(): Promise<void> {
  const token = ++loadSeq;
  proposalsIsFetching.value = true;
  proposalsError.value = null;
  const filter = proposalsFilter.value;
  try {
    const res = await fetchProposals({
      status: filter === 'all' ? undefined : filter,
      limit: PROPOSALS_PAGE_SIZE,
      offset: 0,
    });
    if (token !== loadSeq) return; // a newer load superseded this one
    proposals.value = res;
  } catch (err) {
    if (token !== loadSeq) return;
    proposalsError.value = proposalErrorMessage(err);
  } finally {
    // Only the current load owns the fetching flag; a superseded load must not
    // flip it off while the winner is still in flight.
    if (token === loadSeq) proposalsIsFetching.value = false;
  }
}

/**
 * Fetch the per-status counts (three cheap `limit=1` fetches read for their
 * total_count). On any failure, leaves `proposalCounts` unchanged if it was
 * previously loaded, else null — the stat tiles show a dash rather than a
 * stale/wrong number. Never throws.
 */
export async function loadProposalCounts(): Promise<void> {
  try {
    const [proposed, approved, rejected] = await Promise.all([
      fetchProposals({ status: 'proposed', limit: 1 }),
      fetchProposals({ status: 'approved', limit: 1 }),
      fetchProposals({ status: 'rejected', limit: 1 }),
    ]);
    proposalCounts.value = {
      proposed: proposed.total_count,
      approved: approved.total_count,
      rejected: rejected.total_count,
    };
  } catch {
    // Non-fatal: the list surface is the source of truth; counts are a
    // secondary headline. Leave the prior value intact.
  }
}

/**
 * Load both the queue and the counts — the ApprovalsPanel mount + post-decide
 * refresh entry point. Runs them concurrently.
 */
export async function refreshProposals(): Promise<void> {
  await Promise.all([loadProposals(), loadProposalCounts()]);
}

/**
 * Switch the active filter tab and reload the list. No-op fast path when the
 * filter is unchanged (avoids a redundant round-trip on a repeat click).
 * Counts are filter-independent, so this does NOT refetch them.
 */
export async function setProposalsFilter(
  filter: ProposalStatusFilter,
): Promise<void> {
  if (proposalsFilter.value === filter && proposals.value !== null) return;
  proposalsFilter.value = filter;
  // Clear the buffer so the panel shows its loading skeleton during the
  // switch rather than the PREVIOUS filter's cards (which would render live
  // approve/reject bars under the newly-highlighted tab until the fetch
  // resolves — a mislabeled, actionable state).
  proposals.value = null;
  await loadProposals();
}

// ============================================================================
// DECIDE — approve / reject a single proposal
// ============================================================================

/**
 * Approve a proposal (claim + execute). On success, reloads the queue so the
 * decided row leaves the pending filter (or shows its linked version / any
 * execution error under the other filters). On failure — including the
 * PROPOSAL_ALREADY_DECIDED race and an execution error thrown during the
 * claimed run — records `proposalDecideError` for the row AND reloads, since
 * the server state advanced even when the HTTP call reported an error (an
 * execution failure still claimed the proposal). NEVER throws to the caller.
 */
export async function approveProposalDecision(
  id: string,
  note: string | null,
): Promise<void> {
  if (proposalDecideInFlight.value !== null) return;
  proposalDecideInFlight.value = id;
  proposalDecideError.value = null;
  try {
    await apiApprove(id, note);
    await refreshProposals();
  } catch (err) {
    proposalDecideError.value = { id, message: proposalErrorMessage(err) };
    // The claim may have advanced server-side (e.g. execution threw AFTER the
    // decide UPDATE committed). Reconcile the visible state with the server.
    await refreshProposals();
  } finally {
    proposalDecideInFlight.value = null;
  }
}

/**
 * Reject a proposal (pure decide, nothing executes). Same success/failure
 * discipline as approve, minus the execution path. NEVER throws to the caller.
 */
export async function rejectProposalDecision(
  id: string,
  note: string | null,
): Promise<void> {
  if (proposalDecideInFlight.value !== null) return;
  proposalDecideInFlight.value = id;
  proposalDecideError.value = null;
  try {
    await apiReject(id, note);
    await refreshProposals();
  } catch (err) {
    proposalDecideError.value = { id, message: proposalErrorMessage(err) };
    await refreshProposals();
  } finally {
    proposalDecideInFlight.value = null;
  }
}

// ============================================================================
// PARSE — defensive request_json parsing for the verbatim review block
// ============================================================================

/**
 * Parse a proposal's `request_json` string into a value for the verbatim
 * review block. Returns `{ ok: true, value }` on success or `{ ok: false, raw }`
 * when the string is not valid JSON (never throws) — the card renders the raw
 * string in that case so the reviewer still sees exactly what was recorded.
 */
export function parseProposalRequest(
  proposal: Pick<Proposal, 'request_json'>,
): { ok: true; value: unknown } | { ok: false; raw: string } {
  try {
    return { ok: true, value: JSON.parse(proposal.request_json) };
  } catch {
    return { ok: false, raw: proposal.request_json };
  }
}
