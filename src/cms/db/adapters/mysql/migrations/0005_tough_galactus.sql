CREATE TABLE `abandoned_carts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`items` json NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`locale` varchar(8),
	`subtotal` int NOT NULL DEFAULT 0,
	`status` enum('pending','reminded','converted') NOT NULL DEFAULT 'pending',
	`reminder_sent_at` timestamp,
	`recovered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `abandoned_carts_id` PRIMARY KEY(`id`),
	CONSTRAINT `abandoned_carts_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `idx_abandoned_status_created` ON `abandoned_carts` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_abandoned_email` ON `abandoned_carts` (`email`);