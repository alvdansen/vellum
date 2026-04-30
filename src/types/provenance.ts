// Pure type definitions for Phase 3 provenance, diff, and iterate.
// ZERO imports — canonical type source consumed by engine, store, and tools.
// Refs: D-PROV-02 (ProvenanceEvent), D-PROV-15 (DiffResponse), D-PROV-33 (LineageType).

export type ProvenanceEventType = 'submitted' | 'completed' | 'failed';
export type LineageType = 'reproduce' | 'iterate';

/** D-PROV-02: one row per (version, event). Append-only — repo has no UPDATE/DELETE. */
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
  before: { name: string; hash: string | null };
  after: { name: string; hash: string | null };
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
