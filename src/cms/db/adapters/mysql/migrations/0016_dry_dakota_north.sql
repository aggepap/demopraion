ALTER TABLE `seo_redirects` ADD `document_id` int;--> statement-breakpoint
ALTER TABLE `seo_redirects` ADD CONSTRAINT `seo_redirects_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_seo_redirects_document` ON `seo_redirects` (`document_id`);