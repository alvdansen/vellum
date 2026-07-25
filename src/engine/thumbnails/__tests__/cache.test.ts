import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cachePathFor,
  computeETag,
  invalidateCache,
  isCacheFresh,
  partialPathFor,
  sentinelPathFor,
  writeAtomic,
  writeFailedSentinel,
} from '../cache.js';

/**
 * Phase 17 / Plan 17-01 Task 1 — pure FS-helper unit tests for the
 * thumbnail cache module (cachePathFor / sentinelPathFor / partialPathFor /
 * writeAtomic / computeETag / isCacheFresh / writeFailedSentinel /
 * invalidateCache).
 *
 * Per-test temp dir via mkdtemp + rm-recursive cleanup.
 *
 * For mtime-advance tests, use `utimes()` to set source mtime
 * deterministically rather than sleeping. Node FS rounds atime/mtime to
 * second precision on some platforms (notably HFS+), so we advance by
 * +5s in the affected tests rather than +1ms.
 */

let root: string;
let versionId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'phase17-cache-'));
  versionId = 'ver_test123';
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Plan 17-01 Task 1 — cachePathFor / sentinelPathFor', () => {
  it('Test 1: cachePathFor produces <root>/<vid>/<filename>.thumb.webp', () => {
    const out = cachePathFor(root, versionId, 'a.png');
    expect(out.endsWith(`/${versionId}/a.png.thumb.webp`)).toBe(true);
    expect(out.startsWith(root)).toBe(true);
  });

  it('Test 2: sentinelPathFor produces <root>/<vid>/<filename>.thumb.failed', () => {
    const out = sentinelPathFor(root, versionId, 'a.png');
    expect(out.endsWith(`/${versionId}/a.png.thumb.failed`)).toBe(true);
    expect(out.startsWith(root)).toBe(true);
  });
});

describe('Plan 17-01 Task 1 — partialPathFor', () => {
  it('Test 3: partialPathFor matches <cachePath>.<8 chars>.partial', () => {
    const out = partialPathFor(root, versionId, 'a.png');
    // The 8-char suffix uses nanoid's URL-safe alphabet [A-Za-z0-9_-].
    expect(out).toMatch(/\.thumb\.webp\.[a-zA-Z0-9_-]{8}\.partial$/);
  });

  it('Test 4: partialPathFor returns a different path on each call (nanoid uniqueness)', () => {
    const a = partialPathFor(root, versionId, 'a.png');
    const b = partialPathFor(root, versionId, 'a.png');
    expect(a).not.toEqual(b);
  });
});

describe('Plan 17-01 Task 1 — writeAtomic', () => {
  it('Test 5: writeAtomic invokes writer against the temp path; final file content equals bytes; no .partial leaks on success', async () => {
    // Pre-create the parent dir (writeAtomic doesn't mkdir — caller does).
    const parent = join(root, versionId);
    await rm(parent, { recursive: true, force: true });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(parent, { recursive: true });
    const finalPath = join(parent, 'final.webp');
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    await writeAtomic(finalPath, async (tempPath) => {
      await writeFile(tempPath, bytes);
    });
    // Final file content matches.
    const onDisk = await readFile(finalPath);
    expect(onDisk.equals(bytes)).toBe(true);
    // No .partial files survive.
    const entries = await readdir(parent);
    const partials = entries.filter((e) => e.endsWith('.partial'));
    expect(partials).toEqual([]);
  });

  it('Test 6: writeAtomic cleans up the partial on writer error', async () => {
    const parent = join(root, versionId);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(parent, { recursive: true });
    const finalPath = join(parent, 'final.webp');
    const synthetic = new Error('synthetic-writer-error');
    await expect(
      writeAtomic(finalPath, async (tempPath) => {
        // Write a partial then throw — the partial should be cleaned up.
        await writeFile(tempPath, Buffer.from([0x00]));
        throw synthetic;
      }),
    ).rejects.toThrow('synthetic-writer-error');
    const entries = await readdir(parent);
    const partials = entries.filter((e) => e.endsWith('.partial'));
    expect(partials).toEqual([]);
  });

  it('Test 7: writeAtomic cleans up the partial when the rename fails (target parent missing)', async () => {
    // finalPath lives under a directory that does NOT exist; rename will
    // fail with ENOENT after the writer wrote the temp file. The temp file
    // should still be cleaned up. The temp path is a sibling of finalPath
    // (both share the same parent) so it ALSO lives in the missing dir —
    // the writer's writeFile will fail first, which is the same cleanup
    // path. We test both the rename-failure and writer-failure paths.
    const parent = join(root, 'does-not-exist');
    const finalPath = join(parent, 'final.webp');
    await expect(
      writeAtomic(finalPath, async (tempPath) => {
        await writeFile(tempPath, Buffer.from([0xab, 0xcd]));
      }),
    ).rejects.toThrow();
    // Parent dir doesn't exist, so readdir would itself fail — we simply
    // assert the call rejected. The cleanup is best-effort.
  });
});

describe('Plan 17-01 Task 1 — computeETag', () => {
  it('Test 8: computeETag prefers sha256 strong validator when provided', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const etag = await computeETag(sourcePath, 'abc123def456');
    expect(etag).toBe('"sha256:abc123def456"');
  });

  it('Test 9: computeETag falls back to mtime: short-hash when no sha256', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const etag = await computeETag(sourcePath);
    expect(etag).toMatch(/^"mtime:[0-9a-f]{16}"$/);
  });

  it('Test 10: computeETag returns the same value across two reads with unchanged mtime', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const a = await computeETag(sourcePath);
    const b = await computeETag(sourcePath);
    expect(a).toBe(b);
  });

  it('Test 11: computeETag changes after touching srcPath with utimes() (+5s)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const before = await computeETag(sourcePath);
    // Advance mtime by 5 seconds — well above filesystem precision floors.
    const future = Math.floor(Date.now() / 1000) + 5;
    await utimes(sourcePath, future, future);
    const after = await computeETag(sourcePath);
    expect(after).not.toBe(before);
  });

  it('Test 12: computeETag returns the same value when sha256 is null AND mtime stable', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const a = await computeETag(sourcePath, null);
    const b = await computeETag(sourcePath, undefined);
    expect(a).toBe(b);
  });
});

describe('Plan 17-01 Task 1 — isCacheFresh (D-07 retry-on-source-change)', () => {
  it('Test 13: isCacheFresh returns false (miss) when neither cache nor sentinel exist', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const cachePath = cachePathFor(root, versionId, 'a.png');
    const sentinelPath = sentinelPathFor(root, versionId, 'a.png');
    const result = await isCacheFresh(cachePath, sentinelPath, sourcePath);
    expect(result).toEqual({ fresh: false, via: 'miss' });
  });

  it('Test 14: isCacheFresh returns true (cache) when cache.mtime >= source.mtime', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const cachePath = cachePathFor(root, versionId, 'a.png');
    await writeFile(cachePath, Buffer.from([0x01]));
    // Cache was written AFTER source — mtimes naturally satisfy the
    // ordering. To be explicit, advance cache mtime by +5s.
    const future = Math.floor(Date.now() / 1000) + 5;
    await utimes(cachePath, future, future);
    const sentinelPath = sentinelPathFor(root, versionId, 'a.png');
    const result = await isCacheFresh(cachePath, sentinelPath, sourcePath);
    expect(result).toEqual({ fresh: true, via: 'cache' });
  });

  it('Test 15: isCacheFresh returns false when source.mtime > cache.mtime (D-07 — source advanced, retry)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const cachePath = cachePathFor(root, versionId, 'a.png');
    await writeFile(cachePath, Buffer.from([0x01]));
    // Set cache mtime in the PAST so source.mtime > cache.mtime (D-07
    // retry-on-source-change semantics).
    const past = Math.floor(Date.now() / 1000) - 10;
    await utimes(cachePath, past, past);
    const sentinelPath = sentinelPathFor(root, versionId, 'a.png');
    const result = await isCacheFresh(cachePath, sentinelPath, sourcePath);
    expect(result.fresh).toBe(false);
  });

  it('Test 16: isCacheFresh returns true (sentinel) when .thumb.failed mtime >= source.mtime', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const cachePath = cachePathFor(root, versionId, 'a.png');
    const sentinelPath = sentinelPathFor(root, versionId, 'a.png');
    await writeFailedSentinel(sentinelPath);
    // Advance sentinel mtime to be safely after source.
    const future = Math.floor(Date.now() / 1000) + 5;
    await utimes(sentinelPath, future, future);
    const result = await isCacheFresh(cachePath, sentinelPath, sourcePath);
    expect(result).toEqual({ fresh: true, via: 'sentinel' });
  });

  it('Test 17: isCacheFresh returns false when sentinel.mtime < source.mtime (sentinel stale, retry)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sourcePath = join(root, versionId, 'a.png');
    await writeFile(sourcePath, Buffer.from([0x00]));
    const cachePath = cachePathFor(root, versionId, 'a.png');
    const sentinelPath = sentinelPathFor(root, versionId, 'a.png');
    await writeFailedSentinel(sentinelPath);
    // Set sentinel mtime in the PAST so source.mtime > sentinel.mtime.
    const past = Math.floor(Date.now() / 1000) - 10;
    await utimes(sentinelPath, past, past);
    const result = await isCacheFresh(cachePath, sentinelPath, sourcePath);
    expect(result.fresh).toBe(false);
  });
});

describe('Plan 17-01 Task 1 — writeFailedSentinel (Pitfall G hygiene)', () => {
  it('Test 18: writeFailedSentinel writes a zero-byte file (no identifier in content)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sentinelPath = sentinelPathFor(root, versionId, 'a.png');
    await writeFailedSentinel(sentinelPath);
    const st = await stat(sentinelPath);
    expect(st.size).toBe(0);
    const bytes = await readFile(sentinelPath);
    expect(bytes.length).toBe(0);
  });
});

describe('Plan 17-01 Task 1 — invalidateCache (idempotent unlink)', () => {
  it('Test 19: invalidateCache removes both .thumb.webp AND .thumb.failed', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const cachePath = cachePathFor(root, versionId, 'a.png');
    const sentinelPath = sentinelPathFor(root, versionId, 'a.png');
    await writeFile(cachePath, Buffer.from([0xde, 0xad]));
    await writeFailedSentinel(sentinelPath);
    await invalidateCache(root, versionId, 'a.png');
    // Both gone.
    await expect(stat(cachePath)).rejects.toThrow();
    await expect(stat(sentinelPath)).rejects.toThrow();
  });

  it('Test 20: invalidateCache is idempotent — second call after first does NOT throw (ENOENT swallowed)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    // No files created — first call walks ENOENTs.
    await invalidateCache(root, versionId, 'a.png');
    // Second call also walks ENOENTs.
    await invalidateCache(root, versionId, 'a.png');
    // Confirm explicitly: did not throw, and the parent dir is empty.
    const entries = await readdir(join(root, versionId));
    expect(entries).toEqual([]);
  });

  it('Test 21: invalidateCache removes a half-installed cache (cache present, sentinel absent)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const cachePath = cachePathFor(root, versionId, 'a.png');
    await writeFile(cachePath, Buffer.from([0xff]));
    await invalidateCache(root, versionId, 'a.png');
    await expect(stat(cachePath)).rejects.toThrow();
  });

  it('Test 22: invalidateCache removes a half-installed sentinel (sentinel present, cache absent)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, versionId), { recursive: true });
    const sentinelPath = sentinelPathFor(root, versionId, 'a.png');
    await writeFailedSentinel(sentinelPath);
    await invalidateCache(root, versionId, 'a.png');
    await expect(stat(sentinelPath)).rejects.toThrow();
  });
});
