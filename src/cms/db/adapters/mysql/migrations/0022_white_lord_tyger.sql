CREATE TABLE `gift_card_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gift_card_id` int NOT NULL,
	`type` enum('issue','redeem','reversal','refund_credit','void','adjust','expire') NOT NULL,
	`amount` int NOT NULL,
	`balance_after` int NOT NULL,
	`order_id` int,
	`payment_id` int,
	`actor` varchar(191),
	`note` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gift_card_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gift_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`code_last4` varchar(8) NOT NULL DEFAULT '',
	`code_encrypted` varbinary(512),
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`initial_amount` int NOT NULL,
	`balance` int NOT NULL,
	`status` enum('scheduled','active','void','expired') NOT NULL DEFAULT 'scheduled',
	`expires_at` timestamp,
	`order_id` int,
	`order_item_id` int,
	`purchaser_email` varchar(255),
	`recipient_name` varchar(191),
	`recipient_email` varchar(255),
	`message` text,
	`send_at` timestamp,
	`sent_at` timestamp,
	`issued_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gift_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_gift_cards_code_hash` UNIQUE(`code_hash`),
	CONSTRAINT `uniq_gift_cards_order_item` UNIQUE(`order_item_id`)
);
--> statement-breakpoint
ALTER TABLE `gift_card_transactions` ADD CONSTRAINT `gift_card_transactions_gift_card_id_gift_cards_id_fk` FOREIGN KEY (`gift_card_id`) REFERENCES `gift_cards`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gift_card_transactions` ADD CONSTRAINT `gift_card_transactions_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gift_card_transactions` ADD CONSTRAINT `gift_card_transactions_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_issued_by_admin_users_id_fk` FOREIGN KEY (`issued_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_gift_card_tx_card` ON `gift_card_transactions` (`gift_card_id`);--> statement-breakpoint
CREATE INDEX `idx_gift_cards_status_send` ON `gift_cards` (`status`,`send_at`);