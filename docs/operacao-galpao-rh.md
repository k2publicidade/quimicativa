# Operação, galpão, RH e manutenção

## Equipe

Ao abrir **Recursos Humanos** com perfil de gestão, o sistema completa o cadastro das 17 pessoas fornecidas. **Cadastrar equipe informada** permite repetir a ação: compara nomes/apelidos e preserva cadastros existentes. Francisco recebe Compras e Gerência Geral no mesmo cadastro. Eucimar (Loirinho) e Antonio (Tonhão) também são cadastrados em Motoristas. CNH, MOPP, datas contratuais e dados ausentes precisam ser conferidos; o cadastro de pessoa não cria uma conta de acesso.

Funcionários em serviço é acessível separadamente aos operadores, com jornada e retornos. Informações contratuais, férias, benefícios e EPIs são geridos por direção e gerentes.

## Galpão e roteiro do dia seguinte

**Galpão e estoque** abre na data de amanhã. Hoje e todos os pendentes também estão disponíveis, incluindo pedidos sem data. Cada pedido exibe seus produtos e sua preparação: bombonas, tampas, lacres, IBCs 1000L, necessidade/tipo/quantidade de bombas, necessidade/tamanho de mangote, abraçadeiras, engates rápidos e carrinhos. A preparação guarda observação, data e responsável. O botão Montar rota encaminha o pedido à logística.

O estoque distingue modelos de bomba e tamanhos de mangote. Cadastre os materiais, registre uma contagem inicial e depois entradas, saídas e ajustes com motivo. Saldo insuficiente e gravação desatualizada são rejeitados. O histórico guarda saldo anterior, posterior e responsável. Preparar um pedido não movimenta estoque automaticamente: entradas e saídas físicas devem ser registradas.

## Jornada, entregas e canhotos

1. Monte a rota em Logística com veículo, motorista, data, origem e pedidos.
2. Na ficha da equipe, confirme os ajudantes ou a saída sem ajudantes.
3. Registre saída, data/hora de Brasília e km. O sistema atualiza o odômetro do caminhão.
4. Para cada parada, registre descrição do pedido, resultado, relatório do motorista, observações, bombonas esperadas e devolvidas. Anexe o canhoto e identifique o recebedor, ou justifique sua pendência.
5. Confirme o encerramento de cada parada. Entregas parciais e não realizadas encerram como não integrais e podem ser replanejadas depois de fechar a rota.
6. Ao retornar ao galpão, informe hora, km e resumo. Todas as paradas devem estar encerradas e possuir relatório.

O histórico registra alterações de sequência e desvios informados, com autor, horário e motivo; alterações de planejamento preservam antes/depois. O romaneio PDF inclui equipe, horários/km, informações do galpão e retorno de cada pedido. Canhotos ficam no armazenamento privado e no dossiê/documentos do pedido. Um canhoto que chegar depois pode ser vinculado ao relatório da rota concluída; resultado e quantidades encerradas são preservados.

**Bombonas a recolher** mostra dívida por cliente e pedido e permite baixas parciais ou totais. A baixa não substitui o registro da entrada física no estoque.

## RH e EPI

- Férias: período e situações planejadas, aprovadas, concluídas ou canceladas; períodos sobrepostos são recusados e férias aprovadas são consideradas na escala.
- Cesta básica: competência, entrega, recebedor e observações; uma por funcionário/mês.
- EPI/uniforme: luvas, óculos, capacete, avental, capa de chuva, bota, calça, blusa e camisa, com quantidade, tamanho, CA, entrega e aceite.
- Revisão trimestral: condição de cada um dos nove itens, responsável, necessidade de reposição, histórico e próxima revisão em três meses. Sem histórico aparece como revisão inicial necessária.

## Frota

Em **Frota → Manutenções**, cada caminhão tem três ciclos independentes:

| Serviço | Vencimento após o último serviço concluído do mesmo tipo |
| --- | --- |
| Óleo e filtros | 5.000 km |
| Limpeza geral | 14 dias |
| Revisão geral | 3 meses de calendário |

Sem histórico, a agenda pede o último serviço, sem presumir que esteja em dia. Os registros anteriores permanecem no histórico de manutenção.

## Persistência e validação

As novas entidades usam a tabela `records`, com chaves únicas `ops:*`, metadados validados e trilha em `audit_log`. Usa os RPCs `exec_sql`/`exec_sql_batch` e o índice único de `records.source_key` que já fazem parte do banco Supabase do projeto. Não requer recriar tabelas. Não executar `schema-app.sql` em produção: o arquivo é uma recriação de schema e é usado apenas no PostgreSQL em memória dos testes.

`npm run test:operations` executa as APIs contra PostgreSQL em memória (PGlite), os RPCs e a camada de acesso reais, com sessão/armazenamento simulados e sem tocar na produção. Também são verificáveis `npm run test:schema`, `npm run test:classifier`, `npx tsc --noEmit`, `npm run lint` e `npm run build`.

Teste de interface isolado: execute `npm run test:operations -- --serve`, `npm run dev -- --port 3019` e `python scripts/operations-ui-test.py` (Python Playwright instalado). Todas as chamadas da interface são redirecionadas ao banco local de teste; o código de produção não possui modo de bypass de autenticação.
