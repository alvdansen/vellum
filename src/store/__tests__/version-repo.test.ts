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
