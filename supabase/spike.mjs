// Spike REAL: exercita o fluxo da app contra o Supabase ao vivo, pelo mesmo
// caminho que a app usaria (HTTPS/PostgREST + RPC), usando a service key.
//   node supabase/spike.mjs
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!SB || !KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente (nao commite chaves).");
  process.exit(2);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const rest = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, body };
};
const rpc = (fn, args = {}) => rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

let ok = true;
const step = async (label, fn) => {
  try { const v = await fn(); console.log("PASS  " + label + (v ? "  -> " + v : "")); }
  catch (e) { ok = false; console.log("FAIL  " + label + "  -> " + e.message); }
};

let productId, lotId;
const tag = "__spike__" + Date.now();

await step("INSERT produto (caminho do POST /api/products)", async () => {
  const r = await rest("products", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: tag, category: "Saneantes", controlled: true,
      un_number: "1791", control_agency: "Policia Federal", h_phrases: ["H314"],
      p_phrases: ["P280"] }) });
  if (r.status !== 201) throw new Error("status " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
  productId = r.body[0].id;
  return productId;
});

await step("INSERT lote + FISPQ vinculados", async () => {
  const l = await rest("lots", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ product_id: productId, lot_number: "L-SPIKE", expiry_date: "2027-01-31", quantity: 100, unit: "L" }) });
  if (l.status !== 201) throw new Error("lote: " + JSON.stringify(l.body).slice(0, 160));
  lotId = l.body[0].id;
  const f = await rest("fispq", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ product_id: productId, version: "1", validity_date: "2027-06-30", status: "active" }) });
  if (f.status !== 201) throw new Error("fispq: " + JSON.stringify(f.body).slice(0, 160));
  return "lote+fispq ok";
});

await step("RPC products_overview agrega lote e FISPQ", async () => {
  const r = await rpc("products_overview");
  if (r.status !== 200) throw new Error("status " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
  const row = r.body.find(x => x.id === productId);
  if (!row) throw new Error("produto nao apareceu");
  if (Number(row.total_quantity) !== 100) throw new Error("total_quantity=" + row.total_quantity);
  if (row.fispq_status !== "active") throw new Error("fispq_status=" + row.fispq_status);
  if (!row.next_expiry) throw new Error("next_expiry vazio");
  return `total_lots=${row.total_lots} qtd=${row.total_quantity} fispq=${row.fispq_status} vence=${row.next_expiry}`;
});

await step("RPC controlled_products inclui o controlado", async () => {
  const r = await rpc("controlled_products");
  if (r.status !== 200) throw new Error("status " + r.status);
  const row = r.body.find(x => x.id === productId);
  if (!row) throw new Error("controlado nao listado");
  return `orgao=${row.control_agency} qtd=${row.total_quantity}`;
});

await step("RPC compliance_alerts retorna colunas de alerta", async () => {
  const r = await rpc("compliance_alerts");
  if (r.status !== 200) throw new Error("status " + r.status);
  const c = r.body[0];
  if (!c || c.fispq_missing === undefined) throw new Error("shape inesperado: " + JSON.stringify(c));
  return JSON.stringify(c);
});

await step("UPDATE produto e trigger de auditoria registra", async () => {
  const u = await rest(`products?id=eq.${productId}`, { method: "PATCH",
    headers: { Prefer: "return=representation" }, body: JSON.stringify({ category: "Quimicos" }) });
  if (u.status !== 200 && u.status !== 204) throw new Error("update status " + u.status);
  const a = await rest(`audit_log?entity_id=eq.${productId}&entity_type=eq.products&select=action`);
  if (a.status !== 200) throw new Error("audit status " + a.status);
  const actions = a.body.map(x => x.action);
  if (!actions.includes("insert") || !actions.includes("update"))
    throw new Error("acoes: " + JSON.stringify(actions));
  return actions.join(",");
});

await step("LIMPEZA dos dados de spike", async () => {
  await rest(`fispq?product_id=eq.${productId}`, { method: "DELETE" });
  await rest(`lots?id=eq.${lotId}`, { method: "DELETE" });
  await rest(`audit_log?entity_id=eq.${productId}`, { method: "DELETE" });
  const d = await rest(`products?id=eq.${productId}`, { method: "DELETE" });
  if (d.status !== 204 && d.status !== 200) throw new Error("delete status " + d.status);
  const left = await rest(`products?id=eq.${productId}&select=id`);
  if (left.body.length) throw new Error("sobrou produto");
  return "ok";
});

console.log("\n" + (ok ? "SPIKE SUPABASE: OK ✓ (fluxo real funcionando via HTTPS)" : "SPIKE: HA FALHAS ✗"));
process.exit(ok ? 0 : 1);
