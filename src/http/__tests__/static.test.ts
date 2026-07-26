// Unit tests for createStaticHandler (Plan 05-06, D-WEBUI-04 / D-WEBUI-26 / T-5-04).
//
// Scope: missing-dist fallback (reliably testable surface). When the dashboard
// dist/ directory is absent, the handler returns a valid HTML page indicating
// the build is missing rather than crashing the server. When dist/ exists,
// serveStatic takes over and SPA fallback routes unknown paths to index.html;
// that behavior is delegated to @hono/node-server's serveStatic and is exercised
// end-to-end in Plan 05-12 smoke testing rather than unit-level here.
//
// Mocking strategy:
//   The module-under-test reads `existsSync(distPath)` at request time (not at
//   import time) so we can mock `node:fs.existsSync` to return false and force
//   the fallback branch regardless of the real filesystem state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock existsSync BEFORE importing static.ts so the module sees the mock.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

import { existsSync } from 'node:fs';
import { createStaticHandler } from '../static.js';

describe('createStaticHandler (dist absent)', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it('returns fallback HTML when dist/ does not exist', async () => {
    const app = new Hono();
    app.use('/*', createStaticHandler());
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
    expect(text).toContain('Dashboard not built');
  });

  it('fallback HTML is served for any path when dist absent', async () => {
    const app = new Hono();
    app.use('/*', createStaticHandler());
    const res = await app.request('/some/deep/path');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Dashboard not built');
  });

  it('fallback HTML is served at a nested SPA route like /shots/sh001', async () => {
    const app = new Hono();
    app.use('/*', createStaticHandler());
    const res = await app.request('/shots/sh001');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
    expect(text).toContain('Dashboard not built');
  });

  it('fallback HTML content-type is text/html', async () => {
    const app = new Hono();
    app.use('/*', createStaticHandler());
    const res = await app.request('/');
    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/text\/html/);
  });

  it('handler does not throw when dist/ is absent (no crash)', async () => {
    // If the handler threw, app.request would reject. Explicit assertion.
    const app = new Hono();
    app.use('/*', createStaticHandler());
    await expect(app.request('/')).resolves.toBeInstanceOf(Response);
  });
});

// ---------------------------------------------------------------------------
// dist PRESENT — the branch that actually ships.
//
// REGRESSION. The handler nested two serveStatic calls and discarded the inner
// one's return value, on the stated assumption that "serveStatic has already
// committed the response via c.body()". It has not: c.body() builds a Response,
// and only RETURNING it sets c.finalized. So on any unknown path the shell was
// read off disk, a 200 was built, and then dropped — Hono saw an unhandled
// request and fell through. In the real server that surfaced as a 500 with
// Hono's internal "Context is not finalized" message. Every dashboard deep link
// and every browser refresh outside `/` hit it.
//
// It survived because the tests above only cover the dist-ABSENT branch (this
// file's own header defers the rest to "smoke testing"), and `npm run smoke`
// drives stdio, which never reaches an HTTP static handler.
//
// packages/dashboard/dist is committed, so these run everywhere the repo does.
describe('createStaticHandler (dist present)', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
  });

  /** An app shaped like the real server: a real API route, then the catch-all. */
  function appWithStatic(): Hono {
    const app = new Hono();
    app.get('/api/workspaces', (c) => c.json({ items: [], total_count: 0 }));
    app.use('/*', createStaticHandler());
    return app;
  }

  it('serves the app shell at /', async () => {
    const res = await appWithStatic().request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('serves the app shell for a client-side deep link', async () => {
    // The exact request a browser makes when someone refreshes on a shot page.
    const res = await appWithStatic().request('/shots/sh010');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('<!doctype html>');
  });

  it('serves the app shell for every dashboard route, not just one', async () => {
    for (const route of ['/approvals', '/sequences/seq010', '/a/deeply/nested/one']) {
      const res = await appWithStatic().request(route);
      expect(res.status, `route ${route}`).toBe(200);
      expect(res.headers.get('content-type'), `route ${route}`).toMatch(/text\/html/);
    }
  });

  it('serves a real built asset with its own content type, not the shell', async () => {
    const shell = await (await appWithStatic().request('/')).text();
    const assetPath = /\/assets\/[A-Za-z0-9._-]+\.js/.exec(shell)?.[0];
    expect(assetPath, 'index.html should reference a built JS asset').toBeTruthy();

    const res = await appWithStatic().request(assetPath!);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
  });

  it('does NOT answer an unknown /api path with the app shell', async () => {
    // A fetch() for a mistyped API route must not receive 200 text/html — that
    // is harder to debug than a 404, and it is what a naive SPA catch-all does.
    const res = await appWithStatic().request('/api/not-a-real-route');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/html/);
  });

  it('does not shadow a real API route', async () => {
    const res = await appWithStatic().request('/api/workspaces');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('leaves /mcp and /webhooks to their own handlers', async () => {
    for (const route of ['/mcp', '/webhooks/replicate']) {
      const res = await appWithStatic().request(route);
      expect(res.status, `route ${route}`).toBe(404);
      expect(res.headers.get('content-type') ?? '', `route ${route}`).not.toMatch(/text\/html/);
    }
  });

  it('never serves a file from outside dist, in any traversal encoding', async () => {
    // These all normalise to a path with no file under dist/, so the SPA
    // fallback answers with the shell — which is the correct outcome. What
    // matters is the negative: no encoding reaches a real file on disk. The
    // assertion is on CONTENT, not status, because a 200 here is legitimate.
    for (const probe of [
      '/../../package.json',
      '/..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/package.json',
      '/../../../etc/hosts',
      '/assets/../../../package.json',
    ]) {
      const body = await (await appWithStatic().request(probe)).text();
      expect(body, `probe ${probe}`).not.toContain('"name": "vellum"');
      expect(body, `probe ${probe}`).not.toMatch(/127\.0\.0\.1\s+localhost/);
    }
  });
});
