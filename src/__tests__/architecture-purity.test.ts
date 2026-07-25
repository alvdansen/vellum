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

  // Pivot Phase A — src/providers/** is the generation-backend seam
  // (GenerationProvider interface + future adapters). It is part of the pure
  // core: zero MCP SDK, zero DB. Adapters may make HTTP calls (like src/comfyui/)
  // but must never reach the MCP or persistence layers.
  it('src/providers/ has zero imports from @modelcontextprotocol/sdk (pivot Phase A)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/providers/')).toBe(0);
  });

  it('src/providers/ has zero imports from better-sqlite3 (pivot Phase A)', () => {
    expect(grepCount('better-sqlite3', 'src/providers/')).toBe(0);
  });

  it('src/providers/ has zero imports from drizzle-orm (pivot Phase A)', () => {
    expect(grepCount('drizzle-orm', 'src/providers/')).toBe(0);
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

  // ================================================================
  // Phase 14 Plan 14-02 — engine-layer C2PA module purity (PROV-V-01).
  // The new src/engine/c2pa/ directory MUST be MCP-free, SQLite-free,
  // ORM-free, HTTP-server-free. Additionally, the c2pa-node native
  // binding import is centralized in EXACTLY ONE file: signer.ts.
  // Plan 14-03 (engine integration) and Plan 14-04 (HTTP route) reach
  // c2pa-node only through the index.ts barrel + signer wrapper.
  // ================================================================

  it('src/engine/c2pa/ has zero imports from @modelcontextprotocol/sdk (PROV-V-01)', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/c2pa/')).toBe(0);
  });

  it('src/engine/c2pa/ has zero imports from better-sqlite3 (PROV-V-01)', () => {
    expect(grepCount('better-sqlite3', 'src/engine/c2pa/')).toBe(0);
  });

  it('src/engine/c2pa/ has zero imports from drizzle-orm (PROV-V-01)', () => {
    expect(grepCount('drizzle-orm', 'src/engine/c2pa/')).toBe(0);
  });

  it('src/engine/c2pa/ has zero imports from hono (robust regex, LOW review note)', () => {
    // Robust regex per LOW review note — handles single-quote, double-
    // quote, any whitespace between `from` and the quote.
    try {
      const out = execFileSync(
        'grep',
        ['-rE', "from[[:space:]]*['\"]hono['\"]", 'src/engine/c2pa/'],
        { encoding: 'utf8' },
      );
      expect(out.trim(), `hono import found in src/engine/c2pa/:\n${out}`).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
  });

  it('src/engine/c2pa/ has zero imports from @hono/node-server', () => {
    expect(grepCount('@hono/node-server', 'src/engine/c2pa/')).toBe(0);
  });

  it('c2pa-node imports are centralized in the allowed engine/c2pa importers (Concern #11 + D-CTX-7)', () => {
    // Robust regex per LOW review note — covers BOTH static `from 'c2pa-node'`
    // imports AND dynamic `import('c2pa-node')` calls; handles single-quote,
    // double-quote, any whitespace between `from`/`import(` and the quote.
    // Excludes the __tests__ directories (test cases may include the
    // string in mocks / docstrings without violating the boundary).
    //
    // Phase 16 / Plan 16-01 (D-CTX-7) — the ALLOWED set of importers expanded
    // beyond a single signer.ts file. exporter.ts is reserved for future use
    // (it does NOT actually import c2pa-node — present-bytes are returned
    // verbatim from disk), but the slot is allowed so a future extension that
    // legitimately needs the binding can join without a separate test edit.
    // verifier.ts uses lazy await import('c2pa-node'). Plan 16-02 may extend
    // to redaction.ts when redaction integrates with the native binding.
    //
    // Two-layer assertion:
    //   (a) Subset check — every actual importer is in the allowed set
    //       (no rogue importer outside src/engine/c2pa/).
    //   (b) SET-equality on the actual importers (sorted-array deepEqual).
    //       Prevents a silent regression where signer.ts or verifier.ts is
    //       removed from the importer set unexpectedly. exporter.ts is in
    //       the allowed-set but NOT in the actual-set (it does not import
    //       c2pa-node); the set-equality assertion below uses the actual
    //       set, which currently contains signer.ts + verifier.ts.
    const allowedC2paNodeImporters = new Set<string>([
      'src/engine/c2pa/signer.ts',
      'src/engine/c2pa/exporter.ts', // D-CTX-7 reserves the slot
      'src/engine/c2pa/verifier.ts', // Plan 16-01 — lazy import('c2pa-node')
      'src/engine/c2pa/redaction.ts', // Plan 16-02 — lazy import('c2pa-node')
    ]);
    let out = '';
    try {
      out = execFileSync(
        'grep',
        [
          '-rlE',
          "from[[:space:]]*['\"]c2pa-node|import[[:space:]]*\\([[:space:]]*['\"]c2pa-node",
          'src/',
        ],
        { encoding: 'utf8' },
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
      // No matches at all — file count == 0 — also a violation (signer
      // SHOULD import c2pa-node lazily). Caught below.
    }
    const files = out ? out.trim().split('\n').filter(Boolean) : [];
    const nonTestFiles = files.filter((f) => !f.includes('__tests__/'));
    // (a) Subset check — no rogue importer outside the allowed set.
    const violations = nonTestFiles.filter((f) => !allowedC2paNodeImporters.has(f));
    expect(
      violations,
      `c2pa-node imports outside the allowed list:\n${violations.join('\n')}`,
    ).toEqual([]);
    // (b) SET-equality on the ACTUAL importers (sorted-array deepEqual).
    // exporter.ts intentionally NOT in this list — it does not import
    // c2pa-node; the allowed-set above merely RESERVES the slot per D-CTX-7.
    // Plan 16-02 may add redaction.ts here when redaction goes live.
    const expectedActualImporters = [
      'src/engine/c2pa/signer.ts',
      'src/engine/c2pa/verifier.ts',
      'src/engine/c2pa/redaction.ts', // Plan 16-02 — lazy import('c2pa-node')
    ].sort();
    expect([...nonTestFiles].sort()).toEqual(expectedActualImporters);
  });

  it('src/engine/c2pa/manifest-builder.ts is pure (zero c2pa-node imports)', () => {
    try {
      const out = execFileSync(
        'grep',
        ['-E', "from[[:space:]]*['\"]c2pa-node", 'src/engine/c2pa/manifest-builder.ts'],
        { encoding: 'utf8' },
      );
      expect(out.trim(), `c2pa-node import in manifest-builder.ts:\n${out}`).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
    // Defensive — the directory-level guards above already cover MCP/SQLite/
    // ORM, but a file-level assertion fires in isolation when one specific
    // file regresses. Cheaper to debug than the directory-wide fail.
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/c2pa/manifest-builder.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/c2pa/manifest-builder.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/c2pa/manifest-builder.ts')).toBe(0);
  });

  it('src/engine/c2pa/format-router.ts has zero external dep imports', () => {
    try {
      const out = execFileSync(
        'grep',
        ['-E', "from[[:space:]]*['\"]c2pa-node", 'src/engine/c2pa/format-router.ts'],
        { encoding: 'utf8' },
      );
      expect(out.trim(), `c2pa-node import in format-router.ts:\n${out}`).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/c2pa/format-router.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/c2pa/format-router.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/c2pa/format-router.ts')).toBe(0);
  });

  // Phase 15 / Plan 15-01 — file-level purity locks for the new ingredient
  // primitives. Mirrors manifest-builder.ts + format-router.ts shape above.
  // These two files are the parsing + hashing half of PROV-V-04; they MUST
  // stay pure (no native-binding) so they can run inside the test harness
  // and CI matrix without the c2pa-node native binary. Plan 15-02 extends
  // manifest-builder.ts (still pure) and Plan 15-03 wires both into
  // Engine.signOutput at the impure boundary.
  it('src/engine/c2pa/ingredient-extractor.ts is pure (zero c2pa-node imports)', () => {
    try {
      const out = execFileSync(
        'grep',
        ['-E', "from[[:space:]]*['\"]c2pa-node", 'src/engine/c2pa/ingredient-extractor.ts'],
        { encoding: 'utf8' },
      );
      expect(out.trim(), `c2pa-node import in ingredient-extractor.ts:\n${out}`).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/c2pa/ingredient-extractor.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/c2pa/ingredient-extractor.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/c2pa/ingredient-extractor.ts')).toBe(0);
  });

  it('src/engine/c2pa/ingredient-hasher.ts is pure (zero c2pa-node imports)', () => {
    try {
      const out = execFileSync(
        'grep',
        ['-E', "from[[:space:]]*['\"]c2pa-node", 'src/engine/c2pa/ingredient-hasher.ts'],
        { encoding: 'utf8' },
      );
      expect(out.trim(), `c2pa-node import in ingredient-hasher.ts:\n${out}`).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/c2pa/ingredient-hasher.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/c2pa/ingredient-hasher.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/c2pa/ingredient-hasher.ts')).toBe(0);
  });

  // ================================================================
  // Phase 16 / Plan 16-01 — file-level purity locks for exporter.ts +
  // verifier.ts (PROV-V-07). exporter.ts has ZERO c2pa-node imports
  // (it just reads the embedded-manifest file bytes verbatim from disk).
  // verifier.ts is allowed to import c2pa-node — but ONLY via lazy
  // await import(). A static `from 'c2pa-node'` is a regression that
  // would force eager binding load at module-evaluation time.
  // ================================================================

  it('src/engine/c2pa/exporter.ts is pure (zero c2pa-node imports — read-only manifest snapshot)', () => {
    try {
      const out = execFileSync(
        'grep',
        ['-E', "from[[:space:]]*['\"]c2pa-node|import[[:space:]]*\\([[:space:]]*['\"]c2pa-node", 'src/engine/c2pa/exporter.ts'],
        { encoding: 'utf8' },
      );
      expect(out.trim(), `c2pa-node import in exporter.ts:\n${out}`).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/c2pa/exporter.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/c2pa/exporter.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/c2pa/exporter.ts')).toBe(0);
    expect(grepCount('@hono/node-server', 'src/engine/c2pa/exporter.ts')).toBe(0);
  });

  it('src/engine/c2pa/verifier.ts uses lazy c2pa-node + zero MCP/SQLite/ORM/hono imports', () => {
    // verifier.ts is allowed to import c2pa-node — but ONLY via lazy
    // await import. Static `from 'c2pa-node'` is a regression (would
    // force eager binding load at module evaluation).
    try {
      const staticImport = execFileSync(
        'grep',
        ['-E', "from[[:space:]]+['\"]c2pa-node['\"]", 'src/engine/c2pa/verifier.ts'],
        { encoding: 'utf8' },
      );
      expect(
        staticImport.trim(),
        `verifier.ts must not statically import c2pa-node (use lazy await import):\n${staticImport}`,
      ).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
    // Confirm the lazy form IS present (defence against silent removal).
    const lazyImport = execFileSync(
      'grep',
      ['-E', "import[[:space:]]*\\([[:space:]]*['\"]c2pa-node", 'src/engine/c2pa/verifier.ts'],
      { encoding: 'utf8' },
    );
    expect(lazyImport.trim()).not.toBe('');
    // No MCP / SQLite / drizzle / hono.
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/c2pa/verifier.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/c2pa/verifier.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/c2pa/verifier.ts')).toBe(0);
    expect(grepCount('@hono/node-server', 'src/engine/c2pa/verifier.ts')).toBe(0);
  });

  // ================================================================
  // Phase 16 / Plan 16-02 — file-level purity lock for redaction.ts
  // (PROV-V-06). redaction.ts is allowed to import c2pa-node — but
  // ONLY via lazy await import(). Static `from 'c2pa-node'` is a
  // regression that would force eager native-binding load at
  // module-evaluation time.
  // ================================================================

  it('src/engine/c2pa/redaction.ts uses lazy c2pa-node + zero MCP/SQLite/ORM/hono imports', () => {
    // redaction.ts is allowed to import c2pa-node — but ONLY via lazy
    // await import. Static `from 'c2pa-node'` is a regression.
    try {
      const staticImport = execFileSync(
        'grep',
        ['-E', "from[[:space:]]+['\"]c2pa-node['\"]", 'src/engine/c2pa/redaction.ts'],
        { encoding: 'utf8' },
      );
      expect(
        staticImport.trim(),
        `redaction.ts must not statically import c2pa-node (use lazy await import):\n${staticImport}`,
      ).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
    // Confirm the lazy form IS present (defence against silent removal).
    const lazyImport = execFileSync(
      'grep',
      ['-E', "import[[:space:]]*\\([[:space:]]*['\"]c2pa-node", 'src/engine/c2pa/redaction.ts'],
      { encoding: 'utf8' },
    );
    expect(lazyImport.trim()).not.toBe('');
    // No MCP / SQLite / drizzle / hono.
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/c2pa/redaction.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/c2pa/redaction.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/c2pa/redaction.ts')).toBe(0);
    expect(grepCount('@hono/node-server', 'src/engine/c2pa/redaction.ts')).toBe(0);
  });

  // ================================================================
  // Phase 17 / Plan 17-01 — visual thumbnails module purity (VIS-01..02).
  //
  // The new src/engine/thumbnails/ directory MUST be MCP-free, SQLite-
  // free, ORM-free, HTTP-server-free. The sharp native binding import
  // is centralized in EXACTLY ONE file: image-thumbnail.ts (D-23).
  // Plan 17-02 will add a parallel @ffmpeg-installer/ffmpeg allowed-set
  // assertion in the SAME plan that introduces video-thumbnail.ts (D-25
  // SAME-plan rule).
  //
  // Two-layer assertion (mirrors the c2pa-node block at lines 166-231):
  //   (a) Subset check — every actual sharp importer is in the allowed
  //       set (no rogue importer outside src/engine/thumbnails/).
  //   (b) SET-equality on the actual importers (sorted-array deepEqual).
  //       Prevents a silent regression where image-thumbnail.ts is
  //       removed from the importer set (e.g., someone refactors sharp
  //       out into a different module without updating the allowed set).
  // ================================================================

  it('sharp imports are centralized in src/engine/thumbnails/image-thumbnail.ts (D-23)', () => {
    // Robust regex — covers BOTH static `from 'sharp'` imports AND
    // dynamic `import('sharp')` calls; handles single-quote, double-
    // quote, any whitespace between `from`/`import(` and the quote.
    // Excludes the __tests__ directories (test cases may import sharp
    // directly to generate fixtures without violating the boundary —
    // src/engine/thumbnails/__tests__/image-thumbnail.test.ts uses
    // `import sharp from 'sharp'` for in-memory PNG generation).
    const allowedSharpImporters = new Set<string>([
      'src/engine/thumbnails/image-thumbnail.ts',
    ]);
    let out = '';
    try {
      out = execFileSync(
        'grep',
        [
          '-rlE',
          "from[[:space:]]*['\"]sharp|import[[:space:]]*\\([[:space:]]*['\"]sharp",
          'src/',
        ],
        { encoding: 'utf8' },
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
      // No matches at all — file count == 0 — also a violation
      // (image-thumbnail.ts SHOULD lazy-import sharp). Caught below.
    }
    const files = out ? out.trim().split('\n').filter(Boolean) : [];
    const nonTestFiles = files.filter((f) => !f.includes('__tests__/'));
    // (a) Subset check — no rogue importer outside the allowed set.
    const violations = nonTestFiles.filter((f) => !allowedSharpImporters.has(f));
    expect(
      violations,
      `sharp imports outside the allowed list:\n${violations.join('\n')}`,
    ).toEqual([]);
    // (b) SET-equality on the ACTUAL importers (sorted-array deepEqual).
    const expectedActualImporters = ['src/engine/thumbnails/image-thumbnail.ts'].sort();
    expect([...nonTestFiles].sort()).toEqual(expectedActualImporters);
  });

  // ================================================================
  // Phase 17 / Plan 17-02 (D-24 + D-25) — @ffmpeg-installer/ffmpeg
  // allowed-set lands in the SAME plan that introduces the import
  // (per D-25 SAME-plan rule — no orphaned imports between plans).
  //
  // The MP4 first-frame extraction pipeline imports the bundled
  // ffmpeg binary's `path` from @ffmpeg-installer/ffmpeg. The
  // package is LGPL-2.1 separate-process — MIT-compatible per
  // D-27. The import is centralized in EXACTLY ONE file:
  // video-thumbnail.ts (D-24).
  //
  // Two-layer assertion identical in shape to the sharp + c2pa-node
  // assertions. The dynamic-import regex is critical because
  // video-thumbnail.ts uses `await import('@ffmpeg-installer/ffmpeg')`
  // lazily per D-26 (lazy + monotonic-fail; server boot succeeds when
  // the host platform binary is missing).
  // ================================================================

  it('@ffmpeg-installer/ffmpeg imports are centralized in src/engine/thumbnails/video-thumbnail.ts (D-24)', () => {
    // Robust regex — covers BOTH static `from '@ffmpeg-installer/ffmpeg'`
    // imports AND dynamic `import('@ffmpeg-installer/ffmpeg')` calls;
    // handles single-quote, double-quote, any whitespace between
    // `from`/`import(` and the quote. Excludes the __tests__ directories
    // (test cases may import the package directly to read the binary
    // path for fixture generation without violating the boundary).
    const allowedFfmpegImporters = new Set<string>([
      'src/engine/thumbnails/video-thumbnail.ts',
    ]);
    let out = '';
    try {
      out = execFileSync(
        'grep',
        [
          '-rlE',
          "from[[:space:]]*['\"]@ffmpeg-installer/ffmpeg|import[[:space:]]*\\([[:space:]]*['\"]@ffmpeg-installer/ffmpeg",
          'src/',
        ],
        { encoding: 'utf8' },
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
      // No matches at all — file count == 0 — also a violation
      // (video-thumbnail.ts SHOULD lazy-import @ffmpeg-installer/ffmpeg).
      // Caught by the SET-equality assertion below.
    }
    const files = out ? out.trim().split('\n').filter(Boolean) : [];
    const nonTestFiles = files.filter((f) => !f.includes('__tests__/'));
    // (a) Subset check — no rogue importer outside the allowed set.
    const violations = nonTestFiles.filter((f) => !allowedFfmpegImporters.has(f));
    expect(
      violations,
      `@ffmpeg-installer/ffmpeg imports outside the allowed list:\n${violations.join('\n')}`,
    ).toEqual([]);
    // (b) SET-equality on the ACTUAL importers (sorted-array deepEqual).
    const expectedActualImporters = ['src/engine/thumbnails/video-thumbnail.ts'].sort();
    expect([...nonTestFiles].sort()).toEqual(expectedActualImporters);
  });

  it('src/engine/thumbnails/ has zero imports from @modelcontextprotocol/sdk', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/thumbnails/')).toBe(0);
  });

  it('src/engine/thumbnails/ has zero imports from better-sqlite3', () => {
    expect(grepCount('better-sqlite3', 'src/engine/thumbnails/')).toBe(0);
  });

  it('src/engine/thumbnails/ has zero imports from drizzle-orm', () => {
    expect(grepCount('drizzle-orm', 'src/engine/thumbnails/')).toBe(0);
  });

  it('src/engine/thumbnails/ has zero imports from hono (robust regex)', () => {
    // Robust regex — handles single-quote, double-quote, any whitespace
    // between `from` and the quote. Mirrors the c2pa block at line 146-160.
    try {
      const out = execFileSync(
        'grep',
        ['-rE', "from[[:space:]]*['\"]hono['\"]", 'src/engine/thumbnails/'],
        { encoding: 'utf8' },
      );
      expect(out.trim(), `hono import found in src/engine/thumbnails/:\n${out}`).toBe('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
  });

  it('src/engine/thumbnails/ has zero imports from @hono/node-server', () => {
    expect(grepCount('@hono/node-server', 'src/engine/thumbnails/')).toBe(0);
  });

  // ================================================================
  // Phase 19 / Plan 19-01 — AI Conversational Summary (SUM-01..07).
  //
  // The new src/engine/summary/ directory will host pure helpers
  // (sanitizer, validation, deterministic-template, template,
  // few-shot-examples, circuit-breaker) plus the SOLE @anthropic-ai/sdk
  // importer (anthropic-client.ts — landed by Plan 19-04). The boot
  // path src/server.ts MUST never statically import the SDK so server
  // boot stays resilient when @anthropic-ai/sdk's binding fails to load
  // (mirrors Phase 14 c2pa-node Concern #11).
  //
  // The allowed-set assertion + 6 pure-helper file-level guards are
  // staged HERE (Plan 19-01) but kept .skip()'d — they activate as the
  // corresponding files land in Plans 19-02 / 19-03 / 19-04. The
  // boot-resilience guard runs LIVE from Plan 19-01 (src/server.ts
  // already lacks any @anthropic-ai/sdk import).
  // ================================================================

  it('src/server.ts has zero static imports from @anthropic-ai/sdk (Phase 19 — boot resilience)', () => {
    // Mirrors the Phase 14 c2pa-node boot-resilience guard at lines
    // 108-127 above. Server boot must never eagerly load the Anthropic
    // SDK — Plan 19-04's lazy `await import(...)` inside
    // src/engine/summary/anthropic-client.ts is the SOLE load path.
    try {
      const out = execFileSync(
        'grep',
        ['-E', "from[[:space:]]+['\"]@anthropic-ai/sdk['\"]", 'src/server.ts'],
        { encoding: 'utf8' },
      );
      expect(
        out.trim(),
        `static @anthropic-ai/sdk import found in src/server.ts:\n${out}`,
      ).toBe('');
    } catch (err) {
      // grep exits 1 when no matches — that's the GREEN state we want.
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
  });

  it('@anthropic-ai/sdk imports are centralized in src/engine/summary/anthropic-client.ts (Phase 19)', () => {
    // Activated by Plan 19-04 Task 3. anthropic-client.ts lands the SOLE
    // SDK import; this assertion locks the invariant going forward.
    //
    // Mirror Phase 14 c2pa-node allowed-set assertion at lines 166-231:
    // two-layer (subset check + sorted-array deepEqual) on actual
    // importers.
    const allowedAnthropicImporters = new Set<string>([
      'src/engine/summary/anthropic-client.ts',
    ]);
    let out = '';
    try {
      out = execFileSync(
        'grep',
        [
          '-rlE',
          "from[[:space:]]*['\"]@anthropic-ai/sdk|import[[:space:]]*\\([[:space:]]*['\"]@anthropic-ai/sdk",
          'src/',
        ],
        { encoding: 'utf8' },
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 1) throw err;
    }
    const files = out ? out.trim().split('\n').filter(Boolean) : [];
    const nonTestFiles = files.filter((f) => !f.includes('__tests__/'));

    // (a) Subset check — no rogue importer outside the allowed set.
    const violations = nonTestFiles.filter((f) => !allowedAnthropicImporters.has(f));
    expect(
      violations,
      `@anthropic-ai/sdk imports outside the allowed list:\n${violations.join('\n')}`,
    ).toEqual([]);

    // (b) SET-equality on actual importers (sorted-array deepEqual;
    //     prevents silent regression).
    const expectedActualImporters = ['src/engine/summary/anthropic-client.ts'].sort();
    expect([...nonTestFiles].sort()).toEqual(expectedActualImporters);
  });

  // Phase 19 — pure-helper isolation guards. Each file MUST import zero
  // MCP/SDK/SQLite-driver/ORM/HTTP. Each test enabled by the plan that
  // creates the corresponding file:
  //   sanitizer.ts → Plan 19-02
  //   validation.ts → Plan 19-02
  //   deterministic-template.ts → Plan 19-02
  //   template.ts → Plan 19-03
  //   templates/few-shot-examples.ts → Plan 19-03
  //   circuit-breaker.ts → Plan 19-03

  it('src/engine/summary/sanitizer.ts is pure (zero anthropic/MCP/SQLite/ORM imports)', () => {
    expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/sanitizer.ts')).toBe(0);
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/sanitizer.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/summary/sanitizer.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/summary/sanitizer.ts')).toBe(0);
  });

  it('src/engine/summary/validation.ts is pure (zero anthropic/MCP/SQLite/ORM imports)', () => {
    expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/validation.ts')).toBe(0);
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/validation.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/summary/validation.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/summary/validation.ts')).toBe(0);
  });

  it('src/engine/summary/deterministic-template.ts is pure (zero anthropic/MCP/SQLite/ORM imports)', () => {
    expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/deterministic-template.ts')).toBe(0);
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/deterministic-template.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/summary/deterministic-template.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/summary/deterministic-template.ts')).toBe(0);
  });

  it('src/engine/summary/template.ts is pure (zero anthropic/MCP/SQLite/ORM imports)', () => {
    expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/template.ts')).toBe(0);
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/template.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/summary/template.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/summary/template.ts')).toBe(0);
  });

  it('src/engine/summary/templates/few-shot-examples.ts is pure (zero anthropic/MCP/SQLite/ORM imports)', () => {
    expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/templates/few-shot-examples.ts')).toBe(0);
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/templates/few-shot-examples.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/summary/templates/few-shot-examples.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/summary/templates/few-shot-examples.ts')).toBe(0);
  });

  it('src/engine/summary/circuit-breaker.ts is pure (zero anthropic/MCP/SQLite/ORM imports)', () => {
    expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/circuit-breaker.ts')).toBe(0);
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/circuit-breaker.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/summary/circuit-breaker.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/summary/circuit-breaker.ts')).toBe(0);
  });

  it('src/engine/summary/anthropic-client.ts uses lazy @anthropic-ai/sdk + zero MCP/SQLite/ORM/hono', () => {
    // .skip() left OFF — Plan 19-01 ships the boot-resilience guard above.
    // This test passes pre-Plan-19-04 because the file does not yet exist
    // (grepCount returns 0 for a missing file). Once Plan 19-04 creates the
    // file, the SDK reference becomes legitimate (it's the sole-importer);
    // this test asserts ZERO MCP/SQLite/ORM/hono — which the file should
    // never import.
    if (!existsSync('src/engine/summary/anthropic-client.ts')) {
      return; // Pre-Plan-19-04 no-op
    }
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/anthropic-client.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/summary/anthropic-client.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/summary/anthropic-client.ts')).toBe(0);
    expect(grepCount('@hono/node-server', 'src/engine/summary/anthropic-client.ts')).toBe(0);
  });

  // Phase 19 Plan 08 — telemetry.ts is a pure-helper companion that re-exports
  // flattenAnthropicError from anthropic-client.ts but otherwise has zero
  // MCP/SQLite/ORM/HTTP imports. The @anthropic-ai/sdk allowed-set is
  // satisfied because the SDK reference is transitive via anthropic-client.ts
  // (the sole importer); telemetry.ts itself does NOT directly import the SDK.
  it('src/engine/summary/telemetry.ts is pure (zero MCP/SQLite/ORM/HTTP imports)', () => {
    if (!existsSync('src/engine/summary/telemetry.ts')) {
      return; // Pre-Plan-19-08 no-op
    }
    expect(grepCount('@modelcontextprotocol/sdk', 'src/engine/summary/telemetry.ts')).toBe(0);
    expect(grepCount('better-sqlite3', 'src/engine/summary/telemetry.ts')).toBe(0);
    expect(grepCount('drizzle-orm', 'src/engine/summary/telemetry.ts')).toBe(0);
    expect(grepCount('@hono/node-server', 'src/engine/summary/telemetry.ts')).toBe(0);
    // Note: @anthropic-ai/sdk is allowed only via flattenAnthropicError
    // re-export through './anthropic-client.js' — the SDK reference is
    // transitive, not direct. The allowed-set assertion above (line 600)
    // verifies anthropic-client.ts is the sole direct SDK importer.
    expect(grepCount('@anthropic-ai/sdk', 'src/engine/summary/telemetry.ts')).toBe(0);
  });

  // ================================================================
  // Phase 20 / Plan 20-04 — STAT-02 append-only invariant for the
  // shot_status_events table + file-level MCP-SDK purity lock for the
  // new shot-status repo. Mirrors the provenance-repo append-only guard
  // (D-PROV-01) and the existing per-file MCP purity locks for assets,
  // tag-repo, and metadata-repo above.
  //
  // The append-only guard is the structural enforcement of STAT-02:
  // the repo MUST never UPDATE or DELETE shot_status_events rows.
  // Implementation lives in src/store/shot-status-repo.ts; Plan 20-02
  // also asserts the same via grep at the repo file itself, but the
  // architecture-purity test is the canonical CI regression anchor
  // that fires from a single well-known location.
  // ================================================================
  it('shot_status_events is never UPDATE-d or DELETE-d in src/store/shot-status-repo.ts', () => {
    expect(
      grepCount('UPDATE shot_status_events', 'src/store/shot-status-repo.ts'),
    ).toBe(0);
    expect(
      grepCount('DELETE.*shot_status_events', 'src/store/shot-status-repo.ts'),
    ).toBe(0);
  });

  // Phase 20 — file-level purity lock for shot-status-repo.ts. The
  // directory-level src/store/ guard at line 38 already covers this
  // transitively; the file-level assertion fires in isolation if
  // someone adds an MCP import to this specific file — cheaper to
  // debug than the directory-wide fail.
  it('src/store/shot-status-repo.ts has zero imports from @modelcontextprotocol/sdk', () => {
    expect(grepCount('@modelcontextprotocol/sdk', 'src/store/shot-status-repo.ts')).toBe(0);
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
