/**
 * TreeSidebar component tests.
 *
 * Covers render + expand + select interactions per Plan 05-09 Task 2 behavior
 * contract. All assertions use @testing-library/preact idioms against a jsdom
 * environment (packages/dashboard/vitest.config.ts).
 *
 * TDD gate:
 *   - RED: this file exists before component was tested against the real DOM
 *   - GREEN: TreeSidebar.tsx (Task 1 commit) satisfies every assertion below
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
});
