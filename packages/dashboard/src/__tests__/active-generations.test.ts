// packages/dashboard/src/__tests__/active-generations.test.ts
//
// Unit tests for the @preact/signals activeGenerations store (Plan 05-08,
// Task 2). The store exposes a `signal<ActiveGeneration[]>` plus two writer
// functions (onVersionCreated, onVersionStatusChanged) that the SSE
// dispatcher in ../lib/events.ts wires directly.
//
// Contract (from plan behavior block):
//   - activeGenerations.value starts as []
//   - onVersionCreated appends a new entry with status 'queued'
//   - onVersionStatusChanged updates existing entry's status in place
//   - onVersionStatusChanged for unknown versionId is a no-op (no throw)
//   - Two onVersionCreated calls -> two entries

import { describe, it, expect, beforeEach } from 'vitest';
import {
  activeGenerations,
  onVersionCreated,
  onVersionStatusChanged,
} from '../state/active-generations.js';

describe('activeGenerations signal', () => {
  beforeEach(() => {
    // Reset the signal between tests so order-independent.
    activeGenerations.value = [];
  });

  it('starts empty', () => {
    expect(activeGenerations.value).toHaveLength(0);
  });

  it('onVersionCreated adds entry with status queued', () => {
    onVersionCreated({ versionId: 'v1', shotId: 's1', label: 'v001' });
    expect(activeGenerations.value).toHaveLength(1);
    expect(activeGenerations.value[0]).toMatchObject({
      versionId: 'v1',
      shotId: 's1',
      label: 'v001',
      status: 'queued',
    });
  });

  it('onVersionStatusChanged updates existing entry', () => {
    onVersionCreated({ versionId: 'v1', shotId: 's1', label: 'v001' });
    onVersionStatusChanged({ versionId: 'v1', status: 'running' });
    expect(activeGenerations.value[0].status).toBe('running');
  });

  it('onVersionStatusChanged ignores unknown versionId', () => {
    onVersionCreated({ versionId: 'v1', shotId: 's1', label: 'v001' });
    onVersionStatusChanged({ versionId: 'unknown', status: 'failed' });
    expect(activeGenerations.value[0].status).toBe('queued');
    expect(activeGenerations.value).toHaveLength(1);
  });

  it('two onVersionCreated calls → two entries', () => {
    onVersionCreated({ versionId: 'v1', shotId: 's1', label: 'v001' });
    onVersionCreated({ versionId: 'v2', shotId: 's1', label: 'v002' });
    expect(activeGenerations.value).toHaveLength(2);
  });
});
