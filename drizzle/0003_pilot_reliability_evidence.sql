CREATE TABLE `evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`community_id` int NOT NULL,
	`source_id` int NOT NULL,
	`created_by` int,
	`creator` json NOT NULL,
	`title` varchar(200) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`period_start` timestamp NOT NULL,
	`period_end` timestamp NOT NULL,
	`provenance` json NOT NULL,
	`snapshot` json NOT NULL,
	`confirmed_matches` json NOT NULL,
	`report` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evaluations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `events` ADD `correction_request` text;--> statement-breakpoint
ALTER TABLE `events` ADD `correction_state` enum('requested','running','failed','completed');--> statement-breakpoint
ALTER TABLE `events` ADD `correction_error` text;--> statement-breakpoint
ALTER TABLE `events` ADD `correction_requested_at` timestamp;--> statement-breakpoint
ALTER TABLE `events` ADD `correction_lease_token` varchar(36);--> statement-breakpoint
ALTER TABLE `events` ADD `proposed_update_of_event_id` int;--> statement-breakpoint
ALTER TABLE `events` ADD `proposal_resolved_at` timestamp;--> statement-breakpoint
ALTER TABLE `publish_submissions` ADD `operation` enum('create','update') DEFAULT 'create' NOT NULL;--> statement-breakpoint
ALTER TABLE `publish_submissions` ADD `destination_submit_url` text;--> statement-breakpoint
ALTER TABLE `evaluations` ADD CONSTRAINT `evaluations_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evaluations` ADD CONSTRAINT `evaluations_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evaluations` ADD CONSTRAINT `evaluations_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_evaluations_community` ON `evaluations` (`community_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_evaluations_source` ON `evaluations` (`source_id`);--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_proposed_update_of_event_id_events_id_fk` FOREIGN KEY (`proposed_update_of_event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_events_proposal` ON `events` (`proposed_update_of_event_id`,`proposal_resolved_at`);