/**
 * SummarySection — Phase 19 / Plan 19-06 SUM-01..07 thin-wrapper composition
 * component for the AI conversational summary surface.
 *
 * Architecture-purity (D-WEBUI-31): zero imports from `src/`. Composes
 * existing dashboard primitives (WarningPill, RegenerateButton) + a new
 * skeleton block + a children slot for the relocated SUM-07 Provenance
 * disclosure.
 *
 * Discriminated-state render — branches on `summary.state` (loading / success
 * / fallback / error). Mirrors C2paBadge's discriminated-render pattern at
 * packages/dashboard/src/components/C2paBadge.tsx:71-110.
 *
 * SECURITY — T-5-06 / T-19-33: ALL dynamic content flows through JSX text
 * children. The component does NOT use any innerHTML-style escape hatch.
 * summary.text comes from the engine (post D-VAL-1/3 validation gate) or
 * from the deterministic-template fallback — never user-supplied at the
 * component boundary, AND Preact's text-node escape is the second line of
 * defence.
 *
 * Accessibility:
 *   - <section> wrapper carries aria-labelledby pointing at <h3> id
 *   - aria-busy='true' during loading state (mirrors Phase 17 thumbnail pattern)
 *   - Skeleton bars carry aria-hidden='true' + role='presentation' (decorative
 *     for SR users; the section's aria-busy already announces "loading")
 *   - WarningPill ARIA label is the long-form SUM-06 disclosure for SR users
 *   - Body <p> renders summary.text via JSX text-child interpolation (T-5-06)
 *
 * Layout-stability invariant (D-FB-6, BLOCKER #4 revision-1): the section
 * header text ('SUMMARY'), header bounding-box, and child DOM-slot positions
 * are identical across `success` and `fallback` states. The fallback path
 * adds a <WarningPill/> ABOVE the body <p> WITHIN the same DOM slot — no new
 * section header, no header-height change. Verified by the DOM-stability
 * test in __tests__/SummarySection.test.tsx (Test 16).
 */

import type { ComponentChildren } from 'preact';
import {
  SUMMARY_HEADING,
  SUMMARY_ERROR_FALLBACK,
  WARNING_PILL_FALLBACK_LABEL,
  WARNING_PILL_FALLBACK_ARIA,
  SUMMARY_FIRST_USE_DISCLOSURE,
  regenerateButtonAriaLabel,
} from '../lib/copy.js';
import type { SummaryState } from '../state/summaries.js';
import { WarningPill } from './WarningPill.js';
import { RegenerateButton } from './RegenerateButton.js';

export interface SummarySectionProps {
  /** Discriminated SummaryState read from summarySignal[version.id]. */
  summary: SummaryState;
  /**
   * Server-reported next-regenerate-allowed timestamp. Forwarded to the
   * RegenerateButton; null/undefined leaves the button enabled.
   */
  regenerateAvailableAtMs?: number | null;
  /**
   * D-PRIV-2 first-use disclosure gate — true when the user has NOT yet
   * dismissed the "AI summary uses your prompt text" note. Parent
   * (VersionDrawer) reads localStorage to compute this.
   */
  showFirstUseDisclosure?: boolean;
  /** Click handler — parent applies 500ms debounce + invokes the actual fetch. */
  onRegenerate: () => void;
  /**
   * Version label for the SR-friendly ARIA referent (e.g., 'v003'). Composed
   * into the RegenerateButton aria-label via regenerateButtonAriaLabel.
   */
  versionLabel: string;
  /**
   * SUM-07 disclosure children — VersionDrawer passes the relocated
   * Provenance section wrapped in a <details> disclosure. Rendered AFTER the
   * summary body, INSIDE this section.
   */
  children?: ComponentChildren;
  /** Optional class for the outer <section> element. */
  class?: string;
}

export function SummarySection({
  summary,
  regenerateAvailableAtMs,
  showFirstUseDisclosure = false,
  onRegenerate,
  versionLabel,
  children,
  class: className,
}: SummarySectionProps) {
  // Section heading id is namespaced by versionLabel so that multiple drawers
  // (or test renders) on the same DOM tree don't collide on aria-labelledby
  // referents.
  const headingId = `summary-heading-${versionLabel}`;
  const ariaLabel = regenerateButtonAriaLabel(versionLabel);
  const isLoading = summary.state === 'loading';
  const containerClass =
    `bg-[var(--color-surface)] p-3 rounded ${className ?? ''}`.trim();

  return (
    <section
      class={containerClass}
      aria-labelledby={headingId}
      aria-busy={isLoading ? 'true' : 'false'}
      data-testid="summary-section"
    >
      <header class="flex items-center justify-between gap-2 mb-2">
        <h3
          id={headingId}
          class="label-uppercase text-[var(--color-fg-muted)]"
        >
          {SUMMARY_HEADING}
        </h3>
        <RegenerateButton
          regenerateAvailableAtMs={regenerateAvailableAtMs ?? null}
          isFetching={isLoading}
          onClick={onRegenerate}
          ariaLabel={ariaLabel}
        />
      </header>

      {/* D-PRIV-2 first-use disclosure — gated by parent (VersionDrawer reads
          localStorage). Renders as a muted note ABOVE the body. */}
      {showFirstUseDisclosure && (
        <p
          class="text-xs text-[var(--color-fg-muted)] mb-2"
          data-testid="first-use-disclosure"
        >
          {SUMMARY_FIRST_USE_DISCLOSURE}
        </p>
      )}

      {/* Discriminated render — 4 states. */}
      {summary.state === 'loading' && <SummarySkeleton />}

      {summary.state === 'success' && (
        <p
          class="text-sm text-[var(--color-fg)]"
          data-testid="summary-body"
        >
          {summary.text}
        </p>
      )}

      {summary.state === 'fallback' && (
        <>
          <WarningPill
            label={WARNING_PILL_FALLBACK_LABEL}
            ariaLabel={WARNING_PILL_FALLBACK_ARIA}
          />
          <p
            class="text-sm text-[var(--color-fg)] mt-2"
            data-testid="summary-body"
          >
            {summary.text}
          </p>
        </>
      )}

      {summary.state === 'error' && (
        <>
          <WarningPill
            label={WARNING_PILL_FALLBACK_LABEL}
            ariaLabel={WARNING_PILL_FALLBACK_ARIA}
          />
          <p
            class="text-sm text-[var(--color-fg)] mt-2"
            data-testid="summary-body"
          >
            {SUMMARY_ERROR_FALLBACK}
          </p>
        </>
      )}

      {/* SUM-07 disclosure slot — children are rendered after the body so the
          collapsible Provenance details lives at the bottom of the section. */}
      {children}
    </section>
  );
}

/**
 * 3-line sentence-shaped skeleton block (UI-SPEC: 14px height, widths
 * 95%/100%/60%, gap-1.5 = 6px; uses the existing animate-skeleton-shimmer
 * keyframe from theme.css). Decorative — the section's aria-busy='true'
 * announces the loading state to assistive tech.
 */
function SummarySkeleton() {
  return (
    <div
      class="flex flex-col gap-1.5"
      role="presentation"
      aria-hidden="true"
      data-testid="summary-skeleton"
    >
      <div class="h-[14px] w-[95%] rounded bg-[var(--color-border-subtle)] animate-skeleton-shimmer" />
      <div class="h-[14px] w-full rounded bg-[var(--color-border-subtle)] animate-skeleton-shimmer" />
      <div class="h-[14px] w-3/5 rounded bg-[var(--color-border-subtle)] animate-skeleton-shimmer" />
    </div>
  );
}
