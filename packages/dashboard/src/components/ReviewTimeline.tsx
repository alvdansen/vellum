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

import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { GitCompare } from 'lucide-preact';
import type { ShotHistoryEntry } from '../types/review-panel.js';
import { ShotStatusPill } from './ShotStatusPill.js';
import { formatRelativeTime } from '../lib/time.js';
import {
  compareSelection,
  compareModalOpen,
} from '../state/review-panel.js';
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
  COMPARE_MODE_ENTER_LABEL,
  COMPARE_MODE_ENTER_ARIA,
  COMPARE_MODE_CTA_LABEL,
  COMPARE_MODE_CTA_DISABLED_ARIA,
  COMPARE_MODE_CTA_READY_ARIA,
  COMPARE_MODE_CANCEL_LABEL,
  COMPARE_MODE_CHECKBOX_ARIA_PREFIX,
  COMPARE_MODE_HINT,
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
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [selectionOrder, setSelectionOrder] = useState<{
    first: 'a' | 'b' | null;
  }>({ first: null });

  // Eligible versions for compare = completed events only (D-14: only
  // completed versions are comparable; created-only rows can't have a
  // diff yet).
  const versionIds = entries
    .filter((e) => e.kind === 'version' && e.event === 'completed')
    .map((e) => (e as Extract<ShotHistoryEntry, { kind: 'version' }>).version.id);
  const canEnterCompareMode = versionIds.length >= 2;

  const sel = compareSelection.value;

  function handleCheckboxToggle(versionId: string, checked: boolean): void {
    const cur = compareSelection.value;
    if (checked) {
      if (cur.a === null) {
        compareSelection.value = { ...cur, a: versionId };
        setSelectionOrder({ first: 'a' });
      } else if (cur.b === null) {
        compareSelection.value = { ...cur, b: versionId };
        if (selectionOrder.first === null) setSelectionOrder({ first: 'a' });
      } else {
        // LRU-2: third click replaces the slot that was set first.
        // first='a' means 'a' was the original pick (older); we KEEP 'a'
        // and swap 'b' to the new pick. Symmetric for first='b'.
        if (selectionOrder.first === 'a') {
          compareSelection.value = { a: cur.a, b: versionId };
        } else {
          compareSelection.value = { a: versionId, b: cur.b };
        }
      }
    } else {
      if (cur.a === versionId)
        compareSelection.value = { ...cur, a: null };
      if (cur.b === versionId)
        compareSelection.value = { ...cur, b: null };
    }
  }

  function exitCompareMode(): void {
    setCompareMode(false);
    compareSelection.value = { a: null, b: null };
    setSelectionOrder({ first: null });
  }

  // ESC exits compare-mode (UI-SPEC L455). Only attached when compareMode
  // is active so the listener has no effect when the timeline is in its
  // default state.
  useEffect(() => {
    if (!compareMode) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        exitCompareMode();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  const compareReady = sel.a !== null && sel.b !== null;

  return (
    <section aria-label="Shot history" class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="label-uppercase text-[var(--color-fg-muted)]">
          {REVIEW_SECTION_HISTORY}
        </h3>
        {!compareMode && canEnterCompareMode ? (
          <button
            type="button"
            onClick={() => setCompareMode(true)}
            aria-label={COMPARE_MODE_ENTER_ARIA}
            class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <GitCompare size={14} />
            {COMPARE_MODE_ENTER_LABEL}
          </button>
        ) : null}
      </div>

      {compareMode ? (
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-[var(--color-fg-muted)]">
            {COMPARE_MODE_HINT}
          </span>
          <div class="flex gap-1">
            <button
              type="button"
              onClick={exitCompareMode}
              class="rounded px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              {COMPARE_MODE_CANCEL_LABEL}
            </button>
            <button
              type="button"
              onClick={() => {
                compareModalOpen.value = true;
              }}
              disabled={!compareReady}
              aria-label={
                compareReady
                  ? COMPARE_MODE_CTA_READY_ARIA
                  : COMPARE_MODE_CTA_DISABLED_ARIA
              }
              class="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-normal text-[var(--color-bg)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              {COMPARE_MODE_CTA_LABEL}
            </button>
          </div>
        </div>
      ) : null}

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
              const isCompareable =
                compareMode && entry.event === 'completed';
              const isChecked =
                sel.a === entry.version.id || sel.b === entry.version.id;
              return (
                <li
                  key={`v-${entry.version.id}-${entry.event}`}
                  class="flex items-center gap-2"
                >
                  {isCompareable ? (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) =>
                        handleCheckboxToggle(
                          entry.version.id,
                          (e.target as HTMLInputElement).checked,
                        )
                      }
                      aria-label={`${COMPARE_MODE_CHECKBOX_ARIA_PREFIX}${label}`}
                      class="ml-2"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onVersionClick(entry.version.id)}
                    aria-label={`${TIMELINE_VERSION_ROW_ARIA_PREFIX}${label}${TIMELINE_VERSION_ROW_ARIA_SUFFIX}`}
                    class="flex flex-1 items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
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
