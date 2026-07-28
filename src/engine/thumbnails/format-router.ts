// Pure thumbnail format router.
//
// Pure function — no I/O, no side effects. Returns one of three routes:
//  - { mode: 'image', mimeType }       — PNG/JPEG/WebP/TIFF (sharp can decode)
//  - { mode: 'video', mimeType }       — MP4 (ffmpeg first-frame extraction)
//  - { mode: 'unsupported', reason }   — anything else (EXR/PSD/HEIC/unknown)
//
// **v1.2 scope:** the IMAGE path shipped first. The VIDEO arm is
// reachable and its derivation pipeline (video-thumbnail.ts) ships
// separately. The router is shared by both image and video
// paths, imported from the same barrel.
//
// Extension matching is case-insensitive (mirrors the c2pa/format-router.ts
// rationale: ComfyUI Cloud sometimes returns mixed-case filenames). The
// mimeType strings are the standard registrations.
//
// Architecture-purity: zero MCP / DB / ORM / HTTP / sharp / ffmpeg imports —
// pure-function module. Verified by directory-level grep guards in
// src/__tests__/architecture-purity.test.ts and the file-level allowed-set
// assertion that pins sharp to image-thumbnail.ts.

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
 * are universal; TIFF is included because generation outputs sometimes
 * land as multi-page TIFF (the c2pa signer already routes TIFF,
 * and sharp's libvips backend handles TIFF natively).
 *
 * THIS TABLE IS ROUTING, NOT A SECURITY BOUNDARY. libvips picks its decoder by
 * sniffing content, not by filename, so GIF bytes named `.png` are decoded by
 * the GIF loader and native-VIPS bytes named `.jpg` by the VIPS loader — both
 * of which this table appears to exclude. Narrowing the extensions here does
 * NOT reduce the set of decoders reachable from provider-delivered bytes. The
 * defence against a libvips decoder CVE is keeping sharp current; see
 * SECURITY.md. Pinned by format-router-sniffing.test.ts.
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
 * Video extensions handled by ffmpeg first-frame extraction.
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
