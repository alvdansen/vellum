/**
 * ApprovalsPanel — the approval-gate inbox (no silent credit spend).
 *
 * A full-width view (App routes to it when activeView='approvals') listing the
 * proposal queue: a stat-tile row (pending / approved / rejected counts), a
 * status-filter control, and a scrollable list of <ProposalCard/>s. Each
 * pending card carries the approve/reject decision bar; deciding runs through
 * the state-layer helpers, which reload the queue + counts.
 *
 * States (D "beautiful functioning" bar): loading skeleton, empty (copy varies
 * by filter), and a load-error surface with Retry. Theme-aware via CSS vars;
 * counts use tabular-nums.
 *
 * Data: mount + filter change fetch through the state slice. There is no SSE
 * channel for proposals, so the panel is the fetch owner (mount effect) and
 * refreshes after each decide via the state helpers.
 */

import { useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { ProposalCard } from '../components/ProposalCard.js';
import { EmptyState } from '../components/EmptyState.js';
import {
  proposals,
  proposalsFilter,
  proposalsError,
  proposalCounts,
  refreshProposals,
  loadProposals,
  setProposalsFilter,
} from '../state/proposals.js';
import type { ProposalStatusFilter } from '../types/proposals.js';
import {
  APPROVALS_VIEW_TITLE,
  APPROVALS_VIEW_SUBTITLE,
  APPROVALS_FILTER_PROPOSED,
  APPROVALS_FILTER_APPROVED,
  APPROVALS_FILTER_REJECTED,
  APPROVALS_FILTER_ALL,
  APPROVALS_FILTER_GROUP_ARIA,
  APPROVALS_STAT_PENDING_LABEL,
  APPROVALS_STAT_APPROVED_LABEL,
  APPROVALS_STAT_REJECTED_LABEL,
  APPROVALS_LOADING_LABEL,
  APPROVALS_EMPTY_PENDING,
  APPROVALS_EMPTY_APPROVED,
  APPROVALS_EMPTY_REJECTED,
  APPROVALS_EMPTY_ALL,
  APPROVALS_LOAD_ERROR,
  APPROVALS_RETRY_LABEL,
} from '../lib/copy.js';

const FILTER_TABS: { value: ProposalStatusFilter; label: string }[] = [
  { value: 'proposed', label: APPROVALS_FILTER_PROPOSED },
  { value: 'approved', label: APPROVALS_FILTER_APPROVED },
  { value: 'rejected', label: APPROVALS_FILTER_REJECTED },
  { value: 'all', label: APPROVALS_FILTER_ALL },
];

const EMPTY_COPY: Record<ProposalStatusFilter, string> = {
  proposed: APPROVALS_EMPTY_PENDING,
  approved: APPROVALS_EMPTY_APPROVED,
  rejected: APPROVALS_EMPTY_REJECTED,
  all: APPROVALS_EMPTY_ALL,
};

/**
 * A single count tile (dataviz "stat tile" form — the right shape for a small
 * set of magnitudes; no chart). The status color rides on a left border so it
 * ties to the matching ProposalStatusPill without repainting the whole tile.
 */
function StatTile({
  label,
  count,
  colorVar,
  emphasize,
}: {
  label: string;
  count: number | null;
  colorVar: string;
  emphasize?: boolean;
}): JSX.Element {
  return (
    <div
      class={`flex min-w-[7rem] flex-1 flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${emphasize ? 'ring-1 ring-[var(--color-accent)]' : ''}`}
      style={{ borderLeftColor: `var(${colorVar})`, borderLeftWidth: '3px' }}
      data-testid="approvals-stat-tile"
    >
      <span class="label-uppercase text-xs text-[var(--color-fg-muted)]">
        {label}
      </span>
      <span class="text-2xl font-semibold tabular-nums text-[var(--color-fg)]" style={{ fontFamily: 'var(--font-display)' }}>
        {count === null ? '—' : count}
      </span>
    </div>
  );
}

export function ApprovalsPanel(): JSX.Element {
  // Mount fetch: load the queue + counts once. Deliberately no dependency on
  // the filter here — filter changes flow through the tab click handler
  // (setProposalsFilter), which reloads the list without re-fetching counts.
  useEffect(() => {
    void refreshProposals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filter = proposalsFilter.value;
  const buf = proposals.value;
  const counts = proposalCounts.value;
  const error = proposalsError.value;
  const items = buf?.items ?? [];

  return (
    <div class="flex h-full flex-col overflow-hidden">
      {/* Header — title, subtitle, stat tiles */}
      <div class="flex flex-col gap-3 border-b border-[var(--color-border)] px-6 py-4">
        <div class="flex flex-col gap-1">
          <h1
            class="text-lg font-semibold text-[var(--color-fg)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {APPROVALS_VIEW_TITLE}
          </h1>
          <p class="text-sm text-[var(--color-fg-muted)]">
            {APPROVALS_VIEW_SUBTITLE}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <StatTile
            label={APPROVALS_STAT_PENDING_LABEL}
            count={counts?.proposed ?? null}
            colorVar="--color-shot-status-pending-review"
            emphasize
          />
          <StatTile
            label={APPROVALS_STAT_APPROVED_LABEL}
            count={counts?.approved ?? null}
            colorVar="--color-shot-status-approved"
          />
          <StatTile
            label={APPROVALS_STAT_REJECTED_LABEL}
            count={counts?.rejected ?? null}
            colorVar="--color-shot-status-omit"
          />
        </div>
      </div>

      {/* Filter control */}
      <div
        class="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-6 py-2"
        role="group"
        aria-label={APPROVALS_FILTER_GROUP_ARIA}
      >
        {FILTER_TABS.map((tab) => {
          const active = filter === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              data-filter={tab.value}
              aria-pressed={active}
              onClick={() => void setProposalsFilter(tab.value)}
              class={`rounded px-3 py-1 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
                active
                  ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
                  : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-fg)]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div class="flex-1 overflow-y-auto px-6 py-4">
        {buf === null ? (
          error ? (
            // Never loaded AND the load failed — nothing to show, so the
            // full-surface error + Retry is the whole body.
            <div
              class="flex flex-col items-center justify-center gap-3 py-16"
              role="alert"
            >
              <span class="text-sm text-[var(--color-fg-muted)]">
                {APPROVALS_LOAD_ERROR}
              </span>
              <button
                type="button"
                onClick={() => void loadProposals()}
                class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                {APPROVALS_RETRY_LABEL}
              </button>
            </div>
          ) : (
            // Never loaded yet — the mount effect fires after first paint, and
            // setProposalsFilter nulls the buffer during a switch. Render the
            // skeleton (not the empty state) so the assertive "nothing pending"
            // copy never flashes before the first fetch lands.
            <div
              class="flex flex-col gap-3"
              role="status"
              aria-busy="true"
              aria-label={APPROVALS_LOADING_LABEL}
              data-testid="approvals-loading"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  class="animate-skeleton-shimmer h-28 w-full rounded-lg"
                  aria-hidden="true"
                  role="presentation"
                />
              ))}
            </div>
          )
        ) : (
          // A buffer exists. A non-null `error` here is a TRANSIENT refresh
          // failure (loadProposals preserves the prior buffer on error) — show
          // an inline banner ABOVE the still-valid list rather than blanking it
          // (e.g. a successful decide whose follow-up refresh timed out).
          <>
            {error ? (
              <div
                class="mb-3 flex items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
                role="alert"
                data-testid="approvals-inline-error"
              >
                <span class="text-sm text-[var(--color-fg-muted)]">
                  {APPROVALS_LOAD_ERROR}
                </span>
                <button
                  type="button"
                  onClick={() => void loadProposals()}
                  class="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                >
                  {APPROVALS_RETRY_LABEL}
                </button>
              </div>
            ) : null}
            {items.length === 0 ? (
              <EmptyState message={EMPTY_COPY[filter]} />
            ) : (
              <ul class="flex flex-col gap-3">
                {items.map((p) => (
                  <li key={p.id}>
                    <ProposalCard proposal={p} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
