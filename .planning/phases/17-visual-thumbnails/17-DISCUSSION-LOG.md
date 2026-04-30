# Phase 17: Visual Thumbnails - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 17-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-30
**Phase:** 17-visual-thumbnails
**Areas discussed:** Cache size strategy, C2PA shield overlay treatment, Shot card stack convention, Aspect handling for non-16:9 source

---

## Cache size strategy

### Q1: How many thumbnail sizes should we cache and serve?

| Option | Description | Selected |
|--------|-------------|----------|
| Single fixed size | One thumb per output. Path matches REQUIREMENTS.md. Simpler cache, route, dashboard. | ✓ |
| Responsive multi-size with `?w=` | 4 widths (80/160/320/640). Bandwidth-optimal, srcset-ready. 4× cache footprint, deviates from REQUIREMENTS.md. | |
| Two sizes (1× + 2×) | 320 + 640 retina compromise. Adds responsive logic for half the gain. | |

**User's choice:** Single fixed size (Recommended)
**Notes:** Path locked at `<outputsDir>/<versionId>/<filename>.thumb.webp` per REQUIREMENTS.md. Multi-size deferred to v1.3 when telemetry justifies.

### Q2: What physical dimensions for that single thumbnail?

| Option | Description | Selected |
|--------|-------------|----------|
| 640×360 | Retina-ready for 4K monitors. WebP ~25–40 KB. Frame.io / Vimeo / NLE detail-panel convention. | ✓ |
| 320×180 | Matches existing 160×90 SkeletonThumbnail × 2×. Smaller (~10–18 KB). Soft on 4K when scaled. | |
| 480×270 | Middle ground. ~16–25 KB. | |

**User's choice:** "Whatever the industry standard is, what professionals would expect to see" → resolved as 640×360
**Notes:** User provided free-text rationale; researched industry convention (Frame.io / Vimeo grid / NLE detail panels) which clusters at 640×360 retina-ready. Locked.

### Q3: How should the thumbnail cache invalidate when Phase 16 redact rewrites the source bytes?

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit hook in redact | redactManifestForVersion calls invalidateThumbnail after atomic rename. Symmetric to Phase 16 pattern. | ✓ |
| Lazy mtime check on every request | HTTP route stats source mtime, regenerates if stale. Simpler engine code, stat() cost on every GET. | |
| You decide | Claude picks during planning. | |

**User's choice:** Explicit hook in redact (Recommended)
**Notes:** Mirrors v1.1 pattern. Explicit > lazy for clarity at the redact boundary.

### Q4: If thumbnail generation fails, what's the user-visible behavior?

| Option | Description | Selected |
|--------|-------------|----------|
| SkeletonThumbnail forever + log | Same shimmer as in-progress / loading. Cached failure via `.thumb.failed` sentinel. | ✓ |
| Retry on every request | No failure cache. Simpler. CPU/disk waste on broken sources. | |
| Distinct error skeleton | "Thumb-unavailable" icon distinguishes failed vs in-progress. Extra component cost. | |

**User's choice:** SkeletonThumbnail forever + log (Recommended)
**Notes:** Sentinel `.thumb.failed` marker prevents retry storms on broken sources. UI is unified (skeleton for all 3 states).

---

## C2PA shield overlay treatment

### Q1: Where on the thumbnail should the C2PA shield icon sit?

| Option | Description | Selected |
|--------|-------------|----------|
| Bottom-right corner | Industry convention (X verified, YouTube, Adobe Firefly). Survives object-cover crops. | ✓ |
| Top-right corner | Standard for status badges. May wash out on bright sky pixels. | |
| Top-left corner | Adobe default. Overlaps version label which lives top-left in shot-card layouts. | |

**User's choice:** Bottom-right corner (Recommended)

### Q2: Which signing states should display the shield icon?

| Option | Description | Selected |
|--------|-------------|----------|
| Signed only | Shield = positive signal. Absence = unsigned/unknown. Quiet, focal-point-respecting. | ✓ |
| Signed + Unsigned | 2 shield variants. Visual noise on every thumb. | |
| All three states | Maximum information. Thumbnails become busy. | |

**User's choice:** Signed only (Recommended)
**Notes:** Existing C2paBadge text pill in VersionDrawer continues to surface all 3 states with full detail. Thumbnail shield is a quiet positive-signal layer.

### Q3: How should hover/click interaction work on the shield?

| Option | Description | Selected |
|--------|-------------|----------|
| Tooltip on hover, opens VersionDrawer on click | title/aria-label tooltip; click bubbles to parent VersionCard. | ✓ |
| Tooltip only (no click handler on shield) | Shield is decorative; entire card click opens drawer. Simpler, miss affordance. | |
| Click opens manifest viewer modal directly | Bypasses VersionDrawer. New surface. v1.3 territory. | |

**User's choice:** Tooltip on hover, opens VersionDrawer on click (Recommended)
**Notes:** No nested click target on shield itself.

### Q4: Icon style — which mark do VFX artists / regulators most recognize?

| Option | Description | Selected |
|--------|-------------|----------|
| Adobe Content Credentials "CR" mark | Official C2PA-aligned mark. Adopted by Adobe Firefly / OpenAI / Microsoft / BBC. | ✓ |
| Lucide shield-check icon | Generic shield with checkmark. Reads as "verified" generally, less specific to C2PA. | |
| Custom inline SVG | Custom mark, no icon-lib dep. Less standard recognition. | |

**User's choice:** Adobe Content Credentials "CR" mark (Recommended)
**Notes:** Source: https://contentcredentials.org/icon. Planner verifies license terms before adding to repo.

---

## Shot card stack convention

### Q1: Where does the "shot card" live, and what should the Frame.io stack treatment look like?

| Option | Description | Selected |
|--------|-------------|----------|
| TreeSidebar entry: single thumb of latest-completed | Tight vertical space. Skeleton when no completed version. | ✓ |
| TreeSidebar: thumb + version-count badge | Same + small ·N chip. Communicates version count at a glance. | |
| TreeSidebar: layered-stack visual (Frame.io-style) | Up to 3 layered thumbs. Eats ~40 px vertical, breaks tree density. | |
| Defer shot-card stack to v1.3 | Only single-thumb in v1.2; layered visual for future shot-grid view. | |

**User's choice:** TreeSidebar entry: single thumb of latest-completed (Recommended)
**Notes:** Layered-stack acknowledged as longer-term aspiration for a future shot-grid view in v1.3.

### Q2: VIS-05 says "falls back gracefully when latest is in-progress". Which version's thumb in that case?

| Option | Description | Selected |
|--------|-------------|----------|
| Most-recent COMPLETED version | Skip in-progress. Always shows latest *finished* render. Frame.io behavior. | ✓ |
| SkeletonThumbnail when latest is in-progress | Same skeleton regardless. Shot row "goes blank" mid-render. | |
| Latest in-progress placeholder (custom) | "Rendering..." treatment with version label overlay. More UI surface. | |

**User's choice:** Most-recent COMPLETED version (skip in-progress) (Recommended)
**Notes:** Selection: `ORDER BY completed_at DESC LIMIT 1, status='complete'`.

### Q3: Sequence and Project rows in TreeSidebar — also get thumbnails?

| Option | Description | Selected |
|--------|-------------|----------|
| Text-only for Sequence/Project | Aggregating "hero version" is ambiguous. Out of scope. | ✓ |
| Sequence + Project: thumb of latest-completed-anywhere-under-them | Recursive. Visually richer. Surfacing logic ambiguous. | |
| Sequence yes, Project no | Middle ground. | |

**User's choice:** Text-only for Sequence/Project (Recommended)
**Notes:** Defer to v1.3 if user-demand surfaces.

---

## Aspect handling for non-16:9 source

### Q1: How should non-conforming source render (square, vertical, ultrawide)?

| Option | Description | Selected |
|--------|-------------|----------|
| Letterbox: contain in 16:9 with subtle bg | object-contain. Full source visible. Frame.io default. | ✓ |
| Crop: cover (current VersionCard behavior) | object-cover. Bolder, no bars. May chop content from edges. | |
| Hybrid: blurred-bg + contained source | Sharp foreground + blurred upscaled bg. Premium (Vimeo / IG). 2 sharp ops. | |

**User's choice:** Letterbox: contain in 16:9 with subtle bg (Recommended)
**Notes:** Faithful to actual render. VFX artists may have framed critical content at edges of square / vertical / ultrawide sources — never crop.

### Q2: Letterbox bars — transparent, black, or surface color?

| Option | Description | Selected |
|--------|-------------|----------|
| Transparent | WebP encoded at source aspect; CSS frames in 16:9 wrapper. Theme-flexible. | ✓ |
| Pure black | Padded WebP with #000 bars. Cinema-standard. Theme-independent. | |
| Match dashboard surface color | Padded with --color-surface bg. Theme-mismatch on light/dark switch. | |

**User's choice:** Transparent (Recommended)
**Notes:** Adapts to light/dark theme without re-encoding cached WebP. Dashboard surface bg shows through dead space. Smaller WebP (no padded pixels).

### Q3: Sharp encoder settings — quality vs file size?

| Option | Description | Selected |
|--------|-------------|----------|
| Quality 80, lossy | Sharp default. ~25–40 KB per 640×360 thumb. Industry standard. | ✓ |
| Quality 90, lossy | Higher fidelity, ~50–70 KB. Marginal at thumbnail size. ~2× disk. | |
| You decide | Claude picks during planning. | |

**User's choice:** Quality 80, lossy (Recommended)
**Notes:** Detail review happens at full-size click-through, not at thumb scale.

---

## Claude's Discretion

Items where the user explicitly deferred or where downstream agents have flexibility:

- Sharp `concurrency(2)` global cap (research PITFALLS #7)
- Dashboard fetch queue cap of 6 concurrent thumb requests (research PITFALLS #7)
- Exact brightness-threshold value for the MP4 black-frame fallback (typical: avg luminance < 16/255)
- HTTP `Cache-Control` header value (research suggests `public, max-age=31536000, immutable`; existing `/output` route uses `max-age=3600`)
- Skeleton shimmer dimensions in TreeSidebar (existing default 160×90; smaller may fit better in tree row density)
- Whether to introduce a thin `<Thumbnail />` wrapper component or inline `<img>` swap in `VersionCard` (recommendation: thin wrapper)
- Multi-encoding leak scan extension to thumbnail cache + `.thumb.failed` sentinel paths
- Exact ETag derivation: `sha256:<source_mtime>` vs `outputs_json[0].sha256` if present

---

## Deferred Ideas

Captured during discussion as out-of-scope for v1.2; surfaced for future milestone consideration:

- **Multi-size responsive thumbnails** (`?w=80|160|320|640` srcset) — v1.3 if bandwidth telemetry justifies
- **Frame.io layered-stack visual on shot cards** — v1.3 future shot-grid view
- **Sequence + Project row thumbnails** in TreeSidebar — v1.3 if user demand surfaces
- **Hybrid letterbox: blurred-bg + contained source** (Vimeo / IG style) — v1.3 candidate
- **Distinct error skeleton** (vs unified shimmer for in-progress / loading / failed) — defer; users rarely encounter
- **Hover-to-scrub video preview** — already deferred at REQUIREMENTS.md
- **AI-generated alt text on thumbnails** — already deferred at REQUIREMENTS.md (Phase 19 LLM ground-truth could supply this)
- **Auto-enhanced thumbnails** (sharpen / contrast / denoise) — already an anti-feature at REQUIREMENTS.md

---

*Discussion conducted via /gsd-discuss-phase 17 in default mode.*
*4 areas discussed × 3-4 questions each = 14 total decisions captured.*
