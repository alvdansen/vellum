/**
 * mergeHistory — end-of-attempt emission.
 *
 * The engine stamps `completed_at` on failure as well as success (it marks
 * "the attempt ended"). mergeHistory used to emit `event: 'completed'` for
 * ANY non-null completed_at, so a failed take rendered "Version v001
 * completed" in the same viewport as the pipeline log's "1 failed".
 */
import { describe, it, expect } from 'vitest';
import { mergeHistory } from '../mergeHistory.js';
import type { Version } from '../../types/entities.js';

function version(overrides: Partial<Version> & { id: string }): Version {
  return { version_number: 1, ...overrides } as Version;
}

describe('mergeHistory — failed takes', () => {
  it('a failed version emits a failed entry, not a completed one', () => {
    const failed = {
      ...version({ id: 'ver_f', status: 'failed' }),
      created_at_ms: 1000,
      completed_at: 2000,
    };
    const entries = mergeHistory([failed], []);
    const events = entries
      .filter((e) => e.kind === 'version')
      .map((e) => (e.kind === 'version' ? e.event : ''));
    expect(events).toContain('failed');
    expect(events).not.toContain('completed');
  });

  it('a completed version still emits a completed entry', () => {
    const done = {
      ...version({ id: 'ver_c', status: 'completed' }),
      created_at_ms: 1000,
      completed_at: 2000,
    };
    const entries = mergeHistory([done], []);
    const events = entries
      .filter((e) => e.kind === 'version')
      .map((e) => (e.kind === 'version' ? e.event : ''));
    expect(events).toContain('completed');
    expect(events).not.toContain('failed');
  });

  it('an in-flight version (null completed_at) emits only created', () => {
    const running = {
      ...version({ id: 'ver_r', status: 'running' }),
      created_at_ms: 1000,
      completed_at: null,
    };
    const entries = mergeHistory([running], []);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind === 'version' && entries[0]!.event).toBe('created');
  });
});
