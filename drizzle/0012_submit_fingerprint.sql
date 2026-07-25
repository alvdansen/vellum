-- IDM: ROLLBACK NOT SUPPORTED.
--
-- Duplicate-submit guard.
--
-- A submit whose response is lost (dropped connection, abort, a socket that
-- goes quiet) may still have been ACCEPTED and CHARGED remotely. The engine
-- marks that version failed because it never received a job id, so an agent
-- retrying the identical request pays for the same work twice.
--
-- Storing a fingerprint of the submitted request lets the engine recognise an
-- identical re-submit inside a short window and refuse it, pointing the caller
-- at the version already in flight (or at the one that failed ambiguously and
-- may be running right now).
--
-- Additive, NULLABLE: pre-migration rows read NULL, which the guard treats as
-- "unknown request, never a duplicate". Not in SCHEMA_DDL (additive split).
ALTER TABLE `versions` ADD `request_fingerprint` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_versions_shot_fingerprint` ON `versions` (`shot_id`,`request_fingerprint`,`created_at`);
