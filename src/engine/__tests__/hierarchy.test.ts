import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { Engine } from '../pipeline.js';

describe('hierarchy engine — CRUD, errors, breadcrumbs', () => {
  let engine: Engine;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    // Phase 2 Engine constructor: (repo, versionRepo, client?). Phase 1 tests
    // never exercise generation, so `null` client is the canonical shape here.
    engine = new Engine(new HierarchyRepo(db), new VersionRepo(db), null);
  });

  test('create full hierarchy returns breadcrumb walking 4 levels', () => {
    const ws = engine.createWorkspace('demo-ws');
    const proj = engine.createProject(ws.entity.id, 'my-proj');
    const seq = engine.createSequence(proj.entity.id, 'sq010');
    const shot = engine.createShot(seq.entity.id, 'sh010');

    const fetched = engine.getShot(shot.entity.id);
    expect(fetched.breadcrumb.text).toBe('demo-ws > my-proj > sq010 > sh010');
    expect(fetched.breadcrumb.entries).toHaveLength(4);
    expect(fetched.breadcrumb.entries[0].type).toBe('workspace');
    expect(fetched.breadcrumb.entries[1].type).toBe('project');
    expect(fetched.breadcrumb.entries[2].type).toBe('sequence');
    expect(fetched.breadcrumb.entries[3].type).toBe('shot');
  });

  test('duplicate workspace name throws DUPLICATE_NAME (not raw SQLite)', () => {
    engine.createWorkspace('ws1');
    try {
      engine.createWorkspace('ws1');
      throw new Error('expected throw');
    } catch (err: any) {
      expect(err.name).toBe('TypedError');
      expect(err.code).toBe('DUPLICATE_NAME');
      expect(err.message).not.toContain('SQLITE_CONSTRAINT');
    }
  });

  test('duplicate project under same workspace throws DUPLICATE_NAME', () => {
    const ws = engine.createWorkspace('ws1');
    engine.createProject(ws.entity.id, 'proj1');
    try {
      engine.createProject(ws.entity.id, 'proj1');
      throw new Error('expected throw');
    } catch (err: any) {
      expect(err.name).toBe('TypedError');
      expect(err.code).toBe('DUPLICATE_NAME');
      expect(err.message).not.toContain('SQLITE_CONSTRAINT');
    }
  });

  test('duplicate sequence under same project throws DUPLICATE_NAME', () => {
    const ws = engine.createWorkspace('ws1');
    const proj = engine.createProject(ws.entity.id, 'proj1');
    engine.createSequence(proj.entity.id, 'sq010');
    expect(() => engine.createSequence(proj.entity.id, 'sq010')).toThrowTypedError(
      'DUPLICATE_NAME',
    );
  });

  test('duplicate shot under same sequence throws DUPLICATE_NAME', () => {
    const ws = engine.createWorkspace('ws1');
    const proj = engine.createProject(ws.entity.id, 'proj1');
    const seq = engine.createSequence(proj.entity.id, 'sq010');
    engine.createShot(seq.entity.id, 'sh010');
    expect(() => engine.createShot(seq.entity.id, 'sh010')).toThrowTypedError(
      'DUPLICATE_NAME',
    );
  });

  test('creating project under missing workspace throws PARENT_NOT_FOUND', () => {
    try {
      engine.createProject('ws_nonexistent', 'foo');
      throw new Error('expected throw');
    } catch (err: any) {
      expect(err.name).toBe('TypedError');
      expect(err.code).toBe('PARENT_NOT_FOUND');
      expect(err.message).toContain('ws_nonexistent');
    }
  });

  test('creating sequence under missing project throws PARENT_NOT_FOUND', () => {
    expect(() => engine.createSequence('proj_nonexistent', 'sq010')).toThrowTypedError(
      'PARENT_NOT_FOUND',
    );
  });

  test('creating shot under missing sequence throws PARENT_NOT_FOUND', () => {
    // Note: a non-regex-matching name would throw INVALID_SHOT_FORMAT first,
    // so we use a valid name to exercise the parent-not-found path.
    expect(() => engine.createShot('seq_nonexistent', 'sh010')).toThrowTypedError(
      'PARENT_NOT_FOUND',
    );
  });

  test('getWorkspace with missing id throws WORKSPACE_NOT_FOUND', () => {
    expect(() => engine.getWorkspace('ws_nonexistent')).toThrowTypedError(
      'WORKSPACE_NOT_FOUND',
    );
  });

  test('getProject / getSequence / getShot with missing id throw *_NOT_FOUND', () => {
    expect(() => engine.getProject('proj_nonexistent')).toThrowTypedError(
      'PROJECT_NOT_FOUND',
    );
    expect(() => engine.getSequence('seq_nonexistent')).toThrowTypedError(
      'SEQUENCE_NOT_FOUND',
    );
    expect(() => engine.getShot('shot_nonexistent')).toThrowTypedError('SHOT_NOT_FOUND');
  });

  test('list returns {items, total, limit, offset}; each item has breadcrumb entries + text', () => {
    engine.createWorkspace('ws-a');
    engine.createWorkspace('ws-b');
    engine.createWorkspace('ws-c');

    const result = engine.listWorkspaces(20, 0);
    expect(result.total).toBe(3);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.items).toHaveLength(3);
    for (const item of result.items) {
      expect(item.entries).toBeDefined();
      expect(item.entries.length).toBeGreaterThan(0);
      expect(typeof item.text).toBe('string');
      expect(item.text.length).toBeGreaterThan(0);
    }
  });

  test('list envelope honors limit + offset pagination', () => {
    for (let i = 0; i < 5; i++) engine.createWorkspace(`ws-${i}`);
    const page1 = engine.listWorkspaces(2, 0);
    const page2 = engine.listWorkspaces(2, 2);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page2.offset).toBe(2);
  });

  test('breadcrumb resolves correctly for all 4 entity types at get-time', () => {
    const ws = engine.createWorkspace('w1');
    const proj = engine.createProject(ws.entity.id, 'p1');
    const seq = engine.createSequence(proj.entity.id, 'sq010');
    const shot = engine.createShot(seq.entity.id, 'sh010');

    const gotWs = engine.getWorkspace(ws.entity.id);
    expect(gotWs.breadcrumb.entries.map((e) => e.type)).toEqual(['workspace']);
    expect(gotWs.breadcrumb.text).toBe('w1');

    const gotProj = engine.getProject(proj.entity.id);
    expect(gotProj.breadcrumb.entries.map((e) => e.type)).toEqual(['workspace', 'project']);
    expect(gotProj.breadcrumb.text).toBe('w1 > p1');

    const gotSeq = engine.getSequence(seq.entity.id);
    expect(gotSeq.breadcrumb.entries.map((e) => e.type)).toEqual([
      'workspace',
      'project',
      'sequence',
    ]);
    expect(gotSeq.breadcrumb.text).toBe('w1 > p1 > sq010');

    const gotShot = engine.getShot(shot.entity.id);
    expect(gotShot.breadcrumb.entries.map((e) => e.type)).toEqual([
      'workspace',
      'project',
      'sequence',
      'shot',
    ]);
    expect(gotShot.breadcrumb.text).toBe('w1 > p1 > sq010 > sh010');
  });

  test('listProjects filters by workspace when workspaceId provided', () => {
    const a = engine.createWorkspace('ws-a');
    const b = engine.createWorkspace('ws-b');
    engine.createProject(a.entity.id, 'p-a1');
    engine.createProject(a.entity.id, 'p-a2');
    engine.createProject(b.entity.id, 'p-b1');

    const filteredA = engine.listProjects(a.entity.id, 20, 0);
    expect(filteredA.total).toBe(2);
    expect(filteredA.items).toHaveLength(2);
    for (const item of filteredA.items) {
      expect(item.workspace_id).toBe(a.entity.id);
    }

    const all = engine.listProjects(undefined, 20, 0);
    expect(all.total).toBe(3);
  });

  test('newId produces distinct 21+ char nanoid values with entity prefix', () => {
    const a = engine.createWorkspace('a');
    const b = engine.createWorkspace('b');
    expect(a.entity.id).not.toBe(b.entity.id);
    expect(a.entity.id.startsWith('ws_')).toBe(true);
    expect(b.entity.id.startsWith('ws_')).toBe(true);
    // 'ws_' (3 chars) + nanoid default (21 chars) = 24, so ≥ 21 is the floor.
    expect(a.entity.id.length).toBeGreaterThanOrEqual(21);
  });
});
