import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type Entry = { id: number; period: number; region: string; revenue_cents: number; gross_profit_cents: number; delivery_cost_cents: number; delivered_weight_kg: number; delivery_count: number; average_payment_days: number | null; customer_name?: string; route_name?: string; plate?: string; order_number?: string };
type Summary = { label: string; revenueCents: number; grossProfitCents: number; deliveryCostCents: number; deliveryCount: number; deliveredWeightKg: number; paymentDaysTotal: number; paymentDaysRows: number };
const now = () => Math.floor(Date.now() / 1000);
const money = (value: unknown) => { const raw = String(value ?? "").trim().replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", "."); const number = Number(raw); return Number.isFinite(number) ? Math.round(number * 100) : 0; };
const numeric = (value: unknown) => { const number = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(number) ? number : 0; };
const epoch = (value: unknown) => { const parsed = new Date(String(value || "")); return Number.isNaN(parsed.getTime()) ? now() : Math.floor(parsed.getTime() / 1000); };
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const parseCsv = (text: string) => { const lines = text.split(/\r?\n/).filter(line => line.trim()); if (lines.length < 2) return []; const delimiter = lines[0].includes(";") ? ";" : ","; const parse = (line: string) => { const cells: string[] = []; let cell = "", quoted = false; for (const char of line) { if (char === '"') quoted = !quoted; else if (char === delimiter && !quoted) { cells.push(cell.trim()); cell = ""; } else cell += char; } cells.push(cell.trim()); return cells; }; const headers = parse(lines[0]).map(normalize); return lines.slice(1).map(line => Object.fromEntries(parse(line).map((value, index) => [headers[index], value]))); };
const aggregate = (rows: Entry[], label: (row: Entry) => string) => [...rows.reduce((result, row) => { const key = label(row) || "Sem classificação"; const item = result.get(key) ?? { label: key, revenueCents: 0, grossProfitCents: 0, deliveryCostCents: 0, deliveryCount: 0, deliveredWeightKg: 0, paymentDaysTotal: 0, paymentDaysRows: 0 }; item.revenueCents += row.revenue_cents; item.grossProfitCents += row.gross_profit_cents; item.deliveryCostCents += row.delivery_cost_cents; item.deliveryCount += row.delivery_count; item.deliveredWeightKg += row.delivered_weight_kg; if (row.average_payment_days !== null) { item.paymentDaysTotal += row.average_payment_days; item.paymentDaysRows += 1; } result.set(key, item); return result; }, new Map<string, Summary>()).values()].map(item => ({ label: item.label, revenueCents: item.revenueCents, grossProfitCents: item.grossProfitCents, deliveryCostCents: item.deliveryCostCents, deliveryCount: item.deliveryCount, deliveredWeightKg: item.deliveredWeightKg, averageProfitPerDeliveryCents: item.deliveryCount ? Math.round(item.grossProfitCents / item.deliveryCount) : 0, averageWeightKg: item.deliveryCount ? item.deliveredWeightKg / item.deliveryCount : 0, averagePaymentDays: item.paymentDaysRows ? item.paymentDaysTotal / item.paymentDaysRows : null, marginPercent: item.revenueCents ? item.grossProfitCents / item.revenueCents * 100 : null })).sort((a, b) => b.grossProfitCents - a.grossProfitCents);

export async function GET() {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(), rows = await db.prepare(`SELECT p.*,c.company_name AS customer_name,r.name AS route_name,v.plate,o.number AS order_number FROM profitability_entries p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN routes r ON r.id=p.route_id LEFT JOIN vehicles v ON v.id=p.vehicle_id LEFT JOIN orders o ON o.id=p.order_id ORDER BY p.period DESC,p.id DESC`).all<Entry>();
  return NextResponse.json({ entries: rows.results, dimensions: { customer: aggregate(rows.results, row => row.customer_name || ""), delivery: aggregate(rows.results, row => row.order_number || ""), route: aggregate(rows.results, row => row.route_name || ""), vehicle: aggregate(rows.results, row => row.plate || ""), region: aggregate(rows.results, row => row.region || "") }, summary: aggregate(rows.results, row => row.customer_name || row.region || "") });
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json() as { rows?: Record<string, unknown>[]; csv?: string }, db = getD1(), rows = body.rows ?? (body.csv ? parseCsv(body.csv) : []);
  if (!rows.length) return NextResponse.json({ error: "Envie um CSV/TSV ou uma lista de linhas para importar." }, { status: 400 });
  const timestamp = now(), statements: D1PreparedStatement[] = [];
  for (const input of rows) {
    const row = Object.fromEntries(Object.entries(input).map(([key, item]) => [normalize(key), item]));
    const customerName = String(row.cliente || row.customer || row.client || "").trim(), routeName = String(row.rota || row.route || "").trim(), plate = String(row.placa || row.plate || "").trim(), orderNumber = String(row.pedido || row.ordernumber || row.order || "").trim();
    const customer = customerName ? await db.prepare("SELECT id FROM customers WHERE company_name=? ORDER BY id LIMIT 1").bind(customerName).first<{ id: number }>() : null;
    const route = routeName ? await db.prepare("SELECT id,vehicle_id FROM routes WHERE name=? ORDER BY id DESC LIMIT 1").bind(routeName).first<{ id: number; vehicle_id: number }>() : null;
    const vehicle = plate ? await db.prepare("SELECT id FROM vehicles WHERE plate=?").bind(plate).first<{ id: number }>() : null;
    const order = orderNumber ? await db.prepare("SELECT id,customer_id FROM orders WHERE number=?").bind(orderNumber).first<{ id: number; customer_id: number }>() : null;
    const revenue = money(row.faturamento ?? row.revenue ?? row.receita), profitSource = row.lucrobruto ?? row.grossprofit ?? row.lucro, profit = profitSource === undefined || String(profitSource).trim() === "" ? null : money(profitSource), cost = money(row.custoentrega ?? row.deliverycost ?? row.custo);
    statements.push(db.prepare("INSERT INTO profitability_entries (order_id,customer_id,route_id,vehicle_id,region,period,revenue_cents,gross_profit_cents,delivery_cost_cents,delivered_weight_kg,delivery_count,average_payment_days,source,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(order?.id ?? null, customer?.id ?? order?.customer_id ?? null, route?.id ?? null, vehicle?.id ?? route?.vehicle_id ?? null, String(row.regiao ?? row.region ?? ""), epoch(row.periodo ?? row.period ?? row.data), revenue, profit ?? revenue - cost, cost, numeric(row.pesokg ?? row.weightkg ?? row.peso), Math.max(1, Math.round(numeric(row.entregas ?? row.deliverycount ?? 1))), numeric(row.prazomedio ?? row.paymentdays) || null, "spreadsheet", String(row.observacoes ?? row.notes ?? ""), actor.userId, timestamp));
  }
  await db.batch(statements);
  await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'import','profitability','bulk',?,?)").bind(actor.userId, JSON.stringify({ source: "spreadsheet", importedRows: rows.length }), timestamp).run();
  return NextResponse.json({ imported: rows.length, message: `${rows.length} linha(s) de lucratividade importada(s).` }, { status: 201 });
}
