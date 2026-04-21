import { mkdir, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path/posix';
import { TypedError } from '../engine/errors.js';

/**
 * Disk-path helpers for generation outputs (D-GEN-17, D-GEN-33, D-GEN-35).
 * POSIX-style paths (forward slash) — the output tree is OS-agnostic per demo scope.
 * Path-traversal defense (T-02-01-01) lives in `sanitizeRelativeSegment`.
 */

/**
 * Render a version number as a v###-formatted label per D-GEN-17.
 * Pads to 3 digits (v001, v010, v999); unpadded beyond 999 (v1000, v9999).
 */
export function versionLabel(n: number): string {
  return 'v' + String(n).padStart(3, '0');
}

/**
 * Reject any path segment (project/sequence/shot name, versionLabel, or
 * ComfyUI-returned filename) that could escape the output version directory.
 *
 * C1: before this fix, only `filename` was sanitized — project/sequence/shot
 * names flowed unchecked into path.join. An agent-created project named `..`
 * or `../../tmp` would cause generation outputs to land outside the outputs
 * root. Phase 2 is the first phase to turn these names into disk paths, so
 * the trust boundary is now load-bearing and must be enforced here.
 *
 * Threats caught:
 *   - ComfyUI returns `../etc/passwd` as a filename (T-02-01-01)
 *   - Agent creates a project named `..` or `../secret`
 *   - Names containing `/`, `\\`, NUL (Windows absolute-path, null-byte tricks)
 *   - Empty or whitespace-only names (would collapse the path)
 */
export function sanitizeRelativeSegment(name: string): string {
  if (name.length === 0 || name.trim().length === 0) {
    throw new TypedError(
      'INVALID_INPUT',
      `Unsafe path segment: empty or whitespace-only`,
      'Path segments must be non-empty and contain at least one non-whitespace character.',
    );
  }
  if (name === '.' || name === '..') {
    throw new TypedError(
      'INVALID_INPUT',
      `Unsafe path segment: ${name}`,
      'Path segments cannot be "." or "..".',
    );
  }
  if (
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new TypedError(
      'INVALID_INPUT',
      `Unsafe path segment: ${name}`,
      'Path segments must not contain "..", "/", "\\", or NUL.',
    );
  }
  return name;
}

export interface BuildOutputPathArgs {
  projectName: string;
  sequenceName: string;
  shotName: string;
  versionLabel: string;
  filename: string;
  root?: string;
}

/**
 * Build a POSIX-style relative output path per D-GEN-33:
 *   {root}/{projectName}/{sequenceName}/{shotName}/{versionLabel}/{filename}
 *
 * C1: every segment is sanitized (not just filename). projectName, sequenceName,
 * and shotName are user/agent-supplied; versionLabel is engine-generated but we
 * belt-and-suspenders check it anyway. Defense in depth: tool-layer Zod validates
 * inputs, but the trust boundary for disk writes lives here.
 */
export function buildOutputPath(args: BuildOutputPathArgs): string {
  const root = args.root ?? 'outputs';
  const project = sanitizeRelativeSegment(args.projectName);
  const sequence = sanitizeRelativeSegment(args.sequenceName);
  const shot = sanitizeRelativeSegment(args.shotName);
  const version = sanitizeRelativeSegment(args.versionLabel);
  const fname = sanitizeRelativeSegment(args.filename);
  return path.join(root, project, sequence, shot, version, fname);
}

/** Create directory recursively — no-throw on EEXIST. */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Hard ceiling on the suffix-increment search in `resolveCollisionSuffix`.
 * If a directory already contains `img.png`..`img_9999.png`, the next candidate
 * cannot be assigned and we surface an error rather than search forever. In
 * practice a single version directory holding this many collisions is pathological.
 */
export const MAX_COLLISION_SUFFIX = 10_000;

/**
 * Return a filename that does not collide with existing files in dirPath.
 * If `img.png` exists, tries `img_1.png`, `img_2.png`, ... until a free slot.
 * Matches Phase 1 D-14 "UNIQUE → suffix increment" pattern.
 */
export async function resolveCollisionSuffix(
  dirPath: string,
  filename: string,
): Promise<string> {
  const fileExists = async (p: string): Promise<boolean> =>
    access(p, fsConstants.F_OK).then(
      () => true,
      () => false,
    );
  if (!(await fileExists(path.join(dirPath, filename)))) return filename;

  const dot = filename.lastIndexOf('.');
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? '' : filename.slice(dot);
  for (let i = 1; i < MAX_COLLISION_SUFFIX; i++) {
    const candidate = `${base}_${i}${ext}`;
    if (!(await fileExists(path.join(dirPath, candidate)))) {
      console.error(`[outputs] collision: ${filename} -> ${candidate}`);
      return candidate;
    }
  }
  throw new TypedError(
    'COMFYUI_API_ERROR',
    `Could not resolve collision suffix for ${filename} in ${dirPath}`,
  );
}
