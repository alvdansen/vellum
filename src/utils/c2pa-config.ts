/**
 * Phase 14 — PROV-V-01 / PROV-V-02 / PROV-V-05 (D-CTX-2). Concern #4 mitigation:
 * realpath + allowlist containment.
 *
 * Reads cert + key paths from env, resolves symlinks via realpathSync, asserts
 * the resolved paths live inside the allowlist root (cwd by default, override
 * via VFX_FAMILIAR_C2PA_CERT_ROOT), validates existence + readability +
 * non-empty, and returns a C2paConfig OR null (signing disabled). Throws
 * TypedError('C2PA_CONFIG_INVALID', ...) when validation fails.
 *
 * Throwing BEFORE any transport connect or tool register is the parity-with-
 * Phase-10 MIGRATION_PENDING-typed-error pattern (D-CTX-9 graceful-fail
 * applies at download time; boot-time misconfig fails loud).
 *
 * **Path leak hygiene (Concern #4 / T-14-01 / T-14-12):** Error messages and
 * the boot success log emit ONLY the basename of the cert/key files, never
 * the full path. The full resolved paths are stored in the returned
 * C2paConfig for use by Plan 14-02's signer module (which re-reads bytes at
 * sign time but never logs paths).
 *
 * Mirrors the validateBaseUrlFromEnv pattern at src/utils/validate-base-url.ts:
 * pure helper, exported for tests, imported by src/server.ts boot path.
 */

import { accessSync, statSync, realpathSync, constants as fsConstants } from 'node:fs';
import { basename, sep } from 'node:path';
import { TypedError } from '../engine/errors.js';
import type { C2paConfig } from '../types/c2pa.js';

export const DEFAULT_C2PA_CERT_ROOT_HINT =
  'Set VFX_FAMILIAR_C2PA_CERT_ROOT to override the allowlist root (defaults to cwd).';

/**
 * Phase 14 — PROV-V-01. loadC2paConfigFromEnv reads VFX_FAMILIAR_C2PA_CERT_PEM_PATH
 * and VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH from env, resolves symlinks via
 * realpathSync, asserts allowlist-root containment, validates existence +
 * readability + non-empty, and returns a C2paConfig or null (signing disabled).
 *
 * Throws TypedError('C2PA_CONFIG_INVALID', ...) on:
 *  - exactly one of the two path env vars set (must be both or neither)
 *  - any path is unreadable / missing / broken-symlink
 *  - any path is empty (zero bytes)
 *  - any resolved path is OUTSIDE the allowlist root
 *  - the allowlist root itself is missing or unreadable
 */
export function loadC2paConfigFromEnv(env: NodeJS.ProcessEnv = process.env): C2paConfig | null {
  const certPathRaw = env.VFX_FAMILIAR_C2PA_CERT_PEM_PATH;
  const keyPathRaw = env.VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH;

  // Both unset → signing disabled (D-CTX-2 graceful degradation).
  if (!certPathRaw && !keyPathRaw) return null;

  // Exactly one set → misconfig.
  if (!certPathRaw || !keyPathRaw) {
    throw new TypedError(
      'C2PA_CONFIG_INVALID',
      'Both VFX_FAMILIAR_C2PA_CERT_PEM_PATH and VFX_FAMILIAR_C2PA_PRIVATE_KEY_PEM_PATH must be set together, or both unset',
      'Set both paths to enable C2PA signing, or unset both to run with signing disabled.',
    );
  }

  // Resolve allowlist root.
  const rootRaw = env.VFX_FAMILIAR_C2PA_CERT_ROOT ?? process.cwd();
  let root: string;
  try {
    root = realpathSync(rootRaw);
  } catch {
    throw new TypedError(
      'C2PA_CONFIG_INVALID',
      'C2PA cert allowlist root does not exist or is not accessible',
      DEFAULT_C2PA_CERT_ROOT_HINT,
    );
  }

  // Resolve + validate each path.
  const certPath = resolveAndValidate(certPathRaw, root, 'cert');
  const keyPath = resolveAndValidate(keyPathRaw, root, 'key');

  // T-14-04 mitigation: warn (do NOT throw) if key file mode is more
  // permissive than 0600. World-readable / group-readable keys are a
  // security concern; we surface but don't block. Concern #4: log basename
  // only — never the full resolved path.
  const keyStat = statSync(keyPath);
  const mode = keyStat.mode & 0o777;
  if (mode & 0o077) {
    console.error(
      `vfx-familiar: WARNING — C2PA private key file ${basename(keyPath)} has permissive mode 0${mode.toString(8).padStart(3, '0')}; tighten to 0600 for production.`,
    );
  }

  return { certPemPath: certPath, privateKeyPemPath: keyPath };
}

function resolveAndValidate(
  rawPath: string,
  root: string,
  label: 'cert' | 'key',
): string {
  // Resolve symlinks. realpathSync also asserts existence — a missing file
  // OR a broken symlink throws here.
  let resolved: string;
  try {
    resolved = realpathSync(rawPath);
  } catch {
    throw new TypedError(
      'C2PA_CONFIG_INVALID',
      `C2PA ${label} PEM not readable (file ${basename(rawPath)} not found or symlink broken)`,
      'Ensure the file exists and the server process has read permission. Run scripts/gen-dev-c2pa-cert.mts for a local dev cert.',
    );
  }

  // Allowlist containment. Concern #4: check resolved (post-realpath) path
  // so symlink-out-of-allowlist is caught. Message includes the BASENAME
  // (debugging signal — operator can identify which file was rejected) but
  // NEVER the full directory portion (path-leak hygiene).
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new TypedError(
      'C2PA_CONFIG_INVALID',
      `C2PA ${label} path is outside the allowed cert root (${basename(resolved)})`,
      `${label} file resolves outside the allowlist root. ${DEFAULT_C2PA_CERT_ROOT_HINT}`,
    );
  }

  // R_OK check (realpathSync passed, but mode could still deny read — e.g.,
  // root-owned file with mode 0600 and the server running as a different uid).
  try {
    accessSync(resolved, fsConstants.R_OK);
  } catch {
    throw new TypedError(
      'C2PA_CONFIG_INVALID',
      `C2PA ${label} PEM not readable: ${basename(resolved)}`,
      'Ensure the server process has read permission on the file.',
    );
  }

  const stat = statSync(resolved);
  if (stat.size === 0) {
    throw new TypedError(
      'C2PA_CONFIG_INVALID',
      `C2PA ${label} PEM is empty: ${basename(resolved)}`,
      `The ${label} file exists but is zero bytes. Regenerate or provide a real PEM.`,
    );
  }

  return resolved;
}
