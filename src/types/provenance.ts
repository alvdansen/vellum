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

/** D-PROV-06: one entry per ComfyUI loader node. */
export interface ModelRef {
  node_id: string;
  class_type: string;
  model_name: string;
  model_hash: string | null;      // null in Phase 3 (checksums deferred)
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

export interface DiffResponse {
  summary: string;
  changes: DiffChanges;
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
