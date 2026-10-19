# Operação, galpão e RH — Implementation Plan

**Goal:** Integrar preparação de pedidos, jornada e retorno do motorista, controle de embalagens/equipamentos, equipe, férias, cestas e EPIs.

**Architecture:** Manter pedidos, rotas, eventos, documentos e frota existentes. Guardar as novas entidades em `records`, com chaves exclusivas `ops:*`, metadados validados e escritas atômicas pelo RPC transacional existente. Isso permite usar o banco atual sem migração destrutiva. Separar cadastro de pessoa de acesso ao sistema. Nenhum CPF, admissão, habilitação, quantidade ou manutenção será inventado.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase/PostgreSQL, camada getD1 existente.

## Execução

1. Criar domínio `lib/operations.ts`: equipe informada (Francisco com duas funções), tipos de estoque, EPIs, datas locais, validação e cálculo de pendências e ciclos.
2. Criar repositório/API autenticada de operações: cadastro idempotente da equipe, RH, preparação por pedido, estoque com histórico e saldo não negativo, jornada, relatórios e liquidação de bombonas. Preservar registros existentes e rejeitar edições concorrentes.
3. Acrescentar canhoto ao upload privado de documentos. Exigir relatório por parada para encerrar entrega/rota. Atualizar hodômetro ao registrar jornada e manter trilha de alterações na rota.
4. Criar telas de RH e galpão, visão de funcionários em serviço e controles na rota. Mostrar pedidos e materiais lado a lado com filtro de hoje/amanhã, necessidade e tipo de bomba e tamanho do mangote.
5. Acrescentar ciclos de óleo/filtros (5.000 km), limpeza (14 dias) e revisão geral (3 meses), independentes, com registros e alertas. Revisão de EPI trimestral por funcionário, com histórico.
6. Validar regras de negócio (datas reais, dívida acumulada e baixas, estoque, equipamentos, férias sobrepostas, revisões independentes), APIs, TypeScript, lint e build. Verificar interface em tamanhos desktop/móvel quando o ambiente permitir.

## Critérios

- Cabeçalho da jornada mostra motorista, ajudantes, hora e km; retorno guarda descrição, relatório, observação, embalagens e canhoto.
- Alterações de rota preservam antes/depois, motivo, autor e hora. Não encerrar jornada sem resolver todas as paradas e relatórios.
- Saldo do galpão começa sem contagem confirmada. Necessidades são explícitas; separação não altera estoque silenciosamente.
- Férias e cesta vinculadas ao funcionário; EPI com quantidade, CA quando aplicável, entrega, aceite e revisão.
- Cadastro inicial não substitui pessoas existentes nem cria contas de acesso; Francisco tem Compras e Gerência Geral.
- Mudanças locais anteriores em logística, ERP e dashboard são preservadas.
