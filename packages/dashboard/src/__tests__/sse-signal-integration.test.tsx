// packages/dashboard/src/__tests__/sse-signal-integration.test.tsx
//
// Cross-cutting integration test for the SSE → signal → render chain (Plan
// 05-11, Task 2). Drives an in-memory EventSource mock, wires it through the
// real events.ts dispatcher and active-generations.ts writers, then asserts
// the ActiveGenerationsPanel view renders the expected output.
//
// This is the confidence gate for WEBUI-01 / WEBUI-03: if the
// camelCase/snake_case boundary drifts (payload shape at the wire vs. what the
// writer reads), tests here must FAIL because they go all the way through to
// rendered text — not just signal mutation. Plan 05-08 SUMMARY flagged this as
// threat_flag: serialization-boundary-drift; this file is the regression gate.
//
// Test coverage (5 assertions per plan behavior contract):
//   1. Panel shows empty state when no generations exist
//   2. version.created SSE frame → panel renders new entry label
//   3. version.status_changed SSE frame → panel updates status pill
//   4. Two version.created frames → panel renders two entries
//   5. version.status_changed for unknown id → does not crash
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Imports only from the dashboard tree.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';

/** Minimal EventSource stub used by lib/events.ts. Mirrors the pattern
 *  established in events.test.ts (Plan 08) — no removeEventListener is needed
 *  because the events.ts dispatch layer uses a single wrapper per type + a
 *  listeners Set (see 05-08-SUMMARY "single-dispatch-wrapper per event type"). */
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

  /** Test helper — fires all registered handlers for `type` with a
   *  JSON-stringified payload. The events.ts dispatcher parses back via
   *  JSON.parse, so this exercises the full wire-shape round-trip. */
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

// Import AFTER stubbing EventSource so the module binds to the mock.
// eslint-disable-next-line import/first
import {
  activeGenerations,
  onVersionCreated,
  onVersionStatusChanged,
} from '../state/active-generations.js';
// eslint-disable-next-line import/first
import {
  startSse,
  stopSse,
  onSseEvent,
  offSseEvent,
} from '../lib/events.js';
// eslint-disable-next-line import/first
import { ActiveGenerationsPanel } from '../views/ActiveGenerationsPanel.js';

describe('SSE → signal → render integration', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    // Reset signal so terminal rows from prior tests don't leak.
    activeGenerations.value = [];
    // Wire SSE → signal bridge exactly as App.tsx does on mount.
    onSseEvent('version.created', onVersionCreated);
    onSseEvent('version.status_changed', onVersionStatusChanged);
    startSse();
  });

  afterEach(() => {
    // Mirror App.tsx cleanup to avoid stacking handlers across tests (per
    // 05-10-SUMMARY dedup note — remounts during HMR/StrictMode would
    // otherwise register duplicate listeners against the same function ref).
    offSseEvent('version.created', onVersionCreated);
    offSseEvent('version.status_changed', onVersionStatusChanged);
    stopSse();
  });

  it('ActiveGenerationsPanel shows empty state initially', () => {
    render(<ActiveGenerationsPanel />);
    expect(screen.getByText(/no active generations/i)).toBeTruthy();
  });

  it('version.created SSE event → panel shows new entry', async () => {
    render(<ActiveGenerationsPanel />);
    const es = MockEventSource.instances[0];
    expect(es).toBeTruthy();

    es.dispatchEvent('version.created', {
      versionId: 'v1',
      shotId: 's1',
      label: 'v001',
    });

    // Assert the rendered label — not just the signal value. If the payload
    // shape drifts (e.g. server emits snake_case) the writer would read
    // undefined for label and the assertion below fails, surfacing the drift.
    await waitFor(() => {
      expect(screen.getByText('v001')).toBeTruthy();
    });
    // Full pipeline assertion — StatusPill defaults to 'queued' for new rows
    // (onVersionCreated sets status:'queued'). Confirms the signal's shape
    // reaches the primitive, not just that the label slipped through.
    expect(screen.getByText('queued')).toBeTruthy();
  });

  it('version.status_changed SSE event → updates status pill', async () => {
    render(<ActiveGenerationsPanel />);
    const es = MockEventSource.instances[0];
    expect(es).toBeTruthy();

    es.dispatchEvent('version.created', {
      versionId: 'v1',
      shotId: 's1',
      label: 'v001',
    });
    await waitFor(() => {
      expect(screen.getByText('v001')).toBeTruthy();
    });

    es.dispatchEvent('version.status_changed', {
      versionId: 'v1',
      status: 'running',
    });

    // StatusPill renders the status text as uppercase-tracked children inside
    // a <span>. Panel still shows the row because 'running' is non-terminal.
    await waitFor(() => {
      expect(screen.getByText('running')).toBeTruthy();
    });
  });

  it('two version.created events → two panel entries', async () => {
    render(<ActiveGenerationsPanel />);
    const es = MockEventSource.instances[0];
    expect(es).toBeTruthy();

    es.dispatchEvent('version.created', {
      versionId: 'v1',
      shotId: 's1',
      label: 'v001',
    });
    es.dispatchEvent('version.created', {
      versionId: 'v2',
      shotId: 's1',
      label: 'v002',
    });

    await waitFor(() => {
      expect(screen.getByText('v001')).toBeTruthy();
      expect(screen.getByText('v002')).toBeTruthy();
    });
  });

  it('status_changed for unknown version does not crash', () => {
    render(<ActiveGenerationsPanel />);
    const es = MockEventSource.instances[0];
    expect(es).toBeTruthy();

    // onVersionStatusChanged is defensive: unknown versionId is a no-op.
    // Assert the dispatch path doesn't throw and the panel still renders.
    expect(() => {
      es.dispatchEvent('version.status_changed', {
        versionId: 'unknown',
        status: 'failed',
      });
    }).not.toThrow();

    // Panel stays in empty state — no rows were created for 'unknown'.
    expect(screen.getByText(/no active generations/i)).toBeTruthy();
  });
});
