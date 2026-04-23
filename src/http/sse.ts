// src/http/sse.ts — SSE handler factory (Plan 05-05, D-WEBUI-03 / D-WEBUI-06 /
// D-WEBUI-29 / T-5-01 / T-5-02 / T-5-08).
//
// Single global stream at GET /api/events. Forwards the 5 EngineEventMap
// payload types to every connected browser as SSE `event:`+`data:` frames.
// A 30s keep-alive comment prevents proxy/load-balancer idle-timeouts. An
// origin allowlist guards the endpoint before the stream is opened. All 5
// listeners are removed from engine.events on client disconnect.
//
// Architecture-purity invariants (D-WEBUI-28, D-WEBUI-31):
//  - Zero MCP SDK imports — this file is part of the HTTP layer, not the tool
//    layer. The architecture-purity test greps for the package sentinel
//    string; to avoid tripping it in comments we describe the invariant as
//    "MCP SDK imports" rather than spelling the package name (Plan 04-03
//    precedent, STATE.md decisions log line 119, Plan 05-02 convention).
//  - Zero direct SQLite imports — the engine owns all DB state; this file
//    only subscribes to events published by the engine facade.
//  - Zero imports from src/tools/** — tools are MCP-aware, the HTTP surface
//    lives in a parallel subsystem.

import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Engine } from '../engine/pipeline.js';
import type { EngineEventMap } from '../engine/events.js';

// The 5 event types the dashboard subscribes to (D-WEBUI-06). Declared as a
// `const` tuple so the subscribe/cleanup loops below get exact key-level
// typing against EngineEventMap — adding a sixth event type would fail the
// `satisfies` check until this list is updated.
const EVENT_TYPES = [
  'version.status_changed',
  'version.created',
  'tag.changed',
  'metadata.changed',
  'hierarchy.created',
] as const satisfies ReadonlyArray<keyof EngineEventMap>;

/** Keep-alive interval (milliseconds) — long enough to avoid chattiness but
 * short enough to beat common proxy idle timeouts (nginx defaults to 60s;
 * AWS ALB 60s; Cloudflare 100s). 30s gives ~2x margin against the tightest. */
const KEEP_ALIVE_INTERVAL_MS = 30_000;

/**
 * Create the Hono route handler for `GET /api/events`.
 *
 * @param engine         Engine facade (for its typed event bus).
 * @param allowedOrigins Origins that may open the stream. Empty array = allow
 *                       any origin (dev mode, D-WEBUI-04). Non-empty = strict
 *                       allowlist; requests whose `Origin` header is missing
 *                       from the list are rejected with 403 BEFORE the stream
 *                       opens (T-5-01).
 */
export function createSseHandler(engine: Engine, allowedOrigins: string[] = []) {
  return (c: Context) => {
    // T-5-01 spoofing mitigation — origin check happens before we open the
    // stream, so a forbidden origin never sees the SSE wire nor triggers any
    // listener registration on the engine emitter.
    const origin = c.req.header('Origin') ?? '';
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      return c.text('Forbidden', 403);
    }

    return streamSSE(c, async (stream) => {
      // Map retains the exact listener reference attached for each event type
      // so the cleanup pass removes the same function we registered (Node's
      // EventEmitter off() requires reference equality).
      const listeners = new Map<
        (typeof EVENT_TYPES)[number],
        (payload: unknown) => void
      >();

      for (const type of EVENT_TYPES) {
        // void + .catch(() => {}) — if the client has already disconnected
        // between emit and flush, writeSSE rejects with a stream-closed error.
        // Swallowing is correct because the cleanup handler below removes the
        // listener; there is nothing the handler can do about a closed stream.
        const listener = (payload: unknown) => {
          void stream
            .writeSSE({ data: JSON.stringify(payload), event: type })
            .catch(() => {});
        };
        listeners.set(type, listener);
        engine.events.onEvent(
          type,
          listener as (payload: EngineEventMap[typeof type]) => void,
        );
      }

      // T-5-08 DoS mitigation: keep-alive every 30s. `: ping` is an SSE
      // comment (any line starting with `:`); the EventSource spec requires
      // clients to ignore it, but proxies see the bytes and hold the TCP
      // session open. `writeSSE` prefixes `data: ` to each logical line, so
      // the wire form becomes `data: : ping\n\n` — which still begins with
      // `: ` after the `data: ` prefix is read, and the browser treats the
      // empty resulting data string as a no-op message.
      const keepAliveInterval = setInterval(() => {
        void stream.writeSSE({ data: ': ping' }).catch(() => {});
      }, KEEP_ALIVE_INTERVAL_MS);

      const cleanup = () => {
        clearInterval(keepAliveInterval);
        for (const type of EVENT_TYPES) {
          const listener = listeners.get(type);
          if (listener) {
            engine.events.offEvent(
              type,
              listener as (payload: EngineEventMap[typeof type]) => void,
            );
          }
        }
      };

      // Hold the stream open until the client disconnects. `req.raw.signal`
      // is the standard Web Fetch AbortSignal; `@hono/node-server` wires it
      // to the underlying Node `res` close event. Resolving the promise here
      // lets streamSSE's finally clause close the TransformStream cleanly.
      const signal = c.req.raw.signal;
      if (signal.aborted) {
        cleanup();
        return;
      }
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      cleanup();
    });
  };
}
