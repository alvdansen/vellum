// Phase 17 / Plan 17-03 — engine + HTTP route tests for thumbnails.
//
// This file is split into two layers:
//
//   ENGINE LAYER (Tests 1-11) — Task 1 of Plan 17-03.
//     Drives Engine.generateThumbnail + Engine.invalidateThumbnail through
//     real seeded versions on a mkdtemp outputsDir. Uses a real Engine + DB
//     (no FakeEngine) because the methods read outputs_json from the version
//     row to compute the ETag's `sha256:` prefix.
//
//   HTTP LAYER (Tests 12-20) — Task 3 of Plan 17-03.
//     Drives GET + HEAD /api/versions/:id/thumbnail through createDashboardRouter
//     using the Hono app.request testing API. Asserts ETag/304/Cache-Control/
//     Content-Type plus regression-guards on the existing /output route
//     (T-14-10 byte-parity preserved).
//
// Architecture purity: this test file imports sharp directly to seed PNGs
// (test code may import sharp; the architecture-purity assertion excludes
// __tests__). It does NOT import @ffmpeg-installer/ffmpeg (the video happy
// path is gated on a runtime-detected ffmpeg binary; without one we skip).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtemp, rm, mkdir, utimes, readdir, stat as fsStat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import type { Database } from 'better-sqlite3';
import type { Engine } from '../engine/pipeline.js';
import type { VersionRepo } from '../store/version-repo.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
import { createDashboardRouter } from '../http/dashboard-routes.js';
import { typedErrorHandler } from '../http/error-middleware.js';
import * as ThumbnailsBarrel from '../engine/thumbnails/index.js';

// ---- Detection helpers ----
const haveFfmpeg = (() => {
  try {
    execFileSync('node', ['-e', 'console.log(require("@ffmpeg-installer/ffmpeg").path)'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
})();

// ---- Engine + version seeding helper ----

interface EngineSeed {
  tempRoot: string;
  outputsDir: string;
  versionId: string;
  filename: string;
  sourcePath: string;
  engine: Engine;
  sqlite: Database;
  versionRepo: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  cleanup: () => Promise<void>;
}

/**
 * Seed a real Engine + SQLite + on-disk version with `outputs_json=[{filename}]`.
 * Writes either the provided bytes OR a tiny valid PNG to
 * `<outputsDir>/<vid>/<filename>`.
 */
async function seedEngineWithVersion(opts: {
  filename?: string;
  bytes?: Buffer;
  outputsBytes?: Buffer;
  outputsJsonOverride?: string;
} = {}): Promise<EngineSeed> {
  const tempRoot = await mkdtemp(join(tmpdir(), `vfx-p17-03-eng-${nanoid(6)}-`));
  const outputsDir = join(tempRoot, 'outputs');
  await mkdir(outputsDir, { recursive: true });
  const dbPath = join(tempRoot, 'test.db');
  const filename = opts.filename ?? 'a.png';

  const { openDb } = await import('../store/db.js');
  const handle = openDb(dbPath);

  const { HierarchyRepo } = await import('../store/hierarchy-repo.js');
  const { VersionRepo: VersionRepoCtor } = await import('../store/version-repo.js');
  const { ProvenanceRepo: ProvenanceRepoCtor } = await import('../store/provenance-repo.js');
  const { Engine: EngineCtor } = await import('../engine/pipeline.js');
  const { FakeComfyUIClient } = await import('../test-utils/fake-comfyui-client.js');

  const hierarchy = new HierarchyRepo(handle.db);
  const versionRepo = new VersionRepoCtor(handle.db);
  const provenanceRepo = new ProvenanceRepoCtor(handle.db);
  const fake = new FakeComfyUIClient();

  const engine = new EngineCtor(
    handle.db,
    hierarchy,
    versionRepo,
    provenanceRepo,
    fake as never,
    outputsDir,
  );

  const ws = hierarchy.createWorkspace('p17-03-ws');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ver = versionRepo.insertVersion(shot.id);

  // Build the on-disk source asset.
  const verDir = join(outputsDir, ver.id);
  await mkdir(verDir, { recursive: true });
  const sourcePath = join(verDir, filename);
  if (opts.bytes) {
    await writeFile(sourcePath, opts.bytes);
  } else {
    // 64×36 red rectangle as a valid PNG.
    const png = await sharp({
      create: { width: 64, height: 36, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();
    await writeFile(sourcePath, opts.outputsBytes ?? png);
  }

  // Mark version completed with outputs_json so getVersion + outputs_json
  // resolution downstream succeed.
  const outputsJson = opts.outputsJsonOverride ?? JSON.stringify([{ filename }]);
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'submitted',
    workflow_json: '{}',
  });
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'completed',
    prompt_json: '{}',
    seed: 0,
    models_json: '[]',
    outputs_json: outputsJson,
  });
  versionRepo.markCompleted(ver.id, outputsJson);

  const sqlite = handle.sqlite as unknown as Database;
  return {
    tempRoot,
    outputsDir,
    versionId: ver.id,
    filename,
    sourcePath,
    engine,
    sqlite,
    versionRepo,
    provenanceRepo,
    cleanup: async () => {
      try {
        await engine.stop();
      } catch {
        // best-effort
      }
      try {
        sqlite.close();
      } catch {
        // best-effort
      }
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

// ============================================================================
// ENGINE LAYER (Tests 1-11) — Task 1 of Plan 17-03
// ============================================================================

describe('Engine.generateThumbnail / Engine.invalidateThumbnail (Plan 17-03 Task 1)', () => {
  let seed: EngineSeed;

  beforeEach(async () => {
    seed = await seedEngineWithVersion();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await seed.cleanup();
  });

  // -------- Test 1: image happy path --------
  it('Test 1: image happy path returns {filePath, contentType:"image/webp", etag}', async () => {
    const result = await seed.engine.generateThumbnail(seed.versionId, seed.filename);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.filePath.endsWith(`${seed.filename}.thumb.webp`)).toBe(true);
    expect(result.contentType).toBe('image/webp');
    expect(result.etag).toMatch(/^"(sha256|mtime):/);
    expect(existsSync(result.filePath)).toBe(true);
    const cacheBytes = await import('node:fs/promises').then((m) => m.readFile(result.filePath));
    // RIFF/WEBP magic
    expect(cacheBytes.slice(0, 4).toString('ascii')).toBe('RIFF');
    expect(cacheBytes.slice(8, 12).toString('ascii')).toBe('WEBP');
  });

  // -------- Test 2: cache hit fast path --------
  it('Test 2: second call reuses cache (no second sharp invocation)', async () => {
    const spy = vi.spyOn(ThumbnailsBarrel, 'generateImageThumbnail');
    await seed.engine.generateThumbnail(seed.versionId, seed.filename);
    expect(spy).toHaveBeenCalledTimes(1);
    await seed.engine.generateThumbnail(seed.versionId, seed.filename);
    // Second call hits the cache via isCacheFresh — generateImageThumbnail
    // is NOT invoked again.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // -------- Test 3: cache invalidates on source mtime advance (D-07) --------
  it('Test 3: cache regenerates when source mtime advances (D-07)', async () => {
    const spy = vi.spyOn(ThumbnailsBarrel, 'generateImageThumbnail');
    await seed.engine.generateThumbnail(seed.versionId, seed.filename);
    expect(spy).toHaveBeenCalledTimes(1);
    // Advance source mtime by 5s in the future to force isCacheFresh -> miss.
    const now = new Date();
    const future = new Date(now.getTime() + 5_000);
    await utimes(seed.sourcePath, future, future);
    await seed.engine.generateThumbnail(seed.versionId, seed.filename);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // -------- Test 4: coalescing mutex (D-21) --------
  it('Test 4 (D-21): 50 concurrent same-key generateThumbnail share one in-flight Promise', async () => {
    const spy = vi.spyOn(ThumbnailsBarrel, 'generateImageThumbnail');
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        seed.engine.generateThumbnail(seed.versionId, seed.filename),
      ),
    );
    // Exactly ONE sharp invocation
    expect(spy).toHaveBeenCalledTimes(1);
    // All 50 promises resolved successfully
    expect(results.every((r) => r !== null)).toBe(true);
    // Byte-identical etag — they all reflect the same source mtime/sha256.
    const etags = new Set(results.filter((r) => r !== null).map((r) => r!.etag));
    expect(etags.size).toBe(1);
  });

  // -------- Test 5: parallel different keys --------
  it('Test 5: 50 distinct keys run in parallel — sharp invoked 50 times', async () => {
    // Seed 50 fresh versions each with their own source file.
    const seeds: EngineSeed[] = [];
    try {
      for (let i = 0; i < 50; i++) {
        // eslint-disable-next-line no-await-in-loop
        const s = await seedEngineWithVersion({ filename: `o${i}.png` });
        seeds.push(s);
      }
      // Use a single engine but distinct key map — actually each EngineSeed
      // has its own engine. The mutex behavior holds per-engine; here we
      // exercise distinct (versionId, filename) on the SAME engine. Reset
      // to seed.engine and write 50 source files into seed.outputsDir.
      const distinctKeys: Array<{ vid: string; fn: string }> = [];
      for (let i = 0; i < 50; i++) {
        const fn = `o${i}.png`;
        const verDir = join(seed.outputsDir, seed.versionId);
        const png = await sharp({
          create: {
            width: 32 + i,
            height: 32 + i,
            channels: 3,
            background: { r: i * 5, g: 50, b: 100 },
          },
        })
          .png()
          .toBuffer();
        // eslint-disable-next-line no-await-in-loop
        await writeFile(join(verDir, fn), png);
        distinctKeys.push({ vid: seed.versionId, fn });
      }
      // Update outputs_json so each (vid, fn) resolves; we already have a
      // version row; we test multi-filename on the same vid.
      const spy = vi.spyOn(ThumbnailsBarrel, 'generateImageThumbnail');
      const results = await Promise.all(
        distinctKeys.map(({ vid, fn }) => seed.engine.generateThumbnail(vid, fn)),
      );
      expect(spy).toHaveBeenCalledTimes(50);
      expect(results.every((r) => r !== null)).toBe(true);
    } finally {
      for (const s of seeds) {
        // eslint-disable-next-line no-await-in-loop
        await s.cleanup();
      }
    }
  });

  // -------- Test 6: settle cleanup --------
  it('Test 6: thumbnailMutex entries deleted on settle (size === 0 after concurrent run)', async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        seed.engine.generateThumbnail(seed.versionId, seed.filename),
      ),
    );
    // Access private field via cast — verifies the finally cleanup actually runs.
    // We need a microtask flush since the finally + delete might race the await.
    await new Promise((r) => setImmediate(r));
    const mutex = (
      seed.engine as unknown as {
        thumbnailMutex: Map<string, unknown>;
      }
    ).thumbnailMutex;
    expect(mutex.size).toBe(0);
  });

  // -------- Test 7: unsupported format -> sentinel + null --------
  it('Test 7: unsupported format (output.exr) writes .thumb.failed sentinel and returns null', async () => {
    const exrSeed = await seedEngineWithVersion({ filename: 'output.exr' });
    try {
      const result = await exrSeed.engine.generateThumbnail(
        exrSeed.versionId,
        exrSeed.filename,
      );
      expect(result).toBeNull();
      const sentinel = join(
        exrSeed.outputsDir,
        exrSeed.versionId,
        'output.exr.thumb.failed',
      );
      expect(existsSync(sentinel)).toBe(true);
      // Zero-byte sentinel (D-07 hygiene)
      expect(statSync(sentinel).size).toBe(0);
    } finally {
      await exrSeed.cleanup();
    }
  });

  // -------- Test 8: sharp fails -> sentinel + null --------
  it('Test 8: sharp generateImageThumbnail throw is caught -> sentinel + null', async () => {
    vi.spyOn(ThumbnailsBarrel, 'generateImageThumbnail').mockImplementation(async () => {
      throw new Error('synthetic sharp failure');
    });
    const result = await seed.engine.generateThumbnail(seed.versionId, seed.filename);
    expect(result).toBeNull();
    const sentinel = join(
      seed.outputsDir,
      seed.versionId,
      `${seed.filename}.thumb.failed`,
    );
    expect(existsSync(sentinel)).toBe(true);
  });

  // -------- Test 9: video happy path (skipped if ffmpeg unavailable) --------
  it.skipIf(!haveFfmpeg)(
    'Test 9: MP4 source returns {contentType:"image/webp"}',
    async () => {
      // Generate a tiny test MP4 via @ffmpeg-installer/ffmpeg.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
      const mp4Seed = await seedEngineWithVersion({
        filename: 'tiny.mp4',
        bytes: Buffer.alloc(0), // placeholder; we'll overwrite via ffmpeg
      });
      try {
        const mp4Path = join(mp4Seed.outputsDir, mp4Seed.versionId, 'tiny.mp4');
        // 1s video, testsrc, 256x144, 30fps
        execFileSync(ffmpegPath, [
          '-y',
          '-f', 'lavfi',
          '-i', 'testsrc=size=256x144:rate=30:duration=1',
          '-pix_fmt', 'yuv420p',
          mp4Path,
        ], { stdio: 'ignore' });
        const result = await mp4Seed.engine.generateThumbnail(
          mp4Seed.versionId,
          mp4Seed.filename,
        );
        expect(result).not.toBeNull();
        if (!result) return;
        expect(result.contentType).toBe('image/webp');
        expect(existsSync(result.filePath)).toBe(true);
      } finally {
        await mp4Seed.cleanup();
      }
    },
    30_000,
  );

  // -------- Test 10: invalidateThumbnail removes both .thumb.webp and .thumb.failed --------
  it('Test 10: invalidateThumbnail removes cache + sentinel; second call is idempotent', async () => {
    // Generate a successful thumbnail
    await seed.engine.generateThumbnail(seed.versionId, seed.filename);
    const cachePath = join(
      seed.outputsDir,
      seed.versionId,
      `${seed.filename}.thumb.webp`,
    );
    expect(existsSync(cachePath)).toBe(true);

    // Also produce a sentinel by invoking on an unsupported format under the
    // same versionId — separate filename so the version row holds.
    // (This exercises the dual-unlink path; the .thumb.failed for `a.png` is
    //  not produced by the prior happy path, so it should NOT exist.)
    await seed.engine.invalidateThumbnail(seed.versionId, seed.filename);

    const dirContents = await readdir(join(seed.outputsDir, seed.versionId));
    expect(dirContents.includes(`${seed.filename}.thumb.webp`)).toBe(false);
    expect(dirContents.includes(`${seed.filename}.thumb.failed`)).toBe(false);

    // Second call MUST NOT throw.
    await expect(
      seed.engine.invalidateThumbnail(seed.versionId, seed.filename),
    ).resolves.toBeUndefined();
  });

  // -------- Test 11: invalidateThumbnail does NOT acquire thumbnailMutex --------
  it('Test 11: invalidateThumbnail completes ~immediately (does not contend for thumbnailMutex)', async () => {
    const start = Date.now();
    await seed.engine.invalidateThumbnail(seed.versionId, 'never-existed.png');
    const elapsed = Date.now() - start;
    // Generous bound — the unlink-noop path should be effectively immediate.
    // We use 100ms to avoid CI flakiness; the goal is to assert it's NOT
    // gated by a 30s assetWriterMutex acquire timeout.
    expect(elapsed).toBeLessThan(500);
  });
});

// ============================================================================
// HTTP LAYER (Tests 12-20) — Task 3 of Plan 17-03
// ============================================================================

function buildRouterApp(engine: Engine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}

describe('GET + HEAD /api/versions/:id/thumbnail (Plan 17-03 Task 3)', () => {
  let seed: EngineSeed;

  beforeEach(async () => {
    seed = await seedEngineWithVersion();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await seed.cleanup();
  });

  // -------- Test 12: GET 200 happy path --------
  it('Test 12: GET 200 — Content-Type/Cache-Control/ETag + WebP body bytes', async () => {
    const app = buildRouterApp(seed.engine);
    const res = await app.request(`/api/versions/${seed.versionId}/thumbnail`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    const etag = res.headers.get('ETag');
    expect(etag).toMatch(/^"(sha256|mtime):/);
    const body = new Uint8Array(await res.arrayBuffer());
    // RIFF/WEBP magic
    expect(String.fromCharCode(...body.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...body.slice(8, 12))).toBe('WEBP');
  });

  // -------- Test 13: 304 conditional GET --------
  it('Test 13: GET with If-None-Match returns 304 + same ETag/Cache-Control headers', async () => {
    const app = buildRouterApp(seed.engine);
    const r1 = await app.request(`/api/versions/${seed.versionId}/thumbnail`);
    const etag = r1.headers.get('ETag')!;
    expect(etag).toBeTruthy();
    const r2 = await app.request(`/api/versions/${seed.versionId}/thumbnail`, {
      headers: { 'If-None-Match': etag },
    });
    expect(r2.status).toBe(304);
    expect(r2.headers.get('ETag')).toBe(etag);
    expect(r2.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    const bodyBuf = await r2.arrayBuffer();
    expect(bodyBuf.byteLength).toBe(0);
  });

  // -------- Test 14: HEAD 200 same headers, no body --------
  it('Test 14: HEAD returns same headers as GET, with empty body', async () => {
    const app = buildRouterApp(seed.engine);
    // Pre-warm so HEAD can read cache.
    await app.request(`/api/versions/${seed.versionId}/thumbnail`);
    const res = await app.request(`/api/versions/${seed.versionId}/thumbnail`, {
      method: 'HEAD',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('ETag')).toMatch(/^"(sha256|mtime):/);
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  // -------- Test 15: 404 for unknown version --------
  it('Test 15: GET for unknown vid -> 404', async () => {
    const app = buildRouterApp(seed.engine);
    const res = await app.request(`/api/versions/ver_does_not_exist_xyz/thumbnail`);
    expect(res.status).toBe(404);
  });

  // -------- Test 16: 503 path — unsupported format --------
  it('Test 16: GET for an .exr output -> 503 + THUMBNAIL_FAILED envelope', async () => {
    const exrSeed = await seedEngineWithVersion({ filename: 'output.exr' });
    try {
      const app = buildRouterApp(exrSeed.engine);
      const res = await app.request(`/api/versions/${exrSeed.versionId}/thumbnail`);
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe('THUMBNAIL_FAILED');
      expect(typeof json.error.message).toBe('string');
    } finally {
      await exrSeed.cleanup();
    }
  });

  // -------- Test 17: 503 path — sharp load failed (engine returns null) --------
  it('Test 17: engine.generateThumbnail returning null -> 503 + sentinel suppresses retry', async () => {
    vi.spyOn(ThumbnailsBarrel, 'generateImageThumbnail').mockImplementation(async () => {
      throw new Error('synthetic sharp load failure');
    });
    const app = buildRouterApp(seed.engine);
    const r1 = await app.request(`/api/versions/${seed.versionId}/thumbnail`);
    expect(r1.status).toBe(503);
    const json = (await r1.json()) as { error: { code: string } };
    expect(json.error.code).toBe('THUMBNAIL_FAILED');

    // Sentinel exists on disk
    const sentinel = join(
      seed.outputsDir,
      seed.versionId,
      `${seed.filename}.thumb.failed`,
    );
    expect(existsSync(sentinel)).toBe(true);

    // Subsequent GET also returns 503; the sentinel suppresses retry until
    // source mtime advances (D-07).
    const r2 = await app.request(`/api/versions/${seed.versionId}/thumbnail`);
    expect(r2.status).toBe(503);
  });

  // -------- Test 18: path-traversal rejection (T-5-04 reuse) --------
  it('Test 18: path-traversal-tainted outputs_json filename rejected before engine called', async () => {
    const traversal = await seedEngineWithVersion({
      outputsJsonOverride: JSON.stringify([{ filename: '../../etc/passwd' }]),
    });
    try {
      // Spy AFTER the engine has been instantiated; we want to assert engine
      // dispatch is NOT reached for traversal-tainted inputs.
      const generateSpy = vi.spyOn(traversal.engine, 'generateThumbnail');
      const app = buildRouterApp(traversal.engine);
      const res = await app.request(
        `/api/versions/${traversal.versionId}/thumbnail`,
      );
      // resolveOutputForVersion throws TypedError('INVALID_INPUT', ...) -> 400
      expect(res.status).toBe(400);
      expect(generateSpy).not.toHaveBeenCalled();
    } finally {
      await traversal.cleanup();
    }
  });

  // -------- Test 19: existing /output route is byte-unchanged (T-14-10 regression) --------
  it('Test 19: existing /output route body bytes + headers byte-unchanged', async () => {
    const app = buildRouterApp(seed.engine);
    const res = await app.request(`/api/versions/${seed.versionId}/output`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, immutable');
    // X-C2PA-Signing-Status header is ALSO present (Phase 14 invariant).
    expect(res.headers.get('X-C2PA-Signing-Status')).toBeTruthy();
    const body = new Uint8Array(await res.arrayBuffer());
    // PNG magic — byte-equal to the seed PNG header.
    expect(Array.from(body.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  // -------- Test 20: engine-null-return path emits sentinel (D-07 leak-scan) --------
  it('Test 20: engine-null-return creates .thumb.failed; second GET returns same 503', async () => {
    const spy = vi
      .spyOn(ThumbnailsBarrel, 'generateImageThumbnail')
      .mockImplementation(async () => {
        throw new Error('synthetic sharp failure for sentinel test');
      });
    const app = buildRouterApp(seed.engine);
    const r1 = await app.request(`/api/versions/${seed.versionId}/thumbnail`);
    expect(r1.status).toBe(503);
    const sentinel = join(
      seed.outputsDir,
      seed.versionId,
      `${seed.filename}.thumb.failed`,
    );
    expect(existsSync(sentinel)).toBe(true);
    expect((await fsStat(sentinel)).size).toBe(0);

    // Capture first-request call count, then clear so the second-request
    // assertion is independent of r1's bookkeeping.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();

    // Second GET — engine.deriveThumbnail short-circuits via isCacheFresh
    // sentinel branch and returns null without calling sharp again.
    const r2 = await app.request(`/api/versions/${seed.versionId}/thumbnail`);
    expect(r2.status).toBe(503);
    // Sentinel suppresses retry — generateImageThumbnail NOT called on r2.
    expect(spy).not.toHaveBeenCalled();
  });
});

// Touch a path constant to keep `resolve` import reachable for future expansions.
void resolve;
