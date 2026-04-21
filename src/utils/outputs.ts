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
 * Reject filenames that could escape the output version directory. Called
 * inside buildOutputPath on the `filename` arg only. Project/sequence/shot
 * names are trusted per Phase 1 D-14 (demo-scope constraint).
 *
 * Threat: ComfyUI returns `../etc/passwd` as a filename → path-traversal (T-02-01-01).
 */
export function sanitizeRelativeSegment(name: string): string {
  if (
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new TypedError(
      'COMFYUI_API_ERROR',
      `Unsafe filename returned from ComfyUI: ${name}`,
      'Filenames must be basename-only (no "..", "/", or "\\").',
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
 * root defaults to 'outputs'. Names are used verbatim (D-GEN-33; Phase 2 assumes
 * fs-safe names per demo-scope constraint). The filename segment is the only
 * untrusted input (from ComfyUI) and must pass sanitizeRelativeSegment.
 */
export function buildOutputPath(args: BuildOutputPathArgs): string {
  const root = args.root ?? 'outputs';
  const fname = sanitizeRelativeSegment(args.filename);
  return path.join(
    root,
    args.projectName,
    args.sequenceName,
    args.shotName,
    args.versionLabel,
    fname,
  );
}

/** Create directory recursively — no-throw on EEXIST. */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

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
  for (let i = 1; i < 10_000; i++) {
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
