// packages/dashboard/src/state/hierarchy.ts
//
// @preact/signals-backed store for the TreeSidebar hierarchy (Plan 05-09).
// Tracks the currently-loaded workspaces list plus the "selected path" —
// one ID per hierarchy level so the sidebar can highlight the open chain.
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Uses dashboard-local entity DTOs
// from ../types/entities.ts and dashboard-local sort types from ../lib/sortTypes.ts.
//
// Plan 05-08 Task 2 — lightweight signal bag consumed by Plan 05-09
// components. Each signal is default-null / empty; view components hydrate
// them via api.ts fetches on mount or on node expansion.
//
// Phase 18 / Plan 18-05 Task 1 — adds the treeSort signal. D-09 single
// tree-wide sort applies to ALL hierarchy levels uniformly (workspaces,
// projects, sequences, shots within their parent's children array). The
// dashboard re-sorts client-side via compareTreeNodes (sortHelpers.ts) so
// toggling the tree sort doesn't fire any new fetches.

import { signal } from '@preact/signals';
import type { Workspace } from '../types/entities.js';
import {
  DEFAULT_HIERARCHY_SORT,
  type HierarchySort,
} from '../lib/sortTypes.js';

/** Root list — hydrated via fetchWorkspaces() at app boot. */
export const workspaces = signal<Workspace[]>([]);

/** Currently-selected workspace (null = none chosen). */
export const selectedWorkspaceId = signal<string | null>(null);

/** Currently-selected project under the selected workspace. */
export const selectedProjectId = signal<string | null>(null);

/** Currently-selected sequence under the selected project. */
export const selectedSequenceId = signal<string | null>(null);

/** Currently-selected shot under the selected sequence. */
export const selectedShotId = signal<string | null>(null);

// ============================================================================
// Phase 18 / Plan 18-05 — tree-wide sort state
// ============================================================================

/**
 * SORT-04: current sort applied to the tree (D-09 single tree-wide sort,
 * NOT per-level). Default = A→Z. HomeView's tree composition useMemo reads
 * this and applies compareTreeNodes() at all 4 hierarchy levels client-side,
 * so toggling fires zero new fetches.
 */
export const treeSort = signal<HierarchySort>(DEFAULT_HIERARCHY_SORT);
