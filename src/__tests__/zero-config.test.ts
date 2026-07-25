import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync, existsSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';
import { bootServer } from '../test-utils/boot-server.js';

// Write the throwaway db to the OS temp dir, NOT src/__tests__/ — a transient
// .db under src/ races the architecture-purity `grep -r … src/` (grep errors
// "No such file or directory" when this test deletes it mid-walk).
const tmpDb = join(tmpdir(), `vellum-zero-config-${process.pid}-${Date.now()}.db`);

/**
 * Asserts TRNS-04: zero-config startup.
 *  - Start the server with no flags except --db (to an explicit tmp path, so
 *    the test doesn't collide with a real ./vellum.db) and with an
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

    // Readiness-gated boot (see src/test-utils/boot-server.ts). The db is
    // created during startup, so killing on a wall clock races it: a fixed
    // 3000ms window was exceeded under CPU contention (measured 5.0-5.6s at 8x
    // oversubscription), killing the child before openDb finished and failing
    // the existsSync assertion below with a misleading "expected false to be
    // true". Waiting for the server's own ready marker removes the race, and a
    // boot that never gets there fails with an explicit diagnostic instead.
    const { sawMarker } = await bootServer({
      dbPath: tmpDb,
      // Explicit: strip app-specific env — TRNS-04 says zero env vars consulted.
      // We still need PATH/HOME so that `npx tsx` can find node_modules + tsx.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        // Intentionally NO app-specific env vars
      },
    });
    expect(sawMarker).toBe(true);

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
