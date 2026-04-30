// Phase 12 — DEMO-03. Pure SHA-256 streaming hash utility for on-disk
// version outputs. Engine-layer file with zero MCP-SDK imports, zero
// SQLite-driver imports, zero ORM imports (architecture-purity guard).
//
// Path layout (D-WEBUI-26, locked Phase 5 dashboard work):
//   <outputsDir>/<versionId>/<filename>
// Mirrors src/engine/output-downloader.ts:46-71 layout.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Stream-hash the file at <outputsDir>/<versionId>/<filename> and return the
 * lower-case SHA-256 hex digest.
 *
 * Returns `null` if the file does not exist on disk — caller must treat
 * `null` as "output missing" (the diff envelope encodes this via
 * parent_output_present / reproduction_output_present booleans). Never
 * throws for missing-file cases; surfaces other I/O failures as exceptions
 * (caller decides whether to swallow).
 *
 * Uses createReadStream + createHash to handle large outputs (videos can be
 * 100+ MB) without buffering the full file in memory.
 */
export async function computeOutputSha256(
  outputsDir: string,
  versionId: string,
  filename: string,
): Promise<string | null> {
  const fullPath = path.join(outputsDir, versionId, filename);
  // Pre-check existence so missing files map to null without a stream-error
  // round-trip. stat() throws ENOENT for missing files; we trap that one
  // case and let other failures (EACCES, EBUSY, ...) propagate.
  try {
    await stat(fullPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(fullPath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
