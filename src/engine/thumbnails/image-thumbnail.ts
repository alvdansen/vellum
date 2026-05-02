// Phase 17 / Plan 17-01 Task 2 — image thumbnail derivation (sole sharp importer).
//
// **D-23 architecture-purity invariant:**
//   This file is the SOLE importer of `sharp` across src/. Other modules
//   MUST call into this file's exports rather than import sharp directly.
//   Allowed-set assertion at src/__tests__/architecture-purity.test.ts.
//
// **Lazy + monotonic fail (D-26):**
//   `await import('sharp')` is deferred to the first call site. On native-
//   binding load failure, cachedSharpFailed is set and ALL subsequent calls
//   return null without re-attempting the import. The Plan 17-03 facade
//   converts a null return into a `.thumb.failed` sentinel + structured
//   warning log; the UI degrades to a skeleton.
//
// **Sharp tuning (PITFALL B + F):**
//   - sharp.concurrency(2)  — bounds concurrent libvips threads
//   - sharp.cache(false)    — disables libvips operation cache (server context)
//   Set ONCE on first successful module load.
//
// **Atomic write (D-22):**
//   sharp's .toFile(tempPath) writes via the cache.writeAtomic helper from
//   Task 1: temp+rename via nanoid(8) suffix; partial cleaned up on writer
//   error or rename error.

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TypedError } from '../errors.js';
import { writeAtomic } from './cache.js';

// ─── Lazy native-binding load + monotonic fail (D-26) ─────────────────────

// sharp's package.json declares `"main": "lib/index.js"` and the type
// definition uses `export = sharp` (CommonJS-style). With our tsconfig's
// `esModuleInterop: true`, `await import('sharp')` returns a module
// namespace whose `.default` property is the callable factory at runtime
// (Node ESM CJS-interop wraps `module.exports` as `default`). At the type
// level, however, `typeof import('sharp')` is the namespace shape
// (the static functions `cache`, `concurrency`, etc.) and TypeScript does
// not synthesize `.default` on the namespace alias. The cached value is
// the runtime callable, so we type it via a runtime inference: capture
// the type of `(await import('sharp')).default` from inside an async
// helper, which goes through TS's CJS-interop default-synthesis.
async function inferSharpDefault() {
  const mod = await import('sharp');
  return mod.default;
}
type SharpDefaultExport = Awaited<ReturnType<typeof inferSharpDefault>>;

let cachedSharp: SharpDefaultExport | null = null;
let cachedSharpFailed: { reason: string; loggedOnce: boolean } | null = null;

/**
 * Lazy-load sharp on first call site. Subsequent calls reuse the cached
 * module. On load failure, cachedSharpFailed is set and the failure is
 * monotonic — subsequent calls return null without re-attempting the
 * dynamic import (D-26).
 *
 * On the FIRST successful load only:
 *   - sharp.concurrency(2)  — PITFALL B (stampede mitigation)
 *   - sharp.cache(false)    — PITFALL F (server-context libvips cache disable)
 *
 * Returns the sharp default export (a callable factory: `sharp(input)` →
 * Sharp pipeline) on success, null on monotonic fail.
 */
async function getSharp(): Promise<SharpDefaultExport | null> {
  if (cachedSharp !== null) return cachedSharp;
  if (cachedSharpFailed !== null) return null;
  try {
    const mod = await import('sharp');
    cachedSharp = mod.default;
    // First-load tuning — set ONCE per process. Subsequent calls hit the
    // cachedSharp short-circuit above and skip this block entirely.
    cachedSharp.concurrency(2);
    cachedSharp.cache(false);
    return cachedSharp;
  } catch (err) {
    cachedSharpFailed = { reason: String(err), loggedOnce: false };
    if (!cachedSharpFailed.loggedOnce) {
      // eslint-disable-next-line no-console
      console.warn(
        `vfx-familiar: sharp load failed — thumbnails disabled. ${cachedSharpFailed.reason}`,
      );
      cachedSharpFailed.loggedOnce = true;
    }
    return null;
  }
}

/**
 * Test-only — resets the module-scoped lazy-load state so a vi.doMock on
 * `sharp` can take effect in a subsequent test. Production code MUST NOT
 * call this — it deliberately re-triggers the lazy import path.
 *
 * Mirrors __resetC2paNodeStateForTests at src/engine/c2pa/signer.ts:94-97.
 */
export function __resetSharpStateForTests(): void {
  cachedSharp = null;
  cachedSharpFailed = null;
}

// ─── Public surface ──────────────────────────────────────────────────────

/**
 * Derive a thumbnail from an image source file and write it to `destPath`.
 *
 * Pipeline:
 *   1. Load sharp lazily — on null (binding unavailable), throw TypedError
 *      'THUMBNAIL_FAILED' with reason='native_binding_unavailable'.
 *   2. mkdir destPath's parent (recursive — idempotent).
 *   3. writeAtomic(destPath, async (tempPath) => sharp(source)
 *        .resize(640, 360, { fit:'inside', withoutEnlargement:true })  // D-04
 *        .webp({ quality: 80 })                                        // D-03
 *        .toFile(tempPath)).
 *
 * On any sharp failure (decode error, libvips throw, etc.), rethrow as
 * TypedError 'THUMBNAIL_FAILED' with reason='sharp_failed'. The Plan 17-03
 * facade catches and writes a `.thumb.failed` sentinel.
 *
 * Atomic-write invariant: no `.partial` file survives either a successful
 * write OR a writer-side throw (cache.writeAtomic guarantees the cleanup).
 */
export async function generateImageThumbnail(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  const sharpFn = await getSharp();
  if (sharpFn === null) {
    throw new TypedError(
      'THUMBNAIL_FAILED',
      'sharp native binding unavailable — image thumbnails disabled',
      'Install sharp prebuilds for this platform, or run on a supported platform (macOS arm64/x64, Linux x64/arm64, Windows x64). The dashboard will degrade to a skeleton thumbnail.',
    );
  }

  await mkdir(dirname(destPath), { recursive: true });

  try {
    await writeAtomic(destPath, async (tempPath) => {
      await sharpFn(sourcePath)
        .resize(640, 360, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(tempPath);
    });
  } catch (err) {
    if (err instanceof TypedError) throw err;
    throw new TypedError(
      'THUMBNAIL_FAILED',
      `sharp failed to derive thumbnail: ${(err as Error).message}`,
      'The source asset may be corrupted or in an unsupported format. The dashboard will degrade to a skeleton thumbnail.',
    );
  }
}

/**
 * Compute average luma (BT.601 weighting) of an image at `imagePath`.
 *
 * BT.601 luma = 0.299*R.mean + 0.587*G.mean + 0.114*B.mean. For grayscale
 * sources (channels.length < 3), returns the single-channel mean.
 *
 * Used by Plan 17-02 video-thumbnail.ts to detect black-frame fade-ins
 * (D-29) and fall back to a 1.0s seek when luma < 16/255.
 *
 * Throws TypedError 'THUMBNAIL_FAILED' with reason='sharp_failed' on
 * stats() failure or when the native binding is unavailable.
 */
export async function getImageBrightness(imagePath: string): Promise<number> {
  const sharpFn = await getSharp();
  if (sharpFn === null) {
    throw new TypedError(
      'THUMBNAIL_FAILED',
      'sharp native binding unavailable — brightness check disabled',
      'Install sharp prebuilds for this platform, or run on a supported platform.',
    );
  }
  try {
    const stats = await sharpFn(imagePath).stats();
    const channels = stats.channels;
    if (channels.length < 3) {
      return channels[0]?.mean ?? 0;
    }
    const r = channels[0]!.mean;
    const g = channels[1]!.mean;
    const b = channels[2]!.mean;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  } catch (err) {
    if (err instanceof TypedError) throw err;
    throw new TypedError(
      'THUMBNAIL_FAILED',
      `sharp.stats() failed: ${(err as Error).message}`,
      'The source asset may be corrupted or in an unsupported format.',
    );
  }
}

/**
 * Plan 17-02 consumer surface — returns the cached sharp instance (or null
 * on monotonic fail). Lets video-thumbnail.ts re-encode its ffmpeg-extracted
 * PNG to WebP without duplicating the lazy import (preserves D-23 sole-
 * importer invariant — video-thumbnail.ts calls this helper, NEVER imports
 * sharp directly).
 *
 * Production code other than video-thumbnail.ts SHOULD use generateImageThumbnail
 * or getImageBrightness directly. This helper is exposed because the Plan
 * 17-02 video pipeline needs to chain a custom sharp call (`.webp({quality:80})
 * .toFile(...)`) on an in-memory or temp-file PNG.
 */
export async function getSharpForVideoReencode(): Promise<SharpDefaultExport | null> {
  return getSharp();
}
