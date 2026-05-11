# Stack Research — v1.3 Production Shot Grid

**Domain:** VFX production management additions to existing TypeScript ESM Node MCP server + Preact dashboard
**Date:** 2026-05-11
**Confidence:** HIGH (codebase verified + ecosystem research confirmed)

---

## Q1: Status Workflow State Machines

**Industry pattern:** All major VFX tools (ShotGrid/Flow Production Tracking, ftrack, Kitsu) use a **mutable current-state field** on the entity combined with a **separate append-only event log** for audit. They do not use append-only state alone — the current status is always readable without scanning the log.

ShotGrid stores `status_list` as a short code string on each entity (e.g., `Shot.sg_status_list = 'ip' | 'apr' | 'hld'`). Separately, every status change writes an `EventLogEntry` row. Transitions are **unconstrained by default** — the UI enforces workflow conventions, not the database.

Kitsu (CGWire/Zou) goes further: status changes are created as **comment posts** with an attached task status. The default task statuses are `WIP`, `WFA` (Waiting For Approval), `Done`, `Ready To Start`. Transitions are free-form (no validated DAG).

**Recommended state set for v1.3:**

| Status | Short Code | Meaning |
|--------|-----------|---------|
| `wip` | wip | Active work in progress |
| `pending-review` | pen | Awaiting supervisor review |
| `approved` | apr | Signed off |
| `on-hold` | hld | Blocked / deprioritized |
| `omit` | omt | Cut from sequence, archived in place |

Transitions: **free DAG** (any → any). Do not implement linear guards — VFX supervisors need to reopen approved shots and override holds without workarounds.

**Schema additions required:**

```sql
-- Mutable current state (fast reads, grid filtering)
ALTER TABLE shots ADD COLUMN status TEXT NOT NULL DEFAULT 'wip'
  CHECK(status IN ('wip','pending-review','approved','on-hold','omit'));

-- Append-only audit trail (provenance pattern, never UPDATE/DELETE)
CREATE TABLE shot_status_events (
  id          TEXT PRIMARY KEY,
  shot_id     TEXT NOT NULL REFERENCES shots(id),
  from_status TEXT,           -- NULL on first explicit set
  to_status   TEXT NOT NULL,
  changed_by  TEXT,           -- 'agent' | 'user' | tool name
  note        TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
```

The hybrid mirrors ShotGrid's architecture exactly: fast current-state field for queries, immutable log for audit. This is consistent with the existing `provenance` table's append-only invariant.

---

## Q2: Real-Time Updates (SSE vs WebSockets)

**Industry pattern:** SSE is the established choice for server→client-only status push. Anthropic, OpenAI, and Vercel AI all use SSE as their streaming transport. WebSockets are warranted only when you need bidirectional framing (chat with acks, presence, multi-peer) — none of which apply here.

**Existing infrastructure is the exact right model.** `src/http/sse.ts` already:
- Uses `streamSSE` from `hono/streaming`
- Tracks 5 event types via `stream.writeSSE({ data: JSON.stringify(payload), event: type })`
- Sends keep-alive pings via `stream.write(': ping\n\n')` every 30s
- Cleans up via `c.req.raw.signal` AbortSignal

**What v1.3 needs to add:**

In `src/types/events.ts`, add:
```typescript
'shot.status_changed': {
  shotId: string;
  fromStatus: ShotStatus | null;
  toStatus: ShotStatus;
  changedBy: string;
  note?: string;
}
```

In the shot update engine method, after writing the `shot_status_events` row, emit through the existing engine event emitter — the SSE handler picks it up automatically.

In the dashboard, the existing `useEffect` SSE listener in `HomeView` needs a case for `shot.status_changed` that updates the shot's status in the local `shots` signal without a full re-fetch.

No new transport infrastructure. Extend what exists.

---

## Q3: Thumbnail Hover-to-Scrub

**Industry pattern:** Sprite sheets are the universal industry technique. JW Player, Video.js, Vimeo, and all VFX review tools (ShotGrid Media Center, ftrack Review) use a single image containing a grid of frames. The player or grid cell uses CSS `background-position` to show the correct frame as the cursor moves.

**Feasibility with existing infrastructure:** HIGH. The codebase already has:
- `src/engine/thumbnails/video-thumbnail.ts` — sole ffmpeg consumer (D-24 invariant)
- `src/engine/thumbnails/image-thumbnail.ts` — sole sharp consumer (D-23 invariant)

**Sprite sheet generation approach:**

Step 1 — Extract frames with ffmpeg (add to `video-thumbnail.ts`):
```typescript
// Extract 1 frame every N seconds into a temp dir
// ffmpeg -i input.mp4 -vf "fps=1/2,scale=160:-1" /tmp/frames/frame_%04d.png
```

Step 2 — Composite with sharp (add to `image-thumbnail.ts`):
```typescript
const composited = sharp({
  create: { width: frameWidth * columns, height: frameHeight * rows, channels: 3, background: '#000' }
});
const overlays = frames.map((f, i) => ({
  input: f,
  left: (i % columns) * frameWidth,
  top: Math.floor(i / columns) * frameHeight
}));
await composited.composite(overlays).webp({ quality: 70 }).toFile(spritePath);
```

Step 3 — Serve metadata alongside sprite URL:
```typescript
interface SpriteSheetMeta {
  spriteUrl: string;       // /api/thumbnails/:versionId/sprite.webp
  frameWidth: number;      // 160
  frameHeight: number;     // 90
  columns: number;
  rows: number;
  intervalSeconds: number; // 2
  totalFrames: number;
}
```

Step 4 — Dashboard CSS scrub logic in `Thumbnail.tsx`:
```typescript
const frameIndex = Math.floor(hoverTime / meta.intervalSeconds);
const col = frameIndex % meta.columns;
const row = Math.floor(frameIndex / meta.columns);
el.style.backgroundImage = `url(${meta.spriteUrl})`;
el.style.backgroundPosition = `-${col * meta.frameWidth}px -${row * meta.frameHeight}px`;
el.style.backgroundSize = `${meta.frameWidth * meta.columns}px auto`;
```

**Recommendation:** Generate sprite sheets lazily on first hover request, cache to disk alongside the frame thumbnail. For video sources only — image versions get no sprite (single frame already).

**D-24/D-23 invariant preservation:** The new `generateSpriteSheet()` function lives in `video-thumbnail.ts` (ffmpeg) and calls into `image-thumbnail.ts` (sharp composite) via an internal engine import — same module boundaries, no new importers.

---

## Q4: Streaming LLM Responses (Anthropic SDK)

**SDK version:** `@anthropic-ai/sdk: 0.95.1` is already in `package.json`.

**Two streaming patterns in the SDK:**

Pattern A — MessageStream (higher level, recommended for SSE pipe):
```typescript
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const stream = await anthropic.messages.stream({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: prompt }]
});

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    const textDelta = event.delta.text;
    // pipe to Hono SSE
  }
}
const finalMessage = await stream.getFinalMessage();
```

Pattern B — Raw async iterable (lower level):
```typescript
const stream = await anthropic.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [...],
  stream: true
});
for await (const chunk of stream) { /* same event shapes */ }
```

**Pipe through Hono SSE** — the existing `streamSSE` pattern handles this cleanly:
```typescript
app.get('/api/versions/:id/summary/stream', async (c) => {
  return streamSSE(c, async (sseStream) => {
    const anthropicStream = await anthropic.messages.stream({ ... });

    // Abort Anthropic stream if client disconnects
    c.req.raw.signal.addEventListener('abort', () => {
      anthropicStream.controller.abort();
    }, { once: true });

    for await (const event of anthropicStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        void sseStream.writeSSE({
          data: event.delta.text,
          event: 'summary.delta'
        }).catch(() => {});
      }
    }
    void sseStream.writeSSE({ data: '', event: 'summary.done' }).catch(() => {});
  });
});
```

**Preact consumer pattern** (new `useSummaryStream` hook):
```typescript
const es = new EventSource(`/api/versions/${versionId}/summary/stream`);
es.addEventListener('summary.delta', (e) => {
  summaryText.value += e.data;
});
es.addEventListener('summary.done', () => {
  es.close();
  isSummaryStreaming.value = false;
});
es.onerror = () => {
  summaryError.value = 'Stream interrupted — retry';
  es.close();
};
```

**Permanent fallback (per project memory):** `ANTHROPIC_API_KEY` is not available on Claude Max plan. The summary endpoint must detect missing key at startup and return a static fallback message rather than 500-erroring. The existing Phase 19 pattern (ships in permanent fallback mode) is the established precedent for this project.

---

## Q5: Status Badge UI Patterns

**WCAG requirements (2.1 AA):**
- 1.4.1: Color alone must not convey information — always pair color with text or icon
- 1.4.3: Text contrast ratio ≥ 4.5:1 (normal text), 3:1 (large text / bold ≥ 14pt)
- 1.4.11: UI component contrast ≥ 3:1 against adjacent color

**Industry color conventions (ShotGrid, ftrack, Kitsu):**

| Production Status | Hue | Tailwind Classes |
|-------------------|-----|-----------------|
| wip | Gray | `bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300` |
| pending-review | Amber | `bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200` |
| approved | Green | `bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200` |
| on-hold | Orange | `bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200` |
| omit | Red | `bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200` |

**Existing `StatusPill.tsx` pattern already satisfies WCAG** — it renders uppercase text alongside the color swatch and exposes `data-status` for testing. The new production states slot into the same component.

**Inline edit pattern:** ShotGrid and ftrack both use a click-to-cycle or click-to-dropdown on the status badge in the grid row (no modal). Recommended: click on `ShotStatusPill` opens a floating `<select>` or listbox anchored to the pill, dismisses on blur/Escape, optimistically updates the signal then confirms via PATCH.

---

## Q6: SQLite Scale Considerations

**At v1.3 target scale:** 10K shots × 5 versions average = 50K version rows, 10K shot rows. With proper indexes this is trivially fast — SQLite handles millions of rows for this query shape.

**Indexes needed for v1.3:**

```sql
-- Grid filtering: sequence → status (most common query pattern)
CREATE INDEX idx_shots_status
  ON shots(sequence_id, status);

-- If you add "all shots across project" grid view:
CREATE INDEX idx_shots_project_status
  ON shots(project_id, status, created_at DESC);

-- Shot status event history (timeline panel)
CREATE INDEX idx_shot_status_events_shot_time
  ON shot_status_events(shot_id, created_at DESC);

-- Cursor pagination on shots grid (existing cursor pattern in versions)
CREATE INDEX idx_shots_cursor
  ON shots(sequence_id, created_at DESC, id);
```

**Covering index opportunity** — if the grid renders `(id, name, status, created_at)` per row:
```sql
CREATE INDEX idx_shots_grid_cover
  ON shots(sequence_id, status, created_at DESC)
  INCLUDE (id, name);  -- SQLite 3.38+ supports INCLUDE
```

Note: `better-sqlite3` ships with SQLite 3.45+ via its bundled build — INCLUDE syntax is available.

**ANALYZE discipline:** Run `PRAGMA optimize;` after bulk imports. SQLite's query planner uses stale statistics without it — this matters when status distribution is skewed (e.g., 90% approved).

---

## Summary for Roadmap

The v1.3 milestone adds **zero new infrastructure**. Every technical requirement maps to extending existing patterns:

| Requirement | Extends |
|-------------|---------|
| Shot status column | Drizzle schema migration (ALTER TABLE) |
| Status audit log | `shot_status_events` table, same pattern as `provenance` |
| SSE status push | Add `shot.status_changed` to existing `src/http/sse.ts` |
| Status badge UI | Extend `StatusPill.tsx` with 5 new status variants |
| LLM summary stream | `anthropic.messages.stream()` piped through `streamSSE` |
| Sprite sheet scrub | New function in `video-thumbnail.ts` / `image-thumbnail.ts` |
| Grid indexes | 4 new `CREATE INDEX` statements in migration |

**Highest-risk item:** Sprite sheet generation — ffmpeg tile extraction + sharp composite is straightforward but adds I/O and latency to the thumbnail pipeline. Recommend generating lazily on first hover, not at version-creation time, with a `sprite_generated_at` nullable column on versions as the cache sentinel.

**Lowest-risk item:** SSE `shot.status_changed` event — the existing handler is a 5-line `case` addition with no new routes or transports.
