CREATE TABLE `activity_log` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`actor_user_id` int,
	`actor_email` varchar(320),
	`action` varchar(40) NOT NULL,
	`target_type` varchar(40),
	`target_id` int,
	`summary` varchar(300),
	`detail` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `learnings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int,
	`source_id` int,
	`event_id` int,
	`trigger_kind` enum('rejection','edit') NOT NULL,
	`field_name` varchar(60),
	`before_value` text,
	`after_value` text,
	`reason` text,
	`lesson` text NOT NULL,
	`scope` enum('source','community','global') NOT NULL DEFAULT 'source',
	`status` enum('active','retired') NOT NULL DEFAULT 'active',
	`times_served` int NOT NULL DEFAULT 0,
	`reviewer_id` int,
	`model` varchar(80),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `learnings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `communities` MODIFY COLUMN `default_mode` enum('needs_approval','auto_send','auto_publish','restricted','unrestricted') NOT NULL DEFAULT 'restricted';--> statement-breakpoint
ALTER TABLE `events` MODIFY COLUMN `status` enum('pending','approved','submitted','rejected','duplicate','auto_rejected','published') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `runs` MODIFY COLUMN `run_kind` enum('extraction','discovery','correction','learning') NOT NULL DEFAULT 'extraction';--> statement-breakpoint
ALTER TABLE `sources` MODIFY COLUMN `mode` enum('needs_approval','auto_send','auto_publish','restricted','unrestricted');--> statement-breakpoint
ALTER TABLE `events` ADD `corrected_at` timestamp;--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_activity_created` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_learn_source` ON `learnings` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_learn_community` ON `learnings` (`community_id`);--> statement-breakpoint
CREATE INDEX `idx_learn_status` ON `learnings` (`status`);