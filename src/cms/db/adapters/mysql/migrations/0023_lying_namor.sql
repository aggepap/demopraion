CREATE TABLE `script_snippets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`code` mediumtext,
	`src` varchar(2048),
	`lazy` boolean NOT NULL DEFAULT false,
	`consent_category` varchar(64),
	`enabled` boolean NOT NULL DEFAULT true,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `script_snippets_id` PRIMARY KEY(`id`),
	CONSTRAINT `script_snippets_slug_unique` UNIQUE(`slug`)
);
