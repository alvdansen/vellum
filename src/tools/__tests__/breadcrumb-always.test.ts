// Approach: direct-mirror (see error-wrapping.test.ts header). These tests
// verify the breadcrumb-on-every-response invariant (D-22, D-23, S4) and the
// list envelope shape (D-24, S8) by calling engine + shapers + envelope --
// the exact pipeline every registered tool uses.
import { describe, it, expect } from 'vitest';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { Engine } from '../../engine/pipeline.js';
import { toolOk } from '../envelope.js';
import { shapeCreateOrGet, shapeList } from '../shape.js';

function buildTestStack() {
  const { db } = makeInMemoryDb();
  const repo = new HierarchyRepo(db);
  // Phase 2 Engine constructor: (repo, versionRepo, client?). Breadcrumb tests
  // only exercise Phase 1 tools, so `null` client is correct.
  const engine = new Engine(repo, new VersionRepo(db), null);
  return { engine };
}

describe('breadcrumb-always: create responses carry breadcrumb + breadcrumb_text', () => {
  it('workspace create response has breadcrumb array + breadcrumb_text string', () => {
    const { engine } = buildTestStack();
    const res = toolOk(shapeCreateOrGet(engine.createWorkspace('my-ws')));

    const payload = res.structuredContent as {
      entity: { id: string; name: string };
      breadcrumb: { type: string; id: string; name: string }[];
      breadcrumb_text: string;
    };
    expect(payload.breadcrumb).toBeInstanceOf(Array);
    expect(payload.breadcrumb).toHaveLength(1);
    expect(payload.breadcrumb[0]).toMatchObject({ type: 'workspace', name: 'my-ws' });
    expect(payload.breadcrumb[0].id).toBe(payload.entity.id);
    expect(payload.breadcrumb_text).toBe('my-ws');
    // Dual-form contract holds.
    expect(JSON.parse(res.content[0].text)).toEqual(payload);
  });

  it('workspace get response also has breadcrumb + breadcrumb_text', () => {
    const { engine } = buildTestStack();
    const { entity } = engine.createWorkspace('ws-a');
    const res = toolOk(shapeCreateOrGet(engine.getWorkspace(entity.id)));

    const payload = res.structuredContent as {
      breadcrumb: unknown[];
      breadcrumb_text: string;
    };
    expect(payload.breadcrumb).toHaveLength(1);
    expect(payload.breadcrumb_text).toBe('ws-a');
  });

  it('project create response breadcrumb walks 2 levels (ws > proj)', () => {
    const { engine } = buildTestStack();
    const ws = engine.createWorkspace('ws1').entity;
    const res = toolOk(shapeCreateOrGet(engine.createProject(ws.id, 'my-proj')));

    const payload = res.structuredContent as {
      breadcrumb: { type: string; name: string }[];
      breadcrumb_text: string;
    };
    expect(payload.breadcrumb).toHaveLength(2);
    expect(payload.breadcrumb.map((b) => b.type)).toEqual(['workspace', 'project']);
    expect(payload.breadcrumb_text).toBe('ws1 > my-proj');
  });

  it('sequence create response breadcrumb walks 3 levels', () => {
    const { engine } = buildTestStack();
    const ws = engine.createWorkspace('ws1').entity;
    const proj = engine.createProject(ws.id, 'proj1').entity;
    const res = toolOk(shapeCreateOrGet(engine.createSequence(proj.id, 'sq010')));

    const payload = res.structuredContent as {
      breadcrumb: { type: string; name: string }[];
      breadcrumb_text: string;
    };
    expect(payload.breadcrumb).toHaveLength(3);
    expect(payload.breadcrumb.map((b) => b.type)).toEqual([
      'workspace',
      'project',
      'sequence',
    ]);
    expect(payload.breadcrumb_text).toBe('ws1 > proj1 > sq010');
  });

  it('shot create response breadcrumb walks 4 levels joined by " > "', () => {
    const { engine } = buildTestStack();
    const ws = engine.createWorkspace('demo-ws').entity;
    const proj = engine.createProject(ws.id, 'my-proj').entity;
    const seq = engine.createSequence(proj.id, 'sq010').entity;
    const res = toolOk(shapeCreateOrGet(engine.createShot(seq.id, 'sh010')));

    const payload = res.structuredContent as {
      breadcrumb: { type: string; id: string; name: string }[];
      breadcrumb_text: string;
    };
    expect(payload.breadcrumb).toHaveLength(4);
    expect(payload.breadcrumb_text).toBe('demo-ws > my-proj > sq010 > sh010');
    // Each entry has type/id/name (BreadcrumbEntry shape).
    for (const entry of payload.breadcrumb) {
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('name');
    }
  });
});

describe('breadcrumb-always: list envelope shape + breadcrumb on every item', () => {
  it('workspace list envelope has {items,total,limit,offset} with defaults 20/0', () => {
    const { engine } = buildTestStack();
    engine.createWorkspace('ws-a');
    engine.createWorkspace('ws-b');
    engine.createWorkspace('ws-c');

    // Mirror the default Zod coercion: limit=20, offset=0 when omitted.
    const res = toolOk(shapeList(engine.listWorkspaces(20, 0)));
    const payload = res.structuredContent as {
      items: unknown[];
      total: number;
      limit: number;
      offset: number;
    };

    expect(payload).toHaveProperty('items');
    expect(payload).toHaveProperty('total');
    expect(payload).toHaveProperty('limit');
    expect(payload).toHaveProperty('offset');
    expect(payload.items).toHaveLength(3);
    expect(payload.total).toBe(3);
    expect(payload.limit).toBe(20);
    expect(payload.offset).toBe(0);
  });

  it('each item in workspace list carries its own breadcrumb + breadcrumb_text', () => {
    const { engine } = buildTestStack();
    engine.createWorkspace('ws-a');
    engine.createWorkspace('ws-b');
    const res = toolOk(shapeList(engine.listWorkspaces(20, 0)));
    const payload = res.structuredContent as {
      items: {
        id: string;
        name: string;
        breadcrumb: { type: string; name: string }[];
        breadcrumb_text: string;
      }[];
    };

    expect(payload.items.length).toBeGreaterThanOrEqual(2);
    for (const item of payload.items) {
      expect(item.breadcrumb).toBeInstanceOf(Array);
      expect(item.breadcrumb.length).toBeGreaterThanOrEqual(1);
      expect(typeof item.breadcrumb_text).toBe('string');
      expect(item.breadcrumb_text.length).toBeGreaterThan(0);
    }
  });

  it('shot list with sequenceId filter returns each shot with a 4-level breadcrumb', () => {
    const { engine } = buildTestStack();
    const ws = engine.createWorkspace('demo-ws').entity;
    const proj = engine.createProject(ws.id, 'my-proj').entity;
    const seq = engine.createSequence(proj.id, 'sq010').entity;
    engine.createShot(seq.id, 'sh010');
    engine.createShot(seq.id, 'sh020');

    const res = toolOk(shapeList(engine.listShots(seq.id, 20, 0)));
    const payload = res.structuredContent as {
      items: {
        name: string;
        breadcrumb: { type: string; name: string }[];
        breadcrumb_text: string;
      }[];
      total: number;
    };

    expect(payload.items).toHaveLength(2);
    expect(payload.total).toBe(2);
    for (const item of payload.items) {
      expect(item.breadcrumb).toHaveLength(4);
      expect(item.breadcrumb.map((b) => b.type)).toEqual([
        'workspace',
        'project',
        'sequence',
        'shot',
      ]);
      expect(item.breadcrumb_text).toBe(`demo-ws > my-proj > sq010 > ${item.name}`);
    }
  });

  it('workspace list with limit=2, offset=1 returns 2 items of 3 total, echoing limit/offset', () => {
    const { engine } = buildTestStack();
    engine.createWorkspace('ws-a');
    engine.createWorkspace('ws-b');
    engine.createWorkspace('ws-c');

    const res = toolOk(shapeList(engine.listWorkspaces(2, 1)));
    const payload = res.structuredContent as {
      items: unknown[];
      total: number;
      limit: number;
      offset: number;
    };

    expect(payload.items).toHaveLength(2);
    expect(payload.total).toBe(3);
    expect(payload.limit).toBe(2);
    expect(payload.offset).toBe(1);
  });
});
