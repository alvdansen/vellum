// src/engine/output-downloader.ts — non-fatal ComfyUI output download (D-WEBUI-26).
//
// Downloads a ComfyUI output file and persists it to outputsDir/<versionId>/<filename>.
// Called from markCompleted's completion path AFTER provenance is written. The
// version has already been marked completed when this fires; a download failure
// must NOT roll that back. Every failure path returns null after logging — the
// caller must never see a thrown error.
//
// Security (T-5-03 mitigation): this module does NOT issue raw fetch() calls.
// It delegates to ComfyUIClient.downloadToPath(), which already enforces:
//   - Bearer auth via X-API-Key
//   - SSRF guard (allowlisted base URL + redirect:'manual' on signed URL)
//   - Byte cap (DEFAULT_DOWNLOAD_MAX_BYTES = 500 MiB)
//   - Atomic write ({destPath}.partial → rename on success)
//   - Typed error on failure (DOWNLOAD_FAILED)
//
// Architecture-purity invariants (D-WEBUI-31):
//  - Zero MCP SDK imports (enforced by architecture-purity.test.ts substring grep).
//  - Zero imports from hono or any HTTP-server layer.
//  - Only imports: node:fs/promises, node:path, ComfyUIClient type.

import { mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import type { ComfyUIClient } from '../comfyui/client.js';

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
 *
 * D-WEBUI-26: NON-FATAL. Completion path already wrote provenance + marked the
 * version completed. A download miss produces a gray placeholder in the dashboard;
 * `/api/versions/:id/output` surfaces `OUTPUT_UNAVAILABLE` (D-WEBUI-34).
 */
export async function downloadOutput(
  client: ComfyUIClient | null,
  versionId: string,
  outputsDir: string,
  filename: string,
  opts: { subfolder?: string; type?: string } = {},
): Promise<string | null> {
  if (!client) {
    console.error(
      `vfx-familiar: output-downloader: no ComfyUI client — skipping download for ${versionId} (${filename})`,
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
    return destPath;
  } catch (err) {
    // Non-fatal. Log the failure with enough context for ops to diagnose
    // (version id + filename + underlying error message). Do NOT throw.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `vfx-familiar: output-downloader: failed to download ${filename} for ${versionId}: ${msg}`,
    );
    return null;
  }
}
