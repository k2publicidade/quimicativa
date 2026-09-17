-- ============================================================================
-- Camada de compatibilidade: RPC de execucao + RLS/grants.
-- Aplicar depois de schema-app.sql:
--   node supabase/apply-file.mjs supabase/app-extras.sql "sbp_..."
--
-- POR QUE: o app roda em Cloudflare Workers (sem TCP para o Postgres) e todo o
-- codigo usa SQL parametrizado sobre o D1. Este RPC deixa o Postgres executar
-- esse mesmo SQL via HTTPS, mantendo as 28 rotas SEM ALTERACAO.
-- ============================================================================

-- As RPCs antigas (tipos uuid) foram substituidas pelas tabelas fieis ao app.
drop function if exists products_overview();
drop function if exists controlled_products();
drop function if exists compliance_alerts();

-- Executa um SQL (literais ja escapados pela camada de acesso no servidor) e
-- devolve as linhas como JSON. SECURITY DEFINER porque roda como dono, e o
-- acesso e restrito a service_role (nunca anon/authenticated).
create or replace function exec_sql(query text, expect_rows boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  out jsonb := '[]'::jsonb;
begin
  if query is null or length(btrim(query)) = 0 then
    raise exception 'exec_sql: consulta vazia';
  end if;
  if expect_rows or query ~* '\mreturning\M' then
    -- Envolve em CTE: permite SELECT e tambem INSERT/UPDATE/DELETE ... RETURNING
    execute format(
      'with __r as (%s) select coalesce(jsonb_agg(to_jsonb(__r)), ''[]''::jsonb) from __r',
      query
    ) into out;
  else
    execute query;
    out := '[]'::jsonb;
  end if;
  return coalesce(out, '[]'::jsonb);
end $$;

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

-- Apenas o backend (service_role) pode executar.
revoke all on function exec_sql(text, boolean) from public, anon, authenticated;
grant execute on function exec_sql(text, boolean) to service_role;

-- Executa VARIAS instrucoes numa unica transacao (equivalente ao db.batch do D1).
-- Dentro de uma funcao PL/pgSQL tudo roda numa transacao: ou aplica tudo, ou nada.
create or replace function exec_sql_batch(queries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q text;
  out jsonb := '[]'::jsonb;
  r jsonb;
begin
  if queries is null or jsonb_typeof(queries) <> 'array' then
    raise exception 'exec_sql_batch: esperado um array de consultas';
  end if;
  for q in select jsonb_array_elements_text(queries) loop
    if q ~* '\mreturning\M' then
      execute format(
        'with __r as (%s) select coalesce(jsonb_agg(to_jsonb(__r)), ''[]''::jsonb) from __r',
        q
      ) into r;
    else
      execute q;
      r := '[]'::jsonb;
    end if;
    out := out || jsonb_build_array(r);
  end loop;
  return out;
end $$;

revoke all on function exec_sql_batch(jsonb) from public, anon, authenticated;
grant execute on function exec_sql_batch(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- RLS + policies
-- O backend usa service_role (ignora RLS) e aplica o RBAC em codigo, como
-- antes. O RLS protege o acesso direto pelo navegador (role authenticated).
-- ---------------------------------------------------------------------------
-- Importação idempotente da planilha de lucratividade.
alter table profitability_entries add column if not exists source_key text;
create unique index if not exists idx_profitability_source_key
  on profitability_entries(source_key) where source_key is not null;
alter table customers add column if not exists receiving_window text not null default '';
alter table route_stops add column if not exists receiving_window text not null default '';
alter table erp_integrations add column if not exists secret_api_token text;
alter table erp_integrations add column if not exists customers_path text not null default '/clientes';
alter table erp_integrations add column if not exists goods_receipts_path text not null default '/entradas';
alter table erp_integrations add column if not exists invoices_path text not null default '/notas-fiscais';
alter table erp_integrations add column if not exists receivables_path text not null default '/contas-a-receber';

-- ---------------------------------------------------------------------------
do $$
declare t text;
declare app_tables text[] := array[
  'users','records','intake_batches','files','audit_log','products','lots',
  'suppliers','fispq','licenses','customers','orders','order_items',
  'order_documents','vehicles','vehicle_documents','vehicle_maintenance','drivers',
  'routes','route_stops','route_events','erp_integrations','profitability_entries'];
begin
  foreach t in array app_tables loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists p_read on %I;', t);
    execute format('create policy p_read on %I for select to authenticated using (true);', t);
  end loop;
end $$;

-- Escrita direta pelo navegador: apenas direcao/gestores (operacao usa o backend).
do $$
declare t text;
declare write_tables text[] := array[
  'records','intake_batches','files','products','lots','suppliers','fispq',
  'licenses','customers','orders','order_items','order_documents','vehicles',
  'vehicle_documents','vehicle_maintenance','drivers','routes','route_stops',
  'route_events','erp_integrations','profitability_entries'];
begin
  foreach t in array write_tables loop
    execute format('drop policy if exists p_write_mgr on %I;', t);
    execute format(
      'create policy p_write_mgr on %I for all to authenticated
         using (jwt_role() in (''ceo'',''manager''))
         with check (jwt_role() in (''ceo'',''manager''));', t);
  end loop;
end $$;

-- audit_log: leitura só direção/gestão (ja tem p_read das outras; sobrescreve).
drop policy if exists p_read on audit_log;
drop policy if exists p_audit_mgr on audit_log;
create policy p_audit_mgr on audit_log for select to authenticated
  using (jwt_role() in ('ceo','manager'));

-- Grants: service_role tudo; authenticated leitura; anon NADA.
do $$ begin
  execute 'grant usage on schema public to authenticated, service_role;';
  execute 'grant select on all tables in schema public to authenticated;';
  execute 'grant all on all tables in schema public to service_role;';
  execute 'grant usage, select on all sequences in schema public to authenticated, service_role;';
  execute 'revoke all on all tables in schema public from anon;';
  execute 'revoke all on all sequences in schema public from anon;';
  execute 'alter default privileges in schema public revoke all on tables from anon;';
end $$;
