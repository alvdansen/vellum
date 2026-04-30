# Feature Research — v1.2 Visual & Conversational Dashboard

**Domain:** AI-powered VFX pipeline management dashboard (Preact UI over MCP/HTTP server)
**Milestone:** v1.2 — Visual & Conversational Dashboard
**Researched:** 2026-04-30
**Confidence:** HIGH for thumbnails + sorting (well-trodden ground in Frame.io / Premiere / Resolve / ShotGrid). MEDIUM for AI summary (LLM-grounded-summary is established but the *Supervisor-voice* register is new, plus first LLM dependency in this codebase).
**Scope guard:** ONLY the three v1.2 features (thumbnails, sortable dropdowns, conversational summary) on top of the existing v1.0/v1.1 surfaces. Hierarchy navigation, VersionDrawer, asset query, C2PA badge, ingredient graph, model fingerprints — all built; this research does NOT re-litigate them.

---

## Executive Summary

Three features, three different complexity profiles:

1. **Thumbnails** — table-stakes for any visual creative tool. The interesting decisions are at the edges: video poster-frame extraction (MP4 outputs), in-progress placeholders, aspect-ratio handling (CLS), and where the thumbnail bytes physically live (server-cached vs. on-the-fly transcode). Reference standard: Frame.io stack thumbnail = highest-numbered version in the stack; Premiere/Resolve hover-scrub video; Notion gallery aspect-ratio choice. The existing `VersionCard` already renders an `<img>` tag from `getOutputUrl(version.id)` — that's full-size bytes today; v1.2 needs a thumbnail-sized variant route.

2. **Sortable dropdowns** — table-stakes UX with one *opinionated* default (latest-first). Frame.io defaults custom for Shares but offers six sort options for Review Links; ShotGrid lets you sort by any field on the entity spreadsheet; ownCloud users have asked for "remember per-folder sort" since 2015. The two real decisions are scope (per-folder vs. global) and persistence (localStorage vs. server-side preference). For VFX Familiar's single-artist scope, **localStorage with global default + per-scope override** is the right fit.

3. **Conversational summary** — differentiator. This is the feature that makes VFX Familiar feel like an *AI familiar* rather than a project tracker. The risk is hallucination — the summary MUST be grounded in structured provenance (Phase 13 fingerprints + Phase 15 ingredient graph + prompt blob diff against parent), not a "describe this image" vision-model call. Length 2–4 sentences. Cache by (versionId, prompt-hash) — never regenerate on page load. Streaming optional but recommended for perceived latency. Regenerate button: yes, throttled. Translation: deferred (anti-feature for v1.2).

---

## Feature 1 — Thumbnails on Project/Shot Asset Cards

### Table-stakes (every modern creative-tools dashboard does this)

| Feature | Spec | Complexity | Dependencies | Edge cases |
|---------|------|------------|--------------|------------|
| **Thumbnail on completed-version card** | Render rendered output as small image (~160×90 for shot grid, ~240×135 for side list); `loading="lazy"` + explicit width/height + `object-cover` to preserve aspect | Low | `getOutputUrl()` exists; just need a `?size=thumb` param + server-side resize | Output not yet downloaded from Cloud (status=running); output file deleted; non-image output (MP4) |
| **Skeleton placeholder during load** | `SkeletonThumbnail` component already shipped (160×90 default, shimmer animation, respects `prefers-reduced-motion`). Reuse for `status !== 'complete'` and pre-load state | Low | `SkeletonThumbnail.tsx` exists | None — primitive is solid |
| **Aspect-ratio reservation (CLS=0)** | Wrap `<img>` in `aspect-ratio: 16/9` container OR set `width=160 height=90` attrs on `<img>` directly. MUST be set before image bytes arrive | Low | CSS `aspect-ratio` has 96%+ browser support since 2021 | None |
| **Click-to-fullsize / open in new tab** | `<a href={getOutputUrl()} target="_blank">` already wraps the drawer image — extend pattern to cards | Low | Existing route | None |
| **Fallback for in-progress** | Show SkeletonThumbnail + StatusPill ("running" / "queued") instead of broken-image icon | Low | `StatusPill` exists | Status drift between SSE event and card render — current SSE adapter handles this |
| **Fallback for completed-but-no-output-on-disk** | Engine reports output_present from filesystem check; card shows "missing" placeholder (subtle warning icon, not red) | Medium | Engine.outputRoot is already public-readonly (Plan 05-12); add `output_present: boolean` field to Version DTO | output deleted between list-load and image-load — show stale image until refresh; that's fine |

### Differentiators (separates VFX Familiar from generic gallery dashboards)

| Feature | Spec | Complexity | Dependencies | Edge cases |
|---------|------|------------|--------------|------------|
| **MP4 first-frame thumbnail** | When output is a video, generate a static poster-frame JPEG once (server-side, on first request); cache to disk next to the output | Medium | `ffmpeg` system dep OR `@ffmpeg-installer/ffmpeg` npm wrapper for portable binary; new server module `src/engine/thumbnail.ts` | ffmpeg not on PATH (use installer); MP4 corrupted/incomplete; PSD/EXR (Phase 14 deferred) — punt to placeholder for v1.2 |
| **Hover-to-scrub video preview** | Hover over MP4 thumbnail = play first 1–2s muted/looped (Frame.io / Premiere / Resolve standard) | Medium-High | Generated MP4 preview clip OR HTML5 `<video>` muted preload="metadata" with `play()` on `mouseenter` | Mobile (no hover) — falls back to tap; large MP4 = bandwidth cost; recommend deferring to a "preview clip" pre-generated alongside poster frame |
| **C2PA-signed badge overlay on thumbnail** | Tiny shield icon in corner if version has `manifest_signed` provenance event; click = open VersionDrawer with C2pa section focused | Low | C2paBadge component exists; reuse logic from Phase 14 Plan 04 | Manifest reaped; signing-status='unknown' → no overlay (don't crowd) |
| **Hover-to-zoom (image stills)** | 1.05× scale on hover with smooth transform; aria-disable for prefers-reduced-motion | Low | Pure CSS | None — modern UX baseline |
| **Highest-version-as-shot-card-thumbnail** | Shot row in TreeSidebar / shot grid uses the latest *completed* version's thumbnail (mirrors Frame.io version-stack default). When latest is in-progress, fall back to latest-completed | Medium | New endpoint `/api/shots/:id/representative-thumbnail` OR derived client-side from versions list | Shot has zero completed versions → SkeletonThumbnail with "no renders yet" copy |

### Anti-features (deliberately NOT shipping in v1.2)

| Anti-feature | Why avoid |
|--------------|-----------|
| **Auto-enhanced thumbnails (sharpen / contrast / denoise)** | VFX artists need the thumbnail to be a faithful preview of the actual render — any "enhancement" is a lie that bites them at review time |
| **AI-generated alt text on thumbnails** | C2PA-signed manifests + ingredient graph already encode what the asset is; alt text from a vision model would duplicate provenance with hallucinated content. Use deterministic alt: `Output for ${versionLabel}` (current pattern) |
| **Animated GIF previews of MP4** | Higher bandwidth than a poster JPEG, lower quality than `<video>` hover; pick one or the other, not both |
| **Multi-frame storyboard tile (4-up grid for video)** | Premiere does this; ShotGrid does this. For v1.2 it's a luxury — single poster frame ships value first |
| **Cross-shot thumbnail mosaic / contact sheet** | Out of scope — v1.2 is per-asset, per-card. Project-level visualization is a v1.3+ candidate |
| **Right-click "set custom poster frame"** | Premiere has it; we don't need it — we have prompt blob + seed + parent so the rendered output IS the canonical preview |
| **Thumbnail caching CDN / signed URLs** | Single-artist, local-process scope — `/api/versions/:id/output?size=thumb` with `ETag` + `Cache-Control: max-age=3600` is sufficient |

### Implementation notes

- **Server route shape:** Extend existing `/api/versions/:id/output` with a `?size=thumb` (or `?width=160`) query param. New code path resizes (sharp / @ffmpeg-installer for video) and caches under `${outputRoot}/${versionId}/.thumb-${width}.${ext}` with atomic mkstemp+rename (mirrors the Phase 14 download write pattern).
- **Bytes pipeline:** First request triggers resize; subsequent requests stream from cache. Add `X-Thumbnail-Generated: live|cached` debug header. `If-None-Match` ETag for browser cache hits.
- **Aspect ratio:** All thumbnails landed at 16:9 in the UI (default), but `object-fit: cover` lets vertical / square renders work. Don't pad with letterbox — it makes the gallery feel un-watched.
- **Bundle impact:** Pure CSS for hover-zoom + Preact for state. No new client libs needed. Server-side adds `sharp` (~10 MB) for image resize and `@ffmpeg-installer/ffmpeg` (~70 MB) for video — that's the cost. Document it in STACK.md.

---

## Feature 2 — Sortable Dropdown Folder Structure

### Table-stakes

| Feature | Spec | Complexity | Dependencies | Edge cases |
|---------|------|------------|--------------|------------|
| **Latest-first default sort** | All hierarchy lists (workspaces, projects, sequences, shots, versions) sort newest-first by `created_at DESC` (versions also have `version_number DESC` available) | Low | Existing repos already query by id; need ORDER BY clauses + repo signature changes | Versions of same shot share same `created_at` (rare) → secondary key on `version_number DESC` |
| **Sortable column / dropdown UI** | Small dropdown in shot-grid header + folder-picker header. Options: Latest first / Oldest first / Name A→Z / Name Z→A / Version number ↓↑ (versions only) | Low | New `SortDropdown` component + state in HomeView | None |
| **Active sort indicator** | Selected sort visible in dropdown trigger label (e.g., "Sort: Latest"). Subtle, not in-your-face | Low | CSS only | None |
| **Per-list sort state** | Tree sort (workspaces/projects/sequences/shots) stays simple ("Latest" or "A→Z"); version grid has more options | Low | useState in HomeView (current pattern) | Multiple sidebars open — single global state collapses; expected behavior for single-artist scope |
| **Per-user persistence** | localStorage key `vfx-familiar:sort:${scope}` where scope = `tree` or `versions` or `versions:${shotId}` | Low | Plan 09 already has localStorage discipline (theme toggle); same pattern | localStorage disabled → fall back to in-memory + warning toast (rare) |

### Differentiators

| Feature | Spec | Complexity | Dependencies | Edge cases |
|---------|------|------------|--------------|------------|
| **"Recently active" sort** | Sort versions by `most-recently-touched` — latest of `created_at`, `completed_at`, `manifest_signed` event timestamp, or any provenance event for that version. Surfaces "what did I work on lately" not just "what was created lately" | Medium | Engine query joins provenance; new repo method `listVersionsByLastActivity` | Performance — provenance grows; index on (version_id, ts DESC) needed |
| **"Tag recency" sort** | Sort versions by latest tag-add timestamp on each version. Useful for "show me everything I tagged 'review'". | Medium | TagRepo already has `applied_at` (Phase 4); add ORDER BY join | None — pagination already wired |
| **Smart default per scope** | Tree sidebar defaults A→Z (artists know their project names better than dates); version grid defaults latest-first; folder pickers in MCP-tool dropdowns default latest-first. **Do NOT inflict a single global default** | Low | Scope-aware default constants | None |
| **Sort persists per-shot** | Versions sort preference can be per-shot (some shots have many small versions, others have 3 huge ones — different sort makes sense). Key: `vfx-familiar:sort:versions:${shotId}` | Medium | localStorage key namespacing | localStorage quota (5 MB typical) — not a concern for sort pref strings |

### Anti-features

| Anti-feature | Why avoid |
|--------------|-----------|
| **Multi-column sort (sort by status THEN created_at)** | Spreadsheet-grade UX; over-engineered for single-artist scope. If needed, the asset-query MCP tool already does multi-criterion via SQL |
| **Drag-to-reorder custom sort** | Frame.io has it; ShotGrid has it. Production-pipeline feature, not pipeline-management feature. Out of scope per PROJECT.md |
| **Sort in the SQL query AND on the client** | Pick one — client-side sort is fine for 20-version pages (default pagination). Anything bigger paginates server-side and the SQL ORDER BY is canonical |
| **Saved-sort presets ("My Sort 1", "My Sort 2")** | Premiere/Resolve have it; over-budget for v1.2. localStorage-persisted single-pref is enough |
| **Server-side "user preferences" table** | Single-artist single-process scope; localStorage is correct. Server-side preferences add an auth surface we don't have (PROJECT.md "Out of Scope: multi-user authentication") |
| **Sort by AI summary length / sentiment / mood** | Cute, useless, and the AI summary is per-version cached not pre-computed for cohorts |

### Implementation notes

- **Pagination interaction:** Sort changes invalidate paginated cursors. Keep sort + cursor as independent localStorage keys; sort change → reset cursor to 0.
- **Repo signatures:** Existing `listVersions(shotId)` etc. take no sort param today. Add optional `sort?: SortKey` (discriminated union: `'latest' | 'oldest' | 'name_asc' | 'name_desc' | 'version_desc' | 'version_asc' | 'last_activity'`). Default `'latest'` preserves existing call-site behavior.
- **MCP tool surface:** No new tool actions — sort is a dashboard concern. (If a future MCP-tool consumer wants sorted lists, they pass `sort` in the action args. Tool count stays at 7 of 12.)
- **Tree sort applies recursively:** When tree sort = "A→Z", it sorts at every level. When = "Latest", it sorts at every level by `created_at DESC`. Mixed-mode (workspaces A→Z but versions latest-first) is the smart-default-per-scope pattern.

---

## Feature 3 — AI-Generated Conversational Asset Summary

### What "Supervisor/Lead voice" actually means (citing VFX domain)

VFX supervisors annotate work in tight, declarative sentences with terminology that maps to the *next action* an artist would take. When a Lead writes a note, it's typically: identify the new thing, name the parent context, call out what changed, and (sometimes) cue the next step. Length: 2–4 sentences. Tone: confident, lightly informal, present tense. **No filler ("This image shows...")**, **no hedging ("This appears to be...")**, **no list of nodes** (which is exactly what the current "Summary" does and what artist feedback explicitly rejects).

Reference style:

> v003 is a tighter close-up of the dragon's eye, generated with Flux + the cinematic_fantasy LoRA at seed 42, swapping the wide-angle env map for the HDRI from the parent shot. The reflective scale detail came up cleaner than v002 — likely from the LoRA strength bump from 0.6 to 0.8.

That's the target. It's grounded entirely in: prompt blob diff vs. parent + model fingerprints + ingredient graph + sampler params. **Zero vision-model inference. Zero hallucination room.**

### Table-stakes (any modern AI-creative tool with summaries does this)

| Feature | Spec | Complexity | Dependencies | Edge cases |
|---------|------|------------|--------------|------------|
| **Replace raw provenance JSON dump in VersionDrawer** | The current `<JsonBlock>` listing of provenance events stays *available* (collapsed under "Show provenance details") but is no longer the primary summary | Low | VersionDrawer.tsx (existing) | None |
| **2–4 sentence conversational summary at top of drawer** | Renders `version.summary.text` (new field). Streaming reveal optional but recommended | Medium | New engine module `src/engine/llm-summary.ts`; new field on Version DTO | Summary not yet generated → SkeletonText placeholder + spinner |
| **Generated once per version, cached** | Summary is computed on first request (lazy) AND optionally proactively after `markCompleted` (fire-and-forget like Phase 13 fingerprintModelsForVersion); persisted to a new `version_summaries` table OR appended as a `summary_generated` provenance event | Medium | Drizzle migration 0007 (or stick to provenance event for append-only purity); new repo or ProvenanceWriter call | LLM call fails → fall back to existing `buildSummary(diff)` mechanical text + show "AI summary unavailable" subtle hint |
| **Regenerate button** | Throttled (1/min, debounce on click). Re-runs LLM with same grounded inputs, replaces cached version | Low | Append a NEW `summary_generated` provenance event (latest-wins read pattern); button calls new POST `/api/versions/:id/summary/regenerate` | User spam-clicks → 429 with retry-after; handled at HTTP layer |
| **Loading + streaming UX** | While generating: SkeletonText with shimmer (matches existing thumbnail skeleton style); during streaming: tokens appear as they arrive (TTFT < 800ms is the perceived-instant threshold) | Medium | New SSE event `summary_generating` + `summary_token` + `summary_complete`; OR HTTP chunked response on the regenerate route | SSE drops mid-stream → reconnect uses cached partial; client falls back to non-streaming refresh |

### Differentiators

| Feature | Spec | Complexity | Dependencies | Edge cases |
|---------|------|------------|--------------|------------|
| **"What changed from parent" diff inline in summary** | When version is iterate-lineage, the LLM gets the structured diff (params/seed/models/prompt deltas) as grounding, and the summary names the deltas conversationally ("...swapping the wide-angle env for the HDRI..."). For non-lineage versions, summary describes the version standalone | High | Phase 15 ingredient graph (componentOf + parentOf) + Phase 13 model fingerprints + existing diff-summary.ts as input bundle | First version of a shot (no parent) → standalone summary; reproduce-lineage → "v003 is a re-run of v002 — bytes match" or divergence callout |
| **Grounded prompt structure for the LLM** | System prompt: "You are a VFX Lead writing a 2-4 sentence note. Use ONLY the structured provenance below. Do not invent visual details. Do not list nodes. Reference the parent version by version label when applicable." User prompt: pre-extracted JSON of {model_primary, models_other, lora_with_strength, seed, sampler, steps, cfg, prompt_text_delta, parent_version_label, ingredients_changed} | Medium | New prompt-builder pure function; mirrors the diff-summary.ts pattern | Missing fields (e.g., model_hash_unavailable) → prompt includes `unavailable: true` flag and LLM is told "if a field is unavailable, omit it from the summary" |
| **Lineage-aware narrative thread** | Across v001 → v002 → v003, summaries form a coherent narrative when read in sequence (each summary mentions parent label and key delta). Achieved via per-version generation with parent context, NOT cross-version super-summary | High | Phase 15 ingredient graph for parent walk | Branched lineage (v002a, v002b from v001) — each summary names v001 as parent; UI shows them side-by-side; deferred to v1.3 if lineage_branches not yet supported |
| **Inline metadata pills** | Below the prose summary, render structured pills: model name + LoRA(s) + seed + parent version. Tap-to-copy. Redundant with prose but useful for fast scanning | Low | Pure render — uses already-cached structured fields | None |
| **"Translate to French / Korean" button** | DEFERRED to v1.3. v1.2 ships English-only. Translation is one extra LLM call with the existing English summary as input — clean 5-task plan in v1.3 | Out of scope | n/a | n/a |

### Anti-features

| Anti-feature | Why avoid |
|--------------|-----------|
| **Vision-model "describe the rendered image"** | This is THE anti-feature. CLIP/BLIP/Gemini-vision summaries hallucinate — they say "a dragon flying over mountains" when the actual render is a dog. The provenance graph IS the ground truth; the LLM's job is to *narrate the metadata*, not interpret the pixels. |
| **Summary regeneration on every page load** | Cost waste, latency waste, non-determinism. Regen is opt-in only |
| **Cross-shot AI comparison ("how does this shot compare to shot 03?")** | Out of scope — per-version summaries are sufficient for v1.2; cross-shot is a v1.3+ ADV-04 candidate |
| **Auto-generate on every submit** | Generate after `markCompleted`, NOT on submit (output not present yet for downstream tools to verify against). Fire-and-forget like Phase 13 fingerprinting |
| **Summary editing in the dashboard** | Append-only provenance contract; user-edited summaries blur the line between captured-fact and human-rewrite. If user wants human notes, that's a different field (`metadata` via asset tool) |
| **Multi-paragraph essay summaries** | Hard cap at 4 sentences. Token budget per call: ~150 output tokens. Costs add up over a project's lifetime |
| **Streaming-on-by-default** | Stream when the user clicks "regenerate" (active intent); don't stream on initial drawer-open (cached read should be instant). UX clarity beats consistency |
| **Public-API key from user / BYO-LLM in v1.2** | Add via env var (`VFX_FAMILIAR_LLM_API_KEY` + `VFX_FAMILIAR_LLM_MODEL`) for now. Per-user-LLM-config dashboard panel is a v1.3+ enhancement |
| **Tool-calling LLM that re-fetches structured data mid-completion** | Over-engineered. Build the grounded prompt once, single completion, done. Tool-calling adds latency + non-determinism + cost without value at this scope |
| **C2PA assertion of "AI-written summary"** | Pure metadata layer; not a shipped artifact. The summary lives in DB / SSE / dashboard JSON, never in the C2PA manifest. Keeps v1.1 manifest schema stable |

### Implementation notes

- **Architecture-purity boundary:** Mirror the c2pa pattern — restrict LLM client imports to `src/engine/llm/` only. Tool layer never imports the LLM SDK directly. Lazy-import the provider client (OpenAI / Anthropic / local) at first call to keep boot fast and to allow zero-config no-LLM mode (graceful degrade to mechanical buildSummary text).
- **Provider choice:** v1.2 ships with **provider-agnostic interface** + one concrete adapter (likely Claude Haiku for cost-per-summary-call OR OpenAI gpt-5-nano if available — both are fast, cheap, structured-input-friendly). See STACK.md research for the recommendation.
- **Token budget per call:** ~1.5K input tokens (prompt blob excerpt + diff + ingredient summary + system prompt) + ~150 output tokens (4 sentences). At Haiku pricing 2026, that's roughly ~$0.0006 per summary. A project with 1000 versions costs ~$0.60 in summaries.
- **Cache invalidation:** Summary cache key = `(version_id, prompt_blob_sha256, parent_version_id, parent_prompt_blob_sha256, models_sha256_concat)`. If any input changes, the cached summary is stale (rare — provenance is append-only so the grounded inputs don't change post-completion; this is mostly defensive).
- **Streaming wire format:** Reuse SSE bus (Phase 5). New event types `summary_generating` + `summary_token` + `summary_complete`. Mirror the existing typed-event-bus pattern; add adapter line in `src/http/sse-adapter.ts` per the WEBUI-03 lesson.
- **Rate-limit + cost guard:** Engine-side concurrency limit (max 4 in-flight summary calls), per-version dedupe (one summary call per version at a time), monthly token budget env var (`VFX_FAMILIAR_LLM_MONTHLY_TOKEN_BUDGET`) with soft warn at 80%.
- **Failure mode:** If LLM call fails (network, rate limit, malformed completion), fall back to the existing `buildSummary(diff)` mechanical text and surface a small "AI summary unavailable — using structured summary instead" notice. Never crash the drawer.

---

## Feature Dependencies (build order signal for roadmap)

```
v1.0/v1.1 base (DONE)
   ├── Versions + outputs on disk           ──► Thumbnails (1)
   ├── Hierarchy repos + versions list      ──► Sortable dropdowns (2)
   └── Phase 13 fingerprints
       + Phase 15 ingredient graph
       + diff-summary.ts (mechanical)        ──► Conversational summary (3)
                                                  └── streaming SSE (Phase 5 bus)
                                                  └── regenerate route (HTTP)

Within v1.2:
   Thumbnails (1)        ←── independent of (2) and (3); ship first; smallest risk
   Sortable dropdowns (2) ←── independent of (1) and (3); can ship in parallel with (1)
   Conversational summary (3) ←── biggest unknown (LLM provider choice, cost, latency); ship last after (1)+(2) demonstrate the visual-first dashboard works
```

**Suggested phase ordering:** Thumbnails → Sortable dropdowns (parallel-friendly) → Conversational summary. Reason: (1) and (2) are visible-from-day-one wins that validate the visual-first thesis; (3) carries an external-dependency risk (LLM provider) that should land last so the milestone can de-risk it without blocking the cheaper wins.

---

## MVP Recommendation (v1.2 minimum-viable-shape)

**Ship in this order, ship-each-incrementally:**

1. **Thumbnails — minimum:** image-output thumbnail at `/api/versions/:id/output?size=thumb` with sharp-resize + atomic cache; SkeletonThumbnail fallback; aspect-ratio CLS=0; click-to-fullsize. **Defer:** MP4 first-frame, hover-scrub, video preview clip generation.
2. **Sortable dropdowns — minimum:** latest-first default + 4 sort options (Latest, Oldest, Name A→Z, Version ↓) on the version grid; localStorage persistence; smart-default-per-scope (tree=A→Z, versions=latest). **Defer:** "recently active" sort, tag-recency sort, per-shot persistence (start with global per-list).
3. **Conversational summary — minimum:** non-streaming, single LLM call after markCompleted, cached as provenance event; regenerate button (1/min throttle); fall back to mechanical buildSummary on failure. **Defer:** streaming UX, translation, lineage-narrative thread (still write summaries that mention parent label, just don't promise cross-version coherence yet).

**Defer to v1.3 candidates:**

- MP4 first-frame thumbnail + hover-scrub video preview
- "Recently active" sort
- Streaming summary UX
- Translation
- Per-shot sort persistence
- Branched-lineage narrative coherence

This MVP shape ships in ~3 phases (one per feature) and validates the artist-feedback thesis (visual-first, latest-first, conversational) without committing to the full feature surface.

---

## Edge Cases Cross-Cutting All Three Features

| Scenario | Thumbnail | Sort | Summary |
|----------|-----------|------|---------|
| **Version is `running`/`queued` (no output yet)** | SkeletonThumbnail + StatusPill | Sortable as normal (by created_at; completed_at is null) | No summary yet — show "summary will appear when generation completes" |
| **Output deleted from disk after completion** | "missing" placeholder; warn pill | Unchanged | Summary still readable from cache (DB-backed, not file-backed) |
| **Model fingerprint unavailable (`model_hash_unavailable=true`)** | n/a | n/a | LLM prompt sees `model_primary: { name, hash_unavailable: true }` and is told to omit hash from prose |
| **Reproduce-lineage with byte divergence** | Thumbnail still renders the actual divergent output | Sortable as normal | Summary calls out divergence: "v003 is a re-run of v002 — output bytes drifted; check seed determinism" |
| **No parent (first version of a shot)** | Standalone thumbnail | Sortable as normal | Standalone summary — no "swapping" / "compared to parent" language |
| **Branched lineage (multiple children from same parent)** | Each branch gets its own thumbnail | Branches sort independently within the shot | Each branch summary names the same parent; cross-branch comparison deferred |
| **Empty shot (zero versions)** | SkeletonThumbnail with "no renders yet" copy | Empty list | n/a |
| **localStorage disabled / quota exceeded** | n/a | Falls back to in-memory + session-default | n/a |
| **LLM provider unreachable** | n/a | n/a | Mechanical buildSummary fallback + subtle "AI summary unavailable" hint; regenerate button retries |

---

## Domain Conventions Cited (VFX-specific, not generic-dashboard)

These shaped the table-stakes / differentiator / anti-feature splits:

- **Frame.io stack-thumbnail = highest-numbered version** — when a shot has 5 versions, the shot card shows v005's poster, not v001's. This is the dominant convention for video review tools and is what VFX artists already expect.
- **DaVinci Resolve hover-scrub** — hovering an MP4 thumbnail plays the clip inline; canonical UX in VFX/post tools since Resolve 14.
- **Premiere Pro poster frames** — the *first frame* is rarely representative of an MP4 (often black or a slate). Modern tools default to a frame ~1s in OR use `-vf thumbnail` filter for "most representative." For v1.2 we ship `-vf thumbnail` since we have ffmpeg anyway. Reasonable defaults trump custom-poster-picking.
- **ShotGrid / Flow Production Tracking review pages** — sort by Sort Order field on Playlists. For VFX Familiar, the equivalent is the version-grid sort dropdown; we don't have Playlists.
- **VFX Lead / Supervisor note style** — annotations are loaded onto media; coordinators write notes from supervisor comments; tone is declarative present-tense, terminology maps to next-action. This is what the conversational summary mimics. Source: Open Review Initiative user stories + VFX Voice supervisor profiles.
- **Append-only version discipline** — VFX studios *never* overwrite a version; every iteration is logged. Phase 1 already encodes this. Summary regeneration writes a NEW provenance event, doesn't overwrite — same discipline.

---

## Open Questions for Roadmap Phase

1. **LLM provider:** Claude Haiku 4.7 / GPT-5-nano / local Llama? STACK.md should pin one with a fallback adapter pattern. (The provider-agnostic interface means switching is cheap if the answer changes mid-milestone.)
2. **Streaming UI for summary v1.0:** Worth the SSE wiring complexity, or punt to phase 2? Recommendation: punt — non-streaming with fast cache hit is the right v1.2 default.
3. **Thumbnail dimensions standardization:** 160×90 (16:9), 240×135 (16:9), or content-driven? Recommendation: 240×135 in shot grid + 160×90 in side list, both 16:9, `object-fit: cover` for non-16:9 renders.
4. **Sort scope key:** versions:${shotId} or versions (global)? Recommendation: start global, evaluate per-shot in v1.3 based on user feedback.
5. **Regenerate-summary throttling:** 1/min or 1/5min? Recommendation: 1/min server-side, debounce 500ms client-side.

---

## Sources

- [Frame.io V4 — Version Stacking](https://help.frame.io/en/articles/9101068-version-stacking) — version stack thumbnail = highest-numbered version
- [Frame.io V4 — Sort options for Review Links](https://support.frame.io/en/articles/5281015-how-to-sort-your-assets-in-a-review-or-presentation-link) — six sort options + two order preferences
- [Frame.io V4 — Comparison Viewer](https://help.frame.io/en/articles/9952618-comparison-viewer) — side-by-side compare for video / images / audio / PDF
- [DaVinci Resolve — Media Pool Thumbnail Hover Scrub](https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=175707) — hover-to-scrub for video clips in Media Pool
- [DaVinci Resolve — Gallery Hover Scrub Preview](https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part2895.htm) — Live Preview submenu controls thumbnail vs. viewer scrub independently
- [Adobe Premiere Pro — Thumbnail Controls](https://helpx.adobe.com/premiere/desktop/get-started/use-touch-and-gesture-controls/use-thumbnail-controls-in-the-project-panel.html) — hover scrub + poster frame + scrub/play/mark inline controls
- [Adobe Premiere Pro — Setting Poster Frames](https://www.premiumbeat.com/blog/premiere-pro-tutorial-setting-poster-frames/) — right-click → Set Poster Frame; first frame rarely representative
- [Flow Production Tracking — Versions Sorting in Client Review](https://community.shotgridsoftware.com/t/versions-sorting-in-client-review-site/7911) — playlist Sort Order field convention
- [ftrack — Introduction to Versions](https://help.ftrack-studio.backlight.co/hc/en-us/articles/13129800589591-Introduction-to-Versions) — review via thumbnail in player; encoded thumbnails on publish
- [Foundry Hiero — Versioning](https://www.foundry.com/products/nuke-family/hiero/features) — bring new shot versions onto timeline + swap to compare
- [Open Review Initiative — Annotations and Notes User Stories](https://lf-aswf.atlassian.net/wiki/spaces/PRWG/pages/11282621/Annotations+and+Notes+User+Stories) — supervisor + coordinator note workflow
- [Mux — Extract thumbnails with FFmpeg](https://www.mux.com/articles/extract-thumbnails-from-a-video-with-ffmpeg) — `-vf thumbnail` filter selects representative frame
- [OTTVerse — FFmpeg Thumbnails 3 Techniques](https://ottverse.com/thumbnails-screenshots-using-ffmpeg/) — interval extraction + tile/storyboard layouts
- [MDN — Lazy Loading Performance Guide](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading) — `loading="lazy"` semantics + dimensions for CLS
- [VitalsFixer — Lazy Loading Images Native Guide 2026](https://vitalsfixer.com/blog/lazy-loading-guide) — native lazy loading 90% of cases; explicit width/height + aspect-ratio for CLS=0
- [Cloudinary — AI-Powered Captioning Add-on](https://cloudinary.com/blog/ai-powered-captioning-add-on) — LLM caption stored in image metadata pattern
- [arXiv — Reducing Hallucination in Structured Outputs via RAG](https://arxiv.org/html/2404.08189v1) — structured input minimizes hallucination in summaries
- [Redis — How to Improve LLM UX: Speed, Latency & Caching](https://redis.io/blog/how-to-improve-llm-ux-speed-latency-and-caching/) — TTFT < 800ms perceived-instant; streaming early; cache hit ratio drives cost
- [DEV — Choosing an LLM in 2026](https://dev.to/superorange0707/choosing-an-llm-in-2026-the-practical-comparison-table-specs-cost-latency-compatibility-354g) — Haiku / GPT-nano latency + cost comparisons
- [Medium QuarkAndCode — LLM Optimization Guide 2026](https://medium.com/@QuarkAndCode/llm-optimization-guide-token-budgets-latency-and-cost-7ed701283ce5) — output tokens 3-8× input cost; budget summary length aggressively
