CREATE TABLE `editing_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`resource_type` varchar(32) NOT NULL,
	`resource_key` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`user_name` varchar(191) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`connection_id` varchar(36) NOT NULL,
	`acquired_at` timestamp NOT NULL DEFAULT (now()),
	`heartbeat_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `editing_locks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_editing_locks_resource` UNIQUE(`resource_type`,`resource_key`)
);
--> statement-breakpoint
ALTER TABLE `editing_locks` ADD CONSTRAINT `editing_locks_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_editing_locks_expires_at` ON `editing_locks` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_editing_locks_connection` ON `editing_locks` (`connection_id`);