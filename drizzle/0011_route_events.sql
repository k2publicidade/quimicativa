CREATE TABLE `route_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `route_id` integer NOT NULL,
  `stop_id` integer,
  `event_type` text NOT NULL,
  `occurred_at` integer NOT NULL,
  `odometer_km` real,
  `fuel_liters` real,
  `notes` text,
  `created_by` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`),
  FOREIGN KEY (`stop_id`) REFERENCES `route_stops`(`id`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_route_events_route_time` ON `route_events` (`route_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_route_events_stop` ON `route_events` (`stop_id`);
