CREATE TABLE `erp_integrations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `provider` text DEFAULT 'REST' NOT NULL,
  `base_url` text NOT NULL,
  `orders_path` text DEFAULT '/orders' NOT NULL,
  `api_token` text,
  `active` integer DEFAULT 0 NOT NULL,
  `last_sync_at` integer,
  `last_sync_status` text,
  `last_sync_message` text,
  `created_by` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);
