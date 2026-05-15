/**
 * Phase 22 / Plan 22-05 — ReviewTimeline.
 *
 * Unified, chronologically-interleaved feed of version events (created /
 * completed) and shot_status_events rows. D-04 lock: a single timeline,
 * not two parallel lists.
 *
 * Row shapes (D-04):
 *  - Version rows are CLICKABLE — clicking opens the version drawer via
 *    `openVersionDrawer(versionId)` (D-02 mutex with the review panel).
 *  - Status rows are NON-INTERACTIVE — display the ShotStatusPill, the
 *    changed_by attribution, the relative time, and the optional note.
 *
 * Empty state: REVIEW_HISTORY_EMPTY when entries.length === 0.
 *
 * Security (T-22-17): note + changed_by render as JSX text children —
 * Preact auto-escape; no innerHTML.
 *
 * Pure presentational: props in, DOM out. Parent (ReviewPanel) merges
 * versions + statusHistory via lib/mergeHistory.
 */

import type { JSX } from 'preact';
import type { ShotHistoryEntry } from '../types/review-panel.js';
import { ShotStatusPill } from './ShotStatusPill.js';
import { formatRelativeTime } from '../lib/time.js';
import {
  REVIEW_SECTION_HISTORY,
  REVIEW_HISTORY_EMPTY,
  TIMELINE_CHANGED_BY_PREFIX,
  TIMELINE_VERSION_CREATED_PREFIX,
  TIMELINE_VERSION_CREATED_SUFFIX,
  TIMELINE_VERSION_COMPLETED_PREFIX,
  TIMELINE_VERSION_COMPLETED_SUFFIX,
  TIMELINE_STATUS_CHANGED_PREFIX,
  TIMELINE_VERSION_ROW_ARIA_PREFIX,
  TIMELINE_VERSION_ROW_ARIA_SUFFIX,
} from '../lib/copy.js';

function versionLabel(versionNumber: number | null | undefined): string {
  if (typeof versionNumber !== 'number') return 'v?';
  return `v${String(versionNumber).padStart(3, '0')}`;
}

export interface ReviewTimelineProps {
  entries: readonly ShotHistoryEntry[];
  onVersionClick: (versionId: string) => void;
}

export function ReviewTimeline({
  entries,
  onVersionClick,
}: ReviewTimelineProps): JSX.Element {
  return (
    <section aria-label="Shot history" class="flex flex-col gap-2">
      <h3 class="label-uppercase text-[var(--color-fg-muted)]">
        {REVIEW_SECTION_HISTORY}
      </h3>
      {entries.length === 0 ? (
        <p class="text-sm text-[var(--color-fg-muted)]">
          {REVIEW_HISTORY_EMPTY}
        </p>
      ) : (
        <ul role="log" class="flex flex-col gap-1">
          {entries.map((entry) => {
            if (entry.kind === 'version') {
              const label = versionLabel(entry.version.version_number ?? null);
              const prefix =
                entry.event === 'created'
                  ? TIMELINE_VERSION_CREATED_PREFIX
                  : TIMELINE_VERSION_COMPLETED_PREFIX;
              const suffix =
                entry.event === 'created'
                  ? TIMELINE_VERSION_CREATED_SUFFIX
                  : TIMELINE_VERSION_COMPLETED_SUFFIX;
              return (
                <li key={`v-${entry.version.id}-${entry.event}`}>
                  <button
                    type="button"
                    onClick={() => onVersionClick(entry.version.id)}
                    aria-label={`${TIMELINE_VERSION_ROW_ARIA_PREFIX}${label}${TIMELINE_VERSION_ROW_ARIA_SUFFIX}`}
                    class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                  >
                    <span>
                      {prefix}
                      {label}
                      {suffix}
                    </span>
                    <span class="text-xs text-[var(--color-fg-muted)] num">
                      {formatRelativeTime(entry.at)}
                    </span>
                  </button>
                </li>
              );
            }
            // status row — non-interactive
            const ev = entry.event;
            return (
              <li
                key={`s-${ev.id}`}
                class="flex flex-col gap-1 rounded px-2 py-1 text-sm"
                data-status={ev.to_status}
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span>{TIMELINE_STATUS_CHANGED_PREFIX}</span>
                    <ShotStatusPill status={ev.to_status} />
                  </div>
                  <span class="text-xs text-[var(--color-fg-muted)] num">
                    {formatRelativeTime(ev.created_at)}
                  </span>
                </div>
                <div class="text-xs text-[var(--color-fg-muted)]">
                  {TIMELINE_CHANGED_BY_PREFIX}
                  {ev.changed_by}
                </div>
                {ev.note ? (
                  <div class="text-xs text-[var(--color-fg)]">{ev.note}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
