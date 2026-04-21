import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDb } from '../db.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';

/**
 * [BLOCKING] schema-push gate for plan 02-01 Task 2 (D-GEN-38).
 * Verifies Drizzle migrations apply against real SQLite DBs and
 * that the __drizzle_migrations ledger is idempotent across reboots.
 */
const EXPECTED_MIGRATIONS = 2; // 0001_phase2_version_lifecycle, 0002_idx_versions_status

function uniqueDbPath(label: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `vfx-familiar-${label}-${rand}.db`);
}

function cleanup(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* ignore missing files */
    }
  }
}

describe('Drizzle migration 0001 (D-GEN-38, [BLOCKING] schema push)', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = uniqueDbPath('migrate');
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  test('versions table has error_code, error_message, outputs_json after openDb', () => {
    const { sqlite } = openDb(dbPath);
    const rows = sqlite
      .prepare(`SELECT name, type, "notnull" FROM pragma_table_info('versions')`)
      .all() as { name: string; type: string; notnull: number }[];
    const cols = new Map(rows.map((r) => [r.name, r]));
    for (const c of ['error_code', 'error_message', 'outputs_json']) {
      expect(cols.get(c), `column ${c} missing`).toBeDefined();
      expect(cols.get(c)!.type.toUpperCase()).toBe('TEXT');
      expect(cols.get(c)!.notnull).toBe(0);
    }
    sqlite.close();
  });

  test('__drizzle_migrations table exists after openDb', () => {
    const { sqlite } = openDb(dbPath);
    const rows = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
      )
      .all() as { name: string }[];
    expect(rows.length).toBe(1);
    sqlite.close();
  });

  test(`__drizzle_migrations has exactly ${EXPECTED_MIGRATIONS} rows after first openDb`, () => {
    const { sqlite } = openDb(dbPath);
    const row = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number };
    expect(row.n).toBe(EXPECTED_MIGRATIONS);
    sqlite.close();
  });

  test(`second openDb is idempotent (still exactly ${EXPECTED_MIGRATIONS} rows in __drizzle_migrations)`, () => {
    openDb(dbPath).sqlite.close();
    const { sqlite } = openDb(dbPath);
    const row = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number };
    expect(row.n).toBe(EXPECTED_MIGRATIONS);
    sqlite.close();
  });

  test('idx_versions_status exists (migration 0002)', () => {
    const { sqlite } = openDb(dbPath);
    const rows = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='versions' AND name='idx_versions_status'`,
      )
      .all() as { name: string }[];
    expect(rows.length).toBe(1);
    sqlite.close();
  });

  test('makeInMemoryDb picks up Phase 2 columns via migrate()', () => {
    const { sqlite } = makeInMemoryDb();
    const rows = sqlite
      .prepare(`SELECT name FROM pragma_table_info('versions')`)
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['error_code', 'error_message', 'outputs_json']),
    );
    sqlite.close();
  });

  test('INSERT with new columns succeeds', () => {
    const { sqlite } = openDb(dbPath);
    // Seed shot chain via raw SQL (avoid hierarchy-repo import from a migration test)
    sqlite
      .prepare(`INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`)
      .run('ws_1', 'w', Date.now());
    sqlite
      .prepare(`INSERT INTO projects (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)`)
      .run('proj_1', 'ws_1', 'p', Date.now());
    sqlite
      .prepare(`INSERT INTO sequences (id, project_id, name, created_at) VALUES (?, ?, ?, ?)`)
      .run('seq_1', 'proj_1', 'sq010', Date.now());
    sqlite
      .prepare(`INSERT INTO shots (id, sequence_id, name, created_at) VALUES (?, ?, ?, ?)`)
      .run('shot_1', 'seq_1', 'sh010', Date.now());
    // Insert a version row using the NEW columns — proves they exist and are writable.
    const stmt = sqlite.prepare(`
      INSERT INTO versions
        (id, shot_id, version_number, status, job_id, parent_version_id, notes, created_at, completed_at, error_code, error_message, outputs_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    expect(() =>
      stmt.run(
        'ver_1',
        'shot_1',
        1,
        'failed',
        null,
        null,
        null,
        Date.now(),
        Date.now(),
        'COMFYUI_API_ERROR',
        'test',
        '[]',
      ),
    ).not.toThrow();
    sqlite.close();
  });
});
