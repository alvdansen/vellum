// Direct-mirror pattern — the MCP SDK's registered-tool handler is private,
// so these tests mirror the handler body: (a) call engine, (b) shapeVersionEntity,
// (c) toolOk/toolError. Same scaffold as error-wrapping.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import * as os from 'node:os';
import * as pth from 'node:path';
import * as fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { Engine } from '../../engine/pipeline.js';
import { FakeComfyUIClient } from '../../test-utils/fake-comfyui-client.js';
import { toolOk, toolError } from '../envelope.js';
import { TypedError } from '../../engine/errors.js';
import { versionLabel } from '../../utils/outputs.js';
import type { Version, Breadcrumb } from '../../types/hierarchy.js';
import { registerGeneration } from '../index.js';

type ToolResponse = {
  isError?: boolean;
  structuredContent: Record<string, unknown>;
  content: { type: 'text'; text: string }[];
};

async function buildStack() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const fake = new FakeComfyUIClient();
  const tempRoot = await fsp.mkdtemp(pth.join(os.tmpdir(), `vfx-gen-tool-${nanoid(6)}-`));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine = new Engine(repo, versions, fake as unknown as any, tempRoot);
  const ws = repo.createWorkspace('ws1');
  const proj = repo.createProject(ws.id, 'p1');
  const seq = repo.createSequence(proj.id, 'sq010');
  const shot = repo.createShot(seq.id, 'sh010');
  return { engine, fake, versions, shotId: shot.id, tempRoot };
}

function shapeVersion(result: { entity: Version; breadcrumb: Breadcrumb }) {
  const { entity, breadcrumb } = result;
  return {
    entity: {
      ...entity,
      version_label: versionLabel(entity.version_number),
      progress: null,
      error: entity.error_message ?? null,
    },
    breadcrumb: breadcrumb.entries,
    breadcrumb_text: breadcrumb.text,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeSubmit(stack: { engine: Engine }, input: any): Promise<ToolResponse> {
  try {
    const parsed = z
      .object({
        action: z.literal('submit'),
        shot_id: z.string().min(1),
        workflow_json: z.record(z.string(), z.unknown()),
        notes: z.string().optional(),
      })
      .parse(input);
    return toolOk(
      shapeVersion(
        await stack.engine.submitGeneration(parsed.shot_id, parsed.workflow_json, parsed.notes),
      ),
    ) as ToolResponse;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const path = first.path.join('.');
      return toolError(
        new TypedError(
          'INVALID_INPUT',
          `Invalid input at 'input.${path}' -- ${first.message}`,
        ),
      ) as ToolResponse;
    }
    return toolError(err) as ToolResponse;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeStatus(stack: { engine: Engine }, input: any): Promise<ToolResponse> {
  try {
    const parsed = z
      .object({
        action: z.literal('status'),
        version_id: z.string().min(1),
      })
      .parse(input);
    return toolOk(
      shapeVersion(await stack.engine.getGenerationStatus(parsed.version_id)),
    ) as ToolResponse;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const path = first.path.join('.');
      return toolError(
        new TypedError(
          'INVALID_INPUT',
          `Invalid input at 'input.${path}' -- ${first.message}`,
        ),
      ) as ToolResponse;
    }
    return toolError(err) as ToolResponse;
  }
}

let stack: Awaited<ReturnType<typeof buildStack>>;
beforeEach(async () => {
  stack = await buildStack();
});
afterEach(async () => {
  await stack.engine.stop();
  await fsp.rm(stack.tempRoot, { recursive: true, force: true });
});

const API_WF = { '1': { class_type: 'KSampler', inputs: { seed: 42 } } };
const UI_WF = { nodes: [{ id: 1, type: 'KSampler' }], links: [] };

describe('generation tool — submit happy path', () => {
  it('structuredContent has entity + breadcrumb + breadcrumb_text with 5-entry breadcrumb ending at v001', async () => {
    const res = await invokeSubmit(stack, {
      action: 'submit',
      shot_id: stack.shotId,
      workflow_json: API_WF,
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      entity: {
        version_number: number;
        version_label: string;
        status: string;
        job_id: string;
      };
      breadcrumb: { type: string }[];
      breadcrumb_text: string;
    };
    expect(sc.entity.version_number).toBe(1);
    expect(sc.entity.version_label).toBe('v001');
    expect(sc.entity.status).toBe('submitted');
    expect(sc.entity.job_id).toBe('prompt_fake_123');
    expect(sc.breadcrumb).toHaveLength(5);
    expect(sc.breadcrumb[4].type).toBe('version');
    expect(sc.breadcrumb_text).toMatch(/ > v001$/);
  });

  it('content[0].text JSON.parse equals structuredContent (D-25)', async () => {
    const res = await invokeSubmit(stack, {
      action: 'submit',
      shot_id: stack.shotId,
      workflow_json: API_WF,
    });
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });

  it('submit resolves quickly (< 1s for fake)', async () => {
    const start = Date.now();
    await invokeSubmit(stack, {
      action: 'submit',
      shot_id: stack.shotId,
      workflow_json: API_WF,
    });
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('generation tool — submit error paths', () => {
  it('UI-format workflow → INVALID_WORKFLOW_FORMAT with hint', async () => {
    const res = await invokeSubmit(stack, {
      action: 'submit',
      shot_id: stack.shotId,
      workflow_json: UI_WF,
    });
    expect(res.isError).toBe(true);
    const p = res.structuredContent as { code: string; hint: string };
    expect(p.code).toBe('INVALID_WORKFLOW_FORMAT');
    expect(p.hint).toContain('Dev Mode > Save (API Format)');
  });

  it('unknown shot_id → SHOT_NOT_FOUND', async () => {
    const res = await invokeSubmit(stack, {
      action: 'submit',
      shot_id: 'shot_nope',
      workflow_json: API_WF,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('SHOT_NOT_FOUND');
  });

  it('missing credentials scenario → COMFYUI_CREDENTIALS_MISSING', async () => {
    // Rebuild stack with a null client.
    const { db } = makeInMemoryDb();
    const repo = new HierarchyRepo(db);
    const vRepo = new VersionRepo(db);
    const tempRoot = await fsp.mkdtemp(
      pth.join(os.tmpdir(), `vfx-gen-tool-nokey-${nanoid(6)}-`),
    );
    const engine = new Engine(repo, vRepo, null, tempRoot);
    const ws = repo.createWorkspace('ws');
    const proj = repo.createProject(ws.id, 'p');
    const seq = repo.createSequence(proj.id, 'sq010');
    const shot = repo.createShot(seq.id, 'sh010');
    try {
      const res = await invokeSubmit(
        { engine },
        { action: 'submit', shot_id: shot.id, workflow_json: API_WF },
      );
      expect(res.isError).toBe(true);
      const p = res.structuredContent as { code: string; hint: string };
      expect(p.code).toBe('COMFYUI_CREDENTIALS_MISSING');
      expect(p.hint).toContain('.env.example');
    } finally {
      await engine.stop();
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('missing shot_id → INVALID_INPUT with input.shot_id in message', async () => {
    const res = await invokeSubmit(stack, {
      action: 'submit',
      workflow_json: API_WF,
    });
    expect(res.isError).toBe(true);
    const p = res.structuredContent as { code: string; message: string };
    expect(p.code).toBe('INVALID_INPUT');
    expect(p.message).toContain('input.shot_id');
  });

  it('non-object workflow_json → INVALID_INPUT with input.workflow_json', async () => {
    const res = await invokeSubmit(stack, {
      action: 'submit',
      shot_id: stack.shotId,
      workflow_json: 'not an object',
    });
    expect(res.isError).toBe(true);
    const p = res.structuredContent as { code: string; message: string };
    expect(p.code).toBe('INVALID_INPUT');
    expect(p.message).toContain('input.workflow_json');
  });
});

describe('generation tool — status path', () => {
  it('status on submitted row returns full entity + breadcrumb', async () => {
    const sub = await invokeSubmit(stack, {
      action: 'submit',
      shot_id: stack.shotId,
      workflow_json: API_WF,
    });
    const versionId = (sub.structuredContent as { entity: { id: string } }).entity.id;
    const res = await invokeStatus(stack, { action: 'status', version_id: versionId });
    const sc = res.structuredContent as {
      entity: Record<string, unknown>;
      breadcrumb: unknown[];
    };
    expect(sc.entity.id).toBe(versionId);
    expect(sc.entity).toHaveProperty('status');
    expect(sc.entity).toHaveProperty('progress');
    expect(sc.entity).toHaveProperty('error');
    expect(sc.entity).toHaveProperty('completed_at');
    expect(sc.breadcrumb).toHaveLength(5);
  });

  it('unknown version_id → VERSION_NOT_FOUND', async () => {
    const res = await invokeStatus(stack, { action: 'status', version_id: 'ver_bogus' });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { code: string }).code).toBe('VERSION_NOT_FOUND');
  });

  it('empty version_id → INVALID_INPUT', async () => {
    const res = await invokeStatus(stack, { action: 'status', version_id: '' });
    expect(res.isError).toBe(true);
    const p = res.structuredContent as { code: string; message: string };
    expect(p.code).toBe('INVALID_INPUT');
    expect(p.message).toContain('input.version_id');
  });
});

describe('generation tool — registration smoke', () => {
  it('registerGeneration registers against a live McpServer (generation tool present)', async () => {
    const { engine } = stack;
    const server = new McpServer({ name: 'test-server', version: '0.0.0' });
    expect(() => registerGeneration(server, engine)).not.toThrow();
    const registered = (
      server as unknown as { _registeredTools: Record<string, unknown> }
    )._registeredTools;
    expect(Object.keys(registered)).toContain('generation');
  });

  it('tool description contains "ComfyUI API-format" and "\'Dev Mode > Save (API Format)\'" (D-GEN-08)', async () => {
    const { engine } = stack;
    const server = new McpServer({ name: 'test-server', version: '0.0.0' });
    registerGeneration(server, engine);
    const registered = (
      server as unknown as {
        _registeredTools: Record<string, { description?: string }>;
      }
    )._registeredTools;
    const desc = registered['generation']?.description ?? '';
    expect(desc).toContain('ComfyUI API-format');
    expect(desc).toContain("'Dev Mode > Save (API Format)'");
  });
});
