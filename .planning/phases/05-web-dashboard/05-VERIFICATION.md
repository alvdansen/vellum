---
phase: 05-web-dashboard
verified: 2026-04-23T21:37:50Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Active generations show live progress updates via SSE without manual refresh"
    status: failed
    reason: "SSE wire-shape drift (CR-01) — server emits snake_case + status enum 'submitted/running/completed/failed' with no `label` field; dashboard expects camelCase + 'queued/running/complete/failed' + `label`. Every real SSE frame produced by the running server is dropped, mis-keyed, or rendered unstyled in the dashboard. Empirically confirmed: a live capture of a real `hierarchy.created` SSE frame contained `{entity_type, entity_id, parent_id, at}` while `packages/dashboard/src/types/events.ts::HierarchyCreatedPayload` reads `{entityType, entityId, parentId}`."
    artifacts:
      - path: "src/engine/events.ts"
        issue: "VersionCreatedPayload has {version_id, shot_id, breadcrumb, at} — NO `label` field; status enum is 'submitted' | 'running' | 'completed' | 'failed'"
      - path: "src/http/sse.ts"
        issue: "Forwards payload verbatim via JSON.stringify — no wire-shape adapter between engine shape and dashboard contract"
      - path: "packages/dashboard/src/types/events.ts"
        issue: "Expects camelCase {versionId, shotId, label} + status enum 'queued' | 'running' | 'complete' | 'failed' — incompatible with server emission"
      - path: "packages/dashboard/src/state/active-generations.ts"
        issue: "Reads payload.versionId / payload.shotId / payload.label — all evaluate to undefined against real frames; ActiveGenerations row keyed by `undefined`, onVersionStatusChanged can never find the row to update"
      - path: "src/engine/pipeline.ts"
        issue: "version.created emission at lines 330-336, 545-550, 564-568 provides no `label`; no status translation before emit"
    missing:
      - "Wire adapter in src/http/sse.ts that maps engine payloads to dashboard contract (resolve label from version_number, map status enum submitted->queued / completed->complete, rename version_id/shot_id -> versionId/shotId, entity_type/entity_id -> entityType/entityId) BEFORE JSON.stringify"
      - "End-to-end integration test that emits via engine.events.emitEvent() and asserts the SSE frame consumed by a real dashboard writer produces the expected ActiveGeneration row with populated label + styled status"
      - "OPTIONAL alternative: align packages/dashboard/src/types/events.ts + state/active-generations.ts to the server's snake_case contract via lib/shape.ts central translator, and add the `label` field at the emission site by calling versionLabel(version) when the version.created event fires"
deferred: []
---

# Phase 5: Web Dashboard Verification Report

**Phase Goal:** A non-technical viewer (or the demo audience) can open a browser and see the project hierarchy, version history with provenance details, and live generation progress — no CLI required.

**Verified:** 2026-04-23T21:37:50Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Opening the server URL shows a project hierarchy browsable from workspace down to shot | ✓ VERIFIED | `GET /` serves real pre-built index.html (977B) with hashed asset refs to `/assets/index-zoyhvWiF.js` (38.5kB) + `/assets/index-oqCE3cPV.css` (21.7kB). `HomeView.tsx` renders `TreeSidebar` with lazy hydration via `fetchWorkspaces`/`fetchProjects`/`fetchSequences`/`fetchShots` (HomeView.tsx:83-176). REST endpoints `/api/workspaces`, `/api/workspaces/:id/projects`, `/api/projects/:id/sequences`, `/api/sequences/:id/shots` all live (dashboard-routes.ts:95-131); live smoke confirmed `GET /api/workspaces` → 200 JSON `{items, total_count, limit, offset}`. |
| 2 | Clicking a shot shows version timeline with drill-down into provenance for any version | ✓ VERIFIED | `HomeView.tsx:98-117` hydrates `versions` signal on `selectedShotId` change via `fetchVersions(shotId)`. Version list renders `VersionCard`; clicking opens `VersionDrawer.tsx` which: (a) renders a Timeline section with created/completed timestamps (VersionDrawer.tsx:143-161); (b) lazy-loads provenance events via `getProvenance(version.id)` (VersionDrawer.tsx:67-80) and renders each via `JsonBlock` (line 167-175); (c) exposes a "View Diff" button wired to `DiffDrawer`. REST `/api/versions/:id/provenance` live; live smoke clean. |
| 3 | Active generations show live progress updates via SSE without manual refresh | ✗ FAILED | **CR-01 empirically confirmed.** SSE handshake works (live curl returned 200 text/event-stream). A real server-emitted SSE frame for `hierarchy.created` was captured: `data: {"entity_type":"workspace","entity_id":"ws_AQ0bI2jVPWipWDnMIH2-k","parent_id":null,"at":"..."}`. Dashboard consumers (`state/active-generations.ts:49-74`) read camelCase `payload.versionId` / `payload.shotId` / `payload.label` — all undefined against this wire shape. `VersionStatusChangedPayload.status` on the server is `'submitted' \| 'running' \| 'completed' \| 'failed'`; dashboard expects `'queued' \| 'running' \| 'complete' \| 'failed'` — three of four values mismatch. No `label` field on `VersionCreatedPayload` at all (events.ts:28-33), so `ActiveGenerationsPanel` renders empty text for every row. Plan 05-11 SUMMARY explicitly flagged this: "Serialization-boundary drift is still unresolved. Plan 11 gates it with tests but does not fix it." |
| 4 | Dashboard is served as pre-built static bundle from the same Hono server process — no separate dev server | ✓ VERIFIED | `src/server.ts:323` mounts `app.use('/*', createStaticHandler())` on the same Hono app that hosts `/mcp` + `/api/*` + `/api/events`. `createStaticHandler` (static.ts:31, 91-94) resolves `packages/dashboard/dist/` and delegates to `@hono/node-server`'s `serveStatic` with SPA fallback to `index.html`. Live smoke: `GET /` returns real built HTML with hashed asset refs, served from the same port (3099) as the MCP JSON-RPC endpoint. No Vite dev server involvement in the served bundle. |
| 5 | Viewer can see dashboard immediately after server start with no build step required | ✓ VERIFIED | `packages/dashboard/dist/` is tracked in git (confirmed absent from `.gitignore` check in Plan 05-01); contains `index.html` + `assets/index-*.js` (38.5kB) + `assets/index-*.css` (21.7kB) + all Inter/Inter-Tight woff2 font files. `.github/workflows/ci.yml` enforces dist freshness via `npm run build:dashboard && git diff --exit-code packages/dashboard/dist` (Plan 05-12 SUMMARY). Fresh clone → `npm install` → `npx tsx src/server.ts --http` immediately serves the dashboard; live smoke confirmed this on a clean-state server boot. |

**Score:** 4/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server.ts` | Hono app mounts MCP + SSE + REST + static in load-bearing order | ✓ VERIFIED | Lines 320-323: `onError(typedErrorHandler)` → `/api/events` → `app.route('/', createDashboardRouter(engine))` → `app.use('/*', createStaticHandler())`. |
| `src/http/dashboard-routes.ts` | 18 REST routes covering workspaces/projects/sequences/shots/versions/provenance/diff/outputs/reproduce/assets/dashboard-home | ✓ VERIFIED | 290 lines, all 18 routes present (lines 95-287). Output streaming route (lines 184-245) enforces T-5-04 path-traversal defence (basename + `..`/`/`/`\\` rejection). |
| `src/http/sse.ts` | GET /api/events with 5 typed event subscriptions + 30s keep-alive + origin allowlist + listener cleanup on disconnect | ⚠️ WIRED BUT HOLLOW (Level 4 failure) | Structural wiring complete: 5 listeners registered at lines 72-87, keep-alive at 96-98, cleanup at 100-111. Payload flow is `engine.events.onEvent(type, payload => writeSSE({ data: JSON.stringify(payload) }))` at line 79 — **no wire-shape adapter**. Payload escapes the server in the engine's internal shape, which is not the dashboard's contract. |
| `src/http/static.ts` | Serves `packages/dashboard/dist/` with SPA fallback; fallback HTML when dist absent | ✓ VERIFIED | 95 lines; `createStaticHandler` + `FALLBACK_HTML`. Live smoke: `GET /` returns actual built HTML; `GET /shots/sh001` returns index.html (SPA routing). |
| `packages/dashboard/dist/index.html` | Pre-built entry point with hashed asset references | ✓ VERIFIED | 977 bytes; references `/assets/index-zoyhvWiF.js` + `/assets/index-oqCE3cPV.css`; FOUC-prevention theme script inlined. |
| `packages/dashboard/dist/assets/*.js` | Bundled Preact app with component code | ✓ VERIFIED | 38.5kB bundle; compiled module preload header + IIFE wrapper + bundled components. Committed to git. |
| `packages/dashboard/dist/assets/*.css` | Bundled Tailwind v4 + theme tokens | ✓ VERIFIED | 21.7kB CSS; Plan 05-10 SUMMARY confirmed committed to git + CI dist-freshness gate present. |
| `packages/dashboard/src/App.tsx` | Root component wiring SSE → signals on mount; unmount cleanup | ✓ VERIFIED (downstream data disconnected) | Lines 27-37: `useEffect` registers `onSseEvent('version.created', onVersionCreated)` + `onSseEvent('version.status_changed', onVersionStatusChanged)`, starts SSE, unmount cleanup. Wiring is correct; downstream payload shape is not (see CR-01 gap). |
| `packages/dashboard/src/views/HomeView.tsx` | Two-pane layout: TreeSidebar + shot-detail VersionCard list; opens VersionDrawer on selection | ✓ VERIFIED | 282 lines; confirmed rendering logic + lazy hierarchy hydration + version list + drawer overlay. |
| `packages/dashboard/src/views/VersionDrawer.tsx` | Renders timeline + provenance + View Diff button | ✓ VERIFIED | 208 lines; timeline section (143-161), provenance section (163-176), View Diff button (123-129) wired to DiffDrawer. |
| `packages/dashboard/src/views/ActiveGenerationsPanel.tsx` | Panel showing live in-flight generations filtered to 'queued'/'running' | ⚠️ WIRED BUT HOLLOW | Reads from `activeGenerations` signal correctly (line 23-26); filter is `status === 'queued' \|\| 'running'`. Problem: server's `version.status_changed` status enum never produces `'queued'` — the server emits `'submitted'` which the dashboard drops into the signal as the literal string `'submitted'` (off-union), making rows invisible even when freshly submitted. CR-01 gap. |
| `packages/dashboard/src/state/active-generations.ts` | Signal-backed store, onVersionCreated appends, onVersionStatusChanged mutates status | ⚠️ WIRED BUT HOLLOW | Functions are correctly implemented against their declared contract; the contract does not match the actual server emission. `payload.label`, `payload.versionId`, `payload.shotId` all undefined against real frames. |
| `src/engine/pipeline.ts :: getDashboardHome` | Returns {active_versions, recent_versions, workspaces} for the dashboard home aggregate | ⚠️ PARTIAL | `active_versions` and `workspaces` wire to real queries (lines 670, 677). `recent_versions` is hardcoded `[]` at line 676 with a comment deferring to "a later plan" (WR-04). Phase-scope impact: the dashboard's DashboardHome type advertises `recent_versions: Version[]`, so consumers see a perpetually-empty list as if no generations ever completed. Does not break the roadmap success criteria (recent-completed is not an SC for Phase 5), but is misleading dead-wiring. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `server.ts` `--http` boot | Hono app mounts for `/mcp` + `/api/*` + `/api/events` + `/*` | Sequential `app.route`/`app.get`/`app.use` calls at lines 259-323 | ✓ WIRED | Live smoke confirmed all four surfaces respond on the same port. |
| `createSseHandler` | `engine.events.onEvent(type, listener)` | `src/http/sse.ts:83-86` | ✓ WIRED | Listener registration per event type verified; cleanup via `offEvent` at lines 102-110. |
| `engine.events.emitEvent(type, payload)` | SSE stream `writeSSE` | `src/http/sse.ts:77-81` | ⚠️ PARTIAL (hollow) | Emits correctly but with **no shape translation** — payload shape is engine-native (snake_case + server's status enum), which the dashboard does not consume. |
| `EventSource('/api/events')` (dashboard) | `onSseEvent(type, fn)` dispatch | `packages/dashboard/src/lib/events.ts:45-63` | ✓ WIRED | Per-type dispatch wrapper attaches on demand; parse errors swallowed. |
| `onSseEvent('version.created', onVersionCreated)` | `activeGenerations.value` append | `App.tsx:29` → `active-generations.ts:49-59` | ✗ NOT_WIRED (hollow) | The dispatcher invokes `onVersionCreated(parsed)` but `parsed.versionId`, `parsed.shotId`, `parsed.label` are all undefined for real server frames. Row appears in the array with undefined keys and empty label. |
| `onSseEvent('version.status_changed', onVersionStatusChanged)` | mutate `activeGenerations` row | `App.tsx:30` → `active-generations.ts:68-74` | ✗ NOT_WIRED (hollow) | `g.versionId === payload.versionId` evaluates `undefined === undefined` against real frames — collapses all rows to one match or none; even when it "matches," the pushed status value (e.g., `'completed'`) is off the union the StatusPill knows how to render. |
| `VersionDrawer.handleViewDiff` | `diffVersion(priorVersion.id, version.id)` | `views/VersionDrawer.tsx:90-91` → `lib/api.ts::diffVersion` → `GET /api/versions/:id/diff?against=` | ✓ WIRED | DiffDrawer receives the summary; empty-state fallback on error. |
| `GET /api/dashboard/home` | `engine.getDashboardHome()` | `dashboard-routes.ts:285-287` | ⚠️ PARTIAL | Wired, but `recent_versions` is always `[]` (pipeline.ts:676, WR-04). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `HomeView.tsx` | `workspaces` signal | `fetchWorkspaces()` → `GET /api/workspaces` → `engine.listWorkspaces()` → `HierarchyRepo.listWorkspaces()` (SQLite query) | Yes — returns real DB rows | ✓ FLOWING |
| `HomeView.tsx` | `versions` signal | `fetchVersions(shotId)` → `engine.listVersionsForShot()` → real DB query | Yes | ✓ FLOWING |
| `VersionDrawer.tsx` | `provenance` state | `getProvenance(version.id)` → `engine.getProvenance()` → ProvenanceRepo query | Yes | ✓ FLOWING |
| `ActiveGenerationsPanel.tsx` | `activeGenerations.value` — live panel data | `onSseEvent('version.created', onVersionCreated)` | **No** — real SSE frames arrive in server-native shape; `payload.versionId` / `payload.label` undefined; row has no label; status is off-union | ✗ DISCONNECTED |
| `dashboard-routes.ts /api/dashboard/home` | `recent_versions` in response | `engine.getDashboardHome()` | **No** — hardcoded `const recent: Version[] = []` at pipeline.ts:676 (WR-04) | ⚠️ STATIC |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly across all source | `npx tsc --noEmit` | No output (zero errors) | ✓ PASS |
| Server test suite passes | `npx vitest run` | 687 passed \| 2 skipped (44 files) | ✓ PASS |
| Dashboard test suite passes | `npm run test:dashboard` | 29 passed (5 files) | ✓ PASS |
| Server boots with --http and serves dashboard | `npx tsx src/server.ts --http --port 3099 --db /tmp/vfx-verify.db` + `curl http://127.0.0.1:3099/` | 200 text/html, 977 bytes, real pre-built index.html with hashed asset refs | ✓ PASS |
| REST endpoint returns paginated list | `curl http://127.0.0.1:3099/api/workspaces` | 200 application/json `{items: [], total_count: 0, limit: 20, offset: 0}` | ✓ PASS |
| SSE handshake opens stream | `curl -N http://127.0.0.1:3099/api/events` | 200 text/event-stream, chunked transfer-encoding | ✓ PASS |
| SSE emits real engine event frames on MCP mutation | `POST /mcp` with `workspace action=create` + SSE listener | Captured `event: hierarchy.created\ndata: {"entity_type":"workspace","entity_id":"ws_...","parent_id":null,"at":"..."}` — **server-native snake_case wire shape**, confirming CR-01 is a live bug, not a theoretical one | ✗ FAIL (shape does not match dashboard contract) |
| Dashboard home aggregate route | `curl http://127.0.0.1:3099/api/dashboard/home` | 200 `{"active_versions":[],"recent_versions":[],"workspaces":[]}` — note recent_versions is always empty (WR-04, hardcoded at pipeline.ts:676) | ⚠️ PARTIAL |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| WEBUI-01 | 05-01 (derived), 05-03, 05-04, 05-08, 05-10, 05-11 | Light web dashboard shows project hierarchy browser | ✓ SATISFIED | TreeSidebar + HomeView render workspace→project→sequence→shot lazy-hydrated tree; REST routes live; live smoke passed. |
| WEBUI-02 | 05-03, 05-04, 05-09, 05-10 | Dashboard shows version timeline with provenance detail drill-down | ✓ SATISFIED | VersionDrawer has timeline section + provenance JsonBlock list + View Diff; `/api/versions/:id/provenance` + `/api/versions/:id/diff` live. |
| WEBUI-03 | 05-02, 05-03, 05-05, 05-08, 05-10, 05-11 | Dashboard shows live generation status via SSE | ✗ BLOCKED | SSE plumbing reaches the dashboard (handshake confirmed live), but the wire shape drift (CR-01) means real engine events do not populate the Active Generations panel. Unit tests on both sides pass in isolation because both use hand-rolled matching payloads; there is no end-to-end test that pipes a real `engine.events.emitEvent()` through the SSE stream into the dashboard's writer. |
| WEBUI-04 | 05-01, 05-06, 05-07, 05-12 | Dashboard is served as static build from the same Hono server | ✓ SATISFIED | `src/http/static.ts` mounts `packages/dashboard/dist/` on the Hono app shared with `/mcp`; live smoke confirmed. |
| WEBUI-05 | 05-01, 05-06, 05-12 | No separate build step required to view dashboard (pre-built in dist) | ✓ SATISFIED | `packages/dashboard/dist/` committed to git; CI dist-freshness gate enforces source↔dist sync. |

**Plan-to-requirement mapping is complete.** Every WEBUI-01..05 ID appears in at least one plan's `requirements:` field. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/engine/pipeline.ts` | 676 | `const recent: Version[] = [];` — hardcoded empty with deferring comment | ⚠️ Warning (WR-04) | `getDashboardHome.recent_versions` always empty regardless of DB state; dashboard home consumers see no completed versions even when they exist. Does not block any SC but is misleading dead-wiring of a documented contract. |
| `src/http/dashboard-routes.ts` | 227 | `const filePath = path.join('outputs', versionId, filename);` — hardcoded relative path | ⚠️ Warning (WR-01) | Engine's `outputRoot` is configurable but the route ignores it; running from a non-repo CWD or with custom `outputRoot` breaks the output-streaming route. Does not block any SC (output streaming works at the default). |
| `src/http/sse.ts` | 77-81 | `writeSSE({ data: JSON.stringify(payload) })` — forwards raw engine payload | 🛑 Blocker (CR-01) | Root cause of WEBUI-03 failure. The SSE forwarder is the single leverage point where a shape adapter would live; its absence propagates the server-native contract all the way to the browser. |
| `packages/dashboard/src/lib/api.ts` | 24-30 | `fetchJson` discards error body | ⚠️ Warning (WR-05) | Information-quality regression: typed server error codes (VERSION_NOT_FOUND, OUTPUT_UNAVAILABLE) never surface to the user. Empty state is indistinguishable from "404 not found". Does not block any SC. |
| `packages/dashboard/src/lib/shape.ts` | 39-44 | `normalizeStatus` silently maps unknown values to `'queued'` | ℹ️ Info (IN-04) | Intentional "never unstyled" fallback; combined with CR-01, it hides the drift in dev. Does NOT rescue CR-01 because the signal store writes the raw server status value BEFORE any normalizeStatus pass on the active-generations path (normalizeStatus is only called on the Version list, not on ActiveGeneration row status). |
| `src/http/sse.ts` | 96-98 | `: ping` keep-alive comment is not actually a SSE comment on the wire | ℹ️ Info (IN-02) | Wire frame becomes `data: : ping\n\n` (a data message with value `": ping"`), not an SSE comment. Keeps TCP warm as intended; documentation-level inaccuracy. |
| `src/server.ts` | 292-323 | REST routes have no origin allowlist; only /mcp and /api/events do | ℹ️ Info (WR-02) | Same-origin policy protects browser reads; non-browser cross-origin reads permitted. Comment at lines 317-319 claims protection it doesn't provide. |
| `src/http/sse.ts` | 77-81 | Payload envelope has no runtime validation/scrubbing | ℹ️ Info (WR-03) | A future refactor that accidentally spreads `value` into a metadata.changed emit would pass the current single-test guard (T-5-02 defence is TypeScript-level only). Defence-in-depth gap. |
| `src/http/dashboard-routes.ts` | 88-92 | `qNum` accepts negative numbers and non-integer floats | ℹ️ Info (IN-01) | `?limit=-5` or `?limit=3.7` flow to SQLite LIMIT; SQLite clamps but contract is undefined. Robustness concern only. |

### Deferred Items

None. CR-01 (and WR-04) are in-scope for Phase 5 — WEBUI-03 is the third roadmap success criterion, and no later milestone phase claims to address it.

### Gaps Summary

**One blocker gap.** CR-01 — the SSE wire-shape drift between server and dashboard — is real and empirically demonstrated. I started a live server, captured a real `hierarchy.created` SSE frame, and confirmed its shape is `{entity_type, entity_id, parent_id, at}` while the dashboard consumer reads `{entityType, entityId, parentId}`. The dashboard's Active Generations panel cannot render live progress because every real `version.created` frame lands with `undefined` versionId/shotId/label and every real `version.status_changed` frame writes an off-union status string. Plan 05-11 explicitly flagged this: "Serialization-boundary drift is still unresolved. Plan 11 gates it with tests but does not fix it." The fix is narrow — one adapter function in `src/http/sse.ts` that translates engine payloads to the dashboard contract before `JSON.stringify`, plus one end-to-end integration test that pipes a real `engine.events.emitEvent(...)` through the actual SSE stream into a real dashboard writer (the missing seam test that would have caught this).

Four of five roadmap success criteria are verifiably met with live evidence. The fifth (SC-3, live progress via SSE) fails at the runtime wire layer; all supporting structure (handshake, listener registration, signal propagation, render path) is wired correctly, so the fix is contained to the serialization boundary — not a re-architecture.

Secondary concerns that do NOT block any SC but should be tracked: WR-04 (`recent_versions` hardcoded empty in `getDashboardHome`) is dead-wiring of a documented contract; WR-01 (hardcoded `'outputs'` path root in the output-streaming route) will bite the first operator who runs from a non-default CWD or overrides `outputRoot`; WR-05 (dashboard `fetchJson` discards typed error bodies) is a UX regression that surfaces empty states where a proper message existed.

---

_Verified: 2026-04-23T21:37:50Z_
_Verifier: Claude (gsd-verifier)_
