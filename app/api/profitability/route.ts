import { NextRequest, NextResponse } from "next/server";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type Entry = {
  id: number; customer_id: number | null; period: number; region: string; revenue_cents: number;
  gross_profit_cents: number; delivery_cost_cents: number; delivered_weight_kg: number;
  delivery_count: number; average_payment_days: number | null; customer_name?: string;
  route_name?: string; plate?: string; order_number?: string;
};
type Summary = {
  label: string; revenueCents: number; grossProfitCents: number; deliveryCostCents: number;
  deliveryCount: number; deliveredWeightKg: number; paymentDaysTotal: number; paymentDaysRows: number;
};
type Frequency = { customer_name: string; average_days: number };

const now = () => Math.floor(Date.now() / 1000);
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const decimal = (value: unknown) => {
  let raw = String(value ?? "").trim().replace(/R\$|\s|%/gi, "");
  if (!raw) return 0;
  if (raw.includes(",") && raw.includes(".")) raw = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  else if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: unknown) => Math.round(decimal(value) * 100);
const epoch = (value: unknown) => {
  const raw = String(value ?? "").trim();
  const brazilian = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const parsed = brazilian
    ? new Date(Number(brazilian[3]), Number(brazilian[2]) - 1, Number(brazilian[1]))
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? now() : Math.floor(parsed.getTime() / 1000);
};

const parseDelimited = (text: string) => {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const candidates = ["\t", ";", ","];
  const delimiter = candidates.sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let cell = "", quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(cell.trim()); cell = "";
      } else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseLine(lines[0]).map(normalize);
  return lines.slice(1).map(line => Object.fromEntries(parseLine(line).map((value, index) => [headers[index], value])));
};

const aggregate = (rows: Entry[], label: (row: Entry) => string) => [...rows.reduce((result, row) => {
  const key = label(row) || "Sem classificação";
  const item = result.get(key) ?? { label: key, revenueCents: 0, grossProfitCents: 0, deliveryCostCents: 0, deliveryCount: 0, deliveredWeightKg: 0, paymentDaysTotal: 0, paymentDaysRows: 0 };
  item.revenueCents += row.revenue_cents;
  item.grossProfitCents += row.gross_profit_cents;
  item.deliveryCostCents += row.delivery_cost_cents;
  item.deliveryCount += row.delivery_count;
  item.deliveredWeightKg += row.delivered_weight_kg;
  if (row.average_payment_days !== null) { item.paymentDaysTotal += row.average_payment_days; item.paymentDaysRows += 1; }
  result.set(key, item);
  return result;
}, new Map<string, Summary>()).values()].map(item => ({
  label: item.label,
  revenueCents: item.revenueCents,
  grossProfitCents: item.grossProfitCents,
  deliveryCostCents: item.deliveryCostCents,
  deliveryCount: item.deliveryCount,
  deliveredWeightKg: item.deliveredWeightKg,
  averageProfitPerDeliveryCents: item.deliveryCount ? Math.round(item.grossProfitCents / item.deliveryCount) : 0,
  averageWeightKg: item.deliveryCount ? item.deliveredWeightKg / item.deliveryCount : 0,
  averagePaymentDays: item.paymentDaysRows ? item.paymentDaysTotal / item.paymentDaysRows : null,
  marginPercent: item.revenueCents ? item.grossProfitCents / item.revenueCents * 100 : null,
})).sort((a, b) => b.grossProfitCents - a.grossProfitCents);

const hash = async (input: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};

export async function GET() {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1();
  const [rows, frequencies] = await Promise.all([
    db.prepare(`SELECT p.*,c.company_name AS customer_name,r.name AS route_name,v.plate,o.number AS order_number FROM profitability_entries p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN routes r ON r.id=p.route_id LEFT JOIN vehicles v ON v.id=p.vehicle_id LEFT JOIN orders o ON o.id=p.order_id ORDER BY p.period DESC,p.id DESC`).all<Entry>(),
    db.prepare(`WITH history AS (SELECT customer_id,order_date,LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS previous_date FROM orders WHERE status<>'cancelled') SELECT c.company_name AS customer_name,AVG((h.order_date-h.previous_date)/86400.0) AS average_days FROM history h JOIN customers c ON c.id=h.customer_id WHERE h.previous_date IS NOT NULL GROUP BY h.customer_id,c.company_name`).all<Frequency>(),
  ]);
  const frequencyByCustomer = new Map(frequencies.results.map(item => [item.customer_name, item.average_days]));
  const customers = aggregate(rows.results, row => row.customer_name || "").map(item => ({ ...item, purchaseFrequencyDays: frequencyByCustomer.get(item.label) ?? null }));
  return NextResponse.json({
    entries: rows.results,
    dimensions: {
      customer: customers,
      delivery: aggregate(rows.results, row => row.order_number || ""),
      route: aggregate(rows.results, row => row.route_name || ""),
      vehicle: aggregate(rows.results, row => row.plate || ""),
      region: aggregate(rows.results, row => row.region || ""),
    },
    summary: customers,
  });
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json() as { rows?: Record<string, unknown>[]; csv?: string };
  const rows = body.rows ?? (body.csv ? parseDelimited(body.csv) : []);
  if (!rows.length) return NextResponse.json({ error: "Envie um CSV/TSV com cabeçalho e ao menos uma linha de dados." }, { status: 400 });

  const db = getD1(), timestamp = now(), statements: D1PreparedStatement[] = [];
  let invalidRows = 0, duplicateRows = 0;
  for (const input of rows) {
    const row = Object.fromEntries(Object.entries(input).map(([key, item]) => [normalize(key), item]));
    const customerName = String(row.cliente || row.customer || row.client || "").trim();
    const routeName = String(row.rota || row.route || "").trim();
    const plate = String(row.placa || row.plate || "").trim();
    const orderNumber = String(row.pedido || row.ordernumber || row.order || "").trim();
    const region = String(row.regiao || row.region || "").trim();
    if (!customerName && !routeName && !plate && !orderNumber && !region) { invalidRows += 1; continue; }

    const customer = customerName ? await db.prepare("SELECT id FROM customers WHERE company_name=? ORDER BY id LIMIT 1").bind(customerName).first<{ id: number }>() : null;
    const route = routeName ? await db.prepare("SELECT id,vehicle_id FROM routes WHERE name=? ORDER BY id DESC LIMIT 1").bind(routeName).first<{ id: number; vehicle_id: number }>() : null;
    const vehicle = plate ? await db.prepare("SELECT id FROM vehicles WHERE plate=?").bind(plate).first<{ id: number }>() : null;
    const order = orderNumber ? await db.prepare("SELECT id,customer_id FROM orders WHERE number=?").bind(orderNumber).first<{ id: number; customer_id: number }>() : null;
    const period = epoch(row.periodo ?? row.period ?? row.data);
    const revenue = money(row.faturamento ?? row.revenue ?? row.receita);
    const cost = money(row.custoentrega ?? row.deliverycost ?? row.custo);
    const profitSource = row.lucrobruto ?? row.grossprofit ?? row.lucro;
    const profit = profitSource === undefined || String(profitSource).trim() === "" ? revenue - cost : money(profitSource);
    const deliveredWeightKg = decimal(row.pesokg ?? row.weightkg ?? row.peso);
    const deliveryCount = Math.max(1, Math.round(decimal(row.entregas ?? row.deliverycount ?? 1)));
    const paymentDays = decimal(row.prazomedio ?? row.paymentdays) || null;
    const sourceKey = await hash([orderNumber, customerName, routeName, plate, region, period, revenue, profit, cost, deliveredWeightKg, deliveryCount, paymentDays]);
    if (await db.prepare("SELECT id FROM profitability_entries WHERE source_key=?").bind(sourceKey).first<{ id: number }>()) { duplicateRows += 1; continue; }

    statements.push(db.prepare("INSERT INTO profitability_entries (order_id,customer_id,route_id,vehicle_id,region,period,revenue_cents,gross_profit_cents,delivery_cost_cents,delivered_weight_kg,delivery_count,average_payment_days,source,source_key,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(order?.id ?? null, customer?.id ?? order?.customer_id ?? null, route?.id ?? null, vehicle?.id ?? route?.vehicle_id ?? null, region, period, revenue, profit, cost, deliveredWeightKg, deliveryCount, paymentDays, "spreadsheet", sourceKey, String(row.observacoes ?? row.notes ?? ""), actor.userId, timestamp));
  }
  if (statements.length) await db.batch(statements);
  await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'import','profitability','bulk',?,?)").bind(actor.userId, JSON.stringify({ source: "spreadsheet", importedRows: statements.length, duplicateRows, invalidRows }), timestamp).run();
  return NextResponse.json({
    imported: statements.length,
    duplicateRows,
    invalidRows,
    message: `${statements.length} linha(s) importada(s)${duplicateRows ? `, ${duplicateRows} duplicada(s) ignorada(s)` : ""}${invalidRows ? `, ${invalidRows} inválida(s) ignorada(s)` : ""}.`,
  }, { status: 201 });
}
