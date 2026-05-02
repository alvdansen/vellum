# Roadmap: VFX Familiar

## Overview

VFX Familiar delivers an MCP server that brings production VFX pipeline structure to AI-powered generative content via ComfyUI Cloud. Each milestone delivers a complete, independently verifiable capability set.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-04-28). Full archive: `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`.
- ✅ **v1.1 Provenance Verification (C2PA)** — Phases 10-16 (shipped 2026-04-30). 7 phases, 24 plans, 10 requirements (7 PROV-V + 3 DEMO). Full archive: `milestones/v1.1-ROADMAP.md`, `milestones/v1.1-REQUIREMENTS.md`, `milestones/v1.1-MILESTONE-AUDIT.md`.
- 🚧 **v1.2 Visual & Conversational Dashboard** — Phases 17-19 (started 2026-04-30). 3 phases, 18 requirements (6 VIS + 5 SORT + 7 SUM). In planning.

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

### v1.2 Visual & Conversational Dashboard (Phases 17-19) — IN PROGRESS

**3 phases, 18 requirements (6 VIS + 5 SORT + 7 SUM). Strict sequential ordering 17 → 18 → 19 (low-risk visual wins first; LLM dependency last to derisk).**

- [ ] **Phase 17: Visual Thumbnails** — Lazy-loaded 16:9 thumbnails on every completed-version asset card with C2PA-shield overlay, MP4 first-frame extraction, atomic disk cache, redact-invalidation hook.
- [ ] **Phase 18: Sortable Folder Dropdown** — Latest-first default sort + 4-option dropdown control with localStorage persistence + URL state mirror; smart-default-per-scope (tree=A→Z, version grid=latest); composite-cursor pagination stability.
- [ ] **Phase 19: AI Conversational Summary** — Supervisor/Lead-voice 2-4 sentence summary grounded in prompt blob + ingredient graph + model fingerprints; cached by `manifest_sha256`; circuit breaker + graceful fallback. **Adversarial review mandatory at plan stage.**

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
**Plans:** 5 plans

Plans:
**Wave 1**
- [ ] 17-01-PLAN.md — Engine: image pipeline (sharp) + format-router + cache + arch-purity (sharp) + leak-scan extension

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 17-02-PLAN.md — Engine: video pipeline (@ffmpeg-installer/ffmpeg) + arch-purity (ffmpeg)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 17-03-PLAN.md — Engine facade (generateThumbnail/invalidateThumbnail) + HTTP route (GET/HEAD) + Phase 16 redact-invalidation hook

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 17-04-PLAN.md — Dashboard: <Thumbnail/> + <C2paShield/> components + getThumbnailUrl + copy.ts (license verification checkpoint)

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 17-05-PLAN.md — Dashboard wiring: VersionCard + TreeSidebar shot rows + HomeView latestCompletedVersion + full-suite regression
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
**Plans**: TBD
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
**Plans**: TBD
**UI hint**: yes

## Future Milestones

- **v1.3 C2PA Hardening** (candidate scope): HSM/Yubikey signing, multi-CA / federated trust roots, cryptographic sidecar manifests for EXR/PSD when c2pa-node exposes the sidecar API, sidecar HTTP route + dashboard download link, IPAdapter pack node-variants audit, fetch control image bytes from ComfyUI Cloud input store at sign time, parent-bytes LRU cache, full ingredient mirror in redacted manifests, redaction path size-guard symmetry. (Pivoted from tentatively-scoped v1.2; see PROJECT.md "Pivot context".)
- **v1.3 candidates carried from v1.2 deferrals**: hover-to-scrub video preview, streaming summary UX (SSE), summary translation (multi-language), per-shot sort persistence, branched-lineage narrative coherence across summaries, AI-generated alt text on thumbnails.
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
| 17    | v1.2      | 0/5   | In planning | -          |
| 18    | v1.2      | 0/0   | Not started | -          |
| 19    | v1.2      | 0/0   | Not started | -          |
