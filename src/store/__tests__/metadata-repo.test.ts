import { describe, it, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import { MetadataRepo } from '../metadata-repo.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteClient } from 'better-sqlite3';
import type * as schema from '../schema.js';

/** Widened Db type — factory intersection surface `$client` for raw SQL. */
type DbWithClient = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

/**
 * Tests for MetadataRepo (Phase 4 — D-ASST-03, D-ASST-04, D-ASST-06, D-ASST-08, D-ASST-19).
 *
 * Traceability:
 *   - INV-ASST-03 → test "upsertMetadata second call with same key UPDATEs value + created_at"
 *   - INV-ASST-04 → test "deleteMetadata on missing key is a no-op"
 *
 * Covers:
 *  - upsertMetadata INSERT path (first call) + UPDATE path (second call same key)
 *    (D-ASST-03, D-ASST-08 — created_at refreshes on UPDATE, id stays the same)
 *  - Version pre-check (RESEARCH Pitfall #3 — VERSION_NOT_FOUND, no FK leak)
 *  - deleteMetadata idempotency (D-ASST-03)
 *  - listMetadataForVersion ASC-by-key ordering (D-ASST-04 / D-ASST-19)
 *  - listMetadataForVersion returns [] not [null] for empty sets (RESEARCH Pitfall #2)
 *  - countMetadataForVersion for engine cap enforcement (D-ASST-11 / MAX_METADATA_PER_VERSION)
 *  - listMetadataKeysInScope for workspace/project/sequence/shot + global (D-ASST-06)
 */

/** Intentional duplication of buildSmallHierarchy from tag-repo.test.ts —
 * Plan 04-02 keeps repo tests independent; Plan 05 may extract to fixtures.ts. */
function buildSmallHierarchy(): {
  db: DbWithClient;
  h: HierarchyRepo;
  v: VersionRepo;
  ws: ReturnType<HierarchyRepo['createWorkspace']>;
  proj: ReturnType<HierarchyRepo['createProject']>;
  seq: ReturnType<HierarchyRepo['createSequence']>;
  shot: ReturnType<HierarchyRepo['createShot']>;
  ver: ReturnType<VersionRepo['insertVersion']>;
} {
  const { db } = makeInMemoryDb();
  const h = new HierarchyRepo(db);
  const v = new VersionRepo(db);
  const ws = h.createWorkspace('ws1');
  const proj = h.createProject(ws.id, 'p1');
  const seq = h.createSequence(proj.id, 'sq010');
  const shot = h.createShot(seq.id, 'sh010');
  const ver = v.insertVersion(shot.id);
  return { db: db as DbWithClient, h, v, ws, proj, seq, shot, ver };
}

function buildMultiProjectHierarchy() {
  const { db } = makeInMemoryDb();
  const h = new HierarchyRepo(db);
  const v = new VersionRepo(db);
  const ws = h.createWorkspace('ws_multi');
  const projA = h.createProject(ws.id, 'projA');
  const projB = h.createProject(ws.id, 'projB');
  const seqA = h.createSequence(projA.id, 'sqA010');
  const seqB = h.createSequence(projB.id, 'sqB010');
  const shotA = h.createShot(seqA.id, 'sh010');
  const shotB = h.createShot(seqB.id, 'sh020');
  const verA1 = v.insertVersion(shotA.id);
  const verA2 = v.insertVersion(shotA.id);
  const verB1 = v.insertVersion(shotB.id);
  const verB2 = v.insertVersion(shotB.id);
  return {
    db: db as DbWithClient,
    h,
    v,
    ws,
    projA,
    projB,
    seqA,
    seqB,
    shotA,
    shotB,
    verA1,
    verA2,
    verB1,
    verB2,
  };
}

describe('MetadataRepo — upsert semantics, scope aggregation, hydration (INV-ASST-03, INV-ASST-04)', () => {
  let db: DbWithClient;
  let repo: MetadataRepo;
  let versionRepo: VersionRepo;
  let versionId: string;

  beforeEach(() => {
    const built = buildSmallHierarchy();
    db = built.db;
    versionRepo = built.v;
    repo = new MetadataRepo(db, versionRepo);
    versionId = built.ver.id;
  });

  // ================================================================
  // Case 1: first upsertMetadata returns meta_ id, row inserted
  // ================================================================
  it('upsertMetadata first call inserts a new row and returns { id: meta_... }', () => {
    const result = repo.upsertMetadata(versionId, 'artist', 'tim');
    expect(result.id).toMatch(/^meta_.+/);

    const row = db.$client
      .prepare('SELECT id, version_id, key, value FROM metadata WHERE id = ?')
      .get(result.id) as { id: string; version_id: string; key: string; value: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.version_id).toBe(versionId);
    expect(row?.key).toBe('artist');
    expect(row?.value).toBe('tim');
  });

  // ================================================================
  // Case 2: INV-ASST-03 — second upsertMetadata with same key UPDATEs value and refreshes created_at
  // ================================================================
  it('INV-ASST-03: upsertMetadata second call with same key UPDATEs value, returns same id, refreshes created_at (D-ASST-08)', async () => {
    const first = repo.upsertMetadata(versionId, 'artist', 'tim');
    const firstRow = db.$client.prepare('SELECT * FROM metadata WHERE id = ?').get(first.id) as {
      id: string;
      value: string;
      created_at: number;
    };
    expect(firstRow.value).toBe('tim');

    // ≥5ms real-clock gap so created_at strictly increases.
    await new Promise((r) => setTimeout(r, 5));

    const second = repo.upsertMetadata(versionId, 'artist', 'bob');
    expect(second.id).toBe(first.id); // same id — UPDATE path preserves PK

    const secondRow = db.$client.prepare('SELECT * FROM metadata WHERE id = ?').get(first.id) as {
      id: string;
      value: string;
      created_at: number;
    };
    expect(secondRow.value).toBe('bob'); // UPDATE wrote the new value
    expect(secondRow.created_at).toBeGreaterThan(firstRow.created_at); // D-ASST-08: refreshed
  });

  // ================================================================
  // Case 3: UNIQUE(version_id, key) — only one row after upserts
  // ================================================================
  it('INV-ASST-03: after multiple upsertMetadata calls with same (version_id, key), exactly one row exists', () => {
    repo.upsertMetadata(versionId, 'artist', 'tim');
    repo.upsertMetadata(versionId, 'artist', 'bob');
    repo.upsertMetadata(versionId, 'artist', 'alice');

    const countRow = db.$client
      .prepare('SELECT COUNT(*) AS n FROM metadata WHERE version_id = ? AND key = ?')
      .get(versionId, 'artist') as { n: number };
    expect(countRow.n).toBe(1);

    // Final value reflects the last upsert.
    const kv = repo.listMetadataForVersion(versionId);
    expect(kv).toEqual([{ key: 'artist', value: 'alice' }]);
  });

  // ================================================================
  // Case 4: pre-check version — missing version_id throws VERSION_NOT_FOUND (RESEARCH Pitfall #3)
  // ================================================================
  it('upsertMetadata on a missing version_id throws TypedError("VERSION_NOT_FOUND") — no SQLITE_CONSTRAINT_FOREIGNKEY leak', () => {
    expect(() => repo.upsertMetadata('ver_bogus_id_does_not_exist', 'artist', 'tim')).toThrowTypedError(
      'VERSION_NOT_FOUND',
    );
  });

  // ================================================================
  // Case 5: INV-ASST-04 — deleteMetadata on missing key is a no-op
  // ================================================================
  it('INV-ASST-04: deleteMetadata on a missing key returns void and throws nothing', () => {
    expect(() => repo.deleteMetadata(versionId, 'non-existent-key')).not.toThrow();
    const countRow = db.$client
      .prepare('SELECT COUNT(*) AS n FROM metadata WHERE version_id = ?')
      .get(versionId) as { n: number };
    expect(countRow.n).toBe(0);
  });

  // ================================================================
  // Case 6: deleteMetadata removes an existing key; list no longer includes it
  // ================================================================
  it('deleteMetadata removes an existing (version_id, key) row; listMetadataForVersion no longer includes it', () => {
    repo.upsertMetadata(versionId, 'artist', 'tim');
    repo.upsertMetadata(versionId, 'department', 'lighting');
    expect(repo.listMetadataForVersion(versionId)).toEqual([
      { key: 'artist', value: 'tim' },
      { key: 'department', value: 'lighting' },
    ]);

    repo.deleteMetadata(versionId, 'artist');
    expect(repo.listMetadataForVersion(versionId)).toEqual([
      { key: 'department', value: 'lighting' },
    ]);
  });

  // ================================================================
  // Case 7: listMetadataForVersion returns ASC-by-key (D-ASST-04 / D-ASST-19)
  // ================================================================
  it('listMetadataForVersion returns entries ASC by key regardless of insert order (D-ASST-04 / D-ASST-19)', () => {
    repo.upsertMetadata(versionId, 'gamma', '3');
    repo.upsertMetadata(versionId, 'alpha', '1');
    repo.upsertMetadata(versionId, 'beta', '2');

    expect(repo.listMetadataForVersion(versionId)).toEqual([
      { key: 'alpha', value: '1' },
      { key: 'beta', value: '2' },
      { key: 'gamma', value: '3' },
    ]);
  });

  // ================================================================
  // Case 8: listMetadataForVersion returns [] (NOT [null]) for empty sets — RESEARCH Pitfall #2
  // ================================================================
  it('listMetadataForVersion returns [] (NOT [null]) for a version with no metadata — RESEARCH Pitfall #2 guard', () => {
    const result = repo.listMetadataForVersion(versionId);
    expect(result).toEqual([]);
    expect(result).not.toContain(null);
  });

  // ================================================================
  // Case 9: countMetadataForVersion returns 0 / N (D-ASST-11 engine cap support)
  // ================================================================
  it('countMetadataForVersion returns 0 initially and N after N distinct upsertMetadata calls (D-ASST-11 support)', () => {
    expect(repo.countMetadataForVersion(versionId)).toBe(0);
    repo.upsertMetadata(versionId, 'a', '1');
    repo.upsertMetadata(versionId, 'b', '2');
    repo.upsertMetadata(versionId, 'c', '3');
    expect(repo.countMetadataForVersion(versionId)).toBe(3);

    // Upserting existing key does NOT increment count (UNIQUE(version_id, key)).
    repo.upsertMetadata(versionId, 'a', '1-updated');
    expect(repo.countMetadataForVersion(versionId)).toBe(3);
  });

  // ================================================================
  // Case 10: listMetadataKeysInScope shot scope — aggregates under that shot (count DESC, name ASC)
  // ================================================================
  it('listMetadataKeysInScope({shot_id}) aggregates metadata keys under that shot, ordered count DESC then name ASC', () => {
    const built = buildSmallHierarchy();
    const localRepo = new MetadataRepo(built.db, built.v);
    const ver2 = built.v.insertVersion(built.shot.id);
    localRepo.upsertMetadata(built.ver.id, 'artist', 'tim');
    localRepo.upsertMetadata(built.ver.id, 'department', 'lighting');
    localRepo.upsertMetadata(ver2.id, 'artist', 'bob');

    const result = localRepo.listMetadataKeysInScope({ shot_id: built.shot.id }, 20, 0);
    expect(result.items).toEqual([
      { name: 'artist', count: 2 },
      { name: 'department', count: 1 },
    ]);
    expect(result.total_count).toBe(2); // distinct key count
  });

  // ================================================================
  // Case 11: listMetadataKeysInScope workspace scope (D-ASST-06)
  // ================================================================
  it('listMetadataKeysInScope({workspace_id}) aggregates across all versions under that workspace', () => {
    const built = buildMultiProjectHierarchy();
    const localRepo = new MetadataRepo(built.db, built.v);
    localRepo.upsertMetadata(built.verA1.id, 'projA_key', 'x');
    localRepo.upsertMetadata(built.verA2.id, 'shared_key', 'y');
    localRepo.upsertMetadata(built.verB1.id, 'projB_key', 'z');
    localRepo.upsertMetadata(built.verB2.id, 'shared_key', 'w');

    const result = localRepo.listMetadataKeysInScope({ workspace_id: built.ws.id }, 20, 0);
    const names = result.items.map((i) => i.name).sort();
    expect(names).toEqual(['projA_key', 'projB_key', 'shared_key']);
    expect(result.items[0]).toEqual({ name: 'shared_key', count: 2 });
    expect(result.total_count).toBe(3);
  });

  // ================================================================
  // Case 12: listMetadataKeysInScope({}) returns all keys globally
  // ================================================================
  it('listMetadataKeysInScope({}) (empty scope = global) returns all unique keys across the entire DB', () => {
    const built = buildMultiProjectHierarchy();
    const localRepo = new MetadataRepo(built.db, built.v);
    localRepo.upsertMetadata(built.verA1.id, 'alpha', '1');
    localRepo.upsertMetadata(built.verB1.id, 'beta', '2');
    localRepo.upsertMetadata(built.verB2.id, 'gamma', '3');

    const result = localRepo.listMetadataKeysInScope({}, 20, 0);
    const names = result.items.map((i) => i.name).sort();
    expect(names).toEqual(['alpha', 'beta', 'gamma']);
    expect(result.total_count).toBe(3);
  });

  // ================================================================
  // Case 13: listMetadataKeysInScope pagination
  // ================================================================
  it('listMetadataKeysInScope respects limit/offset pagination while preserving total_count', () => {
    const built = buildMultiProjectHierarchy();
    const localRepo = new MetadataRepo(built.db, built.v);
    localRepo.upsertMetadata(built.verA1.id, 'aaa', '1');
    localRepo.upsertMetadata(built.verA1.id, 'bbb', '1');
    localRepo.upsertMetadata(built.verA2.id, 'bbb', '2'); // bbb: 2 distinct versions use it
    localRepo.upsertMetadata(built.verB1.id, 'ccc', '1');
    localRepo.upsertMetadata(built.verB2.id, 'ddd', '1');

    const page1 = localRepo.listMetadataKeysInScope({ workspace_id: built.ws.id }, 2, 0);
    expect(page1.items.length).toBe(2);
    expect(page1.items[0]).toEqual({ name: 'bbb', count: 2 });
    expect(page1.items[1]).toEqual({ name: 'aaa', count: 1 });
    expect(page1.total_count).toBe(4);

    const page2 = localRepo.listMetadataKeysInScope({ workspace_id: built.ws.id }, 2, 2);
    expect(page2.items.length).toBe(2);
    expect(page2.items.map((i) => i.name)).toEqual(['ccc', 'ddd']);
    expect(page2.total_count).toBe(4);
  });
});
