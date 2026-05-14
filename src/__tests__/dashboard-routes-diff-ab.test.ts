/**
 * Phase 22 / Plan 22-01 — HTTP boundary tests for the new
 * GET /api/versions/:a/diff-with/:b route (D-16).
 *
 * The engine.diffVersions function already accepts an arbitrary version pair
 * per RESEARCH Pitfall 2 — NO engine signature change. The pure diff.ts at
 * src/engine/diff.ts:27-33 throws TypedError('INVALID_INPUT') when the two
 * versions belong to different shots. The new HTTP route is a thin async
 * pass-through that surfaces this through the global typedErrorHandler.
 *
 * Coverage:
 *  1. Same-shot pair → 200 with { summary, changes, reproduction_divergence }
 *  2. Cross-shot pair → 400 INVALID_INPUT (engine guard)
 *  3. Unknown :a → 404 VERSION_NOT_FOUND
 *
 * Architecture-purity: server tree, ../engine/..., ../http/... — zero MCP SDK.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { Engine } from '../engine/pipeline.js';
import { HierarchyRepo } from '../store/hierarchy-repo.js';
import { VersionRepo } from '../store/version-repo.js';
import { ProvenanceRepo } from '../store/provenance-repo.js';
import { ProvenanceWriter } from '../engine/provenance.js';
import { FakeComfyUIClient } from '../test-utils/fake-comfyui-client.js';
import { makeInMemoryDb, type TestDb } from '../test-utils/fixtures.js';
import { createDashboardRouter } from '../http/dashboard-routes.js';
import { typedErrorHandler } from '../http/error-middleware.js';

interface Fixture {
  testDb: TestDb;
  engine: Engine;
  versionRepo: VersionRepo;
  provenanceWriter: ProvenanceWriter;
  app: Hono;
  shotAId: string;
  shotBId: string;
}

let fix: Fixture;

const BASE_BLOB = {
  '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
};

/**
 * Mirror of the seedCompleted helper used by src/engine/__tests__/pipeline.test.ts.
 * Inserts a version, writes submit + completed provenance events so
 * loadDiffSnapshot() can construct the DiffSnapshot pair, and marks the
 * version row completed with an empty outputs_json array.
 */
function seedCompleted(
  versionRepo: VersionRepo,
  writer: ProvenanceWriter,
  shotId: string,
  blob: Record<string, unknown> = BASE_BLOB,
): string {
  const row = versionRepo.insertVersion(shotId);
  writer.writeSubmitEvent(row.id, blob);
  writer.writeCompletedEvent(row.id, blob, '[]');
  versionRepo.markCompleted(row.id, '[]');
  return row.id;
}

beforeEach(() => {
  const testDb = makeInMemoryDb();
  const hierarchyRepo = new HierarchyRepo(testDb.db);
  const versionRepo = new VersionRepo(testDb.db);
  const provenanceRepo = new ProvenanceRepo(testDb.db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const engine = new Engine(
    testDb.db,
    hierarchyRepo,
    versionRepo,
    provenanceRepo,
    fake as never,
    'outputs',
  );

  // Build parent chain with TWO shots so the cross-shot test has a real pair.
  const ws = hierarchyRepo.createWorkspace(`ws-${nanoid(6)}`);
  const proj = hierarchyRepo.createProject(ws.id, `p-${nanoid(6)}`);
  const seq = hierarchyRepo.createSequence(proj.id, `sq010`);
  const shotA = hierarchyRepo.createShot(seq.id, `sh010`);
  const shotB = hierarchyRepo.createShot(seq.id, `sh020`);

  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);

  fix = {
    testDb,
    engine,
    versionRepo,
    provenanceWriter,
    app,
    shotAId: shotA.id,
    shotBId: shotB.id,
  };
});

interface DiffOk {
  summary: string;
  changes: Record<string, unknown>;
  reproduction_divergence: unknown;
}

interface DiffErr {
  error: { code: string; message: string };
}

describe('GET /api/versions/:a/diff-with/:b — happy path', () => {
  test('Test 1: same-shot pair returns 200 with { summary, changes, reproduction_divergence }', async () => {
    const v1 = seedCompleted(fix.versionRepo, fix.provenanceWriter, fix.shotAId, {
      '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    });
    const v2 = seedCompleted(fix.versionRepo, fix.provenanceWriter, fix.shotAId, {
      '3': { class_type: 'KSampler', inputs: { seed: 99, steps: 20, cfg: 7 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    });

    const res = await fix.app.request(`/api/versions/${v1}/diff-with/${v2}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiffOk;
    expect(typeof body.summary).toBe('string');
    expect(body.changes).toBeDefined();
    // reproduction_divergence is null for non-reproduce-lineage diffs.
    expect(body.reproduction_divergence).toBe(null);
  });
});

describe('GET /api/versions/:a/diff-with/:b — cross-shot guard', () => {
  test('Test 2: cross-shot pair returns 400 INVALID_INPUT (engine.diff.ts:27-33 enforced)', async () => {
    const vA = seedCompleted(fix.versionRepo, fix.provenanceWriter, fix.shotAId);
    const vB = seedCompleted(fix.versionRepo, fix.provenanceWriter, fix.shotBId);

    const res = await fix.app.request(`/api/versions/${vA}/diff-with/${vB}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as DiffErr;
    expect(body.error.code).toBe('INVALID_INPUT');
  });
});

describe('GET /api/versions/:a/diff-with/:b — unknown version', () => {
  test('Test 3: unknown :a → 404 VERSION_NOT_FOUND', async () => {
    const vB = seedCompleted(fix.versionRepo, fix.provenanceWriter, fix.shotAId);
    const res = await fix.app.request(`/api/versions/ver_missing/diff-with/${vB}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as DiffErr;
    expect(body.error.code).toBe('VERSION_NOT_FOUND');
  });
});
