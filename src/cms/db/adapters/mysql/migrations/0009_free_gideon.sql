DROP INDEX `idx_payments_provider_ref` ON `payments`;--> statement-breakpoint
DROP INDEX `idx_reservation_payments_provider_ref` ON `reservation_payments`;--> statement-breakpoint
ALTER TABLE `order_items` ADD `variation_id` varchar(64);--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `uniq_payments_provider_ref` UNIQUE(`provider`,`provider_ref`);--> statement-breakpoint
ALTER TABLE `reservation_payments` ADD CONSTRAINT `uniq_reservation_payments_provider_ref` UNIQUE(`provider`,`provider_ref`);