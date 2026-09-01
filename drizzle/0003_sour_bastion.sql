CREATE TABLE `intake_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`department` text NOT NULL,
	`module` text NOT NULL,
	`responsible` text NOT NULL,
	`physical_location` text NOT NULL,
	`expected_documents` integer DEFAULT 1 NOT NULL,
	`expected_pages` integer DEFAULT 1 NOT NULL,
	`received_documents` integer DEFAULT 0 NOT NULL,
	`received_pages` integer DEFAULT 0 NOT NULL,
	`divergences` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_batches_code_unique` ON `intake_batches` (`code`);--> statement-breakpoint
CREATE INDEX `idx_batches_department_status` ON `intake_batches` (`department`,`status`);--> statement-breakpoint
ALTER TABLE `files` ADD `validation_checklist` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `reviewed_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `files` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `rejection_reason` text;--> statement-breakpoint
ALTER TABLE `files` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `files` SET `updated_at` = `created_at`;--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_files_checksum` ON `files` (`checksum`);--> statement-breakpoint
PRAGMA optimize;
