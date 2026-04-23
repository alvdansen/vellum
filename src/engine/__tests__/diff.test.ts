import { describe, expect, test } from 'vitest';
import { diffVersions } from '../diff.js';
import type { DiffSnapshot } from '../../types/provenance.js';
import '../../test-utils/matchers.js';

function snap(partial: Partial<DiffSnapshot>): DiffSnapshot {
  return {
    version_id: 'ver_a',
    shot_id: 'shot_x',
    version_number: 1,
    status: 'completed',
    created_at: 1_000,
    completed_at: 2_000,
    workflow_json: null,
    prompt_json: null,
    models_json: [],
    seed: null,
    output_count: 0,
    ...partial,
  } as DiffSnapshot;
}

describe('diffVersions (D-PROV-15..D-PROV-20)', () => {
  test('same blobs → no changes + "No changes." summary', () => {
    const blob = { '3': { class_type: 'KSampler', inputs: { seed: 42, cfg: 7 } } };
    const r = diffVersions({
      a: snap({ version_id: 'ver_a', prompt_json: blob }),
      b: snap({ version_id: 'ver_b', prompt_json: blob }),
    });
    expect(r.changes.params).toEqual([]);
    expect(r.summary).toBe('No changes.');
  });

  test('seed change detected in both params (inputs.seed) and seed field', () => {
    const a = { '3': { class_type: 'KSampler', inputs: { seed: 42, cfg: 7 } } };
    const b = { '3': { class_type: 'KSampler', inputs: { seed: 999, cfg: 7 } } };
    const r = diffVersions({
      a: snap({ prompt_json: a, seed: 42 }),
      b: snap({ version_id: 'ver_b', prompt_json: b, seed: 999 }),
    });
    expect(r.changes.params).toContainEqual({
      node_id: '3',
      class_type: 'KSampler',
      field: 'seed',
      before: 42,
      after: 999,
    });
    expect(r.changes.seed).toEqual({ before: 42, after: 999 });
  });

  test('node added surfaces as workflow.added', () => {
    const a = { '3': { class_type: 'KSampler', inputs: {} } };
    const b = {
      '3': { class_type: 'KSampler', inputs: {} },
      '7': { class_type: 'LoraLoader', inputs: { lora_name: 'x' } },
    };
    const r = diffVersions({
      a: snap({ prompt_json: a }),
      b: snap({ version_id: 'ver_b', prompt_json: b }),
    });
    expect(r.changes.workflow).toContainEqual({ type: 'added', node_id: '7', class_type: 'LoraLoader' });
  });

  test('node removed surfaces as workflow.removed', () => {
    const a = {
      '3': { class_type: 'KSampler', inputs: {} },
      '7': { class_type: 'LoraLoader', inputs: { lora_name: 'x' } },
    };
    const b = { '3': { class_type: 'KSampler', inputs: {} } };
    const r = diffVersions({
      a: snap({ prompt_json: a }),
      b: snap({ version_id: 'ver_b', prompt_json: b }),
    });
    expect(r.changes.workflow).toContainEqual({ type: 'removed', node_id: '7', class_type: 'LoraLoader' });
  });

  test('link-ref fields are ignored in param diff (surface only via structural)', () => {
    const a = { '3': { class_type: 'KSampler', inputs: { model: ['4', 0] } } };
    const b = { '3': { class_type: 'KSampler', inputs: { model: ['5', 0] } } };
    const r = diffVersions({
      a: snap({ prompt_json: a }),
      b: snap({ version_id: 'ver_b', prompt_json: b }),
    });
    expect(r.changes.params).toEqual([]);
  });

  test('model change detected', () => {
    const wf = { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'A' } } };
    const r = diffVersions({
      a: snap({
        prompt_json: wf,
        models_json: [
          { node_id: '4', class_type: 'CheckpointLoaderSimple', model_name: 'A.safetensors', model_hash: null },
        ],
      }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: wf,
        models_json: [
          { node_id: '4', class_type: 'CheckpointLoaderSimple', model_name: 'B.safetensors', model_hash: null },
        ],
      }),
    });
    expect(r.changes.models).toHaveLength(1);
    expect(r.changes.models[0]!.before.name).toBe('A.safetensors');
    expect(r.changes.models[0]!.after.name).toBe('B.safetensors');
  });

  test('metadata changes surface (status, output_count, completed_at)', () => {
    const wf = { '3': { class_type: 'KSampler', inputs: {} } };
    const r = diffVersions({
      a: snap({ prompt_json: wf, status: 'completed', output_count: 1, completed_at: 1000 }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: wf,
        status: 'failed',
        workflow_json: wf,
        output_count: 0,
        completed_at: 2000,
      }),
    });
    expect(r.changes.metadata).toContainEqual({ field: 'status', before: 'completed', after: 'failed' });
    expect(r.changes.metadata).toContainEqual({ field: 'output_count', before: 1, after: 0 });
    expect(r.changes.metadata).toContainEqual({ field: 'completed_at', before: 1000, after: 2000 });
  });

  test('cross-shot throws INVALID_INPUT', () => {
    expect(() =>
      diffVersions({ a: snap({ shot_id: 'shot_x' }), b: snap({ shot_id: 'shot_y' }) }),
    ).toThrowTypedError('INVALID_INPUT');
  });

  test('cross-shot error hint includes both shot ids', () => {
    try {
      diffVersions({ a: snap({ shot_id: 'shot_x' }), b: snap({ shot_id: 'shot_y' }) });
    } catch (err) {
      const e = err as { code: string; hint?: string };
      expect(e.hint).toContain("'shot_x'");
      expect(e.hint).toContain("'shot_y'");
      return;
    }
    throw new Error('expected throw');
  });

  test('not-completed source throws VERSION_NOT_COMPLETED', () => {
    expect(() =>
      diffVersions({ a: snap({ status: 'submitted' }), b: snap({ version_id: 'ver_b' }) }),
    ).toThrowTypedError('VERSION_NOT_COMPLETED');
  });

  test('both submitted → throws on first (a) with a.version_id in message', () => {
    try {
      diffVersions({ a: snap({ status: 'running' }), b: snap({ version_id: 'ver_b', status: 'running' }) });
    } catch (err) {
      const e = err as { code: string; message: string };
      expect(e.code).toBe('VERSION_NOT_COMPLETED');
      expect(e.message).toContain('ver_a');
      return;
    }
    throw new Error('expected throw');
  });

  test('summary elides >6 changes with "…and N more changes"', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    for (let i = 1; i <= 10; i++) {
      a[String(i)] = { class_type: 'KSampler', inputs: { x: i } };
      b[String(i)] = { class_type: 'KSampler', inputs: { x: i + 100 } };
    }
    const r = diffVersions({
      a: snap({ prompt_json: a }),
      b: snap({ version_id: 'ver_b', prompt_json: b }),
    });
    expect(r.summary).toMatch(/…and 4 more changes$/);
    expect(r.summary.length).toBeLessThanOrEqual(400);
  });

  test('failed version is comparable (has workflow_json)', () => {
    const wf = { '3': { class_type: 'KSampler', inputs: {} } };
    const r = diffVersions({
      a: snap({ status: 'failed', workflow_json: wf }),
      b: snap({ version_id: 'ver_b', status: 'completed', prompt_json: wf }),
    });
    // No throw, changes may include metadata diff for status
    expect(r.changes.metadata).toContainEqual({ field: 'status', before: 'failed', after: 'completed' });
  });
});
