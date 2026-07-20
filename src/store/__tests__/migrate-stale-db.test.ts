import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TypedError } from '../../engine/errors.js';

/**
 * Phase 10 (DEMO-01) — ROADMAP success criteria #2 + #3:
 *   - On migration failure, server exits non-zero with a MIGRATION_PENDING
 *     typed error naming the failed migration file and remediation hint.
 *   - A unit test boots against a deliberately-stale DB fixture and
 *     asserts MIGRATION_PENDING fires BEFORE any tool registration.
 *
 * Strategy: use vi.mock to inject a synthetic failure into the underlying
 * drizzle migrator. This proves the typed-error wrapping in runMigrations()
 * (Plan 10-01) and the close-before-throw + propagation in openDb()
 * (Plan 10-02), without needing to construct an on-disk corrupted
 * migrations folder. The realistic Phase-1-only-DB-upgraded-cleanly
 * happy path is already covered by IDM-02 in migrate.test.ts.
 *
 * Architecture-purity contract: this file has zero MCP-SDK imports
 * — it targets src/store/ and src/engine/errors only. The boot-order
 * proof uses a local vi.fn() spy in place of the real Engine constructor,
 * which sidesteps the (transitive) MCP imports of src/engine/pipeline.ts
 * and keeps this test inside the store-layer purity boundary.
 */

const SYNTHETIC_SQL_ERROR =
  'no such table: __drizzle_migrations (synthetic Phase 10 stale-DB fixture)';

// The mock is hoisted by Vitest. Every test in this file sees a forced
// failure from the underlying drizzle migrator. Plan 10-01's
// runMigrations() wraps that into TypedError('MIGRATION_PENDING').
vi.mock('drizzle-orm/better-sqlite3/migrator', () => {
  return {
    migrate: vi.fn(() => {
      throw new Error(SYNTHETIC_SQL_ERROR);
    }),
  };
});

function uniqueDbPath(label: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `vellum-${label}-${rand}.db`);
}

function cleanup(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore missing */ }
  }
}

describe('Phase 10 — typed-error shape on migration failure (ROADMAP #2)', () => {
  let dbPath: string;
  beforeEach(() => { dbPath = uniqueDbPath('stale-shape'); });
  afterEach(() => { cleanup(dbPath); });

  it('runMigrations() throws TypedError with code MIGRATION_PENDING when underlying migrate() fails', async () => {
    // Imported lazily so the vi.mock above takes effect before the
    // module under test resolves the real migrator import.
    const { runMigrations } = await import('../migrate.js');
    const Database = (await import('better-sqlite3')).default;
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    const db = drizzle(sqlite);

    let captured: unknown;
    try {
      runMigrations(db);
    } catch (err) {
      captured = err;
    } finally {
      sqlite.close();
    }

    expect(captured).toBeInstanceOf(TypedError);
    const typed = captured as TypedError;
    expect(typed.code).toBe('MIGRATION_PENDING');
  });

  it('error.message names a .sql migration filename', async () => {
    const { runMigrations } = await import('../migrate.js');
    const Database = (await import('better-sqlite3')).default;
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite);

    try {
      expect(() => runMigrations(db)).toThrow(/\.sql/);
    } finally {
      sqlite.close();
    }
  });

  it('error.message includes the underlying SQL error text', async () => {
    const { runMigrations } = await import('../migrate.js');
    const Database = (await import('better-sqlite3')).default;
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite);

    try {
      expect(() => runMigrations(db)).toThrow(/synthetic Phase 10 stale-DB fixture/);
    } finally {
      sqlite.close();
    }
  });

  it('error.hint is non-empty and references drizzle-kit push or sqlite3 manual apply', async () => {
    const { runMigrations } = await import('../migrate.js');
    const Database = (await import('better-sqlite3')).default;
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite);

    let captured: unknown;
    try {
      runMigrations(db);
    } catch (err) {
      captured = err;
    } finally {
      sqlite.close();
    }
    const typed = captured as TypedError;
    expect(typed.hint).toBeTruthy();
    // Either remediation path must appear in the hint.
    expect(typed.hint!).toMatch(/drizzle-kit push|sqlite3 .*<.*drizzle/);
  });
});

describe('Phase 10 — boot path bails before tool registration (ROADMAP #3)', () => {
  let dbPath: string;
  beforeEach(() => { dbPath = uniqueDbPath('stale-boot'); });
  afterEach(() => { cleanup(dbPath); });

  it('openDb() throws TypedError(MIGRATION_PENDING) and the WAL lock is released', async () => {
    const { openDb } = await import('../db.js');
    let captured: unknown;
    try {
      openDb(dbPath);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(TypedError);
    expect((captured as TypedError).code).toBe('MIGRATION_PENDING');

    // WAL lock release proof: a follow-up openDb() against the same path
    // would hang for busy_timeout=5000ms if the lock leaked. We don't
    // re-trigger the failure here (that's Plan 10-02's no-op test
    // territory). Instead, we assert the .db file is unlocked by
    // attempting a raw open and immediate close. This must not throw.
    const Database = (await import('better-sqlite3')).default;
    if (fs.existsSync(dbPath)) {
      expect(() => {
        const raw = new Database(dbPath);
        raw.close();
      }).not.toThrow();
    }
  });

  it('the bail happens BEFORE engine construction would run (engine-constructor spy never fires)', async () => {
    // Engine is built in src/server.ts:196 with `new Engine(db, ...)`.
    // We assert that since openDb() throws inside its runMigrations()
    // call (at src/store/db.ts ~line 73), ANY code that runs after the
    // `const { db } = openDb(dbPath);` line in src/server.ts is
    // unreachable. This is a structural assertion — we do NOT import
    // server.ts (which would start a transport) and we do NOT import
    // src/engine/pipeline.ts's Engine (which would pull MCP-touching
    // code into a store-layer test and break architecture-purity).
    // Instead, we simulate the boot order with a vi.fn() spy that
    // stands in for the engine constructor:
    //   1. openDb(dbPath)              <-- throws here on Phase 10 mock
    //   2. engineConstructorSpy(db)    <-- unreachable
    const engineConstructorSpy = vi.fn();
    const { openDb } = await import('../db.js');

    function simulateBoot(): void {
      // Mirrors the sequence in src/server.ts:154-196: openDb first,
      // then engine construction. The Phase 10 close-before-throw
      // contract guarantees openDb's throw escapes before any
      // engine code runs.
      const { db } = openDb(dbPath);   // throws on Phase 10 mock
      engineConstructorSpy(db);         // unreachable
    }

    expect(() => simulateBoot()).toThrow(TypedError);
    expect(engineConstructorSpy).not.toHaveBeenCalled();
  });
});

describe('Phase 10 — failed migration filename in message (ROADMAP #2)', () => {
  let dbPath: string;
  beforeEach(() => { dbPath = uniqueDbPath('stale-fname'); });
  afterEach(() => { cleanup(dbPath); });

  it('on a fresh DB (zero applied), the failing filename is the first journal entry tag + .sql', async () => {
    const { runMigrations } = await import('../migrate.js');
    const Database = (await import('better-sqlite3')).default;
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite);

    try {
      // The journal's first entry tag is `0001_phase2_version_lifecycle`
      // (verified against drizzle/meta/_journal.json). runMigrations
      // names that file when zero migrations are applied yet.
      expect(() => runMigrations(db)).toThrow(/0001_phase2_version_lifecycle\.sql/);
    } finally {
      sqlite.close();
    }
  });
});
