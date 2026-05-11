# Architecture Patterns — v1.3 Production Shot Grid

**Domain:** Shot status workflow, visual shot grid, review/approval, production stats, UX polish (hover-to-scrub, SSE streaming AI summary, sort persistence, cross-version narrative)
**Researched:** 2026-05-11
**Confidence:** HIGH (codebase ground-truth read for every claim; integration points verified against actual source)

---

## Q1: Status Events Schema

**Recommendation: New `shot_status_history` table + denormalized `production_status` column on `shots`.**

The existing `provenance_events` table is version-scoped (FK: `version_id`). Shot production status is shot-scoped, not version-scoped — adding a nullable `shot_id` FK to `provenance_events` would poison join performance and break the semantic model. A new `shot_status_history` table preserves the append-only invariant cleanly without corrupting the existing provenance architecture.

```sql
-- Migration: drizzle/0007_shot_status_history.sql
CREATE TABLE IF NOT EXISTS shot_status_history (
  id          TEXT PRIMARY KEY,          -- nanoid prefix: "ssh_"
  shot_id     TEXT NOT NULL REFERENCES shots(id),
  status      TEXT NOT NULL CHECK(status IN (
                'waiting', 'ready', 'in_review', 'approved', 'rejected'
              )),
  changed_by  TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'mcp_agent' | 'pipeline'
  note        TEXT,                           -- optional free-text rationale
  created_at  INTEGER NOT NULL               -- Unix ms (same convention as provenance)
);

CREATE INDEX idx_shot_status_shot_time
  ON shot_status_history(shot_id, created_at DESC);
```

Denormalized column for O(1) grid reads (no subquery per shot row):

```sql
ALTER TABLE shots ADD COLUMN production_status TEXT NOT NULL DEFAULT 'waiting'
  CHECK(production_status IN ('waiting','ready','in_review','approved','rejected'));
```

Every INSERT into `shot_status_history` also UPDATEs `shots.production_status` within the same transaction. This is the only `UPDATE shots` allowed; the history table is truth, the column is a materialized cache.

**TypeScript types:**

```typescript
export type ProductionStatus =
  | 'waiting'
  | 'ready'
  | 'in_review'
  | 'approved'
  | 'rejected';

export interface ShotStatusHistoryRow {
  id: string;
  shot_id: string;
  status: ProductionStatus;
  changed_by: string;
  note: string | null;
  created_at: number;
}
```

**Repo pattern** (mirrors `src/store/provenance-repo.ts`):

```typescript
// src/store/shot-status-repo.ts
export function insertStatusEvent(
  db: BetterSqlite3.Database,
  shotId: string,
  status: ProductionStatus,
  changedBy: string,
  note?: string,
): void {
  const id = 'ssh_' + nanoid();
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO shot_status_history (id, shot_id, status, changed_by, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, shotId, status, changedBy, note ?? null, now);
    // Materialize current status on shot row for fast grid queries
    db.prepare(`UPDATE shots SET production_status = ? WHERE id = ?`)
      .run(status, shotId);
  })();
}

export function getStatusHistory(
  db: BetterSqlite3.Database,
  shotId: string,
  limit = 50,
): ShotStatusHistoryRow[] {
  return db.prepare(
    `SELECT * FROM shot_status_history
     WHERE shot_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(shotId, limit) as ShotStatusHistoryRow[];
}
```

---

## Q2: MCP Tool Surface

**Recommendation: Add 3 new action arms to the existing `shot` tool — do NOT create a new tool.**

5 tool slots remain (7 of 12 used). A dedicated `production` tool for status CRUD would consume a slot for minimal surface area. The `shot` tool is the natural owner of shot-level state — precedent: `version` tool handles get/list/diff/provenance/export_manifest/verify_manifest/redact_manifest (7 actions) under one tool name.

Current `shot` tool actions: `create | list | get`
New actions: `set_status | get_status | list_status_history`

**Zod discriminated union extension (`src/tools/shot-tool.ts`):**

```typescript
const StatusEnum = z.enum([
  'waiting',
  'ready',
  'in_review',
  'approved',
  'rejected',
]);

const SetStatusInput = z.object({
  action:     z.literal('set_status'),
  shot_id:    z.string().describe('Shot ID (sh_ prefix)'),
  status:     StatusEnum.describe('New production status'),
  changed_by: z.string().optional()
               .describe('Who/what is changing status. Defaults to "user"'),
  note:       z.string().max(500).optional()
               .describe('Optional reason for the status change'),
});

const GetStatusInput = z.object({
  action:  z.literal('get_status'),
  shot_id: z.string().describe('Shot ID (sh_ prefix)'),
});

const ListStatusHistoryInput = z.object({
  action:  z.literal('list_status_history'),
  shot_id: z.string().describe('Shot ID (sh_ prefix)'),
  limit:   z.number().int().min(1).max(100).optional().default(20),
});
```

**Response shapes:**

```typescript
// set_status — human-readable confirmation with previous state
{ shot_id, name, previous_status, new_status, event_id }

// get_status
{ shot_id, name, production_status, last_changed_at }

// list_status_history
{ shot_id, history: Array<{ id, status, changed_by, note, created_at }>, total }
```

---

## Q3: Shot Grid API Design

**Recommendation: New dedicated `/api/sequences/:id/shot-grid` endpoint with a denormalized payload.**

Extending `/api/sequences/:id/shots` would break the TreeSidebar's existing `fetchShots()` API contract. The shot grid needs a denormalized payload (shot + latest completed version + status + thumbnail URL + summary/C2PA flags) incompatible with the flat shot list.

**New endpoint:** `GET /api/sequences/:id/shot-grid`

**Query params:** `status` (comma-separated filter), `cursor` (opaque pagination), `limit` (default 30, max 100)

**Response interface:**

```typescript
interface ShotGridItem {
  shot_id:            string;
  shot_name:          string;
  created_at:         number;
  production_status:  ProductionStatus;
  latest_version: {
    version_id:    string;
    version_label: string;       // e.g. "v003"
    completed_at:  number;
    thumbnail_url: string | null; // /api/versions/:id/thumbnail or null
    has_summary:   boolean;
    has_c2pa:      boolean;
  } | null;
}

interface ShotGridResponse {
  sequence_id:  string;
  items:        ShotGridItem[];
  next_cursor:  string | null;
  total_count:  number;
}
```

**SQL (single query, no N+1):**

```sql
SELECT
  s.id            AS shot_id,
  s.name          AS shot_name,
  s.created_at,
  s.production_status,
  lv.id           AS version_id,
  lv.label        AS version_label,
  lv.created_at   AS version_created_at,
  (SELECT 1 FROM provenance p
   WHERE p.version_id = lv.id AND p.event_type = 'summary_generated' LIMIT 1) AS has_summary,
  (SELECT 1 FROM provenance p
   WHERE p.version_id = lv.id AND p.event_type = 'manifest_signed' LIMIT 1)   AS has_c2pa
FROM shots s
LEFT JOIN versions lv ON lv.id = (
  SELECT v.id FROM versions v
  JOIN provenance p ON p.version_id = v.id AND p.event_type = 'completed'
  WHERE v.shot_id = s.id
  ORDER BY p.timestamp DESC
  LIMIT 1
)
WHERE s.sequence_id = ?
  AND (? IS NULL OR s.production_status IN (/* parameterized list */))
  AND (? IS NULL OR s.id > ?)   -- cursor: nanoid IDs are lex-sortable
ORDER BY s.created_at ASC
LIMIT ?
```

`thumbnail_url` is constructed by the route handler as `/api/versions/${version_id}/thumbnail` when `version_id` is non-null — not stored in DB.

---

## Q4: Hover-to-Scrub Architecture

**Recommendation: Short preview WebM (≤5s, 480p), generated lazily on first hover request, served from the existing thumbnail cache infrastructure.**

The three options evaluated:
- **Sprite sheets**: High upfront CPU cost, 300-500 KB per shot, complex CSS coordinate scrubbing. Disproportionate.
- **On-demand frame thumbnails**: Per-frame HTTP requests on mousemove → request storm. Incompatible with existing architecture.
- **Preview WebM**: ffmpeg already spawns per video in `video-thumbnail.ts`. A second pass producing a 3-5s 480p WebM is a natural extension; the browser `<video>` element handles scrubbing natively.

**Why WebM fits existing infrastructure:**

`src/engine/thumbnails/cache.ts` (`cachePathFor`, `writeAtomic`, `computeETag`, `isCacheFresh`) is generic — operates on paths, not formats. A `video-preview.ts` engine module follows the exact same lazy-load + D-30 (100 MB skip, 10s SIGKILL) pattern as `video-thumbnail.ts`. The sole-importer rule (D-24: only `video-thumbnail.ts` imports `@ffmpeg-installer/ffmpeg`) is maintained by extracting ffmpeg binary resolution into a shared `ffmpeg-binary.ts` helper.

**ffmpeg parameters:**

```typescript
const PREVIEW_MAX_SECONDS = 5;
const PREVIEW_CRF = 28;        // VP9 quality — small file, acceptable quality
const PREVIEW_SCALE = 'scale=854:480:force_original_aspect_ratio=decrease';

// Args
['-ss', '0', '-t', String(PREVIEW_MAX_SECONDS),
 '-vf', PREVIEW_SCALE,
 '-c:v', 'libvpx-vp9', '-crf', String(PREVIEW_CRF), '-b:v', '0',
 '-an',           // no audio
 '-deadline', 'realtime',
 outputPath]
```

**Cache path:** `<outputRoot>/<versionId>/<filename>.preview.webm`

**Route:** `GET /api/versions/:id/preview` → 200 with `Content-Type: video/webm`, strong ETag. 202 + `Retry-After: 3` if generation is in-flight.

**Dashboard scrubbing:** `mouseenter` on a `ShotGridCard` sets `src` on a hidden `<video muted loop preload="metadata">`. `video.currentTime = (mouseX / cardWidth) * video.duration` on `mousemove`. `mouseleave` hides video, shows static thumbnail `<img>`.

---

## Q5: SSE Streaming for AI Summary

**Recommendation: No token streaming in v1.3. Add `summary.status_changed` event to the global SSE channel for badge refresh.**

The current summary path (`src/engine/summary/anthropic-client.ts`) uses `client.messages.create()` — synchronous, 180-token ceiling, ~1-2s latency at Haiku. Streaming adds architectural complexity (per-request SSE lifecycle, backpressure, reconnect) that is not justified at this token budget.

**What to add in v1.3:**

```typescript
// src/http/sse.ts — extend event type tuple
export const SSE_EVENT_TYPES = [
  'version.status_changed',
  'version.created',
  'tag.changed',
  'metadata.changed',
  'hierarchy.created',
  'summary.status_changed',   // new: lets shot grid refresh badge without polling
] as const;

interface SummaryStatusChangedPayload {
  versionId: string;
  shotId: string;
  status: 'generating' | 'completed' | 'failed';
}
```

If streaming is desired in a future phase (longer summaries, different models), the clean path is a per-request SSE route with a nonce token in the URL (`GET /api/versions/:id/summary/stream?token=<nonce>`) to prevent cross-client pollution.

---

## Q6: Dashboard Routing for Shot Grid

**Recommendation: Signal-driven view switch (`activeView` signal) — no router, no tab in HomeView.**

The dashboard has no client-side router. Adding one for a single new view is disproportionate. HomeView's two-pane layout is the wrong container for a full-width shot grid (4-6 cards per row). The `VersionDrawer` overlay pattern (signal-driven mount/unmount) is the established precedent.

**New signals in `packages/dashboard/src/lib/state.ts`:**

```typescript
export const activeView = signal<'home' | 'shot-grid'>('home');
export const shotGridSequenceId = signal<string | null>(null);
```

**`App.tsx`:**

```typescript
function App() {
  return (
    <>
      {activeView.value === 'home'
        ? <HomeView />
        : <ShotGridView sequenceId={shotGridSequenceId.value!} />
      }
      <ActiveGenerationsPanel />
    </>
  );
}
```

**Navigation trigger:** In `TreeSidebar`, each sequence row gets a grid icon button. Clicking it sets `shotGridSequenceId.value = sequenceId; activeView.value = 'shot-grid'`. A back-chevron in `ShotGridView`'s header resets to `'home'`.

**Shot grid signals (isolated from HomeView signals):**

```typescript
export const shotGridItems        = signal<ShotGridItem[]>([]);
export const shotGridCursor       = signal<string | null>(null);
export const shotGridTotal        = signal<number>(0);
export const shotGridFetching     = signal<boolean>(false);
export const shotGridStatusFilter = signal<ProductionStatus[]>([]);
export const shotGridError        = signal<string | null>(null);
```

---

## Summary Table

| Question | Decision | Rationale |
|---|---|---|
| Status events schema | New `shot_status_history` table + denorm `production_status` col | provenance is version-scoped; shot status is shot-scoped; N+1 prevention via denorm |
| MCP tool surface | Extend `shot` tool with 3 new arms | 5 slots remain; `production` tool would waste budget; shot owns its status |
| Shot grid API | New `/api/sequences/:id/shot-grid` endpoint | Denormalized payload incompatible with existing endpoint; sidebar contract preserved |
| Hover-to-scrub | Preview WebM, lazy on first request | Fits existing thumbnail cache; browser handles scrubbing natively; no request storms |
| SSE streaming | No token streaming; add `summary.status_changed` to global SSE | 180-token / ~1s budget; global broadcast for badge refresh is sufficient |
| Dashboard routing | Signal-driven view switch (`activeView` signal) | No router exists; VersionDrawer pattern precedent; HomeView layout wrong container |
