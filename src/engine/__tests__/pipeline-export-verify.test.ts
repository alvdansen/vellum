/**
 * Phase 16 / Plan 16-01 Task 3 — Engine facade tests for
 * exportManifestForVersion + verifyManifestForVersion.
 *
 * These are SHALLOW tests — the deep behavior is locked in
 * src/engine/c2pa/__tests__/exporter.test.ts + verifier.test.ts. Here we
 * confirm the Engine class's lazy-import facade plumbing wires the engine's
 * own this.outputRoot + this.versionRepo + this.provenanceRepo to the
 * underlying engine modules.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';
import type { ManifestSignedPayloadFields } from '../../types/provenance.js';

const PNG_FIXTURE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(56, 0xab),
]);

interface TestCtx {
  engine: Engine;
  versionId: string;
  filename: string;
  outputsDir: string;
  versionRepo: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  cleanup: () => Promise<void>;
}

async function setup(opts: {
  withDiskFile: boolean;
  outputs?: string | null;
  manifestEvent?: ManifestSignedPayloadFields | null;
}): Promise<TestCtx> {
  const filename = 'output.png';
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const fake = new FakeComfyUIClient();
  const outputsDir = await mkdtemp(join(tmpdir(), `vfx-pipeline-ev-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    outputsDir,
    {
      maxConcurrentPollers: 1,
      c2paConfig: null, // signing OFF — facade just delegates to engine modules
    },
  );

  // Seed hierarchy + version row.
  const ws = hierarchy.createWorkspace(`ws-${nanoid(4)}`);
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ver = versions.insertVersion(shot.id);
  const outputsJson =
    opts.outputs === undefined
      ? JSON.stringify([{ filename }])
      : opts.outputs;
  versions.markCompleted(ver.id, outputsJson ?? '[]');

  if (opts.withDiskFile) {
    const verDir = join(outputsDir, ver.id);
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, filename), PNG_FIXTURE);
  }

  if (opts.manifestEvent) {
    provenanceRepo.appendManifestSignedEvent(ver.id, opts.manifestEvent);
  }

  return {
    engine,
    versionId: ver.id,
    filename,
    outputsDir,
    versionRepo: versions,
    provenanceRepo,
    cleanup: async () => {
      await engine.stop();
      await rm(outputsDir, { recursive: true, force: true });
    },
  };
}

describe('Engine.exportManifestForVersion (PROV-V-07)', () => {
  let ctx: TestCtx;
  afterEach(async () => {
    if (ctx) await ctx.cleanup();
  });

  it('delegates to exporter with this.outputRoot + this.provenanceRepo (present branch)', async () => {
    ctx = await setup({
      withDiskFile: true,
      manifestEvent: {
        filename: 'output.png',
        format: 'image/png',
        signed: true,
        cert_subject_summary: 'CN=test-cert',
        signed_at: '2026-04-30T12:00:00.000Z',
        status_reason: '',
        algorithm: 'Es256',
      },
    });

    const result = await ctx.engine.exportManifestForVersion(ctx.versionId);
    expect(result.manifest_status).toBe('present');
    expect(result.format).toBe('image/png');
    expect(result.cert_subject).toBe('CN=test-cert');
    // base64-decoded must equal disk fixture byte-identically
    expect(result.manifest_bytes_base64).not.toBeNull();
    const decoded = Buffer.from(result.manifest_bytes_base64!, 'base64');
    expect(decoded.equals(PNG_FIXTURE)).toBe(true);
  });

  it('returns absent when no manifest_signed event exists', async () => {
    ctx = await setup({ withDiskFile: false });
    const result = await ctx.engine.exportManifestForVersion(ctx.versionId);
    expect(result.manifest_status).toBe('absent');
    expect(result.manifest_bytes_base64).toBeNull();
  });

  it('throws VERSION_NOT_FOUND on missing version', async () => {
    ctx = await setup({ withDiskFile: false });
    await expect(
      ctx.engine.exportManifestForVersion('ver_does_not_exist'),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'VERSION_NOT_FOUND',
    });
  });
});

describe('Engine.verifyManifestForVersion (PROV-V-07)', () => {
  let ctx: TestCtx;
  afterEach(async () => {
    if (ctx) await ctx.cleanup();
  });

  it('versionId-form returns no_manifest when signed=false (signing_disabled)', async () => {
    ctx = await setup({
      withDiskFile: false,
      manifestEvent: {
        filename: 'output.png',
        format: 'image/png',
        signed: false,
        cert_subject_summary: '',
        signed_at: '2026-04-30T12:00:00.000Z',
        status_reason: 'signing_disabled',
        algorithm: '',
      },
    });
    const r = await ctx.engine.verifyManifestForVersion({ versionId: ctx.versionId });
    expect(r.signature_status).toBe('no_manifest');
    expect(r.valid).toBe(false);
  });

  it('manifestBytes-form on plain (unsigned) PNG returns no_manifest', async () => {
    ctx = await setup({ withDiskFile: false });
    const r = await ctx.engine.verifyManifestForVersion({
      manifestBytes: PNG_FIXTURE,
      format: 'image/png',
    });
    expect(r.signature_status).toBe('no_manifest');
    expect(r.valid).toBe(false);
  });

  it('versionId-form on missing version throws VERSION_NOT_FOUND', async () => {
    ctx = await setup({ withDiskFile: false });
    await expect(
      ctx.engine.verifyManifestForVersion({ versionId: 'ver_does_not_exist' }),
    ).rejects.toMatchObject({
      name: 'TypedError',
      code: 'VERSION_NOT_FOUND',
    });
  });
});
