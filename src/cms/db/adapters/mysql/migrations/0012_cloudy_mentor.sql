CREATE TABLE `email_suppressions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`reason` enum('unsubscribe','bounce','complaint','manual') NOT NULL DEFAULT 'unsubscribe',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_suppressions_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_suppressions_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `idx_email_suppressions_reason` ON `email_suppressions` (`reason`);