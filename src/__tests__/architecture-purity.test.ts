import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * Asserts D-33 / D-34: engine, store, utils, and types layers have zero
 * imports from @modelcontextprotocol/sdk. Tools may import it (they are
 * the only MCP-aware layer). server.ts may import it (it wires transports).
 * Everything else must be pure.
 *
 * Regression anchor for Pattern S1 (tool-engine purity). Future phases
 * that add engine/store/utils/types files inherit these invariants.
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
});
