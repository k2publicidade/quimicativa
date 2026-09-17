ALTER TABLE `profitability_entries` ADD `source_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profitability_source_key` ON `profitability_entries` (`source_key`) WHERE `source_key` IS NOT NULL;
