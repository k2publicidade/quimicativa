// Migra os dados do D1 (Cloudflare) para o Supabase, preservando os IDs.
//
//   node scripts/migrate-d1-to-supabase.mjs "<nome-ou-id-do-banco-D1>" [--dry-run]
//
// Pre-requisitos: `npx wrangler login` feito, e env SUPABASE_URL + SUPABASE_SECRET_KEY.
// Ordem respeita as chaves estrangeiras; IDs sao preservados e as sequences
// (bigserial) sao reajustadas no fim para o proximo INSERT nao colidir.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const dbName = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!dbName) {
  console.error("Informe o nome/id do banco D1. Ex.: node ... \"site-creator-d1\"");
  process.exit(2);
}
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SECRET_KEY;
if (!SB || !SK) { console.error("Defina SUPABASE_URL e SUPABASE_SECRET_KEY."); process.exit(2); }

// Ordem de insercao (pais antes de filhos)
const TABLES = [
  "users", "records", "intake_batches", "products", "lots", "suppliers", "fispq",
  "licenses", "customers", "orders", "order_items", "order_documents",
  "vehicles", "vehicle_documents", "vehicle_maintenance", "routes", "route_stops",
  "route_events", "erp_integrations", "profitability_entries", "files", "audit_log",
];

const literal = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
};

function readD1(table) {
  const out = execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", `SELECT * FROM "${table}"`],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: process.platform === "win32" },
  );
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return (first?.results ?? []).map((row) => row);
}

const rpc = async (fn, args) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

const report = [];
for (const table of TABLES) {
  let rows;
  try {
    rows = readD1(table);
  } catch (e) {
    report.push(`${table}: FALHA ao ler do D1 — ${String(e.message).split("\n")[0]}`);
    continue;
  }
  if (!rows.length) { report.push(`${table}: 0 linhas`); continue; }

  const columns = Object.keys(rows[0]);
  const statements = rows.map((row) => {
    const cols = columns.map((c) => `"${c}"`).join(",");
    const vals = columns.map((c) => literal(row[c])).join(",");
    return `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING`;
  });

  if (dryRun) { report.push(`${table}: ${rows.length} linhas (dry-run)`); continue; }

  try {
    // em blocos, para nao estourar o payload
    for (let i = 0; i < statements.length; i += 200) {
      await rpc("exec_sql_batch", { queries: statements.slice(i, i + 200) });
    }
    const { data } = await rpc("exec_sql", { query: `SELECT COUNT(*)::int n FROM "${table}"`, expect_rows: true }).then((d) => ({ data: d }));
    report.push(`${table}: ${rows.length} migradas (total agora: ${data?.[0]?.n})`);
  } catch (e) {
    report.push(`${table}: ERRO ao gravar — ${String(e.message).slice(0, 200)}`);
  }
}

// Reajusta as sequences dos ids preservados
if (!dryRun) {
  const fixes = TABLES.map(
    (t) => `SELECT setval(pg_get_serial_sequence('"${t}"','id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1))`,
  );
  const reset = TABLES.filter((t) => t !== "users").map(
    (t) => `SELECT setval(pg_get_serial_sequence('"${t}"','id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1))`,
  );
  try {
    await rpc("exec_sql_batch", { queries: ["SELECT 1"] });
    for (const q of reset) {
      try { await rpc("exec_sql", { query: q, expect_rows: true }); } catch { /* tabela sem serial */ }
    }
    report.push("sequences reajustadas");
  } catch { /* ignore */ }
}

writeFileSync("migracao-d1-supabase.log", report.join("\n"), "utf8");
console.log(report.join("\n"));
console.log("\nlog salvo em migracao-d1-supabase.log");
