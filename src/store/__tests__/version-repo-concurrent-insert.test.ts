// src/store/__tests__/version-repo-concurrent-insert.test.ts
//
// REGRESSION — allocate-then-insert must not run under a deferred snapshot.
//
// `VersionRepo.doInsert` reads MAX(version_number) and then writes a row derived
// from it. Drizzle's `db.transaction()` defaults to BEGIN DEFERRED, which takes
// no lock until the first WRITE — so any commit by another connection between
// our SELECT and our INSERT invalidates the snapshot and the INSERT raises
// SQLITE_BUSY_SNAPSHOT.
//
// SQLite deliberately does NOT route that through the busy handler, so
// `busy_timeout = 5000` never retries it. It escaped as a raw driver error,
// which the tool envelope rewrites to `INVALID_INPUT: Unexpected internal
// error` — the one code that tells an agent its ARGUMENTS were wrong, so it
// mutates the request instead of retrying the identical one that would now
// succeed. No spend, no orphan row: the take is just silently lost.
//
// Two writer processes over one database file is the documented setup (the
// README's two-terminal instructions), so this is reachable, not theoretical.
// The conflicting write does not even have to touch `versions` — any commit
// invalidates the snapshot, which is what the workspace-insert case below pins.

import { describe, test, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { openDb } from '../db.js';
import { VersionRepo } from '../version-repo.js';
import { HierarchyRepo } from '../hierarchy-repo.js';

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

/** A file-backed database plus a SECOND independent handle on the same file. */
function twoHandles(): {
  a: ReturnType<typeof openDb>['db'];
  b: ReturnType<typeof openDb>['db'];
  bRaw: Database.Database;
  shotId: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'vellum-concurrent-insert-'));
  dirs.push(dir);
  const file = join(dir, 'vellum.db');

  const { db: a } = openDb(file);
  const { db: b } = openDb(file);
  // Production uses busy_timeout = 5000. These tests deliberately create a
  // conflict that cannot resolve, so a realistic timeout would just make every
  // case sit out its full 5s (twice, given the retry). The timeout length is not
  // what is under test — which side of the lock each connection lands on is.
  a.run(sql`PRAGMA busy_timeout = 50`);
  b.run(sql`PRAGMA busy_timeout = 50`);

  const hier = new HierarchyRepo(a);
  const ws = hier.createWorkspace('ws');
  const proj = hier.createProject(ws.id, 'proj');
  const seq = hier.createSequence(proj.id, 'seq');
  const shot = hier.createShot(seq.id, 'sh010');

  // Keep the interloper from parking on the write lock for the full 5s
  // busy_timeout once the fix makes handle A take it at BEGIN.
  const bRaw = new Database(file);
  bRaw.pragma('busy_timeout = 50');

  return { a, b, bRaw, shotId: shot.id };
}

/**
 * Wrap a Drizzle handle so `interlope` fires once, from inside the transaction,
 * immediately after the allocation SELECT resolves — i.e. exactly in the window
 * between the read and the write.
 */
function withInterloper(
  db: ReturnType<typeof openDb>['db'],
  interlope: () => void,
): ReturnType<typeof openDb>['db'] {
  let fired = false;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'transaction') return Reflect.get(target, prop, receiver);
      return (fn: (tx: unknown) => unknown, config?: unknown) =>
        (target.transaction as unknown as (f: (tx: unknown) => unknown, c?: unknown) => unknown)(
          (tx: unknown) => {
            const txProxy = new Proxy(tx as object, {
              get(txTarget, txProp, txReceiver) {
                if (txProp !== 'select') return Reflect.get(txTarget, txProp, txReceiver);
                return (...selectArgs: unknown[]) => {
                  const builder = (
                    Reflect.get(txTarget, 'select', txReceiver) as (...a: unknown[]) => unknown
                  ).apply(txTarget, selectArgs) as Record<string, unknown>;
                  // Walk the fluent chain and hook whichever .get() terminates it.
                  const hookGet = (node: Record<string, unknown>): Record<string, unknown> =>
                    new Proxy(node, {
                      get(n, p, r) {
                        const v = Reflect.get(n, p, r);
                        if (typeof v !== 'function') return v;
                        return (...args: unknown[]) => {
                          const out = (v as (...a: unknown[]) => unknown).apply(n, args);
                          if (p === 'get') {
                            if (!fired) {
                              fired = true;
                              interlope();
                            }
                            return out;
                          }
                          return out && typeof out === 'object'
                            ? hookGet(out as Record<string, unknown>)
                            : out;
                        };
                      },
                    });
                  return hookGet(builder);
                };
              },
            });
            return fn(txProxy);
          },
          config,
        );
    },
  }) as ReturnType<typeof openDb>['db'];
}

describe('VersionRepo.insertVersion under cross-connection contention', () => {
  test('survives another connection committing between the allocation read and the insert', () => {
    const { a, bRaw, shotId } = twoHandles();

    // The interloper writes to a table `versions` has nothing to do with — the
    // point being that ANY commit invalidates a deferred snapshot.
    const repo = new VersionRepo(
      withInterloper(a, () => {
        try {
          bRaw
            .prepare(
              "INSERT INTO workspaces (id, name, created_at) VALUES ('ws_interloper', 'interloper', 1)",
            )
            .run();
        } catch {
          // Expected once the transaction is IMMEDIATE: handle A holds the write
          // lock, so the interloper is the one that loses. Which side loses is
          // not what this test is about — that `insertVersion` survives is.
        }
      }),
    );

    const row = repo.insertVersion(shotId);
    expect(row.version_number).toBe(1);
    expect(row.shot_id).toBe(shotId);
  });

  test('survives a competing version insert on the same shot from another connection', () => {
    const { a, b, shotId } = twoHandles();
    const other = new VersionRepo(b);

    const repo = new VersionRepo(
      withInterloper(a, () => {
        try {
          other.insertVersion(shotId);
        } catch {
          /* whichever side loses the lock is free to lose */
        }
      }),
    );

    const row = repo.insertVersion(shotId);
    expect(row.version_number).toBeGreaterThanOrEqual(1);
  });

  test('a genuinely unresolvable conflict reports CONCURRENT_SUBMIT_CONFLICT, not a raw driver error', () => {
    // The agent-facing half of the fix. A lock conflict that outlives both
    // attempts must arrive as a TypedError whose hint says to retry — never as
    // the envelope's INVALID_INPUT ("your arguments were wrong"), which is the
    // one signal that stops an agent from retrying.
    const { a, bRaw, shotId } = twoHandles();

    // Hold the write lock open for the whole call so neither attempt can win.
    bRaw.pragma('busy_timeout = 0');
    bRaw.exec('BEGIN IMMEDIATE');
    try {
      const repo = new VersionRepo(a);
      expect(() => repo.insertVersion(shotId)).toThrowError(
        expect.objectContaining({ code: 'CONCURRENT_SUBMIT_CONFLICT' }),
      );
    } finally {
      bRaw.exec('ROLLBACK');
    }
  });
});
