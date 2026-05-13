---
phase: 21
slug: shot-grid-view
researched: 2026-05-13
domain: dashboard view + denormalized read endpoint + signal-driven routing
confidence: HIGH
---

# Phase 21: Shot Grid View - Research

**Researched:** 2026-05-13
**Domain:** Preact dashboard view (CSS Grid) + Hono read endpoint with single-query JOIN + Phase 20 SSE consumer + Phase 18 cursor + URL state precedent reuse
**Confidence:** HIGH (all decisions D-01..D-22 LOCKED; UI-SPEC approved 2026-05-13; every analog is in-tree)

## Summary

Phase 21 is the **primary v1.3 user surface**. It composes pre-existing dashboard primitives (`Thumbnail`, `SkeletonThumbnail`, `LoadMoreButton`, `EmptyState`, `TreeSidebar`) with five new files behind a signal-driven view switch in `App.tsx`. The backend introduces **one** new HTTP route (`GET /api/sequences/:id/shot-grid`) backed by a **single** SQL query that joins `shots` + latest-completed `versions` per shot via a `ROW_NUMBER() OVER (PARTITION BY shot_id ORDER BY completed_at DESC)` CTE — fully supported by the project's `better-sqlite3@^12.9.0` binding which ships SQLite ≥ 3.53 (window functions since 3.25.0). [VERIFIED: src/store/__tests__/version-repo-cursor.test.ts and the makeInMemoryDb fixture in src/test-utils/fixtures.ts]

The phase adds **zero new MCP tools** (tool cap remains 7/12), **zero new migrations** (read-only over `shots` + `versions` + Phase 20's `shots.status` denorm), and **zero new native bindings** (so `src/__tests__/architecture-purity.test.ts` requires no edits). All four critical patterns the planner needs already exist in the codebase:

1. **Window-function-CTE for latest-per-group** — supported and recommended over correlated subquery (single index scan vs N+1 lookups).
2. **Composite opaque-base64 cursor encoding** — verbatim reusable from `src/store/sort.ts` (`encodeVersionCursor` / `decodeVersionCursor`); Phase 21 ships a sibling `decodeShotCursor` keyed on `(name, shot_id)` since default sort is `shot.name ASC` (D-07 of REQUIREMENTS.md / Phase 18 "VFX artists know names not dates").
3. **SSE handler lifecycle** — `App.tsx:27-37` is a literal copy-paste pattern: `onSseEvent('shot.status_changed', onShotStatusChanged)` slots alongside existing `version.created`/`version.status_changed`. The server-side `EVENT_TYPES` tuple at `src/http/sse.ts:50-57` already includes `shot.status_changed`, but **the dashboard-local mirror at `packages/dashboard/src/types/events.ts` is missing the `ShotStatusChangedPayload` type and the corresponding map entry** — this is a load-bearing gap the plan must close in Task 1.
4. **URL state via `history.replaceState` + Zod whitelist + graceful fallback** — `packages/dashboard/src/lib/sortHelpers.ts:209-296` (`hydrateSortState`) is the verbatim model. Phase 21 ships a parallel `hydrateShotGridUrlState` reading `?seq=&view=&statusFilter=&showOmitted=`.

**Primary recommendation:** Build the new endpoint around `src/store/shot-status-repo.ts` (extend with `listShotsForGrid(db, sequenceId, opts)` — the file's existing pure-module + drizzle pattern matches). Use the window-function CTE for the join. Mirror Phase 18's HTTP route shape exactly: `qNum` for limit, opaque base64 cursor via a `decodeShotCursor` Zod-validated wrapper that returns `null` on garbage. Threaded into a thin Hono handler at `src/http/dashboard-routes.ts` adjacent to the existing `GET /api/sequences/:id/shots`. On the dashboard side, **add `shot.status_changed` to `packages/dashboard/src/types/events.ts` first** so the rest of Phase 21 can subscribe with full type safety.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `GET /api/sequences/:id/shot-grid` endpoint | API / Backend (Hono) | Database / Storage | Hono route is the thin Zod-validated entry point; real query lives in `src/store/shot-status-repo.ts` (per D-WEBUI-28 tool-engine separation, mirrored at HTTP layer). |
| Single-query join (window function CTE) | Database / Storage (SQLite) | — | Pure SQL; no engine-layer compute; D-13 lean payload shape. |
| Cursor pagination | Database / Storage | API / Backend | Cursor encoded/decoded in `shot-status-repo.ts` (mirrors `src/store/sort.ts`); HTTP route only Zod-validates the param. |
| Sequence-grouped grid render | Browser / Client (Preact) | — | New `ShotGridView` + `SequenceHeader` + `ShotGridCard` components. CSS Grid handled by browser. |
| Signal-driven view routing (`activeView`) | Browser / Client | — | `App.tsx` conditionally renders `HomeView` vs `ShotGridView`; no router library. Signal flip is the navigation primitive (Phase 19 VersionDrawer overlay precedent generalized). |
| URL state mirror (`?seq=&view=&statusFilter=&showOmitted=`) | Browser / Client | — | `history.replaceState` on every change; mount-time URL read precedes signal write. Mirrors Phase 18's `hydrateSortState` pattern in `lib/sortHelpers.ts:209-296`. |
| Client-side status filter | Browser / Client | — | `statusFilter` signal + `.filter()` over `shotGrid.value.shots` (REQ-03 explicit lock — no server param). |
| Aggregate status counts mini-pills | Browser / Client | — | Preact `computed` over `shots.value` reducing into `{ wip, pending_review, ... }` (D-14). |
| `shot.status_changed` SSE subscription | Browser / Client | API / Backend (existing emitter) | New `App.tsx` `onSseEvent` registration; handler mutates matching shot in `shotGrid.value.shots`. Server-side emitter wired by Phase 20 at `src/engine/pipeline.ts:725`. |
| `<ShotStatusPill/>` 5-status badge | Browser / Client | — | New component; mirrors `<StatusPill/>` design vocabulary (saturated bg + inverse text) with 5 new CSS custom properties in `theme.css`. |
| WCAG 2.1 AA contrast on 5 new tokens | Browser / Client (CSS) | — | UI-SPEC §"Color" already proves AA/AAA for both themes; no runtime cost. |

## Standard Stack

All dependencies are already installed and locked. **Phase 21 adds zero new dependencies.**

### Core (in use; versions verified in tree)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^12.9.0 | SQLite driver (WAL mode) | Already standardised. Ships SQLite 3.53 → window functions supported (since 3.25.0). [VERIFIED: package.json + WebSearch] |
| `drizzle-orm` | (lockfile) | Query builder | Existing repo layer (`shot-status-repo.ts`, `sort.ts`) uses `sql\`...\`` template + parameterised values. Phase 21 reuses the same `sql.join` pattern. |
| `hono` | ^4.12.14 | HTTP framework | Already used by `src/http/dashboard-routes.ts`. Phase 21 adds one route handler. |
| `zod` | ^4.3.6 | Validation | Same Zod-whitelist pattern as Phase 18 `parseHierarchySortParam` (`dashboard-routes.ts:189-210`). |
| `nanoid` | ^5.1.9 | ID generation | Not needed by Phase 21 (read-only endpoint, no new entities). |
| `preact` | ^10.29.1 | Dashboard runtime | Already standardised. |
| `@preact/signals` | ^2.9.0 | State management | All new signals in `state/shot-grid.ts` use `signal()` + `computed()`. |
| `lucide-preact` | ^1.9.0 | Icon set | `LayoutGrid`, `Home`, `ChevronDown`, `ChevronRight` all already-importable. [VERIFIED: packages/dashboard/package.json] |
| `tailwindcss` | ^4.2.4 | Utility CSS | v4 CSS-native `@theme` (NO `tailwind.config.js`). Confirmed at `packages/dashboard/src/styles/theme.css:14` `@import "tailwindcss"`. |
| `vitest` | ^4.1.4 (server) / ^4.1.5 (dashboard) | Test runner | Used by both side; phase tests piggyback on existing harness. |
| `@testing-library/preact` | ^3.2.4 | Component tests | Already present in dashboard devDependencies — covers `ShotGridView` / `ShotGridCard` / `ShotStatusPill`. |
| `jsdom` | ^29.0.2 | DOM for component tests | Already present. |

### Alternatives Considered (and rejected — locked decisions exist)
| Instead of | Could Use | Reject Because |
|------------|-----------|----------------|
| `ROW_NUMBER()` window function CTE | Correlated subquery `(SELECT id FROM versions v2 WHERE v2.shot_id = s.id AND v2.status='completed' ORDER BY v2.completed_at DESC LIMIT 1)` | SQLite optimises correlated subqueries as nested loops — O(N×M) without idx scaffolding. The window-function CTE is a single index walk. (See §"Architecture Patterns" Pattern 1 below.) |
| `ROW_NUMBER() OVER` CTE | `LEFT JOIN ... NOT EXISTS (...newer...)` | Equivalent O() but harder to read and harder to extend (Phase 23 will add `is_stale`; CTE composes; NOT EXISTS gets tangled). |
| Signal-driven view routing | `react-router-dom` / `preact-router` | LOCKED in REQUIREMENTS.md cross-cutting constraints ("Signal-driven view routing — no client-side router"). Phase 19 VersionDrawer overlay set the precedent. |
| New top-level MCP tool | (none — Phase 21 is dashboard-only) | LOCKED: tool cap 7/12 (D-13 of v1.3 cross-cutting; STAT-05 + GRID-04 endpoint is dashboard-only). |
| URL `pushState` | `replaceState` | LOCKED D-09: filter/toggle are view settings, not navigation events. Mirrors Phase 18 D-14. |

**Installation:** none required.

**Version verification (executed 2026-05-13):**
- `better-sqlite3@12.9.0` — bundles SQLite 3.53.0 (release notes confirm). Window functions present since SQLite 3.25.0 (2018-09-15). [VERIFIED: WebSearch + https://sqlite.org/windowfunctions.html]
- `tailwindcss@4.2.4` — uses CSS-native `@theme` block; no `tailwind.config.js`. [VERIFIED: existing theme.css imports + CONTEXT7-equivalent codebase grep]
- `lucide-preact@1.9.0` — `LayoutGrid`, `Home`, `ChevronDown`, `ChevronRight` exports already used in `TreeSidebar.tsx:40` (`ChevronRight`, `ChevronDown`). [VERIFIED]

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DASHBOARD CLIENT (Preact + signals)                │
│                                                                             │
│  ┌──────────┐                                                               │
│  │ App.tsx  │  ← onSseEvent('shot.status_changed', onShotStatusChanged)     │
│  │          │  ← signal: activeView ('home' | 'shot-grid')                  │
│  └──────────┘                                                               │
│       │                                                                      │
│       ├── home → <HomeView/> (existing, unchanged)                           │
│       │                                                                      │
│       └── shot-grid → <ShotGridView/>  ──────────────────────────────────┐   │
│              │                                                            │   │
│              ├── on mount: hydrateShotGridUrlState() (URL > signal)       │   │
│              ├── on selectedSequenceForGrid change: fetchShotGrid()        │   │
│              ├── SequenceHeader (computed aggregate counts mini-pills)    │   │
│              ├── ShotGridFilterBar (sticky; statusFilter + showOmitted)   │   │
│              ├── CSS Grid minmax(220px, 1fr)                              │   │
│              │     ShotGridCard[i] keyed on shot.id                       │   │
│              │       Thumbnail (Phase 17 lazy-load)                       │   │
│              │       ShotStatusPill (Phase 21 new)                        │   │
│              │       version count + relative timestamp                   │   │
│              │       on click → selectedVersionId = latest_completed_id   │   │
│              │                 (opens VersionDrawer — Phase 19 overlay)   │   │
│              └── LoadMoreButton when next_cursor !== null                 │   │
│                                                                            │   │
│   SSE event 'shot.status_changed' { shotId, fromStatus, toStatus, ... }    │   │
│   handler updates shotGrid.value.shots[i].status in-place (i = find by id) │   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ GET /api/sequences/:id/shot-grid
                                       ?cursor=<base64>&limit=20
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SERVER (Hono + Engine + Drizzle)                       │
│                                                                              │
│  src/http/dashboard-routes.ts                                                │
│    ├── Zod-validate :id path param                                            │
│    ├── parseShotCursorParam(c.req.query('cursor'))   ← new (mirrors          │
│    ├── qNum(c.req.query('limit'), 20, 'limit')          parseCursorParam)    │
│    └── engine.listShotGrid(sequenceId, { cursor, limit })                    │
│                                                                              │
│  src/engine/pipeline.ts                                                      │
│    Engine.listShotGrid(sequenceId, opts)                                     │
│       → delegates to listShotsForGrid(this.db, sequenceId, opts)             │
│                                                                              │
│  src/store/shot-status-repo.ts (extend) — new export listShotsForGrid        │
│    Single SQL with WITH-CTE:                                                 │
│      WITH ranked AS (                                                        │
│        SELECT v.id, v.shot_id, v.completed_at,                               │
│          ROW_NUMBER() OVER (PARTITION BY v.shot_id                           │
│                             ORDER BY v.completed_at DESC, v.id ASC) AS rn   │
│        FROM versions v                                                       │
│        WHERE v.status = 'completed' AND v.completed_at IS NOT NULL           │
│      )                                                                       │
│      SELECT s.id, s.name, s.status,                                          │
│        (SELECT COUNT(*) FROM versions vc WHERE vc.shot_id = s.id) AS vct,    │
│        r.id AS lcv_id, r.completed_at AS lcv_completed_at                    │
│      FROM shots s                                                            │
│      LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1                     │
│      WHERE s.sequence_id = ?                                                 │
│        AND (? IS NULL OR (s.name, s.id) > (?, ?))    -- after-cursor        │
│      ORDER BY s.name ASC, s.id ASC                                           │
│      LIMIT ? + 1                                                             │
│                                                                              │
│    Returns { shots, next_cursor, total_count }                               │
│    where total_count is a separate single COUNT(*) FROM shots WHERE seq_id=? │
│                                                                              │
│  Index utilisation:                                                          │
│    UNIQUE(shots.sequence_id, shots.name) autoindex → covers ORDER BY + WHERE │
│    UNIQUE(versions.shot_id, versions.version_number) autoindex → PARTITION   │
│      walks the shot_id leading edge; ORDER BY completed_at DESC requires a   │
│      sort within each partition (acceptable — partition size is bounded by   │
│      versions-per-shot, typically 1-20)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ shot.status_changed (existing SSE emit)
┌─────────────────────────────────────────────────────────────────────────────┐
│  Engine.setShotStatus  →  this.events.emitEvent('shot.status_changed', ...)  │
│  (already wired by Phase 20 at src/engine/pipeline.ts:725-733)               │
│  →  src/http/sse.ts listener loop (EVENT_TYPES tuple line 50-57 includes it) │
│  →  toDashboardPayload('shot.status_changed', p) at sse.ts:135-148           │
│  →  client receives { shotId, sequenceId, fromStatus, toStatus, changedBy,  │
│                       note? }                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | File | Owns | Reads From | Writes To |
|-----------|------|------|------------|-----------|
| `App.tsx` (modify) | `packages/dashboard/src/App.tsx` | View routing; SSE subscriptions | `activeView` signal | `activeView`; SSE handlers attached |
| `ShotGridView` (NEW) | `packages/dashboard/src/views/ShotGridView.tsx` | Top-level page; mount-time fetch; URL hydration | `selectedSequenceForGrid`, `shotGrid`, `statusFilter`, `showOmitted` | `shotGrid`, `gridIsFetching`, URL via replaceState |
| `SequenceHeader` (NEW) | `packages/dashboard/src/components/SequenceHeader.tsx` | Sequence name + collapsible chevron + mini-pill counts row | `shotGrid.value.sequence`, `aggregateCounts` (computed) | local `expanded` state |
| `ShotGridFilterBar` (NEW) | `packages/dashboard/src/components/ShotGridFilterBar.tsx` | Sticky bar; 5+1 status pills + Show omitted toggle | `statusFilter`, `showOmitted` | `statusFilter`, `showOmitted`, URL replaceState |
| `ShotGridCard` (NEW) | `packages/dashboard/src/components/ShotGridCard.tsx` | One shot tile; click → opens VersionDrawer | `shot.{id, name, status, version_count, latest_completed_version}` | `selectedVersionId` on click |
| `ShotStatusPill` (NEW) | `packages/dashboard/src/components/ShotStatusPill.tsx` | 5-status pill (NEW — distinct from `StatusPill.tsx`) | `status` prop (`ShotStatus`) | — (pure) |
| `TreeSidebar` (modify) | `packages/dashboard/src/components/TreeSidebar.tsx` | Add `LayoutGrid` icon on every sequence row | `onOpenGrid?`, `currentGridSequenceId?` props | `onOpenGrid(seqId)` callback |
| `state/shot-grid.ts` (NEW) | `packages/dashboard/src/state/shot-grid.ts` | All Phase 21 signals + SSE handler + URL hydration helper | URL, localStorage (none — D-09 chose URL-only) | All Phase 21 signals |
| `lib/api.ts` (modify) | `packages/dashboard/src/lib/api.ts` | New `fetchShotGrid(seqId, opts)` consumer | — | — (pure fetch wrapper) |
| `lib/copy.ts` (modify) | `packages/dashboard/src/lib/copy.ts` | 27 new copy constants (UI-SPEC §"Copywriting Contract") | — | — |
| `lib/time.ts` (NEW) | `packages/dashboard/src/lib/time.ts` | `formatRelativeTime(epochMs): string` | — | — (pure) |
| `types/events.ts` (**MUST modify**) | `packages/dashboard/src/types/events.ts` | Dashboard-local SSE payload mirror | — | — (types only) |
| `types/shot-grid.ts` (NEW) | `packages/dashboard/src/types/shot-grid.ts` | `ShotGridResponse`, `ShotGridRow`, `ShotGridSequenceMeta` | — | — |
| `styles/theme.css` (modify) | `packages/dashboard/src/styles/theme.css` | Add 5 `--color-shot-status-*` tokens | — | — |
| `src/store/shot-status-repo.ts` (extend) | `src/store/shot-status-repo.ts` | New `listShotsForGrid` + cursor encode/decode | — | — (pure read) |
| `src/engine/pipeline.ts` (modify) | `src/engine/pipeline.ts` | New `Engine.listShotGrid` facade | — | — |
| `src/http/dashboard-routes.ts` (modify) | `src/http/dashboard-routes.ts` | New `GET /api/sequences/:id/shot-grid` route handler | — | — |

### Recommended Project Structure
Files Phase 21 adds (5 new components + 1 new view + 1 new state file + 1 new type file + 1 new time helper = **9 new files in the dashboard**, **0 new server files** — `shot-status-repo.ts` is extended, not replaced).

```
packages/dashboard/src/
├── App.tsx                              # MODIFY: new header home button + activeView + SSE
├── components/
│   ├── ShotGridCard.tsx                 # NEW
│   ├── ShotGridFilterBar.tsx            # NEW
│   ├── ShotStatusPill.tsx               # NEW
│   ├── SequenceHeader.tsx               # NEW
│   ├── TreeSidebar.tsx                  # MODIFY: grid-icon prop
│   └── (existing reused: Thumbnail, SkeletonThumbnail, LoadMoreButton, EmptyState)
├── views/
│   └── ShotGridView.tsx                 # NEW
├── state/
│   └── shot-grid.ts                     # NEW (all Phase 21 signals + onShotStatusChanged)
├── lib/
│   ├── api.ts                           # MODIFY: + fetchShotGrid
│   ├── copy.ts                          # MODIFY: + Phase 21 copy block
│   └── time.ts                          # NEW (formatRelativeTime)
├── types/
│   ├── events.ts                        # MODIFY: + ShotStatusChangedPayload (CRITICAL GAP)
│   └── shot-grid.ts                     # NEW
└── styles/
    └── theme.css                        # MODIFY: + 5 --color-shot-status-* tokens

src/
├── store/
│   └── shot-status-repo.ts              # EXTEND: + listShotsForGrid + cursor helpers
├── engine/
│   └── pipeline.ts                      # MODIFY: + Engine.listShotGrid facade
└── http/
    └── dashboard-routes.ts              # MODIFY: + GET /api/sequences/:id/shot-grid
```

### Pattern 1: Single-Query Latest-Completed-Version-Per-Shot Join (Window Function CTE) [VERIFIED]

**What:** Join `shots` with the latest-completed `versions` row per shot AND the version count, in one query, with cursor pagination on `(shots.name, shots.id)`.

**When to use:** Always — this is the GRID-04 lock. Verified no N+1 by `EXPLAIN QUERY PLAN` in the test (see §"Validation Architecture").

**Why window function CTE over correlated subquery:**
- **Correlated subquery** (the seductive shorter version):
  ```sql
  SELECT s.*,
    (SELECT id FROM versions v WHERE v.shot_id = s.id
       AND v.status = 'completed' AND v.completed_at IS NOT NULL
       ORDER BY v.completed_at DESC, v.id ASC LIMIT 1) AS lcv_id
  FROM shots s
  WHERE s.sequence_id = ?
  ```
  SQLite executes the subquery **once per outer row** (visible in `EXPLAIN QUERY PLAN` as `CORRELATED SCALAR SUBQUERY`). For a sequence with 50 shots × N versions, this is 50 dependent lookups. The `EXPLAIN QUERY PLAN` test (REQ-04 lock) WOULD FAIL.
- **Window function CTE** (recommended):
  ```sql
  WITH ranked AS (
    SELECT v.id, v.shot_id, v.completed_at,
      ROW_NUMBER() OVER (
        PARTITION BY v.shot_id
        ORDER BY v.completed_at DESC, v.id ASC
      ) AS rn
    FROM versions v
    WHERE v.status = 'completed' AND v.completed_at IS NOT NULL
  )
  SELECT
    s.id,
    s.name,
    s.status,
    (SELECT COUNT(*) FROM versions vc WHERE vc.shot_id = s.id) AS version_count,
    r.id           AS lcv_id,
    r.completed_at AS lcv_completed_at
  FROM shots s
  LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1
  WHERE s.sequence_id = ?
    AND (
      ?1 IS NULL  -- cursor: NULL → first page
      OR (s.name > ?2 OR (s.name = ?2 AND s.id > ?3))  -- after-cursor lex compare
    )
  ORDER BY s.name ASC, s.id ASC
  LIMIT ? + 1;
  ```
  EXPLAIN QUERY PLAN structure shows:
  - `CO-ROUTINE 1 (ranked)` — single full scan of `versions` filtered to completed; SQLite's window-function planner emits one logical pass.
  - `SCAN shots s USING INDEX sqlite_autoindex_shots_1` (the UNIQUE(sequence_id, name) autoindex — leading edge `sequence_id` filter + natural `name` ASC order means SQLite walks the index without a separate SORT step).
  - `SEARCH r USING AUTOMATIC COVERING INDEX (shot_id=? AND rn=?)` — SQLite materialises the CTE once.
  - **No `CORRELATED SCALAR SUBQUERY`** in the plan rows.

**The `version_count` scalar subquery is benign** — it's an uncorrelated aggregate against the UNIQUE(shot_id, version_number) autoindex (a COUNT walk over the shot_id leading edge, single index range scan per row). The Phase 21 EXPLAIN QUERY PLAN test asserts the absence of `CORRELATED SCALAR SUBQUERY` specifically (the latest-version join is what GRID-04 fences against), not all subqueries. **If the planner wants to fold it into the CTE**, an alternative is a second CTE:
```sql
WITH counts AS (SELECT shot_id, COUNT(*) AS n FROM versions GROUP BY shot_id),
     ranked AS (... as above ...)
SELECT s.*, c.n AS version_count, r.id AS lcv_id, ...
FROM shots s
LEFT JOIN counts c ON c.shot_id = s.id
LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1
WHERE ...
```
Both shapes pass the no-N+1 test. Recommend the scalar-subquery version for legibility; planner picks.

**Drizzle wiring:** Use the `sql\`...\`` template directly — the query is too complex for the Drizzle query builder to compose cleanly. Look at `src/store/version-repo.ts:230-269` (`listByShot`) for the existing precedent of mixing drizzle-builder + raw `sql\`\`` fragments. The repo file is already MCP-pure (`architecture-purity.test.ts:38-40` covers all of `src/store/`).

**Example (drop-in for `src/store/shot-status-repo.ts`):**
```typescript
// Source: in-tree precedent — src/store/sort.ts:135-145 (sql.join composition)
//                            src/store/version-repo.ts:230-269 (limit+1 has_more pattern)
export interface ShotGridRow {
  id: string;
  name: string;
  status: ShotStatus;
  version_count: number;
  latest_completed_version: {
    id: string;
    thumbnail_url: string;  // built at engine/HTTP layer — repo returns lcv_id only
    completed_at: number;
  } | null;
}

export interface ShotGridCursor {
  /** Last shot name on the current page (UTF-8 string). */
  n: string;
  /** Last shot id (tiebreaker). */
  sid: string;
}

export function encodeShotGridCursor(c: ShotGridCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeShotGridCursor(s: string): ShotGridCursor | null {
  try {
    if (typeof s !== 'string' || s.length === 0) return null;
    const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof obj !== 'object' || obj === null) return null;
    if (typeof obj.n !== 'string') return null;
    if (typeof obj.sid !== 'string' || obj.sid.length === 0) return null;
    return { n: obj.n, sid: obj.sid };
  } catch {
    return null;
  }
}

export function listShotsForGrid(
  db: Db,
  sequenceId: string,
  opts: { cursor: ShotGridCursor | null; limit: number },
): {
  items: Array<{ id: string; name: string; status: ShotStatus; version_count: number; lcv_id: string | null; lcv_completed_at: number | null }>;
  next_cursor: string | null;
  total_count: number;
} {
  const { cursor, limit } = opts;

  // total_count — single COUNT(*) over the sequence's shots. Cursor-independent.
  const totalRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(shots)
    .where(eq(shots.sequence_id, sequenceId))
    .get();

  // Cursor predicate as a raw sql.Param tuple. NULL when no cursor.
  const cursorName = cursor?.n ?? null;
  const cursorSid = cursor?.sid ?? null;

  // limit+1 fetch for has_more (mirrors src/store/version-repo.ts:251)
  const rows = db.all(sql`
    WITH ranked AS (
      SELECT v.id, v.shot_id, v.completed_at,
        ROW_NUMBER() OVER (
          PARTITION BY v.shot_id
          ORDER BY v.completed_at DESC, v.id ASC
        ) AS rn
      FROM versions v
      WHERE v.status = 'completed' AND v.completed_at IS NOT NULL
    )
    SELECT
      s.id        AS id,
      s.name      AS name,
      s.status    AS status,
      (SELECT COUNT(*) FROM versions vc WHERE vc.shot_id = s.id) AS version_count,
      r.id           AS lcv_id,
      r.completed_at AS lcv_completed_at
    FROM shots s
    LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1
    WHERE s.sequence_id = ${sequenceId}
      AND (
        ${cursorName} IS NULL
        OR s.name > ${cursorName}
        OR (s.name = ${cursorName} AND s.id > ${cursorSid})
      )
    ORDER BY s.name ASC, s.id ASC
    LIMIT ${limit + 1}
  `) as Array<{ id: string; name: string; status: ShotStatus; version_count: number; lcv_id: string | null; lcv_completed_at: number | null }>;

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let next_cursor: string | null = null;
  if (hasMore && items.length > 0) {
    const lastRow = items[items.length - 1];
    next_cursor = encodeShotGridCursor({ n: lastRow.name, sid: lastRow.id });
  }

  return { items, next_cursor, total_count: Number(totalRow?.c ?? 0) };
}
```

**Where to draw the `thumbnail_url`:** Engine.listShotGrid wraps each row, mapping `lcv_id` → `getThumbnailUrl(versionId)` (the existing `/api/versions/:id/thumbnail` route). The repo stays URL-blind. The dashboard's existing `getThumbnailUrl` helper (`packages/dashboard/src/lib/api.ts:293-296`) is identical shape — server-side equivalent is a one-liner. **Alternative:** return only `lcv_id` and `lcv_completed_at` from the repo, let the dashboard build the thumbnail URL via `getThumbnailUrl(lcv_id)` (Phase 17 precedent). **Recommend** the dashboard-builds-url shape (matches Phase 17's `getThumbnailUrl` is dashboard-side; keeps server route schema minimal). Plan writes `latest_completed_version: { id, completed_at }` and dashboard constructs `thumbnail_url` at render time. Update D-13 payload shape accordingly (or honor it verbatim and have the server inject `thumbnail_url` — both work; plan picks).

### Pattern 2: Composite Opaque-Base64 Cursor (Phase 18 precedent, verbatim adapted)

**What:** URL-safe base64-encoded JSON `{ n: <sort_key>, sid: <shot_id> }` for stable pagination over `(name ASC, id ASC)`.

**When to use:** REQ-04 cursor pagination for > 50 shots. Default limit 20 (CLAUDE.md). Default sort is `shots.name ASC` (Phase 21 ships ONE sort — see §"Out of scope: shot grid sort dropdown" in CONTEXT.md deferred).

**Phase 18 analog ([VERIFIED: src/store/sort.ts:60-68, 169-196]):**
```typescript
// from src/store/sort.ts:60-68
export interface VersionCursor {
  cna: boolean;  // NULL-bit pin (D-01)
  sv: number | string | null;  // sort value
  vid: string;  // version_id tiebreaker (SORT-05)
}

// from src/store/sort.ts:169-196
export function encodeVersionCursor(c: VersionCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}
export function decodeVersionCursor(s: string): VersionCursor | null {
  try {
    if (typeof s !== 'string' || s.length === 0) return null;
    const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    // ... structural validation ...
    return { cna: obj.cna, sv: obj.sv, vid: obj.vid };
  } catch {
    return null;
  }
}
```

**Phase 21 cursor shape:**
```typescript
interface ShotGridCursor {
  /** Last shot name on the current page (the sort key). */
  n: string;
  /** Last shot id (stable tiebreaker). */
  sid: string;
}
```
Simpler than `VersionCursor` because:
- No NULL-bit (shots.name is NOT NULL — column constraint).
- Single sort field (no whitelist enum needed — D-09 fixed sort `name ASC`).
- Tiebreaker is `shots.id` (UNIQUE PRIMARY KEY — already deterministic).

**HTTP route surface (mirrors `dashboard-routes.ts:216-228`):**
```typescript
// in src/http/dashboard-routes.ts, adjacent to parseCursorParam
function parseShotGridCursorParam(raw: string | undefined): ShotGridCursor | null {
  if (raw === undefined || raw === '') return null;
  const decoded = decodeShotGridCursor(raw);
  if (decoded === null) {
    throw new TypedError(
      'INVALID_INPUT',
      `Malformed cursor — drop the ?cursor= param to start from page 1`,
      `Cursors are opaque base64url strings issued in the response's next_cursor field`,
    );
  }
  return decoded;
}

app.get('/api/sequences/:id/shot-grid', (c) => {
  const sequenceId = c.req.param('id');
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const cursor = parseShotGridCursorParam(c.req.query('cursor'));
  return c.json(engine.listShotGrid(sequenceId, { cursor, limit }));
});
```

**Dashboard fetch helper (mirrors `lib/api.ts:230-245` `fetchVersions`):**
```typescript
// Source: in-tree precedent — packages/dashboard/src/lib/api.ts:230-245
export interface ShotGridResponse {
  sequence: { id: string; name: string };
  shots: ShotGridRow[];
  next_cursor: string | null;
  total_count: number;
}

export interface FetchShotGridParams {
  cursor?: string | null;
  limit?: number;
}

export function fetchShotGrid(
  sequenceId: string,
  params?: FetchShotGridParams,
): Promise<ShotGridResponse> {
  const queryParams: Record<string, unknown> = {
    cursor: params?.cursor ?? undefined,  // null → undefined → qs omits
    limit: params?.limit,
  };
  return fetchJson<ShotGridResponse>(
    `/api/sequences/${encodeURIComponent(sequenceId)}/shot-grid${qs(queryParams)}`,
  );
}
```

**LoadMoreButton wiring (verbatim — no changes to the component):** The component takes `remaining`, `pageSize`, `onClick`, `isFetching`, `errorMessage`. Phase 21 computes `remaining = Math.max(0, total_count - shots.length)` and renders the button when `next_cursor !== null AND remaining > 0`. The click handler appends the next page's items to `shotGrid.value.shots`. **HomeView.tsx:530-537 is the literal template** — copy it.

### Pattern 3: Signal-Driven View Routing (no router)

**What:** Conditional render of two top-level views based on a signal value. No `react-router-dom`. No `<Route>`. Just `signal.value === 'home' ? <HomeView/> : <ShotGridView/>`.

**Phase 19 VersionDrawer precedent — overlay form (existing):**
- `selectedVersionId` signal flips → `<VersionDrawer/>` mounts on top of `<HomeView/>`.
- Closing the drawer (`selectedVersionId.value = null`) unmounts the overlay.

**Phase 21 extension — full-page form (new):**
- `activeView: signal<'home' | 'shot-grid'>('home')` in `state/shot-grid.ts`.
- `App.tsx` body renders `activeView.value === 'home' ? <HomeView/> : <ShotGridView/>` instead of `<HomeView/>` directly.
- Home icon button in header sets `activeView.value = 'home'`.
- TreeSidebar grid icon click sets `activeView.value = 'shot-grid'` + `selectedSequenceForGrid.value = seqId`.

**App.tsx code shape (modify, lines 39-58):**
```tsx
// Source: in-tree precedent — packages/dashboard/src/App.tsx:39-58 (current shape)
import { activeView, selectedSequenceForGrid, onShotStatusChanged } from './state/shot-grid.js';
import { ShotGridView } from './views/ShotGridView.js';
import { Home } from 'lucide-preact';
import { HEADER_HOME_ARIA_LABEL } from './lib/copy.js';

export function App() {
  useEffect(() => {
    onSseEvent('version.created', onVersionCreated);
    onSseEvent('version.status_changed', onVersionStatusChanged);
    onSseEvent('shot.status_changed', onShotStatusChanged);  // NEW
    startSse();
    return () => {
      offSseEvent('version.created', onVersionCreated);
      offSseEvent('version.status_changed', onVersionStatusChanged);
      offSseEvent('shot.status_changed', onShotStatusChanged);  // NEW
      stopSse();
    };
  }, []);

  return (
    <div class="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class={`flex items-center justify-center w-7 h-7 rounded focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              activeView.value === 'home'
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
            }`}
            aria-label={HEADER_HOME_ARIA_LABEL}
            onClick={() => { activeView.value = 'home'; }}
          >
            <Home size={16} />
          </button>
          <span class="text-sm font-semibold text-[var(--color-accent)]" style={{ fontFamily: 'var(--font-display)' }}>
            VFX Familiar
          </span>
        </div>
        <ThemeToggle />
      </header>
      <div class="flex flex-1 overflow-hidden">
        <div class="flex-1 overflow-hidden">
          {activeView.value === 'home' ? <HomeView /> : <ShotGridView />}
        </div>
        <ActiveGenerationsPanel />
      </div>
    </div>
  );
}
```

### Pattern 4: SSE Handler Registration + Lifecycle

**What:** Subscribe in `useEffect` on mount, unsubscribe in cleanup. Handler is a pure function in `state/shot-grid.ts` that mutates the `shotGrid` signal.

**Existing wiring (`packages/dashboard/src/App.tsx:27-37`):**
```tsx
useEffect(() => {
  onSseEvent('version.created', onVersionCreated);
  onSseEvent('version.status_changed', onVersionStatusChanged);
  startSse();
  return () => {
    offSseEvent('version.created', onVersionCreated);
    offSseEvent('version.status_changed', onVersionStatusChanged);
    stopSse();
  };
}, []);
```

The `onSseEvent`/`offSseEvent` API in `lib/events.ts:97-117` accepts the event type and a typed handler. **Reference equality is required for unsubscribe** (`listeners.get(type)?.delete(fn)` at line 116) — the same function reference must be passed. Phase 21 follows this verbatim.

**Phase 21 handler (`packages/dashboard/src/state/shot-grid.ts`):**
```typescript
// Source: in-tree precedent — packages/dashboard/src/state/active-generations.ts:68-74
// (onVersionStatusChanged pattern — locate matching row, immutable update)
import { signal, computed } from '@preact/signals';
import type { ShotStatusChangedPayload } from '../types/events.js';
import type { ShotGridResponse, ShotStatus } from '../types/shot-grid.js';

export const activeView = signal<'home' | 'shot-grid'>('home');
export const selectedSequenceForGrid = signal<string | null>(null);
export const shotGrid = signal<ShotGridResponse | null>(null);
export const statusFilter = signal<'all' | ShotStatus>('all');
export const showOmitted = signal<boolean>(false);
export const gridIsFetching = signal<boolean>(false);
export const gridCursor = signal<string | null>(null);
export const gridLoadMoreError = signal<string | null>(null);

/** Aggregate status counts derived from shotGrid.value.shots (D-14). */
export const aggregateCounts = computed<Record<ShotStatus, number>>(() => {
  const init: Record<ShotStatus, number> = {
    'wip': 0,
    'pending-review': 0,
    'approved': 0,
    'on-hold': 0,
    'omit': 0,
  };
  const shots = shotGrid.value?.shots ?? [];
  return shots.reduce((acc, s) => { acc[s.status]++; return acc; }, init);
});

/**
 * SSE handler — locates the matching shot by shotId and mutates its status.
 * Unknown shotId is a no-op (matches onVersionStatusChanged precedent at
 * packages/dashboard/src/state/active-generations.ts:68-74).
 *
 * Filters by `sequenceId`: an event for a sequence that's not currently
 * displayed is ignored. (The payload carries `sequenceId` per the Phase 20
 * SSE wire shape — see src/http/sse.ts:135-148 toDashboardPayload case.)
 */
export function onShotStatusChanged(payload: ShotStatusChangedPayload): void {
  const current = shotGrid.value;
  if (!current) return;
  if (current.sequence.id !== payload.sequenceId) return;  // wrong sequence
  shotGrid.value = {
    ...current,
    shots: current.shots.map((s) =>
      s.id === payload.shotId ? { ...s, status: payload.toStatus } : s,
    ),
  };
}
```

**CRITICAL GAP:** `packages/dashboard/src/types/events.ts:61-67` does NOT include `'shot.status_changed': ShotStatusChangedPayload` in `EngineEventMap`. The plan MUST add this in an early task — without it, `onSseEvent('shot.status_changed', ...)` will not type-check. [VERIFIED: read of types/events.ts line 61-67 confirms missing entry]

**Required addition to `types/events.ts`:**
```typescript
/**
 * shot.status_changed — a shot's production status transitioned (Phase 20 STAT-04).
 * Wire shape is camelCase per src/http/sse.ts:135-148 toDashboardPayload case.
 */
export interface ShotStatusChangedPayload {
  shotId: string;
  sequenceId: string;
  fromStatus: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit' | null;
  toStatus: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit';
  changedBy: string;
  note?: string;
}

export type EngineEventMap = {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
  'shot.status_changed': ShotStatusChangedPayload;  // NEW
};
```

### Pattern 5: URL State via `history.replaceState` + Zod whitelist + graceful fallback

**What:** On mount, read URL → validate against Zod whitelist → signal value (URL > signal precedence). On every signal change after mount, `history.replaceState` updates URL. Malformed URL values → fall back to default + `console.warn` (NEVER throw).

**Phase 18 analog (`packages/dashboard/src/lib/sortHelpers.ts:209-296`):**

```typescript
// from packages/dashboard/src/lib/sortHelpers.ts:212-296
export function hydrateSortState(): { gridSort: VersionSort; treeSort: HierarchySort } {
  let urlGrid: VersionSort | null = null;
  let urlTree: HierarchySort | null = null;
  let urlObj: URL | null = null;
  try {
    if (typeof window !== 'undefined' && window.location) {
      urlObj = new URL(window.location.href);
      urlGrid = parseSortValue(urlObj.searchParams.get('gridSort'), VERSION_FIELDS) as VersionSort | null;
      urlTree = parseSortValue(urlObj.searchParams.get('treeSort'), HIERARCHY_FIELDS) as HierarchySort | null;
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('vfx-familiar: hydrateSortState URL parse failed; falling back to localStorage.', err);
    }
  }
  // ... URL > localStorage > defaults ...
  // history.replaceState for the URL write side
  if (urlChanged) {
    try { history.replaceState(null, '', urlObj.toString()); } catch { /* silent */ }
  }
}
```

**Phase 21 adaptation (`packages/dashboard/src/state/shot-grid.ts`):**

```typescript
// Source: adapted from packages/dashboard/src/lib/sortHelpers.ts:209-296
import { z } from 'zod';
const ShotGridUrlSchema = z.object({
  seq: z.string().min(1).optional(),
  view: z.enum(['home', 'shot-grid']).optional(),
  statusFilter: z.enum(['all', 'wip', 'pending-review', 'approved', 'on-hold', 'omit']).optional(),
  showOmitted: z.enum(['0', '1']).optional(),
});

export function hydrateShotGridUrlState(): void {
  if (typeof window === 'undefined' || !window.location) return;
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('vfx-familiar: hydrateShotGridUrlState URL parse failed.', err);
    }
    return;
  }
  const raw = Object.fromEntries(url.searchParams);
  const parsed = ShotGridUrlSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('vfx-familiar: shot-grid URL params invalid; using defaults.', parsed.error);
    return;
  }
  const v = parsed.data;
  if (v.view) activeView.value = v.view;
  if (v.seq) selectedSequenceForGrid.value = v.seq;
  if (v.statusFilter) statusFilter.value = v.statusFilter;
  if (v.showOmitted) showOmitted.value = v.showOmitted === '1';
}

export function persistShotGridUrlState(): void {
  if (typeof window === 'undefined' || !window.location || typeof history === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('view', activeView.value);
    if (selectedSequenceForGrid.value) url.searchParams.set('seq', selectedSequenceForGrid.value);
    else url.searchParams.delete('seq');
    url.searchParams.set('statusFilter', statusFilter.value);
    url.searchParams.set('showOmitted', showOmitted.value ? '1' : '0');
    history.replaceState(null, '', url.toString());
  } catch { /* silent */ }
}
```

**Precedence (D-09 LOCKED):** URL > signal on first mount; signal > URL after first mount. The `hydrateShotGridUrlState` runs in a mount-time `useEffect` (single fire); subsequent changes flow through `persistShotGridUrlState` called from the filter/toggle/view-switch handlers.

### Pattern 6: Tailwind v4 CSS-native `@theme` + 5 New Shot-Status Tokens

**What:** Add 5 new `--color-shot-status-*` CSS custom properties to the existing `@theme` block in `packages/dashboard/src/styles/theme.css`. No `tailwind.config.js` (Tailwind v4 is CSS-native).

**Tailwind v4 confirmation [VERIFIED: theme.css:14-29]:**
- `@import "tailwindcss"` (line 15) pulls in preflight + utilities + v4 theme layer.
- `@theme { ... }` block (lines 29-71) is the source of truth.
- No `tailwind.config.js` file exists in the project tree.

**Where to add (UI-SPEC §"Color" §"5 NEW shot-status color tokens"):**

After line 51 (`--color-status-failed: #ff4444;`) and before line 53 (`/* Layout fixed widths */`) in the `@theme` block — insert:
```css
  /* Phase 21 — shot production-state pill colors (5 statuses).
   * Saturated background + var(--color-bg) text = WCAG 2.1 AA contrast
   * for both themes (verified in UI-SPEC §"Color" tables). */
  --color-shot-status-wip:             #94a3b8;  /* slate-400 */
  --color-shot-status-pending-review:  #fbbf24;  /* amber-400 */
  --color-shot-status-approved:        #4ade80;  /* green-400 */
  --color-shot-status-on-hold:         #60a5fa;  /* blue-400 */
  --color-shot-status-omit:            #64748b;  /* slate-500 */
```

After line 96 (`--color-destructive: #d73535;`) and before line 97 (`}`) in the `[data-theme="light"]` block — insert:
```css
  --color-shot-status-wip:             #64748b;
  --color-shot-status-pending-review:  #d97706;
  --color-shot-status-approved:        #16a34a;
  --color-shot-status-on-hold:         #2563eb;
  --color-shot-status-omit:            #94a3b8;
```

**Consumption in `ShotStatusPill.tsx` (mirrors `StatusPill.tsx:27-46`):**
```tsx
const SHOT_STATUS_STYLES: Record<ShotStatus, string> = {
  'wip':            'bg-[var(--color-shot-status-wip)] text-[var(--color-bg)]',
  'pending-review': 'bg-[var(--color-shot-status-pending-review)] text-[var(--color-bg)]',
  'approved':       'bg-[var(--color-shot-status-approved)] text-[var(--color-bg)]',
  'on-hold':        'bg-[var(--color-shot-status-on-hold)] text-[var(--color-bg)]',
  'omit':           'bg-[var(--color-shot-status-omit)] text-[var(--color-bg)]',
};

export function ShotStatusPill({ status }: { status: ShotStatus }) {
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${SHOT_STATUS_STYLES[status]}`}
      data-status={status}
    >
      {status}
    </span>
  );
}
```

**Tailwind v4 utility auto-generation note:** Tailwind v4 does NOT auto-generate `bg-shot-status-wip` utility classes from arbitrary custom properties in the `@theme` block (unlike Tailwind v3 with `theme.extend.backgroundColor`). The dashboard uses the **arbitrary-value** syntax `bg-[var(--color-shot-status-wip)]` throughout (see `StatusPill.tsx:28-36`), which works against any CSS custom property. **Phase 21 follows the same pattern — no util class extraction needed.**

### Anti-Patterns to Avoid

- **Don't add a server-side `?statusFilter=` query param.** REQ-03 explicitly locks client-side filter — adding a server param breaks the "no re-fetch on filter change" contract and forces useless network round-trips.
- **Don't auto-fetch the shot grid on every `activeView` change.** Only fetch on `selectedSequenceForGrid` change. View-switching back to a previously-loaded sequence should NOT re-fetch (D-04: switching `activeView` does NOT clear signals).
- **Don't update `selectedShotId` from a ShotGridCard click.** D-04 LOCKED: cards open VersionDrawer overlay via `selectedVersionId`, they do NOT mutate `selectedShotId` (which is HomeView's state).
- **Don't use `history.pushState`.** D-09 LOCKED `replaceState` only. Sort/filter are view settings, not navigation events.
- **Don't add a sort dropdown to the shot grid.** Phase 24 territory; Phase 21 ships single `name ASC` sort.
- **Don't include `latest_completed_at` or `is_stale` at the shot row level.** D-13 lean payload — `completed_at` is nested in `latest_completed_version` (NULL when no completed version exists). `is_stale` is Phase 23.
- **Don't auto-show `omit` shots in the dataset.** REQ-05 / D-08: `showOmitted=false` means the QUERY itself returns omit shots in the payload, but the dashboard filters them out client-side via the `showOmitted` signal. **Wait — let me clarify:** the simpler implementation per REQ-05 + D-08 is the server returns ALL shots regardless of status (no server filter); the dashboard gates display on the `showOmitted` signal. This matches REQ-03's "client-side filter" lock. **Confirm with the planner**: server returns all shots; dashboard hides omit when `showOmitted === false` by filtering `shotGrid.value.shots`. (D-13 endpoint payload doesn't list a status-filter param, supporting this read.)
- **Don't omit Preact `key={shot.id}` on grid cards.** D-22 LOCKED: SSE-driven status updates rely on Preact reusing DOM nodes by key — losing the key triggers a full unmount/remount and an `<img>` re-decode flash.
- **Don't put SSE handler subscription inside `ShotGridView`.** The handler in `App.tsx` lifecycle is correct: it must stay subscribed even when on `HomeView`, so the next `view=shot-grid` switch finds an already-up-to-date `shotGrid.value`. (If `ShotGridView` subscribed in its own `useEffect`, status changes that happened during a HomeView visit would be missed.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest-per-group SQL | A correlated subquery | `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)` CTE | SQLite ≥ 3.25 supports it; single index walk vs N+1 per-row lookup. |
| Cursor encode/decode | New base64 + JSON wrapper | Mirror `src/store/sort.ts:169-196` (`encodeVersionCursor`/`decodeVersionCursor`) shape with simpler `{ n, sid }` payload | Same defensive parsing (try/catch → null) already validated; same `base64url` encoding for URL safety. |
| URL state machine | New mount-effect + push/replace logic | Mirror `lib/sortHelpers.ts:209-296` (`hydrateSortState`) shape with Zod schema | Pattern is battle-tested in Phase 18; graceful fallback + console.warn already proven. |
| SSE subscription | Manual EventSource wiring | `onSseEvent`/`offSseEvent` from `lib/events.ts:97-117` | The dispatcher already handles multi-listener, reference equality, idempotent attach. |
| Pagination button | New "Load more" component | `<LoadMoreButton/>` from `packages/dashboard/src/components/LoadMoreButton.tsx` | Verbatim reusable — same `remaining`/`onClick`/`isFetching`/`errorMessage` API works. |
| Empty state UI | New empty-state primitive | `<EmptyState/>` at `packages/dashboard/src/components/EmptyState.tsx` | Already supports the message-only contract from D-18. |
| Thumbnail with lazy load | New `<img loading="lazy"/>` | `<Thumbnail/>` at `packages/dashboard/src/components/Thumbnail.tsx` | Phase 17 ships explicit width/height for CLS=0 + skeleton fallback. |
| 5-status pill | A unified pill component | NEW `<ShotStatusPill/>` (5 statuses) alongside existing `<StatusPill/>` (4 version statuses) | UI-SPEC §"Component Inventory" notes: distinct components, NOT unified. The status enums DO NOT overlap. |
| Hierarchy tree | New tree component | `<TreeSidebar/>` with two new props (`onOpenGrid?`, `currentGridSequenceId?`) | Existing pure component; add grid-icon button at sequence depth (depth=2 in the existing nesting). |
| Status filter logic | A server query param | Client-side `.filter()` over `shotGrid.value.shots` | REQ-03 LOCKED client-side. No server param. |
| Aggregate counts | A server aggregate query | Preact `computed()` over `shotGrid.value.shots` | D-14 LOCKED client-derived for Phase 21 (Phase 23 will introduce the server widget). |
| Relative timestamp | Importing `date-fns` or `dayjs` | NEW `lib/time.ts` `formatRelativeTime(epochMs): string` | UI-SPEC lists 6 verbatim constants (`TIME_JUST_NOW`, etc.); custom helper is ~20 LOC and avoids a new dependency. Phase 24 may reconsider if needs grow. |

**Key insight:** Phase 21 is **all assembly, no invention**. Every primitive exists. The risk is in the wiring — getting the cursor shape exactly right, getting the SSE handler subscribed at `App.tsx` (not at `ShotGridView`), and ensuring `ShotStatusChangedPayload` is added to `types/events.ts` before any consumer references it.

## Runtime State Inventory

**N/A — Phase 21 is a greenfield additive feature (no rename, no refactor, no migration).**

- Stored data: None — query is read-only over existing tables.
- Live service config: None — no external services touched.
- OS-registered state: None.
- Secrets/env vars: None — endpoint requires no new env vars.
- Build artifacts: None — no compiled binaries / no new pip eggs / no new npm install.

## Common Pitfalls

### Pitfall 1: Missing `ShotStatusChangedPayload` in dashboard types ([VERIFIED])
**What goes wrong:** `onSseEvent('shot.status_changed', onShotStatusChanged)` won't compile; OR a sloppy `as any` cast lets it compile but the handler receives `unknown` and crashes at runtime when it tries to read `payload.shotId`.
**Why it happens:** The server-side `src/engine/events.ts:106` adds `'shot.status_changed': ShotStatusChangedPayload` to `EngineEventMap`, but the dashboard-local mirror at `packages/dashboard/src/types/events.ts:61-67` (per D-WEBUI-31 architecture-purity rule — dashboard has its own copy) was never updated. Phase 20's wire surface ends at `src/http/sse.ts:135-148` (`toDashboardPayload` case); the dashboard type was missed.
**How to avoid:** Make adding `ShotStatusChangedPayload` interface + `'shot.status_changed': ShotStatusChangedPayload` to `EngineEventMap` Task 1 of the plan. Block all downstream tasks on it.
**Warning signs:** TypeScript error on `App.tsx` line that references `onSseEvent('shot.status_changed', ...)`; runtime `undefined.shotId` in the status handler.

### Pitfall 2: Cursor lex compare on column with NULLs
**What goes wrong:** SQLite three-valued logic — `s.name > NULL` returns `unknown` (not `true` or `false`), silently dropping rows.
**Why it happens:** The `shots.name` column is NOT NULL by schema (`schema.ts:60` `text('name').notNull()`), so this won't bite Phase 21 — but if a future migration relaxes this, the cursor predicate will skip rows.
**How to avoid:** Defence-in-depth: include an explicit `s.name IS NOT NULL` filter in the WHERE clause, or document the schema dependency in the cursor helper's docstring. Phase 21 schema is locked-NOT-NULL, so a single-line docstring suffices.
**Warning signs:** Pagination loop skips shots; total_count exceeds the sum of items across all pages.

### Pitfall 3: `latest_completed_version === null` AND card click handler [VERIFIED — D-19 LOCKED]
**What goes wrong:** A shot with zero completed versions has `latest_completed_version === null`. If `<ShotGridCard/>` blindly does `onClick={() => { selectedVersionId.value = shot.latest_completed_version.id }}`, it throws `Cannot read property 'id' of null`.
**Why it happens:** Optimistic destructuring.
**How to avoid:** D-19 LOCKED: when `latest_completed_version === null`, render `<SkeletonThumbnail/>` AND set `aria-disabled="true"` AND skip the `onClick` wiring entirely (no pointer cursor). Mirror `Thumbnail.tsx:137-152` skeleton branch. Component-test should assert this.
**Warning signs:** Browser console error on first interaction with a versionless shot.

### Pitfall 4: SSE handler stale closure
**What goes wrong:** Handler captures `shotGrid.value` at the time of subscription, not at the time of dispatch — updates never see the latest array.
**Why it happens:** Misusing `useEffect` dependencies or capturing the signal value outside the handler body.
**How to avoid:** The handler is module-level (not inside a hook). It reads `shotGrid.value` inside the body, not closes over it. The Phase 18 `onVersionStatusChanged` pattern at `active-generations.ts:68-74` is the template — it reads `activeGenerations.value` inline.
**Warning signs:** Status pill in the grid doesn't update; manual reload fixes it.

### Pitfall 5: Forgetting `key={shot.id}` on grid cards
**What goes wrong:** SSE status update triggers Preact reconciliation; without keys, Preact may unmount/remount cards in different positions, causing thumbnail `<img>` re-decode flashes and lost focus.
**Why it happens:** Default `.map()` without keys.
**How to avoid:** D-22 LOCKED. Always render `<ShotGridCard key={shot.id} shot={shot} />`. Component test should assert the rendered DOM nodes are stable across a status mutation (compare `getByText('SH_010').closest('button')` references before/after a simulated SSE event).
**Warning signs:** Card thumbnails briefly blank out on every status change.

### Pitfall 6: CSS Grid `minmax(220px, 1fr)` overflow
**What goes wrong:** When the viewport is narrower than 220px (mobile), `minmax(220px, 1fr)` causes horizontal scroll instead of stacking.
**Why it happens:** `minmax`'s first arg is a hard minimum.
**How to avoid:** UI-SPEC §"Responsive Behavior" notes mobile (< 768px) is OUT OF SCOPE for Phase 21. Acceptable to break gracefully. **Document this in the plan's verification checklist** so the human reviewer doesn't flag it.
**Warning signs:** Horizontal scroll on phone-width browser test (which Phase 21 explicitly does not target).

### Pitfall 7: SQLite WAL + write-during-read concerns
**What goes wrong:** A long-running grid query holds a read snapshot while a parallel `shot.set_status` write commits — under SQLite without WAL, the read would block until the write released. With WAL, the read sees its snapshot consistently.
**Why it happens:** Default journal mode is rollback (blocks). WAL allows readers + 1 writer concurrently.
**How to avoid:** WAL is already enabled at `src/store/db.ts` (the test fixture `makeInMemoryDb` at `src/test-utils/fixtures.ts:36` also enables WAL: `sqlite.pragma('journal_mode = WAL')`). The grid query is read-only and Phase 21 is read-only — no new writes. **Confirmed safe.**
**Warning signs:** Random `SQLITE_BUSY` errors under load.

### Pitfall 8: Counter mini-pills derived from a stale `shotGrid` after Load more
**What goes wrong:** `aggregateCounts` computed signal reads `shotGrid.value.shots`. After Load more appends a page, the counts reflect only the LOADED shots, not the total dataset.
**Why it happens:** Aggregate counts derived from paginated buffer.
**How to avoid:** **Decision needed** — either (a) accept that aggregate counts are "loaded so far" counts (with a hint in UI like "47 loaded / 89 total"), or (b) ship a separate `aggregateCountsTotal` from the server in the response payload. D-14 LOCKED says client-derived from `shots.value.reduce(...)`, which suggests (a). **Recommend (a)**: in the typical < 50 shots/sequence case, page 1 IS the full dataset; for the > 50 case, Phase 23 ships server-computed stats. Document in the plan.
**Warning signs:** Counts disagree with the visible card count after Load more.

### Pitfall 9: Component test setup for `@testing-library/preact` with signals
**What goes wrong:** Signal updates don't trigger re-render in the test environment.
**Why it happens:** `@preact/signals` requires the preact integration plugin to be active. The dashboard already has `@preact/preset-vite` (package.json line 22), which wires this up.
**How to avoid:** Verify by reading any existing component test in `packages/dashboard/src/components/__tests__/` — they should use `render` from `@testing-library/preact` and signal mutations should reflect on rerender. (Existing tests under `__tests__/` confirm this works.)
**Warning signs:** Test passes the initial render but fails the post-update assertion.

## Code Examples

### Example 1: Engine.listShotGrid facade method (add to `src/engine/pipeline.ts`)

```typescript
// Source: in-tree precedent — src/engine/pipeline.ts:696-741 (setShotStatus shape)
//                            src/engine/pipeline.ts (existing listVersionsForShot wraps repo)
import { listShotsForGrid } from '../store/shot-status-repo.js';
import { getThumbnailUrl } from '../...'; // build helper OR construct inline

/**
 * GRID-04 — denormalized shot grid for a sequence. Returns each shot with its
 * status + version count + latest-completed-version metadata. Single SQL query
 * via window-function CTE (no N+1). Cursor pagination via opaque base64.
 *
 * Throws SEQUENCE_NOT_FOUND when the sequence does not exist.
 */
listShotGrid(
  sequenceId: string,
  opts: { cursor: ShotGridCursor | null; limit: number },
): {
  sequence: { id: string; name: string };
  shots: ShotGridRow[];
  next_cursor: string | null;
  total_count: number;
} {
  const sequence = this.repo.getSequence(sequenceId);
  if (!sequence) {
    throw new TypedError(
      'SEQUENCE_NOT_FOUND',
      `Sequence '${sequenceId}' not found`,
      `List sequences with { tool: 'sequence', action: 'list' }`,
    );
  }
  const { items, next_cursor, total_count } = listShotsForGrid(this.db, sequenceId, opts);
  return {
    sequence: { id: sequence.id, name: sequence.name },
    shots: items.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      version_count: r.version_count,
      latest_completed_version: r.lcv_id !== null && r.lcv_completed_at !== null
        ? {
            id: r.lcv_id,
            // Build the thumbnail URL at this layer; the repo stays URL-blind.
            // Mirrors getThumbnailUrl from packages/dashboard/src/lib/api.ts:293-296
            // shape but server-side. Alternatively, leave it null and let the
            // dashboard build it at render time (Phase 17 precedent — recommended).
            thumbnail_url: `/api/versions/${encodeURIComponent(r.lcv_id)}/thumbnail`,
            completed_at: r.lcv_completed_at,
          }
        : null,
    })),
    next_cursor,
    total_count,
  };
}
```

### Example 2: Hono route handler

```typescript
// Source: in-tree precedent — src/http/dashboard-routes.ts:280-301 (versions cursor route)
//                            src/http/dashboard-routes.ts:267-273 (sequences/:id/shots — same prefix)
app.get('/api/sequences/:id/shot-grid', (c) => {
  const sequenceId = c.req.param('id');
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const cursor = parseShotGridCursorParam(c.req.query('cursor'));
  return c.json(engine.listShotGrid(sequenceId, { cursor, limit }));
});
```

### Example 3: ShotGridView mount-time fetch + SSE-driven update wiring

```tsx
// Source: in-tree precedent — packages/dashboard/src/views/HomeView.tsx:165-285
//                            packages/dashboard/src/state/active-generations.ts:68-74
import { useEffect } from 'preact/hooks';
import { fetchShotGrid } from '../lib/api.js';
import {
  activeView, selectedSequenceForGrid, shotGrid, statusFilter, showOmitted,
  gridIsFetching, gridCursor, gridLoadMoreError,
  hydrateShotGridUrlState, persistShotGridUrlState,
} from '../state/shot-grid.js';
import { SequenceHeader } from '../components/SequenceHeader.js';
import { ShotGridFilterBar } from '../components/ShotGridFilterBar.js';
import { ShotGridCard } from '../components/ShotGridCard.js';
import { LoadMoreButton } from '../components/LoadMoreButton.js';
import { EmptyState } from '../components/EmptyState.js';

export function ShotGridView() {
  // Mount-time URL hydration (runs once)
  useEffect(() => {
    hydrateShotGridUrlState();
  }, []);

  // Fetch on selectedSequenceForGrid change
  useEffect(() => {
    const seqId = selectedSequenceForGrid.value;
    if (!seqId) return;
    let alive = true;
    gridIsFetching.value = true;
    gridLoadMoreError.value = null;
    fetchShotGrid(seqId, { cursor: null, limit: 20 })
      .then((res) => {
        if (!alive) return;
        shotGrid.value = res;
        gridCursor.value = res.next_cursor;
        gridIsFetching.value = false;
      })
      .catch((err) => {
        if (!alive) return;
        gridLoadMoreError.value = err instanceof TypeError
          ? 'Network unavailable' : 'Failed to load shots';
        gridIsFetching.value = false;
      });
    return () => { alive = false; };
  }, [selectedSequenceForGrid.value]);

  // Compute filtered view
  const filtered = (() => {
    const grid = shotGrid.value;
    if (!grid) return null;
    let shots = grid.shots;
    if (!showOmitted.value) {
      shots = shots.filter((s) => s.status !== 'omit');
    }
    if (statusFilter.value !== 'all') {
      shots = shots.filter((s) => s.status === statusFilter.value);
    }
    return shots;
  })();

  if (!shotGrid.value || gridIsFetching.value) {
    return <EmptyState message="Loading shots…" />;
  }
  if (!filtered) return null;

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <SequenceHeader sequence={shotGrid.value.sequence} />
      <ShotGridFilterBar />
      <div class="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <EmptyState message={/* status-aware copy from copy.ts */} />
        ) : (
          <div
            class="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
          >
            {filtered.map((shot) => (
              <ShotGridCard key={shot.id} shot={shot} />
            ))}
          </div>
        )}
        {gridCursor.value !== null && (
          <div class="mt-4 flex justify-center">
            <LoadMoreButton
              remaining={Math.max(0, shotGrid.value.total_count - shotGrid.value.shots.length)}
              onClick={handleLoadMore}
              isFetching={gridIsFetching.value}
              errorMessage={gridLoadMoreError.value}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

### Example 4: TreeSidebar grid-icon affordance (modify `SequenceNode`)

```tsx
// Source: in-tree precedent — packages/dashboard/src/components/TreeSidebar.tsx:212-259
// Add to SequenceNodeProps:
//   onOpenGrid?: (sequenceId: string) => void;
//   currentGridSequenceId?: string;
import { LayoutGrid } from 'lucide-preact';
import { TREE_GRID_ICON_ARIA_PREFIX } from '../lib/copy.js';

// Inside SequenceNode, after the existing TreeRow:
const isCurrentGrid = currentGridSequenceId === sequence.id;
return (
  <>
    <div class="flex items-center">
      <TreeRow {...existingProps} />
      <button
        type="button"
        class={`flex items-center justify-center w-6 h-6 rounded ml-auto focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
          isCurrentGrid
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
        }`}
        aria-label={`${TREE_GRID_ICON_ARIA_PREFIX}${sequence.name}`}
        aria-current={isCurrentGrid ? 'page' : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onOpenGrid?.(sequence.id);
        }}
      >
        <LayoutGrid size={16} />
      </button>
    </div>
    {/* existing expanded children render */}
  </>
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tailwind.config.js` + `theme.extend.colors` | Tailwind v4 `@theme { --color-... }` CSS-native | Tailwind v4.0 (late 2024) | Phase 21 inherits the v4 model already in use; arbitrary-value classes (`bg-[var(--color-shot-status-wip)]`) replace utility-class generation. |
| `LIMIT N OFFSET M` pagination | Composite cursor `(sort_key, id)` | Phase 18 (this codebase) | Phase 21 adopts the same. Avoids skip-bugs under concurrent inserts/deletes. |
| Correlated subquery for latest-per-group | Window function `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)` | SQLite 3.25.0 (2018) | Single index walk vs N+1 dependent lookups. |
| `react-router-dom` SPA routing | Signal-driven view switch (no router) | Phase 19 VersionDrawer overlay precedent | Zero new dependencies; trivial mental model. |
| `pushState` for view settings | `replaceState` | Industry convention (Linear/Figma/GitHub PRs) + Phase 18 D-14 | Doesn't pollute back-stack with reversible UI state. |

**Deprecated/outdated:**
- `tailwind.config.js` (Tailwind v3 era) — not used in this repo; `@theme` block is the SoT.
- `offset` pagination — Phase 18 migrated to cursor; the route handler at `dashboard-routes.ts:287` keeps `offset` as a no-op back-compat parse, but the engine ignores it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The endpoint should return `latest_completed_version.thumbnail_url` as a server-built path string (vs the dashboard building it from `lcv_id` via `getThumbnailUrl`). | Pattern 1, Example 1 | LOW — both shapes are equivalent. D-13 says payload includes `thumbnail_url`; recommendation is server inlines it, but if the planner prefers client-side construction (Phase 17 precedent), the payload's `latest_completed_version` becomes `{ id, completed_at }` only. **Plan should pick.** |
| A2 | The endpoint returns ALL shots in the sequence (including `omit`), and the dashboard filters omit shots client-side based on `showOmitted`. | "Anti-Patterns to Avoid" + Pattern 3 | MEDIUM — REQ-03 locks "client-side filtering" and REQ-05 doesn't say server-side. If the planner wants server-side omit gating (smaller payload), the endpoint gains a `?showOmitted=` param (which contradicts the "no re-fetch" REQ-03 read). Recommend client-side. **User should affirm.** |
| A3 | Aggregate counts (`aggregateCounts` computed signal) reflect "loaded so far" not "total dataset". | Pitfall 8 | LOW — Phase 21's typical sequence size (< 50 shots) means page 1 IS the full dataset. For the > 50 case, Phase 23's server widget supersedes. Plan should document the limitation. |
| A4 | The dashboard tests do not have an existing a11y harness; WCAG verification is manual against UI-SPEC's contrast tables. | "WCAG 2.1 AA badge contract verification" | LOW — UI-SPEC already proves AA/AAA mathematically for both themes. Manual spot-check in dashboard dev server is sufficient. |
| A5 | The `EXPLAIN QUERY PLAN` test asserts the absence of `CORRELATED SCALAR SUBQUERY` in plan rows for the latest-version join — but ALLOWS the `version_count` scalar subquery. | Validation Architecture | LOW — `version_count` is a benign uncorrelated index scan. If a future refactor folds it into a second CTE, the test still passes. |

**Empty? No — 5 assumptions logged.** The planner and discuss-phase should resolve A1 and A2 before locking task contracts.

## Open Questions

1. **Where does `latest_completed_version.thumbnail_url` come from — server-injected or client-built?**
   - What we know: D-13 lists the payload field as `thumbnail_url: string`. The existing Phase 17 dashboard pattern (`packages/dashboard/src/lib/api.ts:293-296` `getThumbnailUrl(versionId)`) builds the URL client-side from `lcv_id`.
   - What's unclear: Whether the server should pre-build the path (slight engine work) or leave `latest_completed_version: { id, completed_at }` and let the dashboard format `/api/versions/{id}/thumbnail`.
   - Recommendation: **Server pre-builds** to honor D-13 verbatim. Engine.listShotGrid concatenates `/api/versions/${id}/thumbnail`; the dashboard reads it as-is. Cheap, type-safe, single point of URL construction. Reverse if the planner wants stricter dashboard-builds-URL parity with Phase 17.

2. **Does Phase 21 need a sequence-level cache on top of the per-sequence fetch?**
   - What we know: The user can switch sequences via TreeSidebar grid icons. Each click triggers `fetchShotGrid(newSeqId)` and replaces `shotGrid.value`.
   - What's unclear: Is rapid back-and-forth between sequences a UX concern? (Mounting cost is O(network round-trip + cursor decode).)
   - Recommendation: **No cache for v1.3.** Browser-native HTTP caching handles short-window repeats. If `Cache-Control` is added to the route handler (currently no cache headers), even better — but stale-while-revalidate against SSE is complex. Defer.

3. **Should `aggregateCounts` cover ALL statuses including `omit`, regardless of `showOmitted`?**
   - What we know: D-14 says counts are client-derived from `shots.value.reduce(...)`. The header shows mini-pills (e.g., `[wip 5] [pending 3] [approved 12] [hold 1] [omit 2]`).
   - What's unclear: When `showOmitted === false`, should the `omit` mini-pill still show in the header (counting hidden shots) or hide entirely?
   - Recommendation: **Show `omit` count even when hidden** — it surfaces the "this sequence has 2 omitted shots; toggle to view" awareness. Mirrors how email clients show archived-count even when filtered out. UI-SPEC §"Aggregate counts" doesn't constrain this; recommend the always-show approach with a muted color when hidden (e.g., `opacity-60`).

4. **What's the SSE handler behavior when a shot's `to_status` would now match the active filter?**
   - Concrete scenario: User has `statusFilter='approved'`; shot SH010 transitions from `pending-review` to `approved`. SSE event arrives. The shot now matches the filter — but was filtered out before. Does it appear?
   - Recommendation: **Yes, automatically.** The handler updates `shotGrid.value.shots[i].status`; the `filtered` derivation re-runs; the now-matching shot enters the visible set. This is the desired "live" behavior — no special-case code needed.

5. **How does the URL state interact with the TreeSidebar's `selectedShotId`?**
   - What we know: D-04 says `selectedShotId` (HomeView state) and `selectedSequenceForGrid` (ShotGridView state) are INDEPENDENT.
   - What's unclear: Does the URL also mirror `selectedShotId`?
   - Recommendation: **No — the URL only mirrors Phase 21 state (`?seq=&view=&statusFilter=&showOmitted=`).** Phase 18 didn't add `selectedShotId` to the URL; Phase 21 preserves that scope. The URL is for sharing shot-grid views, not HomeView state.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (with `process.argv`, `Buffer`) | Engine layer | YES | v25 (per global CLAUDE.md) | — |
| better-sqlite3 native binding | All DB queries | YES | 12.9.0 | — |
| SQLite ≥ 3.25 (window functions) | New CTE query | YES | 3.53 (bundled with better-sqlite3 12.9.0) | — |
| Hono | New HTTP route | YES | 4.12.14 | — |
| Zod | Cursor + URL validation | YES | 4.3.6 | — |
| Preact + signals | Dashboard view | YES | 10.29.1 + 2.9.0 | — |
| lucide-preact (`Home`, `LayoutGrid` icons) | New UI affordances | YES | 1.9.0 | — |
| Tailwind v4 with `@theme` block | New CSS tokens | YES | 4.2.4 | — |
| Vitest | Test runner | YES | 4.1.4 (server) / 4.1.5 (dashboard) | — |
| @testing-library/preact + jsdom | Component tests | YES | 3.2.4 + 29.0.2 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@^4.1.4` (server) / `vitest@^4.1.5` (dashboard) |
| Config file | server: `vitest.config.ts` (project root) / dashboard: `packages/dashboard/vite.config.ts` |
| Quick run command | `npx vitest run <path>` (single file) |
| Full suite command | `npx vitest run` (project root) |
| Server test base | `src/test-utils/fixtures.ts` (`makeInMemoryDb`) provides in-memory SQLite with WAL + Drizzle migrations 0001-0008 applied. Used by `shot-status-repo.test.ts`, `version-repo-cursor.test.ts` precedents. |
| Dashboard test base | `@testing-library/preact` with `jsdom`. Existing tests under `packages/dashboard/src/components/__tests__/` and `packages/dashboard/src/views/__tests__/`. |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRID-01 | TreeSidebar grid-icon click triggers `activeView = 'shot-grid'` + `selectedSequenceForGrid = seqId` | component | `npx vitest run packages/dashboard/src/components/__tests__/TreeSidebar.test.tsx` | ❌ Wave 0 (new test for new prop) |
| GRID-01 | ShotGridView renders CSS Grid with `minmax(220px, 1fr)` template | component | `npx vitest run packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` | ❌ Wave 0 |
| GRID-01 | Signal-driven view switch (home ↔ shot-grid) renders correct view | component | `npx vitest run packages/dashboard/src/__tests__/App.test.tsx` (NEW) | ❌ Wave 0 |
| GRID-02 | ShotGridCard renders Thumbnail (lazy-load) for `latest_completed_version` | component | `npx vitest run packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` | ❌ Wave 0 |
| GRID-02 | ShotGridCard renders SkeletonThumbnail when `latest_completed_version === null` | component | (same file as above) | ❌ Wave 0 |
| GRID-02 | ShotGridCard click sets `selectedVersionId` to `latest_completed_version.id` | component | (same file as above) | ❌ Wave 0 |
| GRID-02 | ShotGridCard click is disabled (no-op) when no completed version | component | (same file as above) | ❌ Wave 0 |
| GRID-02 | ShotStatusPill renders correct color class per status | component | `npx vitest run packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` | ❌ Wave 0 |
| GRID-03 | Filter pill click updates `statusFilter` signal | component | `npx vitest run packages/dashboard/src/components/__tests__/ShotGridFilterBar.test.tsx` | ❌ Wave 0 |
| GRID-03 | Status filter is client-side (no fetch triggered on pill click) | component | (same file; assert `fetch` mock not called after pill click) | ❌ Wave 0 |
| GRID-03 | "All" pill resets `statusFilter = 'all'` | component | (same file) | ❌ Wave 0 |
| GRID-04 | `GET /api/sequences/:id/shot-grid` returns `{ sequence, shots, next_cursor, total_count }` | integration | `npx vitest run src/http/__tests__/dashboard-routes-shot-grid.test.ts` | ❌ Wave 0 (NEW test file) |
| GRID-04 | Endpoint returns 404 SEQUENCE_NOT_FOUND for unknown sequence id | integration | (same file) | ❌ Wave 0 |
| GRID-04 | Endpoint with `?cursor=<base64>&limit=20` returns the next page; cursor walk visits every shot exactly once | integration | (same file — mirrors `version-repo-cursor.test.ts:74-99` walkAllPages helper) | ❌ Wave 0 |
| GRID-04 | Malformed `?cursor=DROP_TABLE` returns 400 INVALID_INPUT (NOT 500) | integration | (same file) | ❌ Wave 0 |
| GRID-04 | `listShotsForGrid` query is single-pass — `EXPLAIN QUERY PLAN` has NO `CORRELATED SCALAR SUBQUERY` row for the latest-version join | unit (SQL) | `npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts` (NEW) | ❌ Wave 0 |
| GRID-04 | `listShotsForGrid` returns each shot with its current `status` from `shots.status` column | unit | (same file) | ❌ Wave 0 |
| GRID-04 | `listShotsForGrid` populates `latest_completed_version` from the latest `status='completed'` version per shot | unit | (same file) | ❌ Wave 0 |
| GRID-04 | `listShotsForGrid` returns `latest_completed_version: null` for shots with zero completed versions | unit | (same file) | ❌ Wave 0 |
| GRID-04 | `listShotsForGrid` uses `COUNT(*)` over `versions WHERE shot_id` for `version_count` (NOT a row count of the join) | unit | (same file — count includes all versions, not just completed) | ❌ Wave 0 |
| GRID-05 | When `showOmitted === false`, dashboard filters out shots with `status === 'omit'` | component | (in `ShotGridView.test.tsx`) | ❌ Wave 0 |
| GRID-05 | When `showOmitted === true`, omit shots render with `opacity-40` wrapper class | component | (in `ShotGridCard.test.tsx`) | ❌ Wave 0 |
| (CROSS) | `App.tsx` registers `onSseEvent('shot.status_changed', ...)` on mount; unregisters on unmount | smoke | `npx vitest run packages/dashboard/src/__tests__/App.test.tsx` | ❌ Wave 0 |
| (CROSS) | `onShotStatusChanged` handler mutates the matching shot in `shotGrid.value.shots` (immutable update); unknown shotId is no-op; cross-sequence event is ignored | unit | `npx vitest run packages/dashboard/src/state/__tests__/shot-grid.test.ts` | ❌ Wave 0 |
| (CROSS) | URL hydration: `?statusFilter=approved&showOmitted=1` on mount sets signals correctly | unit | (same file as above — `hydrateShotGridUrlState` test) | ❌ Wave 0 |
| (CROSS) | URL hydration: malformed `?statusFilter=DROP_TABLE` falls back to default + `console.warn` | unit | (same file) | ❌ Wave 0 |
| (CROSS) | URL persist: signal change calls `history.replaceState` with serialized state | unit | (same file — mock history.replaceState) | ❌ Wave 0 |
| (CROSS) | architecture-purity test PASS unchanged (no new native bindings) | integration | `npx vitest run src/__tests__/architecture-purity.test.ts` | ✅ exists; should be GREEN with zero edits |
| (CROSS) | tool-budget test PASS unchanged at 7 | integration | `npx vitest run src/__tests__/tool-budget.test.ts` | ✅ exists; should be GREEN with zero edits |

### EXPLAIN QUERY PLAN Test Pattern (NEW — no precedent in codebase)

The architecture-purity test grep precedent confirmed no existing `EXPLAIN QUERY PLAN` runtime-assert tests exist in the codebase (only docstring mentions in `src/store/schema.ts:28, 293`). Phase 21 ships the first one.

**Recommended pattern** (uses the `sqlite: Database.Database` exposed by the `makeInMemoryDb` fixture):

```typescript
// File: src/store/__tests__/shot-status-repo-grid.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { makeInMemoryDb, type TestDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import { listShotsForGrid } from '../shot-status-repo.js';

interface PlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

describe('shot-status-repo — listShotsForGrid (GRID-04)', () => {
  let testDb: TestDb;
  let sequenceId: string;

  beforeEach(() => {
    testDb = makeInMemoryDb();
    const hierarchy = new HierarchyRepo(testDb.db);
    const versionRepo = new VersionRepo(testDb.db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    sequenceId = seq.id;
    // Seed 5 shots, each with 2-3 versions (mix of completed + in-progress)
    for (let i = 1; i <= 5; i++) {
      const shot = hierarchy.createShot(seq.id, `sh0${i}0`);
      for (let v = 1; v <= 3; v++) {
        const ver = versionRepo.insertVersion(shot.id);
        if (v <= 2) versionRepo.markCompleted(ver.id, '[]');
      }
    }
  });

  test('EXPLAIN QUERY PLAN: no CORRELATED SCALAR SUBQUERY for the latest-version join (GRID-04 N+1 lock)', () => {
    // The query string MUST match the one in listShotsForGrid verbatim. Plan
    // 21-01 ships a helper that returns the SQL text + bind params so tests
    // can introspect without duplicating SQL text.
    const sql = `
      WITH ranked AS (
        SELECT v.id, v.shot_id, v.completed_at,
          ROW_NUMBER() OVER (
            PARTITION BY v.shot_id
            ORDER BY v.completed_at DESC, v.id ASC
          ) AS rn
        FROM versions v
        WHERE v.status = 'completed' AND v.completed_at IS NOT NULL
      )
      SELECT s.id, s.name, s.status,
        (SELECT COUNT(*) FROM versions vc WHERE vc.shot_id = s.id) AS version_count,
        r.id AS lcv_id, r.completed_at AS lcv_completed_at
      FROM shots s
      LEFT JOIN ranked r ON r.shot_id = s.id AND r.rn = 1
      WHERE s.sequence_id = ?
      ORDER BY s.name ASC, s.id ASC
      LIMIT 21
    `;
    const planRows = testDb.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(sequenceId) as PlanRow[];
    const planText = planRows.map((r) => r.detail).join('\n');

    // The latest-version join (LEFT JOIN ranked) MUST NOT appear as a
    // correlated subquery. If SQLite ever plans it as one, GRID-04 fails.
    // We allow the `version_count` SCALAR SUBQUERY (uncorrelated index scan).
    const correlatedLatestVersion = planRows.filter((r) =>
      r.detail.includes('CORRELATED') && r.detail.includes('ranked'),
    );
    expect(correlatedLatestVersion, `Unexpected correlated subquery in plan:\n${planText}`).toEqual([]);

    // Defence-in-depth: the CTE must materialize (or stream via co-routine),
    // not repeat-scan inside the outer SCAN shots.
    const sawCte = planRows.some((r) =>
      r.detail.includes('CO-ROUTINE') || r.detail.includes('MATERIALIZE') || r.detail.includes('ranked'),
    );
    expect(sawCte, `Expected CTE plan node referencing 'ranked':\n${planText}`).toBe(true);
  });

  test('returns each shot with its current status', () => {
    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(result.items).toHaveLength(5);
    expect(result.items.every((r) => r.status === 'wip')).toBe(true);  // default
  });

  test('populates latest_completed_version from the most recent completed version per shot', () => {
    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    expect(result.items.every((r) => r.lcv_id !== null)).toBe(true);
    expect(result.items.every((r) => r.lcv_completed_at !== null)).toBe(true);
  });

  test('returns null lcv_id for shots with zero completed versions', () => {
    // Add a 6th shot with only in-progress versions
    const hierarchy = new HierarchyRepo(testDb.db);
    const versionRepo = new VersionRepo(testDb.db);
    const shot = hierarchy.createShot(sequenceId, 'sh060');
    versionRepo.insertVersion(shot.id);  // submitted, not completed
    const result = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 20 });
    const sh060 = result.items.find((r) => r.name === 'sh060');
    expect(sh060?.lcv_id).toBeNull();
    expect(sh060?.lcv_completed_at).toBeNull();
  });

  test('cursor walk visits every shot exactly once', () => {
    // Mirrors src/store/__tests__/version-repo-cursor.test.ts:74-99 walkAllPages
    let cursor: ShotGridCursor | null = null;
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {  // safety cap
      const page = listShotsForGrid(testDb.db, sequenceId, { cursor, limit: 2 });
      for (const r of page.items) {
        expect(ids.has(r.id), `duplicate id ${r.id}`).toBe(false);
        ids.add(r.id);
      }
      if (page.next_cursor === null) break;
      cursor = decodeShotGridCursor(page.next_cursor);
    }
    expect(ids.size).toBe(5);  // matches seeded shot count
  });

  test('total_count is cursor-independent', () => {
    const page1 = listShotsForGrid(testDb.db, sequenceId, { cursor: null, limit: 2 });
    const cursor = decodeShotGridCursor(page1.next_cursor!);
    const page2 = listShotsForGrid(testDb.db, sequenceId, { cursor, limit: 2 });
    expect(page1.total_count).toBe(5);
    expect(page2.total_count).toBe(5);
  });
});
```

### Sampling Rate
- **Per task commit:** `npx vitest run <file>` for the file the task creates/edits
- **Per wave merge:** Full Phase 21 scope: `npx vitest run src/store/__tests__/shot-status-repo-grid.test.ts src/http/__tests__/dashboard-routes-shot-grid.test.ts packages/dashboard/src/__tests__ packages/dashboard/src/components/__tests__ packages/dashboard/src/views/__tests__ packages/dashboard/src/state/__tests__`
- **Phase gate:** `npx vitest run` full suite green; tool-budget test asserts === 7 unchanged; architecture-purity test unchanged.

### Wave 0 Gaps
- [ ] `src/store/__tests__/shot-status-repo-grid.test.ts` — covers GRID-04 (SQL + cursor walk + EXPLAIN QUERY PLAN no-N+1 assertion)
- [ ] `src/http/__tests__/dashboard-routes-shot-grid.test.ts` — covers GRID-04 (HTTP route + Zod validation + cursor decode + 404 + payload shape)
- [ ] `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` — covers GRID-02 pill render contract
- [ ] `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` — covers GRID-02 card render + click + disabled-when-no-version
- [ ] `packages/dashboard/src/components/__tests__/ShotGridFilterBar.test.tsx` — covers GRID-03 filter pills + Show omitted toggle
- [ ] `packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` — covers D-14 aggregate counts mini-pills + D-15 collapsible chevron
- [ ] `packages/dashboard/src/components/__tests__/TreeSidebar.test.tsx` — covers D-01/D-02/D-05 grid-icon affordance + active state (or extend existing tree test)
- [ ] `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` — covers GRID-01 view-level integration + SSE wiring smoke + CSS Grid template
- [ ] `packages/dashboard/src/__tests__/App.test.tsx` — covers signal-driven view switch + home button + SSE handler register/unregister
- [ ] `packages/dashboard/src/state/__tests__/shot-grid.test.ts` — covers `onShotStatusChanged` handler + `hydrateShotGridUrlState` + `persistShotGridUrlState` + `aggregateCounts` computed

### Wave Dependency Sketch

| Wave | Task | Depends On |
|------|------|-----------|
| W1 | Add `ShotStatusChangedPayload` + map entry to `packages/dashboard/src/types/events.ts` (Phase 20 wire-shape gap closure) | nothing |
| W1 | Add 5 new `--color-shot-status-*` tokens to `theme.css` (both `@theme` and `[data-theme="light"]` blocks) | nothing |
| W1 | Add `listShotsForGrid` + cursor encode/decode to `src/store/shot-status-repo.ts` + tests (EXPLAIN QUERY PLAN) | nothing (repo file exists) |
| W1 | Append Phase 21 copy block to `packages/dashboard/src/lib/copy.ts` (27 constants from UI-SPEC) | nothing |
| W1 | Create `packages/dashboard/src/lib/time.ts` (formatRelativeTime) + tests | copy.ts (TIME_* constants) |
| W1 | Create `packages/dashboard/src/types/shot-grid.ts` (ShotGridResponse / ShotGridRow / ShotGridSequenceMeta) | types/events.ts |
| W2 | Add `Engine.listShotGrid` facade to `src/engine/pipeline.ts` | W1 repo extension |
| W2 | Add `GET /api/sequences/:id/shot-grid` route to `src/http/dashboard-routes.ts` + integration tests | W2 engine facade |
| W2 | Create `ShotStatusPill` component + tests | W1 theme tokens |
| W2 | Create `state/shot-grid.ts` (signals + onShotStatusChanged + hydrate/persist URL) + tests | W1 types/events.ts |
| W2 | Add `fetchShotGrid` to `lib/api.ts` | W1 types/shot-grid.ts |
| W3 | Create `ShotGridCard` component + tests | W2 ShotStatusPill, W1 time.ts |
| W3 | Create `ShotGridFilterBar` component + tests | W2 state/shot-grid.ts, W1 copy.ts |
| W3 | Create `SequenceHeader` component + tests | W2 state/shot-grid.ts (aggregateCounts) |
| W3 | Modify `TreeSidebar` to add grid-icon affordance + tests | W2 state/shot-grid.ts (selectedSequenceForGrid signal for active state) |
| W4 | Create `ShotGridView` + tests | W3 SequenceHeader, ShotGridFilterBar, ShotGridCard |
| W4 | Modify `App.tsx` (home button + activeView conditional + SSE handler) + tests | W2 state/shot-grid.ts, W4 ShotGridView |
| W5 | Full Phase 21 scope vitest run + architecture-purity + tool-budget regression check | all |

## Security Domain

Phase 21 is read-only over existing data. No new authentication / authorization surface; the new HTTP route inherits the existing `src/http/dashboard-routes.ts` boundary (same-origin SSE, Hono's default CORS handling already configured at server boot).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 21 adds no auth; dashboard is single-user / single-process (PROJECT.md) |
| V3 Session Management | no | Same as V2 |
| V4 Access Control | no | No new authorisation boundaries |
| V5 Input Validation | **yes** | Zod whitelist for `?cursor=` (`parseShotGridCursorParam`) + path param `:id` (no sanitisation needed — Drizzle parameterises). URL query params on the dashboard side validated by `ShotGridUrlSchema`. |
| V6 Cryptography | no | No new crypto |
| V8 Data Protection | yes (low) | Cursor is opaque base64; reveals only the trailing shot name + id of the previous page. Already public via the same /shots route. T-21-01 below. |
| V12 API & Web Service | yes | Standard same-origin GET; inherits the existing `typedErrorHandler` for 4xx envelopes. |

### Known Threat Patterns for the stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| **T-21-01** SQL injection via `:id` path param OR `?cursor=` query | Tampering | Drizzle parameterised values via `sql\`${var}\`` template (Phase 18 precedent). Cursor decoded structurally into a typed object before any SQL touch. ZERO raw string concatenation. |
| **T-21-02** Cursor information disclosure (leaks the last-page shot name) | Information disclosure | Accepted — shot names are already returned in the same response payload. Opaque base64 is encoding hygiene, NOT secrecy. |
| **T-21-03** Malformed cursor crashes the server (UNCAUGHT in JSON.parse) | DoS | `decodeShotGridCursor` wraps in try/catch and returns `null`; HTTP route maps `null` → 400 `INVALID_INPUT` (NEVER 500). Mirrors Phase 18 T-18-04. |
| **T-21-04** XSS via shot name in `aria-label` or empty-state copy | Tampering / Information disclosure | Preact JSX text interpolation auto-escapes. No `dangerouslySetInnerHTML`. All shot names + sequence names flow as text children (see TreeSidebar.tsx T-5-06 precedent at lines 33-36). |
| **T-21-05** `shot.status_changed` SSE handler crash on malformed payload | DoS (client) | Handler reads `payload.shotId / .sequenceId / .toStatus`; on `undefined`, the `.map` callback would fail silently (no shot id match). Defence: TypeScript types enforced by the new `ShotStatusChangedPayload` interface; runtime check is implicit (unknown shotId is no-op). |
| **T-21-06** Filter pill DoS via rapid clicks | DoS (client) | Client-side filter is O(N) over already-loaded shots; for max ~50 shots per page, this is sub-millisecond. No fetch triggered. Accepted. |
| **T-21-07** URL state injection via crafted `?statusFilter=` | Tampering | Zod whitelist `ShotGridUrlSchema` rejects anything outside the closed enum; malformed values → fall back to default + `console.warn`. Mirrors Phase 18 D-16. |
| **T-21-08** Resource exhaustion via large `?limit=` | DoS | Existing `qNum` parser (`dashboard-routes.ts:139-150`) rejects non-integer / negative. Plan should add an upper-bound cap (e.g., 100) to prevent `?limit=999999` — mirrors Phase 18's defense (which lacks an explicit cap; recommend adding one in this phase). **Minor risk:** Phase 18 didn't cap; Phase 21 has the chance to add a sane default cap. |
| **T-21-09** SSE event emitted for a sequence not currently being viewed | Information disclosure (negligible) | Handler filters by `payload.sequenceId === current.sequence.id`; events for other sequences are silently dropped (no logging — they're not errors). Accepted disposition matches Phase 20 T-20-03-01. |

**Recommendation:** Add an upper-bound `?limit=` cap (e.g., 100) in `parseShotGridLimitParam` or as a second arg to `qNum`. This is a no-cost defence and prevents memory exhaustion under a malicious / accidental large-page request.

## Sources

### Primary (HIGH confidence — in-tree code reads + verified versions)
- `src/store/shot-status-repo.ts:1-134` — Phase 20 append-only repo; pattern to extend for Phase 21
- `src/store/version-repo.ts:227-269` — `listByShot` cursor pattern; limit+1 has_more; shape for Phase 21's `listShotsForGrid`
- `src/store/sort.ts:60-196` — Phase 18 `VersionCursor` shape + `encodeVersionCursor` / `decodeVersionCursor` defensive parse; verbatim adapt
- `src/store/hierarchy-repo.ts:297-334` — `listShots` (existing) + back-compat sort param
- `src/store/schema.ts:60-71, 192-221, 245-298` — `shots.status` denorm + `shot_status_events` table + Phase 1 SCHEMA_DDL
- `drizzle/0008_shot_status.sql:1-28` — 4 indexes: `idx_shots_status`, `idx_shots_project_status`, `idx_shot_status_events_shot_time`, `idx_shots_cursor`
- `src/engine/pipeline.ts:680-741` — Phase 20 `setShotStatus` + SSE emit
- `src/engine/events.ts:41-49, 100-107` — Engine-side `ShotStatusChangedPayload` (snake_case) + `EngineEventMap` (server-side has all 6 events)
- `src/http/dashboard-routes.ts:139-150, 159-228, 267-301` — `qNum` helper, Zod whitelist parsers, `parseCursorParam` defence
- `src/http/sse.ts:50-57, 135-156` — `EVENT_TYPES` tuple (includes `shot.status_changed`) + `toDashboardPayload` case
- `src/__tests__/architecture-purity.test.ts:33-760` — file-level + directory-level purity guards; Phase 20 STAT-02 anchor at lines 743-759 (Phase 21 adds nothing)
- `src/test-utils/fixtures.ts:1-50` — `makeInMemoryDb` with WAL + Drizzle migrations; exposes `sqlite: Database.Database` for raw `prepare().all()` (used in EXPLAIN QUERY PLAN test)
- `src/store/__tests__/version-repo-cursor.test.ts:1-99` — walkAllPages helper pattern for cursor traversal
- `src/store/__tests__/shot-status-repo.test.ts:1-90` — in-memory test fixture pattern; HierarchyRepo seeding
- `packages/dashboard/src/App.tsx:17-58` — root component + SSE registration + header layout (modify target)
- `packages/dashboard/src/lib/events.ts:97-117` — `onSseEvent` / `offSseEvent` API + reference-equality contract
- `packages/dashboard/src/types/events.ts:1-67` — dashboard-local event map (**CONFIRMED missing** `shot.status_changed`)
- `packages/dashboard/src/state/active-generations.ts:38-74` — SSE handler shape (immutable array map; unknown id no-op)
- `packages/dashboard/src/lib/api.ts:71-99, 209-245, 293-296` — `fetchJson`, `qs`, `fetchVersions`, `getThumbnailUrl`
- `packages/dashboard/src/lib/sortHelpers.ts:209-360` — Phase 18 URL state precedent (`hydrateSortState`, `persistGridSort`); Phase 21 mirrors shape
- `packages/dashboard/src/components/LoadMoreButton.tsx:1-134` — verbatim reusable
- `packages/dashboard/src/components/StatusPill.tsx:1-47` — design vocabulary template
- `packages/dashboard/src/components/Thumbnail.tsx:60-188` — lazy-load + skeleton + size variants
- `packages/dashboard/src/components/TreeSidebar.tsx:204-330` — `SequenceNode` modification target
- `packages/dashboard/src/components/EmptyState.tsx:1-26` — message-only contract
- `packages/dashboard/src/views/HomeView.tsx:165-553` — paginated buffer + Load more wiring template
- `packages/dashboard/src/styles/theme.css:14-176` — Tailwind v4 `@theme` + `[data-theme="light"]` overrides; insertion targets confirmed at lines 51-52 (dark) + 96-97 (light)
- `packages/dashboard/package.json` — verified versions of preact, signals, lucide-preact, tailwindcss, testing-library, jsdom

### Secondary (MEDIUM confidence — design contracts + adjacent docs)
- `.planning/phases/21-shot-grid-view/21-CONTEXT.md` (D-01..D-22 LOCKED) — phase decisions read in full
- `.planning/phases/21-shot-grid-view/21-UI-SPEC.md` (approved 2026-05-13) — copy + tokens + WCAG proof read in full
- `.planning/phases/18-sortable-folder-dropdown/18-CONTEXT.md` (D-01..D-25) — cursor + URL state precedent
- `.planning/phases/20-shot-status-engine/20-04-SUMMARY.md` — Phase 20 wire surface; STAT-04 + STAT-05 attribution
- `.planning/REQUIREMENTS.md` §"Shot Grid View (GRID)" + §"Cross-Cutting Constraints" — GRID-01..05 + tool cap 7/12 + WAL + WCAG
- `.planning/STATE.md` — current position: Phase 21 UI-SPEC approved 2026-05-13; ready to plan
- `CLAUDE.md` — tool cap 12, paginate default 20, WAL + busy_timeout, tool-engine separation

### Tertiary (LOW confidence — used only for SQLite/Tailwind version claims; cross-verified)
- [SQLite Window Functions reference](https://sqlite.org/windowfunctions.html) — confirms ROW_NUMBER() OVER (PARTITION BY) since 3.25.0
- [better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases) — v12.9.0 bundles SQLite 3.53.0
- [SQLite Release 3.25.0 adds support for window functions | Hacker News](https://news.ycombinator.com/item?id=17764340) — corroborates 2018 cutoff

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified in package.json + reading code
- Architecture: HIGH — every analog (cursor, URL state, SSE, signal routing, Tailwind tokens) is in-tree and has been read line-by-line
- SQL query shape: HIGH — better-sqlite3 12.9.0 bundles SQLite 3.53 (window functions present); plan + EXPLAIN QUERY PLAN test sketched
- Pitfalls: HIGH — the `ShotStatusChangedPayload` gap in `packages/dashboard/src/types/events.ts` is verified by direct file read
- Validation Architecture: HIGH — fixture pattern, test framework, and SQL-introspection technique all match in-tree precedents

**Research date:** 2026-05-13
**Valid until:** 2026-06-12 (30 days) — stable stack; no fast-moving dependencies in Phase 21 scope.

Sources:
- [SQLite Window Functions](https://sqlite.org/windowfunctions.html)
- [better-sqlite3 GitHub Releases](https://github.com/WiseLibs/better-sqlite3/releases)
- [SQLite Release 3.25.0 adds support for window functions | Hacker News](https://news.ycombinator.com/item?id=17764340)
- [Drizzle ORM SQLite docs](https://orm.drizzle.team/docs/get-started-sqlite)
- [Drizzle ORM Magic sql operator](https://orm.drizzle.team/docs/sql)
