import { describe, it, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import { TagRepo } from '../tag-repo.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteClient } from 'better-sqlite3';
import type * as schema from '../schema.js';

/** Widened Db type — factory intersection surface `$client` for raw SQL. */
type DbWithClient = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

/**
 * Tests for TagRepo (Phase 4 — D-ASST-03, D-ASST-04, D-ASST-06, D-ASST-19).
 *
 * Traceability:
 *   - INV-ASST-01 → test "insertTag on existing (version_id, tag) returns success, leaves row unchanged"
 *   - INV-ASST-02 → test "deleteTag on missing (version_id, tag) pair is a no-op"
 *
 * Covers:
 *  - insertTag idempotency (D-ASST-03 — INSERT ON CONFLICT DO NOTHING with follow-up SELECT)
 *  - Version pre-check (RESEARCH Pitfall #3 — VERSION_NOT_FOUND, no SQLITE_CONSTRAINT_FOREIGNKEY leak)
 *  - deleteTag idempotency (D-ASST-03)
 *  - listTagsForVersion alphabetical ASC (D-ASST-04 / D-ASST-19)
 *  - listTagsForVersion returns [] not [null] for empty sets (RESEARCH Pitfall #2)
 *  - countTagsForVersion for engine cap enforcement (D-ASST-11)
 *  - listTagsInScope for workspace/project/sequence/shot + global (D-ASST-06, RESEARCH Operation 5)
 */

/** Intentional duplication — Plan 04-02 keeps repo tests independent; Plan 05 may extract. */
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

/**
 * Build a two-project hierarchy for workspace-scope aggregation tests.
 * One workspace, two projects, each with one sequence + one shot + one version.
 * Each version gets a distinct tag for assert-by-name coverage.
 */
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

describe('TagRepo — idempotent insert, scope aggregation, hydration (INV-ASST-01, INV-ASST-02)', () => {
  let db: DbWithClient;
  let repo: TagRepo;
  let versionRepo: VersionRepo;
  let versionId: string;

  beforeEach(() => {
    const built = buildSmallHierarchy();
    db = built.db;
    versionRepo = built.v;
    repo = new TagRepo(db, versionRepo);
    versionId = built.ver.id;
  });

  // ================================================================
  // Case 1: first insertTag returns { id, inserted: true }, row exists
  // ================================================================
  it('insertTag on a new (version_id, tag) pair inserts one row and returns { id, inserted: true }', () => {
    const result = repo.insertTag(versionId, 'hero');
    expect(result.id).toMatch(/^tag_.+/);
    expect(result.inserted).toBe(true);

    // Verify the row is actually in the DB
    const row = db.$client
      .prepare('SELECT id, version_id, tag FROM tags WHERE id = ?')
      .get(result.id) as { id: string; version_id: string; tag: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.version_id).toBe(versionId);
    expect(row?.tag).toBe('hero');
  });

  // ================================================================
  // Case 2: INV-ASST-01 — second insertTag on same pair returns same id, inserted: false
  // ================================================================
  it('INV-ASST-01: insertTag on an existing (version_id, tag) pair returns { id: existing, inserted: false }', () => {
    const first = repo.insertTag(versionId, 'hero');
    expect(first.inserted).toBe(true);

    const second = repo.insertTag(versionId, 'hero');
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id); // same id — the contract guarantees the existing row's id
  });

  // ================================================================
  // Case 3: UNIQUE(version_id, tag) — only one row after duplicate inserts
  // ================================================================
  it('INV-ASST-01: after duplicate insertTag calls, exactly one row exists (UNIQUE constraint)', () => {
    repo.insertTag(versionId, 'hero');
    repo.insertTag(versionId, 'hero');
    repo.insertTag(versionId, 'hero');

    const countRow = db.$client
      .prepare('SELECT COUNT(*) AS n FROM tags WHERE version_id = ? AND tag = ?')
      .get(versionId, 'hero') as { n: number };
    expect(countRow.n).toBe(1);
  });

  // ================================================================
  // Case 4: pre-check version — missing version_id throws VERSION_NOT_FOUND (RESEARCH Pitfall #3)
  // ================================================================
  it('insertTag on a missing version_id throws TypedError("VERSION_NOT_FOUND") — no SQLITE_CONSTRAINT_FOREIGNKEY leak', () => {
    expect(() => repo.insertTag('ver_bogus_id_does_not_exist', 'hero')).toThrowTypedError(
      'VERSION_NOT_FOUND',
    );
  });

  // ================================================================
  // Case 5: INV-ASST-02 — deleteTag on missing pair is a no-op
  // ================================================================
  it('INV-ASST-02: deleteTag on a missing (version_id, tag) pair returns void and throws nothing', () => {
    expect(() => repo.deleteTag(versionId, 'non-existent-tag')).not.toThrow();
    // Nothing was written; the tags table remains empty for this version.
    const countRow = db.$client
      .prepare('SELECT COUNT(*) AS n FROM tags WHERE version_id = ?')
      .get(versionId) as { n: number };
    expect(countRow.n).toBe(0);
  });

  // ================================================================
  // Case 6: deleteTag removes an existing tag; list no longer includes it
  // ================================================================
  it('deleteTag removes an existing (version_id, tag) row; listTagsForVersion no longer includes it', () => {
    repo.insertTag(versionId, 'hero');
    repo.insertTag(versionId, 'keeper');
    expect(repo.listTagsForVersion(versionId)).toEqual(['hero', 'keeper']);

    repo.deleteTag(versionId, 'hero');
    expect(repo.listTagsForVersion(versionId)).toEqual(['keeper']);
  });

  // ================================================================
  // Case 7: listTagsForVersion returns alphabetical ASC (D-ASST-04 / D-ASST-19)
  // ================================================================
  it('listTagsForVersion returns tags alphabetically ASC regardless of insert order (D-ASST-04 / D-ASST-19)', () => {
    repo.insertTag(versionId, 'gamma');
    repo.insertTag(versionId, 'alpha');
    repo.insertTag(versionId, 'beta');

    expect(repo.listTagsForVersion(versionId)).toEqual(['alpha', 'beta', 'gamma']);
  });

  // ================================================================
  // Case 8: listTagsForVersion returns [] (NOT [null]) for empty sets — RESEARCH Pitfall #2
  // ================================================================
  it('listTagsForVersion returns [] (NOT [null]) for a version with no tags — RESEARCH Pitfall #2 guard', () => {
    const result = repo.listTagsForVersion(versionId);
    expect(result).toEqual([]);
    expect(result).not.toContain(null);
  });

  // ================================================================
  // Case 9: countTagsForVersion returns 0 / N (D-ASST-11 engine cap support)
  // ================================================================
  it('countTagsForVersion returns 0 for a tag-free version and N after N insertTag calls (D-ASST-11 support)', () => {
    expect(repo.countTagsForVersion(versionId)).toBe(0);
    repo.insertTag(versionId, 'a');
    repo.insertTag(versionId, 'b');
    repo.insertTag(versionId, 'c');
    expect(repo.countTagsForVersion(versionId)).toBe(3);
  });

  // ================================================================
  // Case 10: listTagsInScope with shot_id scope — aggregates under that shot only (count DESC, name ASC)
  // ================================================================
  it('listTagsInScope({shot_id}) aggregates tags under that shot, ordered count DESC then name ASC', () => {
    const built = buildSmallHierarchy();
    const localRepo = new TagRepo(built.db, built.v);
    // Add a second version to the shot to exercise cross-version aggregation.
    const ver2 = built.v.insertVersion(built.shot.id);
    localRepo.insertTag(built.ver.id, 'hero');
    localRepo.insertTag(built.ver.id, 'final');
    localRepo.insertTag(ver2.id, 'hero');

    const result = localRepo.listTagsInScope({ shot_id: built.shot.id }, 20, 0);
    expect(result.items).toEqual([
      { name: 'hero', count: 2 },
      { name: 'final', count: 1 },
    ]);
    expect(result.total_count).toBe(2); // distinct tag count
  });

  // ================================================================
  // Case 11: listTagsInScope with workspace_id aggregates across multiple projects (D-ASST-06)
  // ================================================================
  it('listTagsInScope({workspace_id}) aggregates across all versions under that workspace', () => {
    const built = buildMultiProjectHierarchy();
    const localRepo = new TagRepo(built.db, built.v);
    localRepo.insertTag(built.verA1.id, 'projA_tag');
    localRepo.insertTag(built.verA2.id, 'shared');
    localRepo.insertTag(built.verB1.id, 'projB_tag');
    localRepo.insertTag(built.verB2.id, 'shared');

    const result = localRepo.listTagsInScope({ workspace_id: built.ws.id }, 20, 0);
    const names = result.items.map((i) => i.name).sort();
    expect(names).toEqual(['projA_tag', 'projB_tag', 'shared']);
    // shared appears twice, projA_tag and projB_tag once each → count DESC, name ASC
    expect(result.items[0]).toEqual({ name: 'shared', count: 2 });
    expect(result.total_count).toBe(3);
  });

  // ================================================================
  // Case 12: listTagsInScope({}) returns all tags globally
  // ================================================================
  it('listTagsInScope({}) (empty scope = global) returns all unique tags across the entire DB', () => {
    const built = buildMultiProjectHierarchy();
    const localRepo = new TagRepo(built.db, built.v);
    localRepo.insertTag(built.verA1.id, 'alpha');
    localRepo.insertTag(built.verB1.id, 'beta');
    localRepo.insertTag(built.verB2.id, 'gamma');

    const result = localRepo.listTagsInScope({}, 20, 0);
    const names = result.items.map((i) => i.name).sort();
    expect(names).toEqual(['alpha', 'beta', 'gamma']);
    expect(result.total_count).toBe(3);
  });

  // ================================================================
  // Case 13: listTagsInScope pagination — limit + offset slice the tag list
  // ================================================================
  it('listTagsInScope respects limit/offset pagination while preserving total_count', () => {
    const built = buildMultiProjectHierarchy();
    const localRepo = new TagRepo(built.db, built.v);
    // Insert 5 distinct tags with varying counts so ORDER BY is deterministic.
    localRepo.insertTag(built.verA1.id, 'aaa');
    localRepo.insertTag(built.verA1.id, 'bbb');
    localRepo.insertTag(built.verA2.id, 'bbb'); // bbb count=2
    localRepo.insertTag(built.verB1.id, 'ccc');
    localRepo.insertTag(built.verB2.id, 'ddd');

    const page1 = localRepo.listTagsInScope({ workspace_id: built.ws.id }, 2, 0);
    expect(page1.items.length).toBe(2);
    // count DESC, name ASC: bbb(2) first, then aaa/ccc/ddd (all count=1) alphabetical — page1 = bbb + aaa
    expect(page1.items[0]).toEqual({ name: 'bbb', count: 2 });
    expect(page1.items[1]).toEqual({ name: 'aaa', count: 1 });
    expect(page1.total_count).toBe(4); // distinct tags across workspace

    const page2 = localRepo.listTagsInScope({ workspace_id: built.ws.id }, 2, 2);
    expect(page2.items.length).toBe(2);
    expect(page2.items.map((i) => i.name)).toEqual(['ccc', 'ddd']);
    expect(page2.total_count).toBe(4);
  });
});
