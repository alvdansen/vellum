// Phase 14 — D-CTX-3 native-embed format routing (revised 2026-04-30).
//
// Pure function — no I/O, no side effects. Returns one of three routes:
//  - { mode: 'embed-buffer', mimeType }  — JPEG / PNG (c2pa-node buffer API)
//  - { mode: 'embed-file', mimeType }    — MP4 / WebP / TIFF (c2pa-node file API)
//  - { mode: 'unsupported', reason }     — EXR / PSD (native-handler-missing) OR unknown extension
//
// **v1.1 scope (Concern #2 reduction):**
// c2pa-node v0.5.26 has NO public sidecar/external-manifest API. EXR + PSD have
// no c2pa-rs handler. Producing a "sidecar" by signing a placeholder PNG and
// writing those bytes alongside an EXR is cryptographically invalid (the
// manifest's data hash binds to the placeholder, not the EXR). Plan 14-03
// surfaces these as manifest_signed: false / status_reason: 'unsupported_format'
// provenance events; the original file is left unmodified on disk. See
// REQUIREMENTS.md v1.2 deferred items for the cryptographic-sidecar work.
//
// Extension matching is case-insensitive (T-14-08 mitigation: ComfyUI Cloud
// sometimes returns mixed-case filenames). The mimeType strings are the C2PA
// standard registrations and match what c2pa-node expects in its
// asset.mimeType field.
//
// Architecture-purity: zero external imports. zero MCP / DB / ORM / HTTP /
// c2pa-node imports. Pure-function module.

/**
 * D-CTX-3 discriminated union — three routing modes only. The absence of a
 * `sidecar` mode is structurally locked: c2pa-node v0.5.x has no
 * cryptographically-bound sidecar API in the public surface (Concern #2).
 */
export type FormatRoute =
  | { mode: 'embed-buffer'; mimeType: string }
  | { mode: 'embed-file'; mimeType: string }
  | {
      mode: 'unsupported';
      reason: 'native-handler-missing' | 'unknown-extension';
      mimeType?: string;
    };

/**
 * c2pa-node v0.5.x BUFFER-API formats. Verified against bindings.js
 * line 132-134: the JS sign() entry point only accepts image/png and
 * image/jpeg in its buffer-API path.
 */
const BUFFER_TABLE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * c2pa-node v0.5.x FILE-API formats. These go via the file-path API because
 * c2pa-node's buffer API rejects them. Verified against c2pa-rs asset
 * handlers: BMFF (mp4), RIFF (webp), tiff_io (tif/tiff).
 */
const FILE_TABLE: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/**
 * c2pa-rs has NO native handler in v0.5.26. v1.1 surfaces these as
 * unsupported(native-handler-missing). The mimeType is informational
 * (recorded in the manifest_signed provenance event). v1.2 may add
 * cryptographic sidecar support if c2pa-node exposes signEmbeddable.
 */
const NATIVE_HANDLER_MISSING_TABLE: Record<string, string> = {
  '.exr': 'image/x-exr',
  '.psd': 'image/vnd.adobe.photoshop',
};

/** Public exports for downstream consumers (Plan 14-03 / 14-04 / 14-05). */
export const EMBED_BUFFER_FORMATS: readonly string[] = Object.values(BUFFER_TABLE);
export const EMBED_FILE_FORMATS: readonly string[] = Object.values(FILE_TABLE);
export const UNSUPPORTED_NATIVE_FORMATS: readonly string[] = Object.values(
  NATIVE_HANDLER_MISSING_TABLE,
);

/**
 * Pure function — extension lookup against three tables. Case-insensitive
 * (T-14-08 mitigation). Returns one of the three FormatRoute variants.
 */
export function routeFormat(filename: string): FormatRoute {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return { mode: 'unsupported', reason: 'unknown-extension' };
  const ext = filename.slice(dot).toLowerCase();
  if (ext in BUFFER_TABLE) {
    return { mode: 'embed-buffer', mimeType: BUFFER_TABLE[ext]! };
  }
  if (ext in FILE_TABLE) {
    return { mode: 'embed-file', mimeType: FILE_TABLE[ext]! };
  }
  if (ext in NATIVE_HANDLER_MISSING_TABLE) {
    return {
      mode: 'unsupported',
      reason: 'native-handler-missing',
      mimeType: NATIVE_HANDLER_MISSING_TABLE[ext]!,
    };
  }
  return { mode: 'unsupported', reason: 'unknown-extension' };
}

/**
 * Phase 15 WR-02 — supported-MIME helper for the ingredient asset-ref path.
 *
 * Returns the c2pa-rs-supported MIME type for the filename's extension, or
 * `null` if the extension is unknown OR routes to a format that c2pa-rs has
 * no native handler for (EXR / PSD). Pipeline's parent/component asset-ref
 * resolution checks for null and routes the ingredient to
 * `vfx_familiar.unavailable_ingredient` with reason `mime_type_unsupported`,
 * rather than falling through to `application/octet-stream` which c2pa-rs
 * would reject inside `addIngredientsToBuilder`.
 *
 * Why null for native-handler-missing (EXR/PSD): c2pa-rs has no asset
 * handler for these formats, so passing their MIME type to createIngredient
 * would still fail. Treating them as unavailable matches the
 * sign-time signal Plan 14-03 already uses for the SIGNING asset
 * (status_reason='unsupported_format' on the version itself).
 *
 * Pure function — no I/O. Mirrors routeFormat's case-insensitive lookup.
 */
export function getMimeForExtensionOrNull(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = filename.slice(dot).toLowerCase();
  if (ext in BUFFER_TABLE) return BUFFER_TABLE[ext]!;
  if (ext in FILE_TABLE) return FILE_TABLE[ext]!;
  // EXR/PSD route to NATIVE_HANDLER_MISSING_TABLE — c2pa-rs cannot ingest
  // them as ingredient bytes either, so treat as unsupported here.
  return null;
}
