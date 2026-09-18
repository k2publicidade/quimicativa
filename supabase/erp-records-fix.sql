ALTER TABLE public.records ADD COLUMN IF NOT EXISTS source_key text;
-- ERP permits standalone order items without a catalog product.
-- Rollback requires catalog links for all NULL product_id rows before SET NOT NULL.
ALTER TABLE public.order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.records ADD COLUMN IF NOT EXISTS source_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS records_source_key_unique ON public.records(source_key);
UPDATE public.records SET department='financeiro' WHERE department='compras' AND module='Notas Fiscais de Saída' AND source_key LIKE 'vhsys:%:nota:%';
