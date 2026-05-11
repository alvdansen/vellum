# Requirements: VFX Familiar — Milestone v1.3 Production Shot Grid

**Defined:** 2026-05-11
**Driver:** Milestone pivot from C2PA hardening to production management layer, confirmed by Timothy 2026-05-11. v1.3 transforms VFX Familiar from a generation-and-provenance tool into a light production management layer for solo artists and small teams.
**Thesis:** v1.0 captured private provenance; v1.1 made it cryptographically signed; v1.2 made it legible to VFX artists; v1.3 makes it *actionable* for production review and approval workflows. A shot grid grouped by sequence, a 5-state status workflow with audit trail, and a review/approval surface give VFX artists a production-management layer without requiring a full ShotGrid seat.

## Research Decisions Resolved

The following 7 open questions from SUMMARY.md were resolved before writing requirements:

| Question | Decision | Rationale |
|----------|----------|-----------|
| Status change note | **Optional** | Audit trail is valuable; forcing a note on every WIP → pending-review transition adds friction with no payoff for solo/small-team use |
| Stale-shot threshold | **14 days** | Matches ShotGrid's default "overdue" heuristic; configurable in future milestone |
| Sprite sheet timing | **Lazy on first hover** | Eager generation at version completion doubles pipeline I/O for every video; hover-triggered generation only costs when actually needed |
| A/B comparison scope | **Any two user-selected versions** | "Current vs. parent" is too restrictive; supervisors compare across non-linear lineage |
| pending-review trigger | **Manual only** | Auto-trigger on new version upload adds noise; supervisors want explicit control |
| omit visibility | **Hidden from default grid, explicit restore flow** | Omitted shots should not crowd the review surface; restore is an intentional recovery action |
| Stats widget placement | **ShotGridView header** | Contextual — per-sequence stats belong at the top of the sequence's shot grid, not a global panel |

## v1.3 Requirements

Each requirement maps to a single roadmap phase. User-centric, atomic, and testable.

### Shot Status Workflow (STAT)

- [ ] **STAT-01**: User sees a WCAG 2.1 AA compliant status badge (color + text, never color alone) on every shot card in the shot grid representing one of five production states: `wip | pending-review | approved | on-hold | omit`. Transitions are free-form (any → any, no guards) — supervisors must be able to reopen approved shots and override holds without workarounds.

- [ ] **STAT-02**: User changes a shot's status (with optional free-text note) and the change is committed atomically: a single `db.transaction()` executes `UPDATE shots SET status = ?` and `INSERT INTO shot_status_events (...)` together. If the transaction fails, neither the status column nor the event row is written. The `changed_by` field captures `'user'` or the calling tool name.

- [ ] **STAT-03**: User (or MCP agent) queries a shot's status history and receives up to 50 events (performance-bounded) ordered newest-first, each showing `from_status`, `to_status`, `changed_by`, optional `note`, and `created_at`. Shots created before migration 0008 have zero history rows — the repo layer null-coalesces to `'wip'` as the implicit default; callers never receive `null`.

- [ ] **STAT-04**: Status changes push a `shot.status_changed` SSE event to all connected dashboard clients with `{ shotId, fromStatus, toStatus, changedBy, note? }`. Dashboard updates the shot card's status badge in-place without triggering a full grid re-fetch. Shot card component is keyed on `shotId` only — SSE-driven updates do not disrupt open review panels.

- [ ] **STAT-05**: MCP tool budget stays at 7 of 12. All shot-status functionality ships as three new arms on the existing `shot` tool: `set_status`, `get_status`, `list_status_history` — no new `server.registerTool()` call; `tool-budget.test.ts` assertion `=== 7` is unchanged.

### Shot Grid View (GRID)

- [ ] **GRID-01**: User navigates to a sequence via the tree sidebar grid icon and sees a full-width shot grid view (`ShotGridView`). Shots are displayed in a CSS Grid (`minmax(220px, 1fr)`, `16:9` aspect-ratio containers), grouped under a collapsible sequence header that shows the sequence name and aggregate status counts. The existing home view (`HomeView`) is preserved and reachable from the sidebar home icon — no router is added; signal-driven view switch via `activeView` in `App.tsx`.

- [ ] **GRID-02**: Each shot card in the grid shows: the latest completed version's lazy-loaded thumbnail (existing thumbnail pipeline; `loading="lazy"`, explicit width/height for CLS=0), shot name, status badge (`ShotStatusPill`), and a version count badge. Cards missing a completed version render a `<SkeletonThumbnail/>`. Shot cards link to the VersionDrawer on click.

- [ ] **GRID-03**: User filters shots by status via a status filter bar at the top of the shot grid (one pill per status; "All" resets). Filtering is client-side (no re-fetch) using existing shot grid signals. The filter selection persists in the `activeView` signal state for the session.

- [ ] **GRID-04**: Shot grid data loads from a single `GET /api/sequences/:id/shot-grid` endpoint that returns a denormalized payload (shot rows joined with latest-completed-version thumbnail + status) via a single SQL query — no N+1. Cursor pagination applies for sequences with > 50 shots.

- [ ] **GRID-05**: `omit`-status shots are hidden from the default shot grid view. A "Show omitted" toggle in the filter bar reveals them. Omitted shots render with a visual dimming treatment (`opacity-40` overlay) to distinguish them from active shots.

### Review and Approval (REV)

- [ ] **REV-01**: User opens a shot's review panel (VersionDrawer-style overlay, keyed on `shotId`) and sees: the current status badge, a version history timeline (latest first), available status-transition actions (Approve, Request Retake, Hold, Omit), and a notes field for the transition. Each action shows a confirmation popover ("Approve this shot?") before committing — no bare one-click state transitions. The panel is keyed on `shotId` only; SSE-driven version-completion events do not disrupt an open panel.

- [ ] **REV-02**: User quick-approves a shot directly from the shot grid card via an inline `[Approve]` action that shows a confirmation popover anchored to the card. On confirmation, the status optimistically updates in the grid (signal update), then the PATCH request confirms via the `set_status` tool arm. If the request fails, the status reverts to its prior value with an error indicator.

- [ ] **REV-03**: User opens an A/B version comparison view that renders any two user-selected versions side-by-side (not restricted to current vs. parent) with: thumbnails for each version (preloaded in parallel before the panel mounts — `new Image().src` both URLs before rendering), and a metadata diff showing key deltas (model, seed, prompt key changes). No interactive wipe in v1.3 — static side-by-side only.

- [ ] **REV-04**: Notes added during status transitions are stored as the `note` field on the `shot_status_events` row (append-only — never editable). Notes appear in the version history timeline in the review panel, attributed with `changed_by` and `created_at`. Empty notes (no note provided) are stored as `null`, not empty string.

- [ ] **REV-05**: User (or MCP agent) restores an `omit`-status shot to `wip` via an explicit "Restore Shot" action in the review panel — available only when current status is `omit`. The restoration writes a `shot_status_events` row (`to_status: 'wip'`, `note: 'Restored from omit'` as system note). No other path auto-restores omitted shots.

### Production Overview / Stats (OVR)

- [ ] **OVR-01**: User sees a stats widget at the top of every `ShotGridView` showing: total shots in sequence, % approved, per-status counts (wip N, pending-review N, approved N, on-hold N, omit N), and pending-review backlog count. Stats are computed server-side via a single `GROUP BY shot_id, status` query — no N+1, no subquery per shot.

- [ ] **OVR-02**: Stale shot detection: any shot with `status IN ('wip', 'pending-review')` and no completed version in the last 14 days receives a visual "Stale" indicator on its shot card (amber warning icon). Staleness is computed at grid query time from `versions.completed_at` — no separate polling. The 14-day threshold is a named constant (`STALE_SHOT_DAYS = 14`) in `shot-status-repo.ts`.

- [ ] **OVR-03**: Stats widget auto-refreshes when a `shot.status_changed` SSE event is received for any shot in the current sequence — increments/decrements the affected counters without a full re-fetch. Stats are backed by a Preact computed signal derived from the shot grid signal.

### UX Polish Bundle (POL)

- [ ] **POL-01**: User hovers over a video-source thumbnail in the shot grid and sees a hover-to-scrub preview: a sprite sheet (ffmpeg `fps=1/2,scale=160:-1` frame extraction → sharp composite → `.thumb.sprite.webp`) is generated lazily on first hover request (not at version-creation time). CSS `background-position` scrub at `2s` intervals per frame. Image-source thumbnails (not video) get hover-to-zoom only (`transform: scale(1.05)`, CSS transition). The `sprite_generated_at` nullable column on `versions` is the cache sentinel. `invalidateCache` is extended to atomically remove all 4 artifact files (`.thumb.webp`, `.thumb.failed`, `.thumb.sprite.webp`, `.thumb.sprite.json`) when cache is invalidated.

- [ ] **POL-02**: User clicks "Regenerate" on a version summary and sees token-streaming: `anthropic.messages.stream()` is piped through `streamSSE` emitting `summary.delta` (one SSE frame per text token) and `summary.done` (end signal). Every `sseStream.writeSSE()` call uses `void + .catch(() => {})` — no `await` on SSE writes. An `AbortController` tied to `c.req.raw.signal` aborts the upstream Anthropic stream when the client disconnects. When `ANTHROPIC_API_KEY` is absent, the streaming endpoint returns a single `summary.delta` frame with the pre-computed static fallback message, then `summary.done` — no 500 error, no broken UI. Streaming applies to the Regenerate path only; cache-hit reads return immediately without streaming.

- [ ] **POL-03**: User's sort preference per shot persists to `localStorage` with a bounded key (`sort:shot:${shotId}`, LRU capped at 50 entries matching the v1.2 SORT-03 pattern). Sort preference is restored on grid remount. A sort change resets the page cursor to 1 — same invariant as SORT-05 in v1.2.

- [ ] **POL-04**: A/B version comparison panel includes a cross-version narrative summary beneath the side-by-side view: a brief LLM-generated comparison ("v003 adds a wider lens vs v002's tight close-up") using the same `summarizeVersion` engine path as Phase 19 with a comparison-specific prompt template. If `ANTHROPIC_API_KEY` is absent or the circuit breaker has tripped, the comparison summary area shows the static fallback "(comparison summary unavailable)" — no broken panel state.

## Open Questions Resolved (Architecture Decisions)

These decisions are load-bearing and close the SUMMARY.md unresolved-questions list:

| # | Question | Answer |
|---|----------|--------|
| 1 | Status change note | Optional (stored as `null` when omitted, not empty string) |
| 2 | Stale-shot threshold | 14 days (`STALE_SHOT_DAYS = 14`, named constant) |
| 3 | Sprite sheet timing | Lazy on first hover (not eager at version completion) |
| 4 | A/B comparison scope | Any two user-selected versions (not current-vs-parent only) |
| 5 | pending-review trigger | Manual only (new version does NOT auto-set shot status) |
| 6 | omit visibility | Hidden from default grid; visible via "Show omitted" toggle; restore is explicit action in review panel |
| 7 | Stats widget placement | ShotGridView header (contextual, per-sequence) |

## Cross-Cutting Constraints

Non-negotiable invariants carried forward from v1.0 + v1.1 + v1.2:

- **Tool cap holds at 7 of 12** — v1.3 adds zero new top-level MCP tools. All shot-status actions are arms on the existing `shot` tool.
- **Append-only shot_status_events** — `shot_status_events` rows are never `UPDATE`'d or `DELETE`'d. Enforced by grep test: `grep 'UPDATE shot_status_events'` must return empty. Mirrors `provenance_events` append-only discipline.
- **Transaction discipline** — every status change wraps `UPDATE shots SET status` + `INSERT INTO shot_status_events` in a single `db.transaction()`.
- **Null-coalesce at repo layer** — `getStatusHistory()` returns `'wip'` (not `null`) when a shot has zero history rows.
- **Architecture-purity** — D-24 (`@ffmpeg-installer/ffmpeg` sole-importer `video-thumbnail.ts`) and D-23 (`sharp` sole-importer `image-thumbnail.ts`) invariants preserved. `generateSpriteSheet()` lives in `video-thumbnail.ts` and calls `image-thumbnail.ts` for the composite step — no new importers.
- **SSE void+catch universality** — every `sseStream.writeSSE()` call in v1.3 streaming paths uses `void + .catch(() => {})`. No `await stream.writeSSE(...)` in `for await` loops.
- **Permanent fallback for absent ANTHROPIC_API_KEY** — streaming endpoint returns single-frame static response. Phase 19 precedent (ships in permanent fallback mode).
- **WCAG 2.1 AA status badges** — all 5 status states use color + text (never color alone). Contrast ratios: text ≥ 4.5:1, UI components ≥ 3:1.
- **Signal-driven view routing** — `activeView` signal switch in `App.tsx`; no client-side router. Mirrors `VersionDrawer` overlay precedent.
- **WAL mode + busy_timeout=5000** — SQLite configuration unchanged.
- **Migration 0008** — single migration file: `ALTER TABLE shots ADD COLUMN status`, `CREATE TABLE shot_status_events`, 4 indexes. No inline guards or transition matrices in the DB layer.

## Out of Scope (v1.3 explicit exclusions)

| Feature | Reason |
|---------|--------|
| 20-state ShotGrid status machine | Solo/small-team persona does not need it; 5 states cover all target use cases |
| Client approval portal (external review) | Out of persona scope; requires auth infrastructure not in v1.3 |
| Frame-level annotation tools | Scope explosion; Phase 24 sprite scrub is UI budget ceiling for v1.3 |
| Automated status transitions on version completion | Auto-trigger adds noise; supervisors want explicit control (resolved Q5) |
| Financial/bid tracking per shot | Outside VFX Familiar's stated scope |
| Interactive wipe in A/B comparison | Static side-by-side is sufficient for v1.3; wipe requires canvas tooling |
| Summary translation (multi-language) | Clean future phase once usage signals demand it |
| AI-generated alt text on thumbnails | Provenance graph encodes identity; alt text is a v1.4 candidate |
| C2PA hardening (HSM/Yubikey, multi-CA) | Explicitly deferred from v1.1 close; remains future milestone scope |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STAT-01 | Phase 20 | Not started |
| STAT-02 | Phase 20 | Not started |
| STAT-03 | Phase 20 | Not started |
| STAT-04 | Phase 20 | Not started |
| STAT-05 | Phase 20 | Not started |
| GRID-01 | Phase 21 | Not started |
| GRID-02 | Phase 21 | Not started |
| GRID-03 | Phase 21 | Not started |
| GRID-04 | Phase 21 | Not started |
| GRID-05 | Phase 21 | Not started |
| REV-01 | Phase 22 | Not started |
| REV-02 | Phase 22 | Not started |
| REV-03 | Phase 22 | Not started |
| REV-04 | Phase 22 | Not started |
| REV-05 | Phase 22 | Not started |
| OVR-01 | Phase 23 | Not started |
| OVR-02 | Phase 23 | Not started |
| OVR-03 | Phase 23 | Not started |
| POL-01 | Phase 24 | Not started |
| POL-02 | Phase 24 | Not started |
| POL-03 | Phase 24 | Not started |
| POL-04 | Phase 24 | Not started |

**Coverage:**
- v1.3 requirements: 22 total (5 STAT + 5 GRID + 5 REV + 3 OVR + 4 POL)
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-05-11 — v1.3 Production Shot Grid milestone. Research synthesis basis: 5 research files (ARCHITECTURE.md, FEATURES.md, PITFALLS.md, STACK.md, SUMMARY.md), 4 resolved cross-file disagreements. Phase ordering: strict 20 → 21 → 22 → 23 → 24. Phase 24 requires adversarial review checklist before execute.*
