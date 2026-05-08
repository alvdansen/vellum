# Requirements: VFX Familiar — Milestone v1.2 Visual & Conversational Dashboard

**Defined:** 2026-04-30
**Driver:** Direct VFX artist feedback from Timothy Paul Bielec (2026-04-30): "VFX artists are very visual learners (no surprise huh?) so if you could feature thumbnails for the Project or Shot Asset below, that would be very helpful. Also different sorting options so you can pull up latest generations quickly in the dropdown folder structure would be neat. It would be really cool if the 'Summary' didn't just list the nodes, but instead provided an intelligent summary of the asset and the workflow that was used to make it. Make it feel conversational like a Supervisor or Lead wrote it."
**Thesis:** v1.0 captured private provenance; v1.1 made it cryptographically signed and verifiable; v1.2 makes it *legible* to VFX artists. Replace text-heavy node listings with thumbnails on Project/Shot Asset cards, smart-sortable folder dropdowns (latest-first by default), and AI-written conversational summaries grounded in the structured provenance graph.

## v1.2 Requirements

Each requirement maps to a single roadmap phase. User-centric, atomic, and testable.

### Visual Thumbnails (VIS)

- [x] **VIS-01**: User sees a 16:9 thumbnail on every completed-version asset card in the side list and main grid without clicking through. Thumbnails are lazy-loaded (`loading="lazy"`) with explicit width/height for layout-shift-free rendering (CLS=0). Image-output thumbnails resize to a small WebP via `sharp` and cache atomically (temp + rename) at `<outputsDir>/<versionId>/<filename>.thumb.webp`.
- [x] **VIS-02**: User sees a `<SkeletonThumbnail/>` placeholder for in-progress / loading / failed-to-generate versions. No broken image icons; no empty boxes; no "image not found" surface.
- [x] **VIS-03**: User can click a thumbnail to view the full-size asset (existing `/api/versions/:id/output` route — preserved).
- [x] **VIS-04**: User sees an MP4 video's first representative frame as the thumbnail (extracted server-side via `@ffmpeg-installer/ffmpeg` with `-vf thumbnail` filter). Brightness-threshold fallback to 1.0s seek if the thumbnail filter selects a black frame.
- [x] **VIS-05**: User sees the latest *completed* version's thumbnail on the shot card (Frame.io stack convention) — falls back gracefully when latest is in-progress.
- [x] **VIS-06**: User sees a small C2PA shield icon overlay on the thumbnail for cryptographically-signed versions (driven by Phase 14's manifest_signed event presence).

### Sortable Folder Dropdown (SORT)

- [x] **SORT-01**: User opens the version grid and sees versions sorted "latest first" (most recently completed at top) by default.
- [x] **SORT-02**: User can change the sort via a dropdown control: Latest, Oldest, Name A→Z, Version ↓. Engine-side ORDER BY with whitelisted enum (`completed_at | created_at | name | version_number` × `asc | desc`).
- [x] **SORT-03**: User's sort preference persists per scope across browser sessions via `localStorage` with bounded keys (LRU eviction at quota); URL state mirror for shareable views.
- [x] **SORT-04**: User opens the tree sidebar (folder hierarchy: workspace → project → sequence → shot) and sees children sorted A→Z by default (smart default per scope — artists know names, not creation dates, in the tree).
- [x] **SORT-05**: Pagination remains stable when sort changes — no duplicate items across pages, no skipped items. Composite cursor `(sort_key_value, version_id)` — `version_id` is the stable nanoid tiebreaker. Sort change resets cursor to page 1.

### AI Conversational Summary (SUM)

- [ ] **SUM-01**: User opens the VersionDrawer and sees a 2-4 sentence Supervisor/Lead-voice summary of the asset and the workflow that made it (instead of a raw node listing). Tone: declarative, present tense, conversational. Example: "v003 is a tighter close-up of the dragon's eye, generated with Flux + the cinematic_fantasy LoRA at seed 42, swapping the wide-angle env map for a HDRI from the parent shot."
- [ ] **SUM-02**: Summary mentions the model name + parent version + key prompt deltas when the version is iterate-lineage (verified via output-validation regex against `models_json` — at least one model name appears verbatim).
- [ ] **SUM-03**: Summary respects redaction — when the version's manifest carries `redacted: true`, the summary uses only surviving fields and explicitly tags the disclosure (e.g., "(some prompt fields were redacted)"). Cache key includes `manifest_sha256` so redact gives free invalidation.
- [ ] **SUM-04**: User can click "Regenerate" to refresh the summary (throttled to 1/min server-side; 500ms debounce client-side).
- [ ] **SUM-05**: Summary loads from cache on second view without an LLM API call (cached by `manifest_sha256 + template_version + model_id`).
- [ ] **SUM-06**: User sees a graceful fallback when the LLM is down, the API key is missing, or a circuit breaker has tripped: "(AI summary unavailable; showing structured details)" + the existing raw provenance display.
- [ ] **SUM-07**: Raw provenance details (existing node list, prompt JSON, models, seed) remain available in the drawer collapsed under a "Show provenance details" disclosure — table stakes; v1.0/v1.1 functionality preserved.

## Future Requirements

Carried forward from v1.0/v1.1 archives — deferred past v1.2 unless explicitly pulled in:

- **C2PA hardening (v1.3 candidate)**: HSM/Yubikey signing, multi-CA / federated trust roots, cryptographic sidecar manifests for EXR/PSD when c2pa-node exposes the sidecar API, sidecar HTTP route + dashboard download link, IPAdapter pack node-variants audit, fetch control image bytes from ComfyUI Cloud input store at sign time, parent-bytes LRU cache, full ingredient mirror in redacted manifests, redaction path size-guard symmetry, streaming-friendly C2PA for live video, in-dashboard manifest editor.
- **ROUTE-01..03** Multi-backend routing across ComfyUI instances by capability with failover.
- **ADAPT-01..03** OpenAI-compatible function-calling REST adapter for non-MCP agents.
- **ADV-01..04** Advanced operations (batch shot queuing, webhooks, hierarchy export, lineage graph visualization).

## Out of Scope (v1.2 explicit exclusions)

| Feature | Reason |
|---------|--------|
| Vision-model "describe the rendered image" summaries | THE anti-feature. CLIP/BLIP/Gemini-vision summaries hallucinate pixel content. The provenance graph IS the ground truth — structural input prevents hallucination by design. |
| Hover-to-scrub video preview | Bandwidth cost; nice-to-have; defer to v1.3+ when usage data justifies. |
| Streaming summary UX (SSE) | Wiring complexity adds risk; non-streaming with fast cache hit is the right v1.2 default. Defer to v1.3+. |
| Summary translation (multi-language) | Defer to v1.3 — clean 5-task plan once usage signals demand it. |
| Summary editing in dashboard | Append-only contract; user-edited summaries blur captured-fact vs. human-rewrite. |
| New top-level MCP tool for summary or thumbnail | Tool count holds at 7 of 12. Agents read structured provenance, not 4-sentence English. Thumbnails are HTTP-only. |
| Per-shot sort persistence | Start global; evaluate per-shot in v1.3 from user feedback. Avoids over-design. |
| "Recently active" sort / tag-recency sort | Defer to v1.3 — needs supporting telemetry that doesn't exist yet. |
| Auto-enhanced thumbnails (sharpen / contrast / denoise) | VFX artists need faithful previews of actual renders. Auto-enhance distorts provenance. |
| Branched-lineage narrative coherence across summaries | v1.2 ships independent per-version summaries. Cross-summary intelligence (e.g., "this is the bright-eye branch vs. the wide-shot branch") deferred to v1.3. |
| AI-generated alt text on thumbnails | Provenance graph already encodes what the asset is; alt text from grounded provenance is a v1.3 candidate. |

## Cross-Cutting Constraints

These are non-negotiable invariants preserved from v1.0 + v1.1:

- **Tool cap holds at 7 of 12** — v1.2 adds zero new top-level MCP tools. All functionality is dashboard-facing (HTTP) + transparent server-side enrichment.
- **Append-only provenance** — summary cache lives in a new `summary_generated_json` column on the existing `provenance` table (single migration 0007). Zero UPDATE/DELETE on the provenance table.
- **Architecture-purity** — `@anthropic-ai/sdk` imports restricted to `src/engine/summary/anthropic-client.ts`; `sharp` to `src/engine/thumbnails/image-thumbnail.ts`; `@ffmpeg-installer/ffmpeg` to `src/engine/thumbnails/video-thumbnail.ts`. Allowed-set extension mirrors v1.1's `c2pa-node` pattern (sorted-array deepEqual exact membership in `architecture-purity.test.ts`).
- **Dual-transport parity** — any new HTTP route that touches the engine layer must function identically over stdio + Streamable HTTP at the engine boundary (no new MCP tool actions, but engine facade must be callable from both transports for future tool-action introduction).
- **Append-only-via-cache-table** — summary regeneration emits a NEW `summary_generated` event row keyed by `manifest_sha256`; never updates an existing row.
- **Adversarial review at plan stage** for Phase 19 (AI Conversational Summary) — mandatory per the v1.1 crypto-correctness gate pattern. Privacy + injection + API-key-leak class.
- **Multi-encoding leak scan** (UTF-8 + UTF-16LE + UTF-16BE + base64) extends to summary cache, thumbnail cache, error logs.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| VIS-01 | Phase 17 | Not started |
| VIS-02 | Phase 17 | Not started |
| VIS-03 | Phase 17 | Not started |
| VIS-04 | Phase 17 | Not started |
| VIS-05 | Phase 17 | Not started |
| VIS-06 | Phase 17 | Not started |
| SORT-01 | Phase 18 | Complete |
| SORT-02 | Phase 18 | Complete |
| SORT-03 | Phase 18 | Complete |
| SORT-04 | Phase 18 | Complete |
| SORT-05 | Phase 18 | Complete |
| SUM-01 | Phase 19 | Not started |
| SUM-02 | Phase 19 | Not started |
| SUM-03 | Phase 19 | Not started |
| SUM-04 | Phase 19 | Not started |
| SUM-05 | Phase 19 | Not started |
| SUM-06 | Phase 19 | Not started |
| SUM-07 | Phase 19 | Not started |

**Coverage:**
- v1.2 requirements: 18 total (6 VIS + 5 SORT + 7 SUM)
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-04-30 — v1.2 Visual & Conversational Dashboard milestone start. Pivoted from tentatively-scoped C2PA Hardening (v1.1 close) based on direct VFX artist user-demand signal. C2PA hardening shifts to v1.3+ candidate scope.*
