-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 20 (STAT-01..05) — add shot status workflow:
--   1. ALTER TABLE shots ADD COLUMN status (mutable denorm for O(1) grid reads)
--   2. CREATE TABLE shot_status_events (append-only audit trail — never UPDATE/DELETE)
--   3. Four covering indexes per SUMMARY.md requirement
--
-- Dual-model invariant: shots.status is a materialized cache; shot_status_events
-- is truth. Every status change writes BOTH in a single db.transaction().
-- Append-only invariant: shot_status_events rows are NEVER updated or deleted.
-- Architecture-purity grep test enforces: grep 'UPDATE shot_status_events' = empty.
-- Pre-migration shots have zero shot_status_events rows — repo null-coalesces to 'wip'.
ALTER TABLE `shots` ADD `status` text NOT NULL DEFAULT 'wip';--> statement-breakpoint
CREATE TABLE `shot_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`changed_by` text NOT NULL DEFAULT 'user',
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_shots_status` ON `shots` (`sequence_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_shots_project_status` ON `shots` (`sequence_id`,`status`,`created_at` DESC);--> statement-breakpoint
CREATE INDEX `idx_shot_status_events_shot_time` ON `shot_status_events` (`shot_id`,`created_at` DESC);--> statement-breakpoint
CREATE INDEX `idx_shots_cursor` ON `shots` (`sequence_id`,`created_at` DESC,`id`);
