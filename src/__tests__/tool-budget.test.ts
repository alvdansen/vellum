import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asserts D-04 / TOOL-01 / D-GEN-03 / D-PROV-07 / D-ASST-01: the 12-tool budget.
 * Phase 4 uses exactly 7: workspace, project, sequence, shot, generation,
 * version, asset.
 *
 * Counts tool-registration call-sites across src/tools/ only — that is the
 * single layer allowed to import the MCP SDK (D-33, enforced independently
 * by architecture-purity.test.ts). Any future call-site outside src/tools/
 * breaks the purity invariant and should fail the architecture test first.
 *
 * Future phases adding tools will bump the "exactly" assertion. The <=12
 * ceiling is immutable for the v1 milestone.
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

/**
 * Walk src/tools/*.ts (skipping __tests__) and pull the tool-name literal
 * immediately following each `server.registerTool(` call. The SDK's call
 * signature spreads the name to a separate line in all tool files, so a
 * single-line grep can't match — readFile + multi-line regex is the
 * simplest portable solution (avoids GNU-only `-Pzo`).
 */
function registeredToolNames(): string[] {
  const names: string[] = [];
  const toolsDir = 'src/tools';
  for (const entry of readdirSync(toolsDir)) {
    const full = join(toolsDir, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.endsWith('.ts')) continue;
    const content = readFileSync(full, 'utf8');
    // Match `server.registerTool(` followed by whitespace/newlines then
    // a single-quoted lowercase name. `s` flag lets `.` span newlines.
    const pattern = /server\.registerTool\(\s*'([a-z_-]+)'/gs;
    for (const m of content.matchAll(pattern)) {
      names.push(m[1]);
    }
  }
  return names.sort();
}

describe('tool budget', () => {
  it('stays under the 12-tool cap (Pitfall #1)', () => {
    expect(registerToolCount()).toBeLessThanOrEqual(12);
  });

  it('Phase 4 registers exactly 7 tools (D-ASST-01)', () => {
    // Phase 1: workspace, project, sequence, shot (4).
    // Phase 2 adds: generation (5).
    // Phase 3 adds: version (6).
    // Phase 4 adds: asset (7).
    // Any tool added beyond 7 must come with an explicit bump here so
    // Pitfall #1 (tool explosion) stays visible.
    expect(registerToolCount()).toBe(7);
  });

  it('registered tool name set is exactly [asset, generation, project, sequence, shot, version, workspace]', () => {
    const names = registeredToolNames();
    expect(names).toHaveLength(7);
    expect(names).toEqual(
      ['asset', 'generation', 'project', 'sequence', 'shot', 'version', 'workspace'],
    );
    // Sorted alphabetically — stable snapshot. The original declaration
    // order in src/server.ts is workspace, project, sequence, shot,
    // generation, version, asset; this test sorts so ordering changes don't
    // cause spurious failures.
  });
});
