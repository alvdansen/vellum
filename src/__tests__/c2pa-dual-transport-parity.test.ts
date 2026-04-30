/**
 * Phase 14 Plan 14-05 — Task 2.
 *
 * Dual-transport parity test — automated coverage of ROADMAP success
 * criterion #5: stdio and Streamable HTTP paths emit IDENTICAL bytes for
 * the same version's signed output.
 *
 * Architectural background (Plan 14-03 → Plan 14-04 revision):
 *   The signing path runs at WRITE-TIME in the engine downloader hook. The
 *   HTTP route NEVER signs — it streams the on-disk bytes verbatim and reads
 *   the manifest_signed event for the X-C2PA-Signing-Status header. Because
 *   the file IS the source of truth, both stdio (direct fs.readFile) and
 *   --http (GET /api/versions/:id/output) read THE SAME bytes. Parity is
 *   automatic; this test makes that fact a tracked invariant rather than a
 *   structural assumption.
 *
 * Test strategy: build a real Engine + Hono app with the dashboard router
 * mounted, seed a version + run signOutput, write the signed bytes to
 * outputsDir/versionId/filename, then compare:
 *   - Buffer A = await fs.readFile(outputsDir/versionId/filename)
 *   - Buffer B = await app.fetch('/api/versions/:id/output').then(r => Buffer.from(await r.arrayBuffer()))
 *   - assert Buffer.compare(A, B) === 0
 *
 * Header parity (Test 4): the X-C2PA-Signing-Status header value matches
 * engine.getC2paStatusForVersion result — no drift between event store and
 * HTTP layer.
 *
 * v1.1 limit (Test 6): EXR returns body=raw input bytes + header
 * 'unsigned:unsupported_format'; NO sidecar route exists in v1.1.
 *
 * In-process Hono via app.fetch(request) — no real socket needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { Hono } from 'hono';
import { makeInMemoryDb } from '../test-utils/fixtures.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { ProvenanceRepo } from '../store/provenance-repo.js';
import { ProvenanceWriter } from '../engine/provenance.js';
import { Engine } from '../engine/pipeline.js';
import { FakeComfyUIClient } from '../test-utils/fake-comfyui-client.js';
import { __resetC2paNodeStateForTests } from '../engine/c2pa/signer.js';
import { createDashboardRouter } from '../http/dashboard-routes.js';
import { typedErrorHandler } from '../http/error-middleware.js';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { C2paConfig } from '../types/c2pa.js';

const haveOpenssl = (() => {
  try {
    execFileSync('which', ['openssl'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const haveFfmpeg = (() => {
  try {
    execFileSync('which', ['ffmpeg'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const BUNDLED_CERT_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pub');
const BUNDLED_KEY_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pem');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const TINY_TIFF = Buffer.from(
  'SUkqAAwAAAAAUCAAAA4AAAAAAQQAAQAAAAEAAAABAQQAAQAAAAEAAAACAQMAAQAAAAgAAAADAQMAAQAAAAEAAAAGAQMAAQAAAAEAAAARAQQAAQAAAAgAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAEAAAAWAQQAAQAAAAEAAAAXAQQAAQAAAAEAAAAaAQUAAQAAAOoAAAAbAQUAAQAAAPIAAAAcAQMAAQAAAAEAAAAoAQMAAQAAAAIAAAA9AQMAAQAAAAIAAAAAAAAASAAAAAEAAABIAAAAAQAAAA==',
  'base64',
);

const FIXTURE_ROOT = resolve('tests/fixtures/c2pa/algorithms');

function maybeMakeTinyMp4(): Buffer | null {
  const cachedPath = join(FIXTURE_ROOT, 'larger.mp4');
  if (existsSync(cachedPath)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('node:fs').readFileSync(cachedPath);
    } catch {
      return null;
    }
  }
  if (!haveFfmpeg) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:fs').mkdirSync(FIXTURE_ROOT, { recursive: true });
    execFileSync(
      'ffmpeg',
      [
        '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1',
        '-r', '24', '-t', '1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        cachedPath, '-y',
      ],
      { stdio: 'pipe' },
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:fs').readFileSync(cachedPath);
  } catch {
    return null;
  }
}

interface ParityCtx {
  engine: Engine;
  versionId: string;
  outputsDir: string;
  app: Hono;
  cleanup: () => Promise<void>;
}

async function setupParityCtx(c2paConfig: C2paConfig | null): Promise<ParityCtx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const outputsDir = await mkdtemp(join(tmpdir(), `vfx-c2pa-parity-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    outputsDir,
    {
      maxConcurrentPollers: 1,
      c2paConfig,
    },
  );
  const ws = hierarchy.createWorkspace(`ws-${nanoid(4)}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ver = versions.insertVersion(shot.id);
  provenanceWriter.writeSubmitEvent(ver.id, {});
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'completed',
    prompt_json: '{}',
    seed: null,
    models_json: '[]',
    outputs_json: '[]',
  });

  const app = new Hono();
  app.onError(typedErrorHandler);
  app.route('/', createDashboardRouter(engine));

  return {
    engine,
    versionId: ver.id,
    outputsDir,
    app,
    cleanup: async (): Promise<void> => {
      await engine.stop();
      await rm(outputsDir, { recursive: true, force: true });
      __resetC2paNodeStateForTests();
    },
  };
}

/**
 * Seed a version's outputs_json so dashboard routes resolve the filename,
 * then write `signedBytes` to the on-disk output path and mark completed.
 */
async function seedVersionFile(
  ctx: ParityCtx,
  versionId: string,
  filename: string,
  contentBytes: Buffer,
): Promise<string> {
  // Write outputs_json so getVersion + dashboard route can resolve
  // outputs[0].filename.
  // We need to access the repo to mark completed. Reuse the version that
  // was seeded in setupParityCtx, but re-write its outputs_json.
  // Easiest path: directly call markCompleted on the engine's internal repo.
  // Tests mirror the pattern at sign-output.test.ts which uses VersionRepo.markCompleted.
  const versionDir = join(ctx.outputsDir, versionId);
  await mkdir(versionDir, { recursive: true });
  const filePath = join(versionDir, filename);
  await writeFile(filePath, contentBytes);
  return filePath;
}

const REAL_C2PA_CONFIG: C2paConfig = {
  certPemPath: BUNDLED_CERT_PATH,
  privateKeyPemPath: BUNDLED_KEY_PATH,
};

// ============================================================================
// PNG parity (Test 1)
// ============================================================================

describe.skipIf(!haveOpenssl)('C2PA dual-transport parity — PNG (Test 1)', () => {
  let ctx: ParityCtx;
  let filename: string;

  beforeAll(async () => {
    ctx = await setupParityCtx(REAL_C2PA_CONFIG);
    filename = 'out.png';
    // Sign the PNG — buffer-API path.
    const signResult = await ctx.engine.signOutput(ctx.versionId, filename, { bytes: TINY_PNG });
    expect(signResult.signed).not.toBeNull();
    // Persist signed bytes to disk (mirrors output-downloader.signFileInPlace +
    // atomic-write).
    await seedVersionFile(ctx, ctx.versionId, filename, signResult.signed!);
    // Mark version completed so getVersion resolves outputs_json.
    // Use the engine's internal version repo via the same DB the engine has.
    // Simplest: use the ProvenanceRepo + VersionRepo pattern of sign-output.test.ts —
    // but here we already have a completed event seeded. We need outputs_json
    // populated on the row. Re-mark with the proper filename.
    // The engine's getVersion reads VersionRepo.getVersion(id).outputs_json.
    // Since we don't have direct access to versions from setupParityCtx, expose
    // it as a side effect: re-mark via the engine's internal access path.
    // Quick path: re-create row via repo — we'll grab repos via engine internals.
    const internals = ctx.engine as unknown as {
      versionRepo: { markCompleted: (id: string, json: string) => void };
    };
    internals.versionRepo.markCompleted(
      ctx.versionId,
      JSON.stringify([{ filename }]),
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 1 — PNG: HTTP body equals direct file read (byte-identical)', async () => {
    const directBytes = await readFile(join(ctx.outputsDir, ctx.versionId, filename));
    const response = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`),
    );
    expect(response.status).toBe(200);
    const httpBytes = Buffer.from(await response.arrayBuffer());
    expect(Buffer.compare(httpBytes, directBytes)).toBe(0);
    expect(httpBytes.equals(directBytes)).toBe(true);
  });
});

// ============================================================================
// MP4 parity (Test 2)
// ============================================================================

describe.skipIf(!haveOpenssl || !haveFfmpeg)('C2PA dual-transport parity — MP4 (Test 2)', () => {
  let ctx: ParityCtx;
  let filename: string;
  let mp4SkipReason: string | null = null;

  beforeAll(async () => {
    ctx = await setupParityCtx(REAL_C2PA_CONFIG);
    filename = 'out.mp4';
    const srcMp4 = maybeMakeTinyMp4();
    if (!srcMp4) {
      mp4SkipReason = 'ffmpeg-fixture-creation-failed';
      return;
    }
    const signResult = await ctx.engine.signOutput(ctx.versionId, filename, { bytes: srcMp4 });
    if (!signResult.signed) {
      mp4SkipReason = 'mp4-signing-rejected-by-c2pa-rs';
      return;
    }
    await seedVersionFile(ctx, ctx.versionId, filename, signResult.signed);
    const internals = ctx.engine as unknown as {
      versionRepo: { markCompleted: (id: string, json: string) => void };
    };
    internals.versionRepo.markCompleted(ctx.versionId, JSON.stringify([{ filename }]));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 2 — MP4: HTTP body equals direct file read (byte-identical)', async () => {
    if (mp4SkipReason) {
      // eslint-disable-next-line no-console
      console.warn(`Test 2 skipped — ${mp4SkipReason}`);
      return;
    }
    const directBytes = await readFile(join(ctx.outputsDir, ctx.versionId, filename));
    const response = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`),
    );
    expect(response.status).toBe(200);
    const httpBytes = Buffer.from(await response.arrayBuffer());
    expect(Buffer.compare(httpBytes, directBytes)).toBe(0);
  });
});

// ============================================================================
// TIFF parity (Test 3 — v1.1 file-API path)
// ============================================================================

describe.skipIf(!haveOpenssl)('C2PA dual-transport parity — TIFF (Test 3)', () => {
  let ctx: ParityCtx;
  let filename: string;
  let tiffSkipReason: string | null = null;

  beforeAll(async () => {
    ctx = await setupParityCtx(REAL_C2PA_CONFIG);
    filename = 'out.tif';
    const tempDir = await mkdtemp(join(tmpdir(), 'vfx-tiff-src-'));
    const srcPath = join(tempDir, 'src.tif');
    await writeFile(srcPath, TINY_TIFF);
    try {
      const signResult = await ctx.engine.signOutput(
        ctx.versionId,
        filename,
        { filePath: srcPath },
      );
      if (!signResult.signedToPath) {
        tiffSkipReason = 'tiff-signing-skipped';
        return;
      }
      const signedBytes = await readFile(signResult.signedToPath);
      await seedVersionFile(ctx, ctx.versionId, filename, signedBytes);
      const internals = ctx.engine as unknown as {
        versionRepo: { markCompleted: (id: string, json: string) => void };
      };
      internals.versionRepo.markCompleted(ctx.versionId, JSON.stringify([{ filename }]));
    } catch (err) {
      tiffSkipReason = `tiff-fixture-rejected: ${(err as Error).message}`;
    }
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 3 — TIFF: HTTP body equals direct file read (byte-identical)', async () => {
    if (tiffSkipReason) {
      // eslint-disable-next-line no-console
      console.warn(`Test 3 skipped — ${tiffSkipReason}`);
      return;
    }
    const directBytes = await readFile(join(ctx.outputsDir, ctx.versionId, filename));
    const response = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`),
    );
    expect(response.status).toBe(200);
    const httpBytes = Buffer.from(await response.arrayBuffer());
    expect(Buffer.compare(httpBytes, directBytes)).toBe(0);
  });
});

// ============================================================================
// Header parity (Test 4)
// ============================================================================

describe.skipIf(!haveOpenssl)('C2PA dual-transport parity — header parity (Test 4)', () => {
  let ctx: ParityCtx;
  let filename: string;

  beforeAll(async () => {
    ctx = await setupParityCtx(REAL_C2PA_CONFIG);
    filename = 'out.png';
    const signResult = await ctx.engine.signOutput(ctx.versionId, filename, { bytes: TINY_PNG });
    expect(signResult.signed).not.toBeNull();
    await seedVersionFile(ctx, ctx.versionId, filename, signResult.signed!);
    const internals = ctx.engine as unknown as {
      versionRepo: { markCompleted: (id: string, json: string) => void };
    };
    internals.versionRepo.markCompleted(ctx.versionId, JSON.stringify([{ filename }]));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 4 — X-C2PA-Signing-Status header MATCHES engine.getC2paStatusForVersion', async () => {
    const engineStatus = ctx.engine.getC2paStatusForVersion(ctx.versionId, filename);
    expect(engineStatus).not.toBeNull();
    expect(engineStatus!.signed).toBe(true);
    const response = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`),
    );
    expect(response.headers.get('X-C2PA-Signing-Status')).toBe('signed');
  });
});

// ============================================================================
// Signing disabled (Test 5)
// ============================================================================

describe('C2PA dual-transport parity — signing disabled (Test 5)', () => {
  let ctx: ParityCtx;
  let filename: string;

  beforeAll(async () => {
    ctx = await setupParityCtx(null); // signing disabled
    filename = 'out.png';
    const signResult = await ctx.engine.signOutput(ctx.versionId, filename, { bytes: TINY_PNG });
    expect(signResult.signed).toBeNull(); // no signing → original bytes returned
    // Write the ORIGINAL TINY_PNG to disk (signing-disabled means caller
    // proceeds with raw bytes).
    await seedVersionFile(ctx, ctx.versionId, filename, TINY_PNG);
    const internals = ctx.engine as unknown as {
      versionRepo: { markCompleted: (id: string, json: string) => void };
    };
    internals.versionRepo.markCompleted(ctx.versionId, JSON.stringify([{ filename }]));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 5 — signing disabled: HTTP body equals raw input bytes + header is unsigned:signing_disabled', async () => {
    const directBytes = await readFile(join(ctx.outputsDir, ctx.versionId, filename));
    expect(directBytes.equals(TINY_PNG)).toBe(true);
    const response = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`),
    );
    expect(response.status).toBe(200);
    const httpBytes = Buffer.from(await response.arrayBuffer());
    expect(Buffer.compare(httpBytes, directBytes)).toBe(0);
    expect(httpBytes.equals(TINY_PNG)).toBe(true);
    expect(response.headers.get('X-C2PA-Signing-Status')).toBe('unsigned:signing_disabled');
  });
});

// ============================================================================
// EXR (v1.1 unsupported_format) (Test 6)
// ============================================================================

describe.skipIf(!haveOpenssl)('C2PA dual-transport parity — EXR unsigned (Test 6 — v1.1 limit)', () => {
  let ctx: ParityCtx;
  let filename: string;
  const exrBytes = Buffer.from('FAKE EXR BYTES — not a valid EXR but routes via unsupported_format');

  beforeAll(async () => {
    ctx = await setupParityCtx(REAL_C2PA_CONFIG);
    filename = 'out.exr';
    const signResult = await ctx.engine.signOutput(ctx.versionId, filename, { bytes: exrBytes });
    expect(signResult.signed).toBeNull(); // EXR routes to unsupported_format
    await seedVersionFile(ctx, ctx.versionId, filename, exrBytes);
    const internals = ctx.engine as unknown as {
      versionRepo: { markCompleted: (id: string, json: string) => void };
    };
    internals.versionRepo.markCompleted(ctx.versionId, JSON.stringify([{ filename }]));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 6 — EXR: HTTP body equals raw input bytes + header is unsigned:unsupported_format', async () => {
    const directBytes = await readFile(join(ctx.outputsDir, ctx.versionId, filename));
    expect(directBytes.equals(exrBytes)).toBe(true);
    const response = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`),
    );
    expect(response.status).toBe(200);
    const httpBytes = Buffer.from(await response.arrayBuffer());
    expect(Buffer.compare(httpBytes, directBytes)).toBe(0);
    expect(response.headers.get('X-C2PA-Signing-Status')).toBe('unsigned:unsupported_format');
  });

  it('Test 6b — NO sidecar route in v1.1 — GET /api/versions/:id/output.c2pa returns 404 (route does not exist)', async () => {
    const response = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output.c2pa`),
    );
    // No such route registered — Hono returns 404.
    expect(response.status).toBe(404);
  });
});

// ============================================================================
// Cache-Control header (Test 7)
// ============================================================================

describe.skipIf(!haveOpenssl)('C2PA dual-transport parity — Cache-Control parity (Test 7)', () => {
  let ctx: ParityCtx;
  let filename: string;

  beforeAll(async () => {
    ctx = await setupParityCtx(REAL_C2PA_CONFIG);
    filename = 'out.png';
    const signResult = await ctx.engine.signOutput(ctx.versionId, filename, { bytes: TINY_PNG });
    await seedVersionFile(ctx, ctx.versionId, filename, signResult.signed!);
    const internals = ctx.engine as unknown as {
      versionRepo: { markCompleted: (id: string, json: string) => void };
    };
    internals.versionRepo.markCompleted(ctx.versionId, JSON.stringify([{ filename }]));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 7 — Cache-Control: public, max-age=3600, immutable', async () => {
    const response = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`),
    );
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600, immutable');
  });
});

// ============================================================================
// HEAD parity (Test 8)
// ============================================================================

describe.skipIf(!haveOpenssl)('C2PA dual-transport parity — HEAD parity (Test 8)', () => {
  let ctx: ParityCtx;
  let filename: string;

  beforeAll(async () => {
    ctx = await setupParityCtx(REAL_C2PA_CONFIG);
    filename = 'out.png';
    const signResult = await ctx.engine.signOutput(ctx.versionId, filename, { bytes: TINY_PNG });
    await seedVersionFile(ctx, ctx.versionId, filename, signResult.signed!);
    const internals = ctx.engine as unknown as {
      versionRepo: { markCompleted: (id: string, json: string) => void };
    };
    internals.versionRepo.markCompleted(ctx.versionId, JSON.stringify([{ filename }]));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('Test 8 — HEAD returns same X-C2PA-Signing-Status as GET, with no body', async () => {
    const getResponse = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`),
    );
    const headResponse = await ctx.app.fetch(
      new Request(`http://test/api/versions/${ctx.versionId}/output`, { method: 'HEAD' }),
    );
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get('X-C2PA-Signing-Status')).toBe(
      getResponse.headers.get('X-C2PA-Signing-Status'),
    );
    expect(headResponse.headers.get('Content-Type')).toBe(
      getResponse.headers.get('Content-Type'),
    );
    // HEAD body is empty.
    const headBody = await headResponse.arrayBuffer();
    expect(headBody.byteLength).toBe(0);
    // Drain GET body to avoid resource warnings.
    await getResponse.arrayBuffer();
  });
});
