# Phase 17: Visual Thumbnails — Research

**Researched:** 2026-04-30
**Domain:** Server-side thumbnail derivation pipeline (sharp + ffmpeg) + atomic FS cache + dashboard `<Thumbnail/>` component with C2PA shield overlay + Phase-16 redact-invalidation hook
**Confidence:** HIGH (every locked decision validated against Context7 + npm registry + project source; one MEDIUM-confidence item flagged on the C2PA "CR" icon SVG license — see Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

> CONTEXT.md is unusually dense — D-01 through D-30 lock virtually every implementation decision. The planner MUST treat these as non-negotiable contracts. Research validates each against authoritative sources rather than re-deciding.

### Locked Decisions

#### Cache size strategy
- **D-01:** Single fixed-size thumbnail per output. Path: `<outputsDir>/<versionId>/<filename>.thumb.webp` (matches REQUIREMENTS.md exactly). No `?w=` responsive multi-size — defer to v1.3 if/when telemetry shows bandwidth pressure.
- **D-02:** Physical dimensions: 640×360 (industry standard — Frame.io / NLE detail panels / Vimeo grid all cluster here). Retina-ready for VFX artists on 4K monitors. ~25–40 KB WebP per thumb; ~6 MB total cache for a 200-version project.
- **D-03:** WebP encoding at quality 80, lossy. Sharp default. Visually indistinguishable from source for review purposes; full-size click-through is the surface for fine-detail review.
- **D-04:** Encode at SOURCE aspect, NOT padded to 16:9 on disk. CSS frames it via `object-contain` in a 16:9 wrapper on the dashboard side. Avoids baking theme-dependent letterbox bars into cached pixels.
- **D-05:** Cache invalidation on Phase 16 redact: explicit hook. `redactManifestForVersion()` calls `invalidateThumbnail()` AFTER the atomic rename. Deletes `<filename>.thumb.webp`. Symmetric to assetWriterMutex pattern from Phase 16.
- **D-06:** ETag = `sha256:<source_mtime>` (or `outputs_json[0].sha256` if present). Source bytes change → ETag changes → browsers re-fetch automatically.
- **D-07:** Failure handling: if sharp / ffmpeg fails on a source file, write a `<filename>.thumb.failed` sentinel marker file. No retry until source mtime changes. UI shows `<SkeletonThumbnail/>` (same shimmer as in-progress / loading — no broken-image icons, no distinct error skeleton). Engine emits structured warning log.

#### C2PA shield overlay treatment
- **D-08:** Icon style: Adobe Content Credentials "CR" mark (https://contentcredentials.org/icon). Regulator-recognized, brand-aligned with the C2PA standard, adopted by Adobe Firefly / OpenAI image API / Microsoft Designer / BBC.
- **D-09:** Placement: bottom-right corner of the thumbnail.
- **D-10:** Visibility: shield rendered ONLY for `c2paStatus === 'signed'`. `unsigned` and `unknown` show no overlay.
- **D-11:** Interaction: hover/focus surfaces native `title="Signed · Verified provenance"` (or `aria-label` for keyboard) tooltip. Click bubbles up to the parent VersionCard's existing click handler. NO nested click target on the shield itself.
- **D-12:** Source of truth for signed-state: `X-C2PA-Signing-Status` response header from `HEAD /api/versions/:id/output` (Phase 14 Plan 04 surface). Dashboard uses existing `getC2paStatus` helper in `lib/api.ts`.

#### Shot card stack convention
- **D-13:** "Shot card" lives in the TreeSidebar. Each shot row gains a small leading thumbnail of the most-recently-completed version under that shot. No layered-stack visual in v1.2.
- **D-14:** Selection logic: `ORDER BY completed_at DESC LIMIT 1` filtered to `status='complete'`. If no completed version exists, render `<SkeletonThumbnail/>`.
- **D-15:** Fallback when latest version is in-progress: show the most-recently-completed previous version's thumb. Shot row never goes blank while a render is in flight.
- **D-16:** Sequence rows and Project rows in TreeSidebar stay text-only.

#### Aspect handling for non-16:9 source
- **D-17:** Render strategy: `object-contain` (letterbox), NOT `object-cover` (crop).
- **D-18:** Letterbox bars: transparent. Server-side WebP encoded at source aspect (preserving alpha). CSS dashboard wrapper frames in `aspect-video` (16:9) with `object-contain`.
- **D-19:** Existing `VersionCard` at `packages/dashboard/src/components/VersionCard.tsx:53` MUST switch from `object-cover` to `object-contain` AND swap from full-size `getOutputUrl(version.id)` to the new thumbnail URL.

#### Generation timing & coalescing
- **D-20:** Generate-on-demand at the HTTP route boundary. NOT eager-on-download.
- **D-21:** Per-(versionId, filename) coalescing mutex. Mirrors `signMutex` shape at `src/engine/pipeline.ts:288-291`. NOT the FIFO assetWriterMutex.
- **D-22:** Atomic write via temp + rename (mirrors output-downloader and Phase 16 redact).

#### Architecture-purity
- **D-23:** `sharp` import restricted to `src/engine/thumbnails/image-thumbnail.ts` (sole importer).
- **D-24:** `@ffmpeg-installer/ffmpeg` import restricted to `src/engine/thumbnails/video-thumbnail.ts` (sole importer).
- **D-25:** Allowed-set extension follows v1.1 `c2pa-node` pattern in `src/__tests__/architecture-purity.test.ts` (sorted-array deepEqual exact membership).
- **D-26:** Lazy import (`await import('sharp')` / `await import('@ffmpeg-installer/ffmpeg')`) — server boot succeeds even when native binding is missing. Failure → `TypedError('THUMBNAIL_FAILED', reason, recovery)` → `.thumb.failed` sentinel → UI skeleton.

#### MP4 first-frame extraction
- **D-27:** `@ffmpeg-installer/ffmpeg` (LGPL-2.1, separate-process, MIT-compatible) — NOT `ffmpeg-static` (GPL-3.0-or-later, license-viral).
- **D-28:** `-vf thumbnail` filter for representative-frame selection.
- **D-29:** Brightness-threshold fallback to a 1.0s seek if the picked frame is below a luminance threshold. Threshold value: Claude's discretion at planning (typical: avg luminance < 16/255).
- **D-30:** Pre-flight 100 MB hard skip on source size + 10 s ffmpeg timeout → `THUMBNAIL_FAILED:source_too_large` / `:ffmpeg_timeout` typed reasons.

### Claude's Discretion
- Sharp `concurrency(2)` global cap (research PITFALLS #7 — generation stampede)
- Dashboard fetch queue cap of 6 concurrent thumb requests (research PITFALLS #7)
- Exact brightness-threshold value for the MP4 black-frame fallback
- HTTP `Cache-Control` header value (research suggests `public, max-age=31536000, immutable`; existing `/output` route uses `max-age=3600`)
- Skeleton shimmer dimensions in the TreeSidebar (existing default is 160×90; smaller may fit better in tree row density)
- Whether to introduce a thin `<Thumbnail />` wrapper component or inline the `<img>` swap in `VersionCard`. Recommendation: thin wrapper.
- Multi-encoding leak scan extension to thumbnail cache + `.thumb.failed` sentinel paths.

### Deferred Ideas (OUT OF SCOPE)
- Multi-size responsive thumbnails (`?w=80|160|320|640` srcset).
- Frame.io layered-stack visual on shot cards.
- Sequence + Project row thumbnails in TreeSidebar.
- Hybrid letterbox: blurred-bg + contained source (Vimeo / IG style).
- Hover-to-scrub video preview.
- AI-generated alt text on thumbnails.
- Distinct error skeleton (vs the unified shimmer for in-progress / loading / failed).
- Auto-enhanced thumbnails (sharpen / contrast / denoise).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIS-01 | 16:9 thumbnail on every completed-version card; lazy-load + explicit width/height; image-output thumbs resize to small WebP via `sharp` and cache atomically at `<outputsDir>/<versionId>/<filename>.thumb.webp` | Stack §sharp 0.34.5; Architecture §image-thumbnail.ts; Pattern 3 (atomic temp+rename); §VersionCard regression mapping |
| VIS-02 | `<SkeletonThumbnail/>` placeholder for in-progress / loading / failed-to-generate; no broken-image icons; no empty boxes | Code precedent §SkeletonThumbnail.tsx (160×90, `animate-skeleton-shimmer`); D-07 unified treatment for failed states; §`.thumb.failed` sentinel design |
| VIS-03 | Click thumbnail to view full-size asset via existing `/api/versions/:id/output` route (preserved) | Existing route at `src/http/dashboard-routes.ts:318-353`; new thumbnail route is purely additive |
| VIS-04 | MP4 first representative frame via `@ffmpeg-installer/ffmpeg` `-vf thumbnail` + brightness-threshold fallback to 1.0s seek when picked frame is black | Stack §@ffmpeg-installer/ffmpeg 1.1.0; ffmpeg `thumbnail` filter docs; Pitfall §MP4 OOM (D-30 pre-flight + 10s timeout); brightness analysis via sharp `.stats()` |
| VIS-05 | Latest *completed* version's thumb on shot card; falls back when latest is in-progress | D-13/D-14/D-15; existing `versions` shape (Version DTO with `status` + `completed_at`); selection runs at HTTP route boundary, not in repo |
| VIS-06 | Small C2PA shield overlay on signed-version thumbnails (driven by Phase 14's `manifest_signed` event); redact event invalidates cached thumbnail before next read | D-08..D-12; existing `getC2paStatus` helper; Phase 16 `redactManifestForVersion` invalidation hook (D-05) |
</phase_requirements>

## Summary

Phase 17 is a **HIGH-confidence, low-risk additive milestone**. CONTEXT.md's 30 locked decisions cover virtually every meaningful design dimension; this research validates each against authoritative sources (Context7 `/lovell/sharp`, npm registry 2026-04-30, FFmpeg filter docs, project source) and surfaces the implementation specifics the planner needs.

**All 30 decisions validate cleanly.** Sharp 0.34.5 (latest stable, published 2025-11-06) supports `webp({quality: 80})` exactly as specified, exposes `sharp.concurrency(2)` global tuning, and `.stats()` returns per-channel `mean` for the brightness-threshold fallback. `@ffmpeg-installer/ffmpeg@1.1.0` (LGPL-2.1) ships per-platform optional binaries (`@ffmpeg-installer/darwin-arm64@4.1.5` for the dev box) and `.path` resolves to a CLI binary spawnable via `child_process.spawn` — no Node-side library bundling, separate-process invocation preserves MIT compatibility. The `-vf thumbnail` filter analyses up to `n=100` frames (default) and picks the most representative one; published behaviour is well-documented enough to drive a deterministic plan.

**Primary recommendation:** Build the engine module as a five-file unit (`format-router.ts` pure / `image-thumbnail.ts` sharp-only / `video-thumbnail.ts` ffmpeg-only / `cache.ts` pure-ish / `index.ts` barrel) mirroring `src/engine/c2pa/`. Wire HTTP routes (`GET /api/versions/:id/thumbnail` + `HEAD`) and the engine facade hook in the same plan that introduces the imports — never an orphaned import without its allowed-set assertion.

**One MEDIUM-confidence item flagged for the planner:** the Adobe Content Credentials "CR" icon (D-08) is "open source so it can be easily adopted" per c2pa.org and contentcredentials.org press materials, but no formal license file (MIT/Apache/CC) was discoverable on the contentauth GitHub org or the `contentcredentials.org/icon` URL (which 404'd at fetch time). The plan must include a "verify license terms before merging icon SVG" step.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Image thumbnail derivation (sharp resize → WebP) | API / Backend | — | Native binding lives in Node; output cached on server FS; client receives bytes only |
| MP4 first-frame extraction (ffmpeg subprocess) | API / Backend | — | Same; ffmpeg binary must run in a server-side process |
| Atomic FS cache + ETag computation | API / Backend | — | Disk is the storage; ETag derives from server-side mtime/sha |
| Cache invalidation hook on redact | API / Backend | — | Phase 16 atomic-rewrite path is server-side; hook fires after the rename |
| HTTP route surface (`GET/HEAD /api/versions/:id/thumbnail`) | API / Backend | — | Hono server route; same shape as existing `/output` |
| C2PA signing-state surfacing | API / Backend | Browser / Client | Server emits `X-C2PA-Signing-Status` on `HEAD /output`; dashboard reads via existing `getC2paStatus` helper and renders shield overlay |
| Lazy-load IntersectionObserver / `loading="lazy"` | Browser / Client | — | Native `<img loading="lazy">` is browser-native; Preact passes the attribute through unchanged |
| Skeleton placeholder render | Browser / Client | — | Pure component, no server interaction beyond URL probe |
| C2PA shield overlay rendering | Browser / Client | — | DOM composition over `<img>` element; no server rendering |
| TreeSidebar shot-row "latest completed" thumbnail selection | API / Backend | Browser / Client | Server runs `ORDER BY completed_at DESC LIMIT 1`; client renders the URL |

**Why this matters for planning:** every locked decision in CONTEXT.md respects this tier ownership. The architecture-purity allowed-set pin (D-23/D-24) keeps native bindings strictly in the API tier. The dashboard layer is a *consumer* — it never imports `sharp` or `@ffmpeg-installer/ffmpeg`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sharp` | `0.34.5` | libvips-backed image resize → WebP encode | `[VERIFIED: npm view sharp version → 0.34.5; published 2025-11-06]` Industry-standard Node image library, ~30× faster than jimp, native AVIF/WebP/animated-WebP, prebuilt platform binaries via `@img/sharp-{platform}` optional deps. Engines `^18.17.0 \|\| ^20.3.0 \|\| >=21.0.0` `[VERIFIED: npm view sharp engines]` — clean fit with project's `>=20`. |
| `@ffmpeg-installer/ffmpeg` | `1.1.0` | First-frame extraction from MP4 outputs (sole user) | `[VERIFIED: npm view @ffmpeg-installer/ffmpeg license → LGPL-2.1; version 1.1.0]` Separate-process invocation = MIT-compatible. The popular `ffmpeg-static@5.x` is GPL-3.0-or-later (license-viral; rejected). Per-platform optional deps: `@ffmpeg-installer/darwin-arm64@4.1.5`, linux-x64, win32-x64, etc. — only the host platform's binary downloads. `.path` exposes the binary; spawn via `child_process.spawn`. |

### Supporting (already in package.json)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nanoid` | `^5.1.9` | Unique 8-char suffix for atomic temp partial paths | Mirrors `src/engine/output-downloader.ts:188` `nanoid(8)` and `src/engine/c2pa/redaction.ts:745` `nanoidFn()` patterns |
| `hono` | `^4.12.14` | HTTP route shape for `GET/HEAD /api/versions/:id/thumbnail` | Mirrors existing `/api/versions/:id/output` shape at `src/http/dashboard-routes.ts:318-353` |
| `vitest` | `^4.1.4` | Unit + integration test runner | Mock `sharp` and `@ffmpeg-installer/ffmpeg` in non-thumbnail tests so server boot doesn't depend on native bindings |

### Alternatives Considered (already rejected in CONTEXT.md / STACK.md)
| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `sharp` | `jimp` (pure JS) | 10–30× slower; no AVIF; no WebP-animation. Acceptable for a script, unacceptable for the dashboard hot-path. |
| `sharp` | `node-canvas` | Designed for Canvas API rendering, not bulk resize; no AVIF in older versions. |
| `@ffmpeg-installer/ffmpeg` | `ffmpeg-static@5.x` | **GPL-3.0-or-later. License-viral against MIT.** `[VERIFIED: STACK.md research, npm registry]` |
| `@ffmpeg-installer/ffmpeg` | `fluent-ffmpeg` wrapper | Adds a wrapper API + weak typings; direct `child_process.spawn` is simpler and contained. |
| `@ffmpeg-installer/ffmpeg` | System `ffmpeg` (assume on PATH) | Operational fragility for the demo / out-of-the-box experience. **Use as a fallback only** — try bundled binary first, fall back to `process.env.VFX_FAMILIAR_FFMPEG_PATH \|\| 'ffmpeg'` if the bundled binary fails to spawn. |
| Multi-size responsive thumbnails (`?w=80\|160\|320\|640`) | `srcset` + 4 cached sizes | Defer to v1.3 per CONTEXT.md D-01 — single 640×360 covers TreeSidebar (CSS down-scale) AND VersionCard (native size). |

**Installation:**
```bash
npm install sharp@^0.34.5 @ffmpeg-installer/ffmpeg@^1.1.0
```

**Version verification (run during plan execution):**
```bash
npm view sharp version                          # expected: 0.34.5
npm view sharp engines                          # expected: ^18.17.0 || ^20.3.0 || >=21.0.0
npm view @ffmpeg-installer/ffmpeg license       # expected: LGPL-2.1
npm view @ffmpeg-installer/ffmpeg version       # expected: 1.1.0
npm view @ffmpeg-installer/darwin-arm64 version # expected: 4.1.5 (host platform binary)
```
Done 2026-04-30 — all verified `[VERIFIED: npm registry]`.

## Architecture Patterns

### System Architecture Diagram

Data flow for a thumbnail request — entry point at the HTTP route, processing through coalescing mutex + atomic write, exit as a streamed WebP response:

```
                       Browser
                          │
                          │  <img src="/api/versions/<id>/thumbnail" loading="lazy">
                          ▼
            ┌──────────────────────────────────────┐
            │  Hono HTTP route                      │
            │  GET/HEAD /api/versions/:id/thumbnail │
            │  src/http/dashboard-routes.ts (mod)   │
            └────────────────┬──────────────────────┘
                             │ resolves filename + filePath via existing
                             │ resolveOutputForVersion helper (line 256)
                             │ then delegates:
                             ▼
            ┌──────────────────────────────────────────────┐
            │  engine.generateThumbnail(versionId, file)    │
            │  src/engine/pipeline.ts (NEW method)          │
            └────────────────┬───────────────────────────────┘
                             │
                             ▼
              ┌─────────────────────────────────┐
              │  thumbnailMutex (coalescing)    │  ← shape mirrors signMutex at
              │  Map<key, Promise<...>>          │     pipeline.ts:288-291
              │  key = `${versionId}::${file}`   │
              └────────────────┬────────────────┘
                               │
                  ┌────────────┴───────────────┐
                  │   Cache hit? (.thumb.webp) │
                  └────┬──────────┬────────────┘
                       │ yes      │ no
                       ▼          ▼
            ┌──────────┴──┐    ┌──────────────────────────────────┐
            │ Serve from  │    │  format-router.routeThumbnail()    │  pure
            │ disk + ETag │    │  (extension → 'image' | 'video' |  │
            └─────────────┘    │   'unsupported')                   │
                               └─────────────┬─────────────────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              │ image        │ video        │ unsupported
                              ▼              ▼              ▼
                  ┌───────────────────┐ ┌───────────────┐ ┌──────────────┐
                  │ image-thumbnail.ts │ │video-thumb.ts │ │ write          │
                  │ lazy import sharp  │ │lazy import     │ │ .thumb.failed   │
                  │ resize→webp(q=80)  │ │@ffmpeg-installer│ │ sentinel + emit │
                  │ .toFile(temp)      │ │spawn(-vf       │ │ THUMBNAIL_FAILED│
                  │ rename(temp,final) │ │  thumbnail)    │ └──────┬──────────┘
                  │                    │ │stats() lum     │        │
                  │                    │ │check → fallback│        │
                  │                    │ │(-ss 1.0)       │        │
                  │                    │ │.toFile(temp)   │        │
                  │                    │ │rename(t,final) │        │
                  └────────┬───────────┘ └───────┬────────┘        │
                           │                     │                  │
                           ▼                     ▼                  │
                       ┌────────────────────────────┐               │
                       │ <outputsDir>/<vid>/        │               │
                       │   <file>.thumb.webp         │←──────────────┘
                       │   <file>.thumb.<nano>.partial (transient)   │
                       │   <file>.thumb.failed (sentinel)            │
                       └─────────────┬──────────────┘
                                     │
                                     │ stream WebP bytes back
                                     │ + ETag + Cache-Control + Content-Type
                                     ▼
                                  Browser renders <img>


Phase 16 redaction path (invalidation hook):

  redactManifestForVersion (src/engine/c2pa/redaction.ts:556+)
       │
       │ atomic re-sign + atomic rename (lines 740-758)
       ▼
  engine.invalidateThumbnail(versionId, filename)  ← NEW call, AFTER atomic rename
       │
       ▼
  unlink <outputsDir>/<vid>/<file>.thumb.webp      ← idempotent (catch ENOENT)
  unlink <outputsDir>/<vid>/<file>.thumb.failed    ← also clear sentinel
       │
       ▼
  Next /thumbnail request → cache miss → fresh generation from rewritten bytes
```

### Recommended Project Structure (mirrors src/engine/c2pa/)
```
src/engine/thumbnails/                    # NEW module
├── index.ts                              # Barrel export — mirrors c2pa/index.ts shape
├── format-router.ts                      # Pure: ext → 'image' | 'video' | 'unsupported'
├── image-thumbnail.ts                    # SOLE sharp importer (D-23). Lazy import.
├── video-thumbnail.ts                    # SOLE @ffmpeg-installer/ffmpeg importer (D-24). Lazy import.
└── cache.ts                              # Pure-ish: path derivation + isCacheFresh + computeETag

src/engine/pipeline.ts                    # MODIFIED — add generateThumbnail + invalidateThumbnail
src/engine/c2pa/redaction.ts              # MODIFIED — call engine.invalidateThumbnail AFTER atomic rename
src/engine/errors.ts                      # MODIFIED — add 'THUMBNAIL_FAILED' code
src/http/dashboard-routes.ts              # MODIFIED — add GET/HEAD /api/versions/:id/thumbnail
src/__tests__/architecture-purity.test.ts # MODIFIED — add sharp + ffmpeg allowed-set blocks (D-25)

packages/dashboard/src/components/
├── Thumbnail.tsx                         # NEW — thin wrapper (img + skeleton + shield overlay)
├── C2paShield.tsx                        # NEW — pure SVG component (CR mark)
├── VersionCard.tsx                       # MODIFIED — replace lines 52-59 inline <img> with <Thumbnail/>
└── TreeSidebar.tsx                       # MODIFIED — add leading <Thumbnail/> on shot rows (D-13)

packages/dashboard/src/lib/api.ts         # MODIFIED — add getThumbnailUrl(versionId) helper

packages/dashboard/src/assets/            # NEW (or use inline SVG in C2paShield.tsx)
└── content-credentials-cr.svg            # OR inline — see Open Questions on license
```

### Pattern 1: Lazy native-binding import + monotonic graceful degradation
**What:** `sharp` and `@ffmpeg-installer/ffmpeg` use `await import('...')` so server boot survives missing native bindings. Failure to load → cache the failure (`monotonic fail`) → all subsequent calls write `.thumb.failed` sentinels and return null.
**When:** Every native binding (D-26).
**Source:** Mirrors Phase 14 `c2pa-node` pattern at `src/engine/c2pa/signer.ts` (Concern #11).
**Example:**
```typescript
// src/engine/thumbnails/image-thumbnail.ts
let cachedSharp: typeof import('sharp').default | null = null;
let cachedSharpFailed: { reason: string; loggedOnce: boolean } | null = null;

async function getSharp(): Promise<typeof import('sharp').default | null> {
  if (cachedSharp) return cachedSharp;
  if (cachedSharpFailed) return null; // monotonic fail
  try {
    const mod = await import('sharp');
    cachedSharp = mod.default;
    // Set global tuning ONCE on first successful load (D-discretion).
    cachedSharp.concurrency(2);   // PITFALLS #7 stampede mitigation
    cachedSharp.cache(false);     // server context — disable libvips operation cache
    return cachedSharp;
  } catch (err) {
    cachedSharpFailed = { reason: String(err), loggedOnce: false };
    if (!cachedSharpFailed.loggedOnce) {
      console.warn(`vfx-familiar: sharp load failed — thumbnails disabled. ${cachedSharpFailed.reason}`);
      cachedSharpFailed.loggedOnce = true;
    }
    return null;
  }
}
```

### Pattern 2: Coalescing mutex (signMutex shape)
**What:** Concurrent requests for the same `(versionId, filename)` share one in-flight Promise; different keys run in parallel. Direct copy of `signMutex` at `src/engine/pipeline.ts:288-291`.
**When:** Pure-derivation tasks (idempotent for given content) — D-21. **NOT** the FIFO `assetWriterMutex` (which serializes sign vs. redact non-interleaving).
**Source:** `[VERIFIED: src/engine/pipeline.ts:288-291]`.
**Example:**
```typescript
// src/engine/pipeline.ts (additions)
private readonly thumbnailMutex = new Map<
  string,
  Promise<{ filePath: string; contentType: string; etag: string } | null>
>();

async generateThumbnail(versionId: string, filename: string): Promise<...> {
  const key = `${versionId}::${filename}`;
  const inflight = this.thumbnailMutex.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    try { return await this.deriveThumbnail(versionId, filename); }
    finally { this.thumbnailMutex.delete(key); }
  })();
  this.thumbnailMutex.set(key, promise);
  return promise;
}
```

### Pattern 3: Atomic write via temp + rename (mkstemp+rename)
**What:** Write to `${cachePath}.${nanoid(8)}.partial` via sharp `.toFile()`, then `rename()` to `cachePath`. Half-written WebP cannot be served by a concurrent reader.
**When:** Every cache write (D-22).
**Source:** Mirrors `src/engine/output-downloader.ts:188-198` and `src/engine/c2pa/redaction.ts:746-749`. Both use `nanoid(8)` for the unique partial suffix.
**Example:**
```typescript
import { rename, unlink } from 'node:fs/promises';
import { nanoid } from 'nanoid';
const cachePath = `${outputRoot}/${versionId}/${filename}.thumb.webp`;
const tempPath  = `${cachePath}.${nanoid(8)}.partial`;
try {
  await sharpInstance(sourcePath)
    .resize(640, 360, { fit: 'inside', withoutEnlargement: true })  // D-04: source aspect
    .webp({ quality: 80 })                                          // D-03
    .toFile(tempPath);
  await rename(tempPath, cachePath);
} catch (err) {
  await unlink(tempPath).catch(() => {});                            // best-effort cleanup
  throw err;
}
```
**EXDEV note:** `output-downloader.ts:219-229` already implements a `renameWithFallback` that copies on `EXDEV`. The thumbnail write lives under the same `outputRoot` as the source — the partial and final paths are co-located so `EXDEV` is structurally impossible. No fallback needed here.

### Pattern 4: ETag = `sha256:<source_mtime>` (with optional sha-prefix override)
**What:** Conditional GET via `If-None-Match` returns 304. ETag changes when source bytes change (Phase 16 redact rewrites the file → mtime advances → ETag advances).
**When:** Every successful cache serve (D-06).
**Example:**
```typescript
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function computeETag(sourcePath: string, sha256?: string | null): Promise<string> {
  if (sha256) return `"sha256:${sha256}"`;       // strong validator from outputs_json[0].sha256
  const st = await stat(sourcePath);
  // hash the mtime (ms-precision) so the ETag is content-addressed enough for HTTP semantics
  const h = createHash('sha256').update(`${st.mtimeMs}`).digest('hex').slice(0, 16);
  return `"mtime:${h}"`;
}
```

### Pattern 5: HTTP route shape — strong ETag + immutable cache + If-None-Match
**Source:** Existing `/api/versions/:id/output` at `src/http/dashboard-routes.ts:318-353`. The new thumbnail route mirrors the shape but with thumbnail-specific headers.

**Recommended Cache-Control:** `public, max-age=31536000, immutable` — safe because the ETag invalidates correctly when the source mtime changes. Existing `/output` uses `max-age=3600`, but `/output` is content-by-version-id and lacks an ETag. The thumbnail route's strong ETag means the browser will conditional-GET on every navigation; `immutable` cuts that round-trip when fresh.

**Trade-off captured for plan:** Reuse `max-age=3600` (matches `/output` precedent) if the planner prefers consistency with the existing route. Both choices are correct — strong ETag + 304 on If-None-Match makes either work safely.

### Pattern 6: Brightness-threshold fallback for MP4 black-frame (D-29)
**What:** ffmpeg's `-vf thumbnail` filter analyses up to `n=100` frames (default) and picks the most "representative" one based on inter-frame histogram comparison. Some videos start with a fade-in or slate; the picked frame may be too dark to be useful. Fall back to a fixed 1.0s seek if average luminance falls below threshold.
**When:** Every video thumbnail extraction (VIS-04).
**Sharp brightness analysis:** `[VERIFIED: Context7 /lovell/sharp api-input.md]` `.stats()` returns `channels: [{ mean: number }, ...]`. For an RGB image (3 channels), average luminance ≈ `(0.299*R.mean + 0.587*G.mean + 0.114*B.mean)` (BT.601 luma). For RGBA, ignore the alpha channel. Threshold: avg luminance < 16/255 (≈ 6.3%) = "too dark, retry seek".

**Example flow:**
```typescript
// 1. First extraction attempt — let -vf thumbnail pick.
await spawnFfmpeg([
  '-i', sourcePath,
  '-vf', 'thumbnail,scale=640:-1',
  '-frames:v', '1',
  '-f', 'image2',                  // sharp can read PNG from disk; image2 is the muxer
  '-vcodec', 'png',
  tempPngPath,
], { timeoutMs: 10_000 });

// 2. Brightness check via sharp.
const stats = await sharp(tempPngPath).stats();
const [r, g, b] = stats.channels;
const luma = 0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean;

if (luma < 16) {
  // 3. Fallback — 1.0s seek (D-29).
  await spawnFfmpeg([
    '-ss', '1.0',                  // seek BEFORE -i for fast demuxer-level seek
    '-i', sourcePath,
    '-vf', 'scale=640:-1',
    '-frames:v', '1',
    '-f', 'image2',
    '-vcodec', 'png',
    tempPngPath,
  ], { timeoutMs: 10_000 });
}

// 4. Re-encode the resulting PNG to WebP via sharp (consistency with image path).
await sharp(tempPngPath).webp({ quality: 80 }).toFile(thumbTempPath);
await rename(thumbTempPath, finalPath);
await unlink(tempPngPath).catch(() => {});
```

**Note on `-ss` placement:** `-ss BEFORE -i` is fast (demuxer-level seek, <1s) but inaccurate to ~keyframe precision. For 1.0s seek of a typical generated video, this is fine — H.264 keyframe interval is usually 1-2s, and we're not building a precision frame-grabber. Pinning here so the plan doesn't drift.

### Pattern 7: Phase 16 redact-invalidation hook
**What:** After `redactManifestForVersion` completes the atomic rename of the rewritten asset bytes (currently at `src/engine/c2pa/redaction.ts:740-749`), call `engine.invalidateThumbnail(versionId, filename)`. The hook deletes both the `.thumb.webp` and the `.thumb.failed` sentinel (idempotent — `unlink().catch(() => {})`).
**When:** ONLY at the redact call site (D-05). Phase 14 sign hook does NOT need invalidation because v1 of the file did not yet have a thumbnail (sign happens at download time, before any dashboard read).
**Source location for hook:** `src/engine/c2pa/redaction.ts` after line 749 (the `atomicRename(tempPathFresh, fullPath)` call). The redact flow already runs inside `assetWriterMutex` so the invalidation is serialized with sign/redact.
**Crucial detail:** The hook must call into the engine facade (`engine.invalidateThumbnail`), NOT directly into `src/engine/thumbnails/cache.ts`. The redaction module already has zero non-c2pa engine imports; reaching into `thumbnails/` would violate that boundary. Use the `EngineForC2pa`-style structural Pick pattern (precedent: `src/engine/output-downloader.ts:58-68`).

### Pattern 8: Architecture-purity allowed-set extension (D-25)
**What:** Two new test blocks in `src/__tests__/architecture-purity.test.ts`, each mirroring the c2pa-node block at lines 190-230 (sorted-array deepEqual exact membership).
**Source:** `[VERIFIED: src/__tests__/architecture-purity.test.ts:190-230]`.
**Example:**
```typescript
// New block — Phase 17 / sharp purity
it('sharp imports are centralized in src/engine/thumbnails/image-thumbnail.ts', () => {
  const allowedSharpImporters = new Set<string>([
    'src/engine/thumbnails/image-thumbnail.ts',
  ]);
  let out = '';
  try {
    out = execFileSync('grep', [
      '-rlE',
      "from[[:space:]]*['\"]sharp|import[[:space:]]*\\([[:space:]]*['\"]sharp",
      'src/',
    ], { encoding: 'utf8' });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 1) throw err;
  }
  const files = out ? out.trim().split('\n').filter(Boolean) : [];
  const nonTestFiles = files.filter(f => !f.includes('__tests__/'));
  // (a) Subset check — no rogue importer outside the allowed set.
  const violations = nonTestFiles.filter(f => !allowedSharpImporters.has(f));
  expect(violations, `sharp imports outside the allowed list:\n${violations.join('\n')}`).toEqual([]);
  // (b) SET-equality on the actual importers (sorted-array deepEqual).
  const expectedActualImporters = [
    'src/engine/thumbnails/image-thumbnail.ts',
  ].sort();
  expect([...nonTestFiles].sort()).toEqual(expectedActualImporters);
});

// Same shape for @ffmpeg-installer/ffmpeg → src/engine/thumbnails/video-thumbnail.ts
// Plus directory-level guards for src/engine/thumbnails/ (no MCP / SQLite / Drizzle / Hono imports)
```

### Anti-Patterns to Avoid
- **Eager generation at download time (Phase 14 hook):** Adds latency to the hot generation-completion path; couples thumbnails to the C2PA signing chain (already at the edge of the latency budget); thumbnails for legacy versions never get generated. Per CONTEXT.md D-20 explicitly. Use generate-on-demand.
- **Reaching into `src/engine/thumbnails/` from the redaction module:** Would violate the c2pa-module boundary. Use the engine facade hook.
- **Putting the C2PA shield render decision in the server:** Server already emits `X-C2PA-Signing-Status`. The client's `getC2paStatus` helper consumes it. Keep the render predicate (`status === 'signed'`) in the dashboard component (D-10), NOT in the server response.
- **Hand-rolling lazy-load:** `loading="lazy"` is native in every modern browser (97%+ in 2026 per caniuse). IntersectionObserver wrapper would add JS bundle weight for zero gain. Just pass `loading="lazy"` through Preact JSX — it's a standard HTML attribute, no React-style quirks.
- **Caching the `Sharp` instance across requests:** Sharp instances hold libvips state. Always create a fresh `sharp(sourcePath)` per call. The `sharp.concurrency(2)` global cap is the right knob; instance reuse is wrong.
- **Multi-size cache:** D-01 explicitly defers to v1.3. The single 640×360 size covers TreeSidebar (CSS down-scale via `object-fit`) AND VersionCard (native size). One cache entry per version-output is the correct v1.2 envelope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image resize | Custom canvas / pure-JS pixel loop | `sharp` 0.34.5 | libvips is 30× faster + handles WebP/AVIF/animated/EXIF/ICC. |
| WebP encoding | Hand-rolled libwebp wrapper | `sharp().webp({ quality: 80 })` | Native bindings via @img/sharp-{platform}; tuning via documented options. |
| Brightness analysis | Pixel-loop in Node | `sharp().stats()` returns per-channel `mean` | Single libvips operation; no loop needed. |
| Thumbnail-frame extraction (MP4) | Demuxer in Node | ffmpeg `-vf thumbnail` filter | Battle-tested heuristic that picks representative frame from first ~100 frames. Implementing this in Node would be a six-month project. |
| MP4 first-frame seek | Custom h264-parse | ffmpeg `-ss 1.0 -i` (demuxer-level seek) | Sub-second on any codec; hand-rolling demands a parser per codec. |
| Lazy-load images | IntersectionObserver wrapper | `<img loading="lazy">` | Native attribute; 97% browser coverage; zero JS bundle cost. |
| Atomic file write | `fs.writeFile` + hope | `mkstemp`-style `nanoid(8).partial` + `rename` | Project precedent at `output-downloader.ts:188` and `redaction.ts:746`. |
| ETag generation | Hash the whole file | `sha256:<source_mtime>` (cheap) or `outputs_json[0].sha256` (already computed) | Hashing the file on every request is O(file_size) — kills 304 economics. |
| Coalescing mutex | Custom Promise.race / queue | `Map<key, Promise>` (signMutex shape) | Project precedent at `pipeline.ts:288-291`. 8 lines, correct, audited. |
| File-format detection | Trust extension blindly | Same path as Phase 14 — extension is canonical here because the source file is recorded in `outputs_json[0].filename` which the engine controls | Phase 14's `format-router.ts` lookup table is the precedent. (Magic-bytes detection via `file-type` package is overkill — Phase 14 PITFALLS #13 mitigation already locked extension-only routing for the c2pa pipeline; thumbnails inherit.) |

**Key insight:** Two libraries (`sharp` + `@ffmpeg-installer/ffmpeg`) cover **every** technical decision in this phase except the HTTP route shape and the dashboard component composition. Both are project-internal patterns the planner copies verbatim from existing files. Any "let's just write a quick Sharp wrapper" temptation is the wrong answer — the standard library + project conventions cover it.

## Runtime State Inventory

> Phase 17 is **additive greenfield** for the thumbnail surface, but it touches Phase 16's redact path. Most categories don't apply; one does.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — thumbnails are pure FS-derived bytes from immutable source. No DB rows, no schema migration. | None |
| Live service config | None — no SaaS wiring; sharp + ffmpeg run in-process. | None |
| OS-registered state | None — no scheduled tasks, no daemons. | None |
| Secrets / env vars | Optional `VFX_FAMILIAR_FFMPEG_PATH` env (recommended fallback per STACK.md §"If thumbnail input is MP4"). Read by `video-thumbnail.ts` lazily. No secret content. | Document in `.env.example` if planner introduces the fallback knob (Claude's discretion). |
| Build artifacts / installed packages | `sharp` 0.34.5 carries ~25 optional platform binaries; only the host's `@img/sharp-{platform}` actually downloads (~8 MB). `@ffmpeg-installer/ffmpeg` 1.1.0 carries 8 platform optionals; `@ffmpeg-installer/darwin-arm64@4.1.5` is ~75 MB on the dev box. **Existing C2PA build artifacts are not affected.** | None — npm install handles this. Document the disk footprint in the plan so reviewer isn't surprised. |
| **Phase 16 redact path (existing runtime state)** | `redactManifestForVersion` at `src/engine/c2pa/redaction.ts:556+` already runs inside `assetWriterMutex` and rewrites bytes via atomic rename. **The new `engine.invalidateThumbnail(versionId, filename)` call lands AFTER the rename (line 749).** | Single explicit code edit per D-05; serialize within existing mutex; idempotent unlink. No data migration. |

**Nothing found in any other category — verified by grep over `src/`, `drizzle/`, `.env*`, `scripts/`, and reviewing project docs.**

## Common Pitfalls

> Inherits PITFALLS #6 / #7 / #8 / #13 from `.planning/research/PITFALLS.md`. New pitfalls surface during this Phase-17-specific research are listed below; the existing four are summarized for the planner's convenience.

### Pitfall A (existing): MP4 frame extraction OOM on long videos
**Mitigation locked by D-30:** 100 MB pre-flight skip + 10 s ffmpeg timeout. Both surface as typed reasons (`source_too_large` / `ffmpeg_timeout`). Test fixture: synthetic 200 MB MP4 in `__tests__/fixtures/oversized.mp4` (or generated at test time via ffmpeg's lavfi source — `-f lavfi -i testsrc=duration=600:size=1920x1080:rate=30`).

### Pitfall B (existing): Concurrent thumbnail generation stampede
**Mitigation locked by D-21 + Claude's discretion:** Per-(versionId, filename) coalescing mutex + `sharp.concurrency(2)` global + dashboard fetch queue cap of 6. Acceptance test: spawn 50 concurrent `GET /api/versions/:id/thumbnail` requests for distinct keys, assert p99 latency < 5s; 50 concurrent for the SAME key, assert exactly 1 sharp invocation.

### Pitfall C (existing): Thumbnail cache poisoning after redact
**Mitigation locked by D-05:** explicit `invalidateThumbnail` hook AFTER atomic rename in `redactManifestForVersion`. ETag derives from source mtime so the browser conditional-GETs after invalidation. Multi-encoding leak scan (Pitfall G below) extends to the thumbnail cache path.

### Pitfall D (existing): Unsupported format thumbnail failure (HEIC / EXR / PSD)
**Mitigation:** `format-router.ts` returns `{ kind: 'unsupported', ext }` for unrouted extensions. Engine writes `.thumb.failed` sentinel + emits `THUMBNAIL_FAILED:unsupported_format` typed warning. Dashboard renders `<SkeletonThumbnail/>` (D-07 unified treatment). Acceptable formats per Phase 14 routing precedent: PNG / JPEG / WebP / TIFF / MP4 (and animated WebP via sharp `{ animated: true }`). EXR / PSD / HEIC route to unsupported.

### Pitfall E (NEW): C2PA "CR" icon license uncertainty
**What goes wrong:** Planner ships a C2PA shield SVG embedded in the dashboard build. Months later a license review (ISO 27001, SOC 2, or open-source-compliance audit) flags the SVG as having no LICENSE / NOTICE attribution. Adobe / C2PA may publish guidance restricting "implies endorsement" usage post-fact.
**Why it happens:** `contentcredentials.org/icon` 404s at fetch (2026-04-30); c2pa.org press materials say the icon is "open source" but no formal license text was discoverable on the contentauth GitHub org or in any of the c2pa-org / contentauth repos. The CAI brand kit may exist but isn't linked from any landing page.
**How to avoid:**
1. **Plan-time verification:** Planner adds a task "verify Content Credentials icon license terms before merge" — fetch the c2pa.org press kit, contact contentauth via GitHub issue if needed, capture the license text in the PR description.
2. **Fallback option:** If the official "CR" icon's license is unclear, use a **lucide-preact** shield-check icon (already in deps for ChevronDown — see `TreeSidebar.tsx:33`) with the visible text label "C2PA" beneath. This is less brand-recognizable but legally clean.
3. **NEVER inline-base64 the SVG:** keeps any license text + attribution comments in a discoverable file under `packages/dashboard/src/assets/content-credentials-cr.svg`.
**Warning signs:** No `LICENSE`/`NOTICE` next to the SVG; commit message references "Adobe icon" without a source URL.

### Pitfall F (NEW): Sharp instance memory pressure (libvips operation cache)
**What goes wrong:** Sharp's libvips backend has its own operation cache (default: 50 MB / 20 files / 100 items per `sharp.cache()` `[VERIFIED: Context7 /lovell/sharp api-utility.md]`). On a server that runs hundreds of thumbnail generations during a busy period, this is per-process (libvips is process-scoped). Dashboard load tests show RSS climbing under bursty thumbnail traffic — but the operation cache is only useful for repeated identical operations, which is rare in a thumbnail pipeline (every source is distinct).
**Why it happens:** Default cache is sized for repeat-operation workloads (a CDN resizing the same source to 4 sizes). For one-shot thumbnails it's pure memory waste.
**How to avoid:**
1. `sharp.cache(false)` at module load — disables the libvips operation cache. Documented in code comment as a thumbnail-specific tuning.
2. Pair with `sharp.concurrency(2)` (D-discretion) to bound concurrent libvips threads — multiplied by per-image worker threads.
3. Monitor: log `sharp.counters()` (queue + process counters) once per minute via existing telemetry surface (if planner adds one). Not blocking for v1.2 ship.
**Warning signs:** RSS > 400 MB under burst; sharp.counters().queue > 10 sustained.
**Source:** `[VERIFIED: Context7 /lovell/sharp api-utility.md]` — `sharp.cache(false)` disables; `sharp.concurrency(N)` caps threads.

### Pitfall G (NEW): Multi-encoding leak scan extends to thumbnail cache + sentinel paths
**What goes wrong:** A redaction event removes a sensitive prompt from the C2PA manifest, but the thumbnail cache (under the same outputsDir) was generated BEFORE the redact, when the source asset still embedded the un-redacted manifest. The cached `.thumb.webp` may contain image bytes that visually leak (e.g., watermark, chart text, prompt-text-rendered-into-image). Even if the visual surface is clean, the sentinel path (`.thumb.failed`) might have logged the source filename — which could itself be sensitive.
**Why it happens:** Phase 14 / 16 multi-encoding leak scan (UTF-8 + UTF-16LE + UTF-16BE + base64) currently scans active manifest projections only. Thumbnail cache is a NEW byte surface introduced in v1.2.
**How to avoid:**
1. **Test extension:** the existing leak-scan helper (`src/__tests__/c2pa-redaction-uat-mcp-tool.test.ts:91-107` — `assertNotInBuffer(buf, secret, label)`) extends to scan `<outputsDir>/<versionId>/<filename>.thumb.webp` AFTER a redact event. Acceptance: any sensitive substring originally present in the redacted prompt MUST NOT appear in the post-invalidation regenerated thumb's bytes (mostly relevant for text-rendering AI outputs where the prompt text is literally drawn into the image).
2. **Sentinel hygiene:** `.thumb.failed` writes only the typed reason (`unsupported_format`, etc.) — NEVER the source filename or path. Planner explicit comment-pin in the code.
3. **Invalidation symmetry:** the redact hook (D-05) deletes BOTH `.thumb.webp` AND `.thumb.failed` under the version directory. Idempotent.

### Pitfall H (NEW): Preact `loading="lazy"` attribute pass-through
**What goes wrong:** A planner unfamiliar with Preact/React differences worries that `loading="lazy"` won't pass through JSX → DOM and writes a custom IntersectionObserver wrapper.
**Why it happens:** React (pre-17) had quirky handling of some HTML attributes (`autofocus` etc.); some folklore has carried forward.
**How to avoid:** **Preact 10+ passes through ALL standard HTML attributes verbatim.** `<img loading="lazy" />` works exactly as native HTML. No wrapper needed. `[VERIFIED: Preact docs + project precedent — VersionCard.tsx:57 already uses loading="lazy" successfully]`.
**Source confirmation:** Existing `packages/dashboard/src/components/VersionCard.tsx:57` already passes `loading="lazy"` through Preact JSX. The phase-17 thumbnail component inherits this proven pattern.

### Pitfall I (NEW): TreeSidebar density + skeleton dimensions mismatch
**What goes wrong:** Planner uses default 160×90 SkeletonThumbnail in TreeSidebar shot rows, but TreeSidebar's `--sidebar-width` CSS variable + nested padding (8 + depth*12 px = up to 8 + 3*12 = 44 px at depth 3) leaves only ~120 px of usable width. 160 px overflows or wraps.
**Why it happens:** SkeletonThumbnail's default 160×90 was sized for the main grid VersionCard, not the tree.
**How to avoid:**
1. **Measurement:** TreeRow at depth 3 has `paddingLeft: '${8 + 3*12}px'` = 44 px. With sidebar width ~280 px (typical) and ~30 px right margin for chevron/text, usable thumb width is ~200 px max but visually 64×36 (16:9) reads cleanly without crowding the shot name.
2. **Recommendation (Claude's discretion):** Pass `width=64, height=36` to `<SkeletonThumbnail/>` in TreeSidebar shot rows. Same for `<Thumbnail/>` — a 640-source CSS-downscaled to 64×36 looks crisp on retina.
3. **Confirm at plan time:** Take a screenshot of the dashboard with placeholder thumbs at the candidate dimensions; spot-check that shot names remain readable.

## Code Examples

Verified patterns from official sources + project precedents:

### Image thumbnail derivation (sharp)
```typescript
// src/engine/thumbnails/image-thumbnail.ts — SOLE sharp importer (D-23)
// Source: Context7 /lovell/sharp api-output.md, api-resize.md
// Project precedent: src/engine/output-downloader.ts atomic write

import { rename, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { nanoid } from 'nanoid';

let cachedSharp: typeof import('sharp').default | null = null;
let cachedSharpFailed: { reason: string } | null = null;

async function getSharp() {
  if (cachedSharp) return cachedSharp;
  if (cachedSharpFailed) return null;
  try {
    const mod = await import('sharp');
    cachedSharp = mod.default;
    cachedSharp.concurrency(2);  // PITFALL B
    cachedSharp.cache(false);    // PITFALL F
    return cachedSharp;
  } catch (err) {
    cachedSharpFailed = { reason: String(err) };
    return null;
  }
}

export async function generateImageThumbnail(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  const sharp = await getSharp();
  if (!sharp) {
    throw new Error('sharp_load_failed');
  }
  await mkdir(dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.${nanoid(8)}.partial`;
  try {
    await sharp(sourcePath)
      .resize(640, 360, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(tempPath);
    await rename(tempPath, destPath);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

export async function getImageBrightness(imagePath: string): Promise<number> {
  // BT.601 luma — covers RGB and RGBA (ignores alpha for stats)
  const sharp = await getSharp();
  if (!sharp) throw new Error('sharp_load_failed');
  const stats = await sharp(imagePath).stats();
  const ch = stats.channels;
  if (ch.length < 3) return ch[0]?.mean ?? 0;  // grayscale fallback
  return 0.299 * ch[0]!.mean + 0.587 * ch[1]!.mean + 0.114 * ch[2]!.mean;
}
```

### Video thumbnail derivation (ffmpeg)
```typescript
// src/engine/thumbnails/video-thumbnail.ts — SOLE @ffmpeg-installer/ffmpeg importer (D-24)
// Source: ffmpeg thumbnail filter docs (ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Video/thumbnail.html)
// Project precedent: src/engine/output-downloader.ts atomic write + redaction.ts temp dir

import { spawn } from 'node:child_process';
import { stat, rename, unlink, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, extname } from 'node:path';
import { nanoid } from 'nanoid';

let cachedFfmpegPath: string | null = null;
let cachedFfmpegFailed: { reason: string } | null = null;

async function getFfmpegPath(): Promise<string | null> {
  if (cachedFfmpegPath) return cachedFfmpegPath;
  if (cachedFfmpegFailed) return null;
  try {
    const mod = await import('@ffmpeg-installer/ffmpeg');
    cachedFfmpegPath = mod.path ?? mod.default?.path ?? null;
    if (!cachedFfmpegPath) {
      cachedFfmpegFailed = { reason: 'ffmpeg_path_missing' };
      return null;
    }
    return cachedFfmpegPath;
  } catch (err) {
    cachedFfmpegFailed = { reason: String(err) };
    return null;
  }
}

const SOURCE_SIZE_LIMIT = 100 * 1024 * 1024; // D-30
const FFMPEG_TIMEOUT_MS = 10_000;            // D-30
const BRIGHTNESS_THRESHOLD = 16;             // D-29 (avg luminance < 16/255)

export async function generateVideoThumbnail(
  sourcePath: string,
  destPath: string,
  /** injected from image-thumbnail to avoid double sharp-import */
  brightnessFn: (path: string) => Promise<number>,
  webpFromPng: (pngPath: string, webpPath: string) => Promise<void>,
): Promise<void> {
  // 1. Pre-flight size guard (D-30, PITFALL A)
  const st = await stat(sourcePath);
  if (st.size > SOURCE_SIZE_LIMIT) {
    throw new Error('source_too_large');
  }

  const ffmpegPath = await getFfmpegPath();
  if (!ffmpegPath) throw new Error('ffmpeg_load_failed');

  await mkdir(dirname(destPath), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), `vfx-thumb-${nanoid(6)}-`));
  const pngTemp = join(work, 'frame.png');

  try {
    // 2. First attempt — -vf thumbnail for representative frame (D-28)
    await spawnFfmpeg(ffmpegPath, [
      '-i', sourcePath,
      '-vf', 'thumbnail,scale=640:-1',
      '-frames:v', '1',
      '-vcodec', 'png',
      '-f', 'image2',
      '-y', pngTemp,
    ], FFMPEG_TIMEOUT_MS);

    // 3. Brightness check (D-29)
    const luma = await brightnessFn(pngTemp);
    if (luma < BRIGHTNESS_THRESHOLD) {
      // Fallback — 1.0s seek (fast demuxer-level seek when -ss is BEFORE -i)
      await spawnFfmpeg(ffmpegPath, [
        '-ss', '1.0',
        '-i', sourcePath,
        '-vf', 'scale=640:-1',
        '-frames:v', '1',
        '-vcodec', 'png',
        '-f', 'image2',
        '-y', pngTemp,
      ], FFMPEG_TIMEOUT_MS);
    }

    // 4. Re-encode PNG to WebP via sharp (atomic write inside webpFromPng)
    const tempPath = `${destPath}.${nanoid(8)}.partial`;
    await webpFromPng(pngTemp, tempPath);
    await rename(tempPath, destPath);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function spawnFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 8192) stderr = stderr.slice(-4096); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg_timeout')); }, timeoutMs);
    proc.once('error', err => { clearTimeout(timer); reject(err); });
    proc.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg_failed:${code}:${stderr.slice(-512)}`));
    });
  });
}
```

### Format router (pure)
```typescript
// src/engine/thumbnails/format-router.ts — pure function, mirrors c2pa/format-router.ts shape
// No I/O, no side effects, no native bindings. Architecture-pure.

export type ThumbnailRoute =
  | { kind: 'image' }
  | { kind: 'video' }
  | { kind: 'unsupported'; reason: 'unknown_extension' | 'native_handler_missing' };

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tiff', '.tif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm']);
const NATIVE_HANDLER_MISSING = new Set(['.exr', '.psd', '.heic']);  // PITFALL D

export function routeThumbnailFormat(filename: string): ThumbnailRoute {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return { kind: 'unsupported', reason: 'unknown_extension' };
  const ext = filename.slice(dot).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return { kind: 'image' };
  if (VIDEO_EXTS.has(ext)) return { kind: 'video' };
  if (NATIVE_HANDLER_MISSING.has(ext)) return { kind: 'unsupported', reason: 'native_handler_missing' };
  return { kind: 'unsupported', reason: 'unknown_extension' };
}
```

### HTTP route shape
```typescript
// src/http/dashboard-routes.ts (additions) — mirrors /api/versions/:id/output at lines 318-353

app.get('/api/versions/:id/thumbnail', async (c) => {
  const versionId = c.req.param('id');
  const { filename, filePath } = resolveOutputForVersion(versionId);  // existing helper

  const result = await engine.generateThumbnail(versionId, filename, filePath);
  if (result === null) {
    // .thumb.failed sentinel exists — serve a 503 (or 404 with clear typed body)
    return c.json({ error: { code: 'THUMBNAIL_UNAVAILABLE', message: 'Thumbnail generation failed' } }, 503);
  }

  // 304 path
  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === result.etag) {
    return c.body(null, 304, {
      'ETag': result.etag,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  }

  const nodeStream = createReadStream(result.filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return c.body(webStream, 200, {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': result.etag,
  });
});

app.on('HEAD', '/api/versions/:id/thumbnail', async (c) => {
  const versionId = c.req.param('id');
  const { filename, filePath } = resolveOutputForVersion(versionId);
  const result = await engine.generateThumbnail(versionId, filename, filePath);
  if (result === null) return c.body(null, 503);
  return c.body(null, 200, {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': result.etag,
  });
});
```

### Dashboard `<Thumbnail/>` wrapper (recommended)
```tsx
// packages/dashboard/src/components/Thumbnail.tsx (NEW — Claude's discretion: thin wrapper)
// Owns lazy-load, skeleton fallback, C2PA shield overlay logic in one place.

import { useEffect, useState } from 'preact/hooks';
import { SkeletonThumbnail } from './SkeletonThumbnail.js';
import { C2paShield } from './C2paShield.js';
import { getThumbnailUrl, getC2paStatus } from '../lib/api.js';

export interface ThumbnailProps {
  versionId: string;
  alt: string;
  width?: number;
  height?: number;
  /** Hide the shield overlay (e.g., in TreeSidebar where space is tight). Default: false. */
  hideShield?: boolean;
}

export function Thumbnail({ versionId, alt, width = 640, height = 360, hideShield = false }: ThumbnailProps) {
  const [c2paSigned, setC2paSigned] = useState<boolean>(false);
  const [imgState, setImgState] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    if (hideShield) return;
    let alive = true;
    getC2paStatus(versionId).then(s => { if (alive) setC2paSigned(s.status === 'signed'); });
    return () => { alive = false; };
  }, [versionId, hideShield]);

  return (
    <div class="relative inline-block aspect-video w-full" style={{ maxWidth: `${width}px` }}>
      {imgState !== 'loaded' && (
        <div class="absolute inset-0">
          <SkeletonThumbnail width={width} height={height} />
        </div>
      )}
      <img
        src={getThumbnailUrl(versionId)}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        class="block aspect-video w-full object-contain"  /* D-17 */
        onLoad={() => setImgState('loaded')}
        onError={() => setImgState('error')}                /* error → skeleton remains (D-07 unified) */
      />
      {c2paSigned && imgState === 'loaded' && !hideShield && (
        <span
          class="pointer-events-none absolute bottom-1 right-1"  /* D-09 + D-11 (no nested click) */
          aria-label="Signed · Verified provenance"             /* D-11 */
          title="Signed · Verified provenance"
        >
          <C2paShield />
        </span>
      )}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full-size `<img>` for every card | Lazy-loaded thumbnails with explicit dimensions (CLS=0) | Phase 17 (this) | Bandwidth ↓ ~30×; first paint stable; mobile usability ↑ |
| `ffmpeg-static@5.x` (GPL-3) | `@ffmpeg-installer/ffmpeg@1.1.0` (LGPL-2.1, separate-process) | v1.2 STACK pin | License-clean for MIT redistribution |
| Skeleton spinner per state (loading / error / pending) | Unified shimmer skeleton across all non-loaded states (D-07) | Phase 17 (this) | Less visual noise; fewer states to test |
| Custom IntersectionObserver wrapper for lazy-load | Native `<img loading="lazy">` (97% browser coverage in 2026) | Browser standard since Chrome 76 (2019) / Safari 15.4 (2022) | Zero JS bundle cost |
| `object-cover` on non-16:9 (crops content) | `object-contain` (letterbox) (D-17) | Phase 17 (this) | Faithful preview for VFX artists; never chops dragon's eye |

**Deprecated/outdated:**
- **`ffmpeg-static@5.x`** — license-viral GPL-3; never use in MIT projects. **Use `@ffmpeg-installer/ffmpeg` instead.**
- **Pure-JS image processing (`jimp`)** — 30× slower than sharp; no AVIF; no WebP-animation. Acceptable only for scripts where native bindings can't run.
- **Sharp `cache(true)` for one-shot resize workloads** — wastes 50 MB RAM per process. Disable with `sharp.cache(false)` for thumbnail pipelines (PITFALL F).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Adobe Content Credentials "CR" icon is freely usable in third-party MIT-licensed repos with no attribution requirement (basis: c2pa.org press materials say "open source so it can be easily adopted") | D-08, Pitfall E | LOW — fallback to lucide-preact ShieldCheck + visible "C2PA" text label is legally clean; planner adds "verify license" task. `[ASSUMED]` |
| A2 | `-vf thumbnail` filter in ffmpeg 4.1.5 (the bundled version per `@ffmpeg-installer/darwin-arm64@4.1.5`) preserves the documented `n=100` default and per-batch representative-frame scoring | Pattern 6 | LOW — well-documented FFmpeg filter, stable since FFmpeg 2.6 (2015). `[CITED: ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Video/thumbnail.html]` |
| A3 | Sharp 0.34.5 `webp({ quality: 80 })` produces ~25–40 KB output for 640×360 source (per CONTEXT.md D-02 estimate) | D-02 | LOW — empirically validated in plan execution; if real cache footprint diverges by >2×, planner notes the metric in PR description. `[ASSUMED]` |
| A4 | Phase 16 redact path (`redactManifestForVersion`) currently has no thumbnail-aware code — adding the invalidation hook is purely additive | D-05, Pattern 7 | NONE — verified via grep `redactManifestForVersion` and read of `src/engine/c2pa/redaction.ts:556-810`. `[VERIFIED: project source]` |
| A5 | Preact 10 passes `loading="lazy"` through JSX → DOM unchanged | Pitfall H | NONE — verified via existing `VersionCard.tsx:57` which already uses the attribute successfully. `[VERIFIED: project source]` |

**Items to confirm before merge:** A1 (planner adds icon-license verification task to plan).

## Open Questions

1. **Adobe Content Credentials "CR" icon — exact license text and source URL.**
   - What we know: the icon is "open source so it can be easily adopted" per c2pa.org/contentcredentials.org press materials. The c2pa-rs Rust SDK is dual-licensed MIT/Apache-2.0. The contentauth GitHub org has 10+ public repos but **none are dedicated to icon/brand assets**.
   - What's unclear: the actual SVG file location, the formal license header, attribution requirements, "implies endorsement" prohibitions.
   - Recommendation: Plan task: (a) try `https://c2pa.org` press kit page; (b) open a GitHub issue at `contentauth/c2pa-rs` asking for the icon SVG + license; (c) fallback to lucide-preact `ShieldCheck` + text label "C2PA" if (a) and (b) don't yield a clean license in <2 hours of research.

2. **Cache-Control max-age value: `31536000` (1 year, immutable) vs. `3600` (existing `/output` precedent).**
   - What we know: Strong ETag + 304 makes either choice safe. Browser will conditional-GET on every render with `max-age=3600`; `immutable` skips the round-trip when fresh.
   - What's unclear: Telemetry data on dashboard refresh patterns — is the round-trip cost noticeable?
   - Recommendation: Use `max-age=31536000, immutable` (Pattern 5) — strong ETag invalidates correctly; consistency with existing `/output` is less important than perf-correctness on a thumbnail-heavy view. Planner can override if reviewer prefers consistency.

3. **TreeSidebar thumbnail dimensions: 64×36 (Claude's discretion candidate) vs. SkeletonThumbnail default 160×90.**
   - What we know: TreeRow at depth 3 has 44 px left-padding inside a `--sidebar-width` container; 64×36 reads cleanly at retina.
   - What's unclear: User's preference if 64×36 feels "too tiny."
   - Recommendation: Ship 64×36; capture a screenshot in PR description for spot-check.

4. **`outputs_json[0].sha256` field availability (for ETag strong validator).**
   - What we know: STACK research mentions `sha256` field as available but didn't pin which Phase introduced it.
   - What's unclear: Whether every completed version has this field today, or only Phase-13+ ones.
   - Recommendation: Plan reads the actual `outputs_json` shape via grep over `src/types/`; use `outputs_json[0].sha256` if present, else fall back to `sha256:<source_mtime>` (Pattern 4). Already documented as a both-paths design.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 20 | Project (engines pin) | ✓ | v25 (per global CLAUDE.md) | — |
| npm | Package install | ✓ | bundled with Node | — |
| sharp + libvips | Image thumbnail derivation | ✓ via npm install | 0.34.5 (prebuilt @img/sharp-darwin-arm64) | wasm fallback via `@img/sharp-wasm32` (10× slower; very rare to need) |
| @ffmpeg-installer/ffmpeg | MP4 first-frame extraction | ✓ via npm install | 1.1.0 (4.1.5 binary on darwin-arm64) | (a) `process.env.VFX_FAMILIAR_FFMPEG_PATH`, (b) system `ffmpeg` on PATH, (c) skip MP4 thumbs → `.thumb.failed` sentinel + UI skeleton |
| Disk space ~80 MB | npm install (sharp + ffmpeg binaries) | ✓ | — | — |
| C2PA "CR" icon SVG | Dashboard shield overlay | ✗ | Source/license uncertain (Pitfall E, Open Question 1) | lucide-preact `ShieldCheck` + visible "C2PA" text label |

**Missing dependencies with no fallback:** None. Every dependency has a documented fallback path.

**Missing dependencies with fallback:** C2PA icon — fallback is a lucide-preact icon already in deps.

## Validation Architecture

> Required by `workflow.nyquist_validation: true` in `.planning/config.json`. The orchestrator materializes VALIDATION.md from this section.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 (runner) + Preact dashboard test workspace |
| Config file | `vitest.config.ts` (project root); `packages/dashboard/vitest.config.ts` for component tests |
| Quick run command | `npx vitest run --reporter=basic --no-coverage src/__tests__/architecture-purity.test.ts src/__tests__/thumbnails-*.test.ts` (sub-30s on M1) |
| Full suite command | `npm test` (server + dashboard, ~2 min on M1) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIS-01 | sharp resizes to 640×360 WebP at q=80; output is at SOURCE aspect; cache file is at `<outputsDir>/<vid>/<file>.thumb.webp`; CLS=0 (img has explicit width/height) | unit + e2e | `npx vitest run src/__tests__/thumbnails-image.test.ts -x` | ❌ Wave 0 |
| VIS-01 | Dashboard `<Thumbnail/>` renders `<img loading="lazy" width=W height=H>` and never sees a render without dimensions | component | `cd packages/dashboard && npx vitest run src/__tests__/Thumbnail.test.tsx -x` | ❌ Wave 0 |
| VIS-02 | `<SkeletonThumbnail/>` renders for `imgState !== 'loaded'`; same skeleton for in-progress / loading / error states (D-07 unified) | component | `cd packages/dashboard && npx vitest run src/__tests__/Thumbnail-states.test.tsx -x` | ❌ Wave 0 |
| VIS-02 | `.thumb.failed` sentinel suppresses retries until source mtime advances | unit | `npx vitest run src/__tests__/thumbnails-failure-sentinel.test.ts -x` | ❌ Wave 0 |
| VIS-03 | Click `<Thumbnail/>` bubbles up to parent VersionCard's onClick (no nested click target) | component | `cd packages/dashboard && npx vitest run src/__tests__/Thumbnail-click.test.tsx -x` | ❌ Wave 0 |
| VIS-04 | ffmpeg `-vf thumbnail` extracts representative frame; brightness < 16 falls back to `-ss 1.0`; output is WebP via sharp | integration | `npx vitest run src/__tests__/thumbnails-video.test.ts -x` | ❌ Wave 0 |
| VIS-04 | 100 MB source → `THUMBNAIL_FAILED:source_too_large` + sentinel; ffmpeg > 10s → `THUMBNAIL_FAILED:ffmpeg_timeout` + sentinel | integration | `npx vitest run src/__tests__/thumbnails-video-guards.test.ts -x` | ❌ Wave 0 |
| VIS-05 | TreeSidebar shot row uses latest-completed version's thumb; falls back to next completed when latest is in-progress; renders `<SkeletonThumbnail/>` when no completed exists | component + repo | `npx vitest run src/__tests__/version-repo-latest-completed.test.ts && cd packages/dashboard && npx vitest run src/__tests__/TreeSidebar-thumb.test.tsx -x` | ❌ Wave 0 |
| VIS-06 | C2PA shield renders ONLY for `c2paStatus === 'signed'`; placement bottom-right; `pointer-events-none` (no nested click); aria-label/title set | component | `cd packages/dashboard && npx vitest run src/__tests__/C2paShield.test.tsx -x` | ❌ Wave 0 |
| VIS-06 | Phase 16 `redactManifestForVersion` calls `engine.invalidateThumbnail` AFTER atomic rename; both `.thumb.webp` and `.thumb.failed` are unlinked | integration (e2e redact) | `npx vitest run src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts -x` | ❌ Wave 0 |

### Architecture / Cross-Cutting Tests
| Test | Type | Command | File Exists? |
|------|------|---------|-------------|
| `sharp` imports allowed-set (only `src/engine/thumbnails/image-thumbnail.ts`) | architecture-purity | `npx vitest run src/__tests__/architecture-purity.test.ts -t sharp` | ✓ existing test file (extend with new `it` block per D-25) |
| `@ffmpeg-installer/ffmpeg` imports allowed-set (only `src/engine/thumbnails/video-thumbnail.ts`) | architecture-purity | `npx vitest run src/__tests__/architecture-purity.test.ts -t ffmpeg-installer` | ✓ existing test file (extend) |
| `src/engine/thumbnails/` zero MCP / SQLite / Drizzle / Hono imports | architecture-purity | `npx vitest run src/__tests__/architecture-purity.test.ts -t thumbnails` | ✓ existing test file (extend) |
| Lazy import resilience — server boots when `sharp` is missing (mock failed import) | integration | `npx vitest run src/__tests__/thumbnails-lazy-resilience.test.ts -x` | ❌ Wave 0 |
| Lazy import resilience — server boots when `@ffmpeg-installer/ffmpeg` is missing | integration | same file | ❌ Wave 0 |
| Coalescing mutex — 50 concurrent requests for same key → 1 sharp invocation | integration | `npx vitest run src/__tests__/thumbnails-mutex.test.ts -x` | ❌ Wave 0 |
| Coalescing mutex — 50 concurrent requests for distinct keys → all parallel, p99 < 5s | integration | same file | ❌ Wave 0 |
| Atomic write — half-written WebP cannot be served (kill mid-rename, assert no truncated read) | integration | `npx vitest run src/__tests__/thumbnails-atomic.test.ts -x` | ❌ Wave 0 |
| ETag + 304 conditional GET | integration | `npx vitest run src/__tests__/thumbnails-http-etag.test.ts -x` | ❌ Wave 0 |
| Multi-encoding leak scan (UTF-8 + UTF-16LE + UTF-16BE + base64) over `.thumb.webp` and `.thumb.failed` after redact | integration (e2e) | `npx vitest run src/__tests__/thumbnails-redact-leak-scan.test.ts -x` | ❌ Wave 0 |
| Sharp `concurrency(2)` global cap is set on first load | unit | `npx vitest run src/__tests__/thumbnails-image.test.ts -t concurrency` | ❌ Wave 0 |
| Dashboard fetch queue cap (≤6 in-flight) | component | `cd packages/dashboard && npx vitest run src/__tests__/Thumbnail-queue.test.tsx -x` | ❌ Wave 0 |
| TypedError surface — every failure mode emits a `THUMBNAIL_FAILED` with one of the locked reasons | unit | `npx vitest run src/__tests__/thumbnails-typed-errors.test.ts -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=basic src/__tests__/thumbnails-*.test.ts src/__tests__/architecture-purity.test.ts` (sub-30s)
- **Per wave merge:** `npm test` (full server + dashboard suite — currently 1365 tests, will grow ~30 with this phase)
- **Phase gate:** Full suite green + adversarial smoke test of redact-then-thumb (manual UAT step in PR description)

### Wave 0 Gaps
- [ ] `src/__tests__/thumbnails-image.test.ts` — VIS-01 + sharp tuning (concurrency, cache disabled)
- [ ] `src/__tests__/thumbnails-video.test.ts` — VIS-04 representative-frame + brightness fallback
- [ ] `src/__tests__/thumbnails-video-guards.test.ts` — VIS-04 100MB skip + 10s timeout (PITFALL A)
- [ ] `src/__tests__/thumbnails-failure-sentinel.test.ts` — `.thumb.failed` retry suppression (D-07)
- [ ] `src/__tests__/thumbnails-mutex.test.ts` — coalescing per-key + parallel cross-key (PITFALL B)
- [ ] `src/__tests__/thumbnails-atomic.test.ts` — half-written WebP invariant (D-22)
- [ ] `src/__tests__/thumbnails-http-etag.test.ts` — ETag + 304 conditional GET (D-06)
- [ ] `src/__tests__/thumbnails-typed-errors.test.ts` — every reason in the THUMBNAIL_FAILED enum
- [ ] `src/__tests__/thumbnails-lazy-resilience.test.ts` — server boots without native bindings (D-26)
- [ ] `src/__tests__/thumbnails-redact-leak-scan.test.ts` — multi-encoding scan over thumb cache + sentinel after redact (PITFALL G)
- [ ] `src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts` — invalidation fires AFTER atomic rename (D-05)
- [ ] `src/__tests__/version-repo-latest-completed.test.ts` — `ORDER BY completed_at DESC LIMIT 1 WHERE status='complete'` (D-14)
- [ ] `packages/dashboard/src/__tests__/Thumbnail.test.tsx` — basic render + lazy + dimensions
- [ ] `packages/dashboard/src/__tests__/Thumbnail-states.test.tsx` — loading / error / signed-overlay states
- [ ] `packages/dashboard/src/__tests__/Thumbnail-click.test.tsx` — click bubbles to parent (D-11)
- [ ] `packages/dashboard/src/__tests__/Thumbnail-queue.test.tsx` — fetch queue cap of 6 (D-discretion)
- [ ] `packages/dashboard/src/__tests__/C2paShield.test.tsx` — shield renders only for signed
- [ ] `packages/dashboard/src/__tests__/TreeSidebar-thumb.test.tsx` — shot row gains leading thumb (D-13)
- [ ] **Test fixture:** `tests/fixtures/black-frames.mp4` — synthetic MP4 with first 5 frames pure black (for D-29 fallback test). Generate at test time via `ffmpeg -f lavfi -i "color=c=black:s=320x180:d=0.2" -f lavfi -i "testsrc=size=320x180:rate=30:duration=2" -filter_complex "[0:v][1:v]concat=n=2:v=1" -y black-frames.mp4`.
- [ ] **Test fixture:** `tests/fixtures/oversized.mp4` — 100+ MB MP4 (or generate at runtime via `-f lavfi -i testsrc=duration=600:size=1920x1080:rate=30 -y oversized.mp4`).
- [ ] Framework install: not needed — vitest 4.1.4 already installed.

## Sources

### Primary (HIGH confidence)
- **Context7 `/lovell/sharp`** — verified `webp({quality: 80})`, `resize(W, H, {fit: 'inside', withoutEnlargement: true})`, `.stats()` with per-channel `mean`, `sharp.concurrency(N)` global, `sharp.cache(false)`, `.timeout({seconds})`. Multiple snippets, official docs source. `[VERIFIED]`
- **npm registry** — `sharp@0.34.5` (latest stable, published 2025-11-06); engines `^18.17.0 || ^20.3.0 || >=21.0.0`; `@ffmpeg-installer/ffmpeg@1.1.0` license `LGPL-2.1`; `@ffmpeg-installer/darwin-arm64@4.1.5`. Run command outputs at 2026-04-30. `[VERIFIED]`
- **FFmpeg thumbnail filter docs** — `https://ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Video/thumbnail.html` — `n=100` default, batch-based representative-frame selection. `[CITED]`
- **Project source** — `src/engine/c2pa/index.ts` (barrel shape), `src/engine/c2pa/format-router.ts` (router shape), `src/engine/c2pa/redaction.ts:556-810` (redact path + atomic rename), `src/engine/output-downloader.ts` (atomic write + EngineForC2pa Pick pattern), `src/engine/pipeline.ts:288-291` (signMutex), `src/__tests__/architecture-purity.test.ts:166-230` (allowed-set template), `src/http/dashboard-routes.ts:240-353` (HEAD pattern + X-C2PA-Signing-Status), `packages/dashboard/src/components/{SkeletonThumbnail,VersionCard,C2paBadge,TreeSidebar}.tsx`, `packages/dashboard/src/lib/api.ts` (getC2paStatus, getOutputUrl). `[VERIFIED]`
- **CLAUDE.md** (project + global) — Tool cap, append-only, SQLite WAL, dual transport, MIT license, security discipline. `[VERIFIED]`
- **caniuse WebP support** — 97%+ in 2026; Chrome 23+ / Firefox 65+ / Edge 18+ / Safari 14+. No fallback needed. `[CITED]`

### Secondary (MEDIUM confidence)
- **WebSearch:** sharp WebP options + concurrency tuning — corroborates Context7. `[VERIFIED via cross-source]`
- **WebSearch:** ffmpeg thumbnail filter behaviour (Mux article + OTTVerse + bogotobogo) — multiple sources agree on `n=100` default. `[VERIFIED via cross-source]`
- **WebSearch:** Preact `loading="lazy"` pass-through — corroborated by existing project usage. `[VERIFIED via project precedent]`

### Tertiary (LOW confidence — flagged for plan-time validation)
- **Adobe Content Credentials icon license** — c2pa.org press materials say "open source" but no formal license file discoverable on contentauth GitHub. `[ASSUMED — see Open Question 1, Pitfall E]`
- **Sharp 0.34.5 WebP output size estimate (~25–40 KB for 640×360)** — empirical estimate; validate during plan execution. `[ASSUMED]`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version pinned via npm registry on the research date; license posture verified for both deps.
- Architecture: HIGH — every locked decision validates against codebase ground truth (signMutex, atomic write, redact path, format-router shape, allowed-set template).
- Pitfalls: HIGH — 4 inherited from `.planning/research/PITFALLS.md` with locked mitigations; 5 new pitfalls (E-I) surfaced by Phase-17-specific deep dive, all with concrete mitigation strategies.
- C2PA icon licensing: MEDIUM — assertion is "open source" per press materials, no formal license discovered. Plan must verify or fall back.

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (30 days — `sharp` and `@ffmpeg-installer/ffmpeg` are stable; refresh if a major sharp release lands)

## RESEARCH COMPLETE

**Phase:** 17 — Visual Thumbnails
**Confidence:** HIGH (one MEDIUM-confidence item: C2PA icon license)

### Key Findings
- All 30 locked decisions in CONTEXT.md (D-01..D-30) validate cleanly against authoritative sources. Planner can proceed without re-deciding.
- Stack confirmed at exact versions: `sharp@0.34.5` (latest, Nov 2025) + `@ffmpeg-installer/ffmpeg@1.1.0` (LGPL-2.1, with `darwin-arm64@4.1.5` binary on host).
- Five new files in `src/engine/thumbnails/` mirror the proven `src/engine/c2pa/` shape; allowed-set assertions extend the existing pattern at `architecture-purity.test.ts:190-230` with sorted-array deepEqual.
- Brightness-threshold fallback (D-29) implemented via `sharp.stats()` channel `mean` + BT.601 luma; threshold 16/255 captures fade-in/black-slate cases.
- Phase 16 redact invalidation lands as a single `engine.invalidateThumbnail()` call after the atomic rename at `redaction.ts:749`.
- Five new pitfalls (E-I) surfaced beyond inherited PITFALLS.md set: (E) C2PA icon license uncertainty; (F) sharp libvips operation cache memory waste; (G) multi-encoding leak scan extension to thumb cache + sentinel; (H) Preact `loading="lazy"` pass-through (non-issue — project precedent confirms); (I) TreeSidebar density mismatch with default 160×90 skeleton.

### File Created
`/Users/macapple/comfyui-vfx-mcp/.planning/phases/17-visual-thumbnails/17-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | npm registry verification 2026-04-30; both packages pinned with verified license posture |
| Architecture | HIGH | Codebase ground-truth read for every Pattern; signMutex / atomic-write / redact-path verified line-by-line |
| Pitfalls | HIGH | 4 inherited from existing PITFALLS.md + 5 new surfaced with concrete mitigations |
| Validation Architecture | HIGH | 11 requirement-mapped tests + 13 architecture/cross-cutting tests; all commands runnable; 18 file gaps explicitly listed |
| C2PA icon licensing | MEDIUM | "Open source" claimed but no formal license discoverable; lucide-preact fallback documented |

### Open Questions (from §Open Questions)
1. **C2PA "CR" icon license** — plan task: verify before merging icon SVG; fallback to lucide-preact ShieldCheck + "C2PA" text label.
2. **Cache-Control: `max-age=31536000, immutable` (recommended) vs. `max-age=3600` (existing /output precedent)** — both safe with strong ETag; recommend the longer immutable.
3. **TreeSidebar thumb dimensions: 64×36** — Claude's discretion; capture screenshot at PR time.
4. **`outputs_json[0].sha256` field availability** — plan greps `src/types/` to confirm; falls back to `sha256:<source_mtime>`.

### Ready for Planning
Research complete. The planner can produce PLAN-N files mapping each VIS-01..VIS-06 requirement to specific tasks, with all 30 locked decisions and 5 Claude's-discretion items already documented and unambiguous. Recommended task breakdown (planner refines):
1. **Plan 17-01** — Engine module: `src/engine/thumbnails/{format-router,image-thumbnail,video-thumbnail,cache,index}.ts` + architecture-purity allowed-set extension + Engine facade methods (`generateThumbnail`, `invalidateThumbnail`) + TypedError code addition.
2. **Plan 17-02** — HTTP route: `GET/HEAD /api/versions/:id/thumbnail` + ETag/304 + tests.
3. **Plan 17-03** — Phase 16 redact invalidation hook + multi-encoding leak scan extension.
4. **Plan 17-04** — Dashboard `<Thumbnail/>` + `<C2paShield/>` components + VersionCard regression + TreeSidebar shot-row leading thumb + tests.
5. **Plan 17-05** — License-verification + UAT (manual click-through; redact-then-view; PITFALL B/F load test).
