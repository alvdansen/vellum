/**
 * ShotStatusPill — inline color-coded status badge for Phase 21 SHOT statuses.
 *
 * Distinct from `<StatusPill/>` (4 VERSION statuses: queued/running/complete/failed).
 * Per D-17 these are separate components — the 5 shot statuses (wip / pending-
 * review / approved / on-hold / omit) do NOT overlap with the version status
 * union and the badges live on different surfaces (shot grid card vs version
 * grid card).
 *
 * UI-SPEC §"Color" cross-cutting WCAG 2.1 AA constraint (REQ-01): every status
 * pill renders saturated background + `--color-bg` text. The text contrast
 * against the dark / light theme backgrounds was pre-computed in UI-SPEC and
 * every token meets the AA 4.5:1 floor — the lowest contrast (`omit` on dark)
 * is 4.8:1; the strictest light-theme token (`omit` on light) is exactly 4.5:1.
 *
 * Visual vocabulary mirrors `StatusPill.tsx:41` (saturated bg + `--color-bg`
 * text + `uppercase tracking-widest` for label-uppercase convention). The
 * tokens are defined in `theme.css` `@theme` block + `[data-theme="light"]`
 * override block (added by Wave 1 21-01-T02).
 *
 * Landmines preserved (PATTERNS §15):
 *   - NO pulse/spin animation class. Shot statuses are terminal/long-lived
 *     states — never "in flight" — so animation would mislead.
 *   - NO `<StatusPill/>` import or extension. ShotStatus and Status are
 *     distinct unions; combining them would erase the type-system guarantee
 *     that a version-status pill never accidentally renders a shot status.
 */

import type { ShotStatus } from '../types/shot-grid.js';

export interface ShotStatusPillProps {
  status: ShotStatus;
  /**
   * Phase 22 D-13 dual-mode: when provided, the pill renders as a
   * `<button aria-haspopup="dialog">` wrapping the inner pill span.
   * When undefined, the pill stays presentational (`<span>` only) —
   * preserves Phase 21 callers that render the pill inside a non-clickable
   * context (review-panel header, timeline rows).
   */
  onClick?: () => void;
  /**
   * Optional explicit aria-label when the pill is interactive. When the
   * pill is a button and `ariaLabel` is undefined, falls back to
   * `Open review for status ${status}` (defensive default).
   */
  ariaLabel?: string;
}

/**
 * Per-status Tailwind classes mapping each ShotStatus to its color token +
 * inverse text. The `var(--color-shot-status-*)` tokens come from
 * `theme.css` @theme block (Wave 1 21-01-T02); the `var(--color-bg)` text
 * is the universal inverse-for-WCAG-AA constant.
 *
 * Tailwind v4 generates `bg-[var(...)]` as a literal arbitrary-value class
 * (no `tailwind.config.js` token wiring); the value below is the verbatim
 * class string the browser sees.
 */
const SHOT_STATUS_STYLES: Record<ShotStatus, string> = {
  'wip':
    'bg-[var(--color-shot-status-wip)] text-[var(--color-bg)]',
  'pending-review':
    'bg-[var(--color-shot-status-pending-review)] text-[var(--color-bg)]',
  'approved':
    'bg-[var(--color-shot-status-approved)] text-[var(--color-bg)]',
  'on-hold':
    'bg-[var(--color-shot-status-on-hold)] text-[var(--color-bg)]',
  'omit':
    'bg-[var(--color-shot-status-omit)] text-[var(--color-bg)]',
};

export function ShotStatusPill({
  status,
  onClick,
  ariaLabel,
}: ShotStatusPillProps) {
  const pillContent = (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${SHOT_STATUS_STYLES[status]}`}
      data-status={status}
    >
      {status}
    </span>
  );

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? `Open review for status ${status}`}
        aria-haspopup="dialog"
        class="rounded-full focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] motion-safe:transition-[filter] hover:brightness-110"
      >
        {pillContent}
      </button>
    );
  }
  return pillContent;
}
