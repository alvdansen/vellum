import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { GenerationEngine } from '../generation.js';
import { ProvenanceWriter } from '../provenance.js';
import { BreadcrumbResolver } from '../breadcrumb.js';

/**
 * Pivot Phase D — GenerationEngine.registerExternalOutput end-to-end.
 * An external output (URL) is ingested into a shot as a completed version stamped
 * with the reporting provider, with neutral provenance recorded.
 */
describe('registerExternalOutput', () => {
  let outputsDir: string;
  let versionRepo: VersionRepo;
  let provenanceRepo: ProvenanceRepo;
  let engine: GenerationEngine;
  let shotId: string;

  function mockFetch(bytes: Uint8Array): typeof fetch {
    return (async () =>
      new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) },
      })) as unknown as typeof fetch;
  }

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    outputsDir = mkdtempSync(join(tmpdir(), 'vellum-register-'));
    const hierarchy = new HierarchyRepo(db);
    versionRepo = new VersionRepo(db);
    provenanceRepo = new ProvenanceRepo(db);
    const provenanceWriter = new ProvenanceWriter(provenanceRepo);
    const breadcrumb = new BreadcrumbResolver(hierarchy, versionRepo);
    engine = new GenerationEngine(
      hierarchy,
      versionRepo,
      provenanceRepo,
      provenanceWriter,
      null, // no outbound client needed for registration
      breadcrumb,
      outputsDir,
      { ingestFetchImpl: mockFetch(new Uint8Array([1, 2, 3, 4])) },
    );
    const ws = hierarchy.createWorkspace('wsD');
    const proj = hierarchy.createProject(ws.id, 'pD');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    shotId = hierarchy.createShot(seq.id, 'sh010').id;
  });

  afterEach(() => {
    rmSync(outputsDir, { recursive: true, force: true });
  });

  test('creates a completed version stamped with the provider + stored output', async () => {
    const { entity } = await engine.registerExternalOutput({
      shotId,
      providerId: 'replicate',
      externalJobRef: 'pred_abc',
      outputs: [{ url: 'https://replicate.delivery/pbxt/xyz/render.png' }],
      provenance: { params: { prompt: 'a fox', seed: 7 }, model_id: 'owner/m:v1' },
    });

    expect(entity.status).toBe('completed');
    expect(entity.provider).toBe('replicate');
    expect(entity.job_id).toBe('pred_abc');
    expect(entity.version_number).toBe(1);

    const outputs = JSON.parse(entity.outputs_json ?? '[]') as Array<{ filename: string; size_bytes: number }>;
    expect(outputs).toHaveLength(1);
    expect(outputs[0].filename).toBe('render.png');
    expect(outputs[0].size_bytes).toBe(4);
  });

  test('records neutral provenance (provider_id + caller-asserted params) on the completed event', async () => {
    const { entity } = await engine.registerExternalOutput({
      shotId,
      providerId: 'replicate',
      outputs: [{ url: 'https://replicate.delivery/pbxt/xyz/render.png' }],
      provenance: { params: { prompt: 'a fox', seed: 7 } },
    });

    const completed = provenanceRepo.getLatestCompletedEvent(entity.id);
    expect(completed).not.toBeNull();
    expect(completed!.generation_result_json).not.toBeNull();
    const neutral = JSON.parse(completed!.generation_result_json!) as Record<string, unknown>;
    expect(neutral.provider_id).toBe('replicate');
    expect((neutral.params as Record<string, unknown>).seed).toBe(7);
    // ComfyUI-shaped columns are null for a URL-provider registration.
    expect(completed!.prompt_json).toBeNull();
  });

  test('rejects a non-allowlisted output URL and does NOT create a version (pre-flight)', async () => {
    await expect(
      engine.registerExternalOutput({
        shotId,
        providerId: 'replicate',
        outputs: [{ url: 'https://evil.example.com/o.png' }],
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });

    // Proof no orphan version was inserted: the next valid register is still v1.
    const { entity } = await engine.registerExternalOutput({
      shotId,
      providerId: 'replicate',
      outputs: [{ url: 'https://replicate.delivery/pbxt/xyz/ok.png' }],
    });
    expect(entity.version_number).toBe(1);
  });

  test('rejects registration for an unknown shot', async () => {
    await expect(
      engine.registerExternalOutput({
        shotId: 'shot_missing',
        providerId: 'replicate',
        outputs: [{ url: 'https://replicate.delivery/x/o.png' }],
      }),
    ).rejects.toMatchObject({ code: 'SHOT_NOT_FOUND' });
  });

  test('rejects an empty outputs list', async () => {
    await expect(
      engine.registerExternalOutput({ shotId, providerId: 'replicate', outputs: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test("a filename containing '..' is sanitized and still registers (no orphan version)", async () => {
    const { entity } = await engine.registerExternalOutput({
      shotId,
      providerId: 'replicate',
      outputs: [{ url: 'https://replicate.delivery/pbxt/xyz/render.png', filename: 'boom..png' }],
    });
    expect(entity.status).toBe('completed');
    const outputs = JSON.parse(entity.outputs_json ?? '[]') as Array<{ filename: string }>;
    expect(outputs[0].filename).not.toContain('..');
    expect(outputs[0].filename).toBe('boom.png');
  });

  test('partial multi-output failure marks the version failed AND cleans up already-downloaded files', async () => {
    // A fresh engine whose fetch serves the first URL then 404s the second.
    const { db } = makeInMemoryDb();
    const dir = mkdtempSync(join(tmpdir(), 'vellum-register-partial-'));
    const hierarchy = new HierarchyRepo(db);
    const vRepo = new VersionRepo(db);
    const pRepo = new ProvenanceRepo(db);
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const u = input instanceof URL ? input.href : String(input);
      if (u.includes('good.png')) {
        return new Response(new Uint8Array([1, 2, 3, 4]) as unknown as BodyInit, {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '4' },
        });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    const eng = new GenerationEngine(
      hierarchy,
      vRepo,
      pRepo,
      new ProvenanceWriter(pRepo),
      null,
      new BreadcrumbResolver(hierarchy, vRepo),
      dir,
      { ingestFetchImpl: fetchImpl },
    );
    const ws = hierarchy.createWorkspace('wp');
    const proj = hierarchy.createProject(ws.id, 'pp');
    const seq = hierarchy.createSequence(proj.id, 'sq010');
    const sh = hierarchy.createShot(seq.id, 'sh010');

    await expect(
      eng.registerExternalOutput({
        shotId: sh.id,
        providerId: 'replicate',
        outputs: [
          { url: 'https://replicate.delivery/a/good.png' },
          { url: 'https://replicate.delivery/a/bad.png' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });

    // The version is terminal-failed, and the first (already-downloaded) file was
    // unlinked — no dangling .png remains under the outputs dir.
    const pngs = readdirSync(dir, { recursive: true }) as string[];
    expect(pngs.filter((f) => String(f).endsWith('.png'))).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
