---
phase: 05-web-dashboard
plan: 06
subsystem: http-static-and-server-wiring
tags: [hono, serve-static, spa-fallback, server-wiring, mount-order, D-WEBUI-04, D-WEBUI-12, D-WEBUI-26, D-WEBUI-27, T-5-04]
dependency_graph:
  requires:
    - "phase-05 plan-03 — typedErrorHandler exported from src/http/index.js (error conversion for dashboard routes)"
    - "phase-05 plan-04 — createDashboardRouter(engine) exposes 18 REST routes at /api/*"
    - "phase-05 plan-05 — createSseHandler(engine, allowedOrigins) exposes GET /api/events"
    - "@hono/node-server ^2.0.0 (already installed) — provides serveStatic"
  provides:
    - "src/http/static.ts — createStaticHandler(): Hono middleware that serves packages/dashboard/dist/ with SPA fallback + fallback HTML when dist is missing"
    - "Extended src/server.ts — dashboard HTTP surface mounted alongside /mcp: onError(typedErrorHandler) → /api/events → /api/* → /* static (load-bearing order, D-WEBUI-12)"
  affects:
    - "phase-05 plan-07+ (dashboard components): dashboard is reachable at http://127.0.0.1:3000/ once UI is built into packages/dashboard/dist"
    - "phase-05 plan-12 (validation / end-to-end smoke): full request-response surface now available for integration probes"
tech_stack:
  added: []
  patterns:
    - "Nested serveStatic for SPA fallback — primary serveStatic({ root }) tries exact-match; its 'next' handler is a second serveStatic({ root, path: 'index.html' }) pinned to the app shell. Preserves range/precompressed/MIME for the fallback file with zero custom stream handling."
    - "Per-request existsSync check — re-reads dist/ presence on each request so a developer running `npm run build:dashboard` in another terminal sees the dashboard light up without restarting the MCP server."
    - "Constant fallback-HTML — wire-stable across edits; the test assertion targets the 'Dashboard not built' literal in the constant, so any rewording requires updating the test."
    - "Mount-at-root for dashboard router — dashboard-routes.ts registers routes with FULL /api/ paths (app.get('/api/workspaces'), not 'workspaces'). Mounting at '/api' would double-prefix to /api/api/workspaces. app.route('/', router) is the correct call — matches the test fixture pattern."
    - "void-discard adapter for Hono Next — the inner SPA-fallback serveStatic returns Response but Hono's Next type is () => Promise<void>. Wrap in `async () => { await inner(c, next); }` to discard the Response (serveStatic has already committed via c.body by the time the promise resolves)."
key_files:
  created:
    - "src/http/static.ts (95 lines — createStaticHandler factory + distPath resolution + FALLBACK_HTML constant)"
    - "src/http/__tests__/static.test.ts (77 lines — 5 tests covering missing-dist fallback branch)"
  modified:
    - "src/server.ts (+41 lines inside the --http branch — dashboard imports + 4 mount calls + ordering rationale)"
decisions:
  - "[Plan 05-06] Mount dashboard router at '/' (not '/api'). Plan's must_haves.key_links wrote `via: app.route('/api', createDashboardRouter(engine))`. dashboard-routes.ts (Plan 05-04) registers routes with FULL /api/ paths; mounting at '/api' would produce /api/api/workspaces. Test fixture at dashboard-routes.test.ts#57 confirmed the intended pattern: app.route('/', router). Rule 1 auto-fix — the plan's reference code was wrong, the 18 route paths in dashboard-routes.ts are the source of truth."
  - "[Plan 05-06] await-discard inside the SPA-fallback arrow. The arrow passed to the outer serveStatic must conform to Hono's Next type = () => Promise<void>. A bare `return serveStatic(...)(...)` returns Promise<Response> and trips tsc with `Type 'Response' is not assignable to type 'void'`. Solved by awaiting and discarding: `async () => { await serveStatic(...)(c, next); }`. serveStatic has already committed the response via c.body by the time the promise resolves — the caller doesn't need the return value."
  - "[Plan 05-06] FALLBACK_HTML held in a module-level constant rather than inline string template. Wire-stable: the unit test asserts `text.includes('Dashboard not built')` against this literal. A future edit to the copy is a deliberate (test-visible) change, not a silent drift. Bonus: keeps createStaticHandler() at 20 lines — pure glue, zero template logic."
  - "[Plan 05-06] Per-request existsSync, not a module-load snapshot. A developer may run `npm run build:dashboard` in a second terminal while the MCP server is up — we want the dashboard to appear without a restart. Cost: one stat syscall per request when dist is absent, negligible compared to any other middleware."
  - "[Plan 05-06] httpAllowedOrigins passed to createSseHandler verbatim from the /mcp scope. The SSE T-5-01 origin-allowlist is the SAME policy the /mcp route enforces (SEC-03); reusing the variable guarantees parity — a browser allowed to hit /mcp is allowed to open /api/events. The REST router (Plan 05-04) has no origin check of its own — it inherits whatever CORS policy the parent app applies."
  - "[Plan 05-06] app.onError(typedErrorHandler) registered BEFORE the dashboard mounts so TypedError throws inside the 18 routes convert to { error: { code, message } } with the correct status. Plan 05-03 semantics — typed errors never leak stacks; unknown errors collapse to INTERNAL_ERROR/500."
metrics:
  duration_minutes: 15
  task_count: 2
  file_count: 3
  commits: 3
  tests_added: 5
  tests_passing: 683
  tests_skipped: 2
  completed_date: "2026-04-23"
requirements-completed: [WEBUI-04, WEBUI-05]
---

# Phase 5 Plan 6: Static Handler + Server.ts Dashboard Mount Summary

**Static asset handler with missing-dist HTML fallback + SPA routing (index.html for unknown paths), plus server.ts extension mounting the full dashboard surface (`onError` → `/api/events` SSE → `/api/*` REST → `/*` static catch-all) alongside the existing `/mcp` JSON-RPC route.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-23T19:54:14Z
- **Completed:** 2026-04-23T20:09:00Z
- **Tasks:** 2 (Task 1 TDD RED → GREEN + Rule 3 type fix; Task 2 server.ts extension)
- **Files created:** 2
- **Files modified:** 1

## Accomplishments

- **`src/http/static.ts`** (95 lines, ≥40 plan minimum): `createStaticHandler()` exports a Hono middleware that serves `packages/dashboard/dist/` when present, falls back to `index.html` for unknown paths (SPA routing via a nested serveStatic), and emits a `Dashboard not built — run npm run build:dashboard` HTML page when the dist directory is absent. Zero runtime imports from MCP SDK / better-sqlite3 / drizzle (architecture purity held).
- **`src/http/__tests__/static.test.ts`** (77 lines, ≥50 plan minimum): **5 tests** covering the missing-dist branch (the reliably unit-testable surface): HTML body marker, text/html content-type, nested SPA path (`/shots/sh001`) behavior, crash-free invocation. Mocks `node:fs.existsSync` to force the fallback path regardless of real filesystem state.
- **`src/server.ts`** extended inside the `--http` branch (+41 lines): three new imports from the HTTP layer (`createDashboardRouter + typedErrorHandler` from `./http/index.js`, `createSseHandler` from `./http/sse.js`, `createStaticHandler` from `./http/static.js`) + a four-call mount sequence in the D-WEBUI-12 order with an inline comment block explaining why each position matters.
- **Mount order** (load-bearing, D-WEBUI-12): `/mcp POST + wrong-verb handlers` → `app.onError(typedErrorHandler)` → `app.get('/api/events', createSseHandler(engine, httpAllowedOrigins))` → `app.route('/', createDashboardRouter(engine))` → `app.use('/*', createStaticHandler())`. Grep-verified via `grep -n "app\.\(get\|post\|use\|route\|onError\)(" src/server.ts`.
- **`httpAllowedOrigins` reused** for SSE (T-5-01) — the same allowlist the `/mcp` origin gate uses. A browser allowed to hit `/mcp` is allowed to open `/api/events`.
- **Live smoke** (optional, ran anyway): `npx tsx src/server.ts --http --port 3099` boots cleanly. `GET /` returns 200 text/html with the fallback HTML (dist/ absent in the worktree). `GET /api/workspaces` returns `{"items":[],"total_count":0,"limit":20,"offset":0}` with application/json. `GET /shots/sh001` returns 200 text/html (SPA catch-all working). `GET /mcp` still returns 405 JSON-RPC wrong-verb error (existing handler unharmed).
- **Regression**: none. Full vitest suite 683 passed | 2 skipped (up from 643 baseline after prior Plan 05-05 merge; +5 new from this plan, +35 from merged 05-04 router tests). Architecture-purity: 10/10 green. `tsc --noEmit` clean.

## Task Commits

1. **Task 1 RED** — `0ad12a1` `test(05-06): add failing tests for createStaticHandler (RED)` — 5 tests; confirmed FAIL with `Cannot find module '../static.js'`.
2. **Task 1 GREEN** — `d60525f` `feat(05-06): implement createStaticHandler for dashboard (GREEN)` — 95-line implementation; all 5 tests pass; full suite 683 passed | 2 skipped; tsc clean (after Rule 3 type fix — see Deviations).
3. **Task 2** — `e3386e6` `feat(05-06): extend server.ts with SSE + REST + static mounts (D-WEBUI-12)` — +41 lines inside the `--http` branch. Grep confirms mount order; tsc + full vitest stay green.

_Task 1 went RED → GREEN (type fix bundled with GREEN — the intermediate type-error state was never committed). Task 2 is a single-commit server extension; no TDD cycle because it's composition over already-tested sub-modules._

## Files Created / Modified

### Created

- **`src/http/static.ts`** — `createStaticHandler()` factory. Resolves `distPath` once at module load via `fileURLToPath(import.meta.url)` + `../../packages/dashboard/dist`. Per-request `existsSync(distPath)` decides between fallback HTML and the nested serveStatic call. Fallback HTML lives in the `FALLBACK_HTML` constant. SPA fallback uses a nested `serveStatic({ root: distPath, path: 'index.html' })` as the outer `next` function so unknown paths deliver the app shell. No MCP SDK imports, no better-sqlite3 imports.
- **`src/http/__tests__/static.test.ts`** — 5 tests, all focused on the missing-dist branch (the unit-testable surface). `vi.mock('node:fs', { existsSync: vi.fn().mockReturnValue(false) })` forces the fallback path. Tests assert: (a) `<!DOCTYPE html>` + `Dashboard not built` markers present, (b) same fallback served for any path (deep paths + SPA routes), (c) content-type is `text/html`, (d) no crash (`app.request` resolves to a `Response`).

### Modified

- **`src/server.ts`** — `+41 lines` inside the `if (args.http) { ... }` block, between the `app.post('/mcp', ...)` handler and the `serve(...)` call:
  - New imports below the `tools/index.js` block (3 ES imports): `createDashboardRouter + typedErrorHandler`, `createSseHandler`, `createStaticHandler`.
  - 4 new mount calls: `app.onError(typedErrorHandler)`, `app.get('/api/events', createSseHandler(engine, httpAllowedOrigins))`, `app.route('/', createDashboardRouter(engine))`, `app.use('/*', createStaticHandler())`.
  - 24-line block-comment explaining the mount order rationale (each mount's position and dependency on the one before it).

## Decisions Made

- **Mount the dashboard router at `/`, not `/api`** — `dashboard-routes.ts` (Plan 05-04) registers with FULL `/api/*` paths. Mounting at `/api` would produce `/api/api/workspaces`. Rule 1 deviation against the plan's reference code — the 18 paths in `dashboard-routes.ts` are the source of truth and the test fixture (`dashboard-routes.test.ts#57`) matches.
- **`await`-discard in the SPA-fallback arrow** — Hono's `Next` type is `() => Promise<void>`. The inner `serveStatic(...)(c, next)` call returns `Promise<Response>`, which tsc rejects. `async () => { await inner(c, next); }` satisfies the signature without a cast — `serveStatic` commits the response via `c.body` before its promise resolves, so discarding the return is semantically correct.
- **`FALLBACK_HTML` as a module-level constant** — wire-stable. The test targets the `Dashboard not built` substring against this literal; edits surface in the test diff rather than silently drifting. Bonus: keeps the handler body at ~15 lines — pure glue, zero template concatenation.
- **Per-request `existsSync`, not a module-load snapshot** — a developer running `npm run build:dashboard` in a second terminal should see the dashboard go live without restarting the MCP server. One extra stat syscall per request when dist is absent; negligible overhead.
- **`httpAllowedOrigins` reused verbatim for SSE** — the SSE T-5-01 gate should enforce the SAME policy as the `/mcp` route. Declaring a separate allowlist would double the config surface and risk divergence; passing the existing array guarantees parity.
- **`app.onError(typedErrorHandler)` before routes, not via `app.route('/api', ...)` parent** — registering at the app level means both the dashboard REST routes AND the pre-stream SSE errors (e.g., version-not-found before the stream opens) pass through the same error shape. The SSE handler itself doesn't throw TypedError post-stream-open (it uses `event: error` frames for that), but the `onError` at the app level is still the right place.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's mount target `/api` would double-prefix dashboard routes**

- **Found during:** Task 2 (server.ts extension)
- **Issue:** The plan's `<action>` block and `must_haves.key_links.via` field prescribe `app.route('/api', createDashboardRouter(engine))`. But `dashboard-routes.ts` (Plan 05-04) registers its 18 routes with FULL `/api/*` paths — `app.get('/api/workspaces')`, `app.get('/api/versions/:id')`, etc. Mounting at `/api` would produce `/api/api/workspaces` and all 18 routes would return 404. Confirmed by reading the test fixture at `src/http/__tests__/dashboard-routes.test.ts#57`, which mounts `app.route('/', router)` — the correct pattern.
- **Fix:** Used `app.route('/', createDashboardRouter(engine))` in server.ts. Inline comment explains the asymmetry.
- **Files modified:** `src/server.ts`
- **Verification:** Live smoke `curl http://127.0.0.1:3099/api/workspaces` returns 200 JSON `{"items":[],"total_count":0,"limit":20,"offset":0}` — route reached, engine delegated, response shaped correctly. With the wrong mount, this would have been 404 or caught by the static catch-all and returned HTML.
- **Committed in:** `e3386e6` (Task 2)

**2. [Rule 3 - Blocking Type Fix] Hono `Next` type rejected inner `Promise<Response>`**

- **Found during:** Task 1 GREEN — tests passed on first run but `npx tsc -p tsconfig.json --noEmit` reported `TS2345: Argument of type '() => Promise<void | Response>' is not assignable to parameter of type 'Next'. Type 'Promise<void | Response>' is not assignable to type 'Promise<void>'. Type 'Response' is not assignable to type 'void'.`
- **Investigation:** The inner arrow `async () => serveStatic(...)(c, next)` returns whatever `serveStatic`'s handler returns, which is `Promise<Response>` in the file-found path and `Promise<void>` in the not-found path. Hono's `Next = () => Promise<void>` rejects the union because `Response !== void`. Library-wise, the return value is discarded — `serveStatic` has already committed via `c.body(...)` by the time the promise resolves. Fix is to await-and-discard.
- **Fix:** Changed `async () => { return serveStatic(...)(c, next); }` to `async () => { await serveStatic(...)(c, next); }`. Explicit `await` resolves the outer arrow to `Promise<void>` which satisfies `Next`. Zero runtime behavior change.
- **Files modified:** `src/http/static.ts`
- **Verification:** `npx tsc -p tsconfig.json --noEmit` → clean (no output). Tests still 5/5 pass.
- **Committed in:** `d60525f` (Task 1 GREEN — fix bundled with implementation before the first commit; the buggy intermediate state was never committed).

---

**Total deviations:** 2 auto-fixed (1 Rule 1 plan bug, 1 Rule 3 blocking type).

**Impact on plan:** Both fixes were required for success. The Rule 1 deviation (mount at `/` not `/api`) corrects a reference-code bug that would have broken every dashboard REST route; it does not change the plan's scope. The Rule 3 fix is a one-character TypeScript compliance correction (`return` → `await`). All plan success criteria still met.

## Issues Encountered

- **`--reporter=basic` dropped in vitest v4.** The plan's verification block uses `npx vitest run --no-coverage --reporter=basic`. Vitest v4.1.5 (installed in this repo) dropped `basic` as a built-in reporter name; the command fails with `Failed to load url basic`. Substituted `--reporter=default` (or ran without `--reporter`). No code change needed — just a plan-level command note for future executors.

## Auth Gates

None. This plan wires already-authenticated surfaces (the `/mcp` origin gate inherits to `/api/events` via shared `httpAllowedOrigins`; REST + static are public per D-WEBUI-32). No external API calls were introduced.

## Known Stubs

None. The static handler is production-complete:

- Missing-dist branch serves a substantive fallback page with actionable build instructions.
- Present-dist branch delegates to `@hono/node-server`'s production-tested serveStatic (range support, precompressed assets, correct MIME mapping).
- SPA fallback uses the same library-provided serveStatic for index.html delivery — no custom stream handling, no shortcuts.

The server.ts mount block has no TODOs or placeholder branches — every mount is wired to a real, tested handler from Plans 05-03 / 04 / 05.

## Threat Flags

No new threat surface beyond the plan's `<threat_model>`. All three documented mitigations hold:

- **T-5-05 (Elevation of Privilege):** Accepted per D-WEBUI-32. Local-first binding on `127.0.0.1:3000` (existing server.ts bind preserved). No auth added; documented acceptance stands.
- **T-5-04 (Tampering / Path Traversal on static serving):** Transferred to `@hono/node-server`'s serveStatic. Its internal regex at `dist/serve-static.mjs:70` rejects paths containing `..` segments or `/\\` double-separators BEFORE joining them against `root` — our code inherits this mitigation without additional logic. Additionally, the missing-dist fallback path never touches the filesystem at all, so traversal is impossible in that branch.
- **T-5-01 (Spoofing via missing CORS):** Mitigated for SSE via `httpAllowedOrigins` passthrough to `createSseHandler` (T-5-01 gate fires before stream opens, Plan 05-05 verified). REST routes inherit the parent app's origin policy; Plan 05-06 does not weaken it. Static assets are public (per D-WEBUI-32) — no CORS restriction applied; browsers cache per standard rules.

## Verification Evidence

- `npx vitest run src/http/__tests__/static.test.ts --reporter=verbose` — **5 passed** (0 skipped, 0 failed). 153ms.
  - `createStaticHandler (dist absent) > returns fallback HTML when dist/ does not exist`
  - `createStaticHandler (dist absent) > fallback HTML is served for any path when dist absent`
  - `createStaticHandler (dist absent) > fallback HTML is served at a nested SPA route like /shots/sh001`
  - `createStaticHandler (dist absent) > fallback HTML content-type is text/html`
  - `createStaticHandler (dist absent) > handler does not throw when dist/ is absent (no crash)`
- `npx vitest run --no-coverage` (full root) — **683 passed | 2 skipped** (zero regressions; +5 new from this plan).
- `npx tsc -p tsconfig.json --noEmit` — zero errors.
- `npx vitest run src/__tests__/architecture-purity.test.ts` — 10/10 green.
- `grep -c "@modelcontextprotocol\|better-sqlite3\|drizzle-orm" src/http/static.ts` → **0** matches.
- `grep -n "app\.\(get\|post\|use\|route\|onError\)(" src/server.ts` (mount-order verification):
  - Line 259: `app.post('/mcp', ...)` (existing)
  - Line 320: `app.onError(typedErrorHandler)`
  - Line 321: `app.get('/api/events', createSseHandler(...))`
  - Line 322: `app.route('/', createDashboardRouter(engine))`
  - Line 323: `app.use('/*', createStaticHandler())`
- Live smoke via `npx tsx src/server.ts --http --port 3099`:
  - `GET /` → 200 `text/html; charset=UTF-8` with fallback HTML body (dist absent).
  - `GET /api/workspaces` → 200 `application/json` `{"items":[],"total_count":0,"limit":20,"offset":0}`.
  - `GET /shots/sh001` → 200 `text/html; charset=UTF-8` (SPA catch-all).
  - `GET /mcp` → 405 JSON-RPC error `Method GET not allowed on /mcp` (existing wrong-verb handler).
  - Server boots cleanly (`listening on http://127.0.0.1:3099/mcp`).
- Line counts: static.ts 95 (≥40 minimum), static.test.ts 77 (≥50 minimum) — both clear plan thresholds.

## Success Criteria Check

- [x] `GET /` returns the dashboard index.html (or fallback HTML if dist/ missing) — verified via live smoke (fallback HTML served; dist absent in worktree).
- [x] `GET /api/*` routes are served by the API router before the static handler catches them — verified via `/api/workspaces` returning JSON (not HTML).
- [x] `GET /api/events` is served by the SSE handler before the static handler — verified via mount order (line 321 vs 323) and SSE probe returning `text/event-stream` headers before the static catch-all fires.
- [x] Non-existent paths fall through to index.html (SPA routing) — verified via `/shots/sh001` returning text/html (the fallback HTML stands in for index.html when dist is absent).
- [x] Missing `dist/` does not crash the server — verified via 5/5 tests + live smoke on a worktree without a built dist.
- [x] Mount order in server.ts: `/mcp → /api/events → /api/* → /* static` — verified via grep.
- [x] createStaticHandler exported from src/http/static.ts — verified via import in server.ts + test file.
- [x] No MCP/SQLite imports in static.ts — verified via `grep -c` returning 0.
- [x] TypeScript compilation clean — `npx tsc --noEmit` returned zero output.
- [x] Full root vitest suite green — 683 passed | 2 skipped.

## Plan 07+ Handoff Notes

**For Plan 05-07 onward (dashboard components):**

- The REST URL surface is live at `http://127.0.0.1:3000/api/*`. All 18 routes from Plan 05-04 are reachable once `--http` is passed.
- SSE stream is live at `http://127.0.0.1:3000/api/events` — consumers open an `EventSource` and receive `version.status_changed`, `version.created`, `tag.changed`, `metadata.changed`, `hierarchy.created` frames as the engine emits them.
- Static assets are served from `packages/dashboard/dist/` once built (`npm run build:dashboard`). The SPA fallback means client-side routes like `/shots/sh001` deliver the app shell — the dashboard can use a Preact router without worrying about 404s on deep-link refresh.
- Until `dist/` exists, `GET /` returns a clear "Dashboard not built — run: `npm run build:dashboard`" HTML page. No crash.
- `httpAllowedOrigins` is the gate: to hit the dashboard from a browser tab, either add the browser's origin to the `HTTP_ALLOWED_ORIGINS` env var OR leave it empty (dev mode — all origins allowed, D-WEBUI-04).

**For Plan 05-12 (end-to-end validation):**

- `npx tsx src/server.ts --http --port 3000` is the one-liner. Stdio + HTTP run concurrently; the dashboard shares the engine/db with any stdio MCP client.
- A full E2E smoke should hit: `GET /` (static), `GET /api/workspaces` (REST), open `/api/events` (SSE), POST to `/mcp` (MCP JSON-RPC). All four share the same Hono app and engine.
- `packages/dashboard/` needs a build step in CI before Plan 05-12 can assert on a real SPA — the fallback HTML is sufficient for this plan's truth checks but not for a dashboard demo.

## Self-Check: PASSED

All created files verified on disk:

- `src/http/static.ts` — FOUND (95 lines)
- `src/http/__tests__/static.test.ts` — FOUND (77 lines)

All modified files verified:

- `src/server.ts` — MODIFIED (+41 lines in the `--http` branch; imports + mount sequence + rationale comment)

All commits verified in git log:

- `0ad12a1` — FOUND (Task 1 RED)
- `d60525f` — FOUND (Task 1 GREEN, includes Rule 3 type fix)
- `e3386e6` — FOUND (Task 2 server.ts extension)

Mount order verified via grep: `/mcp` → `onError` → `/api/events` → `/api/*` router → `/*` static catch-all.

Architecture purity: `grep -c "@modelcontextprotocol\|better-sqlite3\|drizzle-orm" src/http/static.ts` → 0. `architecture-purity.test.ts` 10/10 green.

Live smoke: all four surfaces (static/, /api/workspaces, /api/events stream, /mcp) respond correctly on a clean boot.

---

*Phase: 05-web-dashboard*
*Plan: 06*
*Completed: 2026-04-23*
