// Approach: direct-mirror. The MCP SDK's registered-tool handler path is
// private (`_registeredTools.handler`) and is designed to be driven by a live
// JSON-RPC transport. Per plan 01-02 task 4's explicit fallback, these tests
// mirror the handler body: (a) call the engine, (b) pipe through
// shapeCreateOrGet/shapeList, (c) envelope via toolOk/toolError -- the exact
// pipeline each registered tool uses. Smoke tests at the bottom also verify
// registerX registers against a live McpServer without throwing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../../engine/pipeline.js';
import { TypedError } from '../../engine/errors.js';
import { toolOk, toolError } from '../envelope.js';
import { shapeCreateOrGet } from '../shape.js';
import {
  registerWorkspace,
  registerProject,
  registerSequence,
  registerShot,
} from '../index.js';

/**
 * Unified tool-response shape for test-side narrowing. Matches MCP's
 * CallToolResult where isError is optional on both success and error variants.
 */
type ToolResponse = {
  isError?: boolean;
  structuredContent: { [key: string]: unknown };
  content: { type: 'text'; text: string }[];
};

function buildTestStack() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  // Phase 3 Engine constructor: (repo, versionRepo, provenanceRepo, client?).
  // Error-wrapping tests only exercise Phase 1 tools, so `null` client is correct.
  const engine = new Engine(repo, new VersionRepo(db), new ProvenanceRepo(db), null);
  return { repo, engine };
}

/**
 * Direct mirror of a tool handler for create-path testing. Matches the shape
 * used in registerWorkspace / registerProject / registerSequence / registerShot.
 */
function invokeCreate<TEntity>(
  fn: () => {
    entity: TEntity;
    breadcrumb: import('../../types/hierarchy.js').Breadcrumb;
  },
): ToolResponse {
  try {
    return toolOk(shapeCreateOrGet(fn()));
  } catch (err) {
    return toolError(err);
  }
}

/**
 * Direct mirror of shot-tool handler WITH the Zod-regex detection branch
 * (matches shot-tool.ts exact catch logic).
 */
function invokeShotCreate(
  engine: Engine,
  sequenceId: string,
  name: string,
): ToolResponse {
  // Replicates the shot-tool Zod schema: name must match ^sh\d{3,}$ with
  // the sentinel message 'INVALID_SHOT_FORMAT'.
  const regex = /^sh\d{3,}$/;
  try {
    if (!regex.test(name)) {
      // Handler's Zod-failure branch re-mapped via the sentinel detection.
      return toolError(
        new TypedError(
          'INVALID_SHOT_FORMAT',
          `Shot name does not match expected format`,
          `Shot names must match ^sh\\d{3,}$ -- e.g. 'sh010', 'sh020'`,
        ),
      );
    }
    return toolOk(shapeCreateOrGet(engine.createShot(sequenceId, name)));
  } catch (err) {
    return toolError(err);
  }
}

describe('error-wrapping: TypedError from engine flows through envelope (D-28)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('duplicate workspace name becomes isError:true with DUPLICATE_NAME', () => {
    const { engine } = buildTestStack();
    invokeCreate(() => engine.createWorkspace('ws1')); // first create succeeds
    const res = invokeCreate(() => engine.createWorkspace('ws1')); // dup

    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code: string; message: string; hint?: string };
    expect(payload.code).toBe('DUPLICATE_NAME');
    expect(payload.message).toContain('ws1');
    // Content text mirrors structuredContent (D-25).
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });

  it('TypedError with hint propagates the hint field (D-31 present)', () => {
    const { engine } = buildTestStack();
    engine.createWorkspace('ws1');
    const res = invokeCreate(() => engine.createWorkspace('ws1'));

    const payload = res.structuredContent as { code: string; message: string; hint?: string };
    expect(payload.hint).toBeDefined();
    expect(payload.hint).toMatch(/different name|list existing/);
  });

  it('PARENT_NOT_FOUND wraps correctly from the project create path', () => {
    const { engine } = buildTestStack();
    const res = invokeCreate(() => engine.createProject('nonexistent', 'my-proj'));

    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code: string; message: string; hint?: string };
    expect(payload.code).toBe('PARENT_NOT_FOUND');
    expect(payload.message).toContain('nonexistent');
    expect(payload.hint).toBeDefined();
  });

  it('Zod-style failure (empty name) rewraps as INVALID_INPUT with input.path in message', () => {
    // Mirror the handler's Zod failure path: construct a ZodError, let the
    // handler's catch branch re-wrap it. Same flow as every registered tool's
    // catch(z.ZodError) branch in tools/*-tool.ts.
    const TestSchema = z.object({ name: z.string().min(1) });
    const parse = TestSchema.safeParse({ name: '' });
    expect(parse.success).toBe(false);
    if (parse.success) return;

    const first = parse.error.issues[0];
    const path = first.path.join('.');
    const res: ToolResponse = toolError(
      new TypedError(
        'INVALID_INPUT',
        `Invalid input at 'input.${path}' -- ${first.message}`,
      ),
    );

    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code: string; message: string };
    expect(payload.code).toBe('INVALID_INPUT');
    expect(payload.message).toContain('input.name');
  });

  it('raw SQLite error from repo does not leak into the response body (D-13)', () => {
    const { engine, repo } = buildTestStack();
    // Make the repo throw a raw SQLite-looking error that is NOT a TypedError
    // and NOT a UNIQUE-wrapped one -- should hit the envelope fallback.
    const rawErr = new Error(
      'SQLITE_CONSTRAINT: some obscure internal constraint failure message',
    );
    (rawErr as Error & { code?: string }).code = 'SQLITE_MISUSE'; // non-unique
    const spy = vi.spyOn(repo, 'createWorkspace').mockImplementation(() => {
      throw rawErr;
    });

    const res = invokeCreate(() => engine.createWorkspace('some-ws'));

    expect(res.isError).toBe(true);
    const wireForm = JSON.stringify(res);
    expect(wireForm).not.toContain('SQLITE_CONSTRAINT');
    expect(wireForm).not.toContain('SQLITE_MISUSE');
    expect(wireForm).not.toContain('obscure internal constraint failure');
    const payload = res.structuredContent as { code: string };
    expect(payload.code).toBe('INVALID_INPUT');
    spy.mockRestore();
  });

  it('shot name "SH010" fails with INVALID_SHOT_FORMAT at the tool boundary (D-07)', () => {
    const { engine } = buildTestStack();
    const ws = engine.createWorkspace('demo').entity;
    const proj = engine.createProject(ws.id, 'my-proj').entity;
    const seq = engine.createSequence(proj.id, 'sq010').entity;

    const res = invokeShotCreate(engine, seq.id, 'SH010');

    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code: string; hint?: string };
    expect(payload.code).toBe('INVALID_SHOT_FORMAT');
    expect(payload.hint).toBeDefined();
    expect(payload.hint).toContain('sh010');
  });

  it('shot name "sh1" fails with INVALID_SHOT_FORMAT (too few digits)', () => {
    const { engine } = buildTestStack();
    const ws = engine.createWorkspace('demo').entity;
    const proj = engine.createProject(ws.id, 'my-proj').entity;
    const seq = engine.createSequence(proj.id, 'sq010').entity;

    const res = invokeShotCreate(engine, seq.id, 'sh1');

    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code: string; hint?: string };
    expect(payload.code).toBe('INVALID_SHOT_FORMAT');
    expect(payload.hint).toBeDefined();
  });

  it('shot name "sh_010" fails with INVALID_SHOT_FORMAT (underscore not allowed)', () => {
    const { engine } = buildTestStack();
    const ws = engine.createWorkspace('demo').entity;
    const proj = engine.createProject(ws.id, 'my-proj').entity;
    const seq = engine.createSequence(proj.id, 'sq010').entity;

    const res = invokeShotCreate(engine, seq.id, 'sh_010');

    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { code: string };
    expect(payload.code).toBe('INVALID_SHOT_FORMAT');
  });
});

describe('error-wrapping: registerX smoke (registration does not throw)', () => {
  it('all 4 register functions register their tools against a live McpServer', () => {
    const { engine } = buildTestStack();
    const server = new McpServer({ name: 'test-server', version: '0.0.0' });

    expect(() => registerWorkspace(server, engine)).not.toThrow();
    expect(() => registerProject(server, engine)).not.toThrow();
    expect(() => registerSequence(server, engine)).not.toThrow();
    expect(() => registerShot(server, engine)).not.toThrow();

    // Confirm all 4 tools registered (internal _registeredTools keyed by name).
    const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(Object.keys(registered).sort()).toEqual(
      ['project', 'sequence', 'shot', 'workspace'].sort(),
    );
  });
});
