// Unit tests for createSseHandler (Plan 05-05, D-WEBUI-03 / D-WEBUI-29 / T-5-01 / T-5-08).
//
// Scope: SSE route wiring — origin gate, typed-event forwarding (5 payload
// types), keep-alive ping, listener cleanup on disconnect.
//
// The Hono test harness (`app.request`) returns a Response whose body is a
// ReadableStream produced by `streamSSE` in a separate async callback. To
// exercise the handler deterministically we:
//   1. Kick off the request (promise pending).
//   2. Emit events on the FakeEngine.events emitter.
//   3. Abort to close the stream.
//   4. Read the full body text and assert shape.
//
// Cleanup + keep-alive assertions use listener-spy + fake-timer patterns so we
// never depend on real wall-clock time. The plan's `<action>` block explicitly
// allows adapting tests to what the harness supports, but mandates the cleanup
// test — we keep that one first-class via a spy on `offEvent`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createSseHandler } from '../sse.js';
import { FakeEngine } from '../../test-utils/fake-engine.js';

function buildApp(allowedOrigins: string[] = []) {
  const engine = new FakeEngine();
  const app = new Hono();
  // The FakeEngine surface is structurally compatible with the real Engine
  // facade for every method/field the SSE handler touches (`events` only).
  // Cast narrows the type so the Hono route accepts it without pulling in the
  // full Engine class which would require a live DB.
  app.get('/api/events', createSseHandler(engine as never, allowedOrigins));
  return { app, engine };
}

// Helper: drain a ReadableStream<Uint8Array> to a UTF-8 string.
async function drain(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch {
    // Stream aborted — return whatever we captured.
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

describe('createSseHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns text/event-stream content type', async () => {
    const { app } = buildApp();
    const controller = new AbortController();
    // The response headers are written before the body stream starts, so we
    // can inspect them even though we never await the body.
    const resPromise = app.request('/api/events', { signal: controller.signal });
    // Give the run() microtask a chance to set headers + kick off the cb.
    await Promise.resolve();
    controller.abort();
    const res = await resPromise;
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    // Drain to release the stream.
    await drain(res.body);
  });

  it('origin not in allowlist → 403, stream never opened', async () => {
    const { app, engine } = buildApp(['http://localhost:5173']);
    const res = await app.request('/api/events', {
      headers: { Origin: 'http://evil.example.com' },
    });
    expect(res.status).toBe(403);
    // Content-Type should not be event-stream — we bailed before streamSSE.
    expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/event-stream/);
    // No listeners should have been attached to the emitter.
    expect(engine.events.listenerCount('version.created')).toBe(0);
  });

  it('empty allowedOrigins allows any origin (dev mode)', async () => {
    const { app } = buildApp([]);
    const controller = new AbortController();
    const resPromise = app.request('/api/events', {
      headers: { Origin: 'http://anything.example.com' },
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const res = await resPromise;
    expect(res.status).not.toBe(403);
    await drain(res.body);
  });

  it('origin present AND in allowlist → passes through', async () => {
    const { app } = buildApp(['http://localhost:5173']);
    const controller = new AbortController();
    const resPromise = app.request('/api/events', {
      headers: { Origin: 'http://localhost:5173' },
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const res = await resPromise;
    expect(res.status).not.toBe(403);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    await drain(res.body);
  });

  it('forwards version.created as SSE data line with event name (adapted shape)', async () => {
    const { app, engine } = buildApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    // Yield so the streamSSE callback registers the listeners before we emit.
    await Promise.resolve();
    await Promise.resolve();
    const payload = {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      breadcrumb: 'ws > p > sq > sh > v001',
      at: '2026-04-23T00:00:00.000Z',
    };
    engine.events.emitEvent('version.created', payload);
    // Give the write a tick to flush into the stream.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const res = await resPromise;
    const text = await drain(res.body);
    expect(text).toContain('event: version.created');
    // CR-01 fix (Plan 05-13): adapter translates snake_case + breadcrumb to
    // camelCase + derived label before JSON.stringify.
    expect(text).toContain('"versionId":"ver_1"');
    expect(text).toContain('"shotId":"shot_1"');
    expect(text).toContain('"label":"v001"');
    // Snake_case keys MUST NOT leak through.
    expect(text).not.toMatch(/"version_id"/);
    expect(text).not.toMatch(/"shot_id"/);
    expect(text).not.toMatch(/"breadcrumb"/);
  });

  it('forwards version.status_changed (adapted shape — completed→complete)', async () => {
    const { app, engine } = buildApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    const payload = {
      version_id: 'ver_1',
      shot_id: 'shot_1',
      status: 'completed' as const,
      breadcrumb: 'ws > p > sq > sh > v001',
      at: '2026-04-23T00:00:00.000Z',
    };
    engine.events.emitEvent('version.status_changed', payload);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);
    expect(text).toContain('event: version.status_changed');
    // CR-01 fix (Plan 05-13): adapter translates version_id → versionId and
    // maps server status 'completed' → dashboard status 'complete'.
    expect(text).toContain('"versionId":"ver_1"');
    expect(text).toContain('"status":"complete"');
    // Server status enum MUST NOT leak through.
    expect(text).not.toMatch(/"status":"completed"/);
    expect(text).not.toMatch(/"version_id"/);
  });

  it('forwards tag.changed (adapted shape — add→created)', async () => {
    const { app, engine } = buildApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    const payload = {
      action: 'add' as const,
      version_id: 'ver_1',
      shot_id: 'shot_1',
      tag: 'hero',
      at: '2026-04-23T00:00:00.000Z',
    };
    engine.events.emitEvent('tag.changed', payload);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);
    expect(text).toContain('event: tag.changed');
    // CR-01 fix (Plan 05-13): adapter maps tag → tagId, action 'add' → 'created'.
    expect(text).toContain('"tagId":"hero"');
    expect(text).toContain('"action":"created"');
    // Server-side action enum ('add') MUST NOT leak through.
    expect(text).not.toMatch(/"action":"add"/);
    expect(text).not.toMatch(/"version_id"/);
  });

  it('forwards metadata.changed without leaking `value` (adapted shape)', async () => {
    const { app, engine } = buildApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    // T-5-02: the payload type deliberately omits `value`; this test asserts
    // the SSE wire never carries a `value` key even by accident (e.g., a stray
    // any-cast that attaches value client-side). The payload shape here is
    // exactly what pipeline.ts emits.
    const payload = {
      action: 'set' as const,
      version_id: 'ver_1',
      shot_id: 'shot_1',
      key: 'artist',
      at: '2026-04-23T00:00:00.000Z',
    };
    engine.events.emitEvent('metadata.changed', payload);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);
    expect(text).toContain('event: metadata.changed');
    // CR-01 fix (Plan 05-13): adapter maps version_id → entityId, drops action/
    // shot_id/at. T-5-02 `value` exclusion preserved by the adapter itself.
    expect(text).toContain('"entityId":"ver_1"');
    expect(text).toContain('"key":"artist"');
    expect(text).not.toMatch(/"version_id"/);
    expect(text).not.toMatch(/"shot_id"/);
    expect(text).not.toMatch(/"action"/);
    // T-5-02 regression — no `"value"` substring anywhere in the SSE frame.
    expect(text).not.toMatch(/"value"\s*:/);
  });

  it('forwards hierarchy.created (adapted shape — camelCase, null parent stripped)', async () => {
    const { app, engine } = buildApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    const payload = {
      entity_type: 'workspace' as const,
      entity_id: 'ws_1',
      parent_id: null,
      at: '2026-04-23T00:00:00.000Z',
    };
    engine.events.emitEvent('hierarchy.created', payload);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);
    expect(text).toContain('event: hierarchy.created');
    // CR-01 fix (Plan 05-13): adapter renames snake_case → camelCase; parent_id
    // null coerces to undefined and JSON.stringify strips the key.
    expect(text).toContain('"entityType":"workspace"');
    expect(text).toContain('"entityId":"ws_1"');
    // Snake_case keys MUST NOT leak.
    expect(text).not.toMatch(/"entity_type"/);
    expect(text).not.toMatch(/"entity_id"/);
    expect(text).not.toMatch(/"parent_id"/);
    // null parent: `parentId` key is omitted entirely (undefined → stripped).
    expect(text).not.toMatch(/"parentId"/);
  });

  it('cleanup: offEvent called for all 5 types on disconnect (T-5-08)', async () => {
    const { app, engine } = buildApp();
    const offSpy = vi.spyOn(engine.events, 'offEvent');
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    // Let the streamSSE cb register listeners.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    // Let the abort handler run + cleanup fire.
    await Promise.resolve();
    await Promise.resolve();
    await drain((await resPromise).body);
    // A few extra microtask yields for the abort-handler resolve → cleanup.
    await Promise.resolve();
    await Promise.resolve();

    const calledTypes = offSpy.mock.calls.map((c) => c[0]);
    expect(calledTypes).toContain('version.created');
    expect(calledTypes).toContain('version.status_changed');
    expect(calledTypes).toContain('tag.changed');
    expect(calledTypes).toContain('metadata.changed');
    expect(calledTypes).toContain('hierarchy.created');
    // No residual listeners left on the emitter — belt-and-suspenders regression
    // guard against a future code path that calls offEvent but leaves a stray
    // listener behind (e.g., if the keep-alive ever subscribed to events).
    expect(engine.events.listenerCount('version.created')).toBe(0);
    expect(engine.events.listenerCount('version.status_changed')).toBe(0);
    expect(engine.events.listenerCount('tag.changed')).toBe(0);
    expect(engine.events.listenerCount('metadata.changed')).toBe(0);
    expect(engine.events.listenerCount('hierarchy.created')).toBe(0);
  });

  it('keep-alive ping comment emitted after 30s (T-5-08)', async () => {
    const { app } = buildApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    // Let the streamSSE cb register the setInterval.
    await Promise.resolve();
    await Promise.resolve();
    // Advance past the 30s keep-alive tick.
    await vi.advanceTimersByTimeAsync(31_000);
    controller.abort();
    const text = await drain((await resPromise).body);
    // SSE comment form: ": ping" — a bare colon-prefixed line the browser
    // EventSource ignores, but that keeps the TCP connection from going idle.
    expect(text).toContain(': ping');
  });
});
