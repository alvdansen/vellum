// src/engine/output-downloader.ts — non-fatal ComfyUI output download (D-WEBUI-26).
//
// Downloads a ComfyUI output file and persists it to outputsDir/<versionId>/<filename>.
// Called from markCompleted's completion path AFTER provenance is written. The
// version has already been marked completed when this fires; a download failure
// must NOT roll that back. Every failure path returns null after logging — the
// caller must never see a thrown error.
//
// Phase 14 (PROV-V-01) addition: the optional `engine` parameter unlocks a
// post-download signing hook. After the Cloud download lands, the file is
// REPLACED in place via atomic mkstemp -> rename when c2paConfig is configured
// AND the format routes to embed-buffer / embed-file. Architecture-purity
// preserved: this file gains zero MCP-SDK imports, zero HTTP-server-layer
// imports, and zero direct native-binding imports. The signing hook delegates
// to engine.signOutput (declared via the EngineForC2pa structural Pick) so
// the native-binding import remains centralized in the engine c2pa module.
//
// Security (T-5-03 mitigation): this module does NOT issue raw fetch() calls.
// It delegates to the provider's downloadToPath() (GenerationProvider — the
// ComfyUI adapter is the reference impl), which already enforces:
//   - Bearer auth via X-API-Key
//   - SSRF guard (allowlisted base URL + redirect:'manual' on signed URL)
//   - Byte cap (DEFAULT_DOWNLOAD_MAX_BYTES = 500 MiB)
//   - Atomic write ({destPath}.partial → rename on success)
//   - Typed error on failure (DOWNLOAD_FAILED)
//
// Architecture-purity invariants (D-WEBUI-31):
//  - Zero MCP SDK imports (enforced by architecture-purity.test.ts substring grep).
//  - Zero imports from any HTTP-server layer.
//  - Zero direct imports from the C2PA native binding (Plan 14-03 Concern #11 boundary).
//  - Only imports: node:fs/promises, node:path, GenerationProvider type, nanoid.

import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { nanoid } from 'nanoid';
import type { GenerationProvider } from '../providers/provider.js';
import { BUFFER_SIGNING_MAX_BYTES } from './c2pa/constants.js';

/**
 * Phase 14 (PROV-V-01) — minimal Engine surface needed by the downloader.
 *
 * Structural pick rather than a hard import on the Engine class: the
 * downloader is engine-aware ONLY at the type level so the architecture
 * boundary stays composition-friendly and tests can pass a stub engine
 * without instantiating the full Engine facade.
 *
 * The contract is precisely the Plan 14-03 Task 2 signOutput method's
 * shape — see Engine.signOutput in src/engine/pipeline.ts.
 */
export type EngineForC2pa = {
  signOutput(
    versionId: string,
    filename: string,
    input: { bytes: Buffer } | { filePath: string },
  ): Promise<{
    signed: Buffer | null;
    signedToPath: string | null;
    alreadySigned?: boolean;
  }>;
};

/**
 * Phase 14 (Concern #6) — defence-in-depth size cap. Imported from the
 * c2pa-module shared-constants barrel (src/engine/c2pa/constants.ts) so
 * pipeline.ts and output-downloader.ts can never drift. See MR-03 in
 * 14-REVIEW-FIX.md — the legacy duplicate has been removed and a single
 * source of truth is enforced via this import.
 */

/**
 * Download a single ComfyUI output to `outputsDir/versionId/filename`.
 *
 * Returns the absolute path on success, or null on any failure.
 * Never throws. Every failure path logs to stderr via console.error.
 *
 * @param client     ComfyUIClient instance (may be null if credentials absent).
 * @param versionId  Version ID — used as the subdirectory name.
 * @param outputsDir Root outputs directory (e.g., 'outputs' or an absolute path).
 * @param filename   The ComfyUI output filename (e.g., 'ComfyUI_00001_.png').
 * @param opts       Optional subfolder + type for the ComfyUI /api/view query.
 * @param engine     Phase 14 — optional Engine surface for the C2PA signing hook.
 *                   Pass `null` (default) to skip signing entirely (back-compat).
 *
 * D-WEBUI-26: NON-FATAL. Completion path already wrote provenance + marked the
 * version completed. A download miss produces a gray placeholder in the dashboard;
 * `/api/versions/:id/output` surfaces `OUTPUT_UNAVAILABLE` (D-WEBUI-34).
 */
export async function downloadOutput(
  client: GenerationProvider | null,
  versionId: string,
  outputsDir: string,
  filename: string,
  opts: { subfolder?: string; type?: string } = {},
  engine: EngineForC2pa | null = null,
): Promise<string | null> {
  if (!client) {
    console.error(
      `vellum: output-downloader: no ComfyUI client — skipping download for ${versionId} (${filename})`,
    );
    return null;
  }

  // Resolve paths up-front so the log lines below can reference them.
  const versionDir = resolve(outputsDir, versionId);
  const destPath = resolve(versionDir, basename(filename));

  try {
    // mkdir first — downloadToPath's atomic-write expects the parent to exist.
    await mkdir(versionDir, { recursive: true });
    await client.downloadToPath(filename, opts, destPath);

    // Phase 14 hook — sign the just-downloaded file in place.
    if (engine !== null) {
      await signFileInPlace(engine, versionId, destPath, filename);
    }

    return destPath;
  } catch (err) {
    // Non-fatal. Log the failure with enough context for ops to diagnose
    // (version id + filename + underlying error message). Do NOT throw.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `vellum: output-downloader: failed to download ${filename} for ${versionId}: ${msg}`,
    );
    return null;
  }
}

/**
 * Phase 14 (PROV-V-01) — read or stream the just-downloaded file, call
 * engine.signOutput, atomic-overwrite via UNIQUE mkstemp -> rename.
 *
 * Errors are logged + swallowed (D-CTX-9 graceful — defence-in-depth):
 *   engine.signOutput already catches everything internally and emits a
 *   manifest_signed event with status_reason=...; this function's catch
 *   is a belt-and-suspenders guard for unexpected throws.
 *
 * Concerns honored:
 *   #6 — pre-stat picks bytes-input vs. filePath-input by file size
 *   #7 — engine.signOutput handles idempotency (alreadySigned guard)
 *   #9 — UNIQUE partial path scheme (`<destPath>.c2pa-signed.<8-char-nanoid>`)
 *        prevents concurrent-writer collision
 */
async function signFileInPlace(
  engine: EngineForC2pa,
  versionId: string,
  destPath: string,
  filename: string,
): Promise<void> {
  try {
    // Concern #6 — pre-stat to choose buffer-input vs filePath-input path.
    // Oversized files skip the readFile to avoid OOM; the engine's file-API
    // path streams via c2pa-rs and does not need the full bytes in memory.
    const st = await stat(destPath);
    const useFilePath = st.size > BUFFER_SIGNING_MAX_BYTES;
    const signInput: { bytes: Buffer } | { filePath: string } = useFilePath
      ? { filePath: destPath }
      : { bytes: await readFile(destPath) };

    const result = await engine.signOutput(versionId, filename, signInput);

    if (result.alreadySigned) {
      // Concern #7 — file was already signed in a prior run. The original
      // bytes were either pre-existing (signed) OR the fake re-overwrote
      // them with the un-signed Cloud bytes; either way the engine's
      // idempotency guard signals not-to-resign.
      return;
    }
    if (result.signed === null && result.signedToPath === null) {
      // Skip / fail / unsupported — engine.signOutput already emitted the
      // provenance event. Original Cloud bytes stay intact on disk.
      return;
    }

    if (result.signed !== null) {
      // Buffer mode — write signed bytes to UNIQUE partial path (Concern #9).
      // Use nanoid(8) for the per-call unique suffix; two concurrent writers
      // for the same versionId+filename will pick different partial paths
      // and rename to the same final path independently.
      const partialPath = `${destPath}.c2pa-signed.${nanoid(8)}.partial`;
      await writeFile(partialPath, result.signed, { mode: 0o644 });
      await renameWithFallback(partialPath, destPath);
    } else if (result.signedToPath !== null) {
      // File-API mode — engine produced a signed temp file under
      // <outputsDir>/.tmp-c2pa/<versionId>/dest-<nanoid>. Move it into place.
      // The engine's signViaTempFiles does NOT unlink dest in this branch
      // (the contract hands ownership to us). The renameWithFallback +
      // EXDEV fallback covers cross-filesystem cases.
      await renameWithFallback(result.signedToPath, destPath);
    }
  } catch (err) {
    // Defence-in-depth (D-CTX-9). engine.signOutput should never throw —
    // it catches every signing path internally and emits a typed
    // manifest_signed event. This catch handles unexpected throws (e.g.,
    // disk full during the writeFile).
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `vellum: output-downloader: C2PA signing post-download failed for ${versionId}/${filename}: ${msg}`,
    );
    // Non-fatal — provenance event already fired (or the engine threw which
    // means it already logged + recorded). Original Cloud bytes stay intact.
  }
}

/**
 * Cross-device-safe rename. fs.rename throws EXDEV when src + dest live on
 * different filesystems (rare but real on Linux mountpoints — e.g.,
 * outputsDir on tmpfs while .tmp-c2pa lives on the host disk). Fall back to
 * copyFile + unlink. The src is always cleaned up after copy completes.
 */
async function renameWithFallback(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await copyFile(src, dest);
      await unlink(src);
      return;
    }
    throw err;
  }
}

// Note — `rm` import is currently unused. Reserved for future cleanup
// helpers that need recursive temp-dir teardown. Tree-shaking / dead-code
// elimination at the bundler removes the unused binding.
void rm;
