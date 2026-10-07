CREATE TABLE `pull_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`additions` integer,
	`archived` numeric DEFAULT (FALSE) NOT NULL,
	`author` text,
	`author_avatar` text,
	`base_ref` text,
	`base_sha` text,
	`changed_files` integer,
	`check_status` text,
	`closed_at_github` numeric,
	`created_at` numeric NOT NULL,
	`created_at_github` numeric,
	`deleted_at` numeric,
	`deletions` integer,
	`description` text,
	`draft` numeric DEFAULT (FALSE) NOT NULL,
	`github_id` integer,
	`head_ref` text,
	`head_sha` text,
	`inactive_reason` text,
	`latest_review_state` text,
	`merged_at_github` numeric,
	`number` integer,
	`remote_state` text DEFAULT 'open' NOT NULL,
	`repo_name` text,
	`repo_owner` text,
	`review_decision` text,
	`review_requested_for_me` numeric DEFAULT (FALSE) NOT NULL,
	`review_status` text,
	`review_tasks_count` integer DEFAULT 0,
	`title` text,
	`updated_at` numeric NOT NULL,
	`updated_at_github` numeric,
	`url` text
);
--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_updated_at_github` ON `pull_requests` (`updated_at_github`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_review_tasks_count` ON `pull_requests` (`review_tasks_count`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_review_status` ON `pull_requests` (`review_status`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_review_requested_for_me` ON `pull_requests` (`review_requested_for_me`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_repo_owner_and_name` ON `pull_requests` (`repo_owner`,`repo_name`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_repo_active_state` ON `pull_requests` (`repo_owner`,`repo_name`,`remote_state`,`inactive_reason`);--> statement-breakpoint
CREATE UNIQUE INDEX `index_pull_requests_on_repo_and_number_unique` ON `pull_requests` (`repo_owner`,`repo_name`,`number`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_repo_filter` ON `pull_requests` (`repo_owner`,`repo_name`,`archived`,`deleted_at`,`review_status`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_remote_state` ON `pull_requests` (`remote_state`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_inactive_reason` ON `pull_requests` (`inactive_reason`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_head_sha` ON `pull_requests` (`head_sha`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_github_id` ON `pull_requests` (`github_id`);--> statement-breakpoint
CREATE INDEX `index_pull_requests_on_deleted_at` ON `pull_requests` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` numeric NOT NULL,
	`key` text,
	`updated_at` numeric NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_settings_on_key` ON `settings` (`key`);--> statement-breakpoint
CREATE TABLE `sync_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` numeric NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`deactivated_count` integer DEFAULT 0 NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_finished_at` numeric,
	`last_started_at` numeric,
	`last_succeeded_at` numeric,
	`repo_name` text,
	`repo_owner` text,
	`scope_key` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`updated_at` numeric NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_sync_states_on_scope_key` ON `sync_states` (`scope_key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` numeric NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`encrypted_password` text DEFAULT '' NOT NULL,
	`remember_created_at` numeric,
	`reset_password_sent_at` numeric,
	`reset_password_token` text,
	`role` text DEFAULT 'user' NOT NULL,
	`updated_at` numeric NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_users_on_reset_password_token` ON `users` (`reset_password_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `index_users_on_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `agent_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` numeric NOT NULL,
	`log_type` text DEFAULT 'output' NOT NULL,
	`message` text,
	`review_task_id` integer NOT NULL,
	`updated_at` numeric NOT NULL,
	FOREIGN KEY (`review_task_id`) REFERENCES `review_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `index_agent_logs_on_review_task_id` ON `agent_logs` (`review_task_id`);--> statement-breakpoint
CREATE INDEX `index_agent_logs_on_log_type` ON `agent_logs` (`log_type`);--> statement-breakpoint
CREATE INDEX `index_agent_logs_on_created_at` ON `agent_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `pull_request_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ai_summary_failure_reason` text,
	`ai_summary_files_changed` integer,
	`ai_summary_generated_at` numeric,
	`ai_summary_lines_added` integer,
	`ai_summary_lines_removed` integer,
	`ai_summary_main_changes` text,
	`ai_summary_risk_areas` text,
	`ai_summary_status` text DEFAULT 'none' NOT NULL,
	`base_sha` text NOT NULL,
	`created_at` numeric NOT NULL,
	`head_sha` text NOT NULL,
	`pull_request_id` integer NOT NULL,
	`stale_reason` text,
	`status` text DEFAULT 'current' NOT NULL,
	`synced_at` numeric,
	`updated_at` numeric NOT NULL,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `index_pull_request_snapshots_on_pull_request_id` ON `pull_request_snapshots` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `index_pr_snapshots_on_pull_request_and_status` ON `pull_request_snapshots` (`pull_request_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `index_pr_snapshots_on_pull_request_and_revision` ON `pull_request_snapshots` (`pull_request_id`,`head_sha`,`base_sha`);--> statement-breakpoint
CREATE INDEX `index_pull_request_snapshots_on_ai_summary_status` ON `pull_request_snapshots` (`ai_summary_status`);--> statement-breakpoint
CREATE TABLE `review_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`body` text NOT NULL,
	`created_at` numeric NOT NULL,
	`file_path` text NOT NULL,
	`line_number` integer,
	`resolution_note` text,
	`review_task_id` integer NOT NULL,
	`severity` text DEFAULT 'suggestion' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`title` text,
	`updated_at` numeric NOT NULL,
	FOREIGN KEY (`review_task_id`) REFERENCES `review_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `index_review_comments_on_status` ON `review_comments` (`status`);--> statement-breakpoint
CREATE INDEX `index_review_comments_on_severity` ON `review_comments` (`severity`);--> statement-breakpoint
CREATE INDEX `index_review_comments_on_review_task_id` ON `review_comments` (`review_task_id`);--> statement-breakpoint
CREATE INDEX `index_review_comments_on_review_task_id_and_file_path` ON `review_comments` (`review_task_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `index_review_comments_on_file_path` ON `review_comments` (`file_path`);--> statement-breakpoint
CREATE TABLE `review_iterations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ai_model` text,
	`cli_client` text NOT NULL,
	`completed_at` numeric,
	`created_at` numeric NOT NULL,
	`from_state` text NOT NULL,
	`iteration_number` integer DEFAULT 1 NOT NULL,
	`review_output` text,
	`review_task_id` integer NOT NULL,
	`review_type` text DEFAULT 'review' NOT NULL,
	`started_at` numeric,
	`to_state` text NOT NULL,
	`updated_at` numeric NOT NULL,
	FOREIGN KEY (`review_task_id`) REFERENCES `review_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `index_review_iterations_on_review_task_id` ON `review_iterations` (`review_task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `index_review_iterations_on_review_task_id_and_iteration_number` ON `review_iterations` (`review_task_id`,`iteration_number`);--> statement-breakpoint
CREATE INDEX `index_review_iterations_on_ai_model` ON `review_iterations` (`ai_model`);--> statement-breakpoint
CREATE TABLE `review_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ai_model` text,
	`archived` numeric DEFAULT (FALSE) NOT NULL,
	`cli_client` text DEFAULT 'claude' NOT NULL,
	`completed_at` numeric,
	`created_at` numeric NOT NULL,
	`failure_reason` text,
	`last_retry_at` numeric,
	`pull_request_id` integer NOT NULL,
	`pull_request_snapshot_id` integer,
	`queued_at` numeric,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`retry_history` text,
	`review_output` text,
	`review_type` text DEFAULT 'review' NOT NULL,
	`started_at` numeric,
	`state` text DEFAULT 'pending_review' NOT NULL,
	`submission_status` text DEFAULT 'pending_submission',
	`submitted_at` numeric,
	`submitted_event` text,
	`updated_at` numeric NOT NULL,
	`worktree_path` text,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_snapshot_id`) REFERENCES `pull_request_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_submitted_event` ON `review_tasks` (`submitted_event`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_submission_status` ON `review_tasks` (`submission_status`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_state` ON `review_tasks` (`state`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_state_and_queued_at` ON `review_tasks` (`state`,`queued_at`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_state_archived` ON `review_tasks` (`state`,`archived`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_retry_count` ON `review_tasks` (`retry_count`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_pull_request_snapshot_id` ON `review_tasks` (`pull_request_snapshot_id`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_pull_request_id` ON `review_tasks` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_pull_request_id_and_state` ON `review_tasks` (`pull_request_id`,`state`);--> statement-breakpoint
CREATE INDEX `index_review_tasks_on_ai_model` ON `review_tasks` (`ai_model`);--> statement-breakpoint
CREATE TABLE `schema_migrations` (
	`version` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ar_internal_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`created_at` numeric NOT NULL,
	`updated_at` numeric NOT NULL
);

