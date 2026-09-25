CREATE TABLE `admin_mfa_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`code_hash` varchar(255) NOT NULL,
	`purpose` varchar(24) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`consumed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_mfa_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_recovery_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`code_hash` varchar(255) NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_recovery_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admin_users` ADD `mfa_method` varchar(16);--> statement-breakpoint
ALTER TABLE `admin_users` ADD `totp_secret_encrypted` varbinary(255);--> statement-breakpoint
ALTER TABLE `admin_users` ADD `mfa_enrolled_at` timestamp;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `totp_last_step` int;--> statement-breakpoint
ALTER TABLE `admin_mfa_codes` ADD CONSTRAINT `admin_mfa_codes_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_recovery_codes` ADD CONSTRAINT `admin_recovery_codes_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_admin_mfa_codes_user` ON `admin_mfa_codes` (`user_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `idx_admin_recovery_codes_user` ON `admin_recovery_codes` (`user_id`);