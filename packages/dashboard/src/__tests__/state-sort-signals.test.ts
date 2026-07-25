/**
 * Phase 18 / Plan 18-05 Task 1 — state signal store extensions.
 *
 * Verifies the new Phase 18 signals exported from state/versions.ts and
 * state/hierarchy.ts. The signals back the SortDropdown and LoadMoreButton
 * primitives in HomeView (Plan 18-05 Task 2).
 *
 * Architecture-purity (D-WEBUI-31): zero server-tree relative imports;
 * imports only from the dashboard tree.
 */

import { describe, it, expect } from 'vitest';
import {
  versions,
  selectedVersionId,
  gridSort,
  gridCursor,
  gridTotalCount,
  gridIsFetching,
  gridLoadMoreError,
} from '../state/versions.js';
import {
  workspaces,
  selectedWorkspaceId,
  selectedProjectId,
  selectedSequenceId,
  selectedShotId,
  treeSort,
} from '../state/hierarchy.js';
import {
  DEFAULT_VERSION_SORT,
  DEFAULT_HIERARCHY_SORT,
} from '../lib/sortTypes.js';

describe('state/versions.ts — Phase 18 / Plan 18-05 grid sort + cursor signals', () => {
  it('Test 1a: gridSort default equals DEFAULT_VERSION_SORT (Latest)', () => {
    expect(gridSort.value).toEqual(DEFAULT_VERSION_SORT);
    expect(gridSort.value.field).toBe('completed_at');
    expect(gridSort.value.dir).toBe('desc');
  });

  it('Test 1b: gridCursor default is null (page 1)', () => {
    expect(gridCursor.value).toBeNull();
  });

  it('Test 1c: gridTotalCount default is 0', () => {
    expect(gridTotalCount.value).toBe(0);
  });

  it('Test 1d: gridIsFetching default is false', () => {
    expect(gridIsFetching.value).toBe(false);
  });

  it('Test 1e: gridLoadMoreError default is null', () => {
    expect(gridLoadMoreError.value).toBeNull();
  });

  it('Test 1f: pre-existing versions and selectedVersionId signals still importable', () => {
    expect(versions).toBeDefined();
    expect(selectedVersionId).toBeDefined();
  });
});

describe('state/hierarchy.ts — Phase 18 / Plan 18-05 tree sort signal', () => {
  it('Test 2: treeSort default equals DEFAULT_HIERARCHY_SORT (A→Z)', () => {
    expect(treeSort.value).toEqual(DEFAULT_HIERARCHY_SORT);
    expect(treeSort.value.field).toBe('name');
    expect(treeSort.value.dir).toBe('asc');
  });

  it('Test 2b: pre-existing workspaces and selection signals still importable', () => {
    expect(workspaces).toBeDefined();
    expect(selectedWorkspaceId).toBeDefined();
    expect(selectedProjectId).toBeDefined();
    expect(selectedSequenceId).toBeDefined();
    expect(selectedShotId).toBeDefined();
  });
});
