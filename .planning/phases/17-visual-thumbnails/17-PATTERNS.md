# Phase 17: Visual Thumbnails - Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 25 (15 backend + 10 frontend, including 5 test files and 1 root package.json)
**Analogs found:** 24 / 25 (one file — `packages/dashboard/src/lib/thumbnail-queue.ts` — has no in-tree analog; reference impl ships in this map)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/engine/thumbnails/index.ts` | barrel export | re-export | `src/engine/c2pa/index.ts` | exact |
| `src/engine/thumbnails/format-router.ts` | utility (pure router) | transform | `src/engine/c2pa/format-router.ts` | exact |
| `src/engine/thumbnails/image-thumbnail.ts` | service (sole sharp importer) | file-I/O + transform | `src/engine/c2pa/signer.ts` (lazy native-binding) + `src/engine/output-downloader.ts` (atomic write) | role-match |
| `src/engine/thumbnails/video-thumbnail.ts` | service (sole ffmpeg importer) | file-I/O + transform + spawn | `src/engine/c2pa/signer.ts` (lazy native-binding) | role-match |
| `src/engine/thumbnails/cache.ts` | utility (FS path + ETag + atomic write) | file-I/O | `src/engine/output-downloader.ts:188-198` (atomic temp+rename) + `src/engine/c2pa/redaction.ts:740-749` (rename pattern) | role-match |
| `src/engine/pipeline.ts` (modify) | engine facade | request-response (coalescing) | same file lines 288-291 (`signMutex`) | exact (self-mirror) |
| `src/engine/c2pa/redaction.ts` (modify) | service hook | event (after-rename hook) | same file lines 740-749 (atomic rename block); engine facade pattern at `src/engine/output-downloader.ts:58-68` (`EngineForC2pa` Pick) | exact (one-line addition) |
| `src/http/dashboard-routes.ts` (modify) | controller (route) | request-response (HTTP) | same file lines 240-353 (`/output` GET+HEAD; `resolveOutputForVersion`; `X-C2PA-Signing-Status`) | exact (self-mirror) |
| `src/__tests__/architecture-purity.test.ts` (modify) | test (architectural invariant) | static analysis | same file lines 166-231 (`c2pa-node` allowed-set) | exact (self-mirror) |
| `package.json` (root, modify) | config | dep manifest | (no analog — dep add only) | n/a |
| `src/engine/thumbnails/__tests__/image-thumbnail.test.ts` | test (engine integration) | file-I/O fixture | `src/engine/c2pa/__tests__/signer.test.ts` shape (lazy-binding mock + atomic-write assertions) | role-match |
| `src/engine/thumbnails/__tests__/video-thumbnail.test.ts` | test (engine integration) | file-I/O + spawn fixture | `src/engine/c2pa/__tests__/signer.test.ts` shape | role-match |
| `src/engine/thumbnails/__tests__/cache.test.ts` | test (FS cache) | file-I/O | `src/engine/c2pa/__tests__/redaction.test.ts` shape | role-match |
| `src/engine/thumbnails/__tests__/format-router.test.ts` | test (pure router) | unit | `src/engine/c2pa/__tests__/format-router.test.ts` | exact |
| `src/__tests__/http/thumbnail-route.test.ts` | test (HTTP route) | request-response | (no co-located http test dir; analog: in-process Hono fetch from `src/__tests__/c2pa-dual-transport-parity.test.ts`) | role-match |
| `packages/dashboard/src/components/Thumbnail.tsx` | component (presentational) | request-response (img fetch) | `packages/dashboard/src/components/SkeletonThumbnail.tsx` (skeleton wrapper) + `packages/dashboard/src/components/VersionCard.tsx:52-59` (current `<img>` shape) | role-match |
| `packages/dashboard/src/components/C2paShield.tsx` | component (SVG icon) | none (presentational) | `packages/dashboard/src/components/C2paBadge.tsx` (predicate + accessibility shape) | role-match |
| `packages/dashboard/src/lib/thumbnail-queue.ts` | utility (concurrency limiter) | request-response | (no in-tree analog — reference impl below) | none |
| `packages/dashboard/src/__tests__/Thumbnail.test.tsx` | test (component) | unit | `packages/dashboard/src/__tests__/VersionCard.test.tsx` | exact |
| `packages/dashboard/src/__tests__/C2paShield.test.tsx` | test (component) | unit | `packages/dashboard/src/__tests__/C2paBadge.test.tsx` | exact |
| `packages/dashboard/src/components/VersionCard.tsx` (modify) | component (presentational) | request-response | same file lines 52-59 (current `<img>`) | exact (self-mirror) |
| `packages/dashboard/src/components/TreeSidebar.tsx` (modify) | component (presentational) | none | same file lines 215-229 (shot-row `TreeRow`) | exact (self-mirror) |
| `packages/dashboard/src/lib/api.ts` (modify) | utility (URL helpers) | request-response | same file lines 191-193 (`getOutputUrl`) | exact (self-mirror) |
| `packages/dashboard/src/components/SkeletonThumbnail.tsx` (modify) | component (presentational) | none | same file (no API change — width/height props already exist) | exact (self-mirror) |
| `packages/dashboard/package.json` (modify, possibly) | config | dep manifest | (no new deps per UI-SPEC §"Phase 17 npm dependencies"; verify only) | n/a |

**Note on `packages/dashboard/src/__tests__/` location:** Existing dashboard tests live at `packages/dashboard/src/__tests__/*.test.tsx`, NOT at `packages/dashboard/src/components/__tests__/`. The CONTEXT.md prompt incorrectly suggested the latter; this map corrects to match the actual codebase layout (verified: `Thumbnail.test.tsx` and `C2paShield.test.tsx` belong alongside `VersionCard.test.tsx`, `C2paBadge.test.tsx`, `TreeSidebar.test.tsx`).

---

## Pattern Assignments

### `src/engine/thumbnails/index.ts` (barrel export, re-export only)

**Analog:** `src/engine/c2pa/index.ts`

**Barrel shape — minimal re-exports** (lines 1-9 + 28-38 of analog):

```typescript
// Phase 14 / Plan 14-02 — engine-layer C2PA module barrel export.
//
// This file re-exports the public API surface of the three submodules.
// [...]
// Architecture-purity: zero non-c2pa imports. The c2pa-node import is
// confined to ./signer.ts; everything in the barrel is re-export only.

export {
  routeFormat,
  type FormatRoute,
  EMBED_BUFFER_FORMATS,
  EMBED_FILE_FORMATS,
  UNSUPPORTED_NATIVE_FORMATS,
} from './format-router.js';
```

**Pattern to mirror:** Header comment block calls out architecture-purity ("zero non-thumbnails imports; sharp + ffmpeg confined to image-thumbnail.ts / video-thumbnail.ts"); body is pure named re-exports from `./format-router.js`, `./image-thumbnail.js`, `./video-thumbnail.js`, `./cache.js`. Use `.js` extensions in import specifiers (ESM convention; matches every analog file).

---

### `src/engine/thumbnails/format-router.ts` (pure router)

**Analog:** `src/engine/c2pa/format-router.ts`

**Discriminated-union return type + pure exports** (lines 23-38, 84-102 of analog):

```typescript
// Pure function — no I/O, no side effects. Returns one of three routes:
//  - { mode: 'image', mimeType }       — PNG/JPEG/WebP/TIFF (sharp can decode)
//  - { mode: 'video', mimeType }       — MP4 (ffmpeg first-frame extraction)
//  - { mode: 'unsupported', reason }   — EXR/PSD/unknown
//
// Architecture-purity: zero external imports. zero MCP / DB / ORM / HTTP /
// sharp / ffmpeg imports. Pure-function module.

export type FormatRoute =
  | { mode: 'image'; mimeType: string }
  | { mode: 'video'; mimeType: string }
  | { mode: 'unsupported'; reason: 'unknown-extension' | 'native-handler-missing'; mimeType?: string };

const IMAGE_TABLE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

const VIDEO_TABLE: Record<string, string> = {
  '.mp4': 'video/mp4',
};

export function routeFormat(filename: string): FormatRoute {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return { mode: 'unsupported', reason: 'unknown-extension' };
  const ext = filename.slice(dot).toLowerCase();
  if (ext in IMAGE_TABLE) return { mode: 'image', mimeType: IMAGE_TABLE[ext]! };
  if (ext in VIDEO_TABLE) return { mode: 'video', mimeType: VIDEO_TABLE[ext]! };
  return { mode: 'unsupported', reason: 'unknown-extension' };
}
```

**Pattern to mirror:** Three-way discriminated union; case-insensitive extension lookup via `lastIndexOf('.')` + `.toLowerCase()`; const TABLE objects with explicit MIME strings; `null!`-bracket assertion in return because `ext in TABLE` narrows. Header comment declares architecture-purity invariants explicitly.

---

### `src/engine/thumbnails/image-thumbnail.ts` (sole sharp importer)

**Analogs:** `src/engine/c2pa/signer.ts:39-71` (lazy native-binding pattern) + `src/engine/output-downloader.ts:188-198` (atomic temp+rename) + RESEARCH.md Pattern 1 (lines 280-303)

**Lazy binding load with monotonic fail** (signer.ts:39-71):

```typescript
// c2pa-node native binding — loaded lazily (Concern #11).
type C2paNodeModule = typeof import('c2pa-node');
let c2paNodeModule: C2paNodeModule | null = null;
let c2paNodeLoadError: Error | null = null;

async function ensureC2paNode(): Promise<C2paNodeModule> {
  if (c2paNodeModule !== null) return c2paNodeModule;
  if (c2paNodeLoadError !== null) {
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `c2pa-node native binding unavailable: ${c2paNodeLoadError.message}`,
      'Install c2pa-node prebuilds for this platform, or run on a supported platform (macOS arm64/x64, Linux x64/arm64, Windows x64).',
    );
  }
  try {
    c2paNodeModule = await import('c2pa-node');
    return c2paNodeModule;
  } catch (err) {
    c2paNodeLoadError = err as Error;
    throw new TypedError(
      'C2PA_SIGNER_LOAD_FAILED',
      `c2pa-node native binding unavailable: ${(err as Error).message}`,
      'Install c2pa-node prebuilds for this platform, or run on a supported platform.',
    );
  }
}
```

**Atomic temp+rename via nanoid(8) suffix** (output-downloader.ts:184-198):

```typescript
if (result.signed !== null) {
  // Buffer mode — write signed bytes to UNIQUE partial path (Concern #9).
  // Use nanoid(8) for the per-call unique suffix; two concurrent writers
  // for the same versionId+filename will pick different partial paths
  // and rename to the same final path independently.
  const partialPath = `${destPath}.c2pa-signed.${nanoid(8)}.partial`;
  await writeFile(partialPath, result.signed, { mode: 0o644 });
  await renameWithFallback(partialPath, destPath);
}
```

**RESEARCH.md Pattern 1 — adapted for sharp** (lines 280-303 of 17-RESEARCH.md):

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

**Pattern to mirror:**
- Module-scoped `cachedSharp` + `cachedSharpFailed` (NOT `Error | null` like signer.ts; the thumbnail path returns `null` and writes a `.thumb.failed` sentinel instead of throwing — D-26).
- `await import('sharp')` inside try/catch.
- Set `concurrency(2)` and `cache(false)` ONCE on first successful load (Claude's-Discretion knob from CONTEXT.md).
- Monotonic-fail guard returns `null` on second+ call after first failure.
- Sharp pipeline: `.resize(640, 360, { fit: 'inside', withoutEnlargement: true })` (D-04: source aspect, no padding) → `.webp({ quality: 80 })` (D-03) → `.toFile(tempPath)` → atomic `rename(tempPath, cachePath)` with `nanoid(8)` suffix on the partial.
- Failure path: `await writeFile('${cachePath}.failed', '')` sentinel (D-07) and emit structured warning log.

---

### `src/engine/thumbnails/video-thumbnail.ts` (sole ffmpeg importer)

**Analog:** Same lazy-binding shape as `image-thumbnail.ts` above (mirrors `src/engine/c2pa/signer.ts:39-71`); spawn pattern from RESEARCH.md Pattern 6 (lines 377-418).

**RESEARCH.md Pattern 6 — ffmpeg + brightness fallback** (key excerpt):

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

**Pattern to mirror:**
- Lazy-load `@ffmpeg-installer/ffmpeg` via `await import('@ffmpeg-installer/ffmpeg')` to retrieve the binary `path` (mirrors signer.ts:60-62 shape; monotonic fail returns null).
- Pre-flight 100 MB source-size hard-skip BEFORE spawning ffmpeg (D-30 + PITFALLS #6 OOM).
- 10s timeout via `setTimeout(() => proc.kill('SIGKILL'), 10_000)` around the spawn promise.
- `-vf thumbnail` filter for representative frame; brightness check via `sharp(...).stats()` luma calculation; 1.0s `-ss BEFORE -i` fast-seek fallback when luma < 16/255.
- Two-stage write: ffmpeg → temp PNG, sharp re-encode → temp WebP, atomic `rename(tempWebp, finalPath)`. Best-effort `unlink(tempPng).catch(() => {})` on cleanup.
- Failure path mirrors image-thumbnail.ts: `.thumb.failed` sentinel + structured warning log; never throws.

**CRITICAL:** This file MUST also lazy-import sharp (for the re-encode step). Per D-23 architecture-purity, this routes through a function call into `image-thumbnail.ts`'s `getSharp()` helper, NOT a direct `await import('sharp')` here. The video-thumbnail file is the SOLE `@ffmpeg-installer/ffmpeg` importer — sharp lives in image-thumbnail.ts only. Implementation: export `getSharpForVideoReencode()` from `image-thumbnail.ts` and call it from `video-thumbnail.ts`.

---

### `src/engine/thumbnails/cache.ts` (FS path + ETag + atomic helpers)

**Analogs:** `src/engine/output-downloader.ts:184-198, 219-229` (atomic write + EXDEV note) + `src/engine/c2pa/redaction.ts:740-749` (atomic rename block) + RESEARCH.md Pattern 4 (lines 357-368)

**Atomic rename block from redaction.ts:740-749:**

```typescript
const {
  writeFile: atomicWriteFile,
  rename: atomicRename,
  unlink: atomicUnlink,
} = await import('node:fs/promises');
const { nanoid: nanoidFn } = await import('nanoid');
const tempPathFresh = `${fullPath}.redact-tmp-${nanoidFn()}`;
try {
  await atomicWriteFile(tempPathFresh, redactedBytes);
  await atomicRename(tempPathFresh, fullPath);
} catch (err) {
  // Best-effort cleanup of temp file on failure.
  try { await atomicUnlink(tempPathFresh); } catch { /* ignore */ }
  throw new TypedError(
    'REDACT_DB_WRITE_FAILED',
    [...]
  );
}
```

**ETag derivation — RESEARCH.md Pattern 4** (lines 357-368):

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

**Pattern to mirror:**
- Pure path helpers: `cachePathFor(outputRoot, versionId, filename) → string`, `sentinelPathFor(...)`, `partialPathFor(...) → uses nanoid(8)`.
- Atomic write API: `writeAtomic(finalPath, bytes) → temp+rename` mirrors redaction.ts pattern verbatim (top-of-file `node:fs/promises` + `nanoid` static imports — they're not native bindings, so static is fine).
- `computeETag(sourcePath, sha256?)` — prefer `sha256:` strong validator from `outputs_json[0].sha256`, fall back to `mtime:` short-hash. Quoted per HTTP RFC.
- `isCacheFresh(cachePath, sentinelPath, sourceMtime) → boolean` — checks both `.thumb.webp` and `.thumb.failed`; returns false if sourceMtime > cache mtime (D-07 retry-on-source-change).
- Sentinel write: `writeFailedSentinel(sentinelPath)` → `await writeFile(sentinelPath, '')` (zero-byte marker; the file's mtime carries the "when failed" semantic).
- Idempotent unlink: `await unlink(path).catch(() => {})` (matches output-downloader.ts:226-227 EXDEV-fallback shape — wrap with try/catch on `ENOENT`).

**EXDEV note (output-downloader.ts:219-229):** Cache writes live under the same `outputRoot/versionId/` parent as the source file — partial and final co-located, so `EXDEV` is structurally impossible. **Do NOT add a copyFile fallback** for thumbnail writes; this would be dead code. The output-downloader's `renameWithFallback` is justified because c2pa temp files live under `outputsDir/.tmp-c2pa/`; the thumbnail cache never crosses that boundary.

---

### `src/engine/pipeline.ts` (modify — add `generateThumbnail` + `invalidateThumbnail` + `thumbnailMutex`)

**Analog:** Same file lines 288-291 (`signMutex` shape) — STRUCTURALLY IDENTICAL to the new `thumbnailMutex`. **NOT** the FIFO `assetWriterMutex` at lines 294-380.

**`signMutex` shape — exact pattern to mirror** (pipeline.ts:288-291):

```typescript
private readonly signMutex = new Map<
  string,
  Promise<{ signed: Buffer | null; signedToPath: string | null; alreadySigned?: boolean }>
>();
```

The surrounding doc comment (lines 280-287) makes the coalescing semantics explicit:

```typescript
   * Cleared on settle (try/finally). The mutex is in-process only — multi-
   * process coordination is out-of-scope for v1.1 (single-server design).
   *
   * Threat model: T-15-06 — bounded growth. Each entry lives until the
   * promise settles. Recovery-poller storms cannot leak entries; settle
   * cleanup is unconditional.
```

**RESEARCH.md Pattern 2 — generateThumbnail facade** (lines 311-327):

```typescript
private readonly thumbnailMutex = new Map<
  string,
  Promise<{ filePath: string; contentType: string; etag: string } | null>
>();

async generateThumbnail(versionId: string, filename: string): Promise<{ filePath: string; contentType: string; etag: string } | null> {
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

**`invalidateThumbnail` — pure delegation:**

```typescript
async invalidateThumbnail(versionId: string, filename: string): Promise<void> {
  // Delegate to thumbnails/cache.ts — pure idempotent FS unlink.
  // No mutex acquire here: the caller (redactManifestForVersion) already
  // holds assetWriterMutex on this key, and invalidate is idempotent.
  const { invalidateCache } = await import('./thumbnails/cache.js');
  await invalidateCache(this.outputRoot, versionId, filename);
}
```

**Pattern to mirror:**
- New `thumbnailMutex: Map<string, Promise<...>>` declared alongside `signMutex` (line 288-291) and `assetWriterMutex` (line 317). Use the SAME `${versionId}::${filename}` key composition.
- `generateThumbnail` uses **coalescing** semantics (signMutex shape — return existing in-flight Promise on key match). NOT FIFO. Pure derivation from immutable bytes is safe to coalesce.
- Delete-on-settle in `try/finally` (matches signMutex doc comment lines 281-287 explicitly).
- `invalidateThumbnail` does NOT take the mutex (called from inside redact, which already holds `assetWriterMutex`); pure delegation to cache.ts.
- `deriveThumbnail` (private helper) routes via format-router → `image-thumbnail.ts` or `video-thumbnail.ts` based on `routeFormat(filename).mode`.

---

### `src/engine/c2pa/redaction.ts` (modify — call `engine.invalidateThumbnail` AFTER atomic rename)

**Analog:** Same file lines 740-749 (the atomic rename block); structural Pick pattern from `src/engine/output-downloader.ts:48-68` (the `EngineForC2pa` shape).

**Engine surface as structural Pick — output-downloader.ts:48-68:**

```typescript
/**
 * Phase 14 (PROV-V-01) — minimal Engine surface needed by the downloader.
 *
 * Structural pick rather than a hard import on the Engine class: the
 * downloader is engine-aware ONLY at the type level so the architecture
 * boundary stays composition-friendly and tests can pass a stub engine
 * without instantiating the full Engine facade.
 *
 * The contract is precisely the Plan 14-03 Task 2 signOutput method's
 * shape — see Engine.signOutput in src/engine/pipeline.ts.
 */
export type EngineForC2pa = {
  signOutput(
    versionId: string,
    filename: string,
    input: { bytes: Buffer } | { filePath: string },
  ): Promise<{
    signed: Buffer | null;
    signedToPath: string | null;
    alreadySigned?: boolean;
  }>;
};
```

**Insertion point — redaction.ts:740-749 (the atomic rename + ONE new line AFTER):**

```typescript
const tempPathFresh = `${fullPath}.redact-tmp-${nanoidFn()}`;
try {
  await atomicWriteFile(tempPathFresh, redactedBytes);
  await atomicRename(tempPathFresh, fullPath);
  // ↓ NEW — Phase 17 D-05: invalidate thumbnail cache AFTER rewrite lands on disk.
  // Idempotent unlink of <fullPath>.thumb.webp + <fullPath>.thumb.failed.
  // engine surface is the structural Pick — see EngineForC2paRedaction below.
  await engine.invalidateThumbnail(versionId, filename);
} catch (err) {
  // [...existing catch — UNCHANGED]
}
```

**Pattern to mirror:**
- Add a NEW structural-Pick type `EngineForC2paRedaction` (or extend the existing `RedactionEngineSurface` if one is already in this file's signature) with `invalidateThumbnail(versionId: string, filename: string): Promise<void>`.
- The single new line `await engine.invalidateThumbnail(versionId, filename);` lands AFTER `atomicRename` succeeds, INSIDE the try block (so a failed atomic-rename does NOT trigger a stale-thumb invalidate). If invalidate itself throws, swallow to a console.warn and continue (the redact succeeded; a stale thumb at worst returns one outdated 304 until the user navigates away — degraded but non-fatal).
- The hook calls into the engine FACADE (`engine.invalidateThumbnail`), NOT directly into `src/engine/thumbnails/cache.ts`. This keeps c2pa-module's allowed-import set unchanged (no `from '../thumbnails/...'`).
- Phase 14 sign hook does NOT need invalidation: sign happens at download time, before any dashboard read, so no cached thumb exists yet to invalidate (D-05 explicit).

---

### `src/http/dashboard-routes.ts` (modify — add `GET` + `HEAD /api/versions/:id/thumbnail`)

**Analog:** Same file lines 240-353 — `/output` GET + HEAD; `resolveOutputForVersion` helper; `X-C2PA-Signing-Status` header pattern. Self-mirror.

**`resolveOutputForVersion` — full helper to mirror** (lines 256-316):

```typescript
function resolveOutputForVersion(versionId: string): {
  filename: string;
  contentType: string;
  filePath: string;
} {
  const version = engine.getVersion(versionId); // throws VERSION_NOT_FOUND → 404

  const raw = version.entity.outputs_json;
  let parsed: Array<{ filename?: string }> = [];
  if (raw) {
    try {
      const maybe = JSON.parse(raw);
      parsed = Array.isArray(maybe) ? (maybe as Array<{ filename?: string }>) : [];
    } catch {
      parsed = [];
    }
  }
  if (parsed.length === 0 || !parsed[0]?.filename) {
    throw new TypedError(
      'OUTPUT_UNAVAILABLE',
      `No outputs recorded for version '${versionId}'`,
      'The output file may not have been downloaded. Use Reproduce Version to regenerate.',
    );
  }

  const storedFilename = parsed[0].filename;
  // T-5-04: reject filenames containing path separators or traversal sequences
  if (
    storedFilename.includes('..') ||
    storedFilename.includes('/') ||
    storedFilename.includes('\\')
  ) {
    throw new TypedError(
      'INVALID_INPUT',
      `Invalid output filename '${storedFilename}' — contains path separator or traversal sequence`,
      'This is a bug or tampering attempt. Check the version record.',
    );
  }
  const filename = path.basename(storedFilename);

  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

  // SC-2: resolve against engine.outputRoot, not hardcoded literal.
  const filePath = path.resolve(engine.outputRoot, versionId, filename);
  if (!existsSync(filePath)) {
    throw new TypedError(
      'OUTPUT_UNAVAILABLE',
      `Output file missing from disk: ${filename}`,
      'The output file is missing. Provenance is still viewable. Use Reproduce Version to regenerate.',
    );
  }

  return { filename, contentType, filePath };
}
```

**`/output` GET + HEAD shape to mirror** (lines 318-353):

```typescript
app.get('/api/versions/:id/output', (c) => {
  const versionId = c.req.param('id');
  const { filename, contentType, filePath } = resolveOutputForVersion(versionId);
  const signingStatus = resolveSigningStatus(versionId, filename);

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return c.body(webStream, 200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600, immutable',
    'X-C2PA-Signing-Status': signingStatus,
  });
});

app.on('HEAD', '/api/versions/:id/output', (c) => {
  const versionId = c.req.param('id');
  const { filename, contentType } = resolveOutputForVersion(versionId);
  const signingStatus = resolveSigningStatus(versionId, filename);
  return c.body(null, 200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600, immutable',
    'X-C2PA-Signing-Status': signingStatus,
  });
});
```

**Pattern to mirror — `/thumbnail` route:**
- Reuse `resolveOutputForVersion(versionId)` to get `filename` + `filePath` + `contentType` (the SOURCE path; thumbnail derivation uses this as input).
- Pre-flight: `routeFormat(filename)` from thumbnails barrel. If `mode === 'unsupported'` → throw `TypedError('UNSUPPORTED_FORMAT', ...)` → 415 via existing typed-error middleware.
- Call `engine.generateThumbnail(versionId, filename)` (returns `{ filePath, contentType: 'image/webp', etag }` or `null`).
- ETag handling: read `If-None-Match` from request; compare against `etag` returned from engine; if match → return `c.body(null, 304, { ETag, 'Cache-Control': ... })`.
- `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable` (RESEARCH.md Pattern 5 recommendation; reconciled with `/output`'s `max-age=3600` precedent — Claude's-Discretion CONTEXT.md item: prefer the longer max-age because thumbnail ETag is strong and invalidates correctly on Phase 16 redact).
- `ETag: "<etag>"` header on every successful response (200 + 304 alike).
- HEAD variant: same headers, `c.body(null, 200, {...})`.
- 404 path when `engine.generateThumbnail` returns `null`: throw `TypedError('THUMBNAIL_FAILED', reason, recovery)` → 500 via typed-error middleware. Dashboard's onError handler swaps to skeleton (D-07 — silent fallback, no toast).

**Streaming choice:** Use `createReadStream(thumbFilePath) → Readable.toWeb(...)` like `/output:325-326` does. Thumbnails are 25-40 KB so a `readFile + c.body(buffer, ...)` would also work, but stream parity with `/output` keeps cognitive load low.

---

### `src/__tests__/architecture-purity.test.ts` (modify — add sharp + ffmpeg blocks)

**Analog:** Same file lines 166-231 (`c2pa-node` allowed-set assertion). Self-mirror — sorted-array deepEqual.

**`c2pa-node` allowed-set block — exact shape** (lines 190-231):

```typescript
const allowedC2paNodeImporters = new Set<string>([
  'src/engine/c2pa/signer.ts',
  'src/engine/c2pa/exporter.ts', // D-CTX-7 reserves the slot
  'src/engine/c2pa/verifier.ts', // Plan 16-01 — lazy import('c2pa-node')
  'src/engine/c2pa/redaction.ts', // Plan 16-02 — lazy import('c2pa-node')
]);
let out = '';
try {
  out = execFileSync(
    'grep',
    [
      '-rlE',
      "from[[:space:]]*['\"]c2pa-node|import[[:space:]]*\\([[:space:]]*['\"]c2pa-node",
      'src/',
    ],
    { encoding: 'utf8' },
  );
} catch (err) {
  const status = (err as { status?: number }).status;
  if (status !== 1) throw err;
}
const files = out ? out.trim().split('\n').filter(Boolean) : [];
const nonTestFiles = files.filter((f) => !f.includes('__tests__/'));
// (a) Subset check — no rogue importer outside the allowed set.
const violations = nonTestFiles.filter((f) => !allowedC2paNodeImporters.has(f));
expect(
  violations,
  `c2pa-node imports outside the allowed list:\n${violations.join('\n')}`,
).toEqual([]);
// (b) SET-equality on the ACTUAL importers (sorted-array deepEqual).
const expectedActualImporters = [
  'src/engine/c2pa/signer.ts',
  'src/engine/c2pa/verifier.ts',
  'src/engine/c2pa/redaction.ts', // Plan 16-02 — lazy import('c2pa-node')
].sort();
expect([...nonTestFiles].sort()).toEqual(expectedActualImporters);
```

**Pattern to mirror — TWO new test blocks for sharp + ffmpeg:**

```typescript
// NEW — Phase 17 D-23 sharp purity
it('sharp imports are centralized in src/engine/thumbnails/image-thumbnail.ts (D-23)', () => {
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
  const violations = nonTestFiles.filter(f => !allowedSharpImporters.has(f));
  expect(violations, `sharp imports outside the allowed list:\n${violations.join('\n')}`).toEqual([]);
  const expectedActualImporters = ['src/engine/thumbnails/image-thumbnail.ts'].sort();
  expect([...nonTestFiles].sort()).toEqual(expectedActualImporters);
});

// NEW — Phase 17 D-24 @ffmpeg-installer/ffmpeg purity
it('@ffmpeg-installer/ffmpeg imports are centralized in src/engine/thumbnails/video-thumbnail.ts (D-24)', () => {
  const allowedFfmpegImporters = new Set<string>([
    'src/engine/thumbnails/video-thumbnail.ts',
  ]);
  // [...same shape: grep for @ffmpeg-installer/ffmpeg, subset + set-equality...]
});
```

**Plus directory-level guards** (mirroring lines 134-164 — the `src/engine/c2pa/` block):

```typescript
it('src/engine/thumbnails/ has zero imports from @modelcontextprotocol/sdk', () => {
  expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/thumbnails/')).toBe(0);
});
it('src/engine/thumbnails/ has zero imports from better-sqlite3', () => {
  expect(grepCount('better-sqlite3', 'src/engine/thumbnails/')).toBe(0);
});
it('src/engine/thumbnails/ has zero imports from drizzle-orm', () => {
  expect(grepCount('drizzle-orm', 'src/engine/thumbnails/')).toBe(0);
});
it('src/engine/thumbnails/ has zero imports from hono', () => { /*regex check*/ });
it('src/engine/thumbnails/ has zero imports from @hono/node-server', () => {
  expect(grepCount('@hono/node-server', 'src/engine/thumbnails/')).toBe(0);
});
```

**Multi-encoding leak scan extension** (CONTEXT.md "Claude's Discretion" — REQUIREMENTS.md cross-cutting constraint mentions thumbnail cache):

The existing leak-scan in this file (search for the test that scans for plaintext API keys / secrets in non-redacted paths) needs `.thumb.webp` and `.thumb.failed` patterns added to its allow-list / scan-target list. **Locate the existing leak-scan test** (likely in `src/__tests__/c2pa-key-leak-negative.test.ts` based on directory listing — verify in plan execution) and add:
- `.thumb.webp` paths to the encoding-leak scan target list
- `.thumb.failed` sentinel paths to the same scan
- Both should be scanned for any embedded plaintext that mirrors what the existing scan checks for source outputs.

---

### `package.json` (root, modify) — add deps

**No analog.** Pure dep manifest update. Per RESEARCH.md STACK pin and D-23/D-24:

```json
{
  "dependencies": {
    "sharp": "^0.34.5",
    "@ffmpeg-installer/ffmpeg": "^1.1.0"
  }
}
```

License posture (D-27 + RESEARCH.md): `@ffmpeg-installer/ffmpeg` ships LGPL-2.1 binary in a separate process (MIT-compatible). `sharp` is Apache-2.0 (MIT-compatible). NEITHER is `ffmpeg-static` (rejected — GPL-3.0-or-later viral).

---

### `src/engine/thumbnails/__tests__/image-thumbnail.test.ts` (engine integration test)

**Analog:** Existing engine integration tests under `src/engine/c2pa/__tests__/` follow the vitest `describe → it` shape with fixture inputs. Closest concrete shape: see `src/engine/c2pa/__tests__/redaction.test.ts:21-39` (header doc-block + STUB constants + helper factories).

**Pattern to mirror — file header + helper:**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Import the SUT — image-thumbnail.ts public surface.
import { generateImageThumbnail } from '../image-thumbnail.js';

const TINY_PNG_BYTES = Buffer.from([/* 4×4 PNG bytes — known fixture */]);

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'phase17-image-thumb-'));
}

describe('Plan 17 — image thumbnail generation', () => {
  it('encodes 640x360 WebP at quality 80 from a PNG source', async () => {
    const root = await makeTempDir();
    try {
      const sourcePath = join(root, 'source.png');
      const thumbPath = join(root, 'source.png.thumb.webp');
      await writeFile(sourcePath, TINY_PNG_BYTES);
      const result = await generateImageThumbnail(sourcePath, thumbPath);
      expect(result).not.toBeNull();
      const stats = await stat(thumbPath);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.size).toBeLessThan(50_000); // ~25-40 KB envelope
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes .thumb.failed sentinel on sharp failure', async () => { /* corrupt input */ });
  it('atomic rename — no partial file remains on success', async () => { /* glob *.partial */ });
});
```

**Pattern to mirror:** vitest + `mkdtemp` per-test temp dir + always-cleanup in `try/finally`. Assert on file existence, file size, and absence of `.partial` files (atomic-write invariant). Mock the lazy-binding when sharp itself is missing on the test runner (use `__resetSharpStateForTests()` mirror of `__resetC2paNodeStateForTests` from signer.ts:94-97).

---

### `src/engine/thumbnails/__tests__/video-thumbnail.test.ts` (engine integration test)

**Analog:** Same as image-thumbnail.test.ts. Plus PITFALLS-driven cases.

**Pattern to mirror:**
- Test 1: extract frame from a small known-good MP4 fixture (committed under `src/engine/thumbnails/__tests__/fixtures/tiny.mp4` — 1-second 256×144 H.264).
- Test 2: brightness fallback — feed an MP4 with a black first frame; assert the 1.0s seek path was taken (mock `spawnFfmpeg` and assert the second call had `-ss 1.0`).
- Test 3: pre-flight 100 MB skip — write a 100MB-sized stub file (use sparse file: `truncate -s 100M ...`) and assert `THUMBNAIL_FAILED:source_too_large` typed reason.
- Test 4: 10s timeout — mock `spawnFfmpeg` to never resolve; assert `THUMBNAIL_FAILED:ffmpeg_timeout` after 10s (use vitest's `vi.useFakeTimers()`).
- Test 5: failure → `.thumb.failed` sentinel written; subsequent call short-circuits.

---

### `src/engine/thumbnails/__tests__/cache.test.ts` (FS cache)

**Analog:** `src/engine/c2pa/__tests__/redaction.test.ts` shape.

**Pattern to mirror:**
- Test 1: `cachePathFor` + `partialPathFor` produce different paths (nanoid suffix differs across calls).
- Test 2: `writeAtomic` — temp file disappears after rename; final file matches input bytes.
- Test 3: `computeETag` — `sha256:` prefix when `outputs_json[0].sha256` provided; `mtime:` short-hash otherwise; ETag stable across calls when source mtime unchanged; ETag changes when source mtime advances by 1 second (`utimes(path, atime, mtime)` to force advance).
- Test 4: `isCacheFresh` returns false when source mtime > cache mtime (D-07 retry-on-source-change).
- Test 5: `invalidateCache` is idempotent — second call after first does NOT throw (`unlink ENOENT` swallowed).
- Test 6: sentinel skip-retry — when `.thumb.failed` exists with mtime ≥ source mtime, `isCacheFresh` returns true (don't retry); when source mtime advances, returns false (retry).

---

### `src/engine/thumbnails/__tests__/format-router.test.ts` (pure router)

**Analog:** `src/engine/c2pa/__tests__/format-router.test.ts` (lines 1-50 exactly mirror the test shape):

```typescript
import { describe, it, expect } from 'vitest';
import {
  routeFormat,
  type FormatRoute,
} from '../format-router.js';

describe('routeFormat — image formats', () => {
  it('Test 1: routeFormat(output.png) -> image image/png', () => {
    expect(routeFormat('output.png')).toEqual({ mode: 'image', mimeType: 'image/png' });
  });
  it('Test 2: routeFormat(OUTPUT.PNG) is case-insensitive on extension', () => {
    expect(routeFormat('OUTPUT.PNG')).toEqual({ mode: 'image', mimeType: 'image/png' });
  });
  // [... .jpg .jpeg .webp .tif .tiff ...]
});

describe('routeFormat — video formats', () => {
  it('routeFormat(render.mp4) -> video video/mp4', () => {
    expect(routeFormat('render.mp4')).toEqual({ mode: 'video', mimeType: 'video/mp4' });
  });
});

describe('routeFormat — unsupported', () => {
  it('routeFormat(file.exr) -> unsupported unknown-extension', () => { /* ... */ });
  it('routeFormat(no-extension) -> unsupported unknown-extension', () => { /* ... */ });
});
```

**Pattern to mirror:** Numbered test descriptions ("Test 1: ..." etc.), one expectation per `it`, `.toEqual()` against the full discriminated-union object, case-insensitive coverage in a dedicated test.

---

### `src/__tests__/http/thumbnail-route.test.ts` (HTTP route test)

**Note:** No `src/__tests__/http/` directory currently exists. The Phase 17 plan creates it. Closest in-tree analog: `src/__tests__/c2pa-dual-transport-parity.test.ts` (in-process Hono fetch via the test harness; reads response headers + body).

**Pattern to mirror:**
- Spin up the Hono app via `createDashboardRoutes(engine)` (existing factory in `src/http/dashboard-routes.ts`).
- Issue a `GET /api/versions/:id/thumbnail` against the in-process `app.request(...)` Hono testing API.
- Assert: 200 status, `Content-Type: image/webp`, `Cache-Control: public, max-age=...immutable`, `ETag: "..."`, body bytes start with `RIFF....WEBP` magic.
- Issue a second `GET` with `If-None-Match` set to the first response's `ETag` → assert 304 + same `ETag`.
- Issue `HEAD` → assert same headers, empty body.
- Issue `GET` for a version with `outputs_json[0].filename = 'source.exr'` → assert 415 (UNSUPPORTED_FORMAT).
- Issue `GET` for a version where engine.generateThumbnail returns `null` (sharp load failed mock) → assert 500 (THUMBNAIL_FAILED) + ensure body is the typed-error envelope (mirrors existing `OUTPUT_UNAVAILABLE` shape).

---

### `packages/dashboard/src/components/Thumbnail.tsx` (NEW component)

**Analogs:**
- `packages/dashboard/src/components/SkeletonThumbnail.tsx` (skeleton wrapper shape; aria-hidden+role=presentation)
- `packages/dashboard/src/components/VersionCard.tsx:52-59` (current `<img>` shape — the BEFORE state)
- `packages/dashboard/src/components/C2paBadge.tsx` (signed-state predicate pattern)
- 17-UI-SPEC.md §"`<Thumbnail/>` API contract" lines 181-237 (full contract)

**SkeletonThumbnail wrapper shape** (full file, 32 lines):

```typescript
export interface SkeletonThumbnailProps {
  width?: number;
  height?: number;
}

export function SkeletonThumbnail({
  width = 160,
  height = 90,
}: SkeletonThumbnailProps) {
  return (
    <div
      class="animate-skeleton-shimmer rounded"
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
      role="presentation"
    />
  );
}
```

**Current `<img>` shape from VersionCard.tsx:52-59 — the BEFORE state being replaced:**

```tsx
{version.status === 'complete' ? (
  <img
    src={getOutputUrl(version.id)}
    alt={`Output for ${version.label}`}
    class="block aspect-video w-full object-cover"
    loading="lazy"
  />
) : null}
```

**Pattern to mirror — `<Thumbnail/>` shape per UI-SPEC §"`<Thumbnail/>` API contract":**

```tsx
import { useState } from 'preact/hooks';
import { SkeletonThumbnail } from './SkeletonThumbnail.js';
import { C2paShield } from './C2paShield.js';
import { getThumbnailUrl } from '../lib/api.js';
import type { Status } from './StatusPill.js';

export type ThumbnailSize = 'card' | 'sm';

export interface ThumbnailVersion {
  id: string;
  filename?: string;
  status: Status;
  label: string;
}

export interface ThumbnailProps {
  version: ThumbnailVersion;
  size?: ThumbnailSize;
  c2paStatus?: { status: 'signed' } | { status: 'unsigned'; reason: string } | { status: 'unknown' };
  class?: string;
  ariaLabel?: string;
}

export function Thumbnail({
  version,
  size = 'card',
  c2paStatus,
  class: className,
  ariaLabel,
}: ThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const isComplete = version.status === 'complete';
  const showSkeleton = !isComplete || imgError;

  // Wrapper class matrix per UI-SPEC §"Dimensional contract"
  const wrapperClass = size === 'sm'
    ? 'relative block aspect-video flex-shrink-0 overflow-hidden rounded'
    : 'relative block aspect-video w-full overflow-hidden rounded';
  const wrapperStyle = size === 'sm' ? { width: '80px' } : undefined;

  if (showSkeleton) {
    const w = size === 'sm' ? 80 : 640;
    const h = size === 'sm' ? 45 : 360;
    return (
      <div
        class={`${wrapperClass} ${className ?? ''}`}
        style={wrapperStyle}
        aria-busy={!isComplete ? 'true' : undefined}
        aria-label={imgError
          ? `Preview unavailable for ${version.label}`
          : undefined}
      >
        <SkeletonThumbnail width={w} height={h} />
      </div>
    );
  }

  const shieldClass = size === 'sm'
    ? 'absolute right-1 bottom-1 h-3.5 w-3.5'
    : 'absolute right-1.5 bottom-1.5 h-5 w-5';
  const widthAttr = size === 'sm' ? 80 : 640;
  const heightAttr = size === 'sm' ? 45 : 360;

  return (
    <div class={`${wrapperClass} ${className ?? ''}`} style={wrapperStyle}>
      <img
        src={getThumbnailUrl(version.id)}
        alt={ariaLabel ?? `Output for ${version.label}`}
        class="block h-full w-full object-contain"
        loading="lazy"
        width={widthAttr}
        height={heightAttr}
        onLoad={() => setImgLoaded(true)}
        onError={() => setImgError(true)}
      />
      {c2paStatus?.status === 'signed' && <C2paShield class={shieldClass} />}
    </div>
  );
}
```

**Pattern to mirror:**
- Pure props-in/no-callback presentational component (mirrors VersionCard.tsx + SkeletonThumbnail.tsx — both pure).
- `useState` for `imgError` (browser onError fallback) and `imgLoaded` (aria-busy lifecycle). Two `useState` hooks total.
- `version.status === 'complete'` predicate gates the real `<img>` vs skeleton (matches VersionCard.tsx:52 verbatim).
- `c2paStatus?.status === 'signed'` predicate gates the shield (D-10 LOCKED).
- Explicit `width`/`height` HTML attributes on `<img>` for CLS=0 (UI-SPEC §"Lazy-load contract").
- `object-contain` (NOT `object-cover` — D-19 LOCKED).
- `loading="lazy"` on `<img>` (UI-SPEC §"Performance contract"; native browser-lazy, NO IntersectionObserver shim).
- NO click handler (UI-SPEC §"Click-target contract" — clicks bubble to parent VersionCard or TreeRow).
- Wrapper class logic per UI-SPEC §"Dimensional contract" Tailwind classes: `relative block aspect-video w-full overflow-hidden rounded` for `card`; `flex-shrink-0` + inline `width: 80px` for `sm`.

---

### `packages/dashboard/src/components/C2paShield.tsx` (NEW component)

**Analogs:**
- `packages/dashboard/src/components/C2paBadge.tsx` (predicate + accessibility shape; Phase 17 shield is SEPARATE — does NOT replace C2paBadge)
- 17-UI-SPEC.md §"`<C2paShield/>` API contract" lines 240-275 (full contract)

**C2paBadge accessibility + role pattern** (lines 71-82):

```tsx
export function C2paBadge({ status }: C2paBadgeProps) {
  if (status.status === 'signed') {
    return (
      <span
        class="c2pa-badge c2pa-badge-signed inline-flex items-center rounded-full bg-[var(--color-status-completed)] px-2 py-0.5 text-xs font-normal uppercase tracking-widest text-[var(--color-bg)]"
        role="status"
        aria-label="C2PA: signed"
        data-testid="c2pa-badge"
      >
        C2PA: signed
      </span>
    );
  }
  // [...]
}
```

**Pattern to mirror — `<C2paShield/>` per UI-SPEC §"`<C2paShield/>` API contract":**

```tsx
export interface C2paShieldProps {
  /** Optional class for sizing (default-fallback: h-5 w-5 = 20×20) */
  class?: string;
  /** Optional title shown via native browser tooltip on hover. Defaults to "Signed · Verified provenance" per D-11 */
  title?: string;
}

export function C2paShield({ class: className, title }: C2paShieldProps) {
  const label = title ?? 'Signed · Verified provenance';
  return (
    <svg
      class={className ?? 'h-5 w-5'}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      data-testid="c2pa-shield"
      style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.6))' }}
    >
      <title>{label}</title>
      {/* Adobe Content Credentials "CR" mark SVG path
          License: free for use to indicate Content Credentials per Adobe published guidance
          License-verification step: planner confirms terms before merging the SVG bytes
          Source: https://contentcredentials.org/icon */}
      <path d="..." fill="#FFFFFF" stroke="#1A1A1A" stroke-width="1.5" />
    </svg>
  );
}
```

**Pattern to mirror:**
- Pure presentational SVG component (mirrors C2paBadge.tsx structure but for SVG).
- `role="img"` (per UI-SPEC §"C2PA shield accessibility") — matches C2paBadge's `role="status"` philosophy: explicit ARIA role.
- `aria-label` + inner `<title>` element (D-11 — both for SR + native tooltip; UI-SPEC §"Render contract").
- `data-testid="c2pa-shield"` (mirrors C2paBadge's `data-testid="c2pa-badge"` line 78).
- Hard-coded `#FFFFFF` body / `#1A1A1A` stroke colors (NOT theme tokens — D-08 + UI-SPEC §"Color usage matrix"). Drop-shadow halo for legibility.
- Inline SVG path. **License verification gate before commit** — UI-SPEC §"External asset license verification" requires planner confirmation; if fails, fallback options listed there.
- NO interactive state, NO click handler, NO `tabindex`, NO independent focus ring (D-11 LOCKED).

---

### `packages/dashboard/src/lib/thumbnail-queue.ts` (NEW utility — concurrency limiter)

**No in-tree analog.** The dashboard's `lib/` directory has no existing concurrency-limiter utility (verified: `lib/api.ts` is the only existing helper module aside from theme + sse-event helpers; none implement queueing).

**Reference implementation per CONTEXT.md "Claude's Discretion" + RESEARCH.md PITFALLS #7:**

```typescript
// packages/dashboard/src/lib/thumbnail-queue.ts
//
// Browser-side concurrency limiter for thumbnail fetches. Caps in-flight
// thumbnail requests at 6 (matches HTTP/1.1 per-origin connection limit;
// HTTP/2 multiplexes but the explicit cap insures against the dashboard
// kicking off 200 simultaneous requests on first project load — would
// overwhelm the in-process Hono server's request queue).
//
// Architecture-purity: this file is browser-only — zero server imports.
// Pure FIFO queue + Promise pool — no external deps.

const MAX_CONCURRENT = 6;
const queue: Array<() => void> = [];
let inFlight = 0;

function release(): void {
  inFlight -= 1;
  const next = queue.shift();
  if (next) next();
}

export async function enqueueThumbnailFetch<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  inFlight += 1;
  try {
    return await fn();
  } finally {
    release();
  }
}
```

**Pattern to introduce:**
- Module-scoped FIFO queue + counter — pure, no class, no signal subscription.
- Single named export `enqueueThumbnailFetch`. Caller wraps `fetch(getThumbnailUrl(...))` in this.
- 6 = HTTP/1.1 per-origin TCP cap (RESEARCH.md PITFALLS #7). Defensive even on HTTP/2.

**Open question for planner:** Should this wrap the `<img>` `src=` mechanism (which the BROWSER schedules — we have no hook), or only fetch-helpers in `lib/api.ts`? The browser already has its own connection-pool throttling on the `<img loading="lazy">` mechanism. Recommendation: **introduce only if a measurable stampede appears** in load testing; ship Phase 17 without it if browser-native lazy + connection pooling proves sufficient. Document in PLAN as "implement if metrics demand; otherwise scope-defer."

---

### `packages/dashboard/src/__tests__/Thumbnail.test.tsx` (component test)

**Analog:** `packages/dashboard/src/__tests__/VersionCard.test.tsx` (full file, 53 lines — concrete shape):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { VersionCard } from '../components/VersionCard.js';

describe('VersionCard', () => {
  it('renders an <img> for completed versions pointing at /api/versions/:id/output', () => {
    render(
      <VersionCard
        version={{ id: 'ver_abc', label: 'v001', status: 'complete' }}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    const img = screen.getByAltText('Output for v001') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toMatch(/\/api\/versions\/ver_abc\/output$/);
  });

  it('omits <img> for non-completed versions (running/queued/failed)', () => {
    for (const status of ['running', 'queued', 'failed'] as const) {
      const { unmount } = render(
        <VersionCard
          version={{ id: 'ver_abc', label: 'v001', status }}
          isSelected={false}
          onSelect={vi.fn()}
        />,
      );
      expect(screen.queryByAltText('Output for v001')).toBeNull();
      unmount();
    }
  });
});
```

**Pattern to mirror — Thumbnail tests:**
- vitest + `@testing-library/preact` import block identical.
- Test 1: `version.status === 'complete'` + no shield → renders `<img>` with `src` matching `/api/versions/{id}/thumbnail` (use `screen.getByAltText('Output for v001')`).
- Test 2: status in {queued, running, failed} → no `<img>`; assert skeleton via `screen.queryByRole('presentation')` or `data-testid` if added.
- Test 3: `c2paStatus={{ status: 'signed' }}` → `<C2paShield data-testid="c2pa-shield">` is in DOM.
- Test 4: `c2paStatus` in {unsigned, unknown, undefined} → no shield in DOM (D-10 LOCKED — use `screen.queryByTestId('c2pa-shield')` returning null).
- Test 5: `<img onError>` fires → swap to skeleton + `aria-label="Preview unavailable for v001"` (UI-SPEC §"Render contract" image-load-error row).
- Test 6: `loading="lazy"` attribute is present on the `<img>` (CLS contract).
- Test 7: explicit `width` + `height` HTML attributes match the size variant (`card` → 640×360; `sm` → 80×45).
- Test 8: `size='sm'` wrapper has inline `width: 80px` style (UI-SPEC §"Dimensional contract").
- Test 9: `size='sm'` shield has `h-3.5 w-3.5` class; `size='card'` shield has `h-5 w-5` class.

---

### `packages/dashboard/src/__tests__/C2paShield.test.tsx` (component test)

**Analog:** `packages/dashboard/src/__tests__/C2paBadge.test.tsx` (full file, 134 lines).

**Pattern to mirror — C2paShield tests:**
- vitest + `@testing-library/preact` import block identical to C2paBadge.test.tsx:29-32.
- Test 1: renders by default with `data-testid="c2pa-shield"` present, `role="img"`, default `aria-label="Signed · Verified provenance"`.
- Test 2: custom `title="Custom"` prop sets both `aria-label` and inner `<title>` text content.
- Test 3: default class is `h-5 w-5` (no `class` prop given).
- Test 4: passing `class="h-3.5 w-3.5"` overrides default.
- Test 5: contains an `<svg>` element (not a `<span>` — distinguishes from C2paBadge).
- Test 6: contains a `<title>` child element (NOT just the `aria-label` attribute) — this is the spec-compliant browser-tooltip mechanism per UI-SPEC §"`<C2paShield/>` API contract" decision rules.
- Test 7: SVG `viewBox="0 0 24 24"` (matches lucide convention per UI-SPEC).
- Test 8 (accessibility): `role="img"` is set (mirrors C2paBadge.test.tsx:127-132 role/aria assertion).

---

### `packages/dashboard/src/components/VersionCard.tsx` (modify lines 52-59)

**Analog:** Same file's current `<img>` shape (the BEFORE state being replaced) — see VersionCard.tsx:40-67 above.

**BEFORE (lines 52-59 verbatim):**

```tsx
{version.status === 'complete' ? (
  <img
    src={getOutputUrl(version.id)}
    alt={`Output for ${version.label}`}
    class="block aspect-video w-full object-cover"
    loading="lazy"
  />
) : null}
```

**AFTER (per UI-SPEC §"Component Inventory" + D-19):**

```tsx
<Thumbnail
  version={{
    id: version.id,
    label: version.label,
    status: version.status,
  }}
  size="card"
  c2paStatus={c2paStatus}
/>
```

**Pattern to mirror — minimal swap:**
- Remove `import { getOutputUrl } from '../lib/api.js';` (line 21) IFF no longer used elsewhere in this file. (Verify: VersionCard.tsx only references `getOutputUrl` at line 54; removal is safe.)
- Add `import { Thumbnail } from './Thumbnail.js';`.
- Pass-through `c2paStatus` prop on `VersionCardProps` (NEW — type addition; the parent view fetches via `getC2paStatus` and threads down). Alternative: VersionCard itself fetches via `useEffect`-pattern (matches existing VersionDrawer's `getC2paStatus` consumer call site; check there for the established pattern). Planner picks; both are valid given that VersionDrawer already does the fetch elsewhere.
- The `version.status === 'complete'` ternary at line 52 GOES AWAY — Thumbnail handles its own skeleton rendering.
- Existing `<button>` wrapper at lines 42-50 stays unchanged — clicks bubble through Thumbnail (UI-SPEC §"Click-target contract").

---

### `packages/dashboard/src/components/TreeSidebar.tsx` (modify shot row only)

**Analog:** Same file's `TreeRow` primitive at lines 246-293 (the shared row component used by all four depth levels) and the shot-row caller at lines 215-229 (the only depth=3 instantiation).

**Shot-row caller — BEFORE (lines 215-229):**

```tsx
{expanded &&
  sequence.shots?.map((shot) => (
    <TreeRow
      key={shot.id}
      label={shot.name}
      depth={3}
      expanded={false}
      hasChildren={false}
      isSelected={shot.id === selectedShotId}
      onClick={() => onSelectShot(shot.id)}
      onToggle={() => {
        /* shots are leaves — no toggle */
      }}
    />
  ))}
```

**`TreeRow` primitive structure** (lines 246-293 — the receiving component to extend):

```tsx
function TreeRow({
  label, depth, expanded, hasChildren, isSelected, onClick, onToggle,
}: TreeRowProps) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      class={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm transition-colors ${
        isSelected
          ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
          : 'text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={onClick}
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={isSelected ? true : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {hasChildren ? (
        <span class="flex-shrink-0" onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-hidden="true">
          <Icon size={14} />
        </span>
      ) : (
        <span class="w-3.5 flex-shrink-0" aria-hidden="true" />
      )}
      <span class="truncate">{label}</span>
    </div>
  );
}
```

**Pattern to mirror — Phase 17 changes (D-13, D-14, D-15, D-16):**
- Add a NEW `latestCompletedVersion?: { id: string; label: string; status: 'complete' }` prop on `TreeShot` and thread it through the parent fetch (parent computes `ORDER BY completed_at DESC LIMIT 1 WHERE status='complete'` per D-14 — likely a server-side aggregation in dashboard-routes; planner decides exact API shape).
- Extend `TreeRowProps` with optional `thumbnail?: VNode` slot.
- In the shot-row caller (lines 215-229), pass `thumbnail={shot.latestCompletedVersion ? <Thumbnail version={...} size="sm" /> : <SkeletonThumbnail width={80} height={45} />}`.
- In `TreeRow` (after the chevron span, before the label span at line 290), insert `{thumbnail ? <span class="flex-shrink-0">{thumbnail}</span> : null}`.
- Sequence + Project + Workspace rows DO NOT pass `thumbnail` (D-16 LOCKED — they stay text-only).
- Effective label width per UI-SPEC §"Adaptive density": `280 - (8 + 3*12) - 14 - 80 - 4 = 138px`. Existing `truncate` class on the label span handles overflow.

---

### `packages/dashboard/src/lib/api.ts` (modify — add `getThumbnailUrl`)

**Analog:** Same file lines 191-193 (`getOutputUrl`) — exact shape to mirror.

**`getOutputUrl` shape** (lines 186-193):

```typescript
/**
 * 13. Returns the URL string for the version's rendered output.
 * Does NOT fetch — callers pass the returned string directly to `<img src=...>`
 * or similar. Intentional URL helper per plan (D-WEBUI-26).
 */
export function getOutputUrl(versionId: string): string {
  return `${BASE}/api/versions/${encodeURIComponent(versionId)}/output`;
}
```

**Pattern to mirror — `getThumbnailUrl`:**

```typescript
/**
 * Phase 17 / Plan 17 — returns the URL string for the version's thumbnail.
 * Does NOT fetch — callers pass the returned string directly to <img src=...>.
 *
 * Server route: GET /api/versions/:id/thumbnail (Phase 17). Returns 640×360
 * WebP cached on disk; supports If-None-Match conditional GET (304 fast path).
 *
 * The optional `filename` parameter is reserved for future multi-output
 * versions; v1.2 ships single-thumbnail-per-version, so the server resolves
 * the primary output's filename internally via outputs_json[0].filename.
 */
export function getThumbnailUrl(versionId: string, filename?: string): string {
  const base = `${BASE}/api/versions/${encodeURIComponent(versionId)}/thumbnail`;
  return filename ? `${base}?filename=${encodeURIComponent(filename)}` : base;
}
```

**Pattern to mirror:**
- Same `${BASE}/api/versions/...` URL composition.
- `encodeURIComponent` on path segments (matches existing pattern at line 192 + everywhere else in api.ts).
- Pure function — does NOT fetch (matches `getOutputUrl` JSDoc verbatim).
- Optional `filename` reserved per UI-SPEC `<Thumbnail/>` API contract (the v1.2 server can ignore; v1.3 may use).

---

### `packages/dashboard/src/components/SkeletonThumbnail.tsx` (verify only — possibly UNCHANGED)

**Analog:** Same file (no API change needed per UI-SPEC §"`SkeletonThumbnail` modifications" lines 277-286).

**Verification per UI-SPEC:** `width`/`height` props already exist (lines 14-22 of SkeletonThumbnail.tsx); callers pass `width={80} height={45}` for `sm` variant; existing inline `style={{ width: '${w}px', height: '${h}px' }}` covers it. Wrapper Tailwind classes on the parent (`aspect-video w-full` for card, fixed `width: 80px` for sm) override as needed.

**Pattern to mirror:** No code change. Add a comment/JSDoc note that 80×45 is now a documented caller variant (Phase 17 D-13 + UI-SPEC §"Spacing Scale" tables). If the planner decides to add explicit prop validation or a `data-variant` attribute for testability, that's polish — not contract-required.

---

### `packages/dashboard/package.json` (verify only — likely UNCHANGED)

Per UI-SPEC §"Phase 17 npm dependencies" (lines 497-508): **zero new dashboard-side dependencies.** The new components use only `preact` + `tailwindcss` (existing). `lucide-preact` is NOT used for the C2PA shield (D-08 forbids generic shield-check).

**Verification step:** Confirm during plan that the executor does NOT add any new `dependencies` entry to `packages/dashboard/package.json`. If a plan agent claims they need a new dep, it's a smell — re-read UI-SPEC §"Registry Safety".

---

## Shared Patterns

### Architecture-purity allowed-set extension

**Source:** `src/__tests__/architecture-purity.test.ts:166-231` (c2pa-node block).
**Apply to:** Both new sole-importer files (`image-thumbnail.ts` for `sharp`; `video-thumbnail.ts` for `@ffmpeg-installer/ffmpeg`).

```typescript
// Same shape twice — each native dep gets its own block, sorted-array deepEqual.
// (a) Subset check — no rogue importer outside the allowed set.
// (b) SET-equality on the actual importers (sorted-array deepEqual).
// Plus directory-level guards: src/engine/thumbnails/ has zero MCP/SQLite/Drizzle/Hono.
```

### Lazy native-binding load + monotonic graceful degradation

**Source:** `src/engine/c2pa/signer.ts:39-71` + RESEARCH.md Pattern 1.
**Apply to:** Both `image-thumbnail.ts` (sharp) and `video-thumbnail.ts` (ffmpeg).

```typescript
let cachedX: T | null = null;
let cachedXFailed: { reason: string; loggedOnce: boolean } | null = null;

async function getX(): Promise<T | null> {
  if (cachedX) return cachedX;
  if (cachedXFailed) return null; // monotonic fail
  try { cachedX = (await import('X')).default; return cachedX; }
  catch (err) { cachedXFailed = { reason: String(err), loggedOnce: false }; /* console.warn once */ return null; }
}
```

### Atomic temp+rename via nanoid(8) suffix

**Source:** `src/engine/output-downloader.ts:184-198` + `src/engine/c2pa/redaction.ts:740-749`.
**Apply to:** All cache writes (`cache.ts`); the engine integration tests assert no `.partial` files survive a successful write.

```typescript
const partialPath = `${finalPath}.${nanoid(8)}.partial`;
try {
  await /* sharp.toFile or writeFile */(partialPath);
  await rename(partialPath, finalPath);
} catch (err) {
  await unlink(partialPath).catch(() => {});
  throw err;
}
```

### Per-(versionId, filename) coalescing mutex (signMutex shape)

**Source:** `src/engine/pipeline.ts:288-291`.
**Apply to:** `thumbnailMutex` in pipeline.ts. **Critical:** NOT FIFO — coalescing.

```typescript
private readonly thumbnailMutex = new Map<string, Promise<...>>();

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

### HTTP route shape (GET + HEAD with X-* header + ETag)

**Source:** `src/http/dashboard-routes.ts:318-353`.
**Apply to:** New `GET /api/versions/:id/thumbnail` + `HEAD /api/versions/:id/thumbnail` in the same file.

```typescript
app.get('/api/versions/:id/...', (c) => {
  const versionId = c.req.param('id');
  // Reuse resolveOutputForVersion(versionId) for filename + filePath.
  // Compute response (engine.generateThumbnail → cached WebP bytes).
  // ETag conditional GET: If-None-Match comparison → 304 fast path.
  return c.body(webStream, 200, {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': etag,
  });
});

app.on('HEAD', '/api/versions/:id/...', (c) => { /* same headers, c.body(null, 200, {...}) */ });
```

### Engine-facade structural Pick (engine-aware modules without hard import)

**Source:** `src/engine/output-downloader.ts:48-68` (`EngineForC2pa` type).
**Apply to:** `src/engine/c2pa/redaction.ts` — declare `EngineForC2paRedaction` (or extend the existing redaction-side surface) with `invalidateThumbnail(versionId, filename) → Promise<void>`. Composition-friendly; tests can pass a stub.

### Dashboard component testing pattern

**Source:** `packages/dashboard/src/__tests__/VersionCard.test.tsx` + `C2paBadge.test.tsx` + `TreeSidebar.test.tsx` (existing).
**Apply to:** All Phase 17 dashboard component tests.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { /* SUT */ } from '../components/<Name>.js';
// One render() per test (not shared); use unmount() for state cleanup; getByAltText / getByTestId / queryByTestId for assertions.
```

---

## Anti-pattern Callouts

- **[X] Use `signMutex` shape (per-key Map<string, Promise>), NOT `assetWriterMutex` (FIFO).** `signMutex` (pipeline.ts:288-291) coalesces — concurrent requests for the same key share one in-flight Promise. `assetWriterMutex` (pipeline.ts:298-380) serializes via FIFO chaining for sign-vs-redact non-interleaving. Thumbnail generation is pure derivation from immutable bytes; coalescing is correct AND faster. Grabbing the FIFO primitive would queue concurrent dashboard scrolls and add latency.

- **[X] Use lazy `await import('sharp')` and `await import('@ffmpeg-installer/ffmpeg')`, NOT eager top-of-file imports.** Server boot must succeed when native bindings are missing or platform-mismatched (Concern #11 — boot resilience). Mirrors the c2pa-node lazy pattern in `signer.ts:39-71`. An eager `import 'sharp'` at the top of the file would crash `npx tsx src/server.ts` on a host without the native binding.

- **[X] Sharp/ffmpeg imports MUST be sole-importers per allowed-set (D-23, D-24).** Any other file in `src/` importing them fails the architecture-purity test. Specifically: video-thumbnail.ts must NOT import sharp directly — it calls into image-thumbnail.ts's `getSharpForVideoReencode()` helper. The sole-importer invariant is enforced by sorted-array deepEqual in `architecture-purity.test.ts`; a regression triggers a clear test failure.

- **[X] Cache invalidation calls `invalidateThumbnail()` AFTER the redact atomic rename, not before.** Symmetric to the existing redact ordering at `redaction.ts:740-749`. Calling invalidate BEFORE the atomic rename succeeds would create a window where (a) old thumb is deleted, (b) atomic rename fails, (c) source file remains stale, (d) no thumb exists — dashboard renders skeleton until next fetch retries. Calling AFTER ensures invalidation only happens for actually-rewritten bytes.

- **[X] NEW C2paShield is a separate component from existing C2paBadge — DO NOT refactor or merge.** Both ship in v1.2. C2paBadge stays the TEXT pill in VersionDrawer (Phase 14 wired); C2paShield is a NEW SVG icon overlaid on thumbnails. UI-SPEC §"Scope of this contract" line 21 is explicit: "C2paBadge.tsx (TEXT pill in VersionDrawer — preserved verbatim per CONTEXT.md 'C2paBadge does NOT replace')."

- **[X] Encode WebP at SOURCE aspect, NOT padded to 16:9 (D-04).** Letterboxing happens CSS-side via `object-contain` in a 16:9 wrapper. Server-side sharp pipeline uses `.resize(640, 360, { fit: 'inside', withoutEnlargement: true })` — NOT `fit: 'contain', background: '#000'`. The latter bakes letterbox bars into the cached WebP and breaks light/dark theme adaptation (D-18).

- **[X] `<Thumbnail/>` and `<C2paShield/>` have NO click handler.** Per UI-SPEC §"Click-target contract" + D-11. Clicks bubble to the parent VersionCard `<button>` (or TreeRow `<div role="treeitem">`). Adding nested click targets (a) creates a WCAG 2.5.5 target-size issue at 20px shield and (b) competes with the existing VersionCard onClick, splitting analytics + accessibility semantics.

- **[X] Use browser-native `loading="lazy"`, NOT IntersectionObserver shim.** UI-SPEC §"Lazy-load contract" + RESEARCH.md Anti-Patterns (line 467). Native lazy is universal in 2026 evergreen browsers; the dashboard already requires desktop ≥1024px (Phase 5 D-WEBUI-17). Hand-rolled IO would add bundle weight for zero gain.

- **[X] Always declare explicit `width` + `height` HTML attributes on `<img>` for CLS=0.** REQUIREMENTS.md VIS-01 explicit. CSS `aspect-ratio` alone is insufficient on older browsers. The `width/height` attributes establish intrinsic ratio for layout reservation BEFORE image decode.

- **[X] `object-contain`, NOT `object-cover` (D-19 LOCKED).** This is a behavior change from existing VersionCard.tsx:56 (`object-cover`). Tests must cover the swap. Cropping a 1024×1024 square render to 16:9 chops content edges — anti-feature for VFX preview fidelity.

- **[X] Server-side WebP letterbox bars MUST be transparent.** Theme adaptation depends on it (D-18). Sharp pipeline preserves the source alpha channel; CSS wrapper supplies the bar color. Compositing onto a solid `--color-surface` server-side would fight light/dark theme switching.

- **[X] No multi-size cache (`?w=80|160|320|640` srcset).** D-01 LOCKED — defer to v1.3. Single 640×360 size covers TreeSidebar (CSS down-scale via `object-fit`) AND VersionCard (native size). One cache entry per version-output is the v1.2 envelope.

- **[X] Reaching into `src/engine/thumbnails/` from `src/engine/c2pa/redaction.ts` is forbidden.** The c2pa module's allowed-import surface stays unchanged. Use the engine FACADE hook (`engine.invalidateThumbnail`) per the structural-Pick pattern in output-downloader.ts:48-68. RESEARCH.md Pattern 7 is explicit on this boundary.

- **[X] Putting the C2PA shield render decision in the server is wrong.** The server already emits `X-C2PA-Signing-Status`; the client's `getC2paStatus` helper consumes it; the dashboard component owns the `status === 'signed'` predicate (D-10). Moving the predicate server-side conflates the `<img src=>` URL with state surfacing — anti-modular.

- **[X] Sharp instance reuse across requests is wrong.** Each call should be `sharp(sourcePath).resize(...).webp(...).toFile(...)` fresh. The `.concurrency(2)` global cap is the right knob; instance reuse holds libvips state and can leak.

- **[X] Multi-encoding leak scan extension is REQUIRED, not optional.** REQUIREMENTS.md cross-cutting constraint mentions thumbnail cache. The existing leak-scan test (`c2pa-key-leak-negative.test.ts` candidate) must be extended to scan `.thumb.webp` and `.thumb.failed` paths for any plaintext that surfaces in the source-output scan. Forgetting this is a silent regression — Claude's-Discretion item but with a hard floor: it MUST exist by end of phase.

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `packages/dashboard/src/lib/thumbnail-queue.ts` | concurrency limiter (browser) | No existing dashboard concurrency limiter. Reference impl is provided above (~25 lines). RESEARCH.md PITFALLS #7 + CONTEXT.md "Claude's Discretion" — planner may scope-defer if browser-native HTTP/2 multiplexing + `loading="lazy"` proves sufficient under load testing. |

| File | Role | Reason |
|------|------|--------|
| `src/__tests__/http/thumbnail-route.test.ts` | HTTP route test | No `src/__tests__/http/` directory currently exists. Closest analog is in-process Hono request testing in existing `c2pa-dual-transport-parity.test.ts`. Plan 17 may either (a) create the new directory or (b) drop the test alongside existing top-level integration tests as `src/__tests__/thumbnail-route.test.ts` — planner picks. |

---

## Metadata

**Analog search scope:**
- `src/engine/c2pa/` (full module — c2pa-node lazy pattern, format-router, redaction)
- `src/engine/output-downloader.ts` (atomic write + structural Pick pattern)
- `src/engine/pipeline.ts:280-380` (signMutex + assetWriterMutex shapes)
- `src/http/dashboard-routes.ts:235-355` (route pattern + resolveOutputForVersion)
- `src/__tests__/architecture-purity.test.ts:1-270` (allowed-set + directory-guard pattern)
- `src/engine/c2pa/__tests__/` (test shape — format-router.test.ts, redaction.test.ts, signer.test.ts)
- `packages/dashboard/src/components/` (VersionCard, SkeletonThumbnail, C2paBadge, TreeSidebar)
- `packages/dashboard/src/__tests__/` (VersionCard.test.tsx, C2paBadge.test.tsx)
- `packages/dashboard/src/lib/api.ts` (getOutputUrl + getC2paStatus shape)
- `packages/dashboard/package.json` (verify zero-new-dep claim per UI-SPEC §"Registry Safety")

**Files scanned in this pass:** 14 source files (read in full or targeted ranges) + 17-CONTEXT.md + 17-RESEARCH.md (lines 240-468) + 17-UI-SPEC.md (full).

**Pattern extraction date:** 2026-05-01

---

## PATTERN MAPPING COMPLETE
