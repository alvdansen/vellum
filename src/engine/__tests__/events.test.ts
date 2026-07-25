import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  EngineEmitter,
  createEngineEmitter,
  type EngineEventMap,
  type VersionCreatedPayload,
  type VersionStatusChangedPayload,
  type TagChangedPayload,
  type MetadataChangedPayload,
  type HierarchyCreatedPayload,
} from '../events.js';

/**
 * Plan 05-02 Task 1 — EngineEmitter tests.
 *
 * D-WEBUI-06: 5 event types + payload shapes.
 * T-5-02 (mitigate): MetadataChangedPayload MUST NOT contain a `value` field.
 * D-WEBUI-29: Engine gains a typed EventEmitter (no new dep — just node:events).
 * D-WEBUI-31: zero MCP + zero HTTP imports in events.ts.
 */

describe('EngineEmitter', () => {
  it('is an EventEmitter — emitEvent/onEvent roundtrip for version.created', () => {
    const emitter = new EngineEmitter();
    expect(emitter).toBeInstanceOf(EventEmitter);

    const received: VersionCreatedPayload[] = [];
    const listener = (payload: VersionCreatedPayload): void => {
      received.push(payload);
    };
    emitter.onEvent('version.created', listener);

    const payload: VersionCreatedPayload = {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      breadcrumb: 'ws > proj > sq010 > sh010 > v001',
      at: new Date('2026-04-23T00:00:00.000Z').toISOString(),
    };
    emitter.emitEvent('version.created', payload);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(payload);
  });

  it('offEvent removes the listener — no call after removal', () => {
    const emitter = new EngineEmitter();
    let count = 0;
    const listener = (): void => {
      count++;
    };
    emitter.onEvent('version.created', listener);

    emitter.emitEvent('version.created', {
      version_id: 'v1',
      shot_id: 's1',
      breadcrumb: '',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(count).toBe(1);

    emitter.offEvent('version.created', listener);
    emitter.emitEvent('version.created', {
      version_id: 'v2',
      shot_id: 's2',
      breadcrumb: '',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(count).toBe(1); // listener was removed — no increment
  });

  it('T-5-02: MetadataChangedPayload does NOT contain a `value` field at runtime', () => {
    const emitter = new EngineEmitter();
    const captured: MetadataChangedPayload[] = [];
    emitter.onEvent('metadata.changed', (p) => captured.push(p));

    const payload: MetadataChangedPayload = {
      action: 'set',
      version_id: 'ver_1',
      shot_id: 'shot_1',
      key: 'artist',
      at: '2026-04-23T00:00:00.000Z',
    };
    emitter.emitEvent('metadata.changed', payload);

    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty('value');
    expect(Object.keys(captured[0]).sort()).toEqual(
      ['action', 'at', 'key', 'shot_id', 'version_id'].sort(),
    );
  });

  it('createEngineEmitter() sets maxListeners >= 100', () => {
    const emitter = createEngineEmitter();
    expect(emitter).toBeInstanceOf(EngineEmitter);
    expect(emitter.getMaxListeners()).toBeGreaterThanOrEqual(100);
  });

  it('all 5 event types accept typed listeners without TS errors', () => {
    const emitter = createEngineEmitter();

    // Type-checked assignments — if any EngineEventMap entry drifts, tsc -noEmit fails.
    const onStatus = (p: VersionStatusChangedPayload): void => {
      void p.status;
    };
    const onCreated = (p: VersionCreatedPayload): void => {
      void p.version_id;
    };
    const onTag = (p: TagChangedPayload): void => {
      void p.action;
    };
    const onMeta = (p: MetadataChangedPayload): void => {
      void p.key;
    };
    const onHier = (p: HierarchyCreatedPayload): void => {
      void p.entity_type;
    };

    emitter.onEvent('version.status_changed', onStatus);
    emitter.onEvent('version.created', onCreated);
    emitter.onEvent('tag.changed', onTag);
    emitter.onEvent('metadata.changed', onMeta);
    emitter.onEvent('hierarchy.created', onHier);

    // Drive each event to ensure the map key / payload pairing is structurally valid.
    emitter.emitEvent('version.status_changed', {
      version_id: 'v1',
      shot_id: 's1',
      status: 'completed',
      breadcrumb: '',
      at: '2026-01-01T00:00:00.000Z',
    });
    emitter.emitEvent('version.created', {
      version_id: 'v1',
      shot_id: 's1',
      breadcrumb: '',
      at: '2026-01-01T00:00:00.000Z',
    });
    emitter.emitEvent('tag.changed', {
      action: 'add',
      version_id: 'v1',
      shot_id: 's1',
      tag: 'hero',
      at: '2026-01-01T00:00:00.000Z',
    });
    emitter.emitEvent('metadata.changed', {
      action: 'set',
      version_id: 'v1',
      shot_id: 's1',
      key: 'artist',
      at: '2026-01-01T00:00:00.000Z',
    });
    emitter.emitEvent('hierarchy.created', {
      entity_type: 'workspace',
      entity_id: 'ws_1',
      parent_id: null,
      at: '2026-01-01T00:00:00.000Z',
    });

    // Compile-time / runtime witness — a string literal that exists in EngineEventMap.
    const probe: keyof EngineEventMap = 'version.created';
    expect(probe).toBe('version.created');
  });

  it('emitEvent returns boolean (delegates to EventEmitter.emit)', () => {
    const emitter = new EngineEmitter();
    const noListeners = emitter.emitEvent('version.created', {
      version_id: 'v1',
      shot_id: 's1',
      breadcrumb: '',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(noListeners).toBe(false);

    emitter.onEvent('version.created', () => {});
    const withListener = emitter.emitEvent('version.created', {
      version_id: 'v2',
      shot_id: 's2',
      breadcrumb: '',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(withListener).toBe(true);
  });
});
