CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_name` text NOT NULL,
	`trading_name` text,
	`document` text DEFAULT '' NOT NULL,
	`state_registration` text,
	`street` text,
	`number` text,
	`complement` text,
	`district` text,
	`city` text,
	`state` text,
	`zip_code` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`segment` text,
	`lgpd_basis` text DEFAULT 'Execução de contrato' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_customers_status` ON `customers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_customers_document` ON `customers` (`document`);--> statement-breakpoint
CREATE TABLE `order_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`order_item_id` integer,
	`kind` text NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_documents_storage_key_unique` ON `order_documents` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_order_docs_order_kind` ON `order_documents` (`order_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_order_docs_item` ON `order_documents` (`order_item_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`product_name` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'L' NOT NULL,
	`unit_price_cents` integer DEFAULT 0 NOT NULL,
	`lot_number` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_order_items_order_id` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product_id` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text DEFAULT '' NOT NULL,
	`customer_id` integer NOT NULL,
	`order_date` integer,
	`delivery_date` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_unique` ON `orders` (`number`);--> statement-breakpoint
CREATE INDEX `idx_orders_customer_id` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_created_at` ON `orders` (`created_at`);