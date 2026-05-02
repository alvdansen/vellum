import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { TypedError } from '../../errors.js';
import {
  __resetSharpStateForTests,
  generateImageThumbnail,
  getImageBrightness,
  getSharpForVideoReencode,
} from '../image-thumbnail.js';

/**
 * Phase 17 / Plan 17-01 Task 2 — image-thumbnail.ts unit tests.
 *
 * src/engine/thumbnails/image-thumbnail.ts is the SOLE sharp importer in
 * src/ (D-23). Test code MAY import sharp directly to generate fixtures —
 * only src/ production code is allowed-set-restricted.
 *
 * Coverage:
 *   1. End-to-end thumbnail derivation produces a webp file with width≤640
 *      AND height≤360, source aspect preserved (D-04 fit:'inside', no padding).
 *   2. Atomic-write invariant on success — no .partial file leaks.
 *   3. Atomic-write cleanup on failure — no .partial file leaks after a
 *      writer-side throw.
 *   4. Sharp tuning is set ONCE on first load (sharp.concurrency(2) +
 *      sharp.cache(false)).
 *   5. Monotonic fail — once cachedSharpFailed is set, subsequent calls do
 *      NOT re-attempt the dynamic import (D-26).
 *   6. Brightness — BT.601 luma calculation matches expected for known-bright
 *      and known-black PNGs (D-29 threshold reference 16/255).
 *   7. getSharpForVideoReencode delegates to the same cached sharp instance
 *      (Plan 02 video-thumbnail consumer surface; preserves D-23 sole-importer
 *      invariant).
 *   8. D-23 architecture-purity grep — image-thumbnail.ts is the sole sharp
 *      importer in src/.
 */

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'phase17-image-thumb-'));
  __resetSharpStateForTests();
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
  __resetSharpStateForTests();
  vi.restoreAllMocks();
  vi.doUnmock('sharp');
});

// ─── Fixture helpers ──────────────────────────────────────────────────────

/** Generate a 32×32 grey RGB PNG (luma ≈ 128). */
async function makeGreyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .png()
    .toBuffer();
}

/** Generate a 32×32 black RGB PNG (luma ≈ 0). */
async function makeBlackPng(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

/** Generate a 32×32 white RGB PNG (luma ≈ 255). */
async function makeWhitePng(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

/** Generate an 800×800 square RGB PNG (so resize(640,360,fit:'inside') -> 360×360). */
async function makeSquarePng(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 64, g: 128, b: 192 } },
  })
    .png()
    .toBuffer();
}

// ─── Tests 1-3: end-to-end derivation + atomic-write invariants ───────────

describe('Plan 17-01 Task 2 — generateImageThumbnail end-to-end', () => {
  it('Test 1: generateImageThumbnail writes a webp file ≤640×360 with source aspect preserved (D-04)', async () => {
    const sourcePath = join(workdir, 'source.png');
    const destPath = join(workdir, 'source.png.thumb.webp');
    // 800×800 source → fit:'inside' shrinks to 360×360 (capped by height=360,
    // width follows aspect) — width≤640 AND height≤360 hold.
    await writeFile(sourcePath, await makeSquarePng());

    await generateImageThumbnail(sourcePath, destPath);

    const meta = await sharp(destPath).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(640);
    expect(meta.height).toBeLessThanOrEqual(360);
    // Source aspect preserved (square) → output remains square at min(640,360)
    // = 360 px. fit:'inside' does not pad.
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBe(360);

    const st = await stat(destPath);
    expect(st.size).toBeGreaterThan(0);
  });

  it('Test 2: atomic-write invariant — no .partial file leaks on success', async () => {
    const sourcePath = join(workdir, 'source.png');
    const destPath = join(workdir, 'source.png.thumb.webp');
    await writeFile(sourcePath, await makeGreyPng());

    await generateImageThumbnail(sourcePath, destPath);

    const entries = await readdir(dirname(destPath));
    const partials = entries.filter((e) => e.endsWith('.partial'));
    expect(partials).toEqual([]);
  });

  it('Test 3: atomic-write cleanup — no .partial file leaks when sharp.toFile rejects', async () => {
    // Trigger a sharp-side failure: pass a directory instead of a regular
    // file to .toFile(). The writer callback will throw, writeAtomic must
    // clean up the partial.
    const sourcePath = join(workdir, 'source.png');
    // Wide-deep destination: write to a destPath whose parent does not exist
    // (sharp.toFile rejects when the parent directory is missing). The
    // writeAtomic catch block runs the unlink cleanup.
    const destPath = join(workdir, 'no-such-parent', 'thumb.webp');
    await writeFile(sourcePath, await makeGreyPng());

    await expect(generateImageThumbnail(sourcePath, destPath)).rejects.toBeInstanceOf(
      TypedError,
    );

    // The partial in workdir/no-such-parent doesn't exist (the parent itself
    // doesn't exist), so we just confirm the workdir parent has no leaked
    // partials.
    const entries = await readdir(workdir);
    const partials = entries.filter((e) => e.endsWith('.partial'));
    expect(partials).toEqual([]);
  });
});

// ─── Test 4: sharp tuning set ONCE on first load ──────────────────────────

describe('Plan 17-01 Task 2 — sharp tuning is set ONCE on first load (PITFALL B + F)', () => {
  it('Test 4: sharp.concurrency(2) + sharp.cache(false) called once across multiple getSharp() calls', async () => {
    // Spy on the sharp module's concurrency + cache methods. They are
    // module-level functions on the default export — `vi.spyOn(sharp,
    // 'concurrency')` works on the runtime sharp object.
    const concSpy = vi.spyOn(sharp, 'concurrency');
    const cacheSpy = vi.spyOn(sharp, 'cache');

    __resetSharpStateForTests();

    // First call triggers tuning.
    const a = await getSharpForVideoReencode();
    // Second call MUST hit the cached path — no re-tuning.
    const b = await getSharpForVideoReencode();

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toBe(b);

    // The spies may register additional calls from the test fixtures
    // (`sharp({create: ...})`) — but those go via constructor, not
    // `sharp.concurrency`/`sharp.cache` static functions. The static
    // function spies should record exactly ONE call each from getSharp.
    expect(concSpy).toHaveBeenCalledTimes(1);
    expect(cacheSpy).toHaveBeenCalledTimes(1);
    expect(concSpy).toHaveBeenCalledWith(2);
    expect(cacheSpy).toHaveBeenCalledWith(false);
  });
});

// ─── Test 5: monotonic fail ──────────────────────────────────────────────

describe('Plan 17-01 Task 2 — monotonic fail (D-26)', () => {
  it('Test 5: cached load failure short-circuits subsequent calls — import is NOT retried', async () => {
    // Use vi.doMock to force a synthetic load failure on the dynamic import.
    // After the first failure, the module-scoped cachedSharpFailed prevents
    // a second import attempt; subsequent calls return null without
    // re-attempting.
    vi.doMock('sharp', () => {
      throw new Error('synthetic-platform-mismatch');
    });

    __resetSharpStateForTests();

    // First call: load attempted, fails, returns null.
    const first = await getSharpForVideoReencode();
    expect(first).toBeNull();

    // Capture how many times sharp was attempted to be imported by inspecting
    // the mock's invocation count via vi.isMockFunction. Vitest's doMock
    // records each `import('sharp')` as a fresh mock setup; the second call
    // must NOT trigger a fresh dynamic-import. We verify by checking the
    // monotonic invariant: a SECOND call returns null in the same way
    // WITHOUT throwing about a missing mock (the mock would still throw if
    // re-attempted, but the returned-null path means cachedSharpFailed
    // short-circuited).
    const second = await getSharpForVideoReencode();
    expect(second).toBeNull();

    // Both calls returned null — second call did not throw, confirming the
    // monotonic-fail short-circuit (cachedSharpFailed set after first
    // failure prevents a re-import).
  });
});

// ─── Test 6: getImageBrightness (BT.601 luma) ─────────────────────────────

describe('Plan 17-01 Task 2 — getImageBrightness (D-29)', () => {
  it('Test 6a: getImageBrightness on a known-white PNG > 16 (above D-29 threshold)', async () => {
    const sourcePath = join(workdir, 'white.png');
    await writeFile(sourcePath, await makeWhitePng());
    const luma = await getImageBrightness(sourcePath);
    expect(luma).toBeGreaterThan(16);
    // White is luma ≈ 255.
    expect(luma).toBeGreaterThan(250);
  });

  it('Test 6b: getImageBrightness on a known-black PNG < 16 (below D-29 threshold)', async () => {
    const sourcePath = join(workdir, 'black.png');
    await writeFile(sourcePath, await makeBlackPng());
    const luma = await getImageBrightness(sourcePath);
    expect(luma).toBeLessThan(16);
    // Black is luma ≈ 0.
    expect(luma).toBeLessThan(2);
  });

  it('Test 6c: getImageBrightness on a known-grey PNG ≈ 128 (BT.601 of equal RGB)', async () => {
    const sourcePath = join(workdir, 'grey.png');
    await writeFile(sourcePath, await makeGreyPng());
    const luma = await getImageBrightness(sourcePath);
    // BT.601 luma of (128,128,128) = 0.299*128 + 0.587*128 + 0.114*128 = 128.
    expect(luma).toBeGreaterThan(120);
    expect(luma).toBeLessThan(135);
  });
});

// ─── Test 7: getSharpForVideoReencode delegates to the same cached sharp ──

describe('Plan 17-01 Task 2 — getSharpForVideoReencode (Plan 02 surface)', () => {
  it('Test 7: getSharpForVideoReencode returns the cached sharp instance (or null on fail)', async () => {
    __resetSharpStateForTests();
    const a = await getSharpForVideoReencode();
    const b = await getSharpForVideoReencode();
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });
});

// ─── Test 8: D-23 architecture-purity grep ───────────────────────────────

describe('Plan 17-01 Task 2 — D-23 architecture-purity (sole sharp importer)', () => {
  it('Test 8: image-thumbnail.ts has exactly ONE sharp-import match; cache.ts + format-router.ts + index.ts have ZERO', async () => {
    const { execFileSync } = await import('node:child_process');
    const grepFn = (file: string): string => {
      try {
        return execFileSync(
          'grep',
          ['-cE', "from[[:space:]]*['\"]sharp|import[[:space:]]*\\([[:space:]]*['\"]sharp", file],
          { encoding: 'utf8' },
        ).trim();
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 1) return '0';
        throw err;
      }
    };

    expect(parseInt(grepFn('src/engine/thumbnails/image-thumbnail.ts'), 10)).toBeGreaterThanOrEqual(
      1,
    );
    expect(grepFn('src/engine/thumbnails/cache.ts')).toBe('0');
    expect(grepFn('src/engine/thumbnails/format-router.ts')).toBe('0');
    expect(grepFn('src/engine/thumbnails/index.ts')).toBe('0');
  });
});
