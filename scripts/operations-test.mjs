import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd(), out = path.join(root, ".tmp-test", "operations");
await fs.mkdir(out, { recursive: true });
const shims = {
  "next/server": `export class NextRequest extends Request { get nextUrl() { return new URL(this.url); } } export const NextResponse = { json: (data, init) => Response.json(data, init) };`,
  authz: `export const getActor = async () => globalThis.__opsActor; export const canWrite = a => a.role !== 'viewer'; export const canValidate = a => ['ceo','manager'].includes(a.role); export const canReadConfidential = a => a.role === 'ceo';`,
  admin: `export const supabaseAdmin = () => ({ rpc: globalThis.__opsRpc });`,
  storage: `export const getFiles = () => ({ put: async (key, bytes) => globalThis.__opsFiles.set(key, bytes), get: async key => { const bytes = globalThis.__opsFiles.get(key); return bytes ? { body: bytes, arrayBuffer: async () => bytes } : null; }, delete: async key => globalThis.__opsFiles.delete(key) });`,
};
const endpoints = ["operations", "route-events", "routes", "routes/manifest", "orders", "vehicles", "drivers", "vehicle-maintenance", "fleet-schedule", "order-docs", "records"];
await build({ entryPoints: Object.fromEntries([...endpoints.map(name => [name, `app/api/${name}/route.ts`]), ["domain", "lib/operations.ts"]]), bundle: true, format: "esm", platform: "node", packages: "external", outdir: out, outExtension: { ".js": ".mjs" }, plugins: [{ name: "local-test-adapters", setup(builder) {
  builder.onResolve({ filter: /^(next\/server)$|authz$|supabase\/(admin|storage)$/ }, args => ({ path: args.path === "next/server" ? args.path : args.path.endsWith("authz") ? "authz" : args.path.endsWith("admin") ? "admin" : "storage", namespace: "ops-test" }));
  builder.onLoad({ filter: /.*/, namespace: "ops-test" }, args => ({ contents: shims[args.path], loader: "js" }));
} }] });
const domain = await import(pathToFileURL(path.join(out, "domain.mjs")));
const apis = Object.fromEntries(await Promise.all(endpoints.map(async name => [name, await import(pathToFileURL(path.join(out, `${name}.mjs`)))])));
const database = new PGlite();
await database.exec(await fs.readFile("supabase/schema-app.sql", "utf8"));
await database.exec(await fs.readFile("supabase/erp-records-fix.sql", "utf8"));
// Install precisely the deployed RPC implementation, including its CTE wrapper.
await database.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
await database.exec("CREATE FUNCTION jwt_role() RETURNS text LANGUAGE sql AS $$ SELECT 'manager'::text $$;");
await database.exec(await fs.readFile("supabase/app-extras.sql", "utf8"));
globalThis.__opsFiles = new Map();
globalThis.__opsRpc = async (name, params) => {
  try { const result = name === "exec_sql_batch" ? await database.query("SELECT exec_sql_batch($1::jsonb) AS result", [JSON.stringify(params.queries)]) : await database.query("SELECT exec_sql($1,$2) AS result", [params.query, params.expect_rows]); return { data: result.rows[0].result, error: null }; }
  catch (error) { return { data: null, error: { message: error.message } }; }
};
const manager = { userId: "test-manager", displayName: "Gestão de teste", email: "test@example.invalid", role: "manager" };
globalThis.__opsActor = manager;
await database.exec("INSERT INTO users (id,email,name,role,created_at) VALUES ('test-manager','test@example.invalid','Gestão','manager',1)");
const today = domain.localDay(), tomorrow = domain.addDays(today, 1);
let checked = 0;
const pass = label => { checked++; console.log(`OK ${label}`); };
async function request(api, payload, expected = 200, method = "POST", search = "") {
  const req = new Request(`http://localhost/api/${api}${search}`, { method, ...(method === "GET" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) });
  Object.defineProperty(req, "nextUrl", { value: new URL(req.url) });
  const response = await apis[api][method](req), data = await response.json();
  assert.equal(response.status, expected, `${api} ${method} ${JSON.stringify(payload)} => ${JSON.stringify(data)}`); return data;
}
async function records(scope = "operations") { return (await request("operations", null, 200, "GET", `?scope=${scope}`)).records; }
async function save(action, data, expected = 201, record) { return (await request("operations", { action, data, id: record?.id, version: record?.version }, expected)).record; }
try {
  assert.equal(domain.TEAM.length, 17); assert.equal(domain.TEAM.filter(row => row.name === "Francisco").length, 1);
  assert.equal(domain.localDay(new Date("2026-10-20T01:00:00Z")), "2026-10-19");
  assert.throws(() => domain.validDate("2026-02-30")); assert.throws(() => domain.count(-1, "Qtd")); assert.throws(() => domain.count(1.5, "Qtd"));
  assert.deepEqual(domain.maintenanceDue("Óleo e filtros", "2026-01-31", 1000), { km: 6000, date: "" });
  assert.deepEqual(domain.maintenanceDue("Limpeza geral", "2026-01-31", 1000), { km: null, date: "2026-02-14" });
  assert.deepEqual(domain.maintenanceDue("Revisão geral", "2026-01-31", 1000), { km: null, date: "2026-04-30" });
  pass("Equipe, datas de Brasília e três ciclos de manutenção independentes");

  globalThis.__opsActor = null; await request("operations", null, 401, "GET");
  globalThis.__opsActor = { ...manager, role: "viewer" }; await request("operations", { action: "bootstrap" }, 403);
  globalThis.__opsActor = { ...manager, role: "operator" }; await request("operations", { action: "employee", data: {} }, 403); await request("operations", null, 403, "GET", "?scope=rh");
  globalThis.__opsActor = manager; pass("Autenticação e permissões de RH / consulta");

  await request("operations", { action: "bootstrap" }); await request("operations", { action: "bootstrap" });
  let hr = await records("rh"); assert.equal(hr.filter(row => row.kind === "employee").length, 17);
  assert.equal((await database.query("SELECT COUNT(*) AS n FROM drivers")).rows[0].n, 2);
  const francisco = hr.find(row => row.title === "Francisco"); assert.match(francisco.data.role, /Compras.*Gerente geral/);
  const mateus = hr.find(row => row.title === "Mateus"); pass("Cadastro idempotente de 17 funcionários e dois motoristas sem CNH inventada");

  let vacation = await save("vacation", { employeeId: mateus.id, start: today, end: tomorrow, status: "approved" });
  await save("vacation", { employeeId: mateus.id, start: today, end: tomorrow, status: "planned" }, 409);
  await save("vacation", { employeeId: mateus.id, start: tomorrow, end: today, status: "planned" }, 400);
  await save("basket", { employeeId: mateus.id, month: today.slice(0, 7), status: "pending" });
  await save("basket", { employeeId: mateus.id, month: today.slice(0, 7), status: "pending" }, 409);
  const basket = (await records("rh")).find(row => row.kind === "basket");
  await save("basket", { ...basket.data, status: "delivered", deliveredDate: today, receivedBy: "Mateus" }, 200, basket);
  await save("basket", { ...basket.data, status: "pending" }, 409, basket);
  const otherMonth = domain.addMonths(`${today.slice(0, 7)}-01`, 1).slice(0, 7);
  const otherBasket = await save("basket", { employeeId: mateus.id, month: otherMonth, status: "pending" });
  await save("basket", { ...otherBasket.data, month: today.slice(0, 7), status: "pending" }, 409, otherBasket);
  assert.equal((await records("rh")).find(row => row.id === otherBasket.id).data.month, otherMonth);
  pass("Férias sem sobreposição, cesta por competência e bloqueio de edição desatualizada");

  await save("ppe", { employeeId: mateus.id, equipment: "Luvas", deliveryDate: today, quantity: "1", signed: "yes", receivedBy: "" }, 400);
  await save("ppe", { employeeId: mateus.id, equipment: "Luvas", deliveryDate: today, quantity: "2", signed: "yes", receivedBy: "Mateus", ca: "12345" });
  const ppe = (await records("rh")).find(row => row.kind === "ppe"); assert.equal(ppe.data.nextReview, domain.addMonths(today, 3));
  const reviewData = { employeeId: mateus.id, reviewDate: today, reviewer: "Gestor", condition: "ok", ...Object.fromEntries(domain.PPE_TYPES.map(item => [item, "ok"])) };
  await save("ppeReview", { ...reviewData, Luvas: "replace" }, 400); await save("ppeReview", reviewData);
  await database.query("INSERT INTO records (department,module,title,metadata,status,created_at,updated_at) VALUES ('rh','Uniformes','Mateus',$1,'active',1,1)", [JSON.stringify({ item: "Camisa", size: "M", quantity: "1", deliveryDate: today })]);
  const legacyUniform = (await records("rh")).find(row => row.data._legacyModule === "Uniformes"); assert.equal(legacyUniform.data.equipment, "Camisa");
  await save("ppe", { employeeId: mateus.id, equipment: "Camisa", deliveryDate: today, quantity: "1", size: "M", signed: "yes", receivedBy: "Mateus" }, 200, legacyUniform);
  assert.equal((await records("rh")).find(row => row.id === legacyUniform.id).data._legacyModule, undefined);
  const publicEmployees = (await records()).filter(row => row.kind === "employee"); assert.ok(publicEmployees.every(row => !row.data.admissionDate && !row.data.notes));
  pass("Entrega de EPI, aceite e revisão trimestral de todos os nove itens");

  let stock = await save("stock", { category: "Bombona", minimum: "2" });
  await request("operations", { action: "movement", version: stock.version, data: { stockId: stock.id, type: "out", quantity: "1", reason: "Sem contagem" } }, 400);
  await request("operations", { action: "movement", version: stock.version, data: { stockId: stock.id, type: "count", quantity: "10", reason: "Contagem inicial" } }, 201);
  await request("operations", { action: "movement", version: stock.version, data: { stockId: stock.id, type: "out", quantity: "1", reason: "Saldo antigo" } }, 409);
  stock = (await records()).find(row => row.id === stock.id);
  await request("operations", { action: "movement", version: stock.version, data: { stockId: stock.id, type: "out", quantity: "11", reason: "Saída excedente" } }, 409);
  const freeText = "Carga d'água? $ops$ $journey$ returning RETURNING — observações livres";
  await request("operations", { action: "movement", version: stock.version, data: { stockId: stock.id, type: "out", quantity: "4", reason: freeText } }, 201);
  assert.equal((await records()).find(row => row.id === stock.id).data.quantity, "6");
  assert.equal((await records()).filter(row => row.kind === "movement").length, 2);
  assert.ok((await records()).some(row => row.kind === "movement" && row.data.reason === freeText));
  await save("stock", { category: "Mangote", minimum: "0" }, 400);
  await save("stock", { category: "Bomba", variant: "Transferência 220V", minimum: "1" });
  pass("Contagem e movimentação atômicas: saldo insuficiente e concorrência preservam histórico");
  stock = (await records()).find(row => row.id === stock.id);
  const concurrentMoves = await Promise.all([1, 2].map(async () => {
    const response = await apis.operations.POST(new Request("http://localhost/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "movement", version: stock.version, data: { stockId: stock.id, type: "out", quantity: "4", reason: "Duas saídas simultâneas" } }) })); return response.status;
  }));
  assert.deepEqual(concurrentMoves.sort(), [201, 409]); assert.equal((await records()).find(row => row.id === stock.id).data.quantity, "2");
  pass("Duas saídas simultâneas não duplicam a baixa nem deixam saldo negativo");

  await database.exec(`INSERT INTO customers (company_name,document,created_at,updated_at) VALUES ('Cliente teste','123',1,1);
    INSERT INTO orders (number,customer_id,status,created_at,updated_at) VALUES ('PED-TESTE',1,'confirmed',1,1),('PED-2',1,'confirmed',1,1);
    INSERT INTO order_items (order_id,product_name,quantity,unit,unit_price_cents,weight_kg,volume_m3,created_at,updated_at) VALUES (1,'Produto teste',10,'L',100,10,0.1,1,1),(2,'Produto teste',10,'L',100,10,0.1,1,1);
    INSERT INTO vehicles (plate,model,odometer_km,capacity_kg,created_at,updated_at) VALUES ('TST1A23','Caminhão teste',1000,500,1,1);
    UPDATE drivers SET license_expiry=2200000000,mopp_expiry=2200000000;`);
  const preparationData = { orderId: 1, date: today, status: "ready", bombonas: "10", tampas: "10", lacres: "10", ibcs: "0", needsPump: "yes", pumpQty: "1", pumpType: "Transferência 220V", needsHose: "yes", hoseSize: "10m / 2 pol.", clamps: "2", couplings: "2", carts: "1" };
  await save("preparation", { ...preparationData, hoseSize: "" }, 400); await save("preparation", preparationData);
  await save("preparation", preparationData, 409);
  const createData = { vehicleId: 1, driverId: 1, routeDate: today, originAddress: "Depósito", orderIds: [1, 2], name: "Rota teste", plannedKm: 20, estimatedCostCents: 100 };
  const created = await request("routes", createData, 201); let route = created.route;
  await request("routes", createData, 409); assert.equal((await database.query("SELECT COUNT(*) AS n FROM routes")).rows[0].n, 1);
  await request("routes", { id: route.id, orderIds: [1, 1], name: "Nome indevido" }, 400, "PUT");
  assert.equal((await database.query("SELECT name FROM routes WHERE id=1")).rows[0].name, "Rota teste");
  await request("routes", { id: route.id, status: "completed" }, 400, "PUT");
  const changed = await request("routes", { id: route.id, orderIds: [2, 1], changeReason: "Janela de recebimento" }, 200, "PUT"); route = changed.route;
  assert.equal(route.stops[0].orderId, 2); assert.equal(route.events.filter(row => row.eventType === "route_changed").length, 1);
  pass("Preparação com bomba/mangote e rotas: carga atômica, alocação única e alteração rastreável");

  await request("route-events", { routeId: route.id, eventType: "departure", odometerKm: 1000 }, 400);
  await save("crew", { routeId: route.id, helperIds: String(mateus.id) }, 400);
  await save("vacation", { ...vacation.data, status: "cancelled" }, 200, vacation);
  let crew = await save("crew", { routeId: route.id, helperIds: String(mateus.id) }); assert.match(crew.data.helpers, /Mateus/);
  await database.exec("INSERT INTO vehicles (plate,model,odometer_km,capacity_kg,created_at,updated_at) VALUES ('TST2A23','Outro caminhão',1000,500,1,1); INSERT INTO orders (number,customer_id,status,created_at,updated_at) VALUES ('PED-3',1,'active',1,1); INSERT INTO order_items (order_id,product_name,quantity,unit,unit_price_cents,weight_kg,volume_m3,created_at,updated_at) VALUES (3,'Carga adicional',1,'L',100,1,0.01,1,1)");
  const secondRoute = (await request("routes", { ...createData, vehicleId: 2, driverId: 2, orderIds: [3], name: "Outra rota" }, 201)).route;
  await save("crew", { routeId: secondRoute.id, helperIds: String(mateus.id) }, 409);
  await save("crew", { routeId: secondRoute.id, helperIds: "" });
  await request("route-events", { routeId: route.id, eventType: "departure" }, 400);
  await request("route-events", { routeId: route.id, eventType: "departure", odometerKm: 999 }, 409);
  await request("route-events", { routeId: route.id, eventType: "departure", odometerKm: 1010, notes: freeText }, 201);
  await request("route-events", { routeId: route.id, eventType: "departure", odometerKm: 1010 }, 409);
  assert.equal((await database.query("SELECT odometer_km FROM vehicles WHERE id=1")).rows[0].odometer_km, 1010);
  assert.equal((await database.query("SELECT notes FROM route_events WHERE route_id=1 AND event_type='departure'")).rows[0].notes, freeText);
  await request("route-events", { routeId: route.id, eventType: "return", odometerKm: 1040, notes: "Retorno" }, 409);
  pass("Jornada exige equipe disponível, horário e odômetro e não retorna com pedidos pendentes");

  const stop = route.stops[0], reportData = { stopId: stop.id, orderDescription: "Descrição do pedido", returnDescription: "Entregue com retorno de bombonas", deliveryNotes: "Portaria", outcome: "completed", bombonasSent: "10", bombonasReturned: "6", signed: "no", unsignedReason: "Cliente ficou de enviar", receiver: "" };
  await request("route-events", { routeId: route.id, stopId: stop.id, eventType: "delivery_completed" }, 409);
  await save("report", { ...reportData, signed: "yes", receiptId: "999" }, 400);
  let report = await save("report", reportData);
  await request("route-events", { routeId: route.id, stopId: stop.id, eventType: "delivery_failed" }, 400);
  await request("route-events", { routeId: route.id, stopId: stop.id, eventType: "delivery_completed" }, 201);
  assert.equal(domain.bombonaDebt(await records())[0].balance, 4);
  await request("operations", { action: "collection", version: report.version, data: { reportId: report.id, quantity: "5", date: today, notes: "Recolhimento" } }, 409);
  await request("operations", { action: "collection", version: report.version, data: { reportId: report.id, quantity: "2", date: today, notes: "Coleta assinada" } }, 201);
  assert.equal(domain.bombonaDebt(await records())[0].balance, 2);
  await request("operations", { action: "collection", version: report.version, data: { reportId: report.id, quantity: "2", date: today, notes: "Repetida" } }, 409);
  report = (await records()).find(row => row.id === report.id);
  await request("operations", { action: "collection", version: report.version, data: { reportId: report.id, quantity: "2", date: today, notes: "Quitação" } }, 201);
  assert.equal(domain.bombonaDebt(await records()).length, 0);
  pass("Relatório por pedido, coerência de resultado e baixa parcial/total de bombonas por cliente");

  const secondStop = route.stops[1]; await save("report", { ...reportData, stopId: secondStop.id, bombonasSent: "0", bombonasReturned: "0", outcome: "failed", returnDescription: "Cliente ausente" });
  await request("route-events", { routeId: route.id, stopId: secondStop.id, eventType: "delivery_failed" }, 201);
  await request("route-events", { routeId: route.id, eventType: "return", odometerKm: 1040, notes: "Jornada encerrada" }, 201);
  assert.equal((await database.query("SELECT status FROM routes WHERE id=1")).rows[0].status, "completed");
  await request("routes", { id: route.id, orderIds: [1, 2] }, 409, "PUT");
  assert.equal((await database.query("SELECT status FROM orders WHERE id=$1", [stop.orderId])).rows[0].status, "completed");
  report = (await records()).find(row => row.id === report.id);
  await save("report", { ...report.data, bombonasSent: "20" }, 409, report);
  pass("Encerramento completo da jornada e imutabilidade das quantidades após fechar a parada");

  const { PDFDocument } = await import("pdf-lib"); const pdf = await PDFDocument.create(); pdf.addPage(); const file = new File([await pdf.save()], "canhoto.pdf", { type: "application/pdf" });
  const form = new FormData(); form.set("orderId", String(stop.orderId)); form.set("kind", "canhoto"); form.set("file", file);
  const uploadResponse = await apis["order-docs"].POST(new Request("http://localhost/api/order-docs", { method: "POST", body: form })); const uploadData = await uploadResponse.json(); assert.equal(uploadResponse.status, 201, JSON.stringify(uploadData));
  report = (await records()).find(row => row.id === report.id);
  await save("report", { ...report.data, signed: "yes", receiptId: String(uploadData.document.id), receiver: "Responsável do cliente" }, 200, report);
  await request("order-docs", { id: uploadData.document.id, status: "archived" }, 409, "PUT");
  const manifestResponse = await apis["routes/manifest"].GET({ nextUrl: new URL("http://localhost/api/routes/manifest?id=1") });
  assert.equal(manifestResponse.status, 200); assert.equal(manifestResponse.headers.get("Content-Type"), "application/pdf");
  const manifest = await PDFDocument.load(await manifestResponse.arrayBuffer()); assert.ok(manifest.getPageCount() > 0);
  pass("Upload privado e vinculação de canhoto assinado após o retorno da rota");

  for (const maintType of domain.MAINTENANCE_TYPES) await request("vehicle-maintenance", { vehicleId: 1, maintType, serviceDate: today, odometerKm: 1040, status: "completed", costCents: 0, description: "Serviço realizado" }, 201);
  const schedule = await request("fleet-schedule", null, 200, "GET"); const services = schedule.vehicles[0].services;
  assert.equal(services.find(row => row.type === "Óleo e filtros").nextKm, 6040);
  assert.equal(services.find(row => row.type === "Limpeza geral").nextDate, domain.addDays(today, 14));
  assert.equal(services.find(row => row.type === "Revisão geral").nextDate, domain.addMonths(today, 3));
  await request("vehicle-maintenance", { vehicleId: 1, maintType: "Limpeza geral", serviceDate: "2026-02-30", odometerKm: 1040, status: "completed", costCents: 0 }, 400);
  await request("vehicle-maintenance", { vehicleId: 1, maintType: "Limpeza geral", serviceDate: tomorrow, odometerKm: 1040, status: "completed", costCents: 0 }, 400);
  pass("Serviços persistidos geram agenda de 5.000 km / 14 dias / 3 meses, sem interferência entre ciclos");
  assert.ok((await database.query("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type='operation'")).rows[0].n >= 10);
  console.log(`\n${checked} cenários de integração passaram com PostgreSQL e os RPCs reais.`);
  if (process.argv.includes("--serve")) {
    const { createServer } = await import("node:http");
    const server = createServer(async (incoming, outgoing) => {
      try {
        const url = new URL(incoming.url, "http://127.0.0.1:3020"), endpoint = url.pathname.replace(/^\/api\//, "");
        let response;
        if (endpoint === "profile") response = Response.json({ name: manager.displayName, role: manager.role });
        else if (endpoint === "summary") response = Response.json({ metrics: {}, compliance: {}, recent: [] });
        else if (endpoint === "integrations") response = Response.json({ integrations: [] });
        else if (apis[endpoint]?.[incoming.method]) {
          const chunks = []; for await (const chunk of incoming) chunks.push(chunk); const body = Buffer.concat(chunks);
          const req = new Request(url, { method: incoming.method, headers: incoming.headers, ...(body.length ? { body } : {}) }); Object.defineProperty(req, "nextUrl", { value: url });
          response = await apis[endpoint][incoming.method](req);
        } else response = Response.json({ error: "Endpoint indisponível no teste local" }, { status: 404 });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) { outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ error: error.message })); }
    });
    server.listen(3020, "127.0.0.1", () => console.log("Banco isolado de testes pronto em http://127.0.0.1:3020"));
    await new Promise(resolve => { for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(resolve)); });
  }
} finally { await database.close(); }
