CREATE TABLE `wishlist_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`product_id` int NOT NULL,
	`variation_id` varchar(64) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wishlist_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_wishlist_customer_item` UNIQUE(`customer_id`,`product_id`,`variation_id`)
);
--> statement-breakpoint
ALTER TABLE `wishlist_items` ADD CONSTRAINT `wishlist_items_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wishlist_items` ADD CONSTRAINT `wishlist_items_product_id_documents_id_fk` FOREIGN KEY (`product_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;