CREATE TABLE `communities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(80) NOT NULL,
	`name` varchar(200) NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'America/New_York',
	`default_mode` enum('restricted','unrestricted') NOT NULL DEFAULT 'restricted',
	`default_destination_id` int,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `communities_id` PRIMARY KEY(`id`),
	CONSTRAINT `communities_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `destinations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`type` enum('ai_calendar','communityhub','webhook','ical') NOT NULL,
	`config` json NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `destinations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_identities` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`global_key` varchar(64) NOT NULL,
	`canonical_title` varchar(255),
	`first_seen_at` timestamp NOT NULL DEFAULT (now()),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`occurrence_count` int NOT NULL DEFAULT 0,
	CONSTRAINT `event_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_identities_global_key_unique` UNIQUE(`global_key`)
);
--> statement-breakpoint
CREATE TABLE `event_identity_links` (
	`identity_id` bigint NOT NULL,
	`event_id` int NOT NULL,
	`community_id` int NOT NULL,
	`source_id` int NOT NULL,
	CONSTRAINT `event_identity_links_identity_id_event_id_pk` PRIMARY KEY(`identity_id`,`event_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int NOT NULL,
	`source_id` int,
	`status` enum('pending','approved','submitted','rejected','duplicate','auto_rejected') NOT NULL DEFAULT 'pending',
	`event_type` varchar(2),
	`title` varchar(200),
	`description` text,
	`extended_description` text,
	`sessions` json,
	`start_time_max` int,
	`location_type` varchar(8),
	`location` text,
	`url_link` varchar(2048),
	`display_type` varchar(8),
	`post_type_ids` json,
	`screens_ids` json,
	`sponsors` json,
	`buttons` json,
	`image_cdn_url` varchar(2048),
	`website` varchar(2048),
	`registration_url` varchar(2048),
	`contact_email` varchar(320),
	`phone` varchar(64),
	`calendar_source_name` varchar(200),
	`calendar_source_url` varchar(2048),
	`field_notes` json,
	`dedup_key` varchar(64),
	`provenance` enum('direct','original_org','aggregator'),
	`published_via` enum('reviewer','auto'),
	`duplicate_of_event_id` int,
	`rejection_reason` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `field_edit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int,
	`source_id` int,
	`field_name` varchar(60) NOT NULL,
	`old_value` text,
	`new_value` text,
	`reviewer_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `field_edit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`kind` enum('magic','otp') NOT NULL,
	`token_hash` varchar(128) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `publish_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`destination_id` int NOT NULL,
	`payload_hash` varchar(64) NOT NULL,
	`state` enum('prepared','sending','succeeded','failed','accepted_unreconciled') NOT NULL DEFAULT 'prepared',
	`external_post_id` varchar(120),
	`payload` json,
	`error` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `publish_submissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_submission` UNIQUE(`event_id`,`destination_id`,`payload_hash`)
);
--> statement-breakpoint
CREATE TABLE `rejection_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int,
	`source_id` int,
	`reason_code` varchar(64),
	`note` text,
	`reviewer_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rejection_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reviewer_sources` (
	`user_id` int NOT NULL,
	`source_id` int NOT NULL,
	CONSTRAINT `reviewer_sources_user_id_source_id_pk` PRIMARY KEY(`user_id`,`source_id`)
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`run_id` int NOT NULL,
	`seq` int NOT NULL,
	`ts` timestamp(3) NOT NULL DEFAULT (now()),
	`kind` varchar(40) NOT NULL,
	`label` varchar(255),
	`data` json,
	CONSTRAINT `run_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_run_seq` UNIQUE(`run_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `run_state` (
	`run_id` int NOT NULL,
	`phase` varchar(24) NOT NULL DEFAULT 'browsing',
	`iteration` int NOT NULL DEFAULT 0,
	`repair_attempts` int NOT NULL DEFAULT 0,
	`messages_json` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `run_state_run_id` PRIMARY KEY(`run_id`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int,
	`source_id` int,
	`run_kind` enum('extraction','discovery') NOT NULL DEFAULT 'extraction',
	`status` enum('running','completed','failed','stopped') NOT NULL DEFAULT 'running',
	`control` enum('run','pause','stop') NOT NULL DEFAULT 'run',
	`phase` varchar(24),
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp,
	`deadline_at` timestamp(3),
	`budget_total` int,
	`prompt_tokens` int NOT NULL DEFAULT 0,
	`completion_tokens` int NOT NULL DEFAULT 0,
	`events_found` int NOT NULL DEFAULT 0,
	`events_extracted` int NOT NULL DEFAULT 0,
	`events_duplicate` int NOT NULL DEFAULT 0,
	`events_invalid` int NOT NULL DEFAULT 0,
	`events_published` int NOT NULL DEFAULT 0,
	`error_log` json,
	`schedule_slot` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `source_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_id` int NOT NULL,
	`community_id` int NOT NULL,
	`field_name` varchar(60) NOT NULL,
	`preferred_value` varchar(255) NOT NULL,
	`canonical_value` varchar(255) NOT NULL,
	`support_count` int NOT NULL DEFAULT 0,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`origin` enum('promoted','manual') NOT NULL DEFAULT 'promoted',
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `source_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_source_rule` UNIQUE(`source_id`,`field_name`)
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`source_type` enum('web','email') NOT NULL DEFAULT 'web',
	`source_kind` enum('original_org','aggregator') NOT NULL DEFAULT 'original_org',
	`url` varchar(2048),
	`special_instructions` text,
	`mode` enum('restricted','unrestricted'),
	`destination_id` int,
	`discovery_status` enum('pending','discovering','ready','failed','stale') NOT NULL DEFAULT 'pending',
	`extraction_recipe` json,
	`start_urls` json,
	`schedule_cron` varchar(120),
	`active` boolean NOT NULL DEFAULT true,
	`discovery_error` text,
	`recipe_updated_at` timestamp,
	`org_name` varchar(200),
	`org_website` varchar(2048),
	`org_phone` varchar(64),
	`org_contact_email` varchar(320),
	`calendar_source_name` varchar(200),
	`calendar_source_url` varchar(2048),
	`legacy_agent_id` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sources_community_slug` UNIQUE(`community_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int,
	`role` enum('platform_admin','community_admin','reviewer') NOT NULL DEFAULT 'reviewer',
	`email` varchar(320) NOT NULL,
	`name` varchar(200),
	`can_review_all_sources` boolean NOT NULL DEFAULT false,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `destinations` ADD CONSTRAINT `destinations_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_identity_links` ADD CONSTRAINT `event_identity_links_identity_id_event_identities_id_fk` FOREIGN KEY (`identity_id`) REFERENCES `event_identities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_identity_links` ADD CONSTRAINT `event_identity_links_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_duplicate_of_event_id_events_id_fk` FOREIGN KEY (`duplicate_of_event_id`) REFERENCES `events`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_edit_log` ADD CONSTRAINT `field_edit_log_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_edit_log` ADD CONSTRAINT `field_edit_log_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_edit_log` ADD CONSTRAINT `field_edit_log_reviewer_id_users_id_fk` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `login_tokens` ADD CONSTRAINT `login_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publish_submissions` ADD CONSTRAINT `publish_submissions_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publish_submissions` ADD CONSTRAINT `publish_submissions_destination_id_destinations_id_fk` FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rejection_log` ADD CONSTRAINT `rejection_log_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rejection_log` ADD CONSTRAINT `rejection_log_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rejection_log` ADD CONSTRAINT `rejection_log_reviewer_id_users_id_fk` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviewer_sources` ADD CONSTRAINT `reviewer_sources_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviewer_sources` ADD CONSTRAINT `reviewer_sources_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `run_events` ADD CONSTRAINT `run_events_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `run_state` ADD CONSTRAINT `run_state_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runs` ADD CONSTRAINT `runs_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runs` ADD CONSTRAINT `runs_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_rules` ADD CONSTRAINT `source_rules_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_rules` ADD CONSTRAINT `source_rules_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_rules` ADD CONSTRAINT `source_rules_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sources` ADD CONSTRAINT `sources_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sources` ADD CONSTRAINT `sources_destination_id_destinations_id_fk` FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_dest_community` ON `destinations` (`community_id`);--> statement-breakpoint
CREATE INDEX `idx_identity_link_event` ON `event_identity_links` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_events_community_dedup` ON `events` (`community_id`,`dedup_key`);--> statement-breakpoint
CREATE INDEX `idx_events_source` ON `events` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_events_status` ON `events` (`status`);--> statement-breakpoint
CREATE INDEX `idx_events_expiry` ON `events` (`status`,`start_time_max`);--> statement-breakpoint
CREATE INDEX `idx_field_edit_source` ON `field_edit_log` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_login_tokens_hash` ON `login_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_rejection_source` ON `rejection_log` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_run_tail` ON `run_events` (`run_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_runs_source` ON `runs` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_status` ON `runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sources_community` ON `sources` (`community_id`);--> statement-breakpoint
CREATE INDEX `idx_users_community` ON `users` (`community_id`);