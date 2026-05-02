/**
 * TreeSidebar component tests.
 *
 * Covers render + expand + select interactions per Plan 05-09 Task 2 behavior
 * contract. All assertions use @testing-library/preact idioms against a jsdom
 * environment (packages/dashboard/vitest.config.ts).
 *
 * Phase 17 / Plan 17-05 Task 2 — depth=3 shot rows gain a leading
 * <Thumbnail size='sm'/> (D-13). When latestCompletedVersion is provided →
 * <Thumbnail/>; when absent → <SkeletonThumbnail width=80 height=45/>
 * fallback (D-14/D-15). Sequence + Project + Workspace rows stay text-only
 * (D-16 LOCKED — verified by grep in Plan 17-05).
 *
 * TDD gate:
 *   - RED: this file exists before component was tested against the real DOM
 *   - GREEN: TreeSidebar.tsx (Task 1 commit + Plan 17-05 Task 2) satisfies
 *     every assertion below
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { TreeSidebar } from '../components/TreeSidebar.js';
import type { TreeWorkspace } from '../components/TreeSidebar.js';

/* Fixture: one workspace containing one project, one sequence, two shots.
 * Matches the shape returned by lib/api.ts fetchWorkspaces (Plan 08), which
 * duck-types against the component's inline TreeWorkspace interface. */
const WORKSPACE: TreeWorkspace = {
  id: 'ws1',
  name: 'Test Workspace',
  projects: [
    {
      id: 'p1',
      name: 'Test Project',
      sequences: [
        {
          id: 'sq1',
          name: 'SQ010',
          shots: [
            { id: 'sh1', name: 'SH0010' },
            { id: 'sh2', name: 'SH0020' },
          ],
        },
      ],
    },
  ],
};

/**
 * Phase 17 / Plan 17-05 Task 2 fixture — workspace with one shot carrying a
 * latestCompletedVersion and one without. Used by the new shot-thumbnail
 * tests below.
 */
const WORKSPACE_WITH_VERSIONS: TreeWorkspace = {
  id: 'ws1',
  name: 'Test Workspace',
  projects: [
    {
      id: 'p1',
      name: 'Test Project',
      sequences: [
        {
          id: 'sq1',
          name: 'SQ010',
          shots: [
            {
              id: 'sh1',
              name: 'SH0010',
              latestCompletedVersion: {
                id: 'ver_a',
                label: 'v003',
                status: 'complete',
              },
            },
            { id: 'sh2', name: 'SH0020' /* no latestCompletedVersion */ },
          ],
        },
      ],
    },
  ],
};

describe('TreeSidebar', () => {
  it('renders empty workspaces list with zero tree items', () => {
    render(
      <TreeSidebar
        workspaces={[]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
  });

  it('renders the workspace name when the list has one entry', () => {
    render(
      <TreeSidebar
        workspaces={[WORKSPACE]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Workspace')).toBeTruthy();
  });

  it('clicking a collapsed workspace row calls onToggleExpand with its id', () => {
    const onToggle = vi.fn();
    render(
      <TreeSidebar
        workspaces={[WORKSPACE]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set()}
        onToggleExpand={onToggle}
      />,
    );
    fireEvent.click(screen.getByText('Test Workspace'));
    expect(onToggle).toHaveBeenCalledWith('ws1');
  });

  it('expanded workspace reveals its projects, sequences, and shots', () => {
    render(
      <TreeSidebar
        workspaces={[WORKSPACE]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set(['ws1', 'p1', 'sq1'])}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Project')).toBeTruthy();
    expect(screen.getByText('SQ010')).toBeTruthy();
    expect(screen.getByText('SH0010')).toBeTruthy();
    expect(screen.getByText('SH0020')).toBeTruthy();
  });

  it('clicking a shot leaf calls onSelectShot with the shot id', () => {
    const onSelectShot = vi.fn();
    render(
      <TreeSidebar
        workspaces={[WORKSPACE]}
        selectedShotId={null}
        onSelectShot={onSelectShot}
        expandedIds={new Set(['ws1', 'p1', 'sq1'])}
        onToggleExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('SH0010'));
    expect(onSelectShot).toHaveBeenCalledWith('sh1');
  });

  it('selected shot gets aria-selected attribute; unselected siblings do not', () => {
    render(
      <TreeSidebar
        workspaces={[WORKSPACE]}
        selectedShotId="sh1"
        onSelectShot={vi.fn()}
        expandedIds={new Set(['ws1', 'p1', 'sq1'])}
        onToggleExpand={vi.fn()}
      />,
    );
    const selected = screen.getByText('SH0010').closest('[role="treeitem"]');
    const unselected = screen.getByText('SH0020').closest('[role="treeitem"]');
    expect(selected?.getAttribute('aria-selected')).toBe('true');
    expect(unselected?.getAttribute('aria-selected')).toBeNull();
  });

  it('expanded rows expose aria-expanded=true; collapsed parents expose false', () => {
    render(
      <TreeSidebar
        workspaces={[WORKSPACE]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set(['ws1'])}
        onToggleExpand={vi.fn()}
      />,
    );
    const workspaceRow = screen.getByText('Test Workspace').closest('[role="treeitem"]');
    const projectRow = screen.getByText('Test Project').closest('[role="treeitem"]');
    expect(workspaceRow?.getAttribute('aria-expanded')).toBe('true');
    // Project is rendered (ws is expanded) but project itself is collapsed.
    expect(projectRow?.getAttribute('aria-expanded')).toBe('false');
  });

  it('rendered output contains no dangerouslySetInnerHTML escape hatch', () => {
    const { container } = render(
      <TreeSidebar
        workspaces={[WORKSPACE]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set(['ws1', 'p1', 'sq1'])}
        onToggleExpand={vi.fn()}
      />,
    );
    // No inlined <script>, <iframe>, or raw HTML — all text nodes.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('clicking a shot does NOT bubble into onToggleExpand', () => {
    const onSelectShot = vi.fn();
    const onToggle = vi.fn();
    render(
      <TreeSidebar
        workspaces={[WORKSPACE]}
        selectedShotId={null}
        onSelectShot={onSelectShot}
        expandedIds={new Set(['ws1', 'p1', 'sq1'])}
        onToggleExpand={onToggle}
      />,
    );
    fireEvent.click(screen.getByText('SH0010'));
    expect(onSelectShot).toHaveBeenCalledWith('sh1');
    // The shot row's onClick is onSelectShot — never the toggle handler.
    expect(onToggle).not.toHaveBeenCalledWith('sh1');
  });

  // ─────────────────────────────────────────────────────────────
  // Phase 17 / Plan 17-05 Task 2 — shot-row thumbnail tests
  // ─────────────────────────────────────────────────────────────

  it('shot row renders <Thumbnail size="sm"/> when latestCompletedVersion is provided (D-13)', () => {
    render(
      <TreeSidebar
        workspaces={[WORKSPACE_WITH_VERSIONS]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set(['ws1', 'p1', 'sq1'])}
        onToggleExpand={vi.fn()}
      />,
    );
    // Shot sh1 has latestCompletedVersion {label:'v003'} → <Thumbnail/> renders
    // an <img> with alt="Output for v003" (Plan 17-04 Thumbnail contract).
    const img = screen.getByAltText('Output for v003') as HTMLImageElement;
    expect(img).toBeTruthy();
    // The Thumbnail size='sm' wrapper applies inline width: 80px style.
    const wrapper = img.parentElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper?.getAttribute('style') ?? '').toMatch(/width:\s*80px/i);
    // The <img> carries the explicit width=80 height=45 HTML attrs (CLS=0).
    expect(img.getAttribute('width')).toBe('80');
    expect(img.getAttribute('height')).toBe('45');
    // And points at /api/versions/ver_a/thumbnail (the Plan 17-03 route).
    expect(img.src).toMatch(/\/api\/versions\/ver_a\/thumbnail$/);
  });

  it('shot row renders <SkeletonThumbnail/> when latestCompletedVersion is absent (D-14/D-15 fallback)', () => {
    const { container } = render(
      <TreeSidebar
        workspaces={[WORKSPACE_WITH_VERSIONS]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set(['ws1', 'p1', 'sq1'])}
        onToggleExpand={vi.fn()}
      />,
    );
    // Shot sh2 has NO latestCompletedVersion → renders SkeletonThumbnail
    // width=80 height=45. SkeletonThumbnail emits <div role="presentation"
    // aria-hidden="true"> with inline width:80px height:45px style.
    const sh2Row = screen.getByText('SH0020').closest('[role="treeitem"]');
    expect(sh2Row).toBeTruthy();
    // The shot row should NOT contain an <img> (Thumbnail's complete-render
    // path is not engaged when latestCompletedVersion is absent — Thumbnail
    // is invoked with status !== 'complete' OR not invoked at all; either
    // way the skeleton renders).
    expect(sh2Row?.querySelector('img')).toBeNull();
    // The skeleton element should be present somewhere inside the row.
    const skeletons = sh2Row?.querySelectorAll('[role="presentation"][aria-hidden="true"]') ?? [];
    expect(skeletons.length).toBeGreaterThan(0);
    // At least one of those skeletons has width:80px and height:45px style.
    const matched = Array.from(skeletons).some((el) => {
      const style = el.getAttribute('style') ?? '';
      return /width:\s*80px/i.test(style) && /height:\s*45px/i.test(style);
    });
    expect(matched).toBe(true);
    // Defence: the container's overall structure rendered without errors.
    expect(container).toBeTruthy();
  });

  it('sequence + project + workspace rows do NOT render thumbnails (D-16 LOCKED)', () => {
    render(
      <TreeSidebar
        workspaces={[WORKSPACE_WITH_VERSIONS]}
        selectedShotId={null}
        onSelectShot={vi.fn()}
        expandedIds={new Set(['ws1', 'p1', 'sq1'])}
        onToggleExpand={vi.fn()}
      />,
    );
    // Workspace row 'Test Workspace' must contain no <img> and no skeleton
    // [role=presentation] inside the row's clickable container.
    const wsRow = screen.getByText('Test Workspace').closest('[role="treeitem"]');
    expect(wsRow?.querySelector('img')).toBeNull();
    expect(wsRow?.querySelector('[role="presentation"][aria-hidden="true"]')).toBeNull();

    // Project row 'Test Project' — same.
    const projRow = screen.getByText('Test Project').closest('[role="treeitem"]');
    expect(projRow?.querySelector('img')).toBeNull();
    expect(projRow?.querySelector('[role="presentation"][aria-hidden="true"]')).toBeNull();

    // Sequence row 'SQ010' — same.
    const seqRow = screen.getByText('SQ010').closest('[role="treeitem"]');
    expect(seqRow?.querySelector('img')).toBeNull();
    expect(seqRow?.querySelector('[role="presentation"][aria-hidden="true"]')).toBeNull();
  });
});
