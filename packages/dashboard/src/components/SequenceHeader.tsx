/**
 * SequenceHeader — collapsible header above the shot grid (D-15).
 *
 * Pure component: props-in, callbacks-out. Sequence name (20px/600 Inter
 * Tight) + chevron toggle button + aggregate count mini-pills row.
 *
 * D-14: aggregate counts are color-coded mini-pills, one per non-zero
 *       status count, rendered in fixed ORDER (wip → pending-review →
 *       approved → on-hold → omit). The parent (ShotGridView, Wave 4)
 *       computes the counts from the shotGrid signal and passes them in;
 *       SSE-driven status updates flow through that computed reactively.
 * D-15: chevron toggles aria-expanded (caller owns the boolean state);
 *       expanded ↔ ChevronDown, collapsed ↔ ChevronRight; open by default
 *       (caller responsibility); session-only state (no localStorage).
 *
 * Architecture-purity (D-WEBUI-31): zero server-tree imports. The
 * `lucide-preact` icons are already in TreeSidebar.tsx (Phase 17 precedent).
 *
 * SECURITY: sequenceName renders as JSX text children (Preact auto-escapes).
 */

import { ChevronDown, ChevronRight } from 'lucide-preact';
import type { ShotStatus } from '../types/shot-grid.js';
import {
  SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_OPEN,
  SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_CLOSED,
  AGGREGATE_COUNTS_REGION_LABEL_PREFIX,
} from '../lib/copy.js';

export interface SequenceHeaderProps {
  sequenceName: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  counts: Record<ShotStatus, number>;
}

/**
 * Per-status mini-pill background + inverse-text classes. Uses the 5
 * --color-shot-status-* tokens introduced by Wave 1 (theme.css both themes)
 * — same vocabulary as <ShotStatusPill/> by design (D-14 token reuse).
 */
const STATUS_BG: Record<ShotStatus, string> = {
  wip: 'bg-[var(--color-shot-status-wip)] text-[var(--color-bg)]',
  'pending-review':
    'bg-[var(--color-shot-status-pending-review)] text-[var(--color-bg)]',
  approved: 'bg-[var(--color-shot-status-approved)] text-[var(--color-bg)]',
  'on-hold': 'bg-[var(--color-shot-status-on-hold)] text-[var(--color-bg)]',
  omit: 'bg-[var(--color-shot-status-omit)] text-[var(--color-bg)]',
};

/** Fixed render order for the aggregate mini-pills (D-14 spec). */
const ORDER: ShotStatus[] = ['wip', 'pending-review', 'approved', 'on-hold', 'omit'];

export function SequenceHeader({
  sequenceName,
  expanded,
  onToggleExpanded,
  counts,
}: SequenceHeaderProps) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  const ariaPrefix = expanded
    ? SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_OPEN
    : SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_CLOSED;

  return (
    <header class="flex flex-col gap-2 px-4 py-6">
      <div class="flex items-center gap-2">
        <button
          type="button"
          // Wrap in arrow so the MouseEvent does NOT pass as the first
          // argument to onToggleExpanded (contract: no args).
          onClick={() => onToggleExpanded()}
          aria-expanded={expanded}
          aria-label={`${ariaPrefix}${sequenceName}`}
          class="flex items-center justify-center rounded p-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <Icon size={18} />
        </button>
        <h2
          class="text-xl font-semibold text-[var(--color-fg)]"
          // font-display = Inter Tight per UI-SPEC Typography line 76.
          // Inline style is the cleanest way to opt into the display family
          // without polluting Tailwind utility classes.
          style={{ fontFamily: 'var(--font-display)', lineHeight: 1.2 }}
        >
          {sequenceName}
        </h2>
      </div>
      <div
        role="group"
        aria-label={`${AGGREGATE_COUNTS_REGION_LABEL_PREFIX}${sequenceName}`}
        class="flex items-center gap-2"
      >
        {ORDER.map((status) => {
          const n = counts[status];
          // D-14: zero counts are hidden from the row entirely (not rendered
          // as empty placeholders). The row collapses gracefully when every
          // count is zero (all five .map returns null).
          if (n === 0) return null;
          return (
            <span
              key={status}
              class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs uppercase tracking-widest ${STATUS_BG[status]}`}
              data-status={status}
            >
              <span class="num">{n}</span>
              <span>{status}</span>
            </span>
          );
        })}
      </div>
    </header>
  );
}
