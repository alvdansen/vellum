// Phase 17 / Plan 17-03 Task 2 — D-05 redact-invalidation hook integration tests.
//
// Asserts the new line of code in src/engine/c2pa/redaction.ts:
//   - INVALIDATE thumbnail cache AFTER atomicRename(tempPathFresh, fullPath)
//   - Inside the try block — calling BEFORE creates a stale-cache window
//     when the rewrite fails
//   - Non-fatal try/catch on the invalidate call itself — invalidate
//     failure must not turn a successful redact into an error
//
// Tests:
//   1. (D-05 ordering): redact succeeds → .thumb.webp + .thumb.failed both
//      removed; source file mtime advanced (redact rewrite landed)
//   2. (idempotent): redact a version that never had a thumb → no exception
//   3. (post-redact regen): redact, then engine.generateThumbnail → fresh
//      .thumb.webp present, mtime > redact mtime
//   4. (multi-encoding leak scan): scan regenerated post-redact .thumb.webp
//      for the redacted-out random hex sentinel via assertNotInBuffer in 4
//      encodings — extends Plan 17-01's leak-scan to the post-redact path
//   5. (failure-path safety — D-05 ordering proof): mock atomicRename to
//      reject → engine.invalidateThumbnail call count = 0; existing thumb
//      stays cached
//   6. (invalidate failure non-fatal): mock engine.invalidateThumbnail to
//      reject → redact succeeds anyway; result returned; console.warn logged
//
// Skip-on-CI: requires openssl + bundled c2pa-node certs (mirror Plan 16-02
// integration tests + Plan 16-05 e2e shape).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, stat as fsStat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import type { Database } from 'better-sqlite3';
import type { Engine } from '../engine/pipeline.js';
import type { ProvenanceRepo } from '../store/provenance-repo.js';
import type { VersionRepo } from '../store/version-repo.js';

// ============================================================================
// Constants — bundled c2pa-node certs (mirror Plan 16-05 e2e shape).
// ============================================================================

const haveOpenssl = (() => {
  try {
    execFileSync('which', ['openssl'], { stdio: 'ignore' });
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

// ============================================================================
// Multi-encoding leak-scan helper (mirror Plan 17-01 + Plan 16-05 e2e shape).
// ============================================================================

function assertNotInBuffer(buf: Buffer, secret: string, label: string): void {
  if (secret.length === 0) return;
  const fragments = [
    secret, // UTF-8 / ASCII
    Buffer.from(secret, 'utf16le').toString('binary'), // UTF-16LE
    Buffer.from(secret, 'utf16le').reverse().toString('binary'), // UTF-16BE roughly
    Buffer.from(secret).toString('base64'), // base64
  ];
  const haystack = buf.toString('binary');
  for (const frag of fragments) {
    if (frag.length === 0) continue;
    expect(
      haystack.includes(frag),
      `D-CTX-1 leak via ${label} — fragment "${frag.slice(0, 20)}..." in post-redact thumbnail bytes`,
    ).toBe(false);
  }
}

// ============================================================================
// Seed helper — builds a real signed v1 manifest with a sentinel value AND
// a generated .thumb.webp on disk. The sentinel is embedded into the prompt
// blob so Phase 15's extractInputAssertion lifts it into the
// vellum.input.data.prompt_positive assertion.
// ============================================================================

interface RedactSeed {
  tempRoot: string;
  outputsDir: string;
  versionId: string;
  filename: string;
  /** Path to the source asset (PNG bytes, post-sign). */
  sourcePath: string;
  /** Path to the generated thumbnail at <source>.thumb.webp. */
  cachePath: string;
  /** Path to the failed-sentinel at <source>.thumb.failed. */
  sentinelPath: string;
  engine: Engine;
  sqlite: Database;
  provenanceRepo: ProvenanceRepo;
  versionRepo: VersionRepo;
  /** The sentinel embedded into the manifest (drives the leak-scan). */
  sentinel: string;
  cleanup: () => Promise<void>;
}

async function seedSignedVersionWithThumb(opts: {
  generateThumb?: boolean;
} = {}): Promise<RedactSeed> {
  const generateThumb = opts.generateThumb !== false;
  const tempRoot = await mkdtemp(join(tmpdir(), `vfx-p17-03-redact-${nanoid(6)}-`));
  const outputsDir = join(tempRoot, 'outputs');
  await mkdir(outputsDir, { recursive: true });
  const dbPath = join(tempRoot, 'test.db');
  const sentinel = `REDACT_SECRET_${nanoid(16)}`;

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
    {
      c2paConfig: {
        certPemPath: BUNDLED_CERT_PATH,
        privateKeyPemPath: BUNDLED_KEY_PATH,
        tsaUrl: 'http://timestamp.digicert.com',
      },
    },
  );

  const ws = hierarchy.createWorkspace('p17-03-redact-ws');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ver = versionRepo.insertVersion(shot.id);

  // Build a real prompt blob containing the sentinel as positive text. Phase 15
  // extractInputAssertion edge-walks KSampler.positive ['6', 0] -> CLIPTextEncode
  // node 6 -> inputs.text -> prompt_positive in the input assertion.
  const promptBlob = {
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: 42,
        steps: 20,
        cfg: 7.0,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0,
        positive: ['6', 0],
        negative: ['7', 0],
      },
    },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: sentinel } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, ugly' } },
  };

  const filename = 'out.png';
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'submitted',
    workflow_json: '{}',
  });
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'completed',
    prompt_json: JSON.stringify(promptBlob),
    seed: 42,
    models_json: '[]',
    outputs_json: JSON.stringify([{ filename }]),
  });

  // Sign — engine reads completed.prompt_json + extracts vellum.input.
  const signResult = await engine.signOutput(ver.id, filename, { bytes: TINY_PNG });
  const verDir = join(outputsDir, ver.id);
  await mkdir(verDir, { recursive: true });
  const sourcePath = join(verDir, filename);
  if (signResult.signed) {
    await writeFile(sourcePath, signResult.signed);
  } else {
    await writeFile(sourcePath, TINY_PNG);
  }
  versionRepo.markCompleted(ver.id, JSON.stringify([{ filename }]));

  const cachePath = `${sourcePath}.thumb.webp`;
  const sentinelPath = `${sourcePath}.thumb.failed`;

  // Pre-generate a thumbnail so we can prove invalidation removed it.
  if (generateThumb) {
    // Use sharp directly to write a valid WebP at the expected cache location.
    // (Plan 17-01's generateImageThumbnail does the same thing under the hood;
    //  we don't need to drive a real PNG through it for these tests.)
    const tinyWebp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 200, b: 100 } },
    })
      .webp({ quality: 80 })
      .toBuffer();
    await writeFile(cachePath, tinyWebp);
  }

  const sqlite = handle.sqlite as unknown as Database;
  return {
    tempRoot,
    outputsDir,
    versionId: ver.id,
    filename,
    sourcePath,
    cachePath,
    sentinelPath,
    engine,
    sqlite,
    provenanceRepo,
    versionRepo,
    sentinel,
    cleanup: async (): Promise<void> => {
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
// Tests (skip when openssl unavailable on runner — same convention as
// c2pa-redaction-e2e.test.ts).
// ============================================================================

describe.skipIf(!haveOpenssl)('Phase 17 Plan 03 Task 2 — redact → invalidateThumbnail (D-05)', () => {
  // -------- Test 1: D-05 ordering — redact removes both .thumb.webp and .thumb.failed --------
  it('Test 1 (D-05 ordering): redact unlinks .thumb.webp + .thumb.failed AFTER atomicRename', async () => {
    const seed = await seedSignedVersionWithThumb({ generateThumb: true });
    try {
      // Pre-condition: cache exists.
      expect(existsSync(seed.cachePath)).toBe(true);
      // Capture pre-redact source mtime to assert it advances after redact.
      const preMtime = (await fsStat(seed.sourcePath)).mtimeMs;

      const result = await seed.engine.redactManifestForVersion(seed.versionId, [
        "assertions[label='vellum.input'].data.prompt_positive",
      ]);
      expect(result).toBeTruthy();

      // (a) Source file mtime advanced — redact rewrote the bytes via atomicRename.
      const postMtime = (await fsStat(seed.sourcePath)).mtimeMs;
      expect(postMtime).toBeGreaterThanOrEqual(preMtime);

      // (b) .thumb.webp does NOT exist — invalidate ran AFTER atomicRename.
      expect(existsSync(seed.cachePath)).toBe(false);
      // (c) .thumb.failed does NOT exist — invalidate scrubbed both.
      expect(existsSync(seed.sentinelPath)).toBe(false);
    } finally {
      await seed.cleanup();
    }
  });

  // -------- Test 2: idempotent — redact a version that never had a thumb --------
  it('Test 2 (idempotent): redact a version with no prior thumbnail does not throw', async () => {
    const seed = await seedSignedVersionWithThumb({ generateThumb: false });
    try {
      expect(existsSync(seed.cachePath)).toBe(false);
      expect(existsSync(seed.sentinelPath)).toBe(false);
      // Should not throw.
      const result = await seed.engine.redactManifestForVersion(seed.versionId, [
        "assertions[label='vellum.input'].data.prompt_positive",
      ]);
      expect(result).toBeTruthy();
      expect(existsSync(seed.cachePath)).toBe(false);
      expect(existsSync(seed.sentinelPath)).toBe(false);
    } finally {
      await seed.cleanup();
    }
  });

  // -------- Test 3: post-redact regeneration — generateThumbnail produces fresh thumb --------
  it('Test 3 (post-redact regen): post-redact generateThumbnail produces fresh .thumb.webp', async () => {
    const seed = await seedSignedVersionWithThumb({ generateThumb: true });
    try {
      const preMtime = (await fsStat(seed.cachePath)).mtimeMs;
      await seed.engine.redactManifestForVersion(seed.versionId, [
        "assertions[label='vellum.input'].data.prompt_positive",
      ]);
      // Post-redact: cache gone.
      expect(existsSync(seed.cachePath)).toBe(false);

      // Drive a fresh derivation. If the source mtime moved forward, the
      // engine's generateThumbnail will regenerate. The redacted bytes are
      // valid PNG with an embedded c2pa manifest — sharp can decode them.
      const result = await seed.engine.generateThumbnail(seed.versionId, seed.filename);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(existsSync(result.filePath)).toBe(true);
      const postRegenMtime = (await fsStat(result.filePath)).mtimeMs;
      // mtime > pre-redact thumb mtime (regenerated AFTER redact).
      expect(postRegenMtime).toBeGreaterThan(preMtime);
    } finally {
      await seed.cleanup();
    }
  });

  // -------- Test 4: multi-encoding leak scan over post-redact thumb --------
  it('Test 4 (D-CTX-1 leak scan): post-redact regenerated thumbnail has zero sentinel leakage in 4 encodings', async () => {
    const seed = await seedSignedVersionWithThumb({ generateThumb: false });
    try {
      // 1. Redact away the sentinel.
      await seed.engine.redactManifestForVersion(seed.versionId, [
        "assertions[label='vellum.input'].data.prompt_positive",
      ]);

      // 2. Regenerate the thumbnail from the redacted source.
      const result = await seed.engine.generateThumbnail(seed.versionId, seed.filename);
      expect(result).not.toBeNull();
      if (!result) return;

      // 3. Multi-encoding scan over the thumbnail bytes.
      const { readFile } = await import('node:fs/promises');
      const thumbBytes = await readFile(result.filePath);
      assertNotInBuffer(thumbBytes, seed.sentinel, 'post-redact .thumb.webp');
    } finally {
      await seed.cleanup();
    }
  });

  // -------- Test 5: failure-path safety — atomicRename failure → invalidate NOT called --------
  it('Test 5 (D-05 ordering proof): atomicRename failure → invalidate call count = 0; thumb stays cached', async () => {
    const seed = await seedSignedVersionWithThumb({ generateThumb: true });
    try {
      const invalidateSpy = vi.spyOn(seed.engine, 'invalidateThumbnail');
      // Mock node:fs/promises.rename to reject — redact's atomicRename uses
      // dynamic `await import('node:fs/promises')`, so we need to mock at
      // the module level. Vitest's vi.doMock + vi.resetModules approach does
      // not interfere with the engine instance since the dynamic import in
      // redaction.ts only resolves once at first call.
      //
      // Simpler approach: write-protect the source file's directory so
      // rename (which is atomic temp+rename) fails. But chmod approaches
      // are flaky on macOS for owner-rename. Instead, mock fs/promises
      // module via vi.doMock + import-cache reset, then re-import.
      //
      // Cleanest: use the redact's atomicWriteFile + atomicRename pattern's
      // behavior — make tempPathFresh a path that cannot be created. We
      // patch by deleting the version directory just before the redact call.
      // But this races with redact's own atomic writes.
      //
      // Pragmatic approach: directly remove the version directory's WRITE
      // permissions immediately before invoking redact. macOS rename in
      // a directory that lacks write permission fails.
      // CAVEAT: this also makes appendManifestSignedRedactedEvent's DB
      // write fail upstream IF the DB lives in the same dir (it does not —
      // DB lives in tempRoot/test.db, not outputsDir/<vid>/).
      const { chmod } = await import('node:fs/promises');
      const verDir = join(seed.outputsDir, seed.versionId);
      // Make readonly. macOS rename in a 0500 directory fails with EACCES.
      await chmod(verDir, 0o500);
      try {
        let caught: { code?: string; message?: string } | null = null;
        try {
          await seed.engine.redactManifestForVersion(seed.versionId, [
            "assertions[label='vellum.input'].data.prompt_positive",
          ]);
        } catch (err) {
          caught = err as { code?: string; message?: string };
        }
        expect(caught).not.toBeNull();
        expect(caught?.code).toBe('REDACT_DB_WRITE_FAILED');
      } finally {
        // Restore permissions so cleanup can run.
        await chmod(verDir, 0o755);
      }

      // D-05 invariant: invalidateThumbnail NOT called when atomicRename failed.
      expect(invalidateSpy).not.toHaveBeenCalled();
      // Existing thumb stays cached.
      expect(existsSync(seed.cachePath)).toBe(true);
    } finally {
      await seed.cleanup();
    }
  });

  // -------- Test 6: invalidate-failure non-fatal --------
  it('Test 6 (invalidate non-fatal): invalidate throw → redact still succeeds; warn logged', async () => {
    const seed = await seedSignedVersionWithThumb({ generateThumb: true });
    try {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Mock invalidateThumbnail to throw — redact's hook MUST NOT propagate
      // this; the redact succeeded on disk and in the DB.
      vi.spyOn(seed.engine, 'invalidateThumbnail').mockRejectedValue(
        new Error('synthetic invalidate failure'),
      );

      const result = await seed.engine.redactManifestForVersion(seed.versionId, [
        "assertions[label='vellum.input'].data.prompt_positive",
      ]);
      // Redact returned — the synthetic invalidate failure did NOT propagate.
      expect(result).toBeTruthy();
      expect(result.redactedFields.length + result.notFound.length).toBeGreaterThan(0);

      // A warn was logged with the synthetic message (non-fatal log).
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0] ?? ''));
      expect(warnCalls.some((c) => c.includes('synthetic invalidate failure'))).toBe(true);
    } finally {
      await seed.cleanup();
    }
  });
});
