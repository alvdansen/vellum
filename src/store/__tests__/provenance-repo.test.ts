import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import { ProvenanceRepo } from '../provenance-repo.js';

/**
 * Tests for ProvenanceRepo per D-PROV-01 (append-only) + D-PROV-03 (event-row model).
 * Covers:
 *  - insertEvent generates prov_-prefixed id, timestamp, returns full row
 *  - getEventsForVersion chronological order
 *  - getLatestCompletedEvent handles multiple completed events (latest wins)
 *  - getSubmitEvent returns the single submitted event or null
 *  - empty-history case (historical Phase 2 row — D-PROV-34)
 *  - structural invariant: NO update/delete methods on prototype
 */

describe('ProvenanceRepo — append-only event store (D-PROV-01, D-PROV-03)', () => {
  let repo: ProvenanceRepo;
  let versionRepo: VersionRepo;
  let versionId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new ProvenanceRepo(db);
    versionRepo = new VersionRepo(db);
    const hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    versionId = versionRepo.insertVersion(shot.id).id;
  });

  test('insertEvent(submitted) generates prov_-prefixed id + timestamp + returns row', () => {
    const row = repo.insertEvent(versionId, {
      event_type: 'submitted',
      workflow_json: '{"3":{"class_type":"KSampler"}}',
    });
    expect(row.id).toMatch(/^prov_/);
    expect(row.version_id).toBe(versionId);
    expect(row.event_type).toBe('submitted');
    expect(row.workflow_json).toBe('{"3":{"class_type":"KSampler"}}');
    expect(row.prompt_json).toBeNull();
    expect(row.seed).toBeNull();
    expect(row.models_json).toBeNull();
    expect(row.outputs_json).toBeNull();
    expect(row.error_code).toBeNull();
    expect(row.error_message).toBeNull();
    expect(typeof row.timestamp).toBe('number');
    expect(row.timestamp).toBeGreaterThan(0);
  });

  test('insertEvent(completed) populates completion fields + nulls submit/fail fields', () => {
    const row = repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{"3":{"class_type":"KSampler","inputs":{"seed":42}}}',
      seed: 42,
      models_json: '[]',
      outputs_json: '[{"url":"x.png"}]',
    });
    expect(row.event_type).toBe('completed');
    expect(row.prompt_json).toBe('{"3":{"class_type":"KSampler","inputs":{"seed":42}}}');
    expect(row.seed).toBe(42);
    expect(row.models_json).toBe('[]');
    expect(row.outputs_json).toBe('[{"url":"x.png"}]');
    expect(row.workflow_json).toBeNull();
    expect(row.error_code).toBeNull();
    expect(row.error_message).toBeNull();
  });

  test('insertEvent(failed) populates error fields + nulls other payload fields', () => {
    const row = repo.insertEvent(versionId, {
      event_type: 'failed',
      error_code: 'COMFYUI_API_ERROR',
      error_message: 'KSampler missing model link',
    });
    expect(row.event_type).toBe('failed');
    expect(row.error_code).toBe('COMFYUI_API_ERROR');
    expect(row.error_message).toBe('KSampler missing model link');
    expect(row.workflow_json).toBeNull();
    expect(row.prompt_json).toBeNull();
    expect(row.seed).toBeNull();
    expect(row.models_json).toBeNull();
    expect(row.outputs_json).toBeNull();
  });

  test('getEventsForVersion returns events in chronological order', async () => {
    repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{}' });
    await new Promise((r) => setTimeout(r, 2));
    repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: null,
      models_json: '[]',
      outputs_json: '[]',
    });

    const events = repo.getEventsForVersion(versionId);
    expect(events).toHaveLength(2);
    expect(events[0]!.event_type).toBe('submitted');
    expect(events[1]!.event_type).toBe('completed');
    expect(events[1]!.timestamp).toBeGreaterThanOrEqual(events[0]!.timestamp);
  });

  test('getEventsForVersion returns empty array for a version with no events (D-PROV-34 historical gap)', () => {
    const events = repo.getEventsForVersion(versionId);
    expect(events).toEqual([]);
  });

  test('getLatestCompletedEvent returns the completed event after submitted', async () => {
    repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{}' });
    await new Promise((r) => setTimeout(r, 2));
    const completed = repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: 1,
      models_json: '[]',
      outputs_json: '[]',
    });

    const got = repo.getLatestCompletedEvent(versionId);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(completed.id);
    expect(got!.event_type).toBe('completed');
  });

  test('getLatestCompletedEvent returns null when no completed event exists (only submitted/failed)', () => {
    repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{}' });
    repo.insertEvent(versionId, {
      event_type: 'failed',
      error_code: 'COMFYUI_API_ERROR',
      error_message: 'x',
    });
    expect(repo.getLatestCompletedEvent(versionId)).toBeNull();
  });

  test('getLatestCompletedEvent returns only completed events even when failed follows', async () => {
    repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{}' });
    await new Promise((r) => setTimeout(r, 2));
    const completed = repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: 1,
      models_json: '[]',
      outputs_json: '[]',
    });
    await new Promise((r) => setTimeout(r, 2));
    repo.insertEvent(versionId, {
      event_type: 'failed',
      error_code: 'COMFYUI_API_ERROR',
      error_message: 'late failure',
    });

    const got = repo.getLatestCompletedEvent(versionId);
    expect(got!.id).toBe(completed.id);
  });

  test('getLatestCompletedEvent picks latest by timestamp when multiple completed exist', async () => {
    repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{"first":true}',
      seed: 1,
      models_json: '[]',
      outputs_json: '[]',
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{"second":true}',
      seed: 2,
      models_json: '[]',
      outputs_json: '[]',
    });

    const got = repo.getLatestCompletedEvent(versionId);
    expect(got!.id).toBe(second.id);
    expect(got!.prompt_json).toBe('{"second":true}');
  });

  test('getSubmitEvent returns the single submitted event', () => {
    const submit = repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{"x":1}' });
    const got = repo.getSubmitEvent(versionId);
    expect(got!.id).toBe(submit.id);
    expect(got!.workflow_json).toBe('{"x":1}');
  });

  test('getSubmitEvent returns null when no submitted event exists', () => {
    repo.insertEvent(versionId, {
      event_type: 'failed',
      error_code: 'COMFYUI_API_ERROR',
      error_message: 'pre-submit failure',
    });
    expect(repo.getSubmitEvent(versionId)).toBeNull();
  });

  test('structural invariant: ProvenanceRepo has no mutation methods (D-PROV-01)', () => {
    const forbidden = ['updateEvent', 'deleteEvent', 'update', 'delete', 'markCompleted', 'markFailed', 'setSeed'];
    const methods = Object.getOwnPropertyNames(ProvenanceRepo.prototype);
    for (const bad of forbidden) {
      expect(methods, `ProvenanceRepo must not expose ${bad}`).not.toContain(bad);
    }
    // Sanity: confirmed public methods ARE present.
    for (const ok of ['constructor', 'insertEvent', 'getEventsForVersion', 'getLatestCompletedEvent', 'getSubmitEvent']) {
      expect(methods).toContain(ok);
    }
  });
});
