// packages/dashboard/src/lib/events.ts
//
// SSE client for the dashboard — opens a single EventSource to /api/events
// (D-WEBUI-03: single global stream per tab). Subscribers register typed
// handlers via onSseEvent; the module holds a singleton EventSource +
// per-type listener sets so start / stop is idempotent.
//
// Architecture-purity invariant (D-WEBUI-31): zero imports from
// ../../../src/**. The EngineEventMap consumed here is the dashboard-local
// duplicate at ../types/events.ts.
//
// Plan 05-08 Task 1 (GREEN). Consumers (Plan 05-10 ActiveGenerationsPanel,
// etc.) call startSse() once at app init, register via onSseEvent('type', fn),
// and cleanup with offSseEvent on unmount.

import type { EngineEventMap } from '../types/events.js';

/** Singleton EventSource — null when stopped / before startSse. */
let es: EventSource | null = null;

/**
 * Registered listeners per event type. The inner Set stores the user's
 * callback directly. The dispatch wrapper (attached once per type per
 * EventSource) iterates this Set at fire-time, so offSseEvent works by
 * simple Set.delete — no removeEventListener round-trip needed, which lets
 * the implementation stay compatible with the minimal mock the tests use.
 */
const listeners: Map<
  keyof EngineEventMap,
  Set<(payload: unknown) => void>
> = new Map();

/**
 * Types that currently have a dispatch wrapper attached to the active
 * EventSource. Prevents double-attach when callers register multiple
 * listeners for the same type.
 */
const attachedTypes: Set<keyof EngineEventMap> = new Set();

/**
 * Attach a single dispatch wrapper on the current EventSource for the given
 * type. The wrapper iterates the listeners Set at fire-time, so adding /
 * removing listeners via on/offSseEvent needs no further EventSource calls.
 */
function attachDispatchFor<K extends keyof EngineEventMap>(type: K): void {
  if (!es) return;
  if (attachedTypes.has(type)) return;
  const handler = (e: MessageEvent): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse((e as MessageEvent<string>).data);
    } catch {
      return; // ignore malformed frames
    }
    const fns = listeners.get(type);
    if (!fns) return;
    // Snapshot so listeners added/removed during dispatch don't mutate the
    // iteration (matches browser EventTarget behaviour).
    for (const fn of [...fns]) fn(parsed);
  };
  es.addEventListener(type as string, handler);
  attachedTypes.add(type);
}

/**
 * Start the SSE connection. Idempotent: calling startSse() twice is a no-op
 * while the first EventSource is still open.
 *
 * Per D-WEBUI-03 the default URL is '/api/events' (same-origin; Vite proxy
 * in dev). Callers override for tests.
 */
export function startSse(url: string = '/api/events'): void {
  if (es) return;
  es = new EventSource(url);
  // (Re)attach dispatch wrappers for any event types with pending listeners.
  for (const type of listeners.keys()) {
    attachDispatchFor(type as keyof EngineEventMap);
  }
}

/**
 * Stop the SSE connection and clear the singleton. Does NOT clear the
 * listeners map — callers that startSse() again will reattach dispatch
 * wrappers and fire existing handlers on the new EventSource.
 */
export function stopSse(): void {
  es?.close();
  es = null;
  attachedTypes.clear();
}

/**
 * Register a typed handler for an SSE event type. Safe to call before or
 * after startSse(); in either case the handler fires when a matching frame
 * arrives on the active EventSource.
 */
export function onSseEvent<K extends keyof EngineEventMap>(
  type: K,
  fn: (payload: EngineEventMap[K]) => void,
): void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(fn as (payload: unknown) => void);
  if (es) attachDispatchFor(type);
}

/**
 * Remove a previously-registered handler. Reference-equal to the fn passed
 * to onSseEvent. If the handler was never registered (or already removed)
 * this is a no-op. The EventSource listener wrapper stays attached for
 * cheapness; next dispatch finds an empty Set and returns without firing.
 */
export function offSseEvent<K extends keyof EngineEventMap>(
  type: K,
  fn: (payload: EngineEventMap[K]) => void,
): void {
  listeners.get(type)?.delete(fn as (payload: unknown) => void);
}
