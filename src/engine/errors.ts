// Typed error model for the Vellum engine.

export type ErrorCode =
  // Hierarchy
  | 'WORKSPACE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'SHOT_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'DUPLICATE_NAME'
  | 'INVALID_SHOT_FORMAT'
  | 'INVALID_INPUT'
  | 'SPEC_NOT_FOUND'                  // project has no spec (or no such revision)
  // Generation lifecycle
  | 'INVALID_WORKFLOW_FORMAT'
  | 'COMFYUI_CREDENTIALS_MISSING'
  | 'COMFYUI_API_ERROR'
  | 'COMFYUI_RATE_LIMITED'
  // Provider-agnostic generation backends
  | 'GENERATION_CREDENTIALS_MISSING'  // no generation provider configured at all
  | 'REPLICATE_API_ERROR'             // Replicate REST surface failure
  | 'FAL_API_ERROR'                   // FAL queue REST surface failure
  | 'BYTEPLUS_API_ERROR'              // BytePlus ModelArk tasks REST surface failure
  | 'GOOGLE_API_ERROR'                // Google AI Studio (Gemini) generateContent surface failure
  | 'PROVIDER_API_ERROR'             // provider-neutral upstream failure — the engine's default when a failed/cancelled job's provider declares no canonical *_API_ERROR code (never mislabel a non-ComfyUI job COMFYUI_API_ERROR)
  | 'PROVIDER_MISCONFIGURED'          // registry/config: unknown or credential-less provider selected
  // Approval gate (no silent credit spend)
  | 'APPROVAL_REQUIRED'               // direct submit/reproduce/iterate blocked; propose+approve instead
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_ALREADY_DECIDED'        // decide-exactly-once claim lost (already approved/rejected)
  | 'INVALID_REQUEST_FORMAT'          // provider-agnostic request validation failure (analog of INVALID_WORKFLOW_FORMAT)
  | 'GENERATION_TIMEOUT'
  | 'DOWNLOAD_FAILED'
  | 'CONCURRENT_SUBMIT_CONFLICT'
  | 'DUPLICATE_SUBMIT'                // identical request already in flight (or ambiguously failed) for this shot
  | 'TOO_MANY_IN_FLIGHT'              // operator's concurrent-generation ceiling reached
  | 'SPEND_LIMIT_REACHED'             // operator's recorded-spend ceiling reached for the window
  // Provenance & versioning
  | 'PROVENANCE_UNAVAILABLE'
  | 'REPRODUCE_BLOCKED'
  | 'ITERATE_INVALID_PATCH'
  | 'VERSION_NOT_COMPLETED'
  // Asset management
  | 'TAG_INVALID'
  | 'METADATA_INVALID'
  | 'TAG_LIMIT_EXCEEDED'
  | 'METADATA_LIMIT_EXCEEDED'
  | 'INVALID_SCOPE'
  // Web dashboard
  | 'OUTPUT_UNAVAILABLE'
  // Endpoint reconciliation
  | 'COMFYUI_ENDPOINT_DRIFT'
  // Migrate-on-boot hardening
  | 'MIGRATION_PENDING'
  // C2PA signed manifest emission
  | 'C2PA_CONFIG_INVALID'
  | 'C2PA_SIGNER_LOAD_FAILED'
  | 'C2PA_SIGNING_FAILED'
  // Redaction & agent surface
  | 'EXPORT_PATH_TRAVERSAL_REJECTED'
  | 'C2PA_VERIFIER_LOAD_FAILED'
  // Redaction error surfaces.
  | 'REDACT_NO_MANIFEST'           // version has no signed manifest_signed event
  | 'REDACT_PARENT_UNREADABLE'     // c2pa.read failed on parent bytes
  | 'REDACT_POLICY_INVALID'        // bounded resolver / DSL violation
  | 'REDACT_TIMEOUT'               // assetWriterMutex acquire timeout (30s default)
  | 'REDACT_SIGNING_DISABLED'      // c2paConfig === null (signing disabled, distinct from no-manifest)
  | 'REDACT_DB_WRITE_FAILED'       // appendManifestSignedRedactedEvent insert failed AFTER re-sign succeeded
  // Visual thumbnails
  | 'THUMBNAIL_FAILED'             // sharp / ffmpeg derivation failed; engine writes .thumb.failed sentinel and UI degrades to skeleton
  // AI conversational summary
  | 'ANTHROPIC_CONFIG_INVALID'    // boot-time validation
  | 'ANTHROPIC_SDK_LOAD_FAILED'   // lazy-import failure (mirrors C2PA_SIGNER_LOAD_FAILED)
  | 'SUMMARY_THROTTLED'           // POST regenerate 60s server throttle
  // Internal fallback for unexpected I/O surfaces below the tool boundary.
  | 'INTERNAL_ERROR';

/**
 * Typed engine error. Every error thrown below the tool boundary is a TypedError.
 * Tool envelope maps this to MCP's `{ isError: true, structuredContent: { code, message, hint } }`.
 * Raw Zod or SQLite errors must never reach the agent.
 */
export class TypedError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public hint?: string,
    /**
     * True when the call failed WITHOUT a response from the provider — a
     * dropped connection, an abort, a socket that went quiet. The request may
     * have been accepted and CHARGED remotely even though we never learned its
     * job id, so a retry can pay twice. A definitive rejection (the provider
     * answered, with a 4xx/5xx) is NOT ambiguous: nothing ran.
     *
     * Additive and defaulted, so `.code` consumers are unaffected.
     */
    public ambiguous: boolean = false,
  ) {
    super(message);
    this.name = 'TypedError';
  }
}
