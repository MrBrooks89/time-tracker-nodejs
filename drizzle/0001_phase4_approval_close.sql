CREATE TABLE `period_close` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year` integer NOT NULL,
	`period_number` integer NOT NULL,
	`correction_window_ends_at` integer,
	`closed_at` integer,
	`closed_by` text,
	FOREIGN KEY (`closed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `period_close_year_period_idx` ON `period_close` (`fiscal_year`,`period_number`);--> statement-breakpoint
CREATE TABLE `timesheet_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`timesheet_id` text NOT NULL,
	`decision` text NOT NULL,
	`decided_by` text NOT NULL,
	`note` text,
	`decided_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`timesheet_id`) REFERENCES `timesheet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `timesheet_decision_timesheet_id_idx` ON `timesheet_decision` (`timesheet_id`);--> statement-breakpoint
ALTER TABLE `timesheet` ADD `approved_at` integer;--> statement-breakpoint
ALTER TABLE `timesheet` ADD `approved_by` text REFERENCES user(id);
