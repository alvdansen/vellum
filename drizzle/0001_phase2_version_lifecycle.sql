-- IDM-03: ROLLBACK NOT SUPPORTED.
--
-- Phase 2 migrations are purely additive: three nullable columns on an
-- existing table. Old Phase 1 code tolerates their presence because it
-- never reads from them (the Phase 1 repos selected named columns that
-- do not include error_code/error_message/outputs_json). There is no
-- scenario where a down migration would be needed — if a downgrade is
-- ever attempted, drop the DB and re-seed. Drizzle does not generate
-- down.sql files and we intentionally do not ship one.
ALTER TABLE `versions` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `outputs_json` text;
