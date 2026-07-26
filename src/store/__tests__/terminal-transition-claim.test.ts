// src/store/__tests__/terminal-transition-claim.test.ts
//
// REGRESSION — the append-only record must not gain a duplicate completion or a
// self-contradicting pair, no matter how many processes are polling.
//
// Provenance events used to be written BEFORE the guarded row UPDATE, and gated
// (on the completed side only) by `getLatestCompletedEvent(id) === null`. That
// is a read-then-write across two unlocked statements: in WAL mode a second
// process reads a snapshot predating the first one's commit, so both observe
// "absent" and both append. There is no unique index on (version_id,
// event_type) to catch it. The failed side had no gate at all, so a version
// could carry a permanent `failed` event on a row that reads `completed`.
//
// The fix makes the guarded UPDATE itself the arbiter: `WHERE completed_at IS
// NULL` in a single autocommit statement is serialized by SQLite, so exactly one
// caller — in any process — sees `changes === 1`. These tests pin that claim
// with two REAL connections on one database file, which is what two server
// processes are (the README documents running two).

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.js';
import { VersionRepo } from '../version-repo.js';
import { ProvenanceRepo } from '../provenance-repo.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { ProvenanceWriter } from '../../engine/provenance.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  dirs.length = 0;
});

/** Two independent connections on one database file — i.e. two server processes. */
function twoProcesses(): {
  a: { versions: VersionRepo; provenance: ProvenanceRepo; writer: ProvenanceWriter };
  b: { versions: VersionRepo; provenance: ProvenanceRepo; writer: ProvenanceWriter };
  versionId: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'vellum-terminal-claim-'));
  dirs.push(dir);
  const file = join(dir, 'vellum.db');

  const { db: dbA } = openDb(file);
  const { db: dbB } = openDb(file);

  const hier = new HierarchyRepo(dbA);
  const ws = hier.createWorkspace('ws');
  const proj = hier.createProject(ws.id, 'proj');
  const seq = hier.createSequence(proj.id, 'seq');
  const shot = hier.createShot(seq.id, 'sh010');

  const versionsA = new VersionRepo(dbA);
  const row = versionsA.insertVersion(shot.id);
  versionsA.setJobId(row.id, 'job-1');

  const mk = (db: typeof dbA) => {
    const provenance = new ProvenanceRepo(db);
    return { versions: new VersionRepo(db), provenance, writer: new ProvenanceWriter(provenance) };
  };
  return { a: mk(dbA), b: mk(dbB), versionId: row.id };
}

function countEvents(p: ProvenanceRepo, versionId: string, type: string): number {
  return p.getEventsForVersion(versionId).filter((e) => e.event_type === type).length;
}

describe('terminal transitions are an atomic claim across processes', () => {
  test('exactly one of two processes wins markCompleted', () => {
    const { a, b, versionId } = twoProcesses();
    const wins = [
      a.versions.markCompleted(versionId, '[]'),
      b.versions.markCompleted(versionId, '[]'),
    ];
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  test('exactly one of two processes wins markFailed', () => {
    const { a, b, versionId } = twoProcesses();
    const wins = [
      a.versions.markFailed(versionId, 'DOWNLOAD_FAILED', 'x'),
      b.versions.markFailed(versionId, 'DOWNLOAD_FAILED', 'y'),
    ];
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  test('a second process cannot fail a version another already completed', () => {
    // The contradiction direction, and the one that needed no race at all:
    // writeFailedEvent had NO guard, so this appended `failed` to a version
    // whose row reads `completed` — permanently, because provenance is
    // append-only.
    const { a, b, versionId } = twoProcesses();

    expect(a.versions.markCompleted(versionId, '[]')).toBe(true);
    a.writer.writeCompletedEvent(versionId, null, '[]', null);

    const bWon = b.versions.markFailed(versionId, 'GENERATION_TIMEOUT', 'timed out');
    expect(bWon).toBe(false);
    if (bWon) b.writer.writeFailedEvent(versionId, 'GENERATION_TIMEOUT', 'timed out');

    expect(countEvents(a.provenance, versionId, 'completed')).toBe(1);
    expect(countEvents(a.provenance, versionId, 'failed')).toBe(0);
    expect(a.versions.getVersion(versionId)!.status).toBe('completed');
  });

  test('a second process cannot complete a version another already failed', () => {
    // The mirror image, reachable without any injected failure: process B's poll
    // lands past the 10-minute deadline while process A is mid-download.
    const { a, b, versionId } = twoProcesses();

    expect(a.versions.markFailed(versionId, 'GENERATION_TIMEOUT', 'timed out')).toBe(true);
    a.writer.writeFailedEvent(versionId, 'GENERATION_TIMEOUT', 'timed out');

    const bWon = b.versions.markCompleted(versionId, '[{"filename":"out.png"}]');
    expect(bWon).toBe(false);
    if (bWon) b.writer.writeCompletedEvent(versionId, null, '[]', null);

    expect(countEvents(a.provenance, versionId, 'failed')).toBe(1);
    expect(countEvents(a.provenance, versionId, 'completed')).toBe(0);
  });

  test('the winner is decided by the row, not by a read-then-write event lookup', () => {
    // What the old gate did: both processes read "no completed event yet"
    // BEFORE either committed, so both appended. Reproduced literally here by
    // taking both reads before either write — the exact interleaving WAL allows.
    const { a, b, versionId } = twoProcesses();

    const aSawNone = a.provenance.getLatestCompletedEvent(versionId) === null;
    const bSawNone = b.provenance.getLatestCompletedEvent(versionId) === null;
    expect(aSawNone && bSawNone).toBe(true); // the premise the old gate trusted

    // Under the fix the row transition, not that stale read, decides.
    const aWon = a.versions.markCompleted(versionId, '[]');
    const bWon = b.versions.markCompleted(versionId, '[]');
    if (aWon) a.writer.writeCompletedEvent(versionId, null, '[]', null);
    if (bWon) b.writer.writeCompletedEvent(versionId, null, '[]', null);

    expect(countEvents(a.provenance, versionId, 'completed')).toBe(1);
  });
});

describe('the claim and its provenance event are one unit', () => {
  // REGRESSION for the fix above. Gating the event on the claim made the event
  // FOLLOW the transition, which is what stops two processes writing
  // contradictory records — but it also made the two separately failable. If
  // the row flipped terminal and the event INSERT then threw (full disk, I/O
  // error, lock timeout), the version was left permanently terminal with NO
  // terminal event, and nothing could repair it: the status read short-circuits
  // terminal rows, the recovery poller only scans non-terminal ones, and
  // provenance is append-only by design. `reproduce` and `iterate` are blocked
  // on that version forever.
  //
  // The pre-inversion order self-healed this, because a failed event write left
  // the row non-terminal and the next poll retried. One transaction keeps the
  // atomic claim and restores that property.

  test('a throwing completed-event append rolls the transition back', () => {
    const { a, versionId } = twoProcesses();

    expect(() =>
      a.versions.markCompletedAtomic(versionId, '[]', () => {
        throw new Error('SQLITE_IOERR: disk failure');
      }),
    ).toThrow(/disk failure/);

    // The row must NOT be terminal — that is what makes the next poll retry.
    const row = a.versions.getVersion(versionId)!;
    expect(row.status).not.toBe('completed');
    expect(row.completed_at).toBeNull();
    expect(countEvents(a.provenance, versionId, 'completed')).toBe(0);
  });

  test('a throwing failed-event append rolls the transition back', () => {
    const { a, versionId } = twoProcesses();

    expect(() =>
      a.versions.markFailedAtomic(versionId, 'DOWNLOAD_FAILED', 'x', () => {
        throw new Error('SQLITE_FULL: database or disk is full');
      }),
    ).toThrow(/disk is full/);

    const row = a.versions.getVersion(versionId)!;
    expect(row.status).not.toBe('failed');
    expect(row.completed_at).toBeNull();
    expect(countEvents(a.provenance, versionId, 'failed')).toBe(0);
  });

  test('after a rolled-back attempt the version can still be completed cleanly', () => {
    // The point of the rollback: the state is recoverable, not wedged.
    const { a, versionId } = twoProcesses();

    expect(() =>
      a.versions.markCompletedAtomic(versionId, '[]', () => {
        throw new Error('transient');
      }),
    ).toThrow();

    const won = a.versions.markCompletedAtomic(versionId, '[{"filename":"out.png"}]', () =>
      a.writer.writeCompletedEvent(versionId, null, '[{"filename":"out.png"}]', null),
    );
    expect(won).toBe(true);
    expect(a.versions.getVersion(versionId)!.status).toBe('completed');
    expect(countEvents(a.provenance, versionId, 'completed')).toBe(1);
  });

  test('the atomic form still decides exactly one winner across processes', () => {
    // The property the transaction must not cost us.
    const { a, b, versionId } = twoProcesses();
    const wins = [
      a.versions.markCompletedAtomic(versionId, '[]', () =>
        a.writer.writeCompletedEvent(versionId, null, '[]', null),
      ),
      b.versions.markCompletedAtomic(versionId, '[]', () =>
        b.writer.writeCompletedEvent(versionId, null, '[]', null),
      ),
    ];
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(countEvents(a.provenance, versionId, 'completed')).toBe(1);
  });

  test('the loser does not run its append at all', () => {
    const { a, b, versionId } = twoProcesses();
    let bAppended = false;

    expect(a.versions.markCompletedAtomic(versionId, '[]', () =>
      a.writer.writeCompletedEvent(versionId, null, '[]', null),
    )).toBe(true);

    expect(
      b.versions.markCompletedAtomic(versionId, '[]', () => {
        bAppended = true;
      }),
    ).toBe(false);
    expect(bAppended).toBe(false);
  });
});
