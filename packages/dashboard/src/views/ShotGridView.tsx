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

import { useEffect } from 'preact/hooks';
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
  headerExpanded,
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
  SHOT_GRID_FETCH_ERROR,
  LOAD_MORE_ERROR_PREFIX_FAILED,
  LOAD_MORE_ERROR_PREFIX_NETWORK,
  LOAD_MORE_RETRY_LABEL,
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
  // Phase 21 / Plan 21-06 — `headerExpanded` is now a module-singleton signal
  // in `state/shot-grid.ts`. It was a useState here in 21-04, but ShotGridView
  // unmounts whenever activeView flips back to 'home' (App.tsx:105 mount
  // switch), which silently reset the user's collapse toggle to its default.
  // D-15 says "session-only state (no localStorage)" — a module-singleton
  // signal lasts until full page reload, which matches that contract.
  //
  // URL hydration was also called from this view's useEffect in 21-04; it now
  // runs in App.tsx's boot useEffect (single boot scope, runs before view
  // routing — see 21-AUDIT.md §5 Bug 1).

  // Initial-page fetch effect, keyed on selectedSequenceForGrid.value. The
  // `alive` latch protects against late-arriving promises when the sequence
  // changes rapidly (the previous fetch's then-handler would otherwise
  // overwrite the newer shotGrid value).
  //
  // Phase 21 / Plan 21-06 — Bugs 4 and 6 fix (21-AUDIT.md §1 rows 4, 6).
  //
  // Bug 4: previously this effect awaited fetchShotGrid before touching
  // shotGrid.value, so a sequence change re-rendered the view with the
  // PREVIOUS sequence's shots still in shotGrid until the new fetch resolved.
  // Now we clear shotGrid.value AND gridLoadMoreError synchronously at the
  // top — the next paint is a clean loading state.
  //
  // Bug 6: previously a fetch rejection only set gridLoadMoreError to the
  // generic "Failed to load" copy, but that copy was wired through the
  // LoadMoreButton pill which only renders when shotGrid is non-null AND
  // has more pages. With shotGrid still null the entire pane was blank.
  // Now the .catch() sets SHOT_GRID_FETCH_ERROR and the render switch
  // checks for the error BEFORE the empty-state branch, producing a visible
  // retry surface.
  useEffect(() => {
    const seqId = selectedSequenceForGrid.value;
    if (!seqId) return;
    // Bug 4 fix — clear stale grid + any stale error BEFORE awaiting so the
    // user sees a clean loading state during the switch, not the prior
    // sequence's data bleeding through.
    shotGrid.value = null;
    gridLoadMoreError.value = null;
    let alive = true;
    gridIsFetching.value = true;
    fetchShotGrid(seqId, { limit: 20 })
      .then((res) => {
        if (!alive) return;
        shotGrid.value = res;
        gridIsFetching.value = false;
      })
      .catch(() => {
        if (!alive) return;
        // Bug 6 fix — full-pane error copy. We deliberately use the
        // SHOT_GRID_FETCH_ERROR constant (not mapFetchErrorToCopy) because
        // the error renders as the FULL pane state, not the inline pill.
        gridLoadMoreError.value = SHOT_GRID_FETCH_ERROR;
        gridIsFetching.value = false;
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSequenceForGrid.value]);

  /**
   * Load-more click handler (D-21 LoadMoreButton reuse). Appends to the
   * existing buffer; preserves total_count + advances next_cursor.
   *
   * Phase 21 / Plan 21-06 — Bug 3 BLOCKING race-condition fix
   * (21-AUDIT.md §1 row 3, codex_challenge). Without a sequence-id guard
   * the following sequence corrupts data:
   *
   *   1. user on seq A clicks Load more → fetch A page-2 dispatched
   *   2. user clicks grid-icon for seq B (selectedSequenceForGrid flips)
   *   3. fetch A page-2 resolves AFTER the seq-B init effect has already
   *      populated shotGrid.value with B's page-1
   *   4. the stale .then() appends A's shots into B's grid + B's
   *      next_cursor is replaced with A's cursor
   *
   * The `requestSeqId` capture + post-await equality check rejects any
   * response whose dispatch-time sequence no longer matches the current
   * sequence. Idempotent under the gridIsFetching guard at entry, and
   * race-safe under the seqId guard after await.
   */
  function loadMore(): void {
    const requestSeqId = selectedSequenceForGrid.value;
    const current = shotGrid.value;
    const cursor = current?.next_cursor ?? null;
    if (!requestSeqId || !cursor) return;
    if (gridIsFetching.value) return; // idempotency guard
    gridIsFetching.value = true;
    gridLoadMoreError.value = null;
    fetchShotGrid(requestSeqId, { cursor, limit: 20 })
      .then((res) => {
        // Bug 3 guard: drop late responses for a sequence the user has
        // navigated away from. Without this check, A's late page-2 would
        // overwrite B's freshly-loaded shotGrid.value.
        if (selectedSequenceForGrid.value !== requestSeqId) {
          // Clear the in-flight flag for this stale request — the active
          // sequence's own fetch (if any) will reset it on resolve.
          gridIsFetching.value = false;
          return;
        }
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
        // Same Bug 3 guard on the failure path — a stale rejection must
        // not flash an error pill on the new sequence's grid.
        if (selectedSequenceForGrid.value !== requestSeqId) {
          gridIsFetching.value = false;
          return;
        }
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
          expanded={headerExpanded.value}
          onToggleExpanded={() => {
            headerExpanded.value = !headerExpanded.value;
          }}
          counts={aggregateCounts.value}
        />
      )}
      {headerExpanded.value && (
        <>
          {/* Loading branch — initial fetch in flight. */}
          {!shotGrid.value && gridIsFetching.value && (
            <EmptyState message={SHOT_GRID_LOADING_LABEL} />
          )}
          {/* Phase 21 / Plan 21-06 — Bug 6 fix: full-pane error state when
           *  the initial fetch rejects (shotGrid still null, no fetch in
           *  flight, but gridLoadMoreError set). Renders the error copy plus
           *  a Retry button that re-triggers the fetch effect by re-writing
           *  the sequence-id signal (assignment to its own value bumps the
           *  effect's dependency identity). */}
          {!shotGrid.value &&
            !gridIsFetching.value &&
            gridLoadMoreError.value && (
              <div
                role="alert"
                class="flex flex-col items-center justify-center gap-3 py-16 text-[var(--color-fg-muted)]"
              >
                <span class="text-sm">{gridLoadMoreError.value}</span>
                <button
                  type="button"
                  onClick={() => {
                    // Re-fire the init effect by re-assigning the seqId.
                    // selectedSequenceForGrid.value === current val is a
                    // no-op for signal subscribers, so we cycle through
                    // null and back to force the effect's dep to change.
                    const seq = selectedSequenceForGrid.value;
                    if (!seq) return;
                    selectedSequenceForGrid.value = null;
                    selectedSequenceForGrid.value = seq;
                  }}
                  class="rounded border border-[var(--color-border)] px-3 py-1 text-xs font-medium text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                >
                  {LOAD_MORE_RETRY_LABEL}
                </button>
              </div>
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
