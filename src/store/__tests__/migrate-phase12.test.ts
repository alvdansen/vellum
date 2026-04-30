import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDb } from '../db.js';

/**
 * Phase 12 — DEMO-03 (D-CTX-5). Asserts the new
 * versions.reproduction_warnings_json column is created at boot via the
 * 0005_phase12_reproduction_warnings.sql Drizzle migration, with the
 * expected TEXT NULLABLE shape, and that legacy rows (no value supplied
 * at INSERT) round-trip as NULL.
 *
 * Companion to migrate-no-op.test.ts (EXPECTED_MIGRATIONS bumped to 5).
 */

function uniqueDbPath(label: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `vfx-familiar-${label}-${rand}.db`);
}
function cleanup(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

describe('Phase 12 — reproduction_warnings_json column (DEMO-03)', () => {
  let dbPath: string;
  beforeEach(() => { dbPath = uniqueDbPath('migrate-phase12'); });
  afterEach(() => { cleanup(dbPath); });

  it('versions table exposes a reproduction_warnings_json TEXT NULL column', () => {
    const { sqlite } = openDb(dbPath);
    try {
      const cols = sqlite.prepare(`PRAGMA table_info(versions)`).all() as Array<{
        name: string; type: string; notnull: number; dflt_value: unknown;
      }>;
      const col = cols.find((c) => c.name === 'reproduction_warnings_json');
      expect(col).toBeDefined();
      expect(col!.type.toUpperCase()).toBe('TEXT');
      expect(col!.notnull).toBe(0);
      expect(col!.dflt_value).toBeNull();
    } finally { sqlite.close(); }
  });

  it('round-trips a JSON-encoded string[] through the new column', () => {
    const { sqlite } = openDb(dbPath);
    try {
      // Minimum hierarchy needed for a versions row.
      sqlite.exec(`
        INSERT INTO workspaces (id, name, created_at) VALUES ('ws_t', 'WS', 0);
        INSERT INTO projects (id, workspace_id, name, created_at) VALUES ('proj_t', 'ws_t', 'P', 0);
        INSERT INTO sequences (id, project_id, name, created_at) VALUES ('seq_t', 'proj_t', 'S', 0);
        INSERT INTO shots (id, sequence_id, name, created_at) VALUES ('shot_t', 'seq_t', 'sh010', 0);
      `);
      sqlite.prepare(
        `INSERT INTO versions (id, shot_id, version_number, status, created_at, reproduction_warnings_json) VALUES (?, ?, ?, ?, ?, ?)`
      ).run('ver_t', 'shot_t', 1, 'completed', 0, JSON.stringify(['w1', 'w2']));
      const row = sqlite.prepare(
        `SELECT reproduction_warnings_json FROM versions WHERE id = ?`
      ).get('ver_t') as { reproduction_warnings_json: string };
      expect(JSON.parse(row.reproduction_warnings_json)).toEqual(['w1', 'w2']);
    } finally { sqlite.close(); }
  });

  it('NULL on a row where the column is unset (legacy semantics)', () => {
    const { sqlite } = openDb(dbPath);
    try {
      sqlite.exec(`
        INSERT INTO workspaces (id, name, created_at) VALUES ('ws_t', 'WS', 0);
        INSERT INTO projects (id, workspace_id, name, created_at) VALUES ('proj_t', 'ws_t', 'P', 0);
        INSERT INTO sequences (id, project_id, name, created_at) VALUES ('seq_t', 'proj_t', 'S', 0);
        INSERT INTO shots (id, sequence_id, name, created_at) VALUES ('shot_t', 'seq_t', 'sh010', 0);
      `);
      sqlite.prepare(
        `INSERT INTO versions (id, shot_id, version_number, status, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run('ver_t', 'shot_t', 1, 'completed', 0);
      const row = sqlite.prepare(
        `SELECT reproduction_warnings_json FROM versions WHERE id = ?`
      ).get('ver_t') as { reproduction_warnings_json: string | null };
      expect(row.reproduction_warnings_json).toBeNull();
    } finally { sqlite.close(); }
  });
});
