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
  | 'INVALID_SCOPE';

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
