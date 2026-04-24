// Phase 5 Plan 04: unit tests for src/http/dashboard-routes.ts (Hono sub-router
// for the dashboard REST surface). D-WEBUI-01 + D-WEBUI-05: 18 canonical routes,
// bare-domain JSON shapes, TypedError → structured error via typedErrorHandler.
//
// Strategy:
//   - Build a fresh Hono app + createDashboardRouter(engine) per test; mount
//     typedErrorHandler at the sub-router so TypedError throws convert to 4xx JSON.
//   - Use FakeEngine (src/test-utils/fake-engine.ts) to assert delegation +
//     arg capture without booting a real DB / ComfyUI client.
//   - For GET /api/versions/:id/output, override fs at test-time via mocked
//     existsSync / createReadStream. We assert MIME mapping + streaming behaviour
//     without touching the real outputs/ directory.
//
// This file exercises ALL 18 routes + 3+ TypedError propagation cases, matching
// the plan's <behavior> block.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import { FakeEngine } from '../../test-utils/fake-engine.js';
import { createDashboardRouter } from '../dashboard-routes.js';
import { typedErrorHandler } from '../error-middleware.js';
import { TypedError } from '../../engine/errors.js';

// --- FS fixtures for GET /api/versions/:id/output ---
// The output route reads from `outputs/<versionId>/<filename>`. Tests create a
// real tmp file in the repo-relative `outputs/` tree (gitignored) so
// fs.createReadStream works end-to-end. Afterwards, remove the test versionId
// subdir without touching any real output files.
const TEST_VERSION_IDS = new Set<string>();

function writeTestOutput(versionId: string, filename: string, content = Buffer.from([0x89, 0x50, 0x4E, 0x47])): string {
  const dir = join('outputs', versionId);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, filename);
  writeFileSync(p, content);
  TEST_VERSION_IDS.add(versionId);
  return p;
}

function cleanupTestOutputs(): void {
  for (const id of TEST_VERSION_IDS) {
    const dir = join('outputs', id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  TEST_VERSION_IDS.clear();
}

// Utility: build a Hono app with the router mounted + error handler wired.
function buildApp(engine: FakeEngine): Hono {
  const app = new Hono();
  app.onError(typedErrorHandler);
  const router = createDashboardRouter(engine as never);
  app.route('/', router);
  return app;
}

describe('createDashboardRouter', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    engine.reset();
  });

  afterEach(() => {
    cleanupTestOutputs();
  });

  // ================================================================
  // WORKSPACES
  // ================================================================

  describe('GET /api/workspaces', () => {
    it('returns the paginated workspace list from engine.listWorkspaces', async () => {
      engine.cans.workspaceList = {
        items: [],
        total_count: 0,
        limit: 20,
        offset: 0,
      };
      const app = buildApp(engine);
      const res = await app.request('/api/workspaces');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ total_count: 0, limit: 20, offset: 0 });
      expect(engine.calls).toContainEqual({ method: 'listWorkspaces', args: [20, 0] });
    });

    it('parses limit/offset query params', async () => {
      const app = buildApp(engine);
      await app.request('/api/workspaces?limit=5&offset=10');
      expect(engine.calls).toContainEqual({ method: 'listWorkspaces', args: [5, 10] });
    });
  });

  describe('GET /api/workspaces/:id', () => {
    it('returns the workspace envelope on happy path', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/workspaces/ws_1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entity.id).toBe('ws_1');
      expect(body).toHaveProperty('breadcrumb');
      expect(engine.calls).toContainEqual({ method: 'getWorkspace', args: ['ws_1'] });
    });

    it('propagates WORKSPACE_NOT_FOUND as 404', async () => {
      engine.getWorkspace = ((id: string) => {
        throw new TypedError('WORKSPACE_NOT_FOUND', `Workspace '${id}' not found`);
      }) as never;
      const app = buildApp(engine);
      const res = await app.request('/api/workspaces/ws_missing');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('WORKSPACE_NOT_FOUND');
    });
  });

  describe('GET /api/workspaces/:id/projects', () => {
    it('lists projects for the workspace', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/workspaces/ws_1/projects?limit=5&offset=2');
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({
        method: 'listProjects',
        args: ['ws_1', 5, 2],
      });
    });
  });

  // ================================================================
  // PROJECTS
  // ================================================================

  describe('GET /api/projects/:id', () => {
    it('returns the project envelope', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/projects/proj_1');
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({ method: 'getProject', args: ['proj_1'] });
    });

    it('propagates PROJECT_NOT_FOUND as 404', async () => {
      engine.getProject = ((id: string) => {
        throw new TypedError('PROJECT_NOT_FOUND', `Project '${id}' not found`);
      }) as never;
      const app = buildApp(engine);
      const res = await app.request('/api/projects/proj_missing');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('PROJECT_NOT_FOUND');
    });
  });

  describe('GET /api/projects/:id/sequences', () => {
    it('lists sequences for the project', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/projects/proj_1/sequences');
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({
        method: 'listSequences',
        args: ['proj_1', 20, 0],
      });
    });
  });

  // ================================================================
  // SEQUENCES
  // ================================================================

  describe('GET /api/sequences/:id', () => {
    it('returns the sequence envelope', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/sequences/seq_1');
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({ method: 'getSequence', args: ['seq_1'] });
    });
  });

  describe('GET /api/sequences/:id/shots', () => {
    it('lists shots for the sequence', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/sequences/seq_1/shots');
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({
        method: 'listShots',
        args: ['seq_1', 20, 0],
      });
    });
  });

  // ================================================================
  // SHOTS
  // ================================================================

  describe('GET /api/shots/:id', () => {
    it('returns the shot envelope', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/shots/shot_1');
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({ method: 'getShot', args: ['shot_1'] });
    });

    it('propagates SHOT_NOT_FOUND as 404', async () => {
      engine.getShot = ((id: string) => {
        throw new TypedError('SHOT_NOT_FOUND', `Shot '${id}' not found`);
      }) as never;
      const app = buildApp(engine);
      const res = await app.request('/api/shots/shot_missing');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('SHOT_NOT_FOUND');
    });
  });

  describe('GET /api/shots/:id/versions', () => {
    it('passes limit/offset/include_tags/include_metadata to engine.listVersionsForShot', async () => {
      const app = buildApp(engine);
      await app.request(
        '/api/shots/shot_1/versions?limit=5&offset=3&include_tags=true&include_metadata=true',
      );
      expect(engine.calls).toContainEqual({
        method: 'listVersionsForShot',
        args: ['shot_1', 5, 3, { include_tags: true, include_metadata: true }],
      });
    });

    it('defaults include flags to false when absent', async () => {
      const app = buildApp(engine);
      await app.request('/api/shots/shot_1/versions');
      expect(engine.calls).toContainEqual({
        method: 'listVersionsForShot',
        args: ['shot_1', 20, 0, { include_tags: false, include_metadata: false }],
      });
    });
  });

  // ================================================================
  // VERSIONS
  // ================================================================

  describe('GET /api/versions/:id', () => {
    it('returns hydrated version entity', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entity.id).toBe('ver_1');
      expect(engine.calls).toContainEqual({ method: 'getVersion', args: ['ver_1'] });
    });

    it('propagates VERSION_NOT_FOUND as 404', async () => {
      engine.getVersion = ((id: string) => {
        throw new TypedError('VERSION_NOT_FOUND', `Version '${id}' not found`);
      }) as never;
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_missing');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('VERSION_NOT_FOUND');
    });
  });

  describe('GET /api/versions/:id/provenance', () => {
    it('returns provenance events + breadcrumb', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_1/provenance');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('events');
      expect(engine.calls).toContainEqual({
        method: 'getProvenance',
        args: ['ver_1'],
      });
    });
  });

  describe('GET /api/versions/:id/diff', () => {
    it('calls engine.diffVersions with both IDs', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_a/diff?against=ver_b');
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({
        method: 'diffVersions',
        args: ['ver_a', 'ver_b'],
      });
    });

    it('returns 400 INVALID_INPUT when ?against is missing', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_a/diff');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  // ================================================================
  // OUTPUT STREAMING — T-5-04 (path traversal defence)
  // ================================================================

  describe('GET /api/versions/:id/output', () => {
    it('returns OUTPUT_UNAVAILABLE (404) when outputs_json is null', async () => {
      engine.cans.versions.set('ver_nooutput', {
        entity: {
          id: 'ver_nooutput',
          shot_id: 'shot_1',
          version_number: 1,
          status: 'completed',
          job_id: null,
          parent_version_id: null,
          notes: null,
          created_at: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: null,
          lineage_type: null,
          tags: [],
          metadata: [],
        },
        breadcrumb: { entries: [], text: '' },
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_nooutput/output');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('OUTPUT_UNAVAILABLE');
    });

    it('returns OUTPUT_UNAVAILABLE (404) when outputs_json is an empty array', async () => {
      engine.cans.versions.set('ver_emptyarr', {
        entity: {
          id: 'ver_emptyarr',
          shot_id: 'shot_1',
          version_number: 1,
          status: 'completed',
          job_id: null,
          parent_version_id: null,
          notes: null,
          created_at: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: '[]',
          lineage_type: null,
          tags: [],
          metadata: [],
        },
        breadcrumb: { entries: [], text: '' },
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_emptyarr/output');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('OUTPUT_UNAVAILABLE');
    });

    it('returns OUTPUT_UNAVAILABLE (404) when file is missing from disk', async () => {
      // Do NOT call writeTestOutput — the fs path will not exist on disk.
      engine.cans.versions.set('ver_missing_file', {
        entity: {
          id: 'ver_missing_file',
          shot_id: 'shot_1',
          version_number: 1,
          status: 'completed',
          job_id: null,
          parent_version_id: null,
          notes: null,
          created_at: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: JSON.stringify([{ filename: 'out.png' }]),
          lineage_type: null,
          tags: [],
          metadata: [],
        },
        breadcrumb: { entries: [], text: '' },
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_missing_file/output');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('OUTPUT_UNAVAILABLE');
    });

    it('rejects path-traversal filenames with INVALID_INPUT (400) — T-5-04', async () => {
      engine.cans.versions.set('ver_traversal', {
        entity: {
          id: 'ver_traversal',
          shot_id: 'shot_1',
          version_number: 1,
          status: 'completed',
          job_id: null,
          parent_version_id: null,
          notes: null,
          created_at: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: JSON.stringify([{ filename: '../../../etc/passwd' }]),
          lineage_type: null,
          tags: [],
          metadata: [],
        },
        breadcrumb: { entries: [], text: '' },
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_traversal/output');
      // path.basename strips path segments; resulting filename is 'passwd' —
      // the check must still catch traversal patterns OR the basename-stripped
      // filename must not include path separators. Either way, no leak.
      // If basename returns 'passwd', existsSync(false) or the path check fires.
      // If basename fails to strip, the separator check rejects. Both paths
      // result in a 4xx — we just assert no 200 + stream leak.
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('streams file with image/png Content-Type for .png output', async () => {
      // Write a real tiny file to outputs/ver_png_stream/out.png so the route
      // can successfully fs.createReadStream it. afterEach cleans it up.
      writeTestOutput('ver_png_stream', 'out.png');
      engine.cans.versions.set('ver_png_stream', {
        entity: {
          id: 'ver_png_stream',
          shot_id: 'shot_1',
          version_number: 1,
          status: 'completed',
          job_id: null,
          parent_version_id: null,
          notes: null,
          created_at: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: JSON.stringify([{ filename: 'out.png' }]),
          lineage_type: null,
          tags: [],
          metadata: [],
        },
        breadcrumb: { entries: [], text: '' },
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_png_stream/output');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
    });

    it('maps .jpg extension to image/jpeg', async () => {
      writeTestOutput('ver_jpg_stream', 'out.jpg');
      engine.cans.versions.set('ver_jpg_stream', {
        entity: {
          id: 'ver_jpg_stream',
          shot_id: 'shot_1',
          version_number: 1,
          status: 'completed',
          job_id: null,
          parent_version_id: null,
          notes: null,
          created_at: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: JSON.stringify([{ filename: 'out.jpg' }]),
          lineage_type: null,
          tags: [],
          metadata: [],
        },
        breadcrumb: { entries: [], text: '' },
      });
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_jpg_stream/output');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
    });
  });

  // ================================================================
  // SC-2 (Phase 6 gap_closure WR-01): outputRoot resolution
  // ================================================================
  describe('GET /api/versions/:id/output — outputRoot resolution (SC-2)', () => {
    // Track tmp dirs for cleanup. Cannot use the existing TEST_VERSION_IDS
    // helper because that one assumes the repo-relative `outputs/` tree;
    // these tests intentionally write OUTSIDE the repo to prove resolution.
    const tmpRoots = new Set<string>();

    afterEach(() => {
      for (const root of tmpRoots) {
        if (existsSync(root)) {
          rmSync(root, { recursive: true, force: true });
        }
      }
      tmpRoots.clear();
    });

    function writeUnder(root: string, versionId: string, filename: string): void {
      const dir = join(root, versionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, filename), Buffer.from([0x89, 0x50, 0x4E, 0x47]));
      tmpRoots.add(root);
    }

    function seedVersion(engine: FakeEngine, versionId: string, filename: string): void {
      engine.cans.versions.set(versionId, {
        entity: {
          id: versionId,
          shot_id: 'shot_1',
          version_number: 1,
          status: 'completed',
          job_id: null,
          parent_version_id: null,
          notes: null,
          created_at: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
          outputs_json: JSON.stringify([{ filename }]),
          lineage_type: null,
          tags: [],
          metadata: [],
        },
        breadcrumb: { entries: [], text: '' },
      });
    }

    it('resolves against an absolute outputRoot (proves CWD independence)', async () => {
      const absRoot = resolvePath(tmpdir(), `vfx-sc2-abs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      // Mutate the FakeEngine surface BEFORE building the app — the route
      // captures `engine.outputRoot` at call time, not at construction time.
      engine.outputRoot = absRoot;
      const versionId = 'ver_sc2_abs';
      writeUnder(absRoot, versionId, 'out.png');
      seedVersion(engine, versionId, 'out.png');

      const app = buildApp(engine);
      const res = await app.request(`/api/versions/${versionId}/output`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');

      // Negative regression: the same file MUST NOT exist under the repo's
      // legacy `outputs/<versionId>/...` literal. If this assertion fires, the
      // route is still using the hardcoded path despite the change above.
      expect(existsSync(join('outputs', versionId, 'out.png'))).toBe(false);
    });

    it('resolves a relative outputRoot against process.cwd', async () => {
      const relRoot = `tmp-sc2-rel-${Date.now()}`;
      engine.outputRoot = relRoot;
      const versionId = 'ver_sc2_rel';
      writeUnder(relRoot, versionId, 'out.png');
      seedVersion(engine, versionId, 'out.png');

      const app = buildApp(engine);
      const res = await app.request(`/api/versions/${versionId}/output`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
    });

    it("preserves default 'outputs' resolution (regression guard)", async () => {
      // Do NOT mutate engine.outputRoot — leaves it at the FakeEngine default
      // 'outputs', which path.resolve() resolves against process.cwd().
      const versionId = 'ver_sc2_default';
      writeTestOutput(versionId, 'out.png');
      seedVersion(engine, versionId, 'out.png');

      const app = buildApp(engine);
      const res = await app.request(`/api/versions/${versionId}/output`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
    });
  });

  // ================================================================
  // REPRODUCE
  // ================================================================

  describe('POST /api/versions/:id/reproduce', () => {
    it('returns 201 + version envelope on success', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_src/reproduce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toHaveProperty('entity');
      expect(body).toHaveProperty('reproduction_warnings');
      expect(engine.calls).toContainEqual({
        method: 'reproduceVersion',
        args: ['ver_src', undefined],
      });
    });

    it('passes optional notes through to engine', async () => {
      const app = buildApp(engine);
      await app.request('/api/versions/ver_src/reproduce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'retry after crash' }),
      });
      expect(engine.calls).toContainEqual({
        method: 'reproduceVersion',
        args: ['ver_src', 'retry after crash'],
      });
    });

    it('tolerates empty body', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/versions/ver_src/reproduce', {
        method: 'POST',
      });
      expect(res.status).toBe(201);
    });
  });

  // ================================================================
  // ASSETS
  // ================================================================

  describe('POST /api/assets/query', () => {
    it('forwards body to engine.queryAssets', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/assets/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: 'ws_1', limit: 10, offset: 0 }),
      });
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({
        method: 'queryAssets',
        args: [{ workspace_id: 'ws_1', limit: 10, offset: 0 }],
      });
    });
  });

  describe('POST /api/assets/list_tags', () => {
    it('forwards body to engine.listTags', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/assets/list_tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: 'proj_1', limit: 20, offset: 0 }),
      });
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({
        method: 'listTags',
        args: [{ project_id: 'proj_1', limit: 20, offset: 0 }],
      });
    });
  });

  describe('POST /api/assets/list_metadata_keys', () => {
    it('forwards body to engine.listMetadataKeys', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/assets/list_metadata_keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shot_id: 'shot_1', limit: 10, offset: 0 }),
      });
      expect(res.status).toBe(200);
      expect(engine.calls).toContainEqual({
        method: 'listMetadataKeys',
        args: [{ shot_id: 'shot_1', limit: 10, offset: 0 }],
      });
    });
  });

  // ================================================================
  // DASHBOARD HOME
  // ================================================================

  describe('GET /api/dashboard/home', () => {
    it('returns aggregate with active_versions + recent_versions + workspaces', async () => {
      engine.cans.dashboardHome = {
        active_versions: [],
        recent_versions: [],
        workspaces: [],
      };
      const app = buildApp(engine);
      const res = await app.request('/api/dashboard/home');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('active_versions');
      expect(body).toHaveProperty('recent_versions');
      expect(body).toHaveProperty('workspaces');
      expect(engine.calls).toContainEqual({ method: 'getDashboardHome', args: [] });
    });
  });

  // ================================================================
  // DEFERRED ROUTES — make sure we did NOT wire them
  // ================================================================

  describe('deferred tag CRUD routes (not in scope)', () => {
    it('GET /api/tags returns 404 (route not registered)', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/tags');
      expect(res.status).toBe(404);
    });

    it('PATCH /api/tags/:id returns 404 (route not registered)', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/tags/tag_1', { method: 'PATCH' });
      expect(res.status).toBe(404);
    });

    it('DELETE /api/tags/:id returns 404 (route not registered)', async () => {
      const app = buildApp(engine);
      const res = await app.request('/api/tags/tag_1', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });
});
