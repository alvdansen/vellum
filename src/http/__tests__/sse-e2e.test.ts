// src/http/__tests__/sse-e2e.test.ts
//
// End-to-end seam test for the SSE wire-shape boundary (Plan 05-13, CR-01
// fix). This is the test whose absence Plan 05-11 SUMMARY explicitly
// flagged: "Serialization-boundary drift is still unresolved. Plan 11 gates
// it with tests but does not fix it."
//
// What this covers that sse.test.ts + sse-adapter.test.ts + the dashboard-
// side sse-signal-integration.test.tsx each miss individually:
//
//  - sse.test.ts uses FakeEngine + hand-rolled payloads; never exercises
//    the real EngineEmitter.emitEvent pathway.
//  - sse-adapter.test.ts isolates the adapter; never exercises JSON.stringify
//    + SSE framing + HTTP wire.
//  - sse-signal-integration.test.tsx uses a MockEventSource fed hand-rolled
//    payloads; never exercises a real server emission.
//
// This test pipes:
//   real EngineEmitter.emitEvent('version.created', {version_id, ...})
//   → real createSseHandler listener
//   → real toDashboardPayload adapter
//   → real JSON.stringify
//   → real Hono streamSSE
//   → real HTTP fetch consumer (app.request)
//   → real SSE frame parser (regex-free, newline-split)
//   → real dashboard-writer logic (reproduction of active-generations.ts)
//   → assertion on the resulting ActiveGeneration row.
//
// Failure mode: if the adapter is removed, if a key is renamed on one side
// only, or if the status enum drifts, THIS test fails with a clear row-
// level mismatch. This is the regression gate the phase verification
// confirmed was missing.
//
// Architecture-purity note: the test does NOT import from
// packages/dashboard/src/**. It reproduces the writer's behaviour inline
// using the dashboard's TYPE contract as ground truth (documented in the
// type block below). This keeps the server test tree free of dashboard
// runtime dependencies (preact/signals, etc.).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createSseHandler } from '../sse.js';
import { createEngineEmitter, type EngineEmitter } from '../../engine/events.js';

// ================================================================
// Dashboard type contract + writer reproduction (mirror of
// packages/dashboard/src/types/events.ts +
// packages/dashboard/src/state/active-generations.ts). Kept in sync by
// the sse-adapter.test.ts + the type definitions in the adapter itself.
// ================================================================

interface DashboardVersionCreatedPayload {
  versionId: string;
  shotId: string;
  label: string;
}

interface DashboardVersionStatusChangedPayload {
  versionId: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
}

interface DashboardHierarchyCreatedPayload {
  entityType: 'workspace' | 'project' | 'sequence' | 'shot';
  entityId: string;
  parentId?: string;
}

interface ActiveGeneration {
  versionId: string;
  shotId: string;
  label: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
}

/** Reproduction of active-generations.ts onVersionCreated. */
function appendOnVersionCreated(
  rows: ActiveGeneration[],
  payload: DashboardVersionCreatedPayload,
): ActiveGeneration[] {
  return [
    ...rows,
    {
      versionId: payload.versionId,
      shotId: payload.shotId,
      label: payload.label,
      status: 'queued',
    },
  ];
}

/** Reproduction of active-generations.ts onVersionStatusChanged. */
function mutateOnStatusChanged(
  rows: ActiveGeneration[],
  payload: DashboardVersionStatusChangedPayload,
): ActiveGeneration[] {
  return rows.map((r) =>
    r.versionId === payload.versionId ? { ...r, status: payload.status } : r,
  );
}

// ================================================================
// Harness helpers
// ================================================================

function buildRealApp(): { app: Hono; engine: { events: EngineEmitter } } {
  const engine = { events: createEngineEmitter() };
  const app = new Hono();
  app.get('/api/events', createSseHandler(engine as never, []));
  return { app, engine };
}

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
    /* aborted stream — return what we captured */
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

/**
 * Extract { event, data } pairs from an SSE wire payload. Handles the
 * minimum shape Hono's streamSSE produces: alternating `event: TYPE\n`
 * and `data: JSON\n\n` frames. Filters keep-alive comment frames
 * (the `: ping` that writeSSE serialises as `data: : ping\n\n`).
 */
function parseSseFrames(text: string): { event: string; data: unknown }[] {
  const blocks = text.split('\n\n').filter((b) => b.trim().length > 0);
  const out: { event: string; data: unknown }[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let event: string | null = null;
    let dataRaw: string | null = null;
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) dataRaw = line.slice('data:'.length).trim();
    }
    if (event && dataRaw !== null) {
      // Skip keep-alive: the keep-alive writes `data: : ping` with no event.
      if (dataRaw.startsWith(': ping')) continue;
      try {
        out.push({ event, data: JSON.parse(dataRaw) });
      } catch {
        // Skip malformed frames — the adapter + JSON.stringify should never produce these.
      }
    }
  }
  return out;
}

describe('SSE end-to-end seam — real engine.emitEvent → real adapter → real fetch → dashboard writer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('version.created SSE frame populates dashboard ActiveGeneration row with label', async () => {
    const { app, engine } = buildRealApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();

    // Real engine emission — the kind pipeline.ts:330 produces on submitGeneration.
    engine.events.emitEvent('version.created', {
      version_id: 'ver_real_1',
      shot_id: 'shot_real_1',
      breadcrumb: 'ws_demo > proj_1 > sq010 > sh010 > v001',
      at: '2026-04-23T00:00:00.000Z',
    });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);

    const frames = parseSseFrames(text);
    const frame = frames.find((f) => f.event === 'version.created');
    expect(frame, `expected version.created frame in: ${text}`).toBeDefined();
    const parsed = frame!.data as DashboardVersionCreatedPayload;

    // Shape assertion — before the adapter landed, these were all undefined.
    expect(parsed.versionId).toBe('ver_real_1');
    expect(parsed.shotId).toBe('shot_real_1');
    expect(parsed.label).toBe('v001');
    // No snake_case keys leak through.
    expect((parsed as unknown as Record<string, unknown>).version_id).toBeUndefined();
    expect((parsed as unknown as Record<string, unknown>).shot_id).toBeUndefined();

    // Dashboard writer reproduction — row lands with populated keys.
    const rows = appendOnVersionCreated([], parsed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      versionId: 'ver_real_1',
      shotId: 'shot_real_1',
      label: 'v001',
      status: 'queued',
    });
  });

  it.each([
    ['submitted', 'queued'],
    ['running', 'running'],
    ['completed', 'complete'],
    ['failed', 'failed'],
  ] as const)(
    'version.status_changed with server-status %s renders as dashboard-status %s',
    async (serverStatus, dashboardStatus) => {
      const { app, engine } = buildRealApp();
      const controller = new AbortController();
      const resPromise = app.request('/api/events', { signal: controller.signal });
      await Promise.resolve();
      await Promise.resolve();

      engine.events.emitEvent('version.status_changed', {
        version_id: 'ver_trans_1',
        shot_id: 'shot_1',
        status: serverStatus,
        breadcrumb: 'ws > p > sq > sh > v001',
        at: '2026-04-23T00:00:00.000Z',
      });

      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      const text = await drain((await resPromise).body);

      const frames = parseSseFrames(text);
      const frame = frames.find((f) => f.event === 'version.status_changed');
      expect(frame, `expected version.status_changed frame in: ${text}`).toBeDefined();
      const parsed = frame!.data as DashboardVersionStatusChangedPayload;

      expect(parsed.versionId).toBe('ver_trans_1');
      expect(parsed.status).toBe(dashboardStatus);
      // Off-union statuses would slip through if the adapter were removed;
      // this guard fails the test the moment anyone bypasses toDashboardPayload.
      expect(['queued', 'running', 'complete', 'failed']).toContain(parsed.status);

      // Dashboard writer reproduction — status lands on an ActiveGeneration row.
      let rows: ActiveGeneration[] = appendOnVersionCreated([], {
        versionId: 'ver_trans_1',
        shotId: 'shot_1',
        label: 'v001',
      });
      rows = mutateOnStatusChanged(rows, parsed);
      expect(rows[0].status).toBe(dashboardStatus);
    },
  );

  it('hierarchy.created SSE frame matches dashboard camelCase contract (VERIFICATION.md captured frame)', async () => {
    const { app, engine } = buildRealApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();

    // This is the EXACT shape from VERIFICATION.md §Behavioral Spot-Checks.
    engine.events.emitEvent('hierarchy.created', {
      entity_type: 'workspace',
      entity_id: 'ws_AQ0bI2jVPWipWDnMIH2-k',
      parent_id: null,
      at: '2026-04-23T00:00:00.000Z',
    });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);

    const frames = parseSseFrames(text);
    const frame = frames.find((f) => f.event === 'hierarchy.created');
    expect(frame, `expected hierarchy.created frame in: ${text}`).toBeDefined();
    const parsed = frame!.data as DashboardHierarchyCreatedPayload;

    expect(parsed.entityType).toBe('workspace');
    expect(parsed.entityId).toBe('ws_AQ0bI2jVPWipWDnMIH2-k');
    // null parent_id coerces to undefined → JSON.stringify strips the key.
    expect(parsed.parentId).toBeUndefined();
    // Snake_case keys must not leak.
    expect((parsed as unknown as Record<string, unknown>).entity_type).toBeUndefined();
    expect((parsed as unknown as Record<string, unknown>).entity_id).toBeUndefined();
    expect((parsed as unknown as Record<string, unknown>).parent_id).toBeUndefined();
  });

  it('hierarchy.created with non-null parent_id populates parentId', async () => {
    const { app, engine } = buildRealApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();

    engine.events.emitEvent('hierarchy.created', {
      entity_type: 'shot',
      entity_id: 'sh_1',
      parent_id: 'sq_1',
      at: '2026-04-23T00:00:00.000Z',
    });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);
    const frames = parseSseFrames(text);
    const frame = frames.find((f) => f.event === 'hierarchy.created');
    const parsed = frame!.data as DashboardHierarchyCreatedPayload;
    expect(parsed.parentId).toBe('sq_1');
  });

  it('tag.changed translates action add → created + tagId from tag string', async () => {
    const { app, engine } = buildRealApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();

    engine.events.emitEvent('tag.changed', {
      action: 'add',
      version_id: 'ver_1',
      shot_id: 'shot_1',
      tag: 'hero',
      at: '2026-04-23T00:00:00.000Z',
    });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);
    const frames = parseSseFrames(text);
    const frame = frames.find((f) => f.event === 'tag.changed');
    const parsed = frame!.data as { tagId: string; action: string };
    expect(parsed.tagId).toBe('hero');
    expect(parsed.action).toBe('created');
  });

  it('metadata.changed translates version_id → entityId and strips `value` (T-5-02)', async () => {
    const { app, engine } = buildRealApp();
    const controller = new AbortController();
    const resPromise = app.request('/api/events', { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();

    engine.events.emitEvent('metadata.changed', {
      action: 'set',
      version_id: 'ver_1',
      shot_id: 'shot_1',
      key: 'artist',
      at: '2026-04-23T00:00:00.000Z',
    });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const text = await drain((await resPromise).body);
    // T-5-02 regression: no "value" key anywhere in the wire.
    expect(text).not.toMatch(/"value"\s*:/);
    const frames = parseSseFrames(text);
    const frame = frames.find((f) => f.event === 'metadata.changed');
    const parsed = frame!.data as { entityId: string; key: string };
    expect(parsed.entityId).toBe('ver_1');
    expect(parsed.key).toBe('artist');
  });
});
