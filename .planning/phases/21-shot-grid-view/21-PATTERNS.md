---
phase: 21
slug: shot-grid-view
mapped: 2026-05-13
files_classified: 28
analogs_found: 27
new_files: 18
modified_files: 10
---

# Phase 21 — Shot Grid View · Pattern Map

> Per-file pattern assignment for the planner. Every new/modified file in Phase 21 is linked to its closest in-tree analog, with concrete code excerpts to copy. The phase is **all assembly, no invention** — every primitive exists.

---

## Summary

Phase 21 weaves together five established in-tree patterns: (1) **Phase 18 cursor pagination** at `src/store/sort.ts` / `parseCursorParam` in `dashboard-routes.ts`, (2) **Phase 17 lazy-load thumbnail** at `Thumbnail.tsx`, (3) **Phase 5 SSE handler lifecycle** at `App.tsx:27-37` + `state/active-generations.ts:68-74`, (4) **Phase 18 URL state + Zod whitelist** at `lib/sortHelpers.ts:209-296`, (5) **Phase 5 `<StatusPill/>`** as design vocabulary for the new 5-status `<ShotStatusPill/>`. The single load-bearing GAP — `packages/dashboard/src/types/events.ts:61-67` is missing the `'shot.status_changed'` entry — must be closed in Task 1 of Wave 1 before any consumer can subscribe. All other Phase 21 files are direct adaptations of existing analogs with minor delta in field shape (`ShotStatus` 5-value union vs `Status` 4-value; `{ n, sid }` cursor vs `{ cna, sv, vid }`; `activeView` signal vs `selectedVersionId`).

The backend side reuses existing helpers verbatim: `qNum` for limit parsing, `parseCursorParam` for cursor decoding (with a fresh `parseShotGridCursorParam` sibling), `TypedError('SEQUENCE_NOT_FOUND', ...)` for 404 propagation, and `makeInMemoryDb` + Drizzle `sql\`...\`` template for the window-function CTE. The frontend side reuses `<Thumbnail/>`, `<SkeletonThumbnail/>`, `<LoadMoreButton/>`, `<EmptyState/>`, `<StatusPill/>` design tokens, the `onSseEvent` / `offSseEvent` registry, `qs()` + `fetchJson<T>()` helpers, and the `@testing-library/preact` rendering harness. No new dependencies, no new migrations, no new MCP tools.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| **Wave 1 — gap closure + foundations** | | | | |
| `packages/dashboard/src/types/events.ts` (MODIFY) | types | wire-shape | `packages/dashboard/src/types/events.ts:17-22` (VersionStatusChangedPayload) | exact (extend, same file) |
| `packages/dashboard/src/types/shot-grid.ts` (NEW) | types | request-response | `packages/dashboard/src/lib/api.ts:209-215` (PaginatedVersionsResponse) | role-match |
| `packages/dashboard/src/styles/theme.css` (MODIFY) | styles | tokens | `packages/dashboard/src/styles/theme.css:29-71` (existing `@theme` block) | exact (extend, same file) |
| `packages/dashboard/src/lib/copy.ts` (MODIFY) | lib | string-constants | `packages/dashboard/src/lib/copy.ts:21-103` (Phase 17/18 copy blocks) | exact (extend, same file) |
| `packages/dashboard/src/lib/time.ts` (NEW) | lib | pure-utility | NO ANALOG — first time helper (closest cousin: `lib/shape.ts` for pure utility shape) | none |
| `packages/dashboard/src/lib/__tests__/time.test.ts` (NEW) | test | unit | `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx:1-91` (pure-function vitest shape) | role-match |
| `packages/dashboard/src/lib/api.ts` (MODIFY) | lib | request-response | `packages/dashboard/src/lib/api.ts:230-245` (fetchVersions) | exact (extend, same file) |
| `src/store/shot-status-repo.ts` (EXTEND) | repo | CRUD-read | `src/store/sort.ts:60-196` (cursor encode/decode) + `src/store/version-repo.ts:230-269` (limit+1 pagination) | role-match |
| `src/store/__tests__/shot-status-repo-grid.test.ts` (NEW) | test | unit | `src/store/__tests__/version-repo-cursor.test.ts:1-100` (walkAllPages) + `src/store/__tests__/shot-status-repo.test.ts:29-41` (makeInMemoryDb fixture) | exact |
| **Wave 2 — engine facade + HTTP + state** | | | | |
| `src/engine/pipeline.ts` (MODIFY) | facade | delegation | `src/engine/pipeline.ts:603-680` (getSequence + listShots) + `:696-741` (setShotStatus) | exact (same file) |
| `src/http/dashboard-routes.ts` (MODIFY) | route | request-response | `src/http/dashboard-routes.ts:267-301` (`/api/sequences/:id/shots`, `/api/shots/:id/versions`) | exact (extend, same file) |
| `src/http/__tests__/dashboard-routes-shot-grid.test.ts` (NEW) | test | integration | `src/http/__tests__/dashboard-routes.test.ts:186-219` (sequence/shot routes) + `:614-668` (qNum INVALID_INPUT) | exact |
| `packages/dashboard/src/state/shot-grid.ts` (NEW) | state | event-driven | `packages/dashboard/src/state/active-generations.ts:1-75` (signals + onVersionStatusChanged) + `lib/sortHelpers.ts:209-296` (URL state) | exact |
| `packages/dashboard/src/state/__tests__/shot-grid.test.ts` (NEW) | test | unit | NO direct analog (state files have no in-tree tests yet) — closest: `src/store/__tests__/shot-status-repo.test.ts` for behavior assertions, `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx` for vitest+jsdom shape | partial |
| `packages/dashboard/src/components/ShotStatusPill.tsx` (NEW) | component | pure-render | `packages/dashboard/src/components/StatusPill.tsx:1-47` (entire file) | exact |
| `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` (NEW) | test | component | `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx:1-91` (props-in render assertions) | role-match |
| **Wave 3 — composite components** | | | | |
| `packages/dashboard/src/components/ShotGridCard.tsx` (NEW) | component | pure-render | `packages/dashboard/src/components/VersionCard.tsx:1-91` (entire file — single-button card with `<Thumbnail/>`) | exact |
| `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` (NEW) | test | component | `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx` + Pitfall 5 from RESEARCH (key stability) | role-match |
| `packages/dashboard/src/components/ShotGridFilterBar.tsx` (NEW) | component | event-out | `packages/dashboard/src/components/StatusPill.tsx` (pill design) + `LoadMoreButton.tsx:103-133` (button + sibling pattern) | role-match |
| `packages/dashboard/src/components/__tests__/ShotGridFilterBar.test.tsx` (NEW) | test | component | `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx` (click + state) | role-match |
| `packages/dashboard/src/components/SequenceHeader.tsx` (NEW) | component | pure-render | NO direct analog (first collapsible header) — closest: `TreeSidebar.tsx:280-329` (TreeRow chevron toggle), `StatusPill.tsx` (mini-pill vocabulary) | partial |
| `packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` (NEW) | test | component | `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx` | role-match |
| `packages/dashboard/src/components/TreeSidebar.tsx` (MODIFY) | component | event-out | `packages/dashboard/src/components/TreeSidebar.tsx:204-258` (SequenceNode) | exact (same file) |
| **Wave 4 — view + root integration** | | | | |
| `packages/dashboard/src/views/ShotGridView.tsx` (NEW) | view | request-response + event-driven | `packages/dashboard/src/views/HomeView.tsx:165-285` (mount-time fetch + paginated buffer) | role-match |
| `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` (NEW) | test | component | `packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx` (view-level integration) | role-match |
| `packages/dashboard/src/App.tsx` (MODIFY) | root | composition | `packages/dashboard/src/App.tsx:27-58` (entire file) | exact (same file) |
| `packages/dashboard/src/__tests__/App.test.tsx` (NEW) | test | smoke | `packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx` (signal-driven render) | role-match |

**Coverage:** 18 new + 10 modified = **28 files mapped**. **27/28 have a strong in-tree analog**; only `lib/time.ts` has no preceding utility (it's tiny — ~30 LOC — and the planner should write it inline against the UI-SPEC time-helper constants).

---

## Pattern Assignments

### 1. `packages/dashboard/src/types/events.ts` (MODIFY — load-bearing GAP)

**Role:** types · **Data flow:** wire-shape mirror · **Analog:** same file lines 17-67 (extend the existing `EngineEventMap`)

**Critical gap (RESEARCH Pitfall 1):** This file is missing `'shot.status_changed': ShotStatusChangedPayload` in `EngineEventMap` — the server-side `EVENT_TYPES` tuple at `src/http/sse.ts:50-57` and the dashboard payload adapter at `src/http/sse.ts:135-148` both already wire the event, but the dashboard's local type mirror was missed in Phase 20. **Block all downstream Phase 21 tasks on this fix.**

**Existing pattern to mirror** (`packages/dashboard/src/types/events.ts:17-22`):
```typescript
/** version.status_changed — a version moved between queued/running/complete/failed. */
export interface VersionStatusChangedPayload {
  versionId: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  jobId?: string;
}
```

**What to add** (mirror camelCase wire shape from `src/http/sse.ts:135-148`):
```typescript
/**
 * shot.status_changed — a shot's production status transitioned (Phase 20 STAT-04).
 * Wire shape is camelCase per src/http/sse.ts:135-148 toDashboardPayload case.
 * `note` coerces null → undefined (optional field) at the adapter; never null on the wire.
 */
export interface ShotStatusChangedPayload {
  shotId: string;
  sequenceId: string;
  fromStatus: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit' | null;
  toStatus: 'wip' | 'pending-review' | 'approved' | 'on-hold' | 'omit';
  changedBy: string;
  note?: string;
}
```

**Pattern to mirror** (the `EngineEventMap` registration at line 61):
```typescript
export type EngineEventMap = {
  'version.status_changed': VersionStatusChangedPayload;
  'version.created': VersionCreatedPayload;
  'tag.changed': TagChangedPayload;
  'metadata.changed': MetadataChangedPayload;
  'hierarchy.created': HierarchyCreatedPayload;
  'shot.status_changed': ShotStatusChangedPayload;  // NEW
};
```

**What's new:** The `ShotStatus` literal union is duplicated inline here (NOT imported from elsewhere). The dashboard does NOT import server types per D-WEBUI-31 architecture-purity. The 5-value union must match `src/types/hierarchy.ts` `SHOT_STATUSES` exactly; misalignment surfaces at `App.tsx` compile time, not runtime.

**Landmines:**
- DO NOT import the union from `src/types/hierarchy.ts` — D-WEBUI-31 forbids server-tree relative imports. Inline-duplicate the literal.
- The wire shape is camelCase (`shotId`, `fromStatus`) per `toDashboardPayload` at `src/http/sse.ts:142-147`. Do NOT use snake_case here even though the engine emits snake_case on the bus.

---

### 2. `packages/dashboard/src/types/shot-grid.ts` (NEW)

**Role:** types · **Data flow:** request-response envelope · **Analog:** `packages/dashboard/src/lib/api.ts:209-215` (PaginatedVersionsResponse)

**Existing pattern to mirror** (`packages/dashboard/src/lib/api.ts:209-215`):
```typescript
export interface PaginatedVersionsResponse {
  items: Version[];
  /** Opaque base64url cursor for the next page. null when no more pages. */
  next_cursor: string | null;
  /** Total row count for the shot (cursor-independent). */
  total_count: number;
}
```

**What to write** (D-13 lean payload — note `shots[]` not `items[]` per the LOCKED endpoint shape):
```typescript
import type { ShotStatusChangedPayload } from './events.js';

/** Extracted from ShotStatusChangedPayload.toStatus — the 5-value shot status union. */
export type ShotStatus = ShotStatusChangedPayload['toStatus'];

export interface ShotGridSequenceMeta {
  id: string;
  name: string;
}

export interface ShotGridRow {
  id: string;
  name: string;
  status: ShotStatus;
  version_count: number;
  latest_completed_version: {
    id: string;
    thumbnail_url: string;   // construct via getThumbnailUrl(id) at render time per RESEARCH Pattern 1
    completed_at: number;    // epoch ms
  } | null;
}

export interface ShotGridResponse {
  sequence: ShotGridSequenceMeta;
  shots: ShotGridRow[];
  next_cursor: string | null;
  total_count: number;
}
```

**What's new:** `ShotStatus` is re-exported here as a type alias of `ShotStatusChangedPayload['toStatus']` to avoid double-duplication. Aggregate counts (D-14) live in `state/shot-grid.ts`, not here.

**Landmines:** `next_cursor` and `total_count` are snake_case (mirrors `PaginatedVersionsResponse`). `latest_completed_version` is also snake_case for the field name but contains camelCase / snake_case mixed (`completed_at` is snake_case epoch ms per the server convention).

---

### 3. `packages/dashboard/src/styles/theme.css` (MODIFY)

**Role:** styles · **Data flow:** CSS tokens · **Analog:** same file lines 29-97 (existing `@theme` + `[data-theme="light"]` blocks)

**Existing pattern** (`theme.css:29-71` — `@theme` block):
The file already declares `--color-status-running`, `--color-status-completed`, `--color-status-failed` (line 49-51 area). Phase 21 adds 5 sibling tokens for shot statuses in the same block AND in the `[data-theme="light"]` override block.

**What to add** (UI-SPEC §"Color" — 5 NEW shot-status tokens):

In `@theme` block, after `--color-status-failed: #ff4444;` and before `/* Layout fixed widths */`:
```css
/* Phase 21 — shot production-state pill colors (5 statuses).
 * Saturated background + var(--color-bg) text = WCAG 2.1 AA contrast
 * both themes (verified in UI-SPEC §"Color" tables). */
--color-shot-status-wip:             #94a3b8;  /* slate-400 — in progress */
--color-shot-status-pending-review:  #fbbf24;  /* amber-400 — pending action */
--color-shot-status-approved:        #4ade80;  /* green-400 — terminal success */
--color-shot-status-on-hold:         #60a5fa;  /* blue-400 — paused/blocked */
--color-shot-status-omit:            #64748b;  /* slate-500 — dimmed/excluded */
```

In `[data-theme="light"]` block, after `--color-destructive: #d73535;`:
```css
--color-shot-status-wip:             #64748b;
--color-shot-status-pending-review:  #d97706;
--color-shot-status-approved:        #16a34a;
--color-shot-status-on-hold:         #2563eb;
--color-shot-status-omit:            #94a3b8;
```

**What's new:** Five tokens added in two blocks (10 lines total). Hex values are verbatim from UI-SPEC §"Color" — DO NOT round or adjust; the WCAG AA contrast proof was computed against these exact values.

**Landmines:**
- Tailwind v4 does NOT auto-generate `bg-shot-status-wip` utilities from arbitrary `@theme` tokens. Components MUST use the arbitrary-value syntax `bg-[var(--color-shot-status-wip)]` (see `StatusPill.tsx:28-36` for the existing pattern).
- Light theme color values DIFFER from dark theme (NOT a uniform shift) — UI-SPEC tables prove each value passes WCAG AA against the matching `--color-bg`. Do NOT reuse dark-theme hex codes in the light block.

---

### 4. `packages/dashboard/src/lib/copy.ts` (MODIFY)

**Role:** lib · **Data flow:** string constants · **Analog:** same file lines 21-184 (Phase 17/18/19 copy blocks)

**Existing pattern** (`copy.ts:50-103` — Phase 18 sort + LoadMoreButton block):
```typescript
// ================================================================
// Phase 18 / Plan 18-04 — sort-strip + dropdown + load-more copy
// (UI-SPEC §"Copywriting Contract" lines 480-545)
// ================================================================

/** Sort-strip muted prefix label — single word "Sort" rendered with the
 * `.label-uppercase` utility... */
export const SORT_STRIP_LABEL = 'Sort';

export const SORT_GRID_ARIA_LABEL = 'Sort versions by';
// ... etc.
```

**Pattern to mirror:**
- Each constant gets a JSDoc paragraph explaining its surface (where it renders) AND its UI-SPEC line reference.
- Constants are `export const NAME = 'value';` — no inline literals in components.
- Section heading comment block at top of new additions: `// ===== Phase 21 — shot grid copy =====`.
- Template helpers (for parameterized strings) are functions: `export function fooArial(name: string): string { return 'prefix ' + name; }` — see `regenerateButtonAriaLabel(versionLabel)` at lines 172-175.

**What to add** (verbatim per UI-SPEC §"Copywriting Contract" — 27 constants):

Filter bar (9):
- `FILTER_BAR_STATUS_LABEL = 'Status'`
- `FILTER_PILL_ALL = 'All'`
- `FILTER_PILL_WIP = 'wip'`
- `FILTER_PILL_PENDING_REVIEW = 'pending-review'`
- `FILTER_PILL_APPROVED = 'approved'`
- `FILTER_PILL_ON_HOLD = 'on-hold'`
- `FILTER_PILL_OMIT = 'omit'`
- `SHOW_OMITTED_TOGGLE_LABEL = 'Show omitted'`
- `SHOW_OMITTED_TOGGLE_ARIA = 'Toggle omitted shots'`

Sequence header (3):
- `SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_OPEN = 'Collapse '`
- `SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_CLOSED = 'Expand '`
- `AGGREGATE_COUNTS_REGION_LABEL_PREFIX = 'Status counts for '`

Shot grid card (5):
- `SHOT_CARD_OPEN_ARIA_PREFIX = 'Open version drawer for '`
- `SHOT_CARD_VERSION_COUNT_SINGULAR = '1 version'`
- `SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX = ' versions'`
- `SHOT_CARD_NO_VERSIONS = 'No versions yet'`
- `SHOT_CARD_LAST_UPDATED_PREFIX = 'Updated '`

Time helper (6):
- `TIME_JUST_NOW = 'just now'`
- `TIME_MINUTES_SUFFIX = 'm ago'`
- `TIME_HOURS_SUFFIX = 'h ago'`
- `TIME_DAYS_SUFFIX = 'd ago'`
- `TIME_WEEKS_SUFFIX = 'w ago'`
- `TIME_MONTHS_SUFFIX = 'mo ago'`

Empty / loading / error (5):
- `SHOT_GRID_EMPTY_NO_SHOTS = 'No shots in this sequence yet. Shots are created via the MCP agent.'`
- `SHOT_GRID_EMPTY_FILTER_PREFIX = "No shots with status '"`
- `SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX = 'No active shots in '`
- `SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN = 'Hidden. Toggle "Show omitted" to view.'`
- `SHOT_GRID_LOADING_LABEL = 'Loading shots…'` (NB: U+2026 ellipsis verbatim — matches `LOAD_MORE_LOADING_LABEL` tone at line 80)
- `SHOT_GRID_FETCH_ERROR_PREFIX = 'Failed to load shots'`

TreeSidebar grid-icon (2):
- `TREE_GRID_ICON_ARIA_PREFIX = 'Open shot grid for '`
- `TREE_GRID_ICON_ACTIVE_ARIA_SUFFIX = ' (current)'`

Header home button (1):
- `HEADER_HOME_ARIA_LABEL = 'Back to home view'`

**What's new:** None of the existing 22 constants change. Phase 21 appends a clearly-marked section block.

**Landmines:**
- Use literal U+2026 (`…`) — NOT three dots `...` — for `SHOT_GRID_LOADING_LABEL`. Matches `LOAD_MORE_LOADING_LABEL` precedent.
- `SHOT_GRID_EMPTY_FILTER_PREFIX` ends with `'` (single quote) — the caller concatenates `${PREFIX}${status}' in ${sequence}.`. Test assertions must compare the FULL composed string, not the prefix alone.
- `FILTER_PILL_WIP` etc. are stored lowercase; CSS `text-transform: uppercase` does the visual rendering (UI-SPEC line 79).

---

### 5. `packages/dashboard/src/lib/time.ts` (NEW)

**Role:** lib · **Data flow:** pure utility (number → string) · **Analog:** NO direct in-tree analog (first time helper) — closest cousin is `lib/shape.ts` for the pure-utility shape

**Pattern to write** (uses 6 copy constants from `copy.ts`):
```typescript
/**
 * Phase 21 — formatRelativeTime: convert an epoch-ms timestamp to a short
 * human-readable string like "just now", "2h ago", "3d ago".
 *
 * Pure function — no side effects, no Date.now() shimming (caller passes a
 * reference time for testability). Uses 6 named copy constants from
 * lib/copy.ts (TIME_JUST_NOW, TIME_MINUTES_SUFFIX, etc.) — no inline strings.
 *
 * Bucket boundaries (mirrors GitHub / Linear precedent):
 *   - < 60 s:        "just now"
 *   - < 60 min:      "{n}m ago"
 *   - < 24 h:        "{n}h ago"
 *   - < 7 d:         "{n}d ago"
 *   - < 4 w:         "{n}w ago"
 *   - else:          "{n}mo ago"
 *
 * Architecture-purity: zero imports from src/. Only ../lib/copy.js.
 */
import {
  TIME_JUST_NOW,
  TIME_MINUTES_SUFFIX,
  TIME_HOURS_SUFFIX,
  TIME_DAYS_SUFFIX,
  TIME_WEEKS_SUFFIX,
  TIME_MONTHS_SUFFIX,
} from './copy.js';

export function formatRelativeTime(epochMs: number, nowMs: number = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor((nowMs - epochMs) / 1000));
  if (deltaSec < 60) return TIME_JUST_NOW;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}${TIME_MINUTES_SUFFIX}`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}${TIME_HOURS_SUFFIX}`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay < 7) return `${deltaDay}${TIME_DAYS_SUFFIX}`;
  const deltaWk = Math.floor(deltaDay / 7);
  if (deltaWk < 4) return `${deltaWk}${TIME_WEEKS_SUFFIX}`;
  const deltaMo = Math.floor(deltaDay / 30);
  return `${deltaMo}${TIME_MONTHS_SUFFIX}`;
}
```

**What's new:** Entire file is new. Approximately 25 LOC including imports and JSDoc.

**Landmines:**
- DO NOT import `date-fns` / `dayjs` / `dayjs/plugin/relativeTime` — RESEARCH "Don't Hand-Roll" table explicitly rejects (UI-SPEC lists 6 verbatim constants; custom helper is ~20 LOC).
- The `nowMs` parameter MUST default to `Date.now()` to keep the public API single-arg from callers, but tests pass an explicit `nowMs` for determinism (UI-SPEC tone).
- Bucket boundary at "30 days" is approximate (real calendars are 28-31 days). For Phase 21's "Updated 2mo ago" surface, this is acceptable; documented as an accepted approximation in UI-SPEC.
- Returns a STRING; never throws. Negative `deltaSec` (future timestamp) clamps to `"just now"` via `Math.max(0, ...)`.

---

### 6. `packages/dashboard/src/lib/__tests__/time.test.ts` (NEW)

**Role:** test · **Data flow:** unit · **Analog:** `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx:1-91` (vitest+vi.setSystemTime shape)

**Existing pattern to mirror** (`RegenerateButton.test.tsx:21-35`):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { RegenerateButton } from '../RegenerateButton.js';

describe('RegenerateButton (Phase 19 — Plan 19-06 Task 1)', () => {
  beforeEach(() => {
    // Pin Date.now to a deterministic epoch so cooldown math is reproducible.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });
```

**Pattern to write** — since `formatRelativeTime` accepts an explicit `nowMs` parameter, prefer pure parameter-passing over `vi.setSystemTime` (simpler):
```typescript
import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../time.js';

const REF_NOW = 1_700_000_000_000; // any deterministic epoch

describe('formatRelativeTime (Phase 21)', () => {
  it('< 60s → "just now"', () => {
    expect(formatRelativeTime(REF_NOW - 30_000, REF_NOW)).toBe('just now');
    expect(formatRelativeTime(REF_NOW, REF_NOW)).toBe('just now');
  });
  it('< 60 min → "Nm ago"', () => {
    expect(formatRelativeTime(REF_NOW - 5 * 60_000, REF_NOW)).toBe('5m ago');
    expect(formatRelativeTime(REF_NOW - 59 * 60_000, REF_NOW)).toBe('59m ago');
  });
  // ... hours, days, weeks, months ...
  it('future timestamp clamps to "just now"', () => {
    expect(formatRelativeTime(REF_NOW + 60_000, REF_NOW)).toBe('just now');
  });
});
```

**What's new:** Pure parameter test — no fake timers needed because `formatRelativeTime` is `nowMs`-injectable.

**Landmines:**
- Use `REF_NOW` constant (not `Date.now()`) so the test is reproducible across CI runs.
- Test each bucket boundary at BOTH the inclusive AND exclusive edge (59m ago vs 60m → "1h ago").
- DO NOT use `vi.setSystemTime` here — the helper accepts `nowMs` explicitly. Reserve `vi.setSystemTime` for components that read `Date.now()` internally (e.g., `RegenerateButton`).

---

### 7. `packages/dashboard/src/lib/api.ts` (MODIFY — extend with fetchShotGrid)

**Role:** lib · **Data flow:** request-response · **Analog:** same file lines 230-245 (fetchVersions) + lines 209-215 (envelope shape)

**Existing pattern to mirror** (`api.ts:230-245`):
```typescript
export function fetchVersions(
  shotId: string,
  params?: FetchVersionsParams,
): Promise<PaginatedVersionsResponse> {
  const queryParams: Record<string, unknown> = {
    sort: params?.sort ? serializeSortValue(params.sort) : undefined,
    cursor: params?.cursor ?? undefined,  // null → undefined → qs omits
    limit: params?.limit,
    include_tags: params?.include_tags,
    include_metadata: params?.include_metadata,
  };
  return fetchJson<PaginatedVersionsResponse>(
    `/api/shots/${encodeURIComponent(shotId)}/versions${qs(queryParams)}`,
  );
}
```

**What to add:**
```typescript
import type { ShotGridResponse } from '../types/shot-grid.js';

export interface FetchShotGridParams {
  cursor?: string | null;
  /** Default 20 per CLAUDE.md "Paginate all list queries". */
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

**What's new:** No new types in the existing file — `ShotGridResponse` comes from the sibling `types/shot-grid.ts`. No `?sort=` param (Phase 21 ships one fixed sort `name ASC`). No `?statusFilter=` (REQ-03 LOCKED: client-side filter).

**Landmines:**
- `cursor: null → qs() omits the param` — the `?? undefined` collapse at line 237 is the exact precedent. DO NOT pass an empty string; the route's `parseCursorParam` treats `''` and `undefined` identically (line 217 of `dashboard-routes.ts`).
- `encodeURIComponent(sequenceId)` — sequenceId is opaque (nanoid + prefix); the encode is defensive against future ID schemes that might include reserved URL chars.
- The function does NOT throw on non-2xx — `fetchJson` throws `DashboardApiError`. Callers wrap in try/catch (see HomeView `mapFetchErrorToCopy` at lines 156-163 for the precedent).

---

### 8. `src/store/shot-status-repo.ts` (EXTEND — listShotsForGrid + cursor helpers)

**Role:** repo · **Data flow:** CRUD-read · **Analog:** `src/store/sort.ts:60-196` (cursor types + encode/decode) + `src/store/version-repo.ts:230-269` (limit+1 has_more pattern, drizzle `sql\`\`` template)

**Existing patterns to mirror:**

(a) **Cursor encode/decode** (`src/store/sort.ts:60-68` + `:169-196`):
```typescript
export interface VersionCursor {
  cna: boolean;  // NULL-bit pin
  sv: number | string | null;
  vid: string;   // tiebreaker
}

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

(b) **Existing repo file shape** (`src/store/shot-status-repo.ts:1-9`):
```typescript
import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { shots, shotStatusEvents } from './schema.js';
import type { ShotStatus } from '../types/hierarchy.js';
import { newId } from '../utils/id.js';

type Db = BetterSQLite3Database<typeof schema>;
```

(c) **Null-coalesce reference** (`src/store/shot-status-repo.ts:130-133`):
```typescript
export function getCurrentStatus(db: Db, shotId: string): ShotStatus {
  const history = getStatusHistory(db, shotId, 1);
  return (history[0]?.to_status as ShotStatus) ?? 'wip';
}
```

**What to add** (per RESEARCH Pattern 1 + Pattern 2):
```typescript
import { sql } from 'drizzle-orm';
// (existing imports stay; add sql)

export interface ShotGridCursor {
  /** Last shot name on the current page (the sort key). */
  n: string;
  /** Last shot id (stable tiebreaker, shots.id is UNIQUE PRIMARY KEY). */
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

export interface ShotGridQueryRow {
  id: string;
  name: string;
  status: ShotStatus;
  version_count: number;
  lcv_id: string | null;
  lcv_completed_at: number | null;
}

export interface ShotGridQueryResult {
  items: ShotGridQueryRow[];
  next_cursor: string | null;
  total_count: number;
}

/**
 * GRID-04 — denormalized shot list for the grid view. Single-pass SQL with
 * window-function CTE (no N+1). Cursor pagination on (shots.name, shots.id) ASC.
 *
 * EXPLAIN QUERY PLAN invariant: NO `CORRELATED SCALAR SUBQUERY` for the
 * latest-version (ranked) join. The benign uncorrelated `version_count`
 * subquery is allowed. See 21-RESEARCH.md §"Validation Architecture" lines
 * 1230-1365 for the test pattern.
 *
 * Null-coalesce: shots.status comes through verbatim (Phase 20 STAT-02 dual-
 * write keeps it materialized; pre-migration shots default to 'wip' via the
 * column default in src/store/schema.ts). Empty version_count yields 0 (NOT
 * null) via SQLite COUNT(*) semantics.
 */
export function listShotsForGrid(
  db: Db,
  sequenceId: string,
  opts: { cursor: ShotGridCursor | null; limit: number },
): ShotGridQueryResult {
  const { cursor, limit } = opts;

  // total_count — single COUNT(*) over the sequence's shots. Cursor-independent.
  const totalRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(shots)
    .where(eq(shots.sequence_id, sequenceId))
    .get();

  const cursorName = cursor?.n ?? null;
  const cursorSid = cursor?.sid ?? null;

  // limit+1 fetch for has_more (mirrors src/store/version-repo.ts:251).
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
  `) as ShotGridQueryRow[];

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let next_cursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    next_cursor = encodeShotGridCursor({ n: last.name, sid: last.id });
  }

  return { items, next_cursor, total_count: Number(totalRow?.c ?? 0) };
}

/** Helper: returns the raw SQL + bind params so the EXPLAIN test can introspect. */
export function listShotsForGridSqlText(): string {
  // Same SQL text as listShotsForGrid for EXPLAIN QUERY PLAN tests.
  return /* sql */`
    WITH ranked AS (
      SELECT v.id, v.shot_id, v.completed_at,
        ROW_NUMBER() OVER (PARTITION BY v.shot_id ORDER BY v.completed_at DESC, v.id ASC) AS rn
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
    WHERE s.sequence_id = ?
      AND (? IS NULL OR s.name > ? OR (s.name = ? AND s.id > ?))
    ORDER BY s.name ASC, s.id ASC
    LIMIT ?
  `;
}
```

**What's new:** Cursor encode/decode (parallel to Phase 18); window-function CTE (first use in repo layer); separate `listShotsForGridSqlText()` helper so the EXPLAIN test can introspect without duplicating SQL strings (RESEARCH §"Validation Architecture" line 119).

**Landmines:**
- DO NOT add MCP-tool dependencies — `src/store/` is the canonical "no MCP" layer per `architecture-purity.test.ts:38-40`.
- The `sql\`\`` template uses Drizzle's parameter substitution — DO NOT inline `sequenceId` as a string literal (SQL injection risk).
- `LIMIT ${limit + 1}` is the has_more probe — Drizzle correctly parameterizes a numeric literal here.
- The `version_count` scalar subquery is INTENTIONALLY uncorrelated-aggregate (single index scan against `UNIQUE(shot_id, version_number)` autoindex). The EXPLAIN test filters `r.detail.includes('CORRELATED') && r.detail.includes('ranked')` — only the latest-version join is fenced (RESEARCH §"Validation Architecture" item 1).
- `Number(totalRow?.c ?? 0)` — better-sqlite3 returns `bigint` for COUNT(*) in some versions; the `Number()` wrap is defensive. Existing repo files (e.g., `version-repo.ts`) cast similarly.

---

### 9. `src/store/__tests__/shot-status-repo-grid.test.ts` (NEW)

**Role:** test · **Data flow:** unit (SQL + cursor walk + EXPLAIN QUERY PLAN) · **Analog:** `src/store/__tests__/version-repo-cursor.test.ts:1-100` (walkAllPages helper) + `src/store/__tests__/shot-status-repo.test.ts:29-41` (makeInMemoryDb + HierarchyRepo seeding)

**Existing pattern to mirror — fixture setup** (`src/store/__tests__/shot-status-repo.test.ts:29-41`):
```typescript
describe('shot-status-repo — append-only event store (STAT-02, STAT-03)', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let shotId: string;

  beforeEach(() => {
    const test = makeInMemoryDb();
    db = test.db;
    const hierarchy = new HierarchyRepo(db);
    const ws = hierarchy.createWorkspace('ws1');
    const proj = hierarchy.createProject(ws.id, 'p1');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const shot = hierarchy.createShot(seq.id, 'sh010');
    shotId = shot.id;
  });
```

**Existing pattern to mirror — walkAllPages** (`src/store/__tests__/version-repo-cursor.test.ts:82-100`):
```typescript
function walkAllPages(
  sort: VersionSort,
  pageSize: number,
): { allItems: Version[]; pageCount: number } {
  const allItems: Version[] = [];
  let cursor: VersionCursor | null = null;
  let pageCount = 0;
  while (pageCount < 100) {
    const page = repo.listByShot(shotId, { sort, cursor, limit: pageSize });
    allItems.push(...page.items);
    pageCount += 1;
    if (page.next_cursor === null) break;
    cursor = decodeVersionCursor(page.next_cursor);
    if (cursor === null) {
      throw new Error('Test bug: cursor decode failed mid-walk');
    }
  }
  return { allItems, pageCount };
}
```

**Existing pattern to mirror — total_count parity** (`version-repo-cursor.test.ts:326-348`):
```typescript
describe('VersionRepo.listByShot — SORT-05 total_count parity across pages', () => {
  test('every page in the walk reports the same total_count (cursor-independent)', () => {
    // ... walk all pages ...
    expect(new Set(totals).size).toBe(1);
    expect(totals[0]).toBe(47);
  });
});
```

**Tests to write** (cover GRID-04 validation map per `21-VALIDATION.md` lines 45-52):
1. **Single-pass SQL — EXPLAIN QUERY PLAN no correlated subquery for `ranked`** (uses `testDb.sqlite.prepare('EXPLAIN QUERY PLAN ' + listShotsForGridSqlText()).all(seq, null, null, null, 21)`)
2. **Single-pass SQL — CTE materializes or streams as co-routine** (defence-in-depth)
3. **Status null-coalesce** — fresh shot returns `status: 'wip'` (shots.status column default fires via createShot)
4. **`latest_completed_version` populated** — shot with multiple completed versions returns the highest-`completed_at` version's id + epoch
5. **`latest_completed_version: null`** — shot with zero completed versions
6. **`version_count` counts ALL versions** (not just completed) — shot with 2 completed + 1 failed → count=3
7. **Cursor walk visits every shot exactly once** (47-shot fixture × pageSize 10 → 5 pages, no duplicates, no skips)
8. **total_count parity** — same value on every page
9. **Cursor lex-compare** — names like `SHOT_010`, `SHOT_020` paginate in ASCII order; tiebreaker via shot.id when names are identical (build a fixture with 3 shots all named `SHOT_dup` to stress the tiebreaker)

**Test scaffold:**
```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb, type TestDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../hierarchy-repo.js';
import { VersionRepo } from '../version-repo.js';
import {
  listShotsForGrid,
  listShotsForGridSqlText,
  decodeShotGridCursor,
  type ShotGridCursor,
} from '../shot-status-repo.js';

let testDb: TestDb;
let hierarchy: HierarchyRepo;
let versionRepo: VersionRepo;
let sequenceId: string;

beforeEach(() => {
  testDb = makeInMemoryDb();
  hierarchy = new HierarchyRepo(testDb.db);
  versionRepo = new VersionRepo(testDb.db);
  const ws = hierarchy.createWorkspace('ws-grid-test');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  sequenceId = seq.id;
});

describe('listShotsForGrid — GRID-04 single-query (no N+1) via EXPLAIN QUERY PLAN', () => {
  test('plan rows do NOT contain CORRELATED SCALAR SUBQUERY referencing the ranked CTE', () => {
    // seed enough shots to ensure the planner picks a representative path
    for (let i = 0; i < 5; i++) hierarchy.createShot(sequenceId, `sh${String(i * 10 + 10).padStart(3, '0')}`);
    const planRows = testDb.sqlite
      .prepare('EXPLAIN QUERY PLAN ' + listShotsForGridSqlText())
      .all(sequenceId, null, null, null, null, 21) as Array<{ detail: string }>;
    const correlatedRanked = planRows.filter(
      (r) => r.detail.includes('CORRELATED') && r.detail.includes('ranked'),
    );
    expect(correlatedRanked).toEqual([]);
  });
  // ... ranked materializes or streams as co-routine ...
});

function walkAllShotsForGrid(pageSize: number): { allItems: any[]; pageCount: number; totals: number[] } {
  const allItems: any[] = [];
  const totals: number[] = [];
  let cursor: ShotGridCursor | null = null;
  let pageCount = 0;
  while (pageCount < 100) {
    const page = listShotsForGrid(testDb.db, sequenceId, { cursor, limit: pageSize });
    allItems.push(...page.items);
    totals.push(page.total_count);
    pageCount++;
    if (page.next_cursor === null) break;
    cursor = decodeShotGridCursor(page.next_cursor);
    if (cursor === null) throw new Error('cursor decode failed mid-walk');
  }
  return { allItems, pageCount, totals };
}

// ... cursor walk test, status null-coalesce, latest_completed_version, total_count parity, etc.
```

**What's new:** First test in repo layer to use `EXPLAIN QUERY PLAN` runtime introspection. Uses `testDb.sqlite.prepare()` against the raw `better-sqlite3` client (exposed by `makeInMemoryDb()` at fixture line 17 — `TestDb.sqlite`).

**Landmines:**
- `EXPLAIN QUERY PLAN` row shape: `{ id, parent, notused, detail }`. The relevant field is `detail` (a free-form string like `'CORRELATED SCALAR SUBQUERY ...'` or `'CO-ROUTINE ranked'`).
- Bind parameters for EXPLAIN: pass ALL 6 placeholders even if some are `null` (cursorName, cursorName, cursorName, cursorSid, plus seqId and limit) — SQLite needs the param count to match the prepared statement.
- `hierarchy.createShot(seqId, name)` — name must match `/^sh\d{3,}$/` per `pipeline.ts:637`. Use `'sh010'`, `'sh020'`, ... or `'sh100'` for sort ordering.
- DO NOT seed via raw INSERT into `shots` — go through `HierarchyRepo.createShot` so the row gets the status='wip' default. Mirror existing `shot-status-repo.test.ts:36-40` exactly.

---

### 10. `src/engine/pipeline.ts` (MODIFY — add `listShotGrid` facade)

**Role:** facade · **Data flow:** delegation · **Analog:** `src/engine/pipeline.ts:603-680` (getSequence, listShots) + `:696-741` (setShotStatus shape)

**Existing pattern to mirror** (`src/engine/pipeline.ts:603-613`):
```typescript
getSequence(id: string): { entity: Sequence; breadcrumb: Breadcrumb } {
  const entity = this.repo.getSequence(id);
  if (!entity) {
    throw new TypedError(
      'SEQUENCE_NOT_FOUND',
      `Sequence '${id}' not found`,
      `List sequences with { tool: 'sequence', action: 'list' }`,
    );
  }
  return { entity, breadcrumb: this.breadcrumb.resolve('sequence', entity.id) };
}
```

**Existing pattern to mirror** (`src/engine/pipeline.ts:666-680`):
```typescript
listShots(
  sequenceId: string | undefined,
  limit: number,
  offset: number,
  opts?: { sort?: HierarchySort },
): ListResult<Shot> {
  const { items, total_count } = this.repo.listShots(sequenceId, limit, offset, opts);
  return {
    items: items.map((s) => ({ ...s, ...this.breadcrumb.resolve('shot', s.id) })),
    total_count,
    limit,
    offset,
  };
}
```

**What to add** (place alongside the Phase 20 setShotStatus / getShotStatus methods at lines 682-741):
```typescript
import {
  listShotsForGrid,
  type ShotGridCursor,
} from '../store/shot-status-repo.js';

// ... inside the engine class:

/**
 * Phase 21 — GRID-04 denormalized shot grid for a sequence. Returns each
 * shot with its status + version count + latest-completed-version metadata.
 * Single SQL query via window-function CTE (no N+1). Cursor pagination via
 * opaque base64. Throws SEQUENCE_NOT_FOUND when the sequence does not exist.
 *
 * The repo layer returns `lcv_id` + `lcv_completed_at`; this facade builds
 * the nested `latest_completed_version` object AND the `thumbnail_url`
 * pointer (server-side `/api/versions/:id/thumbnail` route; mirrors the
 * dashboard's getThumbnailUrl shape at packages/dashboard/src/lib/api.ts:293-296).
 */
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
    latest_completed_version: {
      id: string;
      thumbnail_url: string;
      completed_at: number;
    } | null;
  }>;
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

**What's new:** First facade method that builds a relative URL (`thumbnail_url`) at the engine layer. Alternative discussed in RESEARCH line 397-398 is to leave URL construction to the dashboard via `getThumbnailUrl` — planner picks. Recommended (RESEARCH): keep it server-side so the response payload is self-contained.

**Landmines:**
- The `this.db` access requires that the engine constructor stores the drizzle handle (it does — used by `setShotStatus` at line 717 `insertStatusEvent(this.db, ...)`).
- DO NOT import any MCP type — the engine is MCP-pure per CLAUDE.md "Tool-engine separation".
- `ShotStatus` import is from `../types/hierarchy.js` (the canonical engine-side type). NOT from the dashboard mirror.
- The `getSequence` call here is the EXISTING `this.repo.getSequence` (HierarchyRepo) — NOT the engine's `getSequence` method (which wraps with breadcrumb). The raw repo call is fine because we only need `.name`.

---

### 11. `src/http/dashboard-routes.ts` (MODIFY — add GET /api/sequences/:id/shot-grid)

**Role:** route · **Data flow:** request-response · **Analog:** same file lines 267-301 (`/api/sequences/:id/shots`, `/api/shots/:id/versions`) + lines 217-228 (`parseCursorParam`)

**Existing pattern to mirror — cursor parse** (`dashboard-routes.ts:217-228`):
```typescript
function parseCursorParam(raw: string | undefined): VersionCursor | null {
  if (raw === undefined || raw === '') return null;
  const decoded = decodeVersionCursor(raw);
  if (decoded === null) {
    throw new TypedError(
      'INVALID_INPUT',
      `Malformed cursor — drop the ?cursor= param to start from page 1`,
      `Cursors are opaque base64url strings issued in the response's next_cursor field`,
    );
  }
  return decoded;
}
```

**Existing pattern to mirror — route handler** (`dashboard-routes.ts:280-301`):
```typescript
app.get('/api/shots/:id/versions', (c) => {
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  void qNum(c.req.query('offset'), 0, 'offset'); // back-compat parse
  const sort = parseVersionSortParam(c.req.query('sort'));
  const cursor = parseCursorParam(c.req.query('cursor'));
  // ...
  return c.json(
    engine.listVersionsForShot(c.req.param('id'), { sort, cursor, limit, ... }),
  );
});
```

**What to add** (place adjacent to existing `/api/sequences/:id/shots` at line 267):
```typescript
import {
  decodeShotGridCursor,
  type ShotGridCursor,
} from '../store/shot-status-repo.js';

// (place this alongside parseCursorParam at line 228)
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

// (place this route handler alongside /api/sequences/:id/shots at line 273)
app.get('/api/sequences/:id/shot-grid', (c) => {
  const sequenceId = c.req.param('id');
  const limit = qNum(c.req.query('limit'), 20, 'limit');
  const cursor = parseShotGridCursorParam(c.req.query('cursor'));
  return c.json(engine.listShotGrid(sequenceId, { cursor, limit }));
});
```

**What's new:** Second cursor parser in the file (parallel to `parseCursorParam`). One new route handler — no `?sort=` param (Phase 21 ships fixed sort), no `?statusFilter=`/`?showOmitted=` (REQ-03 LOCKED: client-side filter).

**Landmines:**
- `engine.listShotGrid` must be typed on the `EngineForDashboard` interface at the top of the file (see `src/http/dashboard-routes.ts:60-110` — the `EngineForDashboard` type alias). Add the new method signature there OR widen via `as any` for the initial wave; planner picks.
- `parseShotGridCursorParam` THROWS `TypedError('INVALID_INPUT', ...)` on malformed cursor — the `typedErrorHandler` (mounted at `src/http/error-middleware.ts`) translates to 400. DO NOT catch internally.
- `qNum(c.req.query('limit'), 20, 'limit')` — the default 20 matches CLAUDE.md "Paginate all list queries (default 20)".
- The route URL is `/api/sequences/:id/shot-grid` (hyphenated, not slash-separated). Matches D-13 endpoint spec.

---

### 12. `src/http/__tests__/dashboard-routes-shot-grid.test.ts` (NEW)

**Role:** test · **Data flow:** integration (Hono `app.request` + FakeEngine) · **Analog:** `src/http/__tests__/dashboard-routes.test.ts:186-219` (sequences/shots routes) + `:614-668` (qNum INVALID_INPUT)

**Existing pattern to mirror — test harness** (`dashboard-routes.test.ts:54-73`):
```typescript
function buildApp(engine: FakeEngine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}

describe('createDashboardRouter', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    engine.reset();
  });
```

**Existing pattern to mirror — route happy path** (`dashboard-routes.test.ts:186-196`):
```typescript
describe('GET /api/sequences/:id/shots', () => {
  it('lists shots for the sequence', async () => {
    const app = buildApp(engine);
    const res = await app.request('/api/sequences/seq_1/shots');
    expect(res.status).toBe(200);
    expect(engine.calls).toContainEqual({
      method: 'listShots',
      args: ['seq_1', 20, 0],
    });
  });
});
```

**Existing pattern to mirror — INVALID_INPUT 400** (`dashboard-routes.test.ts:633-639`):
```typescript
it('rejects ?limit=foo with HTTP 400 INVALID_INPUT', async () => {
  const app = buildApp(engine);
  const res = await app.request('/api/workspaces?limit=foo');
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe('INVALID_INPUT');
});
```

**Existing pattern to mirror — 404 propagation** (`dashboard-routes.test.ts:113-122`):
```typescript
it('propagates WORKSPACE_NOT_FOUND as 404', async () => {
  engine.getWorkspace = ((id: string) => {
    throw new TypedError('WORKSPACE_NOT_FOUND', `Workspace '${id}' not found`);
  }) as never;
  const app = buildApp(engine);
  const res = await app.request('/api/workspaces/ws_missing');
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe('WORKSPACE_NOT_FOUND');
});
```

**Tests to write** (per VALIDATION.md lines 56-60):
1. Happy path: `GET /api/sequences/seq_1/shot-grid` → 200 + `{ sequence, shots, next_cursor, total_count }` shape (assert `engine.calls` contains `{ method: 'listShotGrid', args: ['seq_1', { cursor: null, limit: 20 }] }`)
2. `?limit=5` → engine called with `{ limit: 5 }`
3. `?cursor=<base64>&limit=20` → engine called with decoded cursor object
4. Malformed `?cursor=DROP_TABLE` → 400 + `error.code === 'INVALID_INPUT'`
5. Unknown sequence → 404 + `error.code === 'SEQUENCE_NOT_FOUND'` (mock `engine.listShotGrid` to throw `TypedError('SEQUENCE_NOT_FOUND', ...)`)
6. `?limit=-1` → 400 INVALID_INPUT (qNum rejects)

**What's new:** New test file in `src/http/__tests__/`. Uses the SAME `FakeEngine` + `buildApp` harness as `dashboard-routes.test.ts`. Adds a `listShotGrid` method to FakeEngine (likely needs to extend the fake in `src/test-utils/fake-engine.ts` OR mock-override per-test like the WORKSPACE_NOT_FOUND test).

**Landmines:**
- `FakeEngine` may not have `listShotGrid` typed — use `engine.listShotGrid = (id, opts) => ({ ... }) as never;` per-test override (mirrors the `engine.getWorkspace = ((id) => { throw ... }) as never;` pattern at dashboard-routes.test.ts:114).
- `app.request('/api/sequences/seq_1/shot-grid?cursor=' + encodeURIComponent(badCursor))` — URL-encode the cursor value if testing special chars.
- Use `expect(engine.calls).toContainEqual(...)` for delegation assertions — matches the existing test file's idiom.

---

### 13. `packages/dashboard/src/state/shot-grid.ts` (NEW)

**Role:** state · **Data flow:** event-driven (SSE + signal mutations) · **Analog:** `packages/dashboard/src/state/active-generations.ts:1-75` (entire file) + `packages/dashboard/src/lib/sortHelpers.ts:209-296` (URL hydrate/persist pattern)

**Existing pattern to mirror — signal-bag** (`active-generations.ts:14-38`):
```typescript
import { signal } from '@preact/signals';
import type {
  VersionCreatedPayload,
  VersionStatusChangedPayload,
} from '../types/events.js';

export interface ActiveGeneration {
  versionId: string;
  shotId: string;
  label: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
}

export const activeGenerations = signal<ActiveGeneration[]>([]);
```

**Existing pattern to mirror — SSE handler** (`active-generations.ts:68-74`):
```typescript
export function onVersionStatusChanged(
  payload: VersionStatusChangedPayload,
): void {
  activeGenerations.value = activeGenerations.value.map((g) =>
    g.versionId === payload.versionId ? { ...g, status: payload.status } : g,
  );
}
```

**Existing pattern to mirror — URL hydrate** (`lib/sortHelpers.ts:209-296`):
See file 7's reference above for the full pattern. Key elements:
- `try { urlObj = new URL(window.location.href); } catch (err) { console.warn(...); return; }` — wrap the URL parse
- `Object.fromEntries(url.searchParams)` then Zod `safeParse`
- On `parsed.success === false`: `console.warn` + return (NEVER throw)
- `history.replaceState(null, '', url.toString())` for the persist side

**What to write** (assembled from the patterns above):
```typescript
// packages/dashboard/src/state/shot-grid.ts
//
// Phase 21 — Shot Grid View state bag. SSE-driven status updates +
// URL-mirrored filter/toggle/view state. Mirrors active-generations.ts
// signal-bag shape and sortHelpers.ts URL state pattern.
//
// Architecture-purity invariant (D-WEBUI-31): zero server-tree imports.

import { signal, computed } from '@preact/signals';
import { z } from 'zod';
import type { ShotStatusChangedPayload } from '../types/events.js';
import type { ShotGridResponse, ShotStatus } from '../types/shot-grid.js';

// ============================================================================
// Signals — per-view state
// ============================================================================

export const activeView = signal<'home' | 'shot-grid'>('home');
export const selectedSequenceForGrid = signal<string | null>(null);
export const shotGrid = signal<ShotGridResponse | null>(null);
export const statusFilter = signal<'all' | ShotStatus>('all');
export const showOmitted = signal<boolean>(false);
export const gridIsFetching = signal<boolean>(false);
export const gridLoadMoreError = signal<string | null>(null);

/** D-14 — client-derived aggregate counts. Re-computes on shotGrid changes. */
export const aggregateCounts = computed<Record<ShotStatus, number>>(() => {
  const init: Record<ShotStatus, number> = {
    'wip': 0,
    'pending-review': 0,
    'approved': 0,
    'on-hold': 0,
    'omit': 0,
  };
  const shots = shotGrid.value?.shots ?? [];
  return shots.reduce((acc, s) => {
    acc[s.status]++;
    return acc;
  }, init);
});

// ============================================================================
// SSE handler — onShotStatusChanged (D-22)
// ============================================================================

/**
 * SSE handler — locates the matching shot by shotId and mutates its status.
 * Unknown shotId is a no-op (mirrors onVersionStatusChanged at
 * active-generations.ts:68-74). Cross-sequence event is ignored.
 *
 * Pitfall 4 (stale closure): reads `shotGrid.value` INSIDE the body, never
 * closes over it. Module-level function — not inside a hook.
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

// ============================================================================
// URL state — hydrate + persist (D-09, mirrors lib/sortHelpers.ts:209-296)
// ============================================================================

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
    if (typeof console !== 'undefined') {
      console.warn('vfx-familiar: shot-grid URL params invalid; using defaults.', parsed.error);
    }
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
  } catch {
    /* silent — history unavailable or blocked */
  }
}
```

**What's new:** First state file to bundle signals + SSE handler + URL state hydration. Previous state files split these concerns (`active-generations.ts` is signals-only; `lib/sortHelpers.ts` is URL-only). Phase 21 co-locates because the surface is small.

**Landmines:**
- DO NOT subscribe to SSE inside the module top-level. The subscription belongs in `App.tsx` `useEffect` (per RESEARCH "Anti-Patterns to Avoid" line 817).
- DO NOT call `persistShotGridUrlState()` inside the module top-level. Callers (`ShotGridFilterBar`, `App.tsx` home button, etc.) call it after every signal mutation.
- The Zod schema enum order matters for error messages but NOT for parsing — keep alphabetical or by UI order for readability.
- `console.warn` is the only side effect on malformed URL — DO NOT throw, DO NOT show a toast. Mirrors Phase 18 D-16 graceful-fallback contract.
- The `aggregateCounts` `computed` re-runs whenever `shotGrid.value` changes — SSE-driven status updates flow for free through D-14. No manual recompute needed.

---

### 14. `packages/dashboard/src/state/__tests__/shot-grid.test.ts` (NEW)

**Role:** test · **Data flow:** unit (signals + handlers + URL) · **Analog:** NO direct in-tree state-file test analog — closest: `src/store/__tests__/shot-status-repo.test.ts` for behavior-style assertions; `RegenerateButton.test.tsx` for jsdom + vitest shape

**Tests to write** (per VALIDATION.md lines 63-67):
1. `onShotStatusChanged` mutates the matching shot in `shotGrid.value.shots` (immutable update)
2. Unknown shotId is a no-op (array passes through unchanged)
3. Cross-sequence event is ignored (payload.sequenceId !== shotGrid.value.sequence.id)
4. URL hydration: `?statusFilter=approved&showOmitted=1` on mount sets signals
5. URL hydration: malformed `?statusFilter=DROP_TABLE` falls back to defaults + `console.warn` (mock console.warn via `vi.spyOn`)
6. URL persist: signal change → `history.replaceState` called (mock via `vi.spyOn(history, 'replaceState')`)
7. URL persist: NOT `history.pushState` (assert call count zero on pushState mock)
8. `aggregateCounts` correctly counts (5 shots, 2 wip + 1 approved + 2 omit → `{ wip: 2, ... }`)

**Test scaffold:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  activeView,
  selectedSequenceForGrid,
  shotGrid,
  statusFilter,
  showOmitted,
  aggregateCounts,
  onShotStatusChanged,
  hydrateShotGridUrlState,
  persistShotGridUrlState,
} from '../shot-grid.js';

beforeEach(() => {
  // Reset signals to defaults before each test
  activeView.value = 'home';
  selectedSequenceForGrid.value = null;
  shotGrid.value = null;
  statusFilter.value = 'all';
  showOmitted.value = false;
});

describe('onShotStatusChanged', () => {
  it('mutates the matching shot in shotGrid.value.shots immutably', () => {
    shotGrid.value = {
      sequence: { id: 'seq_1', name: 'SEQ_010' },
      shots: [
        { id: 'shot_1', name: 'sh010', status: 'wip', version_count: 0, latest_completed_version: null },
        { id: 'shot_2', name: 'sh020', status: 'wip', version_count: 0, latest_completed_version: null },
      ],
      next_cursor: null,
      total_count: 2,
    };
    const before = shotGrid.value;
    onShotStatusChanged({
      shotId: 'shot_1',
      sequenceId: 'seq_1',
      fromStatus: 'wip',
      toStatus: 'approved',
      changedBy: 'user',
    });
    expect(shotGrid.value).not.toBe(before);  // immutable
    expect(shotGrid.value!.shots[0].status).toBe('approved');
    expect(shotGrid.value!.shots[1].status).toBe('wip');  // unchanged
  });
  // ... unknown shotId no-op, cross-sequence ignored ...
});

describe('hydrateShotGridUrlState', () => {
  beforeEach(() => {
    // Reset window.location.href via the jsdom URL API
    window.history.replaceState(null, '', '/');
  });
  it('parses ?statusFilter=approved&showOmitted=1', () => {
    window.history.replaceState(null, '', '/?statusFilter=approved&showOmitted=1');
    hydrateShotGridUrlState();
    expect(statusFilter.value).toBe('approved');
    expect(showOmitted.value).toBe(true);
  });
  it('malformed ?statusFilter=DROP_TABLE falls back to defaults + console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.history.replaceState(null, '', '/?statusFilter=DROP_TABLE');
    hydrateShotGridUrlState();
    expect(statusFilter.value).toBe('all');  // default
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

**What's new:** First test file under `packages/dashboard/src/state/__tests__/`. Creates the directory.

**Landmines:**
- Signals are module-singleton — leak between tests if not reset. The `beforeEach` block MUST reset every signal to its default. Otherwise test order affects outcomes.
- `window.history.replaceState(null, '', '/?...')` is the cleanest way to set the URL in jsdom (instead of `window.location.href = '...'` which doesn't work in jsdom).
- `vi.spyOn(console, 'warn').mockImplementation(() => {})` — silence the warning AND assert it was called. `.mockRestore()` in cleanup so other tests still see console.
- DO NOT mock `URL` or `history` at the module level — let jsdom provide them. Tests run with `environment: 'jsdom'` per vite.config.ts.

---

### 15. `packages/dashboard/src/components/ShotStatusPill.tsx` (NEW)

**Role:** component · **Data flow:** pure render (props → JSX) · **Analog:** `packages/dashboard/src/components/StatusPill.tsx:1-47` (entire file — exact shape)

**Existing pattern to mirror** (`StatusPill.tsx:14-47` — entire body):
```typescript
export type Status = 'queued' | 'running' | 'complete' | 'failed';

export interface StatusPillProps {
  status: Status;
}

const STATUS_STYLES: Record<Status, string> = {
  queued:
    'bg-[var(--color-fg-muted)] text-[var(--color-bg)]',
  running:
    'bg-[var(--color-status-running)] text-[var(--color-bg)] animate-status-pulse',
  complete:
    'bg-[var(--color-status-completed)] text-[var(--color-bg)]',
  failed:
    'bg-[var(--color-status-failed)] text-[var(--color-bg)]',
};

export function StatusPill({ status }: StatusPillProps) {
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal uppercase tracking-widest ${STATUS_STYLES[status]}`}
      data-status={status}
    >
      {status}
    </span>
  );
}
```

**What to write** (verbatim shape, 5 statuses instead of 4, no pulse animation):
```typescript
/**
 * ShotStatusPill — inline color-coded shot-status badge.
 *
 * Distinct from <StatusPill/> (which renders the 4 version statuses
 * queued/running/complete/failed). Phase 21 introduces 5 shot production
 * states: wip, pending-review, approved, on-hold, omit.
 *
 * Pure component: props-in, no callbacks (read-only display).
 *
 * WCAG 2.1 AA — color + text (never color alone). All 5 colors verified
 * against --color-bg (both light and dark themes) in 21-UI-SPEC.md §"Color".
 */

import type { ShotStatus } from '../types/shot-grid.js';

export interface ShotStatusPillProps {
  status: ShotStatus;
}

const SHOT_STATUS_STYLES: Record<ShotStatus, string> = {
  'wip':            'bg-[var(--color-shot-status-wip)] text-[var(--color-bg)]',
  'pending-review': 'bg-[var(--color-shot-status-pending-review)] text-[var(--color-bg)]',
  'approved':       'bg-[var(--color-shot-status-approved)] text-[var(--color-bg)]',
  'on-hold':        'bg-[var(--color-shot-status-on-hold)] text-[var(--color-bg)]',
  'omit':           'bg-[var(--color-shot-status-omit)] text-[var(--color-bg)]',
};

export function ShotStatusPill({ status }: ShotStatusPillProps) {
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

**What's new:** 5-status union vs StatusPill's 4. No `animate-status-pulse` (no in-progress state for shot statuses). 5 new CSS custom property references (added to theme.css by file 3).

**Landmines:**
- DO NOT add `animate-status-pulse` — shot statuses are NOT in-flight states.
- DO NOT extend `StatusPill` — UI-SPEC §"Component Inventory" notes: distinct components, NOT unified. The status enums DO NOT overlap.
- The class string is verbatim from `StatusPill.tsx:41` except for the bg-/text- token names. The `uppercase tracking-widest text-xs font-normal` triad is the design vocabulary.
- `data-status={status}` exposed for test selection (`getByTestId(...) ?? container.querySelector('[data-status="approved"]')`).

---

### 16. `packages/dashboard/src/components/__tests__/ShotStatusPill.test.tsx` (NEW)

**Role:** test · **Data flow:** component render · **Analog:** `RegenerateButton.test.tsx:38-91` (props-in render assertions)

**Tests to write:**
1. Render all 5 statuses → DOM contains `data-status="wip"`, `data-status="pending-review"`, etc.
2. Each pill has the correct bg-[var(--color-shot-status-*)] class
3. Text content matches the status literal (e.g., `"approved"`)
4. The wrapper has the uppercase + tracking-widest CSS classes

**Test scaffold:**
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/preact';
import { ShotStatusPill } from '../ShotStatusPill.js';

afterEach(() => cleanup());

describe('ShotStatusPill', () => {
  it.each([
    ['wip', 'bg-[var(--color-shot-status-wip)]'],
    ['pending-review', 'bg-[var(--color-shot-status-pending-review)]'],
    ['approved', 'bg-[var(--color-shot-status-approved)]'],
    ['on-hold', 'bg-[var(--color-shot-status-on-hold)]'],
    ['omit', 'bg-[var(--color-shot-status-omit)]'],
  ] as const)('renders %s pill with correct bg class', (status, bgClass) => {
    const { container } = render(<ShotStatusPill status={status} />);
    const pill = container.querySelector('[data-status="' + status + '"]') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.className).toContain(bgClass);
    expect(pill.textContent).toBe(status);
  });
});
```

**What's new:** First test file under `components/__tests__/` for Phase 21. Uses `it.each` for parametric coverage of all 5 statuses.

**Landmines:**
- Tailwind v4 generates `bg-[var(--color-shot-status-wip)]` as a literal CSS class — `pill.className` includes the bracketed token string verbatim.
- `container.querySelector('[data-status="..."]')` because `getByTestId` would require adding a `data-testid` attribute (not in the component spec).
- `cleanup()` in `afterEach` to release jsdom DOM between tests.

---

### 17. `packages/dashboard/src/components/ShotGridCard.tsx` (NEW)

**Role:** component · **Data flow:** pure render + click callback · **Analog:** `packages/dashboard/src/components/VersionCard.tsx:1-91` (entire file — single-button card with `<Thumbnail/>`)

**Existing pattern to mirror** (`VersionCard.tsx:57-91` — entire component):
```typescript
export function VersionCard({
  version,
  isSelected,
  onSelect,
  c2paStatus,
}: VersionCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(version.id)}
      aria-pressed={isSelected}
      class={`w-full overflow-hidden rounded text-left transition-colors ${
        isSelected
          ? 'ring-2 ring-[var(--color-accent)]'
          : 'hover:bg-[var(--color-surface)]'
      }`}
    >
      <Thumbnail
        version={{
          id: version.id,
          label: version.label,
          status: version.status,
        }}
        size="card"
        c2paStatus={c2paStatus}
      />
      <div class={`flex items-center justify-between gap-2 p-2 ${isSelected ? 'bg-[var(--color-accent)] text-[var(--color-bg)]' : 'text-[var(--color-fg)]'}`}>
        <span class="version-label truncate text-sm font-normal">
          {version.label}
        </span>
        <StatusPill status={version.status} />
      </div>
    </button>
  );
}
```

**Pattern adaptation for ShotGridCard:**
- Single `<button>` wrapper — entire card is clickable (D-16)
- Click → `onSelect(latest_completed_version.id)` opens VersionDrawer for the latest completed version (D-19)
- When `latest_completed_version === null`: `aria-disabled="true"`, no `onClick`, `<SkeletonThumbnail/>` instead of `<Thumbnail/>` (D-19)
- When `status === 'omit'` AND `showOmitted === true`: wrap in `opacity-40` div (D-17)
- Layout: 16:9 thumbnail + row with `<ShotStatusPill/>` + version count + shot name + `formatRelativeTime(completed_at)` muted line

**What to write:**
```typescript
/**
 * ShotGridCard — single shot tile for the shot-grid CSS Grid.
 *
 * Pure component: props-in, single onSelect callback. No fetch, no signal
 * reads. Composed from <Thumbnail/> (Phase 17) + <SkeletonThumbnail/> (Phase 17
 * fallback) + <ShotStatusPill/> (new) + formatRelativeTime (new).
 *
 * D-16: entire card is a single <button> with aria-label="Open version
 * drawer for {shotName}". Click target = whole 220×~140px card.
 * D-19: when latest_completed_version === null, render SkeletonThumbnail +
 * aria-disabled="true" + skip onClick wiring.
 * D-17 (omit dimming): when status === 'omit', wrap in opacity-40 div.
 *
 * SECURITY — T-5-06 / VersionCard precedent: shot.name + version count
 * + relative timestamp render as JSX text children (Preact auto-escapes).
 */
import type { ShotGridRow } from '../types/shot-grid.js';
import { ShotStatusPill } from './ShotStatusPill.js';
import { Thumbnail } from './Thumbnail.js';
import { SkeletonThumbnail } from './SkeletonThumbnail.js';
import { formatRelativeTime } from '../lib/time.js';
import {
  SHOT_CARD_OPEN_ARIA_PREFIX,
  SHOT_CARD_VERSION_COUNT_SINGULAR,
  SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX,
  SHOT_CARD_NO_VERSIONS,
  SHOT_CARD_LAST_UPDATED_PREFIX,
} from '../lib/copy.js';

export interface ShotGridCardProps {
  shot: ShotGridRow;
  onSelect: (versionId: string) => void;
}

function formatVersionCount(n: number): string {
  if (n === 0) return SHOT_CARD_NO_VERSIONS;
  if (n === 1) return SHOT_CARD_VERSION_COUNT_SINGULAR;
  return `${n}${SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX}`;
}

export function ShotGridCard({ shot, onSelect }: ShotGridCardProps) {
  const hasVersion = shot.latest_completed_version !== null;
  const disabled = !hasVersion;
  const isOmit = shot.status === 'omit';

  // D-19: skip onClick entirely when no latest version
  const handleClick = hasVersion
    ? () => onSelect(shot.latest_completed_version!.id)
    : undefined;

  const button = (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${SHOT_CARD_OPEN_ARIA_PREFIX}${shot.name}`}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      class={`w-full overflow-hidden rounded text-left transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
        disabled ? 'cursor-default' : 'hover:shadow-[0_0_0_1px_var(--color-border)]'
      }`}
    >
      {hasVersion ? (
        <Thumbnail
          version={{
            id: shot.latest_completed_version!.id,
            label: shot.name,
            status: 'complete',
          }}
          size="card"
        />
      ) : (
        <SkeletonThumbnail width={220} height={124} />
      )}
      <div class="flex flex-col gap-1 p-2 text-[var(--color-fg)]">
        <div class="flex items-center justify-between gap-2">
          <ShotStatusPill status={shot.status} />
          <span class="num text-xs text-[var(--color-fg-muted)]">
            {formatVersionCount(shot.version_count)}
          </span>
        </div>
        <span class="truncate text-sm font-normal">{shot.name}</span>
        {hasVersion && (
          <span class="num text-xs text-[var(--color-fg-muted)]">
            {SHOT_CARD_LAST_UPDATED_PREFIX}
            {formatRelativeTime(shot.latest_completed_version!.completed_at)}
          </span>
        )}
      </div>
    </button>
  );

  // D-17: omit shots get opacity-40 wrapper (pill stays 100% for WCAG AA)
  if (isOmit) {
    return <div class="opacity-40 transition-opacity">{button}</div>;
  }
  return button;
}
```

**What's new:**
- Single-button card pattern carried over from `VersionCard.tsx` verbatim
- New: 3 children (pill row + name + relative timestamp line) vs VersionCard's 2 (label + pill)
- New: D-19 disabled branch when `latest_completed_version === null`
- New: D-17 omit-opacity wrapper
- Reuses Phase 17 `Thumbnail.tsx` directly (with `status: 'complete'` hard-coded — the shot grid only renders cards for completed-version shots when hasVersion is true)

**Landmines:**
- DO NOT call `onSelect` in the disabled branch — D-19 LOCKED `aria-disabled="true"` and no pointer cursor.
- Use `disabled={disabled}` AND `aria-disabled={disabled || undefined}` — `disabled` (HTML) handles keyboard + click; `aria-disabled` is for assistive tech (subtle: empty string is falsy but `'true'` is what assistive tech expects; React/Preact requires the attribute to be `'true'` or absent).
- `key={shot.id}` is set by the PARENT (`ShotGridView` `.map()`) — Pitfall 5 LOCKED. Card itself doesn't need it.
- `Thumbnail` accepts `version: { id, label, status }` — pass `label: shot.name` (used for alt text) and `status: 'complete'` (the contract).
- `SHOT_CARD_OPEN_ARIA_PREFIX` is `'Open version drawer for '` — concatenate with `shot.name` (no quotes).
- `class="num"` on numeric surfaces (version count, timestamp) per UI-SPEC §"Typography" line 80.

---

### 18. `packages/dashboard/src/components/__tests__/ShotGridCard.test.tsx` (NEW)

**Role:** test · **Data flow:** component · **Analog:** `RegenerateButton.test.tsx` (props-in render + click)

**Tests to write** (per VALIDATION.md lines 69-73):
1. Renders `<Thumbnail/>` when `latest_completed_version !== null` (assert `<img>` in DOM)
2. Renders `<SkeletonThumbnail/>` when `latest_completed_version === null` (assert no `<img>`)
3. Click sets `selectedVersionId` — mock the `onSelect` callback and assert it's called with `latest_completed_version.id`
4. Click is disabled when no completed version: `aria-disabled="true"` + onClick NOT called
5. When `status === 'omit'`, the wrapper div has `opacity-40` class
6. Card receives stable DOM node across status mutation (Pitfall 5 — uses Preact's reconciliation; tests reference equality before/after via `container.querySelector('[aria-label*="..."]')`)

**Test scaffold:**
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { ShotGridCard } from '../ShotGridCard.js';
import type { ShotGridRow } from '../../types/shot-grid.js';

afterEach(() => cleanup());

const sampleShot: ShotGridRow = {
  id: 'shot_1',
  name: 'sh010',
  status: 'approved',
  version_count: 3,
  latest_completed_version: {
    id: 'ver_abc',
    thumbnail_url: '/api/versions/ver_abc/thumbnail',
    completed_at: Date.now() - 60_000,  // 1 min ago
  },
};

describe('ShotGridCard', () => {
  it('renders <Thumbnail/> when latest_completed_version !== null', () => {
    const { container } = render(<ShotGridCard shot={sampleShot} onSelect={() => {}} />);
    expect(container.querySelector('img')).toBeTruthy();
  });

  it('renders SkeletonThumbnail and disables click when no completed version', () => {
    const onSelect = vi.fn();
    const versionless: ShotGridRow = { ...sampleShot, latest_completed_version: null };
    const { container } = render(<ShotGridCard shot={versionless} onSelect={onSelect} />);
    expect(container.querySelector('img')).toBeFalsy();
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('click calls onSelect with latest_completed_version.id', () => {
    const onSelect = vi.fn();
    const { container } = render(<ShotGridCard shot={sampleShot} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('button')!);
    expect(onSelect).toHaveBeenCalledWith('ver_abc');
  });

  it('omit status wraps in opacity-40', () => {
    const omitShot: ShotGridRow = { ...sampleShot, status: 'omit' };
    const { container } = render(<ShotGridCard shot={omitShot} onSelect={() => {}} />);
    expect(container.querySelector('.opacity-40')).toBeTruthy();
  });
});
```

**Landmines:**
- `fireEvent.click(button)` triggers the synthetic event — `vi.fn()` records the call.
- For "stable DOM across status mutation" assertion, use Preact's reconciliation: render a parent with `key={shot.id}` `.map()`, mutate via signal, then `expect(buttonBefore).toBe(buttonAfter)` — but this is more naturally tested at the `ShotGridView` test level.

---

### 19. `packages/dashboard/src/components/ShotGridFilterBar.tsx` (NEW)

**Role:** component · **Data flow:** event-out (callbacks) · **Analog:** `packages/dashboard/src/components/StatusPill.tsx` (pill design vocabulary) + `packages/dashboard/src/components/LoadMoreButton.tsx:103-133` (button + sibling div pattern)

**Pattern composition:**
- Sticky-top container with `position: sticky; top: 0; z-index: 10` (UI-SPEC §"Responsive Behavior" CSS block)
- Pill row left-aligned: `All | wip | pending-review | approved | on-hold` (+ optional `omit` when `showOmitted === true`)
- Right-aligned `<button role="switch" aria-checked={showOmitted}>Show omitted</button>` toggle (via `margin-left: auto`)
- Each pill is a `<button>` with `aria-pressed={statusFilter === pill.value}`; active pill gets accent fill + bg-text inversion (D-11)

**What to write:**
```typescript
/**
 * ShotGridFilterBar — sticky top bar with status pills + Show omitted toggle.
 *
 * Pure component: props-in, callbacks-out. No fetch, no signal reads.
 * Parent (ShotGridView) passes statusFilter + showOmitted + callbacks.
 *
 * D-07: pill order = All | wip | pending-review | approved | on-hold [| omit]
 *       (omit appears only when showOmitted === true)
 * D-08: "All" resets filter to show every status in the current dataset
 * D-10: position: sticky; top: 0; z-index: 10 above grid cards
 * D-11: active pill = accent fill + bg text; inactive = outlined + muted text
 *
 * Architecture-purity: zero server-tree imports.
 */
import type { ShotStatus } from '../types/shot-grid.js';
import {
  FILTER_BAR_STATUS_LABEL,
  FILTER_PILL_ALL,
  FILTER_PILL_WIP,
  FILTER_PILL_PENDING_REVIEW,
  FILTER_PILL_APPROVED,
  FILTER_PILL_ON_HOLD,
  FILTER_PILL_OMIT,
  SHOW_OMITTED_TOGGLE_LABEL,
  SHOW_OMITTED_TOGGLE_ARIA,
} from '../lib/copy.js';

type FilterValue = 'all' | ShotStatus;

export interface ShotGridFilterBarProps {
  statusFilter: FilterValue;
  showOmitted: boolean;
  onChangeStatusFilter: (next: FilterValue) => void;
  onToggleShowOmitted: () => void;
}

interface PillSpec {
  value: FilterValue;
  label: string;
}

export function ShotGridFilterBar({
  statusFilter,
  showOmitted,
  onChangeStatusFilter,
  onToggleShowOmitted,
}: ShotGridFilterBarProps) {
  const pills: PillSpec[] = [
    { value: 'all', label: FILTER_PILL_ALL },
    { value: 'wip', label: FILTER_PILL_WIP },
    { value: 'pending-review', label: FILTER_PILL_PENDING_REVIEW },
    { value: 'approved', label: FILTER_PILL_APPROVED },
    { value: 'on-hold', label: FILTER_PILL_ON_HOLD },
  ];
  if (showOmitted) {
    pills.push({ value: 'omit', label: FILTER_PILL_OMIT });
  }

  return (
    <div
      class="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3"
      aria-label="Shot status filters"
    >
      <span class="label-uppercase text-[var(--color-fg-muted)]">
        {FILTER_BAR_STATUS_LABEL}
      </span>
      {pills.map((p) => {
        const active = statusFilter === p.value;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onChangeStatusFilter(p.value)}
            aria-pressed={active}
            class={`inline-flex items-center rounded-full px-3 py-1 text-xs uppercase tracking-widest transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              active
                ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
                : 'border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-fg)]'
            }`}
          >
            {p.label}
          </button>
        );
      })}
      <div class="ml-auto">
        <button
          type="button"
          role="switch"
          aria-checked={showOmitted}
          aria-label={SHOW_OMITTED_TOGGLE_ARIA}
          onClick={onToggleShowOmitted}
          class={`inline-flex items-center gap-2 rounded px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
            showOmitted ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)]'
          }`}
        >
          <span
            class={`inline-block h-3 w-6 rounded-full transition-colors ${
              showOmitted ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
            }`}
            aria-hidden="true"
          />
          {SHOW_OMITTED_TOGGLE_LABEL}
        </button>
      </div>
    </div>
  );
}
```

**What's new:** First sticky filter bar component. First use of `role="switch"` + `aria-checked` in the codebase. The pill array is dynamic (omit pill appears/disappears based on `showOmitted`).

**Landmines:**
- `key={p.value}` on the mapped pills — Preact reconciliation requires keys.
- DO NOT toggle the omit pill via click — its presence/absence is controlled by `showOmitted`, not by clicking the pill itself. D-07: when `showOmitted === false`, the omit pill is hidden from the bar. When `showOmitted === true`, the pill appears as the 6th option.
- Per RESEARCH Pitfall: "If toggling OFF reveals the omit pill is currently active, executor MUST reset `statusFilter = 'all'`". This logic lives in the PARENT (ShotGridView) or in `state/shot-grid.ts`, NOT in this component — keep the bar pure.
- The toggle is a `<button role="switch">` (custom) — NOT `<input type="checkbox">`. The custom thumb visual is the colored span.
- `label-uppercase` class is from `theme.css:124-132` (existing utility). DO NOT re-implement.
- `transition-colors` 150ms ease is the standard from UI-SPEC §"Animation & Motion" line 369.

---

### 20. `packages/dashboard/src/components/__tests__/ShotGridFilterBar.test.tsx` (NEW)

**Role:** test · **Analog:** `RegenerateButton.test.tsx`

**Tests to write** (per VALIDATION.md lines 74-77):
1. Filter pill click → `onChangeStatusFilter` called with the pill value
2. No fetch triggered on pill click (no fetch mock used here; tested at view level)
3. "All" pill click → callback receives `'all'`
4. `showOmitted=true` → omit pill rendered; `showOmitted=false` → omit pill absent
5. Show omitted toggle click → `onToggleShowOmitted` called
6. Active pill has `aria-pressed="true"`; inactive has `"false"`

**Test scaffold:**
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ShotGridFilterBar } from '../ShotGridFilterBar.js';

afterEach(() => cleanup());

describe('ShotGridFilterBar', () => {
  it('clicking pill calls onChangeStatusFilter with the value', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ShotGridFilterBar
        statusFilter="all"
        showOmitted={false}
        onChangeStatusFilter={onChange}
        onToggleShowOmitted={() => {}}
      />,
    );
    const wipPill = container.querySelector('button[aria-pressed]') as HTMLButtonElement;
    // (find by text content matches more reliable)
    const allPills = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
    const approvedPill = allPills.find((b) => b.textContent === 'approved')!;
    fireEvent.click(approvedPill);
    expect(onChange).toHaveBeenCalledWith('approved');
  });

  it('omit pill hidden when showOmitted=false', () => {
    const { container } = render(
      <ShotGridFilterBar
        statusFilter="all"
        showOmitted={false}
        onChangeStatusFilter={() => {}}
        onToggleShowOmitted={() => {}}
      />,
    );
    const omitPill = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'omit',
    );
    expect(omitPill).toBeUndefined();
  });
  // ... etc.
});
```

**Landmines:**
- `getByText('omit')` would conflict because `omit` appears in two places (pill and theme). Use `Array.from(...).find((b) => b.textContent === 'omit')`.
- The Show omitted toggle is `<button role="switch">` — find via `container.querySelector('[role="switch"]')`.

---

### 21. `packages/dashboard/src/components/SequenceHeader.tsx` (NEW)

**Role:** component · **Data flow:** pure render · **Analog:** NO direct collapsible-header analog — closest: `TreeSidebar.tsx:280-329` (TreeRow chevron toggle) + `StatusPill.tsx` (mini-pill vocabulary for aggregate counts)

**Pattern composition:**
- `<header>` with sequence name (20px/600 Inter Tight) + chevron button
- Row of color-coded mini-pills (one per non-zero status count from `aggregateCounts`)
- Chevron toggles `aria-expanded` (local state)
- Visual: chevron rotation 0° → 90° on expand (UI-SPEC §"Animation & Motion")

**Existing pattern to mirror — chevron toggle** (`TreeSidebar.tsx:311-321`):
```typescript
{hasChildren ? (
  <span
    class="flex-shrink-0"
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    aria-hidden="true"
  >
    <Icon size={14} />
  </span>
) : (
  <span class="w-3.5 flex-shrink-0" aria-hidden="true" />
)}
```

**What to write:**
```typescript
/**
 * SequenceHeader — collapsible header above the shot grid (D-15).
 *
 * Pure component: props-in, callbacks-out. Sequence name (20px/600 Inter
 * Tight) + chevron toggle + aggregate count mini-pills row.
 *
 * D-14: aggregate counts are color-coded mini-pills, one per non-zero
 *       status count. SSE-driven updates flow through aggregateCounts
 *       computed signal (read by the parent).
 * D-15: chevron rotates 0° → 90° on expand; aria-expanded reflects state.
 *       Open by default; session-only state (no localStorage persistence).
 *
 * Architecture-purity: zero server-tree imports.
 */
import { ChevronDown, ChevronRight } from 'lucide-preact';
import type { ShotStatus } from '../types/shot-grid.js';
import {
  SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_OPEN,
  SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_CLOSED,
  AGGREGATE_COUNTS_REGION_LABEL_PREFIX,
} from '../lib/copy.js';

export interface SequenceHeaderProps {
  sequenceName: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  counts: Record<ShotStatus, number>;
}

const STATUS_BG: Record<ShotStatus, string> = {
  'wip':            'bg-[var(--color-shot-status-wip)] text-[var(--color-bg)]',
  'pending-review': 'bg-[var(--color-shot-status-pending-review)] text-[var(--color-bg)]',
  'approved':       'bg-[var(--color-shot-status-approved)] text-[var(--color-bg)]',
  'on-hold':        'bg-[var(--color-shot-status-on-hold)] text-[var(--color-bg)]',
  'omit':           'bg-[var(--color-shot-status-omit)] text-[var(--color-bg)]',
};

const ORDER: ShotStatus[] = ['wip', 'pending-review', 'approved', 'on-hold', 'omit'];

export function SequenceHeader({
  sequenceName,
  expanded,
  onToggleExpanded,
  counts,
}: SequenceHeaderProps) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  const ariaPrefix = expanded
    ? SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_OPEN
    : SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_CLOSED;
  return (
    <header class="flex flex-col gap-2 px-4 py-6">
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={`${ariaPrefix}${sequenceName}`}
          class="flex items-center justify-center rounded p-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <Icon size={18} />
        </button>
        <h2
          class="text-xl font-semibold text-[var(--color-fg)]"
          style={{ fontFamily: 'var(--font-display)', lineHeight: 1.2 }}
        >
          {sequenceName}
        </h2>
      </div>
      <div
        role="group"
        aria-label={`${AGGREGATE_COUNTS_REGION_LABEL_PREFIX}${sequenceName}`}
        class="flex items-center gap-2"
      >
        {ORDER.map((status) => {
          const n = counts[status];
          if (n === 0) return null;
          return (
            <span
              key={status}
              class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs uppercase tracking-widest ${STATUS_BG[status]}`}
              data-status={status}
            >
              <span class="num">{n}</span>
              <span>{status}</span>
            </span>
          );
        })}
      </div>
    </header>
  );
}
```

**What's new:**
- First collapsible header in the codebase (TreeSidebar uses inline rows, not a separate header)
- First use of `<h2>` with `font-display` Inter Tight
- First aggregate-count visualization (mini-pills)
- Lucide `ChevronDown` / `ChevronRight` reuses existing TreeSidebar import (`TreeSidebar.tsx:40`)

**Landmines:**
- DO NOT subscribe to `aggregateCounts` signal here — parent reads it and passes the resolved value. Keeps component pure.
- DO NOT auto-collapse when counts are empty — D-15 explicit: open by default, manual toggle only.
- The chevron `size={18}` is one step UP from TreeSidebar's `size={14}` per UI-SPEC §"Spacing Scale" line 56 (sequence header is grid-level density, not sidebar).
- `aria-expanded` reflects state; `aria-label` includes the sequence name so screen readers say "Collapse SEQ_030_final_battle".
- Mini-pills use the SAME color tokens as `<ShotStatusPill/>` (D-14) — pattern reuse, not redefinition.

---

### 22. `packages/dashboard/src/components/__tests__/SequenceHeader.test.tsx` (NEW)

**Role:** test · **Analog:** `RegenerateButton.test.tsx`

**Tests to write** (per VALIDATION.md line 78):
1. Renders sequence name in `<h2>` with `font-display` family
2. Chevron toggle click → `onToggleExpanded` called
3. `expanded=true` → `ChevronDown` icon; `expanded=false` → `ChevronRight` icon
4. `aria-expanded` reflects expanded state
5. Mini-pills render one per non-zero count, in fixed ORDER (wip, pending-review, approved, on-hold, omit)
6. Mini-pill with count=0 is omitted from the row

**Landmines:**
- `font-display` is applied via inline `style={{ fontFamily: 'var(--font-display)' }}` — assert via `h2.style.fontFamily.includes('display')` or read computed style (jsdom limitations apply; pragmatic approach: assert via `getAttribute('style')`).
- `Array.from(container.querySelectorAll('[data-status]'))` to collect rendered mini-pills.

---

### 23. `packages/dashboard/src/components/TreeSidebar.tsx` (MODIFY — add grid-icon prop)

**Role:** component · **Data flow:** event-out (new callback) · **Analog:** same file lines 204-258 (SequenceNode, already-existing nesting)

**Existing pattern to mirror** (`TreeSidebar.tsx:204-258` — entire SequenceNode):
```typescript
function SequenceNode({
  sequence,
  selectedShotId,
  onSelectShot,
  expandedIds,
  onToggleExpand,
}: SequenceNodeProps) {
  const expanded = expandedIds.has(sequence.id);
  const hasChildren = !!sequence.shots?.length;
  return (
    <>
      <TreeRow
        label={sequence.name}
        depth={2}
        expanded={expanded}
        hasChildren={hasChildren}
        isSelected={false}
        onClick={() => onToggleExpand(sequence.id)}
        onToggle={() => onToggleExpand(sequence.id)}
      />
      {expanded && sequence.shots?.map((shot) => ( ... ))}
    </>
  );
}
```

**What to add:**
1. Two new props on `TreeSidebarProps`: `onOpenGrid?: (sequenceId: string) => void` and `currentGridSequenceId?: string`
2. Thread props through `WorkspaceNode` → `ProjectNode` → `SequenceNode`
3. In `SequenceNode`, add a `<button>` with `<LayoutGrid />` icon at the right edge of the row (use a `trailing` slot on `TreeRow`, OR render the button as a sibling — depends on TreeRow's structure)

The cleanest approach: add an optional `trailing?: VNode` prop to `TreeRow` (mirrors the existing `thumbnail?: VNode` prop at line 277). Render in SequenceNode:
```typescript
function SequenceNode({
  sequence,
  selectedShotId,
  onSelectShot,
  expandedIds,
  onToggleExpand,
  onOpenGrid,                  // NEW
  currentGridSequenceId,       // NEW
}: SequenceNodeProps) {
  const expanded = expandedIds.has(sequence.id);
  const hasChildren = !!sequence.shots?.length;
  const isCurrentGrid = currentGridSequenceId === sequence.id;
  return (
    <>
      <TreeRow
        label={sequence.name}
        depth={2}
        expanded={expanded}
        hasChildren={hasChildren}
        isSelected={false}
        onClick={() => onToggleExpand(sequence.id)}
        onToggle={() => onToggleExpand(sequence.id)}
        trailing={
          onOpenGrid ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenGrid(sequence.id);
              }}
              aria-label={
                `${TREE_GRID_ICON_ARIA_PREFIX}${sequence.name}` +
                (isCurrentGrid ? TREE_GRID_ICON_ACTIVE_ARIA_SUFFIX : '')
              }
              aria-current={isCurrentGrid ? 'page' : undefined}
              class={`flex h-6 w-6 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
                isCurrentGrid
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
              }`}
            >
              <LayoutGrid size={16} />
            </button>
          ) : undefined
        }
      />
      {expanded && sequence.shots?.map((shot) => ( ... ))}
    </>
  );
}
```

Update `TreeRow`:
```typescript
interface TreeRowProps {
  // ... existing props ...
  trailing?: VNode;  // NEW — Phase 21
}

function TreeRow({ ..., trailing }: TreeRowProps) {
  // ... existing layout ...
  return (
    <div ...>
      {/* existing chevron + thumbnail + label */}
      {trailing && <span class="ml-auto flex-shrink-0">{trailing}</span>}
    </div>
  );
}
```

**What's new:** Two new props on TreeSidebarProps; `trailing?: VNode` slot on TreeRow (parallel to the existing `thumbnail?` slot at line 277); `LayoutGrid` import from lucide-preact.

**Landmines:**
- `e.stopPropagation()` on the grid-icon button click — prevents the parent row click (which toggles expand) from firing. Mirrors line 315 of the existing chevron's `onClick={(e) => { e.stopPropagation(); onToggle(); }}`.
- `aria-current="page"` is the WCAG-blessed pattern for "this thing reflects the current view" (mirrors selected nav items). DO NOT use `aria-selected` here (that's for listbox semantics).
- The icon button is 24×24 (`h-6 w-6`) per UI-SPEC §"Spacing Scale" line 53. The Lucide icon inside is `size={16}` per line 55.
- DO NOT modify other depths (workspace, project, shot) — D-01 explicit: grid icon only on sequence rows.
- The `LayoutGrid` icon is already in the `lucide-preact` v1.9.0 package (UI-SPEC line 24 verified import).
- Existing component tests in `__tests__/` are absent — this is the first time TreeSidebar gets a test file (file 24).

---

### 24. `packages/dashboard/src/components/__tests__/TreeSidebar.test.tsx` (NEW or EXTEND)

**Role:** test · **Analog:** `RegenerateButton.test.tsx` (props-in component test)

**Tests to write** (per VALIDATION.md lines 79-80):
1. Grid icon click on a sequence row → `onOpenGrid(sequenceId)` called
2. Grid icon click does NOT fire `onToggleExpand` (stopPropagation works)
3. `currentGridSequenceId === sequence.id` → icon button has `aria-current="page"` + accent fill class
4. Grid icon NOT rendered on workspace / project / shot rows (depth!=2)
5. `onOpenGrid` undefined → grid icon NOT rendered (graceful absence)

---

### 25. `packages/dashboard/src/views/ShotGridView.tsx` (NEW)

**Role:** view · **Data flow:** request-response (fetch) + event-driven (signals) · **Analog:** `packages/dashboard/src/views/HomeView.tsx:165-285` (mount-time fetch + paginated buffer + LoadMoreButton wiring)

**Existing pattern to mirror — mount-time fetch** (`HomeView.tsx:170-194`):
```typescript
export function HomeView() {
  // Mount-time hydration: URL > localStorage > defaults reconciliation
  useEffect(() => {
    const { gridSort: initGrid, treeSort: initTree } = hydrateSortState();
    gridSort.value = initGrid;
    treeSort.value = initTree;
  }, []);

  // Hydrate workspaces list on mount.
  useEffect(() => {
    let alive = true;
    fetchWorkspaces()
      .then((raw) => {
        if (!alive) return;
        workspaces.value = unwrapList<Workspace>(raw);
      })
      .catch(() => {
        // no-op
      });
    return () => { alive = false; };
  }, []);
  // ...
}
```

**Existing pattern to mirror — LoadMoreButton wiring** (HomeView.tsx ~530):
```typescript
{gridCursor.value !== null && versions.value.length > 0 && (
  <LoadMoreButton
    remaining={Math.max(0, gridTotalCount.value - versions.value.length)}
    pageSize={20}
    isFetching={gridIsFetching.value}
    errorMessage={gridLoadMoreError.value}
    onClick={() => loadVersionsPage({ replace: false })}
  />
)}
```

**What to write** (top-level layout):
```typescript
/**
 * ShotGridView — top-level shot grid surface.
 *
 * Mount-time URL hydration + mount-time first fetch keyed on
 * selectedSequenceForGrid. SSE-driven status updates flow through the
 * shotGrid signal mutation in state/shot-grid.ts onShotStatusChanged
 * (subscription lives in App.tsx — see Pattern 4 in 21-RESEARCH.md).
 *
 * Layout: sticky <ShotGridFilterBar/> top + <SequenceHeader/> + CSS Grid
 * (minmax 220px, 1fr) of <ShotGridCard/> + <LoadMoreButton/> footer.
 *
 * D-19: card click opens VersionDrawer for latest_completed_version.id;
 *       does NOT mutate selectedShotId (D-04).
 * D-20: one sequence header (single-sequence scope).
 *
 * Architecture-purity: zero server-tree imports.
 */
import { useEffect, useState } from 'preact/hooks';
import { fetchShotGrid, DashboardApiError } from '../lib/api.js';
import { ShotGridFilterBar } from '../components/ShotGridFilterBar.js';
import { SequenceHeader } from '../components/SequenceHeader.js';
import { ShotGridCard } from '../components/ShotGridCard.js';
import { LoadMoreButton } from '../components/LoadMoreButton.js';
import { EmptyState } from '../components/EmptyState.js';
import {
  activeView,
  selectedSequenceForGrid,
  shotGrid,
  statusFilter,
  showOmitted,
  gridIsFetching,
  gridLoadMoreError,
  aggregateCounts,
  hydrateShotGridUrlState,
  persistShotGridUrlState,
} from '../state/shot-grid.js';
import { selectedVersionId } from '../state/versions.js';
import type { ShotStatus, ShotGridRow } from '../types/shot-grid.js';
import {
  SHOT_GRID_EMPTY_NO_SHOTS,
  SHOT_GRID_EMPTY_FILTER_PREFIX,
  SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX,
  SHOT_GRID_LOADING_LABEL,
  LOAD_MORE_ERROR_PREFIX_FAILED,
  LOAD_MORE_ERROR_PREFIX_NETWORK,
} from '../lib/copy.js';

function mapFetchErrorToCopy(err: unknown): string {
  if (err instanceof TypeError) return LOAD_MORE_ERROR_PREFIX_NETWORK;
  return LOAD_MORE_ERROR_PREFIX_FAILED;
}

export function ShotGridView() {
  const [headerExpanded, setHeaderExpanded] = useState(true);

  // Mount-time URL hydration (runs once)
  useEffect(() => {
    hydrateShotGridUrlState();
  }, []);

  // Fetch shot grid when selectedSequenceForGrid changes
  useEffect(() => {
    const seqId = selectedSequenceForGrid.value;
    if (!seqId) return;
    let alive = true;
    gridIsFetching.value = true;
    gridLoadMoreError.value = null;
    fetchShotGrid(seqId, { limit: 20 })
      .then((res) => {
        if (!alive) return;
        shotGrid.value = res;
        gridIsFetching.value = false;
      })
      .catch((err) => {
        if (!alive) return;
        gridLoadMoreError.value = mapFetchErrorToCopy(err);
        gridIsFetching.value = false;
      });
    return () => { alive = false; };
  }, [selectedSequenceForGrid.value]);

  // Client-side filter: status + omit gate (REQ-03 + D-08)
  const allShots: ShotGridRow[] = shotGrid.value?.shots ?? [];
  const filteredShots = allShots.filter((s) => {
    if (s.status === 'omit' && !showOmitted.value) return false;
    if (statusFilter.value === 'all') return true;
    return s.status === statusFilter.value;
  });

  const sequenceName = shotGrid.value?.sequence.name ?? '';

  return (
    <div class="flex h-full flex-col overflow-y-auto bg-[var(--color-bg)]">
      <ShotGridFilterBar
        statusFilter={statusFilter.value}
        showOmitted={showOmitted.value}
        onChangeStatusFilter={(next) => {
          statusFilter.value = next;
          persistShotGridUrlState();
        }}
        onToggleShowOmitted={() => {
          const next = !showOmitted.value;
          showOmitted.value = next;
          // If turning off and currently filtering by omit, reset to 'all'
          if (!next && statusFilter.value === 'omit') {
            statusFilter.value = 'all';
          }
          persistShotGridUrlState();
        }}
      />
      <SequenceHeader
        sequenceName={sequenceName}
        expanded={headerExpanded}
        onToggleExpanded={() => setHeaderExpanded(!headerExpanded)}
        counts={aggregateCounts.value}
      />
      {headerExpanded && (
        <>
          {filteredShots.length === 0 ? (
            <EmptyState
              message={
                allShots.length === 0
                  ? SHOT_GRID_EMPTY_NO_SHOTS
                  : statusFilter.value === 'all'
                  ? `${SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX}${sequenceName}.`
                  : `${SHOT_GRID_EMPTY_FILTER_PREFIX}${statusFilter.value}' in ${sequenceName}.`
              }
            />
          ) : (
            <div
              class="grid gap-4 p-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
            >
              {filteredShots.map((shot) => (
                <ShotGridCard
                  key={shot.id}
                  shot={shot}
                  onSelect={(versionId) => {
                    selectedVersionId.value = versionId;
                  }}
                />
              ))}
            </div>
          )}
          {/* LoadMoreButton when next_cursor !== null */}
          {shotGrid.value?.next_cursor && (
            <div class="flex justify-center py-6">
              <LoadMoreButton
                remaining={Math.max(0, (shotGrid.value.total_count ?? 0) - allShots.length)}
                pageSize={20}
                isFetching={gridIsFetching.value}
                errorMessage={gridLoadMoreError.value}
                onClick={() => {
                  /* loadMore logic appends to shotGrid.value.shots — see Wave 4 plan */
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

**What's new:**
- First view that owns BOTH the sticky filter bar AND the scrollable content (HomeView splits these across left/right panes).
- First view to use CSS Grid `minmax(220px, 1fr)` (REQ-04 lock).
- First view to mix `statusFilter` (signal) + `showOmitted` (signal gate) for client-side filtering.

**Landmines:**
- DO NOT subscribe to `onSseEvent('shot.status_changed', ...)` here — D-22 + RESEARCH "Anti-Patterns" line 817: the SSE handler MUST live in `App.tsx` lifecycle so updates flow even when on HomeView.
- DO NOT mutate `selectedShotId` from a card click — D-04 LOCKED: card opens VersionDrawer via `selectedVersionId`, NOT `selectedShotId`.
- The `useEffect` dependency `[selectedSequenceForGrid.value]` only triggers when the signal's VALUE changes — Preact's signals work with the standard dependency array.
- The CSS Grid template is inline-styled, NOT a Tailwind utility (Tailwind v4 has `grid-cols-[repeat(auto-fill,minmax(220px,1fr))]` arbitrary-value syntax but the inline style is cleaner for a one-off).
- `loadMore` click handler is a placeholder in the scaffold — full implementation (append to `shotGrid.value.shots`) is a Wave 4 task.
- `aggregateCounts.value` re-computes automatically when `shotGrid.value.shots` mutates (D-14 — SSE-driven updates flow for free).

---

### 26. `packages/dashboard/src/views/__tests__/ShotGridView.test.tsx` (NEW)

**Role:** test · **Analog:** `packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx`

**Tests to write** (per VALIDATION.md lines 81-82):
1. CSS Grid template applied: `style.gridTemplateColumns === 'repeat(auto-fill, minmax(220px, 1fr))'`
2. `showOmitted === false` → omit shots filtered out of rendered cards
3. `showOmitted === true` → omit shots rendered (with opacity-40 wrapper)
4. `statusFilter === 'approved'` → only approved shots in rendered cards
5. Card click → `selectedVersionId.value === latest_completed_version.id`
6. Empty state when zero filtered shots; correct copy variant per branch (no shots / no match / all-no-omitted)

**Landmines:**
- Mock `fetchShotGrid` via `vi.mock('../../lib/api', () => ({ fetchShotGrid: vi.fn().mockResolvedValue({ ... }) }))` — `vi.mock` hoists, so the import order matters.
- Reset signals between tests (same as state-test analog).

---

### 27. `packages/dashboard/src/App.tsx` (MODIFY — home button + activeView + SSE handler)

**Role:** root · **Data flow:** composition · **Analog:** same file lines 27-58 (entire current shape)

**Existing pattern to mirror — entire current shape** (`App.tsx:27-58`):
```typescript
export function App() {
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

  return (
    <div class="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <span
          class="text-sm font-semibold text-[var(--color-accent)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          VFX Familiar
        </span>
        <ThemeToggle />
      </header>
      <div class="flex flex-1 overflow-hidden">
        <div class="flex-1 overflow-hidden">
          <HomeView />
        </div>
        <ActiveGenerationsPanel />
      </div>
    </div>
  );
}
```

**Modifications** (per RESEARCH Pattern 3 line 514-567):
1. Add `Home` icon import from `lucide-preact`
2. Add imports from `state/shot-grid.js`: `activeView`, `onShotStatusChanged`
3. Add import `ShotGridView` from `./views/ShotGridView.js`
4. Add import `HEADER_HOME_ARIA_LABEL` from `./lib/copy.js`
5. Add `onSseEvent('shot.status_changed', onShotStatusChanged)` alongside existing handlers
6. Add `offSseEvent('shot.status_changed', onShotStatusChanged)` in cleanup
7. Add home button to header (before brand text)
8. Conditional render: `activeView.value === 'home' ? <HomeView /> : <ShotGridView />`

**Resulting App.tsx body** (modifications inlined):
```typescript
import { useEffect } from 'preact/hooks';
import { Home } from 'lucide-preact';
import { HomeView } from './views/HomeView.js';
import { ShotGridView } from './views/ShotGridView.js';
import { ActiveGenerationsPanel } from './views/ActiveGenerationsPanel.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { startSse, stopSse, onSseEvent, offSseEvent } from './lib/events.js';
import {
  onVersionCreated,
  onVersionStatusChanged,
} from './state/active-generations.js';
import { activeView, onShotStatusChanged } from './state/shot-grid.js';
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
            onClick={() => { activeView.value = 'home'; }}
            aria-label={HEADER_HOME_ARIA_LABEL}
            class={`flex h-7 w-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              activeView.value === 'home'
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
            }`}
          >
            <Home size={16} />
          </button>
          <span
            class="text-sm font-semibold text-[var(--color-accent)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
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

**What's new:** First conditional view-render in App.tsx (Phase 19 introduced overlay drawers via `selectedVersionId`, but those mounted on TOP of HomeView, not in place of it). First SSE handler for a status event from `shot-status-repo` (Phase 20 emitted; Phase 21 consumes).

**Landmines:**
- `onShotStatusChanged` MUST be the SAME function reference passed to `onSseEvent` and `offSseEvent` — reference equality required by `lib/events.ts:116` (`listeners.get(type)?.delete(fn)`). The module-singleton export from `state/shot-grid.ts` guarantees this.
- DO NOT move `startSse()` after the third `onSseEvent` call — order doesn't matter (listeners registered before `startSse()` still work; see `events.ts:73-78`), but the existing pattern (lines 31-33) calls `startSse` last for consistency.
- DO NOT auto-clear `selectedShotId` or `selectedSequenceForGrid` on view switch (D-04 + D-06: state persists across switches).
- The home button position (before brand) is locked by D-03; the gap-2 div wraps both.

---

### 28. `packages/dashboard/src/__tests__/App.test.tsx` (NEW)

**Role:** test · **Analog:** `packages/dashboard/src/views/__tests__/VersionDrawer.test.tsx` (signal-driven render)

**Tests to write** (per VALIDATION.md lines 83-85):
1. `activeView='shot-grid'` → `<ShotGridView/>` rendered (assert via `getByText` or query specific DOM)
2. `activeView='home'` → `<HomeView/>` rendered
3. Home button click → `activeView.value = 'home'`
4. `onSseEvent('shot.status_changed', ...)` called on mount (mock `lib/events`)
5. `offSseEvent('shot.status_changed', ...)` called on unmount

**Scaffold:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';

vi.mock('../lib/events.js', () => ({
  startSse: vi.fn(),
  stopSse: vi.fn(),
  onSseEvent: vi.fn(),
  offSseEvent: vi.fn(),
}));

import { App } from '../App.js';
import { activeView } from '../state/shot-grid.js';
import * as events from '../lib/events.js';

beforeEach(() => {
  activeView.value = 'home';
});

afterEach(() => cleanup());

describe('App view routing', () => {
  it('activeView="home" renders <HomeView/>', () => {
    activeView.value = 'home';
    const { container } = render(<App />);
    // HomeView's distinguishing feature: TreeSidebar nav
    expect(container.querySelector('nav[aria-label="Project hierarchy"]')).toBeTruthy();
  });
  // ... etc.
});

describe('App SSE registration', () => {
  it('subscribes to shot.status_changed on mount', () => {
    render(<App />);
    expect(events.onSseEvent).toHaveBeenCalledWith('shot.status_changed', expect.any(Function));
  });
  it('unsubscribes on unmount', () => {
    const { unmount } = render(<App />);
    unmount();
    expect(events.offSseEvent).toHaveBeenCalledWith('shot.status_changed', expect.any(Function));
  });
});
```

**Landmines:**
- `vi.mock('../lib/events.js', ...)` is hoisted by Vitest — the mock factory runs before any other import. Keep it at the top of the file.
- Reset signals in `beforeEach` so activeView changes don't leak across tests.

---

## Cross-Cutting Patterns

### Pattern A — Defensive Cursor Decode (NEVER throws)

**Source:** `src/store/sort.ts:169-196` (decodeVersionCursor) + `src/http/dashboard-routes.ts:217-228` (parseCursorParam at HTTP boundary)

**Apply to:** `src/store/shot-status-repo.ts` (new `decodeShotGridCursor`) AND `src/http/dashboard-routes.ts` (new `parseShotGridCursorParam`)

**Contract:**
- Repo-level decode: try/catch wraps `JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))`; returns `null` on any failure path (NEVER throws)
- HTTP-level parse: calls repo-level decode; on `null` result, THROWS `TypedError('INVALID_INPUT', ...)` — error-middleware translates to 400 (NEVER 500)

```typescript
// Repo layer — silent null
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

// HTTP layer — 400 INVALID_INPUT on null
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
```

### Pattern B — URL State Mirror (Phase 18 Precedent)

**Source:** `packages/dashboard/src/lib/sortHelpers.ts:209-296` (hydrateSortState + persist functions)

**Apply to:** `packages/dashboard/src/state/shot-grid.ts` (hydrateShotGridUrlState + persistShotGridUrlState)

**Contract:**
- Mount-time hydration: URL > signal > default precedence; runs ONCE via `useEffect` in the view component
- Persist on signal change: `history.replaceState` (NOT pushState) — view settings are not navigation events
- Zod whitelist for validation; malformed → fallback to default + `console.warn` (NEVER throws to caller)
- jsdom-safe: guard every `window` / `history` / `localStorage` access with a `typeof window !== 'undefined'` check

### Pattern C — SSE Handler Reference Equality

**Source:** `packages/dashboard/src/App.tsx:27-37` + `packages/dashboard/src/state/active-generations.ts:68-74` + `packages/dashboard/src/lib/events.ts:97-117`

**Apply to:** `App.tsx` (subscription wiring) + `state/shot-grid.ts` (handler definition)

**Contract:**
- Handler is a module-level exported function (`export function onShotStatusChanged(payload) { ... }`) — NOT an inline lambda
- The same function reference is passed to `onSseEvent` AND `offSseEvent` (reference equality required by `events.ts:116`)
- Handler reads signal `value` inside the body (not closed over) — defends against Pitfall 4 stale closure

### Pattern D — `<button>`-Card with Single Click Target

**Source:** `packages/dashboard/src/components/VersionCard.tsx:63-90`

**Apply to:** `ShotGridCard.tsx`

**Contract:**
- Entire card is one `<button type="button">`; no nested `<a>` or click handlers on internal elements
- `aria-label` covers the entire interaction; visible internal labels (status pill, name, timestamp) are decorative
- `aria-pressed` (selected) OR `aria-disabled` (no version) — never both
- Children are `<Thumbnail/>` (or `<SkeletonThumbnail/>`) + a single `<div>` with the layout row; Thumbnail itself has NO click handlers (D-11 from Phase 17)

### Pattern E — `qNum` for Numeric Query Params

**Source:** `src/http/dashboard-routes.ts:139-150`

**Apply to:** `src/http/dashboard-routes.ts` `/api/sequences/:id/shot-grid` route handler

**Contract:**
- `limit` parsed via `qNum(c.req.query('limit'), 20, 'limit')` — default 20, rejects negatives / floats / non-numeric with `TypedError('INVALID_INPUT', ...)`
- Default value matches CLAUDE.md "Paginate all list queries (default 20)"
- DO NOT reimplement — use the existing helper

### Pattern F — Append Section Comment in Existing Files

**Source:** `packages/dashboard/src/lib/copy.ts:21-103` (3 phases already coexist; each gets a banner comment)

**Apply to:** `lib/copy.ts`, `theme.css`, `App.tsx`, `TreeSidebar.tsx`, `state/shot-grid.ts`, `pipeline.ts`, `dashboard-routes.ts`, `shot-status-repo.ts`

**Contract:**
- Each modification block starts with `// ===== Phase 21 — {topic} =====` (or `/* */` for CSS)
- Existing code is NOT reformatted or moved — append only
- JSDoc on each new constant / function references the UI-SPEC or RESEARCH line that motivates it

### Pattern G — `it.each` for Parametric Status Coverage

**Source:** `packages/dashboard/src/components/__tests__/RegenerateButton.test.tsx` (interpolated state variants)

**Apply to:** `ShotStatusPill.test.tsx`, `SequenceHeader.test.tsx`, potentially `ShotGridFilterBar.test.tsx`

**Contract:**
- Use `it.each([['wip', '...'], ['pending-review', '...'], ...] as const)` for the 5 shot statuses
- Each parameterized case asserts BOTH the visible text AND the data-status attribute
- Reduces boilerplate and ensures all 5 statuses are exercised symmetrically

---

## Open Analog Questions

These are gray areas the planner should resolve before writing plans:

1. **VersionCard.tsx as ShotGridCard analog** — VersionCard exists (already read in research). Confirmed analog. **No question.**

2. **Where does the `loadMore` click handler live?** — The `LoadMoreButton.onClick` callback for the shot grid appends to `shotGrid.value.shots`. Options:
   - (a) Inline in `ShotGridView.tsx` (matches HomeView precedent at `HomeView.tsx:530-537`).
   - (b) Extract to a helper in `state/shot-grid.ts` (e.g., `loadMoreShotGrid()`).
   - **Recommend (a):** view-local closure access to the `seqId` + `cursor` is cleanest; matches HomeView.

3. **Should `ShotGridResponse.shots[].latest_completed_version.thumbnail_url` come from the server or the dashboard?** — RESEARCH line 397-398 leaves it open. Two paths:
   - (a) Server builds `/api/versions/${id}/thumbnail` in `Engine.listShotGrid` — payload is self-contained, dashboard consumes directly.
   - (b) Server returns only `lcv_id`; dashboard builds the URL via `getThumbnailUrl(id)` at render time (Phase 17 precedent).
   - **Recommend (a):** matches D-13 LOCKED payload shape exactly (which lists `thumbnail_url` as a field). The repo stays URL-blind; engine layer builds the URL.

4. **Should `TreeSidebar.tsx` get a test file in Phase 21, or piggyback on an existing future test?** — Currently zero in-tree tests for TreeSidebar. VALIDATION.md line 79-80 lists it as a NEW test file. **Recommend NEW** — Wave 3 task, mirrors Phase 21 surface-area coverage discipline.

5. **Are the `aggregateCounts` paginated-buffer counts accurate?** — RESEARCH Pitfall 8 raises this. Phase 21's typical case is < 50 shots / sequence (single page); aggregate counts derived from `shotGrid.value.shots` are correct for page 1. For > 50 shots (paginated), the counts reflect "loaded so far". **Recommend:** ship D-14 as-stated (client-derived), document in plan that counts are "loaded so far" for paginated sequences; defer total-aggregate to Phase 23 server stats widget.

6. **Does `EngineForDashboard` interface need updating?** — `src/http/dashboard-routes.ts:60-110` defines the type alias the route file uses. Adding `listShotGrid` to it requires a corresponding entry. **Recommend:** add the new method signature to the interface in the same task that adds the route handler (single commit).

---

## Metadata

- **Analog search scope:** `src/store/`, `src/http/`, `src/engine/`, `src/test-utils/`, `packages/dashboard/src/{components,views,state,lib,types,styles}/`, all `__tests__/` subdirs
- **Files scanned (read in full or by-section):** 18 (App.tsx, StatusPill.tsx, Thumbnail.tsx, TreeSidebar.tsx, EmptyState.tsx, LoadMoreButton.tsx, VersionCard.tsx, types/events.ts, state/active-generations.ts, state/versions.ts, lib/api.ts, lib/copy.ts, lib/sortHelpers.ts, lib/events.ts, shot-status-repo.ts, shot-status-repo.test.ts, version-repo-cursor.test.ts, dashboard-routes.ts + .test.ts) plus partial reads of HomeView.tsx, pipeline.ts, sse.ts, fixtures.ts, RegenerateButton.test.tsx
- **Pattern extraction date:** 2026-05-13
- **Coverage gaps:** `SequenceHeader.tsx` has no direct analog (first collapsible header); `state/shot-grid.ts` has no in-tree test analog at the state-file layer (closest cousin: `RegenerateButton.test.tsx`)

---

## PATTERN MAPPING COMPLETE
