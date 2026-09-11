// Aplica supabase/rpc.sql via Management API.
//   node supabase/apply-rpc.mjs "sbp_..."
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const token = process.argv[2];
const ref = process.env.PROJECT_REF || "rorhzeiwqvlrmwbvicph";
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "rpc.sql"), "utf8");
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const t = await r.text();
if (!r.ok) { console.error("Erro:", t.slice(0, 400)); process.exit(1); }
const chk = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: `select routine_name from information_schema.routines
     where routine_schema='public' order by 1` }),
});
const rows = await chk.json();
console.log("RPCs no public:", (rows || []).map(x => x.routine_name).join(", "));
