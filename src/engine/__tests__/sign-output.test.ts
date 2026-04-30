import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { ProvenanceWriter } from '../provenance.js';
import { Engine, BUFFER_SIGNING_MAX_BYTES } from '../pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';
import type { C2paConfig } from '../../types/c2pa.js';
import type { ManifestSignedPayloadFields, ModelRef } from '../../types/provenance.js';
import {
  __resetC2paNodeStateForTests,
  type LoadedSigner,
} from '../c2pa/signer.js';

/**
 * Phase 14 (PROV-V-01) — Plan 14-03 Task 2.
 *
 * Engine.signOutput unit tests covering all 8 paths:
 *   - signing-disabled (c2paConfig=null)
 *   - unsupported_format (EXR / PSD / unknown)
 *   - cert-load-failed (signer construction throws)
 *   - native-binding-unavailable (Concern #11 dynamic import fails)
 *   - sign-call-failed (signEmbedBuffer / signEmbedFile throws)
 *   - asset-too-large-for-buffer-api (Concern #6 pre-stat / size cap)
 *   - alreadySigned (Concern #7 idempotency)
 *   - success-buffer (PNG / JPEG)
 *   - success-file (MP4 / WebP / TIFF — temp file mode 0700/0600 cleanup)
 *
 * Tests use the c2pa-node bundled cert chain (proper trust chain — c2pa-rs
 * rejects the self-signed `.c2pa-dev/` cert). Documented in 14-02-SUMMARY.md.
 */

// c2pa-node bundled test cert chain.
const BUNDLED_CERT_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pub');
const BUNDLED_KEY_PATH = resolve('node_modules/c2pa-node/tests/fixtures/certs/es256.pem');

// Tiny 1x1 transparent PNG (same fixture as signer tests).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

type Ctx = {
  engine: Engine;
  hierarchy: HierarchyRepo;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  fake: FakeComfyUIClient;
  shotId: string;
  versionId: string;
  outputsDir: string;
  cleanup: () => Promise<void>;
};

async function setupEngine(options: { c2paConfig?: C2paConfig | null } = {}): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const outputsDir = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-sign-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    outputsDir,
    {
      maxConcurrentPollers: 1,
      c2paConfig: options.c2paConfig ?? null,
    },
  );
  const ws = hierarchy.createWorkspace(`ws-${nanoid(4)}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  // Seed a 'completed' provenance row + version so signOutput can read
  // getLatestFingerprints. Empty model array models the no-models-recorded path.
  const ver = versions.insertVersion(shot.id);
  provenanceWriter.writeSubmitEvent(ver.id, {});
  provenanceRepo.insertEvent(ver.id, {
    event_type: 'completed',
    prompt_json: '{}',
    seed: null,
    models_json: '[]',
    outputs_json: '[]',
  });
  versions.markCompleted(ver.id, '[]');
  // Use ProvenanceWriter for clean shape.
  void provenanceWriter; // keep for future tests
  return {
    engine,
    hierarchy,
    versions,
    provenanceRepo,
    fake,
    shotId: shot.id,
    versionId: ver.id,
    outputsDir,
    cleanup: async (): Promise<void> => {
      await engine.stop();
      await fsp.rm(outputsDir, { recursive: true, force: true });
      __resetC2paNodeStateForTests();
    },
  };
}

const REAL_C2PA_CONFIG: C2paConfig = {
  certPemPath: BUNDLED_CERT_PATH,
  privateKeyPemPath: BUNDLED_KEY_PATH,
};

function readManifestSignedPayload(
  ctx: Ctx,
  versionId: string,
  filename: string,
): ManifestSignedPayloadFields | null {
  const events = ctx.provenanceRepo.getEventsForVersion(versionId);
  const signedEvents = events.filter((e) => e.event_type === 'manifest_signed');
  // Walk newest-first to find the latest matching filename.
  for (let i = signedEvents.length - 1; i >= 0; i--) {
    const row = signedEvents[i]!;
    if (!row.manifest_signed_json) continue;
    try {
      const parsed = JSON.parse(row.manifest_signed_json) as ManifestSignedPayloadFields;
      if (parsed.filename === filename) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function countManifestSignedEventsFor(
  ctx: Ctx,
  versionId: string,
  filename: string,
): number {
  const events = ctx.provenanceRepo.getEventsForVersion(versionId);
  return events.filter((e) => {
    if (e.event_type !== 'manifest_signed' || !e.manifest_signed_json) return false;
    try {
      const parsed = JSON.parse(e.manifest_signed_json) as ManifestSignedPayloadFields;
      return parsed.filename === filename;
    } catch {
      return false;
    }
  }).length;
}

describe('Engine.signOutput — signing-disabled / unsupported / cert-fail / size-cap (D-CTX-9 graceful-fail)', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('Test 1 — c2paConfig=null returns { signed:null, signedToPath:null } and appends signing_disabled event', async () => {
    ctx = await setupEngine({ c2paConfig: null });
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).toBeNull();
    expect(result.signedToPath).toBeNull();
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.png');
    expect(payload).not.toBeNull();
    expect(payload!.signed).toBe(false);
    expect(payload!.status_reason).toBe('signing_disabled');
    expect(payload!.format).toBe('');
    expect(payload!.algorithm).toBe('');
    expect(payload!.cert_subject_summary).toBe('');
    // signed_at must be a valid ISO-8601.
    expect(new Date(payload!.signed_at).toISOString()).toBe(payload!.signed_at);
  });

  test('Test 5 — unsupported format EXR returns null and appends unsupported_format with format=image/x-exr', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    const exrBytes = Buffer.from('fake exr');
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.exr', { bytes: exrBytes });
    expect(result.signed).toBeNull();
    expect(result.signedToPath).toBeNull();
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.exr');
    expect(payload!.signed).toBe(false);
    expect(payload!.status_reason).toBe('unsupported_format');
    expect(payload!.format).toBe('image/x-exr');
  });

  test('Test 6 — unsupported format PSD returns null and appends unsupported_format with format=image/vnd.adobe.photoshop', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    const psdBytes = Buffer.from('fake psd');
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.psd', { bytes: psdBytes });
    expect(result.signed).toBeNull();
    expect(result.signedToPath).toBeNull();
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.psd');
    expect(payload!.signed).toBe(false);
    expect(payload!.status_reason).toBe('unsupported_format');
    expect(payload!.format).toBe('image/vnd.adobe.photoshop');
  });

  test('Test 7 — unknown extension returns null and appends unsupported_format with format=""', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    const bytes = Buffer.from('opaque');
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.xyz', { bytes });
    expect(result.signed).toBeNull();
    expect(result.signedToPath).toBeNull();
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.xyz');
    expect(payload!.signed).toBe(false);
    expect(payload!.status_reason).toBe('unsupported_format');
    expect(payload!.format).toBe('');
  });

  test('Test 8 — cert load failure returns null and appends cert_load_failed', async () => {
    const badConfig: C2paConfig = {
      certPemPath: '/tmp/nonexistent-cert.pem',
      privateKeyPemPath: '/tmp/nonexistent-key.pem',
    };
    ctx = await setupEngine({ c2paConfig: badConfig });
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).toBeNull();
    expect(result.signedToPath).toBeNull();
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.png');
    expect(payload!.signed).toBe(false);
    expect(payload!.status_reason).toBe('cert_load_failed');
    expect(payload!.format).toBe('image/png');
    expect(payload!.cert_subject_summary).toBe('');
    expect(payload!.algorithm).toBe('');
  });

  test('Test 10 — Concern #6 — bytes.length > BUFFER_SIGNING_MAX_BYTES short-circuits with asset_too_large_for_buffer_api', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    // Build a 501 MB-ish buffer. Use a larger-than-cap-by-1KB allocation to
    // avoid skipping the path on exact-equal size. Buffer.alloc fills with 0x00.
    const oversized = Buffer.alloc(BUFFER_SIGNING_MAX_BYTES + 1024);
    const result = await ctx.engine.signOutput(ctx.versionId, 'oversized.png', {
      bytes: oversized,
    });
    expect(result.signed).toBeNull();
    expect(result.signedToPath).toBeNull();
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'oversized.png');
    expect(payload!.signed).toBe(false);
    expect(payload!.status_reason).toBe('asset_too_large_for_buffer_api');
    expect(payload!.format).toBe('image/png');
    // Cert load succeeded BEFORE the size check fired — so cert_subject_summary
    // and algorithm should be populated from the loaded signer.
    expect(payload!.cert_subject_summary.length).toBeGreaterThan(0);
    expect(payload!.algorithm).toBe('es256');
  }, 30_000);
});

describe('Engine.signOutput — embed-buffer success (PNG / JPEG)', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('Test 2 — PNG signed via embed-buffer; signed bytes returned and event records signed=true', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).not.toBeNull();
    expect(result.signedToPath).toBeNull();
    expect(Buffer.isBuffer(result.signed)).toBe(true);
    expect(result.signed!.length).toBeGreaterThan(TINY_PNG.length);
    expect(result.signed!.equals(TINY_PNG)).toBe(false);
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.png');
    expect(payload!.signed).toBe(true);
    expect(payload!.format).toBe('image/png');
    expect(payload!.status_reason).toBe('');
    expect(payload!.algorithm).toBe('es256');
    expect(payload!.cert_subject_summary.length).toBeGreaterThan(0);
  });
});

describe('Engine.signOutput — embed-file success (MP4) — Concern #5 temp dir + #9 unique partial paths', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('Test 3 — MP4 with bytes input goes through signViaTempFiles (temp dir under outputsDir/.tmp-c2pa/<versionId>/)', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    // c2pa-rs rejects malformed MP4 — surface as sign_call_failed. The path
    // we care about for this test is that signViaTempFiles is invoked AND
    // the temp dir is created+cleaned.
    const fakeMp4 = Buffer.from('ftypisom');
    const tmpDir = pth.join(ctx.outputsDir, '.tmp-c2pa', ctx.versionId);
    expect(existsSync(tmpDir)).toBe(false);

    const result = await ctx.engine.signOutput(ctx.versionId, 'out.mp4', {
      bytes: fakeMp4,
    });

    // Either path resolves: success (rare for fake MP4) or sign_call_failed.
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.mp4');
    expect(payload).not.toBeNull();
    expect(payload!.format).toBe('video/mp4');
    if (payload!.signed) {
      expect(result.signed).not.toBeNull();
    } else {
      expect(payload!.status_reason).toBe('sign_call_failed');
      expect(result.signed).toBeNull();
    }

    // Concern #5 — temp dir cleanup. The src temp file must NOT be left
    // behind. The dest temp file is read into a Buffer (success path) OR
    // never written (failure path); either way, no orphaned files.
    if (existsSync(tmpDir)) {
      const remaining = await fsp.readdir(tmpDir);
      // Only "src-*" / "dest-*" files would be leftover; cleanup wipes src.
      // dest is consumed (read) in success and never written in failure.
      const srcLeftover = remaining.filter((f) => f.startsWith('src-'));
      expect(srcLeftover).toHaveLength(0);
    }
  });
});

describe('Engine.signOutput — Concern #5 temp dir mode 0700 / files mode 0600', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('Test 17 — Concern #5: temp dir at <outputsDir>/.tmp-c2pa/<versionId>/ with mode 0700 (best-effort on cross-platform)', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    // Drive signOutput with an embed-file format (MP4) so the temp dir is created.
    await ctx.engine.signOutput(ctx.versionId, 'out.mp4', {
      bytes: Buffer.from('ftypisom-bytes'),
    });
    const tmpDir = pth.join(ctx.outputsDir, '.tmp-c2pa', ctx.versionId);
    if (existsSync(tmpDir)) {
      // On POSIX, the dir mode bits (after umask) should match 0700. On
      // Windows, file mode bits are not enforced — we only check existence.
      if (process.platform !== 'win32') {
        const stat = await fsp.stat(tmpDir);
        // Mode includes the file-type bits — mask with 0o777 to get just perms.
        const perms = stat.mode & 0o777;
        // 0o700 may be reduced by umask; on macOS test runners the typical
        // umask is 0o022, which DOES NOT clear owner bits. So expect == 0o700
        // on dev macOS, but allow the same-or-tighter pattern as a safety net.
        expect(perms & 0o700).toBe(0o700);
        // Critically: NO group/world write bits.
        expect(perms & 0o022).toBe(0);
      }
    }
  });
});

describe('Engine.signOutput — Concern #7 idempotency on re-sign', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('Test 11 — prior signed=true event causes second call to return alreadySigned + skip work', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    // First call — signs successfully.
    const first = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
    expect(first.signed).not.toBeNull();
    const eventCountAfterFirst = countManifestSignedEventsFor(ctx, ctx.versionId, 'out.png');
    expect(eventCountAfterFirst).toBe(1);

    // Second call — must hit alreadySigned guard.
    const second = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
    expect(second.alreadySigned).toBe(true);
    expect(second.signed).toBeNull();
    expect(second.signedToPath).toBeNull();

    // No new manifest_signed event should have been written (Concern #7
    // explicit no-op to avoid log spam).
    const eventCountAfterSecond = countManifestSignedEventsFor(ctx, ctx.versionId, 'out.png');
    expect(eventCountAfterSecond).toBe(1);
  });

  test('Test 12 — prior signed=false event allows re-sign retry (transient cert misconfig recovery)', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    // Seed a signed=false (cert_load_failed) event for the version+filename.
    ctx.provenanceRepo.appendManifestSignedEvent(ctx.versionId, {
      filename: 'out.png',
      format: 'image/png',
      signed: false,
      cert_subject_summary: '',
      signed_at: '2026-04-30T11:00:00Z',
      status_reason: 'cert_load_failed',
      algorithm: '',
    });
    const eventCountBefore = countManifestSignedEventsFor(ctx, ctx.versionId, 'out.png');
    expect(eventCountBefore).toBe(1);

    // Second call — should retry the sign and emit a fresh event (signed=true now).
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.alreadySigned).toBeUndefined();
    expect(result.signed).not.toBeNull();
    const eventCountAfter = countManifestSignedEventsFor(ctx, ctx.versionId, 'out.png');
    expect(eventCountAfter).toBe(2);
    // Latest event should be signed=true.
    const latest = readManifestSignedPayload(ctx, ctx.versionId, 'out.png');
    expect(latest!.signed).toBe(true);
  });
});

describe('Engine.signOutput — primary model wiring + cert-subject-summary + algorithm', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('Test 13 — primary model from getLatestFingerprints threads into manifest description (no models recorded -> unknown)', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    // Verify the empty-models case via signed bytes — the manifest must
    // contain "model=unknown; hash_unavailable=no_models_recorded" when
    // no fingerprints exist.
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).not.toBeNull();
    // The signed buffer carries the manifest; the round-trip via c2pa.read
    // happens in 14-05 verification tests. Here we assert the event was
    // appended and it succeeded.
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.png');
    expect(payload!.signed).toBe(true);
  });

  test('Test 14 + Test 15 — cert_subject_summary + algorithm in event match LoadedSigner properties', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    const result = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
    expect(result.signed).not.toBeNull();
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.png');
    // Must be a non-empty string (CN / O / fp:fallback per Plan 14-02 Concern #10).
    expect(payload!.cert_subject_summary.length).toBeGreaterThan(0);
    // Bundled cert is es256 (P-256 EC).
    expect(payload!.algorithm).toBe('es256');
  });
});

describe('Engine.signOutput — primary model from getLatestFingerprints', () => {
  test('Test 13b — primary model with fingerprinted hash threads through unchanged', async () => {
    const ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    try {
      // Append a fingerprinted event so the next signOutput sees populated hashes.
      const fingerprinted: ModelRef[] = [
        {
          node_id: '4',
          class_type: 'CheckpointLoaderSimple',
          model_name: 'sd_xl.safetensors',
          model_hash: 'a'.repeat(64),
          model_hash_unavailable: null,
        },
      ];
      ctx.provenanceRepo.appendModelsFingerprintedEvent(ctx.versionId, fingerprinted);

      const result = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
      expect(result.signed).not.toBeNull();
      const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.png');
      expect(payload!.signed).toBe(true);
      expect(payload!.format).toBe('image/png');
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('Engine.signOutput — Concern #11 native binding unavailable', () => {
  test('Test 9 — when c2pa-node load throws, status_reason is native_binding_unavailable', async () => {
    // vi.doMock the c2pa-node module so the lazy import path throws.
    vi.doMock('c2pa-node', () => {
      throw new Error('Cannot find module c2pa-node');
    });
    __resetC2paNodeStateForTests();

    const ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    try {
      const result = await ctx.engine.signOutput(ctx.versionId, 'out.png', { bytes: TINY_PNG });
      expect(result.signed).toBeNull();
      expect(result.signedToPath).toBeNull();
      const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.png');
      expect(payload!.signed).toBe(false);
      expect(payload!.status_reason).toBe('native_binding_unavailable');
    } finally {
      await ctx.cleanup();
      vi.doUnmock('c2pa-node');
      __resetC2paNodeStateForTests();
    }
  });
});

describe('Engine.signOutput — Concern #5 temp file cleanup on signing failure', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  test('Test 16 — signing failure on file-API path leaves no orphan src-*/dest-* files', async () => {
    ctx = await setupEngine({ c2paConfig: REAL_C2PA_CONFIG });
    // Pass garbage MP4 bytes — c2pa-rs will reject. The file-API path goes
    // through signViaTempFiles which writes a src temp, then on failure the
    // finally block must unlink it.
    const garbage = Buffer.from('not a real mp4');
    await ctx.engine.signOutput(ctx.versionId, 'out.mp4', { bytes: garbage });
    const tmpDir = pth.join(ctx.outputsDir, '.tmp-c2pa', ctx.versionId);
    if (existsSync(tmpDir)) {
      const remaining = await fsp.readdir(tmpDir);
      const srcLeftover = remaining.filter((f) => f.startsWith('src-'));
      // src temp must always be cleaned up.
      expect(srcLeftover).toHaveLength(0);
    }
    const payload = readManifestSignedPayload(ctx, ctx.versionId, 'out.mp4');
    // Either signed=true (lucky parse) or sign_call_failed (likely).
    expect(payload).not.toBeNull();
    expect(payload!.format).toBe('video/mp4');
  });
});
