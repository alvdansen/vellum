/**
 * Phase 22 / Plan 22-04 — OverlayHost mount-host + mutex helper tests.
 *
 * Covers:
 *  1. Renders null when activeOverlay=null AND selectedVersionId=null
 *  2. Renders backward-compat fallback when activeOverlay=null but
 *     selectedVersionId!==null (legacy direct-mutation callers)
 *  3. Renders ReviewPanel placeholder when activeOverlay='review' AND
 *     activeReviewShotId!==null
 *  4. Defensive guard: activeOverlay='review' but activeReviewShotId=null
 *     → null + console.warn
 *  5. Defensive guard: activeOverlay='version' but selectedVersionId=null
 *     → null + console.warn
 *  6. openVersionDrawer(id) helper flips all 3 signals correctly
 *  7. openReviewPanel(id) helper flips activeOverlay + activeReviewShotId;
 *     does NOT clear selectedVersionId
 *  8. closeOverlay() clears all 3 signals
 *  9. Mutex invariant: opening review while version drawer is open replaces
 *     the version drawer
 *
 * Module-singleton signal reset (Shared Pattern B): beforeEach resets all
 * 6 review-panel signals + selectedVersionId.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import {
  OverlayHost,
  openVersionDrawer,
  openReviewPanel,
  closeOverlay,
} from '../OverlayHost.js';
import {
  activeOverlay,
  activeReviewShotId,
  compareSelection,
  compareModalOpen,
  actionInFlight,
  quickApproveError,
} from '../../state/review-panel.js';
import { selectedVersionId, versions } from '../../state/versions.js';

// Mock the fetchVersion + fetchVersions + fetchShotStatusHistory paths.
// OverlayHost's ReviewPanelHostInternal kicks off a Promise.all on mount;
// stubs let us assert on either the loading shell or the loaded ReviewPanel.
vi.mock('../../lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api.js')>(
      '../../lib/api.js',
    );
  return {
    ...actual,
    fetchVersion: vi.fn().mockResolvedValue(null),
    fetchVersions: vi
      .fn()
      .mockResolvedValue({ items: [], next_cursor: null, total_count: 0 }),
    fetchShotStatusHistory: vi
      .fn()
      .mockResolvedValue({ shotId: 'mock', history: [], total: 0 }),
  };
});

// Stub ReviewPanel itself so we don't drag in the entire review-panel
// composition for these mount-host tests.
vi.mock('../ReviewPanel.js', () => ({
  ReviewPanel: ({ shotId }: { shotId: string }) => (
    <div data-testid="review-panel-stub" data-shot-id={shotId} />
  ),
}));

// VersionDrawer itself dispatches a lot of side effects on mount (provenance,
// c2pa, summary) — stub the entire subtree to a noop div so we can assert on
// OverlayHost's branching without dragging in those modules.
vi.mock('../VersionDrawer.js', () => ({
  VersionDrawer: ({ version }: { version: { id: string } }) => (
    <div data-testid="version-drawer-stub" data-version-id={version.id} />
  ),
}));

beforeEach(() => {
  activeOverlay.value = null;
  activeReviewShotId.value = null;
  compareSelection.value = { a: null, b: null };
  compareModalOpen.value = false;
  actionInFlight.value = null;
  quickApproveError.value = null;
  selectedVersionId.value = null;
  versions.value = [];
});

afterEach(() => {
  cleanup();
});

describe('OverlayHost — empty state', () => {
  it('renders null when activeOverlay=null AND selectedVersionId=null', () => {
    const { container } = render(<OverlayHost />);
    expect(container.innerHTML).toBe('');
  });
});

describe('OverlayHost — backward-compat fallback', () => {
  it('renders version drawer when activeOverlay=null but selectedVersionId!==null', () => {
    versions.value = [
      {
        id: 'v-1',
        shot_id: 'sh-1',
        version_number: 1,
      } as never,
    ];
    selectedVersionId.value = 'v-1';
    const { getByTestId } = render(<OverlayHost />);
    const stub = getByTestId('version-drawer-stub');
    expect(stub.getAttribute('data-version-id')).toBe('v-1');
  });
});

describe('OverlayHost — review panel branch', () => {
  it('renders ReviewPanel loading shell when activeOverlay=review AND activeReviewShotId!==null', () => {
    activeOverlay.value = 'review';
    activeReviewShotId.value = 'shot-xyz';
    const { getByTestId } = render(<OverlayHost />);
    // Before the Promise.all resolves, the loading shell renders.
    const shell = getByTestId('review-panel-loading');
    expect(shell.getAttribute('role')).toBe('dialog');
  });

  it('defensive: activeOverlay=review but activeReviewShotId=null → null + console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    activeOverlay.value = 'review';
    activeReviewShotId.value = null;
    const { container } = render(<OverlayHost />);
    expect(container.innerHTML).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('activeReviewShotId is null'),
    );
    warnSpy.mockRestore();
  });
});

describe('OverlayHost — version drawer branch (explicit)', () => {
  it('renders version drawer when activeOverlay=version AND selectedVersionId!==null', () => {
    versions.value = [{ id: 'v-2', shot_id: 'sh-1', version_number: 1 } as never];
    activeOverlay.value = 'version';
    selectedVersionId.value = 'v-2';
    const { getByTestId } = render(<OverlayHost />);
    const stub = getByTestId('version-drawer-stub');
    expect(stub.getAttribute('data-version-id')).toBe('v-2');
  });

  it('defensive: activeOverlay=version but selectedVersionId=null → null + console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    activeOverlay.value = 'version';
    selectedVersionId.value = null;
    const { container } = render(<OverlayHost />);
    expect(container.innerHTML).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('selectedVersionId is null'),
    );
    warnSpy.mockRestore();
  });
});

describe('OverlayHost — mutex helpers', () => {
  it('openVersionDrawer(id) sets selectedVersionId + activeOverlay + clears activeReviewShotId', () => {
    activeReviewShotId.value = 'prior-shot';
    openVersionDrawer('v-99');
    expect(selectedVersionId.value).toBe('v-99');
    expect(activeOverlay.value).toBe('version');
    expect(activeReviewShotId.value).toBeNull();
  });

  it('openReviewPanel(id) sets activeReviewShotId + activeOverlay; preserves selectedVersionId', () => {
    selectedVersionId.value = 'v-prior';
    openReviewPanel('sh-77');
    expect(activeReviewShotId.value).toBe('sh-77');
    expect(activeOverlay.value).toBe('review');
    // selectedVersionId is preserved (no clear) so future openVersionDrawer is fast
    expect(selectedVersionId.value).toBe('v-prior');
  });

  it('closeOverlay() clears activeOverlay + selectedVersionId + activeReviewShotId', () => {
    selectedVersionId.value = 'v-1';
    activeReviewShotId.value = 'sh-1';
    activeOverlay.value = 'review';
    closeOverlay();
    expect(activeOverlay.value).toBeNull();
    expect(selectedVersionId.value).toBeNull();
    expect(activeReviewShotId.value).toBeNull();
  });
});

describe('OverlayHost — mutex invariant (D-02)', () => {
  it('opening review while version drawer is open replaces the version drawer', () => {
    versions.value = [{ id: 'v-1', shot_id: 'sh-1', version_number: 1 } as never];
    openVersionDrawer('v-1');
    const { rerender, queryByTestId } = render(<OverlayHost />);
    // First render: version drawer mounted
    expect(queryByTestId('version-drawer-stub')).not.toBeNull();
    expect(queryByTestId('review-panel-loading')).toBeNull();
    expect(queryByTestId('review-panel-stub')).toBeNull();

    // Open the review panel (mutex) — version drawer must unmount; review
    // panel mounts (initially showing the loading shell pre-resolve).
    openReviewPanel('sh-77');
    rerender(<OverlayHost />);
    expect(queryByTestId('version-drawer-stub')).toBeNull();
    expect(queryByTestId('review-panel-loading')).not.toBeNull();
  });
});
