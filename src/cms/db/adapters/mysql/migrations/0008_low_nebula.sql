CREATE TABLE `booking_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slot_key` varchar(80) NOT NULL,
	`slot_date` date NOT NULL,
	`capacity` int,
	`closed` boolean NOT NULL DEFAULT false,
	`price_override` int,
	`note` varchar(191),
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `booking_slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_booking_slots_key_date` UNIQUE(`slot_key`,`slot_date`)
);
--> statement-breakpoint
CREATE TABLE `reservation_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reservation_id` int NOT NULL,
	`kind` varchar(48) NOT NULL,
	`from_status` enum('pending','awaiting_payment','confirmed','paid','cancelled','expired'),
	`to_status` enum('pending','awaiting_payment','confirmed','paid','cancelled','expired'),
	`actor_user_id` int,
	`recipient` varchar(255),
	`email_status` enum('pending','sent','failed','skipped'),
	`email_error` text,
	`detail` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservation_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservation_holds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reservation_id` int NOT NULL,
	`slot_key` varchar(80) NOT NULL,
	`slot_date` date NOT NULL,
	`seats` int NOT NULL DEFAULT 1,
	`state` enum('held','confirmed','released') NOT NULL DEFAULT 'held',
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reservation_holds_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_reservation_holds_res_slot` UNIQUE(`reservation_id`,`slot_key`,`slot_date`)
);
--> statement-breakpoint
CREATE TABLE `reservation_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reservation_id` int NOT NULL,
	`kind` enum('base','person','resource','extra','surcharge','discount') NOT NULL,
	`code` varchar(64) NOT NULL,
	`label` varchar(255) NOT NULL,
	`ref_id` varchar(64),
	`quantity` int NOT NULL DEFAULT 1,
	`unit_amount` int NOT NULL DEFAULT 0,
	`amount` int NOT NULL DEFAULT 0,
	`position` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservation_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservation_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reservation_id` int NOT NULL,
	`provider` varchar(32) NOT NULL,
	`provider_ref` varchar(191),
	`status` enum('pending','authorized','captured','failed','refunded') NOT NULL DEFAULT 'pending',
	`amount` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`method` varchar(32),
	`is_deposit` boolean NOT NULL DEFAULT false,
	`error` text,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reservation_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(32) NOT NULL,
	`status` enum('pending','awaiting_payment','confirmed','paid','cancelled','expired') NOT NULL DEFAULT 'pending',
	`mode` enum('request','instant') NOT NULL DEFAULT 'request',
	`allocation_mode` enum('shared','exclusive','resource') NOT NULL DEFAULT 'shared',
	`booking_id` int,
	`booking_group_id` varchar(64) NOT NULL,
	`booking_slug` varchar(191),
	`booking_title` varchar(255) NOT NULL,
	`resource_id` int,
	`resource_group_id` varchar(64) NOT NULL DEFAULT '',
	`resource_label` varchar(191),
	`slot_date` date NOT NULL,
	`slot_label` varchar(64),
	`persons` int NOT NULL DEFAULT 1,
	`email` varchar(255) NOT NULL,
	`customer_name` varchar(191),
	`phone` varchar(64),
	`locale` varchar(8),
	`notes` text,
	`admin_notes` text,
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`subtotal` int NOT NULL DEFAULT 0,
	`total` int NOT NULL DEFAULT 0,
	`deposit_amount` int NOT NULL DEFAULT 0,
	`amount_paid` int NOT NULL DEFAULT 0,
	`pricing_snapshot` json,
	`selections` json,
	`metadata` json,
	`payment_token_hash` varchar(64),
	`payment_token_expires_at` timestamp,
	`payment_link_sent_at` timestamp,
	`expires_at` timestamp,
	`email_status` enum('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
	`email_error` text,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservations_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
ALTER TABLE `reservation_events` ADD CONSTRAINT `reservation_events_reservation_id_reservations_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_holds` ADD CONSTRAINT `reservation_holds_reservation_id_reservations_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_items` ADD CONSTRAINT `reservation_items_reservation_id_reservations_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_payments` ADD CONSTRAINT `reservation_payments_reservation_id_reservations_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_booking_id_documents_id_fk` FOREIGN KEY (`booking_id`) REFERENCES `documents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_resource_id_documents_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `documents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_booking_slots_date` ON `booking_slots` (`slot_date`);--> statement-breakpoint
CREATE INDEX `idx_reservation_events_reservation` ON `reservation_events` (`reservation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reservation_holds_slot` ON `reservation_holds` (`slot_key`,`slot_date`,`state`);--> statement-breakpoint
CREATE INDEX `idx_reservation_holds_reservation` ON `reservation_holds` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `idx_reservation_items_reservation` ON `reservation_items` (`reservation_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_reservation_payments_reservation` ON `reservation_payments` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `idx_reservation_payments_provider_ref` ON `reservation_payments` (`provider`,`provider_ref`);--> statement-breakpoint
CREATE INDEX `idx_reservations_status_date` ON `reservations` (`status`,`slot_date`);--> statement-breakpoint
CREATE INDEX `idx_reservations_booking_date` ON `reservations` (`booking_group_id`,`slot_date`);--> statement-breakpoint
CREATE INDEX `idx_reservations_resource_date` ON `reservations` (`resource_group_id`,`slot_date`);--> statement-breakpoint
CREATE INDEX `idx_reservations_email` ON `reservations` (`email`);--> statement-breakpoint
CREATE INDEX `idx_reservations_status_expires` ON `reservations` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_reservations_created` ON `reservations` (`created_at`);