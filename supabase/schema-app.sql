-- GERADO por supabase/gen-from-drizzle.mjs — NAO EDITE A MAO.
-- Postgres fiel ao SQLite: bigserial, bigint(epoch), 0/1, JSON text.
-- Assim o app atual (baseado em D1) roda igual sobre o Supabase.

-- limpeza: derruba as tabelas do app (preserva schema public e grants).
drop table if exists "audit_log" cascade;
drop table if exists "files" cascade;
drop table if exists "records" cascade;
drop table if exists "users" cascade;
drop table if exists "intake_batches" cascade;
drop table if exists "fispq" cascade;
drop table if exists "licenses" cascade;
drop table if exists "lots" cascade;
drop table if exists "products" cascade;
drop table if exists "suppliers" cascade;
drop table if exists "customers" cascade;
drop table if exists "order_documents" cascade;
drop table if exists "order_items" cascade;
drop table if exists "orders" cascade;
drop table if exists "vehicle_documents" cascade;
drop table if exists "vehicle_maintenance" cascade;
drop table if exists "vehicles" cascade;
drop table if exists "routes" cascade;
drop table if exists "route_stops" cascade;
drop table if exists "erp_integrations" cascade;
drop table if exists "profitability_entries" cascade;
drop table if exists "route_events" cascade;
drop table if exists "drivers" cascade;

-- ===== TABELAS =====
CREATE TABLE "audit_log" (
 "id" bigserial primary key,
 "actor_id" text,
 "action" text NOT NULL,
 "entity_type" text NOT NULL,
 "entity_id" text NOT NULL,
 "details" text,
 "created_at" bigint NOT NULL);

CREATE TABLE "files" (
 "id" bigserial primary key,
 "record_id" bigint NOT NULL,
 "storage_key" text NOT NULL,
 "filename" text NOT NULL,
 "content_type" text NOT NULL,
 "size_bytes" bigint NOT NULL,
 "uploaded_by" text,
 "created_at" bigint NOT NULL);

CREATE TABLE "records" (
 "id" bigserial primary key,
 "department" text NOT NULL,
 "module" text NOT NULL,
 "title" text NOT NULL,
 "description" text,
 "status" text DEFAULT 'active' NOT NULL,
 "priority" text DEFAULT 'medium' NOT NULL,
 "owner_id" text,
 "due_date" bigint,
 "amount_cents" bigint,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "users" (
 "id" text PRIMARY KEY NOT NULL,
 "email" text NOT NULL,
 "name" text NOT NULL,
 "role" text DEFAULT 'viewer' NOT NULL,
 "created_at" bigint NOT NULL
);

CREATE TABLE "intake_batches" (
 "id" bigserial primary key,
 "code" text NOT NULL,
 "department" text NOT NULL,
 "module" text NOT NULL,
 "responsible" text NOT NULL,
 "physical_location" text NOT NULL,
 "expected_documents" bigint DEFAULT 1 NOT NULL,
 "expected_pages" bigint DEFAULT 1 NOT NULL,
 "received_documents" bigint DEFAULT 0 NOT NULL,
 "received_pages" bigint DEFAULT 0 NOT NULL,
 "divergences" text DEFAULT '' NOT NULL,
 "status" text DEFAULT 'open' NOT NULL,
 "created_by" text NOT NULL,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "fispq" (
 "id" bigserial primary key,
 "product_id" bigint NOT NULL,
 "version" text DEFAULT '1' NOT NULL,
 "issue_date" bigint,
 "validity_date" bigint,
 "file_key" text,
 "file_name" text,
 "file_size" bigint,
 "status" text DEFAULT 'active' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "licenses" (
 "id" bigserial primary key,
 "license_type" text NOT NULL,
 "issuing_agency" text NOT NULL,
 "number" text NOT NULL,
 "validity_date" bigint,
 "scope" text,
 "status" text DEFAULT 'active' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "lots" (
 "id" bigserial primary key,
 "product_id" bigint NOT NULL,
 "lot_number" text NOT NULL,
 "manufacture_date" bigint,
 "expiry_date" bigint,
 "quantity" bigint DEFAULT 0 NOT NULL,
 "unit" text DEFAULT 'un' NOT NULL,
 "location" text,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "products" (
 "id" bigserial primary key,
 "name" text NOT NULL,
 "category" text DEFAULT 'Outros' NOT NULL,
 "concentration" text,
 "un_number" text,
 "hazard_class" text,
 "signal_word" text,
 "h_phrases" text DEFAULT '[]' NOT NULL,
 "p_phrases" text DEFAULT '[]' NOT NULL,
 "controlled" bigint DEFAULT 0 NOT NULL,
 "control_agency" text,
 "flammable" bigint DEFAULT 0 NOT NULL,
 "storage" text,
 "status" text DEFAULT 'active' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "suppliers" (
 "id" bigserial primary key,
 "company_name" text NOT NULL,
 "cnpj" text NOT NULL,
 "state_registration" text,
 "contact_name" text,
 "contact_email" text,
 "contact_phone" text,
 "certificates" text DEFAULT '[]' NOT NULL,
 "status" text DEFAULT 'active' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "customers" (
 "id" bigserial primary key,
 "company_name" text NOT NULL,
 "trading_name" text,
 "document" text DEFAULT '' NOT NULL,
 "state_registration" text,
 "street" text,
 "number" text,
 "complement" text,
 "district" text,
 "city" text,
 "state" text,
 "zip_code" text,
 "contact_name" text,
 "contact_email" text,
 "contact_phone" text,
 "segment" text,
 "lgpd_basis" text DEFAULT 'Execução de contrato' NOT NULL,
 "status" text DEFAULT 'active' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "order_documents" (
 "id" bigserial primary key,
 "order_id" bigint NOT NULL,
 "order_item_id" bigint,
 "kind" text NOT NULL,
 "storage_key" text NOT NULL,
 "file_name" text NOT NULL,
 "content_type" text NOT NULL,
 "size_bytes" bigint NOT NULL,
 "metadata" text DEFAULT '{}' NOT NULL,
 "status" text DEFAULT 'active' NOT NULL,
 "notes" text,
 "uploaded_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "order_items" (
 "id" bigserial primary key,
 "order_id" bigint NOT NULL,
 "product_id" bigint NOT NULL,
 "product_name" text NOT NULL,
 "quantity" double precision DEFAULT 0 NOT NULL,
 "unit" text DEFAULT 'L' NOT NULL,
 "unit_price_cents" bigint DEFAULT 0 NOT NULL,
 "lot_number" text,
 "notes" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "orders" (
 "id" bigserial primary key,
 "number" text DEFAULT '' NOT NULL,
 "customer_id" bigint NOT NULL,
 "order_date" bigint,
 "delivery_date" bigint,
 "status" text DEFAULT 'draft' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "vehicle_documents" (
 "id" bigserial primary key,
 "vehicle_id" bigint NOT NULL,
 "doc_type" text NOT NULL,
 "number" text,
 "issuing_body" text,
 "issue_date" bigint,
 "expiry_date" bigint,
 "storage_key" text,
 "file_name" text,
 "content_type" text,
 "size_bytes" bigint,
 "notes" text,
 "uploaded_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "vehicle_maintenance" (
 "id" bigserial primary key,
 "vehicle_id" bigint NOT NULL,
 "maint_type" text DEFAULT 'Preventiva' NOT NULL,
 "service_date" bigint NOT NULL,
 "odometer_km" bigint DEFAULT 0 NOT NULL,
 "description" text,
 "supplier" text,
 "cost_cents" bigint DEFAULT 0 NOT NULL,
 "next_due_km" bigint,
 "next_due_date" bigint,
 "status" text DEFAULT 'completed' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "vehicles" (
 "id" bigserial primary key,
 "plate" text NOT NULL,
 "renavam" text,
 "chassis" text,
 "brand" text DEFAULT '' NOT NULL,
 "model" text NOT NULL,
 "model_year" bigint,
 "vehicle_type" text DEFAULT 'Caminhão' NOT NULL,
 "capacity_kg" bigint,
 "odometer_km" bigint DEFAULT 0 NOT NULL,
 "maint_interval_km" bigint,
 "maint_interval_months" bigint,
 "status" text DEFAULT 'active' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "routes" (
 "id" bigserial primary key,
 "code" text NOT NULL UNIQUE,
 "name" text NOT NULL,
 "vehicle_id" bigint NOT NULL,
 "driver_name" text DEFAULT '' NOT NULL,
 "route_date" bigint NOT NULL,
 "status" text DEFAULT 'draft' NOT NULL,
 "planned_km" double precision DEFAULT 0 NOT NULL,
 "estimated_cost_cents" bigint DEFAULT 0 NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "route_stops" (
 "id" bigserial primary key,
 "route_id" bigint NOT NULL,
 "order_id" bigint NOT NULL,
 "sequence" bigint NOT NULL,
 "status" text DEFAULT 'pending' NOT NULL,
 "address_snapshot" text DEFAULT '' NOT NULL,
 "weight_kg" double precision DEFAULT 0 NOT NULL,
 "package_summary" text DEFAULT '' NOT NULL,
 "delivered_at" bigint,
 "notes" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "erp_integrations" (
 "id" bigserial primary key,
 "provider" text DEFAULT 'REST' NOT NULL,
 "base_url" text NOT NULL,
 "orders_path" text DEFAULT '/orders' NOT NULL,
 "api_token" text,
 "secret_api_token" text,
 "customers_path" text DEFAULT '/clientes' NOT NULL,
 "active" bigint DEFAULT 0 NOT NULL,
 "last_sync_at" bigint,
 "last_sync_status" text,
 "last_sync_message" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

CREATE TABLE "profitability_entries" (
 "id" bigserial primary key,
 "order_id" bigint,
 "customer_id" bigint,
 "route_id" bigint,
 "vehicle_id" bigint,
 "region" text DEFAULT '' NOT NULL,
 "period" bigint NOT NULL,
 "revenue_cents" bigint DEFAULT 0 NOT NULL,
 "gross_profit_cents" bigint DEFAULT 0 NOT NULL,
 "delivery_cost_cents" bigint DEFAULT 0 NOT NULL,
 "delivered_weight_kg" double precision DEFAULT 0 NOT NULL,
 "delivery_count" bigint DEFAULT 1 NOT NULL,
 "average_payment_days" double precision,
 "source" text DEFAULT 'manual' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL);

CREATE TABLE "route_events" (
 "id" bigserial primary key,
 "route_id" bigint NOT NULL,
 "stop_id" bigint,
 "event_type" text NOT NULL,
 "occurred_at" bigint NOT NULL,
 "odometer_km" double precision,
 "fuel_liters" double precision,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL);

CREATE TABLE "drivers" (
 "id" bigserial primary key,
 "name" text NOT NULL,
 "cpf" text,
 "phone" text,
 "license_number" text,
 "license_category" text,
 "license_expiry" bigint,
 "mopp_expiry" bigint,
 "status" text DEFAULT 'active' NOT NULL,
 "notes" text,
 "created_by" text,
 "created_at" bigint NOT NULL,
 "updated_at" bigint NOT NULL);

-- ===== CHAVES ESTRANGEIRAS =====
alter table "audit_log" add constraint "fk_audit_log_1" foreign key ("actor_id") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "files" add constraint "fk_files_2" foreign key ("record_id") references "records"(id) ON UPDATE no action ON DELETE no action;
alter table "files" add constraint "fk_files_3" foreign key ("uploaded_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "records" add constraint "fk_records_4" foreign key ("owner_id") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "intake_batches" add constraint "fk_intake_batches_5" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "fispq" add constraint "fk_fispq_6" foreign key ("product_id") references "products"(id) ON UPDATE no action ON DELETE no action;
alter table "fispq" add constraint "fk_fispq_7" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "licenses" add constraint "fk_licenses_8" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "lots" add constraint "fk_lots_9" foreign key ("product_id") references "products"(id) ON UPDATE no action ON DELETE no action;
alter table "lots" add constraint "fk_lots_10" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "products" add constraint "fk_products_11" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "suppliers" add constraint "fk_suppliers_12" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "customers" add constraint "fk_customers_13" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "order_documents" add constraint "fk_order_documents_14" foreign key ("order_id") references "orders"(id) ON UPDATE no action ON DELETE no action;
alter table "order_documents" add constraint "fk_order_documents_15" foreign key ("order_item_id") references "order_items"(id) ON UPDATE no action ON DELETE no action;
alter table "order_documents" add constraint "fk_order_documents_16" foreign key ("uploaded_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "order_items" add constraint "fk_order_items_17" foreign key ("order_id") references "orders"(id) ON UPDATE no action ON DELETE no action;
alter table "order_items" add constraint "fk_order_items_18" foreign key ("product_id") references "products"(id) ON UPDATE no action ON DELETE no action;
alter table "orders" add constraint "fk_orders_19" foreign key ("customer_id") references "customers"(id) ON UPDATE no action ON DELETE no action;
alter table "orders" add constraint "fk_orders_20" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "vehicle_documents" add constraint "fk_vehicle_documents_21" foreign key ("vehicle_id") references "vehicles"(id) ON UPDATE no action ON DELETE no action;
alter table "vehicle_documents" add constraint "fk_vehicle_documents_22" foreign key ("uploaded_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "vehicle_maintenance" add constraint "fk_vehicle_maintenance_23" foreign key ("vehicle_id") references "vehicles"(id) ON UPDATE no action ON DELETE no action;
alter table "vehicle_maintenance" add constraint "fk_vehicle_maintenance_24" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "vehicles" add constraint "fk_vehicles_25" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;
alter table "routes" add constraint "fk_routes_26" foreign key ("vehicle_id") references "vehicles"(id);
alter table "routes" add constraint "fk_routes_27" foreign key ("created_by") references "users"(id) ;
alter table "route_stops" add constraint "fk_route_stops_28" foreign key ("route_id") references "routes"(id);
alter table "route_stops" add constraint "fk_route_stops_29" foreign key ("order_id") references "orders"(id) ;
alter table "erp_integrations" add constraint "fk_erp_integrations_30" foreign key ("created_by") references "users"(id) ;
alter table "profitability_entries" add constraint "fk_profitability_entries_31" foreign key ("order_id") references "orders"(id);
alter table "profitability_entries" add constraint "fk_profitability_entries_32" foreign key ("customer_id") references "customers"(id);
alter table "profitability_entries" add constraint "fk_profitability_entries_33" foreign key ("route_id") references "routes"(id);
alter table "profitability_entries" add constraint "fk_profitability_entries_34" foreign key ("vehicle_id") references "vehicles"(id);
alter table "profitability_entries" add constraint "fk_profitability_entries_35" foreign key ("created_by") references "users"(id) ;
alter table "route_events" add constraint "fk_route_events_36" foreign key ("route_id") references "routes"(id);
alter table "route_events" add constraint "fk_route_events_37" foreign key ("stop_id") references "route_stops"(id);
alter table "route_events" add constraint "fk_route_events_38" foreign key ("created_by") references "users"(id) ;
alter table "drivers" add constraint "fk_drivers_39" foreign key ("created_by") references "users"(id) ON UPDATE no action ON DELETE no action;

-- ===== INDICES E ALTERACOES =====
CREATE INDEX "idx_audit_entity" ON "audit_log" ("entity_type","entity_id");
CREATE INDEX "idx_audit_created_at" ON "audit_log" ("created_at");
CREATE UNIQUE INDEX "files_storage_key_unique" ON "files" ("storage_key");
CREATE INDEX "idx_files_record_id" ON "files" ("record_id");
CREATE INDEX "idx_records_department_module" ON "records" ("department","module");
CREATE INDEX "idx_records_status_due_date" ON "records" ("status","due_date");
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
ALTER TABLE "records" ADD "metadata" text DEFAULT '{}' NOT NULL;
ALTER TABLE "files" ADD "department" text DEFAULT 'inbox' NOT NULL;
ALTER TABLE "files" ADD "module" text DEFAULT 'Caixa de entrada' NOT NULL;
ALTER TABLE "files" ADD "document_type" text DEFAULT 'Documento geral' NOT NULL;
ALTER TABLE "files" ADD "reference_date" bigint;
ALTER TABLE "files" ADD "expires_at" bigint;
ALTER TABLE "files" ADD "notes" text;
ALTER TABLE "files" ADD "status" text DEFAULT 'review' NOT NULL;
ALTER TABLE "files" ADD "checksum" text;
ALTER TABLE "files" ADD "batch_code" text;
ALTER TABLE "files" ADD "physical_location" text;
ALTER TABLE "files" ADD "confidentiality" text DEFAULT 'internal' NOT NULL;
ALTER TABLE "files" ADD "page_count" bigint DEFAULT 1 NOT NULL;
ALTER TABLE "files" ADD "version" bigint DEFAULT 1 NOT NULL;
CREATE INDEX "idx_files_department_module" ON "files" ("department","module");
CREATE INDEX "idx_files_status_expires_at" ON "files" ("status","expires_at");
CREATE UNIQUE INDEX "intake_batches_code_unique" ON "intake_batches" ("code");
CREATE INDEX "idx_batches_department_status" ON "intake_batches" ("department","status");
ALTER TABLE "files" ADD "validation_checklist" text DEFAULT '{}' NOT NULL;
ALTER TABLE "files" ADD "reviewed_by" text REFERENCES users(id);
ALTER TABLE "files" ADD "reviewed_at" bigint;
ALTER TABLE "files" ADD "rejection_reason" text;
ALTER TABLE "files" ADD "updated_at" bigint DEFAULT 0 NOT NULL;
UPDATE "files" SET "updated_at" = "created_at";
CREATE UNIQUE INDEX "uidx_files_checksum" ON "files" ("checksum");
CREATE INDEX "idx_fispq_product_id" ON "fispq" ("product_id");
CREATE INDEX "idx_fispq_validity_date" ON "fispq" ("validity_date");
CREATE INDEX "idx_licenses_validity_date" ON "licenses" ("validity_date");
CREATE INDEX "idx_licenses_status" ON "licenses" ("status");
CREATE INDEX "idx_lots_product_id" ON "lots" ("product_id");
CREATE INDEX "idx_lots_expiry_date" ON "lots" ("expiry_date");
CREATE INDEX "idx_products_category" ON "products" ("category");
CREATE INDEX "idx_products_status" ON "products" ("status");
CREATE UNIQUE INDEX "suppliers_cnpj_unique" ON "suppliers" ("cnpj");
CREATE INDEX "idx_suppliers_status" ON "suppliers" ("status");
ALTER TABLE "files" ADD "ocr_text" text;
CREATE INDEX "idx_customers_status" ON "customers" ("status");
CREATE INDEX "idx_customers_document" ON "customers" ("document");
CREATE UNIQUE INDEX "order_documents_storage_key_unique" ON "order_documents" ("storage_key");
CREATE INDEX "idx_order_docs_order_kind" ON "order_documents" ("order_id","kind");
CREATE INDEX "idx_order_docs_item" ON "order_documents" ("order_item_id");
CREATE INDEX "idx_order_items_order_id" ON "order_items" ("order_id");
CREATE INDEX "idx_order_items_product_id" ON "order_items" ("product_id");
CREATE UNIQUE INDEX "orders_number_unique" ON "orders" ("number");
CREATE INDEX "idx_orders_customer_id" ON "orders" ("customer_id");
CREATE INDEX "idx_orders_status" ON "orders" ("status");
CREATE INDEX "idx_orders_created_at" ON "orders" ("created_at");
CREATE UNIQUE INDEX "vehicle_documents_storage_key_unique" ON "vehicle_documents" ("storage_key");
CREATE INDEX "idx_vehicle_docs_vehicle" ON "vehicle_documents" ("vehicle_id");
CREATE INDEX "idx_vehicle_docs_expiry" ON "vehicle_documents" ("expiry_date");
CREATE INDEX "idx_vehicle_maint_vehicle" ON "vehicle_maintenance" ("vehicle_id");
CREATE INDEX "idx_vehicle_maint_date" ON "vehicle_maintenance" ("service_date");
CREATE UNIQUE INDEX "vehicles_plate_unique" ON "vehicles" ("plate");
CREATE INDEX "idx_vehicles_status" ON "vehicles" ("status");
CREATE INDEX "idx_vehicles_plate" ON "vehicles" ("plate");
CREATE INDEX "idx_routes_vehicle_date" ON "routes" ("vehicle_id","route_date");
CREATE INDEX "idx_routes_status" ON "routes" ("status");
CREATE INDEX "idx_route_stops_route_sequence" ON "route_stops" ("route_id","sequence");
CREATE INDEX "idx_route_stops_order" ON "route_stops" ("order_id");
CREATE INDEX "idx_profitability_period" ON "profitability_entries" ("period");
CREATE INDEX "idx_profitability_customer" ON "profitability_entries" ("customer_id");
CREATE INDEX "idx_profitability_route" ON "profitability_entries" ("route_id");
CREATE INDEX "idx_route_events_route_time" ON "route_events" ("route_id","occurred_at");
CREATE INDEX "idx_route_events_stop" ON "route_events" ("stop_id");
ALTER TABLE "orders" ADD "payment_terms" text DEFAULT '' NOT NULL;
ALTER TABLE "order_items" ADD "package_count" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "order_items" ADD "package_type" text DEFAULT '' NOT NULL;
ALTER TABLE "order_items" ADD "package_unit_weight_kg" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "order_items" ADD "weight_kg" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "routes" ADD "origin_address" text DEFAULT '' NOT NULL;
ALTER TABLE "profitability_entries" ADD "source_key" text;
CREATE UNIQUE INDEX "idx_profitability_source_key" ON "profitability_entries" ("source_key") WHERE "source_key" IS NOT NULL;
ALTER TABLE "customers" ADD "receiving_window" text DEFAULT '' NOT NULL;
ALTER TABLE "route_stops" ADD "receiving_window" text DEFAULT '' NOT NULL;
CREATE UNIQUE INDEX "drivers_cpf_unique" ON "drivers" ("cpf");
CREATE INDEX "idx_drivers_status" ON "drivers" ("status");
CREATE INDEX "idx_drivers_expiry" ON "drivers" ("license_expiry","mopp_expiry");
ALTER TABLE "routes" ADD "driver_id" bigint REFERENCES "drivers"("id");
CREATE INDEX "idx_routes_driver_date" ON "routes" ("driver_id","route_date");
ALTER TABLE "vehicles" ADD "capacity_m3" double precision;
ALTER TABLE "order_items" ADD "volume_m3" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "route_stops" ADD "volume_m3" double precision DEFAULT 0 NOT NULL;

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
