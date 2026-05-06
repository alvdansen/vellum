import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';

import {
  type SortField,
  type HierarchySortField,
  type SortDirection,
  type VersionSort,
  type HierarchySort,
  type VersionCursor,
  DEFAULT_VERSION_SORT,
  DEFAULT_HIERARCHY_SORT,
  buildVersionOrderBy,
  buildHierarchyOrderBy,
  encodeVersionCursor,
  decodeVersionCursor,
  buildAfterCursorWhere,
  readSortValue,
} from '../sort.js';
import { versions, projects, sequences, shots } from '../schema.js';
import type { Version } from '../../types/hierarchy.js';

/**
 * Plan 18-01 — src/store/sort.ts foundations.
 *
 * Tests are pure (no DB writes); SQL fragments are inspected via Drizzle's
 * `db.select(...).orderBy(...).toSQL()` shape — see Test 2 setup. The DB is
 * never queried; we only need the rendered SQL string from the query builder.
 */

const sqlite = new Database(':memory:');
const db = drizzle(sqlite);

function renderOrderBy(orderBy: ReturnType<typeof buildVersionOrderBy>): string {
  return db.select().from(versions).orderBy(orderBy).toSQL().sql;
}

function renderHierarchyOrderBy(
  table: typeof projects | typeof sequences | typeof shots,
  orderBy: ReturnType<typeof buildHierarchyOrderBy>,
): string {
  // Use a generic builder against the supplied table so column references
  // resolve correctly against the table alias chosen by Drizzle.
  return db.select().from(table).orderBy(orderBy).toSQL().sql;
}

function renderWhere(where: ReturnType<typeof buildAfterCursorWhere>): string {
  return db.select().from(versions).where(where).toSQL().sql;
}

describe('Plan 18-01 — src/store/sort.ts', () => {
  describe('Test 1 — closed enums + defaults', () => {
    it('exports SortField, HierarchySortField, SortDirection types and the two default sort tuples', () => {
      // Type-level: we cannot read TS types at runtime, but we can verify the
      // default-sort runtime constants match the locked shapes.
      expect(DEFAULT_VERSION_SORT).toEqual({ field: 'completed_at', dir: 'desc' });
      expect(DEFAULT_HIERARCHY_SORT).toEqual({ field: 'name', dir: 'asc' });

      // Smoke-test the type names compile by using them in annotations.
      const sf: SortField = 'completed_at';
      const hsf: HierarchySortField = 'name';
      const dir: SortDirection = 'asc';
      const vs: VersionSort = { field: sf, dir };
      const hs: HierarchySort = { field: hsf, dir };
      expect(vs.dir).toBe('asc');
      expect(hs.dir).toBe('asc');
    });
  });

  describe('Test 2 — buildVersionOrderBy emits three composite terms', () => {
    it('emits NULL-bit pin + user column + tiebreaker for completed_at DESC', () => {
      const orderBy = buildVersionOrderBy({ field: 'completed_at', dir: 'desc' });
      const rendered = renderOrderBy(orderBy);
      // Three terms separated by ', ': (col IS NULL) DESC, col DESC, id ASC.
      expect(rendered).toMatch(/order\s+by/i);
      expect(rendered).toMatch(/\(\s*"completed_at"\s+is\s+null\s*\)\s+desc/i);
      expect(rendered).toMatch(/"completed_at"\s+desc/i);
      expect(rendered).toMatch(/"id"\s+asc\s*$/i);
    });
  });

  describe('Test 3 — NULL-bit pin is ALWAYS the first term', () => {
    const fields: SortField[] = ['completed_at', 'created_at', 'name', 'version_number'];
    const dirs: SortDirection[] = ['asc', 'desc'];

    for (const field of fields) {
      for (const dir of dirs) {
        it(`(${field}, ${dir}): first term is "(completed_at IS NULL) DESC"`, () => {
          const orderBy = buildVersionOrderBy({ field, dir });
          const rendered = renderOrderBy(orderBy);
          // After "order by " the FIRST element must be the NULL-bit term.
          const m = rendered.match(/order\s+by\s+(.+)$/i);
          expect(m).not.toBeNull();
          const orderClause = m![1].trim();
          // Split on top-level commas — Drizzle joins the three sql`` fragments
          // with `, ` so a simple split is sufficient (no nested parens at the
          // top level besides the IS NULL wrap).
          const firstTerm = orderClause.split(/,(?![^()]*\))/)[0].trim();
          expect(firstTerm).toMatch(/\(\s*"completed_at"\s+is\s+null\s*\)\s+desc/i);
        });
      }
    }
  });

  describe('Test 4 — versions.id ASC tiebreaker is ALWAYS the last term', () => {
    const fields: SortField[] = ['completed_at', 'created_at', 'name', 'version_number'];
    const dirs: SortDirection[] = ['asc', 'desc'];

    for (const field of fields) {
      for (const dir of dirs) {
        it(`(${field}, ${dir}): last term is "<table>.id ASC"`, () => {
          const orderBy = buildVersionOrderBy({ field, dir });
          const rendered = renderOrderBy(orderBy);
          // The rendered SQL ends with `"id" asc` (Drizzle escapes column refs
          // in double-quotes; table-qualified or bare both end with "id" asc).
          expect(rendered).toMatch(/"id"\s+asc\s*$/i);
        });
      }
    }
  });

  describe('Test 5 — buildHierarchyOrderBy: two-term shape per table', () => {
    const tables: Array<{ name: string; ref: typeof projects | typeof sequences | typeof shots }> = [
      { name: 'projects', ref: projects },
      { name: 'sequences', ref: sequences },
      { name: 'shots', ref: shots },
    ];

    for (const t of tables) {
      it(`${t.name}: { field: 'name', dir: 'asc' } → "name" asc, "id" asc`, () => {
        const orderBy = buildHierarchyOrderBy(t.ref, { field: 'name', dir: 'asc' });
        const rendered = renderHierarchyOrderBy(t.ref, orderBy);
        expect(rendered).toMatch(/"name"\s+asc/i);
        expect(rendered).toMatch(/"id"\s+asc\s*$/i);
        // No NULL-bit term in the hierarchy order by.
        expect(rendered).not.toMatch(/is\s+null/i);
      });

      it(`${t.name}: { field: 'created_at', dir: 'desc' } → "created_at" desc, "id" asc`, () => {
        const orderBy = buildHierarchyOrderBy(t.ref, { field: 'created_at', dir: 'desc' });
        const rendered = renderHierarchyOrderBy(t.ref, orderBy);
        expect(rendered).toMatch(/"created_at"\s+desc/i);
        expect(rendered).toMatch(/"id"\s+asc\s*$/i);
      });
    }
  });

  describe('Test 6 — cursor encode/decode round-trip (numeric sv)', () => {
    it('encodes + decodes byte-identically for a typical completed-band cursor', () => {
      const cursor: VersionCursor = { cna: false, sv: 1735689600000, vid: 'ver_abc123' };
      const encoded = encodeVersionCursor(cursor);
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);
      const decoded = decodeVersionCursor(encoded);
      expect(decoded).toEqual(cursor);
    });
  });

  describe('Test 7 — cursor encode/decode round-trip (NULL sv, in-progress band)', () => {
    it('preserves sv === null after round-trip', () => {
      const cursor: VersionCursor = { cna: true, sv: null, vid: 'ver_xyz789' };
      const encoded = encodeVersionCursor(cursor);
      const decoded = decodeVersionCursor(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.sv).toBeNull();
      expect(decoded!.cna).toBe(true);
      expect(decoded!.vid).toBe('ver_xyz789');
    });

    it('preserves a string sv (e.g. for the name fallback)', () => {
      const cursor: VersionCursor = { cna: false, sv: 'ver_lex_123', vid: 'ver_abc' };
      const decoded = decodeVersionCursor(encodeVersionCursor(cursor));
      expect(decoded).toEqual(cursor);
    });
  });

  describe('Test 8 — decodeVersionCursor returns null on garbage (NEVER throws)', () => {
    it('rejects malformed base64', () => {
      expect(() => decodeVersionCursor('not-base64!')).not.toThrow();
      expect(decodeVersionCursor('not-base64!')).toBeNull();
    });

    it('rejects empty string', () => {
      expect(decodeVersionCursor('')).toBeNull();
    });

    it('rejects valid base64 of non-JSON content (parse failure)', () => {
      // 'aGVsbG8=' is base64 for 'hello' — JSON.parse throws.
      expect(decodeVersionCursor('aGVsbG8=')).toBeNull();
    });

    it('rejects valid JSON with wrong structure (cna missing)', () => {
      const bad = Buffer.from(JSON.stringify({ wrongShape: true }), 'utf8').toString('base64url');
      expect(decodeVersionCursor(bad)).toBeNull();
    });

    it('rejects when cna is not boolean', () => {
      const bad = Buffer.from(JSON.stringify({ cna: 'true', sv: null, vid: 'v' }), 'utf8').toString('base64url');
      expect(decodeVersionCursor(bad)).toBeNull();
    });

    it('rejects when vid is empty string', () => {
      const bad = Buffer.from(JSON.stringify({ cna: false, sv: 1, vid: '' }), 'utf8').toString('base64url');
      expect(decodeVersionCursor(bad)).toBeNull();
    });

    it('rejects when sv is an unsupported type (object/array/boolean)', () => {
      const badObj = Buffer.from(JSON.stringify({ cna: false, sv: {}, vid: 'v' }), 'utf8').toString('base64url');
      const badArr = Buffer.from(JSON.stringify({ cna: false, sv: [1, 2], vid: 'v' }), 'utf8').toString('base64url');
      const badBool = Buffer.from(JSON.stringify({ cna: false, sv: true, vid: 'v' }), 'utf8').toString('base64url');
      expect(decodeVersionCursor(badObj)).toBeNull();
      expect(decodeVersionCursor(badArr)).toBeNull();
      expect(decodeVersionCursor(badBool)).toBeNull();
    });

    it('rejects null payload', () => {
      const bad = Buffer.from(JSON.stringify(null), 'utf8').toString('base64url');
      expect(decodeVersionCursor(bad)).toBeNull();
    });
  });

  describe('Test 9 — base64url URL safety (no +, /, =)', () => {
    it('100 randomly generated cursors all encode to URL-safe base64url', () => {
      for (let i = 0; i < 100; i++) {
        const cna = Math.random() < 0.5;
        const sv = i % 3 === 0 ? null : i % 3 === 1 ? Math.floor(Math.random() * 1e15) : `ver_${Math.random().toString(36).slice(2)}`;
        const vid = `ver_${Math.random().toString(36).slice(2)}`;
        const encoded = encodeVersionCursor({ cna, sv, vid });
        expect(/[+/=]/.test(encoded)).toBe(false);
      }
    });
  });

  describe('Test 10 — buildAfterCursorWhere DESC structure', () => {
    it('emits three OR branches for completed_at DESC, with `<` operator on branch 2 and `>` on tiebreaker', () => {
      const cursor: VersionCursor = { cna: false, sv: 1700000000000, vid: 'ver_xyz' };
      const where = buildAfterCursorWhere({ field: 'completed_at', dir: 'desc' }, cursor);
      const rendered = renderWhere(where);
      // Branch 1: (col IS NULL) < cna_int (band advance)
      expect(rendered).toMatch(/\(\s*"completed_at"\s+is\s+null\s*\)\s*<\s*0/i);
      // Branch 2: same band, sort advance with `<` (DESC)
      expect(rendered).toMatch(/\(\s*"completed_at"\s+is\s+null\s*\)\s*=\s*0/i);
      expect(rendered).toMatch(/"completed_at"\s*<\s*\?/i);
      // Branch 3: tiebreaker is always > (ASC tiebreaker)
      expect(rendered).toMatch(/"id"\s*>\s*\?/i);
      // OR-joined
      expect(rendered.toLowerCase()).toContain(' or ');
    });
  });

  describe('Test 11 — buildAfterCursorWhere ASC structure', () => {
    it('emits `>` for branch 2 (sortOp inversion) but `>` still for tiebreaker', () => {
      const cursor: VersionCursor = { cna: false, sv: 1700000000000, vid: 'ver_xyz' };
      const where = buildAfterCursorWhere({ field: 'completed_at', dir: 'asc' }, cursor);
      const rendered = renderWhere(where);
      // Branch 2 uses > now
      expect(rendered).toMatch(/"completed_at"\s*>\s*\?/i);
      // Tiebreaker stays >
      expect(rendered).toMatch(/"id"\s*>\s*\?/i);
      // No < operator on the user column anywhere
      expect(rendered).not.toMatch(/"completed_at"\s*<\s*\?/i);
    });

    it('encodes cna === true as 1 in the SQL fragment', () => {
      const cursor: VersionCursor = { cna: true, sv: null, vid: 'ver_in_progress' };
      const where = buildAfterCursorWhere({ field: 'completed_at', dir: 'desc' }, cursor);
      const rendered = renderWhere(where);
      expect(rendered).toMatch(/\(\s*"completed_at"\s+is\s+null\s*\)\s*<\s*1/i);
      expect(rendered).toMatch(/\(\s*"completed_at"\s+is\s+null\s*\)\s*=\s*1/i);
    });
  });

  describe('Test 12 — readSortValue switch coverage', () => {
    const row: Version = {
      id: 'ver_lex_id',
      shot_id: 'shot_a',
      version_number: 7,
      status: 'completed',
      job_id: null,
      parent_version_id: null,
      notes: null,
      created_at: 1700000000000,
      completed_at: 1700000060000,
      error_code: null,
      error_message: null,
      outputs_json: null,
      lineage_type: null,
      reproduction_warnings_json: null,
    };

    it('returns row.completed_at for completed_at field', () => {
      expect(readSortValue(row, 'completed_at')).toBe(1700000060000);
    });

    it('returns row.created_at for created_at field', () => {
      expect(readSortValue(row, 'created_at')).toBe(1700000000000);
    });

    it('returns row.version_number for version_number field', () => {
      expect(readSortValue(row, 'version_number')).toBe(7);
    });

    it('returns row.id for the name field (DEVIATION fallback — versions has no name column)', () => {
      expect(readSortValue(row, 'name')).toBe('ver_lex_id');
    });

    it('preserves null when completed_at is null (in-progress row)', () => {
      const inprog: Version = { ...row, completed_at: null };
      expect(readSortValue(inprog, 'completed_at')).toBeNull();
    });
  });

  describe('Test 13 — architecture-purity inline grep', () => {
    it('src/store/sort.ts has zero forbidden imports', async () => {
      const src = await readFile('src/store/sort.ts', 'utf8');
      // No MCP SDK
      expect(src).not.toMatch(/@modelcontextprotocol/);
      // No native binding
      expect(src).not.toMatch(/from\s+['"]better-sqlite3['"]/);
      // No HTTP layer
      expect(src).not.toMatch(/from\s+['"]hono['"]/);
      expect(src).not.toMatch(/from\s+['"]@hono\/node-server['"]/);
      // No filesystem
      expect(src).not.toMatch(/from\s+['"]node:fs['"]/);
    });
  });

  describe('Test 14 — sql template defended (sentinel: never use sql.raw on user input)', () => {
    it('module source contains zero sql.raw() calls (T-18-01 mitigation)', async () => {
      const src = await readFile('src/store/sort.ts', 'utf8');
      expect(src).not.toMatch(/sql\.raw\s*\(/);
    });
  });
});

// Suppress implicit-any sql import unused warning when tests don't reference it directly.
void sql;
