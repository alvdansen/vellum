// Phase 20 / Plan 20-04 Task 1 — TDD anchor for the pipeline shot-status facade.
//
// These tests drive the three new Engine methods (setShotStatus, getShotStatus,
// listShotStatusHistory) that wire src/store/shot-status-repo.ts (Plan 20-02)
// through the engine layer and emit 'shot.status_changed' on the typed event bus
// (Plan 20-03). Mirrors the existing hierarchy/createShot facade pattern at
// src/engine/__tests__/hierarchy.test.ts.
import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';

describe('Engine.setShotStatus / getShotStatus / listShotStatusHistory (STAT-04)', () => {
  let engine: Engine;
  let sequenceId: string;
  let shotId: string;
  let shotName: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    engine = new Engine(
      db,
      new HierarchyRepo(db),
      new VersionRepo(db),
      new ProvenanceRepo(db),
      null,
    );
    const ws = engine.createWorkspace('demo-ws');
    const proj = engine.createProject(ws.entity.id, 'my-proj');
    const seq = engine.createSequence(proj.entity.id, 'sq010');
    sequenceId = seq.entity.id;
    const shot = engine.createShot(seq.entity.id, 'sh010');
    shotId = shot.entity.id;
    shotName = shot.entity.name;
  });

  test('setShotStatus returns { shotId, name, previousStatus, newStatus, eventId }', () => {
    const result = engine.setShotStatus(shotId, 'pending-review', 'alice', 'first review');
    expect(result.shotId).toBe(shotId);
    expect(result.name).toBe(shotName);
    // First-ever transition reads previousStatus from shot.status which defaults to 'wip'
    expect(result.previousStatus).toBe('wip');
    expect(result.newStatus).toBe('pending-review');
    expect(result.eventId).toMatch(/^sse_/);
  });

  test('setShotStatus emits shot.status_changed with the canonical payload', () => {
    const seen: Array<{
      shot_id: string;
      sequence_id: string;
      from_status: string | null;
      to_status: string;
      changed_by: string;
      note: string | null;
      at: string;
    }> = [];
    engine.events.onEvent('shot.status_changed', (p) => {
      seen.push(p);
    });

    engine.setShotStatus(shotId, 'approved', 'supervisor', 'ship it');

    expect(seen).toHaveLength(1);
    const payload = seen[0];
    expect(payload.shot_id).toBe(shotId);
    expect(payload.sequence_id).toBe(sequenceId);
    expect(payload.from_status).toBe('wip');
    expect(payload.to_status).toBe('approved');
    expect(payload.changed_by).toBe('supervisor');
    expect(payload.note).toBe('ship it');
    // at must be an ISO 8601 timestamp (nowIso shape)
    expect(payload.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('setShotStatus omits note → payload.note is null (not undefined)', () => {
    const seen: Array<{ note: string | null }> = [];
    engine.events.onEvent('shot.status_changed', (p) => {
      seen.push(p);
    });
    engine.setShotStatus(shotId, 'on-hold', 'reviewer');
    expect(seen[0].note).toBeNull();
  });

  test('setShotStatus on a missing shot throws SHOT_NOT_FOUND TypedError', () => {
    expect(() => engine.setShotStatus('shot_does_not_exist', 'approved', 'user'))
      .toThrowTypedError('SHOT_NOT_FOUND');
  });

  test('setShotStatus persists the new status (subsequent getShotStatus reflects it)', () => {
    engine.setShotStatus(shotId, 'pending-review', 'alice', 'r1');
    const current = engine.getShotStatus(shotId);
    expect(current.status).toBe('pending-review');
    // Second transition should read previousStatus from the persisted shot.status
    const second = engine.setShotStatus(shotId, 'approved', 'supervisor', 'ok');
    expect(second.previousStatus).toBe('pending-review');
    expect(second.newStatus).toBe('approved');
  });

  test('getShotStatus returns { shotId, name, status, lastChangedAt }; status defaults to "wip"', () => {
    const fresh = engine.getShotStatus(shotId);
    expect(fresh.shotId).toBe(shotId);
    expect(fresh.name).toBe(shotName);
    expect(fresh.status).toBe('wip');
    expect(fresh.lastChangedAt).toBeNull();
  });

  test('getShotStatus.lastChangedAt is the most recent event created_at after a setShotStatus', () => {
    const before = Date.now();
    engine.setShotStatus(shotId, 'pending-review', 'alice');
    const after = Date.now();
    const status = engine.getShotStatus(shotId);
    expect(typeof status.lastChangedAt).toBe('number');
    expect(status.lastChangedAt).not.toBeNull();
    expect(status.lastChangedAt!).toBeGreaterThanOrEqual(before);
    expect(status.lastChangedAt!).toBeLessThanOrEqual(after);
  });

  test('getShotStatus on a missing shot throws SHOT_NOT_FOUND TypedError', () => {
    expect(() => engine.getShotStatus('shot_does_not_exist'))
      .toThrowTypedError('SHOT_NOT_FOUND');
  });

  test('listShotStatusHistory returns { shotId, history, total } newest-first', () => {
    engine.setShotStatus(shotId, 'pending-review', 'alice', 'r1');
    engine.setShotStatus(shotId, 'approved', 'supervisor', 'ok');
    const list = engine.listShotStatusHistory(shotId, 10);
    expect(list.shotId).toBe(shotId);
    expect(list.total).toBe(2);
    expect(list.history).toHaveLength(2);
    // newest-first ordering — approved transition is the most recent
    expect(list.history[0].to_status).toBe('approved');
    expect(list.history[1].to_status).toBe('pending-review');
  });

  test('listShotStatusHistory honours the limit parameter', () => {
    engine.setShotStatus(shotId, 'pending-review', 'a');
    engine.setShotStatus(shotId, 'approved', 'b');
    engine.setShotStatus(shotId, 'on-hold', 'c');
    const list = engine.listShotStatusHistory(shotId, 2);
    expect(list.total).toBe(2);
    expect(list.history).toHaveLength(2);
    // newest-first — on-hold then approved
    expect(list.history[0].to_status).toBe('on-hold');
    expect(list.history[1].to_status).toBe('approved');
  });

  test('listShotStatusHistory on a shot with no history returns empty array, total=0', () => {
    const list = engine.listShotStatusHistory(shotId, 10);
    expect(list.shotId).toBe(shotId);
    expect(list.total).toBe(0);
    expect(list.history).toEqual([]);
  });

  test('listShotStatusHistory on a missing shot throws SHOT_NOT_FOUND TypedError', () => {
    expect(() => engine.listShotStatusHistory('shot_does_not_exist', 10))
      .toThrowTypedError('SHOT_NOT_FOUND');
  });
});
