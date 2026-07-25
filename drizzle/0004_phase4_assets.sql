-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 4 migration is purely additive: two new plain-CRUD tables (`tags` and
-- `metadata`) and their two secondary indexes. Unlike provenance, these tables
-- support DELETE — tags/metadata are organization state, not lineage (D-ASST-10).
-- Old Phase 1/2/3 code tolerates these because it never reads from them.
-- Drizzle does not generate down.sql and we intentionally do not ship one —
-- drop the DB and re-seed if a downgrade is ever needed.
CREATE TABLE `metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_metadata_key_value` ON `metadata` (`key`,`value`);--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_version_id_key_unique` ON `metadata` (`version_id`,`key`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tags_tag` ON `tags` (`tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `tags_version_id_tag_unique` ON `tags` (`version_id`,`tag`);
