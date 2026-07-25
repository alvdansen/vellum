// Phase 10 — migrate-on-boot hardening (DEMO-01).
// Wraps drizzle's migrator with a pending-count pre-check + typed-error
// failure surface so the boot path (Plan 10-02) and the stale-DB fixture test
// (Plan 10-03) share a single audited code path.
//
// Architecture-purity contract: zero MCP-SDK imports, zero HTTP-transport
// imports, zero imports from any transport layer. The directory-level guard
// at src/__tests__/architecture-purity.test.ts uses file-level grep, so even
// mentions in comments are forbidden — keep this file MCP-string-free.

import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TypedError } from '../engine/errors.js';

/**
 * Result of a runMigrations() call.
 *
 * - `applied`: number of pending migration entries observed before the
 *   migrator ran. On a clean (already-current) DB this is 0.
 * - `skipped`: true iff `applied === 0` and the migrator was a no-op.
 *
 * Phase 10 success criterion #4: a clean DB is a no-op — the helper
 * returns `{ applied: 0, skipped: true }` and the migrator is invoked
 * idempotently with no schema or lock contention.
 */
export interface MigrationResult {
  applied: number;
  skipped: boolean;
}

interface DrizzleJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
}

const REMEDIATION_HINT =
  'Run `npx drizzle-kit push` to apply pending migrations, or apply manually with `sqlite3 <db> < drizzle/<migration>.sql`. See drizzle/ for available migration files.';

function readJournal(migrationsFolder: string): DrizzleJournal {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    return { version: '7', dialect: 'sqlite', entries: [] };
  }
  const raw = readFileSync(journalPath, 'utf8');
  return JSON.parse(raw) as DrizzleJournal;
}

function countAppliedRows(db: BetterSQLite3Database<Record<string, never>>): number {
  // Probe — table may not exist on a fresh DB. better-sqlite3 surfaces
  // the underlying SQLite error; treat "no such table" as applied = 0.
  try {
    // Cast to `any` is intentional — we are reaching past Drizzle's
    // typed query builder into the underlying better-sqlite3 handle to
    // count rows in Drizzle's own private bookkeeping table.
    const rawDb = (db as unknown as { $client?: { prepare: (sql: string) => { get: () => unknown } } }).$client
      ?? (db as unknown as { session?: { client?: { prepare: (sql: string) => { get: () => unknown } } } }).session?.client;
    if (!rawDb) return 0;
    const row = rawDb
      .prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations')
      .get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    // Most likely: __drizzle_migrations does not yet exist. Treat as 0.
    return 0;
  }
}

/**
 * Run pending Drizzle migrations against `db` with typed-error wrapping.
 *
 * Phase 10 (DEMO-01). Replaces the unguarded `migrate(db, ...)` call
 * that previously lived inline in `openDb()` (src/store/db.ts:71).
 *
 * Behavior:
 *   1. Pre-check: count pending migrations by diffing the journal vs.
 *      `__drizzle_migrations`. Surface as `MigrationResult.applied`.
 *   2. Invoke drizzle's `migrate()`. On underlying failure, wrap as
 *      `TypedError('MIGRATION_PENDING', ...)` with the failing migration
 *      filename, the SQL error text, and a remediation hint.
 *   3. On success, return the pre-checked applied count + `skipped`.
 *
 * Architecture-purity contract: this file has zero MCP-SDK or HTTP-transport
 * imports — it is a pure store-layer helper.
 */
export function runMigrations<TSchema extends Record<string, unknown> = Record<string, never>>(
  db: BetterSQLite3Database<TSchema>,
  opts?: { migrationsFolder?: string },
): MigrationResult {
  const migrationsFolder = opts?.migrationsFolder ?? './drizzle';
  const journal = readJournal(migrationsFolder);
  const totalInJournal = journal.entries.length;
  // countAppliedRows reaches past the typed query builder into the raw
  // better-sqlite3 handle, so its parameter type is schema-agnostic.
  const alreadyApplied = countAppliedRows(db as unknown as BetterSQLite3Database<Record<string, never>>);
  const pending = Math.max(0, totalInJournal - alreadyApplied);

  const firstPendingTag = journal.entries[alreadyApplied]?.tag ?? null;

  try {
    drizzleMigrate(db, { migrationsFolder });
  } catch (err) {
    const underlying = (err as Error).message ?? String(err);
    const filename = firstPendingTag ? `${firstPendingTag}.sql` : '<unknown migration file>';
    throw new TypedError(
      'MIGRATION_PENDING',
      `Drizzle migration failed while applying ${filename}: ${underlying}`,
      REMEDIATION_HINT,
    );
  }

  return { applied: pending, skipped: pending === 0 };
}
