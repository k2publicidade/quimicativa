// Verifica o CONTRATO do adaptador D1->Supabase: mesmo SQL das rotas, via RPC.
// Replica inline() do db/index.ts e usa as consultas reais de app/api/products.
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SECRET_KEY;
if (!SB || !SK) { console.error("Defina SUPABASE_URL e SUPABASE_SECRET_KEY."); process.exit(2); }

// --- mesma logica de db/index.ts ---
const literal = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return String(Math.floor(v.getTime() / 1000));
  return `'${String(v).replace(/'/g, "''")}'`;
};
const inline = (sql, params) => {
  let i = 0, out = "", inStr = false;
  for (let c = 0; c < sql.length; c++) {
    const ch = sql[c];
    if (ch === "'") inStr = !inStr;
    if (ch === "?" && !inStr) { out += literal(params[i++]); continue; }
    out += ch;
  }
  return out;
};
const rpc = async (fn, args) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 250)}`);
  return t ? JSON.parse(t) : [];
};
const exec = (sql, params = [], expectRows = true) =>
  rpc("exec_sql", { query: inline(sql.trim().replace(/;\s*$/, ""), params), expect_rows: expectRows });

let ok = true;
const step = async (label, fn) => {
  try { const v = await fn(); console.log("PASS  " + label + (v ? "  -> " + v : "")); }
  catch (e) { ok = false; console.log("FAIL  " + label + "  -> " + e.message); }
};

const now = Math.floor(Date.now() / 1000);
const actor = "test-actor-" + now;
let productId;

await step("preparar usuario (FK real: D1 nao aplicava, Postgres aplica)", async () => {
  await exec(
    "INSERT INTO users (id,email,name,role,created_at) VALUES (?,?,?,?,?)",
    [actor, actor + "@teste.local", "Ator de Teste", "ceo", now],
    false,
  );
  return actor;
});

await step("POST /api/products: INSERT ... RETURNING (id numerico, 0/1, epoch)", async () => {
  const rows = await exec(
    `INSERT INTO products (name,category,concentration,un_number,hazard_class,signal_word,h_phrases,p_phrases,controlled,control_agency,flammable,storage,status,notes,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    ["__adapter__", "Saneantes", "", "1791", "Corrosivo", "Perigo", '["H314"]', '["P280"]', 1, "Polícia Federal", 0, "", "active", "", actor, now, now],
  );
  const row = rows[0];
  if (typeof row.id !== "number") throw new Error("id nao e numero: " + typeof row.id);
  if (typeof row.controlled !== "number") throw new Error("controlled nao e 0/1: " + typeof row.controlled);
  if (typeof row.created_at !== "number") throw new Error("created_at nao e epoch: " + typeof row.created_at);
  productId = row.id;
  return `id=${row.id} controlled=${row.controlled} created_at=${row.created_at}`;
});

await step("GET /api/products?id=: SELECT * WHERE id=? (Number(id) funciona)", async () => {
  const rows = await exec("SELECT * FROM products WHERE id=?", [productId]);
  if (rows.length !== 1) throw new Error("nao achou 1 linha");
  if (rows[0].id !== productId) throw new Error("id divergente");
  return "linha unica, id casa";
});

await step("GET /api/products: query de lotes (agregacao) nao quebra", async () => {
  const rows = await exec(
    `SELECT product_id,COUNT(*) total_lots,COALESCE(SUM(quantity),0) total_quantity,MIN(expiry_date) next_expiry
     FROM lots WHERE quantity>0 GROUP BY product_id`,
  );
  return `agregacao ok (${rows.length} grupos)`;
});

await step("lote com FK + campo opcional NULL", async () => {
  const rows = await exec(
    `INSERT INTO lots (product_id,lot_number,expiry_date,quantity,unit,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?) RETURNING *`,
    [productId, "L-ADAPTER", now + 86400 * 90, 10, "L", actor, now, now],
  );
  return "lote id=" + rows[0].id;
});

await step(".run() sem RETURNING (audit_log) nao retorna linhas", async () => {
  await exec(
    `INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','product',?,?,?)`,
    [actor, String(productId), JSON.stringify({ name: "__adapter__" }), now],
    false,
  );
  const rows = await exec("SELECT COUNT(*) n FROM audit_log WHERE entity_id=?", [String(productId)]);
  if (Number(rows[0].n) < 1) throw new Error("auditoria nao gravou");
  return "audit rows=" + rows[0].n;
});

await step("UPDATE ... RETURNING com texto contendo apóstrofo (escape)", async () => {
  const rows = await exec(
    "UPDATE products SET notes=?,updated_at=? WHERE id=? RETURNING *",
    ["d'água 'teste'", now + 5, productId],
  );
  if (rows[0].notes !== "d'água 'teste'") throw new Error("escape falhou: " + rows[0].notes);
  return "escape de aspas ok";
});

await step("batch em UMA transacao (exec_sql_batch)", async () => {
  const q1 = inline("UPDATE products SET category=? WHERE id=?", ["Batch", productId]);
  const q2 = inline("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','product',?,?,?)", [actor, String(productId), "{}", now + 6]);
  const res = await rpc("exec_sql_batch", { queries: [q1, q2] });
  if (!Array.isArray(res) || res.length !== 2) throw new Error("retorno inesperado: " + JSON.stringify(res).slice(0, 120));
  const chk = await exec("SELECT category FROM products WHERE id=?", [productId]);
  if (chk[0].category !== "Batch") throw new Error("transacao nao aplicou");
  return "2 instrucoes atomicas";
});

await step("exec_sql é negado para anon (seguranca)", async () => {
  const PK = process.env.SUPABASE_PUBLISHABLE_KEY;
  const r = await fetch(`${SB}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: { apikey: PK, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select 1", expect_rows: true }),
  });
  if (r.ok) throw new Error("anon conseguiu executar SQL arbitrario!");
  return "negado (" + r.status + ")";
});

await step("limpeza", async () => {
  await exec("DELETE FROM lots WHERE product_id=?", [productId], false);
  await exec("DELETE FROM audit_log WHERE entity_id=?", [String(productId)], false);
  await exec("DELETE FROM products WHERE id=?", [productId], false);
  await exec("DELETE FROM users WHERE id=?", [actor], false);
  return "ok";
});

console.log("\n" + (ok ? "ADAPTADOR: OK ✓ (SQL real das rotas rodando sobre o Supabase)" : "ADAPTADOR: HA FALHAS ✗"));
process.exit(ok ? 0 : 1);
