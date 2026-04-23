-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 3 migration is purely additive: a new `provenance` table (D-PROV-01,
-- structurally append-only — repo has no UPDATE/DELETE methods), a covering
-- index (D-PROV-35), and a nullable `lineage_type` column on `versions`
-- (D-PROV-33). Old Phase 1/2 code tolerates these because it never reads
-- from them. Drizzle does not generate down.sql and we intentionally do not
-- ship one — drop the DB and re-seed if a downgrade is ever needed.
CREATE TABLE `provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`event_type` text NOT NULL,
	`workflow_json` text,
	`prompt_json` text,
	`seed` integer,
	`models_json` text,
	`outputs_json` text,
	`error_code` text,
	`error_message` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_provenance_version_time` ON `provenance` (`version_id`,`timestamp`);--> statement-breakpoint
ALTER TABLE `versions` ADD `lineage_type` text;
