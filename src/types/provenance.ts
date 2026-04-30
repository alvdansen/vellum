// Pure type definitions for Phase 3 provenance, diff, and iterate.
// ZERO imports — canonical type source consumed by engine, store, and tools.
// Refs: D-PROV-02 (ProvenanceEvent), D-PROV-15 (DiffResponse), D-PROV-33 (LineageType).

export type ProvenanceEventType =
  | 'submitted'
  | 'completed'
  | 'failed'
  | 'models_fingerprinted'
  | 'manifest_signed';
export type LineageType = 'reproduce' | 'iterate';

/**
 * Phase 14 — PROV-V-01 (D-CTX-7). Sibling event written by Engine.signOutput
 * AFTER the 'completed' event + after 'models_fingerprinted'. Carries the
 * outcome of the signing attempt. NEVER carries key material — only the
 * cert subject summary derived from the cert's public DN (Plan 14-02
 * loadSigner with RFC4514-safe parser per Concern #10).
 *
 * v1.1 scope (Concern #2): NO `sidecar` field — c2pa-node v0.5.26 has no
 * sidecar API. EXR/PSD surface as signed=false / status_reason='unsupported_format'
 * with the original file untouched on disk. v1.2 deferred items in
 * REQUIREMENTS.md cover cryptographic-sidecar support pending c2pa-node API
 * additions OR direct c2pa-rs FFI binding.
 *
 * Append-only: ProvenanceRepo's `appendManifestSignedEvent` INSERTs a new
 * row; it never updates the original 'completed' or 'models_fingerprinted'
 * rows. T-14-09 mitigation parity with T-13-07.
 */
export type ManifestSignedPayloadFields = {
  /** Output filename (basename only — outputs may have multiple files per version). */
  filename: string;
  /** MIME type that was signed (image/png, video/mp4, image/tiff, etc.). Empty when signing skipped. */
  format: string;
  /** True when signing succeeded; false when signer was disabled, format unsupported, or signing threw (D-CTX-9 graceful-fail). */
  signed: boolean;
  /** Short DN summary (CN/O) from the cert. NEVER public-key bytes, NEVER private-key bytes. Empty when signed=false. */
  cert_subject_summary: string;
  /** ISO-8601 timestamp recorded by Engine.signOutput. */
  signed_at: string;
  /** Reason code when signed=false. Empty when signed=true. One of:
   *  'signing_disabled' | 'unsupported_format' | 'sign_call_failed' |
   *  'cert_load_failed' | 'asset_too_large_for_buffer_api' | 'native_binding_unavailable'. */
  status_reason: string;
  /** Detected SigningAlgorithm (Plan 14-02 Concern #1). Empty when signed=false. */
  algorithm: string;
  /**
   * Phase 15 (D-CTX-5) — additive. SHA-256 hex digest of the SIGNED ASSET
   * BYTES. Used as the parentOf hash when a downstream child version
   * reads this row to populate its own parentOf ingredient.
   *
   * NOTE: this is the bytewise SHA-256 of the embedded-manifest output,
   * NOT the native binding's "labeled hash" — those are sha384-base64
   * with a format suffix. The native binding's createIngredient at the
   * parentOf call site computes its OWN labeled hash from the file
   * bytes; the manifest_sha256 we record here is for our internal
   * audit + parent lookup only.
   *
   * NULL when signed=false. Pre-Phase-15 rows always read undefined
   * (TS-optional). Plan 15-03 populates this on success paths.
   */
  manifest_sha256?: string | null;
  /**
   * Phase 15 (D-CTX-5) — additive ingredient summary so audits can
   * reconstruct what the manifest emitted without parsing the full
   * bytes. Pre-Phase-15 rows read undefined.
   *
   * unavailable_count = parent_count + component_count − reachable_count;
   * a non-zero value means at least one ingredient surfaced as a
   * vfx_familiar.unavailable_ingredient assertion (ROADMAP criterion #5).
   */
  ingredients_summary?: {
    parent_count: 0 | 1;
    component_count: number;
    input_assertion: boolean;
    unavailable_count: number;
  };
  /**
   * Phase 16 / Plan 16-02 (D-CTX-5) — additive, non-breaking. When TRUE,
   * this manifest_signed event row carries the OUTCOME of a redaction
   * call (Engine.redactManifestForVersion). The original (un-redacted)
   * event row is BYTE-IDENTICAL — the redacted row is a SIBLING
   * (append-only invariant per D-CTX-5). Pre-Phase-16 rows always read
   * undefined here. Tools surface this via Plan 16-04's
   * version.redact_manifest envelope.
   */
  redacted?: boolean;
  /**
   * Phase 16 / Plan 16-02 — list of redaction-policy paths actually
   * applied. Excludes paths that surfaced as `not_found:<path>` (those
   * surface in Plan 16-04's tool envelope as a separate `not_found`
   * field). Empty array iff redacted=true is impossible (no-op redactions
   * are rejected at the helper boundary — Test 11 covers).
   */
  redacted_fields?: string[];
};

export type ProvenanceManifestSignedPayload = {
  event_type: 'manifest_signed';
} & ManifestSignedPayloadFields;

/** D-PROV-02 + Phase 13: one row per (version, event). Append-only — repo
 *  has no UPDATE/DELETE. Phase 13 adds the 'models_fingerprinted' event
 *  carrying populated SHA-256 fingerprints in models_json (sibling row to
 *  the original 'completed' event — append-only invariant preserved). */
export interface ProvenanceEvent {
  id: string;                     // nanoid with 'prov_' prefix (D-11 pattern)
  version_id: string;
  event_type: ProvenanceEventType;
  workflow_json: string | null;   // populated on 'submitted'
  prompt_json: string | null;     // populated on 'completed' (may be null if fetchResolvedPrompt returns null — PROVENANCE_UNAVAILABLE surfaces later)
  seed: number | null;            // populated on 'completed'
  models_json: string | null;     // populated on 'completed' — serialized ModelRef[]
  outputs_json: string | null;    // populated on 'completed' — mirrors versions.outputs_json at event time
  error_code: string | null;      // populated on 'failed'
  error_message: string | null;   // populated on 'failed'
  /** Phase 14 — PROV-V-01. Populated on 'manifest_signed' rows ONLY; carries
   *  the JSON-encoded ManifestSignedPayloadFields. Pre-Phase-14 rows always
   *  read NULL here (migration 0006 added the column as nullable). */
  manifest_signed_json: string | null;
  timestamp: number;              // epoch ms
}

/** D-PROV-06 + Phase 13 (D-CTX-1): one entry per ComfyUI loader node.
 *  Exactly one of `model_hash` / `model_hash_unavailable` is non-null
 *  after Phase 13 fingerprinting completes; both null means
 *  fingerprint-pending (background path has not yet run). Pure extraction
 *  in src/engine/provenance.ts emits both as null. */
export interface ModelRef {
  node_id: string;
  class_type: string;
  model_name: string;
  model_hash: string | null;             // populated by Phase 13 fingerprinter on success
  model_hash_unavailable: string | null; // populated by Phase 13 fingerprinter when bytes unreadable; reason codes per D-CTX-5
}

/** D-PROV-13: per-node override payload for generation.iterate. */
export interface IterateOverride {
  inputs?: Record<string, unknown>;
  class_type?: string;
}

/** D-PROV-15: full diff response (shape mirrored verbatim into tool envelope). */
export interface ParamChange {
  node_id: string;
  class_type: string;
  field: string;
  before: unknown;
  after: unknown;
}

export interface ModelChange {
  node_id: string;
  class_type: string;
  /** D-PROV-15 + Phase 13 (D-CTX-1): full pre-state of the model entry.
   *  After Phase 13, exactly one of `hash` / `hash_unavailable` is non-null
   *  on each side once the background fingerprinter has run; both null is
   *  the legacy / fingerprint-pending state. */
  before: { name: string; hash: string | null; hash_unavailable: string | null };
  after: { name: string; hash: string | null; hash_unavailable: string | null };
}

export interface SeedChange {
  before: number | null;
  after: number | null;
}

export interface WorkflowStructureChange {
  type: 'added' | 'removed';
  node_id: string;
  class_type: string;
}

export interface MetadataChange {
  field: 'created_at' | 'completed_at' | 'status' | 'output_count';
  before: unknown;
  after: unknown;
}

export interface DiffChanges {
  params: ParamChange[];
  models: ModelChange[];
  seed: SeedChange | null;
  workflow: WorkflowStructureChange[];
  metadata: MetadataChange[];
}

/** Phase 12 — DEMO-03 (D-CTX-4). Shape of `reproduction_divergence` attached
 *  to the diff envelope when B is a reproduce-lineage version. NULL when:
 *  (a) B is not reproduce-lineage,
 *  (b) bytes match AND no partner-API warnings persisted (criterion #4).
 *  Anything non-null means at least one divergence signal fired and the
 *  dashboard MUST surface the pill + (when both outputs present) the
 *  side-by-side comparison block. */
export interface ReproductionDivergence {
  sha256_mismatch: { parent: string; reproduction: string } | null;
  warnings: string[];
  parent_output_present: boolean;
  reproduction_output_present: boolean;
}

export interface DiffResponse {
  summary: string;
  changes: DiffChanges;
  /** Phase 12 — DEMO-03 (D-CTX-4). The `reproduction_divergence` field is
   *  optional and only populated when B is a reproduce-lineage version.
   *  NULL `reproduction_divergence` means "no divergence detected" or
   *  "B is not a reproduce-lineage version". */
  reproduction_divergence?: ReproductionDivergence | null;
}

/** Diff pre-conditions: two resolved snapshots with enough metadata to compare. */
export interface DiffSnapshot {
  version_id: string;
  shot_id: string;
  version_number: number;
  status: 'submitted' | 'running' | 'completed' | 'failed';
  created_at: number;
  completed_at: number | null;
  workflow_json: Record<string, unknown> | null;
  prompt_json: Record<string, unknown> | null;
  models_json: ModelRef[] | null;
  seed: number | null;
  output_count: number;
}

export interface DiffInput {
  a: DiffSnapshot;
  b: DiffSnapshot;
}
