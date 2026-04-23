/**
 * HomeView — primary two-pane layout: TreeSidebar (left) + shot-detail panel.
 *
 * Per must-have contract (Plan 05-10 frontmatter):
 *   "HomeView renders TreeSidebar and a shot detail panel side by side"
 *
 * Composition:
 *   - LEFT: TreeSidebar (Plan 09 primitive) reading from `workspaces` signal
 *     plus a local nested `tree` state that lazy-hydrates on expand.
 *   - RIGHT: shot-detail panel — a VersionCard list driven by the `versions`
 *     signal under the currently-selected shot.
 *   - OVERLAY: VersionDrawer when `selectedVersionId` is non-null.
 *
 * Data hydration:
 *   - On mount: fetchWorkspaces() → workspaces signal (top of tree).
 *   - On workspace expand: fetchProjects(id) → local nestedChildren[wsId] entry.
 *   - On project expand: fetchSequences(id) → nestedChildren[projId].
 *   - On sequence expand: fetchShots(id) → nestedChildren[seqId].
 *   - On shot select: fetchVersions(shotId) → versions signal.
 *
 * This keeps TreeSidebar pure (pass-through props) while the view owns the
 * lazy-hydration state. Defensive list unwrapping via unwrapList handles the
 * ListResult wrapper vs bare array shape drift documented in 05-08-SUMMARY.md.
 *
 * SECURITY — T-5-06: all dynamic content (workspace/project/sequence/shot
 * names, version labels) flows as JSX text children via the Plan 09
 * primitives. No dangerouslySetInnerHTML.
 */

import { useState, useEffect } from 'preact/hooks';
import { TreeSidebar } from '../components/TreeSidebar.js';
import type {
  TreeWorkspace,
  TreeProject,
  TreeSequence,
  TreeShot,
} from '../components/TreeSidebar.js';
import { VersionCard } from '../components/VersionCard.js';
import { EmptyState } from '../components/EmptyState.js';
import { VersionDrawer } from './VersionDrawer.js';
import {
  fetchWorkspaces,
  fetchProjects,
  fetchSequences,
  fetchShots,
  fetchVersions,
} from '../lib/api.js';
import { workspaces, selectedShotId } from '../state/hierarchy.js';
import { versions, selectedVersionId } from '../state/versions.js';
import type {
  Workspace,
  Project,
  Sequence,
  Shot,
  Version,
} from '../types/entities.js';
import { versionLabel, normalizeStatus, unwrapList } from '../lib/shape.js';

/**
 * Local nested-tree cache, keyed by parent-id. Holds the already-fetched
 * children for workspaces (→ projects), projects (→ sequences), and sequences
 * (→ shots). The tree is derived at render time by splicing these entries
 * into the top-level workspaces signal.
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

export function HomeView() {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<ChildrenCache>(emptyChildren);

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

  // When selectedShotId changes, hydrate the version list under that shot.
  useEffect(() => {
    let alive = true;
    const shotId = selectedShotId.value;
    if (!shotId) {
      versions.value = [];
      return;
    }
    fetchVersions(shotId)
      .then((raw) => {
        if (!alive) return;
        versions.value = unwrapList<Version>(raw);
      })
      .catch(() => {
        if (alive) versions.value = [];
      });
    return () => {
      alive = false;
    };
  }, [selectedShotId.value]);

  async function hydrateChildrenOf(id: string): Promise<void> {
    // Workspace → projects
    if (workspaces.value.some((ws) => ws.id === id)) {
      if (children.projects[id]) return;
      try {
        const raw = await fetchProjects(id);
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
        const raw = await fetchSequences(id);
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
        const raw = await fetchShots(id);
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

  // Compose the nested tree shape TreeSidebar expects from the workspaces
  // signal + lazy-loaded children cache.
  const tree: TreeWorkspace[] = workspaces.value.map((ws) => ({
    id: ws.id,
    name: ws.name,
    projects: (children.projects[ws.id] ?? []).map(
      (p): TreeProject => ({
        id: p.id,
        name: p.name,
        sequences: (children.sequences[p.id] ?? []).map(
          (s): TreeSequence => ({
            id: s.id,
            name: s.name,
            shots: (children.shots[s.id] ?? []).map(
              (sh): TreeShot => ({ id: sh.id, name: sh.name }),
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

  return (
    <div class="flex h-full">
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
      <main class="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {!selectedShotId.value ? (
          <EmptyState message="Select a shot to view versions" />
        ) : versionsList.length === 0 ? (
          <EmptyState message="No versions yet" />
        ) : (
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
        )}
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
