import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';

// Phase 1 hierarchy tables: workspaces → projects → sequences → shots → versions.
// IDs are nanoid-prefixed text, timestamps are epoch-ms integers.
// Versions table is schema-only in Phase 1 (D-10) — no rows inserted until Phase 2 generation.

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  naming_template: text('naming_template'),
  created_at: integer('created_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  workspace_id: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  naming_template: text('naming_template'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqueNamePerWorkspace: unique().on(t.workspace_id, t.name),
  idxWorkspace: index('idx_projects_workspace').on(t.workspace_id),
}));

export const sequences = sqliteTable('sequences', {
  id: text('id').primaryKey(),
  project_id: text('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqueNamePerProject: unique().on(t.project_id, t.name),
  idxProject: index('idx_sequences_project').on(t.project_id),
}));

export const shots = sqliteTable('shots', {
  id: text('id').primaryKey(),
  sequence_id: text('sequence_id')
    .notNull()
    .references(() => sequences.id),
  name: text('name').notNull(),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqueNamePerSequence: unique().on(t.sequence_id, t.name),
  idxSequence: index('idx_shots_sequence').on(t.sequence_id),
}));

export const versions = sqliteTable('versions', {
  id: text('id').primaryKey(),
  shot_id: text('shot_id')
    .notNull()
    .references(() => shots.id),
  version_number: integer('version_number').notNull(),
  status: text('status').notNull().default('submitted'),
  job_id: text('job_id'),
  parent_version_id: text('parent_version_id'),
  notes: text('notes'),
  created_at: integer('created_at').notNull(),
  completed_at: integer('completed_at'),
  // Phase 2 additions — D-GEN-19 (all nullable). Added by the drizzle migrator
  // via 0001_phase2_version_lifecycle.sql on every DB (fresh or existing); the
  // Phase 1 SCHEMA_DDL below intentionally does NOT declare these columns, so
  // on a brand-new DB the sequence is: SCHEMA_DDL creates base tables → then
  // migrate() ALTER-adds the Phase 2 columns. See IM-04 for history.
  error_code: text('error_code'),
  error_message: text('error_message'),
  outputs_json: text('outputs_json'),
}, (t) => ({
  uniqueVersionPerShot: unique().on(t.shot_id, t.version_number),
  idxShot: index('idx_versions_shot').on(t.shot_id, t.version_number),
  // Supports listPendingVersions() — called at every server boot by the recovery
  // poller (D-GEN-28). Without it the query is a full table scan that grows O(n)
  // in total version count as completed rows accumulate.
  idxStatus: index('idx_versions_status').on(t.status),
}));

/**
 * Raw DDL string used by openDb() first-run path and the in-memory test fixture.
 *
 * IMPORTANT — intentional Phase 1 / Phase 2 split (do not "re-sync"): this DDL
 * mirrors the Phase 1 bootstrap schema (workspaces/projects/sequences/shots/
 * versions base columns + Phase 1 indexes). The Phase 2 NULLABLE columns on
 * `versions` (error_code, error_message, outputs_json) are NOT declared here —
 * they are added on every DB (fresh or existing) by the drizzle migrator via
 * 0001_phase2_version_lifecycle.sql. The idx_versions_status index is duplicated
 * here as a belt-and-suspenders guard (also emitted by migration 0002) because
 * the `IF NOT EXISTS` clause makes the duplicate a no-op.
 *
 * Boot sequence on a fresh DB: (1) openDb() sees user_version=0 → execs this
 * SCHEMA_DDL → stamps user_version=1; (2) migrate() then applies the Phase 2
 * migrations (0001, 0002) additively. On an existing Phase 1 DB only step (2)
 * runs. This split keeps Phase 1's zero-dep bootstrap intact while letting
 * Phase 2+ migrations be additive, idempotent, and rollback-friendly.
 *
 * NOTE: versions.parent_version_id cannot use `REFERENCES versions(id)` inline at
 * CREATE TABLE time because the self-reference would require the rowid to exist;
 * SQLite tolerates it as a forward-ref but tests must not trip on it. Kept explicit.
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  naming_template TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  naming_template TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(sequence_id, name)
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id),
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  job_id TEXT,
  parent_version_id TEXT REFERENCES versions(id),
  notes TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(shot_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sequences_project ON sequences(project_id);
CREATE INDEX IF NOT EXISTS idx_shots_sequence ON shots(sequence_id);
CREATE INDEX IF NOT EXISTS idx_versions_shot ON versions(shot_id, version_number);
CREATE INDEX IF NOT EXISTS idx_versions_status ON versions(status);
`;
