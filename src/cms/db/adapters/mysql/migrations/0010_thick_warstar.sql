ALTER TABLE `reservations` ADD `end_date` date;--> statement-breakpoint
ALTER TABLE `reservations` ADD `nights` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `adults` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `children` int DEFAULT 0 NOT NULL;