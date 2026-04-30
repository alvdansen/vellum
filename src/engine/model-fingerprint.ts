// Phase 13 — PROV-V-03. Streaming SHA-256 fingerprint helper for model
// files referenced by ComfyUI loader nodes (checkpoints, LoRAs, VAEs,
// ControlNet weights, UNet, CLIP, style models). Engine-layer file with
// zero MCP-SDK imports, zero SQLite-driver imports, zero ORM imports
// (architecture-purity guard — proven by grep gates and the
// architecture-purity test in src/__tests__/architecture-purity.test.ts).
// Mirrors the structure of src/engine/output-hash.ts (Phase 12 reference
// for streaming hash + path-traversal defense-in-depth).
//
// Resolution layout (D-CTX-2):
//   <modelsDir>/<MODEL_DIR_BY_CLASS[classType]>/<basename(modelName)>
//
// Returns a discriminated union per D-CTX-1: { model_hash } on success,
// { model_hash_unavailable: <reason> } otherwise. Reason codes per
// D-CTX-5: 'models_dir_not_configured' | 'file_not_found' |
// 'file_unreadable' | 'unsupported_class_type'.
//
// ComfyUI Cloud reality: model files do NOT live on the local file system
// in production. The default deployment runs with VFX_FAMILIAR_MODELS_DIR
// unset and every entry records 'models_dir_not_configured'. Local-dev /
// self-host paths can populate hashes by setting the env var.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { MODEL_DIR_BY_CLASS } from './provenance.js';

/** Inter-attempt sleep schedule for non-ENOENT I/O errors (D-CTX retry policy).
 *  Two sleeps means three attempts: attempt 1 → fail → 1000ms → attempt 2 →
 *  fail → 2000ms → attempt 3 → fail → 'file_unreadable'. Mirrors the
 *  DOWNLOAD_BETWEEN_ATTEMPT_DELAYS pattern at src/engine/generation.ts:34-35
 *  (delays BETWEEN attempts, not per-attempt). */
const FINGERPRINT_BETWEEN_ATTEMPT_DELAYS = [1000, 2000];
const FINGERPRINT_MAX_ATTEMPTS = FINGERPRINT_BETWEEN_ATTEMPT_DELAYS.length + 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** D-CTX-1 / D-CTX-4: discriminated-union return type — exactly one field
 *  is present so caller code TypeScript-narrows on the discriminator. */
export type FingerprintResult =
  | { model_hash: string }
  | { model_hash_unavailable: string };

/**
 * Stream-hash the model file resolved by D-CTX-2 layout and return either
 * { model_hash: <lowercase-hex-sha256> } on success or
 * { model_hash_unavailable: <reason> } per D-CTX-5.
 *
 * Path-traversal guard mirrors src/engine/output-hash.ts:48-56 (Phase 12
 * WR-02 fix): empty / `..` / `/` / `\\` / NUL in modelName degrade to
 * 'file_not_found' rather than reading an outside-of-modelsDir target.
 *
 * Retry policy (criterion #4): non-ENOENT I/O errors retry up to 3 total
 * attempts with 1s/2s sleeps between. ENOENT is NOT retried — the file
 * just isn't there. Final exhaustion → 'file_unreadable'.
 */
export async function fingerprintModel(
  modelsDir: string | null,
  classType: string,
  modelName: string,
): Promise<FingerprintResult> {
  // D-CTX-5: env unset → no local resolution attempted.
  if (modelsDir === null) {
    return { model_hash_unavailable: 'models_dir_not_configured' };
  }
  const subdir = MODEL_DIR_BY_CLASS[classType];
  // D-CTX-5 defensive: should not fire for any LOADER_CLASS_TYPES member
  // (lockstep invariant tested in 13-01 Task 1). Guard exists so a future
  // class_type added to LOADER_CLASS_TYPES without a MODEL_DIR_BY_CLASS
  // entry surfaces as 'unsupported_class_type' rather than throwing.
  if (subdir === undefined) {
    return { model_hash_unavailable: 'unsupported_class_type' };
  }
  // WR-02 mirror: tampered modelName degrades to 'file_not_found' (same
  // downstream UX as a real ENOENT).
  if (
    modelName.length === 0 ||
    modelName.includes('..') ||
    modelName.includes('/') ||
    modelName.includes('\\') ||
    modelName.includes('\0')
  ) {
    return { model_hash_unavailable: 'file_not_found' };
  }
  const safeName = path.basename(modelName);
  const fullPath = path.join(modelsDir, subdir, safeName);

  let lastErrCode: string | null = null;
  for (let attempt = 0; attempt < FINGERPRINT_MAX_ATTEMPTS; attempt++) {
    try {
      await stat(fullPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? null;
      if (code === 'ENOENT') {
        return { model_hash_unavailable: 'file_not_found' };
      }
      lastErrCode = code;
      // Sleep BETWEEN attempts only — no sleep after the final failure.
      if (attempt < FINGERPRINT_BETWEEN_ATTEMPT_DELAYS.length) {
        await sleep(FINGERPRINT_BETWEEN_ATTEMPT_DELAYS[attempt]!);
      }
      continue;
    }
    try {
      const hex = await new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(fullPath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
      });
      return { model_hash: hex };
    } catch (err) {
      lastErrCode = (err as NodeJS.ErrnoException).code ?? null;
      if (attempt < FINGERPRINT_BETWEEN_ATTEMPT_DELAYS.length) {
        await sleep(FINGERPRINT_BETWEEN_ATTEMPT_DELAYS[attempt]!);
      }
      // continue to next attempt
    }
  }
  // Background-path observability — single-line operator-visible log on
  // exhaustion. Not a structured event; Phase 14 may surface fingerprint
  // status via a health endpoint, but that is out of scope here.
  console.error(
    `vfx-familiar: model fingerprint unreadable after ${FINGERPRINT_MAX_ATTEMPTS} attempts: ${fullPath} (last code: ${lastErrCode ?? 'UNKNOWN'})`,
  );
  return { model_hash_unavailable: 'file_unreadable' };
}
