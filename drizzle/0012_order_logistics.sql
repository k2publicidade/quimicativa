ALTER TABLE `orders` ADD `payment_terms` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `package_count` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `package_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `package_unit_weight_kg` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `weight_kg` real DEFAULT 0 NOT NULL;
