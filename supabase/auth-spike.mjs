// Testa o fluxo de auth REAL contra o Supabase: cria usuario, entra com senha,
// confere o papel em public.users e limpa. Requer env:
//   SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SECRET_KEY;
const PK = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!SB || !SK || !PK) { console.error("Faltam envs SUPABASE_URL/SECRET/PUBLISHABLE."); process.exit(2); }

let ok = true;
const step = async (label, fn) => {
  try { const v = await fn(); console.log("PASS  " + label + (v ? "  -> " + v : "")); }
  catch (e) { ok = false; console.log("FAIL  " + label + "  -> " + e.message); }
};
const email = `spike+${Date.now()}@quimicativa.test`;
const password = "TesteSeguro123!";
let uid;

await step("admin cria usuario (email_confirmed)", async () => {
  const r = await fetch(`${SB}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "Spike Teste" } }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  uid = d.id;
  return uid;
});

await step("login por senha devolve sessao", async () => {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PK, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`HTTP ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  return "access_token ok, expira em " + d.expires_in + "s";
});

await step("senha errada e rejeitada", async () => {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: PK, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "senha-errada-xxx" }),
  });
  if (r.ok) throw new Error("aceitou senha errada");
  return "401 como esperado";
});

await step("papel gravado em public.users (viewer quando nao e o 1o)", async () => {
  const ins = await fetch(`${SB}/rest/v1/users`, {
    method: "POST",
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ id: uid, email, name: "Spike Teste", role: "viewer" }),
  });
  if (!ins.ok) throw new Error("insert users: " + (await ins.text()).slice(0, 160));
  const g = await fetch(`${SB}/rest/v1/users?id=eq.${uid}&select=role,email`, {
    headers: { apikey: SK, Authorization: `Bearer ${SK}` },
  });
  const rows = await g.json();
  if (rows[0]?.role !== "viewer") throw new Error("role=" + JSON.stringify(rows[0]));
  return "role=" + rows[0].role;
});

await step("limpeza", async () => {
  await fetch(`${SB}/rest/v1/users?id=eq.${uid}`, { method: "DELETE", headers: { apikey: SK, Authorization: `Bearer ${SK}` } });
  const r = await fetch(`${SB}/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: { apikey: SK, Authorization: `Bearer ${SK}` } });
  if (!r.ok) throw new Error("delete auth: " + r.status);
  return "ok";
});

console.log("\n" + (ok ? "AUTH SUPABASE: OK ✓" : "AUTH: HA FALHAS ✗"));
process.exit(ok ? 0 : 1);
