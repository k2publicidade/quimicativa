ALTER TABLE `erp_integrations` ADD `secret_api_token` text;
--> statement-breakpoint
ALTER TABLE `erp_integrations` ADD `customers_path` text DEFAULT '/clientes' NOT NULL;
