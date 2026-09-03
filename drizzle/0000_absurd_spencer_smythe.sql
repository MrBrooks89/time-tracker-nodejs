CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`issuer` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assignment_change` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`changed_by` text NOT NULL,
	`change_type` text NOT NULL,
	`changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `classification_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`task_code_id` text NOT NULL,
	`classification` text NOT NULL,
	`effective_from` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`task_code_id`) REFERENCES `task_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classification_rule_task_code_id_idx` ON `classification_rule` (`task_code_id`);--> statement-breakpoint
CREATE TABLE `favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`task_code_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_code_id`) REFERENCES `task_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorite_user_project_task_idx` ON `favorite` (`user_id`,`project_id`,`task_code_id`);--> statement-breakpoint
CREATE TABLE `fiscal_period` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year` integer NOT NULL,
	`quarter` integer NOT NULL,
	`period_number` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`week_count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_period_year_period_idx` ON `fiscal_period` (`fiscal_year`,`period_number`);--> statement-breakpoint
CREATE TABLE `holiday` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`observed_date` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holiday_observed_date_unique` ON `holiday` (`observed_date`);--> statement-breakpoint
CREATE TABLE `non_project_category` (
	`id` text PRIMARY KEY NOT NULL,
	`group` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `non_project_category_name_unique` ON `non_project_category` (`name`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`number` integer NOT NULL,
	`description` text,
	`project_manager_id` text,
	`cost_type` text DEFAULT 'operating' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_manager_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_name_unique` ON `project` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_unique` ON `project` (`number`);--> statement-breakpoint
CREATE TABLE `project_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`assigned_by` text,
	`assigned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_assignment_active_unique_idx` ON `project_assignment` (`user_id`,`project_id`) WHERE removed_at IS NULL;--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `task_code` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_code_name_unique` ON `task_code` (`name`);--> statement-breakpoint
CREATE TABLE `time_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`timesheet_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`hours` real NOT NULL,
	`project_id` text,
	`task_code_id` text,
	`non_project_category_id` text,
	`is_hands_on` integer DEFAULT 0 NOT NULL,
	`resolved_classification` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`timesheet_id`) REFERENCES `timesheet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_code_id`) REFERENCES `task_code`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`non_project_category_id`) REFERENCES `non_project_category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entry_timesheet_id_idx` ON `time_entry` (`timesheet_id`);--> statement-breakpoint
CREATE INDEX `time_entry_entry_date_idx` ON `time_entry` (`entry_date`);--> statement-breakpoint
CREATE TABLE `timesheet` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start_date` text NOT NULL,
	`state` text DEFAULT 'not_started' NOT NULL,
	`submitted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timesheet_user_week_idx` ON `timesheet` (`user_id`,`week_start_date`);--> statement-breakpoint
CREATE INDEX `timesheet_week_start_date_idx` ON `timesheet` (`week_start_date`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT 0 NOT NULL,
	`image` text,
	`role` text DEFAULT 'employee' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`partner_code` text,
	`title` text,
	`team` text,
	`employment_type` text DEFAULT 'full_time' NOT NULL,
	`standard_weekly_hours` real DEFAULT 40 NOT NULL,
	`manager_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`manager_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
