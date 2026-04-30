---
phase: 17
slug: visual-thumbnails
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 17-RESEARCH.md §"Validation Architecture" — 11 requirement-mapped tests + 13 architecture/cross-cutting tests.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (root + dashboard packages) |
| **Config file** | vitest.config.ts (root) + packages/dashboard/vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Architecture-purity command** | `npx vitest run src/__tests__/architecture-purity.test.ts` |
| **Dashboard suite command** | `cd packages/dashboard && npx vitest run` |
| **Estimated runtime** | ~12s root, ~6s dashboard, ~18s combined |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=dot`
- **After every plan wave:** Run `npx vitest run` (root) + `cd packages/dashboard && npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green (root + dashboard) AND `tsc --noEmit` clean
- **Max feedback latency:** ~18 seconds for full combined run

---

## Per-Task Verification Map

> Filled per-plan during planning. Plan checker verifies every task has `<automated>` verify or a Wave-0 dependency.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | VIS-01..06 | TBD | TBD | unit/integration | `npx vitest run <file>` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Validation Architecture (from RESEARCH §"Validation Architecture")

### Requirement-Mapped Tests (11)

1. **VIS-01 image thumbnail correctness** — sharp resize 640×360 max, WebP q=80, source-aspect preserved (no padding); deepEqual on `await sharp(thumb).metadata()` for `width`/`height`/`format`/`hasAlpha`.
2. **VIS-01 atomic write contract** — concurrent reader during write sees either pre-existing thumb or completed thumb, never half-written bytes (test uses `setTimeout` race + `fs.readFile` parallel).
3. **VIS-01 cache hit returns 304** — second `GET /api/versions/:id/thumbnail` with `If-None-Match: <etag>` returns 304 with empty body.
4. **VIS-02 skeleton on failed-thumb** — `<filename>.thumb.failed` sentinel triggers `<SkeletonThumbnail/>` render in `<Thumbnail/>` component (Preact testing-library).
5. **VIS-03 click-through preserved** — existing `GET /api/versions/:id/output` still serves full-size; thumb route does NOT replace it.
6. **VIS-04 MP4 first-frame extraction** — fixture H.264 MP4 with bright frame at 0.5s + black frame at 0.0s → resulting WebP luma > 16/255 (proves `-vf thumbnail` selected the bright frame OR fallback `-ss 1.0` engaged).
7. **VIS-04 ffmpeg timeout** — synthetic stalled ffmpeg process → `THUMBNAIL_FAILED:ffmpeg_timeout` typed reason; `.thumb.failed` sentinel written.
8. **VIS-04 100MB pre-flight skip** — 101MB MP4 source → `THUMBNAIL_FAILED:source_too_large` BEFORE ffmpeg invocation (no spawn).
9. **VIS-05 shot-card thumb selection** — TreeSidebar shot row renders the latest `status='complete'` version's thumb; in-progress versions skipped (uses `ORDER BY completed_at DESC LIMIT 1` filtered).
10. **VIS-06 C2PA shield render predicate** — `<Thumbnail/>` shows shield ONLY when `getC2paStatus()` returns `'signed'`; `unsigned` and `unknown` show no overlay.
11. **VIS-06 redact invalidation** — `redactManifestForVersion()` deletes `<filename>.thumb.webp`; next read regenerates fresh bytes.

### Architecture / Cross-Cutting Tests (13)

12. **Architecture-purity: sharp allowed-set** — `architecture-purity.test.ts` asserts sorted-array deepEqual on importers of `sharp` (single entry: `src/engine/thumbnails/image-thumbnail.ts`).
13. **Architecture-purity: ffmpeg allowed-set** — same shape for `@ffmpeg-installer/ffmpeg` (single entry: `src/engine/thumbnails/video-thumbnail.ts`).
14. **Architecture-purity: zero MCP/SQLite/ORM in thumbnails/** — file-level grep gates on `src/engine/thumbnails/*.ts`.
15. **Lazy import resilience** — `await import('sharp')` failure path produces `THUMBNAIL_FAILED:native_binding_unavailable` typed reason; server boot succeeds.
16. **Lazy import resilience** — `await import('@ffmpeg-installer/ffmpeg')` failure path mirror.
17. **Coalescing mutex (signMutex shape)** — concurrent same-key generate calls share a single Promise; different-key calls run in parallel (test asserts spy-call count = 1 for same-key).
18. **Atomic write via temp+rename** — temp file uses `nanoid(8)` partial; final rename is single syscall (test inspects `<outputsDir>/<versionId>/` mid-write).
19. **ETag freshness** — source mtime change → ETag changes → browser re-fetches.
20. **Cache-Control header** — `public, max-age=31536000, immutable` on thumb route (planner reconciles with existing `/output` `max-age=3600` via Claude's discretion).
21. **C2PA shield no nested click target** — keyboard navigation on `<Thumbnail/>` → click bubbles to parent VersionCard (no nested button/anchor).
22. **Multi-encoding leak scan** — extends to `<filename>.thumb.webp` cache + `.thumb.failed` sentinel paths (UTF-8 + UTF-16LE + UTF-16BE + base64).
23. **TypedError surface** — every failure path returns `TypedError('THUMBNAIL_FAILED', reason, recovery)` with one of: `unsupported_format`, `sharp_failed`, `ffmpeg_failed`, `ffmpeg_timeout`, `source_too_large`, `source_unreadable`, `native_binding_unavailable`.
24. **Sharp concurrency cap** — `sharp.concurrency(2)` set at module load; libvips operation cache disabled via `sharp.cache(false)` (PITFALL #7 mitigation).

---

## Wave 0 Requirements

- [ ] `src/engine/thumbnails/__tests__/image-thumbnail.test.ts` — stubs for VIS-01 image path
- [ ] `src/engine/thumbnails/__tests__/video-thumbnail.test.ts` — stubs for VIS-04 MP4 path
- [ ] `src/engine/thumbnails/__tests__/cache.test.ts` — atomic-write + invalidation stubs
- [ ] `src/engine/thumbnails/__tests__/format-router.test.ts` — pure router stubs
- [ ] `src/http/__tests__/thumbnail-routes.test.ts` — HTTP route stubs (GET + HEAD + 304 + ETag)
- [ ] `packages/dashboard/src/components/__tests__/Thumbnail.test.tsx` — wrapper component stubs (skeleton fallback + C2PA shield render predicate)
- [ ] `packages/dashboard/src/components/__tests__/TreeSidebar.test.tsx` — extend existing tests for D-13 shot-row thumb
- [ ] Test fixtures: small PNG, JPEG, WebP, MP4 (H.264 with bright + black frames), oversize MP4 (>100MB stub via sparse file)

*Existing infrastructure (vitest, Preact testing-library, fs/temp dir helpers from Phase 14/16) covers framework needs — no installs required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity of thumbnails on real renders | VIS-01 | Subjective — "are these the right size, are they sharp on a 4K display, do they letterbox correctly" | Open dashboard, scroll Project view with 20+ completed versions, screenshot grid at 1× and 2× DPR |
| C2PA shield placement on cropped renders | VIS-06 | Cross-aspect verification (square 1024×1024, vertical 1080×1920, ultrawide 2.39:1) | Sign a square + vertical render via Phase 14, verify shield doesn't overlap focal point or version label |
| TreeSidebar shot-row density | VIS-05 + D-13 | Layout-shift inspection at narrow viewport widths | DevTools → resize sidebar to min-width, verify thumb fits without truncation |
| Redact-invalidation visual cycle | VIS-06 + D-05 | End-to-end UX: sign → render thumb → redact → see thumb regenerate | Phase 16 redact_manifest action then refresh dashboard; thumb should regenerate within ~200ms |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
