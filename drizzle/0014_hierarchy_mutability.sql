-- IDM: ROLLBACK NOT SUPPORTED.
--
-- The hierarchy was create-only. Not by design so much as by omission: there was
-- no rename, no archive, nothing. A shot named wrong stayed named wrong forever,
-- and a sequence dropped in a re-cut had to sit in the grid pretending to be
-- live. Re-cuts are routine, so that second one bites on real productions.
--
-- Two halves:
--
--   1. `hierarchy_events` — append-only audit of every mutation. Renaming
--      without a record would quietly falsify history: a pipeline log written
--      last week says 'sh010', the shot now says 'sh015', and nothing connects
--      them. Same truth model as shot_status_events — this table is canonical
--      history, the entity row is the materialized current value.
--
--   2. `archived_at` on all four levels. NULL = live. Archive is soft and
--      reversible; nothing is ever deleted, because provenance rows point at
--      these ids and an append-only record whose subject can vanish is not a
--      record. Archived entities are hidden from default listings and refuse
--      NEW work (child creation, new generations) while staying fully readable
--      and still accepting registration of outputs that already exist.
--
-- Deliberately NOT added: move/reparent. Changing a shot's sequence would
-- change the breadcrumb of versions already written and orphan the output
-- directories those versions were persisted into. That needs a migration story
-- for files on disk, not just a column.
--
-- Not in SCHEMA_DDL (additive split).
CREATE TABLE `hierarchy_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_value` text,
	`to_value` text,
	`changed_by` text NOT NULL DEFAULT 'user',
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hierarchy_events_entity_time` ON `hierarchy_events` (`entity_type`,`entity_id`,`created_at` DESC);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `sequences` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `shots` ADD `archived_at` integer;
