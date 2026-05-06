---
phase: 18
slug: sortable-folder-dropdown
created: 2026-05-06
---

# Phase 18: Sortable Folder Dropdown — Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 25 (5 NEW + 9 MODIFIED + 11 NEW Wave-0 test stubs)
**Analogs found:** 24 / 25 (the only file with no clean in-tree analog is `lib/sortTypes.ts` — the dashboard-side type-mirror file; precedent comes from existing inline mirrors in `api.ts` and `shape.ts`)

---

## Overview

Phase 18 is a **coordination phase** across four code surfaces:

1. **Engine layer (pure SQL/TS):** new `src/store/sort.ts` (whitelist enum + Drizzle ORDER BY builder + cursor encode/decode), modified `src/store/version-repo.ts` (composite-cursor pagination), modified `src/store/hierarchy-repo.ts` (optional `sort` opts on three list methods), modified `src/engine/pipeline.ts` (facade signatures pass through new options).

2. **HTTP layer:** modified `src/http/dashboard-routes.ts` — `GET /api/shots/:id/versions` parses `?sort=`/`?cursor=`/`?limit=`; the three hierarchy list routes gain an optional `?sort=` query parameter. Zod whitelist enforcement at the HTTP boundary (defence-in-depth).

3. **Dashboard component layer:** new `<SortDropdown/>` (WAI-ARIA APG combobox), new `<LoadMoreButton/>` (pagination button), modified `views/HomeView.tsx` (orchestrator that composes both new components and threads sort signals down).

4. **Dashboard helper layer:** new `lib/sortTypes.ts` (server enum mirror — D-WEBUI-31 architecture-purity), new `lib/sortHelpers.ts` (URL parser + localStorage read/write + LRU primitive + tree comparator + `hydrateSortState`), modified `lib/api.ts` (`fetchVersions` return type changes), modified `state/versions.ts` + `state/hierarchy.ts` (new sort signals).

**Key precedents:**
- **Drizzle whitelisted ORDER BY** — `version-repo.ts:216` uses `sql\`${versions.version_number} DESC\``; Phase 18 generalizes to a `Record<SortField, SQLiteColumn>` map + `sql.join` composition.
- **Composite tiebreaker for deterministic pagination** — `hierarchy-repo.ts:83` already uses `(asc(workspaces.created_at), asc(workspaces.id))` for RT-03; Phase 18 extends to `(NULL_BIT, sort_field, version_id)` for the version surface.
- **Phase 17 thin-wrapper component shape** — `<Thumbnail/>` (188 lines) and `<C2paShield/>` (~80 lines) are the polish target for `<SortDropdown/>` and `<LoadMoreButton/>`.
- **localStorage with try/catch for privacy-mode safety** — `ThemeToggle.tsx:53-57` (write) + `main.tsx:21-25` (read). Phase 18 mirrors this pattern verbatim, plus an LRU helper that wraps `setItem`.
- **`@preact/signals` shared state** — `state/versions.ts` declares signals via `signal<T>()` from `@preact/signals`. Phase 18 adds sibling signals.
- **Architecture-purity test guards `packages/dashboard/src/**` against server imports** at `architecture-purity.test.ts:732-740`. The dashboard cannot reach into `src/store/sort.ts` — types must be MIRRORED in `lib/sortTypes.ts`.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/store/sort.ts` | utility (pure SQL builders + enum) | transform | `src/store/version-repo.ts:216` (Drizzle `sql\`...\`` pattern) + `src/store/hierarchy-repo.ts:83` (composite ORDER BY) + `src/store/db.ts` (pure-helper file shape) | role-match |
| `src/store/__tests__/sort.test.ts` | test (pure helpers) | unit | `src/store/__tests__/version-repo.test.ts` (vitest + better-sqlite3 setup pattern) | role-match |
| `src/store/__tests__/version-repo-sort.test.ts` | test (engine integration) | unit + DB | `src/store/__tests__/version-repo.test.ts` | exact |
| `src/store/__tests__/version-repo-cursor.test.ts` | test (cursor pagination) | unit + DB | `src/store/__tests__/version-repo.test.ts` | role-match |
| `src/store/__tests__/hierarchy-repo-sort.test.ts` | test (engine integration) | unit + DB | `src/store/__tests__/version-repo.test.ts` | role-match |
| `src/__tests__/dashboard-routes-sort.test.ts` | test (HTTP route) | request-response | `src/__tests__/thumbnail-route.test.ts` (Hono `app.request(...)` testing API) | role-match |
| `src/store/version-repo.ts` (MODIFY) | repository (data access) | CRUD | same file lines 198-221 (`listByShot`) + 232-240 (`listRecentCompleted` reference for `completed_at DESC`) | exact (self-mirror) |
| `src/store/hierarchy-repo.ts` (MODIFY) | repository (data access) | CRUD | same file lines 73-92, 133-165, 205-237, 279-311 (three identical list methods) | exact (self-mirror) |
| `src/engine/pipeline.ts` (MODIFY) | engine facade | request-response | same file lines 540-552, 584-596, 633-645 (existing list facades), 760-786 (`listVersionsForShot`) | exact (self-mirror) |
| `src/http/dashboard-routes.ts` (MODIFY) | controller (route) | request-response | same file lines 104-115 (`qNum` helper), 161-172 (`/api/shots/:id/versions`), 128-153 (hierarchy list routes) | exact (self-mirror) |
| `packages/dashboard/src/components/SortDropdown.tsx` | component (interactive) | event-driven | `packages/dashboard/src/components/Thumbnail.tsx` (thin-wrapper shape), `ThemeToggle.tsx` (interactive button), `TreeSidebar.tsx:280-329` (`<TreeRow/>` ARIA + keyboard handling) | role-match |
| `packages/dashboard/src/components/LoadMoreButton.tsx` | component (interactive) | event-driven | `packages/dashboard/src/components/ThemeToggle.tsx:64-73` (button surface + disabled state) + `packages/dashboard/src/components/WarningPill.tsx` (pure pill structure) | role-match |
| `packages/dashboard/src/lib/sortTypes.ts` | utility (type mirror) | none (pure types) | `packages/dashboard/src/lib/api.ts:35-45` (`DashboardApiError` server-side mirror with comment-pin) + `lib/api.ts:231-234` (`C2paStatus` mirror) | role-match (precedent is inline) |
| `packages/dashboard/src/lib/sortHelpers.ts` | utility (pure functions) | transform + side-effect (DOM/storage) | `packages/dashboard/src/lib/shape.ts` (pure helper file shape) + `lib/api.ts:84-91` (`qs()` helper) + `ThemeToggle.tsx:31-42` (localStorage read with try/catch) + `main.tsx:14-30` (pre-paint pattern, used as inspiration but NOT copied) | role-match |
| `packages/dashboard/src/lib/api.ts` (MODIFY) | utility (URL helpers + fetch wrappers) | request-response | same file lines 148-165 (`fetchVersions` + `FetchVersionsParams`) + 84-91 (`qs()` helper) | exact (self-mirror) |
| `packages/dashboard/src/state/versions.ts` (MODIFY) | state container | none (signals) | same file (existing `versions` + `selectedVersionId` signals) | exact (self-mirror) |
| `packages/dashboard/src/state/hierarchy.ts` (MODIFY) | state container | none (signals) | same file (existing `selectedShotId` etc. signals) | exact (self-mirror) |
| `packages/dashboard/src/views/HomeView.tsx` (MODIFY) | view (orchestrator) | request-response + DOM I/O | same file (existing `useEffect`-on-mount, `useEffect`-on-shot-select, `<TreeSidebar/>` + `<main>` composition) | exact (self-mirror) |
| `packages/dashboard/src/__tests__/SortDropdown.test.tsx` | test (component) | unit | `packages/dashboard/src/__tests__/Thumbnail.test.tsx` (Phase 17 model — vitest + `@testing-library/preact`) | exact |
| `packages/dashboard/src/__tests__/LoadMoreButton.test.tsx` | test (component) | unit | `packages/dashboard/src/__tests__/Thumbnail.test.tsx` | exact |
| `packages/dashboard/src/__tests__/sortHelpers.test.ts` | test (pure helpers + DOM) | unit | `packages/dashboard/src/__tests__/theme-persistence.test.ts` (memory-storage polyfill + `vi.stubGlobal`) | exact |
| `packages/dashboard/src/__tests__/HomeView-sort-defaults.test.tsx` | test (view integration) | DOM | `packages/dashboard/src/__tests__/Thumbnail.test.tsx` + `theme-persistence.test.ts` | role-match |
| `packages/dashboard/src/__tests__/HomeView-sort-toggle.test.tsx` | test (view integration) | DOM | `packages/dashboard/src/__tests__/theme-persistence.test.ts` (state→storage→reload pattern) | role-match |
| `packages/dashboard/src/__tests__/api.test.ts` (MODIFY) | test (helpers) | unit | same file (existing `getThumbnailUrl` tests) | exact (self-mirror — extend with `fetchVersions` shape assertions) |

**Note on the dashboard `__tests__/` location:** Existing dashboard tests live at `packages/dashboard/src/__tests__/*.test.tsx`, NOT at `packages/dashboard/src/components/__tests__/`. Phase 17 corrected this in 17-PATTERNS.md (line 39); Phase 18 must follow the same convention. The 11 Wave-0 test files all land at `packages/dashboard/src/__tests__/<Name>.test.tsx`.

---

## Pattern Assignments

### `src/store/sort.ts` (NEW, pure-helper module)

**Analogs:**
- `src/store/version-repo.ts:216` — Drizzle `sql\`...\`` template precedent (the line `version-repo.ts` uses today: `.orderBy(sql\`${versions.version_number} DESC\`)`).
- `src/store/hierarchy-repo.ts:83` — composite ORDER BY with stable tiebreaker pattern: `.orderBy(asc(workspaces.created_at), asc(workspaces.id))` (RT-03 deterministic pagination).
- `src/store/db.ts` — pure-helper file shape (no class, just exported functions) — used as a structural reference for the file boundary.

**Architecture-purity invariant:** This file imports ONLY from `drizzle-orm` (`sql`) and `drizzle-orm/sqlite-core` (`SQLiteColumn` type), plus the Drizzle table definitions from `./schema.js`. NO database client, NO MCP, NO HTTP, NO state. It is a pure SQL-builder module. The architecture-purity test at `src/__tests__/architecture-purity.test.ts:38-39` (`src/store/ has zero imports from @modelcontextprotocol/sdk`) covers this boundary structurally.

**Drizzle `sql\`\`` template — exact precedent from `version-repo.ts:212-219`:**
```typescript
const items = this.db
  .select()
  .from(versions)
  .where(eq(versions.shot_id, shotId))
  .orderBy(sql`${versions.version_number} DESC`)
  .limit(limit)
  .offset(offset)
  .all() as Version[];
```
**Pattern to mirror:** `${versions.version_number}` interpolates the Drizzle column-reference object (NOT `.name` string) — Drizzle emits the quoted identifier (`"version_number"`) without parameterization. The `DESC` literal is plain SQL; Drizzle does not parameterize it because it's part of the SQL fragment. **Pitfall J in 18-RESEARCH.md** (line 1257) is explicit: never interpolate `.name` strings — always interpolate the column object.

**Composite ORDER BY with stable tiebreaker — exact precedent from `hierarchy-repo.ts:80-86` (the listWorkspaces method, the simplest pattern):**
```typescript
const items = this.db
  .select()
  .from(workspaces)
  .orderBy(asc(workspaces.created_at), asc(workspaces.id))
  .limit(limit)
  .offset(offset)
  .all() as Workspace[];
```
**Pattern to mirror:** Drizzle's `.orderBy(...)` accepts multiple SQL fragments OR helper functions like `asc()`/`desc()`. Phase 18 needs `sql.join()` because the ORDER BY must be assembled DYNAMICALLY based on the user's selected sort field — `asc()`/`desc()` won't work because the column reference itself is variable. Use `sql.join([sql\`...\`, sql\`...\`, sql\`...\`], sql\`, \`)` to compose the three-term ORDER BY.

**RESEARCH.md Pattern 1 — full reference implementation** (already in 18-RESEARCH.md lines 348-447): the `Record<SortField, SQLiteColumn>` map + `dirSql()` helper + `buildVersionOrderBy()` + `buildHierarchyOrderBy()` + `encodeVersionCursor()` + `decodeVersionCursor()` + `buildAfterCursorWhere()`. The plan should reproduce that block verbatim into `src/store/sort.ts`. The file ends up ~150-180 lines.

**Type exports:**
```typescript
export type SortField = 'completed_at' | 'created_at' | 'name' | 'version_number';
export type HierarchySortField = 'name' | 'created_at';
export type SortDirection = 'asc' | 'desc';
export interface VersionSort { field: SortField; dir: SortDirection; }
export interface HierarchySort { field: HierarchySortField; dir: SortDirection; }
export interface VersionCursor { cna: boolean; sv: number | string | null; vid: string; }
export const DEFAULT_VERSION_SORT: VersionSort = { field: 'completed_at', dir: 'desc' };
export const DEFAULT_HIERARCHY_SORT: HierarchySort = { field: 'name', dir: 'asc' };
```

**Open question for planner (raised in 18-RESEARCH.md A1, lines 1474-1486):** The `versions` table has NO `name` column. The schema (verified at `src/store/schema.ts:66-102`) has columns: `id, shot_id, version_number, status, job_id, parent_version_id, notes, created_at, completed_at, error_code, error_message, outputs_json, lineage_type, reproduction_warnings_json`. The `name` enum value in `SortField` must map to SOMETHING. RESEARCH.md recommends dropping "Name A→Z" from the version-grid `GRID_OPTIONS` array (which removes the need for `versions.name` mapping entirely). If kept, the column map fallback to `versions.id` (lexicographic nanoid) gives a deterministic but visually-meaningless order. **Planner picks; pattern mapper does not.**

---

### `src/store/version-repo.ts` (MODIFY — `listByShot` migrates to composite cursor)

**Analog:** Same file. Self-mirror.

**BEFORE shape (lines 198-221, exact verbatim):**
```typescript
/**
 * Phase 3: paginated version list for a shot, ordered version_number DESC
 * (latest first — matches VFX expectation per CONTEXT.md §Specifics).
 */
listByShot(
  shotId: string,
  limit: number,
  offset: number,
): { items: Version[]; total_count: number } {
  const totalRow = this.db
    .select({ c: sql<number>`COUNT(*)` })
    .from(versions)
    .where(eq(versions.shot_id, shotId))
    .get();
  const items = this.db
    .select()
    .from(versions)
    .where(eq(versions.shot_id, shotId))
    .orderBy(sql`${versions.version_number} DESC`)
    .limit(limit)
    .offset(offset)
    .all() as Version[];
  return { items, total_count: Number(totalRow?.c ?? 0) };
}
```

**AFTER shape (target):**
```typescript
listByShot(
  shotId: string,
  opts: { sort: VersionSort; cursor: VersionCursor | null; limit: number },
): { items: Version[]; next_cursor: string | null; total_count: number } {
  // ... see RESEARCH.md "Migrated listByShot" lines 1374-1416 for the full body.
}
```

**Reference for `completed_at DESC` ordering (lines 232-240, the existing `listRecentCompleted`):**
```typescript
listRecentCompleted(limit: number): Version[] {
  return this.db
    .select()
    .from(versions)
    .where(eq(versions.status, 'completed'))
    .orderBy(sql`${versions.completed_at} DESC`)
    .limit(limit)
    .all() as Version[];
}
```
**Pattern to mirror:** This is a CALLSITE precedent for the `sql\`${versions.completed_at} DESC\`` shape. `listRecentCompleted` is NOT a caller of the new sort surface — it's a parallel method that filters `status='completed'` and never sees NULL `completed_at`. The new `listByShot` uses a richer ORDER BY (NULL-bit pin first, then user-selected sort, then `id ASC` tiebreaker) — but the per-term shape (`sql\`${col} DIR\``) is the same.

**Pattern to mirror — the migration:**
- Signature changes from `(shotId, limit, offset)` to `(shotId, { sort, cursor, limit })`. The opts-object form is the v1.2 pattern across the codebase (see `engine.listVersionsForShot(shotId, limit, offset, options)` at `pipeline.ts:760-764` — `options` already exists; opts here just expands the surface).
- Return type changes from `{ items, total_count }` to `{ items, next_cursor, total_count }`.
- ORDER BY built via `buildVersionOrderBy(sort)` from `src/store/sort.ts`.
- WHERE clause assembled from `eq(versions.shot_id, shotId)` AND `buildAfterCursorWhere(sort, cursor)` (only when cursor is non-null).
- Fetch `limit + 1` rows; peek for `has_more`; trim to `limit` if needed; encode `next_cursor` from the last row of the returned page.
- `total_count` query is independent of cursor — remains the existing `COUNT(*)` shape.
- The full migrated function body is in 18-RESEARCH.md "Migrated listByShot" (lines 1374-1416).

**Caller impact:** the engine facade `Engine.listVersionsForShot` (`pipeline.ts:760-786`) is the SOLE caller. See `pipeline.ts` modification entry below.

---

### `src/store/hierarchy-repo.ts` (MODIFY — three list methods gain optional `opts.sort`)

**Analog:** Same file. Self-mirror across three identical list methods.

**Existing pattern — `listProjects` (lines 133-165, the most-extended of the three):**
```typescript
listProjects(
  workspaceId: string | undefined,
  limit: number,
  offset: number,
): { items: Project[]; total_count: number } {
  // RT-03: deterministic pagination ordering (see listWorkspaces).
  const itemsQuery =
    workspaceId !== undefined
      ? this.db
          .select()
          .from(projects)
          .where(eq(projects.workspace_id, workspaceId))
          .orderBy(asc(projects.created_at), asc(projects.id))
          .limit(limit)
          .offset(offset)
      : this.db
          .select()
          .from(projects)
          .orderBy(asc(projects.created_at), asc(projects.id))
          .limit(limit)
          .offset(offset);
  const items = itemsQuery.all() as Project[];

  const totalQuery =
    workspaceId !== undefined
      ? this.db
          .select({ n: sql<number>`count(*)` })
          .from(projects)
          .where(eq(projects.workspace_id, workspaceId))
      : this.db.select({ n: sql<number>`count(*)` }).from(projects);
  const totalRow = totalQuery.get();
  return { items, total_count: Number(totalRow?.n ?? 0) };
}
```

**Pattern to mirror — extension with optional `opts`:**
```typescript
listProjects(
  workspaceId: string | undefined,
  limit: number,
  offset: number,
  opts?: { sort?: HierarchySort },
): { items: Project[]; total_count: number } {
  const orderBy = opts?.sort
    ? buildHierarchyOrderBy(projects, opts.sort)  // imported from ./sort.js
    : sql`${asc(projects.created_at)}, ${asc(projects.id)}`;
  // ... same itemsQuery/totalQuery dual-branch shape, but .orderBy(orderBy) replaces
  //     the inline .orderBy(asc(...), asc(...)) calls.
}
```

**Pattern to mirror:**
- Add a 4th optional parameter `opts?: { sort?: HierarchySort }`. Defaults preserved when caller omits — see "Caller back-compat" below.
- `listSequences` (lines 205-237) and `listShots` (lines 279-311) take the IDENTICAL shape — three near-clones. Update all three.
- The `buildHierarchyOrderBy(table, sort)` helper from `src/store/sort.ts` returns the SQL ORDER BY fragment including the `id ASC` tiebreaker (per RESEARCH.md Pattern 1, line 437-446).
- **DO NOT** touch `listWorkspaces` — the workspace level is not user-facing in the Phase 18 tree dropdown (D-WEBUI-* etc.); workspaces remain `created_at ASC, id ASC`.

**Caller back-compat (D-10):**
- **MCP tool callers DO NOT pass `opts`:** `src/tools/project-tool.ts:88` (`engine.listProjects(input.workspaceId, input.limit, input.offset)`), `src/tools/sequence-tool.ts:88`, `src/tools/shot-tool.ts:94`. All three continue to compile and execute under existing default ORDER BY because `opts` is optional. **No tool-test churn.**
- **Dashboard route callers DO pass `opts`:** the new code paths in `dashboard-routes.ts` parse `?sort=` and forward it as `opts: { sort }`.

---

### `src/engine/pipeline.ts` (MODIFY — facade signatures pass new options through)

**Analog:** Same file. Self-mirror.

**Existing facade pattern — `listProjects` (lines 540-552):**
```typescript
listProjects(
  workspaceId: string | undefined,
  limit: number,
  offset: number,
): ListResult<Project> {
  const { items, total_count } = this.repo.listProjects(workspaceId, limit, offset);
  return {
    items: items.map((p) => ({ ...p, ...this.breadcrumb.resolve('project', p.id) })),
    total_count,
    limit,
    offset,
  };
}
```

**Existing facade pattern — `listVersionsForShot` (lines 760-786):**
```typescript
listVersionsForShot(
  shotId: string,
  limit: number,
  offset: number,
  options: { include_tags?: boolean; include_metadata?: boolean } = {},
): ListResult<VersionWithAssets | Version> {
  const { items, total_count } = this.versionRepo.listByShot(shotId, limit, offset);
  const hydrated = items.map((v) => {
    let withAssets: Version | VersionWithAssets = v;
    if (options.include_tags || options.include_metadata) {
      const full = this.assets.hydrateVersionWithAssets(v);
      // ... tag/metadata hydration ...
    }
    return { ...withAssets, ...this.breadcrumb.resolve('version', v.id) };
  });
  return { items: hydrated, total_count, limit, offset };
}
```

**Pattern to mirror:**
- `listProjects` (line 540), `listSequences` (line 584), `listShots` (line 633) gain an optional 4th parameter `opts?: { sort?: HierarchySort }` and forward it: `this.repo.listProjects(workspaceId, limit, offset, opts)`.
- `listVersionsForShot` (line 760) signature changes more substantially. The CURRENT signature passes `(shotId, limit, offset, options)` to `versionRepo.listByShot(shotId, limit, offset)` (note: existing `options` is for tag/metadata hydration, NOT pagination). The NEW shape: take `{ sort, cursor, limit, include_tags?, include_metadata? }` as a single opts object, delegate `(shotId, { sort, cursor, limit })` to the repo, then hydrate with tags/metadata as before. Return type adds `next_cursor: string | null`.
- The `breadcrumb.resolve(...)` mapping pattern carries over verbatim — every returned item gets the breadcrumb spread.
- The `ListResult<T>` return shape extends with `next_cursor` for the version surface. Hierarchy surfaces don't use cursor (they keep limit/offset).

**`EngineForDashboard` Pick type (`dashboard-routes.ts:54-85`) — no surface change needed:** the existing `'listProjects' | 'listSequences' | 'listShots' | 'listVersionsForShot'` slots already cover Phase 18's modified methods. TypeScript picks up the widened parameter types automatically.

---

### `src/http/dashboard-routes.ts` (MODIFY — query parsing for `?sort=`/`?cursor=`/`?limit=`)

**Analog:** Same file. Self-mirror.

**The `qNum` helper (lines 104-115, exact verbatim) — pattern for new query parsers:**
```typescript
const qNum = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new TypedError(
      'INVALID_INPUT',
      `Query parameter '${name}' must be a non-negative integer (got '${raw}')`,
      'Use a positive integer like ?limit=20',
    );
  }
  return n;
};
```

**Existing route — `/api/shots/:id/versions` (lines 161-172, exact verbatim — the BEFORE state):**
```typescript
app.get('/api/shots/:id/versions', (c) => {
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const offset = qNum(c.req.query('offset'), 0, 'offset');
  const include_tags = c.req.query('include_tags') === 'true';
  const include_metadata = c.req.query('include_metadata') === 'true';
  return c.json(
    engine.listVersionsForShot(c.req.param('id'), limit, offset, {
      include_tags,
      include_metadata,
    }),
  );
});
```

**Existing hierarchy list routes (lines 128-153, exact verbatim — the BEFORE state):**
```typescript
app.get('/api/workspaces/:id/projects', (c) => {
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const offset = qNum(c.req.query('offset'), 0, 'offset');
  return c.json(engine.listProjects(c.req.param('id'), limit, offset));
});

app.get('/api/projects/:id/sequences', (c) => {
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const offset = qNum(c.req.query('offset'), 0, 'offset');
  return c.json(engine.listSequences(c.req.param('id'), limit, offset));
});

app.get('/api/sequences/:id/shots', (c) => {
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const offset = qNum(c.req.query('offset'), 0, 'offset');
  return c.json(engine.listShots(c.req.param('id'), limit, offset));
});
```

**INVALID_INPUT throw pattern (lines 183-196, the existing `/diff` route):**
```typescript
app.get('/api/versions/:id/diff', async (c) => {
  const against = c.req.query('against');
  if (!against) {
    throw new TypedError(
      'INVALID_INPUT',
      "Missing required query parameter 'against'",
      'Call GET /api/versions/:id/diff?against=<other_version_id>',
    );
  }
  return c.json(await engine.diffVersions(c.req.param('id'), against));
});
```
**Pattern to mirror:** `TypedError('INVALID_INPUT', message, recovery)` is the canonical 4xx surface. The `typedErrorHandler` middleware (mounted by `server.ts`) converts to a structured 4xx envelope. Phase 18's malformed-`?sort=` and malformed-`?cursor=` paths use this same throw shape.

**Pattern to mirror — Phase 17 thumbnail route (the closest "new query parameter" precedent, in this file at the `/api/versions/:id/thumbnail` route added by Plan 17-03):**
The thumbnail route is the most recent pattern for query-param parsing in this file (per RESEARCH.md, the thumbnail route precedent shows the GET+HEAD route shape with conditional response headers, ETag handling, and `c.req.query(...)` parsing). Phase 18's `/api/shots/:id/versions` route extension follows the same mental model: parse query → delegate to engine → return JSON.

**Pattern to mirror — Phase 18 changes:**
- Add a Zod-backed sort parser at the top of the file (after `qNum`):
```typescript
const VersionSortFieldEnum = z.enum(['completed_at', 'created_at', 'name', 'version_number']);
const HierarchySortFieldEnum = z.enum(['name', 'created_at']);
const SortDirectionEnum = z.enum(['asc', 'desc']);

function parseVersionSortParam(raw: string | undefined): VersionSort {
  if (!raw) return DEFAULT_VERSION_SORT;
  const colon = raw.indexOf(':');
  if (colon < 0) {
    throw new TypedError('INVALID_INPUT', /* ... */);
  }
  const field = VersionSortFieldEnum.safeParse(raw.slice(0, colon));
  const dir = SortDirectionEnum.safeParse(raw.slice(colon + 1));
  if (!field.success || !dir.success) {
    throw new TypedError('INVALID_INPUT', /* ... */);
  }
  return { field: field.data, dir: dir.data };
}

function parseCursorParam(raw: string | undefined): VersionCursor | null {
  if (!raw) return null;
  const c = decodeVersionCursor(raw);
  if (!c) {
    throw new TypedError('INVALID_INPUT', /* ... */);
  }
  return c;
}
```
- Modify `/api/shots/:id/versions` route to call `parseVersionSortParam(c.req.query('sort'))` and `parseCursorParam(c.req.query('cursor'))`, forward to `engine.listVersionsForShot(...)` with the new opts shape.
- Modify each of the three hierarchy list routes (`/api/workspaces/:id/projects`, `/api/projects/:id/sequences`, `/api/sequences/:id/shots`) to call `parseHierarchySortParam(c.req.query('sort'))` and forward as `{ sort }` opts. Use `HierarchySortFieldEnum`.
- Full reference implementation of these parsers is in 18-RESEARCH.md Pattern 8 (lines 956-998).

**Note on `EngineForDashboard` Pick:** the existing list method slots in lines 56-64 already cover the new signatures (TypeScript picks up the wider parameter types). No surface-list change needed here.

---

### `packages/dashboard/src/components/SortDropdown.tsx` (NEW)

**Analogs:**
- `packages/dashboard/src/components/Thumbnail.tsx` (188 lines) — thin-wrapper component shape (header doc-block, prop typing pattern, pure render path).
- `packages/dashboard/src/components/ThemeToggle.tsx` (74 lines) — interactive control with state management. Uses `useState` + button semantics + `aria-label`.
- `packages/dashboard/src/components/TreeSidebar.tsx:280-329` — `<TreeRow/>` ARIA + keyboard handling precedent (`role="treeitem"`, `aria-expanded`, `aria-selected`, `tabIndex={0}`, `onKeyDown` with `Enter`/`Space`).

**Thin-wrapper component shape — `<Thumbnail/>` header pattern (lines 1-50):**
```typescript
/**
 * Thumbnail — thin presentational wrapper component owning lazy-load
 * <img loading="lazy"> + skeleton fallback + C2PA shield overlay logic.
 *
 * Phase 17 / Plan 17-04 Task 3 primitive. Consumed by VersionCard +
 * TreeSidebar shot rows in Plan 17-05; this file ships the public API
 * contract (UI-SPEC §"<Thumbnail/> API contract" lines 181-237) so Plan 05
 * can plug it into the actual consumers without further coordination.
 *
 * Render contract (verbatim from UI-SPEC):
 *   - version.status !== 'complete' → <SkeletonThumbnail/> at the size
 *     variant's dimensions, aria-busy='true' on the wrapper (D-07 unified
 *     skeleton for in-progress / loading / failed)
 *   ...
 *
 * SECURITY notes (mirrors VersionCard.tsx T-5-06):
 *   - alt={ariaLabel ?? `Output for ${version.label}`} — JSX text interpolation;
 *     Preact escapes the version label as a TEXT_NODE attribute. No
 *     dangerouslySetInnerHTML is used.
 */
```
**Pattern to mirror:** Header doc-block opens with one-line summary, then "Phase X / Plan X-XX" plan anchor, then numbered or bulleted "Render contract" / "Click-target contract" / "Performance contract" / "SECURITY" sections referencing UI-SPEC.md by section header. `<SortDropdown/>` follows this exact shape.

**Typed-props pattern from `<Thumbnail/>` (lines 60-112):**
```typescript
export type ThumbnailSize = 'card' | 'sm';

export interface ThumbnailVersion {
  id: string;
  filename?: string;
  status: Status;
  label: string;
}

export interface ThumbnailProps {
  /** Version metadata required for URL derivation + state-driven render. */
  version: ThumbnailVersion;
  /**
   * 'card' = aspect-video full-width (VersionCard parent);
   * 'sm' = 80×45 fixed (TreeSidebar shot row).
   * Default: 'card'.
   */
  size?: ThumbnailSize;
  // ... other typed props ...
  /** Optional ARIA label override; defaults to `Output for ${version.label}` ... */
  ariaLabel?: string;
}

export function Thumbnail({
  version,
  size = 'card',
  // ...
}: ThumbnailProps) { /* ... */ }
```
**Pattern to mirror:** Each prop has a JSDoc comment explaining purpose AND default. Default values destructured in the function signature. Generic-typed (Phase 18: `<TField extends string>`) for the SortDropdown reuse case (D-08 — same component for grid + tree).

**ARIA + keyboard handling — `<TreeRow/>` precedent (`TreeSidebar.tsx:280-329`):**
```tsx
function TreeRow({
  label, depth, expanded, hasChildren, isSelected, onClick, onToggle, thumbnail,
}: TreeRowProps) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      class={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm transition-colors ${
        isSelected
          ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
          : 'text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={onClick}
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={isSelected ? true : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* ... children ... */}
    </div>
  );
}
```
**Pattern to mirror:**
- `role="…"` ARIA attribute set explicitly per WAI-ARIA spec (Phase 18: `role="combobox"` on trigger button, `role="listbox"` on popup `<ul>`, `role="option"` on each `<li>`).
- `aria-*` boolean attributes use `undefined` (NOT `false`) when not applicable so the attribute is omitted from the DOM (Preact passes attribute pass-through verbatim — verified in 18-RESEARCH.md line 597 "Preact 10 passes ALL standard HTML attributes verbatim to DOM nodes").
- `tabIndex={0}` puts the element in the tab order; `tabIndex={-1}` puts it OUT of the tab order (combobox listbox uses `-1` so Tab moves past it; `aria-activedescendant` simulates focus inside).
- `onKeyDown` handler with explicit `e.key` switch + `e.preventDefault()` on handled keys. Phase 18's listbox handler covers `ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter`, `Space`, `Escape`, `Tab` per WAI-ARIA APG combobox spec.
- CSS variable theming via `bg-[var(--color-accent)]` / `text-[var(--color-fg)]` / `hover:bg-[var(--color-surface)]` — exactly the same token set the dropdown uses.

**Complete reference implementation in 18-RESEARCH.md Pattern 5** (lines 600-754) — full Preact component with `useId`, `useRef`, `useState`, `useEffect` for outside-click. ~140 lines. Reproduce that block verbatim into `packages/dashboard/src/components/SortDropdown.tsx` with the file-header doc-block per Phase 17 thin-wrapper pattern (above).

**File header content for `<SortDropdown/>` (mirroring Phase 17 doc-block style):**
```typescript
/**
 * SortDropdown — thin presentational dropdown component for selecting a
 * sort option from a closed set. Reused for both the version-grid sort
 * (Phase 18 / D-08) and the tree-sidebar sort.
 *
 * Phase 18 / Plan 18-XX Task X primitive. Consumed by HomeView.tsx (composes
 * 2× <SortDropdown/> — one above the version grid, one above the tree).
 *
 * Render contract (verbatim from UI-SPEC §"<SortDropdown/> API contract"):
 *   - role='combobox' trigger button + role='listbox' popup + role='option' items
 *   - WAI-ARIA APG combobox pattern (aria-expanded, aria-haspopup, aria-controls,
 *     aria-activedescendant)
 *   - keyboard: Enter/Space/ArrowDown opens; ArrowUp/ArrowDown navigates;
 *     Home/End jump; Enter/Space selects + closes; Escape closes without
 *     selecting; Tab selects + closes (APG editorial)
 *   - outside-click closes without selecting (useEffect adds document
 *     mousedown listener while open)
 *   - focus management: focus returns to trigger on close
 *
 * Generic typing:
 *   - <TField extends string = string> — same component reused for the
 *     SortField | HierarchySortField enums (D-08 LOCKED)
 *
 * SECURITY notes:
 *   - option labels flow as JSX text children — Preact auto-escapes.
 *   - aria-label flows as attribute — Preact auto-escapes.
 *   - No dangerouslySetInnerHTML.
 */
```

---

### `packages/dashboard/src/components/LoadMoreButton.tsx` (NEW)

**Analogs:**
- `packages/dashboard/src/components/ThemeToggle.tsx:64-73` — button surface + `aria-label` + Tailwind class pattern (closest in-tree button precedent).
- `packages/dashboard/src/components/WarningPill.tsx` — pure presentational pill component (header doc-block + role="status" + data-testid pattern).

**ThemeToggle button surface (lines 64-73, exact verbatim):**
```tsx
return (
  <button
    type="button"
    onClick={toggle}
    aria-label={`Switch to ${nextLabel} theme`}
    class="inline-flex items-center justify-center rounded p-1.5 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
  >
    <Icon size={16} />
  </button>
);
```
**Pattern to mirror:**
- `type="button"` (NOT `type="submit"` — defensive; the dashboard has no `<form>`s but this avoids any future form-nesting submit-on-click bug).
- `aria-label` is descriptive ("Switch to light theme" / "Switch to dark theme" — pattern-mirror: "Load 20 more (32 remaining)").
- Tailwind class composition via `inline-flex items-center justify-center rounded p-1.5 text-[var(--color-fg-muted)] transition-colors hover:...`
- Icon child via `lucide-preact` (the `<Sun/>` / `<Moon/>` precedent — Phase 18 may use no icon, just text, given the button is text-driven; lucide-preact is available if needed).

**Disabled state pattern — UI-SPEC §"Disabled state when isFetching === true":**
```tsx
<button
  type="button"
  disabled={isFetching}
  onClick={onClick}
  aria-label={`Load ${pageSize} more (${remaining} remaining)`}
  class={`inline-flex items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] transition-colors hover:bg-[var(--color-surface-alt)] disabled:opacity-50 disabled:cursor-not-allowed`}
>
  Load {pageSize} more ({remaining} remaining)
</button>
```

**Pattern to mirror:**
- Prop signature: `{ isFetching: boolean; remaining: number; pageSize: number; onClick: () => void; }`. Pure props-in/callbacks-out — no signal reads, no fetches.
- Pure presentational (no `useState` — disabled state is parent-driven via `isFetching` prop, sourced from the new `gridIsFetching` signal).
- `disabled={isFetching}` on the `<button>` element — native HTML attribute. Browser handles tab-order skip + cursor change + click-prevention.
- `disabled:opacity-50 disabled:cursor-not-allowed` Tailwind variants for visual feedback (matches the disabled-button precedent everywhere in the codebase).
- Header doc-block follows Phase 17 thin-wrapper convention: one-line summary + "Phase 18 / Plan 18-XX Task X" anchor + render contract.

---

### `packages/dashboard/src/lib/sortTypes.ts` (NEW — type mirror)

**Analogs:**
- `packages/dashboard/src/lib/api.ts:35-45` (`DashboardApiError`) — mirrors `src/engine/errors.ts:TypedError` with explicit comment-pin: "Analog: src/engine/errors.ts TypedError (server-side typed error). Diverges by ..."
- `packages/dashboard/src/lib/api.ts:231-234` (`C2paStatus`) — mirrors a server-side discriminated union as a dashboard-local copy.
- `packages/dashboard/src/lib/shape.ts:51-72` (`normalizeStatus`) — mirrors the server `versionLabel()` helper inline per D-WEBUI-31. The header doc-block (lines 17-26) explicitly notes the duplication: *"Mirrors the server-side `versionLabel()` helper used by the MCP tool layer — kept here inline per D-WEBUI-31 (no server import)."*

**Architecture-purity context — `architecture-purity.test.ts:732-740` (verbatim):**
```typescript
it('packages/dashboard/src/** has zero imports from server (../../src/)', () => {
  const violations: string[] = [];
  for (const file of dashboardFiles) {
    const content = readFileSync(file, 'utf-8');
    // Any relative path escaping the dashboard package and landing
    // in server source is a boundary violation. Guards against both
    // direct (../../src) and nested (../../../src) traversals.
    if (content.includes('../../src') || content.includes('../../../src')) {
      violations.push(path.relative(dashboardSrcDir, file));
    }
  }
  expect(
    violations,
    `Dashboard imports from server: ${violations.join(', ')}`,
  ).toHaveLength(0);
});
```
**Pattern to enforce:** the dashboard cannot `import { SortField } from '../../../src/store/sort.js'`. The test fails closed on ANY `../../src` or `../../../src` substring in the dashboard tree. Phase 18 must duplicate the types verbatim with a comment-pin pointing at the server source.

**Pattern to mirror — file structure (~30 lines):**
```typescript
// packages/dashboard/src/lib/sortTypes.ts
//
// Phase 18 / Plan 18-XX — dashboard-side mirror of src/store/sort.ts type
// surface. Architecture-purity invariant (D-WEBUI-31 + architecture-purity.test.ts:732):
// the dashboard package has zero imports from server source — types must be
// duplicated, not re-exported.
//
// DUPLICATE OF src/store/sort.ts — keep in lockstep. A test in
// packages/dashboard/src/__tests__/sortHelpers.test.ts asserts the union
// string sets are equal at test time (parses both files via fs.readFileSync).
//
// Analog precedents in this tree:
//   - packages/dashboard/src/lib/api.ts:231-234 (C2paStatus mirror)
//   - packages/dashboard/src/lib/shape.ts:21-26 (versionLabel mirror)
//   - packages/dashboard/src/lib/api.ts:35-45 (DashboardApiError mirror)

export type SortField = 'completed_at' | 'created_at' | 'name' | 'version_number';
export type HierarchySortField = 'name' | 'created_at';
export type SortDirection = 'asc' | 'desc';

export interface VersionSort {
  field: SortField;
  dir: SortDirection;
}

export interface HierarchySort {
  field: HierarchySortField;
  dir: SortDirection;
}

export const DEFAULT_VERSION_SORT: VersionSort = { field: 'completed_at', dir: 'desc' };
export const DEFAULT_HIERARCHY_SORT: HierarchySort = { field: 'name', dir: 'asc' };
```

**Pattern to mirror:**
- Top-of-file comment block declares architecture-purity intent + cites the test line (`architecture-purity.test.ts:732`).
- "DUPLICATE OF src/store/sort.ts — keep in lockstep" comment-pin (mirrors `lib/shape.ts:21` "Mirrors the server-side `versionLabel()` helper").
- A drift-detection test in `sortHelpers.test.ts` (Wave 0) reads both files via `readFileSync` and asserts the union string sets are equal. Researcher recommendation per Pitfall I (line 1252).
- Types only — no runtime values except the two const defaults. Helpers (`parseSortValue`, `serializeSortValue`, `compareTreeNodes`, `setBoundedLocalStorageEntry`, `hydrateSortState`, `persistGridSort`, `persistTreeSort`) all live in `sortHelpers.ts`.

---

### `packages/dashboard/src/lib/sortHelpers.ts` (NEW)

**Analogs:**
- `packages/dashboard/src/lib/shape.ts` (98 lines) — pure helper file shape (no class, just exported functions; D-WEBUI-31 invariant in header).
- `packages/dashboard/src/lib/api.ts:84-91` (`qs()` helper) — pure utility function precedent.
- `packages/dashboard/src/components/ThemeToggle.tsx:31-42` — `readInitialTheme()` localStorage read with try/catch fallback.
- `packages/dashboard/src/components/ThemeToggle.tsx:53-57` — `localStorage.setItem` write with try/catch fallback.
- `packages/dashboard/src/main.tsx:14-30` — pre-paint localStorage read pattern (used as design reference, NOT copied — Phase 18 uses `useEffect` instead, per RESEARCH.md A3 line 1476-1477).

**Pure-helper file header — `lib/shape.ts` lines 1-13 verbatim:**
```typescript
// packages/dashboard/src/lib/shape.ts
//
// Small dashboard-local shape helpers shared across views. Adapts the raw
// server REST shapes (Version with `version_number` + union status) to the
// props shape the Plan 09 primitives expect (VersionCardVersion with `label`
// + StatusPill Status union).
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Only imports from the dashboard-
// local type barrel under types/*.

import type { Version } from '../types/entities.js';
import type { Status } from '../components/StatusPill.js';
```
**Pattern to mirror:**
- File path comment (line 1): `// packages/dashboard/src/lib/sortHelpers.ts`
- Blank-line separator before the body.
- One-paragraph summary of what the helpers do.
- Architecture-purity invariant (D-WEBUI-31) callout — explicit "this file performs zero server-tree relative-import traversals."
- Import block: only `./sortTypes.js` (dashboard-local) + native browser globals (`localStorage`, `URL`, `URLSearchParams`, `history`).

**`qs()` helper precedent (lines 84-91, exact verbatim):**
```typescript
/** Build a query string from a plain object; undefined values are skipped. */
function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}
```
**Pattern to mirror:** Pure function (no I/O), defensive `if (!params) return '';` early return, browser-native `URLSearchParams`. Phase 18 has parallel pure helpers like `parseSortValue(raw, fieldWhitelist)` and `serializeSortValue(s)`.

**localStorage read with try/catch — `ThemeToggle.tsx:31-42` (exact verbatim):**
```typescript
function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return DEFAULT_THEME;
}
```
**Pattern to mirror:**
- `if (typeof localStorage === 'undefined') return DEFAULT;` — defensive against SSR / test-harness environments where the global is not defined.
- Validate the read string against an allowed-set (Phase 18: `parseSortValue(raw, fieldWhitelist)` returns `null` on invalid; caller falls back to default).
- The Phase 18 `readLocalStorageSort()` helper (RESEARCH.md Pattern 6 lines 798-811) wraps the `localStorage.getItem` call AND the `JSON.parse` in try/catch (the value shape is `{ field, dir }` JSON per D-24).

**localStorage write with try/catch — `ThemeToggle.tsx:53-57` (exact verbatim):**
```typescript
try {
  localStorage.setItem(STORAGE_KEY, next);
} catch {
  // localStorage may be blocked in some privacy modes. Non-fatal.
}
```
**Pattern to mirror:** Wrap every `localStorage.setItem` call. Silent fall-through (no console.warn — matches existing precedent; Phase 18 deviates only with `console.warn` for the LRU primitive's malformed-companion-key path because that's a corruption signal, not a privacy-mode signal).

**Pre-paint localStorage read — `main.tsx:14-30` (exact verbatim, used as design reference):**
```typescript
// Ensure data-theme is set before first render so theme.css CSS variables
// resolve to the correct dark/light values.
if (typeof document !== 'undefined') {
  const current = document.documentElement.getAttribute('data-theme');
  if (current !== 'dark' && current !== 'light') {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('vfx-familiar:theme');
    } catch {
      // localStorage may be unavailable in some privacy modes — fall through.
    }
    const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }
}
```
**Pattern note:** Phase 18 DOES NOT add a pre-paint inline script for sort hydration. RESEARCH.md A3 (line 1476-1477) and Claude's-Discretion (line 62) recommend `useEffect`-on-mount instead because (a) sort UI is below-the-fold so FOUC isn't a concern, (b) inline scripts complicate CSP. The `main.tsx` precedent is shown here for understanding the write-target model, NOT for copying.

**Helper exports (full list, with reference impls in 18-RESEARCH.md):**
```typescript
// All exports from lib/sortHelpers.ts — full reference impls in 18-RESEARCH.md
//   Pattern 6 (lines 762-873) and Pattern 7 (lines 884-944) and Pattern 10 (lines 1052-1064).
export function parseSortValue<F extends string>(
  raw: string | null,
  fieldWhitelist: ReadonlySet<F>,
): { field: F; dir: SortDirection } | null { /* ... */ }

export function serializeSortValue(s: { field: string; dir: SortDirection }): string { /* ... */ }

export function hydrateSortState(): { gridSort: VersionSort; treeSort: HierarchySort } { /* ... */ }
export function persistGridSort(next: VersionSort): void { /* ... */ }
export function persistTreeSort(next: HierarchySort): void { /* ... */ }

export function setBoundedLocalStorageEntry(
  prefix: string,
  key: string,
  value: string,
  maxKeys: number,
): void { /* ... */ }

export function compareTreeNodes<T extends { name: string; created_at: number }>(
  a: T, b: T, sort: HierarchySort,
): number { /* ... */ }
```

---

### `packages/dashboard/src/lib/api.ts` (MODIFY — `fetchVersions` signature changes)

**Analog:** Same file. Self-mirror.

**Existing `FetchVersionsParams` + `fetchVersions` (lines 147-165, exact verbatim — the BEFORE state):**
```typescript
/** Parameters for GET /api/shots/:id/versions. */
export interface FetchVersionsParams {
  limit?: number;
  offset?: number;
  include_tags?: boolean;
  include_metadata?: boolean;
}

/** 9. GET /api/shots/:id/versions?limit=&offset=&include_tags=&include_metadata= */
export function fetchVersions(
  shotId: string,
  params?: FetchVersionsParams,
): Promise<Version[]> {
  return fetchJson<Version[]>(
    `/api/shots/${encodeURIComponent(shotId)}/versions${qs(
      params as Record<string, unknown> | undefined,
    )}`,
  );
}
```

**Existing `qs()` helper (lines 84-91, exact verbatim) — handles `undefined` cleanly:**
```typescript
function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}
```
**Pattern note:** No changes needed to `qs()` itself. It already filters undefined values, encodes via `URLSearchParams.set`, and produces the leading `?` correctly.

**Existing hierarchy fetchers (lines 107-141, the simple shapes):**
```typescript
export function fetchProjects(workspaceId: string): Promise<Project[]> {
  return fetchJson<Project[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/projects`,
  );
}

export function fetchSequences(projectId: string): Promise<Sequence[]> {
  return fetchJson<Sequence[]>(
    `/api/projects/${encodeURIComponent(projectId)}/sequences`,
  );
}

export function fetchShots(sequenceId: string): Promise<Shot[]> {
  return fetchJson<Shot[]>(
    `/api/sequences/${encodeURIComponent(sequenceId)}/shots`,
  );
}
```

**Pattern to mirror — Phase 18 changes:**
1. **`FetchVersionsParams` extension** (add `sort` and `cursor`):
```typescript
export interface FetchVersionsParams {
  sort?: VersionSort;        // NEW — Phase 18
  cursor?: string;            // NEW — Phase 18 (base64url, opaque to dashboard)
  limit?: number;
  offset?: number;            // PRESERVED — kept for back-compat with existing callers (deprecated for new sort path)
  include_tags?: boolean;
  include_metadata?: boolean;
}
```
2. **New `PaginatedVersionsResponse` interface:**
```typescript
export interface PaginatedVersionsResponse {
  items: Version[];
  next_cursor: string | null;
  total_count: number;
  has_more: boolean;
}
```
3. **`fetchVersions` return type changes:**
```typescript
export function fetchVersions(
  shotId: string,
  params?: FetchVersionsParams,
): Promise<PaginatedVersionsResponse> {
  const query = qs({
    sort: params?.sort ? `${params.sort.field}:${params.sort.dir}` : undefined,
    cursor: params?.cursor,
    limit: params?.limit,
    offset: params?.offset,
    include_tags: params?.include_tags,
    include_metadata: params?.include_metadata,
  });
  return fetchJson<PaginatedVersionsResponse>(
    `/api/shots/${encodeURIComponent(shotId)}/versions${query}`,
  );
}
```
4. **Hierarchy fetchers gain optional `sort`:**
```typescript
export function fetchProjects(
  workspaceId: string,
  params?: { sort?: HierarchySort },
): Promise<Project[]> {
  const query = qs({
    sort: params?.sort ? `${params.sort.field}:${params.sort.dir}` : undefined,
  });
  return fetchJson<Project[]>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/projects${query}`,
  );
}
// ... fetchSequences, fetchShots take the same shape ...
```

**Caller impact:**
- `HomeView.tsx:106` (`fetchVersions(shotId).then((raw) => { versions.value = unwrapList<Version>(raw); })`) — the `unwrapList<Version>(raw)` call breaks because `raw` is now `{ items, next_cursor, total_count, has_more }`, not `Version[]`. The HomeView modification updates this to `versions.value = response.items` (or appends for "Load more").
- `__tests__/api.test.ts` modification: extend the existing tests with new assertions for `fetchVersions` shape (the test currently only tests `getThumbnailUrl`; Phase 18 adds tests asserting the request URL contains `?sort=…&cursor=…&limit=…` and the response is unwrapped to the new shape).

---

### `packages/dashboard/src/state/versions.ts` (MODIFY — add new signals)

**Analog:** Same file. Self-mirror.

**Existing file (full content, 25 lines, exact verbatim):**
```typescript
// packages/dashboard/src/state/versions.ts
//
// @preact/signals-backed store for the versions list under the selected
// shot, plus the currently-open version-detail drawer target (Plan 05-10).
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Uses dashboard-local entity DTOs
// from ../types/entities.ts.
//
// Plan 05-08 Task 2 — lightweight signal bag consumed by Plan 05-10
// components. The version list is hydrated via fetchVersions(shotId, ...)
// when selectedShotId changes; the drawer target mirrors a row click.

import { signal } from '@preact/signals';
import type { Version } from '../types/entities.js';

/** Versions list for the currently-selected shot. Empty when no shot chosen. */
export const versions = signal<Version[]>([]);

/**
 * The version currently open in the version-detail drawer. null = drawer
 * closed. Drawer component reads this signal to decide whether to render.
 */
export const selectedVersionId = signal<string | null>(null);
```

**Pattern to mirror — additions:**
```typescript
import type { VersionSort } from '../lib/sortTypes.js';

// Phase 18 — sort signals + paginated buffer state.

/**
 * Active version-grid sort. Mirrors localStorage 'vfx-familiar:sort:grid' +
 * URL '?gridSort=…'. Hydrated on mount via hydrateSortState() (lib/sortHelpers).
 * Default 'completed_at:desc' = "Latest" — SORT-01 + D-CTX-* in 18-CONTEXT.md.
 */
export const gridSort = signal<VersionSort>({ field: 'completed_at', dir: 'desc' });

/**
 * Cursor for the next "Load more" fetch. Opaque base64url string from server.
 * null = no more pages OR fresh load (page 1). Reset to null on sort change
 * AND on shot change (D-19 / SORT-05).
 */
export const gridCursor = signal<string | null>(null);

/**
 * Total version count for the current shot — independent of cursor walk.
 * Used to compute "Load N more (M remaining)" copy on <LoadMoreButton/>.
 */
export const gridTotalCount = signal<number>(0);

/**
 * In-flight indicator. true while a fetchVersions promise is pending.
 * <LoadMoreButton/> reads this for disabled state (D-CTX-* + UI-SPEC).
 */
export const gridIsFetching = signal<boolean>(false);
```

**Pattern to mirror:**
- `import { signal } from '@preact/signals';` already present at top of file.
- New imports: `import type { VersionSort } from '../lib/sortTypes.js';`. Type-only; the architecture-purity test allows this because `sortTypes.ts` is dashboard-local.
- Each new signal has a JSDoc comment explaining the source-of-truth, default, and reset triggers.
- No `computed()` needed for v1.2 — all four are plain signals. Future: a `gridHasMore = computed(() => gridCursor.value !== null)` could replace direct `gridCursor.value` reads if the planner sees value, but it's not required.

---

### `packages/dashboard/src/state/hierarchy.ts` (MODIFY — add `treeSort` signal)

**Analog:** Same file. Self-mirror.

**Existing file (full content, 32 lines, exact verbatim):**
```typescript
// packages/dashboard/src/state/hierarchy.ts
//
// @preact/signals-backed store for the TreeSidebar hierarchy (Plan 05-09).
// Tracks the currently-loaded workspaces list plus the "selected path" —
// one ID per hierarchy level so the sidebar can highlight the open chain.
// ...

import { signal } from '@preact/signals';
import type { Workspace } from '../types/entities.js';

export const workspaces = signal<Workspace[]>([]);
export const selectedWorkspaceId = signal<string | null>(null);
export const selectedProjectId = signal<string | null>(null);
export const selectedSequenceId = signal<string | null>(null);
export const selectedShotId = signal<string | null>(null);
```

**Pattern to mirror — additions:**
```typescript
import type { HierarchySort } from '../lib/sortTypes.js';

/**
 * Active tree-sidebar sort. Mirrors localStorage 'vfx-familiar:sort:tree' +
 * URL '?treeSort=…'. Hydrated on mount via hydrateSortState() (lib/sortHelpers).
 * Default 'name:asc' = A→Z — SORT-04 + D-CTX-* in 18-CONTEXT.md.
 *
 * Tree-wide (D-09 LOCKED — per-level sort is OUT OF SCOPE for v1.2). One sort
 * applies recursively to workspaces, projects, sequences, shots. HomeView.tsx
 * uses lib/sortHelpers.ts:compareTreeNodes() to re-sort the cached children
 * arrays when this signal changes (client-side re-sort per CONTEXT.md
 * Claude's-Discretion line 59).
 */
export const treeSort = signal<HierarchySort>({ field: 'name', dir: 'asc' });
```

**Pattern to mirror:** Identical to `versions.ts` — single `signal<HierarchySort>(...)` call with explanatory JSDoc. The signal lives in `hierarchy.ts` rather than a separate `sort.ts` because the TreeSidebar IS the hierarchy view; co-locating with `selectedShotId` etc. matches the existing organization.

---

### `packages/dashboard/src/views/HomeView.tsx` (MODIFY — orchestrator)

**Analog:** Same file (318 lines). Self-mirror.

**Existing tree-pane composition (lines 268-280, exact verbatim — the LEFT pane):**
```tsx
return (
  <div class="flex h-full">
    <TreeSidebar
      workspaces={tree}
      selectedShotId={selectedShotId.value}
      onSelectShot={(id) => {
        selectedShotId.value = id;
        // Clear any open version when moving between shots.
        selectedVersionId.value = null;
      }}
      expandedIds={expandedIds}
      onToggleExpand={toggleExpand}
    />
```

**Existing version-list pane (lines 281-305, exact verbatim — the RIGHT pane):**
```tsx
    <main class="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      {!selectedShotId.value ? (
        <EmptyState message="Select a shot to view versions" />
      ) : versionsList.length === 0 ? (
        <EmptyState message="No versions yet" />
      ) : (
        <ul class="flex flex-col gap-1">
          {versionsList.map((v) => (
            <li key={v.id}>
              <VersionCard
                version={{
                  id: v.id,
                  label: versionLabel(v),
                  status: normalizeStatus(v.status),
                }}
                isSelected={v.id === selectedVersionId.value}
                onSelect={(id) => {
                  selectedVersionId.value = id;
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
```

**Existing `useEffect`-on-mount pattern (lines 83-96, exact verbatim):**
```tsx
useEffect(() => {
  let alive = true;
  fetchWorkspaces()
    .then((raw) => {
      if (!alive) return;
      workspaces.value = unwrapList<Workspace>(raw);
    })
    .catch(() => {
      // no-op — caller sees the empty sidebar state
    });
  return () => {
    alive = false;
  };
}, []);
```

**Existing `useEffect`-on-shot-select pattern (lines 99-117, exact verbatim):**
```tsx
useEffect(() => {
  let alive = true;
  const shotId = selectedShotId.value;
  if (!shotId) {
    versions.value = [];
    return;
  }
  fetchVersions(shotId)
    .then((raw) => {
      if (!alive) return;
      versions.value = unwrapList<Version>(raw);
    })
    .catch(() => {
      if (alive) versions.value = [];
    });
  return () => {
    alive = false;
  };
}, [selectedShotId.value]);
```

**Existing `latestCompletedForSelectedShot` derivation (lines 207-218, the predicate Phase 18 must preserve):**
```tsx
const selectedShotVersions = versions.value;
const latestCompletedForSelectedShot = (() => {
  if (!selectedShotId.value) return undefined;
  const completed = selectedShotVersions.find(
    (v) => normalizeStatus(v.status) === 'complete',
  );
  if (!completed) return undefined;
  return {
    id: completed.id,
    label: versionLabel(completed),
    status: 'complete' as const,
  };
})();
```
**Pattern note (D-21):** This derivation must continue to work after Phase 18's pagination migration. RESEARCH.md Pattern 9 (line 1003-1007) confirms: page 1 with the new ORDER BY (NULL band first, then `completed_at DESC`) puts the latest completed row at the FIRST non-NULL position — `versions.value.find(v => normalizeStatus(v.status) === 'complete')` continues to find it. **No code change at this derivation site.** (Edge case for >20 in-progress + 0 completed in page 1 documented in RESEARCH.md line 1007 — out of scope mitigation.)

**Pattern to mirror — Phase 18 changes (the orchestrator additions):**

1. **Import additions (top of file):**
```tsx
import { SortDropdown, type SortOption } from '../components/SortDropdown.js';
import { LoadMoreButton } from '../components/LoadMoreButton.js';
import {
  gridSort, gridCursor, gridTotalCount, gridIsFetching,
} from '../state/versions.js';
import { treeSort } from '../state/hierarchy.js';
import {
  hydrateSortState, persistGridSort, persistTreeSort, compareTreeNodes,
} from '../lib/sortHelpers.js';
import type { SortField, HierarchySortField } from '../lib/sortTypes.js';
```

2. **Hydrate sort state on mount (NEW useEffect — runs once):**
```tsx
useEffect(() => {
  // SORT-03: URL → localStorage → defaults priority order. Side-effects
  // (URL replaceState + localStorage write) handled inside hydrateSortState.
  const { gridSort: g, treeSort: t } = hydrateSortState();
  gridSort.value = g;
  treeSort.value = t;
}, []);
```

3. **Replace `fetchVersions(shotId)` consumer (lines 99-117) with paginated buffer logic:**
```tsx
useEffect(() => {
  let alive = true;
  const shotId = selectedShotId.value;
  if (!shotId) {
    versions.value = [];
    gridCursor.value = null;
    gridTotalCount.value = 0;
    return;
  }
  // Reset pagination on shot change (D-19 conceptual mirror — fresh shot, fresh view).
  gridCursor.value = null;
  gridIsFetching.value = true;
  fetchVersions(shotId, { sort: gridSort.value, limit: 20 })
    .then((res) => {
      if (!alive) return;
      versions.value = res.items;
      gridCursor.value = res.next_cursor;
      gridTotalCount.value = res.total_count;
    })
    .catch(() => {
      if (alive) {
        versions.value = [];
        gridCursor.value = null;
        gridTotalCount.value = 0;
      }
    })
    .finally(() => {
      if (alive) gridIsFetching.value = false;
    });
  return () => {
    alive = false;
  };
}, [selectedShotId.value, gridSort.value]); // NOTE: gridSort.value added — sort change triggers re-fetch.
```

4. **Add "Load more" handler:**
```tsx
async function loadMore() {
  const shotId = selectedShotId.value;
  const cursor = gridCursor.value;
  if (!shotId || !cursor) return;
  gridIsFetching.value = true;
  try {
    const res = await fetchVersions(shotId, {
      sort: gridSort.value,
      cursor,
      limit: 20,
    });
    versions.value = [...versions.value, ...res.items];
    gridCursor.value = res.next_cursor;
    // total_count may shift slightly mid-session (new versions inserted) —
    // overwrite for accuracy. RESEARCH.md Pitfall B documents the semantic.
    gridTotalCount.value = res.total_count;
  } catch {
    // Inline error pill; planner picks visual treatment.
  } finally {
    gridIsFetching.value = false;
  }
}
```

5. **Add sort-change handlers + scroll-to-top (D-19):**
```tsx
const mainRef = useRef<HTMLElement>(null);

function onGridSortChange(next: VersionSort) {
  gridSort.value = next;
  gridCursor.value = null;        // SORT-05 cursor reset
  persistGridSort(next);          // localStorage + URL replaceState
  // D-19: scroll to top of <main>.
  if (mainRef.current) mainRef.current.scrollTop = 0;
}

function onTreeSortChange(next: HierarchySort) {
  treeSort.value = next;
  persistTreeSort(next);
  // Tree client-side re-sort via compareTreeNodes happens at render time —
  // the `tree: TreeWorkspace[]` derivation (line 222-249) re-runs because
  // treeSort.value is read inside it. No imperative re-sort needed here.
}
```

6. **Compose `<SortDropdown/>` × 2 + `<LoadMoreButton/>` in the JSX:**
```tsx
const GRID_OPTIONS: ReadonlyArray<SortOption<SortField>> = [
  { field: 'completed_at', dir: 'desc', label: 'Latest' },
  { field: 'completed_at', dir: 'asc', label: 'Oldest' },
  { field: 'name', dir: 'asc', label: 'Name A→Z' },          // PLANNER OPEN: drop or keep — see RESEARCH.md A1
  { field: 'version_number', dir: 'desc', label: 'Version ↓' },
] as const;

const TREE_OPTIONS: ReadonlyArray<SortOption<HierarchySortField>> = [
  { field: 'name', dir: 'asc', label: 'A→Z' },
  { field: 'name', dir: 'desc', label: 'Z→A' },
  { field: 'created_at', dir: 'desc', label: 'Newest' },
  { field: 'created_at', dir: 'asc', label: 'Oldest' },
] as const;

return (
  <div class="flex h-full">
    {/* Tree pane — sort strip ABOVE TreeSidebar */}
    <div class="flex flex-col" style={{ width: 'var(--sidebar-width)' }}>
      <div class="flex items-center px-2 py-1.5 border-b border-[var(--color-border)]">
        <SortDropdown
          options={TREE_OPTIONS}
          value={treeSort.value}
          onChange={onTreeSortChange}
          ariaLabel="Sort tree by"
        />
      </div>
      <TreeSidebar /* ... existing props ... */ />
    </div>
    {/* Version-grid pane — sort strip ABOVE the version list, LoadMoreButton at the bottom */}
    <main ref={mainRef} class="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      <div class="flex items-center pb-2 border-b border-[var(--color-border)]">
        <SortDropdown
          options={GRID_OPTIONS}
          value={gridSort.value}
          onChange={onGridSortChange}
          ariaLabel="Sort versions by"
        />
      </div>
      {/* ... existing EmptyState / VersionCard list ... */}
      {gridCursor.value !== null && (
        <LoadMoreButton
          isFetching={gridIsFetching.value}
          remaining={gridTotalCount.value - versions.value.length}
          pageSize={20}
          onClick={loadMore}
        />
      )}
    </main>
    {/* ... existing VersionDrawer ... */}
  </div>
);
```

7. **Tree client-side re-sort — modify the existing `tree: TreeWorkspace[]` derivation (lines 222-249) to use `compareTreeNodes`:**
```tsx
const tree: TreeWorkspace[] = workspaces.value
  .slice()
  .sort((a, b) => compareTreeNodes(a, b, treeSort.value))
  .map((ws) => ({
    id: ws.id,
    name: ws.name,
    projects: (children.projects[ws.id] ?? [])
      .slice()
      .sort((a, b) => compareTreeNodes(a, b, treeSort.value))
      .map((p): TreeProject => ({
        id: p.id,
        name: p.name,
        sequences: (children.sequences[p.id] ?? [])
          .slice()
          .sort((a, b) => compareTreeNodes(a, b, treeSort.value))
          .map((s): TreeSequence => ({
            // ... and so on for shots ...
          })),
      })),
  }));
```
**Pattern note:** `arr.slice().sort(comparator)` is the standard immutable-sort pattern (preserves the source array). `compareTreeNodes` is the Phase 18 helper from `lib/sortHelpers.ts` (RESEARCH.md Pattern 10 lines 1052-1064).

---

### Test files (Wave 0 stubs)

**Server-side test analogs:**
- `src/store/__tests__/version-repo.test.ts` — vitest + better-sqlite3 setup pattern (`makeInMemoryDb()` from `test-utils/fixtures.ts`, `beforeEach` creates fresh repos + parent hierarchy).
- `src/__tests__/thumbnail-route.test.ts` — Hono `app.request(...)` testing API for HTTP route tests (lines 425-431: `buildRouterApp(engine)` factory).

**Existing `version-repo.test.ts` setup (lines 17-34, exact verbatim):**
```typescript
describe('VersionRepo — allocation, state transitions, immutability', () => {
  let repo: VersionRepo;
  let hierarchy: HierarchyRepo;
  let shotId: string;
  let shotB: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    repo = new VersionRepo(db);
    hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    const shot2 = hierarchy.createShot(seq.id, 'sh020');
    shotId = shot.id;
    shotB = shot2.id;
  });
  // ... tests follow ...
});
```
**Pattern to mirror — Wave-0 server tests:** Use `makeInMemoryDb()` from `test-utils/fixtures.ts`, instantiate `HierarchyRepo` + `VersionRepo`, seed parent hierarchy in `beforeEach`. Each test creates a few versions with controlled `completed_at` values (use `vi.setSystemTime(new Date(...))` to control `Date.now()` if needed) and asserts ordering.

**HTTP route test pattern from `thumbnail-route.test.ts:425-431`:**
```typescript
function buildRouterApp(engine: Engine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}
```
**Pattern to mirror — `dashboard-routes-sort.test.ts`:**
- Use the same `buildRouterApp(engine)` factory.
- Issue requests via `app.request('/api/shots/.../versions?sort=completed_at:desc')`.
- Assert: 200 status + JSON body shape `{ items, next_cursor, total_count }`.
- Issue malformed `?sort=garbage` → assert 400 + `INVALID_INPUT` envelope.
- Issue malformed `?cursor=garbage` → assert 400 + `INVALID_INPUT` envelope.

**Dashboard component test analog — `Thumbnail.test.tsx` (236 lines):**
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Thumbnail } from '../components/Thumbnail.js';

function makeVersion(overrides: Partial<ThumbnailVersion> = {}): ThumbnailVersion {
  return {
    id: 'ver_abc',
    label: 'v001',
    status: 'complete',
    ...overrides,
  };
}

describe('Thumbnail (Phase 17 — Plan 17-04 Task 3)', () => {
  it('Test 1: ...', () => { /* render → screen.queryBy* → expect */ });
  it('Test 2: ...', () => { /* ... */ });
});
```
**Pattern to mirror — Wave-0 dashboard tests:**
- vitest + `@testing-library/preact` import block identical.
- One render per test (auto-cleanup via `setup.ts:9-11`).
- `screen.getByRole(...)` / `screen.getByTestId(...)` / `screen.queryByTestId(...)` / `screen.getByAltText(...)` for queries.
- `fireEvent.click(...)` / `fireEvent.keyDown(...)` for interaction.
- Numbered test descriptions: `it('Test 1: opens listbox on Enter key', () => {...})` — matches Phase 17 convention.
- For `SortDropdown.test.tsx`: 12-15 tests covering ARIA roles, keyboard shortcuts (Enter, Space, ArrowDown, ArrowUp, Escape, Tab, Home, End), outside-click, focus management.
- For `LoadMoreButton.test.tsx`: 5-7 tests covering click→onClick, disabled-while-fetching, "Load 20 more (32 remaining)" text composition, aria-label.
- For `sortHelpers.test.ts`: ~20 tests covering `parseSortValue` whitelist, `serializeSortValue` round-trip, `hydrateSortState` URL/localStorage/default precedence (D-13/D-15), `setBoundedLocalStorageEntry` LRU eviction, `compareTreeNodes` (a vs b, asc vs desc), localStorage quota fall-through.
- For `HomeView-sort-defaults.test.tsx` + `HomeView-sort-toggle.test.tsx`: integration tests rendering `<HomeView/>` with `vi.stubGlobal('localStorage', makeMemoryStorage())` (mirrors `theme-persistence.test.ts:33-59`).

**`theme-persistence.test.ts` — memory-storage polyfill (lines 30-65, exact verbatim — pattern for any test that touches localStorage):**
```typescript
function makeMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    clear() { store = {}; },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number): string | null { return Object.keys(store)[index] ?? null; },
    removeItem(key: string): void { delete store[key]; },
    setItem(key: string, value: string): void { store[key] = String(value); },
  };
}

vi.stubGlobal('localStorage', makeMemoryStorage());

// Now safe to import the module under test.
// eslint-disable-next-line import/first
import { ThemeToggle } from '../components/ThemeToggle.js';
```
**Pattern to mirror:** Phase 18 tests that exercise `setBoundedLocalStorageEntry`, `hydrateSortState`, `persistGridSort`, `persistTreeSort` MUST use `makeMemoryStorage()` polyfill via `vi.stubGlobal('localStorage', ...)` BEFORE importing the SUT. Node 25+ has a native experimental `localStorage` global that's a no-op without `--localstorage-file` — without the polyfill, tests pass spuriously.

---

## Cross-cutting Patterns

### Architecture-purity invariant — the dashboard cannot import server source

**Source:** `src/__tests__/architecture-purity.test.ts:732-740` (exact verbatim above).

**Apply to:**
- `packages/dashboard/src/lib/sortTypes.ts` — types MIRRORED from `src/store/sort.ts`, never imported.
- `packages/dashboard/src/lib/sortHelpers.ts` — imports `./sortTypes.js`, never `../../../src/store/...`.
- All Phase 18 dashboard files — must be checked at PR review for rogue `../../src` traversals (the architecture-purity test fires automatically; no new test logic needed).

**No new architecture-purity allowed-set entries.** Phase 18 introduces zero new native bindings or external deps. RESEARCH.md confirms (line 96) and SECURITY DOMAIN section (lines 1591-1599). The existing test does not need extension.

---

### TypedError + INVALID_INPUT throw pattern

**Source:** `src/http/dashboard-routes.ts:108-114` (`qNum` helper) + `:185-190` (`/diff` route's `INVALID_INPUT` throw).

**Apply to:**
- `dashboard-routes.ts` — `parseVersionSortParam` and `parseCursorParam` and `parseHierarchySortParam` all throw `TypedError('INVALID_INPUT', message, recovery)` on malformed input.
- The existing `typedErrorHandler` middleware (mounted in `server.ts`) converts to a 400 response with the structured envelope `{ error: { code: 'INVALID_INPUT', message: '...', recovery: '...' } }`. No middleware change needed.

**Defence-in-depth:** the dashboard's `lib/sortHelpers.ts:parseSortValue` does the SAME validation client-side BEFORE issuing the request, so users with malformed shareable URLs get graceful fallback (D-16) instead of 4xx errors. Two-layer enforcement.

---

### localStorage with try/catch fallback

**Source:** `packages/dashboard/src/components/ThemeToggle.tsx:53-57` (write) + `:31-42` (read with type-narrowing on whitelist).

**Apply to:**
- `lib/sortHelpers.ts:setBoundedLocalStorageEntry` — wraps `localStorage.setItem` in try/catch. Silent fall-through (matches existing precedent).
- `lib/sortHelpers.ts:readLocalStorageSort` — wraps `localStorage.getItem` AND `JSON.parse` in try/catch. Returns null on any failure path.
- `lib/sortHelpers.ts:hydrateSortState` — guards `typeof localStorage === 'undefined'` for SSR / test-harness environments.

**Quota / privacy mode mitigation (RESEARCH.md Pitfall E, line 1226):** Silent fall-through on `QuotaExceededError`. The signal value still updates; only persistence breaks. Matches existing ThemeToggle behavior. Manual UAT step: open dashboard in private mode, toggle sort, reload, verify sort defaults to Latest.

---

### `@preact/signals` shared-state pattern

**Source:** `packages/dashboard/src/state/versions.ts` (full file) + `state/hierarchy.ts` (full file).

**Apply to:**
- New signals declared in the SAME files (`gridSort` + `gridCursor` + `gridTotalCount` + `gridIsFetching` in `versions.ts`; `treeSort` in `hierarchy.ts`).
- Signal reads in `HomeView.tsx` use `gridSort.value`, `gridCursor.value`, etc. The reactivity works because Preact's signal-runtime tracks reads inside render functions.
- Signal writes are direct: `gridSort.value = next;` triggers a re-render of subscribers.

**Pattern note:** No new state-management library. No new patterns. This is a strict additive extension of the existing signal bag.

---

### Phase 17 thin-wrapper component shape

**Source:** `packages/dashboard/src/components/Thumbnail.tsx` (full file, 188 lines).

**Apply to:** `<SortDropdown/>` and `<LoadMoreButton/>`.

**Convention requirements:**
- Header doc-block opens with one-line summary, then "Phase X / Plan X-XX Task X" anchor.
- Numbered or labeled sections referencing UI-SPEC.md by name: "Render contract", "Click-target contract", "Performance contract", "SECURITY notes", "Dimensional contract".
- Typed props interface with JSDoc per prop explaining purpose AND default.
- Default values destructured in function signature.
- Pure presentational where possible (no `useEffect` for data fetching; signal reads in parent, props down).
- `data-testid` on key elements for component-test queries.

**`<SortDropdown/>` deviates from "pure" only because it needs `useState` (open/closed + focused-index) + `useRef` (trigger + listbox refs) + `useEffect` (outside-click listener) + `useId` (stable IDs for `aria-controls` and `aria-activedescendant`). This is structurally identical to Phase 17 `<Thumbnail/>`'s `useState` for `imgError`/`imgLoaded` — a PURE local-state component, not a globally-stateful one.**

---

### Drizzle `sql\`...\`` template — column-reference interpolation, not strings

**Source:** `src/store/version-repo.ts:216` (`sql\`${versions.version_number} DESC\``).

**Apply to:** `src/store/sort.ts` — every column reference in the new ORDER BY builder.

**The danger (Pitfall J in RESEARCH.md, line 1257-1259):**
```typescript
// WRONG — emits SQL `ORDER BY ? DESC` with the column name as a parameter.
sql`${col.name} DESC`

// RIGHT — emits SQL `ORDER BY "completed_at" DESC` with quoted identifier.
sql`${col} DESC`
```

**Pattern to mirror:** Always interpolate the Drizzle column-reference object (`versions.completed_at`, `projects.name`, etc.) DIRECTLY. Never call `.name` on it. The whitelist enum (`SortField`) maps to column references via `Record<SortField, SQLiteColumn>`, so the only strings ever interpolated are the user-selected enum values — and those are exhaustive-checked at TypeScript level + Zod-validated at the HTTP boundary.

---

## Path Conventions

**Server tests:** `src/store/__tests__/<name>.test.ts` and `src/__tests__/<name>.test.ts`. The `__tests__/` directory is co-located with the SUT module's parent. Existing precedent: `src/store/__tests__/version-repo.test.ts`, `src/__tests__/thumbnail-route.test.ts`.

**Dashboard tests:** `packages/dashboard/src/__tests__/<name>.test.tsx` (or `.test.ts` for non-JSX tests). Tests for components in `packages/dashboard/src/components/Foo.tsx` go in `packages/dashboard/src/__tests__/Foo.test.tsx` — NOT in `packages/dashboard/src/components/__tests__/`. Phase 17 made this correction explicit (17-PATTERNS.md line 39); Phase 18 inherits.

**Dashboard pure-helper tests:** `packages/dashboard/src/__tests__/sortHelpers.test.ts` — `.ts` (not `.tsx`) is correct because the helpers are pure functions (no JSX). Use `.tsx` only when JSX is needed in the test (component renders).

**Architecture-purity test extension:** No extension needed for Phase 18. The directory-level guards at `src/store/`, `src/engine/`, `src/utils/`, `src/types/`, `src/comfyui/` (lines 33-62) already cover the new `sort.ts` file structurally. The dashboard-side guard at line 732 covers `sortTypes.ts` and `sortHelpers.ts`. Confirm via `npx vitest run src/__tests__/architecture-purity.test.ts` after Phase 18 lands.

**Lucide-preact icon imports:** `import { ChevronDown, Check } from 'lucide-preact';` (precedent: `TreeSidebar.tsx:40`, `ThemeToggle.tsx:24`). Phase 18 uses `<ChevronDown size={14}/>` for the trigger arrow + `<Check size={14}/>` for the selected-option indicator. No new icon dep needed.

**CSS variable theming:** `bg-[var(--color-surface)]`, `text-[var(--color-fg)]`, `text-[var(--color-fg-muted)]`, `bg-[var(--color-accent)] text-[var(--color-bg)]` (selected state), `border-[var(--color-border)]`. Same token set used by `<TreeRow/>` and `<ThemeToggle/>`. UI-SPEC.md locks the exact mapping per option-state.

---

## Open Questions for Planner

These are decisions the pattern map surfaces but cannot make. The planner addresses each in PLAN.md:

1. **Version-grid `name` sort target column (RESEARCH.md A1, line 1474-1486):** The `versions` table has no `name` column (verified in `src/store/schema.ts:66-102`). Three options:
   - (a) Drop "Name A→Z" from the grid `GRID_OPTIONS` array (researcher recommendation per RESEARCH.md line 1493).
   - (b) Sort by `versions.notes` (display label) — semantically OK but UX-questionable for null/empty notes.
   - (c) Sort by `versions.id` lexicographically (nanoid) — deterministic but visually meaningless.

   Pattern mapping defers; planner picks. **Pattern impact:** if (a), the `VERSION_COLUMN_MAP` in `src/store/sort.ts` only needs entries for `completed_at`, `created_at`, `version_number` (drop `name`). The `SortField` type narrows to those three. If (b) or (c), the column map needs the chosen mapping documented in a code comment.

2. **In-progress band sub-sort fidelity (RESEARCH.md A4 + Open Question 2, lines 1494):** D-02 specifies `created_at DESC` for the in-progress band. Two implementations:
   - (a) Simple `versions.id ASC` tiebreaker (what the RESEARCH.md Pattern 1 reference impl uses) — close enough for typical workloads, lower test surface.
   - (b) CASE-expression refinement (`CASE WHEN completed_at IS NULL THEN created_at END DESC, CASE WHEN completed_at IS NOT NULL THEN completed_at END <dir>`) — exact D-02 fidelity, more SQL complexity.

   Pattern mapping defers; planner picks. **Researcher recommendation: (a). Pattern impact:** if (a), `buildVersionOrderBy` in `sort.ts` is the simple 3-term `sql.join`. If (b), the helper has an additional CASE-expression branch.

3. **`<LoadMoreButton/>` standalone vs. inline (RESEARCH.md Open Question 3, line 1495):** UI-SPEC §"Component Inventory" leaves the choice between a separate `<LoadMoreButton/>` component and inline JSX in `HomeView.tsx`. Pattern mapping assumes a standalone component file (researcher recommendation per RESEARCH.md line 1495 — testability + future reuse on settings list (Phase 19 candidate)). **Pattern impact:** if inline, drop the `LoadMoreButton.tsx` file from the file inventory and merge the JSX into `HomeView.tsx`'s render. If standalone, follow the thin-wrapper pattern documented above.

4. **`gridIsFetching` signal placement (RESEARCH.md Open Question 5, line 1497):** Pattern mapping assumed a module-level signal in `state/versions.ts` (researcher recommendation per RESEARCH.md line 1497 — consistent with existing pattern). Alternative: local `useState` in `HomeView.tsx`. **Pattern impact:** if local `useState`, drop the new `gridIsFetching` signal export from `state/versions.ts`. If signal, the `<LoadMoreButton/>` reads it via `gridIsFetching.value` rather than a passed-down prop. Both are wired correctly in this map; planner narrows.

5. **`?offset=` deprecation timing for `fetchVersions`:** The pattern mapping kept `offset` in `FetchVersionsParams` for back-compat with any non-Phase-18 caller (none exist today, but TypeScript-wise a future caller might pass it). Alternative: remove `offset` outright and break compile if any caller still passes it. **Pattern impact:** if removed, the type narrows; if kept, a deprecation comment-pin warns future planners. Researcher's neutral observation.

6. **Hierarchy fetcher signature compatibility:** The pattern map adds optional `params?: { sort? }` to `fetchProjects`/`fetchSequences`/`fetchShots`. Existing callers in `HomeView.tsx:124,144,164` pass NO second argument and continue to work (TypeScript-optional param). No call-site change needed unless the planner wants to thread `treeSort` to the server (RESEARCH.md Pattern 10 recommendation: client-side re-sort, NOT server re-fetch — line 1080). **Pattern impact:** if planner picks server re-fetch instead of client-side re-sort, the existing fetchers gain new `params: { sort: treeSort.value }` arguments AND `HomeView.tsx`'s `hydrateChildrenOf` needs new signal-dependency logic.

---

## Metadata

**Analog search scope (files read in this pass):**
- `src/store/version-repo.ts` (241 lines, full)
- `src/store/hierarchy-repo.ts` (313 lines, full)
- `src/store/schema.ts` (130 lines, range)
- `src/store/__tests__/version-repo.test.ts` (range — beforeEach pattern + 2 representative tests)
- `src/__tests__/architecture-purity.test.ts` (range — header + line 732 dashboard guard)
- `src/__tests__/thumbnail-route.test.ts` (range — buildRouterApp factory + Test 12 GET shape)
- `src/http/dashboard-routes.ts` (220 lines + grep)
- `src/engine/pipeline.ts` (range — facade list methods at lines 540-786)
- `src/tools/{project,sequence,shot}-tool.ts` (grep — caller back-compat verification)
- `packages/dashboard/src/lib/api.ts` (364 lines, full)
- `packages/dashboard/src/lib/shape.ts` (98 lines, full)
- `packages/dashboard/src/components/Thumbnail.tsx` (188 lines, full)
- `packages/dashboard/src/components/ThemeToggle.tsx` (74 lines, full)
- `packages/dashboard/src/components/TreeSidebar.tsx` (329 lines, full)
- `packages/dashboard/src/components/SkeletonThumbnail.tsx` (32 lines, full)
- `packages/dashboard/src/components/WarningPill.tsx` (44 lines, full)
- `packages/dashboard/src/components/C2paShield.tsx` (range — header + render path)
- `packages/dashboard/src/state/versions.ts` (25 lines, full)
- `packages/dashboard/src/state/hierarchy.ts` (32 lines, full)
- `packages/dashboard/src/views/HomeView.tsx` (318 lines, full)
- `packages/dashboard/src/main.tsx` (35 lines, full)
- `packages/dashboard/src/__tests__/Thumbnail.test.tsx` (236 lines, full)
- `packages/dashboard/src/__tests__/api.test.ts` (48 lines, full)
- `packages/dashboard/src/__tests__/setup.ts` (12 lines, full)
- `packages/dashboard/src/__tests__/theme-persistence.test.ts` (129 lines, full)
- 18-CONTEXT.md (full)
- 18-RESEARCH.md (lines 1-1600, range scan covering Patterns 1-12 + Open Questions + Validation)
- 18-UI-SPEC.md (referenced indirectly via RESEARCH.md citations; not loaded in full due to size)
- 17-PATTERNS.md (lines 1-1600 range — format model)

**Files scanned in this pass:** 27 source/test files + 4 planning docs.

**Pattern extraction date:** 2026-05-06

---
