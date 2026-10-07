CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'ready' NOT NULL,
	`run_at` numeric NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`claimed_at` numeric,
	`finished_at` numeric,
	`created_at` numeric NOT NULL,
	`updated_at` numeric NOT NULL
);
--> statement-breakpoint
CREATE INDEX `index_jobs_on_state_and_run_at` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
CREATE INDEX `index_jobs_on_name_and_state` ON `jobs` (`name`,`state`);
