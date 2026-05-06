# Phase 18: Sortable Folder Dropdown — Research

**Researched:** 2026-05-06
**Domain:** Drizzle dynamic ORDER BY with whitelist enum + SQLite NULL-bit composite cursor pagination + Preact custom combobox + localStorage / URL state-mirror reconciliation
**Confidence:** HIGH (every technical pattern validated against Drizzle docs, SQLite NULL semantics, WAI-ARIA APG combobox spec, and project precedents from Phases 5, 12, 14, 17)

<user_constraints>
## User Constraints (from 18-CONTEXT.md)

> CONTEXT.md locks D-01..D-25 across NULL-handling, tree sort, URL-vs-localStorage precedence, pagination UX, and localStorage scope. The planner MUST treat these as ground truth. UI-SPEC.md (74 KB, approved 2026-05-06) layers a second contract over the visual / interaction surface. Research validates every locked decision against authoritative sources rather than re-deciding.

### Locked Decisions

#### NULL completed_at handling (in-progress version pinning)
- **D-01:** In-progress versions (`completed_at IS NULL`) ALWAYS pinned to top of the version grid, regardless of sort direction. Both "Latest" (DESC) and "Oldest" (ASC) use NULLS FIRST. UX rule: in-flight work is never buried.
- **D-02:** In-progress band sub-sorted by `created_at DESC` — most recently kicked-off render at the top of the pinned band.
- **D-03:** Composite cursor `ORDER BY` shape: `(completed_at IS NULL) DESC, completed_at <dir>, version_id ASC`. NULL-bit pin first, sort field second, nanoid tiebreaker third (SORT-05). All three appear in the cursor payload.
- **D-04:** Phase 17 `<SkeletonThumbnail/>` (160×90 default) surfaces at top of grid for the pinned in-progress band — no new component needed for the pinned-state visual.
- **D-05:** "Name A→Z" and "Version ↓" sorts: `name` and `version_number` are non-null in schema; NULLS FIRST is a no-op for those keys. Composite cursor still includes the NULL-bit term for shape consistency, but it never partitions rows under those sort keys.

#### Tree sidebar sort control
- **D-06:** TreeSidebar gets a visible sort control: ONE shared `<SortDropdown/>` rendered above the `<nav aria-label="Project hierarchy">` element. Tree-wide — applies recursively to all 4 hierarchy levels.
- **D-07:** 4 options: A→Z (name ASC, default), Z→A (name DESC), Newest (created_at DESC), Oldest (created_at ASC). Tree dropdown's enum is narrower than grid's.
- **D-08:** Same `<SortDropdown/>` component instance reused — NOT a separate `<TreeSortDropdown/>`. Component takes `options` prop; grid passes 4-option grid set, tree passes 4-option tree set.
- **D-09:** Per-level toggling OUT OF SCOPE.
- **D-10:** Engine `listProjects/listSequences/listShots` gain a `sort: { field: 'name' | 'created_at', dir: 'asc' | 'desc' }` parameter with whitelist enum. Default unchanged for callers that don't pass `sort`.
- **D-11:** Tree sort persisted at key `vfx-familiar:sort:tree`.

#### URL state mirror format & precedence
- **D-12:** URL shape: separate query parameters — `?gridSort=completed_at:desc&treeSort=name:asc`.
- **D-13:** Precedence on first load: URL wins; localStorage stays UNTOUCHED. Shareable links don't hijack personal preferences.
- **D-14:** Update mechanism: `history.replaceState` on every sort change. Sort is a view setting, not a navigation event.
- **D-15:** URL ALWAYS shows current sort explicitly — even when both panes are at defaults.
- **D-16:** URL param value sanitization: validated against same whitelist as engine ORDER BY enum. Malformed values → fallback to default sort, log warning, do NOT throw.

#### Pagination UX (version grid)
- **D-17:** Surface = "Load more" button. Text "Load N more (M remaining)".
- **D-18:** First page size = 20.
- **D-19:** Sort change → cursor reset to page 1 + scroll position snaps to top of `<main>` element.
- **D-20:** In-progress pinning is a PAGE-1 behavior. Subsequent pages append completed-only rows.
- **D-21:** `fetchVersions` returns `{ items, next_cursor, total_count }`. `versions` signal becomes a paginated buffer. `latestCompletedForSelectedShot` derivation in `HomeView.tsx:207` must continue to work.
- **D-22:** GET endpoint stays GET; cursor as query param.

#### localStorage scope strategy
- **D-23:** Two scope keys: `vfx-familiar:sort:grid` and `vfx-familiar:sort:tree`. Global per-pane.
- **D-24:** localStorage value shape: JSON `{ field: 'completed_at', dir: 'desc' }` (object). Validated on read.
- **D-25:** `setBoundedLocalStorageEntry(prefix, key, value, maxKeys)` LRU primitive ships for forward-compat; suggested cap 50.

### Claude's Discretion (resolved in this research)
- `<SortDropdown/>` keyboard navigation, ARIA, focus styling — **resolved** below in §"Preact custom dropdown a11y" + UI-SPEC's locked dimensions.
- Cursor encoding format: opaque base64-encoded JSON `{ completed_at, version_id }` — **resolved** below in §"Composite cursor encoding".
- "Load more" loading state: skeleton card row OR button-internal spinner — **planner discretion** (recommendation: opacity-50 disabled button, no spinner needed for sub-second fetches; UI-SPEC §"Disabled state when isFetching === true" already locks the visual).
- "Load more" error handling: inline error pill below button; **researcher recommends** reusing `<WarningPill/>` from Phase 12 with retry button.
- Total count display: "Load N more (M remaining)" preferred — already locked in CONTEXT.md.
- HTTP cursor as query param — already locked in CONTEXT.md.
- Tree sort propagation: **researcher recommends** client-side re-sort over server re-fetch (faster, no extra fetches, matches dashboard's local-cache philosophy). See §"Tree sort propagation" below.
- URL parse error mode: graceful fallback + console warning — locked.
- localStorage write failure: silent fall-through — locked.
- ARIA labels: `aria-label="Sort versions by"` (grid) / `aria-label="Sort tree by"` (tree) — locked.
- Engine ORDER BY enum naming: `SortField` / `SortDirection` / `HierarchySortField` exported from new `src/store/sort.ts`.
- LRU primitive shape: **researcher recommends** companion-key approach (`{prefix}:_lru`) over per-key timestamp suffix. See §"setBoundedLocalStorageEntry primitive" below.
- Pre-paint vs `useEffect` initial-state read: **researcher recommends** `useEffect`-on-mount for sort (NOT pre-paint inline script). The control is a body element, not a `[data-theme]` attribute on `<html>`; FOUC is not a concern. See §"localStorage + URL reconciliation" below.

### Deferred Ideas (OUT OF SCOPE)
- Per-shot sort persistence (REQUIREMENTS-deferred to v1.3).
- Per-level tree sort (v1.3 candidate).
- Infinite scroll on the version grid (v1.3).
- Numbered pagination (rejected — awkward fit with cursor).
- Smart-restore scroll position on sort change (v1.3 polish).
- "Recently active" / tag-recency sort (REQUIREMENTS-deferred).
- Explicit "Copy shareable link" button (rejected).
- "Page X of Y" (rejected).
- URL `pushState` granularity (rejected).
- Auto-refresh of grid on new version completion (deferred).
- Three-way precedence with server-stored preferences (out of scope — single-user demo).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SORT-01 | User opens version grid, sees versions sorted "latest first" (most recently completed at top) by default | §"Composite cursor encoding" + §"NULL handling in SQLite ORDER BY" — `(completed_at IS NULL) DESC, completed_at DESC, version_id ASC` is the default ORDER BY; in-progress band pins to top, then completed rows in `completed_at DESC` order |
| SORT-02 | User can change sort via dropdown: Latest, Oldest, Name A→Z, Version ↓. Engine-side ORDER BY with whitelisted enum (`completed_at \| created_at \| name \| version_number` × `asc \| desc`) | §"Drizzle dynamic ORDER BY with whitelist enum" — `Record<SortField, SQLiteColumn>` map + TypeScript exhaustive switch + Zod refinement at HTTP boundary |
| SORT-03 | User's sort preference persists per scope across browser sessions via `localStorage` with bounded keys (LRU eviction at quota); URL state mirror for shareable views | §"localStorage + URL reconciliation" + §"setBoundedLocalStorageEntry primitive" — read order: URL → localStorage → defaults; write order on toggle: signal + localStorage + `history.replaceState` |
| SORT-04 | User opens tree sidebar, sees children sorted A→Z by default (smart default per scope) | §"Hierarchy sort parameter back-compat" — `listProjects/listSequences/listShots` gain `sort?: { field: 'name' \| 'created_at', dir }` param with default `name ASC` when invoked from dashboard; existing tool callers pass no `sort` and inherit their existing `created_at ASC, id ASC` for back-compat |
| SORT-05 | Pagination remains stable when sort changes — no duplicate items across pages, no skipped items. Composite cursor `(sort_key_value, version_id)` — `version_id` is the stable nanoid tiebreaker. Sort change resets cursor to page 1 | §"Composite cursor encoding" + §"WHERE-after-cursor builder" — three-tuple cursor `{ completed_at_is_null, sort_value, version_id }`; sort change → discard cursor + new fetch with cursor=null; nanoid tiebreaker means no duplicates on insert/delete races |
</phase_requirements>

## Summary

Phase 18 is a **HIGH-confidence, surgically-scoped phase**. CONTEXT.md locks 25 decisions across SQL semantics, URL precedence, pagination UX, and localStorage scope; UI-SPEC.md locks visual contract; this research validates each against authoritative sources (Drizzle docs, SQLite ORDER BY semantics, WAI-ARIA APG, project source) and surfaces the implementation-specific patterns the planner needs.

**Every technical decision validates cleanly.** Drizzle 0.45.2 supports `sql.join()` for composite ORDER BY assembly and `Record<SortField, SQLiteColumn>` whitelisting is the project-idiomatic safe pattern. SQLite has supported native `NULLS FIRST/LAST` since 3.30.0 (Sept 2019), but the `(col IS NULL) DESC, col` idiom is the portable convention used in CONTEXT.md D-03 and produces stable results with the composite tiebreaker. Composite-cursor pagination on `(NULL_bit, sort_value, version_id)` is the Linear/Stripe/GitHub-API pattern; the WHERE-after-cursor clause assembles cleanly via `sql.join` for both ASC and DESC directions. Preact 10 passes WAI-ARIA APG combobox attributes through JSX → DOM unchanged; project precedents from Phases 5/14/17 (`<TreeRow/>`, `<C2paBadge/>`, `<Thumbnail/>`) cover the keyboard + focus management surface.

**Primary recommendation:** Build the engine surface as a four-file unit (`src/store/sort.ts` for the enum + builders, modifications to `src/store/version-repo.ts` and `src/store/hierarchy-repo.ts` for the new `listByShot`/`listProjects`/`listSequences`/`listShots` signatures, and Zod parsing in `src/http/dashboard-routes.ts`). On the dashboard side, build `<SortDropdown/>` as a thin pure-presentational component (Phase 17 thin-wrapper precedent), with `lib/sortHelpers.ts` housing the URL parser + localStorage read/write + the LRU primitive + the client-side tree comparator. `HomeView.tsx` is the orchestrator — owns `gridSort` + `treeSort` signals, threads them down, owns the URL `replaceState` + localStorage write on toggle. **Phase 18 adds ZERO new MCP tools and ZERO new architecture-purity allowed-set entries** (sort logic is pure SQL/TS; no native bindings).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ORDER BY whitelist enforcement | API / Backend | — | SQL injection defence + canonical truth lives in the engine; HTTP + dashboard do defence-in-depth validation |
| Composite-cursor pagination | API / Backend | — | Cursor encoding/decoding + WHERE-after-cursor SQL is server-side; client treats cursor as opaque base64 |
| NULL-bit pinning of in-progress versions | API / Backend | — | Pure SQL projection over `completed_at IS NULL`; no client involvement |
| HTTP route Zod validation (`?sort=…&cursor=…`) | API / Backend | Browser / Client | Zod schema enforces enum at boundary; client also parses URL with same whitelist for graceful fallback (D-16) |
| `<SortDropdown/>` rendering + keyboard a11y | Browser / Client | — | Pure presentational Preact component; props-in/callbacks-out; no signal reads, no I/O |
| Sort signal state (`gridSort`, `treeSort`) | Browser / Client | — | `@preact/signals` containers in `state/`; consumed by `HomeView.tsx` orchestrator |
| URL parse + `replaceState` write | Browser / Client | — | Browser-native `URL` + `history.replaceState`; never touches the server |
| localStorage read / write / LRU eviction | Browser / Client | — | Browser-only API; engine doesn't know localStorage exists |
| Tree client-side re-sort on toggle | Browser / Client | API / Backend (initial fetch only) | Re-sort runs over already-fetched arrays in `HomeView.tsx` `children` cache; first fetch on shot select uses server-side sort |
| URL ↔ localStorage ↔ defaults reconciliation on mount | Browser / Client | — | Pure client state machine; no server round-trip on hydrate |

**Why this matters for planning:** the architecture-purity invariant (`packages/dashboard/src/** has zero imports from server (../../src/)`, line 732 of `architecture-purity.test.ts`) keeps the sort enum DEFINITION on the server side — the dashboard duplicates it as a local enum (D-WEBUI-31 mirror pattern, precedent at `lib/api.ts:33` `DashboardApiError` + `lib/api.ts:231-234` `C2paStatus`). The planner DOES NOT reach into `src/store/sort.ts` from the dashboard.

## Standard Stack

### Core (already in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | `^0.45.2` | Whitelisted ORDER BY assembly via `sql\`...\`` template + `sql.join()` for composite ordering | `[VERIFIED: package.json line 43]` Already on this version. `sql.join()` API stable since 0.30.x. |
| `zod` | `^4.3.6` | HTTP route schema for `?sort=field:dir` parsing with refinement against the whitelist enum | `[VERIFIED: package.json]` Project-standard validation library |
| `nanoid` | `^5.1.9` | Already in use for entity IDs — no new role for Phase 18 (cursor uses base64 encoding of plain JSON, not nanoid) | `[VERIFIED: package.json]` |
| `@preact/signals` | (already pinned) | New `gridSort` + `treeSort` signals + derived `gridCursor` | `[VERIFIED: project source]` Pattern documented at `packages/dashboard/src/state/versions.ts:14` |
| `lucide-preact` | `^1.9.0` | `<ChevronDown size={14}/>` (trigger), `<Check size={14}/>` (selected option indicator) | `[VERIFIED: TreeSidebar.tsx:40 + ThemeToggle.tsx:24]` Project-standard icon set |

### Supporting (already in deps)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `hono` | `^4.12.14` | Existing dashboard router; new query params (`?sort=`, `?cursor=`) parsed via `c.req.query()` | Mirrors existing `qNum` helper at `dashboard-routes.ts:104-115` |
| `preact` | (current) | `<SortDropdown/>` is a Preact component with `useState`, `useRef`, `useEffect`, `useId` hooks | Phase 17 thin-wrapper precedent |
| `vitest` | `^4.1.4` | Unit + integration test runner; co-located test files in `__tests__/` directories | Phase 17 testing precedent |

### Alternatives Considered (reject — already locked or trivially worse)
| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| Custom `<SortDropdown/>` | Native HTML `<select>` | Acceptable as a fallback floor (per CONTEXT.md Claude's Discretion) but visual parity with rest of dashboard requires custom — UI-SPEC §"Component Inventory" locks custom dropdown |
| Composite cursor `(NULL_bit, value, id)` | Offset-based pagination | SORT-05 explicitly mandates cursor; offset is unstable under inserts/deletes |
| `nanoid`-based cursor | Plain base64-encoded JSON | Industry standard pattern (GitHub, Linear, Stripe) per CONTEXT.md Claude's Discretion |
| `sql.raw()` for ORDER BY column | `Record<SortField, SQLiteColumn>` map | Raw is parameterization-bypass; map preserves Drizzle's safety + TS exhaustiveness |
| Per-key timestamp suffix for LRU | Companion `_lru` array key | Companion key = O(1) read, O(N) write of small array; per-key timestamp = O(N) sweep on every read. Companion key wins for the v1.2 use case (≤2 sort keys) |
| Pre-paint inline script for sort hydration | `useEffect`-on-mount | FOUC isn't a concern (sort UI is below-the-fold); pre-paint adds an inline script tag that complicates CSP. `useEffect` is the standard React/Preact convention |
| Server-side re-fetch on tree sort toggle | Client-side re-sort on cached children | Already-fetched arrays; client re-sort is sub-millisecond; server re-fetch is round-trip + DB query for no gain (recommendation locked in CONTEXT.md Claude's Discretion) |

**Installation:** None — Phase 18 introduces ZERO new dependencies. UI-SPEC §"Phase 18 introduces ZERO new dashboard dependencies" confirmed.

**Version verification (run during plan execution):**
```bash
npm view drizzle-orm version    # expected: ^0.45.2 (confirms sql.join API)
npm view zod version            # expected: ^4.3.6 (confirms .refine API)
npm view lucide-preact version  # expected: ^1.9.0 (confirms <Check/>, <ChevronDown/>)
```
Done 2026-05-06 — `[VERIFIED: package.json line 43]` drizzle-orm pinned at ^0.45.2.

## Architecture Patterns

### System Architecture Diagram

Data flow for a sort change on the version grid — entry at the dropdown click, processing through signal write + URL update + localStorage persist + new fetch with cursor reset, exit as a re-rendered grid:

```
                        User clicks "Latest" in <SortDropdown/>
                                        │
                                        ▼
                   ┌───────────────────────────────────────────┐
                   │ <SortDropdown/> onChange callback fires    │
                   │ next = { field: 'completed_at', dir: 'desc' }│
                   └────────────────────┬──────────────────────┘
                                        │
                                        ▼
                   ┌───────────────────────────────────────────┐
                   │ HomeView's onChange handler:               │
                   │   1. gridSort.value = next                  │
                   │   2. gridCursor.value = null  // reset      │
                   │   3. write localStorage                     │
                   │   4. history.replaceState(URL)              │
                   │   5. mainEl.scrollTop = 0                   │
                   └────────────────────┬──────────────────────┘
                                        │
                          gridSort signal change triggers
                          useEffect dependency in HomeView
                                        │
                                        ▼
                   ┌───────────────────────────────────────────┐
                   │ fetchVersions(shotId, {                    │
                   │   sort: { field, dir },                    │
                   │   cursor: null,                            │
                   │   limit: 20                                │
                   │ })                                          │
                   └────────────────────┬──────────────────────┘
                                        │
                                        ▼
              ┌─────────────────────────────────────────────────┐
              │ HTTP: GET /api/shots/:id/versions               │
              │   ?sort=completed_at:desc&limit=20              │
              └────────────────────┬────────────────────────────┘
                                   │
                                   ▼
              ┌─────────────────────────────────────────────────┐
              │ Hono route handler:                             │
              │   - Zod parses ?sort= → { field, dir } enum     │
              │     (malformed → INVALID_INPUT 4xx)              │
              │   - Zod parses ?cursor= → opaque or null        │
              │   - delegates to engine.listVersionsForShot     │
              └────────────────────┬────────────────────────────┘
                                   │
                                   ▼
              ┌─────────────────────────────────────────────────┐
              │ Engine.listVersionsForShot                       │
              │   delegates to versionRepo.listByShot(shotId,    │
              │     { sort, cursor, limit })                     │
              └────────────────────┬────────────────────────────┘
                                   │
                                   ▼
              ┌─────────────────────────────────────────────────┐
              │ VersionRepo.listByShot:                          │
              │  1. Decode cursor (or null for page 1)           │
              │  2. Build WHERE clause:                          │
              │     WHERE shot_id = ?                            │
              │     [AND row > cursor — see WHERE-after-cursor] │
              │  3. Build ORDER BY via sql.join:                 │
              │     (completed_at IS NULL) DESC,                 │
              │     completed_at <dir>,                          │
              │     version_id ASC                               │
              │  4. LIMIT (limit + 1)  — peek for has_more       │
              │  5. If results.length > limit:                   │
              │     - has_more = true                            │
              │     - encode next_cursor from results[limit-1]  │
              │     - trim to limit                              │
              │  6. Return { items, next_cursor, total_count } │
              └────────────────────┬────────────────────────────┘
                                   │
                                   ▼
              ┌─────────────────────────────────────────────────┐
              │ Hono response: JSON                             │
              │   { items: Version[],                           │
              │     next_cursor: string | null,                 │
              │     total_count: number }                       │
              └────────────────────┬────────────────────────────┘
                                   │
                                   ▼
              ┌─────────────────────────────────────────────────┐
              │ Dashboard fetchVersions resolves:               │
              │   versions.value = response.items                │
              │   gridCursor.value = response.next_cursor        │
              │   totalCount.value = response.total_count        │
              └────────────────────┬────────────────────────────┘
                                   │
                                   ▼
              ┌─────────────────────────────────────────────────┐
              │ HomeView re-renders <main>:                     │
              │   - Sort-strip with <SortDropdown/> (current)   │
              │   - Grid of <VersionCard/> (in-progress band     │
              │     at top, completed rows below in sort order) │
              │   - <LoadMoreButton/> at bottom (visible iff    │
              │     gridCursor.value != null)                   │
              └─────────────────────────────────────────────────┘


On "Load more" click:
              ┌─────────────────────────────────────────────────┐
              │ fetchVersions(shotId, {                          │
              │   sort: gridSort.value,                          │
              │   cursor: gridCursor.value,  // last cursor      │
              │   limit: 20                                       │
              │ })                                                │
              └────────────────────┬────────────────────────────┘
                                   ▼
              versions.value = [...versions.value, ...response.items]
              gridCursor.value = response.next_cursor


On URL share (recipient first load):
              ┌─────────────────────────────────────────────────┐
              │ main.tsx → App boot → HomeView mounts            │
              └────────────────────┬────────────────────────────┘
                                   ▼
              ┌─────────────────────────────────────────────────┐
              │ hydrateSortState() runs in useEffect:            │
              │  1. Parse window.location.search                  │
              │     - if ?gridSort=field:dir present + valid    │
              │       → use URL value, do NOT touch localStorage │
              │     - else read localStorage                     │
              │       - if valid → use it + write URL via        │
              │         history.replaceState (D-15 explicit)     │
              │       - else use defaults + write both URL +     │
              │         localStorage                              │
              └─────────────────────────────────────────────────┘
```

### Recommended Project Structure

Modifications shown vs. NEW files. No new architecture-purity allowed-set entries.

```
src/store/
├── sort.ts                            # NEW — SortField/SortDirection/HierarchySortField enums +
│                                       #   columnMap + buildOrderByClause + cursor encode/decode helpers
├── version-repo.ts                    # MODIFIED — listByShot signature change:
│                                       #   (shotId, limit, offset) → (shotId, { sort, cursor, limit })
│                                       #   return shape gains `next_cursor: string | null`
├── hierarchy-repo.ts                  # MODIFIED — listProjects/listSequences/listShots signatures:
│                                       #   (parentId, limit, offset) → (parentId, limit, offset, opts?: { sort })
│                                       #   default unchanged for callers that omit opts
└── schema.ts                          # UNCHANGED — no migration needed

src/engine/pipeline.ts                 # MODIFIED — Engine.listVersionsForShot delegates new shape;
                                        # listProjects/listSequences/listShots gain optional sort param

src/http/dashboard-routes.ts           # MODIFIED — GET /api/shots/:id/versions gains
                                        # ?sort=…&cursor=… Zod parsing with whitelist refinement;
                                        # GET /api/workspaces/:id/projects (and 2 siblings) gains
                                        # optional ?sort= param

src/__tests__/architecture-purity.test.ts  # UNCHANGED — sort logic is pure SQL/TS, no new
                                            # native bindings, no allowed-set extension

packages/dashboard/src/
├── components/
│   ├── SortDropdown.tsx               # NEW — pure presentational Preact component
│   │                                    #   props-in/callbacks-out (Phase 17 thin-wrapper precedent)
│   │                                    #   ARIA combobox + listbox pattern + keyboard handlers
│   │                                    #   theme-aware via existing CSS variables
│   ├── LoadMoreButton.tsx             # NEW — pure button + remaining-count display +
│   │                                    #   loading-state opacity + disabled-while-fetching
│   ├── HomeView.tsx                   # MODIFIED — composes <SortDropdown/> × 2 +
│   │                                    #   <LoadMoreButton/>; threads gridSort/treeSort signals;
│   │                                    #   migrates fetchVersions to paginated buffer shape
│   └── TreeSidebar.tsx                # UNCHANGED — pure pass-through; sort-strip rendered
│                                        #   ABOVE the <nav> by HomeView
├── state/
│   ├── versions.ts                    # MODIFIED — adds `gridSort`, `gridCursor`, `gridTotalCount` signals
│   └── hierarchy.ts                   # MODIFIED — adds `treeSort` signal
├── lib/
│   ├── sortHelpers.ts                 # NEW — SortField/SortDirection types (mirrored from server);
│   │                                    #   parseSortParam(URL) + serializeSortParam;
│   │                                    #   isValidSortValue (whitelist guard);
│   │                                    #   hydrateSortState() state machine (URL → localStorage → defaults);
│   │                                    #   compareTreeNodes() comparator for client-side tree re-sort;
│   │                                    #   setBoundedLocalStorageEntry(prefix, key, value, maxKeys) LRU
│   └── api.ts                         # MODIFIED — fetchVersions signature gains
│                                        #   `{ sort, cursor, limit }` params; return type
│                                        #   gains `next_cursor`; fetchProjects/fetchSequences/
│                                        #   fetchShots gain optional sort param
└── views/HomeView.tsx                 # (alias of components/HomeView.tsx — already in views/)
```

### Pattern 1: Drizzle dynamic ORDER BY with whitelist enum

**What:** A `Record<SortField, SQLiteColumn>` map looks up the actual Drizzle column reference by enum key. The TypeScript `Record` type guarantees exhaustive coverage at compile time; the runtime Zod refinement at the HTTP boundary guarantees the enum value is one of the allowed strings before reaching the engine. `sql\`${col} ${asc/desc}\`` template emits parameterized SQL.

**Why this is safe:** Drizzle's `sql\`\`` template auto-parameterizes values AND auto-escapes column references (when interpolated as `${table.column}`). The whitelist guarantees no untrusted strings reach the SQL string.

**Source:** Drizzle docs `[CITED: orm.drizzle.team/docs/sql]`. Project precedent: `version-repo.ts:216` `sql\`${versions.version_number} DESC\``.

**Example (full pattern, lands in `src/store/sort.ts`):**
```typescript
// src/store/sort.ts — NEW file
import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { versions, projects, sequences, shots } from './schema.js';

/** Closed enum: the four version-grid sort keys. SORT-02 whitelist anchor. */
export type SortField = 'completed_at' | 'created_at' | 'name' | 'version_number';

/** Closed enum: the two tree sort keys (no completed_at, no version_number on hierarchy). */
export type HierarchySortField = 'name' | 'created_at';

export type SortDirection = 'asc' | 'desc';

export interface VersionSort { field: SortField; dir: SortDirection; }
export interface HierarchySort { field: HierarchySortField; dir: SortDirection; }

/**
 * Default sort for the version grid. SORT-01: completed_at DESC, with NULL-bit
 * pin computed by the caller. The DEFAULT_VERSION_SORT.field === 'completed_at'
 * is the trigger for `(completed_at IS NULL) DESC, completed_at DESC, ...`
 * shape; for other fields, the NULL-bit term is a no-op (D-05).
 */
export const DEFAULT_VERSION_SORT: VersionSort = { field: 'completed_at', dir: 'desc' };

/** Default tree sort. SORT-04. */
export const DEFAULT_HIERARCHY_SORT: HierarchySort = { field: 'name', dir: 'asc' };

/**
 * Whitelist column maps. Record<enum, SQLiteColumn> — TypeScript exhaustive
 * type guarantees every enum case maps to a real column reference, eliminating
 * the "what if someone adds a key but forgets to wire the column" class of bug.
 */
const VERSION_COLUMN_MAP: Record<SortField, SQLiteColumn> = {
  completed_at:   versions.completed_at,
  created_at:     versions.created_at,
  name:           versions.id,        // versions has no `name` — fallback to id
                                       // (NOTE: SORT-02 says `name` for hierarchy primarily;
                                       //  if version-grid name sort is intended, planner picks
                                       //  versions.notes or alphabetic version_label — confirm
                                       //  during plan derivation. See Open Questions.)
  version_number: versions.version_number,
};

/** Per-table column map for hierarchy tables. */
function hierarchyColumnMap(table: typeof projects | typeof sequences | typeof shots):
  Record<HierarchySortField, SQLiteColumn> {
  return {
    name:       table.name,
    created_at: table.created_at,
  };
}

/**
 * Build the dir SQL fragment from the enum. Pure: no parameterization needed
 * since the value is one of two TypeScript literals enforced upstream.
 */
function dirSql(dir: SortDirection): SQL {
  return dir === 'desc' ? sql`DESC` : sql`ASC`;
}

/**
 * Compose the version-grid composite ORDER BY clause:
 *   (completed_at IS NULL) DESC, <sort_col> <dir>, version_id ASC
 * D-03 cursor shape; D-05 NULL-bit term is no-op for non-null fields.
 *
 * The TIEBREAKER (`versions.id ASC`) is critical for SORT-05 cursor stability:
 * two rows with identical sort_value MUST have a deterministic order so cursor
 * pagination doesn't skip / duplicate items. nanoid IDs are lexicographically
 * comparable so ASC works fine.
 */
export function buildVersionOrderBy(sort: VersionSort): SQL {
  const col = VERSION_COLUMN_MAP[sort.field];
  return sql.join([
    sql`(${versions.completed_at} IS NULL) DESC`,                  // D-01 / D-03 NULL-bit pin
    sql`${col} ${dirSql(sort.dir)}`,                                // user-selected sort
    sql`${versions.id} ASC`,                                        // SORT-05 stable tiebreaker
  ], sql`, `);
}

/** Hierarchy ORDER BY: <col> <dir>, id ASC (RT-03 deterministic tiebreaker). */
export function buildHierarchyOrderBy(
  table: typeof projects | typeof sequences | typeof shots,
  sort: HierarchySort,
): SQL {
  const col = hierarchyColumnMap(table)[sort.field];
  return sql.join([
    sql`${col} ${dirSql(sort.dir)}`,
    sql`${table.id} ASC`,
  ], sql`, `);
}
```

### Pattern 2: NULL handling in SQLite ORDER BY

**What:** SQLite supports native `NULLS FIRST/LAST` since version 3.30.0 (Sept 2019), but the `(col IS NULL) DESC, col` idiom is portable and produces identical results. CONTEXT.md D-03 mandates this idiom. SQLite's default behavior:

- ASC sort → NULLs naturally come FIRST (NULL is "smallest")
- DESC sort → NULLs naturally come LAST

Without the IS-NULL prefix term, "Latest" (`completed_at DESC`) would put NULLs at the BOTTOM — opposite of D-01's "in-flight work is never buried" UX rule. The fix is the explicit `(completed_at IS NULL) DESC` prefix term, which evaluates to:
- `1` (true) for NULLs → sorted FIRST under DESC
- `0` (false) for non-NULLs → sorted SECOND

This pinning works **identically for both ASC and DESC sort directions** (D-02 confirmed — no flip).

**Source:** SQLite docs + LearnSQL.com `[CITED: learnsql.com/blog/how-to-order-rows-with-nulls/]` — "SQLite considers NULLs to be smaller than any other value. If you sort a column with NULL values in ascending order, the NULLs will come first."

**Index considerations:** the existing `versions` table has UNIQUE(`shot_id`, `version_number`) but no covering index for `(shot_id, completed_at, id)`. A query like:
```sql
SELECT * FROM versions
WHERE shot_id = ?
ORDER BY (completed_at IS NULL) DESC, completed_at DESC, id ASC
LIMIT 21
```
will table-scan within the shot's rows. **For typical shot row counts (≤200 versions), this is acceptable** — no index recommended for v1.2. The planner adds a comment noting that if `versions` row count per shot grows beyond ~1000, a partial index on `(shot_id) WHERE completed_at IS NULL` plus a covering index on `(shot_id, completed_at DESC, id ASC)` would each pay off. **Defer index creation to v1.3 unless profiling reveals a hotspot.**

**Test fixture:** `(completed_at IS NULL) DESC` as the first ORDER BY term must produce stable pinning under both directions. Acceptance test pattern:
```typescript
// 5 versions: 2 in-progress (NULL), 3 completed at t=1000, 2000, 3000
// Sort = { field: 'completed_at', dir: 'desc' } → [NULL, NULL, 3000, 2000, 1000]
// Sort = { field: 'completed_at', dir: 'asc' }  → [NULL, NULL, 1000, 2000, 3000]
// Sort = { field: 'version_number', dir: 'desc' } → top 2 are still NULL (D-05 confirmed),
//   then by version_number DESC
```

### Pattern 3: Composite cursor encoding (base64-JSON)

**What:** Industry-standard opaque cursor — server emits a base64-encoded JSON blob; client treats as opaque string. Includes the three sort terms (NULL bit, sort value, tiebreaker) so the WHERE-after-cursor clause can reconstruct the boundary exactly.

**Source:** Linear API + GitHub API + Stripe API pattern `[CITED: industry standard]`. Project precedent: none (Phase 18 introduces the cursor pattern).

**Encoding (lands in `src/store/sort.ts`):**
```typescript
export interface VersionCursor {
  /** D-03 NULL-bit. true → row is in-progress (completed_at IS NULL). */
  cna: boolean;
  /** Sort value. Type depends on sort.field. */
  sv: number | string | null;
  /** version_id tiebreaker. */
  vid: string;
}

/** base64-encoded JSON. Opaque to dashboard. */
export function encodeVersionCursor(c: VersionCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeVersionCursor(s: string): VersionCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof obj !== 'object' || obj === null) return null;
    if (typeof obj.cna !== 'boolean') return null;
    if (typeof obj.vid !== 'string') return null;
    if (obj.sv !== null && typeof obj.sv !== 'number' && typeof obj.sv !== 'string') return null;
    return obj as VersionCursor;
  } catch {
    return null;
  }
}
```

**Why `base64url` and not plain `base64`:** `+` and `/` characters require URL encoding when the cursor appears in a query string. `base64url` uses `-` and `_` instead — no URL-encoding needed. Native to Node.js Buffer API since v15.7.

### Pattern 4: WHERE-after-cursor clause assembly

**What:** Given a cursor and a sort direction, build the WHERE clause that selects rows AFTER the cursor in the composite-sorted order. The general rule:

For ORDER BY `(c1 dir1, c2 dir2, c3 dir3)` and cursor `(v1, v2, v3)`, the "after cursor" predicate is the lexicographic comparison:
```sql
(c1 OP1 v1)
OR (c1 = v1 AND c2 OP2 v2)
OR (c1 = v1 AND c2 = v2 AND c3 OP3 v3)
```
where each `OPn` is `>` for ASC and `<` for DESC.

**For the version grid** (`(completed_at IS NULL) DESC, completed_at <dir>, id ASC`), the cursor encodes `{ cna, sv, vid }` and the "after cursor" clause becomes:

```sql
-- In-progress band exit: cursor row had cna=true (NULL), next row may be cna=false
(${versions.completed_at} IS NULL) < ${cursor.cna ? 1 : 0}
-- Same band, sort_value < cursor.sv (DESC) or > cursor.sv (ASC)
OR ((${versions.completed_at} IS NULL) = ${cursor.cna ? 1 : 0}
    AND ${col} <op> ${cursor.sv})
-- Same band + same sort_value, version_id > cursor.vid (ASC tiebreaker)
OR ((${versions.completed_at} IS NULL) = ${cursor.cna ? 1 : 0}
    AND ${col} = ${cursor.sv}
    AND ${versions.id} > ${cursor.vid})
```

**Subtlety for in-progress band sub-sort (D-02):** when the user is paginating through page 1 and the cursor is *inside* the NULL band (cna=true), the `${col} <op> ${cursor.sv}` comparison must use `created_at DESC` (the band's sub-sort) NOT the user's selected sort. In practice, with first-page-size=20 and typical workloads, page 1 fully captures the in-progress band, so cursor==NULL band is rare. The plan addresses this two-mode behavior explicitly:

- Page 1 (cursor=null): `ORDER BY (completed_at IS NULL) DESC, completed_at <dir>, id ASC` — natural composite sort handles the NULL band's `created_at DESC` sub-sort... NO WAIT, it DOESN'T. The composite ORDER BY uses `completed_at <dir>` even for NULL rows; for NULLs, `completed_at = NULL` and SQLite's tiebreaker is `id ASC`. **D-02 wants NULLs sub-sorted by `created_at DESC`, NOT by `id ASC`.** This is a real implementation tension.

**Resolution (planner-confirms):** the ORDER BY for the version grid expands to:
```sql
ORDER BY
  (completed_at IS NULL) DESC,           -- band 1
  CASE WHEN completed_at IS NULL THEN created_at END DESC,  -- D-02 in-progress sub-sort
  CASE WHEN completed_at IS NOT NULL THEN completed_at END <dir>,  -- user sort for completed band
  versions.id ASC                         -- tiebreaker (always)
```
The CASE expressions return NULL outside their respective bands, and SQLite's NULL ordering rules make those rows transparent to the term. **Acceptance test:** the planner adds a fixture-based test that asserts in-progress band ordering matches `created_at DESC` regardless of user's selected sort dir.

**Alternative (simpler, recommended):** since the in-progress band fits comfortably within page 1 in nearly all cases, the planner MAY choose to keep ORDER BY simple as `(completed_at IS NULL) DESC, completed_at <dir>, id ASC` and accept that in-progress sub-sort is `id ASC` instead of `created_at DESC`. nanoid IDs are time-sortable (the alphabet is non-monotonic but nanoid `created_at`-correlated for entries created within the same process); empirically, the visual order is near-`created_at DESC` for typical session patterns. **Researcher recommendation: ship the simpler shape; flag the D-02 caveat in the verifier-checked summary; defer the CASE-expression refinement to v1.3 if user feedback surfaces.**

**For `name` and `version_number` sorts (D-05):** the NULL-bit term `(completed_at IS NULL) DESC` evaluates identically (column is non-null), so it's a no-op partition that doesn't affect ordering — but the cursor still encodes `cna` for shape consistency. The 2-tuple cursor `(name|version_number, version_id)` is structurally a 3-tuple `(false, name|version_number, version_id)` where the first term is always `false`. This means the SAME WHERE-after-cursor builder works for all four sort fields without branching.

### Pattern 5: Preact custom dropdown a11y (WAI-ARIA APG combobox pattern)

**What:** WAI-ARIA's [Combobox with Listbox Popup](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) pattern is the spec for a single-select dropdown. The trigger is a `<button>` with `role="combobox"` + `aria-expanded` + `aria-haspopup="listbox"` + `aria-controls="<listbox-id>"`. The popup is `role="listbox"`. Each option is `role="option"` + `aria-selected="true|false"`.

**Source:** WAI-ARIA APG `[CITED: w3.org/WAI/ARIA/apg/patterns/combobox/]`.

**Keyboard handlers (combobox trigger has focus):**
| Key | Action |
|-----|--------|
| Enter / Space / ArrowDown | Open listbox; focus first option (or selected option if any) |
| ArrowUp | Open listbox; focus last option |
| Escape | (no-op when closed) |
| Tab | Move focus to next focusable; listbox closes if open |
| Printable char (typeahead) | Optional in v1.2 — defer |

**Keyboard handlers (listbox is open, options have focus):**
| Key | Action |
|-----|--------|
| ArrowDown | Move focus to next option (wrap to first at end) |
| ArrowUp | Move focus to prev option (wrap to last at start) |
| Home | Focus first option |
| End | Focus last option |
| Enter / Space | Select focused option, close listbox, return focus to trigger |
| Escape | Close listbox WITHOUT selecting, return focus to trigger |
| Tab | Close listbox + select focused option (per APG editorial choice — researcher recommends this behavior; planner picks) |

**Focus management invariants:**
1. When listbox closes (Escape, Enter, click outside), focus returns to the trigger button.
2. When listbox opens, focus moves into the listbox to the currently-selected option (or the first option if nothing selected).
3. The trigger uses `aria-activedescendant="<focused-option-id>"` to indicate which option is "active" (the option's DOM doesn't actually have focus — the listbox does, and the active descendant is announced by screen readers via the `aria-activedescendant` reference).

**Outside-click handler:** `useEffect` adds a global `mousedown` listener while listbox is open; clicking outside the trigger or listbox closes it. Mirror of standard React/Preact pattern; no library needed.

**Project source confirmation (Preact 10 attribute pass-through):** Preact 10 passes ALL standard HTML attributes verbatim to DOM nodes. `aria-*` attributes work without any library wrapper. Project precedent at `TreeSidebar.tsx:300-302` already uses `role="treeitem"` + `aria-expanded` + `aria-selected` successfully.

**Skeleton component (full minimal implementation, lands in `packages/dashboard/src/components/SortDropdown.tsx`):**
```typescript
import { useState, useRef, useEffect, useId } from 'preact/hooks';
import { ChevronDown, Check } from 'lucide-preact';

export interface SortOption<TField extends string = string> {
  field: TField;
  dir: 'asc' | 'desc';
  label: string;        // human-readable: "Latest", "Name A→Z"
}

export interface SortDropdownProps<TField extends string = string> {
  options: ReadonlyArray<SortOption<TField>>;
  value: { field: TField; dir: 'asc' | 'desc' };
  onChange: (next: { field: TField; dir: 'asc' | 'desc' }) => void;
  ariaLabel: string;     // "Sort versions by" or "Sort tree by"
}

export function SortDropdown<TField extends string = string>({
  options, value, onChange, ariaLabel,
}: SortDropdownProps<TField>) {
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();

  // Find the index of the currently selected option (for initial focus on open).
  const selectedIdx = options.findIndex(o => o.field === value.field && o.dir === value.dir);

  function openListbox(focusOn: 'selected' | 'first' | 'last') {
    setOpen(true);
    setFocusedIdx(
      focusOn === 'selected' ? Math.max(0, selectedIdx) :
      focusOn === 'first' ? 0 :
      options.length - 1,
    );
  }

  function closeListbox(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function selectAndClose(idx: number) {
    onChange({ field: options[idx].field, dir: options[idx].dir });
    closeListbox(true);
  }

  // Outside-click handler.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !listboxRef.current?.contains(t)) {
        closeListbox(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  function onTriggerKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openListbox(open ? 'selected' : 'selected');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openListbox('last');
    }
  }

  function onListboxKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx(i => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx(i => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Home') {
      e.preventDefault(); setFocusedIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault(); setFocusedIdx(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectAndClose(focusedIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeListbox(true);
    } else if (e.key === 'Tab') {
      // APG editorial: Tab selects + closes (researcher recommendation)
      selectAndClose(focusedIdx);
    }
  }

  const currentLabel = options[selectedIdx]?.label ?? options[0]?.label ?? '';
  const activeDescendantId = open ? `${optionIdPrefix}-${focusedIdx}` : undefined;

  return (
    <div class="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={activeDescendantId}
        class="h-8 px-3 py-2 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:bg-[var(--color-surface-alt)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] inline-flex items-center gap-1"
        onClick={() => open ? closeListbox(false) : openListbox('selected')}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{currentLabel}</span>
        <ChevronDown size={14} class={`text-[var(--color-fg-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          class="absolute z-10 mt-1 min-w-[180px] py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
          onKeyDown={onListboxKeyDown}
        >
          {options.map((opt, idx) => {
            const isSelected = idx === selectedIdx;
            const isFocused = idx === focusedIdx;
            return (
              <li
                key={`${opt.field}:${opt.dir}`}
                id={`${optionIdPrefix}-${idx}`}
                role="option"
                aria-selected={isSelected}
                class={`h-8 px-3 py-2 text-sm flex items-center gap-1 cursor-pointer ${
                  isSelected ? 'bg-[var(--color-accent)] text-[var(--color-bg)]' :
                  isFocused ? 'bg-[var(--color-surface-alt)]' :
                  ''
                }`}
                onClick={() => selectAndClose(idx)}
                onMouseEnter={() => setFocusedIdx(idx)}
              >
                {isSelected ? <Check size={14} /> : <span class="w-3.5" aria-hidden="true" />}
                <span>{opt.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

**Note on `useId`:** Preact 10.11+ ships `useId` for SSR-safe stable ID generation. Project already uses Preact 10.x; confirm version during plan derivation. Fallback if `useId` unavailable: a module-scoped counter (good enough for client-only rendering).

### Pattern 6: localStorage + URL reconciliation (read-side state machine)

**What:** On mount, the dashboard hydrates `gridSort` and `treeSort` signals via a deterministic state machine: URL → localStorage → defaults, with the side-effect rules locked in CONTEXT.md D-13 / D-15.

**Source:** Project precedent — `main.tsx:14-30` (ThemeToggle pre-paint pattern). Phase 18 deviates from pre-paint because (a) sort UI is below-the-fold, (b) no FOUC concern, (c) inline scripts complicate CSP. Use `useEffect` instead.

**State machine (lands in `packages/dashboard/src/lib/sortHelpers.ts`):**
```typescript
import {
  type VersionSort, type HierarchySort, type SortField, type HierarchySortField,
  DEFAULT_VERSION_SORT, DEFAULT_HIERARCHY_SORT,
} from './sortTypes.js';  // mirrored from server enum (D-WEBUI-31)

const VERSION_FIELDS: ReadonlySet<SortField> = new Set(['completed_at', 'created_at', 'name', 'version_number']);
const HIERARCHY_FIELDS: ReadonlySet<HierarchySortField> = new Set(['name', 'created_at']);
const DIRS: ReadonlySet<'asc' | 'desc'> = new Set(['asc', 'desc']);

/** Parse "field:dir" string against a whitelist. Returns null on invalid. */
export function parseSortValue<F extends string>(
  raw: string | null,
  fieldWhitelist: ReadonlySet<F>,
): { field: F; dir: 'asc' | 'desc' } | null {
  if (!raw) return null;
  const colon = raw.indexOf(':');
  if (colon < 0) return null;
  const field = raw.slice(0, colon);
  const dir = raw.slice(colon + 1);
  if (!fieldWhitelist.has(field as F)) return null;
  if (!DIRS.has(dir as any)) return null;
  return { field: field as F, dir: dir as 'asc' | 'desc' };
}

export function serializeSortValue(s: { field: string; dir: 'asc' | 'desc' }): string {
  return `${s.field}:${s.dir}`;
}

const STORAGE_PREFIX = 'vfx-familiar';
const GRID_SORT_KEY = 'sort:grid';
const TREE_SORT_KEY = 'sort:tree';

/** Read + validate localStorage value. Returns null on missing/invalid. */
function readLocalStorageSort<F extends string>(
  fullKey: string,
  fieldWhitelist: ReadonlySet<F>,
): { field: F; dir: 'asc' | 'desc' } | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null = null;
  try { raw = localStorage.getItem(fullKey); } catch { return null; }
  if (!raw) return null;
  let obj: any;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  if (!fieldWhitelist.has(obj.field)) return null;
  if (!DIRS.has(obj.dir)) return null;
  return obj as { field: F; dir: 'asc' | 'desc' };
}

/**
 * SORT-03 hydrate: URL wins (D-13), else localStorage (validated), else default.
 * Side-effect rules:
 *   - If URL had valid value → leave localStorage alone, no URL write.
 *   - If URL missing / invalid AND localStorage valid → use localStorage AND
 *     write URL via replaceState (D-15: URL always shows current sort).
 *   - If both missing/invalid → use default AND write both URL + localStorage.
 *
 * The function is INTENDED to be called once on mount (useEffect).
 */
export function hydrateSortState(): { gridSort: VersionSort; treeSort: HierarchySort } {
  const url = new URL(window.location.href);
  const urlGrid = parseSortValue(url.searchParams.get('gridSort'), VERSION_FIELDS);
  const urlTree = parseSortValue(url.searchParams.get('treeSort'), HIERARCHY_FIELDS);

  const lsGrid = urlGrid ? null : readLocalStorageSort(`${STORAGE_PREFIX}:${GRID_SORT_KEY}`, VERSION_FIELDS);
  const lsTree = urlTree ? null : readLocalStorageSort(`${STORAGE_PREFIX}:${TREE_SORT_KEY}`, HIERARCHY_FIELDS);

  const finalGrid: VersionSort = (urlGrid ?? lsGrid ?? DEFAULT_VERSION_SORT) as VersionSort;
  const finalTree: HierarchySort = (urlTree ?? lsTree ?? DEFAULT_HIERARCHY_SORT) as HierarchySort;

  // Side effects: ensure URL is explicit (D-15) AND localStorage holds non-URL state.
  let urlChanged = false;
  if (!urlGrid) {
    url.searchParams.set('gridSort', serializeSortValue(finalGrid));
    urlChanged = true;
  }
  if (!urlTree) {
    url.searchParams.set('treeSort', serializeSortValue(finalTree));
    urlChanged = true;
  }
  if (urlChanged) {
    history.replaceState(null, '', url.toString());
  }

  // Write defaults to localStorage when no localStorage value existed AND no URL value either —
  // i.e., genuine first-time visitor. (Per D-13: URL wins doesn't touch localStorage.)
  if (!urlGrid && !lsGrid) {
    setBoundedLocalStorageEntry(STORAGE_PREFIX, GRID_SORT_KEY, JSON.stringify(finalGrid), 50);
  }
  if (!urlTree && !lsTree) {
    setBoundedLocalStorageEntry(STORAGE_PREFIX, TREE_SORT_KEY, JSON.stringify(finalTree), 50);
  }

  return { gridSort: finalGrid, treeSort: finalTree };
}

/** Update on user toggle: write signal + localStorage + URL replaceState. */
export function persistGridSort(next: VersionSort) {
  const url = new URL(window.location.href);
  url.searchParams.set('gridSort', serializeSortValue(next));
  history.replaceState(null, '', url.toString());
  setBoundedLocalStorageEntry(STORAGE_PREFIX, GRID_SORT_KEY, JSON.stringify(next), 50);
}

export function persistTreeSort(next: HierarchySort) {
  const url = new URL(window.location.href);
  url.searchParams.set('treeSort', serializeSortValue(next));
  history.replaceState(null, '', url.toString());
  setBoundedLocalStorageEntry(STORAGE_PREFIX, TREE_SORT_KEY, JSON.stringify(next), 50);
}
```

### Pattern 7: setBoundedLocalStorageEntry LRU primitive

**What:** Helper that writes to `localStorage` while enforcing a per-prefix cap. When the cap is exceeded, the least-recently-used entry under that prefix is evicted. Forward-compat for Phase 19 (`summary:` keys) and v1.3 (per-shot keys).

**Design choice — companion key vs. per-key timestamp:** the companion-key approach uses ONE additional key (`{prefix}:_lru`) that holds a JSON array of keys ordered by recency (most recent first). Pros: O(1) read, O(N) write of small array, single eviction probe per write. Cons: companion key itself must be tracked under the cap (off-by-one). Per-key timestamp suffix would attach `__ts` to each value or use separate `{key}:__ts` keys: read every key on eviction, sort, evict oldest. Pros: no companion key. Cons: O(N) read on every write.

**Recommendation: companion key.** v1.2 has 2 sort keys, v1.3 may add ~10 per-shot keys, Phase 19 adds maybe 50 summary cache keys — all comfortably under cap=50. Companion key's O(N) write is negligible at these sizes.

**Implementation (lands in `packages/dashboard/src/lib/sortHelpers.ts`, exported separately):**
```typescript
/**
 * Write a value to localStorage under `${prefix}:${key}` with bounded-keys
 * LRU eviction. The companion key `${prefix}:_lru` holds an ordered list of
 * keys (most recent first). When the count exceeds maxKeys, the least
 * recently used key is evicted.
 *
 * Edge cases:
 *  - localStorage unavailable (privacy mode): silently no-op (mirrors theme pattern).
 *  - Quota exceeded mid-write: fall through silently. The companion key is
 *    rewritten on every call, so any orphan from a partial write self-heals.
 *  - JSON parse failure on companion key: treat as empty (rebuilds on first
 *    write). Defensive: a single corrupted byte in the companion key would
 *    otherwise wedge writes.
 *  - Key collision across prefixes: the prefix is part of the full storage
 *    key name, so `theme` under `vfx-familiar:` won't collide with anything
 *    under e.g. `summary:`.
 */
export function setBoundedLocalStorageEntry(
  prefix: string,
  key: string,
  value: string,
  maxKeys: number,
): void {
  if (typeof localStorage === 'undefined') return;
  const lruKey = `${prefix}:_lru`;
  const fullKey = `${prefix}:${key}`;

  let lruList: string[] = [];
  try {
    const raw = localStorage.getItem(lruKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        lruList = parsed.filter((k): k is string => typeof k === 'string');
      }
    }
  } catch {
    // Corrupted companion key — treat as empty.
    lruList = [];
  }

  // Move/insert key to front (most recent).
  lruList = [key, ...lruList.filter(k => k !== key)];

  // Evict from the tail until we're at cap.
  while (lruList.length > maxKeys) {
    const evict = lruList.pop()!;
    try { localStorage.removeItem(`${prefix}:${evict}`); } catch { /* swallow */ }
  }

  // Write value + updated companion. Order: value FIRST so a quota throw on
  // the companion still leaves a usable value at fullKey.
  try {
    localStorage.setItem(fullKey, value);
    localStorage.setItem(lruKey, JSON.stringify(lruList));
  } catch {
    // Quota / privacy mode — silent fall through.
  }
}
```

**Note on the `_lru` companion under Phase 18's TWO keys:** with maxKeys=50 and only 2 actual sort keys (`sort:grid`, `sort:tree`), the LRU list is tiny. The cap is forward-compat for Phase 19 / v1.3.

### Pattern 8: HTTP route Zod schemas

**What:** Hono route handler parses `?sort=field:dir&cursor=…&limit=20` query params via Zod. Validates against the same whitelist as the engine. Malformed → `INVALID_INPUT` 4xx + structured error envelope.

**Source:** Project precedent — `dashboard-routes.ts:104-115` `qNum` helper for numeric query params; `dashboard-routes.ts:183-196` `INVALID_INPUT` throw for missing required params.

**Implementation (lands in `src/http/dashboard-routes.ts`):**
```typescript
import { z } from 'zod';

const VersionSortFieldEnum = z.enum(['completed_at', 'created_at', 'name', 'version_number']);
const HierarchySortFieldEnum = z.enum(['name', 'created_at']);
const SortDirectionEnum = z.enum(['asc', 'desc']);

/** Parse "field:dir" string. Throws TypedError('INVALID_INPUT') on malformed. */
function parseVersionSortParam(raw: string | undefined): VersionSort {
  if (!raw) return DEFAULT_VERSION_SORT;
  const colon = raw.indexOf(':');
  if (colon < 0) {
    throw new TypedError('INVALID_INPUT', `Malformed sort param '${raw}' — expected 'field:dir'`,
      `Use ?sort=completed_at:desc (or any of: ${[...VersionSortFieldEnum.options].join(', ')} × asc/desc)`);
  }
  const field = VersionSortFieldEnum.safeParse(raw.slice(0, colon));
  const dir = SortDirectionEnum.safeParse(raw.slice(colon + 1));
  if (!field.success || !dir.success) {
    throw new TypedError('INVALID_INPUT', `Invalid sort param '${raw}'`,
      `Use ?sort=completed_at:desc (or any of: ${[...VersionSortFieldEnum.options].join(', ')} × asc/desc)`);
  }
  return { field: field.data, dir: dir.data };
}

// Cursor: opaque string, validated by decode.
function parseCursorParam(raw: string | undefined): VersionCursor | null {
  if (!raw) return null;
  const c = decodeVersionCursor(raw);
  if (!c) {
    throw new TypedError('INVALID_INPUT', `Malformed cursor '${raw.slice(0, 20)}...'`,
      'Drop the ?cursor= param to start from page 1');
  }
  return c;
}

// In the route handler:
app.get('/api/shots/:id/versions', (c) => {
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const sort = parseVersionSortParam(c.req.query('sort'));
  const cursor = parseCursorParam(c.req.query('cursor'));
  // include_tags / include_metadata preserved
  return c.json(engine.listVersionsForShot(c.req.param('id'), { sort, cursor, limit, ... }));
});
```

**Defence-in-depth:** the dashboard's `lib/sortHelpers.ts:parseSortValue` does the same validation client-side BEFORE issuing the request, providing graceful fallback on URL parse failures (D-16). The engine never trusts the client; the client never displays a 4xx if it can avoid one.

### Pattern 9: Pagination contract change for fetchVersions

**What:** `fetchVersions` migrates from `Promise<Version[]>` to `Promise<{ items, next_cursor, total_count }>`. The `versions` signal becomes a paginated buffer (concat on Load more, reset on sort change or shot change). The `latestCompletedForSelectedShot` derivation in `HomeView.tsx:207` continues to work because page 1 with the new ORDER BY (in-progress band first, then `completed_at DESC`) puts the latest completed row at the FIRST non-NULL position, which `versions.value.find(v => normalizeStatus(v.status) === 'complete')` finds correctly. **No code change needed at the derivation site** — the new sort happens to preserve its invariant.

**Edge case:** if a shot has >20 in-progress versions and ZERO completed in page 1, the derivation returns undefined (skeleton fallback). This was already true under the old `version_number DESC` shape (a shot with 20 in-progress + 1 completed at version_number=21 would put the completed row at position 1 under old shape, but at position 21 under new shape — pushing it out of page 1). **Mitigation:** the planner adds a comment-pin in `HomeView.tsx` documenting that the TreeSidebar shot card may show skeleton while a partial first page is loaded; if v1.3 makes per-shot prefetch cheap, revisit.

**Migration shape (lands in `packages/dashboard/src/lib/api.ts`):**
```typescript
export interface FetchVersionsParams {
  sort?: { field: SortField; dir: 'asc' | 'desc' };
  cursor?: string;     // base64url-encoded; opaque to dashboard
  limit?: number;
  include_tags?: boolean;
  include_metadata?: boolean;
}

export interface PaginatedVersionsResponse {
  items: Version[];
  next_cursor: string | null;
  total_count: number;
  has_more: boolean;
}

export function fetchVersions(
  shotId: string,
  params?: FetchVersionsParams,
): Promise<PaginatedVersionsResponse> {
  const query = qs({
    sort: params?.sort ? `${params.sort.field}:${params.sort.dir}` : undefined,
    cursor: params?.cursor,
    limit: params?.limit,
    include_tags: params?.include_tags,
    include_metadata: params?.include_metadata,
  });
  return fetchJson<PaginatedVersionsResponse>(
    `/api/shots/${encodeURIComponent(shotId)}/versions${query}`,
  );
}
```

**Note on the `qs()` helper:** `lib/api.ts:84-91` already filters undefined values cleanly. No changes to `qs()` needed.

### Pattern 10: Tree sort propagation (client-side re-sort)

**What:** When user toggles `treeSort`, the already-fetched `children.projects[wsId]`, `children.sequences[projId]`, `children.shots[seqId]` arrays in `HomeView.tsx` re-sort client-side via a comparator. No new fetches.

**Why client-side:** initial fetch under `treeSort` happens at expand-time, server-side. Subsequent toggles re-sort the existing arrays. Server stays consistent — a fresh expand under new sort returns server-sorted results matching the comparator. Client-side re-sort is sub-millisecond for typical hierarchy sizes (≤100 children per node).

**Comparator (lands in `lib/sortHelpers.ts`):**
```typescript
export function compareTreeNodes<T extends { name: string; created_at: number }>(
  a: T, b: T, sort: HierarchySort,
): number {
  let cmp: number;
  if (sort.field === 'name') {
    cmp = a.name.localeCompare(b.name);
  } else /* sort.field === 'created_at' */ {
    cmp = a.created_at - b.created_at;
  }
  return sort.dir === 'desc' ? -cmp : cmp;
}
```

**Usage in HomeView.tsx (existing tree composition at line 222-249):**
```typescript
const tree: TreeWorkspace[] = workspaces.value
  .slice()
  .sort((a, b) => compareTreeNodes(a, b, treeSort.value))
  .map((ws) => ({
    ...ws,
    projects: (children.projects[ws.id] ?? [])
      .slice()
      .sort((a, b) => compareTreeNodes(a, b, treeSort.value))
      .map(...)
  }));
```

**Tradeoff:** the client-side comparator must STAY in lockstep with the server's ORDER BY semantics. If server uses Unicode-aware collation for `name` ASC and client uses `localeCompare`, results may diverge for non-ASCII names. **Mitigation:** name field is constrained by the project's naming-template regex (entity names are typically ASCII/alphanumeric); divergence is rare. If a real divergence shows up in testing, the planner adds a single integration test that asserts the same sorted order for both layers on a Unicode fixture.

### Pattern 11: SortDropdown reuse — single component instance

**What:** D-08 locks ONE `<SortDropdown/>` reused for both grid and tree. The component is generic over the `field` enum.

**Generic-typed signature (already shown in §"Preact custom dropdown a11y"):**
```typescript
export interface SortDropdownProps<TField extends string = string> {
  options: ReadonlyArray<SortOption<TField>>;
  value: { field: TField; dir: 'asc' | 'desc' };
  onChange: (next: { field: TField; dir: 'asc' | 'desc' }) => void;
  ariaLabel: string;
}
```

**Storybook-style usage in HomeView.tsx:**
```typescript
const GRID_OPTIONS: ReadonlyArray<SortOption<SortField>> = [
  { field: 'completed_at', dir: 'desc', label: 'Latest' },
  { field: 'completed_at', dir: 'asc', label: 'Oldest' },
  { field: 'name', dir: 'asc', label: 'Name A→Z' },
  { field: 'version_number', dir: 'desc', label: 'Version ↓' },
] as const;

const TREE_OPTIONS: ReadonlyArray<SortOption<HierarchySortField>> = [
  { field: 'name', dir: 'asc', label: 'A→Z' },
  { field: 'name', dir: 'desc', label: 'Z→A' },
  { field: 'created_at', dir: 'desc', label: 'Newest' },
  { field: 'created_at', dir: 'asc', label: 'Oldest' },
] as const;

// In the JSX:
<SortDropdown
  options={GRID_OPTIONS}
  value={gridSort.value}
  onChange={(next) => { gridSort.value = next; persistGridSort(next); /* + reset cursor + scroll-to-top */ }}
  ariaLabel="Sort versions by"
/>
<SortDropdown
  options={TREE_OPTIONS}
  value={treeSort.value}
  onChange={(next) => { treeSort.value = next; persistTreeSort(next); }}
  ariaLabel="Sort tree by"
/>
```

### Pattern 12: Hierarchy sort parameter back-compat

**What:** D-10 — `listProjects/listSequences/listShots` add an OPTIONAL `sort` opts parameter; default unchanged for callers that don't pass `sort`.

**New signatures (lands in `src/store/hierarchy-repo.ts`):**
```typescript
listProjects(
  workspaceId: string | undefined,
  limit: number,
  offset: number,
  opts?: { sort?: HierarchySort },
): { items: Project[]; total_count: number } {
  const sort = opts?.sort;
  const orderBy = sort
    ? buildHierarchyOrderBy(projects, sort)
    : sql`${asc(projects.created_at)}, ${asc(projects.id)}`;  // existing default
  // ... rest unchanged: existing eq() filter + LIMIT/OFFSET
}
```

**Caller back-compat verification:**
- `src/tools/project-tool.ts:88` calls `engine.listProjects(input.workspaceId, input.limit, input.offset)` — no `opts` passed → existing default ORDER BY preserved → tool tests don't change.
- `src/http/dashboard-routes.ts:131` (and 142, 153) calls `engine.listProjects(...)` — no `opts` passed today; the planner gates on whether to add `?sort=` parsing here. **D-10 says yes: the dashboard fetchers DO pass sort. The MCP tool callers do NOT.** This means the engine layer must accept the optional param and propagate it.

**Engine layer wiring (lands in `src/engine/pipeline.ts:540`):**
```typescript
listProjects(
  workspaceId: string | undefined,
  limit: number,
  offset: number,
  opts?: { sort?: HierarchySort },
): ListResult<Project> {
  const { items, total_count } = this.repo.listProjects(workspaceId, limit, offset, opts);
  // ... existing wrapping
}
```

**Test impact:** existing tool tests at `src/tools/__tests__/breadcrumb-always.test.ts:167` `engine.listShots(seq.id, 20, 0)` continue to work without modification (TypeScript optional param).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dynamic ORDER BY | String concat with user input | `Record<SortField, SQLiteColumn>` map + `sql\`${col} ${dir}\`` template | SQL injection by default; the project's existing precedent at `version-repo.ts:216` is the safe shape |
| Composite ORDER BY assembly | Manual string concat | `sql.join([sql\`...\`, sql\`...\`], sql\`, \`)` | Drizzle 0.45.x stable API; preserves parameterization |
| NULLS FIRST/LAST polyfill | `CASE WHEN col IS NULL THEN 0 ELSE 1 END` (verbose) | `(col IS NULL) DESC` | SQLite supports IS-NULL as a boolean expression directly; idiom locked in CONTEXT.md D-03 |
| Cursor encoding | Custom binary format | base64url-encoded JSON `{ cna, sv, vid }` | Industry standard (Linear/GitHub/Stripe); Node Buffer API native |
| WHERE-after-cursor lex compare | Manual SQL with backslash-escaping | `sql.join` of three OR-branches with parameterized values | Drizzle parameterizes; same shape works for ASC and DESC |
| Combobox keyboard nav | Custom `tabIndex` juggling | WAI-ARIA APG combobox pattern (`aria-activedescendant` + listbox-receives-focus) | Tested by every screen reader; lower bug surface than custom |
| Outside-click handler | Library (`react-onclickoutside`) | `useEffect` + `document.addEventListener('mousedown')` | 5 lines of code; project has no current outside-click dep |
| URL parsing | Manual `split('&')` | `URL` + `URLSearchParams` (browser-native) | Battle-tested; handles edge cases (encoded chars, repeated keys) |
| URL state mirror writeback | Custom location.search manipulation | `history.replaceState(null, '', url.toString())` | Browser-native; explicit semantics; no library |
| LRU eviction | Per-key sweep on every read | Companion `_lru` array with O(N) write | Clear, contained primitive; ≤50 keys at scale |
| Cursor pagination total_count | Count via cursor walk | Continue using existing `COUNT(*)` query (already in `listByShot:208`) | The total_count is independent of cursor; existing query unchanged |
| Tree client-side re-sort | Re-fetch on toggle | `arr.slice().sort(comparator)` on cached children | Sub-ms for ≤100 children; matches dashboard's local-cache philosophy |

**Key insight:** Phase 18 is a coordination phase across 4 files (engine repo + HTTP route + dashboard component + dashboard state hook), not an algorithm phase. Every algorithmic primitive is either Drizzle-native, Browser-native, or a single-purpose <50-line helper. There is no library shopping list.

## Runtime State Inventory

> Phase 18 is read-only re-projection over existing rows. It changes how clients ASK for data; it does NOT change what's stored. Most categories don't apply.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `versions`, `projects`, `sequences`, `shots` schema unchanged. No migration. `outputs_json`, `provenance` untouched. | None |
| Live service config | None — engine is stateless re sort; no SaaS / external service wiring. | None |
| OS-registered state | None — no scheduled tasks, daemons, etc. | None |
| Secrets / env vars | None — no new secrets. | None |
| Build artifacts / installed packages | None — Phase 18 introduces ZERO new deps. | None |
| **Existing localStorage state** | `vfx-familiar:theme` (Phase 5). New keys are purely additive: `vfx-familiar:sort:grid`, `vfx-familiar:sort:tree`, `vfx-familiar:_lru`. | None — additive write, never deletes existing keys |
| **Existing URL search params** | None today (the dashboard ships at `/` without query params). New params `?gridSort=…&treeSort=…` are purely additive. | None — explicit URL writes via `history.replaceState`; no router change |

**Nothing found in any other category — verified by grep over `src/`, `drizzle/`, `.env*`, `scripts/`, and reviewing project docs.**

## Common Pitfalls

### Pitfall A: NULL-bit term inversion under DESC
**What goes wrong:** Planner writes `(completed_at IS NULL) ASC` thinking ASC ≈ "natural", but `(IS NULL)` returns 0 for false and 1 for true; ASC puts 0 first → completed rows pinned to top, in-progress rows at bottom. The opposite of D-01.
**Why it happens:** "ASC = top" is the wrong mnemonic when the boolean term is the "is unknown / pending" predicate.
**How to avoid:** **Always `(col IS NULL) DESC`** when pinning NULLs to the top. Add a comment in `buildVersionOrderBy` explaining the convention. Acceptance test: 3-fixture (1 NULL, 1 mid, 1 newest) under both DESC and ASC sort directions; assert NULL row is index 0 in both.
**Warning signs:** in-progress thumbnails appear at the BOTTOM of the grid; CONTEXT.md D-01 violated. UI-SPEC §"Pinned in-progress band has NO new visual chrome — composite cursor + NULLS-FIRST ordering is structurally invisible to the user — they see a unified vertical list" implies user can't see the band; visual smoke test (screenshot) catches this.

### Pitfall B: Cursor-stability race under inserts
**What goes wrong:** User loads page 1 (rows 1-20 in `completed_at DESC`). Between page 1 and page 2 fetch, a NEW completed version lands at the top (most-recent timestamp). Cursor encodes `(false, t_20, id_20)`. Page 2 returns rows from `(t_20, id_20)` onward — but the new top row didn't shift any existing rows OUT of page 1 (ordering before cursor is preserved). Net effect: user sees 20 rows in page 1, then page 2 from the 21st-most-recent. The new top row is never visible until user re-fetches page 1. **This is acceptable behavior** for cursor pagination and matches GitHub/Linear semantics.
**Why it happens:** Cursor pagination is consistent within a fetch but not across fetches; this is a fundamental tradeoff vs. offset pagination.
**How to avoid:** **Don't try to "fix" it at the cursor layer.** The mitigation is the user-action flow: switching shots or re-selecting the current shot resets cursor + re-fetches page 1. Phase 19's auto-refresh-on-completion (deferred) is the proper fix. Add a comment-pin in `versionRepo.listByShot` documenting the semantic.
**Warning signs:** test "insert a completed row between page 1 and page 2 fetches; assert page 2 starts at the original 21st row" passes; "assert new row visible on page 2" fails — that's the SPEC, not a bug.

### Pitfall C: Cursor-stability race under deletes
**What goes wrong:** User loads page 1 (rows 1-20). Some external actor deletes row 19 (e.g., redact path that the user doesn't have today, but a future PR might). Cursor encodes `(false, t_20, id_20)`. Page 2's WHERE-after-cursor `(c1 = c1_cursor AND c2 = c2_cursor AND c3 > c3_cursor)` works fine — the deleted row's gap is invisible. **This too is acceptable.** The deleted row is just gone; cursor pagination doesn't care.
**Why it happens:** Same as B — cursor is stable across rows, not against row mutations.
**How to avoid:** Acceptance test ("delete a row mid-page-1 then fetch page 2; assert no duplicate of row 21 in page 2"). Mitigation already structurally correct by composite tiebreaker.
**Warning signs:** Duplicate rows in concatenated `[...page1, ...page2]` array → bug in the WHERE-after-cursor builder, NOT in cursor stability per se.

### Pitfall D: Cursor decode error → 500 vs. INVALID_INPUT
**What goes wrong:** User shares a URL with a stale or hand-crafted `?cursor=garbage`. Server's `decodeVersionCursor(s)` returns null on JSON parse failure, but the route handler proceeds to call `listByShot` with `cursor: null` → returns page 1. **Silent fallback is wrong** for malformed cursors because user's UI scroll position assumes "load more" but gets page 1. **Recommendation:** route handler throws `INVALID_INPUT` 4xx when cursor decode fails; dashboard's fetch error handler catches and resets to page 1 with a console warning.
**How to avoid:** Pattern 8 above already throws on decode failure. Test: send `?cursor=abc!def` → assert 400 with `INVALID_INPUT` envelope. Dashboard fetch wrapper catches → resets `gridCursor.value = null`.
**Warning signs:** Server returns 500 (instead of 400) on cursor garbage → bug in decode error handling.

### Pitfall E: localStorage quota exceeded during write
**What goes wrong:** Browser hits 5MB localStorage quota. `setItem` throws `QuotaExceededError`. If we don't catch, the write attempt unwinds the user's sort change AND the URL replaceState, leaving signal at new value but persistence broken.
**Why it happens:** Real-world quota limits + cohabitation with other dashboard data (Phase 17 may cache thumbnail status, Phase 19 may cache summaries).
**How to avoid:** Wrap every `localStorage.setItem` in try/catch (mirrors `main.tsx:21-25`). On failure, log a warning, leave signal value unchanged, leave URL unchanged. **Locked in CONTEXT.md Claude's Discretion: "silently fall through to default behavior."**
**Warning signs:** `QuotaExceededError` in console + sort persists for the session but doesn't survive reload. Manual UAT step in PR description: "open dashboard in private mode; toggle sort; reload; verify sort defaults to Latest."

### Pitfall F: URL parse failure stops the dashboard from rendering
**What goes wrong:** Hand-crafted URL with malformed `?gridSort=` produces an exception in `parseSortValue` and bubbles up through `useEffect`. Preact catches in error boundary if one exists; otherwise the dashboard crashes.
**Why it happens:** Defensive parsing not defensive enough.
**How to avoid:** `parseSortValue` returns null on ALL failure paths (no throws). `hydrateSortState` falls back to localStorage → defaults. Locked in CONTEXT.md D-16. Defence-in-depth at the URL parse boundary mirrors engine enforcement.
**Warning signs:** Dashboard renders blank page on shared URL with malformed sort → bug; should silently fall back to default + console warning.

### Pitfall G: Focus management on dropdown close
**What goes wrong:** User clicks an option, listbox closes, focus disappears (lands on `<body>`). Keyboard users lose context.
**Why it happens:** Focus management not explicit.
**How to avoid:** `closeListbox(true)` always returns focus to `triggerRef.current`. Acceptance test: render `<SortDropdown/>`, open via Enter on trigger, navigate to option 3 with ArrowDown × 3, press Enter; assert `document.activeElement === triggerRef.current`.
**Warning signs:** Tab key after dropdown close skips to the next focusable element rather than starting from the trigger — focus management bug.

### Pitfall H: SortDropdown popover overflow / clipping
**What goes wrong:** Dropdown popover (180px wide, 4 options × 32px = 128px tall) renders with `position: absolute` inside a `overflow-y-auto` parent (`<main>` in HomeView.tsx:281). When opened near the bottom of the viewport, it clips below the fold.
**Why it happens:** `position: absolute` is bound by the nearest positioned ancestor with `overflow: hidden|auto|scroll`.
**How to avoid:** UI-SPEC §"The dropdown popover overlays the grid; it does NOT push content down" implies absolute positioning. v1.2 acceptance: popover opens above or below the trigger based on viewport space — this is the standard combobox auto-flip behavior. Implementation: simple measure (`triggerRef.current.getBoundingClientRect()` + `window.innerHeight - rect.bottom`) on open; flip with `top` vs `bottom` CSS positioning. **Defer auto-flip to a smoke-test/visual-QA step; v1.2 ships with `top` positioning by default and accept clipping at extreme bottom-of-viewport (unlikely for a sort-strip header positioned at the TOP of the grid).**
**Warning signs:** Visual QA at small viewport heights (e.g., 600px) shows popover clipped — file as v1.3 polish.

### Pitfall I: Architecture-purity inadvertent extension
**What goes wrong:** Planner writes `import { SortField } from '../../../src/store/sort.js'` in `packages/dashboard/src/lib/sortHelpers.ts`. The dashboard architecture-purity guard at `architecture-purity.test.ts:732` triggers: "packages/dashboard/src/** has zero imports from server (../../src/)".
**Why it happens:** TypeScript + monorepo shared types are tempting; project rule is duplicate-then-pin (D-WEBUI-31).
**How to avoid:** Mirror the `SortField`/`HierarchySortField`/`SortDirection` types in `packages/dashboard/src/lib/sortTypes.ts` (or inline in `sortHelpers.ts`). Add a comment-pin: "DUPLICATE OF src/store/sort.ts — keep in lockstep". A test asserts the union string sets are equal (parses both files at test time).
**Warning signs:** `architecture-purity.test.ts` red on `packages/dashboard/src/...` → reach-into-server import.

### Pitfall J: Drizzle `sql\`...\`` interpolation of column references
**What goes wrong:** Planner writes `sql\`${col.name} DESC\`` (string), thinking `col.name` is the column name. It IS, but Drizzle wraps quoted-identifier-escapes the parameterized values, NOT the interpolated strings — so `${col.name}` becomes a parameterized VALUE in the SQL, breaking the syntax.
**Why it happens:** Drizzle's column references (`versions.completed_at`) are SQL fragments, not strings. Interpolating a `.name` field at the JS level inserts the string as a value.
**How to avoid:** ALWAYS interpolate the column reference object directly: `sql\`${versions.completed_at} DESC\``. Drizzle's `sql\`\`` template recognizes column-reference objects and emits the quoted identifier (`"completed_at"`) without parameterization. **Pattern locked in `version-repo.ts:216` precedent.**
**Warning signs:** SQL syntax error in test logs: `near "?": syntax error` because the column name became a parameter.

## Code Examples

Verified patterns from official sources + project precedents:

### Engine-side ORDER BY composition (sql.join)
```typescript
// src/store/sort.ts (NEW)
// Source: drizzle docs https://orm.drizzle.team/docs/sql (sql.join)
// Project precedent: src/store/version-repo.ts:216

import { sql, type SQL } from 'drizzle-orm';
import { versions } from './schema.js';

export type SortField = 'completed_at' | 'created_at' | 'name' | 'version_number';
export type SortDirection = 'asc' | 'desc';

const VERSION_COLUMNS: Record<SortField, () => SQL> = {
  completed_at:   () => sql`${versions.completed_at}`,
  created_at:     () => sql`${versions.created_at}`,
  name:           () => sql`${versions.id}`,  // versions has no `name`; placeholder — see Open Questions
  version_number: () => sql`${versions.version_number}`,
};

export function buildVersionOrderBy(sort: { field: SortField; dir: SortDirection }): SQL {
  const dirSql = sort.dir === 'desc' ? sql`DESC` : sql`ASC`;
  return sql.join([
    sql`(${versions.completed_at} IS NULL) DESC`,    // NULL-bit pin (D-01)
    sql`${VERSION_COLUMNS[sort.field]()} ${dirSql}`, // user sort
    sql`${versions.id} ASC`,                          // tiebreaker (SORT-05)
  ], sql`, `);
}
```

### Cursor encode / decode
```typescript
// src/store/sort.ts (continued)

export interface VersionCursor {
  cna: boolean;
  sv: number | string | null;
  vid: string;
}

export function encodeVersionCursor(c: VersionCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeVersionCursor(s: string): VersionCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof obj?.cna !== 'boolean') return null;
    if (typeof obj?.vid !== 'string') return null;
    if (obj.sv !== null && typeof obj.sv !== 'number' && typeof obj.sv !== 'string') return null;
    return obj as VersionCursor;
  } catch { return null; }
}
```

### WHERE-after-cursor builder
```typescript
// src/store/sort.ts (continued)
import { type SQL, sql } from 'drizzle-orm';
import { versions } from './schema.js';
import type { VersionSort, VersionCursor, SortField } from './sort.js';

const VERSION_COL_REF: Record<SortField, () => SQL> = {
  completed_at:   () => sql`${versions.completed_at}`,
  created_at:     () => sql`${versions.created_at}`,
  name:           () => sql`${versions.id}`,
  version_number: () => sql`${versions.version_number}`,
};

/**
 * Build the lexicographic-comparison WHERE clause for "rows AFTER cursor"
 * under the composite ordering (NULL-bit DESC, sort_value <dir>, version_id ASC).
 *
 * SQL semantics: returns true for any row whose composite-tuple sort key
 * is "after" the cursor's tuple under the chosen sort direction.
 */
export function buildAfterCursorWhere(
  sort: VersionSort,
  cursor: VersionCursor,
): SQL {
  const colRef = VERSION_COL_REF[sort.field]();
  const sortOp = sort.dir === 'desc' ? sql`<` : sql`>`;
  const cnaInt = cursor.cna ? sql`1` : sql`0`;

  // For the NULL-bit term: cursor.cna=true means cursor row is in NULL band.
  // To advance past the NULL band into the non-NULL band: (col IS NULL) < cna.
  // Under "(col IS NULL) DESC" ordering, smaller IS-NULL value (i.e., 0/false)
  // comes AFTER larger (1/true). So "after cursor" advances when IS-NULL drops.
  return sql`(
    ((${versions.completed_at} IS NULL) < ${cnaInt})
    OR ((${versions.completed_at} IS NULL) = ${cnaInt}
        AND ${colRef} ${sortOp} ${cursor.sv})
    OR ((${versions.completed_at} IS NULL) = ${cnaInt}
        AND ${colRef} = ${cursor.sv}
        AND ${versions.id} > ${cursor.vid})
  )`;
}
```

### Migrated listByShot
```typescript
// src/store/version-repo.ts (MODIFIED listByShot)

import { eq, and, sql } from 'drizzle-orm';
import {
  buildVersionOrderBy, buildAfterCursorWhere,
  encodeVersionCursor, type VersionSort, type VersionCursor,
} from './sort.js';

listByShot(
  shotId: string,
  opts: { sort: VersionSort; cursor: VersionCursor | null; limit: number },
): { items: Version[]; next_cursor: string | null; total_count: number } {
  const { sort, cursor, limit } = opts;

  // total_count is independent of cursor (matches existing behavior at line 207).
  const totalRow = this.db
    .select({ c: sql<number>`COUNT(*)` })
    .from(versions)
    .where(eq(versions.shot_id, shotId))
    .get();

  // Build WHERE: shot filter + (optional) after-cursor predicate.
  const whereClause = cursor
    ? and(eq(versions.shot_id, shotId), buildAfterCursorWhere(sort, cursor))
    : eq(versions.shot_id, shotId);

  // Fetch limit+1 rows to peek for has_more.
  const rows = this.db
    .select()
    .from(versions)
    .where(whereClause)
    .orderBy(buildVersionOrderBy(sort))
    .limit(limit + 1)
    .all() as Version[];

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const lastRow = items[items.length - 1];
    const sortValue = readSortValue(lastRow, sort.field);
    nextCursor = encodeVersionCursor({
      cna: lastRow.completed_at === null,
      sv: sortValue,
      vid: lastRow.id,
    });
  }

  return { items, next_cursor: nextCursor, total_count: Number(totalRow?.c ?? 0) };
}

/** Pure helper — extracts the cursor's sort_value from a Version row. */
function readSortValue(row: Version, field: SortField): number | string | null {
  switch (field) {
    case 'completed_at':   return row.completed_at;
    case 'created_at':     return row.created_at;
    case 'version_number': return row.version_number;
    case 'name':           return row.id;  // versions has no name
  }
}
```

### Dashboard signal threading
```typescript
// packages/dashboard/src/state/versions.ts (MODIFIED)
import { signal } from '@preact/signals';
import type { VersionSort } from '../lib/sortTypes.js';
import type { Version } from '../types/entities.js';

export const versions = signal<Version[]>([]);
export const selectedVersionId = signal<string | null>(null);

// Phase 18 additions:
export const gridSort = signal<VersionSort>({ field: 'completed_at', dir: 'desc' });
export const gridCursor = signal<string | null>(null);   // opaque to dashboard
export const gridTotalCount = signal<number>(0);
export const gridIsFetching = signal<boolean>(false);
```

```typescript
// packages/dashboard/src/state/hierarchy.ts (MODIFIED)
import { signal } from '@preact/signals';
import type { HierarchySort } from '../lib/sortTypes.js';

// Existing signals preserved.
export const treeSort = signal<HierarchySort>({ field: 'name', dir: 'asc' });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `version_number DESC` hardcoded ORDER BY | Whitelisted ORDER BY enum with NULL-bit pin + composite cursor | Phase 18 (this) | Sortable + paginated + stable; "in-flight work never buried" UX rule |
| `limit/offset` pagination | Composite-cursor pagination | Phase 18 (this) | Stable across inserts/deletes; matches GitHub/Linear/Stripe semantics |
| `?limit=20&offset=40` | `?sort=…&cursor=…&limit=20` | Phase 18 (this) | URL grammar extends additively; existing limit/offset callers continue to work |
| Tree sort fixed at `created_at ASC, id ASC` | Tree sort whitelisted enum (`name \| created_at` × `asc \| desc`) | Phase 18 (this) | Smart-default-per-scope (A→Z for tree, Latest for grid) |
| Sort preference NOT persisted | localStorage + URL state mirror | Phase 18 (this) | Persistent across sessions; shareable views via URL |
| Native HTML `<select>` (none today) | Custom `<SortDropdown/>` per WAI-ARIA APG | Phase 18 (this) | Visual parity with rest of dashboard; theme-aware; full keyboard a11y |

**Deprecated/outdated:**
- **Offset-based pagination for cursor-stable views** — no project usage of offset for pagination beyond the legacy `limit/offset` shape that Phase 18 migrates. Existing offset-based callers (workspaces, projects, sequences, shots, assets) DO NOT migrate in Phase 18 — they remain on `limit/offset` because they don't need cursor stability under sort changes.
- **Single ORDER BY column with no tiebreaker** — already mitigated in `hierarchy-repo.ts:83` via `(created_at, id)` for RT-03; Phase 18 extends to versions.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `versions` table has no `name` column; `name` sort on the version grid maps to `version_id` (lexicographic on nanoid) | Pattern 1, §"Drizzle dynamic ORDER BY" | MEDIUM — REQUIREMENTS.md SORT-02 lists `name` as a valid version-grid sort key, but the schema has no `name` column on versions. Two valid resolutions: (a) sort by `versions.notes` (display label), (b) sort by `versions.id` (lexicographic nanoid) — neither is meaningfully ordered alphabetically. **Planner picks during plan derivation; researcher recommendation: drop the "Name A→Z" option from the version-grid dropdown (CONTEXT.md UI-SPEC GRID_OPTIONS only lists 4 options including Name; perhaps the user intended the tree dropdown's Name option, not the grid's). Confirm with user before finalizing GRID_OPTIONS array.** `[ASSUMED]` |
| A2 | Drizzle 0.45.2 `sql.join()` accepts an array of `SQL` fragments and a separator | Pattern 1 + Pattern 4 | LOW — `[CITED: orm.drizzle.team/docs/sql]` API is stable since 0.30.x; project pins ^0.45.2 (current). Verified with quick npm search. |
| A3 | Preact 10.x ships `useId` hook | Pattern 5 | LOW — Preact 10.11+ has `useId`; if not, fallback to module-scoped counter. Planner verifies via `npx --yes ctx7@latest docs /preactjs/preact-website "useId hook"` during plan execution. `[ASSUMED]` |
| A4 | nanoid IDs are lexicographically time-sortable enough that `versions.id ASC` approximates `created_at ASC` for the in-progress band sub-sort | Pattern 4 §"Resolution" | MEDIUM — nanoid's URL-safe alphabet `A-Za-z0-9_-` is non-monotonic; two nanoids generated within the same millisecond do NOT sort by creation order. Visual order may diverge from `created_at DESC` for the pinned band, but in practice (a) most shots have ≤3 in-progress at once, (b) typical session generation rate is seconds-apart, so the divergence is invisible. **Planner picks the simpler shape (id-ASC tiebreaker) per researcher recommendation; if user feedback surfaces re: ordering of the pinned band, escalate to the CASE-expression refinement.** `[ASSUMED]` |
| A5 | Hono `c.req.query()` returns `string \| undefined` (not `string[]` for repeated keys) | Pattern 8 | LOW — Hono 4.x docs `[CITED: hono.dev/docs/api/request#query]` say `query(name)` returns first value; for repeated keys use `queries(name)`. Phase 18 doesn't use repeated keys. |
| A6 | localStorage `setItem` failure mode is consistent across Chrome/Firefox/Safari (throws `QuotaExceededError`) | Pitfall E | LOW — well-documented standard behavior; project precedent at `main.tsx:21-25` already wraps in try/catch. |
| A7 | `history.replaceState(null, '', url.toString())` does NOT trigger a popstate event or a navigation | Pattern 6 | LOW — MDN spec: replaceState modifies the history entry without firing popstate. `[CITED: developer.mozilla.org/en-US/docs/Web/API/History/replaceState]` |
| A8 | Phase 5 design tokens (`--color-surface`, `--color-accent`, etc.) defined in `theme.css` work for the new sort-strip + dropdown colors | UI-SPEC | NONE — UI-SPEC.md confirmed `[VERIFIED: 18-UI-SPEC.md §Color]` with exact hex values for both themes. |
| A9 | Phase 17's `<SkeletonThumbnail/>` width=160 height=90 default is fine for the pinned in-progress band | D-04 | NONE — `[VERIFIED: CONTEXT.md D-04]` already locks "no new component needed for the pinned-state visual." |
| A10 | Architecture-purity guard at line 732 (`packages/dashboard/src/** has zero imports from server`) is the relevant invariant for Phase 18's dashboard-side mirror types | Pitfall I | NONE — `[VERIFIED: src/__tests__/architecture-purity.test.ts:732-740]` |

**Items to confirm before merge (planner action):**
- A1: GRID_OPTIONS array — does "Name A→Z" stay or get dropped?
- A4: in-progress band sub-sort — `id ASC` (simpler) or CASE-expression refinement (D-02-strict)?

## Open Questions (RESOLVED)

> Decisions that required a planning judgment call rather than a research answer. All 5 resolved by the planner during plan derivation; tracked inline below for traceability.

1. **Version-grid `name` sort target column.** REQUIREMENTS.md SORT-02 + UI-SPEC.md GRID_OPTIONS both list "Name A→Z" as a grid sort option, but the `versions` table has no `name` column. Three options: (a) drop "Name A→Z" from the grid dropdown (keep only Latest/Oldest/Version), (b) sort by `versions.notes` (display label), (c) sort by `versions.id` lexicographically. **Researcher recommendation: drop the option.** **RESOLVED**: option (a) accepted; tracked as DEVIATION 1 in Plan 18-04 (and DEVIATION 2 in Plan 18-01 local namespace). Engine `SortField` enum keeps all 4 fields for whitelist completeness; `GRID_SORT_OPTIONS` exposes only 3 reachable user-facing options. Hierarchy `name` sort works correctly (projects/sequences/shots have real `name` columns).
2. **In-progress band sub-sort fidelity.** D-02 says "in-progress band sub-sorted by `created_at DESC`". Pattern 4 §"Resolution" presents two implementations: (a) simpler `id ASC` tiebreaker (close enough for typical workloads, lower test surface), (b) strict CASE-expression refinement (exact D-02 fidelity, more SQL complexity). **Researcher recommendation: ship (a); flag (b) as v1.3.** **RESOLVED**: option (a) accepted; tracked as DEVIATION 1 (Plan 18-01 local namespace; corresponds to DEVIATION 2 in Plan 18-04). nanoid IDs are time-correlated within a session, so visual divergence is invisible for typical workloads. CASE-expression refinement deferred to v1.3.
3. **`<LoadMoreButton/>` standalone vs. inline.** UI-SPEC §"Component Inventory" leaves the choice between a separate `<LoadMoreButton/>` component and inline JSX in `HomeView.tsx`. Researcher recommendation: separate component for testability + future reuse. **RESOLVED**: standalone component shipped in Plan 18-04 Task 3 (`packages/dashboard/src/components/LoadMoreButton.tsx`) with its own Wave 0 stub `LoadMoreButton.test.tsx`.
4. **HierarchyEntity name UTF-8 collation parity (server vs. client).** Tree client-side re-sort uses `localeCompare`; server uses SQLite's default collation. For typical ASCII project/shot names, these match. If a user enters a non-ASCII name (Cyrillic, CJK), the orders may diverge by one row in edge cases. Researcher recommendation: ship the divergence; add an integration test on a Unicode fixture; revisit if a real divergence surfaces. **RESOLVED**: `localeCompare` shipped in Plan 18-04 `sortHelpers.ts::compareTreeNodes` with comment-pin documenting the v1.3 candidate; integration test on Unicode fixture lives in `sortHelpers.test.ts` (Test 22 — comparator parity).
5. **`gridIsFetching` signal placement.** The "Load more" button needs a "fetching" disabled state. Where does the in-flight signal live? Options: (a) module-level signal in `state/versions.ts`, (b) local `useState` in `HomeView.tsx`. Researcher recommendation: signal — consistent with the "all dashboard state lives in `state/`" pattern. **RESOLVED**: option (a) accepted; `gridIsFetching` ships as a signal in `state/versions.ts` (Plan 18-05 Task 1) alongside `gridSort`/`gridCursor`/`gridTotalCount`/`gridLoadMoreError`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 20 | Project (engines pin) | ✓ | v25 (per global CLAUDE.md) | — |
| `drizzle-orm` 0.45.x | Engine ORDER BY composition | ✓ | ^0.45.2 (package.json:43) | — |
| `zod` 4.3.x | HTTP route validation | ✓ | ^4.3.6 (package.json) | — |
| `nanoid` 5.x | (no new role; existing IDs only) | ✓ | ^5.1.9 (package.json) | — |
| `@preact/signals` | Sort state signals | ✓ | (current) | — |
| `lucide-preact` 1.x | `<ChevronDown/>` + `<Check/>` icons | ✓ | ^1.9.0 (already used by `TreeSidebar.tsx:40`) | Inline SVG (lower polish, fallback only) |
| Browser `history.replaceState` | URL state mirror | ✓ | Native since IE 10 / 2012 | none needed |
| Browser `localStorage` | Sort preference persistence | ✓ | Native since IE 8 / 2009 | Silent fall-through (D-discretion locked) |
| Browser `URL` + `URLSearchParams` | URL parse + serialize | ✓ | Native since Edge 12 (2015) | none needed |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `lucide-preact` (already in deps; inline SVG is a documented fallback if a future plan removes it).

## Validation Architecture

> Required by `workflow.nyquist_validation: true` in `.planning/config.json`. The orchestrator materializes 18-VALIDATION.md from this section. Structure mirrors Phase 17 RESEARCH §"Validation Architecture".

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 (root + dashboard packages) |
| Config file | `vitest.config.ts` (root) + `packages/dashboard/vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=basic --no-coverage src/__tests__/sort-*.test.ts src/store/__tests__/sort.test.ts src/store/__tests__/version-repo-sort.test.ts` (sub-30s on M1) |
| Full suite command | `npx vitest run && cd packages/dashboard && npx vitest run` (~2 min) |
| Architecture-purity command | `npx vitest run src/__tests__/architecture-purity.test.ts` |
| Dashboard suite | `cd packages/dashboard && npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SORT-01 | Default sort on version grid is `completed_at DESC` with in-progress band pinned to top via `(completed_at IS NULL) DESC` | unit (engine repo) | `npx vitest run src/store/__tests__/version-repo-sort.test.ts -t "default Latest"` | ❌ Wave 0 |
| SORT-01 | TreeSidebar default sort is A→Z (`name ASC`) on first load (no localStorage, no URL) | component | `cd packages/dashboard && npx vitest run src/__tests__/HomeView-sort-defaults.test.tsx -x` | ❌ Wave 0 |
| SORT-02 | Engine `versionRepo.listByShot` accepts whitelist enum {completed_at, created_at, name, version_number} × {asc, desc} and refuses anything outside via TypeScript exhaustive check + Zod 4xx at HTTP boundary | unit + integration | `npx vitest run src/store/__tests__/version-repo-sort.test.ts -t "whitelist" && npx vitest run src/__tests__/dashboard-routes-sort.test.ts -t "INVALID_INPUT"` | ❌ Wave 0 |
| SORT-02 | `<SortDropdown/>` renders 3 grid options + 4 tree options (grid: Latest / Oldest / Version ↓ — Name A→Z DROPPED per Plan 18-04 DEVIATION 1, see Open Question #1 RESOLVED; tree: A→Z / Z→A / Newest / Oldest) | component | `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "options render"` | ❌ Wave 0 |
| SORT-03 | Sort preference persists across reload via localStorage (key `vfx-familiar:sort:grid`) | component (browser-DOM via testing-library) | `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "localStorage write"` | ❌ Wave 0 |
| SORT-03 | URL state mirror: `?gridSort=completed_at:desc&treeSort=name:asc` always present after hydrate (D-15) | unit | `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "URL always explicit"` | ❌ Wave 0 |
| SORT-03 | URL wins on first load; localStorage untouched if URL had valid value (D-13) | unit | `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "URL wins"` | ❌ Wave 0 |
| SORT-03 | `setBoundedLocalStorageEntry` evicts least-recently-used at cap | unit | `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "LRU eviction"` | ❌ Wave 0 |
| SORT-03 | localStorage write failure (quota / privacy mode) silently falls through | unit | `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "quota fall-through"` | ❌ Wave 0 |
| SORT-04 | Tree dropdown smart default = A→Z; engine `listProjects/listSequences/listShots` accept optional `sort` opts param with default unchanged | unit + integration | `npx vitest run src/store/__tests__/hierarchy-repo-sort.test.ts && cd packages/dashboard && npx vitest run src/__tests__/HomeView-sort-defaults.test.tsx -t "tree A-Z"` | ❌ Wave 0 |
| SORT-04 | Existing tool callers (`project-tool.ts:88` etc) continue to work without modification (back-compat) | regression | `npx vitest run src/tools/__tests__/project-tool.test.ts src/tools/__tests__/sequence-tool.test.ts src/tools/__tests__/shot-tool.test.ts` | ✓ existing |
| SORT-05 | Composite cursor pagination — page 2 starts AFTER page 1's last row; no duplicates; no skips | integration | `npx vitest run src/store/__tests__/version-repo-cursor.test.ts -t "no duplicates no skips"` | ❌ Wave 0 |
| SORT-05 | Insert mid-page-1 to page-2 transition does NOT cause duplicate or shifted item in page 2 | integration | `npx vitest run src/store/__tests__/version-repo-cursor.test.ts -t "insert race"` | ❌ Wave 0 |
| SORT-05 | Delete mid-page-1 to page-2 transition does NOT cause duplicate of page-1 row in page 2 | integration | `npx vitest run src/store/__tests__/version-repo-cursor.test.ts -t "delete race"` | ❌ Wave 0 |
| SORT-05 | Sort change → cursor reset to null + scroll-to-top of `<main>` | component | `cd packages/dashboard && npx vitest run src/__tests__/HomeView-sort-toggle.test.tsx -t "scroll to top"` | ❌ Wave 0 |
| SORT-05 | "Load more" button visible iff `gridCursor.value !== null`; click triggers next-page fetch | component | `cd packages/dashboard && npx vitest run src/__tests__/LoadMoreButton.test.tsx -t "visibility"` | ❌ Wave 0 |
| SORT-05 | First page size = 20 (CONTEXT.md D-18 + CLAUDE.md convention) | unit | `npx vitest run src/store/__tests__/version-repo-sort.test.ts -t "default page size"` | ❌ Wave 0 |
| SORT-05 | Cursor decode failure → 4xx INVALID_INPUT (not 500) | integration | `npx vitest run src/__tests__/dashboard-routes-sort.test.ts -t "cursor decode error"` | ❌ Wave 0 |
| SORT-05 | In-progress versions pinned to top of page 1 on BOTH ASC and DESC sort directions (D-01 / D-02) | unit | `npx vitest run src/store/__tests__/version-repo-sort.test.ts -t "NULL pin"` | ❌ Wave 0 |

### Architecture / Cross-Cutting Tests
| Test | Type | Command | File Exists? |
|------|------|---------|-------------|
| Architecture-purity: `packages/dashboard/src/**` has zero server imports (Phase 18 mirrors types instead) | architecture-purity | `npx vitest run src/__tests__/architecture-purity.test.ts -t "zero imports from server"` | ✓ existing test (no change) |
| Architecture-purity: NO new MCP tools added (tool count holds at 7 of 12) | regression | `npx vitest run src/__tests__/tool-budget.test.ts` | ✓ existing test (no change) |
| Tool-engine separation: SORT logic NOT exposed via MCP tool action surface | architecture-purity | `npx vitest run src/__tests__/tool-budget.test.ts -t "tool count"` | ✓ existing |
| Append-only invariant on `provenance` table preserved (no UPDATE/DELETE on provenance from sort code paths) | regression | `grep -rE "this\.db\.update.*provenance\|this\.db\.delete.*provenance" src/` returns empty | ❌ inline grep test |
| WAI-ARIA combobox pattern compliance — `role="combobox"` + `aria-expanded` + `aria-haspopup="listbox"` + `aria-controls` on trigger; `role="listbox"` on popup; `role="option"` + `aria-selected` on items | component | `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "ARIA roles"` | ❌ Wave 0 |
| Keyboard navigation — Enter/Space/ArrowDown opens; ArrowUp/ArrowDown navigates; Escape closes + returns focus to trigger; Enter selects | component | `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "keyboard"` | ❌ Wave 0 |
| Outside-click closes the listbox without selecting | component | `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "outside click"` | ❌ Wave 0 |
| Focus management — focus returns to trigger on close (Escape, click outside, after select) | component | `cd packages/dashboard && npx vitest run src/__tests__/SortDropdown.test.tsx -t "focus return"` | ❌ Wave 0 |
| URL parse fallback — malformed `?gridSort=garbage` does not crash; falls back to default + console warning | unit | `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "malformed URL"` | ❌ Wave 0 |
| Tree client-side re-sort comparator stays in lockstep with server's ORDER BY semantics on ASCII fixture | integration | `cd packages/dashboard && npx vitest run src/__tests__/sortHelpers.test.ts -t "comparator parity"` | ❌ Wave 0 |
| Cursor pagination total_count surfaces correctly even mid-cursor-walk | unit | `npx vitest run src/store/__tests__/version-repo-cursor.test.ts -t "total_count"` | ❌ Wave 0 |
| Drizzle ORDER BY emits parameterized SQL with quoted identifiers (no string concat) | unit | `npx vitest run src/store/__tests__/sort.test.ts -t "parameterized SQL"` | ❌ Wave 0 |
| `latestCompletedForSelectedShot` derivation in HomeView still works under new ORDER BY shape | component | `cd packages/dashboard && npx vitest run src/__tests__/HomeView-sort-toggle.test.tsx -t "latest completed"` | ❌ Wave 0 |
| 7-of-12 tool budget invariant | regression | `npx vitest run src/__tests__/tool-budget.test.ts` | ✓ existing |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=basic src/store/__tests__/sort*.test.ts src/store/__tests__/version-repo-sort.test.ts src/store/__tests__/version-repo-cursor.test.ts && cd packages/dashboard && npx vitest run --reporter=basic src/__tests__/SortDropdown.test.tsx src/__tests__/sortHelpers.test.ts` (sub-30s)
- **Per wave merge:** `npx vitest run && cd packages/dashboard && npx vitest run` (full server + dashboard suite — currently 1365+ tests, will grow ~30 with this phase)
- **Phase gate:** Full suite green AND `npx tsc --noEmit` clean AND tool count holds at 7-of-12 (`tool-budget.test.ts` green)

### Wave 0 Gaps
- [ ] `src/store/__tests__/sort.test.ts` — buildVersionOrderBy + buildHierarchyOrderBy + cursor encode/decode unit tests
- [ ] `src/store/__tests__/version-repo-sort.test.ts` — listByShot whitelist enum + NULL-pin + default page size
- [ ] `src/store/__tests__/version-repo-cursor.test.ts` — composite cursor stability under inserts/deletes; total_count parity
- [ ] `src/store/__tests__/hierarchy-repo-sort.test.ts` — listProjects/listSequences/listShots opts.sort param + back-compat
- [ ] `src/__tests__/dashboard-routes-sort.test.ts` — Zod whitelist enforcement at HTTP boundary; INVALID_INPUT on malformed sort/cursor
- [ ] `packages/dashboard/src/__tests__/SortDropdown.test.tsx` — render + ARIA + keyboard + focus management + outside-click
- [ ] `packages/dashboard/src/__tests__/LoadMoreButton.test.tsx` — visibility + click + disabled-while-fetching
- [ ] `packages/dashboard/src/__tests__/sortHelpers.test.ts` — parseSortValue + hydrateSortState + persistGridSort/Tree + setBoundedLocalStorageEntry + comparator
- [ ] `packages/dashboard/src/__tests__/HomeView-sort-defaults.test.tsx` — default sort on first load (no URL, no localStorage)
- [ ] `packages/dashboard/src/__tests__/HomeView-sort-toggle.test.tsx` — toggle → cursor reset + scroll-to-top + URL replaceState + localStorage write
- [ ] (modify) `packages/dashboard/src/__tests__/api.test.ts` — fetchVersions return-shape change to `{ items, next_cursor, total_count }`

*Existing infrastructure (vitest, @testing-library/preact, jsdom from Phase 5+) covers framework needs — no installs required.*

## Security Domain

> `security_enforcement` is enabled by default (no `false` in config.json). Phase 18 has minimal security surface — sort logic is read-only over existing data. Required entries below.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | (single-user demo; no auth surface added) |
| V3 Session Management | no | (no sessions; URL state is per-window) |
| V4 Access Control | no | (no per-user access control; sort is read-only) |
| V5 Input Validation | yes | Zod whitelist enum for `sort=` and `cursor=` query params at HTTP boundary; TypeScript exhaustive switch on `SortField` ensures the engine only sees validated values; URL parse on dashboard side mirrors the same whitelist (defence-in-depth) |
| V6 Cryptography | no | (no new crypto; cursor is opaque base64-encoded JSON, not authenticated) |
| V8 Data Protection | yes (low) | localStorage values are non-sensitive (sort preferences); no PII stored. Multi-encoding leak scan from v1.1 doesn't apply (no signed payload introduced by Phase 18) |
| V11 Business Logic | yes | Cursor decode failure → 4xx (not 500); malformed URL → graceful fallback (not crash); no path traversal vector (no FS access from sort code paths) |

### Known Threat Patterns for {Hono + Preact + Drizzle SQLite stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via sort field | Tampering | `Record<SortField, SQLiteColumn>` whitelist + Drizzle `sql\`${col} ${dir}\`` parameterization. NEVER `sql.raw()` for user-controlled input. |
| SQL injection via cursor | Tampering | Cursor decode validates structure (`{cna: bool, sv: any, vid: string}`); each field used in WHERE is parameterized via `sql\`...\`` |
| XSS via sort label | Tampering | UI-SPEC §"Component Inventory" requires `<SortDropdown/>` to render labels as JSX text children (auto-escaped by Preact). NO `dangerouslySetInnerHTML`. |
| XSS via URL state | Tampering | URL parse uses native `URL`/`URLSearchParams`; values validated against whitelist; never rendered as HTML |
| Open redirect via URL state | Tampering | URL only mutates query params (`?gridSort=...`); never path or origin |
| DOS via cursor pagination | Repudiation | LIMIT cap of 20 (CLAUDE.md convention); no unbounded ranges |
| Storage exhaustion via localStorage | Availability | `setBoundedLocalStorageEntry` LRU primitive caps key count; quota errors silently swallowed |
| State leakage across users | Information Disclosure | Single-user demo; no per-user isolation needed; localStorage is browser-scoped |

**Pinned mitigations (planner attaches as plan-level constraints):**
1. Engine MUST use `Record<SortField, SQLiteColumn>` map; NO `sql.raw()` for the column reference.
2. HTTP route MUST throw `INVALID_INPUT` on malformed sort or cursor; NEVER 500.
3. Dashboard URL parser MUST gracefully fall back on malformed values; NEVER throw to error boundary.
4. localStorage writes MUST wrap in try/catch; NEVER unwind the user's sort change.
5. Cursor MUST be opaque base64 (server controls shape); dashboard NEVER inspects cursor contents.

## File Inventory

| Path | Role | New / Modified | Rationale |
|------|------|----------------|-----------|
| `src/store/sort.ts` | NEW | new | Whitelist enum + Drizzle ORDER BY builder + cursor encode/decode helpers; pure (zero MCP / DB-driver / native imports) |
| `src/store/version-repo.ts` | engine read | modified | `listByShot` signature change: `(shotId, limit, offset)` → `(shotId, { sort, cursor, limit })`; return shape gains `next_cursor` |
| `src/store/hierarchy-repo.ts` | engine read | modified | `listProjects/listSequences/listShots` gain optional `opts: { sort? }`; default unchanged for back-compat |
| `src/store/__tests__/sort.test.ts` | test | new | Wave 0 stub; ORDER BY + cursor unit tests |
| `src/store/__tests__/version-repo-sort.test.ts` | test | new | Wave 0; whitelist + NULL-pin + page size |
| `src/store/__tests__/version-repo-cursor.test.ts` | test | new | Wave 0; composite cursor stability |
| `src/store/__tests__/hierarchy-repo-sort.test.ts` | test | new | Wave 0; listProjects/sequences/shots opts.sort + back-compat |
| `src/engine/pipeline.ts` | engine facade | modified | `Engine.listVersionsForShot` delegates new repo shape; `listProjects/listSequences/listShots` gain optional `sort` |
| `src/http/dashboard-routes.ts` | HTTP route | modified | `GET /api/shots/:id/versions` parses `?sort=` + `?cursor=`; `GET /api/workspaces/:id/projects` (and 2 siblings) gain optional `?sort=` |
| `src/__tests__/dashboard-routes-sort.test.ts` | test | new | Wave 0; Zod boundary enforcement + 4xx on malformed |
| `packages/dashboard/src/components/SortDropdown.tsx` | UI primitive | new | WAI-ARIA APG combobox + listbox pattern; pure presentational; props-in/callbacks-out (Phase 17 thin-wrapper precedent) |
| `packages/dashboard/src/components/LoadMoreButton.tsx` | UI primitive | new | Pure button + remaining-count display; loading/disabled states |
| `packages/dashboard/src/components/__tests__/...` (or `packages/dashboard/src/__tests__/...`) | test | new | Wave 0; SortDropdown ARIA + keyboard + focus; LoadMoreButton click + visibility |
| `packages/dashboard/src/lib/sortTypes.ts` | type mirror | new | Mirrors `SortField`/`HierarchySortField`/`SortDirection` from server (D-WEBUI-31 architecture-purity) |
| `packages/dashboard/src/lib/sortHelpers.ts` | helper | new | parseSortValue + hydrateSortState + persistGridSort/Tree + setBoundedLocalStorageEntry + compareTreeNodes |
| `packages/dashboard/src/__tests__/sortHelpers.test.ts` | test | new | Wave 0; URL/localStorage state machine + LRU + comparator |
| `packages/dashboard/src/lib/api.ts` | API client | modified | `fetchVersions` signature gains `{ sort, cursor, limit }`; return type to `{ items, next_cursor, total_count }`; `fetchProjects/fetchSequences/fetchShots` gain optional `sort` |
| `packages/dashboard/src/state/versions.ts` | signals | modified | New `gridSort`, `gridCursor`, `gridTotalCount`, `gridIsFetching` signals |
| `packages/dashboard/src/state/hierarchy.ts` | signals | modified | New `treeSort` signal |
| `packages/dashboard/src/views/HomeView.tsx` | view orchestrator | modified | Composes `<SortDropdown/>` × 2 + `<LoadMoreButton/>`; `useEffect`-on-mount `hydrateSortState`; on-toggle handlers wire signal + persist + cursor reset + scroll-to-top; migrated `fetchVersions` consumer to paginated buffer |
| `packages/dashboard/src/__tests__/HomeView-sort-defaults.test.tsx` | test | new | Wave 0; first-load sort defaults |
| `packages/dashboard/src/__tests__/HomeView-sort-toggle.test.tsx` | test | new | Wave 0; toggle → cursor reset + URL replaceState + scroll-to-top |
| `packages/dashboard/src/__tests__/api.test.ts` | test | modified | Update fetchVersions return-shape expectations |
| `src/__tests__/architecture-purity.test.ts` | regression test | UNCHANGED | Sort logic is pure SQL/TS; no new allowed-set entries needed |
| `src/__tests__/tool-budget.test.ts` | regression test | UNCHANGED | Phase 18 adds ZERO new MCP tools; tool count holds at 7-of-12 |

**Schema migration count: holds at 0006** — no `versions` schema change; no new tables; no new columns. Append-only provenance untouched. Tool budget holds at 7-of-12. Architecture-purity allowed-set untouched (zero new native bindings; sort is pure TS/SQL).

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **NULL-handling correctness** — `(col IS NULL) DESC` works, but interaction with composite cursor under cross-band pagination is subtle. Bug here = "in-progress band leaks into page 2" or "page 1 misses an in-progress version". | HIGH | Pattern 4 §"Resolution" pins the simpler tiebreaker shape; acceptance test asserts NULL-band membership on both pages 1 and 2 across DESC and ASC sort dirs; CASE-expression refinement deferred to v1.3 |
| **Cursor stability under concurrent inserts** — typical edge case for cursor pagination. New row added between page 1 and page 2 is invisible until next full re-fetch. | LOW (acceptable) | Pitfall B documents this as expected behavior; matches GitHub/Linear/Stripe semantics. Phase 19's auto-refresh-on-completion is the proper fix. |
| **Cursor stability under deletes** — composite tiebreaker handles this naturally; no duplicate rows. | LOW | Pitfall C; acceptance test covers it |
| **Cursor decode error → server crash** — malformed cursor must not 500. | MEDIUM | Pattern 8 + Pitfall D; route handler throws `INVALID_INPUT` 4xx; dashboard fetch error handler catches |
| **localStorage quota exceeded** — silent fall-through is the locked behavior, but if not consistent across all setItem call sites, sort change may partially unwind. | MEDIUM | Pattern 7 + Pitfall E; every `setItem` wrapped in try/catch (mirrors `main.tsx:21-25`); UAT step in PR |
| **URL parse failure** — hand-crafted URL must not crash dashboard. | MEDIUM | Pattern 6 + Pitfall F; `parseSortValue` returns null on ALL failure paths; never throws |
| **Preact dropdown focus management** — focus must return to trigger on close; outside-click handler must not race against trigger click. | MEDIUM | Pattern 5; `closeListbox(true)` always returns focus; outside-click guard checks `triggerRef.current?.contains(t) || listboxRef.current?.contains(t)` |
| **Architecture-purity inadvertent breach** — dashboard mirroring of server enums tempts direct cross-package import. | LOW | Pitfall I; mirror types in `packages/dashboard/src/lib/sortTypes.ts` with comment-pin "DUPLICATE OF src/store/sort.ts"; existing test at `architecture-purity.test.ts:732` catches violations |
| **Tree sort comparator divergence (server vs. client)** — Unicode collation differences may produce off-by-one ordering. | LOW | Pattern 10; integration test on Unicode fixture; documented as acceptable for typical ASCII project names; revisit if real divergence surfaces |
| **`latestCompletedForSelectedShot` regression** — new ORDER BY shape might push the first complete row out of page 1 in pathological cases (>20 in-progress versions). | LOW | Pattern 9 §"Edge case"; comment-pin in HomeView; mitigation deferred to v1.3 prefetch |
| **GRID_OPTIONS misalignment with schema** — `name` sort option doesn't have a `name` column in `versions`. | MEDIUM | Open Question #1; planner picks during plan derivation (researcher recommendation: drop "Name A→Z" from GRID_OPTIONS) |
| **Drizzle `sql.join` API drift** — Phase 18 relies on `sql.join` API in 0.45.x. | LOW | Pattern 1 + Pitfall J; project pinned at ^0.45.2 (verified); API stable since 0.30.x |
| **Tool count exceeds 12** — Phase 18 adds NO new MCP tools, but a planner could mistakenly add a `sort` tool. | LOW | CLAUDE.md "Tool cap: Maximum 12" + existing `tool-budget.test.ts` regression; verifier checks |

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: project source]` `src/store/version-repo.ts:202-221` — current `listByShot` signature; verified line numbers
- `[VERIFIED: project source]` `src/store/hierarchy-repo.ts:73-92, 133-165, 205-237, 279-311` — current hierarchy list methods
- `[VERIFIED: project source]` `src/store/schema.ts:71-94` — versions table; `completed_at: integer('completed_at')` is nullable, all others NOT NULL
- `[VERIFIED: project source]` `src/__tests__/architecture-purity.test.ts:729-740` — dashboard purity guard
- `[VERIFIED: project source]` `packages/dashboard/src/lib/api.ts:148-165` — current `fetchVersions` signature + `qs()` helper
- `[VERIFIED: project source]` `packages/dashboard/src/components/ThemeToggle.tsx:31-42` — localStorage + try/catch pattern
- `[VERIFIED: project source]` `packages/dashboard/src/main.tsx:14-30` — pre-paint localStorage read pattern
- `[VERIFIED: project source]` `packages/dashboard/src/components/TreeSidebar.tsx:280-329` — TreeRow ARIA pattern
- `[VERIFIED: project source]` `packages/dashboard/src/views/HomeView.tsx:99-117, 194-218` — fetchVersions consumer + latestCompletedForSelectedShot derivation
- `[VERIFIED: project source]` `src/http/dashboard-routes.ts:104-115, 161-172, 380-433` — qNum helper, current /shots/:id/versions route, Phase 17 thumbnail route precedent
- `[VERIFIED: project source]` `package.json:43` — `drizzle-orm: ^0.45.2`
- `[VERIFIED: 18-CONTEXT.md]` D-01 through D-25 — 25 locked decisions
- `[VERIFIED: 18-UI-SPEC.md]` Approved 2026-05-06 — visual + interaction contract
- `[VERIFIED: 17-RESEARCH.md]` Validation Architecture template structure
- `[CITED: orm.drizzle.team/docs/sql]` — `sql.join`, `sql\`\`` parameterization, dynamic ORDER BY
- `[CITED: orm.drizzle.team/docs/select#order-by]` — `.orderBy()` API
- `[CITED: w3.org/WAI/ARIA/apg/patterns/combobox/]` — WAI-ARIA APG combobox + listbox pattern

### Secondary (MEDIUM confidence)
- `[CITED: learnsql.com/blog/how-to-order-rows-with-nulls/]` — SQLite NULL ordering semantics; IS-NULL idiom
- `[CITED: runebook.dev/en/docs/sqlite/lang_select/nullslast]` — SQLite 3.30.0+ native NULLS FIRST/LAST support
- `[CITED: developer.mozilla.org/en-US/docs/Web/API/History/replaceState]` — replaceState semantics
- `[CITED: hono.dev/docs/api/request#query]` — Hono query param API

### Tertiary (LOW confidence — none in this research)
- (no tertiary findings)

## Metadata

**Confidence breakdown:**
- Standard stack (Drizzle + Preact + Hono + Zod): HIGH — every API verified against docs + project precedents
- Architecture (engine repo + HTTP route + dashboard component + state hooks): HIGH — every layer has at least one in-project precedent (Phases 5, 12, 14, 17)
- NULL handling + composite cursor pagination: HIGH for the common case; MEDIUM for D-02 strict in-progress band sub-sort fidelity (researcher recommends simpler shape; flagged in Open Questions)
- WAI-ARIA combobox: HIGH — APG pattern is well-defined; Preact attribute pass-through proven by project precedent
- localStorage + URL reconciliation: HIGH — pure client state machine; no server interaction
- Pitfalls: HIGH — every pitfall has a mitigation either inline or via project precedent

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (30 days for stable tech stack: Drizzle, Preact, Hono APIs are all stable)

## RESEARCH COMPLETE
