import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';

// Vellum hierarchy schema: workspaces → projects → sequences → shots → versions.
// IDs are nanoid-prefixed text (`ws_`, `proj_`, `seq_`, `shot_`, `ver_`);
// timestamps are epoch-ms integers.
//
// Bootstrap layer: the 5 tables + the base columns declared below + the
// original indexes (`idx_*`). SCHEMA_DDL mirrors this for zero-dep first-run
// bootstrap (openDb's user_version=0 path).
//
// Additive layer: three later NULLABLE columns on `versions`
// (error_code, error_message, outputs_json) and the `idx_versions_status`
// index, both applied via the Drizzle migrator (0001, 0002). The SCHEMA_DDL
// below intentionally does NOT declare the migrator-added columns — openDb
// first runs SCHEMA_DDL on a fresh DB, then Drizzle layers the additive
// ALTERs on top. See `openDb()` for the full sequence.

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
  // Mutable denorm for O(1) grid reads.
  // Truth lives in shot_status_events (append-only); this column is a
  // materialized cache updated in the SAME db.transaction() that appends
  // a status event. Added by drizzle migrator via 0008_shot_status.sql;
  // SCHEMA_DDL below intentionally does NOT declare this column —
  // matches the additive-migration split.
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
  // Version-lifecycle additions (all nullable). Added by the drizzle migrator
  // via 0001_phase2_version_lifecycle.sql on every DB (fresh or existing); the
  // bootstrap SCHEMA_DDL below intentionally does NOT declare these columns, so
  // on a brand-new DB the sequence is: SCHEMA_DDL creates base tables → then
  // migrate() ALTER-adds these columns.
  error_code: text('error_code'),
  error_message: text('error_message'),
  outputs_json: text('outputs_json'),
  // Lineage addition (nullable). Added by the drizzle migrator
  // via 0003_phase3_provenance.sql; NULL marks originals from generation.submit.
  lineage_type: text('lineage_type'),
  // Nullable JSON-encoded array of
  // reproduction warnings (e.g., partner-API non-determinism flags) returned
  // by engine.reproduceVersion. NULL on legacy rows semantically equals
  // "no warnings recorded". Added by drizzle migrator via
  // 0005_phase12_reproduction_warnings.sql.
  reproduction_warnings_json: text('reproduction_warnings_json'),
  // Provider-agnostic addition (nullable). The GenerationProvider adapter id
  // that produced this version ('comfyui-cloud', 'replicate', …). NULL on
  // older rows. Added by drizzle migrator via 0009_pivot_neutral_provenance.sql;
  // SCHEMA_DDL below intentionally does NOT declare it — additive-split pattern.
  provider: text('provider'),
  // Duplicate-submit guard (nullable). Fingerprint of the submitted request, so
  // an identical re-submit inside a short window can be recognised and refused
  // rather than paying a provider twice for work that may already be running.
  // NULL on legacy rows, which the guard reads as "unknown request, never a
  // duplicate". Added by drizzle migrator via 0012_submit_fingerprint.sql;
  // SCHEMA_DDL below intentionally does NOT declare it — additive-split pattern.
  request_fingerprint: text('request_fingerprint'),
}, (t) => ({
  uniqueVersionPerShot: unique().on(t.shot_id, t.version_number),
  // Supports the duplicate-submit lookup (shot, fingerprint, recent-first).
  idxShotFingerprint: index('idx_versions_shot_fingerprint').on(
    t.shot_id,
    t.request_fingerprint,
    t.created_at,
  ),
  // Supports listPendingVersions() — called at every server boot by the recovery
  // poller. Without it the query is a full table scan that grows O(n)
  // in total version count as completed rows accumulate. Non-UNIQUE, so this
  // one is kept.
  idxStatus: index('idx_versions_status').on(t.status),
}));

/**
 * Append-only provenance events. One row per
 * (version, event) where event_type is 'submitted' | 'completed' | 'failed'.
 * Structurally append-only: the repo (src/store/provenance-repo.ts) has ZERO
 * UPDATE/DELETE methods; architecture-purity test enforces this. Added by the
 * drizzle migrator via 0003_phase3_provenance.sql; SCHEMA_DDL below intentionally
 * does NOT declare this table — matches the additive-migration split.
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
  // Nullable JSON-encoded payload of the
  // 'manifest_signed' event_type. Rows predating the migration
  // read NULL here. Added by drizzle migrator via
  // 0006_phase14_manifest_signed_event.sql; SCHEMA_DDL above intentionally
  // does NOT declare this column — matches the additive-migration split.
  manifest_signed_json: text('manifest_signed_json'),
  // Nullable JSON-encoded payload of the
  // 'summary_generated' event_type. Rows predating the migration
  // read NULL here. Added by drizzle migrator via
  // 0007_phase19_summary_generated_event.sql; SCHEMA_DDL above intentionally
  // does NOT declare this column — matches the additive-migration split.
  summary_generated_json: text('summary_generated_json'),
  // Provider-agnostic additions (nullable). Neutral analogs of
  // workflow_json / prompt_json for backends with no ComfyUI prompt graph.
  // generation_result_json holds a serialized NeutralProvenance
  // (src/providers/provenance.ts). ComfyUI keeps populating the legacy columns;
  // readers dual-read. Added by 0009_pivot_neutral_provenance.sql — NOT in SCHEMA_DDL.
  generation_request_json: text('generation_request_json'),
  generation_result_json: text('generation_result_json'),
  // Cost actuals — nullable JSON payload of the 'cost_recorded' event_type
  // (amount + currency + note/recorded_by). Pre-migration rows read NULL.
  // Added by 0011_cost_actuals.sql — NOT in SCHEMA_DDL (additive split).
  cost_recorded_json: text('cost_recorded_json'),
  // Spec binding — nullable JSON payload of the 'spec_bound' event_type
  // (spec id + revision + content hash of the project spec that was active
  // when this version was created). Written at most once per version, and
  // only when the project HAD a spec — so absence means "no spec was active",
  // never "we forgot to look". Added by 0013_project_specs.sql — NOT in
  // SCHEMA_DDL (additive split).
  spec_bound_json: text('spec_bound_json'),
  timestamp: integer('timestamp').notNull(),
}, (t) => ({
  // Two-column index supports both "all events for version in order"
  // (version.provenance canonical query) and "latest completed event" lookups
  // on a single index scan.
  idxVersionTime: index('idx_provenance_version_time').on(t.version_id, t.timestamp),
}));

/**
 * Tag attachments for versions. Plain CRUD (DELETE allowed);
 * repo can expose both insertTag and deleteTag (unlike provenance-repo). UNIQUE
 * autoindex on (version_id, tag) covers per-version reads; idx_tags_tag supports
 * the multi-tag AND filter via `tag IN (SELECT value FROM json_each(?))`.
 * Added by migrator via 0004_phase4_assets.sql; SCHEMA_DDL does
 * NOT declare this table (additive-split pattern).
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
 * Key-value metadata for versions. Upsert semantics via
 * ON CONFLICT(version_id, key) DO UPDATE. `value` is arbitrary
 * UTF-8 text up to 2000 chars (enforced at engine boundary). idx_metadata_key_value
 * is a covering index for the (key, value) AND filter.
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
 * Append-only shot status events table
 * (Drizzle export `shotStatusEvents`). One row per status transition
 * for the parent shot, in monotonically increasing `created_at` order.
 * Truth model: this table is canonical history; `shots.status` is a
 * materialized cache rebuilt from the most recent shotStatusEvents row.
 *
 * Structural append-only invariant: the repo (src/store/shot-status-repo.ts)
 * has ZERO update/delete methods. Architecture-purity test enforces
 * `UPDATE shot_status_events` / `DELETE.*shot_status_events` do not appear
 * in src/store/shot-status-repo.ts. Mirrors the provenance pattern.
 *
 * Pre-migration shots have zero rows here — repo null-coalesces to 'wip'.
 *
 * Added by drizzle migrator via 0008_shot_status.sql; SCHEMA_DDL above
 * intentionally does NOT declare this table — matches the additive-migration
 * split.
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
 * Approval gate (no silent credit spend). A generation REQUEST awaiting
 * human sign-off — the full verbatim request recorded BEFORE any provider call.
 * `status` proposed|approved|rejected; the decide UPDATE in
 * src/store/proposal-repo.ts is guarded `WHERE status='proposed'` (decide
 * exactly once — the atomic claim that prevents double-spend). Added by drizzle
 * migrator via 0010_approval_proposals.sql; SCHEMA_DDL below intentionally does
 * NOT declare this table — matches the additive-migration split.
 */
export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  shot_id: text('shot_id')
    .notNull()
    .references(() => shots.id),
  kind: text('kind').notNull(), // 'submit' | 'reproduce' | 'iterate'
  provider: text('provider'), // null = default provider at approve time
  request_json: text('request_json').notNull(),
  notes: text('notes'),
  cost_estimate: text('cost_estimate'), // caller-asserted, free-form ("~12 credits")
  status: text('status').notNull().default('proposed'),
  created_at: integer('created_at').notNull(),
  decided_at: integer('decided_at'),
  decided_note: text('decided_note'),
  version_id: text('version_id'), // linked on approved+executed submit
  execution_error: text('execution_error'), // approve claimed but execution threw
}, (t) => ({
  idxShotStatus: index('idx_proposals_shot_status').on(t.shot_id, t.status),
  idxStatusCreated: index('idx_proposals_status_created').on(t.status, t.created_at),
}));

/**
 * Append-only project spec revisions — the versioned standing context an agent
 * reads before it submits.
 *
 * Vellum records what a generation WAS (append-only provenance) but had no
 * place for the spec that shaped it. A spec is a per-project document (a style
 * bible, a lighting look book, a naming-and-palette contract) that agents load
 * as context; when it turns out to be ambiguous the fix belongs in the SPEC,
 * not in the one output that went wrong. That only works if revisions are
 * durable and every take says which revision it was made under.
 *
 * Structural append-only invariant: the repo (src/store/spec-repo.ts) has ZERO
 * update/delete methods, enforced by architecture-purity greps. `set_spec`
 * inserts revision N+1; nothing ever rewrites revision N.
 *
 * UNIQUE(project_id, revision) is the concurrency guard: two writers racing to
 * create the same revision number collide on the index instead of silently
 * forking history.
 *
 * Added by drizzle migrator via 0013_project_specs.sql; SCHEMA_DDL below
 * intentionally does NOT declare this table — matches the additive-migration split.
 */
export const projectSpecs = sqliteTable('project_specs', {
  id: text('id').primaryKey(),
  project_id: text('project_id')
    .notNull()
    .references(() => projects.id),
  revision: integer('revision').notNull(),
  content: text('content').notNull(),
  // sha256 hex of `content`. Stamped into provenance at bind time so a take
  // can be checked against the spec text even if the row is read much later.
  content_hash: text('content_hash').notNull(),
  note: text('note'),
  authored_by: text('authored_by').notNull().default('user'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqueRevisionPerProject: unique().on(t.project_id, t.revision),
  idxProjectCreated: index('idx_project_specs_project_created').on(t.project_id, t.created_at),
}));

/**
 * Raw DDL string used by openDb() first-run path and the in-memory test fixture.
 *
 * IMPORTANT — intentional bootstrap / migration split (do not "re-sync"): this
 * DDL mirrors the bootstrap schema (workspaces/projects/sequences/shots/
 * versions base columns + bootstrap indexes). The later NULLABLE columns on
 * `versions` (error_code, error_message, outputs_json) are NOT declared here —
 * they are added on every DB (fresh or existing) by the drizzle migrator via
 * 0001_phase2_version_lifecycle.sql. The idx_versions_status index is duplicated
 * here as a belt-and-suspenders guard (also emitted by migration 0002) because
 * the `IF NOT EXISTS` clause makes the duplicate a no-op.
 *
 * Boot sequence on a fresh DB: (1) openDb() sees user_version=0 → execs this
 * SCHEMA_DDL → stamps user_version=1; (2) migrate() then applies the
 * migrations (0001, 0002, …) additively. On an existing bootstrapped DB only
 * step (2) runs. This split keeps the zero-dep bootstrap intact while letting
 * later migrations be additive, idempotent, and rollback-friendly.
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
