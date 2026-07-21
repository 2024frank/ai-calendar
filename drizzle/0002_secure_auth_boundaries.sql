ALTER TABLE `users` ADD `session_version` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `login_tokens` MODIFY COLUMN `kind` enum('magic','password_reset','invite','otp') NOT NULL;
