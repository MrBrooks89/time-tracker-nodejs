CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text,
	`old_value` text,
	`new_value` text,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `correction_log` (
	`id` text PRIMARY KEY NOT NULL,
	`time_entry_id` text NOT NULL,
	`timesheet_id` text NOT NULL,
	`corrected_by` text NOT NULL,
	`reason` text NOT NULL,
	`original_value` text,
	`new_value` text,
	`corrected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`timesheet_id`) REFERENCES `timesheet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`corrected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `correction_log_time_entry_id_idx` ON `correction_log` (`time_entry_id`);--> statement-breakpoint
CREATE INDEX `correction_log_timesheet_id_idx` ON `correction_log` (`timesheet_id`);--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start_date` text NOT NULL,
	`reminded_by` text NOT NULL,
	`reminded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reminded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminder_log_user_week_idx` ON `reminder_log` (`user_id`,`week_start_date`);--> statement-breakpoint
ALTER TABLE `period_close` ADD `restated_at` integer;--> statement-breakpoint
ALTER TABLE `time_entry` ADD `entered_by` text REFERENCES user(id);