// Pure type definitions for Vellum hierarchy entities.
// ZERO imports — this file is the canonical type source consumed by engine, store, and tools.

/**
 * MNT-04: single source of truth for the VFX shot naming convention (D-07).
 * Lowercase `sh` prefix + at least 3 digits (e.g. `sh010`, `sh0200`). The engine
 * enforces the regex before any DB work (pipeline.ts); the shot tool's Zod
 * schema enforces it at the tool boundary for early rejection. Keeping both
 * call sites (defence-in-depth) with ONE source avoids drift.
 */
export const SHOT_NAME_REGEX = /^sh\d{3,}$/;

export interface Workspace {
  id: string;
  name: string;
  naming_template: string | null;
  created_at: number;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  naming_template: string | null;
  created_at: number;
}

export interface Sequence {
  id: string;
  project_id: string;
  name: string;
  created_at: number;
}

export interface Shot {
  id: string;
  sequence_id: string;
  name: string;
  created_at: number;
  status: ShotStatus; // added by migration 0008; default 'wip'
}

/**
 * IAC-05: closed set of version lifecycle states (D-GEN-18 state machine).
 * Engine-level `mapState` already treats this as a closed union; narrowing
 * the type here lets callers pattern-match exhaustively and catches stale
 * string comparisons at compile time. The SQLite column stays TEXT — a
 * cast at the repo boundary preserves schema compatibility without forcing
 * a migration.
 */
export type VersionStatus = 'submitted' | 'running' | 'completed' | 'failed';

/**
 * STAT-01: closed set of shot production states. Free DAG — no transition
 * guards. Supervisors can transition any → any. The SQLite column stays
 * TEXT with DEFAULT 'wip'; the SHOT_STATUSES constant is the single source
 * of truth for the valid set (grep test enforces no inline string comparisons).
 */
export const SHOT_STATUSES = ['wip', 'pending-review', 'approved', 'on-hold', 'omit'] as const;
export type ShotStatus = typeof SHOT_STATUSES[number];

export interface Version {
  id: string;
  shot_id: string;
  version_number: number;
  status: VersionStatus;
  job_id: string | null;
  parent_version_id: string | null;
  notes: string | null;
  created_at: number;
  completed_at: number | null;
  // Phase 2 additions — D-GEN-19 (all nullable):
  error_code: string | null;
  error_message: string | null;
  outputs_json: string | null;
  // Phase 3 additions — D-PROV-33 (nullable).
  lineage_type: 'reproduce' | 'iterate' | null;
  // Phase 12 addition — DEMO-03 (D-CTX-5). JSON-encoded string[] persisted
  // at engine.reproduceVersion time. NULL on legacy rows.
  reproduction_warnings_json: string | null;
  // Pivot Phase B addition. The GenerationProvider adapter id that produced this
  // version ('comfyui-cloud', 'replicate', …). Optional in the TS view because
  // additive/dual-read: DB rows post-migration always carry it (value-or-null),
  // but hand-built literals predating the pivot may omit it (absent ≡ null).
  provider?: string | null;
}

export type EntityType = 'workspace' | 'project' | 'sequence' | 'shot' | 'version';

export interface BreadcrumbEntry {
  type: EntityType;
  id: string;
  name: string;
}

export interface Breadcrumb {
  entries: BreadcrumbEntry[];
  text: string;
}
