CREATE TABLE `routes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `vehicle_id` integer NOT NULL,
  `driver_name` text DEFAULT '' NOT NULL,
  `route_date` integer NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `planned_km` real DEFAULT 0 NOT NULL,
  `estimated_cost_cents` integer DEFAULT 0 NOT NULL,
  `notes` text,
  `created_by` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_routes_vehicle_date` ON `routes` (`vehicle_id`,`route_date`);
--> statement-breakpoint
CREATE INDEX `idx_routes_status` ON `routes` (`status`);
--> statement-breakpoint
CREATE TABLE `route_stops` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `route_id` integer NOT NULL,
  `order_id` integer NOT NULL,
  `sequence` integer NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `address_snapshot` text DEFAULT '' NOT NULL,
  `weight_kg` real DEFAULT 0 NOT NULL,
  `package_summary` text DEFAULT '' NOT NULL,
  `delivered_at` integer,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_route_stops_route_sequence` ON `route_stops` (`route_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `idx_route_stops_order` ON `route_stops` (`order_id`);
