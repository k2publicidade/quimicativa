# Auditoria de lacunas funcionais — CRM Quimicativa

Data: 11/09/2026 · Escopo: módulos do painel (fluxos "aparentes" vs. reais)

Método: leitura do código-fonte (não build), confrontando UI × API × schema
(`db/schema.ts`). Objetivo: **não declarar pronto o que só tem aparência de
fluxo**.

---

## Resumo por severidade

| Sev | Lacuna | Onde |
|---|---|---|
| P0 | Módulos genéricos gravam dado de negócio como JSON em `records` | `app/module-config.ts` + `app/api/records` |
| P0 | LGPD anonimiza **só** `records` — clientes/pedidos/etc. ficam de fora | `app/api/privacy/route.ts` |
| P0 | Módulos de Logística (Rotas/Entregas/Equipamentos) **inalcançáveis** | `app/Dashboard.tsx` |
| P1 | Contadores/alertas do menu são strings hardcoded (nunca vêm do banco) | `app/Dashboard.tsx` |
| P1 | KPIs do módulo: rótulo promete período, valor é contagem crua | `app/Dashboard.tsx` |
| P1 | Busca do topo promete "clientes, notas, pedidos"; só filtra módulos | `app/Dashboard.tsx` |
| P2 | RBAC sem escopo: `canWrite = role !== viewer` (operador escreve tudo) | `app/api/authz.ts` |
| P2 | Sem UI/API para atribuir papéis; 1º login vira `ceo` | `app/api/authz.ts` |
| P2 | Fonte duplicada: `Clientes`(records) vs `customers`; `Fornecedores`(records) vs `suppliers` | `module-config` vs `db/schema.ts` |
| P2 | "Caminhões – Documentos/Manutenção" (RH) coexistem com o módulo Frota novo | `module-config.ts` |

---

## O que É real (verificado)

- **Centros especializados com backend e validação reais**: Acervo Digital
  (`DocumentCenter` + `/api/documents`,`/api/batches`), Produtos
  (`ProductCenter` + products/lots/fispq/licenses/suppliers/reports), Pedidos
  (`PedidosCenter` + orders/order-docs/dossier/customers), Frota (`FleetCenter`),
  Logística (`LogisticsCenter` + routes/route-events/manifest).
- **Centrais analíticas chamam API de verdade** (não são mock):
  `CommercialInsights`→`/api/crm-insights`, `ManagementIndicators`→
  `/api/management-metrics`, `ProfitabilityCenter`→`/api/profitability`,
  `ErpIntegration`→`/api/integrations`.
- **Confidencialidade aplicada** em `/api/documents` (`canReadConfidential`
  filtra leitura/contagem/upload por `confidentiality`).
- **Auditoria** gravada em `audit_log` nas escritas relevantes.

---

## Detalhe dos achados

### P0-1 — Dado de negócio em `records.metadata` (sem estrutura)
Os módulos de RH, Vendas, Compras, Financeiro e Embalagem são **CRUD genérico**:
gravam em `records` (title/description + `metadata` JSON). Não existe tabela
`employees`, `purchase_orders`, `invoices`, `receivables`, `payables`,
`proposals`, `satisfaction`, `labels`, `packaging_inventory`… Consequências:
sem FK, sem validação de domínio no servidor, sem relatório confiável, sem
integração com o resto do domínio. Ex.: "Pesquisa de Satisfação (NPS 78)",
"Propostas e Orçamentos (R$ 326 mil)" e "Contas a Pagar (R$ 92 mil)" são
**rótulos**, não entidades.

→ Correção: adotar as tabelas estruturadas do schema Supabase
(`employees`, `epi_deliveries`, `recruitment_candidates`, `proposals`,
`receivables`, `payables`, `labels`, `packaging_inventory`) e migrar os
`records` desses setores.

### P0-2 — LGPD cobre apenas `records`
`/api/privacy` faz `SELECT * FROM records` e anonimiza `metadata`. Um cliente
cadastrado no módulo **Pedidos** (tabela `customers`) **não tem como ser
anonimizado** pela UI. O skill exige base legal + anonimização sem quebrar o
histórico. → Correção: estender a anonimização a `customers` (+ contatos em
`orders`) e demais tabelas com dado pessoal; usar a flag `customers.anonymized`
já prevista no schema novo.

### P0-3 — Módulos inalcançáveis no departamento Logística
`app/Dashboard.tsx`: `active === "logistica"` renderiza `<LogisticsCenter>` e
nunca a `DepartmentView`. Logo os módulos declarados do setor — **Rotas,
Entregas, Equipamentos de Transporte** — não têm caminho de UI. A config
`departments.logistica.modules` é código morto. → Correção: ou remover os
módulos genéricos (o `LogisticsCenter` já cobre), ou expô-los.

### P1-1 — KPIs do menu hardcoded
`departments[*].modules[*].count` e `.alert` são literais ("42 ativos",
"186 itens", "R$ 487 mil", "NPS 78", "Margem 24,7%", "1.248 unidades"…). Além de
não virem do banco, **não são renderizados** hoje (as cards de módulo mostram só
nome/descrição) — ou seja, prometem indicadores que não existem. → Correção:
calcular via `/api/summary`/por módulo e renderizar, ou remover os campos.

### P1-2 — Rótulo de KPI ≠ valor
`ModuleWorkspace` mostra `config.kpis[0..2]` com valores
`records.length`, `attention`, `done`. O rótulo promete período/semântica
("Admissões no mês", "Entregas no mês", "Afastamentos"), mas o número é
contagem crua do módulo. → Correção: calcular por período/estado real.

### P1-3 — Busca enganosa
Placeholder "Buscar clientes, notas, pedidos..." mas a busca filtra apenas
nomes de módulos do departamento atual; não há busca global entre registros.

### P2-1 — RBAC sem escopo
`authz.ts`: `canWrite = role !== "viewer"` → `operator` escreve **tudo**
(financeiro incluído). `canReadConfidential = role === "ceo"` (o skill pede
direção **+ gestores**). Não há API/tela para atribuir papéis; o primeiro login
vira `ceo` automaticamente — depois disso, papéis só mudam por SQL direto.

### P2-2/2-3 — Fontes duplicadas
`Clientes` (Vendas, records) × `customers` (Pedidos); `Fornecedores` (Compras,
records) × `suppliers` (Produtos); `Caminhões – Documentos/Manutenção` (RH,
records) × módulo Frota. Duas verdades para o mesmo dado.

---

## Recomendação de ordem

1. Estruturar os domínios genéricos em tabelas (P0-1) — já pronto no
   `supabase/schema.sql`.
2. Estender LGPD a `customers`/pessoais (P0-2).
3. Resolver módulos inalcançáveis de Logística (P0-3).
4. Trocar KPIs hardcoded por cálculo real, ou removê-los (P1-1/P1-2).
5. Escopo de RBAC + gestão de papéis (P2-1).
6. Deduplicar Clientes/Fornecedores/Frota (P2-2).
