# Project Research Summary — v1.3 Production Shot Grid

**Project:** VFX Familiar (comfyui-vfx-mcp)
**Domain:** VFX production management layer — shot status workflow, shot grid UI, review/approval surface, production stats, UX polish bundle
**Researched:** 2026-05-11
**Confidence:** HIGH for status workflow, schema, and architecture; MEDIUM for AI summary streaming scope and hover-to-scrub cache integration

---

## Executive Summary

v1.3 — "Production Shot Grid" — transforms VFX Familiar from a generation-and-provenance tool into a light production management layer. It adds five feature areas on top of the shipped v1.2 visual dashboard: (1) a shot status workflow with audit trail, (2) a shot grid view grouped by sequence, (3) a review and approval surface with inline actions and A/B comparison, (4) sequence-level production stats, and (5) a UX polish bundle comprising hover-to-scrub thumbnails, SSE-streamed AI summaries on the Regenerate path, and per-shot sort persistence.

The milestone is bounded to the solo-artist / small-team audience — the 20-state ShotGrid model is explicitly out of scope; five states cover the entire target persona.

The recommended architecture is additive and follows every established project pattern. The status model uses the industry-standard hybrid: a mutable `shots.status` column for fast grid reads/filtering paired with a new append-only `shot_status_events` table for audit trail, both written in a single transaction. All new MCP actions ship as arms on the existing `shot` tool — the tool budget stays at 7 of 12. No new MCP tools, no new transport infrastructure, no new client-side router. Every v1.3 requirement maps to extending an existing pattern.

---

## Key Findings

### Stack and Tooling

v1.3 adds **zero new package dependencies**. Every technical requirement maps to an existing library or pattern already in the codebase. The Anthropic SDK (`@anthropic-ai/sdk: 0.95.1`) is already in `package.json` from Phase 19. The sprite sheet pipeline uses `@ffmpeg-installer/ffmpeg` (already present, D-24 invariant) and `sharp` (already present, D-23 invariant). SSE infrastructure (`src/http/sse.ts`) already handles `streamSSE`, keep-alive pings, and AbortSignal cleanup.

**Core technologies and their v1.3 roles:**

| Technology | v1.3 Role |
|------------|-----------|
| `better-sqlite3` + Drizzle ORM | Migration `0008_shot_status` (ALTER TABLE + new table + 4 indexes) |
| `@anthropic-ai/sdk` | `anthropic.messages.stream()` piped through `streamSSE` on Regenerate path only |
| `@ffmpeg-installer/ffmpeg` | Sprite sheet frame extraction (lazy, on first hover) |
| `sharp` | Sprite sheet composite in `image-thumbnail.ts` |
| `hono/streaming` | Extended for `shot.status_changed` + `summary.delta` / `summary.done` event types |
| Preact signals | New `activeView` signal; isolated shot grid signals; no router added |

**SQLite indexes required (migration 0008):**

```sql
CREATE INDEX idx_shots_status ON shots(sequence_id, status);
CREATE INDEX idx_shots_project_status ON shots(project_id, status, created_at DESC);
CREATE INDEX idx_shot_status_events_shot_time ON shot_status_events(shot_id, created_at DESC);
CREATE INDEX idx_shots_cursor ON shots(sequence_id, created_at DESC, id);
```

### Features

**Must-have (core milestone promise):**
- 5-state shot status engine: `wip | pending-review | approved | on-hold | omit` — free DAG, no transition guards
- Shot grid view grouped by sequence: CSS Grid `minmax(220px, 1fr)`, 16:9 aspect-ratio containers, lazy-load thumbnails, status filter bar, sequence header with aggregate status counts
- Status badge per shot card: WCAG 2.1 AA compliant (color + text), slots into existing `StatusPill.tsx` pattern
- Status change with optional note: every transition writes to `shot_status_events`; system captures `changed_by` and timestamp
- Review panel: VersionDrawer-style overlay with approve/retake/hold/omit actions, notes per version (append-only), version history timeline
- Inline quick-approve from grid with confirmation popover
- Two-panel A/B version comparison: side-by-side with metadata diff; no interactive wipe in v1.3
- Sequence-level stats: % approved, status counts, pending review backlog count
- Sprite-sheet hover scrub for video versions: lazy generation on first hover request
- Hover-to-zoom for image stills (CSS `transform: scale`)
- SSE streaming on AI summary Regenerate path only (not cache-hit reads)
- Per-shot sort persistence via localStorage

**Permanent anti-features:** 20-state status machine, client approval portal, frame-level annotation, automated status transitions, financial/bid tracking.

### Architecture

v1.3 adds one Drizzle migration, one new table, one new endpoint, three new `shot` tool arms, one new dashboard view, and two new SSE event types — all slotted into existing patterns.

**Major components:**

| Component | Type | Purpose |
|-----------|------|---------|
| `src/store/shot-status-repo.ts` | New | `insertStatusEvent()` wraps UPDATE + INSERT in single `db.transaction()` |
| `src/tools/shot-tool.ts` | Extended | 3 new arms: `set_status | get_status | list_status_history` |
| `GET /api/sequences/:id/shot-grid` | New endpoint | Denormalized payload via single SQL; no N+1 |
| `src/engine/thumbnails/video-thumbnail.ts` | Extended | `generateSpriteSheet()` for lazy sprite generation |
| `src/engine/thumbnails/image-thumbnail.ts` | Extended | `compositeSpriteSheet()` called from `video-thumbnail.ts` |
| `src/http/sse.ts` | Extended | `shot.status_changed`, `summary.delta`, `summary.done` events |
| `packages/dashboard/src/lib/state.ts` | Extended | `activeView` signal, `shotGridSequenceId`, isolated shot grid signals |
| `packages/dashboard/src/views/ShotGridView.tsx` | New | Full-width view, CSS Grid, sequence-grouped collapsible sections |
| `packages/dashboard/src/components/ShotStatusPill.tsx` | New | 5 production status variants with inline-edit click handler |

**Routing pattern:** Signal-driven view switch via `activeView` in `App.tsx` — no client-side router, matching the `VersionDrawer` overlay precedent.

### Critical Pitfalls

1. **Dual-model collision** — three status semantics coexist; mitigation: `SHOT_STATUSES` named constant, grep test enforcing no `UPDATE shot_status_events`, migration file documentation.

2. **`void + .catch()` omission in AI streaming** — hangs event loop on client disconnect; mitigation: apply existing pattern universally; add disconnection test to `sse-e2e.test.ts`.

3. **Missing indexes** — status-filtered grid on 200 shots does full table scan without them; mitigation: all 4 indexes non-optional in migration 0008.

4. **Empty event history null-coalesce** — pre-migration shots have zero `shot_status_events` rows; `null` must become `'wip'` at repo layer; mitigation: explicit null-coalesce in `getStatusHistory()`.

5. **Multi-file sprite cache invalidation** — `invalidateCache` must atomically remove all 4 artifact files; stale metadata causes visual corruption.

---

## Resolved Disagreements Between Research Files

| Topic | Resolution | Reasoning |
|-------|------------|-----------|
| **Status states** | `wip\|pending-review\|approved\|on-hold\|omit` | Matches ShotGrid vocabulary; `waiting\|ready\|in_review\|approved\|rejected` from ARCHITECTURE.md had no industry precedent |
| **Hover-to-scrub** | Sprite sheets (not WebM) | Integrates with existing thumbnail cache; no video buffering; no new content-type; ARCHITECTURE.md's WebM recommendation had wrong cost/complexity assessment |
| **AI summary streaming** | SSE on Regenerate path only | Streaming adds perceived speed on active generation; not streaming cache hits is correct (cache reads are instant) |
| **Schema naming** | `shots.status` column, `shot_status_events` table | Shorter, consistent with existing `versions.status` naming; ARCHITECTURE.md's `production_status` / `shot_status_history` names were verbose |

---

## Implications for Roadmap

Phases continue from Phase 19. v1.3 = Phases 20–24.

### Phase 20: Shot Status Engine
**Rationale:** Foundation — all subsequent v1.3 features depend on status existing. Pure backend, no dashboard changes, lowest risk.
**Delivers:** Migration `0008_shot_status` (ALTER TABLE + CREATE TABLE + 4 indexes), `shot-status-repo.ts`, 3 `shot` tool arms (`set_status | get_status | list_status_history`), `shot.status_changed` SSE event type, `ShotStatus` TypeScript type.
**Must-avoid:** Dual-model collision, empty-history null-coalesce, missing transaction wrapping UPDATE + INSERT.

### Phase 21: Shot Grid View
**Rationale:** Requires Phase 20. Delivers the primary v1.3 user surface.
**Delivers:** `GET /api/sequences/:id/shot-grid` endpoint, `ShotGridView.tsx`, `ShotGridCard.tsx`, `ShotStatusPill.tsx`, `activeView` signal, sequence-grouped layout, status filter bar, TreeSidebar grid-icon navigation.
**Must-avoid:** N+1 on grid query (solved by denormalized endpoint), SSE-driven update disrupting open panels (key panel on `shotId` only).

### Phase 22: Review and Approval Surface
**Rationale:** Requires Phase 20. Medium risk — confirmation flows and optimistic UI updates.
**Delivers:** Review panel with approve/retake/hold/omit actions + confirmation popovers, notes per version (append-only), two-panel A/B comparison, inline quick-approve from grid, thumbnail preload on compare activation.
**Must-avoid:** Confirmation-less transitions, data loss on A/B navigation, sequential thumbnail loads in compare.

### Phase 23: Production Stats
**Rationale:** Requires Phases 20 + 21. All reads, no new write paths. Lowest risk of the five phases.
**Delivers:** Sequence-level stats widget (% approved, status counts, pending review backlog), stale shot detection query.
**Must-avoid:** N+1 on stats (single GROUP BY), stale query planner statistics.

### Phase 24: UX Polish Bundle
**Rationale:** Last because it touches `sse.ts`, `video-thumbnail.ts`, `image-thumbnail.ts` — files also modified by phases 20–23. Sequencing last avoids merge conflicts. Highest risk phase.
**Delivers:** Sprite sheet lazy generation + CSS scrub in `ShotGridCard`, hover-to-zoom for image stills, SSE token streaming for AI Regenerate path, per-shot sort persistence, cross-version comparison summary in A/B panel.
**Must-avoid:** `void + .catch()` omission in streaming, multi-file cache invalidation atomicity for sprite artifacts, AbortController omission on upstream Anthropic stream.
**Research flag:** Phase 24 plan requires adversarial review checklist: (a) `void + .catch()` uniformity, (b) AbortController wiring, (c) sprite cache invalidation atomicity, (d) permanent fallback for absent API key.

### Dependency Graph

```
Phase 20 (Status Engine) — backend foundation
  ├── Phase 21 (Shot Grid View) — primary UI surface
  │     └── Phase 23 (Production Stats) — read-only aggregation
  └── Phase 22 (Review & Approval) — interactive review layer
Phase 24 (UX Polish Bundle) — depends on Phase 20; sequential after 23 to avoid file conflicts
```

---

## Open Questions for REQUIREMENTS.md

1. **Status change note:** Optional (recommended) or required?
2. **Stale-shot threshold:** Default N days for "no activity > N days" detection. Recommend 14 days.
3. **Sprite sheet timing:** Lazy on first hover (recommended) vs. eager at version completion?
4. **A/B comparison scope:** Any two user-selected versions, or always current vs. parent?
5. **`pending-review` trigger:** New version auto-sets shot to `pending-review`, or always manual?
6. **`omit` state visibility:** Hidden from default grid view? Explicit "restore" flow?
7. **Stats widget placement:** ShotGridView header (recommended), separate panel, or HomeView?

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies; all libraries already present |
| Features — status/review/stats | HIGH | Verified across ShotGrid/Kitsu/ftrack |
| Features — AI streaming/sprite scrub | MEDIUM | Patterns well-understood; cache integration needs validation |
| Architecture | HIGH | Ground-truth codebase read for every claim |
| Pitfalls | HIGH | Sourced from actual codebase patterns (LANDMINE annotations, existing `void + .catch()` usage) |

**Overall confidence:** HIGH

---

*Research completed: 2026-05-11*
*Ready for roadmap: yes*
*Synthesis basis: 4 research dimensions (STACK/FEATURES/ARCHITECTURE/PITFALLS)*
*Note for roadmapper: Phase ordering is strict 20 → 21 → 22 → 23 → 24. Phase 24 is highest risk and requires adversarial plan review. The 4 resolved disagreements between research files are load-bearing decisions — do not re-open without explicit deliberation.*
