import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * Asserts D-33 / D-34 / D-GEN-21: engine, store, utils, types, AND comfyui
 * layers have zero imports from @modelcontextprotocol/sdk. Tools may import
 * it (they are the only MCP-aware layer). server.ts may import it (it wires
 * transports). Everything else must be pure.
 *
 * Phase 2 extension: src/comfyui/** is the HTTP-client boundary — it must
 * also have zero better-sqlite3 and zero drizzle-orm imports (D-GEN-21).
 * The HTTP client is a pure fetch wrapper, no DB awareness.
 *
 * Regression anchor for Pattern S1 (tool-engine purity). Future phases
 * that add engine/store/utils/types/comfyui files inherit these invariants.
 */
function grepCount(pattern: string, ...paths: string[]): number {
  try {
    const out = execFileSync('grep', ['-r', '-l', pattern, ...paths], {
      encoding: 'utf8',
    });
    return out.trim() ? out.trim().split('\n').length : 0;
  } catch (err) {
    // grep exits 1 when no matches — treat as 0
    const status = (err as { status?: number }).status;
    if (status === 1) return 0;
    throw err;
  }
}

describe('architecture purity', () => {
  it('src/engine/ has zero imports from @modelcontextprotocol/sdk', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/')).toBe(0);
  });

  it('src/store/ has zero imports from @modelcontextprotocol/sdk', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/store/')).toBe(0);
  });

  it('src/utils/ has zero imports from @modelcontextprotocol/sdk', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/utils/')).toBe(0);
  });

  it('src/types/ has zero imports from @modelcontextprotocol/sdk', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/types/')).toBe(0);
  });

  // Phase 2 additions — src/comfyui/** is the HTTP boundary (D-GEN-21).
  // Zero MCP SDK imports, zero DB imports. Pure fetch wrapper.
  it('src/comfyui/ has zero imports from @modelcontextprotocol/sdk (D-GEN-21)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/comfyui/')).toBe(0);
  });

  it('src/comfyui/ has zero imports from better-sqlite3 (D-GEN-21)', () => {
    expect(grepCount('better-sqlite3', 'src/comfyui/')).toBe(0);
  });

  it('src/comfyui/ has zero imports from drizzle-orm (D-GEN-21)', () => {
    expect(grepCount('drizzle-orm', 'src/comfyui/')).toBe(0);
  });

  // Phase 4 additions — file-level assertions for the new engine + repo files
  // (D-ASST-26). The directory-level src/engine/ and src/store/ assertions
  // already cover these transitively, but file-level assertions fire in
  // isolation if someone adds an MCP import to one specific file — cheaper
  // to debug than the directory-wide fail.

  it('src/engine/assets.ts has zero imports from @modelcontextprotocol/sdk (D-ASST-26)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/assets.ts')).toBe(0);
  });

  it('src/store/tag-repo.ts has zero imports from @modelcontextprotocol/sdk (D-ASST-26)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/store/tag-repo.ts')).toBe(0);
  });

  it('src/store/metadata-repo.ts has zero imports from @modelcontextprotocol/sdk (D-ASST-26)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/store/metadata-repo.ts')).toBe(0);
  });
});
