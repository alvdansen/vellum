import { describe, test, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { BreadcrumbResolver } from '../breadcrumb.js';
import { GenerationEngine } from '../generation.js';
import { ProvenanceWriter } from '../provenance.js';
import { GoogleAIStudioAdapter, INLINE_OUTPUT_URL } from '../../providers/google-ai-studio-adapter.js';

/**
 * Google AI Studio E2E (real GenerationEngine + real GoogleAIStudioAdapter, only
 * `fetch` mocked). The novel bit under test is the SYNCHRONOUS inline-base64 bridge:
 * submit performs the generation and stashes decoded bytes, the first status poll
 * returns `completed` immediately, and downloadToPath writes the decoded bytes via
 * the ComfyOutput{filename, subfolder=job id, type=inline:index} locator contract —
 * no polling, no URL fetch. Proves the third adapter family works through the
 * unchanged engine.
 */

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');

function jsonRes(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

function imageFetch(n = 1, seen?: string[]): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : String(input);
    seen?.push(`${(init?.method ?? 'GET').toUpperCase()} ${url}`);
    return jsonRes({
      candidates: [
        {
          content: {
            role: 'model',
            parts: Array.from({ length: n }, () => ({ inlineData: { mimeType: 'image/png', data: PNG_B64 } })),
          },
        },
      ],
    });
  }) as unknown as typeof fetch;
}

type Ctx = {
  engine: GenerationEngine;
  versions: VersionRepo;
  provenanceRepo: ProvenanceRepo;
  shotId: string;
  tempRoot: string;
};
const active: Ctx[] = [];

async function setup(fetchImpl: typeof fetch): Promise<Ctx> {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const breadcrumb = new BreadcrumbResolver(hierarchy, versions);
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vellum-gais-e2e-${nanoid(6)}-`));
  const adapter = new GoogleAIStudioAdapter('AIza_testkey_abcdef', undefined, {
    fetchImpl,
    stagingRoot: pth.join(tempRoot, 'stage'),
  });
  const engine = new GenerationEngine(hierarchy, versions, provenanceRepo, provenanceWriter, adapter, breadcrumb, tempRoot);
  const ws = hierarchy.createWorkspace('wsG');
  const proj = hierarchy.createProject(ws.id, 'pG');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const ctx: Ctx = { engine, versions, provenanceRepo, shotId: shot.id, tempRoot };
  active.push(ctx);
  return ctx;
}

afterEach(async () => {
  for (const c of active.splice(0)) {
    await c.engine.stop();
    await fsp.rm(c.tempRoot, { recursive: true, force: true });
  }
});

const SPEC = { prompt: 'a storybook watercolor interior, soft light' };

describe('Google AI Studio E2E (real Engine + real adapter)', () => {
  test('submit → status(completed) → download persists decoded bytes, stamped + neutral provenance', async () => {
    const seen: string[] = [];
    const ctx = await setup(imageFetch(1, seen));

    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC, 'style-take-1');
    expect(sub.entity.provider).toBe('google-ai-studio');
    expect(sub.entity.job_id).toMatch(/^gais_/);
    expect(sub.entity.status).toBe('submitted');

    // The generation already happened at submit; the first poll completes.
    const p = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(p.entity.status).toBe('completed');
    expect(p.entity.completed_at).not.toBeNull();

    const outputs = JSON.parse(p.entity.outputs_json ?? '[]') as Array<{
      filename: string;
      path: string;
      size_bytes: number;
      content_type: string;
      url: string;
    }>;
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.content_type).toBe('image/png');
    expect(outputs[0]!.url).toBe(INLINE_OUTPUT_URL);
    expect(outputs[0]!.size_bytes).toBe(PNG_BYTES.byteLength);
    // Bytes actually on disk match the decoded base64.
    expect(readFileSync(outputs[0]!.path)).toEqual(PNG_BYTES);

    // Exactly one API call (submit); status/download never hit the network.
    expect(seen.filter((s) => s.includes('generateContent'))).toHaveLength(1);

    // Neutral provenance recorded for cross-provider diff.
    const completed = ctx.provenanceRepo.getLatestCompletedEvent(sub.entity.id);
    const neutral = JSON.parse(completed?.generation_result_json ?? '{}');
    expect(neutral.provider_id).toBe('google-ai-studio');
    expect(neutral.model_id).toBe('gemini-2.5-flash-image');
  });

  test('a safety-blocked response fails the version at submit (no silent empty success)', async () => {
    const blockFetch = (async () => jsonRes({ promptFeedback: { blockReason: 'SAFETY' } })) as unknown as typeof fetch;
    const ctx = await setup(blockFetch);
    await expect(ctx.engine.submitGeneration(ctx.shotId, SPEC)).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR' });
    // The version row is marked failed, not left dangling.
    const list = ctx.versions.listAllForShot(ctx.shotId);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('failed');
  });

  test('multi-image generation persists every decoded output', async () => {
    const ctx = await setup(imageFetch(2));
    const sub = await ctx.engine.submitGeneration(ctx.shotId, SPEC);
    const p = await ctx.engine.getGenerationStatus(sub.entity.id);
    expect(p.entity.status).toBe('completed');
    const outputs = JSON.parse(p.entity.outputs_json ?? '[]') as Array<{ path: string }>;
    expect(outputs).toHaveLength(2);
    for (const o of outputs) expect(readFileSync(o.path)).toEqual(PNG_BYTES);
  });
});
