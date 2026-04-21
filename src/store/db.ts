import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { SCHEMA_DDL } from './schema.js';

export const SCHEMA_VERSION = 1;

export interface OpenDbResult {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

/**
 * Open a SQLite database at `path`, enforcing the pragma-before-schema init
 * sequence (D-20, Pitfall #6, Pitfall #10). On first run (user_version=0),
 * installs SCHEMA_DDL and stamps user_version=SCHEMA_VERSION. On subsequent
 * opens, validates user_version matches SCHEMA_VERSION.
 */
export function openDb(path: string): OpenDbResult {
  const sqlite = new Database(path);

  // Pragmas FIRST, schema SECOND. Order is invariant (D-20, Pitfall #6).
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const existingVersion = sqlite.pragma('user_version', { simple: true }) as number;
  if (existingVersion === 0) {
    sqlite.exec(SCHEMA_DDL);
    sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
  } else if (existingVersion !== SCHEMA_VERSION) {
    throw new Error(
      `DB at ${path} is version ${existingVersion}, server expects ${SCHEMA_VERSION}`,
    );
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
