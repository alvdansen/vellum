-- IDM: ROLLBACK NOT SUPPORTED.
--
-- Project specs — the versioned standing context an agent reads BEFORE it
-- submits, and the missing answer to "why was the request what it was".
-- Vellum already records what happened (append-only provenance); it had
-- nowhere to record the spec that produced it.
--
-- Two halves, one feature:
--
--   1. `project_specs` — append-only revisions of a per-project spec. A
--      revision is NEVER updated or deleted; `set_spec` inserts revision N+1.
--      UNIQUE(project_id, revision) makes the monotonic sequence a structural
--      invariant rather than a convention, so two concurrent writers cannot
--      both claim the same revision number.
--
--   2. `provenance.spec_bound_json` — a nullable column carrying the payload
--      of a new 'spec_bound' sibling event: which spec revision (id + number +
--      content hash) was active when a version was created. Same additive,
--      append-only shape as manifest_signed_json / summary_generated_json /
--      cost_recorded_json. Versions created when a project has no spec write
--      no event at all, so NULL means "no spec was active", not "unknown".
--
-- Neither is in SCHEMA_DDL (additive split).
CREATE TABLE `project_specs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`note` text,
	`authored_by` text NOT NULL DEFAULT 'user',
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_specs_project_revision` ON `project_specs` (`project_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_project_specs_project_created` ON `project_specs` (`project_id`,`created_at` DESC);--> statement-breakpoint
ALTER TABLE `provenance` ADD `spec_bound_json` text;
