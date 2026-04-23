/**
 * DiffDrawer — 2nd-level drawer rendering before/after version comparison.
 *
 * Per must-have contract (Plan 05-10 frontmatter):
 *   "DiffDrawer renders before/after version cards side by side"
 *
 * Composition:
 *   - header: title + close button
 *   - two-column grid: VersionCard (before) | VersionCard (after)
 *   - summary section: one-line count of changes per category (params/models/
 *     seed/workflow/metadata) when a structured diff payload is supplied.
 *
 * The real REST shape for `GET /api/versions/:id/diff?against=<other>` returns
 * `{ summary, changes }` (see src/types/provenance.ts::DiffResponse). The two
 * Version entities the cards need are already held by the parent (VersionDrawer)
 * — they come from the shot's versions list. This drawer is pure presentation;
 * it does not fetch.
 *
 * Pure component: props-in, callbacks-out. No fetch, no signal reads.
 *
 * SECURITY — T-5-06: all dynamic content (version labels, summary text) flows
 * as JSX text children (Preact auto-escapes). No dangerouslySetInnerHTML.
 */

import { VersionCard } from '../components/VersionCard.js';
import { EmptyState } from '../components/EmptyState.js';
import type { VersionCardVersion } from '../components/VersionCard.js';

/**
 * Minimal diff summary surface the drawer renders. The server returns a richer
 * DiffResponse; we read only `summary` (a human-readable one-liner) here. The
 * full `changes` structure is rendered by a future plan's richer diff view.
 */
export interface DiffSummary {
  summary: string;
}

export interface DiffDrawerProps {
  before: VersionCardVersion | null;
  after: VersionCardVersion | null;
  diff?: DiffSummary | null;
  onClose: () => void;
}

export function DiffDrawer({ before, after, diff, onClose }: DiffDrawerProps) {
  return (
    <aside
      class="fixed inset-y-0 right-0 z-20 flex flex-col gap-4 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-xl"
      style={{ width: 'var(--drawer-diff-width)' }}
      role="dialog"
      aria-label="Version diff"
    >
      <header class="flex items-center justify-between">
        <h2
          class="text-base font-semibold text-[var(--color-fg)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Version Diff
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close diff"
          class="inline-flex items-center justify-center rounded p-1 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
        >
          ×
        </button>
      </header>

      <div class="grid grid-cols-2 gap-4">
        <section>
          <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">Before</h3>
          {before ? (
            <VersionCard
              version={before}
              isSelected={false}
              onSelect={() => {
                /* non-interactive in diff view */
              }}
            />
          ) : (
            <EmptyState message="No prior version" />
          )}
        </section>
        <section>
          <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">After</h3>
          {after ? (
            <VersionCard
              version={after}
              isSelected={false}
              onSelect={() => {
                /* non-interactive in diff view */
              }}
            />
          ) : (
            <EmptyState message="No version" />
          )}
        </section>
      </div>

      {diff ? (
        <section>
          <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">Summary</h3>
          <p class="rounded bg-[var(--color-surface-alt)] p-3 text-sm text-[var(--color-fg)]">
            {diff.summary}
          </p>
        </section>
      ) : null}
    </aside>
  );
}
