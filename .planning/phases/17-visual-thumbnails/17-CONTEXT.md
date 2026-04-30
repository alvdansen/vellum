# Phase 17: Visual Thumbnails - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Lazy-loaded 16:9 thumbnails on every completed-version asset card in the side list (TreeSidebar) AND main grid (shot-detail VersionCards), including MP4 first-frame extraction, atomic disk cache, C2PA-signed shield overlay (Adobe CR mark), and a redact-invalidation hook. Thumbnails augment the existing list — they do not replace it. No new MCP tools (tool count holds at 7 of 12). Sort dropdown (Phase 18) and AI summary (Phase 19) are explicitly out of scope here.

</domain>

<decisions>
## Implementation Decisions

### Cache size strategy
- **D-01:** Single fixed-size thumbnail per output. Path: `<outputsDir>/<versionId>/<filename>.thumb.webp` (matches REQUIREMENTS.md exactly). No `?w=` responsive multi-size — defer to v1.3 if/when telemetry shows bandwidth pressure.
- **D-02:** Physical dimensions: 640×360 (industry standard — Frame.io / NLE detail panels / Vimeo grid all cluster here). Retina-ready for VFX artists on 4K monitors. ~25–40 KB WebP per thumb; ~6 MB total cache for a 200-version project.
- **D-03:** WebP encoding at quality 80, lossy. Sharp default. Visually indistinguishable from source for review purposes; full-size click-through is the surface for fine-detail review.
- **D-04:** Encode at SOURCE aspect, NOT padded to 16:9 on disk. CSS frames it via `object-contain` in a 16:9 wrapper on the dashboard side. Avoids baking theme-dependent letterbox bars into cached pixels.
- **D-05:** Cache invalidation on Phase 16 redact: explicit hook. `redactManifestForVersion()` calls `invalidateThumbnail()` AFTER the atomic rename. Deletes `<filename>.thumb.webp`. Symmetric to assetWriterMutex pattern from Phase 16.
- **D-06:** ETag = `sha256:<source_mtime>` (or `outputs_json[0].sha256` if present). Source bytes change → ETag changes → browsers re-fetch automatically.
- **D-07:** Failure handling: if sharp / ffmpeg fails on a source file, write a `<filename>.thumb.failed` sentinel marker file. No retry until source mtime changes. UI shows `<SkeletonThumbnail/>` (same shimmer as in-progress / loading — no broken-image icons, no distinct error skeleton). Engine emits structured warning log.

### C2PA shield overlay treatment
- **D-08:** Icon style: Adobe Content Credentials "CR" mark (https://contentcredentials.org/icon). Regulator-recognized, brand-aligned with the C2PA standard, adopted by Adobe Firefly / OpenAI image API / Microsoft Designer / BBC. Not a generic shield-check.
- **D-09:** Placement: bottom-right corner of the thumbnail. Survives `object-cover` crops better than top corners; doesn't fight the focal point; doesn't overlap version label (top-left in current VersionCard).
- **D-10:** Visibility: shield rendered ONLY for `c2paStatus === 'signed'`. `unsigned` and `unknown` show no overlay (existing C2paBadge text pill in VersionDrawer continues to surface all 3 states with full detail). Shield is a positive signal; absence is the implicit negative.
- **D-11:** Interaction: hover/focus surfaces native `title="Signed · Verified provenance"` (or `aria-label` for keyboard) tooltip. Click bubbles up to the parent VersionCard's existing click handler — opens VersionDrawer where the full C2paBadge + provenance is visible. NO nested click target on the shield itself.
- **D-12:** Source of truth for signed-state: `X-C2PA-Signing-Status` response header from `HEAD /api/versions/:id/output` (Phase 14 Plan 04 surface — already wired). Dashboard uses existing `getC2paStatus` helper in `lib/api.ts`.

### Shot card stack convention
- **D-13:** "Shot card" lives in the TreeSidebar (currently text-only). Each shot row gains a small leading thumbnail of the most-recently-completed version under that shot. No layered-stack visual in v1.2 (TreeSidebar density is tight; layered-stack belongs to a future shot-grid view in v1.3).
- **D-14:** Selection logic for the shot-row thumb: `ORDER BY completed_at DESC LIMIT 1` filtered to `status='complete'`. If no completed version exists, render `<SkeletonThumbnail/>`.
- **D-15:** Fallback when latest version is in-progress: show the most-recently-completed previous version's thumb (matches Frame.io behavior — artists always see the latest *finished* render). The shot row never "goes blank" while a render is in flight, as long as any earlier version has completed.
- **D-16:** Sequence rows and Project rows in TreeSidebar stay text-only. Aggregating "hero version" semantics for organizational containers is ambiguous (latest across all shots? curator-marked?) — out of scope for v1.2. Defer to v1.3 if user-demand surfaces.

### Aspect handling for non-16:9 source
- **D-17:** Render strategy: `object-contain` (letterbox), NOT `object-cover` (crop). Faithful to actual render — never chops content from edges. Frame.io default behavior. Square 1024×1024, vertical 1080×1920, ultrawide 2.39:1 sources all render with full content visible.
- **D-18:** Letterbox bars: transparent. Server-side WebP is encoded at source aspect (preserving alpha). CSS dashboard wrapper frames in `aspect-video` (16:9) with `object-contain`; the dashboard surface bg shows through the dead space. Adapts to light/dark theme automatically. No baked-in bg color → no theme-mismatch when user switches themes.
- **D-19:** **Note: this implies the existing `VersionCard` at `packages/dashboard/src/components/VersionCard.tsx:53` MUST switch from `object-cover` to `object-contain` AND swap from full-size `getOutputUrl(version.id)` to the new thumbnail URL.** This is a small but visible behavior change for already-shipped UI. Tests must cover the swap.

### Generation timing & coalescing (research-locked but worth recording)
- **D-20:** Generate-on-demand at the HTTP route boundary. NOT eager-on-download (would couple to Phase 14 signing chain, add latency, and force an architecture-purity exception in `output-downloader.ts`). First dashboard view of a version pays ~50–200 ms; every subsequent view is a 304.
- **D-21:** Per-(versionId, filename) coalescing mutex. Mirrors `signMutex` shape at `src/engine/pipeline.ts:288-291`. Concurrent thumb requests for the same key share one in-flight Promise; different keys run in parallel. NOT the FIFO assetWriterMutex (sign/redact serialization is different from pure-derivation coalescing).
- **D-22:** Atomic write via temp + rename (mirrors output-downloader and Phase 16 redact). Half-written WebP cannot be served by a concurrent reader.

### Architecture-purity (locked at REQUIREMENTS.md cross-cutting constraint)
- **D-23:** `sharp` import restricted to `src/engine/thumbnails/image-thumbnail.ts` (sole importer).
- **D-24:** `@ffmpeg-installer/ffmpeg` import restricted to `src/engine/thumbnails/video-thumbnail.ts` (sole importer).
- **D-25:** Allowed-set extension follows v1.1 `c2pa-node` pattern in `src/__tests__/architecture-purity.test.ts` (sorted-array deepEqual exact membership). Each new dep adds its allowed-set assertion in the SAME plan that introduces the import — no orphaned imports.
- **D-26:** Lazy import (`await import('sharp')` / `await import('@ffmpeg-installer/ffmpeg')`) — server boot succeeds even when native binding is missing. Mirrors Phase 14 `c2pa-node` lazy pattern (Concern #11 — boot resilience). Failure → `TypedError('THUMBNAIL_FAILED', reason, recovery)` → engine writes `.thumb.failed` sentinel → UI shows skeleton.

### MP4 first-frame extraction (REQUIREMENTS.md VIS-04)
- **D-27:** `@ffmpeg-installer/ffmpeg` (LGPL-2.1, separate-process, MIT-compatible) — NOT `ffmpeg-static` (GPL-3.0-or-later, license-viral). License posture verified in research.
- **D-28:** `-vf thumbnail` filter for representative-frame selection (skips fade-ins, picks the most "thumbnail-like" frame from the first ~100 frames).
- **D-29:** Brightness-threshold fallback to a 1.0s seek if the picked frame is below a luminance threshold (catches the "first frame is black" failure mode). Threshold value: Claude's discretion at planning (typical: avg luminance < 16/255).
- **D-30:** Pre-flight 100 MB hard skip on source size + 10 s ffmpeg timeout → `THUMBNAIL_FAILED:source_too_large` / `:ffmpeg_timeout` typed reasons (research PITFALLS #6 — MP4 OOM).

### Claude's Discretion
- Sharp `concurrency(2)` global cap (research PITFALLS #7 — generation stampede)
- Dashboard fetch queue cap of 6 concurrent thumb requests (research PITFALLS #7)
- Exact brightness-threshold value for the MP4 black-frame fallback
- HTTP `Cache-Control` header value (research suggests `public, max-age=31536000, immutable`; existing `/output` route uses `max-age=3600` — Claude reconciles)
- Skeleton shimmer dimensions in the TreeSidebar (existing default is 160×90; smaller may fit better in tree row density)
- Whether to introduce a thin `<Thumbnail />` wrapper component or inline the `<img>` swap in `VersionCard`. Recommendation: thin wrapper — owns lazy-loading, fallback skeleton, C2PA shield overlay logic in one place.
- Multi-encoding leak scan extension to thumbnail cache + `.thumb.failed` sentinel paths (REQUIREMENTS.md cross-cutting constraint mentions thumbnail cache; planner derives the test shape).

</decisions>

<specifics>
## Specific Ideas

- **"Whatever the industry standard is, what professionals would expect to see"** — direct user quote on thumbnail dimensions. Resolved as 640×360 (Frame.io / Vimeo grid / NLE detail-panel convention; retina-ready for 4K-monitor VFX review).
- **Frame.io as the visual reference** — explicitly named in REQUIREMENTS.md VIS-05 ("Frame.io stack convention"). v1.2 ships single-thumb-of-latest-completed (TreeSidebar density-appropriate); the layered-stack visual is acknowledged as the longer-term aspirational treatment for a future shot-grid view.
- **Adobe Content Credentials "CR" mark** as the C2PA shield — regulator-recognized standard, brand-aligned with the C2PA spec itself. NOT a generic shield-check icon.
- **Letterbox over crop** — VFX artists need faithful previews; cropping a square 1024×1024 render to 16:9 may chop the dragon's eye if it was framed at the edge. The artist made it square for a reason; respect that.
- **Transparent letterbox bars** — adapts to light/dark theme without re-encoding the cached WebP. Theme-flexibility was implicit but worth recording.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.2 milestone scope and constraints
- `.planning/REQUIREMENTS.md` — v1.2 requirements (VIS-01..06 for this phase; cross-cutting constraints lock tool cap, architecture-purity allowed-set extensions, append-only, multi-encoding leak scan)
- `.planning/ROADMAP.md` §"Phase 17: Visual Thumbnails" — 4 success criteria (lazy-loaded thumbs + skeleton fallback + click-thru, MP4 first-frame + Frame.io shot-card thumb, C2PA shield + redact-invalidation)
- `.planning/PROJECT.md` §"Current Milestone: v1.2 Visual & Conversational Dashboard" — milestone driver (artist feedback), pivot context, v1.2 scope envelope

### Research artifacts (consumed by gsd-phase-researcher)
- `.planning/research/SUMMARY.md` §"Phase 17: Visual Thumbnails" — phase-level rationale, build-effort estimate, PITFALLS to avoid (#6 MP4 OOM, #7 stampede, #8 cache poisoning, #13 unsupported format)
- `.planning/research/STACK.md` — `sharp@^0.34.5` + `@ffmpeg-installer/ffmpeg@^1.1.0` version pins; license posture (LGPL-2.1 vs the rejected GPL-3 `ffmpeg-static`); disk footprint
- `.planning/research/ARCHITECTURE.md` §"Component-by-Component Specification" — `src/engine/thumbnails/{image-thumbnail,video-thumbnail,format-router,cache,index}.ts` shapes, lazy-import discipline, atomic-write pattern, ETag derivation, mutex shape (mirrors `signMutex` at `src/engine/pipeline.ts:288-291`)
- `.planning/research/PITFALLS.md` — full prevention strategies for thumbnail-class pitfalls (PITFALLS 6, 7, 8, 13)

### Code precedent (patterns to mirror)
- `src/engine/c2pa/index.ts` — barrel export shape that `src/engine/thumbnails/index.ts` mirrors
- `src/engine/c2pa/format-router.ts` — pure router shape that `src/engine/thumbnails/format-router.ts` mirrors
- `src/engine/output-downloader.ts` — atomic temp+rename + integration with engine facade hook (signing pattern from Phase 14)
- `src/engine/pipeline.ts:288-291` — `signMutex` per-(versionId, filename) coalescing — `thumbnailMutex` is structurally identical
- `src/engine/pipeline.ts:298-308` — `assetWriterMutex` FIFO serializer — explicitly NOT used for thumbs; recorded so planner doesn't grab the wrong primitive
- `src/engine/c2pa/redaction.ts` — Phase 16 redaction flow; thumb invalidation hook lands AFTER the atomic rename in `redactManifestForVersion`
- `src/__tests__/architecture-purity.test.ts:190-230` — `c2pa-node` allowed-set assertion shape; sharp + ffmpeg assertions follow this exact form
- `src/http/dashboard-routes.ts:240-353` — `/api/versions/:id/output` GET + HEAD; `resolveOutputForVersion` helper; `X-C2PA-Signing-Status` header pattern
- `packages/dashboard/src/components/SkeletonThumbnail.tsx` — existing 160×90 shimmer skeleton, reused for thumb loading / in-progress / failed states
- `packages/dashboard/src/components/VersionCard.tsx:52-59` — current `<img src={getOutputUrl(version.id)}>` full-size load (the regression VIS-01 fixes)
- `packages/dashboard/src/components/C2paBadge.tsx` — existing TEXT pill for C2PA status in VersionDrawer; the new C2PA shield overlay is a separate icon component (DOES NOT replace C2paBadge)
- `packages/dashboard/src/views/HomeView.tsx` — TreeSidebar (left pane) + shot-detail VersionCard list (right pane) layout where thumbs surface
- `packages/dashboard/src/components/TreeSidebar.tsx` — shot rows that gain leading thumb (D-13 / D-14)
- `packages/dashboard/src/lib/api.ts` §`getC2paStatus` (HEAD `/api/versions/:id/output` → X-C2PA-Signing-Status) — shield-render predicate uses this

### External icon source
- `https://contentcredentials.org/icon` — Adobe Content Credentials "CR" mark download / SVG (D-08). License: free for use to indicate Content Credentials presence per Adobe's published guidance. Planner / executor verifies license terms in PR review before adding to repo.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/dashboard/src/components/SkeletonThumbnail.tsx` — 160×90 default shimmer; reused as fallback for in-progress / loading / failed thumb states (VIS-02). Existing `animate-skeleton-shimmer` keyframe respects `prefers-reduced-motion`.
- `packages/dashboard/src/components/C2paBadge.tsx` — existing C2PA TEXT pill in VersionDrawer; the new shield overlay is a separate component (does not replace).
- `packages/dashboard/src/lib/api.ts` `getOutputUrl(versionId)` + `getC2paStatus(versionId)` helpers — VersionCard currently uses `getOutputUrl` for full-size `<img>`; new `getThumbnailUrl(versionId)` helper added in this phase.
- `src/engine/c2pa/{index,format-router}.ts` — barrel + pure-router shapes that `src/engine/thumbnails/{index,format-router}.ts` mirror.
- `src/engine/output-downloader.ts` — atomic temp+rename discipline, structural Pick for engine hook (the thumb-invalidation hook in `redactManifestForVersion` follows this discipline).
- `src/engine/pipeline.ts:288-291` `signMutex` — per-(versionId, filename) coalescing; the thumb mutex is structurally identical.

### Established Patterns
- **Lazy native-binding import + graceful degradation:** `await import('c2pa-node')` from Phase 14 (`src/engine/c2pa/signer.ts`) is the precedent for `sharp` + `@ffmpeg-installer/ffmpeg`.
- **Architecture-purity allowed-set:** `src/__tests__/architecture-purity.test.ts` `c2pa-node` block (~lines 190-230) is the template for sharp + ffmpeg blocks. Sorted-array deepEqual exact membership.
- **Atomic temp+rename via UNIQUE mkstemp → rename:** `output-downloader.ts` (Phase 14) and `redaction.ts` (Phase 16). Both use `nanoid(8)` for unique partials. Thumb cache mirrors.
- **Per-(versionId, filename) coalescing mutex (signMutex shape):** Chosen over the assetWriterMutex FIFO serializer because thumb generation is pure derivation from immutable bytes — coalescing is correct and faster.
- **`X-C2PA-Signing-Status` header pattern (Phase 14 Plan 04):** `HEAD /api/versions/:id/thumbnail` may surface a similar header (or none — thumb itself doesn't carry signing state, the source does; planner decides).
- **TypedError + recovery hint:** `THUMBNAIL_FAILED` error code with reasons (`unsupported_format`, `sharp_failed`, `ffmpeg_failed`, `ffmpeg_timeout`, `source_too_large`, `source_unreadable`).

### Integration Points
- **HTTP route surface:** `src/http/dashboard-routes.ts` gains `GET /api/versions/:id/thumbnail` + `HEAD /api/versions/:id/thumbnail` (mirrors `/output` shape — `resolveOutputForVersion` helper provides filename + filePath; thumb derivation runs after).
- **Engine facade:** `src/engine/pipeline.ts` gains `generateThumbnail(versionId, filename)` + `invalidateThumbnail(versionId, filename)` methods (delegates to `src/engine/thumbnails/`).
- **Redact invalidation hook:** `src/engine/c2pa/redaction.ts` `redactManifestForVersion` AFTER atomic rename — calls `engine.invalidateThumbnail(versionId, filename)`. Single explicit call site.
- **Dashboard:** New `<Thumbnail />` component (recommended: thin wrapper) in `packages/dashboard/src/components/Thumbnail.tsx`. Used by `VersionCard` (replaces line 52-59 current `<img>`) and TreeSidebar shot rows (D-13 / D-14).
- **TreeSidebar:** `packages/dashboard/src/components/TreeSidebar.tsx` — shot rows gain leading `<Thumbnail />`; sequence + project rows untouched.
- **Architecture-purity test:** `src/__tests__/architecture-purity.test.ts` — extend allowed-set with sharp + ffmpeg blocks in the SAME plan that introduces those imports.
- **Append-only invariant:** Thumb cache is a derived asset on the filesystem, NOT a database row. No schema migration needed. Append-only `provenance` table is untouched.

</code_context>

<deferred>
## Deferred Ideas

- **Multi-size responsive thumbnails (`?w=80|160|320|640` srcset).** Defer to v1.3 if/when bandwidth telemetry justifies the 4× cache-footprint and invalidation-surface cost.
- **Frame.io layered-stack visual on shot cards.** Phase 17 ships single-thumb-of-latest-completed in TreeSidebar (density-appropriate). Layered-stack belongs to a future shot-grid view in v1.3 where there's room to breathe.
- **Sequence + Project row thumbnails in TreeSidebar.** Aggregating "hero version" semantics is ambiguous (latest across all shots? curator-marked?). v1.3 if user demand surfaces.
- **Hybrid letterbox: blurred-bg + contained source (Vimeo / IG style).** Premium look, costs 2 sharp ops per thumb. v1.3 candidate.
- **Hover-to-scrub video preview.** Already deferred at REQUIREMENTS.md ("bandwidth cost; nice-to-have; defer to v1.3+ when usage data justifies").
- **AI-generated alt text on thumbnails.** Already deferred at REQUIREMENTS.md (Phase 19 LLM ground-truth could supply this; v1.3 candidate).
- **Distinct error skeleton (vs the unified shimmer for in-progress / loading / failed).** Defer; users rarely encounter the failed-thumb state and the unified treatment is consistent.
- **Auto-enhanced thumbnails (sharpen / contrast / denoise).** Already an anti-feature at REQUIREMENTS.md ("VFX artists need faithful previews of actual renders. Auto-enhance distorts provenance.").

</deferred>

---

*Phase: 17-visual-thumbnails*
*Context gathered: 2026-04-30*
