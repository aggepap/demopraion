CREATE TABLE `customer_addresses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`label` varchar(60),
	`name` varchar(191),
	`phone` varchar(40),
	`address1` varchar(255),
	`address2` varchar(255),
	`city` varchar(120),
	`postal` varchar(20),
	`country` varchar(2),
	`is_default_shipping` boolean NOT NULL DEFAULT false,
	`is_default_billing` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_addresses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`purpose` enum('verify_email','reset_password') NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_customer_tokens_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(191) NOT NULL,
	`name` varchar(191),
	`phone` varchar(40),
	`locale` varchar(10) NOT NULL DEFAULT 'el',
	`password_hash` varchar(255),
	`email_verified_at` timestamp,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`token_version` int NOT NULL DEFAULT 1,
	`marketing_opt_in` boolean NOT NULL DEFAULT false,
	`last_login_at` timestamp,
	`deleted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_customers_email` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` int;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tokens` ADD CONSTRAINT `customer_tokens_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_customer_addresses_customer` ON `customer_addresses` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_tokens_customer` ON `customer_tokens` (`customer_id`,`purpose`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_orders_customer` ON `orders` (`customer_id`);