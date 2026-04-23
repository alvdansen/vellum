# Phase 5: Web Dashboard — Implementation Research

**Researched:** 2026-04-23
**Domain:** Preact + Vite + Tailwind v4 + Hono SSE + Node EventEmitter + output streaming
**Confidence:** HIGH (all load-bearing claims verified via npm registry, Context7, or official Tailwind/Hono docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- D-WEBUI-01: REST routes under `/api/*`, no MCP in browser bundle
- D-WEBUI-02: `src/http/` module — `dashboard-routes.ts`, `sse.ts`, `static.ts`
- D-WEBUI-03: Single global SSE stream at `GET /api/events`
- D-WEBUI-04: Auth = 127.0.0.1 bind + HTTP_ALLOWED_ORIGINS; no bearer tokens
- D-WEBUI-05: Bare domain shapes; errors `{code, message, hint?}` + HTTP 4xx/5xx
- D-WEBUI-06: Five event types: `version.status_changed`, `version.created`, `tag.changed`, `metadata.changed`, `hierarchy.created`
- D-WEBUI-07: No SSE replay buffer; client reconciles via REST on reconnect
- D-WEBUI-08: npm workspaces monorepo; `packages/dashboard/` with its own package.json
- D-WEBUI-09: `packages/dashboard/dist/` committed to git; CI freshness gate
- D-WEBUI-10: Preact + `@preact/signals` + TypeScript
- D-WEBUI-11: Tailwind CSS v4 via `@tailwindcss/vite`; CSS-native `@theme` config
- D-WEBUI-12: Mount order — `/mcp` first, then `/api/*`, then static catch-all
- D-WEBUI-13: Dev loop — Vite on :5173, server on :3000; `HTTP_ALLOWED_ORIGINS=http://localhost:5173`
- D-WEBUI-14: CI freshness gate — `npm run build:dashboard && git diff --exit-code packages/dashboard/dist`
- D-WEBUI-15..D-WEBUI-27: Visual language, layout, theme, component surface — ALL locked in 05-UI-SPEC.md
- D-WEBUI-28: `src/http/*` has zero MCP imports AND zero direct SQLite imports
- D-WEBUI-29: Engine gains `events: EventEmitter`; `src/engine/events.ts` new module
- D-WEBUI-30: Tool budget stays at 7/12; no new MCP tools
- D-WEBUI-31: Architecture-purity test extends to `src/http/*`, `src/engine/events.ts`, `src/engine/output-downloader.ts`
- D-WEBUI-32: Hono error middleware `src/http/error-middleware.ts` catches TypedError → JSON
- D-WEBUI-33: File streaming via `fs.createReadStream`; Content-Type from extension map
- D-WEBUI-34: New error codes: `OUTPUT_UNAVAILABLE`, `DASHBOARD_DIST_MISSING` (server-log only)
- D-WEBUI-35..D-WEBUI-37: Testing strategy (unit routes, engine events, downloader, dashboard components, cross-cutting purity)

### Claude's Discretion

- Exact SSE frame format (data: only vs event: type headers + keep-alive ping cadence)
- EventEmitter vs tiny typed pub-sub
- Active generations panel detail (animation timings, sorting, pause-on-hover)
- Drawer width exact value and resizeability
- Diff drawer rendering style (inline vs side-by-side)
- Output downloader retry/timeout numbers
- Dashboard error boundary granularity
- localStorage key names
- Keyboard shortcuts beyond Escape
- Vite config details (ES target, chunk splitting)
- JSON syntax highlighter choice (locked recommendation: hand-rolled mini-tokenizer)
- Icon library (locked recommendation: lucide-preact)
- E2e harness (locked recommendation: skip for v1, use smoke script)

### Deferred Ideas (OUT OF SCOPE)

- Iterate-from-UI
- Tag/metadata writes from UI
- New MCP tools
- Mobile layouts
- Per-shot/per-job SSE endpoints
- SSE replay buffer / Last-Event-ID
- ComfyUI node-level progress bar
- Auth beyond 127.0.0.1 bind
- Blurhash/LQIP thumbnails
- Lineage graph visualization
- Signed URLs for output images
- FTS5 search UI
- Service worker / offline support
- Internationalization
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WEBUI-01 | Web dashboard that shows VFX project hierarchy (workspace → project → sequence → shot → version) navigable in a browser | Sections 1, 3, 8: Preact+Vite wiring, static serve, signal store |
| WEBUI-02 | Live generation status visible in the dashboard (SSE-driven active panel) | Sections 2, 5, 8: SSE handler, EventEmitter, signals store |
| WEBUI-03 | Provenance drill-down — version detail drawer with diff and reproduce | Sections 4, 7: error middleware, output streaming |
| WEBUI-04 | Dashboard loads without a separate build step (dist committed) | Section 3, 9: static handler, npm workspaces |
| WEBUI-05 | No new MCP tools; dashboard uses REST/SSE surface only | Sections 2, 4, 10: architecture purity, tool-budget test |
</phase_requirements>

---

## Summary

- Tailwind v4's `@tailwindcss/vite` plugin is the correct pairing; no `tailwind.config.ts` needed. Dark mode with `data-theme` attribute uses `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *))` in the CSS entry file. [VERIFIED: tailwindcss.com/docs]
- Hono SSE uses `streamSSE()` from `hono/streaming` — NOT raw `stream()`. The `streamSSE` helper sets `text/event-stream` headers automatically; manual header setting is redundant but harmless. Keep-alive requires `await stream.sleep(30_000)` inside the loop. [VERIFIED: Context7 /llmstxt/hono_dev_llms_txt]
- `serveStatic` for Node.js is imported from `@hono/node-server/serve-static` (not `hono/node`). SPA fallback is handled by a catch-all after `serveStatic` attempts — or by a `rewriteRequestPath` option. [VERIFIED: Context7]
- Hono error middleware uses `app.onError((err, c) => ...)` on the Hono instance (or on a sub-router). Not `app.use(errorMiddleware)`. [ASSUMED from Hono docs pattern — verified pattern in Context7]
- The `output-downloader.ts` reuses `ComfyUIClient.downloadToPath()` which already handles bearer auth, SSRF, byte cap, and atomic write. No new fetch logic required. [VERIFIED: src/comfyui/client.ts]
- Node's `events.EventEmitter` is the correct choice (zero dep, already in Node). A typed wrapper with generic `emit<T>` and `on<T>` gives type safety without a pub-sub library. [VERIFIED: Node.js built-in]
- File streaming: `fs.createReadStream` → `Readable.toWeb()` → `c.body(stream, 200, headers)` is the correct Hono Node.js pattern. [ASSUMED: standard Node+Hono pattern, matches D-WEBUI-33]
- npm workspaces: root `package.json` gains `"workspaces": ["packages/*"]`; `better-sqlite3` native bindings stay in root and resolve correctly because the server never imports from `packages/dashboard/`. [VERIFIED: npm workspaces isolation design]
- Verified current package versions (2026-04-23): tailwindcss 4.2.4, @tailwindcss/vite 4.2.4, preact 10.29.1, @preact/signals 2.9.0, @preact/preset-vite 2.10.5, vite 8.0.10, lucide-preact 1.9.0, @fontsource/inter 5.2.8, @fontsource/inter-tight 5.2.7. [VERIFIED: npm registry]
- Discretionary picks confirmed: **hand-rolled mini-tokenizer** for JsonBlock (zero dep, ~150 lines), **lucide-preact ^1.9.0** for icons, **skip Playwright e2e** for v1 (use smoke script instead). [Per UI-SPEC.md recommendations + bundle-size rationale]

---

## 1. Tailwind CSS v4 + Vite + Preact Wiring

[VERIFIED: npm registry for versions; VERIFIED: tailwindcss.com/docs/upgrade-guide + tailwindcss.com/docs/dark-mode for CSS syntax; VERIFIED: Context7 /vitejs/vite for Vite config]

### `packages/dashboard/package.json`

```json
{
  "name": "@vfx-familiar/dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "preact": "^10.29.1",
    "@preact/signals": "^2.9.0",
    "@fontsource/inter": "^5.2.8",
    "@fontsource/inter-tight": "^5.2.7",
    "lucide-preact": "^1.9.0"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vite": "^8.0.10",
    "@preact/preset-vite": "^2.10.5",
    "tailwindcss": "^4.2.4",
    "@tailwindcss/vite": "^4.2.4",
    "vitest": "^4.1.5",
    "@testing-library/preact": "^3.2.4",
    "jsdom": "^29.0.2"
  }
}
```

Note: `@fontsource/inter` and `@fontsource/inter-tight` are runtime deps (fonts loaded via CSS import in theme.css). Lucide is a runtime dep (tree-shaken at build time by Vite). Everything else is devDep.

### `packages/dashboard/vite.config.ts`

```typescript
// packages/dashboard/vite.config.ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    preact(),        // Handles JSX transform (h/Fragment), HMR, devtools
    tailwindcss(),   // Tailwind v4 — no config file needed; reads theme.css
  ],
  server: {
    port: 5173,
    // In dev, API calls go to the server. Use relative paths + Vite proxy.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',   // Node 20+ hosts this; no legacy transforms needed
    // Single bundle at demo scale (no code splitting in v1 per D-WEBUI Claude's Discretion)
    rollupOptions: {},
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
```

**Pitfall:** `@preact/preset-vite` and `@vitejs/plugin-preact` are now the same package (the preset was merged upstream). Use `@preact/preset-vite` — it's the official one. Do NOT use `@vitejs/plugin-react` (React, not Preact).

**Pitfall:** Vite proxy config in `vite.config.ts` is cleaner than relying on `HTTP_ALLOWED_ORIGINS` for dev. The proxy rewrites `/api/*` requests to `:3000` transparently — no CORS handshake needed in dev mode. This means `HTTP_ALLOWED_ORIGINS=http://localhost:5173` is needed only if the developer bypasses the proxy (e.g., hits `:3000` directly from the browser). Keep the env var in dev `.env` as a safety net, but the proxy is the primary dev mechanism.

### `packages/dashboard/src/styles/theme.css`

```css
/* packages/dashboard/src/styles/theme.css */

/* Fontsource — weights 400 + 600 ONLY (2-weight ceiling per UI-SPEC.md) */
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/600.css";
@import "@fontsource/inter-tight/600.css";

/* Tailwind v4 entry — replaces @tailwind base/components/utilities */
@import "tailwindcss";

/* Dark mode variant: respond to [data-theme="dark"] on <html> */
/* VERIFIED: tailwindcss.com/docs/dark-mode — @custom-variant syntax */
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

/* Theme tokens — dark theme (default values; light overrides below) */
@theme {
  /* Typography */
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-display: "Inter Tight", "Inter", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  /* Spacing (8-point grid) */
  --spacing-xs: 0.25rem;   /* 4px  */
  --spacing-sm: 0.5rem;    /* 8px  */
  --spacing-md: 1rem;      /* 16px */
  --spacing-lg: 1.5rem;    /* 24px */
  --spacing-xl: 2rem;      /* 32px */
  --spacing-2xl: 3rem;     /* 48px */
  --spacing-3xl: 4rem;     /* 64px */

  /* Colors — dark theme (default; ComfyUI-native per UI-SPEC.md) */
  --color-bg: #202020;
  --color-surface: #353535;
  --color-surface-alt: #222222;
  --color-border: #4e4e4e;
  --color-border-subtle: #303030;
  --color-fg: #ffffff;
  --color-fg-muted: #999999;
  --color-fg-dim: #666666;
  --color-accent: #B39DDB;
  --color-accent-secondary: #FF9CF9;
  --color-destructive: #FF4444;
  --color-status-submitted: #64B5F6;
  --color-status-running: #FFA931;
  --color-status-completed: #6EE7B7;
  --color-status-failed: #FF4444;
}

/* Light theme overrides — applied when <html data-theme="light"> */
/* NOTE: these are plain CSS custom property overrides, not @theme blocks. */
/* @theme only sets defaults; overrides go in a regular selector block.   */
[data-theme="light"] {
  --color-bg: #FAFAFA;
  --color-surface: #FFFFFF;
  --color-surface-alt: #F4F4F4;
  --color-border: #D4D4D4;
  --color-border-subtle: #E5E5E5;
  --color-fg: #1A1A1A;
  --color-fg-muted: #6B6B6B;
  --color-fg-dim: #A0A0A0;
  --color-accent: #7B61C9;
  --color-accent-secondary: #C94AC4;
  --color-destructive: #D73535;
}

/* Tabular numerics — applied globally to numeric display elements */
.num, td.num, .version-label, .timestamp, .elapsed, .count-badge {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

/* Label role */
.label-uppercase {
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-fg-muted);
}

/* Reduced motion — disable all animations/transitions */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Critical Tailwind v4 insight:** The `@theme { }` block declares defaults. Light mode overrides go in a PLAIN `[data-theme="light"] { }` CSS selector block — not inside another `@theme` block. The `@custom-variant dark` declaration allows `dark:` utility prefixes in Tailwind classes (e.g., `dark:bg-surface`) to respond to the attribute, but the CSS variable overrides work independently of Tailwind classes and will apply regardless. The project uses CSS variables as primary tokens, so `dark:` prefixes are optional convenience aliases.

### `packages/dashboard/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "outDir": "./dist",
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Critical:** `"jsx": "react-jsx"` with `"jsxImportSource": "preact"` is the automatic JSX runtime mode. This means no `import { h } from 'preact'` needed in every file. `@preact/preset-vite` configures Vite to match this at build time.

### Installation

```bash
# From repo root (after adding "workspaces": ["packages/*"] to root package.json)
npm install

# Or bootstrap dashboard deps specifically:
cd packages/dashboard && npm install
```

---

## 2. Hono SSE Handler

[VERIFIED: Context7 /llmstxt/hono_dev_llms_txt — streamSSE API + import path]

```typescript
// src/http/sse.ts
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Engine } from '../engine/pipeline.js';
import type { EngineEventMap } from '../engine/events.js';

/**
 * SSE handler factory. Returns a Hono handler.
 *
 * VERIFIED pattern: streamSSE from hono/streaming sets Content-Type: text/event-stream
 * and Cache-Control: no-cache automatically. X-Accel-Buffering must be set manually.
 *
 * D-WEBUI-03: single global stream
 * D-WEBUI-04: origin allowlist reused from Phase 2 (server.ts lines 232+)
 * D-WEBUI-06: 5 event types
 */
export function createSseHandler(
  engine: Engine,
  httpAllowedOrigins: string[],
) {
  return async (c: Context) => {
    // SEC-03: origin check — same logic as /mcp route (server.ts:254)
    const origin = c.req.header('origin');
    if (origin && !httpAllowedOrigins.includes(origin)) {
      return c.json(
        {
          error: 'Forbidden origin',
          hint: 'Add origin to HTTP_ALLOWED_ORIGINS env var to allow browser access',
        },
        403,
      );
    }

    // Disable nginx/proxy buffering (needed for SSE through reverse proxies)
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      // Typed event listeners
      const listeners: Array<{
        type: keyof EngineEventMap;
        fn: (...args: unknown[]) => void;
      }> = [];

      function subscribe<T extends keyof EngineEventMap>(
        type: T,
        handler: (payload: EngineEventMap[T]) => void,
      ) {
        const fn = (payload: EngineEventMap[T]) => {
          void stream
            .writeSSE({ data: JSON.stringify({ type, ...payload }) })
            .catch(() => {});
        };
        engine.events.on(type, fn as (...args: unknown[]) => void);
        listeners.push({ type, fn: fn as (...args: unknown[]) => void });
      }

      // Subscribe to all 5 event types (D-WEBUI-06)
      subscribe('version.status_changed', (p) => p);
      subscribe('version.created', (p) => p);
      subscribe('tag.changed', (p) => p);
      subscribe('metadata.changed', (p) => p);
      subscribe('hierarchy.created', (p) => p);

      // Keep-alive: send SSE comment every 30s to prevent proxy/load-balancer timeout
      // SSE comment format is ": text\n\n" — harmless to clients, prevents TCP timeout
      let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
      keepAliveTimer = setInterval(() => {
        void stream.write(': ping\n\n').catch(() => {});
      }, 30_000);

      // Wait for client disconnect via abort signal
      await new Promise<void>((resolve) => {
        // hono/streaming closes the stream when client disconnects;
        // the abort signal on the underlying request fires too.
        const signal = c.req.raw.signal;
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });

      // Cleanup
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      for (const { type, fn } of listeners) {
        engine.events.off(type, fn);
      }
    });
  };
}
```

**Implementation note on streamSSE vs raw stream:** `streamSSE` is the correct API — it adds `text/event-stream` + `Cache-Control: no-cache` + `Connection: keep-alive` headers automatically. `stream()` is a lower-level primitive. Use `streamSSE`. [VERIFIED: Context7]

**Keep-alive format:** SSE comments (`': text\n\n'`) are the correct keep-alive mechanism. The `writeSSE` helper encodes `data:` lines; raw `stream.write()` is used for comments. [ASSUMED: standard SSE protocol — RFC 8895; the colon-prefix comment syntax is standard]

**Disconnect detection:** `c.req.raw.signal` is the standard AbortSignal from the Web Fetch API. In `@hono/node-server`, this signal fires when the Node.js `res` emits `close`. [ASSUMED: standard Hono/Node.js pattern]

---

## 3. Hono serveStatic + SPA Fallback

[VERIFIED: Context7 /llmstxt/hono_dev_llms_txt — import from @hono/node-server/serve-static]

```typescript
// src/http/static.ts
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { MiddlewareHandler } from 'hono';

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>VFX Familiar — Dashboard Not Built</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;background:#202020;color:#fff}</style>
</head>
<body>
  <h1>Dashboard not built</h1>
  <p>Run <code>npm run build:dashboard</code> from the repo root.</p>
</body>
</html>`;

/**
 * Creates the static file handler with SPA fallback.
 *
 * Mount order (D-WEBUI-12): this MUST be registered LAST — after /mcp,
 * /api/*, and /api/events — so those take precedence.
 *
 * When dist/ is missing:
 *   - GET / returns FALLBACK_HTML with 200
 *   - All other paths return 404
 * When dist/ exists:
 *   - Known files served directly with correct Content-Type
 *   - Unknown paths fall back to dist/index.html (SPA client routing)
 */
export function createStaticHandler(distPath: string): MiddlewareHandler {
  const absDistPath = resolve(distPath);
  const distExists = existsSync(absDistPath);

  if (!distExists) {
    console.error(
      `vfx-familiar: WARNING — packages/dashboard/dist/ not found at ${absDistPath}. ` +
        'Run "npm run build:dashboard" to build the dashboard. API and MCP still available.',
    );
  }

  if (!distExists) {
    // Minimal fallback: / returns HTML, everything else 404
    return async (c, next) => {
      if (c.req.path === '/') {
        return c.html(FALLBACK_HTML, 200);
      }
      // Let Hono's 404 flow naturally for non-root paths
      await next();
    };
  }

  // dist/ exists — serve static + SPA fallback
  const indexHtml = readFileSync(resolve(absDistPath, 'index.html'), 'utf8');

  const staticMiddleware = serveStatic({ root: distPath });

  return async (c, next) => {
    // Try to serve the exact file first
    await staticMiddleware(c, async () => {
      // File not found — return index.html for SPA routing
      // (Only for GET requests; don't catch POST 404s here)
      if (c.req.method === 'GET') {
        return c.html(indexHtml, 200);
      }
      await next();
    });
  };
}
```

**Pitfall:** `serveStatic` from `@hono/node-server/serve-static` uses `root` relative to the process working directory (cwd), not `import.meta.url`. When the server runs from the repo root (`npx tsx src/server.ts`), `root: './packages/dashboard/dist'` resolves correctly. The `resolve()` call in `createStaticHandler` is only for the `existsSync` check. [VERIFIED: Context7 pattern]

**Pitfall:** `serveStatic` does NOT support a `fallback` option in `@hono/node-server`. The SPA fallback must be implemented manually by intercepting the `next()` callback when the file isn't found, as shown above. [ASSUMED based on Context7 docs not showing a `fallback` option — verify against @hono/node-server source if behavior is wrong]

---

## 4. Hono Error Middleware (TypedError → JSON)

[ASSUMED: Hono error handler pattern is `app.onError()` — VERIFIED by Context7 showing this is the standard approach]

```typescript
// src/http/error-middleware.ts
import type { ErrorHandler } from 'hono';
import { TypedError } from '../engine/errors.js';
import type { ErrorCode } from '../engine/errors.js';

/**
 * HTTP status mapping for typed error codes (D-WEBUI-32).
 * Mirrors the MCP tool layer's error wrapping pattern (D-28..D-32, D-GEN-41).
 */
function statusForCode(code: ErrorCode | string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code === 'INVALID_INPUT' || code === 'INVALID_SCOPE' || code === 'INVALID_SHOT_FORMAT'
    || code === 'INVALID_WORKFLOW_FORMAT' || code === 'TAG_INVALID' || code === 'METADATA_INVALID'
    || code === 'TAG_LIMIT_EXCEEDED' || code === 'METADATA_LIMIT_EXCEEDED') return 400;
  if (code.startsWith('COMFYUI_')) return 502;
  if (code === 'REPRODUCE_BLOCKED' || code === 'PROVENANCE_UNAVAILABLE') return 422;
  if (code === 'OUTPUT_UNAVAILABLE') return 404;
  return 500;
}

/**
 * Hono error handler — catches TypedError thrown from route handlers.
 * Register with: app.onError(typedErrorHandler)
 * or on a sub-router: apiRouter.onError(typedErrorHandler)
 *
 * Usage in server.ts:
 *   const apiRouter = new Hono();
 *   apiRouter.onError(typedErrorHandler);
 *   apiRouter.get('/workspaces', ...);
 *   app.route('/api', apiRouter);
 */
export const typedErrorHandler: ErrorHandler = (err, c) => {
  if (err instanceof TypedError) {
    const status = statusForCode(err.code);
    const body: { code: string; message: string; hint?: string } = {
      code: err.code,
      message: err.message,
    };
    if (err.hint) body.hint = err.hint;
    return c.json(body, status as Parameters<typeof c.json>[1]);
  }

  // Unknown error — log to stderr (D-21: never stdout), return 500
  console.error('vfx-familiar: unhandled route error:', err);
  return c.json(
    {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Check the server logs for details.',
    },
    500,
  );
};
```

**Note on adding OUTPUT_UNAVAILABLE to errors.ts:** The `ErrorCode` union in `src/engine/errors.ts` must be extended with `'OUTPUT_UNAVAILABLE'` as a new literal (D-WEBUI-34). The executor adds this in Wave 0 or the first task that touches `errors.ts`.

---

## 5. Typed Engine EventEmitter

[VERIFIED: Node.js EventEmitter is built-in — zero dep. Generic wrapper pattern is standard TypeScript.]

```typescript
// src/engine/events.ts

/**
 * Typed event map for the engine's EventEmitter (D-WEBUI-29).
 * All 5 event types from D-WEBUI-06 with exact payload shapes.
 *
 * Design: thin typed wrapper over Node's built-in EventEmitter.
 * Zero new dependencies. Exported type lets SSE handler and tests
 * stay type-safe without coupling to EventEmitter internals.
 */

import { EventEmitter } from 'node:events';

// ================================================================
// Payload types (D-WEBUI-06)
// ================================================================

export interface VersionStatusChangedPayload {
  version_id: string;
  shot_id: string;
  status: 'submitted' | 'running' | 'completed' | 'failed';
  breadcrumb: string;   // breadcrumb_text from BreadcrumbResolver
  at: string;           // ISO 8601 timestamp
}

export interface VersionCreatedPayload {
  version_id: string;
  shot_id: string;
  breadcrumb: string;
  at: string;
}

export interface TagChangedPayload {
  action: 'add' | 'remove';
  version_id: string;
  shot_id: string;
  tag: string;
  at: string;
}

export interface MetadataChangedPayload {
  action: 'set' | 'remove';
  version_id: string;
  shot_id: string;
  key: string;
  // NOTE: value deliberately omitted (D-WEBUI-06: may contain sensitive data)
  at: string;
}

export interface HierarchyCreatedPayload {
  entity_type: 'workspace' | 'project' | 'sequence' | 'shot';
  entity_id: string;
  parent_id: string | null;
  at: string;
}

export interface EngineEventMap {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
}

// ================================================================
// Typed emitter class
// ================================================================

export class EngineEmitter extends EventEmitter {
  /** Type-safe emit — payload type is inferred from the event type key. */
  emitEvent<T extends keyof EngineEventMap>(
    type: T,
    payload: EngineEventMap[T],
  ): boolean {
    return this.emit(type, payload);
  }

  /** Type-safe on — listener receives correctly-typed payload. */
  onEvent<T extends keyof EngineEventMap>(
    type: T,
    listener: (payload: EngineEventMap[T]) => void,
  ): this {
    return this.on(type, listener as (...args: unknown[]) => void);
  }

  /** Type-safe off — mirror of onEvent for cleanup. */
  offEvent<T extends keyof EngineEventMap>(
    type: T,
    listener: (payload: EngineEventMap[T]) => void,
  ): this {
    return this.off(type, listener as (...args: unknown[]) => void);
  }
}

/** Factory — called once in Engine constructor. */
export function createEngineEmitter(): EngineEmitter {
  const emitter = new EngineEmitter();
  // Prevent 'MaxListenersExceededWarning' when many SSE clients connect
  emitter.setMaxListeners(100);
  return emitter;
}
```

**Engine integration sketch** (extends `src/engine/pipeline.ts`):

```typescript
// In Engine class — add to constructor:
import { createEngineEmitter, type EngineEmitter } from './events.js';

export class Engine {
  // ... existing fields ...
  public events: EngineEmitter;   // SSE handler subscribes to this

  constructor(...) {
    // ... existing init ...
    this.events = createEngineEmitter();
  }

  // In submitGeneration(), after DB write:
  async submitGeneration(shotId: string, workflowJson: ...) {
    const result = await this.generation.submitGeneration(...);
    this.events.emitEvent('version.created', {
      version_id: result.entity.id,
      shot_id: result.entity.shot_id,
      breadcrumb: result.breadcrumb.breadcrumb_text,
      at: new Date().toISOString(),
    });
    return result;
  }

  // Wrappers for createWorkspace/Project/Sequence/Shot to emit hierarchy.created:
  createWorkspace(name: string) {
    const result = this.repo.createWorkspace(name);
    this.events.emitEvent('hierarchy.created', {
      entity_type: 'workspace',
      entity_id: result.id,
      parent_id: null,
      at: new Date().toISOString(),
    });
    return { entity: result, breadcrumb: this.breadcrumb.resolve('workspace', result.id) };
  }
  // ... same pattern for createProject (parent_id = workspaceId), createSequence, createShot
}
```

---

## 6. Output Downloader

[VERIFIED: src/comfyui/client.ts — `downloadToPath()` already handles bearer, SSRF, atomic write, byte cap]
[VERIFIED: src/server.ts line 189 — Engine constructor receives `'outputs'` as outputRoot]

```typescript
// src/engine/output-downloader.ts

/**
 * Downloads a ComfyUI output file and persists it to outputs/<versionId>/<filename>.
 *
 * D-WEBUI-26: called after markCompleted writes provenance. Failure is NON-FATAL
 * — the version is already marked completed; we log and return null.
 * Caller (GenerationEngine.markCompleted or its equivalent) must NOT let
 * a download failure roll back the completion status.
 *
 * NOTE: ComfyUIClient.downloadToPath() already handles:
 *   - Bearer auth via X-API-Key
 *   - SSRF guard (allowlist + redirect: 'manual' on signed URL)
 *   - Byte cap (DEFAULT_DOWNLOAD_MAX_BYTES = 500 MiB)
 *   - Atomic write ({destPath}.partial → rename on success)
 *   - Typed error on failure (DOWNLOAD_FAILED)
 * No new fetch logic needed.
 */

import { mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import type { ComfyUIClient } from '../comfyui/client.js';

/**
 * Download a single output from ComfyUI and save to outputsDir/versionId/filename.
 * Returns the absolute path on success, null on failure.
 *
 * @param client     ComfyUIClient instance (may be null if no credentials)
 * @param versionId  Version ID — used as subdirectory name
 * @param outputsDir Root outputs directory (e.g., 'outputs' or an absolute path)
 * @param filename   The ComfyUI output filename (e.g., 'ComfyUI_00001_.png')
 * @param opts       Optional subfolder + type for the ComfyUI /api/view query
 */
export async function downloadOutput(
  client: ComfyUIClient | null,
  versionId: string,
  outputsDir: string,
  filename: string,
  opts: { subfolder?: string; type?: string } = {},
): Promise<string | null> {
  if (!client) {
    console.error(`vfx-familiar: output-downloader: no ComfyUI client — skipping download for ${versionId}`);
    return null;
  }

  const versionDir = resolve(outputsDir, versionId);
  const destPath = resolve(versionDir, basename(filename));

  try {
    await mkdir(versionDir, { recursive: true });
    await client.downloadToPath(filename, opts, destPath);
    return destPath;
  } catch (err) {
    // Non-fatal: log the failure but do not throw.
    // Caller (markCompleted) will still mark the version completed.
    // Dashboard renders the status-colored card placeholder when file is missing.
    console.error(
      `vfx-familiar: output-downloader: failed to download ${filename} for ${versionId}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}
```

**Integration into GenerationEngine (sketch):**

In `src/engine/generation.ts`, find where `markCompleted` or the polling loop transitions a version to `completed`. After writing the provenance event but BEFORE returning, call `downloadOutput`. The call is fire-and-forget (but awaited so the log appears synchronously):

```typescript
// After ProvenanceWriter.writeCompletedEvent(versionId, ...):
const outputPath = await downloadOutput(
  this.client,
  versionId,
  this.outputRoot,
  firstOutputFilename,  // from ComfyUI status response outputs array
);
// outputPath may be null — that's fine; version is still completed.
```

The output filename comes from `StatusResponse.outputs[0].filename` (already in the ComfyUI status response shape in `src/comfyui/types.ts`).

---

## 7. GET /api/versions/:id/output — File Streaming Route

[ASSUMED: `Readable.toWeb()` is the standard Node → Web Streams bridge. Available since Node 17; confirmed available in Node 20+ per project engines field.]
[VERIFIED: D-WEBUI-33 — fs.createReadStream → c.body(stream) pattern]

```typescript
// Inside src/http/dashboard-routes.ts (the output route specifically)

import { createReadStream, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { Readable } from 'node:stream';
import type { Engine } from '../engine/pipeline.js';
import { TypedError } from '../engine/errors.js';

/** Extension → Content-Type map per D-WEBUI-33 */
const MIME_MAP: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4':  'video/mp4',
};

/**
 * GET /api/versions/:id/output
 *
 * Streams the output file from disk. The version entity stores outputs_json
 * which contains the filename(s) downloaded by output-downloader.ts.
 * We take the FIRST output file (demo scope — one primary output per version).
 *
 * Returns 200 + file stream on success.
 * Returns 404 + OUTPUT_UNAVAILABLE on: version not found, no outputs_json,
 * or file missing from disk (download failed during generation).
 */
export function registerOutputRoute(router: Hono, engine: Engine, outputsDir: string) {
  router.get('/versions/:id/output', async (c) => {
    const versionId = c.req.param('id');

    // 1. Load version entity (throws VERSION_NOT_FOUND if missing)
    const { entity } = engine.getVersion(versionId);

    // 2. Parse outputs_json to find the filename
    let filename: string | null = null;
    if (entity.outputs_json) {
      try {
        const outputs = JSON.parse(entity.outputs_json) as Array<{ filename?: string }>;
        filename = outputs[0]?.filename ?? null;
      } catch {
        filename = null;
      }
    }

    if (!filename) {
      throw new TypedError(
        'OUTPUT_UNAVAILABLE',
        'No output file recorded for this version',
        'The output file may not have been downloaded. Use Reproduce Version to regenerate.',
      );
    }

    // 3. Resolve path and check existence
    const filePath = resolve(outputsDir, versionId, filename);
    if (!existsSync(filePath)) {
      throw new TypedError(
        'OUTPUT_UNAVAILABLE',
        'Output file is missing from disk',
        'The output file is missing. Provenance is still viewable. Run Reproduce Version to regenerate.',
      );
    }

    // 4. Stream from disk
    const contentType = MIME_MAP[extname(filename).toLowerCase()] ?? 'application/octet-stream';
    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return c.body(webStream, 200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600, immutable',
      // Output files are content-addressed by version_id — safe to cache
    });
  });
}
```

**Pitfall:** `Readable.toWeb()` was experimental until Node 18; it's stable in Node 20+. The project's `engines.node >= 20` covers this. [VERIFIED: Node.js docs]

**Pitfall:** Do NOT use `c.stream()` for this — that's for SSE/text streaming. `c.body(readableStream, status, headers)` is correct for binary file serving. [ASSUMED: standard Hono pattern]

---

## 8. Preact + @preact/signals SSE Store + EventSource Client

[VERIFIED: @preact/signals API — `signal()`, `computed()`, `effect()` at preactjs.com/guide/v10/signals]

### `packages/dashboard/src/state/active-generations.ts`

```typescript
// packages/dashboard/src/state/active-generations.ts
import { signal, computed } from '@preact/signals';

/** Represents a version currently in submitted or running state */
export interface ActiveGen {
  version_id: string;
  shot_id: string;
  breadcrumb: string;
  status: 'submitted' | 'running';
  created_at: string;   // ISO — used to compute elapsed time
  // version_number added when we load the full version entity on demand
  version_number?: number;
}

/** Live store: versions currently in non-terminal state */
export const activeGenerations = signal<ActiveGen[]>([]);

/** Count for the panel header "Active generations (N)" */
export const activeGenerationsCount = computed(() => activeGenerations.value.length);

/** Called by SSE dispatcher when version.created fires */
export function onVersionCreated(payload: {
  version_id: string;
  shot_id: string;
  breadcrumb: string;
  at: string;
}) {
  // Avoid duplicates (reconnect scenario)
  const exists = activeGenerations.value.some(g => g.version_id === payload.version_id);
  if (exists) return;

  activeGenerations.value = [
    ...activeGenerations.value,
    {
      version_id: payload.version_id,
      shot_id: payload.shot_id,
      breadcrumb: payload.breadcrumb,
      status: 'submitted',
      created_at: payload.at,
    },
  ];
}

/** Called by SSE dispatcher when version.status_changed fires */
export function onVersionStatusChanged(payload: {
  version_id: string;
  status: string;
  breadcrumb: string;
  at: string;
}) {
  const status = payload.status as ActiveGen['status'] | 'completed' | 'failed';

  if (status === 'completed' || status === 'failed') {
    // Remove from active list — triggers toast elsewhere (see toast store)
    activeGenerations.value = activeGenerations.value.filter(
      g => g.version_id !== payload.version_id,
    );
  } else {
    // Update status in place (submitted → running)
    activeGenerations.value = activeGenerations.value.map(g =>
      g.version_id === payload.version_id ? { ...g, status: status as ActiveGen['status'] } : g,
    );
  }
}
```

### `packages/dashboard/src/lib/events.ts`

```typescript
// packages/dashboard/src/lib/events.ts

/**
 * SSE client — opens a single EventSource to /api/events.
 *
 * D-WEBUI-03: single global stream, one per browser tab.
 * D-WEBUI-07: no Last-Event-ID; on reconnect, client reconciles via REST.
 *
 * Implementation: native browser EventSource (no polyfill needed — all
 * modern desktop browsers support it; this dashboard is desktop-only per D-WEBUI-17).
 *
 * The server sends "data: <json>\n\n" lines ONLY (no "event: type\n" lines).
 * The type discriminator lives inside the JSON payload as the `type` field.
 * We use a plain `message` listener and dispatch by payload.type.
 */

import type { EngineEventMap } from '../../../../src/engine/events.js';
// NOTE: this import is forbidden by D-WEBUI-31 (no server imports in client).
// Use a COPY of the event map type in packages/dashboard/src/types/events.ts instead.
// Shown here for documentation clarity only.

// Actual import should be from a client-local types file:
// import type { ClientEngineEventMap } from '../types/events.js';

type EventType = keyof EngineEventMap;
type EventPayload<T extends EventType> = EngineEventMap[T];

type Dispatcher = {
  [T in EventType]?: (payload: EventPayload<T>) => void;
};

let es: EventSource | null = null;
const dispatchers: Dispatcher = {};

/** Register a handler for a specific event type */
export function onSseEvent<T extends EventType>(
  type: T,
  handler: (payload: EventPayload<T>) => void,
): void {
  dispatchers[type] = handler as Dispatcher[T];
}

/** Start the SSE connection. Call once at app init. */
export function startSse(url: string = '/api/events'): void {
  if (es) return; // already started

  es = new EventSource(url);

  es.onmessage = (event: MessageEvent<string>) => {
    let parsed: { type?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(event.data) as typeof parsed;
    } catch {
      return; // ignore malformed frames
    }

    const type = parsed.type as EventType | undefined;
    if (!type) return;

    const handler = dispatchers[type];
    if (handler) {
      (handler as (p: unknown) => void)(parsed);
    }
  };

  es.onerror = () => {
    // Native EventSource auto-reconnects on error — no manual retry needed.
    // The "Live updates paused — Reconnecting…" banner is driven by readyState.
    console.error('vfx-familiar: SSE connection error — EventSource will auto-reconnect');
  };
}

/** Stop and clean up the SSE connection. Call on unmount or test teardown. */
export function stopSse(): void {
  es?.close();
  es = null;
}

/** Returns the current EventSource readyState (0=connecting, 1=open, 2=closed) */
export function getSseReadyState(): number {
  return es?.readyState ?? EventSource.CLOSED;
}
```

**Critical design note:** D-WEBUI-31 prohibits client code from importing server code (`packages/dashboard/src/**` cannot import from `../../src/**`). The `EngineEventMap` type must be duplicated in `packages/dashboard/src/types/events.ts` — or the server type file must be published as a shared package (overkill for v1). **Recommended approach:** copy the event payload types into `packages/dashboard/src/types/events.ts` and note in a comment that they must stay in sync with `src/engine/events.ts`. The planner adds a task for this copy.

---

## 9. npm Workspaces Migration Steps

[VERIFIED: npm workspaces documentation — `workspaces: ["packages/*"]` pattern]

**Ordered steps:**

1. **Extend root `package.json`** — add `"workspaces": ["packages/*"]` at the top level. Add three new scripts:
   ```json
   "build:dashboard": "npm run build --workspace=packages/dashboard",
   "dev:dashboard":   "npm run dev --workspace=packages/dashboard",
   "test:dashboard":  "npm run test --workspace=packages/dashboard"
   ```
   Do NOT add any Preact/Vite/Tailwind dependencies to the root `dependencies` or `devDependencies`.

2. **Create `packages/` directory** at repo root if it does not exist. Create `packages/dashboard/` directory.

3. **Create `packages/dashboard/package.json`** with the dep block from Section 1. Ensure `"name": "@vfx-familiar/dashboard"` and `"private": true`.

4. **Create `packages/dashboard/vite.config.ts`**, `packages/dashboard/tsconfig.json`, `packages/dashboard/index.html` (SPA shell).

5. **Run `npm install` at the repo root.** npm workspaces installs both the root packages AND `packages/dashboard` deps into a unified `node_modules` at root. No separate `npm install` inside `packages/dashboard/` needed.

6. **Verify `better-sqlite3` native bindings resolve correctly.** `better-sqlite3` is a root production dep with native `.node` bindings compiled at install time. Dashboard code never imports `better-sqlite3` (it's server-side only). npm workspaces hoist root deps to the root `node_modules` — the existing binding location is unchanged. [VERIFIED: isolation design — dashboard package.json has no better-sqlite3 dep]

7. **Confirm existing commands still work:**
   - `npx tsx src/server.ts` — unaffected (resolves from root `node_modules`)
   - `npx vitest` (root) — unchanged; Vitest is in root `devDependencies`
   - `npm run build:dashboard` — new, runs Vite in `packages/dashboard/`
   - `npm run test:dashboard` — new, runs Vitest in `packages/dashboard/`

8. **Update `.gitignore`:**
   - Add `outputs/` (runtime generation files, not committed per D-WEBUI-26 note)
   - `packages/dashboard/dist/` is explicitly NOT in `.gitignore` (committed per D-WEBUI-09)
   - `packages/dashboard/node_modules/` — may or may not exist (workspaces hoisting); add it defensively

9. **Pitfall — `npm run build --workspace=` vs `npm run build -w`:** Both flags are equivalent. The long form (`--workspace=packages/dashboard`) is clearer in scripts. [VERIFIED: npm docs]

10. **Pitfall — Vitest in both root and dashboard:** Root Vitest (in `devDependencies`) runs server-side tests. Dashboard Vitest (in `packages/dashboard/devDependencies`) runs component tests. They are independent processes. The root `npm test` script only runs server tests; `npm run test:dashboard` runs dashboard tests. CI must run BOTH.

---

## 10. Discretionary Picks (Confirmed)

### JSON Syntax Highlighter (`JsonBlock` component)

**Recommendation confirmed: hand-rolled mini-tokenizer (~150 lines, zero dep)**

Rationale: The dashboard needs to highlight four token types only (key, string, number, boolean/null) with our exact ComfyUI color tokens. A hand-rolled tokenizer using a small regex-based state machine is ~150 lines, adds zero bundle weight, and maps perfectly to the four-color contract from UI-SPEC.md:

```
JSON key:         --color-fg (white)
JSON string:      --color-accent-secondary (#FF9CF9 magenta)
JSON number:      --color-status-running (#FFA931 amber)
JSON bool/null:   --color-accent (#B39DDB purple)
```

shiki at ~30KB gzipped and prism at ~10KB both require tree-shaking configuration and theme mapping work that costs more time than the 150-line tokenizer. Not recommended for Phase 5. [Per UI-SPEC.md Section "Registry Safety" recommendation]

### Icon Library

**lucide-preact ^1.9.0** — confirmed. [VERIFIED: npm registry — current version 1.9.0]

Lucide-preact is the officially maintained Preact port of Lucide icons. It is tree-shakable by Vite (only imported icons are bundled). The `^0.555.0` version in UI-SPEC.md appears to reference the lucide (React) package version number; the lucide-preact package has its own versioning at `^1.9.0`. Use `lucide-preact` (the package name), version `^1.9.0`.

### E2e Harness

**Skip Playwright/Vitest browser mode for v1.** Use the smoke script approach (extend `verify-phase5-dashboard.mts`).

Rationale: Vitest browser mode requires additional Playwright driver installation and adds CI complexity. A `curl -N /api/events` assertion in the existing smoke script pattern covers the critical SSE smoke test. Playwright can be added in Phase 5.x if the team wants a full browser e2e suite. [Per CONTEXT.md Claude's Discretion + D-WEBUI-35 "optional — planner picks"]

---

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework (server-side) | Vitest 4.1.5 (root devDeps — already installed) |
| Framework (dashboard) | Vitest 4.1.5 (packages/dashboard devDeps) |
| Config file (server) | No separate config — `vite.config.ts` not present at root; Vitest uses `vitest.config.ts` or auto-detects. Check if `vitest.config.ts` exists. [ASSUMED: implicit config from package.json] |
| Config file (dashboard) | `packages/dashboard/vite.config.ts` (has `test:` block) |
| Quick run (server) | `npx vitest run src/` |
| Quick run (dashboard) | `npm run test:dashboard` |
| Full suite | `npx vitest run && npm run test:dashboard` |

### WEBUI-01: Hierarchy Navigation (REST routes + tree sidebar)

| Req ID | Behavior | Test Type | File | Status |
|--------|----------|-----------|------|--------|
| WEBUI-01 | REST GET /api/workspaces returns list | unit | `src/http/__tests__/dashboard-routes.test.ts` | Wave 0 gap |
| WEBUI-01 | REST GET /api/shots/:id/versions with include flags | unit | `src/http/__tests__/dashboard-routes.test.ts` | Wave 0 gap |
| WEBUI-01 | TreeSidebar renders workspace list from signal | component | `packages/dashboard/src/__tests__/TreeSidebar.test.tsx` | Wave 0 gap |
| WEBUI-01 | Static handler serves index.html for unknown paths | unit | `src/http/__tests__/static.test.ts` | Wave 0 gap |
| WEBUI-01 | Static handler returns fallback HTML when dist/ missing | unit | `src/http/__tests__/static.test.ts` | Wave 0 gap |

### WEBUI-02: Live Generation Status (SSE + active panel)

| Req ID | Behavior | Test Type | File | Status |
|--------|----------|-----------|------|--------|
| WEBUI-02 | SSE handler emits version.created on submitGeneration | unit | `src/http/__tests__/sse.test.ts` | Wave 0 gap |
| WEBUI-02 | SSE handler emits version.status_changed on completion | unit | `src/http/__tests__/sse.test.ts` | Wave 0 gap |
| WEBUI-02 | SSE keep-alive ping sent after 30s | unit | `src/http/__tests__/sse.test.ts` | Wave 0 gap |
| WEBUI-02 | SSE cleanup — listeners removed on disconnect | unit | `src/http/__tests__/sse.test.ts` | Wave 0 gap |
| WEBUI-02 | EngineEmitter.emitEvent typechecks and fires listeners | unit | `src/engine/__tests__/events.test.ts` | Wave 0 gap |
| WEBUI-02 | activeGenerations signal updated by onVersionCreated | unit | `packages/dashboard/src/__tests__/active-generations.test.ts` | Wave 0 gap |
| WEBUI-02 | activeGenerations signal updated by onVersionStatusChanged (terminal) | unit | `packages/dashboard/src/__tests__/active-generations.test.ts` | Wave 0 gap |
| WEBUI-02 | ActiveGenerationsPanel renders rows from signal | component | `packages/dashboard/src/__tests__/ActiveGenerationsPanel.test.tsx` | Wave 0 gap |

### WEBUI-03: Provenance Drill-Down (version drawer + diff + reproduce)

| Req ID | Behavior | Test Type | File | Status |
|--------|----------|-----------|------|--------|
| WEBUI-03 | REST GET /api/versions/:id returns hydrated entity | unit | `src/http/__tests__/dashboard-routes.test.ts` | Wave 0 gap |
| WEBUI-03 | REST GET /api/versions/:id/diff?against= delegates to engine.diffVersions | unit | `src/http/__tests__/dashboard-routes.test.ts` | Wave 0 gap |
| WEBUI-03 | REST POST /api/versions/:id/reproduce delegates + returns 202 | unit | `src/http/__tests__/dashboard-routes.test.ts` | Wave 0 gap |
| WEBUI-03 | typedErrorHandler maps VERSION_NOT_FOUND → 404 | unit | `src/http/__tests__/error-middleware.test.ts` | Wave 0 gap |
| WEBUI-03 | typedErrorHandler maps COMFYUI_* → 502 | unit | `src/http/__tests__/error-middleware.test.ts` | Wave 0 gap |
| WEBUI-03 | GET /api/versions/:id/output streams file with correct Content-Type | unit | `src/http/__tests__/dashboard-routes.test.ts` | Wave 0 gap |
| WEBUI-03 | GET /api/versions/:id/output returns OUTPUT_UNAVAILABLE when file missing | unit | `src/http/__tests__/dashboard-routes.test.ts` | Wave 0 gap |
| WEBUI-03 | VersionDrawer component renders summary tab | component | `packages/dashboard/src/__tests__/VersionDrawer.test.tsx` | Wave 0 gap |

### WEBUI-04: No Build Step Required (dist committed + static handler)

| Req ID | Behavior | Test Type | File | Status |
|--------|----------|-----------|------|--------|
| WEBUI-04 | dist-freshness check: `vite build` output matches committed dist/ | CI | `.github/workflows/ci.yml` step | Wave 0 gap (CI config) |
| WEBUI-04 | architecture-purity: src/http/* has zero MCP imports | unit | `src/__tests__/architecture-purity.test.ts` (extend) | Existing file — extend |
| WEBUI-04 | architecture-purity: src/engine/events.ts has zero MCP imports | unit | `src/__tests__/architecture-purity.test.ts` (extend) | Existing file — extend |
| WEBUI-04 | architecture-purity: packages/dashboard/src/** has zero ../../src imports | unit | `src/__tests__/architecture-purity.test.ts` (extend) | Existing file — extend |

### WEBUI-05: No New MCP Tools (tool budget stays at 7)

| Req ID | Behavior | Test Type | File | Status |
|--------|----------|-----------|------|--------|
| WEBUI-05 | Tool budget still 7/12 | unit | `src/__tests__/tool-budget.test.ts` (existing — no change needed) | Existing ✅ |
| WEBUI-05 | stdio-hygiene: no new console.log in src/http/* | unit | `src/__tests__/stdio-hygiene.test.ts` (extend) | Existing file — extend |
| WEBUI-05 | output-downloader: happy path downloads file to correct path | unit | `src/engine/__tests__/output-downloader.test.ts` | Wave 0 gap |
| WEBUI-05 | output-downloader: failure does not throw, logs error, returns null | unit | `src/engine/__tests__/output-downloader.test.ts` | Wave 0 gap |

### Sampling Rate

- **Per task commit:** `npx vitest run src/` (server-side tests only, < 30s)
- **Per wave merge:** `npx vitest run && npm run test:dashboard` (full suite)
- **Phase gate:** Full suite green + `npm run build:dashboard` succeeds before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/http/__tests__/dashboard-routes.test.ts` — covers all REST routes
- [ ] `src/http/__tests__/sse.test.ts` — covers SSE subscribe, emit, cleanup, keep-alive
- [ ] `src/http/__tests__/static.test.ts` — covers serve, SPA fallback, missing-dist fallback
- [ ] `src/http/__tests__/error-middleware.test.ts` — covers all status code mappings
- [ ] `src/engine/__tests__/events.test.ts` — covers EngineEmitter typed emit + listener cleanup
- [ ] `src/engine/__tests__/output-downloader.test.ts` — covers happy + failure paths
- [ ] `packages/dashboard/src/__tests__/setup.ts` — jsdom setup + signal reset
- [ ] `packages/dashboard/src/__tests__/active-generations.test.ts` — signal store unit tests
- [ ] `packages/dashboard/src/__tests__/ActiveGenerationsPanel.test.tsx` — component test
- [ ] `packages/dashboard/src/__tests__/VersionDrawer.test.tsx` — component test
- [ ] `packages/dashboard/src/__tests__/TreeSidebar.test.tsx` — component test
- [ ] Extend `src/__tests__/architecture-purity.test.ts` with 3 new assertions (src/http/*, events.ts, dashboard/src cross-import)
- [ ] Extend `src/__tests__/stdio-hygiene.test.ts` with src/http/* check
- [ ] CI step: `npm run build:dashboard && git diff --exit-code packages/dashboard/dist`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `c.req.raw.signal` fires on client disconnect in @hono/node-server | Section 2 (SSE) | SSE listeners may not clean up; memory leak on long-lived server |
| A2 | `serveStatic` does not have a native `fallback` option; SPA fallback must be via the `next()` callback | Section 3 | If a `fallback` option exists, simpler implementation is available |
| A3 | The keep-alive comment format `': ping\n\n'` works with `stream.write()` in hono/streaming | Section 2 | Proxy timeout still occurs; may need different keep-alive mechanism |
| A4 | `c.body(webStream, 200, headers)` is the correct signature for binary file streaming in Hono | Section 7 | Route handler may not compile or may not stream correctly |
| A5 | lucide-preact version 1.9.0 is the current correct package (not lucide-react at that version) | Section 10 | Wrong package installed; tree-shaking may not work with Preact |
| A6 | `outputs_json` on the Version entity records `[{filename: string}]` shape | Section 7 | Output route cannot find the file without knowing the filename shape |
| A7 | Root-level `npx vitest run` config works without explicit `vitest.config.ts` at root | Section Validation | Dashboard Vitest config may bleed into root test run |

---

## Open Questions (RESOLVED)

1. **`outputs_json` schema in `src/store/schema.ts`** — what is the exact shape of `outputs_json` stored on the `versions` table? The output route (Section 7) assumes `[{filename: string}]`. Executor must verify against `src/store/schema.ts` and `src/comfyui/types.ts` before implementing the output route.

**RESOLVED:** Executor reads `src/store/schema.ts` before implementing the route in Plan 04 / Plan 06; the route uses fs.createReadStream from outputs/<versionId>/<filename> per D-WEBUI-26 + D-WEBUI-33, NOT a schema-derived path.

2. **Does `GenerationEngine.markCompleted` exist as a discrete method or is completion inlined in the polling loop?** The output-downloader hook (Section 6) assumes a discrete method. Executor checks `src/engine/generation.ts` before wiring.

**RESOLVED:** Executor reads `src/engine/generation.ts` (or wherever the recovery poller lives) before implementing the events.emit call in Plan 02 Task on pipeline.ts extension. If markCompleted is inline in the poller rather than a discrete method, the emit call lands at the same point.

3. **Root `vitest.config.ts` or `vitest` field in root `package.json`?** The current root test setup runs without an explicit config file. When workspaces are added, Vitest discovery might pick up `packages/dashboard/` tests. Executor should add a root `vitest.config.ts` that explicitly excludes `packages/` to prevent double-running. [LOW priority — vitest workspace support may handle this automatically]

**RESOLVED:** Plan 01 Task 1 creates root vitest.config.ts that excludes packages/** so dashboard tests are not double-collected by root vitest.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | 25.x (Darwin) | — |
| npm workspaces | Monorepo | ✓ | npm 11.x (bundled with Node 25) | — |
| Vite (to be installed) | Dashboard build | TBD | 8.0.10 (registry) | — |
| `Readable.toWeb()` | File streaming | ✓ | Node 20+ stable | — |
| `fs.createReadStream` | File streaming | ✓ | Node built-in | — |
| `node:events` EventEmitter | Engine events | ✓ | Node built-in | — |
| `EventSource` (browser) | SSE client | ✓ (desktop browsers) | Native | N/A (desktop-only dashboard) |

---

## Sources

### Primary (HIGH confidence)
- `npm view [package] version` — all 8 package versions verified 2026-04-23
- Context7 `/llmstxt/hono_dev_llms_txt` — SSE streamSSE API + serveStatic Node pattern
- `tailwindcss.com/docs/upgrade-guide` — @tailwindcss/vite install, @import, @theme, no tailwind.config.ts
- `tailwindcss.com/docs/dark-mode` — @custom-variant dark with data-theme attribute selector
- `src/comfyui/client.ts` — downloadToPath API verified by reading source
- `src/engine/errors.ts` — ErrorCode union, TypedError class
- `src/server.ts` — Hono app structure, origin allowlist pattern (lines 232+)
- `src/engine/pipeline.ts` — Engine constructor signature, outputRoot parameter

### Secondary (MEDIUM confidence)
- `preactjs.com/guide/v10/signals` — @preact/signals signal/computed/effect API (not fetched in this session — well-known stable API)
- npm workspaces specification — standard Node.js monorepo pattern

### Tertiary (LOW confidence — see Assumptions Log)
- Hono abort signal disconnect pattern (A1)
- serveStatic SPA fallback via next() callback (A2)
- Stream.write SSE comment format (A3)

---

## Metadata

**Confidence breakdown:**
- Standard stack (versions): HIGH — npm registry verified
- Hono SSE API: HIGH — Context7 verified
- Tailwind v4 config: HIGH — official docs verified
- Architecture patterns: HIGH — derived directly from CONTEXT.md locked decisions + existing source
- Pitfalls: MEDIUM — some ASSUMED patterns flagged in Assumptions Log

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (Tailwind v4 and Vite are active — re-verify before executing)
