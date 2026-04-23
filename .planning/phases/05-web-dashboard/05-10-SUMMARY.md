---
phase: 05-web-dashboard
plan: 10
subsystem: ui
tags: [preact, vite, tailwindcss-v4, sse, preact-signals, views, xss-mitigation, WEBUI-01, WEBUI-02, WEBUI-03]
dependency_graph:
  requires:
    - phase: 05-01 (foundation-monorepo) — Vite + @preact/preset-vite + Tailwind v4 + vitest jsdom env, index.html FOUC shell, vite.config.ts
    - phase: 05-08 (dashboard-data-layer) — 18 typed fetch wrappers in lib/api.ts, SSE singleton in lib/events.ts, @preact/signals state atoms (activeGenerations, hierarchy, versions), dashboard-local entities + events types
    - phase: 05-09 (theme + primitives) — theme.css design-token layer, 7 pure primitives (TreeSidebar, VersionCard, StatusPill, JsonBlock, ThemeToggle, EmptyState, SkeletonThumbnail)
  provides:
    - "packages/dashboard/src/views/HomeView.tsx — two-pane TreeSidebar + shot-detail VersionCard grid with lazy-hydrated nested children cache"
    - "packages/dashboard/src/views/VersionDrawer.tsx — version detail (timeline + lazy-fetched provenance + View Diff button)"
    - "packages/dashboard/src/views/DiffDrawer.tsx — before/after VersionCard pair + optional diff summary"
    - "packages/dashboard/src/views/ActiveGenerationsPanel.tsx — live right-rail reading activeGenerations signal (queued/running only)"
    - "packages/dashboard/src/App.tsx — root layout + SSE lifecycle (startSse/stopSse/on+offSseEvent) wired to version.created / version.status_changed handlers"
    - "packages/dashboard/src/main.tsx — Vite entry, data-theme fallback to 'dark', render <App /> into #app"
    - "packages/dashboard/src/lib/shape.ts — versionLabel(), normalizeStatus(), unwrapList() helpers"
    - "packages/dashboard/dist/ (build artifact, gitignored) — working Vite v8 bundle produced by npm run build:dashboard"
  affects:
    - "Plan 05-11 (SSE + reproduce) — adds Reproduce Version button inside VersionDrawer; wires to api.reproduceVersion and follow-up SSE frames"
    - "Plan 05-12 (static bundle + Hono mount) — mounts packages/dashboard/dist/ as static assets under / in the existing Hono server"
tech_stack:
  added:
    - "packages/dashboard/src/lib/shape.ts (3 helpers; no new npm deps)"
  patterns:
    - "Lazy-hydrate nested tree via a local ChildrenCache keyed by parent-id — TreeSidebar stays pure (props-in) while HomeView owns the fetch-on-expand behavior"
    - "Defensive list unwrapping — unwrapList() handles both `{items, total_count}` ListResult wrapper and bare `T[]` shapes so views survive the documented api.ts typing drift (Plan 08 handoff notes) without requiring churn when api.ts is corrected"
    - "Status normalization at the view/primitive boundary — dashboard entities carry the server's VersionStatus union (submitted/running/completed/failed) but StatusPill's Status union is the narrower (queued/running/complete/failed); normalizeStatus() maps between them and defaults unknowns to 'queued'"
    - "Single-useEffect SSE lifecycle — App.tsx subscribes bridge handlers with onSseEvent, calls startSse(), and the cleanup returns off+stop so HMR + unmount both leave a clean EventSource state"
    - "Drawer chaining via local state, not signals — VersionDrawer owns showDiff boolean + diff payload locally; DiffDrawer rendering is a function of local state, so the drawer chain closes cleanly on unmount without touching global signals"
    - "Primitive-first view composition — every view exclusively composes Plan 09 primitives (TreeSidebar, VersionCard, StatusPill, JsonBlock, EmptyState, ThemeToggle); zero inline JSX primitives, zero dangerouslySetInnerHTML"
key_files:
  created:
    - packages/dashboard/src/App.tsx (58 lines)
    - packages/dashboard/src/main.tsx (34 lines)
    - packages/dashboard/src/lib/shape.ts (69 lines)
    - packages/dashboard/src/views/ActiveGenerationsPanel.tsx (55 lines)
    - packages/dashboard/src/views/DiffDrawer.tsx (111 lines)
    - packages/dashboard/src/views/HomeView.tsx (282 lines)
    - packages/dashboard/src/views/VersionDrawer.tsx (208 lines)
  modified: []
decisions:
  - "[Plan 05-10] Adapted plan sketch fetchDiff(versionId)→{before,after} + fetchProvenance(versionId) to the REAL api.ts surface: diffVersion(versionA, versionAgainst)→{summary,changes} + getProvenance(versionId)→{events,breadcrumb}. Must-have truth 'DiffDrawer renders before/after version cards side by side' satisfied by taking the two Version entities the parent already holds (current + prior by version_number) and passing them as props; structured diff summary rendered additively when available. No deviation from the plan's intent — the sketch code was illustrative, not binding."
  - "[Plan 05-10] Added packages/dashboard/src/lib/shape.ts with versionLabel(), normalizeStatus(), and unwrapList(). These bridge shape gaps between the Plan 08 API layer (which returns the raw server shapes) and the Plan 09 primitives (which expect label + narrow Status union). Not in the plan file list but required to make the views compose without repeating the same ~30 lines of mapping logic in each view. Zero new npm deps."
  - "[Plan 05-10] Defensive `unwrapList<T>()` handles `ListResult<T>` wrapper vs bare `T[]` because Plan 08's api.ts is typed as `Promise<T[]>` while the server actually returns `{items, total_count, limit, offset}` (ListResult). Plan 08 summary flagged this as 'serialization-boundary-drift / threat_flag'; rather than modify api.ts (Plan 08's domain, out-of-scope here), views call through unwrapList() so they survive either shape. When Plan 11 or a follow-up corrects api.ts typing to `Promise<ListResult<T>>`, unwrapList() continues to work without view churn."
  - "[Plan 05-10] Canonical theme tokens — plan sketch referenced --color-text-primary / --color-text-secondary but theme.css defines --color-fg / --color-fg-muted / --color-fg-dim. Views use the canonical token names (per UI-SPEC.md Color table). Semantic fix in the same spirit as Plan 09's JsonBlock token correction."
  - "[Plan 05-10] ActiveGenerationsPanel filters to queued/running rows only (masks terminal 'complete'/'failed') even though the signal retains terminal rows. This is consistent with Plan 08 SUMMARY's note that panels mask terminals via a computed at the component layer. Count label 'Active Generations (N)' mirrors the filtered length, not the signal length — matches UI-SPEC.md's semantic meaning of 'active'."
  - "[Plan 05-10] SSE lifecycle cleanup includes off+stop (not just stop) per Plan 08 contract — offSseEvent removes the specific handler reference so component re-mounts during HMR don't stack duplicate dispatch handlers against the same listener function."
  - "[Plan 05-10] HomeView fetch-on-expand keeps TreeSidebar pure. Plan 09 explicitly lifted expand state to the parent; the same pattern holds for fetch-on-expand. ChildrenCache is a single useState record, not three separate signals, because it is strictly an HTTP cache with no cross-component consumers. When a future plan needs cross-view sharing, the cache can migrate to a signal without touching TreeSidebar's contract."
metrics:
  duration_minutes: 12
  task_count: 2
  file_count: 7
  commits: 1
  tests_added: 0
  tests_passing_dashboard: 19
  tests_passing_root: "not re-run (pre-existing better-sqlite3 bindings issue — see Known Issues)"
  lines_added: 817
  completed_date: "2026-04-23"
requirements-completed: [WEBUI-01, WEBUI-02, WEBUI-03]
---

# Phase 5 Plan 10: Compose Views + App Entry + Verified Vite Build Summary

**Preact view layer composing Plan 09 primitives against Plan 08 signals — HomeView (tree + shot grid), VersionDrawer (timeline + provenance + diff), DiffDrawer (before/after cards), ActiveGenerationsPanel (live SSE panel), App (SSE lifecycle), main (entry). `npm run build:dashboard` now produces a 38.55 kB JS + 21.70 kB CSS bundle.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-23T13:35:00Z (executor boot)
- **Completed:** 2026-04-23T13:47:00Z (SUMMARY commit)
- **Tasks:** 2/2
- **Files created:** 7 (4 views + App + main + shape helper)
- **Files modified:** 0 (strictly additive plan; index.html / vite.config.ts / theme.css / existing components untouched)

## Accomplishments

- **4 view components** composing Plan 09 primitives:
  - `HomeView` — two-pane layout with lazy-hydrated TreeSidebar (fetches projects/sequences/shots on expand) + shot-detail VersionCard list + VersionDrawer overlay. Hydrates workspaces on mount and versions on shot selection change.
  - `VersionDrawer` — 560px right-rail drawer rendering version label + StatusPill, timeline (created/completed timestamps), lazy-fetched provenance events via JsonBlock, and a "View Diff" button that opens the DiffDrawer with the prior version (by version_number) as "before".
  - `DiffDrawer` — 720px 2nd-level drawer showing before/after VersionCards side-by-side + optional diff summary text. Pure presentation; no fetch.
  - `ActiveGenerationsPanel` — right-rail panel reading `activeGenerations.value`, filtered to queued/running rows. Label count `Active Generations (N)` reflects the filtered length.
- **App.tsx + main.tsx** wire the app:
  - App.tsx owns the SSE lifecycle (`startSse` + `onSseEvent('version.created', onVersionCreated)` + `onSseEvent('version.status_changed', onVersionStatusChanged)` in a single useEffect; cleanup calls `offSseEvent` + `stopSse`).
  - main.tsx reads `localStorage['vfx-familiar:theme']`, falls back to 'dark' per contract, renders `<App />` into `#app`.
- **lib/shape.ts helpers** — 3 small, typed functions bridging the Plan 08 server shapes to the Plan 09 primitive prop shapes without touching either file: `versionLabel(v)`, `normalizeStatus(raw)`, `unwrapList<T>(raw)`.
- **Vite build verified** — `npm run build:dashboard` exits 0; dist/ contains `index.html` + `assets/index-*.css` (21.70 kB) + `assets/index-*.js` (38.55 kB) + @fontsource woff2/woff font files. Tailwind v4 design tokens compiled into the CSS bundle; Preact tree-shaken icons from lucide-preact inlined.
- **All 19 dashboard tests green** — Plan 08's 5 events + 5 active-generations tests and Plan 09's 9 TreeSidebar tests pass unchanged. No test regressions.
- **Architecture-purity test green** — root `src/__tests__/architecture-purity.test.ts` 14/14 pass, including the Dashboard source boundary (D-WEBUI-31) assertion across the 7 new files.
- **Zero `dangerouslySetInnerHTML` usage** in any view (only comment references exist, documenting its absence).

## Task Commits

1. **Task 1: Create views + App + main.tsx** — `9660ec4` (feat)

**Task 2: Verify Vite build** — verification-only task; no source changes, no commit. `npm run build:dashboard` exits 0 and produces a working bundle under `packages/dashboard/dist/`.

## Files Created

| Path                                                         | Lines | Purpose                                                                                                    |
| ------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------- |
| `packages/dashboard/src/App.tsx`                             | 58    | Root layout + SSE lifecycle (startSse / stopSse + on+offSseEvent bridge) + view routing                    |
| `packages/dashboard/src/main.tsx`                            | 34    | Vite entry; reads localStorage['vfx-familiar:theme'] with 'dark' fallback; renders `<App />` into `#app`   |
| `packages/dashboard/src/lib/shape.ts`                        | 69    | `versionLabel()`, `normalizeStatus()`, `unwrapList()` helpers                                              |
| `packages/dashboard/src/views/ActiveGenerationsPanel.tsx`    | 55    | Right-rail panel reading activeGenerations signal, filtered to queued/running                              |
| `packages/dashboard/src/views/DiffDrawer.tsx`                | 111   | Before/after VersionCard pair + optional diff summary text; 720px drawer                                   |
| `packages/dashboard/src/views/HomeView.tsx`                  | 282   | Two-pane: TreeSidebar (lazy-hydrated) + shot-detail VersionCard grid + VersionDrawer overlay               |
| `packages/dashboard/src/views/VersionDrawer.tsx`             | 208   | Version detail: timeline + lazy-fetched provenance + View Diff button; 560px drawer                        |
| **Total**                                                    | **817** |                                                                                                          |

No existing files modified. `packages/dashboard/index.html` and `packages/dashboard/vite.config.ts` from Plan 01 are untouched per plan directive.

## Decisions Made

See frontmatter `decisions:` block for full rationale. High-level:

1. **Adapt sketch code to real APIs** — Plan's `fetchDiff` / `fetchProvenance` were sketches; used `diffVersion(a, against)` + `getProvenance(id)` from the real api.ts.
2. **Add lib/shape.ts** — Three helpers (`versionLabel`, `normalizeStatus`, `unwrapList`) bridge the Plan 08 ↔ Plan 09 shape boundary. Not explicitly in the plan's file list; necessary to avoid duplicating ~30 lines of mapping logic across views.
3. **Defensive `unwrapList<T>`** — Handles both ListResult wrapper and bare array because Plan 08's api.ts typing drift is known but Plan 08's file belongs to that plan's domain.
4. **Canonical theme tokens** — Used `--color-fg` / `--color-fg-muted` per UI-SPEC.md and theme.css, not the plan sketch's `--color-text-primary` / `--color-text-secondary`.
5. **Filter terminals in ActiveGenerationsPanel** — Count reflects queued/running; terminals are retained in the signal but masked by the panel.
6. **SSE cleanup includes off+stop** — Prevents duplicate dispatch wrappers during HMR.
7. **ChildrenCache in useState, not signals** — HTTP cache scoped to HomeView; migrate to a signal only when cross-view sharing is actually needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Semantic fix] API method names — plan sketch used `fetchDiff` / `fetchProvenance`; actual exports are `diffVersion(a, against)` / `getProvenance(id)`**

- **Found during:** Task 1, writing VersionDrawer (first view with fetch calls).
- **Issue:** Plan's sketch code in the `<action>` block imported `fetchDiff` and `fetchProvenance` from `../lib/api.js`. Those names do not exist — the exported symbols are `diffVersion(versionId, against)` (returns structured `{summary, changes}`, requires explicit "against" id) and `getProvenance(versionId)` (returns `{events, breadcrumb}`). The plan's sketch was illustrative, not a binding contract — the must-have frontmatter specifies behavior (renders provenance section / renders before-after cards), not API surface.
- **Fix:** VersionDrawer uses `getProvenance(version.id)` and `diffVersion(priorVersion.id, version.id)`. The "prior version" is computed in HomeView (by scanning the versions list for the largest `version_number` less than the current) and passed as a `priorVersion` prop so the drawer does not itself need to know about the shot's version set.
- **Files modified:** `packages/dashboard/src/views/VersionDrawer.tsx` (new), `packages/dashboard/src/views/HomeView.tsx` (new).
- **Verification:** `npx tsc --noEmit` clean; dashboard test suite unchanged (19/19 green); Vite build exits 0.
- **Committed in:** `9660ec4` (Task 1).

**2. [Rule 1 - Semantic fix] Theme token names — plan sketch used `--color-text-primary` / `--color-text-secondary`; canonical tokens are `--color-fg` / `--color-fg-muted`**

- **Found during:** Task 1, writing the view styles.
- **Issue:** Plan's sketch JSX used class strings like `text-[var(--color-text-primary)]` and `text-[var(--color-text-secondary)]`. `theme.css` (Plan 09) defines `--color-fg` (#fff), `--color-fg-muted` (#999), and `--color-fg-dim` (#666) per UI-SPEC.md's Foreground color role table. The `-text-primary` / `-text-secondary` names are not declared anywhere; classes referencing them would compile but render with `unset` at runtime (inherited white, muted gray not applied).
- **Fix:** All views use the canonical theme tokens: primary body text → `text-[var(--color-fg)]`, muted helper text → `text-[var(--color-fg-muted)]`. This also matches Plan 09's own convention — SUMMARY 05-09 documents the same correction for `JsonBlock` (uses `--color-fg-muted` not `--color-text-secondary`).
- **Files modified:** All 4 view files + App.tsx.
- **Verification:** Vite build exits 0; CSS bundle includes the @theme token definitions from theme.css; inspection of the built CSS shows the token references resolve cleanly.
- **Committed in:** `9660ec4` (Task 1).

**3. [Rule 2 - Missing critical] Added `packages/dashboard/src/lib/shape.ts` with 3 helpers (`versionLabel`, `normalizeStatus`, `unwrapList`)**

- **Found during:** Task 1, writing HomeView's version-card loop.
- **Issue:** Plan 08's `types/entities.ts::Version` shape has `version_number: number` (no `label`) and `status?: 'submitted' | 'running' | 'completed' | 'failed' | 'queued' | 'complete'` (superset union). Plan 09's `VersionCard` / `VersionCardVersion` requires `{ id, label: string, status: Status }` where `Status = 'queued' | 'running' | 'complete' | 'failed'` (narrow union — StatusPill's STATUS_STYLES map has exactly those four keys, any other value renders unstyled). HomeView also needs to map the server ListResult wrapper `{items, total_count, ...}` down to a flat `T[]` for iteration. Without these three helpers each view would repeat ~10 lines of the same mapping logic.
- **Fix:** Created `packages/dashboard/src/lib/shape.ts` with three small functions:
  - `versionLabel(v)` — `v${String(version_number).padStart(3,'0')}` (mirrors server-side `versionLabel()` in `src/tools/shared.ts`, duplicated per D-WEBUI-31 no-cross-tree rule).
  - `normalizeStatus(raw)` — maps `submitted → queued`, `completed → complete`, passthrough for matching values, defensive fallback to `queued` for unknowns.
  - `unwrapList<T>(raw)` — accepts `T[]` OR `{items: T[]}`, returns flat `T[]`. Handles the Plan 08 api.ts typing drift (server returns ListResult wrapper, api.ts types as `T[]` — documented in 05-08-SUMMARY.md threat flags).
- **Files modified:** `packages/dashboard/src/lib/shape.ts` (new).
- **Verification:** `npx tsc --noEmit` clean; used by HomeView + VersionDrawer + DiffDrawer indirectly via versionLabel + normalizeStatus.
- **Committed in:** `9660ec4` (Task 1).

**4. [Rule 2 - Missing critical] SSE cleanup returns `offSseEvent` + `stopSse` (plan sketch only had `stopSse`)**

- **Found during:** Task 1, writing App.tsx.
- **Issue:** Plan sketch's useEffect cleanup was `return () => { stopSse(); };`. During Vite HMR (dev-server module reload) or StrictMode double-invocation, `App` remounts without `stopSse` unwinding the listeners Map — the old handler reference stays bound to the dispatch wrapper via `onSseEvent('version.created', onVersionCreated)`. On remount, `onSseEvent` is called again; the listeners Set now contains the same handler function twice. Every SSE frame would fire the handler twice, duplicating `activeGenerations` entries.
- **Fix:** Cleanup now calls `offSseEvent('version.created', onVersionCreated)` + `offSseEvent('version.status_changed', onVersionStatusChanged)` + `stopSse()`. `offSseEvent` is a `Set.delete` on the listeners Map; remount calls `onSseEvent` on a freshly-emptied Set, so no duplication.
- **Files modified:** `packages/dashboard/src/App.tsx`.
- **Verification:** `npx tsc --noEmit` clean; dashboard test suite unaffected (events.test.ts covers `offSseEvent` semantics, 5/5 green).
- **Committed in:** `9660ec4` (Task 1).

**5. [Rule 2 - Missing critical] ActiveGenerationsPanel filters terminal statuses**

- **Found during:** Task 1, writing ActiveGenerationsPanel.
- **Issue:** Plan sketch rendered `activeGenerations.value` directly — but the signal by contract retains terminal rows (`'complete'` / `'failed'`) per Plan 08's behavior ("terminal filtering is the panel's responsibility"). Without a filter, a long-running session would accumulate completed/failed rows in the panel forever (Plan 08 SUMMARY explicitly flagged this as the panel's job).
- **Fix:** Panel filters to `g.status === 'queued' || g.status === 'running'` and uses the filtered length for the `Active Generations (N)` count label. Matches UI-SPEC.md's semantic "active" meaning.
- **Files modified:** `packages/dashboard/src/views/ActiveGenerationsPanel.tsx`.
- **Verification:** Typechecks clean; behavior aligns with Plan 08's documented handoff note.
- **Committed in:** `9660ec4` (Task 1).

---

**Total deviations:** 5 auto-fixed (2 Rule 1 semantic fixes, 3 Rule 2 missing critical).

**Impact on plan:** None expand scope. Every deviation closes a correctness/compatibility gap that would otherwise have broken the must-haves (status pills would not render without normalizeStatus; version-card grid would not render without versionLabel; SSE remount would duplicate entries without offSseEvent; panel would accumulate terminals without filtering). Zero architectural churn; all within packages/dashboard/src/** and Plan 10's declared `files_modified` surface (the shape.ts helper is an implicit additive — not in the plan's explicit file list but consistent with the plan's Plan-08-data-layer dependency pattern).

## Issues Encountered

- **Better-sqlite3 native binding missing.** Running the full root test suite (`npx vitest run`) surfaced 359 failing tests with errors like `Could not locate the bindings file. Tried: .../node_modules/better-sqlite3/build/Release/better_sqlite3.node`. Root cause: the worktree was bootstrapped with `npm ci --ignore-scripts`, so better-sqlite3's postinstall `prebuild-install` step never ran. This is an **infrastructure concern outside Plan 10's scope** — none of my changes touch the server tree, SQLite code, or better-sqlite3 usage. Verified by:
  - `git diff --stat` — zero modifications to any server file.
  - Direct src/http test subset (`npx vitest run src/http/__tests__/`) — 82/82 green (these tests use only the FakeEngine / do not instantiate a real Database).
  - Root architecture-purity test alone — 14/14 green.
  - Dashboard test suite — 19/19 green.
  Classified as a **deferred infrastructure issue** per the "scope boundary" clause of the deviation rules; not fixed by this plan.

- **Write tool ↔ filesystem desync.** During Task 1, the Write tool reported "File created successfully" but the files did not appear on the actual filesystem (verified via `ls`, `cat`, `test -f`, `find`). The Read tool, however, returned my written content — meaning the Write tool was writing to a virtual layer instead of the real worktree. Fell back to `cat > file << 'EOF' ... EOF` heredoc via Bash (which persists correctly). All 7 source files were written through this fallback path. tsc + vitest + vite build all verify against the real on-disk files. No source-level impact on the plan; flagged here for operator awareness.

## Auth Gates

None. The dashboard calls only same-origin `/api/*` endpoints (no auth surface — local-first, 127.0.0.1 bind per D-WEBUI-32). No external service dependencies.

## Deferred Issues

- **Plan 08 api.ts list shape drift** — `fetchWorkspaces` / `fetchProjects` / `fetchSequences` / `fetchShots` / `fetchVersions` are typed `Promise<T[]>` but the server returns `{items, total_count, limit, offset}` (ListResult wrapper). Views work around this today via `unwrapList<T>()` in `shape.ts`. A follow-up (Plan 11 or a dedicated api.ts fix) should widen the typings to `Promise<ListResult<T>>` and adjust callers. `unwrapList` continues to work against the corrected shape without further view churn.
- **Camel/snake case drift on SSE payloads** — Plan 08 SUMMARY documented that dashboard types (`versionId` / `shotId` / `label`) are camelCase while the live server SSE stream is snake_case. Plan 10 does not exercise this at runtime (the tests drive signals directly); the drift is still open for Plan 11 to resolve (preferred: server adds camelCase aliases at the SSE dispatcher; alternate: dashboard adds a normalising layer at lib/events.ts).
- **Better-sqlite3 rebuild** — noted above; unrelated to Plan 10.

## Known Stubs

None. Every new file is production code:

- `App.tsx` — real SSE lifecycle, real bridge handlers.
- `main.tsx` — real render + real theme bootstrap.
- `lib/shape.ts` — three real utility functions; no placeholders.
- `views/*.tsx` — four real components, each rendering dynamic data from signals + lazy-fetch paths.
- No "coming soon" / "TODO" / "placeholder" strings anywhere.

Note: DiffDrawer renders a `diff.summary` string today (server's one-line DiffResponse.summary field). A richer diff visualization (param-by-param / model-by-model color diff) is documented by UI-SPEC.md as a future enhancement — not a stub, because the plan's must-have explicitly says "before/after version cards side by side" (which is what ships). The current implementation is the minimum the must-have describes; it renders real data from a real endpoint.

## Threat Flags

The plan's threat register (`T-5-06` mitigate / `T-5-05` accept) holds:

- **T-5-06 (Tampering / XSS via API → view render):** Every view renders external data — workspace/project/sequence/shot names in `TreeSidebar` via `{label}` children, version labels in `VersionCard`, status strings in `StatusPill`, provenance JSON in `JsonBlock` via `{JSON.stringify(data, null, 2)}`, diff summary in `DiffDrawer` via `{diff.summary}`, active-generation labels in `ActiveGenerationsPanel` via `{g.label}`. All flow as JSX text children (Preact auto-escapes). Zero `dangerouslySetInnerHTML=` usage (verified by grep; the only `dangerouslySetInnerHTML` substring matches are in docstrings explicitly documenting its absence).
- **T-5-05 (Elevation of Privilege / no auth on /api/workspaces):** Accepted per D-WEBUI-32. Local-first 127.0.0.1 bind means no external access surface; the plan's disposition is unchanged.

No new threat surface introduced. All views are read-only except the View Diff button (POST-less: diff is a GET with `against=` query param) and the implicit SSE subscription (read-only event stream).

## Plan 05-11 / Plan 05-12 Handoff Notes

**Plan 05-11 (SSE + reproduce):** adds a "Reproduce Version" button alongside "View Diff" in `VersionDrawer.tsx`'s header. Wires to `api.reproduceVersion(version.id)` which returns the new `version_id`. The SSE stream (already wired in App.tsx) will fire `version.created` for the new version; `onVersionCreated` pushes it into `activeGenerations` and the panel updates live. The hook surface for Plan 11 is:

```typescript
// VersionDrawer.tsx — header button group, next to View Diff
<button onClick={async () => { await reproduceVersion(version.id); /* navigation? */ }}>
  Reproduce Version
</button>
```

No additional SSE wiring needed — App.tsx already subscribes both events.

**Plan 05-12 (static bundle + Hono mount):** `npm run build:dashboard` now produces `packages/dashboard/dist/` with a working bundle. Plan 12 adds the Hono static route mounting `dist/` at `/` (not `/dashboard/`). The existing `src/http/static.ts` already scaffolds the static handler; Plan 12 wires it to `packages/dashboard/dist/` and verifies the `/` → `dist/index.html`, `/assets/*` → `dist/assets/*` routes round-trip.

Bundle sizes (for Plan 12's reference — must stay within the UI-SPEC.md bundle budget):

- `index-*.js` — 38.55 kB (gzip 13.46 kB)
- `index-*.css` — 21.70 kB (gzip 4.89 kB)
- @fontsource woff2 files: 6 × ~10-35 kB each (latin, latin-ext, greek, cyrillic, cyrillic-ext — Inter 400/600 + Inter Tight 600)

Total on-the-wire for a cold cache (uncompressed): ~500 kB including fonts; ~60 kB including only the main JS+CSS (fonts stream lazily). Gzipped critical path: ~18 kB.

## Verification Evidence

```
$ cd packages/dashboard && npx tsc --noEmit
# exit 0; zero errors

$ cd packages/dashboard && npx vitest run
 Test Files  3 passed (3)
      Tests  19 passed (19)
   Duration  586ms

$ npx vitest run src/__tests__/architecture-purity.test.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)

$ grep -rn 'dangerouslySetInnerHTML=' packages/dashboard/src/
# no matches (only docstring references)

$ grep -rn "from '\.\./\.\./\(\.\./\)\?src\(/\|'\)" packages/dashboard/src/
# no matches (no server-tree traversal imports)

$ npm run build:dashboard
...
dist/assets/index-oqCE3cPV.css  21.70 kB │ gzip:  4.89 kB
dist/assets/index-zoyhvWiF.js   38.55 kB │ gzip: 13.46 kB
✓ built in 153ms
# exit 0; dist/index.html + dist/assets/ populated
```

## Success Criteria Check

- [x] All 4 view components exist and TypeScript compiles cleanly — `packages/dashboard/src/views/{HomeView,VersionDrawer,DiffDrawer,ActiveGenerationsPanel}.tsx` present; tsc --noEmit exits 0.
- [x] App.tsx wires SSE start/stop via useEffect — `startSse()` on mount, `stopSse()` + `offSseEvent` cleanup on unmount.
- [x] main.tsx sets data-theme before first render using 'vfx-familiar:theme' localStorage key — reads key, falls back to 'dark', writes to `document.documentElement[data-theme]` before `render(<App />, root)`.
- [x] Vite build exits 0 and dist/ contains index.html — `npm run build:dashboard` exits 0; `dist/index.html` + `dist/assets/*.{css,js}` + fonts present.
- [x] Full dashboard test suite green — 19/19 pass (10 events/signals + 9 TreeSidebar).
- [x] Zero dangerouslySetInnerHTML in any file — grep for `dangerouslySetInnerHTML=` returns no matches in source (docstring occurrences don't count).
- [x] index.html and vite.config.ts from Plan 01 are not modified — `git diff --stat` confirms zero changes to either file.

## Self-Check: PASSED

All created files verified on disk:

- `packages/dashboard/src/App.tsx` — FOUND (58 lines)
- `packages/dashboard/src/main.tsx` — FOUND (34 lines)
- `packages/dashboard/src/lib/shape.ts` — FOUND (69 lines)
- `packages/dashboard/src/views/ActiveGenerationsPanel.tsx` — FOUND (55 lines)
- `packages/dashboard/src/views/DiffDrawer.tsx` — FOUND (111 lines)
- `packages/dashboard/src/views/HomeView.tsx` — FOUND (282 lines)
- `packages/dashboard/src/views/VersionDrawer.tsx` — FOUND (208 lines)

Commits verified in git log:

- `9660ec4` — FOUND (`feat(05-10): compose views + App + main.tsx (HomeView, VersionDrawer, DiffDrawer, ActiveGenerationsPanel)`)

Build verified:

- `packages/dashboard/dist/index.html` — FOUND
- `packages/dashboard/dist/assets/index-oqCE3cPV.css` — FOUND (21.70 kB)
- `packages/dashboard/dist/assets/index-zoyhvWiF.js` — FOUND (38.55 kB)

---

*Phase: 05-web-dashboard*
*Plan: 10*
*Completed: 2026-04-23*
