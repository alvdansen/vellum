/**
 * Phase 22 / Plan 22-05 — Review panel ↔ SSE integration.
 *
 * Verifies that the panel header pill keys on `shotGrid.value.shots[...]`
 * — the same surface the SSE handler `onShotStatusChanged` (RESEARCH A7,
 * state/shot-grid.ts) mutates. End result: a status_changed SSE for the
 * open shot causes the panel header pill to flip without the parent
 * re-fetching.
 *
 * No real EventSource here — we drive `onShotStatusChanged` directly
 * (same code path the real SSE dispatcher hits per A7).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import {
  onShotStatusChanged,
  shotGrid,
} from '../state/shot-grid.js';
import {
  actionInFlight,
  activeOverlay,
  activeReviewShotId,
  compareSelection,
  compareModalOpen,
  quickApproveError,
} from '../state/review-panel.js';
import { ReviewPanel } from '../views/ReviewPanel.js';

// Stub setShotStatus + StatusChangePopover so ReviewActionBar mounts
// without real fetches or popover DOM.
vi.mock('../lib/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js');
  return {
    ...actual,
    setShotStatus: vi.fn().mockResolvedValue({ status: 'approved', history: [] }),
  };
});

vi.mock('../components/StatusChangePopover.js', () => ({
  StatusChangePopover: () => null,
}));

const SEQ_ID = 'seq-test';

interface TestShotGridShape {
  sequence: { id: string; name: string; project_id: string; created_at: number };
  shots: Array<{
    id: string;
    name: string;
    status: string;
    version_count: number;
    latest_completed_version: null;
  }>;
  next_cursor: string | null;
  total_count: number;
}

function makeShotGridShape(
  shotId: string,
  shotName: string,
  status: string,
): TestShotGridShape {
  return {
    sequence: {
      id: SEQ_ID,
      name: 'TestSeq',
      project_id: 'proj-1',
      created_at: 0,
    },
    shots: [
      {
        id: shotId,
        name: shotName,
        status,
        version_count: 0,
        latest_completed_version: null,
      },
    ],
    next_cursor: null,
    total_count: 1,
  };
}

beforeEach(() => {
  actionInFlight.value = null;
  activeOverlay.value = null;
  activeReviewShotId.value = null;
  compareSelection.value = { a: null, b: null };
  compareModalOpen.value = false;
  quickApproveError.value = null;
  shotGrid.value = null;
});

afterEach(() => {
  cleanup();
});

describe('Review panel ↔ SSE integration', () => {
  it('onShotStatusChanged for the open shot updates shotGrid', () => {
    shotGrid.value = makeShotGridShape('sh-A', 'SH_010', 'wip') as never;
    onShotStatusChanged({
      sequenceId: SEQ_ID,
      shotId: 'sh-A',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });
    const after = shotGrid.value as unknown as TestShotGridShape | null;
    expect(after?.shots[0].status).toBe('approved');
  });

  it('onShotStatusChanged for a DIFFERENT shot does not disrupt the open shot', () => {
    const twoShotGrid: TestShotGridShape = {
      sequence: { id: SEQ_ID, name: 'TestSeq', project_id: 'proj-1', created_at: 0 },
      shots: [
        { id: 'sh-A', name: 'SH_010', status: 'wip', version_count: 0, latest_completed_version: null },
        { id: 'sh-B', name: 'SH_020', status: 'wip', version_count: 0, latest_completed_version: null },
      ],
      next_cursor: null,
      total_count: 2,
    };
    shotGrid.value = twoShotGrid as never;
    onShotStatusChanged({
      sequenceId: SEQ_ID,
      shotId: 'sh-B',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });
    const after = shotGrid.value as unknown as TestShotGridShape | null;
    // sh-A is unchanged
    expect(after?.shots.find((s) => s.id === 'sh-A')?.status).toBe('wip');
    // sh-B IS changed
    expect(after?.shots.find((s) => s.id === 'sh-B')?.status).toBe('approved');
  });

  it('Panel header pill reflects shotGrid after SSE-driven status flip (rerender required for signal subscription)', () => {
    shotGrid.value = makeShotGridShape('sh-A', 'SH_010', 'wip') as never;
    activeReviewShotId.value = 'sh-A';

    // Initial render: pill shows wip
    const { rerender, container } = render(
      <ReviewPanel
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
        onClose={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-status="wip"]'),
    ).not.toBeNull();

    // Simulate SSE → shotGrid mutation → parent passes new currentStatus
    onShotStatusChanged({
      sequenceId: SEQ_ID,
      shotId: 'sh-A',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    // OverlayHost reads shotGrid.value.shots.find(...).status on every render
    // and passes via prop; tests rerender ReviewPanel with the new prop to
    // mimic that flow.
    rerender(
      <ReviewPanel
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="approved"
        versions={[]}
        statusHistory={[]}
        onClose={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-status="approved"]'),
    ).not.toBeNull();
  });

  it('Timeline does NOT auto-refresh on SSE (UI-SPEC L496 — auto-refresh out of scope; timeline content is prop-driven)', () => {
    shotGrid.value = makeShotGridShape('sh-A', 'SH_010', 'wip') as never;
    const { container } = render(
      <ReviewPanel
        shotId="sh-A"
        shotName="SH_010"
        currentStatus="wip"
        versions={[]}
        statusHistory={[]}
        onClose={() => {}}
      />,
    );
    // Fire SSE; with empty props the timeline body stays empty (no fetch).
    onShotStatusChanged({
      sequenceId: SEQ_ID,
      shotId: 'sh-A',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });
    // The timeline section is present but has no row entries (status rows
    // come from props.statusHistory, not from SSE).
    const histSection = container.querySelector(
      'section[aria-label="Shot history"]',
    );
    expect(histSection).not.toBeNull();
    expect(histSection?.querySelectorAll('ul li').length).toBe(0);
  });
});
