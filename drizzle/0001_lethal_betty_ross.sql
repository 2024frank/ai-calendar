CREATE TABLE `app_settings` (
	`key` varchar(80) NOT NULL,
	`value` text,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`run_id` int NOT NULL,
	`kind` enum('extract_source') NOT NULL,
	`status` enum('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
	`dedupe_key` varchar(191),
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 2,
	`available_at` timestamp(3) NOT NULL DEFAULT (now()),
	`locked_at` timestamp(3),
	`locked_by` varchar(120),
	`last_error` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_run_id_unique` UNIQUE(`run_id`),
	CONSTRAINT `jobs_dedupe_key_unique` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`key_hash` varchar(64) NOT NULL,
	`window_started_at_ms` bigint NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`expires_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rate_limit_buckets_key_hash` PRIMARY KEY(`key_hash`)
);
--> statement-breakpoint
CREATE TABLE `user_communities` (
	`user_id` int NOT NULL,
	`community_id` int NOT NULL,
	CONSTRAINT `user_communities_user_id_community_id_pk` PRIMARY KEY(`user_id`,`community_id`)
);
--> statement-breakpoint
ALTER TABLE `run_state` MODIFY COLUMN `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `events` ADD `place_name` varchar(200);--> statement-breakpoint
ALTER TABLE `events` ADD `room_num` varchar(120);--> statement-breakpoint
ALTER TABLE `events` ADD `geo_scope` varchar(20);--> statement-breakpoint
ALTER TABLE `events` ADD `image_data` text;--> statement-breakpoint
ALTER TABLE `events` ADD `ingested_post_url` varchar(2048);--> statement-breakpoint
ALTER TABLE `events` ADD `duplicate_of_url` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `cost_micros` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `model` varchar(80);--> statement-breakpoint
ALTER TABLE `sources` ADD `lookahead_days` int;--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `must_set_password` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_communities` ADD CONSTRAINT `user_communities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_communities` ADD CONSTRAINT `user_communities_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_jobs_available` ON `jobs` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_stale` ON `jobs` (`status`,`locked_at`);--> statement-breakpoint
CREATE INDEX `idx_rate_limit_expiry` ON `rate_limit_buckets` (`expires_at`);