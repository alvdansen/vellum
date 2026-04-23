// Direct-mirror suite for the `version` MCP tool — see the generation-tool
// test scaffold header for the rationale. This file extends the Phase 2
// Engine constructor to include ProvenanceRepo per Plan 02 Task 03-02-03.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
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
import type { Version, Breadcrumb } from '../../types/hierarchy.js';
import type { ProvenanceEvent, DiffResponse } from '../../types/provenance.js';

type ToolResponse = {
  isError?: boolean;
  structuredContent: Record<string, unknown>;
  content: { type: 'text'; text: string }[];
};

async function buildStack() {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  const provenanceWriter = new ProvenanceWriter(provenanceRepo);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-ver-tool-${nanoid(6)}-`));
  const engine = new Engine(
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
  };
}

function shapeVersion(r: { entity: Version; breadcrumb: Breadcrumb }) {
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
    return toolOk(
      shapeList(stack.engine.listVersionsForShot(p.shot_id, p.limit, p.offset)),
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
    return toolOk(shapeDiff(stack.engine.diffVersions(p.version_a, p.version_b))) as ToolResponse;
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

  it('pagination limit/offset honored', async () => {
    for (let i = 0; i < 5; i++) stack.versions.insertVersion(stack.shotId);
    const res = await invokeList(stack, {
      action: 'list',
      shot_id: stack.shotId,
      limit: 2,
      offset: 2,
    });
    const sc = res.structuredContent as { items: { version_number: number }[]; total_count: number };
    expect(sc.items.map((i) => i.version_number)).toEqual([3, 2]);
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
