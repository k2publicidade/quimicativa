// Gera supabase/schema-app.sql — Postgres FIEL ao SQLite do Drizzle, para que o
// app atual (ids numericos, datas epoch, booleanos 0/1, JSON text) rode sem
// alteracao de codigo. Le drizzle/*.sql em ordem e:
//   - converte pk para bigserial e demais inteiros para bigint
//   - real -> double precision
//   - extrai as FKs inline e as recria como ALTER TABLE depois de tudo criado
//     (no Postgres, FK para tabela inexistente falha se declarada inline)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "drizzle");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

function convertType(sql) {
  return sql
    .replace(/`/g, '"')
    .replace(/"integer"\s+PRIMARY\s+KEY\s+AUTOINCREMENT\s+NOT\s+NULL/gi, "bigserial primary key")
    .replace(/"integer"\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "bigserial primary key")
    .replace(/"integer"\s+PRIMARY\s+KEY\s+NOT\s+NULL/gi, "bigserial primary key")
    .replace(/"integer"\s+PRIMARY\s+KEY/gi, "bigserial primary key")
    .replace(/\binteger\s+PRIMARY\s+KEY\s+AUTOINCREMENT\s+NOT\s+NULL\b/gi, "bigserial primary key")
    .replace(/\binteger\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, "bigserial primary key")
    .replace(/\binteger\s+PRIMARY\s+KEY\s+NOT\s+NULL\b/gi, "bigserial primary key")
    .replace(/\binteger\s+PRIMARY\s+KEY\b/gi, "bigserial primary key")
    .replace(/"integer"/gi, "bigint")
    .replace(/\binteger\b/gi, "bigint")
    .replace(/"real"/gi, "double precision")
    .replace(/\breal\b/gi, "double precision")
    .replace(/\bAUTOINCREMENT\b/gi, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const creates = [];
const others = [];
const fkStatements = [];
let fkSeq = 0;

for (const f of files) {
  const raw = readFileSync(join(dir, f), "utf8");
  for (let s of raw.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean)) {
    s = convertType(s).replace(/;\s*$/, "");
    if (!s) continue;
    // ignora pragmas e instrucoes exclusivas do SQLite
    if (/^\s*pragma\b/i.test(s)) continue;
    if (/^\s*(create|alter|insert|update|delete|comment)\b/i.test(s) === false) continue;
    const m = s.match(/create table\s+(?:if not exists\s+)?"?(\w+)"?/i);
    if (m) {
      const table = m[1];
      const fks = [];
      // remove as linhas de FK do corpo e guarda para recriar depois
      const body = s.replace(
        /,?\s*FOREIGN KEY \(([^)]+)\) REFERENCES "?(\w+)"?\("?(\w+)"?\)([^,)]*)/gi,
        (_full, cols, refTable, refCol, tail) => {
          fkSeq += 1;
          fks.push(
            `alter table "${table}" add constraint "fk_${table}_${fkSeq}"` +
              ` foreign key (${cols}) references "${refTable}"(${refCol})${tail ? " " + tail.trim() : ""};`,
          );
          return "";
        },
      ).replace(/,\s*\)/g, "\n)");
      creates.push({ file: f, table, sql: body });
      fkStatements.push(...fks);
    } else {
      others.push({ file: f, sql: s });
    }
  }
}

const out = [];
out.push("-- GERADO por supabase/gen-from-drizzle.mjs — NAO EDITE A MAO.");
out.push("-- Postgres fiel ao SQLite: bigserial, bigint(epoch), 0/1, JSON text.");
out.push("-- Assim o app atual (baseado em D1) roda igual sobre o Supabase.\n");
out.push("-- limpeza: derruba as tabelas do app (preserva schema public e grants).");
for (const c of creates) out.push(`drop table if exists "${c.table}" cascade;`);
out.push("");
out.push("-- ===== TABELAS =====");
for (const c of creates) out.push(c.sql + ";\n");
out.push("-- ===== CHAVES ESTRANGEIRAS =====");
out.push(...fkStatements);
out.push("");
out.push("-- ===== INDICES E ALTERACOES =====");
out.push(...others.map((o) => o.sql + ";"));

writeFileSync(join(root, "supabase", "schema-app.sql"), out.join("\n"), "utf8");
console.log("gerado supabase/schema-app.sql");
console.log(`tabelas (${creates.length}): ${creates.map((c) => c.table).join(", ")}`);
console.log(`fks recriadas: ${fkStatements.length}`);
