import { describe, it, expect } from 'vitest';
import { SHOT_STATUSES, type ShotStatus, type Shot } from '../hierarchy.js';
import { newId, type IdPrefix } from '../../utils/id.js';

/**
 * Phase 20 — STAT-01: closed set of shot production states.
 *
 * Companion guard for the runtime tuple + the IdPrefix union. Types alone
 * are erased at runtime, so we anchor on the SHOT_STATUSES `as const` tuple
 * (the single source of truth grep-test references) and on a generated
 * `sse_*` id from newId().
 */
describe('STAT-01 — ShotStatus type + SHOT_STATUSES runtime tuple', () => {
  it('SHOT_STATUSES contains exactly the five Phase 20 lifecycle values in order', () => {
    expect(SHOT_STATUSES).toEqual([
      'wip',
      'pending-review',
      'approved',
      'on-hold',
      'omit',
    ]);
  });

  it('SHOT_STATUSES is a readonly tuple (frozen `as const`)', () => {
    // `as const` produces a readonly array at the type level; at runtime
    // the array is a plain mutable JS array but the TYPE forbids push().
    // We compile-test by assigning into a typed-narrow alias.
    const values: ReadonlyArray<ShotStatus> = SHOT_STATUSES;
    expect(values.length).toBe(5);
  });

  it('every SHOT_STATUSES value is assignable to ShotStatus', () => {
    // Compile-time check via narrowed alias; if the type drifts from the
    // tuple this line will fail tsc.
    for (const s of SHOT_STATUSES) {
      const narrowed: ShotStatus = s;
      expect(typeof narrowed).toBe('string');
    }
  });

  it('Shot interface carries a status field typed as ShotStatus', () => {
    // Pure compile-time check via assignment: if Shot lacks `status:
    // ShotStatus`, this assignment will fail tsc.
    const sample: Shot = {
      id: 'shot_x',
      sequence_id: 'seq_x',
      name: 'sh010',
      created_at: 0,
      status: 'wip',
    };
    expect(sample.status).toBe('wip');
  });
});

describe('STAT-02 — sse IdPrefix registration', () => {
  it("'sse' is a valid IdPrefix (compile-time + runtime)", () => {
    // Pure compile-time check via the typed const.
    const prefix: IdPrefix = 'sse';
    const id = newId(prefix);
    expect(id).toMatch(/^sse_[A-Za-z0-9_-]{21}$/);
  });
});
