/**
 * Phase 18 / Plan 18-04 — <LoadMoreButton/> pagination affordance.
 *
 * Pure presentational component owning the "Load N more (M remaining)" surface
 * + loading-state opacity + disabled-while-fetching + inline error pill on
 * failure.
 *
 * Renders ONLY when the parent has more pages — parent omits the component
 * when `remaining === 0` or `next_cursor === null`. The component itself does
 * NOT receive a "should render?" prop; absence is the parent's contract.
 *
 * UI-SPEC §"<LoadMoreButton/> API contract" (lines 297-345) is the source of
 * truth for the API + render contract:
 *   - Default (remaining > 0, !isFetching, !errorMessage):
 *       <button>Load {min(pageSize, remaining)} more
 *         <span class="num">({remaining} remaining)</span>
 *       </button>
 *   - Loading (isFetching = true):
 *       <button disabled aria-busy="true" class="opacity-50">Loading…</button>
 *   - Error (errorMessage non-null, !isFetching):
 *       <div>
 *         <button>Load N more (M remaining)</button>  (NOT disabled)
 *         <div role="alert">…errorMessage… · <button>Retry</button></div>
 *       </div>
 *
 * Design-token reuse (UI-SPEC §"Color usage matrix"):
 *   - Default button: --color-surface bg, --color-fg text, --color-border
 *   - Loading: opacity-50 + cursor-not-allowed
 *   - Error pill: --color-status-failed bg + --color-bg fg + --color-border outline
 *     (mirrors WarningPill design-token-reuse pattern from Phase 12)
 *
 * SECURITY (T-18-03 — out of scope for this component, see SortDropdown.tsx
 * header for full notes): the errorMessage prop is passed by the parent —
 * v1.2 fixes its origin to LOAD_MORE_ERROR_PREFIX_FAILED / NETWORK constants
 * + server-emitted string, both controlled. Preact text-node interpolation
 * auto-escapes. NO dangerouslySetInnerHTML.
 *
 * Architecture-purity (D-WEBUI-31): zero imports from src/. Imports only
 * from sibling lib/copy.js for the verbatim copy strings.
 */

import type { VNode } from 'preact';
import {
  LOAD_MORE_LOADING_LABEL,
  LOAD_MORE_RETRY_LABEL,
} from '../lib/copy.js';

export interface LoadMoreButtonProps {
  /**
   * Number of items remaining to be fetched (total_count - current loaded
   * count). MUST be > 0 — parent guards against the "0 remaining" state.
   */
  remaining: number;
  /**
   * Page size for the next fetch. Default 20 per CLAUDE.md
   * "Paginate all list queries (default 20)" + D-18.
   */
  pageSize?: number;
  /**
   * Click handler — fires the next-page fetch. Idempotent; parent guards
   * against double-fire (debounces or marks isFetching).
   */
  onClick: () => void;
  /**
   * True while the next-page fetch is in flight. Disables the button +
   * shows loading state (opacity-50 + 'Loading…' label per researcher
   * recommendation in UI-SPEC).
   */
  isFetching: boolean;
  /**
   * If non-null, an error occurred on the last "Load more" fetch. Renders
   * an inline error pill BELOW the button with the error message + a
   * Retry CTA (re-clicks the same onClick handler).
   */
  errorMessage?: string | null;
}

export function LoadMoreButton({
  remaining,
  pageSize = 20,
  onClick,
  isFetching,
  errorMessage,
}: LoadMoreButtonProps): VNode {
  // Loading branch — single-button render with disabled + aria-busy.
  if (isFetching) {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        class="h-10 min-w-[200px] px-4 py-2 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] opacity-50 cursor-not-allowed"
      >
        {LOAD_MORE_LOADING_LABEL}
      </button>
    );
  }

  const fetchN = Math.min(pageSize, remaining);

  // Default + Error branches share the main button render. The error pill
  // appears as a sibling INSIDE a wrapper <div> when errorMessage is set.
  return (
    <div class="flex flex-col items-stretch gap-2">
      <button
        type="button"
        onClick={onClick}
        class="h-10 min-w-[200px] px-4 py-2 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        Load {fetchN} more{' '}
        <span class="num text-[var(--color-fg-muted)] ml-1">
          ({remaining} remaining)
        </span>
      </button>
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          class="bg-[var(--color-status-failed)] text-[var(--color-bg)] rounded-full px-3 py-1 text-xs flex items-center justify-center gap-1"
        >
          <span>{errorMessage}</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            class="underline focus-visible:ring-2 focus-visible:ring-[var(--color-bg)]"
            onClick={onClick}
          >
            {LOAD_MORE_RETRY_LABEL}
          </button>
        </div>
      )}
    </div>
  );
}
