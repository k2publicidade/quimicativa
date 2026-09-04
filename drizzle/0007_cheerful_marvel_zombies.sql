CREATE TABLE `vehicle_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`doc_type` text NOT NULL,
	`number` text,
	`issuing_body` text,
	`issue_date` integer,
	`expiry_date` integer,
	`storage_key` text,
	`file_name` text,
	`content_type` text,
	`size_bytes` integer,
	`notes` text,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_documents_storage_key_unique` ON `vehicle_documents` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_vehicle_docs_vehicle` ON `vehicle_documents` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `idx_vehicle_docs_expiry` ON `vehicle_documents` (`expiry_date`);--> statement-breakpoint
CREATE TABLE `vehicle_maintenance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`maint_type` text DEFAULT 'Preventiva' NOT NULL,
	`service_date` integer NOT NULL,
	`odometer_km` integer DEFAULT 0 NOT NULL,
	`description` text,
	`supplier` text,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`next_due_km` integer,
	`next_due_date` integer,
	`status` text DEFAULT 'completed' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vehicle_maint_vehicle` ON `vehicle_maintenance` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `idx_vehicle_maint_date` ON `vehicle_maintenance` (`service_date`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plate` text NOT NULL,
	`renavam` text,
	`chassis` text,
	`brand` text DEFAULT '' NOT NULL,
	`model` text NOT NULL,
	`model_year` integer,
	`vehicle_type` text DEFAULT 'Caminhão' NOT NULL,
	`capacity_kg` integer,
	`odometer_km` integer DEFAULT 0 NOT NULL,
	`maint_interval_km` integer,
	`maint_interval_months` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_plate_unique` ON `vehicles` (`plate`);--> statement-breakpoint
CREATE INDEX `idx_vehicles_status` ON `vehicles` (`status`);--> statement-breakpoint
CREATE INDEX `idx_vehicles_plate` ON `vehicles` (`plate`);