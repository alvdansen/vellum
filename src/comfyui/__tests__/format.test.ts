import { describe, test, expect } from 'vitest';
import {
  isUiFormat,
  isApiFormat,
  validateWorkflowFormat,
  extractFirstNodeError,
  flattenComfyError,
} from '../format.js';
import '../../test-utils/matchers.js';

/**
 * Tests for src/comfyui/format.ts per D-GEN-23 + D-GEN-27.
 * UI-format has top-level nodes/links/groups/last_node_id keys.
 * API-format has numeric-string keys mapping to { class_type, inputs }.
 */

const UI_FORMAT_CASES = [
  { nodes: [] },
  { links: [] },
  { groups: [] },
  { last_node_id: 5 },
  { nodes: [], links: [], groups: [], last_node_id: 0 },
];

const API_FORMAT_CASES = [
  { '1': { class_type: 'KSampler', inputs: {} } },
  {
    '1': { class_type: 'A', inputs: {} },
    '2': { class_type: 'B', inputs: { seed: 42 } },
  },
];

const INVALID_OTHER: unknown[] = [
  {},
  [],
  null,
  undefined,
  42,
  'hello',
  { foo: 'bar' },
  { '1': { class_type: 'A' } },
  { '1': { inputs: {} } },
  { a: { class_type: 'A', inputs: {} } },
];

describe('workflow format detection (D-GEN-23)', () => {
  test.each(UI_FORMAT_CASES)('UI-format rejected: %j', (p) => {
    expect(isUiFormat(p)).toBe(true);
    expect(() => validateWorkflowFormat(p)).toThrowTypedError('INVALID_WORKFLOW_FORMAT');
  });

  test.each(API_FORMAT_CASES)('API-format accepted: %j', (p) => {
    expect(isApiFormat(p)).toBe(true);
    expect(() => validateWorkflowFormat(p)).not.toThrow();
  });

  test.each(INVALID_OTHER)('format edge cases rejected: %j', (p) => {
    expect(() => validateWorkflowFormat(p)).toThrowTypedError('INVALID_WORKFLOW_FORMAT');
  });

  test('UI-format reject hint mentions Dev Mode > Save (API Format)', () => {
    try {
      validateWorkflowFormat({ nodes: [] });
      expect.fail('expected throw');
    } catch (err) {
      expect((err as { hint?: string }).hint).toMatch(/Dev Mode > Save \(API Format\)/);
    }
  });

  test('SEC-02: workflow > 5MB serialized is rejected as INVALID_INPUT', () => {
    // Build a syntactically-correct API-format workflow whose JSON string
    // exceeds 5MB. Base64-like noise in `inputs` is cheap ballast.
    const bigPayload: Record<string, unknown> = {};
    const noise = 'x'.repeat(10_000);
    for (let i = 0; i < 600; i++) {
      bigPayload[String(i)] = {
        class_type: 'KSampler',
        inputs: { noise },
      };
    }
    // Sanity: the payload really is oversized.
    expect(JSON.stringify(bigPayload).length).toBeGreaterThan(5_000_000);
    try {
      validateWorkflowFormat(bigPayload);
      expect.fail('expected throw');
    } catch (err) {
      const te = err as { code?: string; message?: string };
      expect(te.code).toBe('INVALID_INPUT');
      expect(te.message ?? '').toMatch(/exceeds/);
    }
  });
});

describe('extractFirstNodeError (D-GEN-27)', () => {
  test('full fixture flattens to "Node <id> (<class_type>): <message>"', () => {
    const msg = extractFirstNodeError({
      '3': {
        errors: [{ type: 'required_input_missing', message: 'bad' }],
        dependent_outputs: [],
        class_type: 'KSampler',
      },
    });
    expect(msg).toBe('Node 3 (KSampler): bad');
  });

  test.each([null, undefined, {}, [], { '3': { errors: [] } }])(
    'edge cases → null: %j',
    (v) => {
      expect(extractFirstNodeError(v)).toBeNull();
    },
  );
});

describe('flattenComfyError (DEMO-02 — single source of truth for the 3-branch chain)', () => {
  test('node_errors object with first-actionable error → "Node <id> (<class_type>): <msg>"', () => {
    const out = flattenComfyError({
      node_errors: {
        '3': {
          errors: [{ message: 'Unauthorized: Please login first' }],
          class_type: 'KSampler',
        },
      },
    });
    expect(out).toBe('Node 3 (KSampler): Unauthorized: Please login first');
  });

  test('node_errors object with value_not_in_list shape → flattened verbatim', () => {
    const out = flattenComfyError({
      node_errors: {
        '5': {
          errors: [{ message: "value_not_in_list: ckpt_name 'X' not in []" }],
          class_type: 'CheckpointLoaderSimple',
        },
      },
    });
    expect(out).toBe(
      "Node 5 (CheckpointLoaderSimple): value_not_in_list: ckpt_name 'X' not in []",
    );
  });

  test('object with empty node_errors falls through to fallback', () => {
    expect(flattenComfyError({ node_errors: {} })).toBe('ComfyUI reported failed');
  });

  test('object with errors[] empty falls through to fallback', () => {
    expect(
      flattenComfyError({ node_errors: { '3': { errors: [], class_type: 'KSampler' } } }),
    ).toBe('ComfyUI reported failed');
  });

  test('non-empty string passes through verbatim', () => {
    expect(flattenComfyError('Cloud bored, retry later')).toBe('Cloud bored, retry later');
  });

  test('Unauthorized string passes through verbatim', () => {
    expect(flattenComfyError('Unauthorized: Please login first')).toBe(
      'Unauthorized: Please login first',
    );
  });

  test.each([undefined, null, '', 42, true, [], {}, { error: 'nested-but-no-node_errors' }])(
    'non-flattenable input → "ComfyUI reported failed": %j',
    (v) => {
      expect(flattenComfyError(v)).toBe('ComfyUI reported failed');
    },
  );

  test('IT-10 contract: cancelled-status (undefined error) emits exact literal', () => {
    // Regression guard for src/engine/__tests__/generation.test.ts:308.
    // The fake's cancelled-status scenario returns { status: 'cancelled' } with
    // no .error field — remote.error is undefined when this helper runs.
    expect(flattenComfyError(undefined)).toBe('ComfyUI reported failed');
  });

  test('property: never throws, always returns non-empty string', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      '',
      0,
      -1,
      NaN,
      Infinity,
      true,
      false,
      [],
      {},
      'hello',
      { node_errors: null },
      { node_errors: undefined },
      { node_errors: 'oops' },
      new Error('boom'),
    ];
    for (const input of inputs) {
      const out = flattenComfyError(input);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
