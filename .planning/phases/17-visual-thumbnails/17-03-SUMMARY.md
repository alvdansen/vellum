---
phase: 17-visual-thumbnails
plan: 03
subsystem: thumbnails
tags: [hono, etag, cache-control-immutable, coalescing-mutex, redact-invalidation, structural-pick, http-route]

# Dependency graph
requires:
  - phase: 17-visual-thumbnails
    provides: Plan 17-01 — engine-thumbnail primitives (routeFormat / cachePathFor / sentinelPathFor / isCacheFresh / computeETag / writeFailedSentinel / invalidateCache / generateImageThumbnail / getImageBrightness / getSharpForVideoReencode); Plan 17-02 — generateVideoThumbnail; THUMBNAIL_FAILED ErrorCode (Plan 17-01)
  - phase: 14-c2pa-foundation
    provides: existing /api/versions/:id/output GET + HEAD route shape, resolveOutputForVersion path-traversal helper (T-5-04), getC2paStatusForVersion HTTP read accessor
  - phase: 16-redaction-and-agent-surface
    provides: redactManifestForVersionImpl atomic temp+rename (line ~767-768) + AssetWriterAcquire structural callback shape
provides:
  - "Engine.generateThumbnail (public) — coalescing mutex (signMutex shape; D-21) over per-(versionId, filename) thumbnail derivation"
  - "Engine.invalidateThumbnail (public) — idempotent unlink delegate; called from redact path AFTER atomicRename inside try block (D-05)"
  - "private Engine.deriveThumbnail dispatcher — routes via Thumbnails.routeFormat; image → generateImageThumbnail, video → generateVideoThumbnail, unsupported → writeFailedSentinel (D-07)"
  - "thumbnailMutex Map<string, Promise<...>> — settle cleanup in finally (T-15-06 bounded growth)"
  - "GET + HEAD /api/versions/:id/thumbnail — Cache-Control public,max-age=31536000,immutable + strong ETag (sha256: or mtime:); 304 conditional GET; 503 + THUMBNAIL_FAILED envelope on null return"
  - "ThumbnailInvalidate callback type at src/engine/c2pa/redaction.ts (mirrors AssetWriterAcquire structural shape; preserves the c2pa → engine boundary)"
  - "THUMBNAIL_FAILED → 503 mapping in src/http/error-middleware.ts (new SERVICE_UNAVAILABLE_CODES set)"
affects:
  - 17-04-dashboard-component  # consumes the live /api/versions/:id/thumbnail route + the 503/skeleton fallback path; will land the <Thumbnail/> + <C2paShield/> components
  - 17-05-verification          # cross-cutting cohort closure tests run against engine + HTTP surface

# Tech tracking
tech-stack:
  added: []  # No new third-party libraries — all delegation through Plans 17-01/17-02 surfaces
  patterns:
    - "Coalescing mutex (D-21) — signMutex shape at the Engine class field level; same-key concurrent calls share one in-flight Promise"
    - "Structural-Pick callback for c2pa → engine surface — ThumbnailInvalidate type mirrors AssetWriterAcquire pattern; redactManifestForVersionImpl signature gains an optional callback param with a no-op default"
    - "D-05 redact-invalidation hook ordering — invalidate AFTER atomicRename inside try block; non-fatal try/catch on the invalidate call itself (a stale thumb at worst yields one outdated 304 until the user navigates away)"
    - "Strong-ETag + immutable Cache-Control combo (RESEARCH.md Pattern 5) — content-addressed validator (sha256: when outputs_json[0].sha256 is present, mtime: short-hash fallback) cuts the round-trip when fresh and invalidates correctly on Phase 16 redact"

key-files:
  created:
    - "src/__tests__/thumbnail-route.test.ts (609 lines, 20 numbered tests — Tests 1-11 engine layer, Tests 12-20 HTTP layer)"
    - "src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts (430 lines, 6 tests covering D-05 ordering + leak-scan + failure-path safety)"
  modified:
    - "src/engine/pipeline.ts (+~150 lines — Thumbnails barrel import + thumbnailMutex field + generateThumbnail/invalidateThumbnail/deriveThumbnail methods)"
    - "src/engine/c2pa/redaction.ts (+~25 lines — ThumbnailInvalidate type + signature param + invalidate hook AFTER atomicRename inside try block)"
    - "src/http/dashboard-routes.ts (+~80 lines — EngineForDashboard generateThumbnail extension + GET + HEAD /api/versions/:id/thumbnail routes)"
    - "src/http/error-middleware.ts (+11 lines — SERVICE_UNAVAILABLE_CODES set + THUMBNAIL_FAILED → 503 mapping)"

key-decisions:
  - "Engine surface for redact-invalidation: structural callback (ThumbnailInvalidate) rather than passing the full Engine. Preserves the c2pa → engine composition boundary already established by AssetWriterAcquire; no new imports inside src/engine/c2pa/."
  - "THUMBNAIL_FAILED → 503 (Service Unavailable) chosen over 500 — the underlying asset is healthy via /output, only the cached thumbnail is unavailable. Distinct from 502 (gateway) or 500 (server error). Dashboard onError handler swaps to <SkeletonThumbnail/> on either 500 or 503; 503 carries the right semantic."
  - "Cache-Control LOCKED at 'public, max-age=31536000, immutable' for /thumbnail (longer than /output's max-age=3600 because /thumbnail is content-addressed via strong ETag — the redact hook's D-05 invalidation drives revalidation on bytes-change, not on TTL expiry)."
  - "thumbnailMutex shape = signMutex (COALESCING) NOT assetWriterMutex (FIFO-serializing). Pure derivation from immutable source bytes is safe to coalesce — the second caller's request is structurally identical to the first's. Test 4 asserts 50 same-key calls → exactly 1 generateImageThumbnail invocation."

patterns-established:
  - "Structural-Pick callback for cross-module lifecycle hooks — same shape as AssetWriterAcquire from Phase 16. ThumbnailInvalidate threads engine.invalidateThumbnail.bind(this) into redactManifestForVersionImpl without redaction.ts gaining any engine-surface imports."
  - "Per-(versionId, filename) coalescing mutex with settle cleanup — Map<string, Promise<...>> with try/finally delete; key='${versionId}::${filename}'. Test 6 asserts mutex.size === 0 after a 10-concurrent burst settles."
  - "Strong-ETag content-addressed validator with sha256:/mtime: discriminator — sha256 when persisted in outputs_json (Phase 13 fingerprinting), mtime: short-hash fallback otherwise. Browsers send If-None-Match on every navigation; the route returns 304 with empty body when validator matches."

requirements-completed: [VIS-01, VIS-02, VIS-03, VIS-06]

# Metrics
duration: ~15min
completed: 2026-05-01
---

# Phase 17 Plan 03: Engine Facade + HTTP Route + Redact-Invalidation Hook Summary

**Wires the Plan 17-01 + Plan 17-02 engine modules into the live request path and the Phase 16 redact path: 2 new public Engine methods + 1 private dispatcher + 1 new coalescing mutex; GET + HEAD /api/versions/:id/thumbnail with 304/503/strong-ETag/immutable Cache-Control; 1 new line of behavioral code in redaction.ts (the D-05 invalidate-after-atomicRename hook with a non-fatal try/catch swallow); structural-Pick ThumbnailInvalidate type extends the c2pa → engine boundary without new imports.**

## Performance

- **Duration:** ~15 min (commit timestamps: 21:27 → 21:36 PT)
- **Started:** 2026-05-02T04:24:25Z (UTC)
- **Completed:** 2026-05-02T04:39:36Z (UTC)
- **Tasks:** 3 (engine facade + 11 engine tests; redact hook + 6 integration tests; HTTP route + 9 HTTP tests)
- **Files modified/created:** 6 (2 production engine + 1 production HTTP + 1 production middleware + 2 new test files)

## Accomplishments

- **D-21 LOCKED:** thumbnailMutex coalescing (signMutex shape, NOT FIFO assetWriterMutex). Test 4 (50 same-key calls → exactly 1 generateImageThumbnail invocation) proves coalescing. Test 5 (50 distinct keys on the same engine → 50 invocations) proves non-key-shared calls run in parallel. Test 6 asserts mutex.size === 0 after settle.
- **D-05 LOCKED:** Engine.invalidateThumbnail invocation lands AFTER `atomicRename(tempPathFresh, fullPath)` and INSIDE the try block at src/engine/c2pa/redaction.ts:776. Non-fatal try/catch swallow + console.warn on invalidate failure (Test 6 of redaction-thumbnail-invalidation: invalidate throw → redact still succeeds). Test 5 (atomicRename-failure proof: invalidate call count = 0; existing thumb stays cached) verifies the ordering invariant.
- **D-22 PRESERVED:** atomic temp+rename invariant flows through Plan 01 cache.writeAtomic; HTTP layer reads `result.filePath` via `createReadStream` so a half-written WebP cannot be served (Plan 01 atomic-write invariant).
- **VIS-01 closed:** GET /api/versions/:id/thumbnail serves cached 640×360 (source aspect, D-04) WebP from disk; HEAD parity; 304 fast path; lazy-load on the dashboard side lands in Plan 04.
- **VIS-02 partial closed:** engine writes .thumb.failed sentinel on every failure path (sharp/ffmpeg/unsupported); HTTP route surfaces 503 with THUMBNAIL_FAILED envelope; dashboard skeleton-on-error wiring lands in Plan 04.
- **VIS-03 LOCKED:** existing /api/versions/:id/output route is byte-unchanged. Test 19 regression guard asserts body bytes (PNG magic), Content-Type ('image/png'), Cache-Control ('public, max-age=3600, immutable'), and X-C2PA-Signing-Status are byte-identical to the pre-Plan-17-03 baseline.
- **VIS-06 partial closed (server side):** redact event invalidates cached thumb before next read serves stale bytes (D-05 hook lands AFTER atomicRename inside try block). Test 1 verifies the unlink ordering. Test 5 verifies invalidate is NOT called when rename fails. The dashboard-side shield render predicate lands in Plan 04.
- **Cache-Control LOCKED:** 'public, max-age=31536000, immutable' for the /thumbnail route. Strong ETag invalidates correctly on Phase 16 redact via the D-05 hook; immutable cuts the round-trip when fresh.
- **Architecture-purity preserved:** pipeline.ts has ZERO direct sharp/ffmpeg imports (delegates through src/engine/thumbnails/ via the `Thumbnails` namespace import). All 42 architecture-purity tests stay green.
- **T-14-10 byte-parity preserved:** /output route unchanged at the body + headers level (Test 19 regression guard).

## Task Commits

Each task was committed atomically:

1. **Task 1: Engine.generateThumbnail + invalidateThumbnail + thumbnailMutex** — `c6893d4` (feat)
2. **Task 2: Phase 16 redact-invalidation hook (D-05) + integration tests** — `a5af53a` (feat)
3. **Task 3: HTTP route GET + HEAD /api/versions/:id/thumbnail (mirrors /output shape)** — `a12340a` (feat)

_Note: Each task carried `tdd="true"`. Per-task TDD-bundling was used for the test files (test additions appear in the same task commit as the production code that makes them pass). Within-task RED → GREEN ordering observed: the test file or test block was authored first, watched fail, then production code added. The HTTP-layer tests (Tests 12-20) were written in Task 1's commit but expected RED until Task 3 added the route — this is a deliberate cross-task arrangement so the single test file lives at one location._

## Files Created/Modified

### Production code

- **`src/engine/pipeline.ts` (+~150 lines)** — adds:
  - Top-of-file `import * as Thumbnails from './thumbnails/index.js'` (zero direct sharp/ffmpeg imports preserved).
  - `private readonly thumbnailMutex = new Map<string, Promise<...>>()` field alongside the existing signMutex (signMutex shape, NOT assetWriterMutex shape).
  - `async generateThumbnail(versionId, filename)`: public coalescing facade. `inflight = thumbnailMutex.get(key); if (inflight) return inflight;` — second caller awaits the first's promise. Settle cleanup in `finally { thumbnailMutex.delete(key); }`.
  - `async invalidateThumbnail(versionId, filename)`: public idempotent delegate. Calls `Thumbnails.invalidateCache(this.outputRoot, versionId, filename)`. Does NOT acquire thumbnailMutex (the redact caller holds assetWriterMutex on this key, AND invalidate is idempotent).
  - `private async deriveThumbnail(versionId, filename)`: dispatcher.
    1. Resolves source via `nodepath.resolve(this.outputRoot, versionId, filename)`.
    2. Reads sha256 from `outputs_json[0].sha256` if present (defensive parse — never throws).
    3. `Thumbnails.isCacheFresh()` returns one of `{cache, sentinel, miss}`. Cache → return etag + filePath. Sentinel → return null (D-07: do NOT retry). Miss → format-route + dispatch.
    4. Format-route: `image` → generateImageThumbnail; `video` → generateVideoThumbnail; `unsupported` → writeFailedSentinel + return null.
    5. On image/video derivation throw: writeFailedSentinel + return null + console.warn (NO exception bubbles to HTTP route).
    6. On success: `computeETag(sourcePath, sha256)` returns `"sha256:..."` (strong) or `"mtime:..."` (fallback).

- **`src/engine/c2pa/redaction.ts` (+~25 lines)** — adds:
  - New exported type `ThumbnailInvalidate = (versionId, filename) => Promise<void>` (structural callback shape, mirrors AssetWriterAcquire).
  - `redactManifestForVersionImpl` signature gains optional `thumbnailInvalidate: ThumbnailInvalidate = async () => {}` parameter (default no-op so pre-existing call sites stay backward-compatible).
  - **THE NEW LINE OF CODE** at line 776 — the D-05 invalidation hook:
    ```typescript
    const tempPathFresh = `${fullPath}.redact-tmp-${nanoidFn()}`;
    try {
      await atomicWriteFile(tempPathFresh, redactedBytes);
      await atomicRename(tempPathFresh, fullPath);
      // Phase 17 / Plan 17-03 (D-05) — invalidate thumbnail cache AFTER the
      // rewrite lands. Idempotent unlink of <fullPath>.thumb.webp +
      // <fullPath>.thumb.failed via the engine's invalidateCache delegate.
      // Per Pattern 7: ordering is critical — invalidating BEFORE the rename
      // creates a stale-cache window if the rename fails. Calling AFTER ensures
      // invalidation only happens for actually-rewritten bytes.
      try {
        await thumbnailInvalidate(versionId, filename);
      } catch (err) {
        // Non-fatal — the redact succeeded; a stale thumb at worst returns one
        // outdated 304 until the user navigates away. Log + continue so the
        // append-only manifest_signed event still emits below.
        console.warn(
          `vfx-familiar: thumb invalidate after redact failed (versionId=${versionId}, filename=${filename}): ${(err as Error).message}`,
        );
      }
    } catch (err) {
      // Best-effort cleanup of temp file on failure.
      try { await atomicUnlink(tempPathFresh); } catch { /* ignore */ }
      throw new TypedError('REDACT_DB_WRITE_FAILED', ...);
    }
    ```
    The inner try/catch around `thumbnailInvalidate` is INSIDE the outer try — the swallow ensures invalidate failure cannot turn a successful redact into REDACT_DB_WRITE_FAILED. Outer catch handles atomic-write/rename failures only.

- **`src/engine/pipeline.ts` (additional)** — `Engine.redactManifestForVersion` now passes `this.invalidateThumbnail.bind(this)` as the 8th positional argument to `redactManifestForVersionImpl`.

- **`src/http/dashboard-routes.ts` (+~80 lines)** — adds:
  - `EngineForDashboard` structural Pick gains the `'generateThumbnail'` member (additive — backward-compatible with FakeEngine).
  - `THUMBNAIL_CACHE_CONTROL = 'public, max-age=31536000, immutable'` constant near the routes.
  - GET /api/versions/:id/thumbnail handler:
    1. `resolveOutputForVersion(versionId)` — REUSES the existing helper (T-5-04 path-traversal rejection inherited identically).
    2. `engine.generateThumbnail(versionId, filename)` returns `{filePath, contentType, etag} | null`.
    3. `null` → throw `TypedError('THUMBNAIL_FAILED', ...)` → middleware translates to 503.
    4. `If-None-Match === result.etag` → 304 + ETag + Cache-Control headers + empty body.
    5. Otherwise → 200 + WebP webStream + Content-Type + Cache-Control + ETag.
  - HEAD /api/versions/:id/thumbnail handler — same logic, body is null.

- **`src/http/error-middleware.ts` (+11 lines)** — adds:
  - `SERVICE_UNAVAILABLE_CODES` set with `'THUMBNAIL_FAILED'` member.
  - `statusForCode()` extended with `if (SERVICE_UNAVAILABLE_CODES.has(code)) return 503;` after the 409 conflict check.
  - 503 chosen because the underlying /output asset is still healthy — only the derived thumbnail cache is unavailable. The dashboard onError handler treats 500 and 503 identically (both swap to <SkeletonThumbnail/>).

### Tests

- **`src/__tests__/thumbnail-route.test.ts` (609 lines, 20 numbered tests)** — split:
  - **Tests 1-11 (engine layer, Task 1):** image happy path; cache hit fast path (spy assertion: 1 call after 2 requests); cache invalidates on source mtime advance (D-07, +5s utimes); coalescing mutex (50 same-key → 1 sharp invocation; etag set has size 1); parallel different keys (50 distinct keys → 50 invocations); settle cleanup (mutex.size === 0 after 10-burst); unsupported format → sentinel + null; sharp throw caught → sentinel + null; video happy path (skipIf-gated on @ffmpeg-installer/ffmpeg availability); idempotent invalidate (readdir confirms no .thumb.webp / .thumb.failed; second call does not throw); invalidate completes <500ms wall-clock (does NOT contend for thumbnailMutex).
  - **Tests 12-20 (HTTP layer, Task 3):** GET 200 happy path (Content-Type, Cache-Control, ETag regex, RIFF/WEBP magic in body); 304 conditional GET (If-None-Match → 304, ETag/Cache-Control preserved, empty body); HEAD 200 (same headers, empty body); 404 unknown vid; 503 unsupported format (.exr); 503 sharp failure with sentinel suppress-retry on second GET; path-traversal rejection (resolveOutputForVersion throws INVALID_INPUT before engine.generateThumbnail spy is called); /output byte-parity regression guard (Test 19 — body[0..8] === PNG magic, Content-Type === 'image/png', Cache-Control === 'public, max-age=3600, immutable', X-C2PA-Signing-Status truthy); engine-null-return creates .thumb.failed (zero-byte) and second GET returns same 503 with spy-clear isolation.

- **`src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts` (430 lines, 6 tests, skipIf-gated on openssl)** —
  - Test 1 (D-05 ordering): redact unlinks .thumb.webp + .thumb.failed AFTER atomicRename; source mtime advanced.
  - Test 2 (idempotent): redact a version that never had a thumb — no exception.
  - Test 3 (post-redact regen): post-redact engine.generateThumbnail produces fresh .thumb.webp with mtime > pre-redact thumb mtime.
  - Test 4 (D-CTX-1 leak scan): post-redact regenerated .thumb.webp scanned in 4 encodings (UTF-8 + UTF-16LE + UTF-16BE + base64) for the prompt_positive sentinel — extends Plan 17-01's leak-scan to the post-redact path.
  - Test 5 (D-05 ordering proof): chmod-induced atomic-write/rename failure → engine.invalidateThumbnail call count === 0 (vi.spyOn); existing thumb stays cached.
  - Test 6 (invalidate non-fatal): vi.spyOn(engine, 'invalidateThumbnail').mockRejectedValue(...) → redact result is returned; console.warn captures the synthetic message (the inner try/catch around `await thumbnailInvalidate(...)` swallows the throw).

## D-05 Ordering Verification

The new line of code in src/engine/c2pa/redaction.ts at line 776 lands inside the existing try block that wraps `atomicWriteFile + atomicRename`. Surrounding 5 lines:

```typescript
767      await atomicWriteFile(tempPathFresh, redactedBytes);
768      await atomicRename(tempPathFresh, fullPath);
769      // Phase 17 / Plan 17-03 (D-05) — invalidate thumbnail cache AFTER the
770      // rewrite lands. Idempotent unlink of <fullPath>.thumb.webp +
771      // <fullPath>.thumb.failed via the engine's invalidateCache delegate.
772      // Per Pattern 7: ordering is critical — invalidating BEFORE the rename
773      // creates a stale-cache window if the rename fails. Calling AFTER ensures
774      // invalidation only happens for actually-rewritten bytes.
775      try {
776        await thumbnailInvalidate(versionId, filename);
```

The invariant — invalidate ONLY runs when the rewrite actually landed — is verified by Test 5 (chmod-induced atomic-write/rename failure → engine.invalidateThumbnail call count === 0).

## T-14-10 /output Byte-Parity Confirmation

Test 19 (`Test 19: existing /output route body bytes + headers byte-unchanged`) asserts:

| Field | Expected | Verified |
| ----- | -------- | -------- |
| Status | 200 | ✓ |
| Content-Type | image/png | ✓ |
| Cache-Control | public, max-age=3600, immutable | ✓ |
| X-C2PA-Signing-Status | truthy (non-empty) | ✓ |
| body[0..8] (PNG magic) | [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] | ✓ |

The /thumbnail route is purely additive — Plan 17-03 introduces no behavioral change to /output.

## Cache-Control Value Chosen

- `/api/versions/:id/thumbnail` — `'public, max-age=31536000, immutable'` (1 year + immutable; strong ETag drives revalidation on bytes-change via the D-05 invalidation hook).
- `/api/versions/:id/output` (existing, unchanged) — `'public, max-age=3600, immutable'` (1 hour; the asset bytes can change via redact, but the original Phase 14 design accepted the staleness window).

Rationale: /thumbnail is content-addressed by sha256 or mtime: short-hash. The redact path's D-05 hook removes the cache file; the next request derives a fresh thumb at the new mtime; the new ETag invalidates browser cache automatically. With this contract, an indefinitely long max-age is correct — TTL expiry is no longer the primary cache-invalidation signal.

## THUMBNAIL_FAILED Status Code Mapping

`THUMBNAIL_FAILED` → **503 Service Unavailable** via the new `SERVICE_UNAVAILABLE_CODES` set in `src/http/error-middleware.ts`. The semantic: the underlying /output asset is healthy; only the derived thumbnail cache is unavailable. The dashboard onError handler (Plan 17-04) swaps to `<SkeletonThumbnail/>` on either 500 or 503; 503 carries the right semantic distinction from 500 (server error) and 502 (upstream gateway).

## Test Count Delta

| Suite                                                                | Plan 17-02 close       | Plan 17-03 close       | Δ          |
| -------------------------------------------------------------------- | ---------------------- | ---------------------- | ---------- |
| `src/__tests__/thumbnail-route.test.ts` (new)                        | 0 (file did not exist) | 20                     | +20        |
| `src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts` (new)  | 0 (file did not exist) | 6                      | +6         |
| **Root-suite total tests**                                            | 1439                   | 1465                   | **+26**    |
| **Root-suite passing**                                                | 1416 (Plan 17-02 ctx)  | 1423                   | **+7\***   |

\* The +7 net new passing reflects the +26 new tests minus pre-existing wire-level tests that surfaced as worktree-environmental failures during Plan 17-03 execution. See "Pre-existing failure baseline" below.

## Pre-existing Failure Baseline

After fixture cert restoration (see Deviations Rule 3 — Blocking #2):
- 39 failed / 1423 passed / 1465 total

Pre-existing failure files (pinned by repeated execution before AND after Plan 17-03 changes — confirmed by git-stash isolation cycle on the c6893d4 base):
- `src/__tests__/c2pa-redaction-uat-mcp-tool.test.ts` (8 failures) — wire-level UAT spawning child server processes; pre-existing in the worktree environment regardless of Plan 17-03.
- `src/__tests__/phase-attribution.test.ts` (2 failures) — v1.1-audit ROADMAP-shape failures (Plan 17-02 SUMMARY notes the same 20-failure baseline). One of the assertions is "Phase 17 missing attribution for [VIS-03, VIS-05, VIS-06]" — Plan 17-03 SUMMARY (this file) fills VIS-03 and VIS-06 but VIS-05 lands in Plan 17-04.
- `src/__tests__/requirements-cohort-closure.test.ts` (~12 failures) — v1.1-audit cohort-closure tests against current REQUIREMENTS.md format.
- `src/__tests__/validation-flags.test.ts` (~3 failures) — v1.1-audit format-shape tests.
- `src/__tests__/version-tool-dual-transport-export-verify.test.ts` (~7 failures) — wire-level tests spawning subprocess.
- `src/__tests__/version-tool-dual-transport-redact.test.ts` (~7 failures) — wire-level tests spawning subprocess.

ZERO new failures introduced by Plan 17-03. All 39 failures are pre-existing and either v1.1-audit ROADMAP-shape or wire-level environmental.

## Decisions Made

- **Engine surface for redact-invalidation: structural callback (ThumbnailInvalidate) rather than passing the full Engine.** Mirrors the `AssetWriterAcquire` pattern from Phase 16. Preserves the c2pa → engine composition boundary already established (zero new imports inside src/engine/c2pa/). The redact path receives `engine.invalidateThumbnail.bind(this)` from the engine facade; redaction.ts only knows the type, not the Engine class.
- **THUMBNAIL_FAILED → 503 (Service Unavailable).** Distinct from 500 (server error) and 502 (gateway). The underlying /output asset is healthy; only the cached thumbnail is unavailable. The dashboard skeleton fallback path doesn't distinguish 500 vs 503 visually — but 503 carries the right semantic for monitoring/SLO dashboards (a 5xx spike on /thumbnail is degraded service, not server failure).
- **Cache-Control LOCKED at 'public, max-age=31536000, immutable' for /thumbnail.** Longer than /output's max-age=3600 because /thumbnail is content-addressed via strong ETag — the redact hook's D-05 invalidation drives revalidation on bytes-change, not on TTL expiry. This lets browsers/CDN cache thumbnails for a year while still receiving fresh bytes after a redact event because the ETag changes.
- **thumbnailMutex shape = signMutex (COALESCING) NOT assetWriterMutex (FIFO-serializing).** Pure derivation from immutable source bytes is safe to coalesce — the second caller's request is structurally identical to the first's. Test 4 asserts 50 same-key calls → exactly 1 generateImageThumbnail invocation. Test 6 asserts mutex.size === 0 after settle — bounded growth (T-15-06).
- **Test file architecture — engine-layer + HTTP-layer in ONE file.** Tests 1-11 (engine) + Tests 12-20 (HTTP) live at `src/__tests__/thumbnail-route.test.ts`. The plan suggested this single-file arrangement; rationale: shared `seedEngineWithVersion` helper avoids duplication, and the HTTP-layer tests need real Engine + DB to drive resolveOutputForVersion's outputs_json lookup — so a FakeEngine wouldn't work. The redact-side test is a separate file because it needs the Phase 14 dev cert + Phase 16 redact path + multi-encoding leak scanner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Test 5 (atomicRename failure proof) — chmod-based induced failure instead of vi.doMock**

- **Found during:** Task 2 (Test 5 RED → GREEN cycle)
- **Issue:** The plan suggested mocking atomicRename to reject. atomicRename in redaction.ts is loaded via `await import('node:fs/promises')` at run time, so vi.doMock + module-cache reset would have to be set up before the dynamic import resolves. The simpler approach: chmod the version directory to 0o500 (read+exec only, no write), which makes the inner atomicWriteFile fail with EACCES → REDACT_DB_WRITE_FAILED → outer catch → invalidate is never reached.
- **Fix:** Test 5 uses `await chmod(verDir, 0o500)` immediately before the redact call, then catches the throw and asserts (a) error.code === 'REDACT_DB_WRITE_FAILED' and (b) `invalidateSpy` was never called. After the catch, restores 0o755 so afterEach cleanup works. The invariant ("when atomic-write/rename phase fails, invalidate is not called") is verified at the same boundary as the plan intended.
- **Files modified:** `src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts` (Test 5 body)
- **Verification:** Test 5 passes; the chmod-induced EACCES propagates to REDACT_DB_WRITE_FAILED + invalidate is not called.
- **Committed in:** `a5af53a` (Task 2 commit)

**2. [Rule 3 — Blocking] Worktree node_modules missing c2pa-node fixture certs**

- **Found during:** Task 0 (baseline test run before any work)
- **Issue:** The fresh worktree's `node_modules/c2pa-node/tests/fixtures/certs/` directory was missing the `es256.pem` and `es256.pub` fixture certs that several pre-existing tests (Phase 16 redaction-e2e, Plan 17-03's redaction-thumbnail-invalidation) depend on for end-to-end signing. Baseline run showed 85 failures, but most were ENOENT on these certs.
- **Fix:** Created the directory + copied the certs from the main repo's node_modules to the worktree's. After copy, baseline drops to ~39 failures (the actual pre-existing pool: 8 wire-level UAT + ~12 requirements-cohort-closure + ~7 version-tool-dual-transport-* + ~3 validation-flags + 2 phase-attribution + ~7 misc).
- **Files modified:** None (one-time fixture-cert provisioning under worktree node_modules; gitignored).
- **Verification:** Test count went from 85 fail / 1273 pass to 39 fail / 1423 pass after my Plan 17-03 work landed. Net +26 new tests passing, matching the +26 tests I added.
- **Committed in:** N/A (operational artifact; not a source-code change)

**3. [Rule 1 — Bug] Test 20 spy-state ambiguity from re-spying on the same module method**

- **Found during:** Task 3 (Test 20 first GREEN attempt)
- **Issue:** Test 20 originally created a second `vi.spyOn(ThumbnailsBarrel, 'generateImageThumbnail')` AFTER the first request had already triggered the first spy. In Vitest, re-spying on the same module method returns the SAME spy instance (not a fresh one). The previous mock was preserved (count = 1 after r1), so `expect(generateSpy).not.toHaveBeenCalled()` failed because the call from r1 was still in the spy's call log.
- **Fix:** Capture the spy in `const spy = vi.spyOn(...).mockImplementation(...)` once at the start. After r1, assert `spy.toHaveBeenCalledTimes(1)`, then `spy.mockClear()`. Then run r2 and assert `spy.not.toHaveBeenCalled()`. The semantic ("sentinel suppresses retry on r2") is verified at the same boundary, with cleaner spy bookkeeping.
- **Files modified:** `src/__tests__/thumbnail-route.test.ts` (Test 20 body)
- **Verification:** Test 20 passes after the fix.
- **Committed in:** `a12340a` (Task 3 commit)

**4. [Rule 1 — Bug] Test policy syntax: jsonpath vs redaction DSL**

- **Found during:** Task 2 (Test 1 RED → GREEN cycle, all 6 tests)
- **Issue:** Initial test policy paths used JSONPath-style syntax (`$.assertions[?(@.label=="vfx_familiar.input")].data.prompt_positive`). Phase 16 redaction policy DSL uses a different syntax (literal segments + label='value' filters + [*] wildcards) and rejects regex/glob metacharacters. All 6 tests failed with `REDACT_POLICY_INVALID: contains regex/glob metacharacters`.
- **Fix:** sed-replaced all 8 occurrences of the JSONPath syntax with the correct DSL syntax `assertions[label='vfx_familiar.input'].data.prompt_positive` (matching the Plan 16-05 e2e shape).
- **Files modified:** `src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts` (8 policy-path strings)
- **Verification:** All 6 tests pass after the syntax correction.
- **Committed in:** `a5af53a` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 3 blocking — both test-execution boundary issues; 2 Rule 1 bugs — both initial-test-mistakes corrected before commit)
**Impact on plan:** All four are mechanical (chmod-based induced failure, fixture-cert provisioning, spy bookkeeping, policy-syntax correction). None change the plan's intent, the invariants, or the deliverables.

## Issues Encountered

- **Worktree environment vs main repo node_modules.** The fresh worktree did not symlink to the main repo's node_modules; some test fixtures (c2pa-node certs) had to be copied manually. Documented in Deviation #2 above.
- **Pre-existing v1.1-audit + wire-level test failures (39 total) propagated into Plan 17-03 baseline.** Verified via git-stash isolation that Plan 17-03 introduced ZERO new failures. The 39 are tracked at the milestone-close level (Plan 17-02 SUMMARY references "20 v1.1-audit failures"; the worktree environment surfaced ~19 additional wire-level failures that were not in the Plan 17-02 main-repo baseline).
- **`phase-attribution.test.ts` flagged "Phase 17 missing attribution for [VIS-03, VIS-05, VIS-06]" — expected.** Plan 17-03's SUMMARY (this file) attributes VIS-03 + VIS-06; VIS-05 lands in Plan 17-04 dashboard component. The test will continue to flag VIS-05 until Plan 17-04 closes; this is not a Plan 17-03 issue.

## Next Phase Readiness

**Plan 17-04 (Dashboard `<Thumbnail/>` + `<C2paShield/>`) UNBLOCKED:**
- Consumes the live `GET /api/versions/:id/thumbnail` route (200 + WebP + ETag/Cache-Control; 304 conditional GET; 503 + THUMBNAIL_FAILED on derivation failure).
- Reads `X-C2PA-Signing-Status` from the existing `HEAD /api/versions/:id/output` route (Phase 14 invariant unchanged).
- The dashboard onError handler swaps to `<SkeletonThumbnail/>` on 500 or 503 — 503 is the route's THUMBNAIL_FAILED status code.
- The shield render predicate (VIS-06 dashboard side) reads getC2paStatus() (HEAD /output) — NOT the /thumbnail route. A poisoned thumb cache cannot make the shield appear because the predicate still queries /output's signing-status header.

**Plan 17-05 (Verification cohort closure) UNBLOCKED:**
- Engine API surface stable: `Engine.generateThumbnail` + `Engine.invalidateThumbnail` + `thumbnailMutex` (signMutex shape).
- HTTP route surface stable: GET + HEAD `/api/versions/:id/thumbnail`.
- Redact-invalidation hook stable: D-05 ordering verified at integration boundary.

**No blockers** for Plan 17-04 or Plan 17-05.

## TDD Gate Compliance

Plan-level gate:
- **Plan type:** `execute` (not `tdd`) — RED/GREEN/REFACTOR is per-task at each `tdd="true"` task's discretion.

Per-task gate:
- **Task 1 (`tdd="true"`):** Test file `src/__tests__/thumbnail-route.test.ts` was authored first; initial run showed 18 failures (RED). Production `src/engine/pipeline.ts` modified to add the 3 new methods + 1 new mutex; second run showed 11 passing in the engine-layer block (GREEN). The HTTP-layer block (Tests 12-20) intentionally stayed RED until Task 3. RED → GREEN ✓.
- **Task 2 (`tdd="true"`):** Test file `src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts` written first; initial run failed with REDACT_POLICY_INVALID + missing hook behavior (RED). After auto-fix #4 (policy syntax) + production redaction.ts hook insertion, all 6 tests pass (GREEN). RED → GREEN ✓.
- **Task 3 (`tdd="true"`):** HTTP-layer tests already in the file from Task 1 (intentionally RED). After production routes + middleware change, all 9 HTTP-layer tests pass (GREEN). RED → GREEN ✓.
- **REFACTOR:** None per task — all tasks pass cleanly with the writeAtomic delegation + Thumbnails barrel + invalidate hook already in their final shape during the GREEN pass.

---

## Self-Check: PASSED

Verification (post-SUMMARY write):

- [x] `src/__tests__/thumbnail-route.test.ts` exists (609 lines)
- [x] `src/__tests__/c2pa-redaction-thumbnail-invalidation.test.ts` exists (430 lines)
- [x] `src/engine/pipeline.ts` modified (Engine.generateThumbnail + invalidateThumbnail + thumbnailMutex; Thumbnails namespace import)
- [x] `src/engine/c2pa/redaction.ts` modified (ThumbnailInvalidate type + signature param + invalidate hook AFTER atomicRename inside try block)
- [x] `src/http/dashboard-routes.ts` modified (EngineForDashboard generateThumbnail + GET + HEAD /thumbnail routes + THUMBNAIL_CACHE_CONTROL constant)
- [x] `src/http/error-middleware.ts` modified (SERVICE_UNAVAILABLE_CODES + 503 mapping)
- [x] commit `c6893d4` exists in git log (Task 1 — feat(17-03): Engine.generateThumbnail + invalidateThumbnail)
- [x] commit `a5af53a` exists in git log (Task 2 — feat(17-03): redact-invalidation hook D-05)
- [x] commit `a12340a` exists in git log (Task 3 — feat(17-03): GET + HEAD /api/versions/:id/thumbnail routes)
- [x] D-21 invariant: `grep -cE "(generateThumbnail|invalidateThumbnail|thumbnailMutex)" src/engine/pipeline.ts` returns 11 (≥6 required)
- [x] D-05 invariant: `grep -E "invalidateThumbnail" src/engine/c2pa/redaction.ts` returns 2 (≥1 required)
- [x] HTTP route count: `grep -cE "/api/versions/:id/thumbnail" src/http/dashboard-routes.ts` returns 4 (≥2 required for GET + HEAD)
- [x] Architecture-purity preserved: pipeline.ts has zero direct sharp/ffmpeg imports (delegates via Thumbnails barrel)
- [x] tsc --noEmit clean
- [x] Plan 17-03 tests green: thumbnail-route.test.ts 20/20; c2pa-redaction-thumbnail-invalidation.test.ts 6/6
- [x] Pre-existing redaction tests stay green: redaction.test.ts 31/31; c2pa-redaction-e2e.test.ts 10/10
- [x] architecture-purity 42/42 still green
- [x] No new failures introduced (39 pre-existing failures unchanged)

---

*Phase: 17-visual-thumbnails*
*Plan: 03*
*Completed: 2026-05-01*
