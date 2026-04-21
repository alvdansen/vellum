import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../store/schema.js';
import { SCHEMA_DDL } from '../store/schema.js';

export interface TestDb {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

/**
 * Create a fresh in-memory SQLite database with the production pragma order
 * applied, schema DDL executed, and user_version=1 set. Mirrors openDb() so
 * tests exercise the same init sequence.
 */
export function makeInMemoryDb(): TestDb {
  const sqlite = new Database(':memory:');
  // Match prod init order (see src/store/db.ts)
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA_DDL);
  sqlite.pragma('user_version = 1');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
