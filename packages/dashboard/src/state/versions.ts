// packages/dashboard/src/state/versions.ts
//
// @preact/signals-backed store for the versions list under the selected
// shot, plus the currently-open version-detail drawer target (Plan 05-10).
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Uses dashboard-local entity DTOs
// from ../types/entities.ts and dashboard-local sort types from ../lib/sortTypes.ts.
//
// Plan 05-08 Task 2 — lightweight signal bag consumed by Plan 05-10
// components. The version list is hydrated via fetchVersions(shotId, ...)
// when selectedShotId changes; the drawer target mirrors a row click.
//
// Phase 18 / Plan 18-05 Task 1 — extends the signal bag with sort + cursor
// pagination state. The new signals (gridSort, gridCursor, gridTotalCount,
// gridIsFetching, gridLoadMoreError) are read by HomeView (Plan 18-05 Task 2)
// to drive the SortDropdown + LoadMoreButton primitives. Per researcher
// recommendation in 18-RESEARCH.md Open Question #5, gridIsFetching is a
// signal (cross-component visibility) rather than local useState.

import { signal } from '@preact/signals';
import type { Version } from '../types/entities.js';
import { DEFAULT_VERSION_SORT, type VersionSort } from '../lib/sortTypes.js';

/** Versions list for the currently-selected shot. Empty when no shot chosen. */
export const versions = signal<Version[]>([]);

/**
 * The version currently open in the version-detail drawer. null = drawer
 * closed. Drawer component reads this signal to decide whether to render.
 */
export const selectedVersionId = signal<string | null>(null);

// ============================================================================
// Phase 18 / Plan 18-05 — grid sort + cursor pagination state
// ============================================================================

/**
 * SORT-01: current sort applied to the version grid. Default = Latest
 * (completed_at DESC with NULL pin to top — see src/store/sort.ts buildVersionOrderBy).
 * The grid useEffect in HomeView re-fetches page 1 whenever this changes.
 */
export const gridSort = signal<VersionSort>(DEFAULT_VERSION_SORT);

/**
 * SORT-05: opaque base64url cursor for the next page. null on page 1 OR last
 * page. Set from the most-recent fetchVersions response's next_cursor field;
 * cleared to null on shot change or sort change (cursor reset per D-19).
 */
export const gridCursor = signal<string | null>(null);

/**
 * SORT-05: total_count from the most-recent fetchVersions response. Drives
 * LoadMoreButton's "(M remaining)" caption.
 */
export const gridTotalCount = signal<number>(0);

/**
 * SORT-05: true while a Load more or sort-change fetch is in flight. The
 * LoadMoreButton click handler bails out when this is true (idempotency
 * guard) so rapid clicks don't fire duplicate fetches.
 */
export const gridIsFetching = signal<boolean>(false);

/**
 * SORT-05: when non-null, an inline error pill renders below the
 * LoadMoreButton showing this human-readable message + a Retry CTA. Cleared
 * to null at the start of every fetchVersions call.
 */
export const gridLoadMoreError = signal<string | null>(null);
