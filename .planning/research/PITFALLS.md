# Pitfalls Research — v1.3 Production Shot Grid

**Domain:** VFX production management — shot status workflow, shot grid view, review/approval, production overview, UX polish bundle

**Date:** 2026-05-11

---

## PITFALLS ANALYSIS: VFX Familiar v1.3 — Production Shot Grid

### Q1: Status Workflow Complexity Traps

**Failure mode — dual-model collision.** The most dangerous trap for v1.3 is that VFX Familiar already has two status models living side by side: the mutable `versions.status` column (TEXT, one of `submitted | running | completed | failed`, guarded by `WHERE completed_at IS NULL`) and the append-only `provenance` events table. If v1.3 adds shot-level status (`pending | in_progress | approved | rejected`) by adding a `status` column to the `shots` table, there will be three different status semantics in the codebase — mutable terminal-guarded versions, mutable unguarded shots, and append-only events. That inconsistency produces category errors: engineers reasoning about shot status may apply the wrong mental model and omit the `completed_at IS NULL` guard pattern, leaving shot status open to concurrent-overwrite races.

**Failure mode — invalid transition explosion.** A four-state shot status (`pending → in_progress → approved | rejected`) has 12 possible ordered pairs, of which maybe 4 are valid. Without an explicit transition table enforced at the repository boundary, the engine becomes the only place transitions are checked — and engine-layer checks drift as features are added. The `versions.status` model dodges this by having only one non-terminal transition (`submitted → running` via `VersionRepo.transition`) and two terminal sinks (`markFailed`, `markCompleted`); the DAG is trivially simple. Shot status is not.

**Failure mode — stale dashboard view.** The SSE `toDashboardPayload` adapter (the single serialization path enforced by the CR-01 architecture-purity grep) currently translates `version.status` to a `status` enum for the frontend. If shot-level status is added and the adapter is extended ad hoc, stale in-flight SSE frames will reflect the old status while the SQLite row has advanced. Because SSE is push-from-server with no client invalidation handshake, a client that reconnects mid-transition may display a ghost state until the next event is emitted.

**Mitigation.** Use the industry-standard hybrid: a mutable `shots.status` column for fast reads/filtering, plus an append-only `shot_status_events` table for audit trail (separate from `provenance_events` which is version-scoped). This is the ShotGrid/ftrack/Kitsu architecture exactly. The `shots.status` column uses a free DAG (no transition guards) because VFX supervisors need to reopen approved shots without workarounds. The `shot_status_events` table uses `insertEvent`-style append-only discipline enforced by grep tests.

**Prior art.** `src/store/provenance-repo.ts` — the `MANIFEST_SIGNED_LOOKUP_LIMIT = 50` and `SUMMARY_GENERATED_LOOKUP_LIMIT = 50` exports demonstrate the cap-and-export pattern. `src/store/version-repo.ts` lines 133–143 — `WHERE completed_at IS NULL` guard demonstrates terminal-immutability.

---

### Q2: Shot Grid Performance Cliffs in SQLite

**Failure mode — N+1 on status derivation.** A naive shot grid implementation will issue one status query per shot row. A 200-shot grid on a project produces 201 queries. With the hybrid model (mutable `shots.status` column), this is solved — the grid query reads the status column directly with no subqueries.

**Failure mode — per-row subquery in ORDER BY.** Adding a `latest_status` derived column via a correlated subquery in the `listShots` SELECT is a common "clever" move. In SQLite this is actually fast for small tables, but it breaks the Drizzle ORM query builder: Drizzle does not support correlated subqueries in SELECT position in its fluent API. Using `sql\`...\`` raw fragments to inject the subquery bypasses the parameterized-query discipline that `hierarchy-repo.ts` comments enforce (line 37: "All inserts/selects use Drizzle parameterized queries").

**Failure mode — missing index on `shots.sequence_id` for cross-project grid queries.** The shot grid will likely want "all shots for a project" (crossing the sequence boundary), which requires a JOIN: `shots → sequences → projects`. The `listShots` method in `hierarchy-repo.ts` only filters by `sequence_id`. A cross-sequence shot query has no index support beyond the primary key. On a project with 20 sequences × 50 shots, a full scan of the shots table is 1000 rows — trivially fast today, slow at production scale.

**Mitigation.** With the mutable `shots.status` column, the N+1 problem is eliminated — the status is a column in the grid query. Required indexes:

```sql
-- Grid filtering: sequence → status (most common query pattern)
CREATE INDEX idx_shots_status ON shots(sequence_id, status);

-- If "all shots across project" grid view added:
CREATE INDEX idx_shots_project_status ON shots(project_id, status, created_at DESC);

-- Status event history (timeline panel)
CREATE INDEX idx_shot_status_events_shot_time ON shot_status_events(shot_id, created_at DESC);

-- Cursor pagination on shots grid
CREATE INDEX idx_shots_cursor ON shots(sequence_id, created_at DESC, id);
```

**Prior art.** `src/store/schema.ts` `idx_provenance_version_time` — demonstrates the composite index pattern for bounded-scan queries.

---

### Q3: Thumbnail/Hover-to-Scrub Scope Creep

**Failure mode — sprite sheet scope creep.** Hover-to-scrub for video thumbnails requires: (a) ffmpeg tile extraction pipeline, (b) sharp composite to stitch frames, (c) a VTT or JSON metadata endpoint, (d) cache invalidation for all artifact types atomically. That is a 3× multiplication of the thumbnail pipeline surface area. The `video-thumbnail.ts` implementation already has D-28 (`-vf thumbnail` representative-frame filter) and D-29 (brightness fallback); a sprite sheet path adds a second ffmpeg invocation per version and a new file type to the `invalidateCache` function in `cache.ts`.

**Failure mode — WebM encoding for scrubbing.** An alternative is generating a low-res WebM for hover playback. This is even larger scope: WebM encoding is 5–10× slower than JPEG extraction, produces 1–5MB per clip (vs. ~80KB sprite sheet), requires browser codec support detection in the dashboard, and adds a new content-type to the HTTP asset serving path.

**Failure mode — cache invalidation for multi-file artifacts.** `cache.ts` `invalidateCache` currently removes two files: `.thumb.webp` and `.thumb.failed`. Adding sprite sheets adds `.thumb.sprite.webp` and `.thumb.sprite.json`. If `invalidateCache` is not updated atomically (all four files in one operation), a race window exists where the thumbnail is fresh but the metadata references stale pixel offsets.

**Mitigation.** Generate sprite sheets lazily on first hover request (not at version-creation time). Add a `sprite_generated_at` nullable column on versions as the cache sentinel. The `generateSpriteSheet()` function lives in `video-thumbnail.ts` (ffmpeg) and calls into `image-thumbnail.ts` (sharp composite) — same module boundaries, no new importers, D-24/D-23 invariants preserved.

**Prior art.** `src/engine/thumbnails/video-thumbnail.ts` D-30 (100MB pre-flight hard-skip) and D-26 (lazy import + monotonic fail) — demonstrate the discipline of bounding scope in the pipeline. `src/engine/thumbnails/cache.ts` `writeAtomic` — the rename-based atomic write pattern must be extended to all artifact types if sprite sheets are added.

---

### Q4: SSE Streaming Reliability

**Failure mode — `writeSSE` never returns on aborted streams (Hono #2068).** The existing `src/http/sse.ts` already handles this correctly: `void stream.writeSSE({...}).catch(() => {})` swallows stream-closed errors rather than awaiting the promise. If v1.3 adds AI summary streaming (token-by-token delivery), the same pattern must be applied to every `writeSSE` call in the streaming path. A naive `await stream.writeSSE(token)` in a `for await ... of tokenStream` loop will hang when the client disconnects mid-stream, blocking the event loop for the duration of the AI model's response.

**Failure mode — reconnect storm on server restart.** `EventSource` reconnects with a 3-second default delay. If the HTTP server restarts, all connected dashboard clients reconnect simultaneously. The existing `createSseHandler` does not emit a `Last-Event-ID`-based replay, so reconnected clients receive only future events. For a single-user demo this is acceptable, but the gap should be documented as a known limitation.

**Failure mode — backpressure on slow clients.** If the dashboard client's TCP receive buffer fills (slow network), Node.js streams apply backpressure. Hono's SSE helper does not expose the `drain` event, so a write that returns `false` from the underlying stream will queue in Node.js's stream buffer. For long-running AI summary streams, this buffer can accumulate multiple KB of queued tokens. The mitigation is an AbortController timeout.

**Failure mode — keep-alive format.** `src/http/sse.ts` sends keep-alives via `stream.write(': ping\n\n')` (raw bytes) rather than `writeSSE({...})`. This is correct — `writeSSE` would produce `data: : ping`, which is a malformed SSE comment. If v1.3 adds a second SSE handler for AI streaming, it must replicate this keep-alive pattern exactly.

**Mitigation.** Apply the existing `void + .catch(() => {})` pattern universally in all SSE write paths. Add an `AbortController` tied to `c.req.raw.signal` for AI streaming calls — abort the upstream fetch when the SSE connection closes, preventing token generation from continuing after the client disconnects (cost and CPU waste). For the Claude Max / no-API-key case (established project precedent), the streaming path must have a synchronous fallback that emits a single `data:` frame with the pre-computed summary.

**Prior art.** `src/http/sse.ts` lines (cleanup, void-catch, keep-alive pattern, AbortSignal) — the complete reference implementation. `src/__tests__/http/sse-e2e.test.ts` — end-to-end test covering all 5 event types; new streaming paths must be added here.

---

### Q5: Append-Only + Status Correctness

**Failure mode — computing "current status" from empty event history.** If a shot was created before the status event system was added (i.e., it has zero events in `shot_status_events`), `getLatestShotStatus` returns `null`. The caller must treat `null` as the implicit default status (e.g., `wip`). If the caller instead throws or returns an error, every pre-migration shot breaks. This is an invisible migration correctness trap: the code works in tests (which create shots and immediately set status), fails in production on pre-existing data.

**Failure mode — race between UPDATE and INSERT.** With the hybrid model, each status change does: (1) UPDATE shots SET status = ? WHERE id = ?, (2) INSERT INTO shot_status_events (...). If these are not wrapped in a single transaction, a concurrent reader can see the UPDATE but not the INSERT, observing a status change with no corresponding audit entry. SQLite WAL mode with `busy_timeout=5000` serializes writers, so the race is between readers and the write transaction, not between concurrent writers.

**Failure mode — `LIMIT 50` cap on history queries.** The `shot_status_events` history query uses `ORDER BY created_at DESC LIMIT 50` for timeline display. After 50 status changes, older history is not displayed — this is a UI pagination limit, not a correctness issue. The cap constant comment should explicitly state "performance cap for timeline display; full history always in DB."

**Failure mode — `lineage_type: null` on reproduce/iterate row (LANDMINE #8, already mitigated).** The existing `LANDMINE #8` comment in `version-repo.ts` line 58 documents that `lineage_type` must be written at INSERT time, never via follow-up UPDATE. This same constraint applies to the `from_status` field in `shot_status_events` — it must be written atomically at event INSERT, never patched.

**Mitigation.** Wrap UPDATE + INSERT in a single `db.transaction()` call (same pattern as `version-repo.ts` line 92). Always null-coalesce to `'wip'` when `shot_status_events` returns no rows for a shot. Add a migration test: shot with zero status events returns `'wip'` from the repo method.

**Prior art.** `src/store/version-repo.ts` line 92 `db.transaction` — the template for atomic multi-statement writes. `src/store/provenance-repo.ts` `getLatestManifestSignedEvent` — bounded-scan pattern with `MANIFEST_SIGNED_LOOKUP_LIMIT`.

---

### Q6: MCP Tool Cap Pressure

**Failure mode — action count vs. tool count confusion.** The `tool-budget.test.ts` assertion `registerToolCount() === 7` counts `server.registerTool(` occurrences in `src/tools/`. Adding `set_status`, `approve`, `reject`, `bulk_set_status`, `get_status_history` as new actions on the existing `shot` tool does NOT increment the count — those are new arms in the `z.discriminatedUnion` inside one `registerTool` call. The count only increments if a new top-level tool is registered. The v1.3 budget pressure is real only if v1.3 needs a genuinely new tool concept.

**Failure mode — discriminated union schema growing too coarse.** When a tool has 8+ actions, the `tools/list` response publishes a massive JSON Schema union object. MCP clients that display tool documentation show all arms simultaneously. A `shot` tool with `create | list | get | set_status | approve | reject | bulk_set_status | get_status_history` is technically one tool but functionally behaves like 8 tools from the user perspective.

**Failure mode — `tool-budget.test.ts` exact-count assertion.** The test asserts `=== 7` (exact). Any PR that adds a new `server.registerTool(` call will fail this test until the assertion is bumped. The `=== 7` assertion should include a comment explaining the headroom: "7 of 12 slots used; 5 remain; bump only after explicit tool-budget review."

**Mitigation.** For v1.3, add all shot-status and approval actions as new arms on the existing `shot` tool — no new `registerTool` call, budget unchanged. If a bulk operation is needed, implement it as `action: 'bulk_set_status'` on the `shot` tool with a `shot_ids: z.array(z.string())` parameter, not as a new tool. Reserve new tool slots for genuinely orthogonal concepts.

**Prior art.** `src/tools/shot-tool.ts` — existing 3-action discriminated union as the template for extension. `src/__tests__/tool-budget.test.ts` — the exact-count assertion and the `registeredToolNames` sorted-array assertion both provide a forcing function.

---

### Q7: Review/Approval UX Traps

**Failure mode — confirmation-less status transitions.** Approving a shot in a VFX review session is a significant action. Without explicit documentation of which status transitions carry higher weight, the dashboard may show an `[Approve]` button with no confirmation step. The free-DAG design (any → any) means there is always a path back, but supervisors may not know that.

**Failure mode — data loss on A/B compare navigation.** A common review UX pattern is side-by-side A/B comparison: version N vs. version N-1. If the dashboard implements this as a route change, any unsaved annotation or status change in progress is silently discarded. The existing Preact dashboard uses client-side state; there is no draft-save mechanism.

**Failure mode — slow A/B compare from sequential thumbnail loads.** A/B comparison requires two thumbnails side by side. If thumbnails are loaded sequentially (fetch A, then fetch B), the comparison panel has a perceptible flash. The mitigation is preloading both thumbnails when the compare view is activated: `new Image().src = thumbUrlA; new Image().src = thumbUrlB;` before rendering the comparison panel.

**Failure mode — SSE status events arriving after review decisions.** A reviewer opens the grid, sees shot X as `wip`, starts reviewing. While reviewing, the rendering engine completes a version and SSE pushes a `version_completed` event. If the dashboard updates the grid row in place (re-rendering the row component), the reviewer's currently-open annotation panel for that shot may be disrupted (scroll position lost, focused element blurred). Preact reconciliation should handle this gracefully if the annotation panel is keyed on shot ID only.

**Mitigation.** Define the status set explicitly as a typed constant (`SHOT_STATUSES` array). Key the annotation panel component on `shotId` only, not on any version-level field, to prevent reconciliation disruption on SSE-driven grid updates. For A/B compare, preload both thumbnails before mounting the comparison component. The MCP tool's response text is the sole confirmation signal for approval (no AI narration dependency per Claude Max / no-API-key project precedent).

**Prior art.** `src/http/sse.ts` `toDashboardPayload` adapter (CR-01 guard) — the right place to add `updateType` metadata that the dashboard uses to decide whether to refresh the annotation panel. `src/store/version-repo.ts` `transition` method — the guard-based transition pattern as the model for shot status transition documentation.

---

## Cross-Cutting Risk Summary

The highest-severity pitfalls for v1.3, ranked by blast radius:

1. **Three-model collision if using naive mutable column (Q1)** — avoid by using the industry-standard hybrid: mutable `shots.status` (fast grid reads) + append-only `shot_status_events` (audit), transacted together. Never extend `provenance_events` with shot-scoped events.

2. **`void + .catch` omission in AI streaming (Q4)** — a single missing `void` on an `await stream.writeSSE(token)` in the streaming path hangs the event loop on client disconnect; not caught by existing tests because the sse-e2e test uses a controlled client.

3. **Missing indexes for grid queries (Q2)** — no index on `(sequence_id, status)` by default; 200-shot grid with status filter does a full shots scan. Add `idx_shots_status` as part of migration.

4. **Empty event history null-coalesce (Q5)** — pre-migration shots have no status events; `null` must be treated as `'wip'` at engine layer; wrap UPDATE + INSERT in transaction.

5. **SSE-driven grid update disrupting open annotation panels (Q7)** — key annotation panel on `shotId` only; test SSE-during-review flow explicitly.
