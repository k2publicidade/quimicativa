ALTER TABLE `vehicles` ADD `capacity_m3` real;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `volume_m3` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `route_stops` ADD `volume_m3` real DEFAULT 0 NOT NULL;
