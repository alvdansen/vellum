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
import { render, fireEvent, cleanup } from '@testing-library/preact';

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
import { selectedVersionId } from '../state/versions.js';
import * as events from '../lib/events.js';
import { FILTER_BAR_STATUS_LABEL, HEADER_HOME_ARIA_LABEL } from '../lib/copy.js';

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
  vi.mocked(events.onSseEvent).mockReset();
  vi.mocked(events.offSseEvent).mockReset();
  vi.mocked(events.startSse).mockReset();
  vi.mocked(events.stopSse).mockReset();
  // Reset window.location.search so a prior test's persistShotGridUrlState()
  // doesn't leak URL state into hydrateShotGridUrlState() at the next mount.
  // jsdom does not let us assign to window.location.search directly; the
  // history.replaceState path mirrors what persist does, just clearing params.
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
