CREATE TABLE `shipments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`courier` enum('acs','speedex','elta','boxnow','pickup','custom') NOT NULL,
	`voucher` varchar(64) NOT NULL,
	`tracking_url` varchar(500),
	`external_id` varchar(191),
	`status` varchar(40) NOT NULL DEFAULT 'created',
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shipments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_shipments_courier_voucher` UNIQUE(`courier`,`voucher`)
);
--> statement-breakpoint
CREATE TABLE `shipping_methods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zone_id` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`courier` enum('acs','speedex','elta','boxnow','pickup','custom') NOT NULL DEFAULT 'custom',
	`kind` enum('address','locker','pickup') NOT NULL DEFAULT 'address',
	`cost` int NOT NULL DEFAULT 0,
	`free_threshold` int,
	`weight_tiers` json,
	`eta_min_days` int,
	`eta_max_days` int,
	`cod_allowed` boolean NOT NULL DEFAULT true,
	`pickup_location_id` varchar(64),
	`active` boolean NOT NULL DEFAULT true,
	`sort` int NOT NULL DEFAULT 0,
	CONSTRAINT `shipping_methods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shipping_zones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`countries` json NOT NULL,
	`sort` int NOT NULL DEFAULT 0,
	CONSTRAINT `shipping_zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_shipping_zones_name` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_method_id` int;--> statement-breakpoint
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_created_by_admin_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipping_methods` ADD CONSTRAINT `shipping_methods_zone_id_shipping_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `shipping_zones`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_shipments_order` ON `shipments` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_shipping_methods_zone` ON `shipping_methods` (`zone_id`);