/**
 * TreeSidebar — left-rail collapsible hierarchy browser
 *   (workspace → project → sequence → shot)
 *
 * Pure component: props-in, callbacks-out. No fetch, no signal reads, no side
 * effects. Parent (Plan 10 views) passes the workspaces array + selection +
 * expand state + handlers.
 *
 * Expand state is lifted to the parent via `expandedIds: Set<string>` +
 * `onToggleExpand`. This keeps the tree stateless — multiple sidebars could
 * share state, and state could live in a signal without this component knowing.
 *
 * Shot selection is tracked separately via `selectedShotId` + `onSelectShot`.
 * Workspaces/projects/sequences are navigable (click = toggle expand) but the
 * terminal selectable unit is a shot.
 *
 * Type contract:
 *   - Minimal structural types declared inline below. The real hierarchy types
 *     live in the data layer (Plan 08) — our types are structurally compatible
 *     via TypeScript duck-typing.
 *
 * Phase 17 / Plan 17-05 — depth=3 shot rows gain a leading thumbnail slot
 * (D-13). When TreeShot.latestCompletedVersion is provided → real thumb;
 * when absent → SkeletonThumbnail width=80 height=45 fallback (D-14/D-15).
 * Sequence + Project + Workspace rows stay text-only (D-16 LOCKED — exactly
 * one thumbnail-rendering caller in this file, in the shot.map() context).
 *
 * Accessibility:
 *   - Root <nav aria-label="Project hierarchy">
 *   - Each expandable row: role="treeitem", aria-expanded reflects state
 *   - Shots (terminal leaves): no aria-expanded
 *   - Selected shot: aria-selected="true"
 *
 * SECURITY — T-5-06: Workspace/project/sequence/shot names are rendered as
 * JSX text children (auto-escaped by Preact). dangerouslySetInnerHTML is
 * not used.
 */

import type { VNode } from 'preact';
import { ChevronRight, ChevronDown } from 'lucide-preact';
import { Thumbnail } from './Thumbnail.js';
import { SkeletonThumbnail } from './SkeletonThumbnail.js';

/* ---------- Minimal structural types (owned by this component) ---------- */

export interface TreeShot {
  id: string;
  name: string;
  /**
   * Phase 17 / Plan 17-05 — latest completed version under this shot. Drives
   * the leading thumb slot at size='sm' per D-13. Undefined → SkeletonThumbnail
   * fallback (D-14/D-15). HomeView populates this from the local versions
   * cache; shots without loaded versions render the skeleton (graceful
   * degradation per UI-SPEC §"Empty states").
   */
  latestCompletedVersion?: { id: string; label: string; status: 'complete' };
}

export interface TreeSequence {
  id: string;
  name: string;
  shots?: TreeShot[];
}

export interface TreeProject {
  id: string;
  name: string;
  sequences?: TreeSequence[];
}

export interface TreeWorkspace {
  id: string;
  name: string;
  projects?: TreeProject[];
}

/* ---------- Props ---------- */

export interface TreeSidebarProps {
  workspaces: TreeWorkspace[];
  selectedShotId: string | null;
  onSelectShot: (shotId: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}

/* ---------- Top-level component ---------- */

export function TreeSidebar({
  workspaces,
  selectedShotId,
  onSelectShot,
  expandedIds,
  onToggleExpand,
}: TreeSidebarProps) {
  return (
    <nav
      class="flex flex-col gap-0.5 overflow-y-auto"
      aria-label="Project hierarchy"
      style={{ width: 'var(--sidebar-width)' }}
    >
      {workspaces.map((ws) => (
        <WorkspaceNode
          key={ws.id}
          workspace={ws}
          selectedShotId={selectedShotId}
          onSelectShot={onSelectShot}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </nav>
  );
}

/* ---------- Nested node components ---------- */

interface WorkspaceNodeProps {
  workspace: TreeWorkspace;
  selectedShotId: string | null;
  onSelectShot: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}

function WorkspaceNode({
  workspace,
  selectedShotId,
  onSelectShot,
  expandedIds,
  onToggleExpand,
}: WorkspaceNodeProps) {
  const expanded = expandedIds.has(workspace.id);
  const hasChildren = !!workspace.projects?.length;
  return (
    <>
      <TreeRow
        label={workspace.name}
        depth={0}
        expanded={expanded}
        hasChildren={hasChildren}
        isSelected={false}
        onClick={() => onToggleExpand(workspace.id)}
        onToggle={() => onToggleExpand(workspace.id)}
      />
      {expanded &&
        workspace.projects?.map((proj) => (
          <ProjectNode
            key={proj.id}
            project={proj}
            selectedShotId={selectedShotId}
            onSelectShot={onSelectShot}
            expandedIds={expandedIds}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </>
  );
}

interface ProjectNodeProps {
  project: TreeProject;
  selectedShotId: string | null;
  onSelectShot: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}

function ProjectNode({
  project,
  selectedShotId,
  onSelectShot,
  expandedIds,
  onToggleExpand,
}: ProjectNodeProps) {
  const expanded = expandedIds.has(project.id);
  const hasChildren = !!project.sequences?.length;
  return (
    <>
      <TreeRow
        label={project.name}
        depth={1}
        expanded={expanded}
        hasChildren={hasChildren}
        isSelected={false}
        onClick={() => onToggleExpand(project.id)}
        onToggle={() => onToggleExpand(project.id)}
      />
      {expanded &&
        project.sequences?.map((seq) => (
          <SequenceNode
            key={seq.id}
            sequence={seq}
            selectedShotId={selectedShotId}
            onSelectShot={onSelectShot}
            expandedIds={expandedIds}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </>
  );
}

interface SequenceNodeProps {
  sequence: TreeSequence;
  selectedShotId: string | null;
  onSelectShot: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}

function SequenceNode({
  sequence,
  selectedShotId,
  onSelectShot,
  expandedIds,
  onToggleExpand,
}: SequenceNodeProps) {
  const expanded = expandedIds.has(sequence.id);
  const hasChildren = !!sequence.shots?.length;
  return (
    <>
      <TreeRow
        label={sequence.name}
        depth={2}
        expanded={expanded}
        hasChildren={hasChildren}
        isSelected={false}
        onClick={() => onToggleExpand(sequence.id)}
        onToggle={() => onToggleExpand(sequence.id)}
      />
      {expanded &&
        sequence.shots?.map((shot) => (
          <TreeRow
            key={shot.id}
            label={shot.name}
            depth={3}
            expanded={false}
            hasChildren={false}
            isSelected={shot.id === selectedShotId}
            onClick={() => onSelectShot(shot.id)}
            onToggle={() => {
              /* shots are leaves — no toggle */
            }}
            thumbnail={
              shot.latestCompletedVersion ? (
                <Thumbnail
                  version={shot.latestCompletedVersion}
                  size="sm"
                />
              ) : (
                <SkeletonThumbnail width={80} height={45} />
              )
            }
          />
        ))}
    </>
  );
}

/* ---------- Shared row primitive ---------- */

interface TreeRowProps {
  label: string;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  isSelected: boolean;
  onClick: () => void;
  onToggle: () => void;
  /**
   * Phase 17 / Plan 17-05 — optional leading thumbnail slot. Sequence /
   * Project / Workspace TreeRow callers omit this prop (D-16 LOCKED — only
   * the depth=3 shot-row caller passes it). When undefined, the slot is
   * not rendered and the row stays text-only.
   */
  thumbnail?: VNode;
}

function TreeRow({
  label,
  depth,
  expanded,
  hasChildren,
  isSelected,
  onClick,
  onToggle,
  thumbnail,
}: TreeRowProps) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      class={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm transition-colors ${
        isSelected
          ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
          : 'text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={onClick}
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={isSelected ? true : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {hasChildren ? (
        <span
          class="flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-hidden="true"
        >
          <Icon size={14} />
        </span>
      ) : (
        <span class="w-3.5 flex-shrink-0" aria-hidden="true" />
      )}
      {thumbnail ? <span class="flex-shrink-0">{thumbnail}</span> : null}
      <span class="truncate">{label}</span>
    </div>
  );
}
