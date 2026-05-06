/**
 * Phase 18 / Plan 18-01 — Whitelist sort enums + Drizzle ORDER BY composers
 * + composite cursor encoding helpers.
 *
 * Architecture-purity invariants (verified by inline grep test in
 * src/store/__tests__/sort.test.ts):
 *   - ZERO MCP-SDK imports
 *   - ZERO native SQLite-driver imports
 *   - ZERO HTTP framework imports
 *   - ZERO filesystem imports
 *   - imports drizzle-orm + ./schema.js only
 *
 * SECURITY notes (Phase 18 RESEARCH §"Security Domain" T-18-01 / T-18-02):
 *   - SortField is a closed string-literal enum; the column reference is
 *     looked up via a Record map; user input never reaches the SQL string.
 *   - SortDirection is a closed enum of two TypeScript literals; the dir
 *     SQL fragment is selected from two pre-built ASC / DESC tagged template
 *     fragments — user input never reaches the SQL string.
 *   - Cursor decode validates structure before returning; decoder NEVER
 *     throws (returns null on any failure path); HTTP layer maps null to
 *     INVALID_INPUT 4xx (Plan 18-03 wires this).
 *   - The unsafe-raw escape hatch from drizzle-orm is NEVER used in this
 *     module (sentinel test locks; see Test 14 for the regex anchor).
 *
 * DEVIATION 1 (D-02 in-progress band sub-sort): Plan 18-01 ships the simpler
 *   `versions.id ASC` tiebreaker for v1.2 per researcher recommendation in
 *   18-RESEARCH.md Open Question #2. Strict CASE-expression refinement
 *   (D-02 verbatim says `created_at DESC`) deferred to v1.3 if user feedback
 *   surfaces. nanoid IDs are time-correlated within a session; the divergence
 *   is invisible for typical workloads (≤ 3 in-progress per shot).
 *
 * DEVIATION 2 (SORT-02 'name' on the version surface): the `versions` table
 *   has no `name` column (verified at src/store/schema.ts:66-102). The engine
 *   accepts the value via VERSION_COL_REF['name'] → versions.id (lexicographic
 *   nanoid). The dashboard's GRID_SORT_OPTIONS (Plan 18-04) does NOT expose
 *   this option; only the tree dropdown's HierarchySortField uses `name`
 *   (projects/sequences/shots all have a real `name` column). Keeping `name`
 *   in the engine SortField enum preserves the SORT-02 whitelist surface
 *   (4 fields × 2 dirs = 8 enum values) without a UI surface.
 */

import { sql, type SQL } from 'drizzle-orm';
import { versions, projects, sequences, shots } from './schema.js';

// ============================================================================
// Type exports — closed enums + sort tuples + cursor shape
// ============================================================================

/** Version-grid sort universe — 4 keys (SORT-02 whitelist). */
export type SortField = 'completed_at' | 'created_at' | 'name' | 'version_number';

/** Tree sort universe — 2 keys (D-07 narrower than version grid). */
export type HierarchySortField = 'name' | 'created_at';

export type SortDirection = 'asc' | 'desc';

export interface VersionSort { field: SortField; dir: SortDirection; }
export interface HierarchySort { field: HierarchySortField; dir: SortDirection; }

/** D-03 cursor shape: NULL-bit, sort_value, version_id tiebreaker. */
export interface VersionCursor {
  /** D-01: completed_at IS NULL — true means row is in the in-progress band. */
  cna: boolean;
  /** Sort value of the trailing row. Type depends on sort.field. */
  sv: number | string | null;
  /** version_id tiebreaker (SORT-05 stable nanoid). */
  vid: string;
}

/** SORT-01 grid default — Latest. */
export const DEFAULT_VERSION_SORT: VersionSort = { field: 'completed_at', dir: 'desc' };

/** SORT-04 tree default — A→Z. */
export const DEFAULT_HIERARCHY_SORT: HierarchySort = { field: 'name', dir: 'asc' };

// ============================================================================
// Whitelist column maps — TypeScript exhaustive coverage guarantees safety
// ============================================================================

/**
 * For the version grid. Returns a SQL fragment that interpolates the column
 * reference (NOT a string), so Drizzle emits the quoted identifier without
 * parameterization. See 18-RESEARCH.md Pitfall J for the danger of the
 * `${col.name}` anti-pattern.
 *
 * DEVIATION: 'name' falls back to versions.id (the table has no `name`
 * column — verified at schema.ts:66-102). The dashboard never exposes this
 * value via GRID_SORT_OPTIONS, so the fallback is unreachable from the UI;
 * documented for engine-test fidelity.
 */
const VERSION_COL_REF: Record<SortField, () => SQL> = {
  completed_at:   () => sql`${versions.completed_at}`,
  created_at:     () => sql`${versions.created_at}`,
  name:           () => sql`${versions.id}`,  // DEVIATION 2 — see header
  version_number: () => sql`${versions.version_number}`,
};

/** Per-table column ref for hierarchy tables. Each table has real `name` and `created_at` columns. */
function hierarchyColRef(
  table: typeof projects | typeof sequences | typeof shots,
  field: HierarchySortField,
): SQL {
  switch (field) {
    case 'name':       return sql`${table.name}`;
    case 'created_at': return sql`${table.created_at}`;
  }
}

// ============================================================================
// Direction SQL fragments — pre-built; selection is a TypeScript literal switch
// ============================================================================

const ASC_FRAGMENT: SQL = sql`ASC`;
const DESC_FRAGMENT: SQL = sql`DESC`;

function dirSql(dir: SortDirection): SQL {
  return dir === 'desc' ? DESC_FRAGMENT : ASC_FRAGMENT;
}

// ============================================================================
// ORDER BY composers
// ============================================================================

/**
 * Build the version-grid composite ORDER BY:
 *   (completed_at IS NULL) DESC,    -- D-01 NULL-bit pin (always first)
 *   <user_col> <dir>,                -- user-selected sort
 *   versions.id ASC                  -- SORT-05 stable tiebreaker (always last)
 *
 * D-05: for `name` and `version_number`, the NULL-bit term is a no-op (those
 * columns are NOT NULL); the term is included for shape consistency so the
 * cursor pagination's WHERE-after-cursor builder can use the same ordering
 * across all four fields.
 */
export function buildVersionOrderBy(sort: VersionSort): SQL {
  const col = VERSION_COL_REF[sort.field]();
  return sql.join(
    [
      sql`(${versions.completed_at} IS NULL) DESC`,
      sql`${col} ${dirSql(sort.dir)}`,
      sql`${versions.id} ASC`,
    ],
    sql`, `,
  );
}

/**
 * Build the hierarchy ORDER BY:
 *   <col> <dir>, <table>.id ASC    -- RT-03 deterministic tiebreaker
 */
export function buildHierarchyOrderBy(
  table: typeof projects | typeof sequences | typeof shots,
  sort: HierarchySort,
): SQL {
  const col = hierarchyColRef(table, sort.field);
  return sql.join(
    [
      sql`${col} ${dirSql(sort.dir)}`,
      sql`${table.id} ASC`,
    ],
    sql`, `,
  );
}

// ============================================================================
// Cursor encode / decode (base64url-encoded JSON; opaque to dashboard)
// ============================================================================

export function encodeVersionCursor(c: VersionCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/**
 * Decode + structurally validate. Returns null on ANY failure path —
 * never throws. The HTTP layer (Plan 18-03) maps null to INVALID_INPUT 4xx.
 *
 * Validation:
 *   - JSON parses successfully
 *   - top-level is an object
 *   - cna is boolean
 *   - vid is a non-empty string
 *   - sv is null OR number OR string (matches SortField column types)
 */
export function decodeVersionCursor(s: string): VersionCursor | null {
  try {
    if (typeof s !== 'string' || s.length === 0) return null;
    const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof obj !== 'object' || obj === null) return null;
    if (typeof obj.cna !== 'boolean') return null;
    if (typeof obj.vid !== 'string' || obj.vid.length === 0) return null;
    if (obj.sv !== null && typeof obj.sv !== 'number' && typeof obj.sv !== 'string') return null;
    return { cna: obj.cna, sv: obj.sv, vid: obj.vid };
  } catch {
    return null;
  }
}

// ============================================================================
// WHERE-after-cursor — three-OR-branch lexicographic comparison
// ============================================================================

/**
 * For ORDER BY (NULL_BIT DESC, sort_value <dir>, id ASC) and a cursor
 * encoding the trailing row's three values, build the predicate that
 * selects rows AFTER the cursor in the composite order.
 *
 * Branches:
 *   1. (IS NULL) < cursor.cna_int       -- band advance (NULL → not-NULL)
 *   2. (IS NULL) = cursor.cna_int AND col <op> cursor.sv  -- same band, sort advance
 *   3. (IS NULL) = cursor.cna_int AND col EQ_PREDICATE AND id > cursor.vid  -- same band+value, tiebreaker
 *
 * <op> is `<` for DESC, `>` for ASC (sortOp inversion). Tiebreaker `>` is
 * always ASC (id ASC tiebreaker is invariant per SORT-05).
 *
 * NULL handling (Plan 18-02 Rule 1 fix): when cursor.sv === null the cursor
 * sits on a row whose sort column is NULL (only possible inside the in-progress
 * band when sort.field === 'completed_at'). SQLite three-valued logic makes
 * `col <op> NULL` and `col = NULL` always unknown, which would silently drop
 * all remaining same-band rows from the cursor walk (skip-bug). Instead:
 *   - Branch 2 collapses to FALSE (no row can be strictly less/greater than
 *     a null sort value — the only meaningful continuation inside the
 *     null-sv same band is via the tiebreaker).
 *   - Branch 3 substitutes `col IS NULL` for `col = cursor.sv` so same-band
 *     rows whose sort value is also null are still reachable via the
 *     versions.id ASC tiebreaker.
 *
 * DEVIATION: when cursor.cna === true (cursor inside in-progress band),
 * the simpler v1.2 implementation uses the same `versions.id ASC` tiebreaker
 * as the completed band (matches DEVIATION 1 in the file header). Strict
 * D-02 fidelity (CASE-expression sub-sort by created_at DESC) deferred to v1.3.
 */
export function buildAfterCursorWhere(
  sort: VersionSort,
  cursor: VersionCursor,
): SQL {
  const col = VERSION_COL_REF[sort.field]();
  const sortOp = sort.dir === 'desc' ? sql`<` : sql`>`;
  const cnaInt = cursor.cna ? sql`1` : sql`0`;
  // sql`FALSE` collapses branch 2 in the null-sv case so the OR chain is
  // structurally identical (same number of branches) regardless of sv shape;
  // SQLite optimises the constant FALSE branch out of the plan.
  const sortAdvance = cursor.sv === null
    ? sql`FALSE`
    : sql`${col} ${sortOp} ${cursor.sv}`;
  const tieEq = cursor.sv === null
    ? sql`${col} IS NULL`
    : sql`${col} = ${cursor.sv}`;
  return sql`(
    ((${versions.completed_at} IS NULL) < ${cnaInt})
    OR ((${versions.completed_at} IS NULL) = ${cnaInt}
        AND ${sortAdvance})
    OR ((${versions.completed_at} IS NULL) = ${cnaInt}
        AND ${tieEq}
        AND ${versions.id} > ${cursor.vid})
  )`;
}

// ============================================================================
// readSortValue — pure helper for cursor encoding from the trailing row
// ============================================================================

/**
 * Minimal structural row shape needed for cursor encoding. Inlined locally
 * to avoid a circular import on Version (../types/hierarchy.js → version-repo.ts
 * → here). Concrete Version objects passed by callers satisfy this shape via
 * TypeScript structural subtyping.
 */
interface VersionLike {
  id: string;
  completed_at: number | null;
  created_at: number;
  version_number: number;
}

/**
 * Extracts the cursor's sort_value field from a Version row given the
 * sort field. Used by Plan 18-02's listByShot to encode next_cursor from
 * the last row of a page.
 */
export function readSortValue(row: VersionLike, field: SortField): number | string | null {
  switch (field) {
    case 'completed_at':   return row.completed_at;
    case 'created_at':     return row.created_at;
    case 'version_number': return row.version_number;
    case 'name':           return row.id;  // DEVIATION 2 — see header
  }
}
