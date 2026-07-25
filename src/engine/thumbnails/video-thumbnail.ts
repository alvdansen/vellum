// Phase 17 / Plan 17-02 Task 1 — MP4 first-frame thumbnail derivation
// (sole @ffmpeg-installer/ffmpeg importer).
//
// **D-24 architecture-purity invariant:**
//   This file is the SOLE importer of `@ffmpeg-installer/ffmpeg` across src/.
//   Other modules MUST call into this file's exports rather than import the
//   ffmpeg package directly. Allowed-set assertion at
//   src/__tests__/architecture-purity.test.ts (added in Task 2 of this plan
//   per D-25 SAME-plan rule).
//
// **D-23 preserved — sharp delegate, NOT direct import:**
//   This file does NOT import `sharp` directly — sharp access is via the
//   `getSharpForVideoReencode` and `getImageBrightness` delegates from
//   ./image-thumbnail.js (preserves D-23 sole-importer invariant). The
//   re-encode of the ffmpeg-extracted PNG to WebP routes through the cached
//   sharp instance owned by image-thumbnail.ts.
//
// **D-26 lazy + monotonic fail:**
//   `await import('@ffmpeg-installer/ffmpeg')` is deferred to the first call
//   site. On native-binding load failure, cachedFfmpegFailed is set and ALL
//   subsequent calls short-circuit without re-attempting the import. The
//   Plan 17-03 facade converts the typed error into a `.thumb.failed`
//   sentinel + structured warning log; the UI degrades to a skeleton.
//
// **D-27 license posture:**
//   `@ffmpeg-installer/ffmpeg` ships an LGPL-2.1 ffmpeg binary in a SEPARATE
//   process (verified via `node -e "require('@ffmpeg-installer/ffmpeg/package.json').license"`).
//   Separate-process invocation is MIT-compatible — NOT the rejected
//   `ffmpeg-static` package which carries a GPL-3.0-or-later viral license.
//
// **D-28 representative frame:**
//   First extraction attempt uses `-vf thumbnail` filter — ffmpeg analyses up
//   to 100 frames and picks the most representative one (skips fade-ins,
//   slate boards, repeated-frame blocks).
//
// **D-29 brightness fallback:**
//   If the extracted frame's BT.601 average luma < 16/255, a SECOND spawn
//   runs with `-ss 1.0` BEFORE `-i` (demuxer-level fast-seek to 1s) to dodge
//   black-pre-roll fade-ins. The fallback path is delegated through the
//   `getImageBrightness` helper from image-thumbnail.ts.
//
// **D-30 + Pitfall A — bounded resource use:**
//   - 100 MB pre-flight hard-skip on source size BEFORE spawning ffmpeg
//     (avoids OOM on long videos).
//   - 10 s SIGKILL timeout on each ffmpeg spawn (rejects hung processes).
//   - Both surface as TypedError reasons (`source_too_large`, `ffmpeg_timeout`).
//
// **D-22 atomic write:**
//   ffmpeg → temp PNG (in mkdtemp work dir) → sharp re-encode → temp WebP
//   (via cache.writeAtomic) → atomic rename to final destPath. The temp
//   work dir is cleaned up in a finally clause; the WebP partial is
//   cleaned by writeAtomic's catch-and-unlink. No `*.partial` files survive
//   either a successful run OR a writer-side throw.

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { nanoid } from 'nanoid';
import { TypedError } from '../errors.js';
import { writeAtomic } from './cache.js';
import {
  getImageBrightness,
  getSharpForVideoReencode,
} from './image-thumbnail.js';

// ─── Locked constants (CONTEXT D-29 / D-30 + PITFALL A) ─────────────────

/** Pre-flight source-size cap (D-30 + PITFALL A). */
const SOURCE_SIZE_LIMIT = 100 * 1024 * 1024;

/** Per-spawn ffmpeg SIGKILL timeout (D-30). */
const FFMPEG_TIMEOUT_MS = 10_000;

/** BT.601 luma threshold for brightness fallback (D-29). */
const BRIGHTNESS_THRESHOLD = 16;

// ─── Lazy native-binding load + monotonic fail (D-26) ──────────────────

let cachedFfmpegPath: string | null = null;
let cachedFfmpegFailed: { reason: string; loggedOnce: boolean } | null = null;

/**
 * Lazy-load the @ffmpeg-installer/ffmpeg binary path on first call site.
 * Subsequent calls reuse the cached value. On load failure, cachedFfmpegFailed
 * is set and the failure is monotonic — subsequent calls return null without
 * re-attempting the dynamic import (D-26).
 *
 * Returns the absolute path to the host platform's bundled ffmpeg binary on
 * success, null on monotonic fail.
 */
async function getFfmpegPath(): Promise<string | null> {
  if (cachedFfmpegPath !== null) return cachedFfmpegPath;
  if (cachedFfmpegFailed !== null) return null;
  try {
    const mod = await import('@ffmpeg-installer/ffmpeg');
    // The package exports `installer.path`. Under Node's CJS-interop, the
    // module shape may surface as `mod.path` directly OR via `mod.default.path`
    // depending on bundler / Node version. Probe both shapes.
    const candidate =
      (mod as { path?: string; default?: { path?: string } }).path ??
      (mod as { default?: { path?: string } }).default?.path ??
      null;
    if (candidate === null || typeof candidate !== 'string') {
      cachedFfmpegFailed = {
        reason: 'ffmpeg_path_missing',
        loggedOnce: false,
      };
      if (!cachedFfmpegFailed.loggedOnce) {
        // eslint-disable-next-line no-console
        console.warn(
          'vellum: @ffmpeg-installer/ffmpeg loaded but exposed no `.path` — video thumbnails disabled.',
        );
        cachedFfmpegFailed.loggedOnce = true;
      }
      return null;
    }
    cachedFfmpegPath = candidate;
    return cachedFfmpegPath;
  } catch (err) {
    cachedFfmpegFailed = {
      reason: String(err),
      loggedOnce: false,
    };
    if (!cachedFfmpegFailed.loggedOnce) {
      // eslint-disable-next-line no-console
      console.warn(
        `vellum: @ffmpeg-installer/ffmpeg load failed — video thumbnails disabled. ${cachedFfmpegFailed.reason}`,
      );
      cachedFfmpegFailed.loggedOnce = true;
    }
    return null;
  }
}

// ─── Test-injection seam ──────────────────────────────────────────────

/**
 * The ffmpeg-spawn helper signature. Returns a Promise that resolves on
 * code 0 exit, rejects on non-zero / timeout / spawn error. The timeout
 * arg surfaces the 10s cap (D-30) — production code passes
 * FFMPEG_TIMEOUT_MS; tests may pass a smaller value to exercise the
 * timeout path quickly.
 */
type SpawnFfmpegFn = (
  bin: string,
  args: string[],
  timeoutMs: number,
) => Promise<void>;

/**
 * Production ffmpeg-spawn — spawns the binary, captures stderr (last 4KB on
 * overflow), enforces the 10s SIGKILL timeout. Resolves on exit code 0;
 * rejects with `ffmpeg_timeout` on timeout, `ffmpeg_failed:<code>:<stderr-tail>`
 * on non-zero exit, or the underlying spawn error on `proc.on('error')`.
 */
function realSpawnFfmpeg(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer | string) => {
      stderr += typeof d === 'string' ? d : d.toString();
      if (stderr.length > 8192) stderr = stderr.slice(-4096);
    });
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* best-effort */
      }
      reject(new Error('ffmpeg_timeout'));
    }, timeoutMs);
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg_failed:${code}:${stderr.slice(-512)}`));
    });
  });
}

let spawnFfmpegFn: SpawnFfmpegFn = realSpawnFfmpeg;

/**
 * Test-only — replaces the spawn helper with `fn`. Used by the
 * video-thumbnail.test.ts integration suite to stub out the spawn so the
 * tests can assert on argv shape, force timeouts, and force non-zero
 * exits without actually spawning ffmpeg. Production code MUST NOT call
 * this. The replacement is reverted by `__resetFfmpegStateForTests` (and
 * by the afterEach hook in the test suite).
 */
export function __setSpawnFfmpegForTests(fn: SpawnFfmpegFn): void {
  spawnFfmpegFn = fn;
}

/**
 * Test-only — resets the module-scoped lazy-load + spawn-injection state
 * so a vi.doMock on `@ffmpeg-installer/ffmpeg` can take effect in a
 * subsequent test. Production code MUST NOT call this — it deliberately
 * re-triggers the lazy import path.
 *
 * Mirrors __resetSharpStateForTests at src/engine/thumbnails/image-thumbnail.ts:96.
 */
export function __resetFfmpegStateForTests(): void {
  cachedFfmpegPath = null;
  cachedFfmpegFailed = null;
  spawnFfmpegFn = realSpawnFfmpeg;
}

// ─── Public surface ────────────────────────────────────────────────────

/**
 * Derive a thumbnail from a video source (MP4) and write it as a WebP at
 * `destPath`.
 *
 * Pipeline:
 *   1. Stat the source — surface ENOENT/EACCES as
 *      TypedError('THUMBNAIL_FAILED', `source_unreadable: ...`).
 *   2. Pre-flight 100 MB hard-skip (D-30 + PITFALL A) — throws
 *      TypedError reason='source_too_large' BEFORE any spawn.
 *   3. Lazy-load the ffmpeg binary path (D-26). On null → throw
 *      TypedError reason='ffmpeg_load_failed'.
 *   4. mkdir destPath's parent (recursive — idempotent).
 *   5. mkdtemp work dir under os.tmpdir() — cleaned up in finally.
 *   6. First spawn: `-vf thumbnail,scale=640:-1` → temp PNG (D-28
 *      representative-frame selection).
 *   7. Brightness check via image-thumbnail.ts's getImageBrightness
 *      helper. If luma < 16/255 → second spawn with `-ss 1.0` BEFORE
 *      `-i` (D-29 demuxer-level fast-seek fallback).
 *   8. Re-encode PNG → WebP via the sharp delegate
 *      (getSharpForVideoReencode from image-thumbnail.ts) routed
 *      through cache.writeAtomic (atomic temp+rename).
 *   9. Cleanup work dir.
 *
 * Failure paths surface as TypedError('THUMBNAIL_FAILED', ...) with one
 * of the locked reasons:
 *   - source_unreadable          — stat failure (ENOENT/EACCES/etc.)
 *   - source_too_large           — pre-flight 100 MB skip
 *   - ffmpeg_load_failed         — lazy-import threw OR no .path
 *   - ffmpeg_timeout             — spawn exceeded 10s
 *   - ffmpeg_failed              — non-zero exit with stderr tail
 *   - sharp_reencode_failed      — sharp delegate returned null OR threw
 */
export async function generateVideoThumbnail(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  // 1. Stat source — surface ENOENT/EACCES as TypedError.
  let st: { size: number };
  try {
    st = await stat(sourcePath);
  } catch (err) {
    throw new TypedError(
      'THUMBNAIL_FAILED',
      `source_unreadable: ${(err as Error).message}`,
      'The source video may have been moved or deleted. Use Reproduce Version to regenerate.',
    );
  }

  // 2. Pre-flight 100 MB skip (D-30 + PITFALL A).
  if (st.size > SOURCE_SIZE_LIMIT) {
    throw new TypedError(
      'THUMBNAIL_FAILED',
      `source_too_large: ${st.size} bytes (limit ${SOURCE_SIZE_LIMIT})`,
      'Video files over 100 MB are skipped to bound ffmpeg memory pressure. The version remains usable; only the thumbnail is unavailable.',
    );
  }

  // 3. Lazy-load ffmpeg binary path (D-26).
  const ffmpegPath = await getFfmpegPath();
  if (ffmpegPath === null) {
    throw new TypedError(
      'THUMBNAIL_FAILED',
      'ffmpeg_load_failed',
      'Install @ffmpeg-installer/ffmpeg prebuilds for this platform, or run on a supported platform (macOS arm64/x64, Linux x64/arm64, Windows x64). The dashboard will degrade to a skeleton thumbnail.',
    );
  }

  // 4. Ensure destPath's parent exists (idempotent).
  await mkdir(dirname(destPath), { recursive: true });

  // 5. Per-call work dir for the temp PNG (cleaned in finally).
  const work = await mkdtemp(join(tmpdir(), `vfx-thumb-${nanoid(6)}-`));
  const pngTemp = join(work, 'frame.png');

  try {
    // 6. First spawn: -vf thumbnail filter (D-28 representative frame).
    try {
      await spawnFfmpegFn(
        ffmpegPath,
        [
          '-i',
          sourcePath,
          '-vf',
          'thumbnail,scale=640:-1',
          '-frames:v',
          '1',
          '-vcodec',
          'png',
          '-f',
          'image2',
          '-y',
          pngTemp,
        ],
        FFMPEG_TIMEOUT_MS,
      );
    } catch (err) {
      throw translateSpawnError(err);
    }

    // 7. Brightness check + D-29 fallback if luma < 16.
    let luma: number;
    try {
      luma = await getImageBrightness(pngTemp);
    } catch (err) {
      // Brightness check itself failed — surface as sharp_reencode_failed
      // (the Plan 17-01 helper translates sharp errors to TypedError
      // already; this catch covers TypedError re-throws from there).
      if (err instanceof TypedError) {
        throw new TypedError(
          'THUMBNAIL_FAILED',
          `sharp_reencode_failed: ${err.message}`,
          err.hint,
        );
      }
      throw new TypedError(
        'THUMBNAIL_FAILED',
        `sharp_reencode_failed: ${(err as Error).message}`,
        'The extracted PNG may be corrupted; sharp brightness check failed.',
      );
    }

    if (luma < BRIGHTNESS_THRESHOLD) {
      // D-29: -ss 1.0 BEFORE -i — demuxer-level fast-seek fallback.
      try {
        await spawnFfmpegFn(
          ffmpegPath,
          [
            '-ss',
            '1.0',
            '-i',
            sourcePath,
            '-vf',
            'scale=640:-1',
            '-frames:v',
            '1',
            '-vcodec',
            'png',
            '-f',
            'image2',
            '-y',
            pngTemp,
          ],
          FFMPEG_TIMEOUT_MS,
        );
      } catch (err) {
        throw translateSpawnError(err);
      }
    }

    // 8. Re-encode PNG → WebP via the sharp delegate (D-23 preserved).
    const sharp = await getSharpForVideoReencode();
    if (sharp === null) {
      throw new TypedError(
        'THUMBNAIL_FAILED',
        'sharp_reencode_failed: sharp delegate returned null',
        'sharp native binding is unavailable; the video thumbnail cannot be re-encoded to WebP.',
      );
    }
    try {
      await writeAtomic(destPath, async (tempPath) => {
        await sharp(pngTemp).webp({ quality: 80 }).toFile(tempPath);
      });
    } catch (err) {
      if (err instanceof TypedError) throw err;
      throw new TypedError(
        'THUMBNAIL_FAILED',
        `sharp_reencode_failed: ${(err as Error).message}`,
        'sharp failed to re-encode the extracted PNG to WebP. The source video may be corrupted.',
      );
    }
  } finally {
    // 9. Cleanup work dir (best-effort).
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Translate a spawn-helper error into a TypedError. Maps the rejection
 * shapes from `realSpawnFfmpeg` (and any test-injected stand-in) into
 * the locked reason-code surface.
 *
 *   - 'ffmpeg_timeout'           → reason='ffmpeg_timeout'
 *   - 'ffmpeg_failed:<...>'      → reason='ffmpeg_failed: <stderr-tail>'
 *   - any other Error            → reason='ffmpeg_failed: <message>'
 */
function translateSpawnError(err: unknown): TypedError {
  if (err instanceof TypedError) return err;
  const msg = (err as Error).message ?? String(err);
  if (msg.includes('ffmpeg_timeout')) {
    return new TypedError(
      'THUMBNAIL_FAILED',
      'ffmpeg_timeout',
      'ffmpeg exceeded the 10s timeout. The source video may be corrupt or excessively long.',
    );
  }
  // Mirror the realSpawnFfmpeg failure shape (`ffmpeg_failed:<code>:<tail>`).
  // Surface the entire message in the reason so callers can debug; the
  // tail is bounded to 512 bytes upstream.
  if (msg.startsWith('ffmpeg_failed')) {
    return new TypedError(
      'THUMBNAIL_FAILED',
      msg,
      'ffmpeg returned a non-zero exit code. The source video may be in an unsupported codec or container.',
    );
  }
  return new TypedError(
    'THUMBNAIL_FAILED',
    `ffmpeg_failed: ${msg}`,
    'ffmpeg invocation failed. Check the engine logs for stderr details.',
  );
}
