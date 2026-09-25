CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`product_id` int,
	`sku` varchar(64),
	`name` varchar(255) NOT NULL,
	`variant_label` varchar(191),
	`unit_price` int NOT NULL DEFAULT 0,
	`quantity` int NOT NULL DEFAULT 1,
	`line_total` int NOT NULL DEFAULT 0,
	`snapshot` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(32) NOT NULL,
	`status` enum('pending','paid','fulfilled','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`email` varchar(255) NOT NULL,
	`customer_name` varchar(191),
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`subtotal` int NOT NULL DEFAULT 0,
	`total` int NOT NULL DEFAULT 0,
	`locale` varchar(8),
	`notes` text,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`provider` varchar(32) NOT NULL,
	`provider_ref` varchar(191),
	`status` enum('pending','authorized','captured','failed','refunded') NOT NULL DEFAULT 'pending',
	`amount` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`method` varchar(32),
	`error` text,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_documents_id_fk` FOREIGN KEY (`product_id`) REFERENCES `documents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_status_created` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_email` ON `orders` (`email`);--> statement-breakpoint
CREATE INDEX `idx_payments_order` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_provider_ref` ON `payments` (`provider`,`provider_ref`);