// Verificacao independente pos-apply (trigger de auditoria + updated_at + RLS).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const token = process.argv[2];
const ref = process.env.PROJECT_REF || "rorhzeiwqvlrmwbvicph";
const here = dirname(fileURLToPath(import.meta.url));
const API = `https://api.supabase.com/v1/projects/${ref}/database/query`;
const run = async (query) => {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
};

let ok = true;
const step = async (label, fn) => {
  try { const v = await fn(); console.log("PASS  " + label + (v !== undefined ? "  -> " + v : "")); }
  catch (e) { ok = false; console.log("FAIL  " + label + "  -> " + e.message); }
};

await step("INSERT em products cria linha em audit_log (trigger)", async () => {
  const r = await run(
    `insert into products(name,category,controlled,un_number)
     values ('__audit_check__','Teste',true,'0000') returning id::text as id`);
  const id = r[0].id;
  const c = await run(`select count(*)::int n from audit_log where entity_type='products' and entity_id='${id}'`);
  await run(`delete from products where id='${id}'`);
  const c2 = await run(`select count(*)::int n from audit_log where entity_type='products' and entity_id='${id}' and action='delete'`);
  await run(`delete from audit_log where entity_id='${id}'`);
  if (c[0].n < 1) throw new Error("audit insert nao registrou");
  if (c2[0].n < 1) throw new Error("audit delete nao registrou");
  return `insert=${c[0].n}, delete=${c2[0].n}`;
});

await step("trigger updated_at altera a coluna", async () => {
  const r = await run(
    `with u as (update products set name=name where name='__none__' returning updated_at, created_at)
     select 1 as x`);
  // teste real: cria, atualiza, compara
  const c = await run(`insert into products(name) values ('__upd__') returning id::text as id, created_at::text as c`);
  await run(`select pg_sleep(1)`);
  await run(`update products set category='Teste' where id='${c[0].id}'`);
  const a = await run(`select (updated_at > created_at) as changed from products where id='${c[0].id}'`);
  await run(`delete from audit_log where entity_id='${c[0].id}'; delete from products where id='${c[0].id}';`);
  if (!a[0].changed) throw new Error("updated_at nao mudou");
  return "ok";
});

await step("FK protege integridade (order_item -> produto inexistente)", async () => {
  try {
    await run(`insert into order_items(order_id,product_id,product_name)
      values ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','x')`);
    throw new Error("FK nao barrou (deveria falhar)");
  } catch (e) {
    if (/foreign key|violates/i.test(e.message)) return "barrado";
    throw e;
  }
});

await step("enums e contagens finais", async () => {
  const t = await run(`select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`);
  const p = await run(`select count(*)::int n from pg_policies where schemaname='public'`);
  const r2 = await run(`select count(*)::int n from pg_tables where schemaname='public' and rowsecurity=true`);
  const e = await run(`select count(*)::int n from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'`);
  return `tabelas=${t[0].n} policies=${p[0].n} rls=${r2[0].n} enums=${e[0].n}`;
});

await step("anon nao tem grant (porta fechada)", async () => {
  const g = await run(`select has_table_privilege('anon','public.products','select') as anon_sel`);
  if (g[0].anon_sel) throw new Error("anon TEM select (deveria ser negado)");
  const a = await run(`select has_table_privilege('authenticated','public.products','select') as a_sel`);
  if (!a[0].a_sel) throw new Error("authenticated NAO tem select");
  return "anon=negado, authenticated=ok";
});

console.log("\n" + (ok ? "VERIFICACAO COMPLETA: OK ✓" : "HA FALHAS ACIMA ✗"));
process.exit(ok ? 0 : 1);
