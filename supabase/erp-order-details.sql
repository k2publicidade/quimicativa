-- Additive ERP identity and exact price support. Existing manual records are retained.
alter table public.orders add column if not exists source_payload jsonb;
alter table public.orders add column if not exists source_key text;
alter table public.customers add column if not exists source_key text;
alter table public.customers add column if not exists source_payload jsonb;
alter table public.products add column if not exists source_key text;
alter table public.products add column if not exists source_payload jsonb;
alter table public.order_items add column if not exists source_key text;
alter table public.order_items add column if not exists source_payload jsonb;
alter table public.order_items add column if not exists line_total_cents bigint;
alter table public.order_items alter column unit_price_cents type numeric(20,6);
create unique index if not exists idx_orders_source_key on public.orders(source_key);
create unique index if not exists idx_customers_source_key on public.customers(source_key);
create unique index if not exists idx_products_source_key on public.products(source_key);
create unique index if not exists idx_order_items_source_key on public.order_items(source_key);
