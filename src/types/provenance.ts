// Pure type definitions for provenance, diff, and iterate.
// ZERO imports — canonical type source consumed by engine, store, and tools.

export type ProvenanceEventType =
  | 'submitted'
  | 'completed'
  | 'failed'
  | 'models_fingerprinted'
  | 'manifest_signed'
  | 'summary_generated'    // LLM summary sibling event
  | 'cost_recorded'        // Cost actuals — log every call + cost
  | 'spec_bound';          // Which project spec revision was active at creation
export type LineageType = 'reproduce' | 'iterate';

/**
 * Spec binding payload for a 'spec_bound' sibling event: the project spec
 * revision that was active when a version was created.
 *
 * This is the record that makes "fix the spec, not the shot" auditable. Without
 * it, a spec revised on Tuesday silently reinterprets every take made on Monday
 * and nothing says which takes predate the correction.
 *
 * `content_hash` is the sha256 of the revision body, carried so a take can be
 * checked against spec text held elsewhere without trusting the row to be the
 * same bytes. Written at most once per version, and ONLY when a spec existed —
 * so no event means "no spec was active", never "nobody looked".
 */
export type SpecBoundPayloadFields = {
  spec_id: string;
  project_id: string;
  revision: number;
  content_hash: string;
};

/**
 * Cost actuals payload for a 'cost_recorded' sibling event. The approval gate
 * records a free-form cost ESTIMATE on the proposal before spend; this records
 * the ACTUAL cost after a take runs. Numeric `amount` + `currency` (not a free-
 * form string) so the dashboard can aggregate spend. Append-only: a correction
 * is a new sibling event; the newest wins. `currency` is a short label — a real
 * money code ('USD') OR a provider unit ('credits'). `recorded_by` is 'user' or
 * the calling tool/agent id.
 */
export type CostRecordedPayloadFields = {
  amount: number;
  currency: string;
  note?: string;
  recorded_by?: string;
};

/**
 * Sibling event written by Engine.signOutput
 * AFTER the 'completed' event + after 'models_fingerprinted'. Carries the
 * outcome of the signing attempt. NEVER carries key material — only the
 * cert subject summary derived from the cert's public DN (loadSigner
 * uses an RFC4514-safe parser).
 *
 * Scope note: NO `sidecar` field — c2pa-node v0.5.26 has no
 * sidecar API. EXR/PSD surface as signed=false / status_reason='unsupported_format'
 * with the original file untouched on disk. Deferred:
 * cryptographic-sidecar support pending c2pa-node API
 * additions OR direct c2pa-rs FFI binding.
 *
 * Append-only: ProvenanceRepo's `appendManifestSignedEvent` INSERTs a new
 * row; it never updates the original 'completed' or 'models_fingerprinted'
 * rows.
 */
export type ManifestSignedPayloadFields = {
  /** Output filename (basename only — outputs may have multiple files per version). */
  filename: string;
  /** MIME type that was signed (image/png, video/mp4, image/tiff, etc.). Empty when signing skipped. */
  format: string;
  /** True when signing succeeded; false when signer was disabled, format unsupported, or signing threw (graceful-fail). */
  signed: boolean;
  /** Short DN summary (CN/O) from the cert. NEVER public-key bytes, NEVER private-key bytes. Empty when signed=false. */
  cert_subject_summary: string;
  /** ISO-8601 timestamp recorded by Engine.signOutput. */
  signed_at: string;
  /** Reason code when signed=false. Empty when signed=true. One of:
   *  'signing_disabled' | 'unsupported_format' | 'sign_call_failed' |
   *  'cert_load_failed' | 'asset_too_large_for_buffer_api' | 'native_binding_unavailable'. */
  status_reason: string;
  /** Detected SigningAlgorithm. Empty when signed=false. */
  algorithm: string;
  /**
   * Additive. SHA-256 hex digest of the SIGNED ASSET
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
   * NULL when signed=false. Rows predating this field always read
   * undefined (TS-optional). Populated on success paths.
   */
  manifest_sha256?: string | null;
  /**
   * Additive ingredient summary so audits can
   * reconstruct what the manifest emitted without parsing the full
   * bytes. Rows predating this field read undefined.
   *
   * unavailable_count = parent_count + component_count − reachable_count;
   * a non-zero value means at least one ingredient surfaced as a
   * vellum.unavailable_ingredient assertion.
   */
  ingredients_summary?: {
    parent_count: 0 | 1;
    component_count: number;
    input_assertion: boolean;
    unavailable_count: number;
  };
  /**
   * Additive, non-breaking. When TRUE,
   * this manifest_signed event row carries the OUTCOME of a redaction
   * call (Engine.redactManifestForVersion). The original (un-redacted)
   * event row is BYTE-IDENTICAL — the redacted row is a SIBLING
   * (append-only invariant). Rows predating redaction always read
   * undefined here. Tools surface this via the
   * version.redact_manifest envelope.
   */
  redacted?: boolean;
  /**
   * List of redaction-policy paths actually
   * applied. Excludes paths that surfaced as `not_found:<path>` (those
   * surface in the tool envelope as a separate `not_found`
   * field). Empty array iff redacted=true is impossible (no-op redactions
   * are rejected at the helper boundary).
   */
  redacted_fields?: string[];
};

export type ProvenanceManifestSignedPayload = {
  event_type: 'manifest_signed';
} & ManifestSignedPayloadFields;

/**
 * Sibling event written by Engine.summarizeVersion AFTER
 * a successful LIVE call (cache miss + Anthropic success + validation pass).
 *
 * Cache key: (manifest_sha256, template_version, model_id). Redaction
 * mutates manifest_sha256 — free invalidation without explicit logic.
 *
 * NEVER carries the prompt text or the response text inside log emissions.
 * The summary_text field stays inside the JSON cell only; the multi-encoding
 * leak scan applies BEFORE INSERT to assert no API key fragments leaked.
 *
 * Append-only: ProvenanceRepo.appendSummaryGeneratedEvent INSERTs a new row;
 * fallback paths NEVER write a row. Regenerate paths bypass the
 * cache lookup but still INSERT a new sibling row on success —
 * getLatestSummaryGeneratedEvent returns the newer row.
 */
export type SummaryGeneratedPayloadFields = {
  /** Composite cache-key part 1. From the latest manifest_signed event. */
  manifest_sha256: string;
  /** Composite cache-key part 2. SUMMARY_TEMPLATE_VERSION constant from template.ts. */
  template_version: string;
  /** Composite cache-key part 3. 'claude-haiku-4-5-20251001'. */
  model_id: string;
  /** The validated LLM output (length-capped to ~180-token output budget). */
  summary_text: string;
  /** ISO-8601 timestamp from clock at write time. */
  generated_at: string;
  /** Anthropic response.usage.input_tokens — observability only, never logged with text. */
  prompt_tokens: number;
  /** Anthropic response.usage.output_tokens — observability only. */
  completion_tokens: number;
  /** ALWAYS 'live' — fallback paths do NOT write rows. */
  outcome: 'live';
};

export type ProvenanceSummaryGeneratedPayload = {
  event_type: 'summary_generated';
} & SummaryGeneratedPayloadFields;

/** One row per (version, event). Append-only — repo
 *  has no UPDATE/DELETE. The 'models_fingerprinted' event
 *  carries populated SHA-256 fingerprints in models_json (sibling row to
 *  the original 'completed' event — append-only invariant preserved). */
export interface ProvenanceEvent {
  id: string;                     // nanoid with 'prov_' prefix
  version_id: string;
  event_type: ProvenanceEventType;
  workflow_json: string | null;   // populated on 'submitted'
  prompt_json: string | null;     // populated on 'completed' (may be null if fetchResolvedPrompt returns null — PROVENANCE_UNAVAILABLE surfaces later)
  seed: number | null;            // populated on 'completed'
  models_json: string | null;     // populated on 'completed' — serialized ModelRef[]
  outputs_json: string | null;    // populated on 'completed' — mirrors versions.outputs_json at event time
  error_code: string | null;      // populated on 'failed'
  error_message: string | null;   // populated on 'failed'
  /** Populated on 'manifest_signed' rows ONLY; carries
   *  the JSON-encoded ManifestSignedPayloadFields. Older rows always
   *  read NULL here (migration 0006 added the column as nullable). */
  manifest_signed_json: string | null;
  /** Populated on 'summary_generated' rows ONLY; carries
   *  the JSON-encoded SummaryGeneratedPayloadFields. Older rows always
   *  read NULL here (migration 0007 added the column as nullable). */
  summary_generated_json: string | null;
  /** Cost actuals — populated on 'cost_recorded' rows ONLY; carries the
   *  JSON-encoded CostRecordedPayloadFields. Pre-migration rows read NULL
   *  (0011_cost_actuals.sql added the column as nullable). */
  cost_recorded_json?: string | null;
  /** Spec binding — populated on 'spec_bound' rows ONLY; carries the
   *  JSON-encoded SpecBoundPayloadFields. Pre-migration rows read NULL
   *  (0013_project_specs.sql added the column as nullable). */
  spec_bound_json?: string | null;
  // Neutral analogs of workflow_json / prompt_json for
  // non-ComfyUI backends. generation_result_json carries a serialized
  // NeutralProvenance (src/providers/provenance.ts). Optional in the TS view
  // (additive/dual-read): DB rows post-migration carry them (value-or-null),
  // pre-pivot literals may omit them (absent ≡ null). Migration 0009 added both.
  generation_request_json?: string | null;
  generation_result_json?: string | null;
  timestamp: number;              // epoch ms
}

/** One entry per ComfyUI loader node.
 *  Exactly one of `model_hash` / `model_hash_unavailable` is non-null
 *  after fingerprinting completes; both null means
 *  fingerprint-pending (background path has not yet run). Pure extraction
 *  in src/engine/provenance.ts emits both as null. */
export interface ModelRef {
  node_id: string;
  class_type: string;
  model_name: string;
  model_hash: string | null;             // populated by the fingerprinter on success
  model_hash_unavailable: string | null; // populated by the fingerprinter when bytes unreadable; carries a reason code
}

/** Per-node override payload for generation.iterate. */
export interface IterateOverride {
  inputs?: Record<string, unknown>;
  class_type?: string;
}

/** Full diff response (shape mirrored verbatim into tool envelope). */
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
  /** Full pre-state of the model entry.
   *  Exactly one of `hash` / `hash_unavailable` is non-null
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

/** Shape of `reproduction_divergence` attached
 *  to the diff envelope when B is a reproduce-lineage version. NULL when:
 *  (a) B is not reproduce-lineage,
 *  (b) bytes match AND no partner-API warnings persisted.
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
  /** The `reproduction_divergence` field is
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
  /** The neutral, comparable param bag for URL-provider versions,
   *  built from the completed event's generation_result_json as { model_id, params }.
   *  Null for ComfyUI versions (which diff via the prompt graph) and for rows
   *  predating it. When present on either side, version.diff compares via diffParams. */
  neutral_params?: Record<string, unknown> | null;
}

export interface DiffInput {
  a: DiffSnapshot;
  b: DiffSnapshot;
}
