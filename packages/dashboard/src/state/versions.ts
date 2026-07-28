// packages/dashboard/src/state/versions.ts
//
// @preact/signals-backed store for the versions list under the selected
// shot, plus the currently-open version-detail drawer target.
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Uses dashboard-local entity DTOs
// from ../types/entities.ts and dashboard-local sort types from ../lib/sortTypes.ts.
//
// Lightweight signal bag consumed by the version-list and drawer
// components. The version list is hydrated via fetchVersions(shotId, ...)
// when selectedShotId changes; the drawer target mirrors a row click.
//
// The sort + cursor pagination signals (gridSort, gridCursor, gridTotalCount,
// gridIsFetching, gridLoadMoreError) are read by HomeView to drive the
// SortDropdown + LoadMoreButton primitives. gridIsFetching is a
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
// Grid sort + cursor pagination state
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
