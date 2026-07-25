import { describe, expect, test } from 'vitest';
import { diffVersions, buildReproductionDivergence } from '../diff.js';
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
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'A.safetensors',
            model_hash: null,
            model_hash_unavailable: null,
          },
        ],
      }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: wf,
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'B.safetensors',
            model_hash: null,
            model_hash_unavailable: null,
          },
        ],
      }),
    });
    expect(r.changes.models).toHaveLength(1);
    expect(r.changes.models[0]!.before.name).toBe('A.safetensors');
    expect(r.changes.models[0]!.after.name).toBe('B.safetensors');
    // Phase 13 — both before and after now carry hash + hash_unavailable.
    expect(r.changes.models[0]!.before.hash).toBeNull();
    expect(r.changes.models[0]!.before.hash_unavailable).toBeNull();
    expect(r.changes.models[0]!.after.hash).toBeNull();
    expect(r.changes.models[0]!.after.hash_unavailable).toBeNull();
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

describe('diffVersions — neutral params path (#2a, URL providers)', () => {
  const neu = (model_id: string, params: Record<string, unknown>) => ({ model_id, params });

  test('two URL-provider versions diff their neutral params, not the ComfyUI graph', () => {
    const r = diffVersions({
      a: snap({
        version_id: 'ver_a',
        workflow_json: { version: 'm:v1', input: { prompt: 'fox', seed: 1 } },
        neutral_params: neu('m:v1', { prompt: 'fox', seed: 1 }),
      }),
      b: snap({
        version_id: 'ver_b',
        workflow_json: { version: 'm:v1', input: { prompt: 'fox', seed: 9 } },
        neutral_params: neu('m:v1', { prompt: 'fox', seed: 9 }),
      }),
    });
    expect(r.changes.params).toContainEqual({
      node_id: '(request)',
      class_type: 'neutral',
      field: 'params.seed',
      before: 1,
      after: 9,
    });
    // ComfyUI-graph concepts stay empty on the neutral path.
    expect(r.changes.workflow).toEqual([]);
    expect(r.changes.models).toEqual([]);
    expect(r.summary).not.toBe('No changes.');
  });

  test('model_id change surfaces as a neutral param', () => {
    const r = diffVersions({
      a: snap({ neutral_params: neu('owner/m:v1', { prompt: 'x' }) }),
      b: snap({ version_id: 'ver_b', neutral_params: neu('owner/m:v2', { prompt: 'x' }) }),
    });
    expect(r.changes.params).toContainEqual({
      node_id: '(request)',
      class_type: 'neutral',
      field: 'model_id',
      before: 'owner/m:v1',
      after: 'owner/m:v2',
    });
  });

  test('LEGACY graph (no neutral bag) vs neutral params → INVALID_INPUT with backfill hint', () => {
    // A resolved-graph version that PREDATES neutral-provenance capture (no
    // neutral bag) vs a params-only version: still refused, but now with a hint
    // to reproduce/backfill. (A freshly-completed ComfyUI version DOES carry a
    // neutral bag and diffs cross-family — see the cross-family test below.)
    expect(() =>
      diffVersions({
        a: snap({
          version_id: 'ver_a',
          prompt_json: { '3': { class_type: 'KSampler', inputs: { seed: 42, cfg: 7 } } },
        }),
        b: snap({ version_id: 'ver_b', neutral_params: neu('m:v1', { prompt: 'fox', seed: 99 }) }),
      }),
    ).toThrowError(/no comparable provenance|neutral-provenance was captured/i);
  });

  test('CROSS-FAMILY: completed ComfyUI (graph + derived neutral bag) vs URL neutral → diffs neutrally', () => {
    // The new capability (#d): a ComfyUI version that carries BOTH a resolved
    // graph AND a derived neutral bag is field-comparable against a URL version
    // via the neutral path (not the graph path, since one side is params-only).
    const r = diffVersions({
      a: snap({
        version_id: 'ver_a',
        prompt_json: { '3': { class_type: 'KSampler', inputs: { seed: 42 } } },
        neutral_params: neu('sd_xl.safetensors', { seed: 42, steps: 20 }),
      }),
      b: snap({
        version_id: 'ver_b',
        neutral_params: neu('flux/dev', { seed: 99, steps: 20 }),
      }),
    });
    // Routed to the neutral path — node_id '(request)', class_type 'neutral'.
    expect(r.changes.params).toContainEqual({
      node_id: '(request)',
      class_type: 'neutral',
      field: 'params.seed',
      before: 42,
      after: 99,
    });
    expect(r.changes.params).toContainEqual({
      node_id: '(request)',
      class_type: 'neutral',
      field: 'model_id',
      before: 'sd_xl.safetensors',
      after: 'flux/dev',
    });
    // Graph-only concepts stay empty on the neutral path.
    expect(r.changes.workflow).toEqual([]);
    expect(r.changes.models).toEqual([]);
  });

  test('failed URL versions (request workflow_json, no neutral) are NOT read as ComfyUI graphs → refuse', () => {
    // A failed URL version has workflow_json = the request bag (no node
    // class_type) and no neutral bag. Structural graph detection must NOT treat
    // it as a ComfyUI graph (which would diff two request bags as a misleading
    // "no real change") — refuse instead.
    expect(() =>
      diffVersions({
        a: snap({
          version_id: 'ver_a',
          status: 'failed',
          workflow_json: { version: 'modelX', input: { prompt: 'cat', seed: 1 } },
        }),
        b: snap({
          version_id: 'ver_b',
          status: 'failed',
          workflow_json: { version: 'modelY', input: { prompt: 'dog', seed: 2 } },
        }),
      }),
    ).toThrowError(/no comparable provenance/i);
  });

  test('two completed ComfyUI versions (both now carry a neutral bag) STILL diff via the graph path', () => {
    // Regression guard for the #d routing: adding a neutral bag to ComfyUI
    // versions must NOT downgrade ComfyUI↔ComfyUI to the neutral path — the
    // rich node-level graph diff (per-node class_type, seed, workflow) is kept.
    const r = diffVersions({
      a: snap({
        version_id: 'ver_a',
        prompt_json: { '3': { class_type: 'KSampler', inputs: { seed: 1 } } },
        neutral_params: neu('m', { seed: 1 }),
        seed: 1,
      }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: { '3': { class_type: 'KSampler', inputs: { seed: 2 } } },
        neutral_params: neu('m', { seed: 2 }),
        seed: 2,
      }),
    });
    // Graph path → params carry real node ids (not '(request)') and seed diffs.
    expect(r.changes.params.every((p) => p.node_id !== '(request)')).toBe(true);
    expect(r.changes.seed).toEqual({ before: 1, after: 2 });
  });

  test('identical neutral params → No changes.', () => {
    const r = diffVersions({
      a: snap({ neutral_params: neu('m:v1', { prompt: 'x', seed: 7 }) }),
      b: snap({ version_id: 'ver_b', neutral_params: neu('m:v1', { prompt: 'x', seed: 7 }) }),
    });
    expect(r.changes.params).toEqual([]);
    expect(r.summary).toBe('No changes.');
  });
});

describe('buildReproductionDivergence (Phase 12 — DEMO-03 / D-CTX-4)', () => {
  test('null when warnings empty AND hashes match (criterion #4 negative)', () => {
    const r = buildReproductionDivergence({
      warnings: [],
      parentHash: 'abc',
      reproductionHash: 'abc',
    });
    expect(r).toBeNull();
  });

  test('null when warnings empty AND both hashes missing (cannot compare)', () => {
    const r = buildReproductionDivergence({
      warnings: [],
      parentHash: null,
      reproductionHash: null,
    });
    expect(r).toBeNull();
  });

  test('populated with sha256_mismatch when hashes differ', () => {
    const r = buildReproductionDivergence({
      warnings: [],
      parentHash: 'aaa',
      reproductionHash: 'bbb',
    });
    expect(r).not.toBeNull();
    expect(r!.sha256_mismatch).toEqual({ parent: 'aaa', reproduction: 'bbb' });
    expect(r!.warnings).toEqual([]);
    expect(r!.parent_output_present).toBe(true);
    expect(r!.reproduction_output_present).toBe(true);
  });

  test('populated with warnings when warnings non-empty even if hashes match', () => {
    const r = buildReproductionDivergence({
      warnings: ['Cloud API did not expose model metadata — reproduction is best-effort'],
      parentHash: 'abc',
      reproductionHash: 'abc',
    });
    expect(r).not.toBeNull();
    expect(r!.sha256_mismatch).toBeNull();
    expect(r!.warnings).toHaveLength(1);
    expect(r!.parent_output_present).toBe(true);
    expect(r!.reproduction_output_present).toBe(true);
  });

  test('both indicators populated when warnings non-empty AND hashes differ', () => {
    const r = buildReproductionDivergence({
      warnings: ['w1'],
      parentHash: 'aaa',
      reproductionHash: 'bbb',
    });
    expect(r).not.toBeNull();
    expect(r!.sha256_mismatch).toEqual({ parent: 'aaa', reproduction: 'bbb' });
    expect(r!.warnings).toEqual(['w1']);
  });

  test('parent_output_present=false when parent hash is null; sha256_mismatch null', () => {
    const r = buildReproductionDivergence({
      warnings: ['w1'],
      parentHash: null,
      reproductionHash: 'bbb',
    });
    expect(r).not.toBeNull();
    expect(r!.parent_output_present).toBe(false);
    expect(r!.reproduction_output_present).toBe(true);
    expect(r!.sha256_mismatch).toBeNull();
  });

  test('reproduction_output_present=false when reproduction hash is null', () => {
    const r = buildReproductionDivergence({
      warnings: ['w1'],
      parentHash: 'aaa',
      reproductionHash: null,
    });
    expect(r).not.toBeNull();
    expect(r!.parent_output_present).toBe(true);
    expect(r!.reproduction_output_present).toBe(false);
    expect(r!.sha256_mismatch).toBeNull();
  });
});

// ================================================================
// Phase 13 (PROV-V-03) — model_hash_unavailable transitions in diffModels.
// diffModels now compares ALL of (model_name, model_hash, model_hash_unavailable).
// A change in any field surfaces a ModelChange whose before/after carries
// both hash and hash_unavailable so consumers (Phase 14 C2PA) see the
// complete state on each side.
// ================================================================
describe('Phase 13 — model_hash_unavailable transitions in diffModels', () => {
  const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

  test('hash populated → unavailable surfaces a ModelChange with hash_unavailable populated on after', () => {
    const r = diffVersions({
      a: snap({
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: HEX,
            model_hash_unavailable: null,
          },
        ],
      }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: null,
            model_hash_unavailable: 'file_not_found',
          },
        ],
      }),
    });
    expect(r.changes.models).toHaveLength(1);
    const m = r.changes.models[0]!;
    expect(m.before.hash).toBe(HEX);
    expect(m.before.hash_unavailable).toBeNull();
    expect(m.after.hash).toBeNull();
    expect(m.after.hash_unavailable).toBe('file_not_found');
  });

  test('unavailable → hash populated surfaces a ModelChange with the new hash on after', () => {
    const r = diffVersions({
      a: snap({
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: null,
            model_hash_unavailable: 'models_dir_not_configured',
          },
        ],
      }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: HEX,
            model_hash_unavailable: null,
          },
        ],
      }),
    });
    expect(r.changes.models).toHaveLength(1);
    const m = r.changes.models[0]!;
    expect(m.before.hash).toBeNull();
    expect(m.before.hash_unavailable).toBe('models_dir_not_configured');
    expect(m.after.hash).toBe(HEX);
    expect(m.after.hash_unavailable).toBeNull();
  });

  test('unavailable code change (file_not_found → file_unreadable) surfaces a ModelChange', () => {
    const r = diffVersions({
      a: snap({
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: null,
            model_hash_unavailable: 'file_not_found',
          },
        ],
      }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: null,
            model_hash_unavailable: 'file_unreadable',
          },
        ],
      }),
    });
    expect(r.changes.models).toHaveLength(1);
    const m = r.changes.models[0]!;
    expect(m.before.hash).toBeNull();
    expect(m.before.hash_unavailable).toBe('file_not_found');
    expect(m.after.hash).toBeNull();
    expect(m.after.hash_unavailable).toBe('file_unreadable');
  });

  test('identical entries with both fields null produce no ModelChange', () => {
    const r = diffVersions({
      a: snap({
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: null,
            model_hash_unavailable: null,
          },
        ],
      }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: null,
            model_hash_unavailable: null,
          },
        ],
      }),
    });
    expect(r.changes.models).toEqual([]);
  });

  test('identical entries with same populated hash produce no ModelChange (post-fingerprint stability)', () => {
    const r = diffVersions({
      a: snap({
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: HEX,
            model_hash_unavailable: null,
          },
        ],
      }),
      b: snap({
        version_id: 'ver_b',
        prompt_json: { '4': { class_type: 'CheckpointLoaderSimple', inputs: {} } },
        models_json: [
          {
            node_id: '4',
            class_type: 'CheckpointLoaderSimple',
            model_name: 'sd.safetensors',
            model_hash: HEX,
            model_hash_unavailable: null,
          },
        ],
      }),
    });
    expect(r.changes.models).toEqual([]);
  });
});
