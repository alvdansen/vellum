import { describe, test, expect, beforeEach } from 'vitest';
import '../../test-utils/matchers.js';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';

/**
 * Shot naming (HIER-05, was VALIDATION.md row 01-SHOT-REGEX).
 *
 * The rule used to be `^sh\d{3,}$`, which made one studio's convention a global
 * law and left every other studio's shot codes unrepresentable. It is now a
 * SAFETY rule, not a style rule: a shot name becomes a directory segment, a
 * breadcrumb entry and a markdown heading, so it must be path-safe and
 * unambiguous — and beyond that, a studio names its own shots.
 *
 * The widening is strict: every name that was legal under the old pattern is
 * still legal, so no persisted row can become invalid.
 */

const VALID_SHOT_NAMES = [
  // Everything the old pattern allowed still works.
  'sh010',
  'sh020',
  'sh0120',
  'sh999999',
  // …and the conventions it used to refuse.
  'SH014',           // uppercase — the most common real-world form
  'Sh010',           // mixed case
  'sh1',             // short numbers are a studio's business, not ours
  'sh_010',          // underscore separator
  'sh-010',          // hyphen separator
  'shot010',         // a different prefix
  'EP101_SH014',     // episode-qualified
  'SC012_SH0030',    // scene-qualified
  'sh010.v2',        // dotted qualifier
  'a',               // single char
  'console',         // merely STARTS with a reserved name — legal
  'x'.repeat(100),   // at the length ceiling
];

const INVALID_SHOT_NAMES: [string, string][] = [
  ['', 'empty'],
  ['.hidden', 'leading dot would create a hidden directory'],
  ['-rf', 'leading hyphen reads as a flag to anything shelling out'],
  ['a..b', 'contains .. — path traversal'],
  ['..', 'parent directory'],
  ['sh010.', 'trailing dot; Windows strips it, so this collides with sh010 on disk'],
  ['CON', 'Windows reserved device name'],
  ['con.png', 'reserved device name with an extension'],
  ['LPT3', 'reserved device name'],
  ['nul', 'reserved device name, lowercase'],
  ['sh 010', 'space'],
  ['sh/010', 'path separator'],
  ['sh\\010', 'Windows path separator'],
  ['sh>010', 'angle bracket — the breadcrumb separator is " > "'],
  ['x'.repeat(101), 'over the 100-char ceiling'],
  ['sh‮010', 'bidirectional override — can make a name display as something else'],
];

describe('shot naming', () => {
  let engine: Engine;
  let sequenceId: string;

  beforeEach(() => {
    const { db } = makeInMemoryDb();
    const repo = new HierarchyRepo(db);
    engine = new Engine(db, repo, new VersionRepo(db), new ProvenanceRepo(db), null);

    const ws = engine.createWorkspace('demo-ws');
    const proj = engine.createProject(ws.entity.id, 'demo-proj');
    const seq = engine.createSequence(proj.entity.id, 'sq010');
    sequenceId = seq.entity.id;
  });

  test.each(VALID_SHOT_NAMES)('accepts %j', (name) => {
    const result = engine.createShot(sequenceId, name);
    expect(result.entity.name).toBe(name);
    expect(result.breadcrumb.entries).toHaveLength(4);
    expect(result.breadcrumb.text).toContain(name);
  });

  test.each(INVALID_SHOT_NAMES)('rejects %j (%s)', (name) => {
    expect(() => engine.createShot(sequenceId, name)).toThrowTypedError('INVALID_SHOT_FORMAT');
  });

  test('the rejection message tells you what IS allowed, with real examples', () => {
    try {
      engine.createShot(sequenceId, 'sh 010');
      throw new Error('expected a rejection');
    } catch (err) {
      const msg = (err as Error).message + ((err as { hint?: string }).hint ?? '');
      expect(msg).toContain('SH014');
      expect(msg).toMatch(/directory/i);
    }
  });

  test('case-differing names are distinct shots (SQLite UNIQUE is case-sensitive)', () => {
    // Documented, not asserted-as-desirable: nothing stops a caller creating
    // both. Worth knowing before wiring an importer that normalizes case.
    engine.createShot(sequenceId, 'SH010');
    expect(() => engine.createShot(sequenceId, 'sh010')).not.toThrow();
  });
});
