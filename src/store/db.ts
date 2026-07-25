import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from './migrate.js';
import * as schema from './schema.js';
import { SCHEMA_DDL } from './schema.js';

export const SCHEMA_VERSION = 1;

/**
 * MNT-05: single source for the SQLite busy_timeout value. Consumed by the
 * production openDb() path AND the in-memory test fixture so both share the
 * exact same contention ceiling. 5000ms was picked per CLAUDE.md (Architecture
 * Rules — "SQLite WAL: Enable WAL mode + busy_timeout=5000 at database
 * initialization").
 */
export const BUSY_TIMEOUT_MS = 5000;

export interface OpenDbResult {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

/**
 * Open a SQLite database at `path`, enforcing the pragma-before-schema init
 * sequence (D-20, Pitfall #6, Pitfall #10).
 *
 * Init sequence on a fresh DB:
 *   1. WAL + busy_timeout + foreign_keys pragmas (invariant order).
 *   2. If user_version === 0 → exec SCHEMA_DDL (Phase 1 base tables +
 *      indexes) → stamp user_version = SCHEMA_VERSION.
 *   3. Drizzle migrator (`migrate()`) runs the additive migrations under
 *      `./drizzle/` (tracked by Drizzle's own `__drizzle_migrations` table).
 *      Phase 2 added `versions.error_code/error_message/outputs_json` via
 *      0001_phase2_version_lifecycle.sql and the recovery-poller index via
 *      0002_idx_versions_status.sql.
 *
 * On subsequent opens, validates user_version matches SCHEMA_VERSION and
 * only re-runs the Drizzle migrator (which is idempotent).
 *
 * DM-02: on user_version mismatch, closes the handle before throwing so
 * the WAL lock releases.
 */
export function openDb(path: string): OpenDbResult {
  const sqlite = new Database(path);

  // Pragmas FIRST, schema SECOND. Order is invariant (D-20, Pitfall #6).
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.pragma('foreign_keys = ON');

  const existingVersion = sqlite.pragma('user_version', { simple: true }) as number;
  if (existingVersion === 0) {
    sqlite.exec(SCHEMA_DDL);
    sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
  } else if (existingVersion !== SCHEMA_VERSION) {
    // DM-02: close the fd + release the WAL lock before throwing. Leaving
    // the handle open on a mismatch leaks both into the process's open-file
    // table and blocks subsequent openDb attempts on the same path until GC.
    const msg = `DB at ${path} is version ${existingVersion}, server expects ${SCHEMA_VERSION}`;
    sqlite.close();
    throw new Error(msg);
  }

  const db = drizzle(sqlite, { schema });

  // Phase 2 addition (D-GEN-38): drizzle-kit-generated migrations layer on top.
  // Idempotent — Drizzle's own __drizzle_migrations table tracks applied files.
  // Phase 10 (DEMO-01): runs through runMigrations() so a failed apply
  // surfaces as TypedError('MIGRATION_PENDING') with the failing migration
  // filename + remediation hint, BEFORE buildEngine() / tool registration.
  // On failure we close the WAL lock (DM-02 parity) before the throw escapes.
  try {
    runMigrations(db);
  } catch (err) {
    // DM-02 parity: release the WAL lock before the typed error
    // escapes so a follow-up openDb() against the same path is not
    // blocked. Plan 10 success criterion #2: MIGRATION_PENDING must
    // surface from openDb() before either transport opens.
    sqlite.close();
    throw err;
  }

  return { db, sqlite };
}
