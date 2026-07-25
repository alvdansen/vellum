// Phase 15 — PROV-V-04 (D-CTX-2). Streaming SHA-256 hash for component
// image inputs referenced in the resolved prompt blob. Mirrors
// src/engine/output-hash.ts: same path-traversal guard, same
// createReadStream + createHash pipeline. Returns a discriminated union
// so callers (Plan 15-03 Engine.signOutput) can record the typed
// unavailable reason directly into the c2pa.ingredient assertion's
// metadata when bytes are unreachable.
//
// T-15-02 mitigation: filename traversal characters ('..', '/', '\\', NUL)
// are rejected BEFORE any filesystem call; the request degrades to
// component_unavailable: 'file_not_found' (semantically equivalent to
// "no comparable bytes" — same downstream UX as a missing file).
//
// T-15-04 mitigation: returns ONLY the SHA-256 hex digest OR a typed
// reason code. NEVER the resolved filesystem path — callers carry the
// basename in the c2pa.ingredient metadata, never the absolute path.
//
// Architecture-purity: zero MCP / native-c2pa-binding / SQLite-driver /
// ORM imports.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';

/** Outcome of a hash attempt. Exactly one branch carries data. */
export type HashOutcome =
  | { hash: string }
  | { component_unavailable: 'file_not_found' | 'file_unreadable' };

/**
 * Stream-hash the file at <inputsDir>/<versionId>/<filename> and return the
 * lower-case SHA-256 hex digest, OR a typed unavailable reason. NEVER
 * throws — caller can record the outcome directly in the manifest.
 *
 * Path layout mirrors src/engine/output-downloader.ts (D-WEBUI-26).
 * In production (ComfyUI Cloud), control / mask / VAEEncode source
 * images typically live on cloud storage and are NOT reachable via this
 * path; the typical outcome is therefore 'file_not_found' (per D-CTX-4).
 * Local fixture tests exercise the success path.
 */
export async function hashComponentBytes(
  inputsDir: string,
  versionId: string,
  filename: string,
): Promise<HashOutcome> {
  // T-15-02: reject empty / separator / traversal / NUL filenames before
  // any path resolution. Same guard shape as output-hash.ts. Treat all
  // such cases as 'file_not_found' — the manifest records the dangling
  // reference cleanly without leaking the failure mode.
  if (
    filename.length === 0 ||
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0')
  ) {
    return { component_unavailable: 'file_not_found' };
  }
  const safeName = path.basename(filename);
  const fullPath = path.join(inputsDir, versionId, safeName);
  try {
    await stat(fullPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { component_unavailable: 'file_not_found' };
    // EACCES / EBUSY / EISDIR / EMFILE / ... → unreadable. Degrade
    // gracefully (D-CTX-2) — the manifest records the dangling reference.
    return { component_unavailable: 'file_unreadable' };
  }
  try {
    const hash = await new Promise<string>((resolve, reject) => {
      const h = createHash('sha256');
      const stream = createReadStream(fullPath);
      stream.on('error', reject);
      stream.on('data', (chunk) => h.update(chunk));
      stream.on('end', () => resolve(h.digest('hex')));
    });
    return { hash };
  } catch {
    return { component_unavailable: 'file_unreadable' };
  }
}
