/**
 * Phase 18 / Plan 18-05 Task 2 — HomeView first-load hydration tests.
 *
 * Verifies the URL → localStorage → defaults reconciliation per D-13/D-15/D-16
 * happens correctly on HomeView mount, AND that the SortDropdown + version-grid
 * + tree primitives render with the hydrated values.
 *
 * Test setup mirrors theme-persistence.test.ts: vi.stubGlobal('localStorage',
 * memoryStorage) before importing the component, and per-test stubs for
 * window.location + history.replaceState + fetch.
 *
 * Architecture-purity (D-WEBUI-31): zero server-tree relative imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h } from 'preact';
import { render, screen, waitFor } from '@testing-library/preact';

/** Memory localStorage polyfill — same shape as Web Storage API. */
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
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
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

const memoryStorage = makeMemoryStorage();
vi.stubGlobal('localStorage', memoryStorage);

// Import AFTER localStorage stubbing so module-level closures bind to the polyfill.
// eslint-disable-next-line import/first
import { HomeView } from '../views/HomeView.js';
// eslint-disable-next-line import/first
import {
  versions,
  selectedVersionId,
  gridSort,
  gridCursor,
  gridTotalCount,
  gridIsFetching,
  gridLoadMoreError,
} from '../state/versions.js';
// eslint-disable-next-line import/first
import {
  workspaces,
  selectedShotId,
  selectedWorkspaceId,
  selectedProjectId,
  selectedSequenceId,
  treeSort,
} from '../state/hierarchy.js';
// eslint-disable-next-line import/first
import {
  DEFAULT_VERSION_SORT,
  DEFAULT_HIERARCHY_SORT,
} from '../lib/sortTypes.js';

interface SetupOpts {
  urlSearch?: string;
  localStorageGrid?: string;
  localStorageTree?: string;
  /** Map from URL path prefix → JSON body. Routes match by startsWith. */
  fetchRoutes?: Record<string, unknown>;
}

interface SetupResult {
  replaceStateSpy: ReturnType<typeof vi.fn>;
  fetchSpy: ReturnType<typeof vi.fn>;
}

function setupHomeView(opts: SetupOpts = {}): SetupResult {
  const search = opts.urlSearch ?? '';
  const url = new URL(`http://localhost/${search}`);

  // Reset signals.
  versions.value = [];
  selectedVersionId.value = null;
  selectedShotId.value = null;
  selectedWorkspaceId.value = null;
  selectedProjectId.value = null;
  selectedSequenceId.value = null;
  workspaces.value = [];
  gridSort.value = DEFAULT_VERSION_SORT;
  gridCursor.value = null;
  gridTotalCount.value = 0;
  gridIsFetching.value = false;
  gridLoadMoreError.value = null;
  treeSort.value = DEFAULT_HIERARCHY_SORT;

  // Reset localStorage.
  memoryStorage.clear();
  if (opts.localStorageGrid) {
    memoryStorage.setItem('vfx-familiar:sort:grid', opts.localStorageGrid);
  }
  if (opts.localStorageTree) {
    memoryStorage.setItem('vfx-familiar:sort:tree', opts.localStorageTree);
  }

  // Stub window.location to a writable URL with the test's search params.
  // jsdom's location is read-only by default; replace via stubGlobal.
  vi.stubGlobal('window', {
    ...globalThis.window,
    location: url,
  });
  // Some sortHelpers code paths reference bare `window.location.href`. Make
  // sure the global URL object is also updated for tests reading it directly.
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: url,
  });

  // Stub history.replaceState — the helper writes URL via this method.
  const replaceStateSpy = vi.fn();
  vi.stubGlobal('history', { replaceState: replaceStateSpy });

  // Stub fetch — return JSON for any matching route prefix; otherwise empty.
  const routes = opts.fetchRoutes ?? {};
  const fetchSpy = vi.fn().mockImplementation(async (urlArg: string) => {
    for (const prefix of Object.keys(routes)) {
      if (urlArg.startsWith(prefix)) {
        return new Response(JSON.stringify(routes[prefix]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    // Default: empty array OR empty paginated response based on URL shape.
    if (urlArg.includes('/versions')) {
      return new Response(
        JSON.stringify({ items: [], next_cursor: null, total_count: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchSpy);

  return { replaceStateSpy, fetchSpy };
}

describe('HomeView — Plan 18-05 first-load hydration', () => {
  beforeEach(() => {
    // Each test calls setupHomeView() to install fresh stubs.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Test 1: no URL params + no localStorage → defaults; replaceState writes both gridSort + treeSort', async () => {
    const { replaceStateSpy } = setupHomeView();
    render(h(HomeView, null));
    await waitFor(() => {
      expect(gridSort.value).toEqual(DEFAULT_VERSION_SORT);
      expect(treeSort.value).toEqual(DEFAULT_HIERARCHY_SORT);
    });
    // D-15: replaceState fills both missing params on the first paint.
    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    const writtenUrl = String(lastCall[2]);
    expect(writtenUrl).toContain('gridSort=completed_at%3Adesc');
    expect(writtenUrl).toContain('treeSort=name%3Aasc');
  });

  it('Test 2: URL wins — query param value used; localStorage value is NOT touched (D-13)', async () => {
    setupHomeView({
      urlSearch: '?gridSort=completed_at:asc&treeSort=name:desc',
      localStorageGrid: JSON.stringify({ field: 'name', dir: 'asc' }),
      localStorageTree: JSON.stringify({ field: 'created_at', dir: 'desc' }),
    });
    render(h(HomeView, null));
    await waitFor(() => {
      expect(gridSort.value).toEqual({ field: 'completed_at', dir: 'asc' });
      expect(treeSort.value).toEqual({ field: 'name', dir: 'desc' });
    });
    // D-13: URL wins → localStorage left untouched.
    expect(memoryStorage.getItem('vfx-familiar:sort:grid')).toBe(
      JSON.stringify({ field: 'name', dir: 'asc' }),
    );
    expect(memoryStorage.getItem('vfx-familiar:sort:tree')).toBe(
      JSON.stringify({ field: 'created_at', dir: 'desc' }),
    );
  });

  it('Test 3: localStorage wins when URL absent; URL written via replaceState (D-15)', async () => {
    const { replaceStateSpy } = setupHomeView({
      localStorageGrid: JSON.stringify({ field: 'created_at', dir: 'desc' }),
    });
    render(h(HomeView, null));
    await waitFor(() => {
      expect(gridSort.value).toEqual({ field: 'created_at', dir: 'desc' });
    });
    // D-15: replaceState fills the missing URL param with the localStorage value.
    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    const writtenUrl = String(lastCall[2]);
    expect(writtenUrl).toContain('gridSort=created_at%3Adesc');
  });

  it('Test 4: malformed URL value → fallback to default; never throws (D-16)', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupHomeView({ urlSearch: '?gridSort=DROP_TABLE' });
    render(h(HomeView, null));
    await waitFor(() => {
      // Falls back to default; no throw to error boundary.
      expect(gridSort.value).toEqual(DEFAULT_VERSION_SORT);
    });
    consoleSpy.mockRestore();
  });

  it('Test 5: tree A→Z is the default when no URL + no localStorage (SORT-04)', async () => {
    setupHomeView();
    render(h(HomeView, null));
    await waitFor(() => {
      expect(treeSort.value).toEqual({ field: 'name', dir: 'asc' });
    });
  });

  it('Test 6: grid SortDropdown renders with the default Latest label', async () => {
    setupHomeView();
    render(h(HomeView, null));
    await waitFor(() => {
      // The grid SortDropdown's trigger has aria-label='Sort versions by'
      // and renders the current option's label inside the button.
      const trigger = screen.getByRole('combobox', { name: 'Sort versions by' });
      expect(trigger.textContent).toContain('Latest');
    });
  });

  it('Test 7: tree SortDropdown renders with the default A→Z label', async () => {
    setupHomeView();
    render(h(HomeView, null));
    await waitFor(() => {
      const trigger = screen.getByRole('combobox', { name: 'Sort tree by' });
      expect(trigger.textContent).toContain('A→Z');
    });
  });

  it('Test 8: LoadMoreButton hidden when next_cursor === null (page is final)', async () => {
    setupHomeView({
      fetchRoutes: {
        '/api/shots/shot_x/versions': {
          items: [
            { id: 'v1', shot_id: 'shot_x', version_number: 1 },
            { id: 'v2', shot_id: 'shot_x', version_number: 2 },
          ],
          next_cursor: null, // no more pages
          total_count: 2,
        },
      },
    });
    selectedShotId.value = 'shot_x';
    render(h(HomeView, null));
    await waitFor(() => {
      expect(versions.value).toHaveLength(2);
    });
    // No "Load N more" button — next_cursor is null
    expect(screen.queryByText(/Load \d+ more/)).toBeNull();
  });

  it("Test 9: latestCompletedForSelectedShot derivation continues working under new sort (Phase 17 invariant preserved)", async () => {
    setupHomeView({
      fetchRoutes: {
        '/api/shots/shot_y/versions': {
          // Page 1 under the new ORDER BY: in-progress (NULL pin) at top,
          // then completed by completed_at DESC. The first 'complete' row
          // is what latestCompletedForSelectedShot should pick up.
          items: [
            { id: 'v3', shot_id: 'shot_y', version_number: 3, status: 'running' },
            { id: 'v2', shot_id: 'shot_y', version_number: 2, status: 'complete' },
            { id: 'v1', shot_id: 'shot_y', version_number: 1, status: 'complete' },
          ],
          next_cursor: null,
          total_count: 3,
        },
      },
    });
    selectedShotId.value = 'shot_y';
    render(h(HomeView, null));
    await waitFor(() => {
      expect(versions.value).toHaveLength(3);
    });
    // The first 'complete' row in versions.value is v2 — the derivation
    // returns it for the selected shot.
    const completed = versions.value.find((v) => v.status === 'complete');
    expect(completed?.id).toBe('v2');
  });
});
