CREATE TABLE `cookie_consents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitor_ref` varchar(64) NOT NULL,
	`decision` varchar(16) NOT NULL,
	`categories` json NOT NULL,
	`policy_version` varchar(64),
	`locale` varchar(8),
	`ua` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cookie_consents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cookie_consents_visitor` ON `cookie_consents` (`visitor_ref`);--> statement-breakpoint
CREATE INDEX `idx_cookie_consents_created` ON `cookie_consents` (`created_at`);