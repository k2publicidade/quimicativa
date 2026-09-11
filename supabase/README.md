# Supabase — Schema do CRM Quimicativa

**STATUS: APLICADO EM PRODUÇÃO** no projeto `rorhzeiwqvlrmwbvicph`
(11/09/2026) — 32 tabelas, 60 policies, 32 tabelas com RLS, 112 triggers,
10 enums. Verificado por dois canais independentes (Management API + PostgREST).

Estrutura de banco **completa e validada** do CRM para produção, derivada de
`db/schema.ts` (D1/SQLite) e estendida com as tabelas estruturadas que hoje
vivem soltas em `records.metadata`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `schema.sql` | DDL PostgreSQL completo: 32 tabelas, enums, triggers de auditoria e `updated_at`, RLS + policies, grants. **Idempotente**. |
| `apply-management-api.mjs` | Aplica via Management API do Supabase (precisa de PAT `sbp_...`) + verifica. |
| `apply.mjs` | Aplica via conexão Postgres direta (precisa da connection string). |
| `verify.mjs` | Verificação independente (trigger de auditoria, updated_at, FK, RLS, grants). |
| `finalize.mjs` | Limpa resíduos de teste e imprime o estado final do banco. |

## Como reaplicar

```bash
# via Management API (PAT em https://supabase.com/dashboard/account/tokens)
node supabase/apply-management-api.mjs "sbp_..."
node supabase/verify.mjs "sbp_..."

# ou via Postgres direto
node supabase/apply.mjs "postgresql://postgres.rorhzeiwqvlrmwbvicph:SENHA@aws-....pooler.supabase.com:5432/postgres"
```

> Segurança: o PAT é de escopo de conta. **Revogue-o** em
> https://supabase.com/dashboard/account/tokens quando o trabalho terminar.


## O que o schema cobre

- **Núcleo/auditoria/RBAC**: `users`, `user_roles`, `audit_log` (escrita por
  trigger `SECURITY DEFINER`, não por código de app).
- **Acervo digital**: `records`, `intake_batches`, `files` (checksum SHA-256,
  OCR, confidencialidade, versão, revisão humana).
- **Produtos & compliance**: `products` (GHS: frases H/P, controlado, ONU),
  `lots` (validade obrigatória/FEFO), `suppliers`, `fispq` (validade
  obrigatória), `licenses`.
- **Vendas**: `customers` (base legal LGPD + flag `anonymized`), `orders`
  (PED-####), `order_items`, `order_documents` (nf/boleto/laudo/ficha),
  `proposals`/`proposal_items`.
- **Frota/logística**: `vehicles`, `vehicle_documents`, `vehicle_maintenance`,
  `routes`, `route_stops`, `route_events`.
- **Financeiro**: `profitability_entries`, `receivables`, `payables`.
- **RH**: `employees`, `epi_deliveries`, `recruitment_candidates`.
- **Embalagem**: `labels`, `packaging_inventory`.
- **ERP**: `erp_integrations`.

## Segurança (RLS)

- RLS habilitado em **todas** as tabelas.
- `jwt_role()` lê o papel do JWT (`ceo|manager|operator|viewer`).
- **viewer** lê, não escreve · **operator** escreve em operação (pedidos, frota,
  rotas) · **manager/ceo** escrevem tudo · `profitability_entries` e `audit_log`
  restritos a direção/gestão.
- `anon` não recebe **nenhum** grant — porta fechada.
- Backend confiável (service_role) bypassa RLS.

## Verificação já feita (Postgres real, 16/16)

DDL aplica · idempotente · 32 tabelas · 60 policies · trigger de auditoria
(`SECURITY DEFINER`) grava em cada escrita · `updated_at` atualiza · FK barra
referência inválida · RLS: viewer lê/`viewer` não escreve/ceo escreve/anon
negado.

## Próximo passo (fora deste arquivo)

Mapear as rotas `/api/*` (hoje Drizzle/SQLite) para o cliente Postgres e migrar
os dados existentes do D1 respeitando as FKs. As tabelas `records` genéricas
podem ser progressivamente substituídas pelas tabelas estruturadas desta lista.
