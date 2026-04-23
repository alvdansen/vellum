import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { buildFakeEngine, FakeEngine } from '../fake-engine.js';
import { buildStackWithOutputs } from '../fixtures.js';

describe('Phase 5 test-utils extensions (D-WEBUI-37)', () => {
  describe('FakeEngine', () => {
    it('exposes a public events EventEmitter', () => {
      const engine = buildFakeEngine();
      expect(engine).toBeInstanceOf(FakeEngine);
      expect(engine.events).toBeInstanceOf(EventEmitter);
    });

    it('emits and receives version.created with the same payload', () => {
      const engine = buildFakeEngine();
      const received: unknown[] = [];
      engine.events.on('version.created', (payload) => received.push(payload));
      const payload = { type: 'version.created', version_id: 'ver_1', shot_id: 'shot_1', breadcrumb: [], at: '2026-04-23T00:00:00.000Z' };
      engine.events.emit('version.created', payload);
      expect(received).toEqual([payload]);
    });

    it('records calls and returns canned fixtures', () => {
      const engine = buildFakeEngine();
      const v = engine.getVersion('ver_42');
      expect(engine.calls).toContainEqual({ method: 'getVersion', args: ['ver_42'] });
      expect(v.entity.id).toBe('ver_42');
      expect(v.entity.tags).toEqual([]);
      expect(v.breadcrumb.entries).toEqual([]);
    });

    it('reproduceVersion is async and returns a typed reproduction result', async () => {
      const engine = buildFakeEngine();
      const result = await engine.reproduceVersion('ver_src', 'note');
      expect(result.entity.lineage_type).toBe('reproduce');
      expect(result.entity.parent_version_id).toBe('ver_src');
      expect(engine.calls).toContainEqual({ method: 'reproduceVersion', args: ['ver_src', 'note'] });
    });

    it('reset clears calls + listeners + cans', () => {
      const engine = buildFakeEngine();
      let counter = 0;
      engine.events.on('version.created', () => { counter++; });
      engine.cans.versions.set('ver_x', { entity: { id: 'ver_x' } as never, breadcrumb: { entries: [], text: '' } });
      engine.getVersion('ver_x');
      engine.reset();
      engine.events.emit('version.created', {});
      expect(counter).toBe(0);
      expect(engine.calls).toHaveLength(0);
      expect(engine.cans.versions.size).toBe(0);
    });
  });

  describe('buildStackWithOutputs', () => {
    let cleanups: Array<() => void> = [];
    afterEach(() => { for (const c of cleanups) c(); cleanups = []; });

    it('returns engine + tmp outputsDir that exists on disk', () => {
      const stack = buildStackWithOutputs();
      cleanups.push(stack.cleanup);
      expect(stack.engine).toBeDefined();
      expect(stack.outputsDir).toMatch(/vfx-test-outputs-/);
      expect(existsSync(stack.outputsDir)).toBe(true);
      expect(stack.client).toBeDefined();
      expect(stack.sqlite).toBeDefined();
    });

    it('cleanup removes the tmp outputsDir', () => {
      const stack = buildStackWithOutputs();
      const dir = stack.outputsDir;
      stack.cleanup();
      expect(existsSync(dir)).toBe(false);
    });
  });
});
