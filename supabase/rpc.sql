-- ============================================================================
-- RPCs de leitura para a app migrar do D1 (SQLite) para o Supabase (Postgres).
-- Consultas complexas (agregações/joins) viram funções; CRUD simples usa
-- supabase-js direto na tabela. Aplicar com:
--   node supabase/apply-rpc.mjs "sbp_..."
-- ============================================================================

-- Visão de produtos com agregados de lote + última FISPQ (substitui os 3
-- SELECTs de app/api/products/route.ts).
create or replace function products_overview()
returns table (
  id uuid, name text, category text, concentration text, un_number text,
  hazard_class text, signal_word text, h_phrases jsonb, p_phrases jsonb,
  controlled boolean, control_agency text, flammable boolean, storage text,
  status text, notes text, created_at timestamptz, updated_at timestamptz,
  total_lots bigint, total_quantity numeric, next_expiry date,
  fispq_status text, fispq_validity date
) language sql stable as $$
  select p.id, p.name, p.category, p.concentration, p.un_number, p.hazard_class,
         p.signal_word, p.h_phrases, p.p_phrases, p.controlled, p.control_agency,
         p.flammable, p.storage, p.status::text, p.notes, p.created_at, p.updated_at,
         coalesce(s.total_lots, 0)::bigint,
         coalesce(s.total_quantity, 0)::numeric,
         s.next_expiry,
         f.status::text, f.validity_date
  from products p
  left join (
    select product_id, count(*) total_lots, sum(quantity) total_quantity,
           min(expiry_date) next_expiry
    from lots where quantity > 0 group by product_id
  ) s on s.product_id = p.id
  left join lateral (
    select status, validity_date from fispq
    where product_id = p.id order by updated_at desc limit 1
  ) f on true
  order by p.name;
$$;

-- Gráficos/relatórios: produtos controlados (prestação de contas).
create or replace function controlled_products()
returns table (
  id uuid, name text, category text, un_number text, hazard_class text,
  signal_word text, control_agency text, total_quantity numeric, next_expiry date
) language sql stable as $$
  select p.id, p.name, p.category, p.un_number, p.hazard_class, p.signal_word,
         p.control_agency,
         coalesce(sum(l.quantity), 0)::numeric, min(l.expiry_date)
  from products p
  left join lots l on l.product_id = p.id and l.quantity > 0
  where p.controlled
  group by p.id, p.name, p.category, p.un_number, p.hazard_class, p.signal_word, p.control_agency
  order by p.name;
$$;

-- Alertas consolidados para a dashboard (substitui o cálculo em JS de /api/summary).
create or replace function compliance_alerts()
returns table (fispq_missing bigint, fispq_expired bigint, fispq_expiring bigint,
               lots_expired bigint, lots_expiring bigint,
               licenses_expired bigint, licenses_expiring bigint)
language sql stable as $$
  select
    (select count(*) from products p where p.status='active'
       and not exists (select 1 from fispq f where f.product_id=p.id and f.status='active')),
    (select count(*) from fispq where status='active' and validity_date < current_date),
    (select count(*) from fispq where status='active'
       and validity_date >= current_date and validity_date <= current_date + 30),
    (select count(*) from lots where quantity > 0 and expiry_date < current_date),
    (select count(*) from lots where quantity > 0
       and expiry_date >= current_date and expiry_date <= current_date + 30),
    (select count(*) from licenses where status='active' and validity_date < current_date),
    (select count(*) from licenses where status='active'
       and validity_date >= current_date and validity_date <= current_date + 30);
$$;

-- Grants: authenticated executa; anon não.
do $$ begin
  execute 'grant execute on function products_overview() to authenticated, service_role;';
  execute 'grant execute on function controlled_products() to authenticated, service_role;';
  execute 'grant execute on function compliance_alerts() to authenticated, service_role;';
  execute 'revoke all on function products_overview() from anon, public;';
  execute 'revoke all on function controlled_products() from anon, public;';
  execute 'revoke all on function compliance_alerts() from anon, public;';
end $$;
