// Typed error model for VFX Familiar engine (D-28..D-32, extended by D-GEN-40).
// Phase 1 codes + Phase 2 generation-lifecycle codes.

export type ErrorCode =
  // Phase 1 — hierarchy
  | 'WORKSPACE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'SHOT_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'DUPLICATE_NAME'
  | 'INVALID_SHOT_FORMAT'
  | 'INVALID_INPUT'
  // Phase 2 — generation (D-GEN-40)
  | 'INVALID_WORKFLOW_FORMAT'
  | 'COMFYUI_CREDENTIALS_MISSING'
  | 'COMFYUI_API_ERROR'
  | 'COMFYUI_RATE_LIMITED'
  | 'GENERATION_TIMEOUT'
  | 'DOWNLOAD_FAILED'
  | 'CONCURRENT_SUBMIT_CONFLICT'
  // Phase 3 — provenance & versioning (D-PROV-36)
  | 'PROVENANCE_UNAVAILABLE'
  | 'REPRODUCE_BLOCKED'
  | 'ITERATE_INVALID_PATCH'
  | 'VERSION_NOT_COMPLETED'
  // Phase 4 — asset management (D-ASST-23)
  | 'TAG_INVALID'
  | 'METADATA_INVALID'
  | 'TAG_LIMIT_EXCEEDED'
  | 'METADATA_LIMIT_EXCEEDED'
  | 'INVALID_SCOPE'
  // Phase 5 — web dashboard (D-WEBUI-34)
  | 'OUTPUT_UNAVAILABLE'
  // Phase 7 — endpoint reconciliation (D-EP-08)
  | 'COMFYUI_ENDPOINT_DRIFT'
  // Phase 10 — migrate-on-boot hardening (DEMO-01)
  | 'MIGRATION_PENDING'
  // Phase 14 — C2PA signed manifest emission (PROV-V-01)
  | 'C2PA_CONFIG_INVALID'
  | 'C2PA_SIGNER_LOAD_FAILED'
  | 'C2PA_SIGNING_FAILED'
  // Phase 16 — Redaction & agent surface (PROV-V-06, PROV-V-07)
  | 'EXPORT_PATH_TRAVERSAL_REJECTED'
  | 'C2PA_VERIFIER_LOAD_FAILED'
  // Phase 16 / Plan 16-02 — PROV-V-06 redaction error surfaces.
  | 'REDACT_NO_MANIFEST'           // version has no signed manifest_signed event
  | 'REDACT_PARENT_UNREADABLE'     // c2pa.read failed on parent bytes
  | 'REDACT_POLICY_INVALID'        // bounded resolver / DSL violation
  | 'REDACT_TIMEOUT'               // C-04 fix: assetWriterMutex acquire timeout (30s default)
  | 'REDACT_SIGNING_DISABLED'      // C-06 fix: c2paConfig === null (signing disabled, distinct from no-manifest)
  | 'REDACT_DB_WRITE_FAILED'       // C-06 fix: appendManifestSignedRedactedEvent insert failed AFTER re-sign succeeded
  // Phase 17 — visual thumbnails (VIS-01..06)
  | 'THUMBNAIL_FAILED'             // sharp / ffmpeg derivation failed; engine writes .thumb.failed sentinel and UI degrades to skeleton (D-26)
  // Phase 19 — AI Conversational Summary (SUM-01..07)
  | 'ANTHROPIC_CONFIG_INVALID'    // boot-time validation (D-PRIV-4)
  | 'ANTHROPIC_SDK_LOAD_FAILED'   // lazy-import failure (mirrors C2PA_SIGNER_LOAD_FAILED)
  | 'SUMMARY_THROTTLED'           // POST regenerate 60s server throttle (SUM-04)
  // Internal fallback for unexpected I/O surfaces below the tool boundary.
  | 'INTERNAL_ERROR';

/**
 * Typed engine error. Every error thrown below the tool boundary is a TypedError.
 * Tool envelope maps this to MCP's `{ isError: true, structuredContent: { code, message, hint } }`.
 * Raw Zod or SQLite errors must never reach the agent — see D-13, D-32.
 */
export class TypedError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'TypedError';
  }
}
