import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, SCHEMA_VERSION } from '../db.js';

/**
 * Each test uses a unique temp file so leftovers from one test never affect another.
 * Cleanup removes the .db file plus .db-wal and .db-shm side-cars.
 */
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

describe('openDb — pragma-first init sequence', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = uniqueDbPath('pragma');
  });
  afterEach(() => {
    cleanup(dbPath);
  });

  test('WAL mode active after openDb', () => {
    const { sqlite } = openDb(dbPath);
    const mode = sqlite.pragma('journal_mode', { simple: true }) as string;
    expect(String(mode).toLowerCase()).toBe('wal');
    sqlite.close();
  });

  test('busy_timeout set to 5000', () => {
    const { sqlite } = openDb(dbPath);
    const timeout = sqlite.pragma('busy_timeout', { simple: true }) as number;
    expect(timeout).toBe(5000);
    sqlite.close();
  });

  test('foreign_keys ON', () => {
    const { sqlite } = openDb(dbPath);
    const fk = sqlite.pragma('foreign_keys', { simple: true }) as number;
    expect(fk).toBe(1);
    sqlite.close();
  });

  test('user_version set to 1 on fresh db', () => {
    const { sqlite } = openDb(dbPath);
    const ver = sqlite.pragma('user_version', { simple: true }) as number;
    expect(ver).toBe(SCHEMA_VERSION);
    expect(ver).toBe(1);
    sqlite.close();
  });

  test('user_version mismatch throws on re-open', () => {
    // First open stamps user_version=1.
    const first = openDb(dbPath);
    first.sqlite.pragma('user_version = 99');
    first.sqlite.close();

    // Second open should throw because 99 !== SCHEMA_VERSION.
    expect(() => openDb(dbPath)).toThrow(/expects/);
  });

  test('schema tables present after first run', () => {
    const { sqlite } = openDb(dbPath);
    const rows = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[];
    const tableNames = rows.map((r) => r.name);
    for (const expected of ['workspaces', 'projects', 'sequences', 'shots', 'versions']) {
      expect(tableNames).toContain(expected);
    }
    sqlite.close();
  });

  test('non-UNIQUE indexes present after first run (DM-03: redundant FK indexes dropped)', () => {
    const { sqlite } = openDb(dbPath);
    const rows = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`)
      .all() as { name: string }[];
    const idxNames = rows.map((r) => r.name);
    // Only idx_versions_status remains — the FK-leading-column indexes were
    // redundant with SQLite's UNIQUE autoindexes per DM-03.
    expect(idxNames).toContain('idx_versions_status');
    // On a fresh install the dropped indexes must NOT be created.
    expect(idxNames).not.toContain('idx_projects_workspace');
    expect(idxNames).not.toContain('idx_sequences_project');
    expect(idxNames).not.toContain('idx_shots_sequence');
    expect(idxNames).not.toContain('idx_versions_shot');
    sqlite.close();
  });

  test('second open on existing db does not re-exec DDL and keeps schema version', () => {
    const first = openDb(dbPath);
    first.sqlite.close();

    // Second open with matching SCHEMA_VERSION should succeed silently.
    const second = openDb(dbPath);
    const ver = second.sqlite.pragma('user_version', { simple: true }) as number;
    expect(ver).toBe(SCHEMA_VERSION);
    second.sqlite.close();
  });
});
