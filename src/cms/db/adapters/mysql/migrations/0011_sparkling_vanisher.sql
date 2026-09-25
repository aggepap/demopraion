CREATE TABLE `cms_api_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(191) NOT NULL,
	`key_id` varchar(16) NOT NULL,
	`secret_encrypted` varbinary(255) NOT NULL,
	`scopes` json NOT NULL,
	`created_by` int,
	`last_used_at` timestamp,
	`last_used_ip` varchar(64),
	`expires_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cms_api_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_cms_api_tokens_key_id` UNIQUE(`key_id`)
);
--> statement-breakpoint
CREATE TABLE `pm_head_payloads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`path` varchar(255) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`remote_type` varchar(32),
	`document_id` int,
	`head_meta` json,
	`jsonld` json,
	`alternates` json,
	`seo_override` boolean NOT NULL DEFAULT false,
	`source` varchar(32) NOT NULL DEFAULT 'pm',
	`payload_hash` varchar(64),
	`compiled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pm_head_payloads_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_pm_head_payloads_path_locale` UNIQUE(`path`,`locale`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `actor_label` varchar(191);--> statement-breakpoint
ALTER TABLE `cms_api_tokens` ADD CONSTRAINT `cms_api_tokens_created_by_admin_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_head_payloads` ADD CONSTRAINT `pm_head_payloads_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_cms_api_tokens_active` ON `cms_api_tokens` (`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_pm_head_payloads_document` ON `pm_head_payloads` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_updated_at` ON `documents` (`updated_at`);