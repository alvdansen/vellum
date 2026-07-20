import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../store/schema.js';
import { SCHEMA_DDL } from '../../store/schema.js';
import { BUSY_TIMEOUT_MS } from '../../store/db.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';

/**
 * Pivot Phase B — migration 0009_pivot_neutral_provenance + versions.provider stamping.
 *
 * Additive, provider-agnostic groundwork. All three columns are NULLABLE and
 * dual-read (legacy rows read NULL):
 *   - versions.provider — the GenerationProvider adapter id.
 *   - provenance.generation_request_json / generation_result_json — neutral
 *     analogs of workflow_json / prompt_json (holds NeutralProvenance).
 *
 * Mirrors the 0007 migration-test shape (fresh-DB apply, legacy-NULL, idempotency).
 */

function freshMigratedDb(): { sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA_DDL);
  sqlite.pragma('user_version = 1');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return { sqlite };
}

describe('Pivot Phase B — migration 0009 (versions.provider + neutral provenance columns)', () => {
  test('Test 1 — fresh DB: versions.provider exists and is nullable TEXT', () => {
    const { sqlite } = freshMigratedDb();
    const cols = sqlite.prepare(`PRAGMA table_info(versions)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const providerCol = cols.find((c) => c.name === 'provider');
    expect(providerCol).toBeDefined();
    expect(providerCol!.type.toUpperCase()).toBe('TEXT');
    expect(providerCol!.notnull).toBe(0); // nullable
    sqlite.close();
  });

  test('Test 2 — fresh DB: provenance neutral JSON columns exist and are nullable TEXT', () => {
    const { sqlite } = freshMigratedDb();
    const cols = sqlite.prepare(`PRAGMA table_info(provenance)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    for (const name of ['generation_request_json', 'generation_result_json']) {
      const col = cols.find((c) => c.name === name);
      expect(col, `${name} column must exist`).toBeDefined();
      expect(col!.type.toUpperCase()).toBe('TEXT');
      expect(col!.notnull).toBe(0);
    }
    sqlite.close();
  });

  test('Test 3 — idempotency: migrate() twice is a no-op (column count + set unchanged)', () => {
    const { sqlite } = freshMigratedDb();
    const db = drizzle(sqlite, { schema });
    const before = sqlite.prepare(`PRAGMA table_info(versions)`).all() as Array<{ name: string }>;
    expect(() => migrate(db, { migrationsFolder: './drizzle' })).not.toThrow();
    const after = sqlite.prepare(`PRAGMA table_info(versions)`).all() as Array<{ name: string }>;
    expect(after.length).toBe(before.length);
    expect(new Set(after.map((c) => c.name))).toEqual(new Set(before.map((c) => c.name)));
    sqlite.close();
  });

  describe('provider stamping + legacy dual-read', () => {
    let versionRepo: VersionRepo;
    let provenanceRepo: ProvenanceRepo;
    let shotId: string;

    beforeEach(() => {
      const { db } = makeInMemoryDb();
      versionRepo = new VersionRepo(db);
      provenanceRepo = new ProvenanceRepo(db);
      const hierarchy = new HierarchyRepo(db);
      const ws = hierarchy.createWorkspace('wsB');
      const proj = hierarchy.createProject(ws.id, 'pB');
      const seq = hierarchy.createSequence(proj.id, 'sq010');
      shotId = hierarchy.createShot(seq.id, 'sh010').id;
    });

    test('Test 4 — insertVersion stamps the provider arg and it round-trips through getVersion', () => {
      const row = versionRepo.insertVersion(shotId, undefined, undefined, 'replicate');
      expect(row.provider).toBe('replicate');
      const fetched = versionRepo.getVersion(row.id);
      expect(fetched?.provider).toBe('replicate');
    });

    test('Test 5 — insertVersion WITHOUT a provider stamps NULL (legacy/test path)', () => {
      const row = versionRepo.insertVersion(shotId);
      expect(row.provider ?? null).toBeNull();
      const fetched = versionRepo.getVersion(row.id);
      expect(fetched?.provider ?? null).toBeNull();
    });

    test('Test 6 — legacy completed provenance event reads neutral columns as NULL (dual-read)', () => {
      const versionId = versionRepo.insertVersion(shotId).id;
      provenanceRepo.insertEvent(versionId, {
        event_type: 'completed',
        prompt_json: '{}',
        seed: 7,
        models_json: '[]',
        outputs_json: '[]',
      });
      const events = provenanceRepo.getEventsForVersion(versionId);
      expect(events).toHaveLength(1);
      expect(events[0]!.generation_request_json ?? null).toBeNull();
      expect(events[0]!.generation_result_json ?? null).toBeNull();
    });
  });
});
