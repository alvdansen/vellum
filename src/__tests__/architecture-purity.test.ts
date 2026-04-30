import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

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

  // Phase 13 additions — PROV-V-03. The new model-fingerprint helper is an
  // engine-layer pure file (zero MCP / DB / HTTP imports). The directory-
  // wide `src/engine/` guard at line 34 already covers it transitively;
  // file-level assertions fire in isolation if someone adds an MCP import
  // to one specific file — cheaper to debug than the directory-wide fail.

  it('src/engine/model-fingerprint.ts has zero imports from @modelcontextprotocol/sdk (PROV-V-03)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/model-fingerprint.ts')).toBe(0);
  });

  it('src/engine/model-fingerprint.ts has zero imports from better-sqlite3 (PROV-V-03)', () => {
    expect(grepCount('better-sqlite3', 'src/engine/model-fingerprint.ts')).toBe(0);
  });

  it('src/engine/model-fingerprint.ts has zero imports from drizzle-orm (PROV-V-03)', () => {
    expect(grepCount('drizzle-orm', 'src/engine/model-fingerprint.ts')).toBe(0);
  });

  // Phase 14 additions — PROV-V-01 / Concern #11. The c2pa-node native binding
  // load is deferred to Plan 14-02's signer module (lazy on first sign attempt).
  // Server boot MUST succeed even when the prebuilt N-API binary is missing or
  // mismatched on the host platform — so src/server.ts has ZERO static imports
  // of c2pa-node. The only consumers are scripts/gen-dev-c2pa-cert.mts (dev-
  // only, opt-in) and Plan 14-02's signer wrapper (lazy import). This grep
  // gate is the structural guard against accidentally re-introducing an eager
  // boot-path dependency.
  it('src/server.ts has zero static imports from c2pa-node (Concern #11 — boot resilience)', () => {
    // Use grep -E with a regex tolerant to whitespace + either quote style.
    // `from\s+['"]c2pa-node['"]` matches any `from 'c2pa-node'` or `from "c2pa-node"`
    // import shape. Avoids the fragility of a literal-string match.
    try {
      const out = execFileSync('grep', ['-E', "from[[:space:]]+['\"]c2pa-node['\"]", 'src/server.ts'], {
        encoding: 'utf8',
      });
      // grep exits 0 when matches found — that's a violation
      expect(out.trim(), `static c2pa-node import found in src/server.ts:\n${out}`).toBe('');
    } catch (err) {
      // grep exits 1 when no matches — that's the GREEN state we want
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
  });
});

// ================================================================
// Phase 5 additions (D-WEBUI-31) — HTTP layer, engine events, and
// dashboard source boundary. The HTTP layer (src/http/**) mediates
// between browsers and the engine facade; it must remain MCP-free
// and SQLite-free. The engine event-emitter (src/engine/events.ts)
// publishes structured payloads; it must not leak MCP SDK types.
// The dashboard (packages/dashboard/src/**) is a separately-built
// Preact SPA that communicates with the server only over HTTP —
// any direct import from server source is a boundary violation.
// ================================================================

// Helper: recursively enumerate .ts files (not .test.ts, not .d.ts).
// Used by the Phase 5 file-content assertions below — file-level
// iteration catches additions in new subdirectories without any
// test edits. The plan expects this to also gracefully handle a
// missing dashboard src directory (Plans 08-10 create it); an
// empty-array return is intentional and yields vacuously-green
// assertions until the dashboard source exists.
function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

describe('HTTP layer architecture purity (D-WEBUI-31)', () => {
  const httpDir = path.resolve('src/http');
  const httpSourceFiles = collectSourceFiles(httpDir);

  it('src/http/* has zero imports from @modelcontextprotocol/sdk', () => {
    const violations: string[] = [];
    for (const file of httpSourceFiles) {
      const content = readFileSync(file, 'utf-8');
      if (content.includes('@modelcontextprotocol/sdk')) {
        violations.push(path.relative('src', file));
      }
    }
    expect(
      violations,
      `MCP import found in: ${violations.join(', ')}`,
    ).toHaveLength(0);
  });

  it('src/http/* has zero imports from better-sqlite3 / drizzle-orm', () => {
    const violations: string[] = [];
    for (const file of httpSourceFiles) {
      const content = readFileSync(file, 'utf-8');
      if (content.includes('better-sqlite3') || content.includes('drizzle-orm')) {
        violations.push(path.relative('src', file));
      }
    }
    expect(
      violations,
      `SQLite import found in: ${violations.join(', ')}`,
    ).toHaveLength(0);
  });
});

describe('Engine events module purity (D-WEBUI-31)', () => {
  it('src/engine/events.ts has zero imports from @modelcontextprotocol/sdk', () => {
    const file = path.resolve('src/engine/events.ts');
    const content = readFileSync(file, 'utf-8');
    expect(
      content.includes('@modelcontextprotocol/sdk'),
      'events.ts must not import MCP SDK',
    ).toBe(false);
  });
});

// ================================================================
// Phase 5 Plan 13 — SSE wire-shape adapter is the only serialization
// path (CR-01 regression guard). Asserts:
//   1. src/http/sse.ts exports toDashboardPayload.
//   2. Every JSON.stringify call in sse.ts either (a) passes a
//      toDashboardPayload(...) return value, or (b) is the string
//      literal ": ping" keep-alive (which isn't a stringify call at all).
//   3. `JSON.stringify(payload)` with a raw `payload` identifier is
//      never reintroduced.
// ================================================================

describe('SSE wire-shape adapter is the only serialization path (CR-01)', () => {
  const ssePath = path.resolve('src/http/sse.ts');
  const sseContent = readFileSync(ssePath, 'utf-8');

  it('src/http/sse.ts exports toDashboardPayload', () => {
    expect(sseContent).toMatch(/export\s+function\s+toDashboardPayload\b/);
  });

  it('src/http/sse.ts invokes toDashboardPayload at the writeSSE call site', () => {
    // The listener must call the adapter before JSON.stringify. We look
    // for the textual co-occurrence inside the same write expression.
    // `\s*` covers any whitespace (including newlines) between the opening
    // paren and the adapter call.
    expect(sseContent).toMatch(/JSON\.stringify\(\s*toDashboardPayload\(/);
  });

  it('src/http/sse.ts never calls JSON.stringify(payload) with a raw payload identifier (CR-01 reintroduction guard)', () => {
    // Match JSON.stringify followed by `(` + whitespace + `payload` + `)`.
    // Allows `JSON.stringify(toDashboardPayload(...))` (adapter call) and
    // `JSON.stringify({...})` (object literal). Fails only the raw-
    // forwarding shape that was the CR-01 bug.
    //
    // We strip comments before matching so the prose reference to the
    // forbidden pattern in this file's own docstring does not trip this
    // guard. Line-comments (//) are stripped; the sse.ts file uses // for
    // all commentary.
    const stripped = sseContent
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('//');
        return idx >= 0 ? line.slice(0, idx) : line;
      })
      .join('\n');
    const violations = stripped.match(/JSON\.stringify\(\s*payload\s*\)/g);
    expect(violations, 'raw JSON.stringify(payload) reintroduced — use toDashboardPayload').toBeNull();
  });

  it('src/http/sse.ts header docstring documents the boundary contract', () => {
    // Weak but useful signal — future refactors that delete the header
    // should surface a review signal. Match is case-insensitive on a
    // short unique phrase.
    expect(sseContent.toLowerCase()).toContain('wire-shape');
  });

  // ------------------------------------------------------------------
  // Live-smoke re-verification (gsd-verifier / manual). After Plan 05-13
  // lands, the behavioral spot-check from .planning/phases/05-web-dashboard/
  // 05-VERIFICATION.md §Behavioral Spot-Checks must now produce a
  // camelCase SSE frame instead of the snake_case frame captured at
  // verification time:
  //
  //   Terminal 1:
  //     npx tsx src/server.ts --http --port 3099 --db /tmp/vfx-verify.db
  //   Terminal 2 (listener):
  //     curl -N http://127.0.0.1:3099/api/events
  //   Terminal 3 (trigger):
  //     curl -X POST http://127.0.0.1:3099/mcp \
  //       -H 'Content-Type: application/json' \
  //       -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
  //            "params":{"name":"workspace","arguments":{"action":"create","name":"smoke-ws"}}}'
  //
  // Expected frame on Terminal 2:
  //   event: hierarchy.created
  //   data: {"entityType":"workspace","entityId":"ws_...","parentId":null}
  //
  // Expected keys present:       entityType, entityId   (camelCase)
  // Expected keys absent:        entity_type, entity_id (snake_case)
  // ------------------------------------------------------------------
});

describe('Dashboard source boundary (D-WEBUI-31)', () => {
  // packages/dashboard/src/** must not reach into server source
  // via relative imports. Communication is HTTP-only (fetch + SSE).
  // Currently vacuously green — dashboard src is scaffolded in a
  // later plan. The test activates automatically once .ts files
  // land in packages/dashboard/src/.
  const dashboardSrcDir = path.resolve('packages/dashboard/src');
  const dashboardFiles = collectSourceFiles(dashboardSrcDir);

  it('packages/dashboard/src/** has zero imports from server (../../src/)', () => {
    const violations: string[] = [];
    for (const file of dashboardFiles) {
      const content = readFileSync(file, 'utf-8');
      // Any relative path escaping the dashboard package and landing
      // in server source is a boundary violation. Guards against both
      // direct (../../src) and nested (../../../src) traversals.
      if (content.includes('../../src') || content.includes('../../../src')) {
        violations.push(path.relative(dashboardSrcDir, file));
      }
    }
    expect(
      violations,
      `Dashboard imports from server: ${violations.join(', ')}`,
    ).toHaveLength(0);
  });
});
