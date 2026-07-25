// packages/dashboard/src/state/active-generations.ts
//
// @preact/signals-backed store for the Active Generations panel (Plan 05-10).
// Driven by two SSE event handlers that the dispatcher in ../lib/events.ts
// will wire via onSseEvent('version.created', onVersionCreated) +
// onSseEvent('version.status_changed', onVersionStatusChanged).
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Uses dashboard-local payload types
// from ../types/events.ts.
//
// Plan 05-08 Task 2 (GREEN).

import { signal } from '@preact/signals';
import type {
  VersionCreatedPayload,
  VersionStatusChangedPayload,
} from '../types/events.js';

/**
 * A single active generation row as rendered by the Active Generations panel.
 * Status mirrors the VersionStatusChangedPayload.status union — panels that
 * show only in-flight work filter out 'complete' / 'failed' via a computed.
 */
export interface ActiveGeneration {
  versionId: string;
  shotId: string;
  label: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
}

/**
 * Live store of all versions the dashboard has seen created (in any state).
 * Appended on 'version.created'; each row's status updates on
 * 'version.status_changed'. Terminal filtering (hide 'complete'/'failed') is
 * the panel's responsibility — components use a computed that masks them out.
 */
export const activeGenerations = signal<ActiveGeneration[]>([]);

/**
 * Handler for the 'version.created' SSE event. Appends a new queued row.
 *
 * Idempotency note: this implementation does NOT dedupe by versionId. The
 * plan behavior contract asserts "two onVersionCreated calls -> two entries"
 * (see tests) so the store trusts the server to not re-emit 'version.created'
 * for the same versionId. If duplicate frames become an issue at runtime, a
 * follow-up plan can add a dedupe guard without changing the public API.
 */
export function onVersionCreated(payload: VersionCreatedPayload): void {
  activeGenerations.value = [
    ...activeGenerations.value,
    {
      versionId: payload.versionId,
      shotId: payload.shotId,
      label: payload.label,
      status: 'queued',
    },
  ];
}

/**
 * Handler for the 'version.status_changed' SSE event. Mutates the matching
 * row's status field in place (via an immutable map). Unknown versionId is
 * a no-op — the array passes through unchanged, not a throw. This keeps the
 * dashboard robust to out-of-order frames (terminal event before creation
 * frame, or status frame for a version reaped on reload).
 */
export function onVersionStatusChanged(
  payload: VersionStatusChangedPayload,
): void {
  activeGenerations.value = activeGenerations.value.map((g) =>
    g.versionId === payload.versionId ? { ...g, status: payload.status } : g,
  );
}
