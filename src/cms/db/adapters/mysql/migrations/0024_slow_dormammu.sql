ALTER TABLE `seo_redirects` ADD `reason` varchar(32);--> statement-breakpoint
UPDATE `seo_redirects` SET `reason` = 'unpublish' WHERE `document_id` IS NOT NULL;
