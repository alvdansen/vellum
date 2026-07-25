// Phase 16 / Plan 16-01 — PROV-V-07. Pure-async exporter for the v1.1
// agent surface. Reads the latest manifest_signed event for a version's
// primary output + the embedded-manifest file bytes from disk. Returns a
// base64-encoded snapshot suitable for the tool envelope.
//
// This module is the EXPORT half of D-CTX-3. The redaction primitive
// (Plan 16-02) re-uses parts of this read path; the verifier (Plan 16-01
// sibling file verifier.ts) re-uses the disk-read discipline.
//
// Architecture-purity:
//   - ZERO MCP imports
//   - ZERO native-binding imports — the exporter just reads the embedded-
//     manifest file bytes verbatim. The native binding is needed only
//     for verify (verifier.ts) and re-sign (Plan 16-02 reuses signer.ts).
//   - Repo access is via Pick<...> dependency injection (zero SQLite-
//     driver imports, zero ORM imports).
//
// Path-traversal safety (T-16-01 mitigation):
//   - filename is path.basename'd before path.join
//   - resolved path is asserted to live within outputsDir/<versionId>/
//   - traversal attempts throw TypedError EXPORT_PATH_TRAVERSAL_REJECTED

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { TypedError } from '../errors.js';
import type { ProvenanceRepo } from '../../store/provenance-repo.js';
import type { VersionRepo } from '../../store/version-repo.js';

/**
 * Phase 16 — exporter return shape per CONTEXT.md specifics block.
 * - manifest_status discriminates the three outcomes: present / absent /
 *   unsupported_format. The latter is distinct from absent because it
 *   reflects the SIGNER's deliberate choice (EXR/PSD/unknown ext) — the
 *   asset is on disk but un-signed; clients should know the difference.
 * - cert_subject + signed_at + ingredients_summary are NULL when
 *   manifest_status !== 'present' (i.e., the values are meaningful only
 *   when there's an embedded manifest to expose).
 *
 * Exception: when manifest_status === 'unsupported_format' we surface
 * format + signed_at from the manifest_signed event (the signer recorded
 * a deliberate skip with reason metadata — clients benefit from seeing
 * which format it was and when the decision was recorded).
 */
export interface ExporterResult {
  format: string; // event.format ('image/png' | ...) or '' when absent
  signed_at: string | null; // ISO from manifest_signed event
  manifest_bytes_base64: string | null; // disk bytes, base64-encoded
  manifest_status: 'present' | 'absent' | 'unsupported_format';
  cert_subject: string | null; // event.cert_subject_summary mirror
  ingredients_summary: {
    parent_count: 0 | 1;
    component_count: number;
    input_assertion: boolean;
    unavailable_count: number;
  } | null;
}

/**
 * Read the latest manifest_signed event for a version's primary output
 * (outputs_json[0].filename) and return the embedded-manifest file bytes
 * as base64.
 *
 * D-PLAN-4: base64 wrapper is appropriate for v1.1 typical sizes (~1 MB);
 * streaming export deferred per CONTEXT.md.
 *
 * @throws TypedError VERSION_NOT_FOUND when versionRepo.getVersion returns null
 * @throws TypedError EXPORT_PATH_TRAVERSAL_REJECTED when filename has traversal chars
 */
export async function exportManifest(
  versionId: string,
  versionRepo: Pick<VersionRepo, 'getVersion'>,
  provenanceRepo: Pick<ProvenanceRepo, 'getLatestManifestSignedEvent'>,
  outputsDir: string,
): Promise<ExporterResult> {
  const version = versionRepo.getVersion(versionId);
  if (!version) {
    throw new TypedError(
      'VERSION_NOT_FOUND',
      `Version '${versionId}' not found`,
      `List versions for a shot with { tool: 'version', action: 'list', shot_id: ... }`,
    );
  }

  // Resolve outputs_json[0].filename. Empty / malformed -> 'absent'.
  const filename = parsePrimaryOutputFilename(version.outputs_json);
  if (filename === null) {
    return makeAbsentResult();
  }

  // Path-traversal guard at the boundary (T-16-01).
  assertSafeFilename(filename);

  // Read latest manifest_signed event for (versionId, filename).
  const event = provenanceRepo.getLatestManifestSignedEvent(versionId, filename);
  if (event === null) {
    return makeAbsentResult();
  }

  // unsupported_format short-circuit — don't read the disk file (it's the
  // unsigned original; we expose the manifest_status reason explicitly).
  if (event.signed === false && event.status_reason === 'unsupported_format') {
    return {
      format: event.format,
      signed_at: event.signed_at,
      manifest_bytes_base64: null,
      manifest_status: 'unsupported_format',
      cert_subject: null,
      ingredients_summary: null,
    };
  }

  // signed=false (any reason other than unsupported_format) -> absent
  // (signing_disabled / sign_call_failed / cert_load_failed / ...).
  if (event.signed === false) {
    return makeAbsentResult();
  }

  // signed=true -> read disk bytes, base64-encode.
  const safeName = path.basename(filename);
  const fullPath = path.join(outputsDir, versionId, safeName);
  assertWithinRoot(outputsDir, fullPath);

  let bytes: Buffer;
  try {
    bytes = await readFile(fullPath);
  } catch (err) {
    // ENOENT graceful-fail (Phase 14 D-CTX-9 pattern) — disk file deleted
    // or downloader hadn't completed; we surface 'absent' rather than
    // throwing so agent UX is consistent.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return makeAbsentResult();
    }
    // Non-ENOENT (perm, I/O) — bubble up as INTERNAL_ERROR.
    throw new TypedError(
      'INTERNAL_ERROR',
      `Failed to read embedded-manifest file: ${(err as Error).message}`,
    );
  }

  return {
    format: event.format,
    signed_at: event.signed_at,
    manifest_bytes_base64: bytes.toString('base64'),
    manifest_status: 'present',
    cert_subject: event.cert_subject_summary || null,
    ingredients_summary: event.ingredients_summary ?? null,
  };
}

/**
 * Parse outputs_json -> primary output's filename. Mirrors the resolveC2paStatus
 * helper in src/tools/version-tool.ts — same JSON parse + array + [0].filename
 * pattern. Pulled into the exporter so repo callers don't shoulder JSON parsing.
 */
function parsePrimaryOutputFilename(outputsJson: string | null): string | null {
  if (!outputsJson) return null;
  try {
    const parsed = JSON.parse(outputsJson) as Array<{ filename?: string }>;
    if (!Array.isArray(parsed)) return null;
    const filename = parsed[0]?.filename;
    return typeof filename === 'string' && filename.length > 0 ? filename : null;
  } catch {
    return null;
  }
}

/** Path-traversal guard — throws EXPORT_PATH_TRAVERSAL_REJECTED on .. / \\ characters. */
function assertSafeFilename(filename: string): void {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new TypedError(
      'EXPORT_PATH_TRAVERSAL_REJECTED',
      `Filename contains path-traversal characters: ${filename}`,
      `Filenames must be basenames (no /, \\, or .. components).`,
    );
  }
}

/** Defence-in-depth — assert resolved path lives within outputsDir/<versionId>. */
function assertWithinRoot(outputsDir: string, fullPath: string): void {
  const resolvedRoot = path.resolve(outputsDir);
  const resolvedFull = path.resolve(fullPath);
  if (!resolvedFull.startsWith(resolvedRoot + path.sep) && resolvedFull !== resolvedRoot) {
    throw new TypedError(
      'EXPORT_PATH_TRAVERSAL_REJECTED',
      `Resolved path escapes outputsDir: ${fullPath}`,
    );
  }
}

function makeAbsentResult(): ExporterResult {
  return {
    format: '',
    signed_at: null,
    manifest_bytes_base64: null,
    manifest_status: 'absent',
    cert_subject: null,
    ingredients_summary: null,
  };
}
