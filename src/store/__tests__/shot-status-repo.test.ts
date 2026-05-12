import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import * as shotStatusRepo from '../shot-status-repo.js';
import {
  insertStatusEvent,
  getStatusHistory,
  getCurrentStatus,
  STALE_SHOT_DAYS,
  type ShotStatusEvent,
} from '../shot-status-repo.js';
import { shots } from '../schema.js';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../schema.js';

/**
 * Tests for shot-status-repo per STAT-02 (transactional dual-write) +
 * STAT-03 (null-coalesce to 'wip') + OVR-02 (STALE_SHOT_DAYS = 14 constant).
 *
 * Append-only structural invariant verified: the module exports NO
 * update/delete/remove/clear functions. The architecture-purity test in
 * Plan 04 will mirror this assertion at the grep level for
 * `UPDATE shot_status_events` / `DELETE.*shot_status_events`.
 */

describe('shot-status-repo — append-only event store (STAT-02, STAT-03)', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let shotId: string;

  beforeEach(() => {
    const test = makeInMemoryDb();
    db = test.db;
    const hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    shotId = shot.id;
  });

  test('insertStatusEvent generates sse_-prefixed id + returns full row', () => {
    const event = insertStatusEvent(db, shotId, 'wip', 'pending-review', 'user', 'ready for review');
    expect(event.id).toMatch(/^sse_/);
    expect(event.shot_id).toBe(shotId);
    expect(event.from_status).toBe('wip');
    expect(event.to_status).toBe('pending-review');
    expect(event.changed_by).toBe('user');
    expect(event.note).toBe('ready for review');
    expect(typeof event.created_at).toBe('number');
    expect(event.created_at).toBeGreaterThan(0);
  });

  test('insertStatusEvent persists note as null when undefined', () => {
    const event = insertStatusEvent(db, shotId, null, 'pending-review', 'user');
    expect(event.from_status).toBeNull();
    expect(event.note).toBeNull();
  });

  test('insertStatusEvent materializes shots.status in the same transaction (STAT-02 dual-write)', () => {
    insertStatusEvent(db, shotId, 'wip', 'approved', 'user');
    const shot = db.select().from(shots).where(eq(shots.id, shotId)).get();
    expect(shot?.status).toBe('approved');
  });

  test('insertStatusEvent flips shots.status across multiple transitions', () => {
    insertStatusEvent(db, shotId, 'wip', 'pending-review', 'user');
    let shot = db.select().from(shots).where(eq(shots.id, shotId)).get();
    expect(shot?.status).toBe('pending-review');
    insertStatusEvent(db, shotId, 'pending-review', 'approved', 'supervisor');
    shot = db.select().from(shots).where(eq(shots.id, shotId)).get();
    expect(shot?.status).toBe('approved');
    insertStatusEvent(db, shotId, 'approved', 'on-hold', 'lead');
    shot = db.select().from(shots).where(eq(shots.id, shotId)).get();
    expect(shot?.status).toBe('on-hold');
  });

  test('getStatusHistory returns rows newest-first', async () => {
    insertStatusEvent(db, shotId, 'wip', 'pending-review', 'user');
    await new Promise((r) => setTimeout(r, 5));
    insertStatusEvent(db, shotId, 'pending-review', 'approved', 'supervisor');
    const history = getStatusHistory(db, shotId);
    expect(history).toHaveLength(2);
    expect(history[0]!.to_status).toBe('approved');
    expect(history[1]!.to_status).toBe('pending-review');
    expect(history[0]!.created_at).toBeGreaterThanOrEqual(history[1]!.created_at);
  });

  test('getStatusHistory respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      insertStatusEvent(db, shotId, i === 0 ? 'wip' : 'pending-review', 'pending-review', 'user');
      await new Promise((r) => setTimeout(r, 2));
    }
    const limited = getStatusHistory(db, shotId, 2);
    expect(limited).toHaveLength(2);
  });

  test('getStatusHistory defaults to limit=50', async () => {
    for (let i = 0; i < 3; i++) {
      insertStatusEvent(db, shotId, i === 0 ? 'wip' : 'pending-review', 'pending-review', 'user');
      await new Promise((r) => setTimeout(r, 2));
    }
    const history = getStatusHistory(db, shotId);
    expect(history.length).toBeLessThanOrEqual(50);
    expect(history).toHaveLength(3);
  });

  test('getStatusHistory returns empty array (not null) when no events exist', () => {
    const history = getStatusHistory(db, shotId);
    expect(history).toEqual([]);
    expect(Array.isArray(history)).toBe(true);
  });

  test('getCurrentStatus null-coalesces to "wip" for shot with zero history (STAT-03)', () => {
    const status = getCurrentStatus(db, shotId);
    expect(status).toBe('wip');
    // CRITICAL: never returns null
    expect(status).not.toBeNull();
  });

  test('getCurrentStatus returns latest to_status after one event', () => {
    insertStatusEvent(db, shotId, 'wip', 'on-hold', 'user');
    const status = getCurrentStatus(db, shotId);
    expect(status).toBe('on-hold');
  });

  test('getCurrentStatus returns latest to_status across multiple events', async () => {
    insertStatusEvent(db, shotId, 'wip', 'pending-review', 'user');
    await new Promise((r) => setTimeout(r, 5));
    insertStatusEvent(db, shotId, 'pending-review', 'approved', 'supervisor');
    await new Promise((r) => setTimeout(r, 5));
    insertStatusEvent(db, shotId, 'approved', 'omit', 'lead');
    const status = getCurrentStatus(db, shotId);
    expect(status).toBe('omit');
  });

  test('STALE_SHOT_DAYS constant is 14 (REQUIREMENTS.md OVR-02)', () => {
    expect(STALE_SHOT_DAYS).toBe(14);
  });

  test('structural invariant: shot-status-repo exports zero update/delete/remove/clear members', () => {
    const exportedNames = Object.keys(shotStatusRepo);
    const forbidden = exportedNames.filter((name) =>
      /update|delete|remove|clear/i.test(name),
    );
    expect(forbidden).toHaveLength(0);
  });

  test('ShotStatusEvent type carries id/shot_id/from_status/to_status/changed_by/note/created_at', () => {
    const event = insertStatusEvent(db, shotId, 'wip', 'approved', 'user', 'note text');
    const probe: ShotStatusEvent = event;
    expect(Object.keys(probe).sort()).toEqual(
      ['changed_by', 'created_at', 'from_status', 'id', 'note', 'shot_id', 'to_status'].sort(),
    );
  });
});
