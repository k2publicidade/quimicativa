CREATE TABLE `fispq` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`version` text DEFAULT '1' NOT NULL,
	`issue_date` integer,
	`validity_date` integer,
	`file_key` text,
	`file_name` text,
	`file_size` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fispq_product_id` ON `fispq` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_fispq_validity_date` ON `fispq` (`validity_date`);--> statement-breakpoint
CREATE TABLE `licenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`license_type` text NOT NULL,
	`issuing_agency` text NOT NULL,
	`number` text NOT NULL,
	`validity_date` integer,
	`scope` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_licenses_validity_date` ON `licenses` (`validity_date`);--> statement-breakpoint
CREATE INDEX `idx_licenses_status` ON `licenses` (`status`);--> statement-breakpoint
CREATE TABLE `lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`lot_number` text NOT NULL,
	`manufacture_date` integer,
	`expiry_date` integer,
	`quantity` integer DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'un' NOT NULL,
	`location` text,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lots_product_id` ON `lots` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_lots_expiry_date` ON `lots` (`expiry_date`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Outros' NOT NULL,
	`concentration` text,
	`un_number` text,
	`hazard_class` text,
	`signal_word` text,
	`h_phrases` text DEFAULT '[]' NOT NULL,
	`p_phrases` text DEFAULT '[]' NOT NULL,
	`controlled` integer DEFAULT 0 NOT NULL,
	`control_agency` text,
	`flammable` integer DEFAULT 0 NOT NULL,
	`storage` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category`);--> statement-breakpoint
CREATE INDEX `idx_products_status` ON `products` (`status`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_name` text NOT NULL,
	`cnpj` text NOT NULL,
	`state_registration` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`certificates` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_cnpj_unique` ON `suppliers` (`cnpj`);--> statement-breakpoint
CREATE INDEX `idx_suppliers_status` ON `suppliers` (`status`);