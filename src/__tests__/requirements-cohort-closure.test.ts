/**
 * Phase 14 Plan 14-05 — Task 5 cohort closure smoke test.
 *
 * Asserts the on-disk state of REQUIREMENTS.md + ROADMAP.md after the
 * Phase 14 cohort closure (PROV-V-01 + PROV-V-02 + PROV-V-05 → complete,
 * Deferred to v1.2 section added with the cryptographic-sidecar items).
 *
 * Mirrors the Phase 13 cohort-closure verification pattern (PROV-V-03).
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('Requirements cohort closure (Phase 14 — PROV-V-01 / PROV-V-02 / PROV-V-05)', () => {
  it('REQUIREMENTS.md marks PROV-V-01 complete with [x]', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/- \[x\] \*\*PROV-V-01\*\*:/);
  });

  it('REQUIREMENTS.md marks PROV-V-02 complete with [x]', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/- \[x\] \*\*PROV-V-02\*\*:/);
  });

  it('REQUIREMENTS.md marks PROV-V-05 partially complete with [x]', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/- \[x\] \*\*PROV-V-05\*\*:/);
  });

  it('REQUIREMENTS.md Traceability table shows Complete (Phase 14) for PROV-V-01', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/PROV-V-01.*Phase 14.*Complete/);
  });

  it('REQUIREMENTS.md Traceability table shows Complete (Phase 14) for PROV-V-02', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/PROV-V-02.*Phase 14.*Complete/);
  });

  it('REQUIREMENTS.md Traceability table shows Partially Complete for PROV-V-05', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/PROV-V-05.*Phase 14.*Partially Complete/);
  });

  it('REQUIREMENTS.md has a Deferred to v1.2 section', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/## Deferred to v1\.2/);
  });

  it('REQUIREMENTS.md Deferred to v1.2 mentions Cryptographic sidecar', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/Cryptographic sidecar/);
  });

  it('REQUIREMENTS.md Deferred to v1.2 mentions HSM / hardware-key signing', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/HSM|hardware-key/);
  });

  it('REQUIREMENTS.md Deferred to v1.2 mentions sidecar HTTP route', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/sidecar HTTP route|output\.c2pa/);
  });

  it('REQUIREMENTS.md footer references Concern #8 cryptographic binding closure', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text).toMatch(/Concern #8|c2pa\.hash\.data/);
  });

  it('ROADMAP.md Phase 14 row marked Complete with 5/5 plans', async () => {
    const text = await readFile(resolve('.planning/ROADMAP.md'), 'utf8');
    // The Phase 14 row in the progress table — pattern matches one line.
    const phase14Row = text.split('\n').find((l) => /14\..*C2PA Signed Manifest Emission/.test(l));
    expect(phase14Row).toBeDefined();
    expect(phase14Row).toMatch(/5\/5/);
    expect(phase14Row).toMatch(/Complete/);
    expect(phase14Row).toMatch(/2026-04-30/);
  });

  it('ROADMAP.md Phase 14 detail section: every plan checkbox is [x]', async () => {
    const text = await readFile(resolve('.planning/ROADMAP.md'), 'utf8');
    // Phase 14 has 5 plans — all should be [x] in the detail section.
    expect(text).toMatch(/\[x\] 14-01-PLAN\.md/);
    expect(text).toMatch(/\[x\] 14-02-PLAN\.md/);
    expect(text).toMatch(/\[x\] 14-03-PLAN\.md/);
    expect(text).toMatch(/\[x\] 14-04-PLAN\.md/);
    expect(text).toMatch(/\[x\] 14-05-PLAN\.md/);
  });

  it('ROADMAP.md upper checklist marks Phase 14 complete with [x]', async () => {
    const text = await readFile(resolve('.planning/ROADMAP.md'), 'utf8');
    expect(text).toMatch(/- \[x\] \*\*Phase 14:/);
  });
});

// ============================================================================
// Phase 15 — PROV-V-04 cohort closure smoke (added 2026-04-30 by Plan 15-04)
// ============================================================================

describe('Phase 15 — PROV-V-04 cohort closure smoke', () => {
  it('REQUIREMENTS.md marks PROV-V-04 as [x] complete', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    // [x] checkbox.
    expect(text.includes('[x] **PROV-V-04**')).toBe(true);
    // Traceability row.
    expect(text.includes('| PROV-V-04 | Phase 15 | Complete |')).toBe(true);
  });

  it('REQUIREMENTS.md records v1.2 deferred items from REVISION C3 + IPAdapter audit + LRU cache', async () => {
    const text = await readFile(resolve('.planning/REQUIREMENTS.md'), 'utf8');
    expect(text.includes('Fetch control image bytes from ComfyUI Cloud')).toBe(true);
    expect(text.includes('IPAdapter pack node-variants')).toBe(true);
    expect(text.includes('Per-(parent_version_id, signed_at) LRU cache')).toBe(true);
  });

  it('ROADMAP.md marks Phase 15 row as Complete with date', async () => {
    const text = await readFile(resolve('.planning/ROADMAP.md'), 'utf8');
    // List-entry checkbox.
    expect(text.includes('[x] **Phase 15: Ingredient Graph**')).toBe(true);
    // Progress table row (4/4 plans Complete).
    expect(/15\. Ingredient Graph\s+\|\s+v1\.1\s+\|\s+4\/4\s+\|\s+Complete\s+\|\s+2026-04-30/.test(text)).toBe(true);
  });

  it('Phase 15 plans are committed (15-01..15-04 PLAN.md files exist)', async () => {
    const fs = await import('node:fs');
    const planDir = '.planning/phases/15-ingredient-graph';
    for (const n of ['01', '02', '03', '04']) {
      expect(fs.existsSync(`${planDir}/15-${n}-PLAN.md`)).toBe(true);
    }
  });
});
