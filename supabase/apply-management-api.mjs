// Aplica supabase/schema.sql via Management API do Supabase e verifica.
// Requer um Personal Access Token (PAT, comeca com "sbp_") do dono da conta.
//   node supabase/apply-management-api.mjs "sbp_xxxxx"
// Opcional: PROJECT_REF=xxx node supabase/apply-management-api.mjs sbp_...
//
// O PAT e criado em: https://supabase.com/dashboard/account/tokens
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const token = process.argv[2] || process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF || "rorhzeiwqvlrmwbvicph";
if (!token || !token.startsWith("sbp_")) {
  console.error("Faltou o PAT (sbp_...). Crie em https://supabase.com/dashboard/account/tokens");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "schema.sql"), "utf8");
const API = `https://api.supabase.com/v1/projects/${ref}/database/query`;

const run = async (query) => {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return text; }
};

try {
  console.log(`Aplicando schema no projeto ${ref}...`);
  await run(sql);
  console.log("Schema aplicado. Verificando...\n");

  const tables = await run(
    `select table_name from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE' order by 1`);
  const names = (tables || []).map(r => r.table_name);
  console.log(`Tabelas criadas (${names.length}): ${names.join(", ")}`);

  const pol = await run(`select count(*)::int n from pg_policies where schemaname='public'`);
  const rls = await run(`select count(*)::int n from pg_tables where schemaname='public' and rowsecurity=true`);
  const trg = await run(`select count(*)::int n from information_schema.triggers where trigger_schema='public'`);
  console.log(`Policies: ${pol[0].n} | Tabelas com RLS: ${rls[0].n} | Triggers: ${trg[0].n}`);

  // smoke test de triggers (instrucoes separadas: o Postgres nao ve efeitos
  // de uma CTE de escrita na mesma consulta)
  const ins = await run(
    `insert into products(name,category) values ('__smoke__','t') returning id::text as id`);
  const id = ins[0].id;
  const aud = await run(
    `select count(*)::int n from audit_log where entity_type='products' and entity_id='${id}'`);
  await run(`delete from products where id='${id}';
             delete from audit_log where entity_id='${id}';`);
  console.log(`Trigger de auditoria: ${aud[0].n > 0 ? "OK" : "FALHOU"}`);

  const ok = names.length >= 32 && pol[0].n >= 30 && rls[0].n >= 30;
  console.log("\n" + (ok ? "SUPABASE PRONTO ✓" : "ATENCAO: conferir contagens acima"));
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error("Erro:", e.message);
  process.exit(1);
}
