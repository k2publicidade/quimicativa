// Aplica um arquivo .sql no Supabase via Management API.
//   node supabase/apply-file.mjs supabase/schema-app.sql "sbp_..."
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [, , file, tokenArg] = process.argv;
const token = tokenArg || process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF || "rorhzeiwqvlrmwbvicph";
if (!file || !token) {
  console.error("Uso: node supabase/apply-file.mjs <arquivo.sql> <sbp_...>");
  process.exit(2);
}
const path = join(dirname(fileURLToPath(import.meta.url)), "..", file);
const sql = readFileSync(path, "utf8");

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const t = await r.text();
if (!r.ok) {
  console.error(`FALHOU (${r.status}):`, t.slice(0, 700));
  process.exit(1);
}
console.log(`Aplicado: ${file} (${sql.length} bytes)`);
