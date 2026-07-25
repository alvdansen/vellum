/**
 * ShotGridFilterBar — sticky top bar with status pills + Show omitted toggle.
 *
 * Pure component: props-in, callbacks-out. No fetch, no signal reads, no state
 * mutations. Parent (ShotGridView, Wave 4) passes statusFilter + showOmitted
 * + callbacks and owns the "reset to 'all' when toggling off omit while
 * filter==='omit'" logic (D-07).
 *
 * D-07: pill order = All | wip | pending-review | approved | on-hold [| omit]
 *       The omit pill is rendered ONLY when showOmitted === true. Its
 *       visibility is controlled SOLELY by the showOmitted prop — clicking
 *       a pill does NOT toggle visibility.
 * D-08: 'All' resets the status filter within the current dataset; the
 *       dataset is gated orthogonally by the Show omitted toggle.
 * D-10: position: sticky; top: 0; z-index: 10 above the grid cards (below
 *       VersionDrawer overlay).
 * D-11: active pill = bg-[var(--color-accent)] + text-[var(--color-bg)]
 *       (filled); inactive = border + text-[var(--color-fg-muted)] (outlined).
 *
 * Architecture-purity (D-WEBUI-31): zero server-tree imports.
 *
 * SECURITY: no user-provided strings flow into innerHTML — pill labels come
 * from the locked copy constants below; Preact auto-escapes text children.
 */

import type { ShotStatus } from '../types/shot-grid.js';
import {
  FILTER_BAR_STATUS_LABEL,
  FILTER_PILL_ALL,
  FILTER_PILL_WIP,
  FILTER_PILL_PENDING_REVIEW,
  FILTER_PILL_APPROVED,
  FILTER_PILL_ON_HOLD,
  FILTER_PILL_OMIT,
  SHOW_OMITTED_TOGGLE_LABEL,
  SHOW_OMITTED_TOGGLE_ARIA,
} from '../lib/copy.js';

/** All possible filter values: 'all' OR one of the 5 ShotStatus values. */
type FilterValue = 'all' | ShotStatus;

export interface ShotGridFilterBarProps {
  statusFilter: FilterValue;
  showOmitted: boolean;
  onChangeStatusFilter: (next: FilterValue) => void;
  onToggleShowOmitted: () => void;
}

interface PillSpec {
  value: FilterValue;
  label: string;
}

/** Shared focus-visible ring class — keeps active/inactive pills consistent. */
const PILL_BASE_CLASS =
  'inline-flex items-center rounded-full px-3 py-1 text-xs uppercase tracking-widest transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]';

const ACTIVE_PILL_CLASS =
  'bg-[var(--color-accent)] text-[var(--color-bg)]';

const INACTIVE_PILL_CLASS =
  'border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-fg)]';

export function ShotGridFilterBar({
  statusFilter,
  showOmitted,
  onChangeStatusFilter,
  onToggleShowOmitted,
}: ShotGridFilterBarProps) {
  // D-07: build the pill array dynamically. The omit pill appears as the
  // 6th option ONLY when showOmitted === true.
  const pills: PillSpec[] = [
    { value: 'all', label: FILTER_PILL_ALL },
    { value: 'wip', label: FILTER_PILL_WIP },
    { value: 'pending-review', label: FILTER_PILL_PENDING_REVIEW },
    { value: 'approved', label: FILTER_PILL_APPROVED },
    { value: 'on-hold', label: FILTER_PILL_ON_HOLD },
  ];
  if (showOmitted) {
    pills.push({ value: 'omit', label: FILTER_PILL_OMIT });
  }

  return (
    <div
      class="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3"
      aria-label="Shot status filters"
    >
      <span class="label-uppercase text-[var(--color-fg-muted)]">
        {FILTER_BAR_STATUS_LABEL}
      </span>
      {pills.map((p) => {
        const active = statusFilter === p.value;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onChangeStatusFilter(p.value)}
            aria-pressed={active}
            class={`${PILL_BASE_CLASS} ${active ? ACTIVE_PILL_CLASS : INACTIVE_PILL_CLASS}`}
          >
            {p.label}
          </button>
        );
      })}
      <div class="ml-auto">
        <button
          type="button"
          role="switch"
          aria-checked={showOmitted}
          aria-label={SHOW_OMITTED_TOGGLE_ARIA}
          // Wrap in arrow function so the MouseEvent does NOT get passed as
          // the first argument to onToggleShowOmitted (contract: no args).
          onClick={() => onToggleShowOmitted()}
          class={`inline-flex items-center gap-2 rounded px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
            showOmitted ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)]'
          }`}
        >
          <span
            class={`inline-block h-3 w-6 rounded-full transition-colors ${
              showOmitted ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
            }`}
            aria-hidden="true"
          />
          {SHOW_OMITTED_TOGGLE_LABEL}
        </button>
      </div>
    </div>
  );
}
