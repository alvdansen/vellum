---
phase: 17-visual-thumbnails
plan: 01
subsystem: thumbnails
tags: [sharp, webp, atomic-write, etag, architecture-purity, lazy-import, thumbnail-cache]

requires:
  - phase: 14-c2pa-foundation
    provides: lazy-native-binding pattern (signer.ts), atomic temp+rename (output-downloader.ts), allowed-set test shape (architecture-purity.test.ts)
  - phase: 16-redaction-and-agent-surface
    provides: structural Pick engine surface (output-downloader.ts), atomic rename pattern (redaction.ts), multi-encoding leak-scan harness (c2pa-key-leak-negative.test.ts)
provides:
  - sharp@^0.34.5 dependency pinned + sole-importer rule locked at architecture-purity.test.ts (D-23 / D-25)
  - src/engine/thumbnails/format-router.ts (pure routeFormat) — shared by image + video paths
  - src/engine/thumbnails/cache.ts (cachePathFor / sentinelPathFor / partialPathFor / writeAtomic / computeETag / isCacheFresh / writeFailedSentinel / invalidateCache)
  - src/engine/thumbnails/image-thumbnail.ts (generateImageThumbnail / getImageBrightness / getSharpForVideoReencode / __resetSharpStateForTests) — sole sharp importer
  - THUMBNAIL_FAILED ErrorCode in src/engine/errors.ts
  - 5 directory-level architecture-purity guards on src/engine/thumbnails/
  - PITFALL G multi-encoding leak-scan extension (.thumb.webp + .thumb.failed in 4 encodings)
affects:
  - 17-02-video-thumbnails  # imports format-router.ts + getSharpForVideoReencode + cache helpers
  - 17-03-engine-facade-integration  # uses generateImageThumbnail + cache helpers + invalidateCache for engine.generateThumbnail / invalidateThumbnail
  - 17-04-http-route-and-dashboard  # consumes engine.generateThumbnail surface

tech-stack:
  added:
    - sharp@^0.34.5 (libvips-backed image processing; sole importer in src/engine/thumbnails/image-thumbnail.ts)
  patterns:
    - lazy-native-binding (mirrors Phase 14 c2pa-node signer.ts) — await import('sharp') with monotonic fail; cachedSharpFailed short-circuits subsequent calls
    - first-load tuning (PITFALL B + F) — sharp.concurrency(2) + sharp.cache(false) set ONCE on first successful module load
    - atomic write via writeAtomic helper — nanoid(8)-suffixed temp path, rename on success, best-effort unlink on writer/rename failure
    - ETag derivation (D-06) — sha256: strong validator preferred, mtime: short-hash fallback
    - sentinel-path freshness check (D-07) — .thumb.failed mtime suppresses retry until source mtime advances
    - sole-importer architecture-purity (D-23 / D-25) — sorted-array deepEqual subset+SET-equality
    - multi-encoding leak-scan extension (PITFALL G) — UTF-8 + UTF-16LE + UTF-16BE + base64 over thumb cache + sentinel surfaces

key-files:
  created:
    - src/engine/thumbnails/format-router.ts (82 lines)
    - src/engine/thumbnails/cache.ts (224 lines)
    - src/engine/thumbnails/index.ts (39 lines)
    - src/engine/thumbnails/image-thumbnail.ts (209 lines)
    - src/engine/thumbnails/__tests__/format-router.test.ts (152 lines, 16 tests)
    - src/engine/thumbnails/__tests__/cache.test.ts (312 lines, 22 tests)
    - src/engine/thumbnails/__tests__/image-thumbnail.test.ts (294 lines, 10 tests)
  modified:
    - package.json (sharp dep alphabetical position)
    - package-lock.json
    - src/engine/errors.ts (THUMBNAIL_FAILED ErrorCode)
    - src/__tests__/architecture-purity.test.ts (sharp allowed-set + 5 directory guards = 6 new tests)
    - src/__tests__/c2pa-key-leak-negative.test.ts (Phase 17 PITFALL G multi-encoding scan = 1 new test)

key-decisions:
  - "Engine facade integration deferred to Plan 17-03 — Plan 17-01 ships ONLY the engine-side primitives + the architectural-invariant tests that pin them"
  - "Plan 17-02's @ffmpeg-installer/ffmpeg allowed-set extension is deliberately NOT pre-empted (D-25 SAME-plan rule); inline marker comment notes the intentional gap"
  - "TS-quirk: typeof import('sharp')['default'] doesn't surface as a static type alias because sharp uses CJS-style export = sharp; resolved via async helper + Awaited<ReturnType<...>> wrapper. Runtime mod.default works correctly via Node's CJS-interop dynamic import."

patterns-established:
  - "Phase-17 thumbnail module shape: 4 production files (format-router / cache / image-thumbnail / index barrel) + 3 test files; Plan 17-02 adds video-thumbnail.ts as the sole @ffmpeg-installer/ffmpeg importer in parallel"
  - "Architecture-purity SAME-plan rule (D-25): the allowed-set test extension lands in the SAME plan that introduces the import — no orphaned imports between plans"
  - "Multi-encoding leak-scan extension: every new on-disk asset surface gets a Phase-17-style assertNotInBuffer test in the c2pa-key-leak-negative harness"

requirements-completed: [VIS-01, VIS-02]

duration: ~9min
completed: 2026-05-01
---

# Phase 17 Plan 01: Thumbnail Module Foundation Summary

**Engine-layer thumbnail primitives — pure format router, sole-importer sharp wrapper for image derivation, FS cache helpers (path / atomic-write / ETag / sentinel / invalidate), and the architecture-purity allowed-set extension that locks sharp into a single importer in the SAME plan that introduces the import.**

## Performance

- **Duration:** ~9 min (commit timestamps: 20:49:07 → 20:58:03 PT)
- **Started:** 2026-05-02T03:49:07Z (UTC)
- **Completed:** 2026-05-02T03:58:30Z (UTC)
- **Tasks:** 3 (1 module foundation, 1 TDD sole-importer, 1 architecture-invariant tests)
- **Files modified/created:** 12 (4 production + 3 unit tests + 2 cross-cutting test extensions + package.json + package-lock.json + errors.ts)

## Sharp Install Verification

- **Version installed:** `sharp@0.34.5` (pinned at `^0.34.5`)
- **Platform binary observed:** `node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node` (Apple Silicon — Timothy's dev machine)
- **Bundled libvips:** `node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib`

## Accomplishments

- **D-23 LOCKED:** sharp imports allowed-set = {`src/engine/thumbnails/image-thumbnail.ts`} via sorted-array deepEqual subset + SET-equality two-layer assertion (matches Phase 14 c2pa-node block shape verbatim).
- **D-25 LOCKED:** the allowed-set extension landed in the SAME plan that introduces the sharp import — no orphaned imports between plans. Plan 17-02 will add the parallel `@ffmpeg-installer/ffmpeg` block when video-thumbnail.ts is introduced.
- **D-26 LOCKED:** lazy `await import('sharp')` with monotonic fail; cachedSharpFailed short-circuits subsequent getSharp() calls. Server boot succeeds without the sharp native binding (verified via vi.doMock test).
- **D-22 LOCKED:** atomic temp+rename via `nanoid(8).partial`; no `.partial` files survive a successful write OR a writer-side throw (vitest readdir assertion).
- **D-06 LOCKED:** `computeETag` prefers `sha256:` strong validator from `outputs_json[0].sha256` when present, falls back to `mtime:<16-char-hex>` short-hash.
- **D-07 LOCKED:** `.thumb.failed` sentinel suppresses retry until source mtime advances; `isCacheFresh` checks both cache + sentinel mtimes against source mtime.
- **PITFALL B + F LOCKED:** `sharp.concurrency(2)` and `sharp.cache(false)` set ONCE on first successful load — verified by `vi.spyOn` asserting exactly 1 call each across multiple `getSharpForVideoReencode()` invocations.
- **PITFALL G LOCKED:** multi-encoding leak scan (UTF-8 + UTF-16LE + UTF-16BE + base64) extended to `.thumb.webp` + `.thumb.failed` cache surfaces. The new `assertNotInBuffer` helper covers all 4 encodings; sentinel file size assertion locks the zero-byte hygiene contract structurally.

## Task Commits

Each task was committed atomically:

1. **Task 1: package.json + errors.ts + format-router + cache + tests** — `5b95602` (feat)
2. **Task 2 RED: failing tests for image-thumbnail** — `3c21563` (test)
3. **Task 2 GREEN: implement image-thumbnail (sole sharp importer)** — `1c2064e` (feat)
4. **Task 3: arch-purity allowed-set + multi-encoding leak-scan extension** — `c23191f` (test)

_Note: Task 2 followed RED/GREEN TDD cycle — separate test commit before implementation commit._

## Files Created/Modified

### Production code

- `src/engine/thumbnails/format-router.ts` (82 lines) — pure `routeFormat(filename)` returning discriminated union `{mode:'image'|'video'|'unsupported',...}`. PNG/JPG/JPEG/WebP/TIF/TIFF → image; MP4 → video; everything else → unknown-extension.
- `src/engine/thumbnails/cache.ts` (224 lines) — `cachePathFor` / `sentinelPathFor` / `partialPathFor` / `writeAtomic` / `computeETag` / `isCacheFresh` / `writeFailedSentinel` / `invalidateCache` pure-ish helpers. EXDEV note in header comment explains why no copyFile fallback (partial+final co-located).
- `src/engine/thumbnails/image-thumbnail.ts` (209 lines) — sole sharp importer (D-23). Exports `generateImageThumbnail` (640×360 fit:'inside' WebP q=80 via `cache.writeAtomic`), `getImageBrightness` (BT.601 luma via `sharp.stats()`), `getSharpForVideoReencode` (Plan 17-02 surface returning the cached sharp instance), and `__resetSharpStateForTests` (vi.doMock test hook).
- `src/engine/thumbnails/index.ts` (39 lines) — barrel re-exports.

### Tests (engine-side)

- `src/engine/thumbnails/__tests__/format-router.test.ts` — 16 numbered tests covering image (PNG/JPG/JPEG/WebP/TIF/TIFF) + video (MP4) + unsupported (EXR/PSD/empty/no-ext) + case-insensitivity + discriminated-union exhaustiveness.
- `src/engine/thumbnails/__tests__/cache.test.ts` — 22 numbered tests covering path derivation, atomic write success + failure cleanup, ETag sha256/mtime branches, ETag stability across same-mtime reads, ETag advancement after `utimes()` (+5s), `isCacheFresh` cache/sentinel/miss states, sentinel zero-byte hygiene, idempotent invalidation.
- `src/engine/thumbnails/__tests__/image-thumbnail.test.ts` — 10 tests covering end-to-end thumbnail derivation (≤640×360, source aspect preserved, file non-empty), atomic-write invariants on success + failure (no `.partial` leaks), sharp tuning called once (concurrency(2) + cache(false)), monotonic fail (D-26), BT.601 luma brightness (D-29 threshold reference), `getSharpForVideoReencode` delegate, D-23 sole-sharp-importer grep gate.

### Cross-cutting tests

- `src/__tests__/architecture-purity.test.ts` (+95 lines) — 6 new tests:
  1. `sharp imports are centralized in src/engine/thumbnails/image-thumbnail.ts (D-23)` — two-layer subset + SET-equality assertion via grep + sorted-array deepEqual
  2-6. Five directory-level guards on `src/engine/thumbnails/` for `@modelcontextprotocol/sdk`, `better-sqlite3`, `drizzle-orm`, `hono`, `@hono/node-server`
- `src/__tests__/c2pa-key-leak-negative.test.ts` (+92 lines) — 1 new test:
  - `Test 10 — Phase 17 thumb.webp + thumb.failed scan covers UTF-8 + UTF-16LE + UTF-16BE + base64`. Generates a 32-byte random hex sentinel, drives `generateImageThumbnail` against a tiny PNG, scans the resulting WebP bytes in 4 encodings via the new `assertNotInBuffer` helper. Confirms `.thumb.failed` size === 0.

## Architecture-Purity Assertions Added

| Assertion                                          | Target                                                       | Shape                                       |
|----------------------------------------------------|--------------------------------------------------------------|---------------------------------------------|
| sharp allowed-set (D-23)                           | `src/engine/thumbnails/image-thumbnail.ts`                   | sorted-array deepEqual subset+SET-equality  |
| zero @modelcontextprotocol/sdk                     | `src/engine/thumbnails/`                                     | grepCount === 0                             |
| zero better-sqlite3                                | `src/engine/thumbnails/`                                     | grepCount === 0                             |
| zero drizzle-orm                                   | `src/engine/thumbnails/`                                     | grepCount === 0                             |
| zero hono (robust regex)                           | `src/engine/thumbnails/`                                     | grep -rE returns empty                      |
| zero @hono/node-server                             | `src/engine/thumbnails/`                                     | grepCount === 0                             |

## Multi-Encoding Leak-Scan Extension

**Test file:** `src/__tests__/c2pa-key-leak-negative.test.ts`
**Test name:** `Test 10 — Phase 17 thumb.webp + thumb.failed scan covers UTF-8 + UTF-16LE + UTF-16BE + base64`
**New helper:** `assertNotInBuffer(buf, sentinel, label)` scans for `sentinel` in 4 encodings:
1. **UTF-8 raw:** the hex sentinel string verbatim (latin1 substring match)
2. **UTF-16LE:** `Buffer.from(sentinel, 'utf16le').toString('latin1')` substring match
3. **UTF-16BE:** byte-pair-swap of the UTF-16LE encoding then `.toString('latin1')` substring match
4. **base64:** `Buffer.from(sentinel).toString('base64')` substring match

**Sentinel:** 32-byte random-bytes → hex string (non-textual marker; WebP re-encoding does NOT preserve any visual rendering).

**Verification grep:** `grep -n "thumb.webp\|thumb.failed" src/__tests__/c2pa-key-leak-negative.test.ts` returns 6 matches (well above the ≥ 2 threshold from the plan).

## Test Count Delta

| Suite                                              | Before this plan         | After this plan          | Δ          |
|----------------------------------------------------|--------------------------|--------------------------|------------|
| `src/__tests__/architecture-purity.test.ts`        | 35                       | 41                       | +6         |
| `src/__tests__/c2pa-key-leak-negative.test.ts`     | 9                        | 10                       | +1         |
| `src/engine/thumbnails/__tests__/` (new)           | 0                        | 48 (16 + 22 + 10)        | +48        |
| **Root-suite total (passing)**                     | 1397 (from stashed run)  | 1404                     | **+55 net new test cases (only 7 of which surface as new "passing" deltas because the rest are inside the new test files which add to the file count)** |

**Pre-existing baseline check:** 20 pre-existing v1.1-audit ROADMAP-shape failures (in `phase-attribution.test.ts` + `requirements-cohort-closure.test.ts` + `validation-flags.test.ts`) — UNCHANGED by Plan 17-01. Verified by stash/unstash cycle: pre-stash run = 20 fail / 1397 pass / 1420 total; post-Task-3 = 20 fail / 1404 pass / 1427 total.

(Note: the plan's verification line says "the 4 pre-existing v1.1-audit pre-existing failures noted in STATE.md remain unchanged" — STATE.md captured 4-failure baseline at Phase 16 start; the 20-failure count we see now reflects audit-test additions across Phases 13-16. None are introduced by Plan 17-01.)

## Decisions Made

- **Engine facade integration deferred to Plan 17-03.** Plan 17-01's scope is engine-side primitives + the architectural-invariant tests that pin them. The `Engine.generateThumbnail` / `Engine.invalidateThumbnail` / `thumbnailMutex` work lands in 17-03. This keeps the plan tight (3 tasks, ~9 minutes) and lets the cross-cutting arch-purity test land in the same plan as the new sharp import (D-25).
- **`@ffmpeg-installer/ffmpeg` allowed-set extension deliberately NOT pre-empted in this plan.** Plan 17-02 introduces video-thumbnail.ts AND the ffmpeg arch-purity assertion in the SAME plan (D-25 SAME-plan rule). Inline marker comment in `architecture-purity.test.ts` documents the intentional gap.
- **Sharp TS-type-quirk:** sharp uses CJS-style `export = sharp`. With `module: NodeNext` + `esModuleInterop: true`, `await import('sharp')` returns `{ default: typeof sharp; cache; concurrency; ... }` at the value-level (Node CJS-interop default-synthesis), but `typeof import('sharp')['default']` does not resolve at the type-level alias. Resolved via an `async function inferSharpDefault()` helper + `Awaited<ReturnType<typeof inferSharpDefault>>` to capture the runtime-inferred type. Documented in image-thumbnail.ts header comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Vitest 4 reporter syntax**

- **Found during:** Task 1 (verification step)
- **Issue:** Plan's verify command used `--reporter=basic`, which Vitest 4 (project's installed version) does not export. The reporter loader threw `ERR_LOAD_URL`.
- **Fix:** Substituted `--reporter=default` (the project default). Same output level for our purposes.
- **Files modified:** None — only the bash command syntax for the verify step.
- **Verification:** Tests pass with the corrected flag.
- **Committed in:** N/A (bash-only fix; no code change)

**2. [Rule 3 — Blocking] Sharp TS-type alias quirk**

- **Found during:** Task 2 (GREEN typecheck)
- **Issue:** Initial type alias `type SharpDefaultExport = typeof import('sharp')['default']` failed `tsc --noEmit` with `Property 'default' does not exist on type 'typeof sharp'`. Sharp's `export = sharp` shape produces a value-level `.default` (via Node ESM CJS-interop) but no type-level `.default` member on the namespace alias.
- **Fix:** Replaced with an inferred type via async helper:
  ```typescript
  async function inferSharpDefault() {
    const mod = await import('sharp');
    return mod.default;
  }
  type SharpDefaultExport = Awaited<ReturnType<typeof inferSharpDefault>>;
  ```
  This goes through TS's value-level CJS-interop default-synthesis correctly. Documented in the file header.
- **Files modified:** `src/engine/thumbnails/image-thumbnail.ts`
- **Verification:** `tsc --noEmit` clean.
- **Committed in:** `1c2064e` (Task 2 GREEN commit)

**3. [Rule 3 — Blocking] Test 3 fixture choice for atomic-write cleanup**

- **Found during:** Task 2 (GREEN initial run — 9/10 pass)
- **Issue:** Test 3 originally tried to trigger sharp.toFile failure by writing to a destPath whose parent directory was missing, but `generateImageThumbnail`'s `mkdir(dirname(destPath), { recursive: true })` creates the parent first, so sharp.toFile succeeds and the test's `expect.rejects.toBeInstanceOf(TypedError)` failed.
- **Fix:** Changed Test 3 to point at a NON-EXISTENT source file (`does-not-exist.png`). Sharp throws ENOENT inside `.toFile()` → writeAtomic catch runs the unlink → throw wrapped as TypedError('THUMBNAIL_FAILED', reason='sharp_failed'). The atomic-write cleanup invariant still holds (no .partial leaks; no thumb.webp created on failure).
- **Files modified:** `src/engine/thumbnails/__tests__/image-thumbnail.test.ts`
- **Verification:** `npx vitest run src/engine/thumbnails/__tests__/image-thumbnail.test.ts` 10/10 pass.
- **Committed in:** `1c2064e` (Task 2 GREEN commit; bundled with the implementation per Rule 3 scope-boundary)

---

**Total deviations:** 3 auto-fixed (3 Rule 3 blocking — all direct consequences of plan-execution boundary issues; no scope creep)
**Impact on plan:** All three deviations are mechanical (vitest CLI flag, TS alias quirk, fixture choice for an `expect.rejects` test). None change the plan's intent or the deliverables.

## Issues Encountered

- **Sharp + c2pa-node co-bundling warning:** When running `c2pa-key-leak-negative.test.ts` (which now imports `generateImageThumbnail` for the leak-scan extension), the test process loads BOTH the project's `node_modules/@img/sharp-libvips-darwin-arm64@8.17.3` and c2pa-node's bundled `node_modules/c2pa-node/node_modules/@img/sharp-libvips-darwin-arm64@8.17.1`. Node's dyld emits a `Class GNotificationCenterDelegate is implemented in both ... .dylib` warning. This is a pre-existing concern (c2pa-node has bundled its own sharp since v0.5.x), not introduced by Plan 17-01. The 10 leak-scan tests still pass cleanly. **Out of scope for Plan 17-01.** Future plans (or a v1.3 dependency-hygiene task) may consider c2pa-node's bundling behavior as a candidate dependency-deduplication item.

## Next Phase Readiness

**Plan 17-02 (Video Thumbnails) UNBLOCKED:**
- Imports `routeFormat()` from `src/engine/thumbnails/format-router.ts` (the `mode: 'video'` branch is reachable but Plan 17-01 does not consume it).
- Imports `getSharpForVideoReencode()` from `src/engine/thumbnails/image-thumbnail.ts` to re-encode the ffmpeg-extracted PNG to WebP without duplicating the sharp import (preserves D-23 sole-importer invariant — video-thumbnail.ts MUST NOT import sharp directly).
- Imports `cachePathFor` / `sentinelPathFor` / `writeAtomic` / `writeFailedSentinel` from `src/engine/thumbnails/cache.ts` for the `<filename>.thumb.webp` / `<filename>.thumb.failed` cache paths.
- Imports `getImageBrightness()` for the D-29 black-frame brightness fallback (BT.601 luma threshold 16/255).
- Plan 17-02 MUST add the `@ffmpeg-installer/ffmpeg` allowed-set assertion in the same plan that introduces the import (D-25 SAME-plan rule). The inline marker comment at `src/__tests__/architecture-purity.test.ts` after the sharp block documents the intentional gap.

**Plan 17-03 (Engine facade integration) UNBLOCKED:**
- Engine surface lands here: `Engine.generateThumbnail(versionId, filename)` + `Engine.invalidateThumbnail(versionId, filename)` + `thumbnailMutex` (signMutex shape).
- Reads from `src/engine/thumbnails/cache.ts` cache layout AND error code `THUMBNAIL_FAILED` introduced in this plan.

**No blockers** for Plan 17-02 or Plan 17-03.

## TDD Gate Compliance

Plan-level gate:
- **Plan type:** `execute` (not `tdd`) — RED/GREEN/REFACTOR cycle is per-task at Task 2's discretion (`tdd="true"`), not plan-wide.

Per-task gate (Task 2):
- **RED commit:** `3c21563` — `test(17-01): add failing tests for image-thumbnail (RED)` ✓
- **GREEN commit:** `1c2064e` — `feat(17-01): implement image-thumbnail (sole sharp importer; D-23)` ✓ (lands AFTER RED)
- **REFACTOR commit:** None — no refactor needed; GREEN passes cleanly with the writeAtomic delegation already in place.

---

## Self-Check: PASSED

Verification (post-SUMMARY write):

- [x] `src/engine/thumbnails/format-router.ts` exists
- [x] `src/engine/thumbnails/cache.ts` exists
- [x] `src/engine/thumbnails/index.ts` exists
- [x] `src/engine/thumbnails/image-thumbnail.ts` exists
- [x] `src/engine/thumbnails/__tests__/format-router.test.ts` exists
- [x] `src/engine/thumbnails/__tests__/cache.test.ts` exists
- [x] `src/engine/thumbnails/__tests__/image-thumbnail.test.ts` exists
- [x] commit `5b95602` exists in git log
- [x] commit `3c21563` exists in git log
- [x] commit `1c2064e` exists in git log
- [x] commit `c23191f` exists in git log

---

*Phase: 17-visual-thumbnails*
*Plan: 01*
*Completed: 2026-05-01*
