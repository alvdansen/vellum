/**
 * ProviderBadge — subtle pill showing which generation backend produced a version
 * ('comfyui-cloud' | 'replicate' | 'fal' | …), from versions.provider (pivot
 * enhancement #5). Informational metadata, NOT a status/warning: muted surface
 * styling (border + surface bg + muted fg) so it reads distinctly from
 * StatusPill/WarningPill. Renders nothing when provider is null/undefined
 * (legacy pre-pivot rows), so existing single-provider views are unchanged.
 *
 * Pure component: props-in, no callbacks.
 *
 * SECURITY — T-5-06: `provider` is validated upstream to [A-Za-z0-9._-]{1,64}
 * (MCP register + webhook route) and rendered as JSX text — Preact auto-escapes.
 * No dangerouslySetInnerHTML.
 *
 * Accessibility: role="note" + aria-label so assistive tech announces the backend.
 * Stable data-testid for drawer integration tests.
 */

export interface ProviderBadgeProps {
  provider?: string | null;
}

export function ProviderBadge({ provider }: ProviderBadgeProps) {
  if (!provider) return null;
  return (
    <span
      class="provider-badge inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs font-normal text-[var(--color-fg-muted)]"
      role="note"
      aria-label={`Provider: ${provider}`}
      data-testid="provider-badge"
    >
      {provider}
    </span>
  );
}
