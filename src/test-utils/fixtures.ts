import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Database as SqliteClient } from 'better-sqlite3';
import * as schema from '../store/schema.js';
import { SCHEMA_DDL } from '../store/schema.js';
import { BUSY_TIMEOUT_MS } from '../store/db.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { TagRepo } from '../store/tag-repo.js';
import { MetadataRepo } from '../store/metadata-repo.js';
import type { Version } from '../types/hierarchy.js';

export interface TestDb {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

/**
 * Widened Db type — the `drizzle()` factory returns `BetterSQLite3Database<T> &
 * { $client: Database }`, but the class declaration omits `$client`. TagRepo +
 * MetadataRepo need the widened type for their raw-SQL json_group_array paths
 * (Plan 04-02 established the widening convention at the repo boundary). We
 * widen locally in fixtures so every helper can pass `testDb.db as DbWithClient`
 * into the repo constructors without leaking the cast to callers.
 */
type DbWithClient = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

/**
 * Create a fresh in-memory SQLite database with the production pragma order
 * applied, schema DDL executed, user_version=1 set, AND Drizzle migrations
 * applied on top. Mirrors openDb() so tests exercise the same init sequence.
 */
export function makeInMemoryDb(): TestDb {
  const sqlite = new Database(':memory:');
  // Match prod init order (see src/store/db.ts)
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA_DDL);
  sqlite.pragma('user_version = 1');
  const db = drizzle(sqlite, { schema });
  // Phase 2: keep test parity with prod (src/store/db.ts).
  migrate(db, { migrationsFolder: './drizzle' });
  return { db, sqlite };
}

// =============== Phase 4 seeding helpers (RESEARCH §Test Fixtures Needed) ===============
//
// These helpers compose HierarchyRepo + VersionRepo + TagRepo + MetadataRepo so
// engine and tool tests can seed realistic Phase 4 data without re-writing the
// hierarchy walk or per-version tag/metadata loops. Each helper accepts an
// existing TestDb (from makeInMemoryDb) so tests own database lifecycle.
//
// All helpers use unique workspace names via `ws-<context>-${Date.now()}` to
// avoid collisions when multiple helpers run in the same test case. Returns
// typed plain objects (no classes) so tests can destructure and assert.

/**
 * Phase 4 helper: seed a workspace/project/sequence/shot with N versions plus
 * the requested number of tag rows and metadata entries per version.
 *
 * Bulk seeding for query-correctness tests — every version gets distinct tag
 * names (`tag_<t>_<i>`) and metadata keys (`key_<m>_<i>`) so cross-version
 * aggregation scenarios have predictable data.
 *
 * Returns the created hierarchy ids + the seeded versions + the flat tag/key
 * arrays for assertion convenience (e.g., sort + compare against ASC-ordered
 * output).
 */
export async function seedAssetFixtures(
  testDb: TestDb,
  options: {
    versionCount?: number;
    tagsPerVersion?: number;
    metadataPerVersion?: number;
  } = {},
): Promise<{
  hierarchy: { workspaceId: string; projectId: string; sequenceId: string; shotId: string };
  versions: Version[];
  tagNames: string[];
  metadataKeys: string[];
}> {
  const { versionCount = 3, tagsPerVersion = 2, metadataPerVersion = 2 } = options;
  const { db } = testDb;
  const h = new HierarchyRepo(db);
  const v = new VersionRepo(db);
  // Cast to widened Db at the TagRepo / MetadataRepo boundary — factory runtime
  // surfaces $client via intersection; narrow TestDb.db omits it at the type
  // level. Same pattern as src/store/__tests__/tag-repo.test.ts.
  const tagRepo = new TagRepo(db as DbWithClient, v);
  const metaRepo = new MetadataRepo(db as DbWithClient, v);

  const ws = h.createWorkspace(`ws-${Date.now()}`);
  const proj = h.createProject(ws.id, 'p1');
  const seq = h.createSequence(proj.id, 'sq010');
  const shot = h.createShot(seq.id, 'sh010');

  const versions: Version[] = [];
  const tagNames: string[] = [];
  const metadataKeys: string[] = [];
  for (let i = 0; i < versionCount; i++) {
    const ver = v.insertVersion(shot.id, `notes-${i}`);
    versions.push(ver);
    for (let t = 0; t < tagsPerVersion; t++) {
      const tag = `tag_${t}_${i}`;
      tagRepo.insertTag(ver.id, tag);
      if (!tagNames.includes(tag)) tagNames.push(tag);
    }
    for (let m = 0; m < metadataPerVersion; m++) {
      const key = `key_${m}_${i}`;
      metaRepo.upsertMetadata(ver.id, key, `value-${m}-${i}`);
      if (!metadataKeys.includes(key)) metadataKeys.push(key);
    }
  }
  return {
    hierarchy: { workspaceId: ws.id, projectId: proj.id, sequenceId: seq.id, shotId: shot.id },
    versions,
    tagNames,
    metadataKeys,
  };
}

/**
 * Quick helper: attach a specific tag set to a specific version. Assumes the
 * version already exists. Use for focused unit tests where seedAssetFixtures
 * is overkill (e.g., "attach these exact 3 tags in this order and assert the
 * ASC ordering on read").
 *
 * Tags are inserted via TagRepo.insertTag (idempotent per D-ASST-03) so calling
 * this twice with overlapping sets is safe.
 */
export function versionWithTags(
  testDb: TestDb,
  versionId: string,
  tags: string[],
): void {
  const tagRepo = new TagRepo(testDb.db as DbWithClient, new VersionRepo(testDb.db));
  for (const t of tags) {
    tagRepo.insertTag(versionId, t);
  }
}

/**
 * Quick helper: attach a specific metadata map to a specific version. Assumes
 * the version already exists. Use for focused unit tests.
 *
 * Metadata is upserted via MetadataRepo.upsertMetadata (idempotent per
 * D-ASST-03) so later calls replace earlier values for the same key.
 */
export function versionWithMetadata(
  testDb: TestDb,
  versionId: string,
  metadataMap: Record<string, string>,
): void {
  const metaRepo = new MetadataRepo(testDb.db as DbWithClient, new VersionRepo(testDb.db));
  for (const [k, val] of Object.entries(metadataMap)) {
    metaRepo.upsertMetadata(versionId, k, val);
  }
}

/**
 * Build two projects with two shots each (one shot per sequence; two versions
 * in the first shot + one version in the second) — 3 versions total — for
 * scope filter tests. The two projects share a workspace so workspace-scoped
 * queries return all versions while project-scoped queries return only one
 * subtree.
 *
 * Returns the full hierarchy ids in a nested shape so tests can pluck whatever
 * scope level they need.
 */
export function hierarchyWithVersionsAcrossScopes(
  testDb: TestDb,
): {
  workspaceId: string;
  projects: {
    projectId: string;
    sequences: { sequenceId: string; shots: { shotId: string; versionIds: string[] }[] }[];
  }[];
} {
  const { db } = testDb;
  const h = new HierarchyRepo(db);
  const v = new VersionRepo(db);
  const ws = h.createWorkspace(`ws-multi-${Date.now()}`);
  const p1 = h.createProject(ws.id, 'p1');
  const p2 = h.createProject(ws.id, 'p2');
  const sq1 = h.createSequence(p1.id, 'sq010');
  const sq2 = h.createSequence(p2.id, 'sq010');
  const sh1 = h.createShot(sq1.id, 'sh010');
  const sh2 = h.createShot(sq2.id, 'sh010');
  const v1a = v.insertVersion(sh1.id);
  const v1b = v.insertVersion(sh1.id);
  const v2a = v.insertVersion(sh2.id);
  return {
    workspaceId: ws.id,
    projects: [
      {
        projectId: p1.id,
        sequences: [
          { sequenceId: sq1.id, shots: [{ shotId: sh1.id, versionIds: [v1a.id, v1b.id] }] },
        ],
      },
      {
        projectId: p2.id,
        sequences: [
          { sequenceId: sq2.id, shots: [{ shotId: sh2.id, versionIds: [v2a.id] }] },
        ],
      },
    ],
  };
}

/**
 * Build N versions with controlled created_at timestamps (in seed order) for
 * date-range boundary tests (D-ASST-15 inclusive-both-ends + INV-ASST-11). The
 * raw UPDATE on versions.created_at is the standard pattern (see
 * src/engine/__tests__/assets.test.ts INV-ASST-10) for overriding the natural
 * Date.now()-at-insert timestamp — necessary because insertVersion() always
 * stamps with the current time.
 *
 * Returns the shot id + the ordered version ids so tests can assert against
 * the known timestamp-to-id mapping.
 */
export async function versionsWithTimestampSpread(
  testDb: TestDb,
  timestamps: number[],
): Promise<{ shotId: string; versionIds: string[] }> {
  const { db, sqlite } = testDb;
  const h = new HierarchyRepo(db);
  const v = new VersionRepo(db);
  const ws = h.createWorkspace(`ws-ts-${Date.now()}`);
  const p = h.createProject(ws.id, 'p1');
  const s = h.createSequence(p.id, 'sq010');
  const sh = h.createShot(s.id, 'sh010');
  const versionIds: string[] = [];
  for (const ts of timestamps) {
    const ver = v.insertVersion(sh.id);
    // Overwrite created_at via raw UPDATE (tests need controlled timestamps).
    sqlite.prepare(`UPDATE versions SET created_at = ? WHERE id = ?`).run(ts, ver.id);
    versionIds.push(ver.id);
  }
  return { shotId: sh.id, versionIds };
}

/**
 * Build four versions with each of submitted/running/completed/failed states
 * for status-filter tests. The status column is updated via raw SQL because
 * VersionRepo's public API only exposes state transitions through
 * markCompleted/markFailed; bypassing preserves the Phase 3 invariants while
 * giving status-filter tests a ready-made fixture.
 *
 * Returns the shot id + a Record keyed by status so tests can pluck ids by
 * state without array indexing.
 */
export function versionsWithStatusVariety(
  testDb: TestDb,
): { shotId: string; versionsByStatus: Record<'submitted' | 'running' | 'completed' | 'failed', string> } {
  const { db, sqlite } = testDb;
  const h = new HierarchyRepo(db);
  const v = new VersionRepo(db);
  const ws = h.createWorkspace(`ws-status-${Date.now()}`);
  const p = h.createProject(ws.id, 'p1');
  const s = h.createSequence(p.id, 'sq010');
  const sh = h.createShot(s.id, 'sh010');
  const vSubmitted = v.insertVersion(sh.id);
  const vRunning = v.insertVersion(sh.id);
  const vCompleted = v.insertVersion(sh.id);
  const vFailed = v.insertVersion(sh.id);
  // submitted is the default on insertVersion; update the other three.
  sqlite.prepare(`UPDATE versions SET status = ? WHERE id = ?`).run('running', vRunning.id);
  sqlite.prepare(`UPDATE versions SET status = ? WHERE id = ?`).run('completed', vCompleted.id);
  sqlite.prepare(`UPDATE versions SET status = ? WHERE id = ?`).run('failed', vFailed.id);
  return {
    shotId: sh.id,
    versionsByStatus: {
      submitted: vSubmitted.id,
      running: vRunning.id,
      completed: vCompleted.id,
      failed: vFailed.id,
    },
  };
}

/**
 * Seed a version with exactly N tags and M metadata entries for
 * MAX_TAGS_PER_VERSION / MAX_METADATA_PER_VERSION cap tests (D-ASST-11 —
 * 50/100 respectively).
 *
 * Defaults to 50 tags + 0 metadata (the common tag-cap fixture). Pass
 * `{ tagCount: 0, metadataCount: 100 }` for a metadata-cap version or
 * `{ tagCount: 50, metadataCount: 100 }` for a both-at-cap version.
 *
 * Returns the version id; callers already know the shot from their own test
 * setup or can resolve it via the repo if needed.
 */
export function versionsAtCap(
  testDb: TestDb,
  options: { tagCount?: number; metadataCount?: number } = {},
): string {
  const { tagCount = 50, metadataCount = 0 } = options;
  const { db } = testDb;
  const h = new HierarchyRepo(db);
  const v = new VersionRepo(db);
  const tagRepo = new TagRepo(db as DbWithClient, v);
  const metaRepo = new MetadataRepo(db as DbWithClient, v);
  const ws = h.createWorkspace(`ws-cap-${Date.now()}`);
  const p = h.createProject(ws.id, 'p1');
  const s = h.createSequence(p.id, 'sq010');
  const sh = h.createShot(s.id, 'sh010');
  const ver = v.insertVersion(sh.id);
  for (let i = 0; i < tagCount; i++) {
    tagRepo.insertTag(ver.id, `cap_tag_${i}`);
  }
  for (let i = 0; i < metadataCount; i++) {
    metaRepo.upsertMetadata(ver.id, `cap_key_${i}`, `cap_value_${i}`);
  }
  return ver.id;
}
