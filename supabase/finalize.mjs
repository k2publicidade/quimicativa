// Limpeza final dos dados de teste + estado do banco.
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const token = process.argv[2];
const ref = process.env.PROJECT_REF || "rorhzeiwqvlrmwbvicph";
const API = `https://api.supabase.com/v1/projects/${ref}/database/query`;
const run = async (q) => {
  const r = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
};

await run(`delete from audit_log where entity_type='products';
           delete from products;`);
console.log("resíduos de teste removidos.");

const st = await run(`
  select
    (select count(*)::int from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE') as tabelas,
    (select count(*)::int from pg_policies where schemaname='public') as policies,
    (select count(*)::int from pg_tables where schemaname='public' and rowsecurity=true) as com_rls,
    (select count(*)::int from information_schema.triggers where trigger_schema='public') as triggers,
    (select count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public' and t.typtype='e') as enums,
    (select count(*)::int from products) as produtos,
    (select count(*)::int from audit_log) as auditoria`);
console.log(JSON.stringify(st[0], null, 2));
