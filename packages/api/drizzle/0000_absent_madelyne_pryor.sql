-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`url` text NOT NULL,
	`title` text,
	`status` text NOT NULL,
	`current_stage` text,
	`session_path` text,
	`final_video_path` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `task_stages` (
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`last_message` text,
	`error_message` text,
	`progress` integer,
	PRIMARY KEY(`task_id`, `name`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);

*/