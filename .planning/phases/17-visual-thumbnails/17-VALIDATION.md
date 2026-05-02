---
phase: 17
slug: visual-thumbnails
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-30
last_reviewed: 2026-05-01
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

> Every task in Phase 17 has an `<automated>` verify command (Nyquist-compliant). Wave 0 stubs are created INSIDE the plan-owning tasks, not as a separate pre-wave (acceptable per the GSD Wave 0 rule: "stubs may be co-located with the task that uses them so long as the test file lands BEFORE the implementation in the task ordering").

| Plan | Task | Wave | Test/Verify Command | Notes |
|------|------|------|---------------------|-------|
| 17-01 | T1 | 1 | `npx vitest run --reporter=basic --no-coverage src/engine/thumbnails/__tests__/format-router.test.ts src/engine/thumbnails/__tests__/cache.test.ts && npx tsc --noEmit` | Creates W0 stubs: format-router.test.ts + cache.test.ts |
| 17-01 | T2 | 1 | `npx vitest run --reporter=basic --no-coverage src/engine/thumbnails/__tests__/image-thumbnail.test.ts && npx tsc --noEmit` | TDD task; creates W0 stub: image-thumbnail.test.ts (RED first) |
| 17-01 | T3 | 1 | `npx vitest run --reporter=basic --no-coverage src/__tests__/architecture-purity.test.ts -t "sharp imports are centralized" src/__tests__/architecture-purity.test.ts -t "src/engine/thumbnails/" src/__tests__/c2pa-key-leak-negative.test.ts -t "Phase 17"` | Updates architecture-purity.test.ts (sharp allowed-set + 5 dir guards) + c2pa-key-leak-negative.test.ts (Phase 17 leak-scan extension) |
| 17-02 | T1 | 2 | `npx vitest run --reporter=basic --no-coverage src/engine/thumbnails/__tests__/video-thumbnail.test.ts && npx tsc --noEmit` | TDD task; creates W0 stub: video-thumbnail.test.ts (RED first); skipIf-gates on ffmpeg availability |
| 17-02 | T2 | 2 | `npx vitest run --reporter=basic --no-coverage src/__tests__/architecture-purity.test.ts -t "ffmpeg" && npx tsc --noEmit` | Updates architecture-purity.test.ts (@ffmpeg-installer allowed-set; removes Plan 01 sentinel comment) |
| 17-03 | T1 | 3 | `npx vitest run --reporter=basic --no-coverage src/__tests__/thumbnail-route.test.ts -t "Engine\|generateThumbnail\|invalidateThumbnail\|thumbnailMutex" && npx tsc --noEmit` | TDD task; creates W0 stub: thumbnail-route.test.ts (RED first) — engine-layer Tests 1-11 |
| 17-03 | T2 | 3 | `npx vitest run --reporter=basic --no-coverage src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts src/engine/c2pa/__tests__/redaction.test.ts src/__tests__/c2pa-redaction-e2e.test.ts src/__tests__/c2pa-redaction-uat-mcp-tool.test.ts && npx tsc --noEmit` | TDD task; creates W0 stub: c2pa-redaction-thumbnail-invalidation.test.ts (RED first); extends Plan 01's leak-scan to post-redact |
| 17-03 | T3 | 3 | `npx vitest run --reporter=basic --no-coverage src/__tests__/thumbnail-route.test.ts src/__tests__/c2pa-key-leak-negative.test.ts src/__tests__/c2pa-dual-transport-parity.test.ts && npx tsc --noEmit` | TDD task; appends HTTP-layer Tests 12-20 to thumbnail-route.test.ts |
| 17-04 | T1 | 4 | MISSING — checkpoint (human-verify); resume-signal token IS the verification | License verification gate; no automated verify (D-08 license decision A/B/C) |
| 17-04 | T2 | 4 | `cd packages/dashboard && npx vitest run --reporter=basic --no-coverage src/__tests__/C2paShield.test.tsx src/__tests__/api.test.ts && cd /Users/macapple/comfyui-vfx-mcp && npx tsc --noEmit` | TDD task; creates W0 stub: C2paShield.test.tsx (RED first) |
| 17-04 | T3 | 4 | `cd packages/dashboard && npx vitest run --reporter=basic --no-coverage src/__tests__/Thumbnail.test.tsx && cd /Users/macapple/comfyui-vfx-mcp && npx tsc --noEmit` | TDD task; creates W0 stub: Thumbnail.test.tsx (RED first) |
| 17-05 | T1 | 5 | `cd packages/dashboard && npx vitest run --reporter=basic --no-coverage src/__tests__/VersionCard.test.tsx && cd /Users/macapple/comfyui-vfx-mcp && npx tsc --noEmit` | TDD task; updates existing VersionCard.test.tsx (2 tests modified, 2 added) |
| 17-05 | T2 | 5 | `cd packages/dashboard && npx vitest run --reporter=basic --no-coverage src/__tests__/TreeSidebar.test.tsx src/__tests__/VersionCard.test.tsx && cd /Users/macapple/comfyui-vfx-mcp && npx tsc --noEmit` | TDD task; updates existing TreeSidebar.test.tsx (+2 new tests) |
| 17-05 | T3 | 5 | `npx vitest run --reporter=basic --no-coverage 2>&1 \| tail -20 && cd packages/dashboard && npx vitest run --reporter=basic --no-coverage 2>&1 \| tail -20 && cd /Users/macapple/comfyui-vfx-mcp && npx tsc --noEmit && npx vitest run --reporter=basic --no-coverage src/__tests__/tool-budget.test.ts src/__tests__/architecture-purity.test.ts` | Full-suite regression gate; tool count holds at 7-of-12 |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — populated during execution after each task commit.*

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

## Wave 0 Test File Inventory (paths match the actual codebase layout — verified against PATTERNS.md §"Note on packages/dashboard/src/__tests__/ location")

> Wave 0 stubs are created in the OWNING task (TDD RED step) of each plan, not as a separate pre-wave. Every path below matches what the plans actually create.

- [x] `src/engine/thumbnails/__tests__/format-router.test.ts` — pure router stubs (Plan 17-01 Task 1)
- [x] `src/engine/thumbnails/__tests__/cache.test.ts` — atomic-write + invalidation stubs (Plan 17-01 Task 1)
- [x] `src/engine/thumbnails/__tests__/image-thumbnail.test.ts` — stubs for VIS-01 image path (Plan 17-01 Task 2)
- [x] `src/engine/thumbnails/__tests__/video-thumbnail.test.ts` — stubs for VIS-04 MP4 path (Plan 17-02 Task 1)
- [x] `src/__tests__/architecture-purity.test.ts` — sharp + ffmpeg allowed-set + 5 thumbnails dir guards (Plan 17-01 Task 3 + Plan 17-02 Task 2)
- [x] `src/__tests__/c2pa-key-leak-negative.test.ts` — Phase 17 leak-scan extension over .thumb.webp + .thumb.failed (Plan 17-01 Task 3 + Plan 17-03 Task 2)
- [x] `src/__tests__/thumbnail-route.test.ts` — engine + HTTP route coverage (Plan 17-03 Tasks 1+3) — single test file at the top-level `src/__tests__/` directory (NOT under `src/http/__tests__/`; the corrected path matches PATTERNS.md inventory)
- [x] `src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts` — redact → invalidate ordering + leak-scan (Plan 17-03 Task 2)
- [x] `packages/dashboard/src/__tests__/Thumbnail.test.tsx` — wrapper component stubs (skeleton fallback + C2PA shield render predicate) (Plan 17-04 Task 3) — at top-level `packages/dashboard/src/__tests__/` (NOT `packages/dashboard/src/components/__tests__/`)
- [x] `packages/dashboard/src/__tests__/C2paShield.test.tsx` — pure SVG component stubs (Plan 17-04 Task 2) — at top-level `packages/dashboard/src/__tests__/`
- [x] `packages/dashboard/src/__tests__/VersionCard.test.tsx` (modify existing) — extend with 2 Thumbnail-integration tests (Plan 17-05 Task 1)
- [x] `packages/dashboard/src/__tests__/TreeSidebar.test.tsx` (modify existing) — extend with 2 shot-row-thumb tests (Plan 17-05 Task 2)
- [x] Test fixtures: small PNG, JPEG, WebP, MP4 (H.264 with bright + black frames), oversize MP4 (>100MB stub via sparse file) — generated inline via sharp/ffmpeg in test code (no committed binaries)

*Existing infrastructure (vitest, @testing-library/preact, fs/temp dir helpers from Phase 14/16) covers framework needs — no installs required.*

**Path divergence note:** PATTERNS.md line ~39 explicitly flags that the original CONTEXT.md prompt referenced `packages/dashboard/src/components/__tests__/` and `src/http/__tests__/`, but the actual codebase places dashboard component tests at `packages/dashboard/src/__tests__/` and the new HTTP route test at the top-level `src/__tests__/`. The Wave 0 paths above use the corrected, codebase-matching layout.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity of thumbnails on real renders | VIS-01 | Subjective — "are these the right size, are they sharp on a 4K display, do they letterbox correctly" | Open dashboard, scroll Project view with 20+ completed versions, screenshot grid at 1× and 2× DPR |
| C2PA shield placement on cropped renders | VIS-06 | Cross-aspect verification (square 1024×1024, vertical 1080×1920, ultrawide 2.39:1) | Sign a square + vertical render via Phase 14, verify shield doesn't overlap focal point or version label |
| TreeSidebar shot-row density | VIS-05 + D-13 | Layout-shift inspection at narrow viewport widths | DevTools → resize sidebar to min-width, verify thumb fits without truncation |
| Redact-invalidation visual cycle | VIS-06 + D-05 | End-to-end UX: sign → render thumb → redact → see thumb regenerate | Phase 16 redact_manifest action then refresh dashboard; thumb should regenerate within ~200ms |
| License verification gate (Plan 04 Task 1) | D-08 | Subjective decision tree (A/B/C-redraw/C-fallback) over discovered license text | Resume-signal token from user; planner captures URLs + verbatim license quotes in 17-04-SUMMARY.md |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (or are explicitly checkpoints — Plan 04 Task 1)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Plan 04 Task 1 is a single checkpoint sandwiched between Task 2 + Task 3, both automated)
- [x] Wave 0 covers all MISSING references — every test file path above matches what the plans create
- [x] No watch-mode flags — all verify commands use `vitest run --reporter=basic --no-coverage`
- [x] Feedback latency < 20s — combined root + dashboard suite ~18s
- [x] `nyquist_compliant: true` set in frontmatter
- [x] `wave_0_complete: true` set in frontmatter

**Approval:** validated 2026-05-01
