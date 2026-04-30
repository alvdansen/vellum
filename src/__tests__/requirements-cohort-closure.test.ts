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
