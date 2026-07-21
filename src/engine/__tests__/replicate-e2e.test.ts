import { describe, test, expect, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { BreadcrumbResolver } from '../breadcrumb.js';
import { GenerationEngine } from '../generation.js';
import { ProvenanceWriter } from '../provenance.js';
import { ReplicateAdapter } from '../../providers/replicate-adapter.js';

/**
 * Outbound Replicate E2E (pivot enhancement #1).
 *
 * Drives the REAL GenerationEngine composed with the REAL ReplicateAdapter — only
 * `fetch` is mocked. This is the first test to exercise the whole non-ComfyUI
 * provider seam end-to-end: submit → poll (starting/processing → succeeded) →
 * download from replicate.delivery → persist to disk → completed version + neutral
 * provenance. Unlike generation.test.ts (which uses FakeComfyUIClient), nothing
 * about the adapter is faked here, so the ComfyOutput{filename, subfolder, type:URL}
 * modelling contract between adapter and engine is validated for real.
 */

// Not a real PNG, just deterministic bytes; content-type header is what the
// engine's firstPngPath heuristic keys on, not the magic bytes.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jsonRes(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bytesRes(bytes: Uint8Array, contentType = 'image/png'): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
    },
  });
}

interface ReplicateScript {
  predictionId?: string;
  /** One entry consumed per GET /v1/predictions/{id}; the last entry sticks (terminal). */
  statuses: Array<Record<string, unknown>>;
  /** Override the delivery-download response for a given URL. Defaults to PNG_BYTES. */
  delivery?: (url: string) => Response;
  /** Records "METHOD url" for every fetch, for assertions. */
  seen?: string[];
  /** Records the parsed JSON body of every POST /v1/predictions, for assertions. */
  postBodies?: unknown[];
}

/**
 * A single mock `fetch` that routes Replicate's three call shapes:
 *   POST {base}/v1/predictions        → { id, status:'starting' }
 *   GET  {base}/v1/predictions/{id}   → next scripted status
 *   GET  https://replicate.delivery/… → asset bytes (or scripted override)
 */
function makeReplicateFetch(script: ReplicateScript): typeof fetch {
  const id = script.predictionId ?? 'pred_e2e';
  const queue = [...script.statuses];
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    script.seen?.push(`${method} ${url}`);
    if (method === 'POST' && url.endsWith('/v1/predictions')) {
      if (script.postBodies && init?.body != null) {
        script.postBodies.push(JSON.parse(String(init.body)));
      }
      return jsonRes({ id, status: 'starting' });
    }
    if (method === 'GET' && url.includes('/v1/predictions/')) {
      const next = queue.length > 1 ? queue.shift()! : queue[queue.length - 1];
      return jsonRes(next ?? { status: 'starting' });
    }
    // Anything else is a delivery download.
    return script.delivery ? script.delivery(url) : bytesRes(PNG_BYTES);
  }) as unknown as typeof fetch;
}

type Ctx = {
  engine: GenerationEngine;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  provenanceWriter: ProvenanceWriter;
  shotId: string;
  tempRoot: string;
};

const active: Ctx[] = [];

async function setup(
  fetchImpl: typeof fetch,
  opts: { additionalAllowedHosts?: string[] } = {},
): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const breadcrumb = new BreadcrumbResolver(hierarchy, versions);
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vellum-repl-e2e-${nanoid(6)}-`));
  const adapter = new ReplicateAdapter('r8_testtoken_abcdef', undefined, {
    fetchImpl,
    additionalAllowedHosts: opts.additionalAllowedHosts,
  });
  const engine = new GenerationEngine(
    hierarchy,
    versions,
    provenanceRepo,
    provenanceWriter,
    adapter,
    breadcrumb,
    tempRoot,
  );
  const ws = hierarchy.createWorkspace('wsR');
  const proj = hierarchy.createProject(ws.id, 'pR');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ctx: Ctx = {
    engine,
    versions,
    provenanceRepo,
    provenanceWriter,
    shotId: shot.id,
    tempRoot,
  };
  active.push(ctx);
  return ctx;
}

// A minimal, valid Replicate submit spec (provider-routed validateRequest).
const SPEC = { version: 'owner/model:abc123', input: { prompt: 'a red fox' } };

afterEach(async () => {
  for (const c of active.splice(0)) {
    await c.engine.stop();
    await fsp.rm(c.tempRoot, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

describe('outbound Replicate E2E (real Engine + real ReplicateAdapter)', () => {
  test('submit → poll(processing→succeeded) → download → persist: completes, stamped, on disk', async () => {
    const seen: string[] = [];
    const ctx = await setup(
      makeReplicateFetch({
        predictionId: 'pred_happy',
        statuses: [
          { status: 'processing' },
          { status: 'succeeded', output: 'https://replicate.delivery/pbxt/abc/render.png' },
        ],
        seen,
      }),
    );

    // Submit stamps provider + job_id from the prediction id.
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC, 'take-1');
    expect(sub.entity.provider).toBe('replicate');
    expect(sub.entity.job_id).toBe('pred_happy');
    expect(sub.entity.status).toBe('submitted');

    // Poll #1: processing → running (non-terminal transition).
    const p1 = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(p1.entity.status).toBe('running');

    // Poll #2: succeeded → download + persist + complete.
    const p2 = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(p2.entity.status).toBe('completed');
    expect(p2.entity.completed_at).not.toBeNull();

    const outputs = JSON.parse(p2.entity.outputs_json ?? '[]') as Array<{
      filename: string;
      path: string;
      size_bytes: number;
      content_type: string;
    }>;
    expect(outputs).toHaveLength(1);
    expect(outputs[0].filename).toBe('render.png');
    expect(outputs[0].size_bytes).toBe(PNG_BYTES.byteLength);
    expect(existsSync(outputs[0].path)).toBe(true);
    // Assert the BYTES on disk, not just the recorded/content-length echo.
    expect(statSync(outputs[0].path).size).toBe(PNG_BYTES.byteLength);

    // The file was actually fetched from the delivery host (real download path).
    expect(seen.some((s) => s.includes('replicate.delivery/pbxt/abc/render.png'))).toBe(true);

    // A completed provenance event exists (URL provider → prompt_json null).
    const completed = ctx.provenanceRepo.getLatestCompletedEvent(sub.entity.id);
    expect(completed).not.toBeNull();
    expect(completed!.prompt_json).toBeNull();
  });

  test('array output → every URL is persisted as its own output', async () => {
    const ctx = await setup(
      makeReplicateFetch({
        statuses: [
          {
            status: 'succeeded',
            output: [
              'https://replicate.delivery/a/one.png',
              'https://replicate.delivery/b/two.png',
            ],
          },
        ],
      }),
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);
    const done = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(done.entity.status).toBe('completed');
    const outputs = JSON.parse(done.entity.outputs_json ?? '[]') as Array<{
      filename: string;
      path: string;
    }>;
    expect(outputs.map((o) => o.filename).sort()).toEqual(['one.png', 'two.png']);
    for (const o of outputs) expect(existsSync(o.path)).toBe(true);
  });

  test('nested-object output shape → recursion still extracts the deep URL (adversarial-fix E2E)', async () => {
    const ctx = await setup(
      makeReplicateFetch({
        statuses: [
          {
            status: 'succeeded',
            // A model returning { images: [{ file: <url> }] } — a shallow scan
            // would silently drop this; the adapter recurses.
            output: { images: [{ file: 'https://replicate.delivery/n/deep.png' }] },
          },
        ],
      }),
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);
    const done = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(done.entity.status).toBe('completed');
    const outputs = JSON.parse(done.entity.outputs_json ?? '[]') as Array<{ filename: string }>;
    expect(outputs).toHaveLength(1);
    expect(outputs[0].filename).toBe('deep.png');
  });

  test('succeeded with no downloadable https URL → version FAILS (no silent empty success)', async () => {
    const seen: string[] = [];
    const ctx = await setup(
      makeReplicateFetch({
        statuses: [{ status: 'succeeded', output: 'the answer is 42' }],
        seen,
      }),
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);
    const done = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(done.entity.status).toBe('failed');
    // No delivery download was ever attempted.
    expect(seen.some((s) => s.includes('replicate.delivery'))).toBe(false);
    // The version row carries the actionable reason.
    expect(done.entity.error_message ?? '').toMatch(/downloadable/i);
  });

  test('provider-reported failure → version FAILS carrying the provider error', async () => {
    const ctx = await setup(
      makeReplicateFetch({
        statuses: [{ status: 'failed', error: 'CUDA out of memory' }],
      }),
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);
    const done = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(done.entity.status).toBe('failed');
    expect(done.entity.error_message ?? '').toContain('CUDA out of memory');
  });

  test('download from a non-allowlisted host → retries then FAILS with DOWNLOAD_FAILED, no file persisted', async () => {
    const ctx = await setup(
      makeReplicateFetch({
        // https, so it IS extracted as an output — but evil.example.com is not an
        // allowlisted delivery host, so downloadToPath rejects it (SSRF guard).
        statuses: [{ status: 'succeeded', output: 'https://evil.example.com/o.png' }],
      }),
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);

    // Retry backoff sleeps 2s+4s between the 3 attempts — auto-advance the clock.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done = await ctx.engine.getGenerationStatus(sub.entity.id);
    vi.useRealTimers();

    expect(done.entity.status).toBe('failed');
    expect(done.entity.error_code).toBe('DOWNLOAD_FAILED');
    const pngs = (await fsp.readdir(ctx.tempRoot, { recursive: true })) as string[];
    expect(pngs.filter((f) => String(f).endsWith('.png'))).toHaveLength(0);
  });

  test('multi-output partial failure → version FAILS with DOWNLOAD_FAILED, no completed event', async () => {
    const ctx = await setup(
      makeReplicateFetch({
        statuses: [
          {
            status: 'succeeded',
            output: [
              'https://replicate.delivery/a/one.png', // allowlisted → downloads
              'https://evil.example.com/two.png', // https but not allowlisted → fails the SSRF guard
            ],
          },
        ],
      }),
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);

    // The second output exhausts its 3 download attempts (2s+4s backoff).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done = await ctx.engine.getGenerationStatus(sub.entity.id);
    vi.useRealTimers();

    expect(done.entity.status).toBe('failed');
    expect(done.entity.error_code).toBe('DOWNLOAD_FAILED');
    // A partial failure writes NO completed provenance event — the version is not
    // silently marked complete with only the assets that happened to land.
    expect(ctx.provenanceRepo.getLatestCompletedEvent(sub.entity.id)).toBeNull();
    // The already-downloaded first output is intentionally RETAINED for debug/audit
    // (D-GEN-36) — unlike the register path, the outbound poll path does not unlink.
    const files = (await fsp.readdir(ctx.tempRoot, { recursive: true })) as string[];
    expect(files.some((f) => String(f).endsWith('one.png'))).toBe(true);
  });

  test('a legitimate custom delivery mirror can be allowlisted and downloads succeed', async () => {
    const ctx = await setup(
      makeReplicateFetch({
        statuses: [{ status: 'succeeded', output: 'https://cdn.mirror.example/x/mirror.png' }],
      }),
      { additionalAllowedHosts: ['mirror.example'] },
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);
    const done = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(done.entity.status).toBe('completed');
    const outputs = JSON.parse(done.entity.outputs_json ?? '[]') as Array<{ filename: string }>;
    expect(outputs[0].filename).toBe('mirror.png');
  });

  test('reproduce (request-replay): re-submits the EXACT original request as a lineage=reproduce version', async () => {
    const seen: string[] = [];
    const postBodies: unknown[] = [];
    const ctx = await setup(
      makeReplicateFetch({
        predictionId: 'pred_src',
        statuses: [{ status: 'succeeded', output: 'https://replicate.delivery/r/x.png' }],
        seen,
        postBodies,
      }),
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);
    const done = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(done.entity.status).toBe('completed');

    const repro = await ctx.engine.reproduceVersion(done.entity.id, 'repro-note');
    expect(repro.entity.lineage_type).toBe('reproduce');
    expect(repro.entity.parent_version_id).toBe(done.entity.id);
    expect(repro.entity.version_number).toBe(2);
    expect(repro.entity.provider).toBe('replicate');

    // Prove it replayed the EXACT original request body — not merely that 2 POSTs happened.
    const posts = seen.filter((s) => s.startsWith('POST') && s.includes('/v1/predictions'));
    expect(posts).toHaveLength(2); // original submit + reproduce
    expect(postBodies).toHaveLength(2);
    expect(postBodies[1]).toEqual(SPEC);
    expect(postBodies[1]).toEqual(postBodies[0]);

    // The params-replay warning names the provider and disclaims byte-identity.
    const warning = repro.reproduction_warnings.find((w) => /params-replay/i.test(w));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/replicate/i);
    expect(warning).toMatch(/not byte-identical/i);
  });

  test('reproduce re-runs validateRequest — a now-invalid stored request fails fast, no new version', async () => {
    const ctx = await setup(makeReplicateFetch({ statuses: [{ status: 'starting' }] }));
    // A completed Replicate version whose stored request is missing `version`.
    const v = ctx.versions.insertVersion(ctx.shotId, 'src', undefined, 'replicate');
    ctx.provenanceWriter.writeSubmitEvent(v.id, { input: { prompt: 'x' } });
    ctx.provenanceWriter.writeCompletedEvent(v.id, null, '[]');
    ctx.versions.markCompleted(v.id, '[]');
    await expect(ctx.engine.reproduceVersion(v.id)).rejects.toMatchObject({
      code: 'INVALID_REQUEST_FORMAT',
    });
    // validateRequest runs BEFORE insertVersion → no reproduce row was created
    // (a fresh insert claims v2, proving the failed reproduce consumed no version).
    expect(ctx.versions.insertVersion(ctx.shotId).version_number).toBe(2);
  });

  test('reproduce of a reproduce (chain) — the replay row is itself completable and replayable', async () => {
    const postBodies: unknown[] = [];
    const ctx = await setup(
      makeReplicateFetch({
        statuses: [{ status: 'succeeded', output: 'https://replicate.delivery/r/x.png' }],
        postBodies,
      }),
    );
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);
    const v1 = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(v1.entity.status).toBe('completed');

    const repro1 = await ctx.engine.reproduceVersion(v1.entity.id);
    const v2 = await ctx.engine.getGenerationStatus(repro1.entity.id);
    expect(v2.entity.status).toBe('completed');

    const repro2 = await ctx.engine.reproduceVersion(v2.entity.id);
    expect(repro2.entity.lineage_type).toBe('reproduce');
    expect(repro2.entity.parent_version_id).toBe(v2.entity.id);
    expect(repro2.entity.version_number).toBe(3);
    // All three POSTs replayed the identical original request.
    expect(postBodies).toEqual([SPEC, SPEC, SPEC]);
  });

  test('reproduce with no captured request → PROVENANCE_UNAVAILABLE', async () => {
    const ctx = await setup(makeReplicateFetch({ statuses: [{ status: 'starting' }] }));
    // Seed a completed Replicate version whose submit event was never written.
    const v = ctx.versions.insertVersion(ctx.shotId, 'src', undefined, 'replicate');
    ctx.provenanceWriter.writeCompletedEvent(v.id, null, '[]');
    ctx.versions.markCompleted(v.id, '[]');
    await expect(ctx.engine.reproduceVersion(v.id)).rejects.toMatchObject({
      code: 'PROVENANCE_UNAVAILABLE',
    });
  });

  test('reproduce of a version from a DIFFERENT provider than the default → REPRODUCE_BLOCKED', async () => {
    const ctx = await setup(makeReplicateFetch({ statuses: [{ status: 'starting' }] }));
    // A completed version stamped with a provider the current default (replicate) is not.
    const v = ctx.versions.insertVersion(ctx.shotId, 'src', undefined, 'comfyui-cloud');
    ctx.provenanceWriter.writeCompletedEvent(v.id, { '1': { class_type: 'KSampler', inputs: {} } }, '[]');
    ctx.versions.markCompleted(v.id, '[]');
    await expect(ctx.engine.reproduceVersion(v.id)).rejects.toMatchObject({
      code: 'REPRODUCE_BLOCKED',
    });
  });

  test('legacy null-provider (ComfyUI-era) version on a request-replay default → REPRODUCE_BLOCKED', async () => {
    const ctx = await setup(makeReplicateFetch({ statuses: [{ status: 'starting' }] }));
    // A pre-pivot row: provider=null, carries a resolved ComfyUI prompt blob. It
    // cannot run on the Replicate (request-replay) default, so reproduce blocks
    // cleanly rather than feeding a node graph to Replicate's validateRequest.
    const graph = { '3': { class_type: 'KSampler', inputs: { seed: 1 } } };
    const v = ctx.versions.insertVersion(ctx.shotId, 'legacy'); // no provider → null
    ctx.provenanceWriter.writeSubmitEvent(v.id, graph);
    ctx.provenanceWriter.writeCompletedEvent(v.id, graph, '[]');
    ctx.versions.markCompleted(v.id, '[]');
    await expect(ctx.engine.reproduceVersion(v.id)).rejects.toMatchObject({
      code: 'REPRODUCE_BLOCKED',
    });
  });
});
