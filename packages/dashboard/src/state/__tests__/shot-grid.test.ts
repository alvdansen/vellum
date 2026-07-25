/**
 * Phase 21 / Plan 21-02 — Task T06 — state/shot-grid.ts unit tests.
 *
 * Covers four describe blocks (≥ 9 cases) matching the Wave 2 behavior
 * contract:
 *   - onShotStatusChanged: matching shot, unknown shotId, cross-sequence,
 *     null-shotGrid no-op
 *   - hydrateShotGridUrlState: valid params, malformed (console.warn +
 *     defaults), view+seq combo
 *   - persistShotGridUrlState: replaceState exactly once, pushState NEVER
 *   - aggregateCounts: reduce correctness + reactivity after
 *     onShotStatusChanged
 *
 * Module-singleton signal reset (PATTERNS §14 landmine guard): every
 * test starts with a fresh signal state via beforeEach. Without this,
 * one test's mutations leak into the next because @preact/signals
 * instances live at module scope.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  activeView,
  selectedSequenceForGrid,
  shotGrid,
  statusFilter,
  showOmitted,
  aggregateCounts,
  onShotStatusChanged,
  hydrateShotGridUrlState,
  persistShotGridUrlState,
} from '../shot-grid.js';
import type { ShotGridResponse } from '../../types/shot-grid.js';

/** Fixture: 2-shot grid for seq_1 (both wip initially). */
function seedShotGrid(): ShotGridResponse {
  return {
    sequence: { id: 'seq_1', name: 'SEQ_010' },
    shots: [
      {
        id: 'shot_1',
        name: 'sh010',
        status: 'wip',
        version_count: 0,
        is_stale: false,
        latest_completed_version: null,
      },
      {
        id: 'shot_2',
        name: 'sh020',
        status: 'wip',
        version_count: 0,
        is_stale: false,
        latest_completed_version: null,
      },
    ],
    // Phase 23 — D-02 sequence-wide stats envelope (default to 2 wip).
    stats: {
      total: 2,
      approved_pct: 0,
      counts: { wip: 2, 'pending-review': 0, approved: 0, 'on-hold': 0, omit: 0 },
      pending_review_backlog: 0,
      stale_count: 0,
    },
    next_cursor: null,
    total_count: 2,
  };
}

beforeEach(() => {
  // Module-singleton reset — PATTERNS §14 landmine guard
  activeView.value = 'home';
  selectedSequenceForGrid.value = null;
  shotGrid.value = null;
  statusFilter.value = 'all';
  showOmitted.value = false;
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('onShotStatusChanged', () => {
  it('mutates the matching shot immutably (signal reference changes)', () => {
    shotGrid.value = seedShotGrid();
    const before = shotGrid.value;

    onShotStatusChanged({
      shotId: 'shot_1',
      sequenceId: 'seq_1',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    expect(shotGrid.value).not.toBe(before);
    expect(shotGrid.value!.shots[0].status).toBe('approved');
    expect(shotGrid.value!.shots[1].status).toBe('wip');
    // The non-matching row's identity is preserved (no needless re-render)
    expect(shotGrid.value!.shots[1]).toBe(before.shots[1]);
  });

  it('unknown shotId leaves all shots unchanged', () => {
    shotGrid.value = seedShotGrid();

    onShotStatusChanged({
      shotId: 'shot_NONEXISTENT',
      sequenceId: 'seq_1',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    expect(shotGrid.value!.shots[0].status).toBe('wip');
    expect(shotGrid.value!.shots[1].status).toBe('wip');
  });

  it('cross-sequence event leaves shotGrid reference unchanged (A2/T-21-09)', () => {
    shotGrid.value = seedShotGrid();
    const before = shotGrid.value;

    onShotStatusChanged({
      shotId: 'shot_1',
      sequenceId: 'seq_DIFFERENT',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    // Reference unchanged — no mutation applied
    expect(shotGrid.value).toBe(before);
  });

  it('shotGrid===null is a no-op (does not throw)', () => {
    shotGrid.value = null;

    expect(() =>
      onShotStatusChanged({
        shotId: 'shot_x',
        sequenceId: 'seq_x',
        fromStatus: null,
        toStatus: 'wip',
        changedBy: 'user',
      }),
    ).not.toThrow();
    expect(shotGrid.value).toBe(null);
  });
});

describe('hydrateShotGridUrlState', () => {
  it('parses ?statusFilter=approved&showOmitted=1', () => {
    window.history.replaceState(
      null,
      '',
      '/?statusFilter=approved&showOmitted=1',
    );

    hydrateShotGridUrlState();

    expect(statusFilter.value).toBe('approved');
    expect(showOmitted.value).toBe(true);
  });

  it('malformed ?statusFilter=DROP_TABLE falls back to default + console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.history.replaceState(null, '', '/?statusFilter=DROP_TABLE');

    hydrateShotGridUrlState();

    expect(statusFilter.value).toBe('all'); // default unchanged
    expect(warnSpy).toHaveBeenCalled();
  });

  it('?view=shot-grid&seq=seq_xyz sets both signals', () => {
    window.history.replaceState(null, '', '/?view=shot-grid&seq=seq_xyz');

    hydrateShotGridUrlState();

    expect(activeView.value).toBe('shot-grid');
    expect(selectedSequenceForGrid.value).toBe('seq_xyz');
  });
});

describe('persistShotGridUrlState', () => {
  it('calls history.replaceState exactly once with serialized state', () => {
    const replaceSpy = vi.spyOn(history, 'replaceState');
    activeView.value = 'shot-grid';
    statusFilter.value = 'pending-review';
    showOmitted.value = true;
    selectedSequenceForGrid.value = 'seq_1';

    persistShotGridUrlState();

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const calledUrl = replaceSpy.mock.calls[0][2] as string;
    expect(calledUrl).toContain('view=shot-grid');
    expect(calledUrl).toContain('statusFilter=pending-review');
    expect(calledUrl).toContain('showOmitted=1');
    expect(calledUrl).toContain('seq=seq_1');
  });

  it('does NOT call history.pushState', () => {
    const pushSpy = vi.spyOn(history, 'pushState');
    persistShotGridUrlState();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

describe('aggregateCounts (D-14 computed)', () => {
  it('counts by status correctly', () => {
    shotGrid.value = {
      sequence: { id: 'seq_1', name: 'SEQ' },
      shots: [
        {
          id: 's1',
          name: 'sh1',
          status: 'wip',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
        {
          id: 's2',
          name: 'sh2',
          status: 'wip',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
        {
          id: 's3',
          name: 'sh3',
          status: 'approved',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
        {
          id: 's4',
          name: 'sh4',
          status: 'omit',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
        {
          id: 's5',
          name: 'sh5',
          status: 'omit',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
      ],
      // Phase 23 — D-02 sequence-wide stats (not asserted in this test).
      stats: {
        total: 5,
        approved_pct: 20,
        counts: { wip: 2, 'pending-review': 0, approved: 1, 'on-hold': 0, omit: 2 },
        pending_review_backlog: 0,
        stale_count: 0,
      },
      next_cursor: null,
      total_count: 5,
    };

    expect(aggregateCounts.value).toEqual({
      'wip': 2,
      'pending-review': 0,
      'approved': 1,
      'on-hold': 0,
      'omit': 2,
    });
  });

  it('re-computes reactively after onShotStatusChanged', () => {
    shotGrid.value = {
      sequence: { id: 'seq_1', name: 'SEQ' },
      shots: [
        {
          id: 's1',
          name: 'sh1',
          status: 'wip',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
        {
          id: 's2',
          name: 'sh2',
          status: 'wip',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
        {
          id: 's3',
          name: 'sh3',
          status: 'approved',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
        {
          id: 's4',
          name: 'sh4',
          status: 'omit',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
        {
          id: 's5',
          name: 'sh5',
          status: 'omit',
          version_count: 0,
          is_stale: false,
          latest_completed_version: null,
        },
      ],
      // Phase 23 — D-02 sequence-wide stats (not asserted in this test).
      stats: {
        total: 5,
        approved_pct: 20,
        counts: { wip: 2, 'pending-review': 0, approved: 1, 'on-hold': 0, omit: 2 },
        pending_review_backlog: 0,
        stale_count: 0,
      },
      next_cursor: null,
      total_count: 5,
    };

    onShotStatusChanged({
      shotId: 's1',
      sequenceId: 'seq_1',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });

    expect(aggregateCounts.value).toEqual({
      'wip': 1,
      'pending-review': 0,
      'approved': 2,
      'on-hold': 0,
      'omit': 2,
    });
  });
});
