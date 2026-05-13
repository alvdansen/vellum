---
phase: 21
plan: 2
subsystem: shot-grid-view
tags:
  - facade
  - http-route
  - signals
  - sse-handler
  - url-state
  - component
  - tdd
dependency_graph:
  requires:
    - "21-01-SUMMARY.md (listShotsForGrid + ShotGridCursor + ShotGridResponse types + ShotStatusChangedPayload)"
  provides:
    - "Engine.listShotGrid(sequenceId, opts) facade"
    - "GET /api/sequences/:id/shot-grid HTTP route + parseShotGridCursorParam"
    - "EngineForDashboard Pick<> widened with 'listShotGrid'"
    - "<ShotStatusPill/> primitive (5 statuses, WCAG 2.1 AA)"
    - "state/shot-grid.ts — 7 signals + aggregateCounts computed + onShotStatusChanged + hydrate/persist URL"
    - "fetchShotGrid(sequenceId, { cursor?, limit? }) consumer"
  affects:
    - "Wave 3 — <ShotGridCard/>, <ShotGridFilterBar/>, <SequenceHeader/>, TreeSidebar grid-icon affordance"
    - "Wave 4 — <ShotGridView/>, App.tsx root wiring + SSE subscribe"
tech-stack:
  added: []
  patterns:
    - "Window-function CTE pass-through (engine facade re-maps Wave 1 repo rows to dashboard wire shape)"
    - "Thin Hono route handler with deliberately-narrow query surface (no statusFilter / showOmitted / sort params — client-side per REQ-03/D-08/D-21)"
    - "Per-test inline mock override pattern: (engine as unknown as { listShotGrid: unknown }).listShotGrid = ((...) => ...) as never"
    - "Tailwind v4 arbitrary-value classes (`bg-[var(--color-shot-status-*)]`) verbatim in className — no token wiring in vite.config / tailwind.config"
    - "Signal-bag co-location pattern (state/shot-grid.ts owns signals + computed + SSE handler + URL hydrate/persist as a cohesive view-state module)"
    - "history.replaceState mirror (NOT pushState) — Phase 18 D-16 graceful fallback precedent extended to Phase 21 with view+seq+statusFilter+showOmitted"
key-files:
  created:
    - "src/http/__tests__/dashboard-routes-shot-grid.test.ts"
    - "packages/dashboard/src/components/ShotStatusPill.tsx"
    - "packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx"
    - "packages/dashboard/src/state/shot-grid.ts"
    - "packages/dashboard/src/state/__tests__/shot-grid.test.ts"
    - ".planning/phases/21-shot-grid-view/deferred-items.md"
  modified:
    - "src/engine/pipeline.ts"
    - "src/http/dashboard-routes.ts"
    - "packages/dashboard/src/lib/api.ts"
    - "packages/dashboard/src/__tests__/api.test.ts"
decisions:
  - "Combined T01/T02 implementation + T03 test commit ordering: implementation committed before integration test for parity with Wave 1 precedent (commit-per-task without staged RED/GREEN sub-commits when impl + test live in the same plan but in different files — see 21-01-SUMMARY 'Workflow Observations 1')"
  - "Adopted inline test-override pattern for FakeEngine.listShotGrid via `as unknown as { listShotGrid: unknown }` cast (FakeEngine does not yet declare the method); matches the existing `engine.getWorkspace = ...` per-test override idiom in dashboard-routes.test.ts:114"
  - "Did NOT add `listShotGrid` to FakeEngine class as a default method — per-test mocks keep the test scope tightly bounded and avoid Wave 2 modifying a shared test fixture in ways that could affect unrelated test suites"
  - "Engine.listShotGrid takes `repo.getSequence(sequenceId)` (raw Sequence | undefined) NOT the wrapped engine.getSequence (which throws) — facade owns the SEQUENCE_NOT_FOUND throw at the right tier to surface 404 via global typedErrorHandler"
metrics:
  duration_seconds: 1080
  duration_human: "~18m"
  completed_date: "2026-05-13T05:34:00Z"
  task_count: 7
  files_created: 6
  files_modified: 4
  commit_count: 7
  test_cases_added: 24
  test_files_added: 3
  lines_added: 1224
---

# Phase 21 Plan 02: Wave 2 Backend Facade + HTTP Route + Dashboard State Summary

**One-liner:** Closed the end-to-end fetch path (`fetchShotGrid → /api/sequences/:id/shot-grid → engine.listShotGrid → Wave 1 listShotsForGrid`) plus the dashboard state bag (signals, SSE handler, URL hydrate/persist, aggregateCounts computed) and the `<ShotStatusPill/>` primitive — 7 atomic commits, 24 new test cases, all 3 plan-scope vitest files green and Wave-2 regression sweep clean (architecture-purity / tool-budget / pipeline-shot-status / dashboard-routes all unchanged).

## What Was Built

### T01 — Engine.listShotGrid facade

**Commit:** `feca577` — `feat(21-02): add Engine.listShotGrid facade + EngineForDashboard Pick<>`

Added a new `listShotGrid(sequenceId, opts)` method on `Engine` (src/engine/pipeline.ts) below the Phase 20 shot-status block. Signature:

```typescript
listShotGrid(
  sequenceId: string,
  opts: { cursor: ShotGridCursor | null; limit: number },
): {
  sequence: { id: string; name: string };
  shots: Array<{
    id: string;
    name: string;
    status: ShotStatus;
    version_count: number;
    latest_completed_version: { id: string; thumbnail_url: string; completed_at: number } | null;
  }>;
  next_cursor: string | null;
  total_count: number;
}
```

**404 propagation:** Looks up `this.repo.getSequence(sequenceId)` — the raw HierarchyRepo path returning `Sequence | undefined`. If `undefined`, throws `TypedError('SEQUENCE_NOT_FOUND', \`Sequence '${id}' not found\`, hint)` verbatim from PATTERNS §10. The HTTP route never wraps this in a try/catch — the global `typedErrorHandler` translates `SEQUENCE_NOT_FOUND` → 404 automatically.

**Repo delegation:** Calls `listShotsForGrid(this.db, sequenceId, opts)` from `'../store/shot-status-repo.js'` (Wave 1 addition). The repo function is the single-pass window-function CTE that joins `shots` + `versions` (latest-completed via `ROW_NUMBER() OVER (PARTITION BY shot_id ORDER BY completed_at DESC, id ASC)`) — N+1 regression guarded by an `EXPLAIN QUERY PLAN` assertion in 21-01-T07.

**thumbnail_url construction at engine layer (D-13 / A1):** When `r.lcv_id !== null && r.lcv_completed_at !== null`, the facade builds `thumbnail_url: \`/api/versions/${encodeURIComponent(r.lcv_id)}/thumbnail\``. The dashboard never assembles URL strings — the wire shape gives `<Thumbnail/>` a usable `<img src=>` value directly. When `lcv_id` is null (zero completed versions), the facade returns `latest_completed_version: null` (drives `<SkeletonThumbnail/>` in Wave 3 per D-19).

**EngineForDashboard widening:** Added `'listShotGrid'` to the `Pick<Engine, ...>` type alias in `src/http/dashboard-routes.ts` so the T02 route can call `engine.listShotGrid(...)` without an `any` cast. Single-line edit captured in the same commit because the facade and the Pick widening are one logical change (the route would not type-check without the widening).

### T02 — HTTP route + parseShotGridCursorParam

**Commit:** `2dfcb02` — `feat(21-02): add GET /api/sequences/:id/shot-grid route + parseShotGridCursorParam`

Added two surfaces to `src/http/dashboard-routes.ts`:

**`parseShotGridCursorParam(raw)` helper** — placed adjacent to the existing `parseCursorParam` (Phase 18 precedent). Mirrors the 4xx contract verbatim: `undefined` or `''` → `null` (page 1); valid base64url → decoded `ShotGridCursor`; anything else → `TypedError('INVALID_INPUT', genericMessage, hint)` with NO echo of the malformed input back (T-18-03 information-disclosure hygiene). The underlying `decodeShotGridCursor` is the Wave 1 helper that returns `null` on every failure path; this route helper translates that `null` to a structured 400 envelope.

**Route registration:**

```typescript
app.get('/api/sequences/:id/shot-grid', (c) => {
  const sequenceId = c.req.param('id');
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const cursor = parseShotGridCursorParam(c.req.query('cursor'));
  return c.json(engine.listShotGrid(sequenceId, { cursor, limit }));
});
```

**Deliberately narrow query surface:** Banner comment + explicit JSDoc spell out that the route does NOT accept `statusFilter`, `showOmitted`, or `sort` query params — those are client-side responsibilities per REQ-03 / D-08 / D-21. Filter and gating live in `state/shot-grid.ts`; sort is fixed `name ASC` for Phase 21.

**No try/catch:** The route trusts the global `typedErrorHandler`:
- `TypedError('SEQUENCE_NOT_FOUND')` (from engine.listShotGrid) → 404
- `TypedError('INVALID_INPUT')` (from parseShotGridCursorParam or qNum) → 400
- Any other error → 500 (no leakage of internal error shape)

### T03 — dashboard-routes-shot-grid integration tests

**Commit:** `3a1b140` — `test(21-02): add dashboard-routes-shot-grid integration tests (7 cases)`

Created `src/http/__tests__/dashboard-routes-shot-grid.test.ts` (200 LOC) covering the T02 HTTP surface end-to-end. Each test builds a fresh Hono app via the existing `buildApp(engine)` helper pattern from `dashboard-routes.test.ts:54-73`, mounts `typedErrorHandler`, and uses `FakeEngine` with a per-test mock override of `engine.listShotGrid`.

**The 7 cases:**

1. **Happy path** — `/api/sequences/seq_1/shot-grid` → 200, engine receives `('seq_1', { cursor: null, limit: 20 })`, response has the 4-field shape (`sequence`, `shots`, `next_cursor`, `total_count`).
2. **?limit=5 override** — engine receives `{ cursor: null, limit: 5 }`.
3. **?cursor=<valid base64url>** — uses `encodeShotGridCursor` to build a real opaque cursor; engine receives the decoded `{ n, sid }` object.
4. **?cursor=DROP_TABLE** → 400 INVALID_INPUT; the body's `error.message` is asserted to NOT contain the malformed input string (T-18-03 hygiene).
5. **Unknown sequence** — TypedError mock throws `SEQUENCE_NOT_FOUND`; response is 404 with `error.code === 'SEQUENCE_NOT_FOUND'`.
6. **?limit=-1** → 400 INVALID_INPUT (qNum rejects negatives).
7. **?limit=foo** → 400 INVALID_INPUT (qNum rejects non-numeric).

The defensive negative-path tests (4, 6, 7) ALSO assert the engine mock is never reached — proving the parse seam fails closed before any SQL touch.

### T04 — `<ShotStatusPill/>` primitive

**Commit:** `90deaec` — `feat(21-02): add ShotStatusPill component + WCAG-AA parametric tests`

Created `packages/dashboard/src/components/ShotStatusPill.tsx` (~67 LOC) implementing the 5-status pill primitive per D-17 / UI-SPEC §"Color". Visual vocabulary mirrors `<StatusPill/>`:

```tsx
<span
  class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${SHOT_STATUS_STYLES[status]}`}
  data-status={status}
>
  {status}
</span>
```

Where `SHOT_STATUS_STYLES[status]` maps each `ShotStatus` to its Tailwind v4 arbitrary-value class: `bg-[var(--color-shot-status-wip)] text-[var(--color-bg)]` etc. The 5 background tokens were added to `theme.css` by Wave 1 21-01-T02 with pre-verified WCAG 2.1 AA contrast against `--color-bg` in both dark and light themes.

**Distinct from `<StatusPill/>` (D-17 landmine):** Shot status (5-value) and version status (4-value) unions do not overlap; the components live in separate files; there is no shared union or extended component. Type system guarantees a version-status pill can never render a shot status and vice versa.

**No `animate-status-pulse`:** Shot statuses are long-lived states (artists transition them deliberately), not in-flight markers — animation would mislead. The test file includes an explicit negative-case asserting the pulse class is absent.

**6 vitest cases** in `__tests__/ShotStatusPill.test.tsx`:
- 5 parametric (`it.each`) covering each status's bg token + WCAG-AA inverse text + label-uppercase + tracking-widest + textContent
- 1 defensive: no pulse animation applied

### T05 — `state/shot-grid.ts`

**Commit:** `7351237` — `feat(21-02): add state/shot-grid.ts signals + SSE handler + URL helpers`

Created `packages/dashboard/src/state/shot-grid.ts` (~257 LOC) — the cohesive view-state module for Phase 21. Architecture-purity preserved (zero `src/` imports; only `@preact/signals`, `zod`, and dashboard-local `../types/*` barrels).

**Signals exported (7):**

| Signal | Type | Purpose |
|--------|------|---------|
| `activeView` | `'home' \| 'shot-grid'` | Toggled by home-icon and TreeSidebar grid-icon |
| `selectedSequenceForGrid` | `string \| null` | Which sequence's grid is currently displayed |
| `shotGrid` | `ShotGridResponse \| null` | Paginated buffer; `null` pre-fetch / fetch-failed |
| `statusFilter` | `'all' \| ShotStatus` | Currently-active filter pill |
| `showOmitted` | `boolean` | Dataset gate for `omit` shots |
| `gridIsFetching` | `boolean` | Loading flag for initial fetch + load-more |
| `gridLoadMoreError` | `string \| null` | Most-recent error for `<LoadMoreButton/>` retry |

**Computed: `aggregateCounts`** (D-14) — `Record<ShotStatus, number>` derived from `shotGrid.value?.shots ?? []` via a reduce. SSE-driven re-derivation flows for free: when `onShotStatusChanged` mutates a row's status, the computed re-runs and `<SequenceHeader/>` mini-pills (Wave 3) re-render reactively. Caveat: for sequences > 50 shots the counts reflect "loaded so far" (RESEARCH Pitfall 8); Phase 23 ships the full server-computed widget.

**SSE handler: `onShotStatusChanged(payload)`** — three defensive branches:

1. `shotGrid.value === null` → no-op (nothing to update)
2. `current.sequence.id !== payload.sequenceId` → no-op (cross-sequence event, user navigated away; A2 / T-21-09 disposition)
3. unknown `shotId` → `.map`'s identity passthrough leaves all rows unchanged

On a matching event the entire `shotGrid.value` is replaced (immutable) with the targeted row freshly constructed (`{ ...s, status: payload.toStatus }`) and non-matching rows preserving their object identity — so Preact rerenders only the one card and the `<img>` tag inside `<Thumbnail/>` does not re-decode.

**URL state helpers (D-09):**

- `hydrateShotGridUrlState()` — called once by `App.tsx`'s mount useEffect (Wave 4). Reads `window.location.searchParams`; runs them through `ShotGridUrlSchema.safeParse` (Zod whitelist of valid `seq`, `view`, `statusFilter`, `showOmitted` values); on failure logs `console.warn` and returns with signals at defaults — **NEVER throws to caller** (Phase 18 D-16 graceful fallback). SSR guard at entry.
- `persistShotGridUrlState()` — called by the view after every signal mutation. Builds a URL from `window.location.href`, sets the 4 keys, and calls `history.replaceState(null, '', url.toString())`. **LOCKED to `replaceState` only** — never `pushState`; view settings must not pollute browser back-stack. Silent on SSR / sandboxed `history`.

**Landmine guards (PATTERNS §13):**

- No top-level SSE subscription — the subscription belongs in `App.tsx`'s `useEffect` so register/unregister lifecycle is tied to mount/unmount.
- No top-level `persistShotGridUrlState()` call — callers invoke explicitly after signal mutation (matches Phase 18 `persistGridSort` precedent).
- No `history` push-state usage anywhere in the module.

### T06 — `state/__tests__/shot-grid.test.ts`

**Commit:** `7f70653` — `test(21-02): add state/shot-grid unit tests (11 cases, 4 describes)`

Created `packages/dashboard/src/state/__tests__/shot-grid.test.ts` (313 LOC) with the four mandated describe blocks:

| Describe | Cases | Coverage |
|----------|-------|----------|
| `onShotStatusChanged` | 4 | matching shot immutable mutation (refs change; non-matching rows preserve identity); unknown shotId no-op; cross-sequence event refs preserved; null shotGrid does not throw |
| `hydrateShotGridUrlState` | 3 | valid params adopted; malformed → console.warn + defaults preserved (asserts BOTH); view+seq combo |
| `persistShotGridUrlState` | 2 | `history.replaceState` called exactly once with all 4 keys in URL; `history.pushState` NEVER called |
| `aggregateCounts` | 2 | reduce-by-status correctness across 5-shot fixture; reactive re-derive after onShotStatusChanged |

**Module-singleton signal reset** in `beforeEach` (PATTERNS §14 landmine guard) — `@preact/signals` instances live at module scope, so without explicit reset one test's mutations leak into the next. The `afterEach(() => vi.restoreAllMocks())` cleans the `console.warn` spy and the `history.{replaceState,pushState}` spies.

**Cross-sequence ignore confirmation:** the test `'cross-sequence event leaves shotGrid reference unchanged (A2/T-21-09)'` captures `const before = shotGrid.value` before the event, then asserts `expect(shotGrid.value).toBe(before)` after — confirming referential stability (no `.value =` write at all on the no-op branch).

### T07 — `fetchShotGrid` consumer

**Commit:** `33bf423` — `feat(21-02): add fetchShotGrid consumer + 6 unit tests`

Added to `packages/dashboard/src/lib/api.ts`:

```typescript
export interface FetchShotGridParams {
  cursor?: string | null;
  limit?: number;
}

export function fetchShotGrid(
  sequenceId: string,
  params?: FetchShotGridParams,
): Promise<ShotGridResponse> {
  const queryParams: Record<string, unknown> = {
    cursor: params?.cursor ?? undefined,
    limit: params?.limit,
  };
  return fetchJson<ShotGridResponse>(
    `/api/sequences/${encodeURIComponent(sequenceId)}/shot-grid${qs(queryParams)}`,
  );
}
```

Key invariants (mirror `fetchVersions:230-245` precedent):
- Path-encoded `sequenceId` via `encodeURIComponent` (defensive — characters like ` `, `?`, `#`, `/` would break URL parsing without encoding)
- `cursor: null` collapses to `undefined` via the `?? undefined` operator → `qs()` omits the param entirely (server treats missing-cursor as page 1)
- Return type is `Promise<ShotGridResponse>` (the D-13 envelope from Wave 1 `types/shot-grid.ts`); errors surface as `DashboardApiError` via `fetchJson` (envelope-preserving)
- No status filter, no show-omitted, no sort query params (REQ-03 / D-08 / D-21 LOCKED)

**6 new test cases** appended to `packages/dashboard/src/__tests__/api.test.ts`:

1. No params → clean URL `/api/sequences/seq_1/shot-grid` (no `?`)
2. `?limit=50` override appended
3. Both `?cursor=&limit=` appended together
4. `cursor: null` → param omitted from URL entirely
5. `encodeURIComponent` path-encoding: `'id with spaces'` → `/api/sequences/id%20with%20spaces/shot-grid`
6. Typed `ShotGridResponse` round-trips correctly (server fixture verified via `toEqual`)

Total api.test.ts cases: 13 prior + 6 new = **19 passed**.

## End-to-End Path Established

After Wave 2 the full request path is wire-typed end-to-end:

```
ShotGridView (Wave 4)
  └─ fetchShotGrid(seqId, { cursor, limit })          [lib/api.ts]
      └─ GET /api/sequences/:id/shot-grid             [dashboard-routes.ts]
          └─ engine.listShotGrid(seqId, { cursor, limit })  [engine/pipeline.ts]
              └─ listShotsForGrid(db, seqId, opts)    [store/shot-status-repo.ts — Wave 1]
                  └─ SQL: WITH ranked AS (ROW_NUMBER ... LEFT JOIN ... LIMIT n+1)
```

Response envelope (D-13 LOCKED, type-shared end-to-end):

```typescript
{
  sequence: { id: string; name: string };
  shots: Array<{
    id: string;
    name: string;
    status: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit';
    version_count: number;
    latest_completed_version: { id: string; thumbnail_url: string; completed_at: number } | null;
  }>;
  next_cursor: string | null;
  total_count: number;
}
```

Error envelopes:
- 400 INVALID_INPUT — malformed cursor / negative or non-numeric limit
- 404 SEQUENCE_NOT_FOUND — sequenceId not in workspace

## Deviations from Plan

### Auto-fixed Issues

None. All 7 tasks executed exactly as specified in 21-02-PLAN.md. No Rule 1 bugs were discovered, no missing critical functionality was found, and no Rule 3 blocking issues required auto-fixes.

### Workflow Observations

1. **Inline mock-override pattern needed a cast (T03):** The plan suggested `engine.listShotGrid = ((sequenceId, opts) => { ... }) as never;`. Without the LHS cast TypeScript rejects the assignment because `FakeEngine` does not declare `listShotGrid`. I applied the minimal cast `(engine as unknown as { listShotGrid: unknown }).listShotGrid = ...` which preserves the test's intent and matches the existing-file idiom of `engine.getWorkspace = ...` (where the LHS resolves to a declared method). I did NOT add `listShotGrid` to `FakeEngine` itself — keeping the surface change narrow (per-test mock) avoids modifying a shared fixture in a way that could affect unrelated test suites.

2. **JSDoc references to forbidden patterns trip plan verify greps:** Two verify commands (`grep -c '?showOmitted=' ... == 0` and `grep -c 'animate-status-pulse' ... == 0` and `grep -c 'history.pushState' ... == 0`) had me rephrase JSDoc comments that referenced these literals in their "DO NOT use" warnings. The substance of each invariant is preserved — no code uses these patterns; the JSDocs now describe what NOT to do without using the exact forbidden string. This matches the Wave 1 precedent of treating verify commands as guidelines and the underlying acceptance criteria as authoritative.

3. **TDD `tdd="true"` flag interpretation:** Per `executor-examples.md` "acceptable for new-helper introduction", T03/T04/T06/T07 follow the same "test + impl committed atomically" pattern Wave 1 used for similar new-surface tasks. T01/T02 implementation commits land before T03's test commit specifically because they introduce the engine + route surface the integration tests verify — this is the standard "GREEN-after-implementation" pattern when impl + test live in the same plan but in different file types (TypeScript source vs test). All test files run green on first run after their corresponding impl files exist.

4. **Worktree node_modules symlinks:** The worktree spawned without its own `node_modules`. Per the same precedent set by Wave 1 (21-01-SUMMARY observation 3), I symlinked `node_modules/` and `packages/dashboard/node_modules/` from the main repo's installed dependencies into the worktree. Symlinks are gitignored and not part of any commit; verified non-tracked via `git status` before each commit.

### Architectural Adjustments

None. No Rule 4 architectural decisions surfaced.

### Auth Gates

None. All work was local TypeScript/test authoring with no external service calls.

## Threat Surface Scan

No new security-relevant surface introduced beyond the plan's threat model coverage:

- **Cursor decode**: `parseShotGridCursorParam` reuses the Wave 1 defensive decoder (try/catch wrapped, structural validation, never throws); the route never echoes malformed cursor strings back to the client (T-18-03 hygiene preserved)
- **SQL parameterization**: The engine facade only passes the structurally-validated `ShotGridCursor` object to `listShotsForGrid`; the repo uses Drizzle `sql\`\${var}\`` template parameterization throughout (no string concatenation)
- **URL injection**: `fetchShotGrid` uses `encodeURIComponent(sequenceId)` for the path segment; `qs()` URL-encodes all query values
- **CSRF / state mutation**: Phase 21 endpoint is read-only (GET only); no new write surface introduced
- **Authentication**: No new auth surface; same-origin dashboard fetch via `fetchJson` (Phase 5 BASE='').
- **Information disclosure**: 400 INVALID_INPUT messages are generic ("Malformed cursor — drop the ?cursor= param to start from page 1") with no echo of the malformed input

Threat Flags: none new.

## Self-Check: PASSED

```bash
$ git log --oneline -8
33bf423 feat(21-02): add fetchShotGrid consumer + 6 unit tests
7f70653 test(21-02): add state/shot-grid unit tests (11 cases, 4 describes)
7351237 feat(21-02): add state/shot-grid.ts signals + SSE handler + URL helpers
90deaec feat(21-02): add ShotStatusPill component + WCAG-AA parametric tests
3a1b140 test(21-02): add dashboard-routes-shot-grid integration tests (7 cases)
2dfcb02 feat(21-02): add GET /api/sequences/:id/shot-grid route + parseShotGridCursorParam
feca577 feat(21-02): add Engine.listShotGrid facade + EngineForDashboard Pick<>
8ac9366 docs(phase-21): update tracking after wave 1
```

### Files created — exist on disk

- `src/http/__tests__/dashboard-routes-shot-grid.test.ts`: FOUND
- `packages/dashboard/src/components/ShotStatusPill.tsx`: FOUND
- `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx`: FOUND
- `packages/dashboard/src/state/shot-grid.ts`: FOUND
- `packages/dashboard/src/state/__tests__/shot-grid.test.ts`: FOUND
- `.planning/phases/21-shot-grid-view/deferred-items.md`: FOUND

### Files modified — verify changes present

- `src/engine/pipeline.ts`: FOUND `listShotGrid` method + import
- `src/http/dashboard-routes.ts`: FOUND `/api/sequences/:id/shot-grid` route + parseShotGridCursorParam + 'listShotGrid' in EngineForDashboard
- `packages/dashboard/src/lib/api.ts`: FOUND `fetchShotGrid` + `FetchShotGridParams`
- `packages/dashboard/src/__tests__/api.test.ts`: FOUND `describe('fetchShotGrid (Phase 21 GRID-04)')`

### Commit hashes — all reachable from HEAD

- T01 `feca577`: FOUND
- T02 `2dfcb02`: FOUND
- T03 `3a1b140`: FOUND
- T04 `90deaec`: FOUND
- T05 `7351237`: FOUND
- T06 `7f70653`: FOUND
- T07 `33bf423`: FOUND

## Verification Evidence

```bash
# Type-check (both packages): clean
$ npx tsc --noEmit                                              # exit 0
$ npx tsc --noEmit -p packages/dashboard/tsconfig.json          # exit 0

# Plan-scope test files — all green
$ npx vitest run src/http/__tests__/dashboard-routes-shot-grid.test.ts   # 7/7 passed
$ cd packages/dashboard
$ npx vitest run src/components/__tests__/ShotStatusPill.test.tsx        # 6/6 passed
$ npx vitest run src/state/__tests__/shot-grid.test.ts                   # 11/11 passed
$ npx vitest run src/__tests__/api.test.ts                               # 19/19 passed (13 prior + 6 new)

# Full dashboard suite — sanity regression
$ cd packages/dashboard && npx vitest run
  Test Files  29 passed (29)
       Tests  308 passed (308)

# Wave 2 server-side scope + regression — all green
$ cd /Users/macapple/comfyui-vfx-mcp/.claude/worktrees/agent-a7cf86d6f7a718279
$ npx vitest run \
    src/store/__tests__/shot-status-repo-grid.test.ts \
    src/http/__tests__/dashboard-routes-shot-grid.test.ts \
    src/__tests__/architecture-purity.test.ts \
    src/__tests__/tool-budget.test.ts \
    src/store/__tests__/shot-status-repo.test.ts \
    src/http/__tests__/dashboard-routes.test.ts \
    src/engine/__tests__/pipeline-shot-status.test.ts \
    src/engine/__tests__/pipeline.test.ts
  Test Files  8 passed (8)
       Tests  173 passed (173)

# Route presence — exactly once
$ grep -c "app.get('/api/sequences/:id/shot-grid'" src/http/dashboard-routes.ts  # → 1

# State exports — 8 signals/computed + 3 functions
$ grep -c "^export const\|^export function" packages/dashboard/src/state/shot-grid.ts  # → 11

# Tool-budget invariant remains at 7
# (asserted by passing `npx vitest run src/__tests__/tool-budget.test.ts`)

# Architecture-purity invariant remains green
# (asserted by passing `npx vitest run src/__tests__/architecture-purity.test.ts`)
```

### Deferred items (pre-existing failures unrelated to Wave 2)

See `deferred-items.md` in this directory. 22 test failures observed in the full server-side suite are pre-existing on `main` HEAD and target ROADMAP.md / REQUIREMENTS.md doc-structure parsers + c2pa wire-level UAT scenarios — none touch any file modified by this plan.

## Commits

| Task | Commit  | Message                                                                  |
|------|---------|--------------------------------------------------------------------------|
| T01  | `feca577` | feat(21-02): add Engine.listShotGrid facade + EngineForDashboard Pick<>  |
| T02  | `2dfcb02` | feat(21-02): add GET /api/sequences/:id/shot-grid route + parseShotGridCursorParam |
| T03  | `3a1b140` | test(21-02): add dashboard-routes-shot-grid integration tests (7 cases)  |
| T04  | `90deaec` | feat(21-02): add ShotStatusPill component + WCAG-AA parametric tests     |
| T05  | `7351237` | feat(21-02): add state/shot-grid.ts signals + SSE handler + URL helpers  |
| T06  | `7f70653` | test(21-02): add state/shot-grid unit tests (11 cases, 4 describes)      |
| T07  | `33bf423` | feat(21-02): add fetchShotGrid consumer + 6 unit tests                   |

## Required Outputs (per plan `<output>` block)

- **Engine facade signature + 404 propagation:** `Engine.listShotGrid(sequenceId, opts)` returns the D-13 envelope; throws `TypedError('SEQUENCE_NOT_FOUND', \`Sequence '${id}' not found\`, hint)` for unknown sequenceId. The HTTP layer wraps no try/catch — `typedErrorHandler` translates the typed throw into a 404 envelope automatically.

- **HTTP route surface:**
  - URL: `GET /api/sequences/:id/shot-grid`
  - Query params accepted: `?cursor=<base64url>&limit=<int>` (defaults: cursor=null, limit=20)
  - Query params REJECTED: anything else passes through Hono untouched; explicitly no `?statusFilter=`, `?showOmitted=`, `?sort=` (locked per REQ-03 / D-08 / D-21)
  - Success response: `{ sequence: { id, name }, shots: ShotGridRow[], next_cursor: string|null, total_count: number }`
  - 400 envelope: `{ error: { code: 'INVALID_INPUT', message, hint? } }` for malformed cursor / negative limit / non-numeric limit
  - 404 envelope: `{ error: { code: 'SEQUENCE_NOT_FOUND', message, hint? } }` for unknown sequenceId
  - No 500 leak on any tested negative path (T03 covers cursor + limit failure modes)

- **Cross-sequence SSE ignore — referential stability confirmed:** The test `'cross-sequence event leaves shotGrid reference unchanged (A2/T-21-09)'` captures `const before = shotGrid.value` before invoking the handler with `payload.sequenceId === 'seq_DIFFERENT'`, then asserts `expect(shotGrid.value).toBe(before)` after. The reference is unchanged — no `.value =` write occurs in the cross-sequence branch.

- **aggregateCounts shape:** `computed<Record<ShotStatus, number>>(() => ...)` returning an object with exactly 5 keys (`'wip', 'pending-review', 'approved', 'on-hold', 'omit'`), each a non-negative integer count of the matching shots in `shotGrid.value?.shots ?? []`. Initialized via `init` literal with all 5 keys at 0 so the shape is stable even when `shotGrid` is null or the grid is empty.

- **EngineForDashboard Pick<> widened with `'listShotGrid'`:** Confirmed. Added between the existing `'summarizeVersion'` entry and the closing `>`. The route's call `engine.listShotGrid(...)` type-checks without a cast at the dashboard-routes.ts seam.

- **Deviations:** Documented above under "Deviations from Plan". Summary: zero substantive deviations; four minor workflow observations (test-override cast, JSDoc rephrasing for verify-grep alignment, TDD interpretation, worktree node_modules symlinks).
