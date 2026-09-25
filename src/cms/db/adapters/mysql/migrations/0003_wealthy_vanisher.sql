CREATE TABLE `cookie_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(64) NOT NULL,
	`name` json NOT NULL,
	`description` json,
	`required` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cookie_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `cookie_categories_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `cookie_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_id` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`provider` varchar(128),
	`purpose` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cookie_services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `cookie_services` ADD CONSTRAINT `cookie_services_category_id_cookie_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `cookie_categories`(`id`) ON DELETE cascade ON UPDATE no action;