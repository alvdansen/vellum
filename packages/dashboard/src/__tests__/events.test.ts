// packages/dashboard/src/__tests__/events.test.ts
//
// Unit tests for the SSE client in ../lib/events.ts (Plan 05-08, Task 1).
// Mocks EventSource globally because jsdom does not ship an implementation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Minimal EventSource stub that records instances + dispatched listeners. */
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  listeners: Map<string, ((e: MessageEvent) => void)[]> = new Map();
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(handler);
  }

  /** Test helper — fires all registered handlers for `type` with JSON-stringified data. */
  dispatchEvent(type: string, data: unknown) {
    const handlers = this.listeners.get(type) ?? [];
    for (const h of handlers) {
      h(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }

  close() {
    this.closed = true;
  }
}
vi.stubGlobal('EventSource', MockEventSource);

// Import AFTER stubbing EventSource so the module under test picks up the mock
// if it caches the global at module-load time.
import { startSse, stopSse, onSseEvent, offSseEvent } from '../lib/events.js';

describe('SSE client', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    // Reset the module's singleton between tests.
    stopSse();
  });

  it('startSse() creates an EventSource at /api/events', () => {
    startSse();
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toBe('/api/events');
  });

  it('startSse() twice does not create a second EventSource', () => {
    startSse();
    startSse();
    expect(MockEventSource.instances.length).toBe(1);
  });

  it('stopSse() closes the EventSource', () => {
    startSse();
    stopSse();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it('onSseEvent listener is called when event fires', () => {
    const fn = vi.fn();
    startSse();
    onSseEvent('version.created', fn);
    MockEventSource.instances[0].dispatchEvent('version.created', {
      versionId: 'v1',
      shotId: 's1',
      label: 'v001',
    });
    expect(fn).toHaveBeenCalledWith({
      versionId: 'v1',
      shotId: 's1',
      label: 'v001',
    });
  });

  it('offSseEvent removes listener', () => {
    const fn = vi.fn();
    startSse();
    onSseEvent('version.created', fn);
    offSseEvent('version.created', fn);
    MockEventSource.instances[0].dispatchEvent('version.created', {
      versionId: 'v1',
      shotId: 's1',
      label: 'v001',
    });
    expect(fn).not.toHaveBeenCalled();
  });
});
