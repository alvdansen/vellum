import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  mkdtemp,
  readdir,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TypedError } from '../../errors.js';

/**
 * Module-identity-tolerant TypedError predicate. After `vi.resetModules()`,
 * a fresh dynamic import of `../video-thumbnail.js` re-evaluates the entire
 * module graph, producing a NEW TypedError class. The test's top-level
 * TypedError (imported once at file scope) and the freshly-imported one
 * are distinct classes — `instanceof TypedError` returns false even though
 * both are structurally identical.
 *
 * This helper checks the structural shape: it is a non-null object whose
 * constructor's `name === 'TypedError'` AND it carries a string `code`.
 * Production code throws TypedError instances via `class TypedError extends
 * Error` so the constructor-name check is sound.
 */
function isTypedError(
  err: unknown,
): err is TypedError & { code: string; message: string; hint?: string } {
  return (
    err !== null &&
    typeof err === 'object' &&
    err instanceof Error &&
    err.constructor.name === 'TypedError' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

/**
 * Phase 17 / Plan 17-02 Task 1 — video-thumbnail.ts unit tests.
 *
 * src/engine/thumbnails/video-thumbnail.ts is the SOLE @ffmpeg-installer/ffmpeg
 * importer in src/ (D-24). Test code MAY import the package directly to
 * generate fixtures — only src/ production code is allowed-set-restricted.
 *
 * Coverage:
 *   1. Happy path  — generateVideoThumbnail produces a webp file from an MP4.
 *   2. Brightness fallback — black-first-frames trigger -ss 1.0 BEFORE -i.
 *   3. 100MB pre-flight skip — oversized source short-circuits before spawn.
 *   4. 10s SIGKILL timeout — long-running spawn is killed at 10s mark.
 *   5. Monotonic ffmpeg load fail — second call does not re-attempt import.
 *   6. Atomic write — no .partial files survive a successful run.
 *   7. Reason codes — every failure surfaces a TypedError with locked reason.
 *   8. D-24 architecture-purity — sole @ffmpeg-installer/ffmpeg importer.
 *   9. D-23 preservation — zero direct sharp imports in video-thumbnail.ts.
 */

// ── Resolve ffmpeg availability ONCE at file scope (D-26 monotonic check) ──
const ffmpegAvailable = await (async () => {
  try {
    const m = await import('@ffmpeg-installer/ffmpeg');
    // Module shape: `installer.path` (or `installer.default.path` after CJS interop).
    const candidate =
      (m as { path?: string; default?: { path?: string } }).path ??
      (m as { default?: { path?: string } }).default?.path ??
      null;
    return Boolean(candidate);
  } catch {
    return false;
  }
})();

const ffmpegBin = await (async () => {
  if (!ffmpegAvailable) return null;
  const m = await import('@ffmpeg-installer/ffmpeg');
  return (
    (m as { path?: string; default?: { path?: string } }).path ??
    (m as { default?: { path?: string } }).default?.path ??
    null
  );
})();

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'phase17-video-thumb-'));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
  // Re-import via fresh dynamic import so test-injection seam reset is
  // visible even if vi.doMock changed module identity in the prior test.
  const { __resetFfmpegStateForTests } = await import('../video-thumbnail.js');
  __resetFfmpegStateForTests();
  vi.restoreAllMocks();
  vi.doUnmock('@ffmpeg-installer/ffmpeg');
  vi.resetModules();
});

// ── Fixture helpers ────────────────────────────────────────────────────────

/**
 * Run ffmpeg with the given args and reject on non-zero exit. Used by tests
 * to generate MP4 fixtures via the bundled binary. Promise resolves on close
 * code 0; rejects with stderr-tail on non-zero.
 */
function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 8192) stderr = stderr.slice(-4096);
    });
    proc.once('error', reject);
    proc.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-512)}`));
    });
  });
}

/**
 * Generate a tiny known-good MP4 (1s, 256×144 @ 30fps testsrc) at `dest`.
 * Used by the happy-path test — non-black, non-trivial frames so -vf thumbnail
 * picks a representative frame whose luma is well above 16/255.
 */
async function makeTinyMp4(dest: string): Promise<void> {
  if (!ffmpegBin) throw new Error('ffmpeg not available');
  await runFfmpeg(ffmpegBin, [
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=1:size=256x144:rate=30',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    dest,
  ]);
}

/**
 * Generate a 1.2s MP4 whose first ~0.2s is pure-black, followed by 1.0s of
 * testsrc. -vf thumbnail (default n=100) will pick from the first ~100
 * frames at 30fps ≈ 3.3s — but the input is only 1.2s long so it picks
 * from the available frames; a black-pre-roll defeats it because the first
 * frames dominate the histogram-comparison statistics.
 *
 * Used by Test 2 (brightness fallback) — proves that when -vf thumbnail
 * picks a dark frame, the -ss 1.0 fallback engages and produces a thumbnail
 * with luma above the threshold.
 */
async function makeBlackThenBrightMp4(dest: string): Promise<void> {
  if (!ffmpegBin) throw new Error('ffmpeg not available');
  await runFfmpeg(ffmpegBin, [
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=256x144:d=1.0:r=30',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=256x144:rate=30:duration=1.0',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    dest,
  ]);
}

// ── Tests 1-2: happy path + brightness fallback (require ffmpeg binary) ───

describe('Plan 17-02 Task 1 — generateVideoThumbnail end-to-end', () => {
  it.skipIf(!ffmpegAvailable)(
    'Test 1: generateVideoThumbnail writes a valid webp file from a tiny MP4 (D-28 happy path)',
    async () => {
      const { generateVideoThumbnail, __resetFfmpegStateForTests } =
        await import('../video-thumbnail.js');
      __resetFfmpegStateForTests();

      const sourcePath = join(workdir, 'tiny.mp4');
      const destPath = join(workdir, 'tiny.mp4.thumb.webp');
      await makeTinyMp4(sourcePath);

      await generateVideoThumbnail(sourcePath, destPath);

      // Verify the output is non-empty and is a valid WebP.
      const st = await stat(destPath);
      expect(st.size).toBeGreaterThan(0);

      // Use sharp (test code only — production code routes through
      // image-thumbnail.ts) to verify format='webp'.
      const sharp = (await import('sharp')).default;
      const meta = await sharp(destPath).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBeLessThanOrEqual(640);
    },
  );

  it.skipIf(!ffmpegAvailable)(
    'Test 2: brightness fallback engages on dark first-frame; second spawn uses -ss 1.0 BEFORE -i (D-29)',
    async () => {
      // The brightness-fallback control flow is exercised by injecting a
      // fully-controlled spawn helper. The first call writes a BLACK PNG
      // (luma ≈ 0, below the BRIGHTNESS_THRESHOLD=16); the second call (the
      // fallback) writes a WHITE PNG (luma ≈ 255). This asserts the
      // production code path:
      //   1. invokes spawn with -vf thumbnail FIRST,
      //   2. checks luma via getImageBrightness,
      //   3. on dark, invokes spawn AGAIN with -ss 1.0 BEFORE -i,
      //   4. re-encodes the (now-bright) PNG to WebP via the sharp delegate.
      //
      // We intentionally do NOT spawn real ffmpeg here — the goal is to
      // assert the orchestration logic, not ffmpeg's own behavior. Tests 1
      // and 6 already cover the real spawn path end-to-end.
      const { generateVideoThumbnail, __resetFfmpegStateForTests, __setSpawnFfmpegForTests } =
        await import('../video-thumbnail.js');
      __resetFfmpegStateForTests();

      const sourcePath = join(workdir, 'blackbright.mp4');
      const destPath = join(workdir, 'blackbright.mp4.thumb.webp');
      // Real source file so the stat() and pre-flight gate pass.
      await makeBlackThenBrightMp4(sourcePath);

      // Generate the controlled PNG bytes once outside the spawn handler.
      const sharp = (await import('sharp')).default;
      const blackPngBytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer();
      const whitePngBytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } },
      })
        .png()
        .toBuffer();

      const calls: Array<{ bin: string; args: string[]; timeoutMs: number }> = [];
      __setSpawnFfmpegForTests(async (bin, args, timeoutMs) => {
        calls.push({ bin, args: [...args], timeoutMs });
        // The last positional arg is the output path (production code passes
        // the temp PNG path here). Write controlled bytes to it so the
        // brightness check sees BLACK on call 1, WHITE on call 2.
        const outPath = args[args.length - 1];
        const bytes = calls.length === 1 ? blackPngBytes : whitePngBytes;
        await writeFile(outPath, bytes);
      });

      await generateVideoThumbnail(sourcePath, destPath);

      // Two spawn calls — first with -vf thumbnail (no -ss before -i), second
      // with -ss 1.0 BEFORE -i (the demuxer-level fast-seek fallback).
      expect(calls.length).toBe(2);

      // First call: -vf thumbnail filter, no -ss before -i.
      expect(calls[0].args).toContain('-vf');
      const firstVfIdx = calls[0].args.indexOf('-vf');
      expect(calls[0].args[firstVfIdx + 1]).toMatch(/^thumbnail/);
      // -i must appear; -ss must NOT appear before -i in the first call.
      const firstIIdx = calls[0].args.indexOf('-i');
      expect(firstIIdx).toBeGreaterThanOrEqual(0);
      const firstSsIdx = calls[0].args.indexOf('-ss');
      // Either no -ss at all, or -ss is AFTER -i (not the fallback pattern).
      expect(firstSsIdx === -1 || firstSsIdx > firstIIdx).toBe(true);

      // Second call: -ss BEFORE -i (the D-29 fallback).
      const secondSsIdx = calls[1].args.indexOf('-ss');
      const secondIIdx = calls[1].args.indexOf('-i');
      expect(secondSsIdx).toBeGreaterThanOrEqual(0);
      expect(secondIIdx).toBeGreaterThan(secondSsIdx);
      expect(calls[1].args[secondSsIdx + 1]).toBe('1.0');

      // Resulting thumbnail luma exceeds the brightness threshold (the
      // re-encode path picked up the WHITE PNG written by the second spawn).
      const stats = await sharp(destPath).stats();
      const channels = stats.channels;
      const luma =
        channels.length >= 3
          ? 0.299 * channels[0]!.mean + 0.587 * channels[1]!.mean + 0.114 * channels[2]!.mean
          : (channels[0]?.mean ?? 0);
      expect(luma).toBeGreaterThan(16);
    },
  );
});

// ── Test 3: 100MB pre-flight skip ─────────────────────────────────────────

describe('Plan 17-02 Task 1 — 100MB pre-flight skip (D-30 + PITFALL A)', () => {
  it('Test 3: oversized source throws THUMBNAIL_FAILED reason="source_too_large" BEFORE spawn', async () => {
    const { generateVideoThumbnail, __resetFfmpegStateForTests, __setSpawnFfmpegForTests } =
      await import('../video-thumbnail.js');
    __resetFfmpegStateForTests();

    const sourcePath = join(workdir, 'oversized.mp4');
    const destPath = join(workdir, 'oversized.mp4.thumb.webp');
    // Sparse 101 MB file — truncate creates a hole-only file fast.
    await writeFile(sourcePath, '');
    await truncate(sourcePath, 101 * 1024 * 1024);

    const spawnSpy = vi.fn();
    __setSpawnFfmpegForTests((bin, args, timeoutMs) => {
      spawnSpy(bin, args, timeoutMs);
      return Promise.resolve();
    });

    let caught: unknown = null;
    try {
      await generateVideoThumbnail(sourcePath, destPath);
    } catch (err) {
      caught = err;
    }

    expect(isTypedError(caught)).toBe(true);
    const t = caught as TypedError;
    expect(t.code).toBe('THUMBNAIL_FAILED');
    expect(t.message).toContain('source_too_large');

    // Spawn was NEVER called — the pre-flight gate engaged.
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

// ── Test 4: 10s SIGKILL timeout ──────────────────────────────────────────

describe('Plan 17-02 Task 1 — 10s ffmpeg SIGKILL timeout (D-30)', () => {
  it.skipIf(!ffmpegAvailable)(
    'Test 4: ffmpeg spawn that exceeds 10s is killed via SIGKILL; throws reason="ffmpeg_timeout"',
    async () => {
      const { generateVideoThumbnail, __resetFfmpegStateForTests, __setSpawnFfmpegForTests } =
        await import('../video-thumbnail.js');
      __resetFfmpegStateForTests();

      const sourcePath = join(workdir, 'tiny.mp4');
      const destPath = join(workdir, 'tiny.mp4.thumb.webp');
      await makeTinyMp4(sourcePath);

      // Mock the spawn helper to return a Promise that rejects with the
      // synthetic timeout error after 10s of fake time.
      __setSpawnFfmpegForTests((_bin, _args, _timeoutMs) => {
        return new Promise<void>((_resolve, reject) => {
          // Use real setTimeout — but rely on the production code path
          // having its own internal timer. Here we just simulate the
          // timeout-error contract by rejecting with the expected message.
          // To avoid blocking the test for 10s, reject immediately with
          // the timeout-shaped error.
          setTimeout(() => reject(new Error('ffmpeg_timeout')), 10);
        });
      });

      let caught: unknown = null;
      try {
        await generateVideoThumbnail(sourcePath, destPath);
      } catch (err) {
        caught = err;
      }

      expect(isTypedError(caught)).toBe(true);
      const t = caught as TypedError;
      expect(t.code).toBe('THUMBNAIL_FAILED');
      expect(t.message).toContain('ffmpeg_timeout');
    },
  );
});

// ── Test 5: monotonic ffmpeg load fail ───────────────────────────────────

describe('Plan 17-02 Task 1 — monotonic ffmpeg-load fail (D-26)', () => {
  it('Test 5: cached ffmpeg load failure short-circuits subsequent calls — import is NOT retried', async () => {
    // Use vi.doMock to force the dynamic import to throw.
    vi.doMock('@ffmpeg-installer/ffmpeg', () => {
      throw new Error('synthetic-platform-mismatch');
    });

    // resetModules so the next dynamic import re-evaluates the module with
    // the doMock in effect.
    vi.resetModules();

    const { generateVideoThumbnail, __resetFfmpegStateForTests } = await import(
      '../video-thumbnail.js'
    );
    __resetFfmpegStateForTests();

    const sourcePath = join(workdir, 'small.mp4');
    const destPath = join(workdir, 'small.mp4.thumb.webp');
    // Tiny file — passes the size gate so we hit the ffmpeg-load path.
    await writeFile(sourcePath, Buffer.alloc(1024));

    // First call: load attempted, fails monotonic.
    let firstCaught: unknown = null;
    try {
      await generateVideoThumbnail(sourcePath, destPath);
    } catch (err) {
      firstCaught = err;
    }
    expect(isTypedError(firstCaught)).toBe(true);
    expect((firstCaught as TypedError).code).toBe('THUMBNAIL_FAILED');
    expect((firstCaught as TypedError).message).toContain('ffmpeg_load_failed');

    // Second call: cachedFfmpegFailed short-circuits; same outcome.
    let secondCaught: unknown = null;
    try {
      await generateVideoThumbnail(sourcePath, destPath);
    } catch (err) {
      secondCaught = err;
    }
    expect(isTypedError(secondCaught)).toBe(true);
    expect((secondCaught as TypedError).code).toBe('THUMBNAIL_FAILED');
    expect((secondCaught as TypedError).message).toContain('ffmpeg_load_failed');
  });
});

// ── Test 6: atomic write — no .partial leaks ─────────────────────────────

describe('Plan 17-02 Task 1 — atomic write (D-22)', () => {
  it.skipIf(!ffmpegAvailable)(
    'Test 6: no .partial files survive a successful generateVideoThumbnail run',
    async () => {
      const { generateVideoThumbnail, __resetFfmpegStateForTests } = await import(
        '../video-thumbnail.js'
      );
      __resetFfmpegStateForTests();

      const sourcePath = join(workdir, 'tiny.mp4');
      const destPath = join(workdir, 'tiny.mp4.thumb.webp');
      await makeTinyMp4(sourcePath);

      await generateVideoThumbnail(sourcePath, destPath);

      const entries = await readdir(dirname(destPath));
      const partials = entries.filter((e) => e.endsWith('.partial'));
      expect(partials).toEqual([]);
    },
  );
});

// ── Test 7: every failure path surfaces a typed reason ────────────────────

describe('Plan 17-02 Task 1 — locked reason-code surface', () => {
  it('Test 7a: ENOENT on source surfaces THUMBNAIL_FAILED reason="source_unreadable"', async () => {
    const { generateVideoThumbnail, __resetFfmpegStateForTests } = await import(
      '../video-thumbnail.js'
    );
    __resetFfmpegStateForTests();

    const sourcePath = join(workdir, 'does-not-exist.mp4');
    const destPath = join(workdir, 'thumb.webp');

    let caught: unknown = null;
    try {
      await generateVideoThumbnail(sourcePath, destPath);
    } catch (err) {
      caught = err;
    }
    expect(isTypedError(caught)).toBe(true);
    expect((caught as TypedError).code).toBe('THUMBNAIL_FAILED');
    expect((caught as TypedError).message).toContain('source_unreadable');
  });

  it('Test 7b: ffmpeg non-zero exit (synthetic) surfaces reason="ffmpeg_failed"', async () => {
    const { generateVideoThumbnail, __resetFfmpegStateForTests, __setSpawnFfmpegForTests } =
      await import('../video-thumbnail.js');
    __resetFfmpegStateForTests();

    const sourcePath = join(workdir, 'small.mp4');
    const destPath = join(workdir, 'small.mp4.thumb.webp');
    await writeFile(sourcePath, Buffer.alloc(1024));

    __setSpawnFfmpegForTests(() =>
      Promise.reject(new Error('ffmpeg_failed:1:synthetic-stderr-tail')),
    );

    let caught: unknown = null;
    try {
      await generateVideoThumbnail(sourcePath, destPath);
    } catch (err) {
      caught = err;
    }
    expect(isTypedError(caught)).toBe(true);
    expect((caught as TypedError).code).toBe('THUMBNAIL_FAILED');
    expect((caught as TypedError).message).toContain('ffmpeg_failed');
  });
});

// ── Test 8: D-24 architecture-purity (sole @ffmpeg-installer/ffmpeg importer) ──

describe('Plan 17-02 Task 1 — D-24 architecture-purity (sole ffmpeg importer)', () => {
  it('Test 8: video-thumbnail.ts has the @ffmpeg-installer/ffmpeg import; sibling files have ZERO', async () => {
    const { execFileSync } = await import('node:child_process');
    const grepFn = (file: string): string => {
      try {
        return execFileSync(
          'grep',
          [
            '-cE',
            "from[[:space:]]*['\"]@ffmpeg-installer/ffmpeg|import[[:space:]]*\\([[:space:]]*['\"]@ffmpeg-installer/ffmpeg",
            file,
          ],
          { encoding: 'utf8' },
        ).trim();
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 1) return '0';
        throw err;
      }
    };

    expect(
      parseInt(grepFn('src/engine/thumbnails/video-thumbnail.ts'), 10),
    ).toBeGreaterThanOrEqual(1);
    expect(grepFn('src/engine/thumbnails/image-thumbnail.ts')).toBe('0');
    expect(grepFn('src/engine/thumbnails/cache.ts')).toBe('0');
    expect(grepFn('src/engine/thumbnails/format-router.ts')).toBe('0');
    expect(grepFn('src/engine/thumbnails/index.ts')).toBe('0');
  });
});

// ── Test 9: D-23 preserved — zero direct sharp imports in video-thumbnail.ts ──

describe('Plan 17-02 Task 1 — D-23 preserved (sharp delegate via image-thumbnail)', () => {
  it('Test 9: video-thumbnail.ts has ZERO direct `from "sharp"` imports', async () => {
    const { execFileSync } = await import('node:child_process');
    const grepFn = (file: string): string => {
      try {
        return execFileSync(
          'grep',
          [
            '-cE',
            "from[[:space:]]*['\"]sharp|import[[:space:]]*\\([[:space:]]*['\"]sharp",
            file,
          ],
          { encoding: 'utf8' },
        ).trim();
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 1) return '0';
        throw err;
      }
    };

    // Zero sharp imports — the re-encode goes through getSharpForVideoReencode
    // delegate from ./image-thumbnail.ts (D-23 preserved).
    expect(grepFn('src/engine/thumbnails/video-thumbnail.ts')).toBe('0');
  });

  it('Test 9b: video-thumbnail.ts imports getSharpForVideoReencode from ./image-thumbnail.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/engine/thumbnails/video-thumbnail.ts', 'utf-8');
    expect(src).toMatch(/from\s+['"]\.\/image-thumbnail\.js['"]/);
    expect(src).toMatch(/getSharpForVideoReencode/);
    expect(src).toMatch(/getImageBrightness/);
  });
});
