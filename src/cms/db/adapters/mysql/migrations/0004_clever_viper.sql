CREATE TABLE `product_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_group_id` varchar(36) NOT NULL,
	`product_id` int,
	`product_slug` varchar(191),
	`rating` int NOT NULL,
	`author_name` varchar(191) NOT NULL,
	`email` varchar(255) NOT NULL,
	`title` varchar(191),
	`body` text NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`verified` boolean NOT NULL DEFAULT false,
	`locale` varchar(8),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `product_reviews` ADD CONSTRAINT `product_reviews_product_id_documents_id_fk` FOREIGN KEY (`product_id`) REFERENCES `documents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_reviews_group_status` ON `product_reviews` (`product_group_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reviews_status_created` ON `product_reviews` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reviews_email` ON `product_reviews` (`email`);