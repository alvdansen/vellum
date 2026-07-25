// src/http/local-guard.ts — DNS-rebinding guard for the loopback HTTP surface.
//
// THE ATTACK: the server binds 127.0.0.1, which is often read as "only I can
// reach it". It is not. Any page the operator visits can issue requests to
// 127.0.0.1 from their browser. Same-origin policy stops the page READING the
// response cross-origin, but DNS rebinding removes even that: the attacker
// serves evil.test with a short TTL, the page loads, then evil.test re-resolves
// to 127.0.0.1. The browser now considers the loopback response same-origin
// with evil.test and hands it over. The page can read the whole database
// through the dashboard REST API and trigger paid generations.
//
// WHAT ACTUALLY STOPS IT: the Host header. A rebound request still carries
// `Host: evil.test`, because that is the name the browser resolved. Rejecting
// any Host that is not a loopback name defeats rebinding even when no Origin
// header is present — which matters, because non-browser MCP clients send no
// Origin and must keep working.
//
// Origin is checked too, as defence in depth for ordinary cross-site requests.
//
// Prior state: /mcp checked Origin, but the dashboard REST router had no check
// at all, and the SSE handler only checked when HTTP_ALLOWED_ORIGINS was set —
// unset by default, so the check never ran. Nothing anywhere looked at Host.

import type { MiddlewareHandler } from 'hono';

/** Hostnames that mean "this machine". Compared case-insensitively. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
  '0000:0000:0000:0000:0000:0000:0000:0001',
]);

/**
 * Strip the port from a Host header value, keeping IPv6 brackets intact.
 * `127.0.0.1:3000` → `127.0.0.1`; `[::1]:3000` → `[::1]`; `evil.test` → `evil.test`.
 */
export function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim();
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? value.toLowerCase() : value.slice(0, close + 1).toLowerCase();
  }
  const colon = value.indexOf(':');
  return (colon === -1 ? value : value.slice(0, colon)).toLowerCase();
}

/** True when a hostname refers to this machine. */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

export interface LocalGuardOptions {
  /**
   * Extra origins allowed beyond loopback (HTTP_ALLOWED_ORIGINS). Exact-match,
   * e.g. `https://studio.example.com`.
   */
  allowedOrigins?: readonly string[];
  /**
   * Extra Host values allowed beyond loopback (HTTP_ALLOWED_HOSTS). Needed only
   * when the server is fronted by a reverse proxy or tunnel that rewrites Host;
   * the shipped bind is 127.0.0.1, so the default covers every direct client.
   */
  allowedHosts?: readonly string[];
}

/**
 * Reject requests whose Host is not this machine, or whose Origin is not
 * allowed. Mount BEFORE the dashboard, SSE, webhook and static handlers.
 */
export function createLocalGuard(options: LocalGuardOptions = {}): MiddlewareHandler {
  const extraHosts = new Set((options.allowedHosts ?? []).map((h) => hostnameOf(h)));
  const extraOrigins = new Set(options.allowedOrigins ?? []);

  return async (c, next) => {
    const hostHeader = c.req.header('host');
    // A request with no Host reaches us only from a non-HTTP/1.1 client or a
    // hand-rolled socket; there is nothing to validate, so refuse rather than
    // guess.
    const hostname = hostHeader === undefined ? '' : hostnameOf(hostHeader);
    if (!isLoopbackHostname(hostname) && !extraHosts.has(hostname)) {
      return c.json(
        {
          error: 'Forbidden host',
          hint:
            'Vellum serves 127.0.0.1 only. A request arriving under another hostname is either a proxy that rewrites Host — add it to HTTP_ALLOWED_HOSTS — or a DNS-rebinding attempt from a web page.',
        },
        403,
      );
    }

    const origin = c.req.header('origin');
    if (origin !== undefined && !extraOrigins.has(origin)) {
      // Any loopback origin is fine regardless of port: that is the dashboard
      // talking to its own server, and the port is operator-chosen.
      let originHostname = '';
      try {
        originHostname = new URL(origin).hostname.toLowerCase();
      } catch {
        originHostname = '';
      }
      if (!isLoopbackHostname(originHostname)) {
        return c.json(
          {
            error: 'Forbidden origin',
            hint: 'Add the origin to HTTP_ALLOWED_ORIGINS (comma-separated) to allow browser access from it.',
          },
          403,
        );
      }
    }

    await next();
  };
}
