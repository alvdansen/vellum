/**
 * RegenerateButton — Phase 19 / Plan 19-06 SUM-04 thin presentational button
 * with a 1Hz cooldown countdown.
 *
 * Architecture-purity (D-WEBUI-31): zero imports from `src/`. The component
 * imports only from sibling dashboard modules (../lib/copy.js) and from
 * `preact/hooks` for the countdown tick. Mirrors the
 * SortDropdown.tsx / WarningPill.tsx file-shape precedent.
 *
 * Three render states (UI-SPEC §"<RegenerateButton/> API contract"):
 *   - default  (regenerateAvailableAtMs <= now, !isFetching) → "Regenerate"
 *   - cooldown (regenerateAvailableAtMs > now, !isFetching)  → "Regenerate (Ns)"
 *                                                              tabular-nums
 *   - fetching (isFetching=true)                             → "Regenerating…"
 *
 * Fetching wins over cooldown when both are true (an active fetch implies
 * the cooldown gate already passed). Disabled-state guards onClick — passing
 * `undefined` to a disabled button additionally guards against the case where
 * a parent does not respect HTML's native disabled-click suppression.
 *
 * Accessibility:
 *   - Native <button type="button"> + native HTML `disabled` (removes from
 *     tab order, blocks click events).
 *   - aria-label is REQUIRED — caller passes regenerateButtonAriaLabel(label).
 *   - aria-busy='true' during isFetching — assistive tech announces the
 *     "doing work" state (UI-SPEC accessibility contract).
 *   - prefers-reduced-motion: the 1Hz tick is text content, not animation;
 *     does not violate the reduced-motion contract (per UI-SPEC).
 *
 * Layout-stability (UI-SPEC + D-FB-6 sibling): `tabular-nums` Tailwind class
 * keeps the (Ns) digit width fixed across countdown ticks so the button does
 * not jitter as the countdown progresses.
 */

import { useEffect, useState } from 'preact/hooks';
import {
  REGENERATE_BUTTON_LABEL,
  REGENERATE_BUTTON_FETCHING,
  regenerateButtonCooldownLabel,
} from '../lib/copy.js';

export interface RegenerateButtonProps {
  /**
   * Server-reported epoch ms at which the next regenerate call will succeed.
   * When > Date.now(), the button is disabled and the label shows the
   * countdown. When null/undefined or in the past, the button is enabled.
   */
  regenerateAvailableAtMs?: number | null;
  /** True while a fetch is in flight (initial mount OR active regenerate). */
  isFetching?: boolean;
  /** Click handler — parent applies 500ms debounce + invokes the actual fetch. */
  onClick: () => void;
  /**
   * Required ARIA label — caller passes regenerateButtonAriaLabel(version.label).
   * Surfaces the version referent to screen-reader users since the visible
   * button text is brief.
   */
  ariaLabel: string;
  /** Optional class for composition with parent container styling. */
  class?: string;
}

export function RegenerateButton({
  regenerateAvailableAtMs,
  isFetching = false,
  onClick,
  ariaLabel,
  class: className,
}: RegenerateButtonProps) {
  // 1Hz tick for the cooldown countdown digit.
  //
  // The effect is keyed solely on `regenerateAvailableAtMs` — using `now` as
  // a dep would re-install the interval on every tick and break test-time
  // fake-timer advancement (a single advanceTimersByTimeAsync call would only
  // fire once because each tick tears down + reinstalls the interval). The
  // callback re-samples Date.now() every second; the unmount cleanup clears
  // the interval, and the cooldownSeconds computation below still goes to 0
  // once the deadline elapses (the disabled-state and label flip naturally).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!regenerateAvailableAtMs) return;
    if (regenerateAvailableAtMs <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [regenerateAvailableAtMs]);

  const cooldownSeconds =
    regenerateAvailableAtMs && regenerateAvailableAtMs > now
      ? Math.ceil((regenerateAvailableAtMs - now) / 1000)
      : 0;

  // Fetching wins over cooldown — an active fetch means the cooldown already
  // passed (UI-SPEC button-state precedence).
  const isDisabled = isFetching || cooldownSeconds > 0;
  const label = isFetching
    ? REGENERATE_BUTTON_FETCHING
    : cooldownSeconds > 0
      ? regenerateButtonCooldownLabel(cooldownSeconds)
      : REGENERATE_BUTTON_LABEL;

  // Match View Diff button styling verbatim per UI-SPEC color/spacing matrix
  // (see VersionDrawer.tsx:218-222).
  const baseClass =
    'rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-normal tabular-nums text-[var(--color-bg)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50';
  const composed = className ? `${baseClass} ${className}` : baseClass;

  return (
    <button
      type="button"
      class={composed}
      aria-label={ariaLabel}
      aria-busy={isFetching ? 'true' : 'false'}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      data-testid="regenerate-button"
    >
      {label}
    </button>
  );
}
