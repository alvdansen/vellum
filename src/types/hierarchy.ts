// Pure type definitions for VFX Familiar hierarchy entities.
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
