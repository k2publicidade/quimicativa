ALTER TABLE erp_integrations ADD COLUMN goods_receipts_path TEXT NOT NULL DEFAULT '/entradas';
ALTER TABLE erp_integrations ADD COLUMN invoices_path TEXT NOT NULL DEFAULT '/notas-fiscais';
ALTER TABLE erp_integrations ADD COLUMN receivables_path TEXT NOT NULL DEFAULT '/contas-a-receber';
