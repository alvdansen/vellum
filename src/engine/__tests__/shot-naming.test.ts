import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { Engine } from '../pipeline.js';

/**
 * Parameterized tests for the ^sh\d{3,}$ shot naming regex (D-07, HIER-05).
 * Maps to VALIDATION.md row 01-SHOT-REGEX.
 */

const VALID_SHOT_NAMES = [
  'sh010',
  'sh020',
  'sh015',
  'sh0120',
  'sh1000',
  'sh999999',
];

const INVALID_SHOT_NAMES = [
  'SH010',    // uppercase prefix
  'sh1',      // only 1 digit
  'sh_010',   // underscore
  'shot010',  // wrong prefix
  'sh01',     // 2 digits
  'SH_010',   // uppercase + underscore
  'sh-010',   // dash
  'sh010a',   // trailing char
  '',         // empty
  'Sh010',    // mixed case
];

describe('shot naming regex (^sh\\d{3,}$)', () => {
  let engine: Engine;
  let sequenceId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    const repo = new HierarchyRepo(db);
    // Phase 2 Engine constructor: (repo, versionRepo, client?).
    engine = new Engine(repo, new VersionRepo(db), null);

    // Seed a workspace → project → sequence so createShot has a valid parent.
    const ws = engine.createWorkspace('demo-ws');
    const proj = engine.createProject(ws.entity.id, 'demo-proj');
    const seq = engine.createSequence(proj.entity.id, 'sq010');
    sequenceId = seq.entity.id;
  });

  test.each(VALID_SHOT_NAMES)('valid shot name %s is accepted', (name) => {
    const result = engine.createShot(sequenceId, name);
    expect(result.entity.name).toBe(name);
    expect(result.breadcrumb.entries).toHaveLength(4);
    expect(result.breadcrumb.text).toContain(name);
  });

  test.each(INVALID_SHOT_NAMES)('invalid shot name %j is rejected as INVALID_SHOT_FORMAT', (name) => {
    expect(() => engine.createShot(sequenceId, name)).toThrowTypedError('INVALID_SHOT_FORMAT');
  });
});
