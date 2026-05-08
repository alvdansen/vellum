/**
 * HomeView — primary two-pane layout: TreeSidebar (left) + shot-detail panel.
 *
 * Per must-have contract (Plan 05-10 frontmatter):
 *   "HomeView renders TreeSidebar and a shot detail panel side by side"
 *
 * Composition:
 *   - LEFT pane: sort strip (SORT_STRIP_LABEL + tree SortDropdown) +
 *     TreeSidebar (Plan 09 primitive) reading from `workspaces` signal plus
 *     a local nested `tree` state that lazy-hydrates on expand.
 *   - RIGHT pane: sort strip (SORT_STRIP_LABEL + grid SortDropdown) +
 *     scrollable shot-detail panel (VersionCard list driven by the `versions`
 *     signal under the currently-selected shot) + LoadMoreButton footer.
 *   - OVERLAY: VersionDrawer when `selectedVersionId` is non-null.
 *
 * Phase 18 / Plan 18-05 Task 2 — Sortable folder dropdown integration:
 *   - Mount-time hydrateSortState() reconciles URL > localStorage > defaults
 *     for both gridSort and treeSort signals (D-13/D-15/D-16).
 *   - Two SortDropdown instances (D-08 reuse) render above tree + grid; the
 *     same component handles both with TField generic constraint.
 *   - LoadMoreButton renders at the version-list bottom ONLY when
 *     gridCursor.value !== null AND versionsList.length > 0 (SORT-05).
 *   - Grid sort onChange: cursor reset (D-19) + scroll-to-top (D-19) + URL
 *     replaceState + localStorage write via persistGridSort.
 *   - Tree sort onChange: client-side re-sort via compareTreeNodes at all 4
 *     hierarchy levels (D-09 single tree-wide sort, NOT per-level); NO new
 *     fetches fire (D-discretion: client-side over server re-fetch).
 *   - Versions fetch useEffect migrates to paginated buffer semantics:
 *     replace on shot/sort change, append on Load more click.
 *
 * Data hydration:
 *   - On mount: hydrateSortState() (signals URL > localStorage > default) AND
 *     fetchWorkspaces() → workspaces signal (top of tree).
 *   - On workspace expand: fetchProjects(id, treeSort.value) → children cache.
 *   - On project expand: fetchSequences(id, treeSort.value) → children cache.
 *   - On sequence expand: fetchShots(id, treeSort.value) → children cache.
 *   - On shot OR sort change: fetchVersions(shotId, {sort, cursor:null}) →
 *     REPLACE versions.value (paginated buffer reset).
 *   - On Load more click: fetchVersions(shotId, {sort, cursor}) → APPEND.
 *
 * SECURITY — T-5-06 + T-18-03: all dynamic content (workspace/project/
 *   sequence/shot names, version labels, sort option labels) flows as JSX
 *   text children via the Plan 09 + 18-04 primitives. No
 *   dangerouslySetInnerHTML. SortDropdown labels come from hardcoded
 *   GRID_SORT_OPTIONS / TREE_SORT_OPTIONS constants — never user-controlled.
 */

import { useState, useEffect, useRef } from 'preact/hooks';
import { TreeSidebar } from '../components/TreeSidebar.js';
import type {
  TreeWorkspace,
  TreeProject,
  TreeSequence,
  TreeShot,
} from '../components/TreeSidebar.js';
import { VersionCard } from '../components/VersionCard.js';
import { EmptyState } from '../components/EmptyState.js';
import { SortDropdown } from '../components/SortDropdown.js';
import { LoadMoreButton } from '../components/LoadMoreButton.js';
import { VersionDrawer } from './VersionDrawer.js';
import {
  fetchWorkspaces,
  fetchProjects,
  fetchSequences,
  fetchShots,
  fetchVersions,
} from '../lib/api.js';
import {
  GRID_SORT_OPTIONS,
  TREE_SORT_OPTIONS,
  hydrateSortState,
  persistGridSort,
  persistTreeSort,
  compareTreeNodes,
} from '../lib/sortHelpers.js';
import {
  SORT_STRIP_LABEL,
  SORT_GRID_ARIA_LABEL,
  SORT_TREE_ARIA_LABEL,
  LOAD_MORE_ERROR_PREFIX_FAILED,
  LOAD_MORE_ERROR_PREFIX_NETWORK,
} from '../lib/copy.js';
import {
  workspaces,
  selectedShotId,
  treeSort,
} from '../state/hierarchy.js';
import {
  versions,
  selectedVersionId,
  gridSort,
  gridCursor,
  gridTotalCount,
  gridIsFetching,
  gridLoadMoreError,
} from '../state/versions.js';
import type {
  Workspace,
  Project,
  Sequence,
  Shot,
} from '../types/entities.js';
import type {
  SortField,
  HierarchySortField,
  VersionSort,
  HierarchySort,
} from '../lib/sortTypes.js';
import { versionLabel, normalizeStatus, unwrapList } from '../lib/shape.js';

/**
 * Local nested-tree cache, keyed by parent-id. Holds the already-fetched
 * children for workspaces (→ projects), projects (→ sequences), and sequences
 * (→ shots). The tree is derived at render time by splicing these entries
 * into the top-level workspaces signal AND applying compareTreeNodes per the
 * tree sort signal (D-09).
 */
interface ChildrenCache {
  projects: Record<string, Project[]>;
  sequences: Record<string, Sequence[]>;
  shots: Record<string, Shot[]>;
}

const emptyChildren: ChildrenCache = {
  projects: {},
  sequences: {},
  shots: {},
};

/**
 * compareTreeNodes expects `created_at: number` (engine integer ms epoch),
 * but dashboard entity types still declare `created_at?: string` (a v1.0
 * type-drift artifact — the runtime value IS a number, but the dashboard
 * hadn't needed to read it before Phase 18). Cast at the comparator call
 * site rather than mutate the entity types or read raw rows; v1.3 candidate
 * for follow-up alignment of types/entities.ts with the wire shape.
 */
function compareTreeNodesUnsafe<T extends { name: string; created_at?: unknown }>(
  a: T,
  b: T,
  sort: HierarchySort,
): number {
  return compareTreeNodes(
    a as unknown as { name: string; created_at: number },
    b as unknown as { name: string; created_at: number },
    sort,
  );
}

/**
 * Map a fetchVersions error to the user-readable LoadMoreButton error pill
 * copy. Network errors (TypeError thrown by fetch on offline / DNS fail)
 * surface as LOAD_MORE_ERROR_PREFIX_NETWORK; everything else (HTTP 4xx/5xx
 * from the server, JSON parse error, unknown) surfaces as
 * LOAD_MORE_ERROR_PREFIX_FAILED.
 */
function mapFetchErrorToCopy(err: unknown): string {
  // fetch() in browsers throws TypeError on network failure. The dashboard's
  // fetchJson wraps non-2xx responses in DashboardApiError; bare TypeError
  // surfaces only on offline / abort / DNS issues.
  if (err instanceof TypeError) return LOAD_MORE_ERROR_PREFIX_NETWORK;
  return LOAD_MORE_ERROR_PREFIX_FAILED;
}

export function HomeView() {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<ChildrenCache>(emptyChildren);
  const mainScrollRef = useRef<HTMLDivElement>(null);

  // Mount-time hydration: URL > localStorage > defaults reconciliation
  // (D-13/D-15/D-16). Runs ONCE; subsequent sort changes flow through
  // persistGridSort/persistTreeSort.
  useEffect(() => {
    const { gridSort: initGrid, treeSort: initTree } = hydrateSortState();
    gridSort.value = initGrid;
    treeSort.value = initTree;
  }, []);

  // Hydrate workspaces list on mount. Errors leave `workspaces.value` as [] —
  // TreeSidebar then renders the empty state implicitly (no treeitems).
  useEffect(() => {
    let alive = true;
    fetchWorkspaces()
      .then((raw) => {
        if (!alive) return;
        workspaces.value = unwrapList<Workspace>(raw);
      })
      .catch(() => {
        // no-op — caller sees the empty sidebar state
      });
    return () => {
      alive = false;
    };
  }, []);

  // Phase 18 / Plan 18-05 Task 2 — paginated buffer load helper. Caller's
  // INTENT is encoded in `replace`: page-1 useEffect always replaces; Load
  // more click handler always appends. Avoids guessing from gridCursor at
  // resolve time (which races with sort-change cursor reset).
  function loadVersionsPage(args: {
    shotId: string;
    sort: VersionSort;
    cursor: string | null;
    replace: boolean;
  }): Promise<void> {
    gridIsFetching.value = true;
    gridLoadMoreError.value = null;
    return fetchVersions(args.shotId, {
      sort: args.sort,
      cursor: args.cursor,
      limit: 20,
    })
      .then((response) => {
        if (args.replace) {
          versions.value = response.items;
        } else {
          versions.value = [...versions.value, ...response.items];
        }
        gridCursor.value = response.next_cursor;
        gridTotalCount.value = response.total_count;
        gridIsFetching.value = false;
      })
      .catch((err) => {
        gridLoadMoreError.value = mapFetchErrorToCopy(err);
        gridIsFetching.value = false;
        // On page-1 failure, leave versions.value at whatever it was (may be
        // [] from prior shot change). The error pill renders only when
        // versions.value is non-empty AND gridCursor.value is non-null —
        // for a complete-failure-on-page-1, the empty state still shows.
      });
  }

  // Page-1 useEffect: depends on shot AND sort (NOT cursor — cursor is reset
  // to null in handleGridSortChange upstream; Load more flows through the
  // click handler directly). Re-fires on shot change OR sort change.
  useEffect(() => {
    const shotId = selectedShotId.value;
    if (!shotId) {
      versions.value = [];
      gridCursor.value = null;
      gridTotalCount.value = 0;
      return;
    }
    gridCursor.value = null; // page-1 reset (defence in depth)
    void loadVersionsPage({
      shotId,
      sort: gridSort.value,
      cursor: null,
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShotId.value, gridSort.value]);

  // Grid sort onChange: cursor reset + scroll-to-top + URL/localStorage write.
  function handleGridSortChange(next: VersionSort): void {
    gridSort.value = next; // triggers page-1 useEffect
    gridCursor.value = null; // explicit reset (defence in depth)
    persistGridSort(next); // localStorage + URL replaceState
    // D-19 scroll-to-top: bring the grid back to the start of the new sort.
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
  }

  // Tree sort onChange: persist + let the tree composition useMemo re-sort
  // client-side. NO fetch — D-09 single tree-wide sort applies via
  // compareTreeNodes at all 4 hierarchy levels in the render path below.
  function handleTreeSortChange(next: HierarchySort): void {
    treeSort.value = next;
    persistTreeSort(next);
  }

  // LoadMoreButton click handler. Idempotent under gridIsFetching guard.
  function handleLoadMore(): void {
    if (gridIsFetching.value) return; // double-click guard
    if (gridCursor.value === null) return; // shouldn't render the button when null
    const shotId = selectedShotId.value;
    if (!shotId) return;
    void loadVersionsPage({
      shotId,
      sort: gridSort.value,
      cursor: gridCursor.value,
      replace: false,
    });
  }

  async function hydrateChildrenOf(id: string): Promise<void> {
    // Workspace → projects
    if (workspaces.value.some((ws) => ws.id === id)) {
      if (children.projects[id]) return;
      try {
        const raw = await fetchProjects(id, treeSort.value);
        setChildren((prev) => ({
          ...prev,
          projects: { ...prev.projects, [id]: unwrapList<Project>(raw) },
        }));
      } catch {
        setChildren((prev) => ({
          ...prev,
          projects: { ...prev.projects, [id]: [] },
        }));
      }
      return;
    }
    // Project → sequences
    const inProjects = Object.values(children.projects).some((list) =>
      list.some((p) => p.id === id),
    );
    if (inProjects) {
      if (children.sequences[id]) return;
      try {
        const raw = await fetchSequences(id, treeSort.value);
        setChildren((prev) => ({
          ...prev,
          sequences: { ...prev.sequences, [id]: unwrapList<Sequence>(raw) },
        }));
      } catch {
        setChildren((prev) => ({
          ...prev,
          sequences: { ...prev.sequences, [id]: [] },
        }));
      }
      return;
    }
    // Sequence → shots
    const inSequences = Object.values(children.sequences).some((list) =>
      list.some((s) => s.id === id),
    );
    if (inSequences) {
      if (children.shots[id]) return;
      try {
        const raw = await fetchShots(id, treeSort.value);
        setChildren((prev) => ({
          ...prev,
          shots: { ...prev.shots, [id]: unwrapList<Shot>(raw) },
        }));
      } catch {
        setChildren((prev) => ({
          ...prev,
          shots: { ...prev.shots, [id]: [] },
        }));
      }
    }
  }

  // Toggle expand + lazy-fetch children for the expanded node.
  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      next.add(id);
      // Fire-and-forget hydration. We look up the node's level by checking
      // which collection the id belongs to so the right fetcher runs.
      void hydrateChildrenOf(id);
      return next;
    });
  }

  // Phase 17 / Plan 17-05 — populate TreeShot.latestCompletedVersion for the
  // currently-selected shot from the in-memory versions signal. Other shots
  // (whose versions have not been loaded into the local cache) keep
  // latestCompletedVersion undefined → SkeletonThumbnail fallback (D-14/D-15).
  // This is the v1.2 conservative ship per Plan 17-05 Task 2 Step 3 — the
  // "selected-shot-only" populate approach is documented in the plan as the
  // safe minimum; cross-shot prefetch is deferred to v1.3.
  //
  // Phase 18 / Plan 18-05 Task 2 (D-21): the new ORDER BY for fetchVersions
  // pins in-progress (NULL completed_at) to the top of page 1, then orders
  // completed by completed_at DESC. The first 'complete' row in versions.value
  // is therefore the latest-completed row (typical case). Edge case:
  // shot with >20 in-progress versions → page 1 may be all in-progress, so
  // no completed row is found and the derivation returns undefined →
  // SkeletonThumbnail fallback in TreeSidebar. v1.3 prefetch fix per
  // CONTEXT.md D-21 deferred.
  const selectedShotVersions = versions.value;
  const latestCompletedForSelectedShot = (() => {
    if (!selectedShotId.value) return undefined;
    const completed = selectedShotVersions.find(
      (v) => normalizeStatus(v.status) === 'complete',
    );
    if (!completed) return undefined;
    return {
      id: completed.id,
      label: versionLabel(completed),
      status: 'complete' as const,
    };
  })();

  // Compose the nested tree shape TreeSidebar expects from the workspaces
  // signal + lazy-loaded children cache. Apply compareTreeNodes at every
  // hierarchy level per D-09 — the same treeSort.value drives the entire
  // tree's order, NOT a per-level sort.
  const currentTreeSort = treeSort.value;
  const tree: TreeWorkspace[] = workspaces.value
    .slice()
    .sort((a, b) => compareTreeNodesUnsafe(a, b, currentTreeSort))
    .map((ws) => ({
      id: ws.id,
      name: ws.name,
      projects: (children.projects[ws.id] ?? [])
        .slice()
        .sort((a, b) => compareTreeNodesUnsafe(a, b, currentTreeSort))
        .map(
          (p): TreeProject => ({
            id: p.id,
            name: p.name,
            sequences: (children.sequences[p.id] ?? [])
              .slice()
              .sort((a, b) => compareTreeNodesUnsafe(a, b, currentTreeSort))
              .map(
                (s): TreeSequence => ({
                  id: s.id,
                  name: s.name,
                  shots: (children.shots[s.id] ?? [])
                    .slice()
                    .sort((a, b) =>
                      compareTreeNodesUnsafe(a, b, currentTreeSort),
                    )
                    .map(
                      (sh): TreeShot => ({
                        id: sh.id,
                        name: sh.name,
                        // Populate latestCompletedVersion ONLY for the selected
                        // shot (D-15 happy path); all other shots fall back to
                        // SkeletonThumbnail.
                        latestCompletedVersion:
                          sh.id === selectedShotId.value
                            ? latestCompletedForSelectedShot
                            : undefined,
                      }),
                    ),
                }),
              ),
          }),
        ),
    }));

  const versionsList = versions.value;
  const selectedVersion =
    versionsList.find((v) => v.id === selectedVersionId.value) ?? null;
  const priorVersion =
    selectedVersion && typeof selectedVersion.version_number === 'number'
      ? versionsList
          .filter(
            (v) =>
              typeof v.version_number === 'number' &&
              v.version_number < (selectedVersion.version_number as number),
          )
          .sort(
            (a, b) =>
              (b.version_number as number) - (a.version_number as number),
          )[0] ?? null
      : null;

  const remaining = Math.max(0, gridTotalCount.value - versionsList.length);

  return (
    <div class="flex h-full">
      {/* LEFT pane — tree sort strip + TreeSidebar */}
      <div
        class="flex flex-col"
        style={{ width: 'var(--sidebar-width)' }}
      >
        <div class="flex items-center gap-2 px-2 py-2 border-b border-[var(--color-border)]">
          <span class="label-uppercase text-xs text-[var(--color-fg-muted)]">
            {SORT_STRIP_LABEL}
          </span>
          <SortDropdown<HierarchySortField>
            options={TREE_SORT_OPTIONS}
            value={treeSort.value}
            onChange={handleTreeSortChange}
            ariaLabel={SORT_TREE_ARIA_LABEL}
          />
        </div>
        <TreeSidebar
          workspaces={tree}
          selectedShotId={selectedShotId.value}
          onSelectShot={(id) => {
            selectedShotId.value = id;
            // Clear any open version when moving between shots.
            selectedVersionId.value = null;
          }}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
        />
      </div>
      {/* RIGHT pane — grid sort strip + version list + LoadMoreButton */}
      <main class="flex flex-1 flex-col overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
          <span class="label-uppercase text-xs text-[var(--color-fg-muted)]">
            {SORT_STRIP_LABEL}
          </span>
          <SortDropdown<SortField>
            options={GRID_SORT_OPTIONS}
            value={gridSort.value}
            onChange={handleGridSortChange}
            ariaLabel={SORT_GRID_ARIA_LABEL}
          />
        </div>
        <div
          ref={mainScrollRef}
          class="flex flex-1 flex-col gap-2 overflow-y-auto p-4"
        >
          {!selectedShotId.value ? (
            <EmptyState message="Select a shot to view versions" />
          ) : versionsList.length === 0 ? (
            <EmptyState message="No versions yet" />
          ) : (
            <>
              <ul class="flex flex-col gap-1">
                {versionsList.map((v) => (
                  <li key={v.id}>
                    <VersionCard
                      version={{
                        id: v.id,
                        label: versionLabel(v),
                        status: normalizeStatus(v.status),
                      }}
                      isSelected={v.id === selectedVersionId.value}
                      onSelect={(id) => {
                        selectedVersionId.value = id;
                      }}
                    />
                  </li>
                ))}
              </ul>
              {gridCursor.value !== null && remaining > 0 && (
                <LoadMoreButton
                  remaining={remaining}
                  onClick={handleLoadMore}
                  isFetching={gridIsFetching.value}
                  errorMessage={gridLoadMoreError.value}
                />
              )}
            </>
          )}
        </div>
      </main>
      {selectedVersion && (
        <VersionDrawer
          version={selectedVersion}
          priorVersion={priorVersion}
          onClose={() => {
            selectedVersionId.value = null;
          }}
        />
      )}
    </div>
  );
}
