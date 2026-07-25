/**
 * ProgressBar — WCAG 2.1 AA progress-bar primitive.
 *
 * Phase 23 / Plan 23-02 (D-06). Pure component: props-in, no callbacks,
 * no state. Renders a horizontal bar with the progressbar ARIA role and
 * the full set of aria-value{now,min,max} + aria-label attributes for
 * assistive tech. The bar fill width transitions at 150ms with the
 * Tailwind v4 motion-reduce variant honoring prefers-reduced-motion
 * per D-21 + UI-SPEC A6.
 *
 * Track color: --color-border (existing token).
 * Fill color: --color-shot-status-approved (Phase 21 token — green
 * because approval is a success state, reuses the pill color for that
 * status; UI-SPEC §"Color > Subrow color element matrix").
 * Optional label color: --color-fg-muted (supplemental signal — bar
 * carries primary cue; UI-SPEC §"Color").
 *
 * SECURITY — T-5-06 / T-23-02-03: dynamic content (ariaLabel, label)
 * flows as JSX text children → Preact auto-escapes. The component does
 * NOT use dangerouslySetInnerHTML. The aria-label attribute is also
 * auto-escaped via Preact's prop handling.
 *
 * Defensive clamp pipes value through round → min(max,...) → max(0,...)
 * once per render. Rounding runs BEFORE clamp so floats integer-coerce
 * first. Divide-by-zero guard: max === 0 → 0% (no NaN).
 */

export interface ProgressBarProps {
  /** Current progress value (typically 0-max). Clamped + integer-rounded at render. */
  value: number;
  /** Maximum value. Defaults to 100. */
  max?: number;
  /** Optional visible label rendered next to the bar (e.g., "60% approved"). */
  label?: string;
  /** REQUIRED `aria-label` for the progressbar element (bar has no visible heading). */
  ariaLabel: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  ariaLabel,
}: ProgressBarProps) {
  // Defensive clamp per UI-SPEC §"Animation & Motion" line 278:
  // Math.round runs BEFORE clamp so floats are integer-coerced first;
  // clamp ensures aria-valuenow stays within [0, max] even for hostile inputs.
  const clamped = Math.max(0, Math.min(max, Math.round(value)));
  // Width is the fraction-as-percent. Divide-by-zero guarded explicitly
  // (max === 0 is a degenerate input that should yield an empty bar).
  const widthPct = max === 0 ? '0%' : `${(clamped / max) * 100}%`;

  return (
    <div class="inline-flex items-center gap-1">
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel}
        class="relative h-2 w-32 overflow-hidden rounded bg-[var(--color-border)]"
      >
        <div
          class="h-full bg-[var(--color-shot-status-approved)] transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: widthPct }}
        />
      </div>
      {label ? (
        <span class="num text-xs text-[var(--color-fg-muted)]">{label}</span>
      ) : null}
    </div>
  );
}
