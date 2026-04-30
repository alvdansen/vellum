import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDb } from '../db.js';
import { runMigrations } from '../migrate.js';

/**
 * Phase 10 (DEMO-01) — ROADMAP success criterion #4:
 * Running the server against a clean (already-current) DB is a no-op
 * on the migration path. No spurious migration apply, no WAL lock
 * contention, no MIGRATION_PENDING.
 *
 * This test is the regression guard. It complements the stale-DB
 * failure-path test in Plan 10-03.
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

const EXPECTED_MIGRATIONS = 4; // 0001..0004 — same constant as migrate.test.ts

describe('Phase 10 — clean-DB migration no-op (DEMO-01, ROADMAP #4)', () => {
  let dbPath: string;
  beforeEach(() => { dbPath = uniqueDbPath('migrate-no-op'); });
  afterEach(() => { cleanup(dbPath); });

  it('first open against a fresh DB applies all migrations and does not throw', () => {
    expect(() => {
      const { sqlite } = openDb(dbPath);
      sqlite.close();
    }).not.toThrow();
  });

  it('second open against an already-current DB is a no-op: runMigrations returns { applied: 0, skipped: true }', () => {
    // First open seeds the DB and applies all migrations.
    const first = openDb(dbPath);
    first.sqlite.close();

    // Reopen and call runMigrations directly to inspect the result.
    const second = openDb(dbPath);
    try {
      const result = runMigrations(second.db);
      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(true);
    } finally {
      second.sqlite.close();
    }
  });

  it('no spurious migration apply on second open — __drizzle_migrations row count stays at 4', () => {
    // First open.
    const first = openDb(dbPath);
    first.sqlite.close();

    // Second open. After this, __drizzle_migrations must still hold exactly 4 rows.
    const second = openDb(dbPath);
    const row = second.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number };
    expect(row.n).toBe(EXPECTED_MIGRATIONS);
    second.sqlite.close();
  });

  it('no WAL lock contention between two sequential opens (busy_timeout never fires)', () => {
    // The WAL lock release happens in better-sqlite3 sqlite.close().
    // If the close-before-throw path were broken (Plan 10-02 Task 1)
    // OR if runMigrations failed to release a write lock, this second
    // open would block for busy_timeout=5000ms before erroring.
    // We measure wall-time as a sanity check — well under 1s on a clean DB.
    const start = Date.now();
    const first = openDb(dbPath);
    first.sqlite.close();
    const second = openDb(dbPath);
    second.sqlite.close();
    const elapsed = Date.now() - start;
    // Generous bound — typical < 100ms; failure mode is multi-second.
    expect(elapsed).toBeLessThan(2000);
  });
});
