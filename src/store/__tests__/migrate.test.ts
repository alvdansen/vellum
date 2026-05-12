import { describe, it, test, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../db.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';

/**
 * [BLOCKING] schema-push gate for plan 02-01 Task 2 (D-GEN-38).
 * Verifies Drizzle migrations apply against real SQLite DBs and
 * that the __drizzle_migrations ledger is idempotent across reboots.
 */
const EXPECTED_MIGRATIONS = 8; // +0008_shot_status (Phase 20 — STAT-01..05: shots.status column + shot_status_events append-only table + 4 indexes)

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

  test('provenance table created by migration 0003', () => {
    const { sqlite } = openDb(dbPath);
    const row = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provenance'")
      .get();
    expect(row).toBeDefined();
    sqlite.close();
  });

  test('provenance table has all D-PROV-02 columns', () => {
    const { sqlite } = openDb(dbPath);
    const rows = sqlite
      .prepare(`SELECT name FROM pragma_table_info('provenance')`)
      .all() as { name: string }[];
    const names = new Set(rows.map((r) => r.name));
    for (const c of [
      'id',
      'version_id',
      'event_type',
      'workflow_json',
      'prompt_json',
      'seed',
      'models_json',
      'outputs_json',
      'error_code',
      'error_message',
      'timestamp',
    ]) {
      expect(names.has(c), `column ${c} missing from provenance`).toBe(true);
    }
    sqlite.close();
  });

  test('versions.lineage_type column added by migration 0003', () => {
    const { sqlite } = openDb(dbPath);
    const rows = sqlite
      .prepare(`SELECT name, type FROM pragma_table_info('versions')`)
      .all() as { name: string; type: string }[];
    const lineage = rows.find((r) => r.name === 'lineage_type');
    expect(lineage).toBeDefined();
    expect(lineage!.type.toLowerCase()).toBe('text');
    sqlite.close();
  });

  test('idx_provenance_version_time index created by migration 0003', () => {
    const { sqlite } = openDb(dbPath);
    const row = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_provenance_version_time'",
      )
      .get();
    expect(row).toBeDefined();
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

  test('IDM-02: Phase-1-only DB upgrades cleanly when openDb runs the migrator on top', () => {
    // Simulate an "existing Phase 1 DB" by seeding ONLY the Phase 1 bootstrap
    // schema (no Phase 2 columns, no Phase 2 index, no __drizzle_migrations).
    // Then close, reopen via openDb(), and assert the migrator added the
    // Phase 2 columns + index without disturbing the existing data.
    const PHASE_1_ONLY_DDL = `
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        naming_template TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        name TEXT NOT NULL,
        naming_template TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(workspace_id, name)
      );
      CREATE TABLE IF NOT EXISTS sequences (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, name)
      );
      CREATE TABLE IF NOT EXISTS shots (
        id TEXT PRIMARY KEY,
        sequence_id TEXT NOT NULL REFERENCES sequences(id),
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(sequence_id, name)
      );
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY,
        shot_id TEXT NOT NULL REFERENCES shots(id),
        version_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted',
        job_id TEXT,
        parent_version_id TEXT REFERENCES versions(id),
        notes TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        UNIQUE(shot_id, version_number)
      );
      CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_sequences_project ON sequences(project_id);
      CREATE INDEX IF NOT EXISTS idx_shots_sequence ON shots(sequence_id);
      CREATE INDEX IF NOT EXISTS idx_versions_shot ON versions(shot_id, version_number);
    `;
    // Seed a raw better-sqlite3 connection (no migrator!) so we get a truly
    // Phase-1-only state, then close.
    {
      const raw = new Database(dbPath);
      raw.pragma('journal_mode = WAL');
      raw.pragma('foreign_keys = ON');
      raw.exec(PHASE_1_ONLY_DDL);
      raw.pragma('user_version = 1'); // matches Phase 1 bootstrap
      // Seed a row to verify it survives the upgrade.
      raw.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`).run(
        'ws_pre',
        'pre-migration',
        Date.now(),
      );
      raw.close();
    }

    // Reopen via openDb — the migrator should now run and add Phase 2 bits.
    const { sqlite } = openDb(dbPath);

    // Phase 2 columns present on versions?
    const cols = sqlite
      .prepare(`SELECT name FROM pragma_table_info('versions')`)
      .all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    for (const c of ['error_code', 'error_message', 'outputs_json']) {
      expect(colNames).toContain(c);
    }

    // idx_versions_status present?
    const idx = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='versions' AND name='idx_versions_status'`,
      )
      .all();
    expect(idx).toHaveLength(1);

    // __drizzle_migrations present with all expected rows applied?
    const mig = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number };
    expect(mig.n).toBe(EXPECTED_MIGRATIONS);

    // Pre-existing data preserved?
    const preserved = sqlite
      .prepare(`SELECT name FROM workspaces WHERE id = ?`)
      .get('ws_pre') as { name: string } | undefined;
    expect(preserved?.name).toBe('pre-migration');

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

describe('phase 4 migration 0004', () => {
  it('creates tags table with expected columns, PK, and indexes', () => {
    const { sqlite } = makeInMemoryDb();
    const cols = sqlite
      .prepare(`PRAGMA table_info(tags)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
    expect(cols.map((c) => c.name).sort()).toEqual([
      'created_at',
      'id',
      'tag',
      'version_id',
    ]);
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    // SQLite's PRAGMA table_info normalizes type names to upper-case (TEXT/INTEGER)
    // regardless of how the DDL spells them — so compare case-insensitively.
    expect(byName.id.type.toUpperCase()).toBe('TEXT');
    expect(byName.id.pk).toBe(1);
    expect(byName.version_id.type.toUpperCase()).toBe('TEXT');
    expect(byName.version_id.notnull).toBe(1);
    expect(byName.tag.type.toUpperCase()).toBe('TEXT');
    expect(byName.tag.notnull).toBe(1);
    expect(byName.created_at.type.toUpperCase()).toBe('INTEGER');
    expect(byName.created_at.notnull).toBe(1);
  });

  it('creates metadata table with expected columns, PK, and indexes', () => {
    const { sqlite } = makeInMemoryDb();
    const cols = sqlite
      .prepare(`PRAGMA table_info(metadata)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
    expect(cols.map((c) => c.name).sort()).toEqual([
      'created_at',
      'id',
      'key',
      'value',
      'version_id',
    ]);
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(byName.id.pk).toBe(1);
    expect(byName.value.type.toUpperCase()).toBe('TEXT');
    expect(byName.value.notnull).toBe(1);
  });

  it('idx_tags_tag and idx_metadata_key_value are present as explicit indexes', () => {
    const { sqlite } = makeInMemoryDb();
    const idxRows = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('tags','metadata')`,
      )
      .all() as Array<{ name: string }>;
    const names = idxRows.map((r) => r.name);
    expect(names).toContain('idx_tags_tag');
    expect(names).toContain('idx_metadata_key_value');
  });

  it('UNIQUE(version_id, tag) and UNIQUE(version_id, key) autoindexes exist', () => {
    const { sqlite } = makeInMemoryDb();
    // UNIQUE constraints create either `<table>_<cols>_unique` (drizzle-kit style)
    // or `sqlite_autoindex_<table>_N` (raw DDL style) depending on how the SQL
    // was authored. Accept either shape; we just assert at least one such index
    // exists on each table that enforces the composite uniqueness.
    const rows = sqlite
      .prepare(
        `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('tags','metadata')`,
      )
      .all() as Array<{ name: string; tbl_name: string; sql: string | null }>;
    const tagUnique = rows.some(
      (r) =>
        r.tbl_name === 'tags' &&
        (r.name === 'tags_version_id_tag_unique' ||
          r.name.startsWith('sqlite_autoindex_tags')),
    );
    const metaUnique = rows.some(
      (r) =>
        r.tbl_name === 'metadata' &&
        (r.name === 'metadata_version_id_key_unique' ||
          r.name.startsWith('sqlite_autoindex_metadata')),
    );
    expect(tagUnique).toBe(true);
    expect(metaUnique).toBe(true);
  });

  it('tags.version_id and metadata.version_id FK → versions(id)', () => {
    const { sqlite } = makeInMemoryDb();
    const tagFks = sqlite
      .prepare(`PRAGMA foreign_key_list(tags)`)
      .all() as Array<{ table: string; from: string; to: string }>;
    expect(tagFks).toHaveLength(1);
    expect(tagFks[0].table).toBe('versions');
    expect(tagFks[0].from).toBe('version_id');
    expect(tagFks[0].to).toBe('id');

    const metaFks = sqlite
      .prepare(`PRAGMA foreign_key_list(metadata)`)
      .all() as Array<{ table: string; from: string; to: string }>;
    expect(metaFks).toHaveLength(1);
    expect(metaFks[0].table).toBe('versions');
  });
});
