CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `distribution_log` (
	`id` text PRIMARY KEY NOT NULL,
	`close_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`recipient_role` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`close_id`) REFERENCES `period_close`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `distribution_log_close_id_idx` ON `distribution_log` (`close_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reminder_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start_date` text NOT NULL,
	`reminded_by` text,
	`reminded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`note` text,
	`channel` text DEFAULT 'in_app' NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`recipient` text,
	`trigger` text DEFAULT 'manual' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reminded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_reminder_log`("id", "user_id", "week_start_date", "reminded_by", "reminded_at", "note", "channel", "status", "recipient", "trigger") SELECT "id", "user_id", "week_start_date", "reminded_by", "reminded_at", "note", 'in_app', 'sent', NULL, 'manual' FROM `reminder_log`;--> statement-breakpoint
DROP TABLE `reminder_log`;--> statement-breakpoint
ALTER TABLE `__new_reminder_log` RENAME TO `reminder_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reminder_log_user_week_idx` ON `reminder_log` (`user_id`,`week_start_date`);