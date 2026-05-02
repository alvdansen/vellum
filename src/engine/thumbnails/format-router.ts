// Phase 17 / Plan 17-01 Task 1 — pure thumbnail format router (D-CTX 17/I).
//
// Pure function — no I/O, no side effects. Returns one of three routes:
//  - { mode: 'image', mimeType }       — PNG/JPEG/WebP/TIFF (sharp can decode)
//  - { mode: 'video', mimeType }       — MP4 (ffmpeg first-frame extraction in Plan 17-02)
//  - { mode: 'unsupported', reason }   — anything else (EXR/PSD/HEIC/unknown)
//
// **v1.2 scope:** Plan 17-01 ships the IMAGE path only. The VIDEO arm is
// reachable but its derivation pipeline (Plan 17-02 video-thumbnail.ts) is
// out of scope for this plan. The router is shared by both image and video
// paths so Plan 17-02 imports it from the same barrel.
//
// Extension matching is case-insensitive (mirrors c2pa/format-router.ts T-14-08
// rationale: ComfyUI Cloud sometimes returns mixed-case filenames). The
// mimeType strings are the standard registrations.
//
// Architecture-purity: zero MCP / DB / ORM / HTTP / sharp / ffmpeg imports —
// pure-function module. Verified by directory-level grep guards in
// src/__tests__/architecture-purity.test.ts and the file-level allowed-set
// assertion that pins sharp to image-thumbnail.ts (D-23 / D-25).

/**
 * Discriminated union — three routing modes only. The absence of a
 * `sidecar` mode mirrors the c2pa router's structural-lock pattern.
 *
 * `native-handler-missing` is reserved for v1.3+ when a downstream consumer
 * (e.g., EXR/PSD via a future helper) wants to differentiate "we know what
 * this is but cannot derive a thumbnail" from "unknown extension". The v1.2
 * router collapses all unrouted extensions into `unknown-extension` per the
 * c2pa-router precedent.
 */
export type FormatRoute =
  | { mode: 'image'; mimeType: string }
  | { mode: 'video'; mimeType: string }
  | {
      mode: 'unsupported';
      reason: 'unknown-extension' | 'native-handler-missing';
      mimeType?: string;
    };

/**
 * Image extensions sharp can decode for thumbnail derivation. PNG/JPEG/WebP
 * are universal; TIFF is included because ComfyUI VFX outputs sometimes
 * land as multi-page TIFF (Phase 14 already routes TIFF for c2pa signing,
 * and sharp's libvips backend handles TIFF natively).
 */
const IMAGE_TABLE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/**
 * Video extensions handled by ffmpeg first-frame extraction (Plan 17-02).
 * v1.2 ships MP4 only; other container formats (mov/webm/mkv) defer to
 * v1.3+ when telemetry shows demand.
 */
const VIDEO_TABLE: Record<string, string> = {
  '.mp4': 'video/mp4',
};

/**
 * Pure function — extension lookup against two tables. Case-insensitive
 * (mixed-case filenames from ComfyUI Cloud). Returns one of the three
 * FormatRoute variants; unknown extensions collapse to
 * `unsupported(unknown-extension)`.
 */
export function routeFormat(filename: string): FormatRoute {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return { mode: 'unsupported', reason: 'unknown-extension' };
  const ext = filename.slice(dot).toLowerCase();
  if (ext in IMAGE_TABLE) {
    return { mode: 'image', mimeType: IMAGE_TABLE[ext]! };
  }
  if (ext in VIDEO_TABLE) {
    return { mode: 'video', mimeType: VIDEO_TABLE[ext]! };
  }
  return { mode: 'unsupported', reason: 'unknown-extension' };
}
