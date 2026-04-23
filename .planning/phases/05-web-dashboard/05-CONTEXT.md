# Phase 5: Web Dashboard - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a pre-built Preact SPA that renders from the Hono server as a static bundle on `/`, reading data via new REST routes under `/api/*` and receiving live generation events via a single Server-Sent Events stream at `/api/events`. The dashboard is a mostly-read surface — it exposes `diff` and `reproduce` actions on versions but does NOT expose `iterate`, tag writes, or metadata writes in Phase 5 (agents still drive those via MCP). Authentication is by 127.0.0.1 bind only — the same posture as today's `/mcp` route. WEBUI-01..WEBUI-05.

**In scope:**

- **Repo layout:** convert the root to an npm workspaces monorepo (`"workspaces": ["packages/*"]`). Add `packages/dashboard/` with its own `package.json` carrying Preact + Vite + Tailwind v4 devDeps — these do NOT pollute the server runtime graph.
- **Dashboard source:** Preact + `@preact/signals` + TypeScript + Tailwind CSS v4. Vite handles TSX + HMR in dev.
- **Static bundle:** `packages/dashboard/dist/` is pre-built and **committed to git** (WEBUI-05 literally: "no separate build step required to view dashboard"). CI step runs `npm run build:dashboard` and fails on `git diff --exit-code packages/dashboard/dist` — PRs that touch dashboard source without rebuilding fail CI.
- **New server-side HTTP module:** `src/http/` — the only place (besides `server.ts`) that registers Hono routes. Contains `src/http/dashboard-routes.ts` (REST), `src/http/sse.ts` (event stream), and `src/http/static.ts` (serveStatic mount).
- **New REST routes on the existing Hono app** (NOT the MCP tool surface — do NOT count against the 12-tool MCP budget):
  - `GET /api/workspaces` — list workspaces
  - `GET /api/workspaces/:id` — workspace detail
  - `GET /api/workspaces/:id/projects` — projects under a workspace
  - `GET /api/projects/:id` — project detail
  - `GET /api/projects/:id/sequences` — sequences under a project
  - `GET /api/sequences/:id` — sequence detail
  - `GET /api/sequences/:id/shots` — shots under a sequence
  - `GET /api/shots/:id` — shot detail
  - `GET /api/shots/:id/versions` — version list for a shot (paginated, `include_tags=1&include_metadata=1` honored per D-ASST-20)
  - `GET /api/versions/:id` — version detail (always includes tags + metadata + breadcrumb per D-ASST-19)
  - `GET /api/versions/:id/provenance` — provenance events timeline
  - `GET /api/versions/:id/diff?against=<other_version_id>` — structured diff
  - `GET /api/versions/:id/output` — raw image file (streams from disk)
  - `POST /api/versions/:id/reproduce` — submit reproduce; returns new version id (returns bare domain shape, not MCP envelope)
  - `POST /api/assets/query` — paginated cross-hierarchy search (body mirrors `asset.query` input shape; returns bare `{items, total_count, limit, offset}`)
  - `POST /api/assets/list_tags` / `POST /api/assets/list_metadata_keys` — for future facets, mirror the MCP actions
  - `GET /api/dashboard/home` — aggregate endpoint for the landing view: `{active_versions: [...], recent_versions: [...], workspaces: [...]}`
- **Response envelope:** REST returns **bare domain shapes** — no MCP `{structuredContent, content}` dual-form wrapper. Errors use Hono's JSON 4xx/5xx with body `{code, message, hint?}` matching the MCP typed-error vocabulary.
- **SSE stream:** one global endpoint `GET /api/events` (Content-Type `text/event-stream`). Event types, each as one SSE `data:` JSON frame:
  - `version.status_changed` — `{type, version_id, shot_id, status, breadcrumb, at}`
  - `version.created` — `{type, version_id, shot_id, breadcrumb, at}` (fires on `submit`, `reproduce`, and `iterate` inserts)
  - `tag.changed` — `{type, action: 'add'|'remove', version_id, shot_id, tag, at}`
  - `metadata.changed` — `{type, action: 'set'|'remove', version_id, shot_id, key, at}` (value NOT in payload — may contain sensitive data)
  - `hierarchy.created` — `{type, entity_type: 'workspace'|'project'|'sequence'|'shot', entity_id, parent_id, at}`
- **Engine EventEmitter:** tiny `src/engine/events.ts` module. Engine exposes an `EventEmitter` (Node built-in) the SSE handler subscribes to. Hierarchy/version mutation methods publish typed events. Zero new dependency. Emitter lives on the Engine facade (not per-repo) — keeps the event fanout centralized.
- **Static file serving:** `app.use('/*', serveStatic({ root: './packages/dashboard/dist' }))` — registered AFTER `/api/*` and `/mcp` so those take precedence. When `dist/` is missing, server logs a warning and `/` returns a minimal fallback HTML (`<h1>Dashboard not built</h1><p>Run <code>npm run build:dashboard</code></p>`). Server still starts and serves `/api/*` + `/mcp`.
- **Dev loop:** two-process — `npm run dev:dashboard` runs `vite` on `:5173` (HMR), `npm run start:http` runs the MCP server on `:3000`. Dashboard fetches `http://127.0.0.1:3000/api/*` in dev. `HTTP_ALLOWED_ORIGINS` env gains `http://localhost:5173` in the dev `.env` only; production deploys rely on same-origin serving.
- **Thumbnail / output storage:** Engine extension — on `markCompleted`, download the ComfyUI output to `outputs/<version_id>/<original_filename>`. Existing Engine constructor already takes `'outputs'` (see `src/engine/pipeline.ts` line 189 of `server.ts`). `GET /api/versions/:id/output` streams the file from disk with correct `Content-Type`. Dashboard uses `<img src="/api/versions/:id/output" />` directly. Works offline after generation.
- **Aesthetic:** ComfyUI-native — lift palette, typography, iconography from comfy.org + ComfyUI app chrome, but keep our own layouts (tree sidebar + detail pane, not a ComfyUI-app clone). Dark theme by default; light theme toggle persists to `localStorage`. Tailwind v4 dark mode via CSS variables + `[data-theme="dark|light"]` attribute on `<html>`.
- **Typography:** Inter (UI) + Inter Tight (headings) + `tabular-nums` on every numeric column (timestamps, version numbers, counts).
- **Motion:** restrained — 150-200ms ease-out on state changes, subtle pulse on running status, flash-to-complete on status transition. No springs, no staggered entrances.
- **Target:** desktop-only, 1440px+ optimal. 1024px-1440px degrades gracefully (sidebar collapses to drawer). Below 1024px shows an overlay message "Dashboard requires a desktop browser."
- **Navigation model:** Tree sidebar (collapsible hierarchy: workspace → project → sequence → shot) always visible on the left. Main pane shows selected entity's detail. Sidebar has a persistent bottom panel `Active generations (N)` with one row per running version — always visible regardless of what's in the main pane.
- **Home view:** root `/` route renders a dashboard home pane (active generations summary + recent versions feed + workspace quick-links). Sidebar tree is still present to the left.
- **Shot detail view:** thumbnail grid of version cards (latest first). Each card: thumbnail (`<img>` with skeleton placeholder that fades in on load) + `v###` label + timestamp + status pill + lineage badge (for reproduce/iterate). Status-colored card placeholder when output doesn't exist (submitted / running / failed).
- **Version detail drawer:** opens from the right when a version card is clicked. Tabs: **Summary** (seed, timestamp, elapsed, status, lineage + parent link), **Workflow** (syntax-highlighted JSON, collapsible), **Prompt** (same), **Models** (list with checksum or `null` badge), **Raw** (full entity JSON). Copy-to-clipboard button on each JSON block.
- **Version actions (dashboard surface):** `Compare with v###` (diff) and `Reproduce` buttons in the drawer header. Diff opens a second drawer with structured diff from `engine.diffVersions`. Reproduce calls `POST /api/versions/:id/reproduce`; on success, drawer shows a toast "v004 submitted — tracking in active panel."
- **Empty states:** handled explicitly — empty workspaces, empty shots, pre-first-generation. Each shows a contextual message, not a broken view.
- **Auth posture:** trust 127.0.0.1 binding. SEC-03 origin allowlist (Phase 2) continues to reject unexpected browser origins. Zero new auth tokens.
- **Testing:** Phase 5 tests live in two places:
  - Server-side: `src/http/__tests__/*` — unit tests for REST route handlers, SSE event fan-out, fallback HTML behavior, serveStatic mount order (api/mcp precedence).
  - Dashboard-side: `packages/dashboard/src/__tests__/*` — Vitest + `@testing-library/preact`. Snapshot tests for key views (home, shot detail, provenance drawer); interaction tests for diff + reproduce; SSE reconnect simulation.
  - Cross-cutting: extend `architecture-purity.test.ts` to assert `src/http/*` has zero MCP imports (parallel to engine-purity); extend `stdio-hygiene.test.ts` to assert no new tool registrations bumped tool-budget; add `dist-freshness.test.ts` that spawns `vite build` and diffs the output (or a CI-only check — planner picks).
- **CORS:** `/api/*` checks `Origin` header against `HTTP_ALLOWED_ORIGINS` (reuses existing Phase 2 env + logic from `server.ts` line 232). Same-origin (served-from-self) passes because browsers don't send `Origin` for same-origin `fetch`. SSE honors the same origin check on the initial request.
- **Tool-budget test:** Phase 5 adds ZERO new MCP tools. Tool-budget assertion stays at **7 of 12**. Dashboard API is NOT MCP.

**Out of scope (belongs to later phases or deferred):**

- **Iterate-from-UI** — no in-dashboard editor for node-scoped overrides. Agents use `generation.iterate` via MCP.
- **Tag / metadata write from UI** — dashboard does NOT add/remove tags or set/remove metadata. Agents do that via `asset` MCP tool. Dashboard only reads.
- **New MCP tools** — Phase 5 uses the existing 7 tools verbatim (no `dashboard` MCP tool, no new actions on existing tools).
- **Mobile / phone layouts** — desktop-only below 1024px shows an overlay.
- **Per-shot or per-job SSE endpoints** — single global stream only; client-side filter by current view.
- **SSE replay buffer / Last-Event-ID** — simple reconnect; client reconciles via REST if it missed events during disconnection.
- **ComfyUI node-by-node progress bar** — Phase 5 shows only status transitions + elapsed timer. Node-level progress is a potential v1.x upgrade if the Cloud API exposes it.
- **Authentication / authorization beyond 127.0.0.1 bind** — no bearer token, no user accounts, no per-user views.
- **0.0.0.0 bind / remote access** — server continues to bind 127.0.0.1 only.
- **Multi-backend routing dashboard view** — v2 (ROUTE-01..ROUTE-03).
- **Batch operations, webhook config, hierarchy export** — v2 (ADV-01..ADV-04).
- **Dashboard workflow authoring** — out of scope project-wide (PROJECT.md Out of Scope).
- **Output file cleanup / retention policy** — demo scale, we keep everything; cleanup is a later phase if disk becomes a concern.
- **Blurhash / LQIP for thumbnails** — skeleton placeholder only; blurhash deferred.
- **Lineage graph visualization** — v2 (ADV-04). Phase 5 shows lineage as a badge + parent link in the provenance drawer, not as a graph.
- **Signed URLs or expiring tokens for output images** — `/api/versions/:id/output` is unauthenticated (same-origin served from 127.0.0.1).
- **Full-text search UI on tags / metadata values** — Phase 4 is AND-only exact match; Phase 5 exposes the same via `POST /api/assets/query`, no FTS5.
- **Service-worker / offline support** — online-only demo.
- **Internationalization** — English only.
- **Animations beyond subtle fades/pulses** — no node-graph-animated-traces, no particle effects, no "wow" motion.

</domain>

<decisions>
## Implementation Decisions

### Data Flow & HTTP Surface (WEBUI-01, WEBUI-03, WEBUI-04)

- **D-WEBUI-01:** Dashboard reads data via **new Hono REST routes under `/api/*`** — NOT by speaking MCP to `/mcp`. The dashboard is not an MCP client; no MCP SDK ships in the browser bundle. Routes delegate to the same `Engine` the MCP tools delegate to, so the two surfaces stay behaviorally consistent without any envelope translation layer.
- **D-WEBUI-02:** REST + SSE routes live in a **new `src/http/` module** — the only place (outside `server.ts`) that registers Hono handlers. Files: `src/http/dashboard-routes.ts`, `src/http/sse.ts`, `src/http/static.ts`. Architecture-purity asserts `src/http/*` has zero `@modelcontextprotocol/sdk` imports (parallel to the engine-purity rule). `server.ts` imports from `src/http/index.ts` and mounts on the existing Hono app.
- **D-WEBUI-03:** **Single global SSE stream** at `GET /api/events`. One connection per browser tab. Client-side filter by current view (e.g., only render `version.status_changed` events whose `shot_id` matches the open shot). No per-shot or per-job endpoints.
- **D-WEBUI-04:** **Auth = 127.0.0.1 bind**. Dashboard inherits the Phase 1/2 HTTP posture: bind `127.0.0.1` only, `HTTP_ALLOWED_ORIGINS` allowlist for browser `Origin` headers. No bearer tokens, no per-user auth, no `0.0.0.0` bind option in Phase 5. Same-origin fetches from the dashboard (served by the same Hono process) don't send `Origin` — they pass automatically.
- **D-WEBUI-05:** REST responses are **bare domain shapes**, NOT the MCP dual-form `{structuredContent, content}` envelope. Example: `GET /api/versions/:id` returns `{entity: Version & {tags, metadata}, breadcrumb, breadcrumb_text}` — the same `hydrateVersionWithAssets` output as the MCP tool's `structuredContent`, but unwrapped. Errors: JSON body `{code, message, hint?}` + HTTP 4xx/5xx. Error codes reuse the existing typed vocabulary (`VERSION_NOT_FOUND`, `INVALID_INPUT`, `INVALID_SCOPE`, `COMFYUI_CREDENTIALS_MISSING`, etc.).
- **D-WEBUI-06:** **Five SSE event types** fire from the engine:
  1. `version.status_changed` — `{type, version_id, shot_id, status, breadcrumb, at}` (fires from `markCompleted` + recovery-poller state transitions)
  2. `version.created` — `{type, version_id, shot_id, breadcrumb, at}` (fires from `submitGeneration`, `reproduceVersion`, `iterateFromVersion` on row insert)
  3. `tag.changed` — `{type, action: 'add'|'remove', version_id, shot_id, tag, at}` (from `addTag`, `removeTag`)
  4. `metadata.changed` — `{type, action: 'set'|'remove', version_id, shot_id, key, at}` — value deliberately omitted to avoid leaking potentially sensitive values into the event stream
  5. `hierarchy.created` — `{type, entity_type: 'workspace'|'project'|'sequence'|'shot', entity_id, parent_id, at}` (from `HierarchyRepo.createWorkspace/Project/Sequence/Shot`)
- **D-WEBUI-07:** **Simple SSE reconnect** — no replay buffer, no `Last-Event-ID`. On reconnect, the client drops any missed events and reconciles current state via REST calls (`GET /api/shots/:id/versions`, `GET /api/dashboard/home`). This is cheaper (no server-side event buffer + eviction policy) and honest about the delivery guarantee: SSE is best-effort, REST is the source of truth.

### Static Bundle & Build (WEBUI-04, WEBUI-05)

- **D-WEBUI-08:** Repo becomes an **npm workspaces monorepo**. Root `package.json` adds `"workspaces": ["packages/*"]`. Dashboard lives at `packages/dashboard/` with its own `package.json` carrying `preact`, `@preact/signals`, `vite`, `@vitejs/plugin-preact`, `tailwindcss@^4`, `@tailwindcss/vite`, `typescript`, `vitest`, `@testing-library/preact`. These deps do NOT pollute root `package.json` — `npm install` at the root installs both packages via workspaces; server runtime deps stay minimal. Scripts: root `package.json` adds `"build:dashboard": "npm run build --workspace=packages/dashboard"`, `"dev:dashboard": "npm run dev --workspace=packages/dashboard"`, `"test:dashboard": "npm run test --workspace=packages/dashboard"`.
- **D-WEBUI-09:** **`packages/dashboard/dist/` is committed to git**. A CI workflow step runs `npm run build:dashboard` and fails if `git diff --exit-code packages/dashboard/dist` shows a mismatch. PRs that modify dashboard source without rebuilding dist fail. This honors WEBUI-05 ("no separate build step required to view dashboard") — viewers who `git clone && npm install && npm run start:http` see the dashboard immediately. Ugly commits but correct contract.
- **D-WEBUI-10:** **Client framework:** Preact + `@preact/signals` for reactive state + TypeScript. Signals fit a read-heavy dashboard with many components subscribing to the same SSE stream — fine-grained reactivity avoids full-tree re-renders on every event.
- **D-WEBUI-11:** **Styling:** Tailwind CSS v4 via `@tailwindcss/vite`. No component library — hand-roll components for the ComfyUI-native aesthetic we're chasing. Tailwind v4 config lives in `packages/dashboard/src/styles/theme.css` (CSS-native config; no `tailwind.config.ts` needed).
- **D-WEBUI-12:** **Hono static mount order:**
  ```ts
  app.post('/mcp', ...)             // MCP first
  app.on([...], '/mcp', ...)        // MCP method guards
  app.route('/api', dashboardApi)   // REST second
  app.get('/api/events', sseHandler)// SSE
  app.use('/*', serveStatic({...})) // static last (fallback)
  ```
  `/api/*` and `/mcp` take precedence over the wildcard serveStatic. When `packages/dashboard/dist/` is missing (fresh clone before `npm install`), the static handler returns a minimal fallback HTML at `/` and the server logs a one-line warning at boot.
- **D-WEBUI-13:** **Dev loop (two-process):** `npm run dev:dashboard` runs `vite` (HMR on `:5173`), `npm run start:http` runs the server (`:3000`). Dashboard fetches `http://127.0.0.1:3000/api/*` in dev. Root `.env.development` (or developer docs) adds `HTTP_ALLOWED_ORIGINS=http://localhost:5173` — dev-only widening. Production single-process serves everything from `:3000` same-origin.
- **D-WEBUI-14:** **CI freshness gate:** `.github/workflows/ci.yml` (or equivalent) adds a step `- run: npm run build:dashboard && git diff --exit-code packages/dashboard/dist`. Any PR touching `packages/dashboard/src/**` without rebuilding dist fails CI. Planner may also add a `pre-commit` hook (husky + lint-staged) for developer ergonomics — CI gate is non-negotiable, hook is optional.

### Visual Language & Layout (WEBUI-01, WEBUI-02)

- **D-WEBUI-15:** **Aesthetic direction:** ComfyUI-native — lift the palette, typography, and iconography from comfy.org + the ComfyUI desktop app, but keep our own layouts. Dashboard reads as "made by the Comfy team" without being a ComfyUI clone. Researcher / planner should:
  1. Inspect comfy.org's CSS (marketing site) + the open-source ComfyUI web UI (`ComfyUI/web/`) for color tokens, font stack, accent colors (notably the purple/magenta signature).
  2. Extract canonical tokens into `packages/dashboard/src/styles/theme.css` as CSS custom properties.
  3. Not attempt to recreate ComfyUI's node-graph chrome or panel system — we have our own layout (tree sidebar + detail pane).
- **D-WEBUI-16:** **Theme:** dark by default, light toggle. Toggle persists to `localStorage`. Implementation: `[data-theme="dark"]` / `[data-theme="light"]` on `<html>`; Tailwind v4 dark-mode uses CSS variables under these selectors. No `prefers-color-scheme` auto-switch in Phase 5 (user choice wins; we can add auto-detect on first visit as an enhancement).
- **D-WEBUI-17:** **Navigation model:** tree sidebar + detail pane.
  - Left sidebar (fixed width ~280px): collapsible hierarchy tree (workspace → project → sequence → shot). Each level expands on click, persists expansion state in `localStorage`.
  - Main pane: shows the selected entity's detail view (workspace detail, project detail, sequence detail, shot detail).
  - Sidebar bottom: persistent `Active generations (N)` panel (see D-WEBUI-22).
  - Responsive: sidebar collapses to a slide-out drawer below 1024px; overlay "requires desktop" below that.
- **D-WEBUI-18:** **Home view (root `/`):** landing renders a dashboard home pane: three sections stacked — `Active generations` (N rows, live), `Recent versions` (most-recent N across all shots), `Workspaces` (quick-jump cards). Sidebar is also visible. Backed by `GET /api/dashboard/home` aggregate endpoint. Gives the demo audience a "something is happening" first impression rather than an empty detail pane.
- **D-WEBUI-19:** **Shot detail view:** image-thumbnail grid of version cards, latest first (ordering matches D-ASST-16 — `versions.created_at DESC, versions.id DESC`). Each card:
  - Thumbnail (skeleton placeholder → fade-in on load per D-WEBUI-23).
  - `v###` label (zero-padded per HIER-05).
  - Timestamp (relative "2m ago" with tooltip showing absolute ISO).
  - Status pill (submitted / running / completed / failed — color-coded).
  - Lineage badge (for reproduce / iterate versions — small icon + parent link).
  - Tag chips (if present; read-only in Phase 5).
  - Metadata count ("3 metadata" → tooltip shows keys).
- **D-WEBUI-20:** **Typography:** Inter (UI), Inter Tight (headings). `font-variant-numeric: tabular-nums` applied to every numeric column (timestamps, version numbers, elapsed-time counters, tag/metadata counts) — prevents digit jitter during live updates. Font hosted via `@fontsource/inter` dep inside `packages/dashboard/` (not via CDN — offline-capable, predictable).
- **D-WEBUI-21:** **Motion:** restrained — 150-200ms ease-out on state changes. Subtle pulse (1.5s sine-wave opacity) on running status. Flash-to-complete on status transition (brief green/red tint). No springs, no bounces, no staggered list entrances. CSS-only animations; no motion library dependency.

### Live Generation & Provenance UX (WEBUI-02, WEBUI-03)

- **D-WEBUI-22:** **Active generations panel:** persistent panel at the bottom of the left sidebar. Header: `Active generations (N)` with N live-updated from SSE. Body: one row per `status in ('submitted', 'running')` version, showing breadcrumb (`project/sequence/sh010`) + `v###` + elapsed time (live counter) + cancel link (deferred — Phase 5 displays the counter only). Row animates out on terminal status transition and a small bottom-right toast fires (`v004 in sh010 completed`, green) or (`v004 in sh010 failed: <message>`, red). Auto-dismisses after 5s.
- **D-WEBUI-23:** **Progress granularity:** status transitions + elapsed-time counter only. No ComfyUI node-by-node progress bar in Phase 5 (engine doesn't know node-level state; would require probing a ComfyUI Cloud progress endpoint that may or may not exist). Elapsed-time counter is client-side — starts at `created_at` (from SSE `version.created` payload) and ticks every second until the `version.status_changed` event lands with a terminal status.
- **D-WEBUI-24:** **Provenance drill-down presentation:** side-drawer from the right (width ~560px, full height). Opens when a version card is clicked. Tabs across the top:
  1. **Summary** — seed, `created_at`, `completed_at`, elapsed (if completed), status, lineage (`lineage_type` + parent link if present), `job_id`, model count, tag count, metadata count.
  2. **Workflow** — syntax-highlighted JSON (`workflow_json`), collapsible. Copy-to-clipboard button.
  3. **Prompt** — same, for `prompt_json`. Copy button. Shows "unavailable" placeholder if `prompt_json` is null (failed version path, per D-PROV-24).
  4. **Models** — list of models from the prompt blob; each row shows model name + checksum badge (or `null` badge + tooltip "checksums deferred — Phase 3").
  5. **Raw** — full entity JSON dump (everything the API returned). Copy button.
  Drawer header has two action buttons — see D-WEBUI-25.
- **D-WEBUI-25:** **Version actions exposed by the dashboard (minimal surface):**
  1. **`Compare with v###` (diff)** — dropdown of sibling versions → select one → opens a second drawer showing the structured diff from `engine.diffVersions` (`{summary, changes: {params, models, seed, workflow, metadata}}`). Each change section renders as a colored add/remove list. Matches `version.diff` MCP action response.
  2. **`Reproduce`** — submits a reproduce via `POST /api/versions/:id/reproduce`. On success (202), drawer shows an inline toast ("Reproduce submitted — tracking as v005"). The new version appears in the sidebar active-generations panel via SSE (`version.created` event). Failure (e.g., `PROVENANCE_UNAVAILABLE`) shows an inline error with the hint.
  3. **Copy prompt / workflow JSON** — copy buttons already on each JSON block.
  - Explicitly NOT in Phase 5: `Iterate from this` button (node-override editor is a separate UX investment — defer to Phase 5.x or a later iteration), `Add tag`, `Set metadata`, `Remove tag`, `Remove metadata`. Agents drive those via MCP; dashboard stays a mostly-read surface.
- **D-WEBUI-26:** **Thumbnail source:** Engine extension — on `markCompleted`, download the ComfyUI output to `outputs/<version_id>/<original_filename>`. Engine already receives `'outputs'` as the directory in its constructor (`src/server.ts` line 189). Download happens inside the generation completion path, after the provenance event is written. Downloader is a small helper in `src/engine/output-downloader.ts` — pure `fetch` (reusing `ComfyUIClient`'s bearer/SSRF guard) + `fs.writeFile`. On failure, the version is still marked completed but `outputs/<version_id>/` is missing; dashboard shows the status-colored card placeholder (D-WEBUI-27) instead of a broken image. `GET /api/versions/:id/output` streams the file via `fs.createReadStream` with `Content-Type` guessed from the filename extension (`.png`, `.webp`, `.jpg`, `.mp4`).
- **D-WEBUI-27:** **Empty / loading states:**
  - Before `<img>` loads: gray skeleton card with subtle shimmer pulse (200ms fade-in on `onload`).
  - Status = `submitted` / `running`: status-colored card (amber for running, blue for submitted) with the status text centered — no image at all (none exists yet).
  - Status = `failed`: red-tinted card with error message excerpt + "View details" affordance that opens the drawer on the Summary tab.
  - Output file missing after completion (download failed): neutral card with a "preview unavailable — provenance still viewable" hint + drawer-opening click target.
  - Empty hierarchy (fresh server): home pane shows a "Getting started" card with a link to the MCP setup docs; shot detail shows "No versions yet — submit a generation via your MCP agent."

### Server-Side Architecture (extends Phase 1/2/3/4)

- **D-WEBUI-28:** **Tool-engine separation continues.** New `src/http/*` is a thin REST delegate to engine methods — zero business logic in route handlers. Architecture-purity test asserts `src/http/*` has zero MCP SDK imports AND zero direct SQLite imports (route handlers go through `Engine`, not raw repos).
- **D-WEBUI-29:** **Engine gains a tiny EventEmitter.** New `src/engine/events.ts` exports an `EventEmitter` instance attached to the `Engine` facade (`this.events: EventEmitter`). All mutation paths inside `src/engine/*` publish typed events:
  - `engine.submitGeneration()` publishes `version.created`.
  - `engine.reproduceVersion()` publishes `version.created`.
  - `engine.iterateFromVersion()` publishes `version.created`.
  - Recovery poller / `markCompleted` publishes `version.status_changed`.
  - `engine.addTag / removeTag` publishes `tag.changed`.
  - `engine.setMetadata / removeMetadata` publishes `metadata.changed` (value stripped).
  - `HierarchyRepo.create*` — Engine facade wraps these and publishes `hierarchy.created`.
  The SSE handler (`src/http/sse.ts`) subscribes to the emitter and writes each event as an SSE frame to the connected response. On connection close, unsubscribes and cleans up.
- **D-WEBUI-30:** **Tool-budget test stays at 7/12.** No new MCP tools. No new MCP actions on existing tools. Dashboard API is NOT MCP.
- **D-WEBUI-31:** **Architecture-purity extensions:**
  - `src/http/*` has zero `@modelcontextprotocol/sdk` imports.
  - `src/http/*` has zero `better-sqlite3` / `drizzle-orm` imports (goes through `Engine`).
  - `src/engine/events.ts` has zero MCP imports and zero HTTP imports (pure EventEmitter module).
  - `packages/dashboard/src/**` has zero imports from `../../src/**` (client code cannot import server code — enforced by tsconfig paths / eslint rule at planner discretion).
- **D-WEBUI-32:** **Error envelope on REST:** errors throw as existing typed `TypedError` inside route handlers; a Hono middleware `src/http/error-middleware.ts` catches them and renders `{code, message, hint?}` with the appropriate HTTP status (404 for `*_NOT_FOUND`, 400 for `INVALID_INPUT`/`INVALID_SCOPE`, 502 for `COMFYUI_*`, 500 for unknown). Parallel to how the MCP tool layer re-wraps typed errors (D-28..D-32, D-GEN-41, D-PROV-37, D-ASST-25).
- **D-WEBUI-33:** **File-streaming for outputs:** `GET /api/versions/:id/output` uses `fs.createReadStream` wrapped in a `ReadableStream` for Hono's `c.body(stream)`. `Content-Type` via a small extension → mime map (`.png`, `.webp`, `.jpg`, `.jpeg`, `.mp4`). On missing file → 404 with `{code: 'OUTPUT_UNAVAILABLE', message, hint}` — new typed error code.
- **D-WEBUI-34:** **New typed error codes reserved for Phase 5:**
  - `OUTPUT_UNAVAILABLE` — version exists but output file missing on disk (download failed or cleanup happened); hint points to re-running `reproduce`.
  - `DASHBOARD_DIST_MISSING` — never raised to clients; used only for the boot-time server log when `packages/dashboard/dist/` is absent.

### Testing Strategy

- **D-WEBUI-35:** Test layers:
  1. **Unit — HTTP routes** (`src/http/__tests__/dashboard-routes.test.ts`, `sse.test.ts`, `static.test.ts`): every REST route exercised with the in-memory fake engine; SSE subscribe + event fan-out; static mount order + fallback HTML.
  2. **Unit — engine events** (`src/engine/__tests__/events.test.ts`): mutation paths publish the right events with right payloads (shape + id correctness).
  3. **Unit — output downloader** (`src/engine/__tests__/output-downloader.test.ts`): happy path + failure recovery (completion still succeeds, log written, no unhandled rejection).
  4. **Dashboard component tests** (`packages/dashboard/src/__tests__/*.test.tsx`): snapshot tests for home pane, shot detail grid, version drawer tabs; interaction tests for diff drawer open + reproduce button; SSE client-side filter tests.
  5. **Dashboard e2e** (optional — planner picks): Playwright or Vitest browser mode — one golden-path test (server starts, dashboard loads, active panel reacts to a fake SSE event).
  6. **Cross-cutting**:
     - `architecture-purity.test.ts` adds `src/http/*` + `src/engine/events.ts` + `src/engine/output-downloader.ts` to the MCP-import-free assertion.
     - `tool-budget.test.ts` stays 7/12.
     - New `dist-freshness.test.ts` or CI step that runs `vite build` and fails on `git diff`.
  7. **Live smoke** — extend `verify-phase3-uat.mts` / new `verify-phase5-dashboard.mts` to curl `/api/dashboard/home`, `/api/shots/:id/versions`, then hit `/api/events` with `curl -N` and assert at least one `version.status_changed` event frame when a generation completes.
- **D-WEBUI-36:** **SSE testing specifics:** in unit tests, swap the real `EventEmitter` for a controlled spy so tests can assert emit order and payload shape without starting a real HTTP server. For the end-to-end SSE test, use `undici`'s `fetch` with streaming body — Node 20+ supports SSE-style response streaming out of the box; no new dep.
- **D-WEBUI-37:** **Test-utils extensions:** `src/test-utils/fake-engine.ts` gains a fake `events: EventEmitter` that component/route tests can `.emit()` on directly. `src/test-utils/fixtures.ts` gains a `buildStackWithOutputs()` helper that wires a temp directory for the outputs/ path so downloader tests don't hit real disk outside the temp area.

### Claude's Discretion

- **Exact color tokens and spacing scale** — planner / researcher extracts these from comfy.org + ComfyUI app chrome; no specific hex codes locked in CONTEXT.md.
- **Icon library** — phosphor-icons, lucide-preact, or hand-drawn SVGs — planner picks based on bundle size + ComfyUI parity.
- **JSON syntax highlighter** — `shiki` (tree-shaken), `prism`, `highlight.js`, or a hand-rolled mini-tokenizer — planner picks; bundle size matters.
- **Exact SSE frame format** — `data: {"type":"...","..."}\n\n` is canonical; whether to include `event:` type header + keep-alive ping cadence is planner's call.
- **EventEmitter vs a tiny pub/sub of our own** — planner may use Node's built-in `events.EventEmitter` or a ~20-line typed pub-sub. Either is fine.
- **Active generations panel behavior detail** — exact animation timings, stacking when > 5 active, pause-on-hover, sorting (oldest first vs newest first) — planner decides based on what feels right during demo rehearsal.
- **Drawer vs modal for provenance detail** — decision is drawer (right-side), but width exact value and whether it's resizeable is planner's call.
- **Diff drawer rendering** — planner picks presentation: inline add/remove list, side-by-side, or a hybrid. Data shape is locked (`engine.diffVersions` output).
- **Output downloader retry / timeout policy** — follows ComfyUIClient pattern (exponential backoff) but exact numbers are planner's call.
- **Dashboard error boundaries** — how granular; where to catch runtime errors in the Preact tree. Planner decides; one-per-major-view is a reasonable default.
- **localStorage keys** — theme preference, sidebar expansion state, last-visited shot. Planner picks key names and payload shapes.
- **Keyboard shortcuts** — cmd-k for search? Escape to close drawer? Planner picks; not in scope to pin in CONTEXT.md.
- **Build tool config details** — `vite.config.ts` exact shape, target es-version, CSS preprocessor — planner picks to minimize bundle size.
- **Whether to split the dashboard bundle into chunks** — route-based code splitting vs single bundle. Probably single bundle at demo scale; planner decides.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, checker) MUST read these before acting.**

### Prior phase context (hard dependency — Phase 5 extends, not restates)

- `.planning/phases/01-foundation-hierarchy/01-CONTEXT.md` — Phase 1 decisions D-01..D-36: tool naming / action discrimination / dual-form envelope / breadcrumb on every response / typed error model / nanoid prefixes / repo pattern / tool-engine separation / 12-tool cap / `listChanged: false` override / 127.0.0.1 bind discipline (D-16). The dashboard REST surface honors the same breadcrumb + typed-error contracts (in bare form per D-WEBUI-05).
- `.planning/phases/02-comfyui-generation/02-CONTEXT.md` — Phase 2 decisions. Especially: HTTP origin allowlist (`HTTP_ALLOWED_ORIGINS` + SEC-03) that Phase 5 SSE + REST inherit verbatim; ComfyUI client bearer/SSRF guard (IS-02); recovery poller (D-GEN-29) that fires `version.status_changed` events; `versions.status` enum vocabulary (`submitted | running | completed | failed`) used in SSE payloads and status pills.
- `.planning/phases/03-provenance-versioning/03-CONTEXT.md` — Phase 3 decisions. Especially: `version.get` / `version.list` / `version.diff` / `version.provenance` response shapes (the dashboard's REST routes mirror these in bare form); `reproduction_warnings[]` (D-PROV-28 — surfaced in the provenance drawer Summary tab); `lineage_type` + `parent_version_id` (D-PROV-13, D-PROV-33) rendered as the lineage badge + parent link.
- `.planning/phases/04-asset-management/04-CONTEXT.md` — Phase 4 decisions. Especially: `version.get` inline tags + metadata (D-ASST-19) — dashboard renders these on every version card / drawer; `version.list` include flags (D-ASST-20) — dashboard calls `?include_tags=1&include_metadata=1` for shot detail; `asset.query` AND-only filter model (D-ASST-12..14) — REST `POST /api/assets/query` mirrors it; single-scope XOR rule (D-ASST-13); breadcrumb-every-response (D-ASST-22); status filter values (D-ASST-17).

### Project research (MUST read — locks macro decisions)

- `.planning/research/ARCHITECTURE.md` §"Web UI" / §"Transport" — confirms dashboard as static bundle served by the same Hono process; SSE as the live mechanism; 127.0.0.1 binding policy.
- `.planning/research/STACK.md` — pinned versions of Hono, `@hono/node-server`, `better-sqlite3`, `drizzle-orm`, `zod`. Phase 5 adds **only devDeps inside `packages/dashboard/`** — Preact, Vite, Tailwind v4, @testing-library/preact, vitest — these do NOT appear in root production deps.
- `.planning/research/PITFALLS.md` — relevant entries: bundle size creep, SSE connection leaks, HMR cross-origin in dev.
- `.planning/research/FEATURES.md` §"Web UI" — scope hints: hierarchy, provenance, live status. Phase 5 delivers exactly these.
- `.planning/research/SUMMARY.md` — Phase 5 positions the dashboard as the demo deliverable for the whole ComfyUI org audience.

### Project instructions

- `CLAUDE.md` §"UI" — "Preact + Vite (served as static build)". Example command `cd packages/dashboard && npx vite build`. D-WEBUI-08 follows this verbatim (monorepo shape + `packages/dashboard/` + Vite build). CLAUDE.md also pins the 12-tool MCP cap (dashboard API is NOT MCP → no impact) and the human-readable-error rule (D-WEBUI-32 extends it to REST).
- `.planning/PROJECT.md` — Active requirement "Light web UI showing project hierarchy, provenance trail, and generation status" + "Demo video: full loop from natural language → structured VFX output at scale". Demo quality constraint: "must be taken seriously by the whole org — no hacky MVP vibes" — drives D-WEBUI-15 (ComfyUI-native aesthetic) and D-WEBUI-21 (restrained, serious motion).
- `.planning/REQUIREMENTS.md` — WEBUI-01..WEBUI-05 canonical definitions. All five delivered by D-WEBUI-01..D-WEBUI-37.
- `.planning/ROADMAP.md` §"Phase 5: Web Dashboard" — Goal + five success criteria. Phase 5 `UI hint: yes`; `Depends on: Phase 4`.
- `.planning/STATE.md` — Phase 4 complete; ready-to-plan state for Phase 5. Engine, repos, migrations 0001..0004 in place.

### Existing source files (load-bearing for planning)

- `src/server.ts` — Hono app boot + `/mcp` registration + `HTTP_ALLOWED_ORIGINS` logic + 127.0.0.1 bind. Phase 5 extends this file minimally: imports from `src/http/index.ts`, mounts new routes BEFORE the static handler, registers the SSE handler.
- `src/engine/pipeline.ts` — `Engine` facade. Phase 5 extends with `events: EventEmitter`, thin `hierarchy.create` wrappers that publish `hierarchy.created`, and output-downloader hook inside `markCompleted`.
- `src/engine/index.ts` (if present — planner confirms path) — barrel exports. Add `events.ts`, `output-downloader.ts`.
- `src/store/hierarchy-repo.ts`, `src/store/version-repo.ts`, `src/store/provenance-repo.ts`, `src/store/tag-repo.ts`, `src/store/metadata-repo.ts` — read-only for Phase 5. No new methods. REST handlers go through the Engine facade, not repos.
- `src/tools/*` — ZERO changes in Phase 5. Tool surface is frozen. If a REST route needs data shaped exactly like a tool response, it calls the same engine method and strips the MCP envelope.
- `drizzle/*` — ZERO new migrations in Phase 5. No schema changes.
- `.env` — gain optional `HTTP_ALLOWED_ORIGINS` entry for dev (`http://localhost:5173`). `COMFYUI_API_KEY`, `COMFYUI_API_BASE` unchanged.
- `package.json` (root) — gains `"workspaces": ["packages/*"]` + new scripts (`build:dashboard`, `dev:dashboard`, `test:dashboard`). No runtime deps added to root.
- `packages/dashboard/package.json` (NEW) — all Preact + Vite + Tailwind devDeps live here.
- `packages/dashboard/vite.config.ts` (NEW) — Vite config with Preact + Tailwind plugins.
- `packages/dashboard/tsconfig.json` (NEW) — TypeScript config for the client package, extends a shared base.

### External specs / docs the planner / researcher needs

- **Preact** — https://preactjs.com/ — target Preact 10.x. Uses JSX factory `h` / the automatic runtime via `@preact/preset-vite`.
- **@preact/signals** — https://preactjs.com/guide/v10/signals — `signal()`, `computed()`, `effect()`. Use for SSE-driven state; components re-render only for the signals they read.
- **Vite** — https://vitejs.dev/ — target 6.x or 7.x. Use `@preact/preset-vite` (or `@vitejs/plugin-preact`) + `@tailwindcss/vite`.
- **Tailwind CSS v4** — https://tailwindcss.com/docs/v4-beta — CSS-first config via `@theme { ... }` blocks in a CSS entry file. Dark-mode selector `[data-theme="dark"]` — no `dark:` prefix config (v4 handles this via CSS variables).
- **Hono** — already pinned in STACK.md. Phase 5 uses `hono/streaming` for SSE (`stream(c, ...)` helper) and `serve-static` from `@hono/node-server/serve-static`.
- **MCP TypeScript SDK 1.29** — not used in Phase 5 client; locked in prior phases for the server side.
- **ComfyUI Cloud API docs** — https://docs.comfy.org/development/cloud/overview — still only consumed server-side (engine downloader); dashboard never talks to ComfyUI Cloud directly.
- **comfy.org marketing site + open-source ComfyUI web UI** — research source for palette / typography / iconography (D-WEBUI-15). Researcher should fetch and inspect in the research phase.

### Credentials

- No new credentials in Phase 5. `.env` (`COMFYUI_API_KEY`, `COMFYUI_API_BASE`) is untouched. Dashboard is served from the same server process; no separate dashboard secret. Viewer's browser → `127.0.0.1:3000` → Hono — no token on the wire.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 1/2/3/4 artifacts Phase 5 builds on)

- **`src/server.ts` — Hono app + dual-transport bootstrap.** Already registers `POST /mcp` + method guards + 127.0.0.1 bind + `HTTP_ALLOWED_ORIGINS` allowlist (lines 232-262). Phase 5 adds imports from `src/http/index.ts`, mounts `/api/*` routes + `/api/events` SSE handler BEFORE the catch-all static handler. No rearrangement of existing MCP logic.
- **`src/engine/pipeline.ts` — `Engine` facade.** Already constructor-injects `db, hierarchyRepo, versionRepo, provenanceRepo, comfyClient, outputsDir, { maxConcurrentPollers }`. Phase 5 adds an `events: EventEmitter` field (no constructor change — instantiated internally) and a thin output-downloader hook inside the `markCompleted` path. All existing mutation methods gain one-line `this.events.emit('version.*', payload)` calls — no behavioral change.
- **`src/engine/breadcrumb.ts` — `BreadcrumbResolver`.** Already resolves every entity type. REST handlers call it directly for the handful of responses that need a breadcrumb (consistent with MCP tool surface).
- **`src/engine/errors.ts` — `TypedError`.** Reused verbatim. Phase 5 adds one new string-literal code (`OUTPUT_UNAVAILABLE`). The REST error middleware (D-WEBUI-32) catches `TypedError` and renders it as JSON.
- **`src/tools/shape.ts` — shared constants.** `MAX_PAGE_SIZE` (100), `DEFAULT_PAGE_SIZE` (20) are reused by REST pagination endpoints. No new constants in Phase 5.
- **`src/tools/envelope.ts` + `shapeList`.** NOT reused — Phase 5 REST uses bare domain shapes (D-WEBUI-05). The MCP tool layer keeps its envelope wrapping.
- **Engine methods `getVersion`, `listVersionsForShot`, `diffVersions`, `queryAssets`, `listTags`, `listMetadataKeys`, `reproduceVersion`** — all already exist from Phase 3/4. REST routes delegate directly.
- **`src/comfyui/client.ts` — `ComfyUIClient`.** Phase 5 reuses its `fetch` wrapper (bearer header, SSRF guard) for the new output-downloader. No new methods on the client.
- **`src/test-utils/fake-engine.ts` + `fixtures.ts`.** Extended with `events: EventEmitter` field on the fake Engine; new `buildStackWithOutputs()` helper for downloader tests.
- **`outputs/` directory.** Engine constructor already receives `'outputs'` as the directory path. Phase 5 starts writing files there (`outputs/<version_id>/<filename>`). `.gitignore` should include `outputs/` (planner confirms).

### Established Patterns (Phase 5 must match)

- **Tool-engine separation** — reused at a higher level: route-engine separation. `src/http/*` is the route layer; Engine is still the only business-logic layer. Architecture-purity asserts this.
- **Typed error model** — all REST errors re-wrap into `TypedError`; middleware renders as JSON. Parallel to how MCP tool layer re-wraps (D-28..D-32, D-GEN-41, D-PROV-37, D-ASST-25).
- **Breadcrumb on every read response** — REST reads hydrate breadcrumb via `BreadcrumbResolver` the same way MCP tools do. Matches WEBUI response ergonomics.
- **Additive-only file boundaries** — Phase 5 adds new files (`src/http/*`, `src/engine/events.ts`, `src/engine/output-downloader.ts`, `packages/dashboard/**`). No renames, no breaking changes to Phase 1-4 public APIs. `src/server.ts` grows — does not change structure.
- **127.0.0.1 bind + origin allowlist** — inherited verbatim from Phase 2 (`server.ts` lines 232-262). Dashboard does not widen this.
- **Repo pattern** — NOT extended (no new tables, no new repos in Phase 5).
- **Tool-budget test** — stays at 7/12 — a critical invariant Phase 5 must NOT accidentally violate.
- **Architecture-purity test** — extends to `src/http/*`, `src/engine/events.ts`, `src/engine/output-downloader.ts` (zero MCP imports).
- **stdio-hygiene test** — REST handlers log via `console.error` (stderr) — stdout remains reserved for MCP JSON-RPC framing. Phase 5 must not introduce any `console.log`.

### Integration Points

- **`src/server.ts` — extend.** Import `src/http/index.ts`. Before the catch-all static handler, register: REST routes (`app.route('/api', dashboardApi)`), SSE handler (`app.get('/api/events', sseHandler)`), static mount (`app.use('/*', serveStatic({ root: './packages/dashboard/dist', fallback: fallbackHtml }))`). Engine gets passed into `src/http/*` the same way it's passed into `buildServer()`. The `if (args.http)` branch is where all this wiring lives — stdio transport is unaffected.
- **`src/http/index.ts` — NEW.** Barrel export of `createDashboardRoutes(engine)`, `createSseHandler(engine)`, `createStaticHandler(distPath)`. Each factory receives the shared Engine instance.
- **`src/http/dashboard-routes.ts` — NEW.** All `/api/*` read routes + `POST /api/versions/:id/reproduce` + `POST /api/assets/query` + `POST /api/assets/list_tags` + `POST /api/assets/list_metadata_keys`. Each handler: parse params (ad-hoc zod schemas per route, import from `src/tools/shape.ts` where possible), call engine method, unwrap into bare domain shape, return as `c.json(...)`.
- **`src/http/sse.ts` — NEW.** `createSseHandler(engine)` returns a Hono handler. On connect: check Origin against allowlist; set `Content-Type: text/event-stream` + `Cache-Control: no-cache` + `Connection: keep-alive`; subscribe to `engine.events` for the 5 event types; serialize each as `data: <json>\n\n`; send keep-alive ping every 30s; unsubscribe + close on client disconnect.
- **`src/http/static.ts` — NEW.** `createStaticHandler(distPath)` returns a Hono middleware that serves files from `distPath` with SPA fallback (unknown paths return `index.html`). When `distPath` doesn't exist (fresh clone), returns a minimal fallback HTML on `/` and 404 on others. Logs a one-line warning at startup if missing.
- **`src/http/error-middleware.ts` — NEW.** Hono error middleware that catches `TypedError` and renders `{code, message, hint?}` with the right status code. Registered on the `/api/*` route group.
- **`src/engine/events.ts` — NEW.** Exports a typed `EngineEventMap` + `createEngineEmitter()` factory. The factory returns a Node `EventEmitter` wrapped with typed `emit<T extends keyof EngineEventMap>(type: T, payload: EngineEventMap[T])` and `on<T extends ...>(...)` helpers — keeps the dashboard's SSE code type-safe.
- **`src/engine/output-downloader.ts` — NEW.** `downloadOutput(client, versionId, outputsDir, comfyOutputUrl): Promise<string>` — fetches the output file from ComfyUI, writes to `outputs/<versionId>/<filename>`, returns the absolute path. Failure is logged but NON-fatal to the completion path (version still marks completed; dashboard renders placeholder).
- **`src/engine/pipeline.ts` — extend.** Instantiate `this.events = createEngineEmitter()` in the constructor. In each mutation method, add `this.events.emit(...)` AFTER the DB write succeeds. Wrap `markCompleted` with an additional (non-throwing) `downloadOutput` call. Expose `this.events` publicly for SSE subscribers.
- **`src/engine/errors.ts` — extend.** Add `OUTPUT_UNAVAILABLE` to the `TypedErrorCode` string-literal union.
- **`src/engine/breadcrumb.ts` — reused as-is.** REST routes import `BreadcrumbResolver` directly.
- **`src/test-utils/fake-engine.ts` — extend.** Fake `events: EventEmitter` field. `buildFakeEngine()` factory wires it.
- **`src/test-utils/fixtures.ts` — extend.** `buildStackWithOutputs()` helper: creates a tmp directory, wires it into a FakeEngine for downloader tests. No change to existing fixtures.
- **`packages/dashboard/package.json` — NEW.** Preact, @preact/signals, TypeScript, Vite, @vitejs/plugin-preact (or @preact/preset-vite), Tailwind v4, @tailwindcss/vite, @fontsource/inter, vitest, @testing-library/preact, jsdom. Scripts: `dev`, `build`, `test`.
- **`packages/dashboard/vite.config.ts` — NEW.** Preact preset + Tailwind plugin. Dev server port 5173. Build output `dist/`. No bundling gymnastics in v1 — single bundle, single entry point.
- **`packages/dashboard/index.html` — NEW.** Single-entry SPA shell. `<div id="app"></div>` + `<script type="module" src="/src/main.tsx"></script>`.
- **`packages/dashboard/src/main.tsx` — NEW.** Preact render entry. Mounts `<App />` into `#app`. Initializes SSE connection.
- **`packages/dashboard/src/lib/api.ts` — NEW.** Typed fetch client. `api.workspaces.list()`, `api.versions.get(id)`, `api.versions.reproduce(id)`, `api.versions.diff(a, b)`, `api.assets.query(body)`, etc. Each returns a typed domain shape. Errors throw a typed `ApiError` with `{code, message, hint}`.
- **`packages/dashboard/src/lib/events.ts` — NEW.** SSE client: opens `EventSource('/api/events')`, dispatches typed events to a signal-backed store. Handles reconnect (native `EventSource` auto-reconnects).
- **`packages/dashboard/src/state/*` — NEW.** Signal-backed stores: `activeGenerations`, `currentSelection` (workspace/project/sequence/shot), `themePreference`, `sidebarExpansion`.
- **`packages/dashboard/src/views/*` — NEW.** `HomeView`, `WorkspaceView`, `ProjectView`, `SequenceView`, `ShotView`, `VersionDrawer`, `DiffDrawer`.
- **`packages/dashboard/src/components/*` — NEW.** `TreeSidebar`, `VersionCard`, `ActiveGenerationsPanel`, `StatusPill`, `JsonBlock`, `ThemeToggle`, `EmptyState`, `SkeletonThumbnail`.
- **`packages/dashboard/src/styles/theme.css` — NEW.** Tailwind v4 `@theme` block with ComfyUI-native palette + typography tokens extracted during research.
- **`packages/dashboard/dist/**` — NEW, COMMITTED.** Pre-built bundle. CI enforces freshness (D-WEBUI-14).
- **`.github/workflows/*` — extend (if exists) or NEW.** Add `npm run build:dashboard && git diff --exit-code packages/dashboard/dist` step.
- **Root `package.json` — extend.** Add `"workspaces": ["packages/*"]`, scripts `build:dashboard`, `dev:dashboard`, `test:dashboard`. No runtime deps added.
- **Root `tsconfig.json` — reuse / extend.** Phase 5 plans whether dashboard has its own tsconfig extending a shared base, or stays fully isolated. Planner picks.
- **`.gitignore` — extend.** Add `outputs/` (local generation outputs are not committed). `packages/dashboard/dist/` is explicitly NOT ignored — it IS committed per D-WEBUI-09.

### Build Order (Phase 5 subset — respects layering)

```
1.  Repo monorepo migration: root package.json workspaces + packages/dashboard scaffold
2.  src/engine/events.ts (typed EventEmitter factory)
3.  src/engine/output-downloader.ts (pure fetch + fs helper)
4.  src/engine/pipeline.ts extension (events field + emits + downloader hook)
5.  src/engine/errors.ts extension (OUTPUT_UNAVAILABLE code)
6.  src/test-utils/fake-engine.ts + fixtures.ts extensions
7.  src/http/error-middleware.ts (TypedError → JSON)
8.  src/http/dashboard-routes.ts (all REST routes)
9.  src/http/sse.ts (SSE handler)
10. src/http/static.ts (serveStatic + fallback HTML)
11. src/http/index.ts (barrel exports)
12. src/server.ts extension (mount http/*)
13. Unit tests for src/http/** and src/engine/events.ts + output-downloader.ts
14. Cross-cutting tests (architecture-purity + tool-budget stays 7/12)
15. packages/dashboard/ scaffold: vite.config.ts, tsconfig.json, theme.css, index.html
16. packages/dashboard/src/lib/api.ts + events.ts
17. packages/dashboard/src/state/* signals
18. packages/dashboard/src/components/* primitives
19. packages/dashboard/src/views/* (HomeView, ShotView, VersionDrawer, DiffDrawer)
20. Dashboard component tests (snapshot + interaction)
21. First build: npm run build:dashboard → commit packages/dashboard/dist/
22. CI freshness gate step added
23. Live smoke: verify-phase5-dashboard.mts curls /api/* + /api/events
```

</code_context>

<specifics>
## Specific Values (reproduce verbatim)

- **New repo layout:** workspaces monorepo. Root adds `"workspaces": ["packages/*"]`. Dashboard at `packages/dashboard/`.
- **New root scripts:** `"build:dashboard": "npm run build --workspace=packages/dashboard"`, `"dev:dashboard": "npm run dev --workspace=packages/dashboard"`, `"test:dashboard": "npm run test --workspace=packages/dashboard"`.
- **Committed artifact:** `packages/dashboard/dist/` — IS committed to git. `.gitignore` does NOT exclude it. CI fails PRs that forget to rebuild.
- **New server-side directories / files:**
  - `src/http/index.ts`
  - `src/http/dashboard-routes.ts`
  - `src/http/sse.ts`
  - `src/http/static.ts`
  - `src/http/error-middleware.ts`
  - `src/http/__tests__/*.test.ts`
  - `src/engine/events.ts`
  - `src/engine/output-downloader.ts`
  - `src/engine/__tests__/events.test.ts`
  - `src/engine/__tests__/output-downloader.test.ts`
- **REST route catalog** (all under `/api`):
  - `GET /api/workspaces`
  - `GET /api/workspaces/:id`
  - `GET /api/workspaces/:id/projects`
  - `GET /api/projects/:id`
  - `GET /api/projects/:id/sequences`
  - `GET /api/sequences/:id`
  - `GET /api/sequences/:id/shots`
  - `GET /api/shots/:id`
  - `GET /api/shots/:id/versions?limit=&offset=&include_tags=&include_metadata=`
  - `GET /api/versions/:id`
  - `GET /api/versions/:id/provenance`
  - `GET /api/versions/:id/diff?against=<other_version_id>`
  - `GET /api/versions/:id/output`
  - `POST /api/versions/:id/reproduce` — body empty; returns `{ version_id, status, breadcrumb, breadcrumb_text }`
  - `POST /api/assets/query` — body mirrors `asset.query` input; returns `{ items, total_count, limit, offset }`
  - `POST /api/assets/list_tags` — body mirrors `asset.list_tags`; returns `{ items: [{name,count}], total_count, limit, offset }`
  - `POST /api/assets/list_metadata_keys` — same shape
  - `GET /api/dashboard/home` — returns `{ active_versions, recent_versions, workspaces }`
- **SSE endpoint:** `GET /api/events` (single global stream).
- **SSE event types (exact type strings):**
  - `version.status_changed`
  - `version.created`
  - `tag.changed`
  - `metadata.changed`
  - `hierarchy.created`
- **SSE event payload shape:** JSON object with `type`, `at` (epoch-ms), plus event-specific fields listed in D-WEBUI-06.
- **SSE frame format:** `data: <json>\n\n`; keep-alive `: ping\n\n` every 30 seconds; no `event:` header line (type is in the payload).
- **New typed error codes:** `OUTPUT_UNAVAILABLE`.
- **Static mount path:** `app.use('/*', serveStatic({ root: './packages/dashboard/dist' }))` — mounted AFTER `/api/*` and `/mcp`. SPA fallback for unknown paths → `index.html`.
- **Fallback HTML body (when `dist/` missing):** minimal `<html><head><title>vfx-familiar</title></head><body><h1>Dashboard not built</h1><p>Run <code>npm run build:dashboard</code> from the repo root.</p></body></html>`
- **Theme persistence:** `localStorage["vfx-familiar:theme"]` = `"dark" | "light"`. Default `"dark"`.
- **Sidebar expansion persistence:** `localStorage["vfx-familiar:sidebar-expanded"]` = JSON array of entity IDs that are expanded.
- **Active generations panel:** sorts by `created_at ASC` (oldest first — so newer jobs push down, matching "queue" mental model). Toast on completion (green) or failure (red); auto-dismiss 5000ms.
- **Thumbnail skeleton placeholder:** `<div class="skeleton-thumb">` with a subtle shimmer keyframe; `<img onload={...}>` fades in over 200ms.
- **Drawer widths:** version-detail drawer 560px; diff drawer 720px (side-by-side needs width).
- **Version action set:** `Compare with v###` (diff) + `Reproduce` + copy-to-clipboard on each JSON block. No iterate, no tag writes, no metadata writes from the UI.
- **Output storage path:** `outputs/<version_id>/<original_filename>`.
- **Output `.gitignore`:** `outputs/` is ignored at the repo root.
- **Tool-budget assertion:** stays at **7 of 12** (`workspace`, `project`, `sequence`, `shot`, `generation`, `version`, `asset`). No change.
- **Architecture-purity new paths:** `src/http/*`, `src/engine/events.ts`, `src/engine/output-downloader.ts` — zero MCP imports.
- **Dev server port:** `5173` (Vite default). Added to `HTTP_ALLOWED_ORIGINS` in dev only.
- **Prod server port:** `3000` (unchanged from Phase 2). Dashboard served same-origin.
- **`HTTP_ALLOWED_ORIGINS` dev value (for local dev):** `http://localhost:5173,http://127.0.0.1:5173`.
- **Font loading:** `@fontsource/inter` + `@fontsource/inter-tight` as dependencies inside `packages/dashboard/` (NOT CDN). Loaded via CSS `@import` in `theme.css`.
- **Numeric formatting:** `font-variant-numeric: tabular-nums` applied to `.num, td.num, .version-label, .timestamp, .elapsed, .count-badge` — every numeric surface.
- **CI freshness step:** `- run: npm ci && npm run build:dashboard && git diff --exit-code packages/dashboard/dist`.

</specifics>

<deferred>
## Deferred Ideas

Surfaced during discussion. Not in Phase 5 scope — preserved so they aren't lost.

- **Iterate-from-UI** — in-dashboard editor for node-scoped overrides + seed shortcut. Significant UX investment (JSON-ish form with per-node field picker). Agents still drive iterate via MCP in Phase 5. Ship as Phase 5.x or a later iteration when demand appears.
- **Tag / metadata writes from UI** — add-tag chip with `+`, set-metadata form in the provenance drawer, inline remove buttons. Broadens scope materially (optimistic updates, error toasts, confirmation UX). Defer until the demo reveals it's needed.
- **ComfyUI node-by-node progress bar** — requires probing the ComfyUI Cloud progress endpoint (may not exist / may be flaky). Phase 5 shows status transitions + elapsed-time counter only. Layered upgrade when Cloud API grows.
- **Per-shot or per-job SSE endpoints** — single global stream only in Phase 5. If a screen shows thousands of shots and bandwidth becomes a concern, add scoped endpoints.
- **Last-Event-ID SSE replay buffer** — simple reconnect only in Phase 5. Replay buffer ships if we see actual event-loss bug reports.
- **Blurhash / LQIP on thumbnails** — skeleton placeholder only. Blurhash adds a dep + a compute step; nice polish, not required for demo.
- **Mobile / tablet layouts** — desktop-only. Mobile redesign is a full v1.x project.
- **Lineage graph visualization** — Phase 5 shows lineage as a badge + parent link only. Full graph (ADV-04) is a v2 feature.
- **FTS5 UI for searching tags / metadata values** — REST `POST /api/assets/query` is AND-only exact match (mirrors Phase 4). FTS5 + a "search" route ship when a real demand surfaces.
- **Keyboard-driven navigation** — cmd-k palette, j/k to navigate, enter to drill in. Demo polish; planner can add opportunistically but not required.
- **Output file retention policy / cleanup** — everything kept forever in `outputs/`. Disk usage becomes a concern after many thousand generations; cleanup + retention rules are a later phase.
- **Signed / expiring URLs for output images** — unauthenticated same-origin in Phase 5. If we ever bind 0.0.0.0 or reverse-proxy the server, this becomes required.
- **Multi-user / per-user auth** — single-artist scope. Out of scope project-wide (PROJECT.md Out of Scope).
- **Dashboard crash reporting / telemetry** — no error reporting service in Phase 5. Sentry or equivalent is a v1.x add.
- **prefers-color-scheme auto-switch** — user toggle only in Phase 5; auto-detect on first visit is a small enhancement.
- **Dashboard-side internationalization** — English only. i18n ships when we ship outside the demo audience.
- **Per-tab or multi-tab concurrency concerns** — two dashboards open against the same server: the SSE stream fan-outs independently (each tab has its own subscription). No cross-tab coordination in Phase 5.
- **Node-graph-inspired chrome** — NO attempt to mimic ComfyUI's node editor visuals in Phase 5. "ComfyUI-native" (D-WEBUI-15) means palette + typography + iconography, not the node-graph canvas.
- **Dashboard bundle size budget** — no formal budget in Phase 5; planner keeps it reasonable (target < 200KB gzipped). Budget enforcement is a v1.x add.
- **Active generations panel cancel action** — display-only in Phase 5 (no cancel button). Cancel requires an MCP `generation.cancel` action that doesn't exist yet.
- **Workflow authoring in dashboard** — explicit project-level Out of Scope (PROJECT.md). Users bring their own ComfyUI workflows.
- **E2E test harness (Playwright / browser mode)** — optional in Phase 5 (D-WEBUI-35 item 5); planner decides. If demo reliability becomes a concern, add one golden-path test.
- **Dashboard npm package publication** — repo itself is the distribution surface in Phase 5. Publishing to npm (D-WEBUI-09 option B) ships later if we want global install.
- **Structured logger (pino) on server side** — still `console.error`. Bump when surface area justifies.
- **TypedError → HTTP status code table as a shared helper** — inline mapping in the error middleware in Phase 5; extract into `src/engine/error-mapping.ts` if it grows.

</deferred>

---

*Phase: 05-web-dashboard*
*Context gathered: 2026-04-23 via /gsd-discuss-phase*
