import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';

// VFX Familiar hierarchy schema: workspaces → projects → sequences → shots → versions.
// IDs are nanoid-prefixed text (`ws_`, `proj_`, `seq_`, `shot_`, `ver_`);
// timestamps are epoch-ms integers.
//
// Phase 1 (landed): the 5 tables + the base columns declared below + the
// Phase 1 indexes (`idx_*`). SCHEMA_DDL mirrors this for zero-dep first-run
// bootstrap (openDb's user_version=0 path).
//
// Phase 2 (landed): three additive NULLABLE columns on `versions`
// (error_code, error_message, outputs_json) and the `idx_versions_status`
// index, both applied via the Drizzle migrator (0001, 0002). The SCHEMA_DDL
// below intentionally does NOT declare the Phase 2 columns — openDb first
// runs SCHEMA_DDL on a fresh DB, then Drizzle layers the additive ALTERs
// on top. See `openDb()` for the full sequence and IM-04 in the Phase 2
// planning for history.

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  naming_template: text('naming_template'),
  created_at: integer('created_at').notNull(),
});

// DM-03: `idx_{projects,sequences,shots,versions}_{fk}` indexes were redundant
// with the implicit UNIQUE autoindexes whose leading column matches the FK
// (confirmed via `EXPLAIN QUERY PLAN`). Dropped from the Drizzle schema to
// stop write-amplifying every insert. Existing DBs retain the indexes
// (migration 0001/0002 created them) — those are harmless leftovers and will
// be cleaned up whenever we re-baseline the schema.
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
  // Phase 3 additions — D-PROV-33 (nullable). Added by the drizzle migrator
  // via 0003_phase3_provenance.sql; NULL marks originals from generation.submit.
  lineage_type: text('lineage_type'),
}, (t) => ({
  uniqueVersionPerShot: unique().on(t.shot_id, t.version_number),
  // Supports listPendingVersions() — called at every server boot by the recovery
  // poller (D-GEN-28). Without it the query is a full table scan that grows O(n)
  // in total version count as completed rows accumulate. Non-UNIQUE, so this
  // one is kept.
  idxStatus: index('idx_versions_status').on(t.status),
}));

/**
 * Phase 3 — D-PROV-01, D-PROV-02: append-only provenance events. One row per
 * (version, event) where event_type is 'submitted' | 'completed' | 'failed'.
 * Structurally append-only: the repo (src/store/provenance-repo.ts) has ZERO
 * UPDATE/DELETE methods; architecture-purity test enforces this. Added by the
 * drizzle migrator via 0003_phase3_provenance.sql; SCHEMA_DDL below intentionally
 * does NOT declare this table — matches the Phase 2 additive split.
 */
export const provenance = sqliteTable('provenance', {
  id: text('id').primaryKey(),
  version_id: text('version_id')
    .notNull()
    .references(() => versions.id),
  event_type: text('event_type').notNull(),
  workflow_json: text('workflow_json'),
  prompt_json: text('prompt_json'),
  seed: integer('seed'),
  models_json: text('models_json'),
  outputs_json: text('outputs_json'),
  error_code: text('error_code'),
  error_message: text('error_message'),
  timestamp: integer('timestamp').notNull(),
}, (t) => ({
  // D-PROV-35: two-column index supports both "all events for version in order"
  // (version.provenance canonical query) and "latest completed event" lookups
  // on a single index scan.
  idxVersionTime: index('idx_provenance_version_time').on(t.version_id, t.timestamp),
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

-- DM-03: idx_projects_workspace / idx_sequences_project / idx_shots_sequence /
-- idx_versions_shot were redundant with the UNIQUE autoindexes whose leading
-- column matched the FK (EXPLAIN QUERY PLAN confirmed they were never picked).
-- Dropped from this fresh-install DDL; existing DBs retain them harmlessly
-- until the next schema re-baseline.
CREATE INDEX IF NOT EXISTS idx_versions_status ON versions(status);
`;
