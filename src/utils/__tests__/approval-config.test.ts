import { describe, test, expect } from 'vitest';
import { isApprovalRequired } from '../approval-config.js';

describe('isApprovalRequired — fail-closed gate parsing', () => {
  test('unset / empty defaults OFF (opt-in gate)', () => {
    expect(isApprovalRequired(undefined)).toBe(false);
    expect(isApprovalRequired('')).toBe(false);
    expect(isApprovalRequired('   ')).toBe(false);
  });

  test('documented ON values enable the gate', () => {
    expect(isApprovalRequired('1')).toBe(true);
    expect(isApprovalRequired('true')).toBe(true);
  });

  test('explicit OFF values disable the gate (case/space-insensitive)', () => {
    for (const v of ['0', 'false', 'FALSE', 'no', 'NO', 'off', ' Off ']) {
      expect(isApprovalRequired(v)).toBe(false);
    }
  });

  test('fail-closed: typo-ish truthy values still ENABLE the gate', () => {
    // The old strict `=== '1' || === 'true'` silently failed OPEN on these.
    for (const v of ['True', 'TRUE', 'yes', 'on', ' 1', '1 ', 'enabled']) {
      expect(isApprovalRequired(v)).toBe(true);
    }
  });
});
