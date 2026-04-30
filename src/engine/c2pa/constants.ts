// Phase 14 / Plan 14-02 — engine-layer C2PA shared constants.
//
// Architecture-purity: this module has ZERO MCP / HTTP / SQLite / drizzle
// imports. It is the single source of truth for C2PA-related size caps and
// other module-spanning constants so we never drift between
// pipeline.ts / output-downloader.ts copies.

/**
 * Phase 14 — Concern #6 mitigation. The c2pa-node buffer-API path reads the
 * full asset bytes into a Node Buffer. For oversized assets that crosses the
 * V8 heap limit and risks an OOM. Pre-stat at the call site (output-downloader)
 * AND defence-in-depth here: signOutput refuses to drive embed-buffer when
 * input bytes exceed this cap and emits a typed manifest_signed event with
 * status_reason='asset_too_large_for_buffer_api'.
 *
 * 500 MB matches the existing DEFAULT_DOWNLOAD_MAX_BYTES cap in the ComfyUI
 * client (T-5-03) — outputs larger than 500 MB are already rejected at the
 * download boundary, so this constant is the upper bound a downloader can
 * realistically pass through. The file-API path (MP4 / WebP / TIFF) streams
 * via c2pa-rs and does NOT need the cap.
 *
 * Single source of truth (Plan 14-fix MR-03): pipeline.ts and
 * output-downloader.ts both import this constant — drift class eliminated.
 */
export const BUFFER_SIGNING_MAX_BYTES = 500 * 1024 * 1024;
