import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createLocalGuard, hostnameOf, isLoopbackHostname } from '../local-guard.js';

/**
 * REGRESSION — the loopback HTTP surface must refuse DNS-rebound requests.
 *
 * Binding 127.0.0.1 does not make the surface private. Any page the operator
 * visits can call it from their browser, and DNS rebinding lets that page read
 * the responses too: the whole database via the REST API, plus the ability to
 * trigger paid generations.
 *
 * Before this guard, /mcp checked Origin, the dashboard router checked nothing,
 * SSE's check was skipped whenever HTTP_ALLOWED_ORIGINS was unset (the
 * default), and nothing anywhere looked at Host — which is the header that
 * actually catches rebinding, and the only signal available for non-browser
 * clients that send no Origin at all.
 */

function appWith(options: Parameters<typeof createLocalGuard>[0] = {}): Hono {
  const app = new Hono();
  app.use('*', createLocalGuard(options));
  app.get('/api/workspaces', (c) => c.json({ ok: true }));
  return app;
}

async function get(
  app: Hono,
  headers: Record<string, string>,
): Promise<number> {
  const res = await app.request('http://127.0.0.1:3000/api/workspaces', { headers });
  return res.status;
}

describe('DNS-rebinding guard', () => {
  it('allows a plain loopback request', async () => {
    expect(await get(appWith(), { host: '127.0.0.1:3000' })).toBe(200);
    expect(await get(appWith(), { host: 'localhost:3000' })).toBe(200);
    expect(await get(appWith(), { host: '[::1]:3000' })).toBe(200);
  });

  it('rejects a rebound Host — the actual attack', async () => {
    // The browser resolved evil.test to 127.0.0.1, so the request arrives here
    // carrying the attacker's name in Host.
    expect(await get(appWith(), { host: 'evil.test' })).toBe(403);
    expect(await get(appWith(), { host: 'evil.test:3000' })).toBe(403);
  });

  it('rejects a request carrying no Host rather than guessing', async () => {
    // A bare Request has no Host header at all. There is nothing to validate,
    // so the guard refuses instead of assuming it came from this machine.
    const res = await appWith().fetch(
      new Request('http://127.0.0.1:3000/api/workspaces'),
    );
    expect(res.status).toBe(403);
    expect(isLoopbackHostname('')).toBe(false);
  });

  it('rejects a cross-site Origin even when Host is loopback', async () => {
    expect(
      await get(appWith(), { host: '127.0.0.1:3000', origin: 'https://evil.test' }),
    ).toBe(403);
  });

  it('allows a loopback Origin on any port', async () => {
    expect(
      await get(appWith(), { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }),
    ).toBe(200);
    expect(
      await get(appWith(), { host: '127.0.0.1:3000', origin: 'http://localhost:5173' }),
    ).toBe(200);
  });

  it('allows a configured extra origin and host', async () => {
    const app = appWith({
      allowedOrigins: ['https://studio.example.com'],
      allowedHosts: ['studio.example.com'],
    });
    expect(
      await get(app, { host: 'studio.example.com', origin: 'https://studio.example.com' }),
    ).toBe(200);
    // Still nothing else.
    expect(await get(app, { host: 'other.example.com' })).toBe(403);
  });

  it('a non-browser client with no Origin is still allowed', async () => {
    // MCP clients (Claude Desktop, Cursor, CLI) send no Origin. They must keep
    // working — which is exactly why Host, not Origin, is the load-bearing check.
    expect(await get(appWith(), { host: '127.0.0.1:3000' })).toBe(200);
  });

  it('a malformed Origin is refused, not parsed into an allow', async () => {
    expect(await get(appWith(), { host: '127.0.0.1:3000', origin: 'not-a-url' })).toBe(403);
  });
});

describe('hostnameOf', () => {
  it('strips ports and keeps IPv6 brackets', () => {
    expect(hostnameOf('127.0.0.1:3000')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:3000')).toBe('[::1]');
    expect(hostnameOf('[::1]')).toBe('[::1]');
    expect(hostnameOf('evil.test')).toBe('evil.test');
    expect(hostnameOf('  EVIL.TEST:8080 ')).toBe('evil.test');
  });
});
