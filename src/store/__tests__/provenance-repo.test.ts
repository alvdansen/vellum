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

/**
 * Phase 13 (PROV-V-03) — sibling 'models_fingerprinted' provenance event.
 *
 * The fingerprinter writes a NEW row of event_type='models_fingerprinted'
 * carrying populated SHA-256 hashes (or typed unavailable reasons) — it does
 * NOT update the original 'completed' event row. These tests prove:
 *   - Append: the new event lands as a separate row in chronological order.
 *   - Read fall-through: getLatestFingerprints prefers the fingerprinted row
 *     and falls back to the original completed_event.models_json when none
 *     exists yet (pre-fingerprint state).
 *   - Malformed-row resilience: getLatestFingerprints returns null on
 *     non-array / unparseable payloads instead of throwing.
 *   - Append-only invariant: the original completed_event row stays
 *     byte-identical after a fingerprinted event is appended.
 */
describe('Phase 13 (PROV-V-03) — models_fingerprinted sibling event', () => {
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

  test('appendModelsFingerprintedEvent inserts a row with event_type=models_fingerprinted', async () => {
    repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{}' });
    await new Promise((r) => setTimeout(r, 2));
    repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: 42,
      models_json: JSON.stringify([
        { node_id: '4', class_type: 'CheckpointLoaderSimple', model_name: 'sd_xl.safetensors', model_hash: null, model_hash_unavailable: null },
      ]),
      outputs_json: '[]',
    });
    await new Promise((r) => setTimeout(r, 2));
    const inserted = repo.appendModelsFingerprintedEvent(versionId, [
      {
        node_id: '4',
        class_type: 'CheckpointLoaderSimple',
        model_name: 'sd_xl.safetensors',
        model_hash: 'a'.repeat(64),
        model_hash_unavailable: null,
      },
      {
        node_id: '5',
        class_type: 'LoraLoader',
        model_name: 'a.safetensors',
        model_hash: null,
        model_hash_unavailable: 'file_not_found',
      },
    ]);
    expect(inserted.id).toMatch(/^prov_/);
    expect(inserted.event_type).toBe('models_fingerprinted');
    expect(inserted.models_json).not.toBeNull();
    const parsed = JSON.parse(inserted.models_json!) as unknown[];
    expect(parsed).toHaveLength(2);
    // Other event-specific fields must be null on a models_fingerprinted row.
    expect(inserted.workflow_json).toBeNull();
    expect(inserted.prompt_json).toBeNull();
    expect(inserted.seed).toBeNull();
    expect(inserted.outputs_json).toBeNull();
    expect(inserted.error_code).toBeNull();
    expect(inserted.error_message).toBeNull();

    const events = repo.getEventsForVersion(versionId);
    expect(events.map((e) => e.event_type)).toEqual([
      'submitted',
      'completed',
      'models_fingerprinted',
    ]);
  });

  test('getEventsForVersion includes the new event in chronological order', async () => {
    repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{}' });
    await new Promise((r) => setTimeout(r, 2));
    repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: null,
      models_json: '[]',
      outputs_json: '[]',
    });
    await new Promise((r) => setTimeout(r, 2));
    repo.appendModelsFingerprintedEvent(versionId, []);

    const events = repo.getEventsForVersion(versionId);
    expect(events).toHaveLength(3);
    expect(events[0]!.event_type).toBe('submitted');
    expect(events[1]!.event_type).toBe('completed');
    expect(events[2]!.event_type).toBe('models_fingerprinted');
    expect(events[2]!.timestamp).toBeGreaterThanOrEqual(events[1]!.timestamp);
  });

  test('getLatestFingerprints prefers the latest models_fingerprinted event', async () => {
    repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: null,
      models_json: JSON.stringify([
        { node_id: '4', class_type: 'CheckpointLoaderSimple', model_name: 'sd_xl.safetensors', model_hash: null, model_hash_unavailable: null },
      ]),
      outputs_json: '[]',
    });
    await new Promise((r) => setTimeout(r, 2));
    repo.appendModelsFingerprintedEvent(versionId, [
      {
        node_id: '4',
        class_type: 'CheckpointLoaderSimple',
        model_name: 'sd_xl.safetensors',
        model_hash: 'a'.repeat(64),
        model_hash_unavailable: null,
      },
    ]);
    await new Promise((r) => setTimeout(r, 5));
    repo.appendModelsFingerprintedEvent(versionId, [
      {
        node_id: '4',
        class_type: 'CheckpointLoaderSimple',
        model_name: 'sd_xl.safetensors',
        model_hash: 'b'.repeat(64),
        model_hash_unavailable: null,
      },
    ]);

    const got = repo.getLatestFingerprints(versionId);
    expect(got).not.toBeNull();
    expect(got).toHaveLength(1);
    expect(got![0]!.model_hash).toBe('b'.repeat(64));
  });

  test('getLatestFingerprints falls back to completed_event.models_json when no fingerprinted event exists', () => {
    const completedModels = [
      { node_id: '4', class_type: 'CheckpointLoaderSimple', model_name: 'sd_xl.safetensors', model_hash: null, model_hash_unavailable: null },
    ];
    repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{}',
      seed: null,
      models_json: JSON.stringify(completedModels),
      outputs_json: '[]',
    });

    const got = repo.getLatestFingerprints(versionId);
    expect(got).not.toBeNull();
    expect(got).toEqual(completedModels);
  });

  test('getLatestFingerprints returns null when neither event exists', () => {
    repo.insertEvent(versionId, { event_type: 'submitted', workflow_json: '{}' });
    expect(repo.getLatestFingerprints(versionId)).toBeNull();
  });

  test('getLatestFingerprints returns null on malformed models_json', () => {
    repo.insertEvent(versionId, {
      event_type: 'models_fingerprinted',
      models_json: 'NOT_VALID_JSON',
    });
    expect(repo.getLatestFingerprints(versionId)).toBeNull();
  });

  test('getLatestFingerprints returns null when fingerprinted models_json is non-array (e.g., {})', () => {
    repo.insertEvent(versionId, {
      event_type: 'models_fingerprinted',
      models_json: '{"oops":true}',
    });
    expect(repo.getLatestFingerprints(versionId)).toBeNull();
  });

  test('append-only invariant: appendModelsFingerprintedEvent never UPDATEs the completed event', async () => {
    const completedModels = [
      { node_id: '4', class_type: 'CheckpointLoaderSimple', model_name: 'sd_xl.safetensors', model_hash: null, model_hash_unavailable: null },
    ];
    const completed = repo.insertEvent(versionId, {
      event_type: 'completed',
      prompt_json: '{"x":1}',
      seed: 7,
      models_json: JSON.stringify(completedModels),
      outputs_json: '[{"u":"a.png"}]',
    });
    await new Promise((r) => setTimeout(r, 2));
    repo.appendModelsFingerprintedEvent(versionId, [
      {
        node_id: '4',
        class_type: 'CheckpointLoaderSimple',
        model_name: 'sd_xl.safetensors',
        model_hash: 'a'.repeat(64),
        model_hash_unavailable: null,
      },
    ]);

    // Re-fetch the original completed row by id and assert byte-equality on
    // every field — the sibling-event approach must NEVER mutate the existing
    // completed row (D-PROV-01 + T-13-07 mitigation).
    const events = repo.getEventsForVersion(versionId);
    const refetched = events.find((e) => e.id === completed.id);
    expect(refetched).toBeDefined();
    expect(refetched!.id).toBe(completed.id);
    expect(refetched!.version_id).toBe(completed.version_id);
    expect(refetched!.event_type).toBe(completed.event_type);
    expect(refetched!.workflow_json).toBe(completed.workflow_json);
    expect(refetched!.prompt_json).toBe(completed.prompt_json);
    expect(refetched!.seed).toBe(completed.seed);
    expect(refetched!.models_json).toBe(completed.models_json);
    expect(refetched!.outputs_json).toBe(completed.outputs_json);
    expect(refetched!.error_code).toBe(completed.error_code);
    expect(refetched!.error_message).toBe(completed.error_message);
    expect(refetched!.timestamp).toBe(completed.timestamp);
  });
});
