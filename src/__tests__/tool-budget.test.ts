import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * Asserts D-04 / TOOL-01: the 12-tool budget. Phase 1 uses exactly 4.
 * Counts tool-registration call-sites across src/tools/ only — that is the
 * single layer allowed to import the MCP SDK (D-33, enforced independently
 * by architecture-purity.test.ts). Any future call-site outside src/tools/
 * breaks the purity invariant and should fail the architecture test first.
 *
 * Future phases adding tools will bump the "exactly" assertion — if the phase
 * is unexpectedly over budget, Pitfall #1 (tool explosion) is the warning.
 * The <=12 ceiling is immutable for the v1 milestone.
 */
function registerToolCount(): number {
  try {
    const out = execFileSync(
      'grep',
      ['-rE', 'server\\.registerTool\\(', 'src/tools/'],
      { encoding: 'utf8' },
    );
    return out.trim() ? out.trim().split('\n').length : 0;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return 0;
    throw err;
  }
}

describe('tool budget', () => {
  it('stays under the 12-tool cap (Pitfall #1)', () => {
    expect(registerToolCount()).toBeLessThanOrEqual(12);
  });

  it('Phase 1 registers exactly 4 tools (D-04)', () => {
    expect(registerToolCount()).toBe(4);
  });
});
