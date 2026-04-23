---
phase: 05-web-dashboard
verified: 2026-04-23T22:45:00Z
re_verification_of: 2026-04-23T21:37:50Z
status: verified
score: 5/5 must-haves verified
overrides_applied: 0
gaps: []
deferred:
  - id: WR-04
    summary: "pipeline.ts:676 getDashboardHome hardcodes recent_versions: []; dashboard home consumer sees perpetually-empty list. User explicitly deferred in 05-CONTEXT.md — does not block any SC."
  - id: WR-01
    summary: "dashboard-routes.ts:227 uses hardcoded 'outputs' path; ignores configurable engine outputRoot. User deferred — does not block any SC at default config."
  - id: WR-05
    summary: "dashboard lib/api.ts fetchJson discards typed error bodies. User deferred — UX regression but does not block any SC."
  - id: IN-01
    summary: "qNum query-param parser accepts negatives and non-integer floats. User deferred — SQLite clamps, robustness only."
  - id: IN-02
    summary: "sse.ts `: ping` keep-alive frame is not an SSE comment on the wire (becomes `data: : ping`). User deferred — documentation-level inaccuracy."
  - id: IN-04
    summary: "lib/shape.ts normalizeStatus silently maps unknown values to 'queued'. User deferred — intentional fallback; does not interact with CR-01 fix because the adapter emits union-valid values."
---

# Phase 5: Web Dashboard Verification Report (Re-verification)

**Phase Goal:** A non-technical viewer (or the demo audience) can open a browser and see the project hierarchy, version history with provenance details, and live generation progress — no CLI required.

**Verified:** 2026-04-23T22:45:00Z
**Re-verification of:** 2026-04-23T21:37:50Z (prior run flagged CR-01 blocker; Plan 05-13 closed it)
**Status:** verified

## Re-verification Note

The prior verification (2026-04-23T21:37:50Z) flagged ONE blocker gap (CR-01 — SSE wire-shape drift) and marked SC-3 / WEBUI-03 as ✗ FAILED. The other four roadmap success criteria were verified green with live HTTP evidence.

Plan 05-13 (gap closure) committed five changes on main since the prior verification:

- `c09bf9a` feat(05-13): add toDashboardPayload wire-shape adapter at SSE boundary
- `b868a51` test(05-13): unit tests for toDashboardPayload adapter (18 assertions)
- `b8725a3` test(05-13): end-to-end SSE seam test — real engine to dashboard writer (9 assertions)
- `d3f7d38` test(05-13): CR-01 regression guard in architecture-purity suite (4 assertions)
- `055c094` docs(05-13): complete summary — SSE wire-shape adapter (CR-01 closed)

This re-verification confirms (a) the adapter exists at the code level with the locked translation rules, (b) the seam test that Plan 05-11 SUMMARY admitted was missing is now in place piping a real `createEngineEmitter` through the real `createSseHandler` into an inline reproduction of the dashboard writer, (c) the four previously-verified SCs have not regressed, and (d) server test count grew from 687 → 718 with zero regressions.

## Goal Achievement

### Observable Truths

| # | Truth | Prior Status | Current Status | Evidence |
|---|-------|--------------|----------------|----------|
| 1 | Opening the server URL shows a project hierarchy browsable from workspace down to shot | ✓ VERIFIED | ✓ VERIFIED | Unchanged. `GET /` still serves real pre-built index.html (977B) with hashed asset refs. `HomeView.tsx` renders `TreeSidebar` with lazy hydration via the REST routes; no files in Plan 05-13 touched the hierarchy surface. |
| 2 | Clicking a shot shows version timeline with drill-down into provenance for any version | ✓ VERIFIED | ✓ VERIFIED | Unchanged. `VersionDrawer.tsx` still renders Timeline + provenance + View Diff; no files in Plan 05-13 touched the version-detail surface. |
| 3 | Active generations show live progress updates via SSE without manual refresh | ✗ FAILED (CR-01) | ✓ VERIFIED | **Gap closed.** `src/http/sse.ts:93` exports `toDashboardPayload(type, payload)` with exhaustive `never`-default arm at line 135. The SSE listener at lines 184-186 now calls `JSON.stringify(toDashboardPayload(type, payload as EngineEventMap[typeof type]))` — raw `JSON.stringify(payload)` is gone from every executable line (only surviving references are inside `//` comments at lines 31, 66, 180 documenting the boundary). Translation rules match the dashboard type contract at `packages/dashboard/src/types/events.ts`: version.created → {versionId, shotId, label (from breadcrumb last segment)}; version.status_changed → {versionId, status} with submitted→queued and completed→complete; hierarchy.created → {entityType, entityId, parentId (null coerced to undefined)}; tag.changed → {tagId (from tag string), action} with add→created and remove→deleted; metadata.changed → {entityId, key} (T-5-02 preserved: no `value`). End-to-end seam test at `src/http/__tests__/sse-e2e.test.ts` pipes a real `createEngineEmitter` through the real `createSseHandler` via `app.request('/api/events')`, parses the SSE frames, and feeds them to an inline reproduction of the dashboard writer — 9 tests including the required-named `'version.created SSE frame populates dashboard ActiveGeneration row with label'`. Architecture-purity regression guard at `src/__tests__/architecture-purity.test.ts` forbids reintroduction of raw `JSON.stringify(payload)` on executable lines. |
| 4 | Dashboard is served as pre-built static bundle from the same Hono server process — no separate dev server | ✓ VERIFIED | ✓ VERIFIED | Unchanged. `src/server.ts:323` still mounts `createStaticHandler()` on the Hono app shared with `/mcp` + `/api/*` + `/api/events`; Plan 05-13 touched none of these. |
| 5 | Viewer can see dashboard immediately after server start with no build step required | ✓ VERIFIED | ✓ VERIFIED | Unchanged. `packages/dashboard/dist/` still committed to git; CI dist-freshness gate still enforced. Plan 05-13 did not modify dashboard sources and therefore did not change the dist bundle. |

**Score:** 5/5 truths verified (was 4/5; SC-3 now green after CR-01 closure).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server.ts` | Hono app mounts MCP + SSE + REST + static in load-bearing order | ✓ VERIFIED | Unchanged from prior verification. |
| `src/http/dashboard-routes.ts` | 18 REST routes | ✓ VERIFIED | Unchanged. |
| `src/http/sse.ts` | GET /api/events with 5 typed event subscriptions + 30s keep-alive + origin allowlist + listener cleanup **+ wire-shape adapter** | ✓ VERIFIED (was ⚠️ WIRED BUT HOLLOW) | 238 lines (was 131). `toDashboardPayload` exported at line 93 with exhaustive switch over `EngineEventMap` + `never`-default arm. Listener at 184-186 routes through the adapter before `JSON.stringify`. Header docstring (lines 24-33) documents the wire-shape boundary contract. |
| `src/http/sse.ts` adapter exhaustiveness | Compile-time enforcement — adding a new key to EngineEventMap fails `tsc --noEmit` | ✓ VERIFIED | `const _exhaustive: never = type` at line 135 + runtime throw. |
| `src/http/__tests__/sse-adapter.test.ts` | Unit tests isolating the adapter | ✓ VERIFIED (NEW) | 252 lines; 6 describe blocks covering all 5 event types + exhaustiveness; 18 `it` assertions. |
| `src/http/__tests__/sse-e2e.test.ts` | End-to-end seam test pipeline real emitter → real handler → real fetch → dashboard writer reproduction | ✓ VERIFIED (NEW) | 379 lines. Imports `createEngineEmitter` and `createSseHandler` from real source. Contains the required-named test. Zero imports from `packages/dashboard/src/**` (architecture-purity preserved). 9 `it` assertions including the `it.each` covering all 4 status transitions submitted→queued, running→running, completed→complete, failed→failed. |
| `src/__tests__/architecture-purity.test.ts` | CR-01 regression guard | ✓ VERIFIED (EXTENDED) | New describe block: "SSE wire-shape adapter is the only serialization path (CR-01)" with 4 assertions. Strips `//` line comments before matching to tolerate documentation references. 18 total architecture-purity tests (was 14). |
| `src/http/static.ts` | Serves `packages/dashboard/dist/` with SPA fallback | ✓ VERIFIED | Unchanged. |
| `packages/dashboard/dist/` | Pre-built entry point + hashed assets committed to git | ✓ VERIFIED | Unchanged. |
| `packages/dashboard/src/App.tsx` | Root component wiring SSE → signals on mount | ✓ VERIFIED | Unchanged. The dashboard-side dispatch was correctly implemented all along; the CR-01 fix lives on the server side of the boundary. |
| `packages/dashboard/src/views/HomeView.tsx` | Two-pane layout | ✓ VERIFIED | Unchanged. |
| `packages/dashboard/src/views/VersionDrawer.tsx` | Timeline + provenance + View Diff | ✓ VERIFIED | Unchanged. |
| `packages/dashboard/src/views/ActiveGenerationsPanel.tsx` | Panel filtered to queued/running | ✓ VERIFIED (was ⚠️ WIRED BUT HOLLOW) | Code unchanged, but the panel now receives properly-populated rows because the adapter maps server `'submitted'` → dashboard `'queued'` before the signal store ever sees the status string. |
| `packages/dashboard/src/state/active-generations.ts` | Signal-backed store, onVersionCreated/onVersionStatusChanged | ✓ VERIFIED (was ⚠️ WIRED BUT HOLLOW) | Code unchanged. The contract the writer reads against now matches the wire shape produced by the server because the adapter closes the snake_case→camelCase + status-enum translation at the serialization boundary. |
| `src/engine/pipeline.ts :: getDashboardHome` | Returns {active_versions, recent_versions, workspaces} | ⚠️ PARTIAL | Unchanged. `recent_versions` still hardcoded `[]` at line 676 (WR-04, deferred by user). Does not block any SC. |

### Key Link Verification

| From | To | Status (Prior → Current) | Details |
|------|-----|--------------------------|---------|
| `server.ts` `--http` boot | Hono app mounts | ✓ WIRED → ✓ WIRED | Unchanged. |
| `createSseHandler` | `engine.events.onEvent(type, listener)` | ✓ WIRED → ✓ WIRED | Unchanged. |
| `engine.events.emitEvent(type, payload)` | SSE stream `writeSSE` | ⚠️ PARTIAL → ✓ WIRED | Adapter now translates at the serialization boundary. `sse-e2e.test.ts` proves the full path end-to-end. |
| `EventSource('/api/events')` (dashboard) | `onSseEvent(type, fn)` dispatch | ✓ WIRED → ✓ WIRED | Unchanged. |
| `onSseEvent('version.created', onVersionCreated)` | `activeGenerations.value` append | ✗ NOT_WIRED → ✓ WIRED | Row now lands with populated `versionId`, `shotId`, `label` — confirmed by `sse-e2e.test.ts::'version.created SSE frame populates dashboard ActiveGeneration row with label'`. |
| `onSseEvent('version.status_changed', onVersionStatusChanged)` | mutate `activeGenerations` row | ✗ NOT_WIRED → ✓ WIRED | Adapter maps all 4 server statuses to dashboard-union-valid values; all 4 transitions asserted via `it.each` in `sse-e2e.test.ts`. |
| `VersionDrawer.handleViewDiff` | `diffVersion` → `GET /api/versions/:id/diff` | ✓ WIRED → ✓ WIRED | Unchanged. |
| `GET /api/dashboard/home` | `engine.getDashboardHome()` | ⚠️ PARTIAL → ⚠️ PARTIAL | Unchanged. WR-04 deferred. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Produces Real Data? | Status (Prior → Current) |
|----------|---------------|---------------------|--------------------------|
| `HomeView.tsx` | `workspaces` signal | Yes — real DB rows | ✓ FLOWING → ✓ FLOWING |
| `HomeView.tsx` | `versions` signal | Yes — real DB rows | ✓ FLOWING → ✓ FLOWING |
| `VersionDrawer.tsx` | `provenance` state | Yes — ProvenanceRepo query | ✓ FLOWING → ✓ FLOWING |
| `ActiveGenerationsPanel.tsx` | `activeGenerations.value` | **Yes** — real SSE frames arrive in the dashboard contract shape after adapter translation | ✗ DISCONNECTED → ✓ FLOWING |
| `dashboard-routes.ts /api/dashboard/home` | `recent_versions` | No — hardcoded `[]` (WR-04, deferred) | ⚠️ STATIC → ⚠️ STATIC |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly across all source | `npx tsc --noEmit` | 0 errors | ✓ PASS |
| Server test suite passes | `npx vitest run` | 718 passed, 2 skipped (46 files) — up from 687 (31 new tests, 0 regressions) | ✓ PASS |
| Dashboard test suite passes | `npm run test:dashboard` | 29 passed (5 files) — unchanged | ✓ PASS |
| SSE wire-shape adapter exists + wired | `grep -n "toDashboardPayload\|_exhaustive" src/http/sse.ts` | Definition at line 93; exhaustiveness arm at 135; call site at 184-186 | ✓ PASS |
| No raw `JSON.stringify(payload)` on executable lines | `grep -nE "JSON\.stringify\(payload\)" src/http/sse.ts` | 1 match at line 31 — inside `//` comment documenting the guard; architecture-purity test strips comments before matching | ✓ PASS |
| E2E seam test exercises real engine → real handler → real fetch | `grep -c "createEngineEmitter\|createSseHandler" src/http/__tests__/sse-e2e.test.ts` | 5 matches | ✓ PASS |
| E2E test does not cross architecture-purity boundary | `grep -c "from.*packages/dashboard" src/http/__tests__/sse-e2e.test.ts` | 0 matches | ✓ PASS |
| Required-named test present | `grep -c "version.created SSE frame populates dashboard ActiveGeneration row with label" src/http/__tests__/sse-e2e.test.ts` | 1 match | ✓ PASS |
| Live-smoke re-verification recipe for /gsd-verify-phase | Embedded as in-file comment in `src/__tests__/architecture-purity.test.ts` at the bottom of the CR-01 describe block | Available | ✓ DOCUMENTED (optional execution — automated regression gate already in place) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Prior Status | Current Status | Evidence |
|-------------|----------------|-------------|--------------|----------------|----------|
| WEBUI-01 | 05-01, 05-03, 05-04, 05-08, 05-10, 05-11 | Light web dashboard shows project hierarchy browser | ✓ SATISFIED | ✓ SATISFIED | Unchanged. |
| WEBUI-02 | 05-03, 05-04, 05-09, 05-10 | Dashboard shows version timeline with provenance detail | ✓ SATISFIED | ✓ SATISFIED | Unchanged. |
| WEBUI-03 | 05-02, 05-03, 05-05, 05-08, 05-10, 05-11, **05-13** | Dashboard shows live generation status via SSE | ✗ BLOCKED | ✓ SATISFIED | Plan 05-13 adapter + seam test close the loop. Real engine emissions now populate `activeGenerations` rows with union-valid statuses. |
| WEBUI-04 | 05-01, 05-06, 05-07, 05-12 | Dashboard served as static build from the same Hono server | ✓ SATISFIED | ✓ SATISFIED | Unchanged. |
| WEBUI-05 | 05-01, 05-06, 05-12 | No separate build step required (pre-built in dist) | ✓ SATISFIED | ✓ SATISFIED | Unchanged. |

**Plan-to-requirement mapping is complete.** All 5 WEBUI requirements satisfied. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Status |
|------|------|---------|----------|--------|
| `src/http/sse.ts` | 77-81 (prior) | `writeSSE({ data: JSON.stringify(payload) })` — forwards raw engine payload | 🛑 Blocker (CR-01) | **RESOLVED** in Plan 05-13. Now routes through `toDashboardPayload` at lines 184-186. Architecture-purity regression guard forbids reintroduction. |
| `src/engine/pipeline.ts` | 676 | `const recent: Version[] = [];` — hardcoded empty | ⚠️ Warning (WR-04) | **DEFERRED** by user. Does not block any SC. |
| `src/http/dashboard-routes.ts` | 227 | Hardcoded `'outputs'` path | ⚠️ Warning (WR-01) | **DEFERRED** by user. |
| `packages/dashboard/src/lib/api.ts` | 24-30 | `fetchJson` discards error body | ⚠️ Warning (WR-05) | **DEFERRED** by user. |
| `packages/dashboard/src/lib/shape.ts` | 39-44 | `normalizeStatus` silently maps unknown → 'queued' | ℹ️ Info (IN-04) | **DEFERRED** by user. No longer interacts with CR-01 because the adapter emits union-valid values before `normalizeStatus` ever runs. |
| `src/http/sse.ts` | 207 (prior 96-98) | `: ping` keep-alive comment is not an SSE comment on the wire | ℹ️ Info (IN-02) | **DEFERRED** by user. Documentation-level inaccuracy; keeps TCP warm as intended. |
| `src/server.ts` | 292-323 | REST routes lack origin allowlist | ℹ️ Info (WR-02) | **DEFERRED** (not flagged by user for Plan 05-13; same-origin policy protects browser reads). |
| `src/http/sse.ts` | N/A | Payload envelope has no runtime validation/scrubbing | ℹ️ Info (WR-03) | **PARTIALLY MITIGATED** by the new adapter: any unhandled event type fails at compile time (`tsc --noEmit` via `_exhaustive: never`) AND throws at runtime if the compile guard is bypassed. Deeper field-level validation remains out of scope. |
| `src/http/dashboard-routes.ts` | 88-92 | `qNum` accepts negatives and non-integer floats | ℹ️ Info (IN-01) | **DEFERRED** by user. |

### Deferred Items

All deferred items are listed in the frontmatter `deferred:` block. User explicitly scoped them out of Plan 05-13 in `05-CONTEXT.md`. None block any Phase 5 roadmap success criterion.

### Gaps Summary

**Zero gaps.** CR-01 — the SSE wire-shape drift between server and dashboard that previously blocked SC-3 / WEBUI-03 — is closed. The fix is a pure-function adapter at the HTTP serialization boundary with exhaustive compile-time + runtime coverage, backed by unit tests for the adapter itself, a regression guard at the architecture-purity layer, and the end-to-end seam test that Plan 05-11 SUMMARY explicitly flagged as missing. All five roadmap success criteria for Phase 05 are now verified green.

Phase 05 is ready for milestone audit / completion.

---

_Verified: 2026-04-23T22:45:00Z_
_Re-verification of: 2026-04-23T21:37:50Z_
_Verifier: Claude Opus 4.7 (inline, after gsd-verifier agent timeout)_
