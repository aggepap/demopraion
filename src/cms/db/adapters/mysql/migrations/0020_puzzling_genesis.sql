CREATE TABLE `review_locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`label` varchar(191) NOT NULL,
	`source` enum('gbp','places') NOT NULL DEFAULT 'places',
	`place_id` varchar(191),
	`resource_name` varchar(191),
	`enabled` boolean NOT NULL DEFAULT true,
	`last_synced_at` timestamp,
	`last_error` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `review_locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_review_locations_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `reviews_external` (
	`id` int AUTO_INCREMENT NOT NULL,
	`location_id` int NOT NULL,
	`source` enum('gbp','places') NOT NULL,
	`external_id` varchar(191) NOT NULL,
	`author_name` varchar(191) NOT NULL DEFAULT '',
	`photo_media_id` varchar(64),
	`rating` tinyint NOT NULL,
	`text` text,
	`published_at` timestamp NOT NULL,
	`owner_reply` text,
	`owner_reply_at` timestamp,
	`hidden` boolean NOT NULL DEFAULT false,
	`synced_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reviews_external_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_reviews_external_location_external` UNIQUE(`location_id`,`external_id`)
);
--> statement-breakpoint
ALTER TABLE `reviews_external` ADD CONSTRAINT `reviews_external_location_id_review_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `review_locations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_reviews_external_published` ON `reviews_external` (`published_at`);