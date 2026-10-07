CREATE TABLE `job_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`pid` integer NOT NULL,
	`heartbeat_at` numeric NOT NULL,
	`created_at` numeric NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `claimed_by` text;
