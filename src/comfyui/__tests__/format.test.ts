import { describe, test, expect } from 'vitest';
import {
  isUiFormat,
  isApiFormat,
  validateWorkflowFormat,
  extractFirstNodeError,
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
