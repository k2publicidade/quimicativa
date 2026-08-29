ALTER TABLE `records` ADD `metadata` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
PRAGMA optimize;
