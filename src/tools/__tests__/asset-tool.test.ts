// Direct-mirror integration tests for the `asset` MCP tool — Phase 4 Plan 04.
//
// Pattern source: `src/tools/__tests__/version-tool.test.ts` (register-and-extract
// via the SDK's private `_registeredTools` map). The handler is invoked directly
// rather than through a transport — faster feedback, same envelope shape as the
// wire.
//
// Traceability anchors (VALIDATION.md §Business Logic Invariants / D-ASST-*):
//   - INV-ASST-08 scope XOR (2 scope fields → INVALID_SCOPE)
//   - INV-ASST-14 tool-layer limit cap (limit > MAX_PAGE_SIZE → INVALID_INPUT)
//   - INV-ASST-20 envelope invariant (dual-form D-25; JSON.parse(content) == structuredContent)
//   - INV-ASST-25 breadcrumb on every successful response (D-22, D-ASST-04/05)
//
// Coverage (25 tests):
//   add_tag / remove_tag (6): happy, idempotent, unknown version, invalid regex,
//       whitespace, length > 64
//   set_metadata / remove_metadata (5): happy, upsert, value > 2000 chars,
//       whitespace key, idempotent remove on missing key
//   query (7): global, tags AND, scope XOR violation, date range inverted,
//       limit cap at Zod, pagination totals, 0-result
//   list_tags / list_metadata_keys (3): scoped to shot, count DESC ordering,
//       scope echoed in structuredContent
//   envelope invariants (2): breadcrumb present on mutator; structuredContent
//       deep-equals JSON.parse(content[0].text)
//   registration smoke (2): registerAsset produces a tool named 'asset';
//       description mentions the 7 actions
//
// The file fails at the `import { registerAsset } from '../asset-tool.js'`
// line until Task 2 lands the implementation (TDD RED state).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../../engine/pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';
import { registerAsset } from '../asset-tool.js';

type ToolResponse = {
  isError?: boolean;
  structuredContent: Record<string, unknown>;
  content: { type: 'text'; text: string }[];
};

type AssetHandler = (
  input: Record<string, unknown>,
) => Promise<ToolResponse>;

async function buildAssetStack() {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(
    pth.join(os.tmpdir(), `vfx-asset-tool-${nanoid(6)}-`),
  );
  // Plan 04-03 Engine constructor signature: db FIRST, then repos + optional client.
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    tempRoot,
  );
  // Build a small hierarchy: ws → project → sequence → shot → version.
  const ws = hierarchy.createWorkspace('ws1');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const shotB = hierarchy.createShot(seq.id, 'sh020');
  const ver = versions.insertVersion(shot.id);

  // Register the asset tool on an in-memory McpServer and extract the handler
  // via the SDK's private _registeredTools map. Same pattern the other tool
  // tests use (see version-tool.test.ts register smoke; generation-tool.test.ts
  // uses direct-mirror helpers instead — we need the real registration here to
  // assert description + Zod + handler body end-to-end).
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerAsset(server, engine);
  // MCP SDK 1.29 stores the registered callback under the `handler` key (see
  // node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js _createRegisteredTool).
  const registered = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: AssetHandler; description?: string }
      >;
    }
  )._registeredTools;
  const handler = registered.asset!.handler as AssetHandler;
  const description = registered.asset!.description ?? '';

  return {
    db,
    engine,
    hierarchy,
    versions,
    fake,
    handler,
    description,
    wsId: ws.id,
    projId: proj.id,
    seqId: seq.id,
    shotId: shot.id,
    shotBId: shotB.id,
    versionId: ver.id,
    tempRoot,
  };
}

let stack: Awaited<ReturnType<typeof buildAssetStack>>;
beforeEach(async () => {
  stack = await buildAssetStack();
});
afterEach(async () => {
  await stack.engine.stop();
  await fsp.rm(stack.tempRoot, { recursive: true, force: true });
});

// ================================================================
// add_tag / remove_tag — 6 tests
// ================================================================

describe('asset tool — add_tag', () => {
  it('happy path — entity has tag, breadcrumb 5-entry, tags ASC (INV-ASST-25)', async () => {
    const res = await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      entity: { id: string; tags: string[]; version_label: string; metadata: unknown[] };
      breadcrumb: { type: string }[];
      breadcrumb_text: string;
    };
    expect(sc.entity.id).toBe(stack.versionId);
    expect(sc.entity.tags).toEqual(['hero']);
    expect(Array.isArray(sc.entity.metadata)).toBe(true);
    expect(sc.entity.version_label).toBe('v001');
    expect(sc.breadcrumb).toHaveLength(5);
    expect(sc.breadcrumb[4].type).toBe('version');
    expect(sc.breadcrumb_text).toMatch(/ > v001$/);
  });

  it('idempotent — second add_tag with same tag leaves tags length at 1 (D-ASST-03)', async () => {
    await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    const res = await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { entity: { tags: string[] } };
    expect(sc.entity.tags).toEqual(['hero']);
  });

  it('unknown version_id → VERSION_NOT_FOUND', async () => {
    const res = await stack.handler({
      action: 'add_tag',
      version_id: 'ver_nope',
      tag: 'hero',
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('VERSION_NOT_FOUND');
  });

  it('invalid regex tag "hero$" → INVALID_INPUT via Zod (or TAG_INVALID via engine)', async () => {
    const res = await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero$',
    });
    expect(res.isError).toBe(true);
    const code = (res.structuredContent as { code: string }).code;
    // Zod should reject first (TAG_REGEX not matching $); TAG_INVALID is the
    // engine-layer rejection (defence in depth). Either is acceptable per plan
    // acceptance criteria ("Zod catches at tool boundary OR TAG_INVALID if
    // engine path catches first").
    expect(['INVALID_INPUT', 'TAG_INVALID']).toContain(code);
  });

  it('whitespace tag " hero" → INVALID_INPUT or TAG_INVALID', async () => {
    const res = await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: ' hero',
    });
    expect(res.isError).toBe(true);
    const code = (res.structuredContent as { code: string }).code;
    expect(['INVALID_INPUT', 'TAG_INVALID']).toContain(code);
  });

  it('tag > 64 chars → INVALID_INPUT', async () => {
    const longTag = 'a'.repeat(65);
    const res = await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: longTag,
    });
    expect(res.isError).toBe(true);
    const code = (res.structuredContent as { code: string }).code;
    expect(['INVALID_INPUT', 'TAG_INVALID']).toContain(code);
  });
});

describe('asset tool — remove_tag', () => {
  it('happy path — entity.tags no longer contains removed tag (D-ASST-04)', async () => {
    await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'final',
    });
    const res = await stack.handler({
      action: 'remove_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { entity: { tags: string[] } };
    expect(sc.entity.tags).toEqual(['final']);
  });

  it('idempotent — remove_tag on missing tag returns success with current tags (D-ASST-03)', async () => {
    const res = await stack.handler({
      action: 'remove_tag',
      version_id: stack.versionId,
      tag: 'never-added',
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { entity: { tags: string[] } };
    expect(sc.entity.tags).toEqual([]);
  });
});

// ================================================================
// set_metadata / remove_metadata — 5 tests
// ================================================================

describe('asset tool — set_metadata', () => {
  it('happy path — entity.metadata contains the new pair (D-ASST-04)', async () => {
    const res = await stack.handler({
      action: 'set_metadata',
      version_id: stack.versionId,
      key: 'artist',
      value: 'tim',
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      entity: { metadata: { key: string; value: string }[] };
    };
    expect(sc.entity.metadata).toEqual([{ key: 'artist', value: 'tim' }]);
  });

  it('upsert — second call with same key updates value (D-ASST-03)', async () => {
    await stack.handler({
      action: 'set_metadata',
      version_id: stack.versionId,
      key: 'status',
      value: 'review',
    });
    const res = await stack.handler({
      action: 'set_metadata',
      version_id: stack.versionId,
      key: 'status',
      value: 'approved',
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      entity: { metadata: { key: string; value: string }[] };
    };
    expect(sc.entity.metadata).toEqual([{ key: 'status', value: 'approved' }]);
  });

  it('value > 2000 chars → INVALID_INPUT (INV-ASST-14)', async () => {
    const longValue = 'x'.repeat(2001);
    const res = await stack.handler({
      action: 'set_metadata',
      version_id: stack.versionId,
      key: 'notes',
      value: longValue,
    });
    expect(res.isError).toBe(true);
    const code = (res.structuredContent as { code: string }).code;
    expect(['INVALID_INPUT', 'METADATA_INVALID']).toContain(code);
  });

  it('whitespace key " artist" → INVALID_INPUT or METADATA_INVALID', async () => {
    const res = await stack.handler({
      action: 'set_metadata',
      version_id: stack.versionId,
      key: ' artist',
      value: 'tim',
    });
    expect(res.isError).toBe(true);
    const code = (res.structuredContent as { code: string }).code;
    expect(['INVALID_INPUT', 'METADATA_INVALID']).toContain(code);
  });
});

describe('asset tool — remove_metadata', () => {
  it('idempotent — remove on missing key returns success (D-ASST-03)', async () => {
    const res = await stack.handler({
      action: 'remove_metadata',
      version_id: stack.versionId,
      key: 'never-set',
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { entity: { metadata: unknown[] } };
    expect(sc.entity.metadata).toEqual([]);
  });
});

// ================================================================
// query — 7 tests (includes INV-ASST-08, INV-ASST-14, INV-ASST-20)
// ================================================================

describe('asset tool — query', () => {
  it('global (no scope) — paginated envelope with items + total_count + limit + offset', async () => {
    await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    const res = await stack.handler({ action: 'query' });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      items: { id: string; tags: string[]; breadcrumb: unknown[] }[];
      total_count: number;
      limit: number;
      offset: number;
    };
    expect(sc.items).toHaveLength(1);
    expect(sc.items[0].id).toBe(stack.versionId);
    expect(sc.items[0].tags).toEqual(['hero']);
    expect(sc.items[0].breadcrumb).toHaveLength(5);
    expect(sc.total_count).toBe(1);
    expect(sc.limit).toBe(20);
    expect(sc.offset).toBe(0);
  });

  it('tags AND — only versions having ALL listed tags match (D-ASST-14)', async () => {
    const vA = stack.versions.insertVersion(stack.shotId);
    const vB = stack.versions.insertVersion(stack.shotId);
    await stack.handler({ action: 'add_tag', version_id: vA.id, tag: 'hero' });
    await stack.handler({ action: 'add_tag', version_id: vA.id, tag: 'final' });
    await stack.handler({ action: 'add_tag', version_id: vB.id, tag: 'hero' });

    const res = await stack.handler({
      action: 'query',
      tags: ['hero', 'final'],
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { items: { id: string }[]; total_count: number };
    expect(sc.items.map((i) => i.id)).toEqual([vA.id]);
    expect(sc.total_count).toBe(1);
  });

  it('INV-ASST-08 scope XOR — 2 scope fields → INVALID_SCOPE naming both', async () => {
    const res = await stack.handler({
      action: 'query',
      workspace_id: stack.wsId,
      shot_id: stack.shotId,
    });
    expect(res.isError).toBe(true);
    const p = res.structuredContent as { code: string; message: string };
    expect(p.code).toBe('INVALID_SCOPE');
    expect(p.message).toContain('workspace_id');
    expect(p.message).toContain('shot_id');
  });

  it('date_from > date_to → INVALID_INPUT (D-ASST-15)', async () => {
    const res = await stack.handler({
      action: 'query',
      date_from: 2000,
      date_to: 1000,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('INV-ASST-14 limit cap — limit:101 → INVALID_INPUT (Zod rejects > MAX_PAGE_SIZE)', async () => {
    const res = await stack.handler({ action: 'query', limit: 101 });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('pagination — total_count reflects full match set even when page is smaller', async () => {
    // Insert 5 versions, all tagged 'hero'; fetch with limit=2.
    for (let i = 0; i < 4; i++) {
      const v = stack.versions.insertVersion(stack.shotId);
      await stack.handler({ action: 'add_tag', version_id: v.id, tag: 'hero' });
    }
    // Also tag the initial stack.versionId
    await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    const res = await stack.handler({ action: 'query', tags: ['hero'], limit: 2 });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      items: unknown[];
      total_count: number;
      limit: number;
    };
    expect(sc.items).toHaveLength(2);
    expect(sc.total_count).toBe(5);
    expect(sc.limit).toBe(2);
  });

  it('0-result — items: [] + total_count: 0', async () => {
    const res = await stack.handler({
      action: 'query',
      tags: ['never-exists'],
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { items: unknown[]; total_count: number };
    expect(sc.items).toEqual([]);
    expect(sc.total_count).toBe(0);
  });
});

// ================================================================
// list_tags / list_metadata_keys — 3 tests
// ================================================================

describe('asset tool — list_tags / list_metadata_keys', () => {
  it('list_tags scoped to shot — envelope includes scope echo in structuredContent (D-ASST-06)', async () => {
    await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'final',
    });
    const res = await stack.handler({
      action: 'list_tags',
      shot_id: stack.shotId,
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      items: { name: string; count: number }[];
      total_count: number;
      limit: number;
      offset: number;
      scope: { shot_id?: string };
    };
    expect(sc.items.map((i) => i.name).sort()).toEqual(['final', 'hero']);
    expect(sc.total_count).toBe(2);
    expect(sc.scope.shot_id).toBe(stack.shotId);
  });

  it('list_tags ordered count DESC, name ASC (D-ASST-06)', async () => {
    const vA = stack.versions.insertVersion(stack.shotId);
    const vB = stack.versions.insertVersion(stack.shotId);
    // 'hero' on 3 versions, 'final' on 1, 'alpha' on 1 — tie at 1: alpha ASC before final
    await stack.handler({ action: 'add_tag', version_id: stack.versionId, tag: 'hero' });
    await stack.handler({ action: 'add_tag', version_id: vA.id, tag: 'hero' });
    await stack.handler({ action: 'add_tag', version_id: vB.id, tag: 'hero' });
    await stack.handler({ action: 'add_tag', version_id: stack.versionId, tag: 'final' });
    await stack.handler({ action: 'add_tag', version_id: vA.id, tag: 'alpha' });

    const res = await stack.handler({ action: 'list_tags' });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { items: { name: string; count: number }[] };
    expect(sc.items[0]).toEqual({ name: 'hero', count: 3 });
    // Tie-broken alphabetical: alpha before final
    expect(sc.items[1]).toEqual({ name: 'alpha', count: 1 });
    expect(sc.items[2]).toEqual({ name: 'final', count: 1 });
  });

  it('list_metadata_keys scoped to project — envelope + scope echo', async () => {
    await stack.handler({
      action: 'set_metadata',
      version_id: stack.versionId,
      key: 'artist',
      value: 'tim',
    });
    await stack.handler({
      action: 'set_metadata',
      version_id: stack.versionId,
      key: 'status',
      value: 'approved',
    });
    const res = await stack.handler({
      action: 'list_metadata_keys',
      project_id: stack.projId,
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      items: { name: string; count: number }[];
      total_count: number;
      scope: { project_id?: string };
    };
    expect(sc.items.map((i) => i.name).sort()).toEqual(['artist', 'status']);
    expect(sc.total_count).toBe(2);
    expect(sc.scope.project_id).toBe(stack.projId);
  });
});

// ================================================================
// Envelope invariants — 2 tests (INV-ASST-20, INV-ASST-25)
// ================================================================

describe('asset tool — envelope invariants', () => {
  it('INV-ASST-20 dual form — structuredContent deep-equals JSON.parse(content[0].text) (D-25)', async () => {
    const res = await stack.handler({
      action: 'add_tag',
      version_id: stack.versionId,
      tag: 'hero',
    });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });

  it('INV-ASST-25 breadcrumb is present on every mutator response (5 entries)', async () => {
    const mutators = [
      { action: 'add_tag', version_id: stack.versionId, tag: 'hero' },
      { action: 'remove_tag', version_id: stack.versionId, tag: 'hero' },
      { action: 'set_metadata', version_id: stack.versionId, key: 'artist', value: 'tim' },
      { action: 'remove_metadata', version_id: stack.versionId, key: 'artist' },
    ];
    for (const input of mutators) {
      const res = await stack.handler(input);
      expect(res.isError).toBeUndefined();
      const sc = res.structuredContent as {
        breadcrumb: { type: string }[];
        breadcrumb_text: string;
      };
      expect(sc.breadcrumb).toHaveLength(5);
      expect(sc.breadcrumb[4].type).toBe('version');
      expect(sc.breadcrumb_text).toMatch(/ > v001$/);
    }
  });
});

// ================================================================
// Registration smoke — 2 tests
// ================================================================

describe('asset tool — registration smoke', () => {
  it('registerAsset registers a tool named "asset"', () => {
    expect(stack.handler).toBeTypeOf('function');
  });

  it('tool description mentions all 7 actions', () => {
    const desc = stack.description;
    expect(desc).toContain('add_tag');
    expect(desc).toContain('remove_tag');
    expect(desc).toContain('set_metadata');
    expect(desc).toContain('remove_metadata');
    expect(desc).toContain('query');
    expect(desc).toContain('list_tags');
    expect(desc).toContain('list_metadata_keys');
  });
});
