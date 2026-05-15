/**
 * ShotGridView integration tests (Phase 21 / Plan 21-04 Task T01).
 *
 * Covers the 9 view-level behaviors required by 21-04-PLAN.md <behavior>:
 *   1. CSS Grid template applied: gridTemplateColumns 'repeat(auto-fill, minmax(220px, 1fr))'
 *   2. Loading state when shotGrid.value === null AND gridIsFetching === true
 *   3. showOmitted=false hides omit shots
 *   4. showOmitted=true renders omit shots with opacity-40 wrapper
 *   5. statusFilter='approved' restricts to approved shots only
 *   6. Card click sets selectedVersionId.value (D-19 — opens VersionDrawer overlay,
 *      does NOT mutate selectedShotId per D-04)
 *   7. Empty state copy variants:
 *      - zero shots → SHOT_GRID_EMPTY_NO_SHOTS
 *      - all-omitted with filter='all', showOmitted=false → SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX
 *      - filter='pending-review' with no matches → SHOT_GRID_EMPTY_FILTER_PREFIX template
 *      - filter='omit' with showOmitted=false → SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN (defensive)
 *   8. Toggle Show omitted OFF when filter='omit' auto-resets filter to 'all'
 *
 * Mocking strategy: vi.mock the lib/api module so fetchShotGrid is a controllable
 * vi.fn() — no real HTTP. The hoisted mock keeps imports clean.
 *
 * Signal reset in beforeEach is critical — @preact/signals are module-singletons,
 * so without explicit reset one test's mutations leak into the next.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';

// Hoisted partial mock for the api module — fetchShotGrid is a vi.fn we set
// per test; all other exports (getThumbnailUrl, etc.) keep their real impl so
// that Thumbnail.tsx and other consumers continue to work during render.
vi.mock('../../lib/api.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    fetchShotGrid: vi.fn(),
  };
});

import { ShotGridView } from '../ShotGridView.js';
import { fetchShotGrid } from '../../lib/api.js';
import {
  selectedSequenceForGrid,
  shotGrid,
  statusFilter,
  showOmitted,
  gridIsFetching,
  gridLoadMoreError,
  activeView,
} from '../../state/shot-grid.js';
import { selectedVersionId } from '../../state/versions.js';
import type {
  ShotGridResponse,
  ShotGridRow,
  ShotStatus,
} from '../../types/shot-grid.js';
import {
  SHOT_GRID_EMPTY_NO_SHOTS,
  SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX,
  SHOT_GRID_EMPTY_FILTER_PREFIX,
  SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN,
  SHOT_GRID_LOADING_LABEL,
  SHOT_GRID_FETCH_ERROR,
} from '../../lib/copy.js';

// ---------- Fixtures ----------

function makeShot(
  id: string,
  status: ShotStatus,
  hasVersion = true,
): ShotGridRow {
  return {
    id,
    name: id.toUpperCase(),
    status,
    version_count: hasVersion ? 3 : 0,
    latest_completed_version: hasVersion
      ? {
          id: `ver_${id}`,
          thumbnail_url: `/api/versions/ver_${id}/thumbnail`,
          completed_at: 1_700_000_000_000,
        }
      : null,
  };
}

function buildResponse(overrides: Partial<ShotGridResponse> = {}): ShotGridResponse {
  return {
    sequence: { id: 'seq_1', name: 'SEQ_010', ...overrides.sequence },
    shots:
      overrides.shots ?? [
        makeShot('shot_1', 'wip'),
        makeShot('shot_2', 'approved'),
        makeShot('shot_3', 'omit'),
      ],
    next_cursor:
      'next_cursor' in overrides ? overrides.next_cursor ?? null : null,
    total_count: overrides.total_count ?? 3,
  };
}

/**
 * Render and wait for the mount-time fetch + microtask flush so the
 * shotGrid signal has been written before assertions run. Tests can seed
 * signals directly before calling this to bypass the fetch effect's
 * initial overwrite (shotGrid is set explicitly after the await).
 */
async function renderAndWait(
  res: ShotGridResponse = buildResponse(),
): Promise<ReturnType<typeof render>> {
  selectedSequenceForGrid.value = res.sequence.id;
  vi.mocked(fetchShotGrid).mockResolvedValue(res);
  const result = render(<ShotGridView />);
  // Flush microtasks so the .then() in the fetch effect lands.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return result;
}

// ---------- Signal reset ----------

beforeEach(() => {
  // Module-singleton @preact/signals — reset every signal to its default so
  // one test's mutations don't leak into the next.
  activeView.value = 'shot-grid';
  selectedSequenceForGrid.value = null;
  shotGrid.value = null;
  statusFilter.value = 'all';
  showOmitted.value = false;
  gridIsFetching.value = false;
  gridLoadMoreError.value = null;
  selectedVersionId.value = null;
  vi.mocked(fetchShotGrid).mockReset();
  cleanup();
});

// ============================================================================
// Test cases per 21-04-PLAN.md <behavior>
// ============================================================================

describe('ShotGridView — CSS Grid template (REQ-04 lock)', () => {
  it('renders inline-style gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))"', async () => {
    const { container } = await renderAndWait();
    const gridDiv = container.querySelector(
      '[style*="grid-template-columns"]',
    ) as HTMLElement | null;
    expect(gridDiv).toBeTruthy();
    expect(gridDiv?.style.gridTemplateColumns).toBe(
      'repeat(auto-fill, minmax(220px, 1fr))',
    );
  });
});

describe('ShotGridView — loading state', () => {
  it('renders SHOT_GRID_LOADING_LABEL when shotGrid is null and gridIsFetching is true', () => {
    // Mock fetchShotGrid to a never-resolving promise so the view stays in
    // the loading branch (shotGrid still null, gridIsFetching still true).
    selectedSequenceForGrid.value = 'seq_1';
    vi.mocked(fetchShotGrid).mockReturnValue(new Promise(() => {}));
    const { container } = render(<ShotGridView />);
    expect(container.textContent).toContain(SHOT_GRID_LOADING_LABEL);
  });
});

describe('ShotGridView — client-side filter (REQ-03 + D-08)', () => {
  it('with showOmitted=false hides omit shots from the grid', async () => {
    showOmitted.value = false;
    statusFilter.value = 'all';
    const { container } = await renderAndWait(
      buildResponse({
        shots: [
          makeShot('shot_1', 'wip'),
          makeShot('shot_2', 'wip'),
          makeShot('shot_3', 'omit'),
        ],
        total_count: 3,
      }),
    );
    const cards = container.querySelectorAll(
      'button[aria-label^="Open version drawer for "]',
    );
    expect(cards.length).toBe(2); // omit hidden
  });

  it('with showOmitted=true renders omit shots inside an opacity-40 wrapper', async () => {
    showOmitted.value = true;
    statusFilter.value = 'all';
    const { container } = await renderAndWait(
      buildResponse({
        shots: [
          makeShot('shot_1', 'wip'),
          makeShot('shot_2', 'wip'),
          makeShot('shot_3', 'omit'),
        ],
        total_count: 3,
      }),
    );
    const cards = container.querySelectorAll(
      'button[aria-label^="Open version drawer for "]',
    );
    expect(cards.length).toBe(3); // omit included
    // The omit card's ancestor should have opacity-40 class.
    // Phase 22 D-13: card structure is now
    //   <div class="opacity-40 ..."> ← wrapper (this assertion target)
    //     <div class="group relative ...">  ← cardBody
    //       <button aria-label="Open version drawer for ...">  ← omitButton
    //         ...
    // Walk up to the `.opacity-40` ancestor via `.closest()`.
    const omitButton = container.querySelector(
      'button[aria-label="Open version drawer for SHOT_3"]',
    ) as HTMLElement | null;
    expect(omitButton).toBeTruthy();
    const wrapper = omitButton?.closest('.opacity-40') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain('opacity-40');
  });

  it("with statusFilter='approved', only approved shots are visible", async () => {
    statusFilter.value = 'approved';
    showOmitted.value = false;
    const { container } = await renderAndWait(
      buildResponse({
        shots: [
          makeShot('shot_1', 'wip'),
          makeShot('shot_2', 'approved'),
          makeShot('shot_3', 'pending-review'),
        ],
        total_count: 3,
      }),
    );
    const cards = container.querySelectorAll(
      'button[aria-label^="Open version drawer for "]',
    );
    expect(cards.length).toBe(1);
    expect(cards[0].getAttribute('aria-label')).toBe(
      'Open version drawer for SHOT_2',
    );
  });
});

describe('ShotGridView — card click (D-19, D-04)', () => {
  it('sets selectedVersionId.value to latest_completed_version.id on card click', async () => {
    statusFilter.value = 'all';
    showOmitted.value = true;
    const { container } = await renderAndWait(
      buildResponse({
        shots: [makeShot('shot_1', 'wip')],
        total_count: 1,
      }),
    );
    const card = container.querySelector(
      'button[aria-label="Open version drawer for SHOT_1"]',
    ) as HTMLButtonElement | null;
    expect(card).toBeTruthy();
    fireEvent.click(card!);
    expect(selectedVersionId.value).toBe('ver_shot_1');
  });
});

describe('ShotGridView — empty state copy variants (D-18)', () => {
  it('zero shots → SHOT_GRID_EMPTY_NO_SHOTS', async () => {
    const { container } = await renderAndWait(
      buildResponse({
        shots: [],
        total_count: 0,
      }),
    );
    expect(container.textContent).toContain(SHOT_GRID_EMPTY_NO_SHOTS);
  });

  it("filter='all' + showOmitted=false + all-omitted dataset → SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED", async () => {
    statusFilter.value = 'all';
    showOmitted.value = false;
    const { container } = await renderAndWait(
      buildResponse({
        shots: [makeShot('shot_1', 'omit')],
        total_count: 1,
      }),
    );
    expect(container.textContent).toContain(
      `${SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX}SEQ_010.`,
    );
  });

  it("filter='pending-review' with no matches → SHOT_GRID_EMPTY_FILTER_PREFIX template", async () => {
    statusFilter.value = 'pending-review';
    showOmitted.value = false;
    const { container } = await renderAndWait(
      buildResponse({
        shots: [makeShot('shot_1', 'wip'), makeShot('shot_2', 'approved')],
        total_count: 2,
      }),
    );
    expect(container.textContent).toContain(
      `${SHOT_GRID_EMPTY_FILTER_PREFIX}pending-review' in SEQ_010.`,
    );
  });

  it("defensive branch: statusFilter='omit' with showOmitted=false → SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN (21-04 plan-checker FLAG)", async () => {
    // This is the defensive case: URL hydration could place statusFilter='omit'
    // while showOmitted=false; the view must surface a self-explanatory copy
    // rather than the generic "no shots with status 'omit'" fallback.
    statusFilter.value = 'omit';
    showOmitted.value = false;
    const { container } = await renderAndWait(
      buildResponse({
        shots: [makeShot('shot_1', 'wip'), makeShot('shot_2', 'omit')],
        total_count: 2,
      }),
    );
    expect(container.textContent).toContain(SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN);
  });
});

describe('ShotGridView — Show omitted toggle auto-reset (D-07)', () => {
  it("toggling Show omitted OFF while statusFilter='omit' auto-resets filter to 'all'", async () => {
    statusFilter.value = 'omit';
    showOmitted.value = true;
    const { container } = await renderAndWait(
      buildResponse({
        shots: [makeShot('shot_1', 'omit'), makeShot('shot_2', 'wip')],
        total_count: 2,
      }),
    );
    // Find the role=switch button (the "Show omitted" toggle).
    const toggle = container.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement | null;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    expect(showOmitted.value).toBe(false);
    expect(statusFilter.value).toBe('all');
  });
});

// ============================================================================
// Phase 21 / Plan 21-06 — Bug 4 (sequence switch clears stale grid) +
// Bug 6 (initial fetch rejection renders error state, not blank pane).
// ============================================================================

describe('ShotGridView — sequence switch clears stale grid (21-AUDIT.md Bug 4)', () => {
  it('switching to a new sequence clears the previous sequence shots before the new fetch resolves', async () => {
    // 1. Load seq A first. renderAndWait resolves A's fetch and writes
    //    shotGrid.value with shots SHOT_A1, SHOT_A2.
    const seqA = buildResponse({
      sequence: { id: 'seq_a', name: 'SEQ_A' },
      shots: [
        makeShot('shot_a1', 'wip'),
        makeShot('shot_a2', 'wip'),
      ],
      total_count: 2,
    });
    const { container } = await renderAndWait(seqA);
    expect(
      container.querySelector('button[aria-label="Open version drawer for SHOT_A1"]'),
    ).toBeTruthy();

    // 2. Switch to seq B. Mock fetchShotGrid to return a never-resolving
    //    promise — this simulates seq B's network being slow. The init
    //    effect re-fires when selectedSequenceForGrid changes.
    vi.mocked(fetchShotGrid).mockReturnValue(new Promise(() => {}));
    selectedSequenceForGrid.value = 'seq_b';

    // 3. After the signal change, await a microtask flush so the new effect
    //    runs. The Bug 4 fix synchronously clears shotGrid.value=null at the
    //    top of the effect — so the prior sequence's shots disappear from
    //    the DOM even though the new fetch is still pending.
    await waitFor(() => {
      expect(
        container.querySelector(
          'button[aria-label="Open version drawer for SHOT_A1"]',
        ),
      ).toBeFalsy();
    });

    // 4. Final state assertion: the loading-state copy is shown (shotGrid
    //    null + gridIsFetching true). Critically: NO shot-A cards visible
    //    while we wait for seq B.
    expect(shotGrid.value).toBeNull();
    expect(container.textContent).toContain(SHOT_GRID_LOADING_LABEL);
  });
});

describe('ShotGridView — initial fetch rejection renders error state (21-AUDIT.md Bug 6)', () => {
  it('initial fetchShotGrid rejection renders the full-pane error copy + retry button (NOT a blank pane)', async () => {
    selectedSequenceForGrid.value = 'seq_1';
    // Reject the initial fetch. With the Bug 6 fix, the .catch() sets
    // gridLoadMoreError.value = SHOT_GRID_FETCH_ERROR and the render switch
    // shows the full-pane error branch BEFORE the empty-state check.
    vi.mocked(fetchShotGrid).mockRejectedValue(
      new Error('simulated 500 from server'),
    );
    const { container } = render(<ShotGridView />);

    // Wait for the .catch() to settle and the error pane to render.
    await waitFor(() => {
      expect(container.textContent).toContain(SHOT_GRID_FETCH_ERROR);
    });

    // The error pane is wrapped in role="alert" (SR-friendly announcement).
    expect(container.querySelector('[role="alert"]')).toBeTruthy();

    // Retry button rendered with the LOAD_MORE_RETRY_LABEL ('Retry') copy.
    const retryButton = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Retry'));
    expect(retryButton).toBeTruthy();

    // Bug 6 regression: BEFORE the fix, gridLoadMoreError was the inline
    // pill copy ("Failed to load") which was attached to the LoadMoreButton
    // pill — only renders when shotGrid is non-null. shotGrid was still
    // null so the pane was blank. Now the error state has its own branch.
    expect(shotGrid.value).toBeNull();
    expect(gridLoadMoreError.value).toBe(SHOT_GRID_FETCH_ERROR);
  });
});
