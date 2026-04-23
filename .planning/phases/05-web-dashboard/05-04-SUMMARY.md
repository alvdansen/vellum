---
phase: 05-web-dashboard
plan: 04
subsystem: http-dashboard-routes
tags: [http, hono, rest, dashboard, output-streaming, typed-errors, D-WEBUI-01, D-WEBUI-05, D-WEBUI-26, D-WEBUI-33, T-5-04]
dependency_graph:
  requires:
    - phase-05 plan-02 complete (Engine.events + outputs downloaded to outputs/versionId/<filename>)
    - phase-05 plan-03 complete (typedErrorHandler + statusForCode in src/http/error-middleware.ts)
    - hono ^4.12.14 (already installed in root package.json)
  provides:
    - src/http/dashboard-routes.ts — createDashboardRouter(engine) with all 18 canonical REST routes
    - src/http/index.ts — public barrel for the HTTP layer (createDashboardRouter, typedErrorHandler, statusForCode, EngineForDashboard)
    - Engine.getDashboardHome() aggregate method — returns { active_versions, recent_versions, workspaces } for GET /api/dashboard/home
    - FakeEngine.getDashboardHome + cans.dashboardHome — test-time stub
    - EngineForDashboard — structural subset type that FakeEngine + real Engine both satisfy
  affects:
    - Plan 05-05 (SSE handler): same Engine surface + typedErrorHandler for pre-stream errors
    - Plan 05-06 (server.ts wiring): imports createDashboardRouter + typedErrorHandler from src/http/index.js and mounts them
    - Plan 05-07+ (dashboard components): REST endpoints are frozen — dashboard fetches from these exact URLs
tech_stack:
  added: []
  patterns:
    - "Structural-subset Engine typing — route module declares `EngineForDashboard = Pick<Engine, 'listWorkspaces' | ...>` so FakeEngine satisfies the surface without matching every Engine method. Fake stays minimal; real Engine still passes TypeScript at mount time."
    - "Real-file fs fixture for streaming routes — tests write actual bytes to outputs/<versionId>/<filename> (gitignored) in beforeEach and rm -rf in afterEach. Avoids vi.mock('node:fs') fragility with Readable.toWeb + c.body pipeline."
    - "Path-traversal defence-in-depth (T-5-04) — validate stored filename for `..`, `/`, `\\` BEFORE path.basename normalization. Basename alone would strip `../../etc/passwd` to `passwd` and silently fail via existsSync, but flagging the attack in the TypedError surfaces it in logs."
    - "Empty-body tolerance on POST — c.req.json() catch → default object so routes still accept `fetch(url, {method: 'POST'})` with no headers. Matches the typical browser fetch pattern."
    - "Numeric query-param parser with fallback — qNum(raw, fallback) returns fallback on undefined AND on NaN. One helper, zero branching in callers."
key_files:
  created:
    - src/http/dashboard-routes.ts (290 lines — 18 routes + EngineForDashboard type + MIME map + T-5-04 filename guard)
    - src/http/index.ts (22 lines — barrel re-export of createDashboardRouter / typedErrorHandler / statusForCode / EngineForDashboard)
    - src/http/__tests__/dashboard-routes.test.ts (624 lines — 35 route tests covering happy-path + TypedError + path-traversal + MIME mapping + deferred-route absence)
  modified:
    - src/engine/pipeline.ts (added getDashboardHome() method — uses listPendingVersions for active, empty recent_versions for demo scope, listWorkspaces for workspaces)
    - src/test-utils/fake-engine.ts (added cans.dashboardHome + getDashboardHome stub)
decisions:
  - "[Plan 05-04] EngineForDashboard as structural subset type — keeps the real Engine class free of a formal interface declaration while letting FakeEngine (with only dashboard-relevant methods plus events + calls) satisfy the route module's parameter. TypeScript widens the parameter to a Pick type, so server.ts can pass a full Engine without a cast. This is the same pattern as Phase 4 fixtures.ts buildStack — narrow types at boundaries, wide types at call sites."
  - "[Plan 05-04] Engine.getDashboardHome uses listPendingVersions for active_versions (already present from D-GEN-28 recovery poller) and returns empty recent_versions — the plan's <interfaces> block specified the method signature but NOT a listByStatus repo helper. Adding a new repo method was out of scope; SSE updates keep the home view live as versions complete. A later plan (or the dashboard component itself) can add a dedicated recent-completed query."
  - "[Plan 05-04] outputs_json shape correction — the plan's reference implementation treated outputs_json as `string[]` and did `parsed[0]` as the filename. But GenerationEngine.downloadAndPersist writes `[{filename, path, url, content_type, size_bytes}]` (confirmed in src/engine/generation.ts line 412). Implementation extracts `parsed[0].filename` and guards against the object being non-array or having no filename key. Rule 1 bug in the plan's action block, fixed inline."
  - "[Plan 05-04] Real tmp files for streaming test, not vi.mock('node:fs') — first attempt used vi.mock with a minimal Readable-shaped object; Hono's c.body → Readable.toWeb pipeline hit a 500 because the mock lacked the full async-iterator + destroy contract. Switched to writeFileSync under outputs/<versionId>/ (gitignored) with afterEach cleanup. Two positive streaming tests now pass (.png → image/png, .jpg → image/jpeg)."
  - "[Plan 05-04] Empty body tolerance for POST /api/versions/:id/reproduce — c.req.json() throws SyntaxError on empty body; wrapping in try/catch and defaulting to undefined notes lets `fetch(url, { method: 'POST' })` (no headers, no body) still return 201. Matches browser fetch conventions and is in line with D-WEBUI-05 (bare JSON shapes)."
  - "[Plan 05-04] GET /api/versions/:id/diff returns INVALID_INPUT (400) when `?against=` missing rather than 404 or 422 — diff is a read of two versions, and if only one is supplied the REQUEST itself is malformed. INVALID_INPUT from typedErrorHandler maps to 400, matching Plan 05-03's status mapping for bad request validation."
metrics:
  duration_minutes: 7
  task_count: 2
  file_count: 5
  commits: 3
  tests_added: 35
  tests_passing: 667
  tests_skipped: 2
  completed_date: "2026-04-23"
requirements-completed: [WEBUI-01, WEBUI-02]
---

# Phase 5 Plan 4: Dashboard REST Routes + HTTP Barrel Export Summary

**18 canonical dashboard REST routes wired to the Engine facade as a Hono sub-router — hierarchy reads, version reads, provenance, diff, reproduce, asset filters, and dashboard aggregate; output streaming validates filenames against path traversal (T-5-04) before fs.createReadStream.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-23T12:38:46-07:00
- **Completed:** 2026-04-23T12:45:32-07:00
- **Tasks:** 2 (Task 1 TDD RED → GREEN; Task 2 barrel add)
- **Files created:** 3
- **Files modified:** 2

## Accomplishments

- **18 REST routes** live in `src/http/dashboard-routes.ts` via `createDashboardRouter(engine)`. Exact route map matches the plan's `<interfaces>` block verbatim: `/api/workspaces*`, `/api/projects*`, `/api/sequences*`, `/api/shots*`, `/api/versions*`, `/api/assets/{query,list_tags,list_metadata_keys}`, `/api/dashboard/home`. ZERO deferred tag CRUD routes (plan explicitly ruled out).
- **Output streaming route** (`GET /api/versions/:id/output`) streams from `outputs/<versionId>/<filename>` via `fs.createReadStream → Readable.toWeb → c.body`. MIME mapped from file extension (png, jpg, jpeg, webp, gif, mp4, webm → else octet-stream). T-5-04 mitigation: filename validated for `..`, `/`, `\\` BEFORE `path.basename()` normalization; `existsSync` guards against missing file → `OUTPUT_UNAVAILABLE` (404).
- **Engine aggregate method** `getDashboardHome()` added to pipeline.ts — returns `{ active_versions, recent_versions, workspaces }` using `listPendingVersions` + `listWorkspaces` (both existed). `recent_versions` intentionally empty for Phase 5 demo scope; SSE updates the home view as versions complete.
- **`EngineForDashboard` structural subset type** — route module declares a Pick-type over Engine's 17 dashboard-relevant methods. FakeEngine satisfies this surface without implementing every Engine method. Real Engine still passes TypeScript at mount time.
- **Public barrel** `src/http/index.ts` re-exports `createDashboardRouter`, `EngineForDashboard`, `typedErrorHandler`, `statusForCode`. Plan 05-06 (server.ts) imports from here, not from individual files.
- **35 new tests** covering every route group, TypedError propagation (WORKSPACE/PROJECT/SHOT/VERSION `*_NOT_FOUND` + `INVALID_INPUT` for missing `?against=`), T-5-04 path-traversal rejection, empty-outputs_json handling, missing-file-on-disk handling, MIME mapping for .png + .jpg, and explicit absence of deferred tag CRUD routes. Full suite: **667 passed | 2 skipped** (up from 608 baseline = +59 new tests net).

## Task Commits

1. **Task 1 RED** — `6a6694c` `test(05-04): add failing tests for createDashboardRouter (RED)`
2. **Task 1 GREEN** — `29a49dd` `feat(05-04): implement createDashboardRouter + all 18 REST routes (GREEN)`
3. **Task 2** — `984c77e` `feat(05-04): add src/http/index.ts barrel export`

_Task 1 followed RED → GREEN; no REFACTOR needed. Task 2 was a single 22-line barrel file + one 3-line docstring polish to dashboard-routes.ts (avoid substring-grep false positive on MCP SDK sentinel per Plan 04-03 convention)._

## Files Created / Modified

### Created

- `src/http/dashboard-routes.ts` (290 lines) — `createDashboardRouter(engine)`; 18 route handlers; `MIME_MAP`; `qNum` helper; `EngineForDashboard` structural subset type; T-5-04 filename guard + `path.basename` normalization; `Readable.toWeb` streaming with `Cache-Control: public, max-age=3600, immutable`.
- `src/http/index.ts` (22 lines) — re-exports `createDashboardRouter`, `EngineForDashboard` (type), `typedErrorHandler`, `statusForCode`.
- `src/http/__tests__/dashboard-routes.test.ts` (624 lines) — 35 tests across workspaces/projects/sequences/shots/versions/versions-output/reproduce/assets/dashboard-home/deferred-tag-absence.

### Modified

- `src/engine/pipeline.ts` — added `getDashboardHome()` method at end of class (lines 650-684). Uses existing `this.versionRepo.listPendingVersions()` for active, empty recent, `this.repo.listWorkspaces(50, 0)` for workspaces.
- `src/test-utils/fake-engine.ts` — added `cans.dashboardHome` default + `getDashboardHome()` method; `reset()` resets the can. Zero runtime change for existing tests.

## Decisions Made

- **EngineForDashboard as Pick-type over Engine.** Declaring a formal interface on Engine would force every test harness that builds an Engine to implement the full surface. Pick lets FakeEngine stay minimal (17 methods) while server.ts passes a full Engine without a cast. Same pattern as Phase 4 fixtures.ts buildStack — narrow at the boundary, wide at the call site.
- **outputs_json shape: object array, not string array.** The plan's reference implementation cast `JSON.parse(outputs_json) as string[]`. Real writes (src/engine/generation.ts line 412) store `[{filename, path, url, content_type, size_bytes}]`. Implementation extracts `parsed[0].filename` and guards against the object being non-array or having no filename key. Bug in plan action block, fixed inline (Rule 1 auto-fix).
- **Real tmp files for streaming tests.** First attempt: `vi.mock('node:fs')` with a minimal Readable-shaped object. Hono's `c.body(webStream)` pipeline hit a 500 because the mock lacked the full async-iterator + `destroy` contract. Switched to `writeFileSync('outputs/<versionId>/<filename>', ...)` with `afterEach` cleanup. `outputs/` is already gitignored (D-WEBUI-26); no pollution. Two positive streaming tests now pass.
- **Empty body tolerance on POST /api/versions/:id/reproduce.** `c.req.json()` throws SyntaxError on empty body. Wrapping in try/catch + defaulting `notes = undefined` lets `fetch(url, { method: 'POST' })` (no headers, no body) still return 201. Consistent with D-WEBUI-05 (bare JSON shapes) and the typical browser fetch pattern when a body is optional.
- **Diff route INVALID_INPUT for missing `?against=`.** Diff is a two-version read; one ID alone is a malformed request, not "not found". Throwing `TypedError('INVALID_INPUT', ...)` maps to 400 via typedErrorHandler (Plan 05-03 mapping) — semantically correct and consistent with the rest of the surface.
- **Engine.getDashboardHome leans on existing methods.** listPendingVersions (D-GEN-28 recovery) already returns the submitted+running subset; recent_versions stays empty for Phase 5 demo scope and SSE keeps the home view live. Adding a dedicated listByStatus repo helper was out of scope for this plan; honest empty array + comment beats a stub with fake data.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's outputs_json parse shape was wrong**

- **Found during:** Task 1 GREEN — writing the output route action block
- **Issue:** The plan's `<action>` block parses `outputs_json` as `string[]` and treats `parsed[0]` as the filename directly. But src/engine/generation.ts line 412 writes objects with `{filename, path, url, content_type, size_bytes}`. Would have silently failed at runtime (parsed[0] would be `{filename: ...}`, not a string, and `path.extname(obj)` would blow up).
- **Fix:** Cast to `Array<{ filename?: string }>`, extract `parsed[0]?.filename`, validate that it's a non-empty string. Plan 02-SUMMARY.md line 369 had the correct shape; the plan's action block was out of sync with the real writer.
- **Files modified:** `src/http/dashboard-routes.ts`
- **Verification:** Both streaming tests (ver_png_stream .png → image/png, ver_jpg_stream .jpg → image/jpeg) pass; empty-outputs_json test and missing-file test both correctly return 404 OUTPUT_UNAVAILABLE.
- **Committed in:** `29a49dd` (Task 1 GREEN)

**2. [Rule 3 - Blocking] vi.mock('node:fs') did not satisfy Readable.toWeb contract**

- **Found during:** Task 1 GREEN — first full test run, 34/35 tests pass; streaming test returns 500 instead of 200.
- **Investigation:** Minimal mock stream had Symbol.asyncIterator returning done=true but lacked the full Readable contract (proper `_read`, `destroy` event chain, `close` event). `Readable.toWeb(mockStream)` threw at `c.body(webStream)` serialization, typedErrorHandler caught it and returned 500.
- **Fix:** Replaced the vi.mock with a `writeTestOutput(versionId, filename)` helper that creates real files under `outputs/<versionId>/<filename>` before the request and removes the entire `outputs/<versionId>/` subdir in afterEach. `outputs/` is already in .gitignore per D-WEBUI-26, so no worktree pollution. Two positive streaming tests added (MIME mapping for .png and .jpg).
- **Files modified:** `src/http/__tests__/dashboard-routes.test.ts`
- **Verification:** All 35 tests pass; full suite 667/669 green; afterEach reliably removes test files (no leftover in outputs/ after the run).
- **Committed in:** `29a49dd` (Task 1 GREEN — bundled with the implementation since the test was never green pre-fix)

**3. [Rule 3 - Blocking] Missing Engine.getDashboardHome method**

- **Found during:** Task 1 RED — writing the /api/dashboard/home test
- **Issue:** The plan's `<action>` block calls `engine.getDashboardHome()` but neither the real Engine nor the FakeEngine had this method. Would have been `TypeError: engine.getDashboardHome is not a function` at runtime.
- **Fix:** Added `getDashboardHome()` to `src/engine/pipeline.ts` (uses existing `listPendingVersions` + `listWorkspaces`, empty recent_versions for Phase 5 demo scope) and matching stub in `src/test-utils/fake-engine.ts` (`cans.dashboardHome` default + `getDashboardHome()` method that records the call and returns the can). The plan explicitly noted: "If `engine.getDashboardHome()` does not yet exist on the Engine class, the executor must add it..." — so this is a planned deviation.
- **Files modified:** `src/engine/pipeline.ts`, `src/test-utils/fake-engine.ts`
- **Verification:** `GET /api/dashboard/home` test returns 200 with `{ active_versions, recent_versions, workspaces }` shape; engine.calls records `{ method: 'getDashboardHome', args: [] }`.
- **Committed in:** `29a49dd` (Task 1 GREEN)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 bug in plan, 2 Rule 3 blocking gaps).
**Impact on plan:** All three auto-fixes were necessary to pass the plan's own verification tests. The plan explicitly anticipated fix #3 (getDashboardHome). Fix #1 (outputs_json shape) and fix #2 (real-file streaming test) were not anticipated but do not change the plan's scope — they correct the reference implementation against the real system behaviour.

## Issues Encountered

- **None beyond the 3 auto-fixes above.** TypeScript was clean (zero errors) on first compilation. Architecture-purity tests still green (they scope to src/engine/, src/store/, src/utils/, src/types/, src/comfyui/ — not src/http/, so the sentinel phrasing in error-middleware.ts inherited from Plan 03 doesn't trip them). Full suite regression guard: 667 passed | 2 skipped (2 pre-existing live-smoke skips from Phase 3).

## Auth Gates

None. This plan ships pure HTTP-layer wiring with zero new external API calls.

## Known Stubs

- **Engine.getDashboardHome.recent_versions is intentionally `[]` for Phase 5 demo scope.** Documented in the method's JSDoc comment. SSE (`version.status_changed` on completion) updates the dashboard home view as versions complete. A future plan (or direct dashboard-side query via GET /api/shots/:id/versions filtered by status) can fill this if needed. NOT a plan-blocking stub — WEBUI-01 goal is hierarchy browsing (satisfied by workspaces + listWorkspaces/Projects/Sequences/Shots) and WEBUI-02 goal is live status (satisfied by active_versions from listPendingVersions).

## Threat Flags

No new threat surface beyond what's documented in the plan's `<threat_model>`. All three threats hold:

- **T-5-04 (Tampering / Info Disclosure on GET /api/versions/:id/output):** Mitigated. Filename check rejects `..`, `/`, `\\` BEFORE `path.basename()` normalization; verified by `rejects path-traversal filenames with INVALID_INPUT (400)` test.
- **T-5-05 (Elevation of Privilege):** Accepted per D-WEBUI-32. No auth on dashboard endpoints; VFX Familiar is local-first (127.0.0.1 bind by default, Plan 05-06 enforces the bind).
- **T-5-01 (Spoofing via missing CORS):** Transferred to Plan 05-06 at server mount time. Routes inherit whatever CORS the parent app applies.

## Verification Evidence

- `npx vitest run src/http/__tests__/dashboard-routes.test.ts src/http/__tests__/error-middleware.test.ts` — **66 passed** (35 dashboard + 31 error-middleware).
- `npx vitest run` (full root) — **667 passed | 2 skipped** (up from 608 baseline; +59 new/net tests across this plan).
- `npx tsc --noEmit` — zero errors.
- `grep -c "^\s*app\.\(get\|post\)" src/http/dashboard-routes.ts` — **18** (exactly 18 routes).
- `grep -E "GET /api/tags|PATCH /api/tags|DELETE /api/tags" src/http/dashboard-routes.ts` — zero matches (deferred routes not wired).
- `grep "^import" src/http/dashboard-routes.ts` — only hono + node:fs + node:stream + node:path + engine/pipeline + engine/errors. Zero MCP SDK, zero better-sqlite3, zero drizzle-orm imports.
- `grep "^import" src/http/index.ts` — re-exports only; no direct package imports.
- `src/__tests__/architecture-purity.test.ts` — 10/10 green (src/http/ not yet in the grep set; Plan 05-05+ can extend if needed).

## Plan 05-05 / Plan 05-06 Handoff Notes

**Plan 05-05 (SSE handler)** — the SSE module at `src/http/sse.ts` will live next to `dashboard-routes.ts` and share the same error surface. Pattern:

```typescript
import { createSseHandler } from './sse.js';
const app = new Hono();
app.onError(typedErrorHandler);
app.route('/', createDashboardRouter(engine));
app.get('/api/events', createSseHandler(engine, httpAllowedOrigins));
```

**Plan 05-06 (server.ts mount)** — import from the barrel:

```typescript
import { createDashboardRouter, typedErrorHandler } from './http/index.js';
```

Mount order per D-WEBUI-12: `/mcp` first → `app.onError(typedErrorHandler)` → `createDashboardRouter(engine)` + SSE → static catch-all last. Routes inherit the CORS middleware applied at the server root.

**For dashboard client code (Phase 05-07+)** — the 18 REST URLs are now frozen. The client fetches directly:

```typescript
const ws = await fetch('/api/workspaces').then(r => r.json());
const home = await fetch('/api/dashboard/home').then(r => r.json());
```

No URL versioning (no `/v1`); all contracts are bare-domain shapes per D-WEBUI-05.

## Self-Check: PASSED

All created files verified on disk:

- `src/http/dashboard-routes.ts` — FOUND (290 lines)
- `src/http/index.ts` — FOUND (22 lines)
- `src/http/__tests__/dashboard-routes.test.ts` — FOUND (624 lines)

All modified files verified:

- `src/engine/pipeline.ts` — modified (getDashboardHome added at line 662)
- `src/test-utils/fake-engine.ts` — modified (cans.dashboardHome + getDashboardHome method added)

All commits verified in git log:

- `6a6694c` — FOUND (Task 1 RED)
- `29a49dd` — FOUND (Task 1 GREEN)
- `984c77e` — FOUND (Task 2 barrel)

---

*Phase: 05-web-dashboard*
*Plan: 04*
*Completed: 2026-04-23*
