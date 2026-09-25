CREATE TABLE `admin_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`permissions` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_roles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `admin_user_roles` (
	`user_id` int NOT NULL,
	`role_id` int NOT NULL,
	CONSTRAINT `admin_user_roles_user_id_role_id_pk` PRIMARY KEY(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(191) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`locale` varchar(8) NOT NULL DEFAULT 'el',
	`last_login_at` timestamp,
	`disabled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`action` varchar(64) NOT NULL,
	`subject_type` varchar(64),
	`subject_id` varchar(64),
	`before` json,
	`after` json,
	`ip` varchar(64),
	`ua` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` varchar(128) NOT NULL,
	`value` json,
	`updated_by` int,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `document_relations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`from_id` int NOT NULL,
	`to_id` int NOT NULL,
	`field_key` varchar(128) NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	CONSTRAINT `document_relations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_document_relations_link` UNIQUE(`from_id`,`to_id`,`field_key`)
);
--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`document_id` int NOT NULL,
	`version` int NOT NULL,
	`snapshot` json NOT NULL,
	`label` varchar(191),
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_document_versions_doc_version` UNIQUE(`document_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(64) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`status` enum('draft','published','scheduled','archived') NOT NULL DEFAULT 'draft',
	`published_at` timestamp,
	`scheduled_for` timestamp,
	`translation_group_id` varchar(36),
	`meta_title` varchar(255),
	`meta_description` varchar(320),
	`canonical_path` varchar(512),
	`noindex` boolean NOT NULL DEFAULT false,
	`nofollow` boolean NOT NULL DEFAULT false,
	`include_in_sitemap` boolean NOT NULL DEFAULT true,
	`og_image_uuid` varchar(36),
	`data` json NOT NULL,
	`created_by` int,
	`updated_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_documents_type_slug_locale` UNIQUE(`type`,`slug`,`locale`),
	CONSTRAINT `uniq_documents_canonical_path` UNIQUE(`canonical_path`)
);
--> statement-breakpoint
CREATE TABLE `media_files` (
	`uuid` varchar(36) NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`mime` varchar(128) NOT NULL,
	`size` bigint NOT NULL,
	`width` int,
	`height` int,
	`hash` varchar(64) NOT NULL,
	`alt_text` varchar(512),
	`folder_id` int,
	`uploaded_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `media_files_uuid` PRIMARY KEY(`uuid`)
);
--> statement-breakpoint
CREATE TABLE `media_folders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int,
	`name` varchar(191) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `media_folders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `media_usages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`media_uuid` varchar(36) NOT NULL,
	`subject_type` varchar(64) NOT NULL,
	`subject_id` varchar(64) NOT NULL,
	`context` varchar(64),
	CONSTRAINT `media_usages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `media_variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`media_uuid` varchar(36) NOT NULL,
	`variant_key` enum('original','thumb','medium','large','og') NOT NULL,
	`format` enum('jpg','webp','png','avif','svg') NOT NULL,
	`path` varchar(512) NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`size` bigint NOT NULL,
	CONSTRAINT `media_variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_media_variant` UNIQUE(`media_uuid`,`variant_key`,`format`)
);
--> statement-breakpoint
CREATE TABLE `seo_404_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`path` varchar(512) NOT NULL,
	`locale` varchar(8),
	`hits` int NOT NULL DEFAULT 1,
	`first_seen` timestamp NOT NULL DEFAULT (now()),
	`last_seen` timestamp NOT NULL DEFAULT (now()),
	`user_agent_sample` varchar(255),
	`referrer_sample` varchar(512),
	`ignored` boolean NOT NULL DEFAULT false,
	CONSTRAINT `seo_404_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_seo_404_log_path_locale` UNIQUE(`path`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `seo_meta` (
	`id` int AUTO_INCREMENT NOT NULL,
	`path` varchar(255) NOT NULL,
	`locale` varchar(8) NOT NULL DEFAULT 'el',
	`title` varchar(255),
	`description` varchar(320),
	`robots` varchar(64),
	`canonical` varchar(512),
	`og_title` varchar(255),
	`og_description` varchar(320),
	`og_image` varchar(512),
	`updated_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seo_meta_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_seo_meta_path_locale` UNIQUE(`path`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `seo_redirects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` varchar(512) NOT NULL,
	`target` varchar(512) NOT NULL,
	`status_code` int NOT NULL DEFAULT 301,
	`kind` enum('literal','wildcard','regex') NOT NULL DEFAULT 'literal',
	`active` boolean NOT NULL DEFAULT true,
	`hits` int NOT NULL DEFAULT 0,
	`last_hit_at` timestamp,
	`notes` varchar(512),
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seo_redirects_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_seo_redirects_source_kind` UNIQUE(`source`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`form_type` varchar(64) NOT NULL,
	`email` varchar(255) NOT NULL,
	`payload` json NOT NULL,
	`source_page_slug` varchar(191),
	`source_locale` varchar(8),
	`referrer_url` varchar(512),
	`ip_hash` varchar(64),
	`ua` varchar(255),
	`email_status` enum('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
	`email_error` text,
	`status` enum('new','handled','archived','spam') NOT NULL DEFAULT 'new',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `form_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `newsletter_subscribers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`locale` varchar(8) NOT NULL DEFAULT 'el',
	`consent_text` text NOT NULL,
	`consent_given_at` timestamp NOT NULL DEFAULT (now()),
	`double_opt_in_at` timestamp,
	`unsubscribed_at` timestamp,
	`source_page_slug` varchar(191),
	`mailchimp_id` varchar(64),
	`mailchimp_status` varchar(32),
	`last_synced_at` timestamp,
	`ip_hash` varchar(64),
	`ua` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `newsletter_subscribers_id` PRIMARY KEY(`id`),
	CONSTRAINT `newsletter_subscribers_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `admin_user_roles` ADD CONSTRAINT `admin_user_roles_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_user_roles` ADD CONSTRAINT `admin_user_roles_role_id_admin_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `admin_roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_settings` ADD CONSTRAINT `site_settings_updated_by_admin_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_relations` ADD CONSTRAINT `document_relations_from_id_documents_id_fk` FOREIGN KEY (`from_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_relations` ADD CONSTRAINT `document_relations_to_id_documents_id_fk` FOREIGN KEY (`to_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_versions` ADD CONSTRAINT `document_versions_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_versions` ADD CONSTRAINT `document_versions_created_by_admin_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_created_by_admin_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_updated_by_admin_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_files` ADD CONSTRAINT `media_files_folder_id_media_folders_id_fk` FOREIGN KEY (`folder_id`) REFERENCES `media_folders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_files` ADD CONSTRAINT `media_files_uploaded_by_admin_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_folders` ADD CONSTRAINT `media_folders_parent_id_media_folders_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `media_folders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_usages` ADD CONSTRAINT `media_usages_media_uuid_media_files_uuid_fk` FOREIGN KEY (`media_uuid`) REFERENCES `media_files`(`uuid`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_variants` ADD CONSTRAINT `media_variants_media_uuid_media_files_uuid_fk` FOREIGN KEY (`media_uuid`) REFERENCES `media_files`(`uuid`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `seo_meta` ADD CONSTRAINT `seo_meta_updated_by_admin_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `seo_redirects` ADD CONSTRAINT `seo_redirects_created_by_admin_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_audit_subject` ON `audit_logs` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_user` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_document_relations_from_field` ON `document_relations` (`from_id`,`field_key`);--> statement-breakpoint
CREATE INDEX `idx_document_relations_to` ON `document_relations` (`to_id`);--> statement-breakpoint
CREATE INDEX `idx_document_versions_doc` ON `document_versions` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_type_status_locale` ON `documents` (`type`,`status`,`locale`);--> statement-breakpoint
CREATE INDEX `idx_documents_status_published` ON `documents` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_translation_group` ON `documents` (`translation_group_id`);--> statement-breakpoint
CREATE INDEX `idx_media_files_hash` ON `media_files` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_media_usages_media` ON `media_usages` (`media_uuid`);--> statement-breakpoint
CREATE INDEX `idx_media_usages_subject` ON `media_usages` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_seo_404_log_last_seen` ON `seo_404_log` (`last_seen`);--> statement-breakpoint
CREATE INDEX `idx_seo_meta_path` ON `seo_meta` (`path`);--> statement-breakpoint
CREATE INDEX `idx_seo_redirects_active` ON `seo_redirects` (`active`);--> statement-breakpoint
CREATE INDEX `idx_seo_redirects_source` ON `seo_redirects` (`source`);--> statement-breakpoint
CREATE INDEX `idx_form_submissions_type_created` ON `form_submissions` (`form_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_form_submissions_status` ON `form_submissions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_form_submissions_email` ON `form_submissions` (`email`);--> statement-breakpoint
CREATE INDEX `idx_newsletter_created` ON `newsletter_subscribers` (`created_at`);