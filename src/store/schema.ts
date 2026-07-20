import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';

// Vellum hierarchy schema: workspaces → projects → sequences → shots → versions.
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
  // Phase 20 addition — STAT-01. Mutable denorm for O(1) grid reads.
  // Truth lives in shot_status_events (append-only); this column is a
  // materialized cache updated in the SAME db.transaction() that appends
  // a status event. Added by drizzle migrator via 0008_shot_status.sql;
  // SCHEMA_DDL below intentionally does NOT declare this column —
  // matches the Phase 2/3/12/14/19 additive split.
  status: text('status').notNull().default('wip'),
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
  // Phase 12 addition — DEMO-03 (D-CTX-5). Nullable JSON-encoded array of
  // reproduction warnings (e.g., partner-API non-determinism flags) returned
  // by engine.reproduceVersion. NULL on legacy rows semantically equals
  // "no warnings recorded". Added by drizzle migrator via
  // 0005_phase12_reproduction_warnings.sql.
  reproduction_warnings_json: text('reproduction_warnings_json'),
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
  // Phase 14 addition — PROV-V-01. Nullable JSON-encoded payload of the
  // 'manifest_signed' event_type added by Plan 14-03. Pre-Phase-14 rows
  // read NULL here. Added by drizzle migrator via
  // 0006_phase14_manifest_signed_event.sql; SCHEMA_DDL above intentionally
  // does NOT declare this column — matches the Phase 2/3/12 additive split.
  manifest_signed_json: text('manifest_signed_json'),
  // Phase 19 addition — SUM-05. Nullable JSON-encoded payload of the
  // 'summary_generated' event_type added by Plan 19-01. Pre-Phase-19 rows
  // read NULL here. Added by drizzle migrator via
  // 0007_phase19_summary_generated_event.sql; SCHEMA_DDL above intentionally
  // does NOT declare this column — matches the Phase 2/3/12/14 additive split.
  summary_generated_json: text('summary_generated_json'),
  timestamp: integer('timestamp').notNull(),
}, (t) => ({
  // D-PROV-35: two-column index supports both "all events for version in order"
  // (version.provenance canonical query) and "latest completed event" lookups
  // on a single index scan.
  idxVersionTime: index('idx_provenance_version_time').on(t.version_id, t.timestamp),
}));

/**
 * Phase 4 — D-ASST-07: tag attachments for versions. Plain CRUD (DELETE allowed);
 * repo can expose both insertTag and deleteTag (unlike provenance-repo). UNIQUE
 * autoindex on (version_id, tag) covers per-version reads; idx_tags_tag supports
 * multi-tag AND filter via `tag IN (SELECT value FROM json_each(?))` (Pattern 1
 * of RESEARCH.md). Added by migrator via 0004_phase4_assets.sql; SCHEMA_DDL does
 * NOT declare this table (additive-split pattern — D-ASST-31).
 */
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  version_id: text('version_id')
    .notNull()
    .references(() => versions.id),
  tag: text('tag').notNull(),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqueVersionTag: unique().on(t.version_id, t.tag),
  idxTag: index('idx_tags_tag').on(t.tag),
}));

/**
 * Phase 4 — D-ASST-08: key-value metadata for versions. Upsert semantics via
 * ON CONFLICT(version_id, key) DO UPDATE (D-ASST-03). `value` is arbitrary
 * UTF-8 text up to 2000 chars (enforced at engine boundary). idx_metadata_key_value
 * is a covering index for the (key, value) AND filter (Pattern 2 of RESEARCH.md).
 */
export const metadata = sqliteTable('metadata', {
  id: text('id').primaryKey(),
  version_id: text('version_id')
    .notNull()
    .references(() => versions.id),
  key: text('key').notNull(),
  value: text('value').notNull(),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqueVersionKey: unique().on(t.version_id, t.key),
  idxKeyValue: index('idx_metadata_key_value').on(t.key, t.value),
}));

/**
 * Phase 20 — STAT-02, STAT-03: append-only shot status events table
 * (Drizzle export `shotStatusEvents`). One row per status transition
 * for the parent shot, in monotonically increasing `created_at` order.
 * Truth model: this table is canonical history; `shots.status` is a
 * materialized cache rebuilt from the most recent shotStatusEvents row.
 *
 * Structural append-only invariant: the repo (src/store/shot-status-repo.ts,
 * Plan 02) has ZERO update/delete methods. Architecture-purity test enforces
 * `UPDATE shot_status_events` / `DELETE.*shot_status_events` do not appear
 * in src/store/shot-status-repo.ts. Mirrors the Phase 3 provenance pattern.
 *
 * Pre-migration shots have zero rows here — repo null-coalesces to 'wip'.
 *
 * Added by drizzle migrator via 0008_shot_status.sql; SCHEMA_DDL above
 * intentionally does NOT declare this table — matches the Phase 2/3/12/14/19
 * additive split.
 */
export const shotStatusEvents = sqliteTable('shot_status_events', {
  id: text('id').primaryKey(),
  shot_id: text('shot_id')
    .notNull()
    .references(() => shots.id),
  from_status: text('from_status'), // null on first-ever status set
  to_status: text('to_status').notNull(),
  changed_by: text('changed_by').notNull(),
  note: text('note'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  idxShotTime: index('idx_shot_status_events_shot_time').on(t.shot_id, t.created_at),
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
