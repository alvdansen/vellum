/**
 * WarningPill — amber/yellow advisory badge.
 *
 * Phase 12 (DEMO-03) primitive for reproduce-lineage divergence indication.
 * Distinct from StatusPill (which carries a closed status union); WarningPill
 * carries free-form copy with a warning intent.
 *
 * Pure component: props-in, no callbacks. Mirrors StatusPill's structural shape
 * (rounded-full, uppercase tracking, --color-bg text on saturated background)
 * but binds to --color-status-running (the existing amber token at theme.css:51)
 * to avoid introducing a new design token (CONTEXT.md "no new design tokens").
 *
 * SECURITY — T-5-06: dynamic content (label, ariaLabel) flows as JSX text
 * children — Preact auto-escapes. Caller passes hardcoded strings; no
 * user-controlled data reaches the pill.
 *
 * Accessibility: role="status" + aria-label so screen readers announce the
 * divergence indication when the drawer mounts. Stable data-testid so the
 * VersionDrawer integration tests can assert presence/absence.
 */

export interface WarningPillProps {
  /** The visible label inside the pill. Default: 'non-deterministic'. */
  label?: string;
  /** Long-form description for assistive tech. Default: `Warning: <label>`. */
  ariaLabel?: string;
}

export function WarningPill({
  label = 'non-deterministic',
  ariaLabel,
}: WarningPillProps) {
  return (
    <span
      class="warning-pill inline-flex items-center rounded-full bg-[var(--color-status-running)] px-2 py-0.5 text-xs font-normal uppercase tracking-widest text-[var(--color-bg)]"
      role="status"
      aria-label={ariaLabel ?? `Warning: ${label}`}
      data-testid="warning-pill"
    >
      {label}
    </span>
  );
}
