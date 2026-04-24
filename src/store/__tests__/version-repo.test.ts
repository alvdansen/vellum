import { describe, test, expect, beforeEach, vi } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';

/**
 * Tests for VersionRepo per D-GEN-16 + D-GEN-18 + D-GEN-20.
 * Covers:
 *  - version_number MAX+1 monotonicity per shot
 *  - UNIQUE violation retry → CONCURRENT_SUBMIT_CONFLICT on second failure
 *  - completed_at immutability via WHERE completed_at IS NULL guard
 *  - state transition helpers (transition/markFailed/markCompleted)
 *  - listPendingVersions for the recovery poller (D-GEN-28)
 */

describe('VersionRepo — allocation, state transitions, immutability', () => {
  let repo: VersionRepo;
  let hierarchy: HierarchyRepo;
  let shotId: string;
  let shotB: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new VersionRepo(db);
    hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    const shot2 = hierarchy.createShot(seq.id, 'sh020');
    shotId = shot.id;
    shotB = shot2.id;
  });

  test('first insert has version_number = 1 and status submitted', () => {
    const v = repo.insertVersion(shotId);
    expect(v.version_number).toBe(1);
    expect(v.status).toBe('submitted');
    expect(v.id).toMatch(/^ver_/);
    expect(v.job_id).toBeNull();
    expect(v.completed_at).toBeNull();
    expect(v.error_code).toBeNull();
    expect(v.error_message).toBeNull();
    expect(v.outputs_json).toBeNull();
  });

  test('version_number monotone per shot', () => {
    const nums = [1, 2, 3, 4, 5].map(() => repo.insertVersion(shotId).version_number);
    expect(nums).toEqual([1, 2, 3, 4, 5]);
  });

  test('version_number independent per shot', () => {
    const a = repo.insertVersion(shotId);
    const b = repo.insertVersion(shotB);
    expect(a.version_number).toBe(1);
    expect(b.version_number).toBe(1);
  });

  test('concurrent UNIQUE violation retries once, second UNIQUE surfaces CONCURRENT_SUBMIT_CONFLICT', () => {
    // Force the first attempt to throw a SQLITE_CONSTRAINT_UNIQUE, then let the retry succeed.
    const original = (repo as unknown as { doInsert: (shotId: string, notes?: string) => unknown })
      .doInsert.bind(repo);
    let calls = 0;
    vi.spyOn(repo as unknown as { doInsert: (...args: unknown[]) => unknown }, 'doInsert').mockImplementation(
      (...args: unknown[]) => {
        calls++;
        if (calls === 1) {
          const err = new Error('UNIQUE constraint failed') as Error & { code?: string };
          err.code = 'SQLITE_CONSTRAINT_UNIQUE';
          throw err;
        }
        return original(...(args as [string, string?]));
      },
    );
    const v = repo.insertVersion(shotId);
    expect(v.version_number).toBe(1);
    expect(calls).toBe(2); // one miss + one retry

    // Force TWO consecutive UNIQUE → expect CONCURRENT_SUBMIT_CONFLICT
    vi.restoreAllMocks();
    calls = 0;
    vi.spyOn(repo as unknown as { doInsert: (...args: unknown[]) => unknown }, 'doInsert').mockImplementation(
      () => {
        calls++;
        const err = new Error('UNIQUE constraint failed') as Error & { code?: string };
        err.code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw err;
      },
    );
    expect(() => repo.insertVersion(shotId)).toThrowTypedError('CONCURRENT_SUBMIT_CONFLICT');
  });

  test('completed_at immutability: markFailed after markCompleted is a no-op', () => {
    const v = repo.insertVersion(shotId);
    repo.markCompleted(v.id, '[{"filename":"a.png"}]');
    const afterOk = repo.getVersion(v.id)!;
    expect(afterOk.status).toBe('completed');
    const completedAt1 = afterOk.completed_at!;

    // Second terminal call is guarded by WHERE completed_at IS NULL
    repo.markFailed(v.id, 'DOWNLOAD_FAILED', 'boom');
    const afterFail = repo.getVersion(v.id)!;
    expect(afterFail.status).toBe('completed'); // unchanged
    expect(afterFail.error_code).toBeNull(); // unchanged
    expect(afterFail.completed_at).toBe(completedAt1); // unchanged
  });

  test('IT-17: completed_at immutability: markCompleted after markFailed is a no-op (reverse direction)', () => {
    const v = repo.insertVersion(shotId);
    repo.markFailed(v.id, 'COMFYUI_API_ERROR', 'first-fail');
    const afterFail = repo.getVersion(v.id)!;
    expect(afterFail.status).toBe('failed');
    expect(afterFail.error_code).toBe('COMFYUI_API_ERROR');
    expect(afterFail.error_message).toBe('first-fail');
    const completedAt1 = afterFail.completed_at!;

    // A belated success (e.g., a racing poller) must NOT regress the row:
    // WHERE completed_at IS NULL on markCompleted makes it a no-op.
    repo.markCompleted(v.id, '[{"filename":"late.png"}]');
    const afterOk = repo.getVersion(v.id)!;
    expect(afterOk.status).toBe('failed'); // unchanged
    expect(afterOk.error_code).toBe('COMFYUI_API_ERROR'); // unchanged
    expect(afterOk.error_message).toBe('first-fail'); // unchanged
    expect(afterOk.outputs_json).toBeNull(); // unchanged
    expect(afterOk.completed_at).toBe(completedAt1); // unchanged
  });

  test('markFailed sets status, error_code, error_message, completed_at', () => {
    const v = repo.insertVersion(shotId);
    repo.markFailed(v.id, 'COMFYUI_API_ERROR', 'boom');
    const got = repo.getVersion(v.id)!;
    expect(got.status).toBe('failed');
    expect(got.error_code).toBe('COMFYUI_API_ERROR');
    expect(got.error_message).toBe('boom');
    expect(typeof got.completed_at).toBe('number');
  });

  test('markCompleted sets status, outputs_json, completed_at', () => {
    const v = repo.insertVersion(shotId);
    repo.markCompleted(v.id, '[{"filename":"a.png"}]');
    const got = repo.getVersion(v.id)!;
    expect(got.status).toBe('completed');
    expect(got.outputs_json).toBe('[{"filename":"a.png"}]');
    expect(typeof got.completed_at).toBe('number');
  });

  test('transition submitted → running leaves completed_at null', () => {
    const v = repo.insertVersion(shotId);
    repo.transition(v.id, 'running');
    const got = repo.getVersion(v.id)!;
    expect(got.status).toBe('running');
    expect(got.completed_at).toBeNull();
  });

  test('C2: transition is a no-op once the row has reached a terminal state (completed)', () => {
    // Race guard: recovery poller + tool-path caller race. Poller drives row to
    // completed. Tool path, holding a stale 'submitted' snapshot, sees a 'running'
    // remote status and calls transition(). Without the WHERE guard, the row
    // regresses: status='running' but completed_at/outputs_json already populated.
    const v = repo.insertVersion(shotId);
    repo.markCompleted(v.id, '[{"filename":"a.png"}]');
    const afterComplete = repo.getVersion(v.id)!;
    const completedAt = afterComplete.completed_at!;
    repo.transition(v.id, 'running');
    const afterTransition = repo.getVersion(v.id)!;
    expect(afterTransition.status).toBe('completed');
    expect(afterTransition.completed_at).toBe(completedAt);
    expect(afterTransition.outputs_json).toBe('[{"filename":"a.png"}]');
  });

  test('C2: transition is a no-op once the row has reached a terminal state (failed)', () => {
    const v = repo.insertVersion(shotId);
    repo.markFailed(v.id, 'DOWNLOAD_FAILED', 'net');
    const before = repo.getVersion(v.id)!;
    repo.transition(v.id, 'running');
    const after = repo.getVersion(v.id)!;
    expect(after.status).toBe('failed');
    expect(after.error_code).toBe('DOWNLOAD_FAILED');
    expect(after.completed_at).toBe(before.completed_at);
  });

  test('listPendingVersions returns only submitted|running rows', () => {
    const a = repo.insertVersion(shotId);
    const b = repo.insertVersion(shotId);
    const c = repo.insertVersion(shotId);
    repo.transition(b.id, 'running');
    repo.markCompleted(c.id, '[]');
    const pending = repo
      .listPendingVersions()
      .map((v) => v.id)
      .sort();
    expect(pending).toEqual([a.id, b.id].sort());
  });

  test('getVersion returns null for unknown id', () => {
    expect(repo.getVersion('ver_nonexistent')).toBeNull();
  });

  test('setJobId updates job_id on an existing row', () => {
    const v = repo.insertVersion(shotId);
    repo.setJobId(v.id, 'prompt_xyz');
    const got = repo.getVersion(v.id)!;
    expect(got.job_id).toBe('prompt_xyz');
  });
});

describe('VersionRepo.insertVersion — Phase 3 lineage params (D-PROV-33)', () => {
  let repo: VersionRepo;
  let hierarchy: HierarchyRepo;
  let shotId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new VersionRepo(db);
    hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    shotId = shot.id;
  });

  test('omitted lineage → parent_version_id=null, lineage_type=null (Phase 2 default)', () => {
    const v = repo.insertVersion(shotId);
    expect(v.parent_version_id).toBeNull();
    expect(v.lineage_type).toBeNull();
  });

  test('empty lineage object → parent_version_id=null, lineage_type=null', () => {
    const v = repo.insertVersion(shotId, undefined, {});
    expect(v.parent_version_id).toBeNull();
    expect(v.lineage_type).toBeNull();
  });

  test("lineage: reproduce → parent_version_id + lineage_type='reproduce' set at INSERT", () => {
    const parent = repo.insertVersion(shotId);
    const child = repo.insertVersion(shotId, 'reproduced', {
      parent_version_id: parent.id,
      lineage_type: 'reproduce',
    });
    expect(child.parent_version_id).toBe(parent.id);
    expect(child.lineage_type).toBe('reproduce');
    expect(child.notes).toBe('reproduced');
    expect(child.version_number).toBe(2);
  });

  test("lineage: iterate → parent_version_id + lineage_type='iterate' set at INSERT", () => {
    const parent = repo.insertVersion(shotId);
    const child = repo.insertVersion(shotId, undefined, {
      parent_version_id: parent.id,
      lineage_type: 'iterate',
    });
    expect(child.parent_version_id).toBe(parent.id);
    expect(child.lineage_type).toBe('iterate');
  });

  test('round-trip via getVersion preserves lineage fields', () => {
    const parent = repo.insertVersion(shotId);
    const child = repo.insertVersion(shotId, undefined, {
      parent_version_id: parent.id,
      lineage_type: 'reproduce',
    });
    const reloaded = repo.getVersion(child.id)!;
    expect(reloaded.parent_version_id).toBe(parent.id);
    expect(reloaded.lineage_type).toBe('reproduce');
  });

  test('lineage params do not break existing version_number monotonicity on the shot', () => {
    const parent = repo.insertVersion(shotId);
    const child1 = repo.insertVersion(shotId, undefined, {
      parent_version_id: parent.id,
      lineage_type: 'reproduce',
    });
    const child2 = repo.insertVersion(shotId, undefined, {
      parent_version_id: parent.id,
      lineage_type: 'iterate',
    });
    expect([parent.version_number, child1.version_number, child2.version_number]).toEqual([1, 2, 3]);
  });
});

describe('VersionRepo.listRecentCompleted', () => {
  let repo: VersionRepo;
  let hierarchy: HierarchyRepo;
  let shotId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new VersionRepo(db);
    hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws_recent');
    const proj = hierarchy.createProject(ws.id, 'p_recent');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    shotId = shot.id;
  });

  test('returns [] on empty DB', () => {
    expect(repo.listRecentCompleted(10)).toEqual([]);
  });

  test('orders results by completed_at DESC', () => {
    // Insert 3 versions, mark each completed with distinct timestamps.
    // markCompleted stamps completed_at = Date.now(); use direct SQL UPDATE
    // to set deterministic values for an ordering assertion.
    const v1 = repo.insertVersion(shotId);
    const v2 = repo.insertVersion(shotId);
    const v3 = repo.insertVersion(shotId);
    repo.markCompleted(v1.id, '[]');
    repo.markCompleted(v2.id, '[]');
    repo.markCompleted(v3.id, '[]');
    // Force distinct completed_at via raw UPDATE on the existing repo's client
    // (better-sqlite3 statements on (repo as any).db.$client) — set
    // completed_at = 1000/2000/3000 explicitly for deterministic ordering.
    const client = (repo as unknown as { db: { $client: { exec: (s: string) => void; prepare: (s: string) => { run: (...a: unknown[]) => void } } } }).db.$client;
    client.prepare('UPDATE versions SET completed_at = ? WHERE id = ?').run(1000, v1.id);
    client.prepare('UPDATE versions SET completed_at = ? WHERE id = ?').run(2000, v2.id);
    client.prepare('UPDATE versions SET completed_at = ? WHERE id = ?').run(3000, v3.id);

    const rows = repo.listRecentCompleted(10);
    expect(rows.map((r) => r.id)).toEqual([v3.id, v2.id, v1.id]);
  });

  test("filters out non-'completed' rows (submitted/failed/running excluded)", () => {
    const v1 = repo.insertVersion(shotId); // status='submitted' default
    const v2 = repo.insertVersion(shotId);
    const v3 = repo.insertVersion(shotId);
    const v4 = repo.insertVersion(shotId);
    const v5 = repo.insertVersion(shotId);
    const v6 = repo.insertVersion(shotId);
    const v7 = repo.insertVersion(shotId);
    const v8 = repo.insertVersion(shotId);
    // Mark 5 completed.
    [v1, v2, v3, v4, v5].forEach((v) => repo.markCompleted(v.id, '[]'));
    // Mark 1 failed (status='failed').
    repo.markFailed(v6.id, 'COMFYUI_API_ERROR', 'test failure');
    // v7 stays submitted, v8 stays submitted.
    void v7;
    void v8;

    const rows = repo.listRecentCompleted(20);
    expect(rows).toHaveLength(5);
    rows.forEach((r) => expect(r.status).toBe('completed'));
  });

  test('limit caps the result count', () => {
    // Insert 12 completed versions.
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const v = repo.insertVersion(shotId);
      repo.markCompleted(v.id, '[]');
      ids.push(v.id);
    }
    const rows = repo.listRecentCompleted(10);
    expect(rows).toHaveLength(10);
    rows.forEach((r) => expect(r.status).toBe('completed'));
  });

  test('limit=0 returns [] (boundary)', () => {
    const v1 = repo.insertVersion(shotId);
    repo.markCompleted(v1.id, '[]');
    expect(repo.listRecentCompleted(0)).toEqual([]);
  });
});
