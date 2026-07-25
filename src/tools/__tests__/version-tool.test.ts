// Direct-mirror suite for the `version` MCP tool — see the generation-tool
// test scaffold header for the rationale. This file extends the Phase 2
// Engine constructor to include ProvenanceRepo per Plan 02 Task 03-02-03.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import {
  makeInMemoryDb,
  seedAssetFixtures,
  versionWithTags,
  versionWithMetadata,
} from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { ProvenanceWriter } from '../../engine/provenance.js';
import { Engine } from '../../engine/pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import type { ComfyUIClient } from '../../comfyui/client.js';
import { toolOk, toolError } from '../envelope.js';
import { TypedError } from '../../engine/errors.js';
import { versionLabel } from '../../utils/outputs.js';
import {
  shapeList,
  MAX_ID_LENGTH,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from '../shape.js';
import type { Breadcrumb } from '../../types/hierarchy.js';
import type { VersionWithAssets } from '../../types/assets.js';
import type { ProvenanceEvent, DiffResponse } from '../../types/provenance.js';

type ToolResponse = {
  isError?: boolean;
  structuredContent: Record<string, unknown>;
  content: { type: 'text'; text: string }[];
};

async function buildStack() {
  const testDb = makeInMemoryDb();
  const { db } = testDb;
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-ver-tool-${nanoid(6)}-`));
  const engine = new Engine(
    db,
    hierarchy,
    versions,
    provenanceRepo,
    fake as unknown as ComfyUIClient,
    tempRoot,
  );
  const ws = hierarchy.createWorkspace('ws1');
  const proj = hierarchy.createProject(ws.id, 'p1');
  const seq = hierarchy.createSequence(proj.id, 'sq010');
  const shot = hierarchy.createShot(seq.id, 'sh010');
  const shotB = hierarchy.createShot(seq.id, 'sh020');
  return {
    engine,
    hierarchy,
    versions,
    provenanceRepo,
    provenanceWriter,
    fake,
    shotId: shot.id,
    shotBId: shotB.id,
    tempRoot,
    // Phase 4: expose the TestDb so fixture helpers (versionWithTags /
    // versionWithMetadata) can attach rows to the stack's database.
    testDb,
  };
}

function shapeVersion(r: { entity: VersionWithAssets; breadcrumb: Breadcrumb }) {
  // Phase 4 (D-ASST-19): engine.getVersion now returns VersionWithAssets;
  // spread carries tags + metadata through automatically.
  return {
    entity: {
      ...r.entity,
      version_label: versionLabel(r.entity.version_number),
    },
    breadcrumb: r.breadcrumb.entries,
    breadcrumb_text: r.breadcrumb.text,
  };
}

function shapeProvenance(r: { events: ProvenanceEvent[]; breadcrumb: Breadcrumb }) {
  return {
    events: r.events,
    breadcrumb: r.breadcrumb.entries,
    breadcrumb_text: r.breadcrumb.text,
  };
}

function shapeDiff(
  r: DiffResponse & { breadcrumb: Breadcrumb['entries']; breadcrumb_text: string },
) {
  return {
    summary: r.summary,
    changes: r.changes,
    reproduction_divergence: r.reproduction_divergence ?? null,
    breadcrumb: r.breadcrumb,
    breadcrumb_text: r.breadcrumb_text,
  };
}

const GetInput = z.object({
  action: z.literal('get'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});
const ListInput = z.object({
  action: z.literal('list'),
  shot_id: z.string().min(1).max(MAX_ID_LENGTH),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
  // Phase 4 — D-ASST-20 opt-in hydration flags (mirror production tool schema).
  include_tags: z.boolean().default(false),
  include_metadata: z.boolean().default(false),
});
const DiffInputSchema = z.object({
  action: z.literal('diff'),
  version_a: z.string().min(1).max(MAX_ID_LENGTH),
  version_b: z.string().min(1).max(MAX_ID_LENGTH),
});
const ProvenanceInput = z.object({
  action: z.literal('provenance'),
  version_id: z.string().min(1).max(MAX_ID_LENGTH),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeGet(stack: { engine: Engine }, input: any): Promise<ToolResponse> {
  try {
    const p = GetInput.parse(input);
    return toolOk(shapeVersion(stack.engine.getVersion(p.version_id))) as ToolResponse;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return toolError(
        new TypedError('INVALID_INPUT', `Invalid input at 'input.${first.path.join('.')}'`),
      ) as ToolResponse;
    }
    return toolError(err) as ToolResponse;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeList(stack: { engine: Engine }, input: any): Promise<ToolResponse> {
  try {
    const p = ListInput.parse(input);
    // Phase 18 / Plan 18-02 TRANSITIONAL — mirrors the production
    // version-tool.ts list-action shim: forwards version_number DESC + null
    // cursor so the v1.1 wire-level ordering at the MCP boundary is byte-
    // identical to pre-Phase-18 behavior. Offset is ignored under cursor
    // pagination (cursor:null = page 1).
    return toolOk(
      shapeList(
        stack.engine.listVersionsForShot(p.shot_id, {
          sort: { field: 'version_number', dir: 'desc' }, // TRANSITIONAL — preserves v1.1 ordering
          cursor: null,                                     // TRANSITIONAL
          limit: p.limit,
          include_tags: p.include_tags,
          include_metadata: p.include_metadata,
        }),
      ),
    ) as ToolResponse;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return toolError(
        new TypedError('INVALID_INPUT', `Invalid input at 'input.${first.path.join('.')}'`),
      ) as ToolResponse;
    }
    return toolError(err) as ToolResponse;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeDiff(stack: { engine: Engine }, input: any): Promise<ToolResponse> {
  try {
    const p = DiffInputSchema.parse(input);
    return toolOk(shapeDiff(await stack.engine.diffVersions(p.version_a, p.version_b))) as ToolResponse;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return toolError(
        new TypedError('INVALID_INPUT', `Invalid input at 'input.${first.path.join('.')}'`),
      ) as ToolResponse;
    }
    return toolError(err) as ToolResponse;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeProvenance(stack: { engine: Engine }, input: any): Promise<ToolResponse> {
  try {
    const p = ProvenanceInput.parse(input);
    return toolOk(shapeProvenance(stack.engine.getProvenance(p.version_id))) as ToolResponse;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return toolError(
        new TypedError('INVALID_INPUT', `Invalid input at 'input.${first.path.join('.')}'`),
      ) as ToolResponse;
    }
    return toolError(err) as ToolResponse;
  }
}

const BASE_BLOB = {
  '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
};

function seedCompleted(
  stack: Awaited<ReturnType<typeof buildStack>>,
  shotId: string,
  blob: Record<string, unknown> = BASE_BLOB,
): string {
  const row = stack.versions.insertVersion(shotId);
  stack.provenanceWriter.writeSubmitEvent(row.id, blob);
  stack.provenanceWriter.writeCompletedEvent(row.id, blob, '[]');
  stack.versions.markCompleted(row.id, '[]');
  return row.id;
}

let stack: Awaited<ReturnType<typeof buildStack>>;
beforeEach(async () => {
  stack = await buildStack();
});
afterEach(async () => {
  await stack.engine.stop();
  await fsp.rm(stack.tempRoot, { recursive: true, force: true });
});

describe('version tool — get', () => {
  it('returns entity + version_label + 5-entry breadcrumb', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    const res = await invokeGet(stack, { action: 'get', version_id: row.id });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      entity: { id: string; version_number: number; version_label: string; lineage_type: null };
      breadcrumb: { type: string }[];
      breadcrumb_text: string;
    };
    expect(sc.entity.id).toBe(row.id);
    expect(sc.entity.version_number).toBe(1);
    expect(sc.entity.version_label).toBe('v001');
    expect(sc.entity.lineage_type).toBeNull();
    expect(sc.breadcrumb).toHaveLength(5);
    expect(sc.breadcrumb[4].type).toBe('version');
  });

  it('content[0].text JSON.parse equals structuredContent (D-25)', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    const res = await invokeGet(stack, { action: 'get', version_id: row.id });
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });

  it('unknown version_id → VERSION_NOT_FOUND', async () => {
    const res = await invokeGet(stack, { action: 'get', version_id: 'ver_missing' });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('VERSION_NOT_FOUND');
  });

  it('missing version_id → INVALID_INPUT via Zod re-wrap', async () => {
    const res = await invokeGet(stack, { action: 'get' });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });
});

describe('version tool — list', () => {
  it('returns items DESC by version_number with per-item breadcrumb + total_count/limit/offset', async () => {
    stack.versions.insertVersion(stack.shotId);
    stack.versions.insertVersion(stack.shotId);
    stack.versions.insertVersion(stack.shotId);
    const res = await invokeList(stack, { action: 'list', shot_id: stack.shotId });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      items: { version_number: number; breadcrumb: { type: string }[] }[];
      total_count: number;
      limit: number;
      offset: number;
    };
    expect(sc.items.map((i) => i.version_number)).toEqual([3, 2, 1]);
    expect(sc.total_count).toBe(3);
    expect(sc.limit).toBe(20);
    expect(sc.offset).toBe(0);
    for (const i of sc.items) {
      expect(i.breadcrumb).toHaveLength(5);
    }
  });

  it('pagination limit honored (offset ignored under Phase 18 cursor pagination — TRANSITIONAL shim)', async () => {
    // Phase 18 / Plan 18-02 TRANSITIONAL: the engine surface migrated from
    // limit/offset to {sort, cursor, limit}; the MCP `version.list` wire-
    // level Zod schema still ACCEPTS offset for v1.1 byte compatibility,
    // but the TRANSITIONAL shim in version-tool.ts forwards cursor: null
    // (page 1). Offset values are accepted at the boundary (no INVALID_INPUT)
    // but produce no pagination side-effect. Plan 18-04 may add a cursor-
    // aware MCP wire surface; until then page 2+ is unreachable via MCP.
    for (let i = 0; i < 5; i++) stack.versions.insertVersion(stack.shotId);
    const res = await invokeList(stack, {
      action: 'list',
      shot_id: stack.shotId,
      limit: 2,
      offset: 2,
    });
    const sc = res.structuredContent as { items: { version_number: number }[]; total_count: number };
    // Top 2 by version_number DESC under TRANSITIONAL shim → [5, 4] (offset
    // ignored, returns page 1).
    expect(sc.items.map((i) => i.version_number)).toEqual([5, 4]);
    expect(sc.total_count).toBe(5);
  });

  it('empty shot → items: [] + total_count: 0', async () => {
    const res = await invokeList(stack, { action: 'list', shot_id: stack.shotBId });
    const sc = res.structuredContent as { items: unknown[]; total_count: number };
    expect(sc.items).toEqual([]);
    expect(sc.total_count).toBe(0);
  });

  it('limit > MAX_PAGE_SIZE → INVALID_INPUT via Zod', async () => {
    const res = await invokeList(stack, {
      action: 'list',
      shot_id: stack.shotId,
      limit: 999,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });
});

describe('version tool — provenance', () => {
  it('returns chronological events for a version with submit + completed', async () => {
    const versionId = seedCompleted(stack, stack.shotId);
    const res = await invokeProvenance(stack, { action: 'provenance', version_id: versionId });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { events: { event_type: string }[]; breadcrumb: unknown[] };
    expect(sc.events.map((e) => e.event_type)).toEqual(['submitted', 'completed']);
    expect(sc.breadcrumb).toHaveLength(5);
  });

  it('returns events: [] for a pre-Phase-3 Version with no events (D-PROV-34 honesty)', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    const res = await invokeProvenance(stack, { action: 'provenance', version_id: row.id });
    const sc = res.structuredContent as { events: unknown[] };
    expect(sc.events).toEqual([]);
  });

  it('unknown version_id → VERSION_NOT_FOUND', async () => {
    const res = await invokeProvenance(stack, { action: 'provenance', version_id: 'ver_missing' });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('VERSION_NOT_FOUND');
  });
});

describe('version tool — diff', () => {
  it('two completed versions on same shot with seed change → diff envelope includes summary + changes + breadcrumb', async () => {
    const v1 = seedCompleted(stack, stack.shotId, {
      '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    });
    const v2 = seedCompleted(stack, stack.shotId, {
      '3': { class_type: 'KSampler', inputs: { seed: 99, steps: 20, cfg: 7 } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl.safetensors' } },
    });
    const res = await invokeDiff(stack, { action: 'diff', version_a: v1, version_b: v2 });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      summary: string;
      changes: { params: unknown[]; models: unknown[]; seed: unknown; workflow: unknown[]; metadata: unknown[] };
      breadcrumb: unknown[];
      breadcrumb_text: string;
    };
    expect(typeof sc.summary).toBe('string');
    expect(sc.changes).toBeDefined();
    expect(Array.isArray(sc.breadcrumb)).toBe(true);
    expect(typeof sc.breadcrumb_text).toBe('string');
  });

  it('cross-shot diff → INVALID_INPUT (D-PROV-20 enforced in engine, flows through toolError)', async () => {
    const v1 = seedCompleted(stack, stack.shotId);
    const v2 = seedCompleted(stack, stack.shotBId);
    const res = await invokeDiff(stack, { action: 'diff', version_a: v1, version_b: v2 });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('unknown version id → VERSION_NOT_FOUND', async () => {
    const v1 = seedCompleted(stack, stack.shotId);
    const res = await invokeDiff(stack, {
      action: 'diff',
      version_a: v1,
      version_b: 'ver_missing',
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('VERSION_NOT_FOUND');
  });
});

describe('version tool — register smoke', () => {
  it('registerVersion exports a function that adds a tool named "version"', async () => {
    // Structural smoke: import registerVersion and confirm it is a function
    // with the expected signature. Deep MCP-SDK integration is covered in
    // tool-budget.test.ts (which counts server.registerTool calls across
    // src/tools/). Avoids coupling this file to SDK internals.
    const mod = await import('../version-tool.js');
    expect(typeof mod.registerVersion).toBe('function');
    // Calling registerVersion with a fake shape: not needed — we just
    // assert the handler body was structurally correct via the invokeX
    // helpers above (direct mirror), which is how generation-tool.test.ts
    // handles the same concern.
  });
});

// =============================================================================
// Phase 4 extensions — INV-ASST-15, 16, 17, 22, 23, 25
// =============================================================================
//
// Traceability:
//   INV-ASST-15 → version.get always inlines tags (ASC) + metadata (ASC by key),
//                 including empty arrays when no attachments (D-ASST-19)
//   INV-ASST-16 → version.list default omits tags per item (D-ASST-20 default)
//   INV-ASST-17 → version.list include_tags=true carries tags: string[] per item
//   INV-ASST-22 → version.list default omits metadata per item (D-ASST-20 default)
//   INV-ASST-23 → version.list include_metadata=true carries metadata per item
//   INV-ASST-25 → version.provenance UNCHANGED — tags/metadata never in event stream
//                 (D-ASST-21)

describe('version tool — get — Phase 4 hydration (D-ASST-19, INV-ASST-15)', () => {
  it('INV-ASST-15 entity.tags is sorted ASC alphabetically across mixed-case seed order', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    // Seed tags out of alphabetical order to prove the engine sorts them.
    versionWithTags(stack.testDb, row.id, ['zebra', 'apple', 'mango']);
    const res = await invokeGet(stack, { action: 'get', version_id: row.id });
    expect(res.isError).toBeUndefined();
    const entity = (res.structuredContent as { entity: Record<string, unknown> }).entity;
    expect(entity.tags).toEqual(['apple', 'mango', 'zebra']);
  });

  it('INV-ASST-15 entity.metadata is sorted ASC by key across mixed-case seed order', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    // Seed metadata keys out of alphabetical order; assert they come back ASC by key.
    versionWithMetadata(stack.testDb, row.id, {
      zeta: '3',
      alpha: '1',
      mu: '2',
    });
    const res = await invokeGet(stack, { action: 'get', version_id: row.id });
    expect(res.isError).toBeUndefined();
    const entity = (res.structuredContent as { entity: Record<string, unknown> }).entity;
    expect(entity.metadata).toEqual([
      { key: 'alpha', value: '1' },
      { key: 'mu', value: '2' },
      { key: 'zeta', value: '3' },
    ]);
  });

  it('INV-ASST-15 bare version (no tags, no metadata) returns tags:[] and metadata:[] (not null/undefined)', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    // Do NOT attach any tags or metadata.
    const res = await invokeGet(stack, { action: 'get', version_id: row.id });
    expect(res.isError).toBeUndefined();
    const entity = (res.structuredContent as { entity: Record<string, unknown> }).entity;
    // Explicit empty-array contract — agents can .map/.filter without branches.
    expect(entity.tags).toEqual([]);
    expect(entity.metadata).toEqual([]);
  });
});

describe('version tool — list — Phase 4 include flags (D-ASST-20, INV-ASST-16, 17, 22, 23)', () => {
  it('INV-ASST-16, INV-ASST-22 default (no include flags) omits tags AND metadata per item', async () => {
    // Seed 3 versions with tags + metadata via fixture helpers using the stack's db.
    const seeded = await seedAssetFixtures(stack.testDb, {
      versionCount: 3,
      tagsPerVersion: 2,
      metadataPerVersion: 2,
    });
    // Use the shot from the fixture (a distinct hierarchy from stack.shotId).
    const res = await invokeList(stack, {
      action: 'list',
      shot_id: seeded.hierarchy.shotId,
      limit: 10,
    });
    expect(res.isError).toBeUndefined();
    const items = (res.structuredContent as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item).not.toHaveProperty('tags');
      expect(item).not.toHaveProperty('metadata');
    }
  });

  it('INV-ASST-17 include_tags=true adds tags: string[] per item (ASC); metadata still omitted', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    versionWithTags(stack.testDb, row.id, ['charlie', 'alpha', 'bravo']);
    versionWithMetadata(stack.testDb, row.id, { artist: 'tim' }); // seeded but NOT opted in
    const res = await invokeList(stack, {
      action: 'list',
      shot_id: stack.shotId,
      include_tags: true,
    });
    expect(res.isError).toBeUndefined();
    const items = (res.structuredContent as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0].tags).toEqual(['alpha', 'bravo', 'charlie']);
    // Not opted in — metadata must remain absent.
    expect(items[0]).not.toHaveProperty('metadata');
  });

  it('INV-ASST-23 include_metadata=true (alone) carries metadata: Array<{key,value}> ASC by key; tags still omitted', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    versionWithTags(stack.testDb, row.id, ['hero']); // seeded but NOT opted in
    versionWithMetadata(stack.testDb, row.id, { department: 'vfx', artist: 'tim' });
    const res = await invokeList(stack, {
      action: 'list',
      shot_id: stack.shotId,
      include_metadata: true,
    });
    expect(res.isError).toBeUndefined();
    const items = (res.structuredContent as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0].metadata).toEqual([
      { key: 'artist', value: 'tim' },
      { key: 'department', value: 'vfx' },
    ]);
    // Not opted in — tags must remain absent.
    expect(items[0]).not.toHaveProperty('tags');
  });

  it('INV-ASST-17, INV-ASST-23 include_tags=true AND include_metadata=true carries both per item', async () => {
    const row = stack.versions.insertVersion(stack.shotId);
    versionWithTags(stack.testDb, row.id, ['final', 'approved']);
    versionWithMetadata(stack.testDb, row.id, { status: 'complete' });
    const res = await invokeList(stack, {
      action: 'list',
      shot_id: stack.shotId,
      include_tags: true,
      include_metadata: true,
    });
    expect(res.isError).toBeUndefined();
    const items = (res.structuredContent as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0].tags).toEqual(['approved', 'final']);
    expect(items[0].metadata).toEqual([{ key: 'status', value: 'complete' }]);
  });
});

describe('version tool — provenance — Phase 4 non-regression (D-ASST-21, INV-ASST-25)', () => {
  it('INV-ASST-25 provenance response does NOT surface tags or metadata (not provenance)', async () => {
    // Seed a version with both tags + metadata AND a submit/completed event,
    // then assert the provenance response does NOT include any "tags":
    // or "metadata": keys anywhere in its structuredContent.
    const versionId = seedCompleted(stack, stack.shotId);
    versionWithTags(stack.testDb, versionId, ['hero', 'approved']);
    versionWithMetadata(stack.testDb, versionId, { artist: 'tim', department: 'vfx' });
    const res = await invokeProvenance(stack, { action: 'provenance', version_id: versionId });
    expect(res.isError).toBeUndefined();
    const serialized = JSON.stringify(res.structuredContent);
    // D-ASST-21 lock: tags/metadata are NEVER in the event stream. Walk the
    // serialized JSON to catch any unexpected leak — belt-and-suspenders on top
    // of the positive events[] assertion.
    expect(serialized).not.toMatch(/"tags"\s*:/);
    expect(serialized).not.toMatch(/"metadata"\s*:/);
    // And the events array MUST still be present (Phase 3 contract preserved).
    const sc = res.structuredContent as { events: { event_type: string }[] };
    expect(sc.events.map((e) => e.event_type)).toEqual(['submitted', 'completed']);
  });
});
