# Correção da sincronização vhsys

Aplicar `erp-records-fix.sql` antes de publicar a aplicação. É idempotente e não exclui registros. Mantém o índice parcial anterior e cria um índice único completo compatível com o upsert do PostgREST. Permite produtos avulsos nos pedidos, mantendo a chave estrangeira dos produtos cadastrados.

Com as variáveis de ambiente existentes no servidor:

```sh
node --env-file=.env.local scripts/erp-repair.mjs --all
node --env-file=.env.local scripts/erp-verify-production.mjs
```

A verificação é somente leitura e compara cada ID remoto com o banco. A reparação é paginada, pode ser repetida sem duplicar registros e interrompe ao encontrar falha. `--scope contas-pagar` limita a reparação a um módulo. Não altera tokens nem realiza baixas financeiras.

Os registros fiscais/financeiros importados são de consulta no formulário genérico: as alterações devem ser feitas na vhsys e sincronizadas. Produtos, parcelas e payload original ficam disponíveis nos detalhes.

## Reversão

Em caso de falha de publicação, voltar a versão da aplicação sem remover colunas ou dados importados. O esquema é compatível com a versão anterior. Não restaurar `product_id NOT NULL` enquanto existirem itens avulsos; isso exige primeiro um vínculo de catálogo válido, sem inventar produtos. Não remover o índice único enquanto o sincronizador usar `ON CONFLICT(source_key)`.
