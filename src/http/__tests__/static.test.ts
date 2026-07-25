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
