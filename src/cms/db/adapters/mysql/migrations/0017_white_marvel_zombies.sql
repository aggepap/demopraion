CREATE TABLE `integration_secrets` (
	`key` varchar(128) NOT NULL,
	`ciphertext` varbinary(4096) NOT NULL,
	`hint` varchar(8) NOT NULL DEFAULT '',
	`updated_by` int,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integration_secrets_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `stat_counters` (
	`scope` varchar(32) NOT NULL,
	`subject_id` int NOT NULL,
	`metric` varchar(32) NOT NULL,
	`day` date NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	CONSTRAINT `stat_counters_scope_subject_id_metric_day_pk` PRIMARY KEY(`scope`,`subject_id`,`metric`,`day`)
);
--> statement-breakpoint
ALTER TABLE `integration_secrets` ADD CONSTRAINT `integration_secrets_updated_by_admin_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;