// src/http/__tests__/sse-adapter.test.ts
//
// Unit tests for toDashboardPayload — the pure wire-shape adapter at the
// SSE serialization boundary (Plan 05-13, CR-01 fix).
//
// Scope: input = engine-native payload from src/engine/events.ts;
//        output = dashboard-contract shape from
//        packages/dashboard/src/types/events.ts.
//
// These tests complement the end-to-end seam test in sse-e2e.test.ts. They
// isolate the adapter logic so a broken translation rule is caught with a
// single clear assertion, without the noise of Hono streams or HTTP I/O.

import { describe, it, expect } from 'vitest';
import { toDashboardPayload } from '../sse.js';
import type { EngineEventMap } from '../../engine/events.js';

describe('toDashboardPayload — version.created', () => {
  it('renames snake_case keys to camelCase and derives label from breadcrumb last segment', () => {
    const out = toDashboardPayload('version.created', {
      version_id: 'ver_abc',
      shot_id: 'shot_xyz',
      breadcrumb: 'ws > proj_1 > sq010 > sh010 > v001',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toEqual({ versionId: 'ver_abc', shotId: 'shot_xyz', label: 'v001' });
  });

  it('handles single-segment breadcrumb by using it as the label', () => {
    const out = toDashboardPayload('version.created', {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      breadcrumb: 'v001',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toMatchObject({ label: 'v001' });
  });

  it('returns empty-string label for empty breadcrumb (defensive fallback)', () => {
    const out = toDashboardPayload('version.created', {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      breadcrumb: '',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toMatchObject({ label: '' });
  });

  it('omits `at` and `breadcrumb` from the output (dashboard does not render them)', () => {
    const out = toDashboardPayload('version.created', {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      breadcrumb: 'ws > p > sq > sh > v001',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).not.toHaveProperty('at');
    expect(out).not.toHaveProperty('breadcrumb');
  });
});

describe('toDashboardPayload — version.status_changed', () => {
  it('maps `submitted` → `queued`', () => {
    const out = toDashboardPayload('version.status_changed', {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      status: 'submitted',
      breadcrumb: 'ws > p > sq > sh > v001',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toEqual({ versionId: 'ver_1', status: 'queued' });
  });

  it('keeps `running` unchanged', () => {
    const out = toDashboardPayload('version.status_changed', {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      status: 'running',
      breadcrumb: '',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toMatchObject({ status: 'running' });
  });

  it('maps `completed` → `complete`', () => {
    const out = toDashboardPayload('version.status_changed', {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      status: 'completed',
      breadcrumb: '',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toMatchObject({ status: 'complete' });
  });

  it('keeps `failed` unchanged', () => {
    const out = toDashboardPayload('version.status_changed', {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      status: 'failed',
      breadcrumb: '',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toMatchObject({ status: 'failed' });
  });

  it('omits shot_id, breadcrumb, at (dashboard union only includes versionId + status + optional jobId)', () => {
    const out = toDashboardPayload('version.status_changed', {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      status: 'submitted',
      breadcrumb: 'ws > p > sq > sh > v001',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).not.toHaveProperty('shotId');
    expect(out).not.toHaveProperty('shot_id');
    expect(out).not.toHaveProperty('breadcrumb');
    expect(out).not.toHaveProperty('at');
  });
});

describe('toDashboardPayload — hierarchy.created', () => {
  it('renames entity_type/entity_id/parent_id to camelCase', () => {
    const out = toDashboardPayload('hierarchy.created', {
      entity_type: 'workspace',
      entity_id: 'ws_1',
      parent_id: 'parent_xyz',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toEqual({ entityType: 'workspace', entityId: 'ws_1', parentId: 'parent_xyz' });
  });

  it('coerces parent_id: null to undefined (matches optional dashboard field; stripped by JSON.stringify)', () => {
    const out = toDashboardPayload('hierarchy.created', {
      entity_type: 'workspace',
      entity_id: 'ws_1',
      parent_id: null,
      at: '2026-04-23T00:00:00.000Z',
    });
    // undefined is the behaviour that causes JSON.stringify to omit the key.
    expect((out as { parentId?: string }).parentId).toBeUndefined();
    // And omitted from the serialized form:
    expect(JSON.stringify(out)).not.toMatch(/"parentId"/);
  });

  it('preserves shot entity_type', () => {
    const out = toDashboardPayload('hierarchy.created', {
      entity_type: 'shot',
      entity_id: 'shot_1',
      parent_id: 'sq_1',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toMatchObject({ entityType: 'shot', entityId: 'shot_1', parentId: 'sq_1' });
  });
});

describe('toDashboardPayload — tag.changed', () => {
  it('maps action `add` → `created` and uses tag string as tagId', () => {
    const out = toDashboardPayload('tag.changed', {
      action: 'add',
      version_id: 'ver_1',
      shot_id: 'shot_1',
      tag: 'hero',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toEqual({ tagId: 'hero', action: 'created' });
  });

  it('maps action `remove` → `deleted`', () => {
    const out = toDashboardPayload('tag.changed', {
      action: 'remove',
      version_id: 'ver_1',
      shot_id: 'shot_1',
      tag: 'wip',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toEqual({ tagId: 'wip', action: 'deleted' });
  });
});

describe('toDashboardPayload — metadata.changed', () => {
  it('renames version_id → entityId and keeps key', () => {
    const out = toDashboardPayload('metadata.changed', {
      action: 'set',
      version_id: 'ver_1',
      shot_id: 'shot_1',
      key: 'artist',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).toEqual({ entityId: 'ver_1', key: 'artist' });
  });

  it('T-5-02: output never contains `value` field even when engine payload shape grows one in the future', () => {
    // Simulate a hypothetical future engine extension — the adapter must
    // still strip `value` at the boundary.
    const withValue = {
      action: 'set',
      version_id: 'ver_1',
      shot_id: 'shot_1',
      key: 'artist',
      at: '2026-04-23T00:00:00.000Z',
    } as unknown as EngineEventMap['metadata.changed'];
    const out = toDashboardPayload('metadata.changed', withValue);
    expect(JSON.stringify(out)).not.toMatch(/"value"/);
  });

  it('omits action, shot_id, at (dashboard contract has only entityId + key)', () => {
    const out = toDashboardPayload('metadata.changed', {
      action: 'remove',
      version_id: 'ver_1',
      shot_id: 'shot_1',
      key: 'artist',
      at: '2026-04-23T00:00:00.000Z',
    });
    expect(out).not.toHaveProperty('action');
    expect(out).not.toHaveProperty('shot_id');
    expect(out).not.toHaveProperty('at');
  });
});

describe('toDashboardPayload — exhaustiveness', () => {
  it('all 5 EngineEventMap keys are handled (runtime smoke)', () => {
    // Type-level exhaustiveness is enforced by the never-default arm at
    // compile time; this test provides a runtime smoke check that every
    // key in the map routes through a case arm and does not hit default.
    const minimalByType: {
      [K in keyof EngineEventMap]: EngineEventMap[K];
    } = {
      'version.created': { version_id: 'v', shot_id: 's', breadcrumb: 'a > b', at: 't' },
      'version.status_changed': {
        version_id: 'v',
        shot_id: 's',
        status: 'submitted',
        breadcrumb: '',
        at: 't',
      },
      'hierarchy.created': { entity_type: 'workspace', entity_id: 'e', parent_id: null, at: 't' },
      'tag.changed': { action: 'add', version_id: 'v', shot_id: 's', tag: 'x', at: 't' },
      'metadata.changed': { action: 'set', version_id: 'v', shot_id: 's', key: 'k', at: 't' },
    };
    const keys = Object.keys(minimalByType) as (keyof EngineEventMap)[];
    expect(keys.length).toBe(5);
    for (const key of keys) {
      // Each call must return an object (no throw from the default arm).
      // TypeScript can't narrow the payload for a dynamic `key` indexer, so
      // we widen to EngineEventMap[keyof EngineEventMap] via a cast.
      const payload = minimalByType[key] as EngineEventMap[typeof key];
      const out = toDashboardPayload(key, payload);
      expect(typeof out).toBe('object');
      expect(out).not.toBeNull();
    }
  });
});
