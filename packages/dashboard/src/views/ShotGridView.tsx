/**
 * ShotGridView — top-level shot grid surface (Phase 21 / Plan 21-04 Task T01).
 *
 * Mount-time URL hydration + mount-time first fetch keyed on
 * `selectedSequenceForGrid`. SSE-driven status updates flow through the
 * shotGrid signal mutation in state/shot-grid.ts `onShotStatusChanged` — the
 * subscription itself lives in App.tsx (D-22 + RESEARCH "Anti-Patterns" line
 * 817), NOT inside this view, so status updates apply even when the user is
 * on HomeView.
 *
 * Layout (D-10, REQ-04, D-15):
 *   - <ShotGridFilterBar/> — sticky top (position: sticky, top: 0)
 *   - <SequenceHeader/> — name + aggregate count mini-pills + chevron toggle
 *   - CSS Grid (inline-style `repeat(auto-fill, minmax(220px, 1fr))`, 16px gap)
 *     populated with <ShotGridCard/> instances keyed on shot.id
 *   - <LoadMoreButton/> footer when `next_cursor !== null`
 *
 * Filtering (REQ-03, D-07, D-08):
 *   - Two orthogonal controls. `showOmitted` gates the dataset (omit hidden
 *     when false). `statusFilter` filters within the dataset (or 'all' shows
 *     every status that survives the omit gate). Server NEVER receives these
 *     as query params — all filtering is client-side over `shotGrid.value.shots`.
 *
 * Empty state copy (D-18, four branches):
 *   1. zero shots in sequence       → SHOT_GRID_EMPTY_NO_SHOTS
 *   2. filter='all', showOmitted=false, dataset has shots but all are omit
 *      → SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX + sequenceName + '.'
 *   3. filter='omit' with showOmitted=false (defensive — URL-hydrated state)
 *      → SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN
 *   4. specific status filter with no matches in sequence
 *      → SHOT_GRID_EMPTY_FILTER_PREFIX + status + "' in " + sequenceName + '.'
 *
 * Card click (D-04, D-19):
 *   - Sets `selectedVersionId.value = latest_completed_version.id` to open the
 *     VersionDrawer overlay. Does NOT mutate the HomeView shot-selection
 *     signal — HomeView's state is preserved across view switches.
 *
 * Architecture-purity (D-WEBUI-31): zero server-tree imports — only sibling
 * dashboard modules plus `preact/hooks`.
 *
 * SECURITY (T-5-06): sequence/shot names render as JSX text children (Preact
 * auto-escapes). All copy comes from `lib/copy.ts` constants — zero inline
 * user-facing literals.
 */

import { useEffect, useState } from 'preact/hooks';
import { fetchShotGrid } from '../lib/api.js';
import { ShotGridFilterBar } from '../components/ShotGridFilterBar.js';
import { SequenceHeader } from '../components/SequenceHeader.js';
import { ShotGridCard } from '../components/ShotGridCard.js';
import { LoadMoreButton } from '../components/LoadMoreButton.js';
import { EmptyState } from '../components/EmptyState.js';
import {
  selectedSequenceForGrid,
  shotGrid,
  statusFilter,
  showOmitted,
  gridIsFetching,
  gridLoadMoreError,
  aggregateCounts,
  hydrateShotGridUrlState,
  persistShotGridUrlState,
} from '../state/shot-grid.js';
import { selectedVersionId } from '../state/versions.js';
import type { ShotGridRow } from '../types/shot-grid.js';
import {
  SHOT_GRID_EMPTY_NO_SHOTS,
  SHOT_GRID_EMPTY_FILTER_PREFIX,
  SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX,
  SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN,
  SHOT_GRID_LOADING_LABEL,
  LOAD_MORE_ERROR_PREFIX_FAILED,
  LOAD_MORE_ERROR_PREFIX_NETWORK,
} from '../lib/copy.js';

/**
 * Map a fetchShotGrid error to the user-readable LoadMoreButton error pill
 * copy. Network errors (TypeError thrown by fetch on offline / DNS fail)
 * surface as LOAD_MORE_ERROR_PREFIX_NETWORK; everything else (4xx/5xx
 * envelope from server, JSON parse error, unknown) surfaces as
 * LOAD_MORE_ERROR_PREFIX_FAILED. Mirrors `HomeView.tsx:157-163` precedent.
 */
function mapFetchErrorToCopy(err: unknown): string {
  if (err instanceof TypeError) return LOAD_MORE_ERROR_PREFIX_NETWORK;
  return LOAD_MORE_ERROR_PREFIX_FAILED;
}

export function ShotGridView() {
  // D-15: open by default; session-only state (no localStorage persistence).
  const [headerExpanded, setHeaderExpanded] = useState(true);

  // Mount-time URL hydration — runs ONCE (empty deps). Reads URL search
  // params through the Zod whitelist and writes valid values to signals.
  // Defensive: never throws (see state/shot-grid.ts hydrateShotGridUrlState).
  useEffect(() => {
    hydrateShotGridUrlState();
  }, []);

  // Initial-page fetch effect, keyed on selectedSequenceForGrid.value. The
  // `alive` latch protects against late-arriving promises when the sequence
  // changes rapidly (the previous fetch's then-handler would otherwise
  // overwrite the newer shotGrid value).
  useEffect(() => {
    const seqId = selectedSequenceForGrid.value;
    if (!seqId) return;
    let alive = true;
    gridIsFetching.value = true;
    gridLoadMoreError.value = null;
    fetchShotGrid(seqId, { limit: 20 })
      .then((res) => {
        if (!alive) return;
        shotGrid.value = res;
        gridIsFetching.value = false;
      })
      .catch((err) => {
        if (!alive) return;
        gridLoadMoreError.value = mapFetchErrorToCopy(err);
        gridIsFetching.value = false;
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSequenceForGrid.value]);

  // Load-more click handler (D-21 LoadMoreButton reuse). Appends to the
  // existing buffer; preserves total_count + advances next_cursor.
  function loadMore(): void {
    const seqId = selectedSequenceForGrid.value;
    const current = shotGrid.value;
    const cursor = current?.next_cursor ?? null;
    if (!seqId || !cursor) return;
    if (gridIsFetching.value) return; // idempotency guard
    gridIsFetching.value = true;
    gridLoadMoreError.value = null;
    fetchShotGrid(seqId, { cursor, limit: 20 })
      .then((res) => {
        const existing = shotGrid.value;
        if (!existing) {
          shotGrid.value = res;
        } else {
          shotGrid.value = {
            ...existing,
            shots: [...existing.shots, ...res.shots],
            next_cursor: res.next_cursor,
            total_count: res.total_count,
          };
        }
        gridIsFetching.value = false;
      })
      .catch((err) => {
        gridLoadMoreError.value = mapFetchErrorToCopy(err);
        gridIsFetching.value = false;
      });
  }

  // Client-side filter (REQ-03 + D-08):
  //   - showOmitted=false gates omit shots out of the dataset entirely
  //   - statusFilter='all' shows everything that survives the omit gate
  //   - any other statusFilter restricts to matching shots
  const allShots: ShotGridRow[] = shotGrid.value?.shots ?? [];
  const filteredShots = allShots.filter((s) => {
    if (s.status === 'omit' && !showOmitted.value) return false;
    if (statusFilter.value === 'all') return true;
    return s.status === statusFilter.value;
  });

  const sequenceName = shotGrid.value?.sequence.name ?? '';
  const hasAnyShots = allShots.length > 0;
  const hasAnyNonOmit = allShots.some((s) => s.status !== 'omit');

  // Empty state copy selection (D-18, four branches):
  //
  //   - 1: sequence has zero shots → SHOT_GRID_EMPTY_NO_SHOTS
  //   - 2: filter='all' + showOmitted=false but every shot is omit
  //        → SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX + name + '.'
  //   - 3: defensive — filter='omit' but showOmitted=false (URL-hydrated state)
  //        → SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN
  //   - 4: any specific status filter with no matches in sequence
  //        → SHOT_GRID_EMPTY_FILTER_PREFIX + status + "' in " + name + '.'
  let emptyMessage: string | null = null;
  if (filteredShots.length === 0 && shotGrid.value !== null) {
    if (!hasAnyShots) {
      emptyMessage = SHOT_GRID_EMPTY_NO_SHOTS;
    } else if (
      statusFilter.value === 'all' &&
      !showOmitted.value &&
      !hasAnyNonOmit
    ) {
      emptyMessage = `${SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX}${sequenceName}.`;
    } else if (statusFilter.value === 'all') {
      // Defensive: if filter='all' yields zero matches with hasAnyNonOmit
      // (e.g. all non-omit shots happen to share an unfiltered-out status),
      // fall back to the same "no active shots" copy.
      emptyMessage = `${SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX}${sequenceName}.`;
    } else if (statusFilter.value === 'omit' && !showOmitted.value) {
      // 21-04 plan-checker FLAG: defensive branch — URL hydration could set
      // statusFilter='omit' while showOmitted=false. Surface a self-explanatory
      // copy that points the user at the Show omitted toggle.
      emptyMessage = SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN;
    } else {
      emptyMessage = `${SHOT_GRID_EMPTY_FILTER_PREFIX}${statusFilter.value}' in ${sequenceName}.`;
    }
  }

  const remaining =
    shotGrid.value !== null
      ? Math.max(0, shotGrid.value.total_count - allShots.length)
      : 0;

  return (
    <div class="flex h-full flex-col overflow-y-auto bg-[var(--color-bg)]">
      <ShotGridFilterBar
        statusFilter={statusFilter.value}
        showOmitted={showOmitted.value}
        onChangeStatusFilter={(next) => {
          statusFilter.value = next;
          persistShotGridUrlState();
        }}
        onToggleShowOmitted={() => {
          const next = !showOmitted.value;
          showOmitted.value = next;
          // D-07: when turning OFF and currently filtering by omit, reset to
          // 'all' so the user isn't left staring at an empty grid.
          if (!next && statusFilter.value === 'omit') {
            statusFilter.value = 'all';
          }
          persistShotGridUrlState();
        }}
      />
      {shotGrid.value && (
        <SequenceHeader
          sequenceName={shotGrid.value.sequence.name}
          expanded={headerExpanded}
          onToggleExpanded={() => setHeaderExpanded(!headerExpanded)}
          counts={aggregateCounts.value}
        />
      )}
      {headerExpanded && (
        <>
          {/* Loading branch — initial fetch in flight. */}
          {!shotGrid.value && gridIsFetching.value && (
            <EmptyState message={SHOT_GRID_LOADING_LABEL} />
          )}
          {/* Empty state — sequence loaded but filtered set is empty. */}
          {shotGrid.value && emptyMessage !== null && (
            <EmptyState message={emptyMessage} />
          )}
          {/* Grid — at least one filtered shot. */}
          {shotGrid.value && filteredShots.length > 0 && (
            <div
              class="grid gap-4 p-4"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              }}
            >
              {filteredShots.map((shot) => (
                <ShotGridCard
                  key={shot.id}
                  shot={shot}
                  onSelect={(versionId) => {
                    // D-04: open VersionDrawer via selectedVersionId; do NOT
                    // mutate the HomeView shot-selection signal. HomeView
                    // keeps its prior selection across the view switch.
                    selectedVersionId.value = versionId;
                  }}
                />
              ))}
            </div>
          )}
          {/* LoadMoreButton — only when there are more pages to fetch. */}
          {shotGrid.value &&
            shotGrid.value.next_cursor !== null &&
            shotGrid.value.next_cursor !== undefined &&
            remaining > 0 && (
              <div class="flex justify-center py-6">
                <LoadMoreButton
                  remaining={remaining}
                  pageSize={20}
                  isFetching={gridIsFetching.value}
                  errorMessage={gridLoadMoreError.value}
                  onClick={loadMore}
                />
              </div>
            )}
        </>
      )}
    </div>
  );
}
