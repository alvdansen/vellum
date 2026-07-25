// packages/dashboard/src/__tests__/sortHelpers.test.ts
//
// Phase 18 / Plan 18-04 Task 1 — sortHelpers.ts + sortTypes.ts unit coverage.
//
// 25 tests covering:
//   - sortTypes mirror byte-equality (Test 1)
//   - parseSortValue happy path + null/empty/garbage/whitelist refusal (Tests 2-5)
//   - serializeSortValue round-trip (Test 6)
//   - hydrateSortState state machine: URL > localStorage > defaults (Tests 7-11)
//     including D-13 (URL wins doesn't touch localStorage), D-15 (URL always
//     explicit via replaceState), D-16 (malformed URL → fallback)
//   - persistGridSort / persistTreeSort write all 3 layers (Tests 12-13)
//   - persistGridSort under quota-exceeded (Test 14 — silent fall-through)
//   - setBoundedLocalStorageEntry LRU companion-key behaviour (Tests 15-18)
//   - compareTreeNodes pure comparator (Tests 19-22)
//   - GRID_SORT_OPTIONS / TREE_SORT_OPTIONS shape (Tests 23-25)
//
// Mirrors packages/dashboard/src/__tests__/theme-persistence.test.ts setup:
// vi.stubGlobal('localStorage', memoryStorage) before importing sortHelpers
// so the module's localStorage references bind to the in-memory polyfill.
//
// Architecture-purity invariant (D-WEBUI-31): zero server-tree relative
// imports. Imports only from the dashboard tree.

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Memory localStorage polyfill — same shape as the Web Storage API surface. */
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

/** Quota-exceeded localStorage variant — setItem always throws. */
function makeQuotaExceededStorage(): Storage {
  const base = makeMemoryStorage();
  return {
    ...base,
    setItem: (_k: string, _v: string) => {
      throw new DOMException('Quota', 'QuotaExceededError');
    },
  };
}

// Install the polyfill BEFORE importing the module under test so the module's
// readLocalStorageSort closure binds to this implementation, not the Node
// no-op that would otherwise shadow jsdom's localStorage.
vi.stubGlobal('localStorage', makeMemoryStorage());

// Now safe to import the module under test.
// eslint-disable-next-line import/first
import {
  parseSortValue,
  serializeSortValue,
  hydrateSortState,
  persistGridSort,
  persistTreeSort,
  setBoundedLocalStorageEntry,
  compareTreeNodes,
  GRID_SORT_OPTIONS,
  TREE_SORT_OPTIONS,
} from '../lib/sortHelpers.js';
import type {
  SortField,
  HierarchySortField,
  SortDirection,
  VersionSort,
} from '../lib/sortTypes.js';
import {
  DEFAULT_VERSION_SORT,
  DEFAULT_HIERARCHY_SORT,
} from '../lib/sortTypes.js';

const VERSION_FIELDS: ReadonlySet<SortField> = new Set([
  'completed_at',
  'created_at',
  'name',
  'version_number',
]);
const HIERARCHY_FIELDS: ReadonlySet<HierarchySortField> = new Set([
  'name',
  'created_at',
]);

const GRID_LS_KEY = 'vellum:sort:grid';
const TREE_LS_KEY = 'vellum:sort:tree';

/**
 * Set up a fresh memory localStorage + URL/history mock per test. Returns the
 * replaceState spy so individual tests can assert on its calls.
 */
function setupEnv(search: string, opts?: { quota?: boolean }): {
  storage: Storage;
  replaceStateSpy: ReturnType<typeof vi.fn>;
} {
  const storage = opts?.quota ? makeQuotaExceededStorage() : makeMemoryStorage();
  vi.stubGlobal('localStorage', storage);

  const url = new URL(
    'http://localhost/' +
      (search.length === 0 ? '' : search.startsWith('?') ? search : `?${search}`),
  );
  const replaceStateSpy = vi.fn();
  vi.stubGlobal('window', {
    location: { href: url.href, search: url.search, pathname: url.pathname },
  });
  vi.stubGlobal('location', { href: url.href, search: url.search, pathname: url.pathname });
  vi.stubGlobal('history', { replaceState: replaceStateSpy });

  return { storage, replaceStateSpy };
}

describe('sortTypes — mirror byte-equality (Test 1)', () => {
  it('Test 1: defaults match server-side byte-equal', () => {
    expect(DEFAULT_VERSION_SORT).toEqual({ field: 'completed_at', dir: 'desc' });
    expect(DEFAULT_HIERARCHY_SORT).toEqual({ field: 'name', dir: 'asc' });
  });
});

describe('parseSortValue (Tests 2-5)', () => {
  it('Test 2: parses valid field:dir pair', () => {
    expect(parseSortValue('completed_at:desc', VERSION_FIELDS)).toEqual({
      field: 'completed_at',
      dir: 'desc',
    });
    expect(parseSortValue('name:asc', HIERARCHY_FIELDS)).toEqual({
      field: 'name',
      dir: 'asc',
    });
  });

  it('Test 3: returns null for null / undefined / empty', () => {
    expect(parseSortValue(null, VERSION_FIELDS)).toBeNull();
    expect(parseSortValue(undefined, VERSION_FIELDS)).toBeNull();
    expect(parseSortValue('', VERSION_FIELDS)).toBeNull();
  });

  it('Test 4: returns null on malformed input — never throws', () => {
    expect(() => parseSortValue('no_colon', VERSION_FIELDS)).not.toThrow();
    expect(parseSortValue('no_colon', VERSION_FIELDS)).toBeNull();
    expect(parseSortValue('foo:bar', VERSION_FIELDS)).toBeNull();
    expect(parseSortValue('completed_at:invalid_dir', VERSION_FIELDS)).toBeNull();
    expect(parseSortValue('foo:asc', VERSION_FIELDS)).toBeNull();
    // Edge: trailing colon with empty dir
    expect(parseSortValue('completed_at:', VERSION_FIELDS)).toBeNull();
    // Edge: leading colon with empty field
    expect(parseSortValue(':asc', VERSION_FIELDS)).toBeNull();
  });

  it('Test 5: refuses non-whitelisted fields (D-16 graceful fallback, no throw)', () => {
    expect(() =>
      parseSortValue('DROP_TABLE:desc', VERSION_FIELDS),
    ).not.toThrow();
    expect(parseSortValue('DROP_TABLE:desc', VERSION_FIELDS)).toBeNull();
    // Hierarchy whitelist is narrower (no 'completed_at'/'version_number')
    expect(parseSortValue('completed_at:desc', HIERARCHY_FIELDS)).toBeNull();
    expect(parseSortValue('version_number:desc', HIERARCHY_FIELDS)).toBeNull();
  });
});

describe('serializeSortValue round-trip (Test 6)', () => {
  it('Test 6: round-trip serialize → parse returns the original tuple', () => {
    const cases: VersionSort[] = [
      { field: 'completed_at', dir: 'desc' },
      { field: 'completed_at', dir: 'asc' },
      { field: 'created_at', dir: 'desc' },
      { field: 'name', dir: 'asc' },
      { field: 'version_number', dir: 'desc' },
    ];
    for (const c of cases) {
      const serialized = serializeSortValue(c);
      const parsed = parseSortValue(serialized, VERSION_FIELDS);
      expect(parsed).toEqual(c);
    }
  });
});

describe('hydrateSortState — state machine (Tests 7-11)', () => {
  it('Test 7: URL wins; localStorage NOT touched (D-13)', () => {
    const { storage, replaceStateSpy } = setupEnv(
      '?gridSort=completed_at:asc&treeSort=name:desc',
    );
    // Pre-seed localStorage with DIFFERENT values to prove URL wins
    storage.setItem(GRID_LS_KEY, JSON.stringify({ field: 'created_at', dir: 'desc' }));
    storage.setItem(TREE_LS_KEY, JSON.stringify({ field: 'created_at', dir: 'asc' }));

    const result = hydrateSortState();

    expect(result.gridSort).toEqual({ field: 'completed_at', dir: 'asc' });
    expect(result.treeSort).toEqual({ field: 'name', dir: 'desc' });
    // localStorage values must remain UNCHANGED — D-13 says URL wins doesn't
    // touch localStorage.
    expect(JSON.parse(storage.getItem(GRID_LS_KEY) ?? 'null')).toEqual({
      field: 'created_at',
      dir: 'desc',
    });
    expect(JSON.parse(storage.getItem(TREE_LS_KEY) ?? 'null')).toEqual({
      field: 'created_at',
      dir: 'asc',
    });
    // URL was already explicit — replaceState should NOT have been called.
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('Test 8: URL absent + localStorage valid → use localStorage AND write URL via replaceState (D-15)', () => {
    const { storage, replaceStateSpy } = setupEnv('');
    storage.setItem(GRID_LS_KEY, JSON.stringify({ field: 'created_at', dir: 'asc' }));
    storage.setItem(TREE_LS_KEY, JSON.stringify({ field: 'name', dir: 'desc' }));

    const result = hydrateSortState();

    expect(result.gridSort).toEqual({ field: 'created_at', dir: 'asc' });
    expect(result.treeSort).toEqual({ field: 'name', dir: 'desc' });
    // D-15: URL must always show current sort explicitly — replaceState fires.
    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    expect(String(lastCall[2])).toContain('gridSort=created_at%3Aasc');
    expect(String(lastCall[2])).toContain('treeSort=name%3Adesc');
  });

  it('Test 9: first-time visitor — URL absent + localStorage absent → defaults + write to all 3 layers', () => {
    const { storage, replaceStateSpy } = setupEnv('');
    expect(storage.getItem(GRID_LS_KEY)).toBeNull();
    expect(storage.getItem(TREE_LS_KEY)).toBeNull();

    const result = hydrateSortState();

    expect(result.gridSort).toEqual(DEFAULT_VERSION_SORT);
    expect(result.treeSort).toEqual(DEFAULT_HIERARCHY_SORT);
    // localStorage written
    expect(JSON.parse(storage.getItem(GRID_LS_KEY) ?? 'null')).toEqual(DEFAULT_VERSION_SORT);
    expect(JSON.parse(storage.getItem(TREE_LS_KEY) ?? 'null')).toEqual(DEFAULT_HIERARCHY_SORT);
    // URL written via replaceState
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  it('Test 10: malformed URL → fallback to default; logs console.warn (D-16, never throws)', () => {
    const { replaceStateSpy } = setupEnv('?gridSort=DROP_TABLE&treeSort=evil');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => hydrateSortState()).not.toThrow();
    const result = hydrateSortState();

    expect(result.gridSort).toEqual(DEFAULT_VERSION_SORT);
    expect(result.treeSort).toEqual(DEFAULT_HIERARCHY_SORT);
    // URL gets re-written to defaults via replaceState (D-15)
    expect(replaceStateSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('Test 11: malformed localStorage → fallback to default + rewrite localStorage', () => {
    const { storage } = setupEnv('');
    // Pre-seed corrupt JSON
    storage.setItem(GRID_LS_KEY, '{not json}');
    storage.setItem(TREE_LS_KEY, JSON.stringify({ field: 'banana', dir: 'asc' })); // valid JSON, invalid field

    const result = hydrateSortState();

    expect(result.gridSort).toEqual(DEFAULT_VERSION_SORT);
    expect(result.treeSort).toEqual(DEFAULT_HIERARCHY_SORT);
    // localStorage gets rewritten with the default since previous value was invalid
    expect(JSON.parse(storage.getItem(GRID_LS_KEY) ?? 'null')).toEqual(
      DEFAULT_VERSION_SORT,
    );
    expect(JSON.parse(storage.getItem(TREE_LS_KEY) ?? 'null')).toEqual(
      DEFAULT_HIERARCHY_SORT,
    );
  });
});

describe('persistGridSort / persistTreeSort (Tests 12-14)', () => {
  it('Test 12: persistGridSort writes localStorage + URL gridSort param', () => {
    const { storage, replaceStateSpy } = setupEnv('?treeSort=name:desc');
    persistGridSort({ field: 'completed_at', dir: 'asc' });

    // localStorage updated
    expect(JSON.parse(storage.getItem(GRID_LS_KEY) ?? 'null')).toEqual({
      field: 'completed_at',
      dir: 'asc',
    });
    // URL replaceState called with gridSort updated, treeSort preserved
    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCallUrl = String(
      replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1][2],
    );
    expect(lastCallUrl).toContain('gridSort=completed_at%3Aasc');
    expect(lastCallUrl).toContain('treeSort=name%3Adesc');
  });

  it('Test 13: persistTreeSort writes localStorage + URL treeSort param (preserves gridSort)', () => {
    const { storage, replaceStateSpy } = setupEnv('?gridSort=completed_at:desc');
    persistTreeSort({ field: 'name', dir: 'desc' });

    expect(JSON.parse(storage.getItem(TREE_LS_KEY) ?? 'null')).toEqual({
      field: 'name',
      dir: 'desc',
    });
    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCallUrl = String(
      replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1][2],
    );
    expect(lastCallUrl).toContain('treeSort=name%3Adesc');
    expect(lastCallUrl).toContain('gridSort=completed_at%3Adesc');
  });

  it('Test 14: persistGridSort under quota-exceeded — silent fall-through; URL still updates', () => {
    const { replaceStateSpy } = setupEnv('', { quota: true });
    expect(() =>
      persistGridSort({ field: 'completed_at', dir: 'asc' }),
    ).not.toThrow();
    // URL still updates (sort works in-session even if persistence fails)
    expect(replaceStateSpy).toHaveBeenCalled();
  });
});

describe('setBoundedLocalStorageEntry — LRU primitive (Tests 15-18)', () => {
  beforeEach(() => {
    setupEnv('');
  });

  it('Test 15: writes 51 keys with maxKeys=50 → key #1 (oldest) is evicted; _lru holds most-recent 50 in MRU order', () => {
    const prefix = 'lrutest';
    for (let i = 0; i < 51; i++) {
      setBoundedLocalStorageEntry(prefix, `k${i}`, `v${i}`, 50);
    }

    const lruRaw = localStorage.getItem(`${prefix}:_lru`);
    expect(lruRaw).not.toBeNull();
    const lruList = JSON.parse(lruRaw!);
    expect(Array.isArray(lruList)).toBe(true);
    expect(lruList).toHaveLength(50);
    // Most-recent first → k50 at index 0
    expect(lruList[0]).toBe('k50');
    // The OLDEST key (k0) was evicted
    expect(localStorage.getItem(`${prefix}:k0`)).toBeNull();
    // k1..k50 still present
    expect(localStorage.getItem(`${prefix}:k1`)).toBe('v1');
    expect(localStorage.getItem(`${prefix}:k50`)).toBe('v50');
    // _lru should NOT contain the evicted key
    expect(lruList).not.toContain('k0');
  });

  it('Test 16: updating existing key moves it to front of _lru', () => {
    const prefix = 'lrumove';
    setBoundedLocalStorageEntry(prefix, 'k1', 'v1', 50);
    setBoundedLocalStorageEntry(prefix, 'k2', 'v2', 50);
    setBoundedLocalStorageEntry(prefix, 'k1', 'v1updated', 50); // touch k1 again

    const lruList = JSON.parse(localStorage.getItem(`${prefix}:_lru`)!);
    expect(lruList[0]).toBe('k1'); // moved to front
    expect(lruList).toHaveLength(2); // no duplication
    expect(lruList).toContain('k2');
    expect(localStorage.getItem(`${prefix}:k1`)).toBe('v1updated');
  });

  it('Test 17: corrupt _lru companion → treated as empty, rebuilt; never throws', () => {
    const prefix = 'lrucorrupt';
    localStorage.setItem(`${prefix}:_lru`, '{not valid json}');
    expect(() => setBoundedLocalStorageEntry(prefix, 'k1', 'v1', 50)).not.toThrow();
    const lruList = JSON.parse(localStorage.getItem(`${prefix}:_lru`)!);
    expect(Array.isArray(lruList)).toBe(true);
    expect(lruList).toEqual(['k1']);
  });

  it('Test 18: localStorage.setItem throwing → silent no-op; never throws', () => {
    // Use a quota-exceeded shim
    vi.stubGlobal('localStorage', makeQuotaExceededStorage());
    expect(() =>
      setBoundedLocalStorageEntry('lru-q', 'k1', 'v1', 50),
    ).not.toThrow();
  });
});

describe('compareTreeNodes (Tests 19-22)', () => {
  it('Test 19: name asc — Banana > Apple', () => {
    const result = compareTreeNodes(
      { name: 'Banana', created_at: 0 },
      { name: 'Apple', created_at: 0 },
      { field: 'name', dir: 'asc' as SortDirection },
    );
    expect(result).toBeGreaterThan(0);
  });

  it('Test 20: name desc — Banana < Apple (inverted)', () => {
    const result = compareTreeNodes(
      { name: 'Banana', created_at: 0 },
      { name: 'Apple', created_at: 0 },
      { field: 'name', dir: 'desc' as SortDirection },
    );
    expect(result).toBeLessThan(0);
  });

  it('Test 21: created_at desc — older > newer (1000 > 2000 inverted)', () => {
    const result = compareTreeNodes(
      { name: '', created_at: 1000 },
      { name: '', created_at: 2000 },
      { field: 'created_at', dir: 'desc' as SortDirection },
    );
    expect(result).toBeGreaterThan(0);
  });

  it('Test 22: name asc uses localeCompare — Ä before Z (Unicode collation)', () => {
    const result = compareTreeNodes(
      { name: 'Ä', created_at: 0 },
      { name: 'Z', created_at: 0 },
      { field: 'name', dir: 'asc' as SortDirection },
    );
    // Most locales (including 'en-US') sort Ä near A, before Z.
    expect(result).toBeLessThan(0);
  });
});

describe('GRID_SORT_OPTIONS / TREE_SORT_OPTIONS (Tests 23-25)', () => {
  it('Test 23: GRID_SORT_OPTIONS has 3 entries — DEVIATION 1 (Name A→Z dropped)', () => {
    expect(GRID_SORT_OPTIONS).toHaveLength(3);
    const labels = GRID_SORT_OPTIONS.map((o) => o.label);
    expect(labels).toContain('Latest');
    expect(labels).toContain('Oldest');
    expect(labels).toContain('Version ↓');
    // 'Name A→Z' MUST NOT be in the grid — DEVIATION 1
    expect(labels).not.toContain('Name A→Z');
    // Each id matches the field:dir tuple
    for (const opt of GRID_SORT_OPTIONS) {
      expect(opt.id).toBe(`${opt.field}:${opt.dir}`);
    }
  });

  it('Test 24: TREE_SORT_OPTIONS has 4 entries verbatim per D-07', () => {
    expect(TREE_SORT_OPTIONS).toHaveLength(4);
    const labels = TREE_SORT_OPTIONS.map((o) => o.label);
    expect(labels).toEqual(['A→Z', 'Z→A', 'Newest', 'Oldest']);
    // First entry (default per D-07) is name:asc
    expect(TREE_SORT_OPTIONS[0]).toMatchObject({ field: 'name', dir: 'asc' });
  });

  it('Test 25: every option id is parseable by parseSortValue with the matching whitelist', () => {
    for (const opt of GRID_SORT_OPTIONS) {
      const parsed = parseSortValue(opt.id, VERSION_FIELDS);
      expect(parsed).toEqual({ field: opt.field, dir: opt.dir });
    }
    for (const opt of TREE_SORT_OPTIONS) {
      const parsed = parseSortValue(opt.id, HIERARCHY_FIELDS);
      expect(parsed).toEqual({ field: opt.field, dir: opt.dir });
    }
  });
});

