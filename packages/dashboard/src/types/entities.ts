// packages/dashboard/src/types/entities.ts
//
// Dashboard-local entity types. Mirrors the REST response shapes from
// src/http/dashboard-routes.ts (Plan 05-04) — plain DTOs the UI renders.
//
// Duplicated per D-WEBUI-31 (no server imports under packages/dashboard/src/**).
// These types are intentionally minimal: only the fields the dashboard reads.
// They are not a full mirror of every DB column.

/** Workspace entity — top of the hierarchy. */
export interface Workspace {
  id: string;
  name: string;
  created_at?: string;
}

/** Project entity — belongs to a workspace. */
export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  created_at?: string;
}

/** Sequence entity — belongs to a project. */
export interface Sequence {
  id: string;
  project_id: string;
  name: string;
  created_at?: string;
}

/** Shot entity — belongs to a sequence. */
export interface Shot {
  id: string;
  sequence_id: string;
  name: string;
  created_at?: string;
}

/** Version entity — a single generation result under a shot. */
export interface Version {
  id: string;
  shot_id: string;
  version_number: number;
  label?: string;
  status?: 'submitted' | 'running' | 'completed' | 'failed' | 'queued' | 'complete';
  created_at?: string;
  tags?: string[];
  metadata?: Array<{ key: string }>;
}
