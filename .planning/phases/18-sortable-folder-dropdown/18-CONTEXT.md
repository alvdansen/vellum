# Phase 18: Sortable Folder Dropdown - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

A `<SortDropdown/>` component (Phase 17 thin-wrapper pattern) wires a 4-option sort control to two dashboard surfaces — the version grid (default: Latest = `completed_at DESC`) and the TreeSidebar (default: A→Z = `name ASC`) — with sort preference persisted per-pane in `localStorage` (`vfx-familiar:sort:grid`, `vfx-familiar:sort:tree`) and mirrored in URL state (`?gridSort=…&treeSort=…`) for shareable views. Engine-side `ORDER BY` uses a whitelisted enum, hierarchy lists gain `name | created_at` × `asc | desc`, and version listing migrates from `limit/offset` to composite-cursor pagination `(completed_at IS NULL DESC, completed_at, version_id)` with a "Load more" button on the grid. No new MCP tools — tool count holds at 7 of 12. Append-only provenance untouched (sort is a read-only re-projection over existing data). AI conversational summary (Phase 19), per-shot sort persistence, "recently active" sort, and dropdown infinite scroll are explicitly out of scope.

</domain>

<decisions>
## Implementation Decisions

### NULL completed_at handling (in-progress version pinning)
- **D-01:** In-progress versions (`completed_at IS NULL`) are ALWAYS pinned to the top of the version grid, regardless of sort direction. Both "Latest" (DESC) and "Oldest" (ASC) use NULLS FIRST. UX rule: in-flight work is never buried.
- **D-02:** In-progress band sub-sorted by `created_at DESC` — most recently kicked-off render at the top of the pinned band.
- **D-03:** Composite cursor `ORDER BY` shape: `(completed_at IS NULL) DESC, completed_at <dir>, version_id ASC`. The first sort key is the NULL-bit pin; the third key is the nanoid tiebreaker (SORT-05). All three appear in the cursor payload.
- **D-04:** Phase 17 `<SkeletonThumbnail/>` (160×90 default; in-progress card uses the existing skeleton variant) naturally surfaces at the top of the grid for the pinned in-progress band — no new component needed for the pinned-state visual.
- **D-05:** "Name A→Z" and "Version ↓" sorts: `name` and `version_number` are non-null in the schema, so NULLS FIRST is a no-op for those keys. Composite cursor still includes the NULL-bit term for shape consistency, but it never partitions rows under those sort keys.

### Tree sidebar sort control
- **D-06:** TreeSidebar gets a visible sort control: ONE shared `<SortDropdown/>` rendered above the `<nav aria-label="Project hierarchy">` element. Tree-wide — applies recursively to all 4 hierarchy levels (workspaces / projects / sequences / shots).
- **D-07:** 4 options matching the version-grid pattern: A→Z (name ASC, default), Z→A (name DESC), Newest (created_at DESC), Oldest (created_at ASC). Hierarchy levels don't have `completed_at` or `version_number`, so the tree dropdown's enum is narrower than the grid's.
- **D-08:** Same `<SortDropdown/>` component instance is reused — NOT a separate `<TreeSortDropdown/>`. Component takes a prop for the available options array; grid passes the 4-option grid set, tree passes the 4-option tree set.
- **D-09:** Per-level toggling (each hierarchy level having its own sort control) is OUT OF SCOPE. Single tree-wide sort applies recursively. Per-level deferred to v1.3 if user demand surfaces.
- **D-10:** Engine `listProjects/listSequences/listShots` in `src/store/hierarchy-repo.ts` (currently fixed `created_at ASC, id ASC`) gain a `sort: { field: 'name' | 'created_at', dir: 'asc' | 'desc' }` parameter with whitelist enum. Default unchanged for callers that don't pass `sort` (back-compat for asset-tool's `listProjects` callers).
- **D-11:** Tree sort persisted at key `vfx-familiar:sort:tree` (matches `vfx-familiar:theme` precedent from `ThemeToggle`). One key for the entire tree, not per-level.

### URL state mirror format & precedence
- **D-12:** URL shape: separate query parameters — `?gridSort=completed_at:desc&treeSort=name:asc`. Each pane gets its own param. Sets the precedent for future URL state additions (e.g., `?selected=ver_…`); keeps the URL grammar extensible without locking into a comma-grammar combined param.
- **D-13:** Precedence on first load: URL wins; localStorage stays UNTOUCHED. Shareable links don't hijack personal preferences. If user A shares a link with `?gridSort=oldest:asc`, user B's grid renders that sort but their `vfx-familiar:sort:grid` value is preserved. If user B then clicks the dropdown to change sort, BOTH localStorage AND URL update going forward.
- **D-14:** Update mechanism: `history.replaceState` on every sort change. Sort is a view setting, not a navigation event. Back button must NOT replay sort toggles. Matches Linear / Figma / GitHub PRs filter conventions.
- **D-15:** URL ALWAYS shows current sort explicitly — even when both panes are at defaults. Default-state URL is `?gridSort=completed_at:desc&treeSort=name:asc`, never `/`. Rationale: deterministic shareable links — user A explicitly resetting to defaults and sharing the URL must produce the same view for user B regardless of B's localStorage. Cost: noisier URL on first visit, accepted for the determinism win.
- **D-16:** URL param value sanitization: validated against the same whitelist as the engine ORDER BY enum. Malformed values (e.g., `?gridSort=DROP_TABLE`) → fallback to default sort, log a warning, do NOT throw or break the page. Defence-in-depth at the URL parse boundary mirrors the engine's whitelist enforcement.

### Pagination UX (version grid)
- **D-17:** Surface = "Load more" button. Small button at the bottom of the version list with text "Load N more (M remaining)". Triggers next-page fetch on click. Cursor encoded in fetch params.
- **D-18:** First page size = 20 (matches CLAUDE.md "Paginate all list queries (default 20, include total count)" convention). Same default for subsequent pages.
- **D-19:** Sort change → cursor reset to page 1 (per SORT-05) AND scroll position snaps to top of the version list. Consistent "fresh sort, fresh view" UX. The grid's parent scroll container is the `<main>` element in `HomeView.tsx`; reset its `scrollTop` to 0 on sort change.
- **D-20:** In-progress pinning is a PAGE-1 behavior. Subsequent pages (Load more) append completed-only rows. Composite cursor naturally enforces this — once page 1 has paginated past the NULL band, the cursor encodes the last `completed_at + version_id` and the next page's WHERE clause excludes the NULL band.
- **D-21:** Today: `HomeView.tsx` calls `fetchVersions(shotId)` without pagination params and renders ALL versions (`versions.value = unwrapList(raw)`). Phase 18 changes this contract — `fetchVersions` returns `{ items, next_cursor, total_count }` and `versions` signal becomes a paginated buffer. Phase 17's `latestCompletedForSelectedShot` derivation in `HomeView.tsx:207` (uses `versions.value.find(v => normalizeStatus(v.status) === 'complete')`) must continue to work — page 1 with in-progress pinned still contains a `complete` row in the typical case (unless ALL completed are below page 1 on a >20-version shot, which the planner addresses).
- **D-22:** GET endpoint stays GET; cursor as query param. No POST migration. Preserves existing route shape and same-origin caching.

### localStorage scope strategy
- **D-23:** Two scope keys (per the smart-default-per-scope rule): `vfx-familiar:sort:grid` (version grid) and `vfx-familiar:sort:tree` (TreeSidebar). Global per-pane, NOT per-shot (per-shot is explicitly out-of-scope per REQUIREMENTS.md "Per-shot sort persistence").
- **D-24:** localStorage value shape: JSON `{ field: 'completed_at', dir: 'desc' }` (object, not opaque string). Allows future field additions without bumping a version key. Validated on read against the same whitelist as the engine ORDER BY enum; invalid values → reset to default + log a warning.
- **D-25:** SORT-03's "bounded keys with LRU eviction at quota" — only TWO sort keys exist in v1.2 (grid + tree), so the quota concern is theoretical. The LRU primitive must still ship for forward-compat (Phase 19 may add `summary:` keys; future phases may add per-shot keys). Helper: `setBoundedLocalStorageEntry(prefix, key, value, maxKeys)` evicts the least-recently-used `prefix:*` key when count exceeds `maxKeys`. Suggested cap: 50.

### Claude's Discretion
- `<SortDropdown/>` component implementation details: keyboard navigation (Arrow up/down, Escape), accessible role/state, focus ring styling, dark/light theme via existing CSS variables. Match Phase 17 `<Thumbnail/>` / `<C2paShield/>` thin-wrapper polish. Native `<select>` is acceptable as a fallback if custom dropdown introduces complexity, but the recommendation is custom for visual parity with the rest of the dashboard.
- Cursor encoding format: opaque base64-encoded JSON `{ completed_at: 1735689600000, version_id: "ver_abc123def456" }` (industry standard pattern — GitHub API, Linear API, Stripe). Server can change cursor shape later without client coordination.
- "Load more" button loading state: skeleton card row OR button-internal spinner (`<Spinner/>` doesn't exist yet — planner picks). Disabled state when `isFetching === true`.
- "Load more" button error handling: inline error pill below button with "Retry" action. Mirrors Phase 12 `<WarningPill/>` color token usage. Toast NOT required (no toast system today).
- Total count display in "Load more" button: "Load 20 more (32 remaining)" preferred over "Page 2 of 8" — matches the cursor model and stays accurate even if total shifts mid-session.
- Initial fetch shape: `fetchVersions(shotId, { sort, cursor?, limit })` returning `{ items, next_cursor, total_count, has_more }`. Engine layer adds `next_cursor` to the existing `{ items, total_count }` shape from `version-repo.ts:listByShot`.
- HTTP route migration: `GET /api/shots/:id/versions` gains `?sort=completed_at:desc&cursor=…&limit=20`. `total_count` continues; `next_cursor` is a new field; `cursor` query param is opaque to the dashboard. The 18-route `api.ts` catalog (`fetchVersions`) updates type signatures.
- Tree sort propagation: when user changes tree sort, the lazy-loaded `children` cache in `HomeView.tsx` (`children.projects`, `children.sequences`, `children.shots`) must re-fetch under the new sort key. OR: re-sort client-side from already-fetched arrays (purely visual, server stays consistent on re-fetch). Recommended: client-side re-sort (faster, no extra fetches, matches the dashboard's local-cache philosophy); server sort enforced on initial fetch + on shot select.
- URL parse error mode: graceful fallback to default + console warning, NEVER throw. Defence-in-depth.
- localStorage write failure (private browsing / quota exceeded): silently fall through to default behavior. Existing pattern: `main.tsx` already wraps localStorage reads in try/catch ("localStorage may be unavailable in some privacy modes — fall through.").
- ARIA labelling for the dropdown: `aria-label="Sort versions by"` on grid, `aria-label="Sort tree by"` on tree. Selected state announced via `aria-selected` on options.
- Naming convention for the engine ORDER BY enum: `SortField = 'completed_at' | 'created_at' | 'name' | 'version_number'`, `SortDirection = 'asc' | 'desc'`. Hierarchy variant: `HierarchySortField = 'name' | 'created_at'`. Both exported from `src/store/types.ts` (or new `src/store/sort.ts`). Reused by HTTP layer's URL parser, dashboard's localStorage reader, and engine repos.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.2 milestone scope and constraints
- `.planning/REQUIREMENTS.md` §"Sortable Folder Dropdown (SORT)" — SORT-01..05 (this phase); cross-cutting constraints lock tool cap at 7 of 12, append-only provenance, architecture-purity allowed-set extensions, multi-encoding leak scan, dual-transport parity
- `.planning/ROADMAP.md` §"Phase 18: Sortable Folder Dropdown" — 4 success criteria (latest-first default + smart-default-per-scope, 4-option whitelist enum, localStorage + URL mirror, composite cursor pagination stability)
- `.planning/PROJECT.md` §"Current Milestone: v1.2 Visual & Conversational Dashboard" — milestone driver (artist feedback), pivot context, v1.2 scope envelope, "different sorting options so you can pull up latest generations quickly" verbatim user quote

### Prior-phase decisions to carry forward
- `.planning/phases/17-visual-thumbnails/17-CONTEXT.md` — Phase 17 component patterns (`<Thumbnail/>`, `<C2paShield/>` thin-wrapper precedent for `<SortDropdown/>`); `<SkeletonThumbnail/>` as the in-progress visual that surfaces at the top of the grid under the new pinned-NULL behavior; `versions.value` signal contract that Phase 18 modifies (`HomeView.tsx:207` `latestCompletedForSelectedShot` derivation must keep working)
- `.planning/phases/17-visual-thumbnails/17-SUMMARY.md` (when written by verifier) — Phase 17 implementation notes that may inform Phase 18

### Code precedent (patterns to mirror)
- `packages/dashboard/src/components/Thumbnail.tsx` — Phase 17 thin-wrapper component shape that `<SortDropdown/>` mirrors
- `packages/dashboard/src/components/ThemeToggle.tsx` — localStorage read/write pattern with try/catch for privacy-mode safety; key naming precedent (`vfx-familiar:theme` → `vfx-familiar:sort:grid` / `vfx-familiar:sort:tree`)
- `packages/dashboard/src/main.tsx:14-30` — pre-paint localStorage read pattern (`vfx-familiar:theme` is read inline before first render to prevent FOUC); applies to sort initial-state hydration
- `packages/dashboard/src/lib/api.ts:148-165` (`fetchVersions` + `FetchVersionsParams`) — current endpoint shape that Phase 18 extends; `qs()` helper handles undefined values cleanly
- `packages/dashboard/src/views/HomeView.tsx:99-117` — current `fetchVersions(shotId)` consumer that needs to migrate to `{ items, next_cursor, total_count }`
- `packages/dashboard/src/views/HomeView.tsx:194-218` — `latestCompletedForSelectedShot` derivation that depends on `versions.value` containing at least one `complete` row (Phase 17 thumbnail wiring on TreeSidebar shot rows)
- `packages/dashboard/src/components/TreeSidebar.tsx` — pure component that gets `<SortDropdown/>` rendered above its `<nav>` element via the parent (`HomeView.tsx`); the component itself stays pass-through-props (no signal reads)
- `src/store/version-repo.ts:202-221` (`listByShot`) — current `version_number DESC` + `limit/offset` shape that Phase 18 migrates to whitelist-enum sort + composite cursor
- `src/store/version-repo.ts:232-240` (`listRecentCompleted`) — already does `completed_at DESC` (with no NULL handling, since it filters `status='completed'`); reference for the engine-side ORDER BY pattern but NOT a direct caller
- `src/store/hierarchy-repo.ts:133-165` (`listProjects`), `:205-237` (`listSequences`), `:279-…` (`listShots`) — fixed `created_at ASC, id ASC` ordering; Phase 18 adds `sort` parameter with whitelist enum
- `src/http/dashboard-routes.ts` `GET /api/shots/:id/versions` — HTTP route that gains `?sort=…&cursor=…&limit=…` query parsing; existing `/output` route is the same-shape precedent for new query param handling

### Cross-cutting
- `CLAUDE.md` §"Conventions" — "Paginate all list queries (default 20, include total count)" locks the page-size default
- `CLAUDE.md` §"Architecture Rules" — "Tool cap: Maximum 12 MCP tools" (Phase 18 holds at 7 of 12, dashboard-only feature)
- `src/__tests__/architecture-purity.test.ts` — sole-importer pattern for native bindings; Phase 18 likely adds NO new external deps (sort logic is pure SQL whitelist + dashboard-side state mgmt), so no new allowed-set entries needed. Confirm during planning.
- `packages/dashboard/src/state/versions.ts` (and `state/hierarchy.ts`) — `@preact/signals` state container; sort state lives here (new `gridSort`, `treeSort` signals) per the existing pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`<ThemeToggle/>` localStorage pattern** (`packages/dashboard/src/components/ThemeToggle.tsx`, `main.tsx:14-30`) — try/catch around `localStorage.getItem` for private-mode safety; pre-paint read in `main.tsx` to avoid FOUC. Sort initial state mirrors this pattern.
- **`<SkeletonThumbnail/>`** (`packages/dashboard/src/components/SkeletonThumbnail.tsx`) — already used by Phase 17 for in-progress versions; surfaces naturally at top of grid under the new NULLS FIRST pinning, no new component needed.
- **`fetchVersions(shotId, params?)`** (`packages/dashboard/src/lib/api.ts:148-165`) — already accepts a `FetchVersionsParams` object with `limit/offset/include_tags/include_metadata`. Phase 18 extends with `sort` and `cursor`; `qs()` helper handles undefined cleanly.
- **`unwrapList<T>(raw)`** (`packages/dashboard/src/lib/shape.ts`) — handles `ListResult` wrapper vs bare-array shape drift. Continues to apply to the new paginated response.
- **Phase 17 `<Thumbnail/>` / `<C2paShield/>` thin-wrapper pattern** — established convention for new dashboard components. `<SortDropdown/>` follows this shape.
- **Phase 12 `<WarningPill/>`** (`packages/dashboard/src/components/WarningPill.tsx`) — design-token reuse precedent for the new "Load more" error pill (if needed).

### Established Patterns
- **localStorage prefix `vfx-familiar:`** (set by `ThemeToggle`) — Phase 18 extends with `vfx-familiar:sort:grid` and `vfx-familiar:sort:tree`. Bounded-key LRU eviction helper introduced as new primitive.
- **Engine ORDER BY whitelist via Drizzle `sql\`…\`` template** — `version-repo.ts:listByShot` uses `sql\`${versions.version_number} DESC\``. Phase 18 introduces a parameterized switch over the `SortField` enum to assemble the ORDER BY at query time. Whitelist enforcement via TypeScript exhaustive switch + runtime Zod validation at the HTTP/tool boundary.
- **Composite ORDER BY with stable tiebreaker** — `hierarchy-repo.ts` already uses `(created_at, id)` for deterministic pagination ("RT-03: deterministic pagination ordering"). Phase 18 extends to `(NULL_BIT, sort_field, version_id)` for the version surface.
- **Same-origin GETs with query params** — `lib/api.ts` `qs()` helper + `BASE = ''`. Vite proxies `/api → 127.0.0.1:3000` in dev (D-WEBUI-13). Phase 18 stays on this surface (no POST migration).
- **`@preact/signals` for shared state** — `versions.value`, `selectedShotId.value` etc. Phase 18 adds `gridSort` + `treeSort` signals plus a derived `gridCursor` signal for the next-page fetch.
- **Engine architecture-purity** — sort logic is pure SQL/TS, no new native bindings. Architecture-purity allowed-set probably untouched. Confirm during plan derivation.

### Integration Points
- **Engine repos:** `src/store/version-repo.ts:listByShot` migrates from `(shotId, limit, offset)` to `(shotId, { sort, cursor, limit })`; returns `{ items, next_cursor, total_count }`. `src/store/hierarchy-repo.ts:listProjects/listSequences/listShots` gain optional `sort` parameter (back-compat default preserved).
- **Engine pipeline:** No new methods on `Engine`. Sort is a read-only re-projection over existing repo surfaces. Existing `Engine.listVersionsForShot` (or callsite of `listByShot`) signature updates accordingly.
- **HTTP layer:** `src/http/dashboard-routes.ts` `GET /api/shots/:id/versions` gains query parsing for `sort`, `cursor`, `limit`. Existing `/api/workspaces/:id/projects` etc. gain optional `sort` query param. URL parse uses Zod whitelist; malformed → fallback to default with warning log.
- **Dashboard API:** `packages/dashboard/src/lib/api.ts:fetchVersions` signature gains `sort` + `cursor`; return type changes from `Version[]` to `{ items: Version[], next_cursor: string | null, total_count: number }`. Hierarchy fetchers (`fetchProjects`, `fetchSequences`, `fetchShots`) gain optional `sort` parameter.
- **Dashboard state:** New `gridSort`, `treeSort` signals in `packages/dashboard/src/state/`. Initial state hydrated from URL → localStorage → defaults (priority order). On mount: pre-paint read in `main.tsx` (mirrors theme pattern) OR first-render `useEffect` (less FOUC-sensitive since dropdown is a control, not a body-class).
- **Dashboard view:** `HomeView.tsx` renders `<SortDropdown/>` above the version list (right pane) and another `<SortDropdown/>` above `<TreeSidebar/>` (left pane). On change: update signal → write localStorage → `history.replaceState`. The "Load more" button lives at the bottom of the version list inside `HomeView.tsx`'s `<main>`.
- **TreeSidebar:** Stays a pure component. Receives the already-sorted `workspaces` array from the parent. Sort happens at the parent (`HomeView.tsx`) when composing the `tree` array — either by passing sort to fetchers or by client-side re-sorting cached children. The TreeSidebar itself doesn't know about sort.
- **No append-only impact:** Sort is read-only; provenance table untouched; no new migration. Schema migration count holds at 0006.
- **Architecture-purity:** No new native bindings. Allowed-set assertion in `src/__tests__/architecture-purity.test.ts` likely unchanged. Confirm in plan derivation.

</code_context>

<specifics>
## Specific Ideas

- **"VFX artists very visual learners… pull up latest generations quickly in the dropdown folder structure"** — direct user quote (PROJECT.md, REQUIREMENTS.md) anchors the "Latest first" default and the dropdown UX. Phase 18 ships the structural sort surface; Phase 17 already addressed the visual side.
- **"Smart default per scope" (REQUIREMENTS.md SORT-04)** — interpreted as per-pane (grid=Latest, tree=A→Z), NOT per-hierarchy-level. Per-level deferred to v1.3.
- **"In-flight work is never buried"** — UX rule that emerged from the NULL-handling discussion. Pinning in-progress to top of the grid on BOTH Latest and Oldest is the concrete expression.
- **"Shareable links don't hijack personal preferences"** — UX rule that emerged from URL-vs-localStorage precedence discussion. URL wins on first load but localStorage stays untouched; user can toggle back to their pref and the URL updates.
- **Phase 17 thin-wrapper pattern as the polish bar** — `<SortDropdown/>` should match the visual quality of `<Thumbnail/>` + `<C2paShield/>`. Native `<select>` is the fallback floor, custom dropdown is the recommended ship.

</specifics>

<deferred>
## Deferred Ideas

- **Per-shot sort persistence** — REQUIREMENTS.md already explicitly defers this to v1.3. localStorage scope keys are `:sort:grid` + `:sort:tree`, NOT `:sort:grid:{shot_id}`. The bounded-key LRU helper introduced here (`setBoundedLocalStorageEntry`) is forward-compat for per-shot when v1.3 ships.
- **Per-level tree sort** — independent sort per hierarchy level (workspaces sorted A→Z, shots sorted Newest, etc.). v1.3 candidate if user demand surfaces.
- **Infinite scroll on the version grid** — IntersectionObserver trigger pattern. v1.3 candidate; "Load more" button is the conservative v1.2 ship.
- **Numbered pagination on the version grid** — classic "Page 1 of 8" footer. Awkward fit with cursor pagination (no native "jump to page N"). Defer indefinitely.
- **Smart-restore scroll position on sort change** — track last-clicked card and scroll-to-it after re-sort if still in page 1. v1.3 polish; v1.2 ships snap-to-top.
- **"Recently active" / tag-recency sort** — needs telemetry not yet captured. Already deferred per REQUIREMENTS.md.
- **Explicit "Copy shareable link" button** — instead of reactive URL, a button snapshots current state. Considered and rejected — reactive URL via `replaceState` is the SORT-03 contract. Future enhancement if URL-sharing UX is unclear.
- **Total count display as "Page 2 of 8"** — alternative to "Load N more (M remaining)". Rejected because cursor pagination doesn't natively support page-numbered jumps.
- **URL push-state granularity (back-arrow through sort history)** — `pushState` per change instead of `replaceState`. Considered and rejected — sort isn't a navigation event, polluting back-stack hurts UX.
- **Auto-refresh of grid on new version completion (SSE-driven)** — when an in-progress generation completes mid-session, the new completed row should slide into its sorted position. Today's HomeView fetches on shot select only; no auto-refresh. Phase 18 doesn't add this — defer to v1.3 (or addressed by Phase 19 work). Workaround: user re-selects shot to refresh.
- **Three-way precedence (URL > localStorage > server-personalized default)** — server-stored sort preferences for multi-device sync. Out of scope — single-user demo.

</deferred>

---

*Phase: 18-sortable-folder-dropdown*
*Context gathered: 2026-05-06*
