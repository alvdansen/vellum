/**
 * hierarchy.created SSE → live tree update.
 *
 * A workspace created over MCP while the dashboard is open must appear in
 * the sidebar without a reload, and a project created under an expanded
 * workspace must refetch that workspace's children. Before this handler
 * existed, the server emitted hierarchy.created (verified on the wire) and
 * the dashboard subscribed to none of it — the README §5 walkthrough
 * ("create a workspace, watch the panel update") failed in the order it is
 * written.
 *
 * Harness mirrors sse-signal-integration.test.tsx (MockEventSource stubbed
 * before import) + HomeView-sort-defaults.test.tsx (fetch route map).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h } from 'preact';
import { render, screen, waitFor } from '@testing-library/preact';

/** Same MockEventSource shape as sse-signal-integration.test.tsx. */
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
  dispatchEvent(type: string, data: unknown) {
    const handlers = this.listeners.get(type) ?? [];
    for (const handler of handlers) {
      handler(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
  close() {
    this.closed = true;
  }
}
vi.stubGlobal('EventSource', MockEventSource);

// Import AFTER stubbing EventSource so the events module binds to the mock.
// eslint-disable-next-line import/first
import { HomeView } from '../views/HomeView.js';
// eslint-disable-next-line import/first
import { startSse, stopSse } from '../lib/events.js';
// eslint-disable-next-line import/first
import { workspaces } from '../state/hierarchy.js';

const WS_A = { id: 'ws_a', name: 'alpha', created_at: 1 };
const WS_B = { id: 'ws_b', name: 'beta', created_at: 2 };

/** Route-map fetch stub; routes match by startsWith, later calls can be
 *  re-pointed by mutating the map. */
function stubFetch(routes: Record<string, () => unknown>) {
  const spy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.includes(prefix)) {
        return Promise.resolve(
          new Response(JSON.stringify(body()), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
    }
    return Promise.resolve(new Response('{"items":[]}', { status: 200 }));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('HomeView — hierarchy.created SSE handler', () => {
  beforeEach(() => {
    workspaces.value = [];
    MockEventSource.instances.length = 0;
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    stopSse();
    vi.unstubAllGlobals();
  });

  it('a workspace created elsewhere appears in the tree without a reload', async () => {
    // First hydration returns one workspace; after the event, two.
    let list = [WS_A];
    stubFetch({ '/api/workspaces': () => ({ items: list, total_count: list.length }) });

    render(h(HomeView, {}));
    startSse();
    await waitFor(() => expect(workspaces.value.map((w) => w.id)).toEqual(['ws_a']));

    list = [WS_A, WS_B];
    // Wire shape is the toDashboardPayload output (camelCase, parentId
    // omitted for workspaces) — NOT the server's engine payload. The first
    // version of this test dispatched the engine's snake_case shape and
    // passed against a handler making the same mistake; dispatch what the
    // adapter actually sends.
    MockEventSource.instances[0]!.dispatchEvent('hierarchy.created', {
      entityType: 'workspace',
      entityId: 'ws_b',
    });

    await waitFor(() => expect(workspaces.value.map((w) => w.id)).toEqual(['ws_a', 'ws_b']));
    await waitFor(() => expect(screen.getByText('beta')).toBeTruthy());
  });

  it('a project created under a workspace refetches that workspace children', async () => {
    stubFetch({
      '/api/workspaces/ws_a/projects': () => ({ items: [], total_count: 0 }),
      '/api/workspaces': () => ({ items: [WS_A], total_count: 1 }),
    });
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;

    render(h(HomeView, {}));
    startSse();
    await waitFor(() => expect(workspaces.value.length).toBe(1));
    const callsBefore = fetchSpy.mock.calls.length;

    MockEventSource.instances[0]!.dispatchEvent('hierarchy.created', {
      entityType: 'project',
      entityId: 'proj_new',
      parentId: 'ws_a',
    });

    await waitFor(() => {
      const projectCalls = fetchSpy.mock.calls
        .slice(callsBefore)
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/workspaces/ws_a/projects'));
      expect(projectCalls.length).toBe(1);
    });
  });
});
