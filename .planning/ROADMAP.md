# Roadmap: VFX Familiar

## Overview

VFX Familiar delivers an MCP server that brings production VFX pipeline structure to AI-powered generative content via ComfyUI Cloud. Each milestone delivers a complete, independently verifiable capability set.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-04-28). Full archive: `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`.
- ✅ **v1.1 Provenance Verification (C2PA)** — Phases 10-16 (shipped 2026-04-30). 7 phases, 24 plans, 10 requirements (7 PROV-V + 3 DEMO). Full archive: `milestones/v1.1-ROADMAP.md`, `milestones/v1.1-REQUIREMENTS.md`, `milestones/v1.1-MILESTONE-AUDIT.md`.
- ✅ **v1.2 Visual & Conversational Dashboard** — Phases 17-19 (shipped 2026-05-09). 3 phases, 18 requirements (6 VIS + 5 SORT + 7 SUM). Full archive: see Phase 17-19 details below.
- 🚧 **v1.3 Production Shot Grid** — Phases 20-24 (started 2026-05-11). 5 phases, 22 requirements (5 STAT + 5 GRID + 5 REV + 3 OVR + 4 POL). In planning.

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-9) — SHIPPED 2026-04-28</summary>

**5 functional phases + 4 gap-closure phases. 46 plans, all verified green.**

- [x] Phase 1: Foundation & Hierarchy (3/3 plans) — completed 2026-04-20
- [x] Phase 2: ComfyUI Generation (3/3 plans) — completed 2026-04-21
- [x] Phase 3: Provenance & Versioning (3/3 plans) — completed 2026-04-22
- [x] Phase 4: Asset Management (5/5 plans) — completed 2026-04-22
- [x] Phase 5: Web Dashboard (13/13 plans) — completed 2026-04-23
- [x] Phase 6: Dashboard Wire Quality [GAP CLOSURE] (7/7 plans) — completed 2026-04-24
- [x] Phase 7: ComfyUI Endpoint Reconciliation [GAP CLOSURE] (8/8 plans) — completed 2026-04-24
- [x] Phase 8: Documentation Attribution Backfill [GAP CLOSURE] (3/3 plans) — completed 2026-04-25
- [x] Phase 9: Nyquist Wave 0 Closure [GAP CLOSURE] (1/1 plan) — completed 2026-04-28

</details>

<details>
<summary>✅ v1.1 Provenance Verification (C2PA) (Phases 10-16) — SHIPPED 2026-04-30</summary>

**7 phases, 24 plans, 10 requirements (7 PROV-V + 3 DEMO). All verified green. Adversarial codex-substitute review caught 5 BLOCKERS + 6 CONCERNS at planning stage; all closed before execute.**

- [x] Phase 10: Migrate-on-boot Hardening (3/3 plans) — completed 2026-04-30
- [x] Phase 11: Recovery Poller Error Detail (2/2 plans) — completed 2026-04-30
- [x] Phase 12: Reproduce Divergence Transparency (2/2 plans) — completed 2026-04-30
- [x] Phase 13: Model Fingerprinting (3/3 plans) — completed 2026-04-30
- [x] Phase 14: C2PA Signed Manifest Emission (5/5 plans) — completed 2026-04-30
- [x] Phase 15: Ingredient Graph (4/4 plans) — completed 2026-04-30
- [x] Phase 16: Redaction & Agent Surface (5/5 plans) — completed 2026-04-30

**Test trajectory:** 760 (v1.0 close) → 1365 (post-Phase-16) = +605 net new tests. Tool count holds at 7 of 12 cap; `version` action count grew 4 → 7 (added export_manifest + verify_manifest + redact_manifest).

</details>

### v1.2 Visual & Conversational Dashboard (Phases 17-19) — SHIPPED 2026-05-09

**3 phases, 18 requirements (6 VIS + 5 SORT + 7 SUM). Strict sequential ordering 17 → 18 → 19 (low-risk visual wins first; LLM dependency last to derisk).**

- [x] **Phase 17: Visual Thumbnails** — Lazy-loaded 16:9 thumbnails on every completed-version asset card with C2PA-shield overlay, MP4 first-frame extraction, atomic disk cache, redact-invalidation hook. (completed 2026-05-02)
- [x] **Phase 18: Sortable Folder Dropdown** — Latest-first default sort + 4-option dropdown control with localStorage persistence + URL state mirror; smart-default-per-scope (tree=A→Z, version grid=latest); composite-cursor pagination stability. (completed 2026-05-08)
- [x] **Phase 19: AI Conversational Summary** — Supervisor/Lead-voice 2-4 sentence summary grounded in prompt blob + ingredient graph + model fingerprints; cached by `manifest_sha256`; circuit breaker + graceful fallback. **Adversarial review mandatory at plan stage.** (completed 2026-05-09)

## Phase Details

### Phase 17: Visual Thumbnails
**Goal**: VFX artists see rendered output thumbnails on every completed-version asset card without clicking through, including MP4 first-frame extraction and C2PA-signed shield overlays.
**Depends on**: Nothing in v1.2 (independent of Phase 18+19; builds on v1.0 Phase 5 dashboard surfaces + v1.1 Phase 14 C2PA signing event)
**Requirements**: VIS-01, VIS-02, VIS-03, VIS-04, VIS-05, VIS-06
**Success Criteria** (what must be TRUE):
  1. User opens the dashboard and sees a 16:9 lazy-loaded thumbnail on every completed-version asset card in the side list AND main grid (CLS=0; explicit width/height; image-output thumbnails resize to small WebP via `sharp` and cache atomically at `<outputsDir>/<versionId>/<filename>.thumb.webp`).
  2. User sees a `<SkeletonThumbnail/>` placeholder for in-progress / loading / failed-to-generate versions (no broken image icons, no empty boxes); clicking any rendered thumbnail opens the full-size asset via the existing `/api/versions/:id/output` route.
  3. User sees an MP4 video's first representative frame as the thumbnail (extracted server-side via `@ffmpeg-installer/ffmpeg` `-vf thumbnail` filter, with brightness-threshold fallback to a 1.0s seek when the picked frame is black) AND the latest *completed* version's thumbnail surfaces on the shot card (Frame.io stack convention; falls back gracefully when latest is in-progress).
  4. User sees a small C2PA shield icon overlay on the thumbnail for cryptographically-signed versions (driven by Phase 14's `manifest_signed` event presence) AND a redact event (Phase 16) invalidates the cached thumbnail before the next read serves stale bytes.
**Plans:** 5/5 plans complete

Plans:
**Wave 1**
- [x] 17-01-PLAN.md — Engine: image pipeline (sharp) + format-router + cache + arch-purity (sharp) + leak-scan extension

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 17-02-PLAN.md — Engine: video pipeline (@ffmpeg-installer/ffmpeg) + arch-purity (ffmpeg)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 17-03-PLAN.md — Engine facade (generateThumbnail/invalidateThumbnail) + HTTP route (GET/HEAD) + Phase 16 redact-invalidation hook

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 17-04-PLAN.md — Dashboard: <Thumbnail/> + <C2paShield/> components + getThumbnailUrl + copy.ts (license verification checkpoint)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 17-05-PLAN.md — Dashboard wiring: VersionCard + TreeSidebar shot rows + HomeView latestCompletedVersion + full-suite regression
**UI hint**: yes

### Phase 18: Sortable Folder Dropdown
**Goal**: VFX artists can pull up latest generations quickly via a sort dropdown that defaults to "latest first" on the version grid and "A→Z" on the tree sidebar, with sort preference persisted across browser sessions.
**Depends on**: Phase 17 (slots cleanly into the dashboard surfaces with thumbnails in place; reuses VersionCard layout patterns)
**Requirements**: SORT-01, SORT-02, SORT-03, SORT-04, SORT-05
**Success Criteria** (what must be TRUE):
  1. User opens the version grid and sees versions sorted "latest first" (most recently completed at top) by default; user opens the tree sidebar (workspace → project → sequence → shot) and sees children sorted A→Z by default (smart default per scope — artists know names, not creation dates, in the tree).
  2. User can change the sort via a dropdown control with 4 options (Latest, Oldest, Name A→Z, Version ↓); engine-side ORDER BY uses a whitelisted enum (`completed_at | created_at | name | version_number` × `asc | desc`) — no SQL injection surface.
  3. User's sort preference persists per scope across browser sessions via `localStorage` (bounded keys with LRU eviction at quota) AND is mirrored in URL state for shareable views.
  4. Pagination remains stable when sort changes — no duplicate items across pages, no skipped items — via composite cursor `(sort_key_value, version_id)` where `version_id` is the stable nanoid tiebreaker; sort change resets cursor to page 1.
**Plans**: 5 plans

Plans:
**Wave 1**
- [x] 18-01-PLAN.md — Engine sort foundations (sort.ts: whitelist enum + ORDER BY composers + cursor encode/decode + WHERE-after-cursor)

**Wave 2** *(parallel — both depend on Wave 1; no file overlap)*
- [x] 18-02-PLAN.md — Version repo cursor migration (listByShot → composite-cursor pagination; pipeline.ts facade; transitional shim in dashboard-routes.ts)
- [x] 18-04-PLAN.md — Dashboard primitives (sortTypes mirror + sortHelpers state machine + LRU + comparator + SortDropdown WAI-ARIA combobox + LoadMoreButton)

**Wave 3** *(blocked on 18-02)*
- [x] 18-03-PLAN.md — Hierarchy sort + HTTP routes (hierarchy-repo opts.sort + Engine facade + Zod whitelist parsing in dashboard-routes.ts; removes 18-02 transitional shim)

**Wave 4** *(blocked on 18-03 + 18-04)*
- [x] 18-05-PLAN.md — HomeView integration + verification (state signals + lib/api migration + two SortDropdown instances + LoadMoreButton + paginated buffer + tree client-side re-sort + full-suite regression)
**UI hint**: yes

### Phase 19: AI Conversational Summary
**Goal**: VFX artists open the VersionDrawer and read a 2-4 sentence Supervisor/Lead-voice summary of the asset and the workflow that made it (instead of a raw node listing), grounded in structured provenance with zero vision-model inference.
**Depends on**: Phase 17 + Phase 18 (ships LAST as the highest-risk phase; LLM dependency derisks after visual wins are locked)
**Requirements**: SUM-01, SUM-02, SUM-03, SUM-04, SUM-05, SUM-06, SUM-07
**Success Criteria** (what must be TRUE):
  1. User opens the VersionDrawer and sees a 2-4 sentence Supervisor/Lead-voice summary (declarative, present tense, conversational) — e.g., "v003 is a tighter close-up of the dragon's eye, generated with Flux + the cinematic_fantasy LoRA at seed 42, swapping the wide-angle env map for a HDRI from the parent shot." For iterate-lineage versions the summary mentions the model name + parent version + key prompt deltas (output validation regex requires verbatim model name from `models_json`).
  2. User views a previously-summarized version a second time and the summary loads from cache without an LLM API call (cache key = `manifest_sha256 + template_version + model_id`); user clicks "Regenerate" to refresh (server-side throttled to 1/min; client-side debounced 500ms).
  3. User views a redacted version and the summary uses ONLY surviving fields and explicitly tags the disclosure (e.g., "(some prompt fields were redacted)") — redact event invalidates cache for free because cache key includes `manifest_sha256`.
  4. User sees a graceful fallback when the LLM is down, the API key is missing, or the circuit breaker has tripped: "(AI summary unavailable; showing structured details)" + the existing raw provenance display — no broken UI surface, no leaked error message containing API keys (verified via `flattenAnthropicError` helper + multi-encoding leak negative test).
  5. Raw provenance details (existing node list, prompt JSON, models, seed) remain available in the drawer collapsed under a "Show provenance details" disclosure — v1.0/v1.1 functionality preserved as table stakes; tool count stays at 7 of 12 (no new top-level MCP tools added).
**Plans**: 8 plans

Plans:
**Wave 1**
- [x] 19-01-PLAN.md — Foundation: Anthropic config + boot validation + arch-purity allowed-set + Migration 0007 + ProvenanceRepo accessors + SDK pin

**Wave 2** *(parallel — both depend on Wave 1; no file overlap)*
- [x] 19-02-PLAN.md — Pure helpers: sanitizer + validation + deterministic-template
- [x] 19-03-PLAN.md — Pure helpers: template + few-shot examples + circuit-breaker

**Wave 3** *(blocked on Waves 1+2+3)*
- [x] 19-04-PLAN.md — Anthropic client (sole-importer + lazy-import + retry policy + flattenAnthropicError) + Engine.summarizeVersion 8-outcome facade

**Wave 4** *(blocked on Wave 3)*
- [x] 19-05-PLAN.md — HTTP routes (GET + POST regenerate + 60s throttle) + dashboard signal/state + lib/api.ts helpers

**Wave 5** *(blocked on Wave 4)*
- [x] 19-06-PLAN.md — Dashboard components (SummarySection + RegenerateButton) + VersionDrawer integration + 11 copy constants

**Wave 6** *(parallel — both depend on Wave 4 OR 5; no file overlap)*
- [x] 19-07-PLAN.md — Eval suite (12 fixtures × 9 dimensions per AI-SPEC §5) + CI integration
- [x] 19-08-PLAN.md — E2E adversarial tests (redact-cache-invariant + leak-scan + prompt-injection) + telemetry per AI-SPEC §7 + HUMAN-UAT.md + ADVERSARIAL-REVIEW.md
**UI hint**: yes

### v1.3 Production Shot Grid (Phases 20-24) — IN PLANNING

**5 phases, 22 requirements (5 STAT + 5 GRID + 5 REV + 3 OVR + 4 POL). Strict ordering 20 → 21 → 22 → 23 → 24. Phase 24 is highest-risk and requires adversarial review checklist before execute.**

- [x] **Phase 20: Shot Status Engine** — Migration 0008 (ALTER TABLE shots + CREATE TABLE shot_status_events + 4 indexes), `shot-status-repo.ts`, 3 `shot` tool arms (`set_status | get_status | list_status_history`), `shot.status_changed` SSE event type, `ShotStatus` TypeScript type. Pure backend, no dashboard changes. **(Planned — 4 plans ready)** (completed 2026-05-12)
- [ ] **Phase 21: Shot Grid View** — `GET /api/sequences/:id/shot-grid` endpoint, `ShotGridView.tsx`, `ShotGridCard.tsx`, `ShotStatusPill.tsx`, `activeView` signal, sequence-grouped layout, status filter bar, "Show omitted" toggle, TreeSidebar grid-icon navigation. (Not started — requires Phase 20)
- [ ] **Phase 22: Review and Approval** — Review panel with approve/retake/hold/omit/restore actions + confirmation popovers, notes per status change (append-only), two-panel A/B version comparison (any two versions, thumbnails preloaded in parallel), inline quick-approve from grid. (Not started — requires Phase 20)
- [x] **Phase 23: Production Stats** — Sequence-level stats widget (% approved, status counts, pending-review backlog, stale-shot detection at 14 days), SSE-driven counter update on `shot.status_changed`, single GROUP BY query — no N+1. (Not started — requires Phase 20 + 21) (completed 2026-05-12)
- [ ] **Phase 24: UX Polish Bundle** — Sprite sheet lazy generation + CSS scrub in `ShotGridCard`, hover-to-zoom for image stills, SSE token streaming for AI Regenerate path (`void + .catch()` universally applied, AbortController wired), per-shot sort persistence, cross-version comparison summary in A/B panel. **Adversarial review required at plan stage.** (Not started — requires Phase 20; sequential after 23 to avoid file conflicts)

## Phase Details (v1.3)

### Phase 20: Shot Status Engine
**Goal**: Backend foundation for production status tracking — the mutable `shots.status` column, the append-only `shot_status_events` audit table, transactional write discipline, MCP tool arms, and SSE push. All subsequent v1.3 phases depend on this.
**Depends on**: Nothing in v1.3 (pure backend, builds on Phase 19 foundation)
**Requirements**: STAT-01, STAT-02, STAT-03, STAT-04, STAT-05
**Success Criteria** (what must be TRUE):
  1. Migration 0008 runs cleanly on a fresh DB and on a DB with existing shots — existing shots receive `status = 'wip'` default; `shot_status_events` is empty for all pre-migration shots.
  2. `shot.set_status` tool arm writes UPDATE + INSERT in a single transaction; `db.transaction()` is the implementation pattern (not two sequential awaits). A shot with zero history rows returns `{ status: 'wip', history: [] }` from `shot.get_status` — no null, no throw.
  3. `shot.status_changed` SSE event fires on every status change and includes `{ shotId, fromStatus, toStatus, changedBy, note? }`. Tool count remains at 7 (`tool-budget.test.ts` assertion green).
  4. Grep test confirms `UPDATE shot_status_events` returns zero matches in `src/` (append-only invariant enforced in CI).
  5. 4 indexes exist in migration 0008: `idx_shots_status`, `idx_shot_status_events_shot_time`, `idx_shots_cursor`, and one additional covering index.
**Plans:** 4/4 plans complete

Plans:
**Wave 1**
- [x] 20-01-PLAN.md — Foundation: ShotStatus type + SHOT_STATUSES const + Shot.status field + 'sse' IdPrefix + shotStatusEvents Drizzle table + shots.status column + migration 0008 SQL + journal entry

**Wave 2** *(parallel — both depend on Wave 1; no file overlap)*
- [x] 20-02-PLAN.md — Store: shot-status-repo.ts (insertStatusEvent transactional dual-write + getStatusHistory + getCurrentStatus null-coalesce + STALE_SHOT_DAYS) + repo test file
- [x] 20-03-PLAN.md — Events+SSE: ShotStatusChangedPayload + EngineEventMap extension + EVENT_TYPES extension + toDashboardPayload case

**Wave 3** *(blocked on Waves 1+2)*
- [x] 20-04-PLAN.md — Integration: pipeline facade (setShotStatus/getShotStatus/listShotStatusHistory) + shot-tool 3 new arms + architecture-purity tests + shot-tool-status tests + [BLOCKING] drizzle-kit push + full suite regression

### Phase 21: Shot Grid View
**Goal**: Primary v1.3 user surface — VFX artists navigate to a sequence and see all shots in a visual grid with status badges, thumbnails, and filter controls.
**Depends on**: Phase 20 (status column + SSE event must exist)
**Requirements**: GRID-01, GRID-02, GRID-03, GRID-04, GRID-05
**Success Criteria** (what must be TRUE):
  1. User clicks grid icon in TreeSidebar for a sequence and `activeView` switches to `'shot-grid'`; home view is preserved and reachable from home icon. No router library is added.
  2. `GET /api/sequences/:id/shot-grid` executes a single SQL query (verified by sqlite3 `EXPLAIN QUERY PLAN` — no N+1 subquery per row) and returns shot rows with status, latest-completed-version thumbnail URL, and version count.
  3. Shot grid renders with CSS Grid `minmax(220px, 1fr)`; each card has a 16:9 aspect-ratio container; lazy-loaded thumbnail (`loading="lazy"`) with explicit width/height for CLS=0.
  4. Status filter bar filters to single-status views client-side (no re-fetch); "Show omitted" toggle reveals `omit`-status shots with dimmed treatment (`opacity-40`).
  5. SSE `shot.status_changed` event updates the affected card's status badge in-place; no full grid re-fetch; open VersionDrawer panels are not disrupted (keyed on `shotId`).
**Plans:** TBD (estimated 4-5 plans)
**UI hint**: yes

### Phase 22: Review and Approval
**Goal**: VFX supervisors approve, retake, hold, or omit shots from a review panel; compare two versions side-by-side; quick-approve directly from the grid.
**Depends on**: Phase 20 (status engine + event log)
**Requirements**: REV-01, REV-02, REV-03, REV-04, REV-05
**Success Criteria** (what must be TRUE):
  1. Review panel opens as VersionDrawer-style overlay; each status-transition action (Approve, Request Retake, Hold, Omit) shows a confirmation popover before committing — no bare one-click transitions.
  2. Quick-approve from shot grid card shows inline confirmation popover; on confirm, status optimistically updates in the signal, then PATCH confirms; on error, status reverts and shows error indicator.
  3. A/B comparison view loads any two user-selected versions; both thumbnails are preloaded via `new Image().src` before the comparison panel mounts (no sequential flash).
  4. "Restore Shot" action in review panel is available only when `currentStatus === 'omit'`; writes `{ to_status: 'wip', note: 'Restored from omit' }` to `shot_status_events`.
  5. Notes stored as `null` (not empty string) when no note provided; notes displayed in timeline with `changed_by` attribution.
**Plans:** TBD (estimated 4-5 plans)
**UI hint**: yes

### Phase 23: Production Stats
**Goal**: Sequence-level production stats widget giving supervisors an at-a-glance view of approval progress, backlog, and stale shots.
**Depends on**: Phase 20 + Phase 21 (stats appear in ShotGridView header)
**Requirements**: OVR-01, OVR-02, OVR-03
**Success Criteria** (what must be TRUE):
  1. Stats widget appears in `ShotGridView` header showing total shots, % approved, per-status counts, pending-review backlog. Stats computed via single `GROUP BY` query (verified by EXPLAIN — no per-shot subquery).
  2. Stale shot cards display amber "Stale" indicator for shots with `status IN ('wip','pending-review')` and no completed version in last 14 days. Threshold is `STALE_SHOT_DAYS = 14` named constant.
  3. Stats widget updates counters when `shot.status_changed` SSE event fires for a shot in the current sequence — no full re-fetch, signal-derived computed value.
**Plans:** TBD (estimated 2-3 plans)
**UI hint**: yes

### Phase 24: UX Polish Bundle
**Goal**: Deliver the four v1.2 deferrals plus one new enhancement — hover-to-scrub, SSE streaming regenerate, per-shot sort persistence, and cross-version comparison summary. Highest-risk phase; adversarial review mandatory at plan stage.
**Depends on**: Phase 20 (status engine); sequential after Phase 23 to avoid file conflicts with `sse.ts`, `video-thumbnail.ts`, `image-thumbnail.ts`
**Requirements**: POL-01, POL-02, POL-03, POL-04
**Success Criteria** (what must be TRUE):
  1. Hovering a video-source thumbnail in the shot grid triggers sprite sheet generation on first hover (lazy) — no sprite generated at version completion time. Sprite pipeline: ffmpeg `fps=1/2,scale=160:-1` → sharp composite → `.thumb.sprite.webp` + `.thumb.sprite.json`. CSS `background-position` scrub at 2s/frame. `invalidateCache` removes all 4 artifact files atomically.
  2. Clicking Regenerate on a version summary shows token streaming: `summary.delta` SSE frames arrive progressively; `summary.done` closes the stream. Every `sseStream.writeSSE()` uses `void + .catch(() => {})` — grep test confirms no bare `await sseStream.writeSSE(` in the streaming path. AbortController tied to `c.req.raw.signal` aborts the upstream Anthropic stream on disconnect.
  3. When `ANTHROPIC_API_KEY` is absent, streaming endpoint emits one `summary.delta` frame (static fallback text) then `summary.done` — no 500, no broken UI.
  4. Per-shot sort preference persists to `localStorage` key `sort:shot:${shotId}` (LRU cap 50 entries); restored on grid remount; sort change resets cursor to page 1.
  5. Adversarial review checklist passed before execute: (a) `void + .catch()` uniformity, (b) AbortController wiring, (c) sprite cache invalidation atomicity, (d) permanent fallback for absent API key.
**Plans:** TBD (estimated 4-5 plans)
**UI hint**: yes

## Future Milestones

- **v1.4 C2PA Hardening** (candidate scope): HSM/Yubikey signing, multi-CA / federated trust roots, cryptographic sidecar manifests for EXR/PSD when c2pa-node exposes the sidecar API, sidecar HTTP route + dashboard download link, IPAdapter pack node-variants audit, fetch control image bytes from ComfyUI Cloud input store at sign time, parent-bytes LRU cache, full ingredient mirror in redacted manifests, redaction path size-guard symmetry. (Pivoted from tentatively-scoped v1.2 then v1.3; see PROJECT.md "Pivot context".)
- **Multi-Backend Routing** (ROUTE-01..03) — route generation to specific ComfyUI instances by capability with failover.
- **Function-Calling Adapter** (ADAPT-01..03) — OpenAI-compatible REST endpoint for non-MCP agents.
- **Advanced Operations** (ADV-01..04) — batch queuing, webhooks, hierarchy export, lineage visualization.
- **Streaming-friendly C2PA for live video.**
- **In-dashboard manifest editor + cross-shot/cross-project manifest aggregation + watermarking channel** (separate, lower-priority surfaces).

## Progress

| Phase | Milestone | Plans | Status      | Completed  |
| ----- | --------- | ----- | ----------- | ---------- |
| 1-9   | v1.0      | 46/46 | Complete    | 2026-04-28 |
| 10-16 | v1.1      | 24/24 | Complete    | 2026-04-30 |
| 17    | v1.2      | 5/5   | Complete    | 2026-05-02 |
| 18    | v1.2      | 5/5   | Complete    | 2026-05-08 |
| 19    | v1.2      | 8/8   | Complete    | 2026-05-09 |
| 20    | v1.3      | 4/4 | Complete    | 2026-05-12 |
| 21    | v1.3      | 0/TBD | Not started | —          |
| 22    | v1.3      | 0/TBD | Not started | —          |
| 23    | v1.3      | 0/TBD | Not started | —          |
| 24    | v1.3      | 0/TBD | Not started | —          |
