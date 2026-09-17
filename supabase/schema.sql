-- ============================================================================

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
-- QUIMICATIVA — CRM Gestão Integrada
-- Schema PostgreSQL para Supabase (produção)
-- Fonte: db/schema.ts (D1/SQLite) mapeado + tabelas estruturadas faltantes.
--
-- GUIA DE APLICAÇÃO NO SUPABASE:
--   1. Supabase Dashboard → SQL Editor → cole e rode este arquivo inteiro.
--   2. RLS habilitado em todas as tabelas. O backend (Next.js/vinext) acessa
--      via service_role ou via JWT com claim 'role' (ceo|manager|operator|viewer),
--      lido pelas policies através de jwt_role(). Ajuste conforme authz.ts real.
--   3. É IDEMPOTENTE: pode rodar mais de uma vez sem erro.
--
-- CONVENÇÕES:
--   * id uuid PK default gen_random_uuid().
--   * Dinheiro SEMPRE em centavos (bigint) — mesma regra de db/schema.ts.
--   * timestamptz em UTC; datas em 'date'.
--   * Auditoria por TRIGGER (Postgres permite; no D1 era escrita por código).
--   * Exclusão = soft (status archived/anonymized), nunca DELETE físico.
-- ============================================================================

-- gen_random_uuid() é nativo no Postgres 13+ (e no Supabase). A extensão
-- pgcrypto fica opcional: criada no Supabase, ignorada onde não existir.
do $$ begin create extension if not exists pgcrypto;
exception when others then null; end $$;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
do $$ begin create type app_role as enum ('ceo','manager','operator','viewer');
exception when duplicate_object then null; end $$;

do $$ begin create type record_status as enum
  ('active','pending','completed','archived','review','expired','in_use',
   'failed','cancelled','draft','approved','vacation','leave','overdue','critical');
exception when duplicate_object then null; end $$;

do $$ begin create type doc_status as enum ('active','review','validated','rejected','archived');
exception when duplicate_object then null; end $$;

do $$ begin create type order_status as enum ('draft','active','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type order_doc_kind as enum ('nf','boleto','laudo','ficha');
exception when duplicate_object then null; end $$;

do $$ begin create type confidentiality as enum ('public','internal','restricted','confidential');
exception when duplicate_object then null; end $$;

do $$ begin create type priority_level as enum ('low','medium','high','critical');
exception when duplicate_object then null; end $$;

do $$ begin create type vehicle_status as enum ('active','in_maintenance','retired');
exception when duplicate_object then null; end $$;

do $$ begin create type route_status as enum ('draft','active','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type stop_status as enum ('pending','in_transit','delivered','failed','cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- FUNÇÕES DE UTILIDADE
-- ---------------------------------------------------------------------------
-- papel do usuário autenticado (claim JWT) — NÃO usar o nome current_role,
-- que é função embutida do Postgres.
create or replace function jwt_role() returns text language sql stable as $$
  select coalesce(
    nullif((nullif(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'role', ''),
    'viewer');
$$;

create or replace function jwt_sub() returns text language sql stable as $$
  select nullif((nullif(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'sub', '');
$$;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- grava qualquer escrita na trilha de auditoria imutável.
-- SECURITY DEFINER: a inserção em audit_log roda como dono da função e
-- NÃO é bloqueada pelo RLS das tabelas (senão toda escrita autenticada falha).
create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if tg_op = 'DELETE' then
    v_id := old.id::text;
    insert into audit_log(actor_id, action, entity_type, entity_id, details, created_at)
    values (nullif(jwt_sub(),'')::uuid, 'delete', tg_table_name, v_id,
            jsonb_build_object('old', to_jsonb(old)), now());
    return old;
  elsif tg_op = 'UPDATE' then
    insert into audit_log(actor_id, action, entity_type, entity_id, details, created_at)
    values (nullif(jwt_sub(),'')::uuid, 'update', tg_table_name, new.id::text,
            jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)), now());
    return new;
  else
    insert into audit_log(actor_id, action, entity_type, entity_id, details, created_at)
    values (nullif(jwt_sub(),'')::uuid, 'insert', tg_table_name, new.id::text,
            to_jsonb(new), now());
    return new;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. NÚCLEO / AUDITORIA / RBAC
-- ---------------------------------------------------------------------------
create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  name       text not null,
  role       app_role not null default 'viewer',
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id          bigserial primary key,
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_entity     on audit_log(entity_type, entity_id);
create index if not exists idx_audit_created_at on audit_log(created_at);

create table if not exists user_roles (
  id      bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  role    app_role not null,
  scope   text,
  unique (user_id, role, scope)
);

-- ---------------------------------------------------------------------------
-- 2. CRUD GENÉRICO POR SETOR + ACERVO DIGITAL
-- ---------------------------------------------------------------------------
create table if not exists records (
  id          uuid primary key default gen_random_uuid(),
  department  text not null,
  module      text not null,
  title       text not null,
  description text,
  metadata    jsonb not null default '{}'::jsonb,
  status      record_status not null default 'active',
  priority    priority_level not null default 'medium',
  owner_id    uuid references users(id),
  due_date    date,
  amount_cents bigint,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_records_department_module on records(department, module);
create index if not exists idx_records_status_due_date     on records(status, due_date);

create table if not exists intake_batches (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  department         text not null,
  module             text not null,
  responsible        text not null,
  physical_location  text not null,
  expected_documents integer not null default 1,
  expected_pages     integer not null default 1,
  received_documents integer not null default 0,
  received_pages     integer not null default 0,
  divergences        text not null default '',
  status             record_status not null default 'active',
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_batches_department_status on intake_batches(department, status);

create table if not exists files (
  id                   uuid primary key default gen_random_uuid(),
  record_id            uuid references records(id),
  storage_key          text not null unique,
  filename             text not null,
  content_type         text not null,
  size_bytes           bigint not null,
  department           text not null default 'inbox',
  module               text not null default 'Caixa de entrada',
  document_type        text not null default 'Documento geral',
  reference_date       date,
  expires_at           date,
  notes                text,
  status               doc_status not null default 'review',
  checksum             text,
  batch_code           text,
  physical_location    text,
  confidentiality      confidentiality not null default 'internal',
  page_count           integer not null default 1,
  version              integer not null default 1,
  validation_checklist jsonb not null default '{}'::jsonb,
  ocr_text             text,
  reviewed_by          uuid references users(id),
  reviewed_at          timestamptz,
  rejection_reason     text,
  uploaded_by          uuid references users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index  if not exists idx_files_record_id         on files(record_id);
create index  if not exists idx_files_department_module on files(department, module);
create index  if not exists idx_files_status_expires    on files(status, expires_at);
create unique index if not exists uidx_files_checksum   on files(checksum) where checksum is not null;

-- ---------------------------------------------------------------------------
-- 3. PRODUTOS & COMPLIANCE
-- ---------------------------------------------------------------------------
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text not null default 'Outros',
  concentration  text,
  un_number      text,
  hazard_class   text,
  signal_word    text,
  h_phrases      jsonb not null default '[]'::jsonb,
  p_phrases      jsonb not null default '[]'::jsonb,
  controlled     boolean not null default false,
  control_agency text,
  flammable      boolean not null default false,
  storage        text,
  status         record_status not null default 'active',
  notes          text,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_products_category on products(category);
create index if not exists idx_products_status   on products(status);

create table if not exists lots (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id),
  lot_number       text not null,
  manufacture_date date,
  expiry_date      date not null,
  quantity         numeric(18,4) not null default 0,
  unit             text not null default 'un',
  location         text,
  notes            text,
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_lots_product_id  on lots(product_id);
create index if not exists idx_lots_expiry_date on lots(expiry_date);

create table if not exists suppliers (
  id                 uuid primary key default gen_random_uuid(),
  company_name       text not null,
  cnpj               text not null unique,
  state_registration text,
  contact_name       text,
  contact_email      text,
  contact_phone      text,
  certificates       jsonb not null default '[]'::jsonb,
  status             record_status not null default 'active',
  notes              text,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_suppliers_status on suppliers(status);

create table if not exists fispq (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id),
  version       text not null default '1',
  issue_date    date,
  validity_date date not null,
  file_key      text,
  file_name     text,
  file_size     bigint,
  status        doc_status not null default 'active',
  notes         text,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_fispq_product_id on fispq(product_id);
create index if not exists idx_fispq_validity   on fispq(validity_date);

create table if not exists licenses (
  id             uuid primary key default gen_random_uuid(),
  license_type   text not null,
  issuing_agency text not null,
  number         text not null,
  validity_date  date not null,
  scope          text,
  status         record_status not null default 'active',
  notes          text,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_licenses_validity on licenses(validity_date);
create index if not exists idx_licenses_status   on licenses(status);

-- ---------------------------------------------------------------------------
-- 4. VENDAS — CLIENTES, PEDIDOS, PROPOSTAS
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id                 uuid primary key default gen_random_uuid(),
  company_name       text not null,
  trading_name       text,
  document           text not null default '',
  state_registration text,
  street             text,
  number             text,
  complement         text,
  district           text,
  city               text,
  state              text,
  zip_code           text,
  receiving_window   text not null default '',
  contact_name       text,
  contact_email      text,
  contact_phone      text,
  segment            text,
  lgpd_basis         text not null default 'Execução de contrato',
  anonymized         boolean not null default false,
  status             record_status not null default 'active',
  notes              text,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_customers_status   on customers(status);
create index if not exists idx_customers_document on customers(document);

create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  customer_id   uuid not null references customers(id),
  order_date    date,
  delivery_date date,
  payment_terms text not null default '',
  status        order_status not null default 'draft',
  notes         text,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_orders_customer_id on orders(customer_id);
create index if not exists idx_orders_status       on orders(status);
create index if not exists idx_orders_created_at   on orders(created_at);

create table if not exists order_items (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references orders(id) on delete cascade,
  product_id             uuid references products(id),
  product_name           text not null,
  quantity               numeric(18,4) not null default 0,
  unit                   text not null default 'L',
  unit_price_cents       bigint not null default 0,
  package_count          numeric(18,4) not null default 0,
  package_type           text not null default '',
  package_unit_weight_kg numeric(10,3) not null default 0,
  weight_kg              numeric(10,3) not null default 0,
  lot_number             text,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_order_items_order_id   on order_items(order_id);
create index if not exists idx_order_items_product_id on order_items(product_id);

create table if not exists order_documents (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  order_item_id uuid references order_items(id),
  kind          order_doc_kind not null,
  storage_key   text not null unique,
  file_name     text not null,
  content_type  text not null,
  size_bytes    bigint not null,
  metadata      jsonb not null default '{}'::jsonb,
  status        doc_status not null default 'active',
  notes         text,
  uploaded_by   uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_order_docs_order_kind on order_documents(order_id, kind);
create index if not exists idx_order_docs_item        on order_documents(order_item_id);

create table if not exists proposals (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references customers(id),
  number       text unique,
  status       record_status not null default 'draft',
  total_cents  bigint not null default 0,
  valid_until  date,
  version      integer not null default 1,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table if not exists proposal_items (
  id               uuid primary key default gen_random_uuid(),
  proposal_id      uuid not null references proposals(id) on delete cascade,
  product_id       uuid references products(id),
  description      text not null,
  quantity         numeric(18,4) not null default 0,
  unit_price_cents bigint not null default 0
);

-- ---------------------------------------------------------------------------
-- 5. FROTA E LOGÍSTICA
-- ---------------------------------------------------------------------------
create table if not exists vehicles (
  id                    uuid primary key default gen_random_uuid(),
  plate                 text not null unique,
  renavam               text,
  chassis               text,
  brand                 text not null default '',
  model                 text not null,
  model_year            integer,
  vehicle_type          text not null default 'Caminhão',
  capacity_kg           integer,
  capacity_m3           numeric(10,3),
  odometer_km           integer not null default 0,
  maint_interval_km     integer,
  maint_interval_months integer,
  status                vehicle_status not null default 'active',
  notes                 text,
  created_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_vehicles_status on vehicles(status);
create index if not exists idx_vehicles_plate  on vehicles(plate);

create table if not exists vehicle_documents (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references vehicles(id) on delete cascade,
  doc_type     text not null,
  number       text,
  issuing_body text,
  issue_date   date,
  expiry_date  date,
  storage_key  text unique,
  file_name    text,
  content_type text,
  size_bytes   bigint,
  notes        text,
  uploaded_by  uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_vehicle_docs_vehicle on vehicle_documents(vehicle_id);
create index if not exists idx_vehicle_docs_expiry  on vehicle_documents(expiry_date);

create table if not exists vehicle_maintenance (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references vehicles(id) on delete cascade,
  maint_type    text not null default 'Preventiva',
  service_date  date not null,
  odometer_km   integer not null default 0,
  description   text,
  supplier      text,
  cost_cents    bigint not null default 0,
  next_due_km   integer,
  next_due_date date,
  status        record_status not null default 'completed',
  notes         text,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_vehicle_maint_vehicle on vehicle_maintenance(vehicle_id);
create index if not exists idx_vehicle_maint_date    on vehicle_maintenance(service_date);

create table if not exists drivers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  cpf              text unique,
  phone            text,
  license_number   text,
  license_category text,
  license_expiry   date,
  mopp_expiry      date,
  status           record_status not null default 'active',
  notes            text,
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_drivers_status on drivers(status);
create index if not exists idx_drivers_expiry on drivers(license_expiry, mopp_expiry);

create table if not exists routes (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  name                 text not null,
  vehicle_id           uuid not null references vehicles(id),
  driver_id            uuid references drivers(id),
  driver_name          text not null default '',
  route_date           date not null,
  origin_address       text not null default '',
  status               route_status not null default 'draft',
  planned_km           numeric(10,2) not null default 0,
  estimated_cost_cents bigint not null default 0,
  notes                text,
  created_by           uuid references users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_routes_vehicle_date on routes(vehicle_id, route_date);
create index if not exists idx_routes_driver_date  on routes(driver_id, route_date);
create index if not exists idx_routes_status        on routes(status);

create table if not exists route_stops (
  id               uuid primary key default gen_random_uuid(),
  route_id         uuid not null references routes(id) on delete cascade,
  order_id         uuid not null references orders(id),
  sequence         integer not null,
  status           stop_status not null default 'pending',
  address_snapshot text not null default '',
  weight_kg        numeric(10,3) not null default 0,
  package_summary  text not null default '',
  receiving_window text not null default '',
  delivered_at     timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_route_stops_route_sequence on route_stops(route_id, sequence);
create index if not exists idx_route_stops_order           on route_stops(order_id);
alter table customers add column if not exists receiving_window text not null default '';
alter table route_stops add column if not exists receiving_window text not null default '';
alter table vehicles add column if not exists capacity_m3 numeric(10,3);
alter table order_items add column if not exists volume_m3 numeric(10,3) not null default 0;
alter table route_stops add column if not exists volume_m3 numeric(10,3) not null default 0;

create table if not exists route_events (
  id          uuid primary key default gen_random_uuid(),
  route_id    uuid not null references routes(id) on delete cascade,
  stop_id     uuid references route_stops(id),
  event_type  text not null,
  occurred_at timestamptz not null default now(),
  odometer_km numeric(10,2),
  fuel_liters numeric(10,2),
  notes       text,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_route_events_route_time on route_events(route_id, occurred_at);
create index if not exists idx_route_events_stop        on route_events(stop_id);

-- ---------------------------------------------------------------------------
-- 6. FINANCEIRO E RESULTADOS
-- ---------------------------------------------------------------------------
create table if not exists profitability_entries (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid references orders(id),
  customer_id          uuid references customers(id),
  route_id             uuid references routes(id),
  vehicle_id           uuid references vehicles(id),
  region               text not null default '',
  period               date not null,
  revenue_cents        bigint not null default 0,
  gross_profit_cents   bigint not null default 0,
  delivery_cost_cents  bigint not null default 0,
  delivered_weight_kg  numeric(10,3) not null default 0,
  delivery_count       integer not null default 1,
  average_payment_days numeric(6,2),
  source               text not null default 'manual',
  source_key           text,
  notes                text,
  created_by           uuid references users(id),
  created_at           timestamptz not null default now()
);
create index if not exists idx_profitability_period   on profitability_entries(period);
create index if not exists idx_profitability_customer on profitability_entries(customer_id);
create index if not exists idx_profitability_route    on profitability_entries(route_id);
alter table profitability_entries add column if not exists source_key text;
create unique index if not exists idx_profitability_source_key on profitability_entries(source_key) where source_key is not null;

create table if not exists receivables (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references orders(id),
  customer_id  uuid references customers(id),
  description  text not null,
  due_date     date not null,
  amount_cents bigint not null default 0,
  status       record_status not null default 'pending',
  paid_at      timestamptz,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_receivables_due on receivables(due_date);

create table if not exists payables (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid references suppliers(id),
  description  text not null,
  due_date     date not null,
  amount_cents bigint not null default 0,
  status       record_status not null default 'pending',
  paid_at      timestamptz,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_payables_due on payables(due_date);

-- ---------------------------------------------------------------------------
-- 7. RH (ESTRUTURADO)
-- ---------------------------------------------------------------------------
alter table orders add column if not exists source_payload jsonb;
create table if not exists employees (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  role           text,
  department     text,
  admission_date date,
  contract_type  text,
  document       text unique,
  status         record_status not null default 'active',
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_employees_status on employees(status);

create table if not exists epi_deliveries (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references employees(id),
  equipment     text not null,
  ca_number     text,
  delivery_date date not null,
  quantity      integer not null default 1,
  signed        boolean not null default false,
  signature_key text,
  status        record_status not null default 'pending',
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists recruitment_candidates (
  id                       uuid primary key default gen_random_uuid(),
  position                 text not null,
  candidate_name           text not null,
  source                   text,
  interview_date           date,
  salary_expectation_cents bigint,
  status                   record_status not null default 'pending',
  created_by               uuid references users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. EMBALAGEM (ESTRUTURADO)
-- ---------------------------------------------------------------------------
create table if not exists labels (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid references products(id),
  version      text not null default 'v1',
  package_size text,
  responsible  text,
  art_key      text,
  status       record_status not null default 'draft',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists packaging_inventory (
  id         uuid primary key default gen_random_uuid(),
  item_name  text not null,
  category   text,
  unit       text not null default 'un',
  stock      numeric(18,4) not null default 0,
  min_stock  numeric(18,4) not null default 0,
  status     record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 9. INTEGRAÇÃO ERP
-- ---------------------------------------------------------------------------
create table if not exists erp_integrations (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'REST',
  base_url          text not null,
  orders_path       text not null default '/orders',
  api_token         text,
  secret_api_token  text,
  customers_path    text not null default '/clientes',
  goods_receipts_path text not null default '/entradas',
  invoices_path text not null default '/notas-fiscais',
  receivables_path text not null default '/contas-a-receber',
  active            boolean not null default false,
  last_sync_at      timestamptz,
  last_sync_status  text,
  last_sync_message text,
  created_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- TRIGGERS (auditoria + updated_at) — idempotentes
-- ---------------------------------------------------------------------------
do $$
declare t text;
declare tbls text[] := array[
  'records','intake_batches','files','products','lots','suppliers','fispq',
  'licenses','customers','orders','order_items','order_documents','proposals',
  'vehicles','vehicle_documents','vehicle_maintenance','routes','route_stops',
  'route_events','profitability_entries','receivables','payables','employees',
  'epi_deliveries','recruitment_candidates','labels','packaging_inventory',
  'erp_integrations'];
begin
  foreach t in array tbls loop
    execute format('drop trigger if exists trg_%s_audit on %I;', t, t);
    execute format('create trigger trg_%s_audit after insert or update or delete on %I
                    for each row execute function audit_trigger();', t, t);
    execute format('drop trigger if exists trg_%s_updated on %I;', t, t);
    execute format('create trigger trg_%s_updated before update on %I
                    for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
do $$
declare t text;
declare tbls text[] := array[
  'records','intake_batches','files','products','lots','suppliers','fispq',
  'licenses','customers','orders','order_items','order_documents','proposals',
  'proposal_items','vehicles','vehicle_documents','vehicle_maintenance','routes',
  'route_stops','route_events','profitability_entries','receivables','payables',
  'employees','epi_deliveries','recruitment_candidates','labels',
  'packaging_inventory','erp_integrations','users','user_roles','audit_log'];
begin
  foreach t in array tbls loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- leitura liberada a qualquer usuário autenticado (painel interno)
do $$
declare t text;
declare read_tbls text[] := array[
  'records','intake_batches','files','products','lots','suppliers','fispq',
  'licenses','customers','orders','order_items','order_documents','proposals',
  'proposal_items','vehicles','vehicle_documents','vehicle_maintenance','routes',
  'route_stops','route_events','receivables','payables','employees',
  'epi_deliveries','recruitment_candidates','labels','packaging_inventory',
  'erp_integrations'];
begin
  foreach t in array read_tbls loop
    execute format('drop policy if exists p_read on %I;', t);
    execute format('create policy p_read on %I for select to authenticated using (true);', t);
  end loop;
end $$;

-- escrita para direção/gestão (ceo|manager)
do $$
declare t text;
declare mgr_tbls text[] := array[
  'records','intake_batches','files','products','lots','suppliers','fispq',
  'licenses','customers','proposals','proposal_items','vehicle_documents',
  'profitability_entries','receivables','payables','employees','epi_deliveries',
  'recruitment_candidates','labels','packaging_inventory','erp_integrations'];
begin
  foreach t in array mgr_tbls loop
    execute format('drop policy if exists p_write_mgr on %I;', t);
    execute format('create policy p_write_mgr on %I for all to authenticated
                    using (jwt_role() in (''ceo'',''manager''))
                    with check (jwt_role() in (''ceo'',''manager''));', t);
  end loop;
end $$;

-- escrita operacional (ceo|manager|operator)
do $$
declare t text;
declare ops_tbls text[] := array[
  'orders','order_items','order_documents','vehicles','vehicle_maintenance',
  'routes','route_stops','route_events'];
begin
  foreach t in array ops_tbls loop
    execute format('drop policy if exists p_write_ops on %I;', t);
    execute format('create policy p_write_ops on %I for all to authenticated
                    using (jwt_role() in (''ceo'',''manager'',''operator''))
                    with check (jwt_role() in (''ceo'',''manager'',''operator''));', t);
  end loop;
end $$;

-- auditoria e papéis: leitura só direção/gestão
do $$ begin
  execute 'drop policy if exists p_audit_mgr on audit_log;';
  execute 'create policy p_audit_mgr on audit_log for select to authenticated
           using (jwt_role() in (''ceo'',''manager''));';
  execute 'drop policy if exists p_roles_mgr on user_roles;';
  execute 'create policy p_roles_mgr on user_roles for all to authenticated
           using (jwt_role() in (''ceo'',''manager'')) with check (jwt_role() = ''ceo'');';
  execute 'drop policy if exists p_users_self on users;';
  execute 'create policy p_users_self on users for select to authenticated using (true);';
end $$;

-- ---------------------------------------------------------------------------
-- GRANTS (defesa em profundidade)
-- Supabase já concede por default privileges, mas explicitamos para o schema
-- funcionar igual em qualquer projeto. 'anon' NÃO recebe nada: porta fechada.
--   * authenticated → CRUD; o que cada papel pode de fato fazer é decidido
--     pelas policies RLS acima.
--   * service_role   → acesso total (backend confiável, bypassa RLS).
-- ---------------------------------------------------------------------------
do $$ begin
  execute 'grant usage on schema public to authenticated, service_role;';
  execute 'grant select, insert, update, delete on all tables in schema public to authenticated;';
  execute 'grant all on all tables in schema public to service_role;';
  execute 'grant usage, select on all sequences in schema public to authenticated, service_role;';
  execute 'alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;';
  execute 'alter default privileges in schema public grant all on tables to service_role;';
  execute 'alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;';
  -- Supabase concede 'anon' por default privileges herdadas: revogamos para
  -- fechar a porta de fato (RLS ja bloquearia linhas; sem grant nem conecta).
  execute 'revoke all on all tables in schema public from anon;';
  execute 'revoke all on all sequences in schema public from anon;';
  execute 'alter default privileges in schema public revoke all on tables from anon;';
  execute 'alter default privileges in schema public revoke all on sequences from anon;';
end $$;

-- ============================================================================
-- FIM. Após aplicar, popule users/user_roles (RBAC) e, se for migrar dados do
-- D1, faça o ETL dos registros existentes respeitando as FKs acima.
-- ============================================================================
