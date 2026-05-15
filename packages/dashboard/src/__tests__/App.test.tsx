/**
 * App.tsx integration tests (Phase 21 / Plan 21-04 Task T02).
 *
 * Covers the 7 behaviors required by 21-04-PLAN.md <behavior>:
 *   1. activeView='home' renders <HomeView/> (distinguishing element present)
 *   2. activeView='shot-grid' renders <ShotGridView/> (filter bar's Status label
 *      present)
 *   3. Click on the Home button (aria-label='Back to home view') sets
 *      activeView.value = 'home'
 *   4. Home button has text-[var(--color-accent)] class when activeView='home'
 *      and text-[var(--color-fg-muted)] class when activeView='shot-grid'
 *   5. onSseEvent('shot.status_changed', ...) called on mount (D-22)
 *   6. offSseEvent('shot.status_changed', ...) called on unmount with the
 *      SAME function reference (events.ts:116 .delete depends on it)
 *   7. Existing version SSE subscriptions still present (regression check)
 *
 * Mocks: lib/events.js (the 4 SSE entry points are stubbed) + lib/api.js
 *   (fetchWorkspaces + fetchShotGrid stubbed to never resolve so neither
 *   view fires real HTTP). Hoisted via vi.mock so factory runs before any
 *   non-mocked module import.
 *
 * Signal reset in beforeEach is mandatory — @preact/signals are
 * module-singletons so activeView leaks between tests otherwise.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';

/**
 * In-memory localStorage polyfill — Node 25+ ships an experimental native
 * `localStorage` global that takes precedence over jsdom's implementation
 * and is a no-op without `--localstorage-file`. Mirrors the polyfill used
 * by views/__tests__/VersionDrawer.test.tsx (the canonical precedent for
 * dashboard tests that need browser-equivalent localStorage). ThemeToggle
 * + hydrateSortState both call localStorage.getItem at mount.
 */
function makeMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(store, key)
        ? store[key]
        : null;
    },
    key(index: number): string | null {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string): void {
      delete store[key];
    },
    setItem(key: string, value: string): void {
      store[key] = String(value);
    },
  };
}
vi.stubGlobal('localStorage', makeMemoryStorage());

// Hoisted mock of lib/events — the 4 entry points are stubs we can assert on.
vi.mock('../lib/events.js', () => ({
  startSse: vi.fn(),
  stopSse: vi.fn(),
  onSseEvent: vi.fn(),
  offSseEvent: vi.fn(),
}));

// Hoisted partial mock of lib/api — keep getThumbnailUrl etc. for Thumbnail,
// but stub the network helpers so neither view fires real HTTP at mount.
vi.mock('../lib/api.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Never-resolving promises so the views stay in their pre-fetch state
    // throughout the render. We assert on rendered structure, not on the
    // post-fetch updates.
    fetchWorkspaces: vi.fn(() => new Promise(() => {})),
    fetchProjects: vi.fn(() => new Promise(() => {})),
    fetchSequences: vi.fn(() => new Promise(() => {})),
    fetchShots: vi.fn(() => new Promise(() => {})),
    fetchVersions: vi.fn(() => new Promise(() => {})),
    fetchShotGrid: vi.fn(() => new Promise(() => {})),
    // Phase 21 / Plan 21-06 — fetchVersion stub for the URL deep-link
    // integration test below. VersionDrawerHost calls this on a cache miss
    // (shot-grid card click → version id not in versions.value).
    fetchVersion: vi.fn(() => new Promise(() => {})),
    // VersionDrawer mount-time fetches — never-resolving so the drawer's
    // initial state shows up immediately for assertions.
    getProvenance: vi.fn(() => new Promise(() => {})),
    getC2paStatus: vi.fn(() => Promise.resolve({ status: 'unknown' })),
    diffVersion: vi.fn(() => new Promise(() => {})),
    getOutputUrl: (id: string) => `/api/versions/${id}/output`,
  };
});

// Stub state/summaries so VersionDrawer's auto-fetch effect is a no-op
// during the deep-link integration test (avoids real network).
vi.mock('../state/summaries.js', async () => {
  const { signal } = (await vi.importActual('@preact/signals')) as {
    signal: <T>(v: T) => { value: T };
  };
  return {
    summarySignal: signal(new Map()),
    fetchSummary: vi.fn(() => new Promise(() => {})),
  };
});

import { App } from '../App.js';
import {
  activeView,
  selectedSequenceForGrid,
  shotGrid,
  statusFilter,
  showOmitted,
  gridIsFetching,
  gridLoadMoreError,
} from '../state/shot-grid.js';
import { selectedShotId } from '../state/hierarchy.js';
import { selectedVersionId, versions } from '../state/versions.js';
import * as events from '../lib/events.js';
import {
  fetchShotGrid,
  fetchVersion,
} from '../lib/api.js';
import { FILTER_BAR_STATUS_LABEL, HEADER_HOME_ARIA_LABEL } from '../lib/copy.js';
import type { ShotGridResponse } from '../types/shot-grid.js';
import type { Version } from '../types/entities.js';

beforeEach(() => {
  // Reset module-singleton signals to known defaults.
  activeView.value = 'home';
  selectedSequenceForGrid.value = null;
  shotGrid.value = null;
  statusFilter.value = 'all';
  showOmitted.value = false;
  gridIsFetching.value = false;
  gridLoadMoreError.value = null;
  selectedShotId.value = null;
  selectedVersionId.value = null;
  versions.value = [];
  vi.mocked(events.onSseEvent).mockReset();
  vi.mocked(events.offSseEvent).mockReset();
  vi.mocked(events.startSse).mockReset();
  vi.mocked(events.stopSse).mockReset();
  vi.mocked(fetchShotGrid).mockReset();
  vi.mocked(fetchVersion).mockReset();
  // Reset window.location.search so a prior test's persistShotGridUrlState()
  // doesn't leak URL state into hydrateShotGridUrlState() at the next mount.
  // jsdom does not let us assign to window.location.search directly; the
  // history.replaceState path mirrors what persist does, just clearing params.
  // Tests that NEED a seeded URL (e.g. the deep-link integration test)
  // re-set window.location.search AFTER beforeEach runs.
  try {
    history.replaceState(null, '', window.location.pathname);
  } catch {
    /* SSR / sandboxed history — no-op */
  }
});

afterEach(() => cleanup());

// ============================================================================
// View routing (Phase 21 GRID-01)
// ============================================================================

describe('App view routing (Phase 21 GRID-01)', () => {
  it("activeView='home' renders <HomeView/> (Project hierarchy nav present)", () => {
    activeView.value = 'home';
    const { container } = render(<App />);
    expect(
      container.querySelector('nav[aria-label="Project hierarchy"]'),
    ).toBeTruthy();
  });

  it("activeView='shot-grid' renders <ShotGridView/> (Status filter label present)", () => {
    activeView.value = 'shot-grid';
    selectedSequenceForGrid.value = 'seq_1';
    const { container } = render(<App />);
    // ShotGridFilterBar's leading label is FILTER_BAR_STATUS_LABEL ('Status').
    // The HomeView surface does NOT include this text, so its presence is a
    // ShotGridView-mounted-distinguishing element.
    expect(container.textContent).toContain(FILTER_BAR_STATUS_LABEL);
    // Conversely the home view nav should NOT be present in this branch.
    expect(
      container.querySelector('nav[aria-label="Project hierarchy"]'),
    ).toBeFalsy();
  });

  it("clicking the home button sets activeView.value = 'home' (D-02 / D-03)", () => {
    activeView.value = 'shot-grid';
    selectedSequenceForGrid.value = 'seq_1';
    const { container } = render(<App />);
    const home = container.querySelector(
      `button[aria-label="${HEADER_HOME_ARIA_LABEL}"]`,
    ) as HTMLButtonElement | null;
    expect(home).toBeTruthy();
    fireEvent.click(home!);
    expect(activeView.value).toBe('home');
  });

  it("home button uses accent color when activeView='home'", () => {
    activeView.value = 'home';
    const { container } = render(<App />);
    const home = container.querySelector(
      `button[aria-label="${HEADER_HOME_ARIA_LABEL}"]`,
    ) as HTMLButtonElement | null;
    expect(home?.className).toContain('text-[var(--color-accent)]');
    expect(home?.className).not.toContain('text-[var(--color-fg-muted)]');
  });

  it("home button uses muted color when activeView='shot-grid'", () => {
    activeView.value = 'shot-grid';
    selectedSequenceForGrid.value = 'seq_1';
    const { container } = render(<App />);
    const home = container.querySelector(
      `button[aria-label="${HEADER_HOME_ARIA_LABEL}"]`,
    ) as HTMLButtonElement | null;
    expect(home?.className).toContain('text-[var(--color-fg-muted)]');
  });
});

// ============================================================================
// SSE subscription lifecycle (Phase 21 GRID-02 / D-22)
// ============================================================================

describe('App SSE registration (Phase 21 GRID-02 D-22)', () => {
  it("subscribes to shot.status_changed on mount", () => {
    render(<App />);
    expect(events.onSseEvent).toHaveBeenCalledWith(
      'shot.status_changed',
      expect.any(Function),
    );
  });

  it("unsubscribes shot.status_changed on unmount with the SAME function reference (events.ts:116 .delete contract)", () => {
    const { unmount } = render(<App />);
    const subscribed = vi
      .mocked(events.onSseEvent)
      .mock.calls.find((c) => c[0] === 'shot.status_changed')?.[1];
    expect(subscribed).toBeDefined();
    unmount();
    const unsubscribed = vi
      .mocked(events.offSseEvent)
      .mock.calls.find((c) => c[0] === 'shot.status_changed')?.[1];
    expect(unsubscribed).toBeDefined();
    // Reference equality — the same function ref must be passed to both
    // on and off, otherwise Set.delete(fn) on lib/events.ts:116 misses the
    // entry and the handler leaks.
    expect(unsubscribed).toBe(subscribed);
  });

  it("regression: existing version SSE subscriptions still present", () => {
    render(<App />);
    expect(events.onSseEvent).toHaveBeenCalledWith(
      'version.created',
      expect.any(Function),
    );
    expect(events.onSseEvent).toHaveBeenCalledWith(
      'version.status_changed',
      expect.any(Function),
    );
  });
});

// ============================================================================
// URL deep-link integration (Phase 21 / Plan 21-06 — single test that catches
// the 3 cross-view-seam bugs from 21-AUDIT.md: Bug 1 hydrate-on-boot,
// Bug 2 VersionDrawer scope, Bug 5 drawer data model from non-cached version)
// ============================================================================

describe('App URL deep-link integration (Phase 21 GRID-04 / 21-AUDIT.md Bugs 1+2+5)', () => {
  /**
   * Builds a minimal ShotGridResponse with a single shot that has a latest
   * completed version. The ShotGridCard's onSelect fires with that
   * version's id when the card is clicked.
   */
  function buildResponse(): ShotGridResponse {
    return {
      sequence: { id: 'seq_1', name: 'SEQ_010' },
      shots: [
        {
          id: 'shot_a',
          name: 'SHOT_A',
          status: 'wip',
          version_count: 3,
          is_stale: false,
          latest_completed_version: {
            id: 'ver_a',
            thumbnail_url: '/api/versions/ver_a/thumbnail',
            completed_at: 1_700_000_000_000,
          },
        },
      ],
      // Phase 23 — D-02 sequence-wide stats envelope (single GROUP BY result).
      stats: {
        total: 1,
        approved_pct: 0,
        counts: { wip: 1, 'pending-review': 0, approved: 0, 'on-hold': 0, omit: 0 },
        pending_review_backlog: 0,
        stale_count: 0,
      },
      next_cursor: null,
      total_count: 1,
    };
  }

  /**
   * Returns a complete Version object — VersionDrawerHost's fetchVersion
   * resolves to this when the grid-card click writes a version id that's
   * not in versions.value (the Bug 5 scenario).
   */
  function buildVersion(): Version {
    return {
      id: 'ver_a',
      shot_id: 'shot_a',
      version_number: 1,
      status: 'complete',
    };
  }

  it('URL ?view=shot-grid&seq=seq_1 → mount → click card → drawer renders (catches Bugs 1+2+5)', async () => {
    // 1. Seed the URL BEFORE render so hydrateShotGridUrlState() picks it up
    //    on App mount. The default beforeEach above already cleared
    //    window.location.search — this assignment runs AFTER beforeEach.
    history.replaceState(null, '', '?view=shot-grid&seq=seq_1');

    // 2. Wire the fetch mocks. fetchShotGrid resolves with the seq_1 grid;
    //    fetchVersion resolves with ver_a (the grid-card scenario writes a
    //    version id that's not in versions.value, so the host must fall
    //    back to the API).
    vi.mocked(fetchShotGrid).mockResolvedValue(buildResponse());
    vi.mocked(fetchVersion).mockResolvedValue(buildVersion());

    // 3. Render <App/>, NOT a leaf view. The URL hydrate has to flow
    //    activeView → 'shot-grid' BEFORE the body's view switch decides
    //    which subtree to mount. This is the chicken-and-egg seam (Bug 1).
    const { container } = render(<App />);

    // 4. Bug 1 check: shot-grid surface mounted on URL alone. The
    //    FILTER_BAR_STATUS_LABEL ('Status') is unique to ShotGridView's
    //    ShotGridFilterBar — its presence is proof that activeView flipped.
    await waitFor(() => {
      expect(container.textContent).toContain(FILTER_BAR_STATUS_LABEL);
    });

    // 5. Wait for the grid card to render (fetchShotGrid resolution lands
    //    on a microtask after mount).
    await waitFor(() => {
      const card = container.querySelector(
        'button[aria-label="Open version drawer for SHOT_A"]',
      );
      expect(card).toBeTruthy();
    });

    // 6. Click the card. The handler writes selectedVersionId='ver_a'.
    const card = container.querySelector(
      'button[aria-label="Open version drawer for SHOT_A"]',
    ) as HTMLButtonElement;
    fireEvent.click(card);

    // 7. Bug 2 + 5 check: the VersionDrawerHost overlay (mounted at App
    //    scope, NOT inside HomeView) reads selectedVersionId, sees the
    //    cache miss, calls fetchVersion('ver_a'), and renders <VersionDrawer/>
    //    once the fetch resolves. Without the 21-06 refactor the drawer
    //    would never render — HomeView is unmounted (activeView='shot-grid')
    //    so its render-time <VersionDrawer/> never fires.
    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    });
    expect(vi.mocked(fetchVersion)).toHaveBeenCalledWith('ver_a');
  });
});
