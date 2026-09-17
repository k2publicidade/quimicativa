CREATE TABLE `drivers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`cpf` text,
	`phone` text,
	`license_number` text,
	`license_category` text,
	`license_expiry` integer,
	`mopp_expiry` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drivers_cpf_unique` ON `drivers` (`cpf`);
--> statement-breakpoint
CREATE INDEX `idx_drivers_status` ON `drivers` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_drivers_expiry` ON `drivers` (`license_expiry`,`mopp_expiry`);
--> statement-breakpoint
ALTER TABLE `routes` ADD `driver_id` integer REFERENCES `drivers`(`id`);
--> statement-breakpoint
CREATE INDEX `idx_routes_driver_date` ON `routes` (`driver_id`,`route_date`);
