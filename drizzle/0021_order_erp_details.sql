ALTER TABLE orders ADD COLUMN source_key TEXT;
ALTER TABLE customers ADD COLUMN source_key TEXT;
ALTER TABLE customers ADD COLUMN source_payload TEXT;
ALTER TABLE products ADD COLUMN source_key TEXT;
ALTER TABLE products ADD COLUMN source_payload TEXT;
ALTER TABLE order_items ADD COLUMN source_key TEXT;
ALTER TABLE order_items ADD COLUMN source_payload TEXT;
ALTER TABLE order_items ADD COLUMN line_total_cents INTEGER;
CREATE UNIQUE INDEX idx_orders_source_key ON orders(source_key);
CREATE UNIQUE INDEX idx_customers_source_key ON customers(source_key);
CREATE UNIQUE INDEX idx_products_source_key ON products(source_key);
CREATE UNIQUE INDEX idx_order_items_source_key ON order_items(source_key);
-- SQLite's numeric affinity retains fractional cents; production uses NUMERIC(20,6).
