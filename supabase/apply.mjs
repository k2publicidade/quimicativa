// Aplica supabase/schema.sql num banco Postgres (Supabase) e VERIFICA o resultado.
// Uso:
//   node supabase/apply.mjs "postgresql://postgres.<ref>:<senha>@aws-...pooler.supabase.com:6543/postgres"
// ou defina DATABASE_URL no ambiente.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "schema.sql");
const url = process.argv[2] || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!url) {
  console.error("Faltou a connection string. Passe como argumento ou em DATABASE_URL.");
  process.exit(2);
}

const sql = readFileSync(sqlPath, "utf8");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const EXPECTED_TABLES = [
  "users","audit_log","user_roles","records","intake_batches","files","products",
  "lots","suppliers","fispq","licenses","customers","orders","order_items",
  "order_documents","proposals","proposal_items","vehicles","vehicle_documents","drivers",
  "vehicle_maintenance","routes","route_stops","route_events","profitability_entries",
  "receivables","payables","employees","epi_deliveries","recruitment_candidates",
  "labels","packaging_inventory","erp_integrations",
];

try {
  await client.connect();
  console.log("Conectado. Aplicando schema...");
  await client.query(sql);
  console.log("Schema aplicado. Verificando...\n");

  const t = await client.query(
    `select table_name from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE'`);
  const have = new Set(t.rows.map(r => r.table_name));
  const missing = EXPECTED_TABLES.filter(x => !have.has(x));
  console.log(`Tabelas: ${have.size} no total | faltando: ${missing.length ? missing.join(", ") : "nenhuma"}`);

  const p = await client.query(`select count(*)::int n from pg_policies where schemaname='public'`);
  const r = await client.query(`select count(*)::int n from pg_tables where schemaname='public' and rowsecurity=true`);
  const tg = await client.query(
    `select count(*)::int n from information_schema.triggers where trigger_schema='public'`);
  console.log(`Policies: ${p.rows[0].n} | Tabelas com RLS: ${r.rows[0].n} | Triggers: ${tg.rows[0].n}`);

  // smoke test de triggers (rollback para não sujar dados)
  await client.query("begin");
  const ins = await client.query(
    `insert into products(name,category) values ('__smoke__','test') returning id`);
  const aud = await client.query(
    `select count(*)::int n from audit_log where entity_type='products' and entity_id=$1`,
    [ins.rows[0].id]);
  await client.query("rollback");
  console.log(`Trigger de auditoria: ${aud.rows[0].n > 0 ? "OK" : "FALHOU"}`);

  const ok = missing.length === 0 && p.rows[0].n >= 30 && r.rows[0].n >= 30 && aud.rows[0].n > 0;
  console.log("\n" + (ok ? "SUPABASE PRONTO ✓" : "ATENCAO: verificar itens acima"));
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error("Erro:", e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
