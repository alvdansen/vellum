import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { unlinkSync, existsSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverTs = resolve(__dirname, '../server.ts');
const tmpDb = resolve(__dirname, `__zero-config-${Date.now()}.db`);

/**
 * Asserts TRNS-04: zero-config startup.
 *  - Start the server with no flags except --db (to an explicit tmp path, so
 *    the test doesn't collide with a real ./vfx-familiar.db) and with an
 *    env-bag stripped of app-specific variables.
 *  - Verify the db file is created.
 *  - Verify WAL mode is active on the file.
 *  - Verify at least the 5 expected tables exist
 *    (workspaces / projects / sequences / shots / versions).
 *  - Verify user_version = 1 (Pitfall #10 — migration readiness).
 */
describe('zero-config startup', () => {
  it('auto-creates db with WAL + schema on first run', async () => {
    // Ensure clean slate
    for (const p of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      if (existsSync(p)) unlinkSync(p);
    }

    await new Promise<void>((resolvePromise) => {
      const child = spawn('npx', ['tsx', serverTs, '--db', tmpDb], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Explicit: strip app-specific env — TRNS-04 says zero env vars consulted.
        // We still need PATH/HOME so that `npx tsx` can find node_modules + tsx.
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          // Intentionally NO app-specific env vars
        },
      });
      child.stdin.end();
      // Phase 5 (Plan 05-01): npm workspaces hoist expanded node_modules,
      // which pushed `tsx` cold-start past the prior 1500ms window under
      // parallel vitest load. Boot completes well under 3000ms in practice;
      // this is purely a timing margin, not a functional change.
      setTimeout(() => child.kill('SIGTERM'), 3000);
      child.on('exit', () => resolvePromise());
    });

    expect(existsSync(tmpDb)).toBe(true);
    expect(statSync(tmpDb).size).toBeGreaterThan(0);

    // Inspect the db directly — bypasses the server's openDb wrapper.
    const db = new Database(tmpDb);
    try {
      const journalMode = db.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');

      const userVersion = db.pragma('user_version', { simple: true });
      expect(userVersion).toBe(1);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          'projects',
          'sequences',
          'shots',
          'versions',
          'workspaces',
        ]),
      );
    } finally {
      db.close();
    }
  }, 15_000);

  afterAll(() => {
    for (const p of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      if (existsSync(p)) unlinkSync(p);
    }
  });
});
