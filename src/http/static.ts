// src/http/static.ts — static asset handler for the Preact dashboard
// (Plan 05-06, D-WEBUI-04 / D-WEBUI-26 / D-WEBUI-27 / T-5-04).
//
// Serves pre-built assets from `packages/dashboard/dist/` — a single-page app
// where unknown paths fall through to `index.html` (SPA routing). When dist/
// is absent (either fresh clone before `npm run build:dashboard` or a dev
// workflow without the UI built), a fallback HTML page is served instead of
// throwing, so the MCP server and `/api/*` routes still function.
//
// Architecture purity (D-WEBUI-28 / D-WEBUI-31): no MCP SDK imports, no direct
// SQLite imports, no engine dependency. This is pure file serving + a 6-line
// fallback.
//
// T-5-04 path traversal: @hono/node-server's serveStatic rejects paths
// containing `..` segments and double separators BEFORE resolving against
// root (see dist/serve-static.mjs#67-72). The check runs per-request, so we
// inherit the mitigation without additional code.

import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context, Next } from 'hono';

// Resolve dist/ once at module load. Relative to this file:
//   src/http/static.ts  →  ../../packages/dashboard/dist
// When the server runs via `npx tsx src/server.ts` this evaluates to
// `<repo>/packages/dashboard/dist`. For production builds via `tsc` to dist/,
// the same relative traversal holds (dist/http/static.js → ../../packages/...).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../packages/dashboard/dist');

/**
 * Fallback HTML for the dist-missing branch. Valid HTML5, provides the build
 * command so a developer hitting the dashboard before running `npm run
 * build:dashboard` sees an actionable message instead of a cryptic 404.
 *
 * Kept as a constant so the test assertion (`contains "Dashboard not built"`)
 * is wire-stable across edits — changing the copy requires updating the test.
 */
const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vellum</title>
  </head>
  <body>
    <h1>Vellum</h1>
    <p>Dashboard not built. Run: <code>npm run build:dashboard</code></p>
    <p>The MCP server and <code>/api/*</code> routes are still available.</p>
  </body>
</html>`;

/**
 * Create the catch-all static handler for the dashboard SPA.
 *
 * Mount at `app.use('/*', createStaticHandler())` — this must be the LAST
 * route registered on the Hono app (after /mcp, /api/events, /api/*) so it
 * only fires for non-API paths.
 *
 * Behavior:
 *   1. If `packages/dashboard/dist/` does not exist: respond 200 with the
 *      fallback HTML. Logged for the developer; server stays up.
 *   2. If dist/ exists: delegate to @hono/node-server's serveStatic.
 *      When serveStatic finds a file, it streams it with the correct MIME.
 *      When serveStatic does NOT find a file, it calls the inner next()
 *      which we wire to a SECOND serveStatic call pinned to `index.html`.
 *      That resolves SPA routes like `/shots/sh001` to the app shell so
 *      Preact's client-side router can take over.
 *
 * Re-checking `existsSync` per-request is intentional: a developer running
 * `npm run build:dashboard` in another terminal should see the dashboard
 * become available without restarting the MCP server.
 */
/**
 * Path prefixes that are NOT client-side routes. An unknown path under one of
 * these is a wrong URL, not a deep link, so it must fall through to a 404
 * rather than be answered with the app shell — a fetch() for a mistyped API
 * route should not receive 200 text/html.
 */
const NON_SPA_PREFIXES = ['/api', '/mcp', '/webhooks'] as const;

function isClientSideRoute(pathname: string): boolean {
  return !NON_SPA_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function createStaticHandler() {
  return async (c: Context, next: Next) => {
    if (!existsSync(distPath)) {
      return c.html(FALLBACK_HTML);
    }

    // Each pass gets an inert `next` so a miss returns undefined instead of
    // running the rest of the chain, and we decide what happens next ourselves.
    const noop: Next = async () => {};

    // Primary pass: an exact file at the request path.
    const asset = await serveStatic({ root: distPath })(c, noop);
    if (asset) return asset;

    if (!isClientSideRoute(c.req.path)) return next();

    // SPA fallback: serve index.html so client-side routing can take the URL.
    //
    // The returned Response MUST be returned up the chain. This used to nest
    // the two calls and discard the inner result, on the stated assumption that
    // "serveStatic has already committed the response via c.body()". It has
    // not: c.body() builds a Response, and only RETURNING it sets c.finalized.
    // So the shell was read off disk, a 200 was constructed, and then thrown
    // away — Hono saw an unhandled request and fell through. Every dashboard
    // deep link and every browser refresh outside `/` answered with an error.
    //
    // Nothing caught it because the unit tests only cover the dist-absent
    // branch, and `npm run smoke` drives stdio, which never touches this file.
    const shell = await serveStatic({ root: distPath, path: 'index.html' })(c, noop);
    if (shell) return shell;

    return next();
  };
}
