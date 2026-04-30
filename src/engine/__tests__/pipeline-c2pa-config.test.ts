import { describe, test, expect } from 'vitest';
import { makeInMemoryDb } from '../../test-utils/fixtures.js';
import { HierarchyRepo } from '../../store/hierarchy-repo.js';
import { VersionRepo } from '../../store/version-repo.js';
import { ProvenanceRepo } from '../../store/provenance-repo.js';
import { Engine } from '../pipeline.js';
import type { C2paConfig } from '../../types/c2pa.js';

/**
 * Phase 14 — PROV-V-01 / PROV-V-02 / PROV-V-05 (D-CTX-2). Plan 14-01 Task 2.
 *
 * Tiny structural test that the Engine constructor accepts the new
 * `options.c2paConfig` field additively (default null), stores it on a
 * private readonly field, and rejects nothing — the loader at
 * src/utils/c2pa-config.ts is the validation site.
 *
 * Behavior coverage:
 *  - Test 1: type import resolves at compile time (build proves this).
 *  - Test 2: explicit null in options is the disabled-signing state.
 *  - Test 3: explicit C2paConfig is accepted and stored.
 *  - Test 4: omitting c2paConfig defaults to null (back-compat with all
 *    pre-Phase-14 Engine call sites).
 */

function buildEngine(options: { c2paConfig?: C2paConfig | null } = {}): Engine {
  const { db } = makeInMemoryDb();
  const hierarchy = new HierarchyRepo(db);
  const versions = new VersionRepo(db);
  const provenanceRepo = new ProvenanceRepo(db);
  return new Engine(db, hierarchy, versions, provenanceRepo, null, 'outputs', options);
}

describe('Engine constructor — c2paConfig wiring (Phase 14 Plan 14-01 Task 2)', () => {
  test('Test 2: accepts explicit null (disabled-signing default per D-CTX-2)', () => {
    const engine = buildEngine({ c2paConfig: null });
    expect(engine).toBeInstanceOf(Engine);
  });

  test('Test 3: accepts a C2paConfig with both paths and stores it on a private field', () => {
    const cfg: C2paConfig = {
      certPemPath: '/p/cert.pem',
      privateKeyPemPath: '/p/key.pem',
    };
    const engine = buildEngine({ c2paConfig: cfg });
    expect(engine).toBeInstanceOf(Engine);
    // The field is private — read it via TS-cast escape hatch ONLY for this
    // structural test. Plans 14-02 / 14-03 will add a public accessor when
    // they need it. Here we just prove the constructor stored what it received.
    const stored = (engine as unknown as { c2paConfig: C2paConfig | null }).c2paConfig;
    expect(stored).toEqual(cfg);
  });

  test('Test 4: omitting c2paConfig defaults to null (back-compat — all pre-Phase-14 Engine call sites still work)', () => {
    const engine = buildEngine();
    expect(engine).toBeInstanceOf(Engine);
    const stored = (engine as unknown as { c2paConfig: C2paConfig | null }).c2paConfig;
    expect(stored).toBeNull();
  });

  test('Test 1 (compile-time): C2paConfig type import resolves and matches the documented shape', () => {
    // If C2paConfig were not exported, or the shape changed, this test would
    // not compile. Runtime assertion is a tautology — compile-time enforcement
    // is the actual gate.
    const cfg: C2paConfig = {
      certPemPath: '/abs/path/cert.pem',
      privateKeyPemPath: '/abs/path/key.pem',
    };
    expect(typeof cfg.certPemPath).toBe('string');
    expect(typeof cfg.privateKeyPemPath).toBe('string');
  });
});
