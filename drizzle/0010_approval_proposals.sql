-- IDM: ROLLBACK NOT SUPPORTED.
--
-- Approval gate (10-ton "no silent credit spend" law). A proposal is a
-- generation REQUEST awaiting human sign-off: the full verbatim request is
-- recorded BEFORE any provider call, an approver reads it (and the caller's
-- cost estimate), and only an explicit approve executes the spend. `kind`
-- selects which engine path runs at approve time:
--   submit    -> request_json = the provider request (workflow/params bag)
--   reproduce -> request_json = { version_id }
--   iterate   -> request_json = { version_id, overrides?, seed? }
-- `status` is 'proposed' | 'approved' | 'rejected'; the decide UPDATE is
-- guarded WHERE status='proposed' so a proposal can be decided exactly once
-- (the atomic claim that prevents double-spend). `version_id` links the
-- version created by an approved submit; NULL until then (and NULL forever
-- on rejected / failed-at-execute proposals — execution_error records why).
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text,
	`request_json` text NOT NULL,
	`notes` text,
	`cost_estimate` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`decided_note` text,
	`version_id` text,
	`execution_error` text,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_proposals_shot_status` ON `proposals` (`shot_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_proposals_status_created` ON `proposals` (`status`,`created_at`);
