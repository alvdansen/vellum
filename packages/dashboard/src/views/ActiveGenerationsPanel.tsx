/**
 * ActiveGenerationsPanel — right-rail live panel rendering in-flight versions.
 *
 * Subscribes (reactively) to the `activeGenerations` signal from the data layer
 * (Plan 08). Each row shows a version label + a StatusPill (Plan 09 primitive).
 * Terminal rows (status 'complete' | 'failed') are retained per Plan 08's
 * behavior contract — panel only masks them here via a computed filter so the
 * caller can later decide to surface terminal rows elsewhere without churn to
 * the signal surface.
 *
 * Pure component: no fetch, no mutations, no engine side effects. Reads
 * activeGenerations.value at render time; @preact/signals re-renders on push.
 *
 * SECURITY — T-5-06: version labels flow as JSX text children (Preact
 * auto-escapes). No dangerouslySetInnerHTML.
 */

import { activeGenerations } from '../state/active-generations.js';
import { StatusPill } from '../components/StatusPill.js';
import { EmptyState } from '../components/EmptyState.js';

export function ActiveGenerationsPanel() {
  const gens = activeGenerations.value;
  const running = gens.filter(
    (g) => g.status === 'queued' || g.status === 'running',
  );

  return (
    <aside
      class="flex w-64 flex-shrink-0 flex-col gap-2 border-l border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      aria-label="Active generations"
    >
      <h2 class="label-uppercase text-[var(--color-fg-muted)]">
        Active Generations ({running.length})
      </h2>
      {running.length === 0 ? (
        <EmptyState message="No active generations" />
      ) : (
        <ul class="flex flex-col gap-1">
          {running.map((g) => (
            <li
              key={g.versionId}
              class="flex items-center justify-between gap-2 rounded bg-[var(--color-surface-alt)] px-2 py-1"
            >
              <span class="version-label truncate text-sm text-[var(--color-fg)]">
                {g.label}
              </span>
              <StatusPill status={g.status} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
