CREATE TABLE `profitability_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `order_id` integer,
  `customer_id` integer,
  `route_id` integer,
  `vehicle_id` integer,
  `region` text DEFAULT '' NOT NULL,
  `period` integer NOT NULL,
  `revenue_cents` integer DEFAULT 0 NOT NULL,
  `gross_profit_cents` integer DEFAULT 0 NOT NULL,
  `delivery_cost_cents` integer DEFAULT 0 NOT NULL,
  `delivered_weight_kg` real DEFAULT 0 NOT NULL,
  `delivery_count` integer DEFAULT 1 NOT NULL,
  `average_payment_days` real,
  `source` text DEFAULT 'manual' NOT NULL,
  `notes` text,
  `created_by` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`),
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`),
  FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`),
  FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_profitability_period` ON `profitability_entries` (`period`);
--> statement-breakpoint
CREATE INDEX `idx_profitability_customer` ON `profitability_entries` (`customer_id`);
--> statement-breakpoint
CREATE INDEX `idx_profitability_route` ON `profitability_entries` (`route_id`);
