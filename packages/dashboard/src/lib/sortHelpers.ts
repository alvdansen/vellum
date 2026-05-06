/**
 * Phase 18 / Plan 18-04 — sort-related dashboard helpers.
 *
 * Surface (9 exports + SortOption type):
 *   - parseSortValue / serializeSortValue — string ↔ {field, dir} round-trip
 *   - hydrateSortState — URL → localStorage → defaults reconciliation (D-13/D-15)
 *   - persistGridSort / persistTreeSort — write signal + localStorage + URL
 *   - setBoundedLocalStorageEntry — companion-key LRU primitive (D-25)
 *   - compareTreeNodes — client-side tree re-sort comparator (D-discretion)
 *   - GRID_SORT_OPTIONS / TREE_SORT_OPTIONS — UI dropdown configurations
 *
 * Architecture-purity (D-WEBUI-31): zero imports from src/. Types come from
 * the local mirror at './sortTypes.js'.
 *
 * DEVIATION 1 (this plan; lockstep with DEVIATION 2 in src/store/sort.ts):
 *   GRID_SORT_OPTIONS has 3 entries (Latest, Oldest, Version ↓). 'Name A→Z'
 *   is DROPPED from grid options because the `versions` table has no `name`
 *   column (verified at src/store/schema.ts:66-102; the engine SortField
 *   enum keeps `name` for whitelist completeness but falls back to
 *   versions.id, never reachable from the UI). TREE_SORT_OPTIONS retains
 *   all 4 entries because projects/sequences/shots all have real `name`
 *   columns.
 *
 * Security model (defence-in-depth at every untrusted-input boundary):
 *   - parseSortValue NEVER throws — D-16 graceful-fallback contract
 *   - hydrateSortState wraps URL parse + localStorage read in try/catch
 *   - persistGridSort / persistTreeSort silently fall through on quota
 *     exceeded (Pitfall E from 18-RESEARCH.md; matches ThemeToggle precedent)
 *   - All localStorage values are JSON-validated against the same whitelist
 *     used at the URL parse boundary (D-24 + D-16 unified)
 */

import type {
  SortField,
  HierarchySortField,
  SortDirection,
  VersionSort,
  HierarchySort,
} from './sortTypes.js';
import { DEFAULT_VERSION_SORT, DEFAULT_HIERARCHY_SORT } from './sortTypes.js';

// ============================================================================
// Whitelist sets (mirror server enums; constant ReadonlySet for O(1) checks)
// ============================================================================

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

const DIRS: ReadonlySet<SortDirection> = new Set(['asc', 'desc']);

// ============================================================================
// SortOption type + GRID/TREE option arrays (UI-SPEC §"Copywriting Contract")
// ============================================================================

export interface SortOption<F extends string = string> {
  /** Stable id used as localStorage value AND URL query param value. Format: 'field:dir'. */
  id: string;
  /** User-facing label (verbatim per UI-SPEC). Plain text — no HTML. */
  label: string;
  /** Field portion of the id — exposed for type-safe consumers. */
  field: F;
  /** Direction portion of the id. */
  dir: SortDirection;
}

/**
 * GRID_SORT_OPTIONS — DEVIATION 1: 3 entries. 'Name A→Z' DROPPED because the
 * `versions` table has no `name` column. Each id parseable by parseSortValue
 * with VERSION_FIELDS whitelist.
 */
export const GRID_SORT_OPTIONS: ReadonlyArray<SortOption<SortField>> = [
  { id: 'completed_at:desc', label: 'Latest', field: 'completed_at', dir: 'desc' },
  { id: 'completed_at:asc', label: 'Oldest', field: 'completed_at', dir: 'asc' },
  {
    id: 'version_number:desc',
    label: 'Version ↓',
    field: 'version_number',
    dir: 'desc',
  },
];

/**
 * TREE_SORT_OPTIONS — 4 entries verbatim per D-07.
 * Default (first entry) is name:asc — matches DEFAULT_HIERARCHY_SORT.
 */
export const TREE_SORT_OPTIONS: ReadonlyArray<SortOption<HierarchySortField>> = [
  { id: 'name:asc', label: 'A→Z', field: 'name', dir: 'asc' },
  { id: 'name:desc', label: 'Z→A', field: 'name', dir: 'desc' },
  { id: 'created_at:desc', label: 'Newest', field: 'created_at', dir: 'desc' },
  { id: 'created_at:asc', label: 'Oldest', field: 'created_at', dir: 'asc' },
];

// ============================================================================
// parseSortValue / serializeSortValue
// ============================================================================

/**
 * Parse 'field:dir' against the passed-in field whitelist. Returns null on
 * any failure path (NEVER throws). D-16 graceful-fallback contract.
 *
 * Validates structurally: presence of colon, field membership in whitelist,
 * dir membership in {asc, desc}. Non-string inputs (null/undefined) collapse
 * to null without inspection.
 */
export function parseSortValue<F extends string>(
  raw: string | null | undefined,
  fieldWhitelist: ReadonlySet<F>,
): { field: F; dir: SortDirection } | null {
  if (!raw || typeof raw !== 'string') return null;
  const colon = raw.indexOf(':');
  if (colon < 0) return null;
  const field = raw.slice(0, colon);
  const dir = raw.slice(colon + 1);
  if (field.length === 0 || dir.length === 0) return null;
  if (!fieldWhitelist.has(field as F)) return null;
  if (!DIRS.has(dir as SortDirection)) return null;
  return { field: field as F, dir: dir as SortDirection };
}

/**
 * Serialize a {field, dir} tuple to 'field:dir' format suitable for URL
 * query params + localStorage values.
 */
export function serializeSortValue(s: { field: string; dir: SortDirection }): string {
  return `${s.field}:${s.dir}`;
}

// ============================================================================
// localStorage scope keys (D-23 — global per-pane, NOT per-shot)
// ============================================================================

const STORAGE_PREFIX = 'vfx-familiar';
const GRID_SORT_KEY = 'sort:grid';
const TREE_SORT_KEY = 'sort:tree';
const LRU_KEY_SUFFIX = '_lru';
const LRU_MAX_KEYS = 50; // D-25 forward-compat cap

// ============================================================================
// hydrateSortState — pure state machine (URL → localStorage → defaults)
// ============================================================================

/**
 * Read JSON from localStorage and validate against the field whitelist.
 * Returns null on missing / invalid / parse-error / localStorage-unavailable.
 *
 * D-24 invariant: localStorage value shape is JSON `{ field, dir }`; both
 * fields validated against the same whitelist used at the URL boundary.
 * Invalid → null → caller falls back to default + overwrites (Test 11).
 */
function readLocalStorageSort<F extends string>(
  fullKey: string,
  fieldWhitelist: ReadonlySet<F>,
): { field: F; dir: SortDirection } | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(fullKey);
  } catch {
    return null;
  }
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const cast = obj as Partial<{ field: F; dir: SortDirection }>;
  if (typeof cast.field !== 'string' || !fieldWhitelist.has(cast.field as F)) {
    return null;
  }
  if (typeof cast.dir !== 'string' || !DIRS.has(cast.dir as SortDirection)) {
    return null;
  }
  return { field: cast.field as F, dir: cast.dir as SortDirection };
}

/**
 * SORT-03 hydrate: URL wins (D-13), else localStorage (validated), else default.
 *
 * Side-effect rules:
 *   - URL had valid value → leave localStorage alone, no URL write (already explicit).
 *   - URL missing/invalid AND localStorage valid → use localStorage AND
 *     write URL via replaceState (D-15 — URL always shows current sort).
 *   - Both missing/invalid → use default AND write both URL + localStorage.
 *
 * D-13: URL-wins-doesn't-touch-localStorage — sharing a URL with a sort
 * tweak does NOT permanently rewrite the recipient's persistent sort
 * preference; their localStorage stays untouched.
 *
 * D-14: history.replaceState (NOT pushState) — sort is a view setting, not
 * a navigation event; back button must not replay sort toggles.
 *
 * D-15: URL is always explicit — replaceState fills in any missing param so
 * deep-link-back-to-page-with-sort-X always works.
 *
 * Call ONCE on dashboard mount (HomeView useEffect — Plan 18-05 wires this).
 */
export function hydrateSortState(): {
  gridSort: VersionSort;
  treeSort: HierarchySort;
} {
  let urlGrid: VersionSort | null = null;
  let urlTree: HierarchySort | null = null;
  let urlObj: URL | null = null;

  try {
    if (typeof window !== 'undefined' && window.location) {
      urlObj = new URL(window.location.href);
      urlGrid = parseSortValue(
        urlObj.searchParams.get('gridSort'),
        VERSION_FIELDS,
      ) as VersionSort | null;
      urlTree = parseSortValue(
        urlObj.searchParams.get('treeSort'),
        HIERARCHY_FIELDS,
      ) as HierarchySort | null;
    }
  } catch (err) {
    // URL parse failure — fall through to localStorage path. Log for diagnosis.
    if (typeof console !== 'undefined') {
      console.warn(
        'vfx-familiar: hydrateSortState URL parse failed; falling back to localStorage.',
        err,
      );
    }
  }

  const lsGrid = urlGrid
    ? null
    : (readLocalStorageSort<SortField>(
        `${STORAGE_PREFIX}:${GRID_SORT_KEY}`,
        VERSION_FIELDS,
      ) as VersionSort | null);
  const lsTree = urlTree
    ? null
    : (readLocalStorageSort<HierarchySortField>(
        `${STORAGE_PREFIX}:${TREE_SORT_KEY}`,
        HIERARCHY_FIELDS,
      ) as HierarchySort | null);

  const finalGrid: VersionSort = urlGrid ?? lsGrid ?? DEFAULT_VERSION_SORT;
  const finalTree: HierarchySort = urlTree ?? lsTree ?? DEFAULT_HIERARCHY_SORT;

  // Side-effect: ensure URL is explicit (D-15) — write any missing param.
  if (urlObj && typeof history !== 'undefined') {
    let urlChanged = false;
    if (!urlGrid) {
      urlObj.searchParams.set('gridSort', serializeSortValue(finalGrid));
      urlChanged = true;
    }
    if (!urlTree) {
      urlObj.searchParams.set('treeSort', serializeSortValue(finalTree));
      urlChanged = true;
    }
    if (urlChanged) {
      try {
        history.replaceState(null, '', urlObj.toString());
      } catch {
        /* history unavailable / blocked — silent */
      }
    }
  }

  // Side-effect: write defaults to localStorage when no localStorage value
  // existed AND no URL value either (genuine first-time visitor). D-13: URL
  // wins doesn't touch localStorage; rewrite ONLY when LS was missing/invalid.
  if (!urlGrid && !lsGrid) {
    setBoundedLocalStorageEntry(
      STORAGE_PREFIX,
      GRID_SORT_KEY,
      JSON.stringify(finalGrid),
      LRU_MAX_KEYS,
    );
  }
  if (!urlTree && !lsTree) {
    setBoundedLocalStorageEntry(
      STORAGE_PREFIX,
      TREE_SORT_KEY,
      JSON.stringify(finalTree),
      LRU_MAX_KEYS,
    );
  }

  return { gridSort: finalGrid, treeSort: finalTree };
}

// ============================================================================
// persistGridSort / persistTreeSort — write signal + localStorage + URL
// ============================================================================

/**
 * Persist a new grid sort: writes URL via history.replaceState AND
 * localStorage via setBoundedLocalStorageEntry.
 *
 * Called by the parent's onChange handler when the user picks a new option
 * in the SortDropdown. Idempotent: called repeatedly with the same value
 * leaves all three layers consistent.
 *
 * Failure modes (silent fall-through, never throws):
 *   - history.replaceState unavailable / blocked → URL not updated; LS still tries
 *   - localStorage.setItem throws QuotaExceededError → LS not updated; URL still updates
 *   - Both fail → in-session sort still works via the parent's signal/state
 */
export function persistGridSort(next: VersionSort): void {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof history !== 'undefined'
  ) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('gridSort', serializeSortValue(next));
      history.replaceState(null, '', url.toString());
    } catch {
      /* history unavailable / blocked — silent */
    }
  }
  setBoundedLocalStorageEntry(
    STORAGE_PREFIX,
    GRID_SORT_KEY,
    JSON.stringify(next),
    LRU_MAX_KEYS,
  );
}

/**
 * Persist a new tree sort. Symmetric to persistGridSort — see header notes.
 */
export function persistTreeSort(next: HierarchySort): void {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof history !== 'undefined'
  ) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('treeSort', serializeSortValue(next));
      history.replaceState(null, '', url.toString());
    } catch {
      /* history unavailable / blocked — silent */
    }
  }
  setBoundedLocalStorageEntry(
    STORAGE_PREFIX,
    TREE_SORT_KEY,
    JSON.stringify(next),
    LRU_MAX_KEYS,
  );
}

// ============================================================================
// setBoundedLocalStorageEntry — companion-key LRU primitive (D-25)
// ============================================================================

/**
 * Write a value to localStorage under `${prefix}:${key}` with bounded-keys
 * LRU eviction. Companion key `${prefix}:_lru` holds an ordered string[] of
 * keys (most-recent first). When count > maxKeys, evict from the tail.
 *
 * D-25 forward-compat: Phase 19 may add `summary:` keys; v1.3 may add
 * per-shot scope keys. The cap=50 default stops localStorage growth at
 * any single prefix while preserving the most-recently-used N entries.
 *
 * Edge cases (all silent — never throws):
 *   - localStorage unavailable (privacy mode, server-side) → silent no-op
 *   - Quota exceeded mid-write → silent fall-through (Pitfall E)
 *   - Corrupt _lru companion → treated as empty, rebuilt
 *   - Setting the same key repeatedly → moves to front, no duplication
 */
export function setBoundedLocalStorageEntry(
  prefix: string,
  key: string,
  value: string,
  maxKeys: number,
): void {
  if (typeof localStorage === 'undefined') return;
  const lruKey = `${prefix}:${LRU_KEY_SUFFIX}`;
  const fullKey = `${prefix}:${key}`;

  let lruList: string[] = [];
  try {
    const raw = localStorage.getItem(lruKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        lruList = parsed.filter((k): k is string => typeof k === 'string');
      }
    }
  } catch {
    lruList = []; // corrupt or parse error — rebuild from scratch
  }

  // Move/insert key to front (most recent).
  lruList = [key, ...lruList.filter((k) => k !== key)];

  // Evict from tail until at cap.
  while (lruList.length > maxKeys) {
    const evict = lruList.pop()!;
    try {
      localStorage.removeItem(`${prefix}:${evict}`);
    } catch {
      /* removal failed — proceed; the entry may be over-capped but won't grow */
    }
  }

  // Write value FIRST (so quota throw on companion still leaves usable value).
  try {
    localStorage.setItem(fullKey, value);
    localStorage.setItem(lruKey, JSON.stringify(lruList));
  } catch {
    // quota / privacy mode — silent (Pitfall E)
  }
}

// ============================================================================
// compareTreeNodes — client-side tree re-sort comparator (D-discretion)
// ============================================================================

/**
 * Pure comparator for sorting tree nodes (workspaces / projects / sequences /
 * shots). Uses localeCompare for `name` (Unicode-aware string ordering);
 * numeric subtract for `created_at` (epoch-ms integer).
 *
 * Tradeoff vs server SQLite ORDER BY: SQLite default collation (BINARY)
 * may diverge from localeCompare for non-ASCII strings. For typical ASCII
 * project names, results match. Open Question #4 in 18-RESEARCH.md flagged
 * this; researcher recommendation accepted: ship localeCompare; revisit
 * if real divergence surfaces in v1.3.
 *
 * Returns a negative number if a < b, positive if a > b, zero if equal.
 * Suitable for direct use as the comparator in Array.prototype.sort().
 */
export function compareTreeNodes<T extends { name: string; created_at: number }>(
  a: T,
  b: T,
  sort: HierarchySort,
): number {
  let cmp: number;
  if (sort.field === 'name') {
    cmp = a.name.localeCompare(b.name);
  } else {
    /* sort.field === 'created_at' */
    cmp = a.created_at - b.created_at;
  }
  return sort.dir === 'desc' ? -cmp : cmp;
}
