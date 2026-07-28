import * as fsp from 'node:fs/promises';
import path from 'node:path/posix';
import { TypedError } from '../engine/errors.js';

/**
 * Disk-path helpers for generation outputs.
 * POSIX-style paths (forward slash) — the output tree is OS-agnostic by design.
 * Path-traversal defense lives in `sanitizeRelativeSegment`.
 */

/**
 * Render a version number as a v###-formatted label.
 * Pads to 3 digits (v001, v010, v999); unpadded beyond 999 (v1000, v9999).
 */
export function versionLabel(n: number): string {
  return 'v' + String(n).padStart(3, '0');
}

/**
 * Reject any path segment (project/sequence/shot name, versionLabel, or
 * ComfyUI-returned filename) that could escape the output version directory.
 *
 * Historically only `filename` was sanitized — project/sequence/shot
 * names flowed unchecked into path.join. An agent-created project named `..`
 * or `../../tmp` would cause generation outputs to land outside the outputs
 * root. This is the point where those names first become disk paths, so
 * the trust boundary is load-bearing and must be enforced here.
 *
 * Threats caught:
 *   - ComfyUI returns `../etc/passwd` as a filename
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
  // Bidirectional control characters (RLO/LRO/PDF and the isolate family).
  // They carry no meaning in a filename but reorder how one is DISPLAYED, so a
  // name can be made to read as something other than what it is — the classic
  // "invoice‮gnp.exe" trick — in a terminal, a file browser, or the
  // generated pipeline log. An agent picks these names, so treat them as
  // hostile input rather than typos.
  if (/[‎‏‪-‮⁦-⁩]/.test(name)) {
    throw new TypedError(
      'INVALID_INPUT',
      'Unsafe path segment: contains bidirectional control characters',
      'Remove left-to-right / right-to-left override and isolate characters from the name.',
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
 * Build a POSIX-style relative output path:
 *   {root}/{projectName}/{sequenceName}/{shotName}/{versionLabel}/{filename}
 *
 * Every segment is sanitized (not just filename). projectName, sequenceName,
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
  await fsp.mkdir(dirPath, { recursive: true });
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
 * Matches the "UNIQUE → suffix increment" pattern used for entity names.
 *
 * Single readdir() + in-memory Set lookup (O(1) per candidate) instead
 * of sequential access() calls (O(n) syscalls). Preserves semantics — returns
 * the first unused suffix up to MAX_COLLISION_SUFFIX. If the directory is
 * missing (ENOENT), treats it as empty and returns `filename` unchanged.
 */
export async function resolveCollisionSuffix(
  dirPath: string,
  filename: string,
): Promise<string> {
  let entries: Set<string>;
  try {
    const names = await fsp.readdir(dirPath);
    entries = new Set(names);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return filename;
    }
    throw err;
  }
  if (!entries.has(filename)) return filename;

  const dot = filename.lastIndexOf('.');
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? '' : filename.slice(dot);
  for (let i = 1; i < MAX_COLLISION_SUFFIX; i++) {
    const candidate = `${base}_${i}${ext}`;
    if (!entries.has(candidate)) {
      console.error(`[outputs] collision: ${filename} -> ${candidate}`);
      return candidate;
    }
  }
  // Provider-neutral: filename-suffix exhaustion is a local PERSIST failure, not
  // an upstream API failure — code it DOWNLOAD_FAILED so a Replicate/FAL/etc. job
  // that hits it is never mislabeled COMFYUI_API_ERROR (the downloadAndPersist
  // catch preserves this TypedError's code verbatim).
  throw new TypedError(
    'DOWNLOAD_FAILED',
    `Could not resolve collision suffix for ${filename} in ${dirPath}`,
  );
}
