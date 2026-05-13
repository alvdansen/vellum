---
phase: 21
slug: shot-grid-view
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-13
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Distilled from `21-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^4.1.4` (server) / `vitest@^4.1.5` (dashboard) |
| **Config file** | server: `vitest.config.ts` / dashboard: `packages/dashboard/vite.config.ts` |
| **Quick run command** | `npx vitest run <path>` (single file) |
| **Full suite command** | `npx vitest run` (project root) |
| **Estimated runtime** | ~15-25 seconds (Phase 21 scope) / ~60-90 seconds (full suite) |
| **Server test base** | `src/test-utils/fixtures.ts` `makeInMemoryDb` (in-memory SQLite + WAL + migrations 0001-0008 applied) |
| **Dashboard test base** | `@testing-library/preact` + `jsdom` |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <file-the-task-edited-or-created>`
- **After every plan wave:** Run Phase 21 scope: `npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts src/http/__tests__/dashboard-routes-shot-grid.test.ts packages/dashboard/src/__tests__ packages/dashboard/src/components/__tests__ packages/dashboard/src/views/__tests__ packages/dashboard/src/state/__tests__`
- **Before `/gsd-verify-work`:** Full suite green (`npx vitest run`); tool-budget test asserts === 7 unchanged; architecture-purity test unchanged
- **Max feedback latency:** 25 seconds

---

## Per-Task Verification Map

| Req ID | Wave | Behavior | Test Type | Automated Command | File Exists |
|--------|------|----------|-----------|-------------------|-------------|
| (CROSS) | W1 | `ShotStatusChangedPayload` added to `types/events.ts` + `EngineEventMap` entry typed correctly | type-check + smoke | `npx tsc --noEmit` + `npx vitest run packages/dashboard/src/state/__tests__/shot-grid.test.ts` | ❌ W0 |
| GRID-02 | W1 | 5 new `--color-shot-status-*` tokens added to both `@theme` and `[data-theme="light"]` blocks of `theme.css` | source assertion | `grep -c '\-\-color-shot-status-' packages/dashboard/src/styles/theme.css` returns ≥ 10 | ❌ W0 |
| GRID-04 | W1 | `listShotsForGrid` query is single-pass — `EXPLAIN QUERY PLAN` has NO `CORRELATED SCALAR SUBQUERY` row for the latest-version (ranked) join | unit (SQL) | `npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts` | ❌ W0 |
| GRID-04 | W1 | `listShotsForGrid` returns each shot with its current `status` (default `'wip'` null-coalesced) | unit | (same file) | ❌ W0 |
| GRID-04 | W1 | `listShotsForGrid` populates `latest_completed_version` from the latest `status='completed'` version per shot | unit | (same file) | ❌ W0 |
| GRID-04 | W1 | `listShotsForGrid` returns `latest_completed_version: null` for shots with zero completed versions | unit | (same file) | ❌ W0 |
| GRID-04 | W1 | `listShotsForGrid` uses `COUNT(*)` over `versions WHERE shot_id` for `version_count` (counts ALL versions, not just completed) | unit | (same file) | ❌ W0 |
| GRID-04 | W1 | Cursor walk visits every shot exactly once (mirrors `version-repo-cursor.test.ts:74-99` walkAllPages helper) | unit | (same file) | ❌ W0 |
| GRID-04 | W1 | `total_count` is cursor-independent (same value on page 1 and page 2) | unit | (same file) | ❌ W0 |
| (CROSS) | W1 | `lib/copy.ts` exports 27 Phase 21 constants (status pills, filter bar, empty-state copy, time formats) | source assertion | `grep -c '^export const ' packages/dashboard/src/lib/copy.ts` reflects new additions | ❌ W0 |
| (CROSS) | W1 | `formatRelativeTime(epochMs)` returns "Xs ago", "Xm ago", "Xh ago", "Xd ago", "just now" buckets | unit | `npx vitest run packages/dashboard/src/lib/__tests__/time.test.ts` | ❌ W0 |
| (CROSS) | W1 | `types/shot-grid.ts` exports `ShotGridResponse`, `ShotGridRow`, `ShotGridSequenceMeta` types | type-check | `npx tsc --noEmit` | ❌ W0 |
| GRID-04 | W2 | `Engine.listShotGrid(seqId, opts)` facade delegates to repo function with zero MCP dependency | unit + tool-engine-separation | facade signature test in `src/engine/__tests__/pipeline.test.ts` (or new) | ❌ W0 |
| GRID-04 | W2 | `GET /api/sequences/:id/shot-grid` returns `{ sequence, shots, next_cursor, total_count }` payload shape | integration | `npx vitest run src/http/__tests__/dashboard-routes-shot-grid.test.ts` | ❌ W0 |
| GRID-04 | W2 | Endpoint returns 404 SEQUENCE_NOT_FOUND for unknown sequence id | integration | (same file) | ❌ W0 |
| GRID-04 | W2 | Endpoint with `?cursor=<base64>&limit=20` returns the next page | integration | (same file) | ❌ W0 |
| GRID-04 | W2 | Malformed `?cursor=DROP_TABLE` returns 400 INVALID_INPUT (NOT 500) | integration | (same file) | ❌ W0 |
| GRID-04 | W2 | Endpoint default limit = 20, total_count always included | integration | (same file) | ❌ W0 |
| GRID-02 | W2 | `<ShotStatusPill/>` renders correct color class per status (all 5 statuses) | component | `npx vitest run packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` | ❌ W0 |
| GRID-02 | W2 | `<ShotStatusPill/>` text is WCAG 2.1 AA — color + text (never color alone); `data-status` attribute exposed for testing | component | (same file) | ❌ W0 |
| (CROSS) | W2 | `state/shot-grid.ts` exports signals (`activeView`, `selectedSequenceForGrid`, `shotGrid`, `statusFilter`, `showOmitted`) + computed `aggregateCounts` | unit | `npx vitest run packages/dashboard/src/state/__tests__/shot-grid.test.ts` | ❌ W0 |
| GRID-05 | W2 | `onShotStatusChanged` handler mutates the matching shot in `shotGrid.value.shots` (immutable update); unknown shotId is no-op; cross-sequence event is ignored | unit | (same file as above) | ❌ W0 |
| (CROSS) | W2 | URL hydration: `?statusFilter=approved&showOmitted=1` on mount sets signals correctly | unit | (same file — `hydrateShotGridUrlState` test) | ❌ W0 |
| (CROSS) | W2 | URL hydration: malformed `?statusFilter=DROP_TABLE` falls back to default + `console.warn` | unit | (same file) | ❌ W0 |
| (CROSS) | W2 | URL persist: signal change calls `history.replaceState` (NOT pushState) with serialized state | unit | (same file — mock history.replaceState) | ❌ W0 |
| (CROSS) | W2 | `fetchShotGrid(sequenceId, { cursor?, limit? })` returns typed `ShotGridResponse` | unit | `npx vitest run packages/dashboard/src/lib/__tests__/api.test.ts` (extend) | ❌ W0 |
| GRID-02 | W3 | `<ShotGridCard/>` renders `<Thumbnail/>` (lazy-load) for `latest_completed_version` | component | `npx vitest run packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` | ❌ W0 |
| GRID-02 | W3 | `<ShotGridCard/>` renders `<SkeletonThumbnail/>` when `latest_completed_version === null` | component | (same file) | ❌ W0 |
| GRID-02 | W3 | `<ShotGridCard/>` click sets `selectedVersionId` to `latest_completed_version.id` | component | (same file) | ❌ W0 |
| GRID-02 | W3 | `<ShotGridCard/>` click is disabled (`aria-disabled="true"`, no pointer cursor) when no completed version | component | (same file) | ❌ W0 |
| GRID-05 | W3 | When `showOmitted === true`, omit shots render with `opacity-40` wrapper class | component | (same file) | ❌ W0 |
| GRID-03 | W3 | Filter pill click updates `statusFilter` signal | component | `npx vitest run packages/dashboard/src/components/__tests__/ShotGridFilterBar.test.tsx` | ❌ W0 |
| GRID-03 | W3 | Status filter is client-side (no fetch triggered on pill click) | component | (same file; assert `fetch` mock not called after pill click) | ❌ W0 |
| GRID-03 | W3 | "All" pill resets `statusFilter = 'all'` | component | (same file) | ❌ W0 |
| GRID-03 | W3 | "Show omitted" toggle gates the dataset; omit pill appears only when toggle is ON (per D-07) | component | (same file) | ❌ W0 |
| (CROSS) | W3 | `<SequenceHeader/>` renders aggregate count mini-pills (D-14); chevron toggles collapse state (D-15) | component | `npx vitest run packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` | ❌ W0 |
| GRID-01 | W3 | TreeSidebar grid-icon click triggers `activeView = 'shot-grid'` + `selectedSequenceForGrid = seqId` (D-01/D-02) | component | `npx vitest run packages/dashboard/src/components/__tests__/TreeSidebar.test.tsx` | ❌ W0 |
| GRID-01 | W3 | TreeSidebar grid-icon for current grid sequence shows active state (`aria-current="page"` + accent fill, D-05) | component | (same file) | ❌ W0 |
| GRID-01 | W4 | `<ShotGridView/>` renders CSS Grid with `minmax(220px, 1fr)` template | component | `npx vitest run packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` | ❌ W0 |
| GRID-05 | W4 | When `showOmitted === false`, `<ShotGridView/>` filters out shots with `status === 'omit'` | component | (same file) | ❌ W0 |
| GRID-01 | W4 | Signal-driven view switch — `activeView='shot-grid'` renders `<ShotGridView/>`, `activeView='home'` renders `<HomeView/>` | component | `npx vitest run packages/dashboard/src/__tests__/App.test.tsx` (NEW) | ❌ W0 |
| GRID-01 | W4 | Home icon click sets `activeView = 'home'` | component | (same file) | ❌ W0 |
| (CROSS) | W4 | `App.tsx` registers `onSseEvent('shot.status_changed', ...)` on mount; unregisters on unmount | smoke | (same file) | ❌ W0 |
| (CROSS) | W5 | Full suite green — `architecture-purity.test.ts` PASS unchanged (no new native bindings) | integration | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ exists |
| (CROSS) | W5 | `tool-budget.test.ts` PASS unchanged at 7 (no new MCP tools) | integration | `npx vitest run src/__tests__/tool-budget.test.ts` | ✅ exists |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. "W0" = file does not yet exist; created in Wave 0 of its plan.*

---

## Wave 0 Requirements (Test Files To Create)

- [ ] `src/store/__tests__/shot-status-repo-grid.test.ts` — covers GRID-04 (SQL + cursor walk + EXPLAIN QUERY PLAN no-N+1 assertion)
- [ ] `src/http/__tests__/dashboard-routes-shot-grid.test.ts` — covers GRID-04 (HTTP route + Zod validation + cursor decode + 404 + payload shape)
- [ ] `packages/dashboard/src/lib/__tests__/time.test.ts` — covers `formatRelativeTime` (NEW utility)
- [ ] `packages/dashboard/src/lib/__tests__/api.test.ts` — extend with `fetchShotGrid` (or create if missing)
- [ ] `packages/dashboard/src/state/__tests__/shot-grid.test.ts` — covers `onShotStatusChanged`, `hydrateShotGridUrlState`, `persistShotGridUrlState`, `aggregateCounts`
- [ ] `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` — covers GRID-02 pill render contract
- [ ] `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` — covers GRID-02 card render + click + disabled-when-no-version + omit dimming
- [ ] `packages/dashboard/src/components/__tests__/ShotGridFilterBar.test.tsx` — covers GRID-03 filter pills + Show omitted toggle
- [ ] `packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` — covers D-14 aggregate counts + D-15 collapsible chevron
- [ ] `packages/dashboard/src/components/__tests__/TreeSidebar.test.tsx` — extend (or create) with D-01/D-02/D-05 grid-icon affordance
- [ ] `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` — covers GRID-01 view-level integration + CSS Grid template + omit filter
- [ ] `packages/dashboard/src/__tests__/App.test.tsx` — covers signal-driven view switch + home button + SSE handler register/unregister

*Framework already installed (vitest@^4.1.x). Test fixtures (`makeInMemoryDb`, `@testing-library/preact`) already in place.*

---

## EXPLAIN QUERY PLAN Test Pattern (NEW — first in codebase)

Phase 21 ships the first runtime-assert `EXPLAIN QUERY PLAN` test. Pattern documented in `21-RESEARCH.md` §"Validation Architecture → EXPLAIN QUERY PLAN Test Pattern" (lines 1230-1365). The test uses `testDb.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...)` against the raw `better-sqlite3` client exposed by `makeInMemoryDb`, and asserts:

1. **No correlated subquery for the latest-version (`ranked`) join** — `planRows.filter(r => r.detail.includes('CORRELATED') && r.detail.includes('ranked'))` must equal `[]`. The benign `version_count` uncorrelated scalar subquery is allowed.
2. **CTE materializes or streams as co-routine** — at least one plan row must reference `CO-ROUTINE` / `MATERIALIZE` / `ranked` (defence-in-depth against the planner regressing to row-by-row).

The repo function ships a public helper that returns the exact SQL text + bind params so tests can introspect without duplicating SQL strings.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WCAG 2.1 AA contrast check for 5 new `--color-shot-status-*` tokens against `--color-bg` and `--color-fg` | GRID-02, REQUIREMENTS cross-cutting WCAG lock | UI-SPEC `Color` section lists pre-computed contrast ratios; runtime automation requires a headless browser + axe-core which is out of scope for Phase 21. UI-SPEC table is the source of truth. | (a) Open `packages/dashboard/src/styles/theme.css`, confirm 5 tokens match the UI-SPEC values exactly. (b) Cross-check the UI-SPEC contrast table against the WebAIM Contrast Checker — text ≥ 4.5:1, UI components ≥ 3:1. (c) Visual smoke: start dev server, navigate to `?view=shot-grid&seq=<id>`, eyeball pill legibility in both light and dark themes. |
| Visual smoke: ShotGridView end-to-end render with real data (lazy thumbnails load, CSS Grid wraps responsively, SSE updates animate cards in-place) | GRID-01, GRID-02, GRID-05 | Component tests cover unit behavior; full visual flow with real ComfyUI Cloud thumbnail URLs needs a live dev environment | (a) `npx tsx src/server.ts --http` in one terminal + `cd packages/dashboard && npx vite` in another. (b) Click TreeSidebar grid icon on a sequence with ≥ 3 shots. (c) Verify cards render with lazy thumbnails (open DevTools → Network → confirm thumbnails load on scroll, not eagerly). (d) Confirm CSS Grid wraps with `minmax(220px, 1fr)` at multiple viewport widths (480/768/1024/1440). (e) Trigger a shot status change via MCP tool; confirm the affected card's pill updates in-place without re-render of others. |

---

## Validation Sign-Off

- [ ] All Wave 1 tasks include `<automated>` verify pointing at a test file in Wave 0 requirements
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (Wave 5's phase-gate task is the only manual node)
- [ ] Wave 0 covers all 12 MISSING test file references
- [ ] No watch-mode flags (`vitest run`, never `vitest`)
- [ ] Feedback latency < 25s per task
- [ ] `nyquist_compliant: true` set in frontmatter after planner completes

**Approval:** pending

---

*Generated: 2026-05-13 · Source: 21-RESEARCH.md §Validation Architecture · Phase: 21-shot-grid-view*
