ALTER TABLE `files` ADD `department` text DEFAULT 'inbox' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `module` text DEFAULT 'Caixa de entrada' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `document_type` text DEFAULT 'Documento geral' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `reference_date` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `files` ADD `status` text DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `checksum` text;--> statement-breakpoint
ALTER TABLE `files` ADD `batch_code` text;--> statement-breakpoint
ALTER TABLE `files` ADD `physical_location` text;--> statement-breakpoint
ALTER TABLE `files` ADD `confidentiality` text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `page_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_files_department_module` ON `files` (`department`,`module`);--> statement-breakpoint
CREATE INDEX `idx_files_status_expires_at` ON `files` (`status`,`expires_at`);--> statement-breakpoint
PRAGMA optimize;
