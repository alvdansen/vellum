import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';
import { TypedError } from '../errors.js';

/**
 * REGRESSION — project and sequence names must be rejected at CREATION when
 * they cannot serve as a directory segment.
 *
 * These names become path segments in buildOutputPath
 * (project/sequence/shot/vNNN/file), which runs in downloadAndPersist — AFTER
 * the provider has generated and charged. sanitizeRelativeSegment rejected them
 * there, so the version was marked failed and the paid output discarded.
 * Containment always held; the cost is wasted spend, and the trigger is as
 * ordinary as naming a project "Acme / Season 2".
 */

const UNUSABLE_NAMES = [
  'Acme / Season 2', // the realistic one: a human using a slash
  '../escape',
  '..',
  '.',
  'a/b',
  'a\\b',
  'nul\0byte',
  '   ',
];

const USABLE_NAMES = ['DEMO01', 'Acme - Season 2', 'proj.v2', 'a b c', 'ünïcodé'];

describe('project + sequence names must be usable as folder names', () => {
  let engine: Engine;
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    const repo = new HierarchyRepo(db);
    engine = new Engine(db, repo, new VersionRepo(db), new ProvenanceRepo(db), null);
    const ws = engine.createWorkspace('demo-ws');
    workspaceId = ws.entity.id;
    projectId = engine.createProject(workspaceId, 'demo-proj').entity.id;
  });

  test.each(UNUSABLE_NAMES)('project name %j is rejected at creation', (name) => {
    expect(() => engine.createProject(workspaceId, name)).toThrow(TypedError);
  });

  test.each(UNUSABLE_NAMES)('sequence name %j is rejected at creation', (name) => {
    expect(() => engine.createSequence(projectId, name)).toThrow(TypedError);
  });

  test.each(USABLE_NAMES)('project name %j is still accepted', (name) => {
    expect(engine.createProject(workspaceId, name).entity.name).toBe(name);
  });

  test.each(USABLE_NAMES)('sequence name %j is still accepted', (name) => {
    expect(engine.createSequence(projectId, name).entity.name).toBe(name);
  });

  test('rejection carries INVALID_INPUT with actionable guidance', () => {
    try {
      engine.createProject(workspaceId, 'Acme / Season 2');
      expect.unreachable('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TypedError);
      const typed = err as TypedError;
      expect(typed.code).toBe('INVALID_INPUT');
      // The agent (or human) needs to be told what to do, not just "invalid".
      expect(typed.hint).toContain('Acme - Season 2');
    }
  });

  test('a rejected name writes NO row (check happens before DB work)', () => {
    const before = engine.listProjects(workspaceId, 100, 0).total_count;
    expect(() => engine.createProject(workspaceId, 'a/b')).toThrow();
    expect(engine.listProjects(workspaceId, 100, 0).total_count).toBe(before);
  });
});
