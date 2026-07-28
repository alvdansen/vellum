/**
 * Type mirror of server-side sort enums.
 *
 * D-WEBUI-31 architecture-purity: this dashboard package MUST NOT import
 * from src/store/. Types are duplicated here verbatim. The file-level
 * architecture-purity grep gate
 * structurally enforces the no-server-import invariant.
 *
 * DUPLICATE OF src/store/sort.ts — keep in lockstep.
 * If the server-side enum gains a new field or direction, mirror it here
 * AND update GRID_SORT_OPTIONS / TREE_SORT_OPTIONS in sortHelpers.ts.
 *
 * DEVIATION 2 (inherited from src/store/sort.ts header): the engine
 * SortField enum keeps `name` for whitelist completeness even though the
 * `versions` table has no `name` column (server-side falls back to
 * versions.id). The dashboard's GRID_SORT_OPTIONS (sortHelpers.ts) does
 * NOT expose `name` because the UI surface narrows to fields that are
 * actually meaningful for version rows (DEVIATION 1, sortHelpers.ts).
 *
 * SECURITY notes:
 *   - The closed string-literal enums constrain the surface so user input
 *     can never reach a column reference.
 *   - parseSortValue (sortHelpers.ts) validates against these enums via
 *     ReadonlySet whitelists; the graceful-fallback contract holds.
 */

// Mirror — keep byte-equal with src/store/sort.ts:
export type SortField = 'completed_at' | 'created_at' | 'name' | 'version_number';
export type HierarchySortField = 'name' | 'created_at';
export type SortDirection = 'asc' | 'desc';

export interface VersionSort {
  field: SortField;
  dir: SortDirection;
}

export interface HierarchySort {
  field: HierarchySortField;
  dir: SortDirection;
}

/** Grid default — Latest. Mirrors src/store/sort.ts:71. */
export const DEFAULT_VERSION_SORT: VersionSort = {
  field: 'completed_at',
  dir: 'desc',
};

/** Tree default — A→Z. Mirrors src/store/sort.ts:74. */
export const DEFAULT_HIERARCHY_SORT: HierarchySort = {
  field: 'name',
  dir: 'asc',
};
