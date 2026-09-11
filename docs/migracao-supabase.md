# Migração D1 → Supabase (Postgres) — plano e decisões

Data: 11/09/2026 · Projeto Supabase: `rorhzeiwqvlrmwbvicph`

## Status

| Item | Estado |
|---|---|
| Schema Postgres completo aplicado | ✅ 32 tabelas, RLS, auditoria por trigger |
| RPCs de leitura (agregações/joins) | ✅ `products_overview`, `controlled_products`, `compliance_alerts` |
| Fluxo real pela via da app (HTTPS/PostgREST) | ✅ spike 7/7 ao vivo (insert → RPC → update → auditoria → delete) |
| Código da app apontando para o Supabase | ❌ **ainda usa D1/Drizzle** — não iniciado |

## Como a app fala com o banco (decisão de arquitetura)

A app roda em **Cloudflare Workers** (`import { env } from 'cloudflare:workers'`,
bindings D1 + R2). Workers **não** abre conexão TCP comum para o Postgres do
Supabase de forma confiável. Dois caminhos:

- **A (recomendado): HTTPS/PostgREST via `@supabase/supabase-js`.** A app fala
  com o Supabase por HTTPS (mesma origem dos dados), com a service key no
  servidor. CRUD simples = `supabase.from(tabela)`; consultas com join/agregação
  = funções RPC (já criadas). Foi esse o caminho **testado no spike**.
- **B: driver Postgres sobre `cloudflare:sockets`** (ex. `postgres` + adapter CF).
  Mantém SQL cru, mas depende de suporte a sockets/portas no runtime e é mais
  frágil no deploy.

→ Adotar **A**.

## Decisões que mudam o custo da migração

### 1. Tipo da chave primária — uuid (aplicado) vs bigserial

O schema aplicado usa **uuid** (idiomático no Supabase). A app, porém, é toda
construída sobre **id numérico** do SQLite (`id: number`, `Number(id)`,
`/api/products?id=3`). Migrar para uuid obriga a trocar tipos e parsing em todas
as ~27 rotas **e** nos tipos do front.

- **Manter uuid**: design melhor; custo = mexer tipos/parsing em app e UI.
- **Trocar para `bigserial`**: a app mantém os ids numéricos; a migração vira
  quase mecânica (dialeto SQL + driver) e **preserva os ids originais** — o que
  dispensa remapear FKs no ETL dos dados do D1.

**Recomendação:** `bigserial` — menor risco e ETL mais simples para um CRM
interno que já funciona. Como o banco está vazio, a troca é imediata.
*(Se preferir uuid, o custo é maior só no código, não no banco.)*

### 2. Datas — epoch (app) vs timestamptz (Postgres)

A app guarda datas como **inteiro unix (segundos)** e usa `updated_at * 1000`.
O Postgres usa `timestamptz`/`date`. Precisa de uma camada: na leitura,
`Date → Math.floor(t/1000)`; na escrita, `to_timestamp($n)`. Alternativa mais
limpa: migrar a app para ISO (`new Date(row.updated_at)`), ajustando os pontos
que hoje multiplicam por 1000.

**Recomendação:** converter na borda (camada de acesso) para não tocar a UI.

### 3. Arquivos — R2 (atual) vs Supabase Storage

Hoje os anexos (Acervo Digital, laudos/fichas de pedido, docs de veículo) vão
para o **R2** por binding. Ou se mantém o R2 (o Supabase guarda só a referência)
ou se migra para o **Supabase Storage**. Mantê-los no R2 é o de menor risco —
o schema já guarda só `storage_key`/`file_key`.

## Trabalho por grupo de rotas (27 arquivos em `app/api/`)

1. **Infra**: `db/supabase.ts` (cliente service-role) + helper de conversão de
   datas; remover `getD1()` das rotas migradas.
2. **Auth/RBAC**: `authz.ts` passa a ler `users`/`user_roles` no Postgres
   (mesmos papéis ceo/manager/operator/viewer).
3. **Produtos/compliance** (já com RPC pronta): `products`, `lots`, `fispq`,
   `licenses`, `suppliers`, `batches`, `reports`, `summary`.
4. **Acervo**: `documents` (upload/download via R2 mantido; OCR inalterado).
5. **Vendas/pedidos**: `customers`, `orders`, `order-docs`, `orders/dossier`.
6. **Frota/logística**: `vehicles`, `vehicle-docs`, `vehicle-maintenance`,
   `routes`, `routes/manifest`, `route-events`.
7. **Analíticos**: `crm-insights`, `management-metrics`, `profitability`,
   `integrations`, `integrations/sync`.
8. **LGPD**: `privacy` — **estender para `customers`** (hoje só cobre `records`).
9. **Dashboard**: `records` (genérico) — decidir se continua como tabela livre
   ou se os módulos passam a usar as tabelas estruturadas novas.

## Variáveis de ambiente

No runtime da app:
```
SUPABASE_URL=https://rorhzeiwqvlrmwbvicph.supabase.co
SUPABASE_SECRET_KEY=<service key>   # só no servidor, nunca no cliente
```
A `publishable` (anon) fica para uso no browser, se necessário.

## Riscos

- **Idempotência de escrita**: hoje o D1 usa `RETURNING *`; no PostgREST o
  equivalente é `Prefer: return=representation`. Conferir cada rota.
- **RLS**: a service key bypassa RLS; o RBAC continua sendo aplicado em código
  (`authz.ts`). Não confiar no RLS como única barreira enquanto a app usar
  service key.
- **Locking otimista**: `documents` já usa `version`; manter no Postgres.
- **ETL**: migrar dados do D1 respeitando FKs — com `bigserial`, preservar ids.
