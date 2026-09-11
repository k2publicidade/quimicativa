import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type RouteRow = { id: number; code: string; name: string; vehicle_id: number; driver_name: string; route_date: number; origin_address: string; status: string; planned_km: number; estimated_cost_cents: number; notes: string | null; created_at: number; updated_at: number; plate?: string; model?: string; capacity_kg?: number | null };
type StopRow = { id: number; route_id: number; order_id: number; sequence: number; status: string; address_snapshot: string; weight_kg: number; package_summary: string; delivered_at: number | null; notes: string | null; order_number: string; customer_name: string; payment_terms: string };
type LoadItem = { quantity: number; unit: string; package_count: number; package_type: string; package_unit_weight_kg: number; weight_kg: number };
const now = () => Math.floor(Date.now() / 1000);
const epoch = (value: unknown) => value ? Math.floor(new Date(String(value)).getTime() / 1000) : now();
const date = (value: number) => new Date(value * 1000).toISOString().slice(0, 10);
const address = (c: Record<string, unknown> | null) => c ? [c.street, c.number, c.complement, c.district, c.city, c.state, c.zip_code].filter(Boolean).join(", ") : "";

async function details(db: D1Database, row: RouteRow) {
  const [stops, revenue, events, loadItems] = await Promise.all([
    db.prepare(`SELECT s.*,o.number AS order_number,o.payment_terms,c.company_name AS customer_name FROM route_stops s JOIN orders o ON o.id=s.order_id JOIN customers c ON c.id=o.customer_id WHERE s.route_id=? ORDER BY s.sequence`).bind(row.id).all<StopRow>(),
    db.prepare(`SELECT COALESCE(SUM(oi.quantity * oi.unit_price_cents),0) AS revenue_cents FROM route_stops s JOIN order_items oi ON oi.order_id=s.order_id WHERE s.route_id=?`).bind(row.id).first<{ revenue_cents: number }>(),
    db.prepare("SELECT id,stop_id,event_type,occurred_at,odometer_km,fuel_liters,notes FROM route_events WHERE route_id=? ORDER BY occurred_at,id").bind(row.id).all<{ id: number; stop_id: number | null; event_type: string; occurred_at: number; odometer_km: number | null; fuel_liters: number | null; notes: string | null }>(),
    db.prepare("SELECT oi.quantity,oi.unit,oi.package_count,oi.package_type,oi.package_unit_weight_kg,oi.weight_kg FROM route_stops s JOIN order_items oi ON oi.order_id=s.order_id WHERE s.route_id=?").bind(row.id).all<LoadItem>(),
  ]);
  const weight = stops.results.reduce((sum, stop) => sum + Number(stop.weight_kg || 0), 0);
  const revenueCents = Math.round(revenue?.revenue_cents ?? 0);
  const firstOdometer = events.results.find(event => event.odometer_km !== null)?.odometer_km ?? null;
  const lastOdometer = [...events.results].reverse().find(event => event.odometer_km !== null)?.odometer_km ?? null;
  const measuredKm = firstOdometer !== null && lastOdometer !== null ? Math.max(0, lastOdometer - firstOdometer) : null;
  const departure = events.results.find(event => event.event_type === "departure")?.occurred_at ?? null, returned = [...events.results].reverse().find(event => event.event_type === "return")?.occurred_at ?? null;
  const durationHours = departure && returned && returned >= departure ? (returned - departure) / 3600 : null, completedDeliveries = stops.results.filter(stop => stop.status === "completed").length;
  const serviceMinutes = new Map<number, number>();
  stops.results.forEach(stop => { const arrival = events.results.find(event => event.stop_id === stop.id && event.event_type === "stop_arrival")?.occurred_at, finished = events.results.find(event => event.stop_id === stop.id && ["delivery_completed", "delivery_failed"].includes(event.event_type))?.occurred_at; if (arrival && finished && finished >= arrival) serviceMinutes.set(stop.id, (finished - arrival) / 60); });
  const averageServiceMinutes = serviceMinutes.size ? [...serviceMinutes.values()].reduce((sum, value) => sum + value, 0) / serviceMinutes.size : null;
  const packages = new Map<string, { packageType: string; unitWeightKg: number; count: number }>();
  loadItems.results.forEach(item => { const inferredPackage = /^(un|cx|caixa|fardo|bombona|tambor|container|contêiner)$/i.test(item.unit); const count = Number(item.package_count || (inferredPackage ? item.quantity : 0)); const packageType = String(item.package_type || (inferredPackage ? item.unit : "")).trim(); if (!count || !packageType) return; const unitWeightKg = Number(item.package_unit_weight_kg || 0), key = `${packageType.toLowerCase()}|${unitWeightKg}`; const current = packages.get(key) ?? { packageType, unitWeightKg, count: 0 }; current.count += count; packages.set(key, current); });
  return { id: row.id, code: row.code, name: row.name, vehicleId: row.vehicle_id, plate: row.plate ?? "", model: row.model ?? "", driverName: row.driver_name, routeDate: date(row.route_date), status: row.status, plannedKm: row.planned_km, estimatedCostCents: row.estimated_cost_cents, revenueCents, estimatedProfitCents: revenueCents - row.estimated_cost_cents, capacityKg: row.capacity_kg ?? null, loadedKg: weight, occupancy: row.capacity_kg ? Math.round(weight / row.capacity_kg * 100) : null, remainingCapacityKg: row.capacity_kg ? Math.max(0, row.capacity_kg - weight) : null, canAddDeliveries: row.capacity_kg ? weight < row.capacity_kg : null, loadSummary: [...packages.values()].sort((a, b) => a.packageType.localeCompare(b.packageType, "pt-BR")), measuredKm, fuelLiters: events.results.reduce((sum, event) => sum + Number(event.fuel_liters ?? 0), 0) || null, durationHours, completedDeliveries, deliveriesPerHour: durationHours && durationHours > 0 ? completedDeliveries / durationHours : null, averageServiceMinutes, costPerDeliveryCents: completedDeliveries ? Math.round(row.estimated_cost_cents / completedDeliveries) : null, costPerKmCents: measuredKm && measuredKm > 0 ? Math.round(row.estimated_cost_cents / measuredKm) : null, profitPerKmCents: measuredKm && measuredKm > 0 ? Math.round((revenueCents - row.estimated_cost_cents) / measuredKm) : null, events: events.results.map(event => ({ id: event.id, stopId: event.stop_id, eventType: event.event_type, occurredAt: event.occurred_at, odometerKm: event.odometer_km, fuelLiters: event.fuel_liters, notes: event.notes ?? "" })), stops: stops.results.map(s => ({ id: s.id, orderId: s.order_id, orderNumber: s.order_number, customerName: s.customer_name, sequence: s.sequence, status: s.status, address: s.address_snapshot, weightKg: s.weight_kg, packageSummary: s.package_summary, paymentTerms: s.payment_terms ?? "", serviceMinutes: serviceMinutes.get(s.id) ?? null, deliveredAt: s.delivered_at, notes: s.notes ?? "" })) };
}

export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(), id = Number(request.nextUrl.searchParams.get("id"));
  if (Number.isInteger(id) && id > 0) {
    const row = await db.prepare(`SELECT r.*,v.plate,v.model,v.capacity_kg FROM routes r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=?`).bind(id).first<RouteRow>();
    if (!row) return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    return NextResponse.json({ route: { ...(await details(db, row)), originAddress: row.origin_address ?? "" } });
  }
  const rows = await db.prepare(`SELECT r.*,v.plate,v.model,v.capacity_kg FROM routes r JOIN vehicles v ON v.id=r.vehicle_id ORDER BY r.route_date DESC,r.id DESC`).all<RouteRow>();
  const routes = await Promise.all(rows.results.map(async row => ({ ...(await details(db, row)), originAddress: row.origin_address ?? "" })));
  return NextResponse.json({ routes });
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>, db = getD1();
  const vehicleId = Number(body.vehicleId), orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(Number) : [];
  if (!Number.isInteger(vehicleId) || vehicleId <= 0 || !orderIds.length) return NextResponse.json({ error: "Selecione um caminhão e ao menos um pedido." }, { status: 400 });
  if (!String(body.originAddress || "").trim()) return NextResponse.json({ error: "Informe o ponto de partida ou depósito da rota." }, { status: 400 });
  const vehicle = await db.prepare("SELECT id,plate,model,capacity_kg FROM vehicles WHERE id=? AND status='active'").bind(vehicleId).first<{ id: number; plate: string; model: string; capacity_kg: number | null }>();
  if (!vehicle) return NextResponse.json({ error: "Caminhão ativo não encontrado." }, { status: 404 });
  const placeholders = orderIds.map(() => "?").join(",");
  const orders = await db.prepare(`SELECT o.id,o.number,o.payment_terms,c.company_name,c.street,c.number AS address_number,c.complement,c.district,c.city,c.state,c.zip_code FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id IN (${placeholders}) AND o.status <> 'cancelled'`).bind(...orderIds).all<Record<string, unknown>>();
  if (orders.results.length !== orderIds.length) return NextResponse.json({ error: "Um ou mais pedidos não foram encontrados ou estão cancelados." }, { status: 400 });
  const items = await db.prepare(`SELECT order_id,quantity,unit,product_name,package_count,package_type,package_unit_weight_kg,weight_kg FROM order_items WHERE order_id IN (${placeholders})`).bind(...orderIds).all<{ order_id: number; quantity: number; unit: string; product_name: string; package_count: number; package_type: string; package_unit_weight_kg: number; weight_kg: number }>();
  const alreadyAssigned = await db.prepare(`SELECT s.order_id FROM route_stops s JOIN routes r ON r.id=s.route_id WHERE s.order_id IN (${placeholders}) AND r.status IN ('draft','active')`).bind(...orderIds).all<{ order_id: number }>();
  if (alreadyAssigned.results.length) return NextResponse.json({ error: `Pedido(s) já alocado(s) em uma rota ativa: ${alreadyAssigned.results.map(item => item.order_id).join(", ")}.` }, { status: 409 });
  const byOrder = new Map<number, typeof items.results>();
  items.results.forEach(item => byOrder.set(item.order_id, [...(byOrder.get(item.order_id) ?? []), item]));
  const stopData = orders.results.map((order, index) => {
    const orderItems = byOrder.get(Number(order.id)) ?? [];
    const weight = orderItems.reduce((sum, item) => sum + Number(item.weight_kg || (item.package_count && item.package_unit_weight_kg ? item.package_count * item.package_unit_weight_kg : /kg|quilo/i.test(item.unit) ? item.quantity : 0)), 0);
    const packages = orderItems.map(item => item.package_count && item.package_type ? `${item.package_count} ${item.package_type}${item.package_unit_weight_kg ? ` de ${item.package_unit_weight_kg} kg` : ""} · ${item.product_name}` : `${item.quantity} ${item.unit} · ${item.product_name}`).join("; ");
    return { order, index, weight, packages };
  });
  const orderedStops = body.optimize ? stopData.sort((a, b) => String(a.order.city ?? "").localeCompare(String(b.order.city ?? ""), "pt-BR") || String(a.order.district ?? "").localeCompare(String(b.order.district ?? ""), "pt-BR") || String(a.order.company_name ?? "").localeCompare(String(b.order.company_name ?? ""), "pt-BR")) : stopData;
  const loaded = orderedStops.reduce((sum, item) => sum + item.weight, 0);
  if (vehicle.capacity_kg && loaded > vehicle.capacity_kg) return NextResponse.json({ error: `Capacidade excedida: ${loaded.toLocaleString("pt-BR")} kg em um caminhão de ${vehicle.capacity_kg.toLocaleString("pt-BR")} kg.` }, { status: 409 });
  const timestamp = now(), code = `ROT-${timestamp}-${Math.floor(Math.random() * 900 + 100)}`;
  const route = await db.prepare(`INSERT INTO routes (code,name,vehicle_id,driver_name,route_date,origin_address,status,planned_km,estimated_cost_cents,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).bind(code, String(body.name || `Rota ${vehicle.plate}`), vehicleId, String(body.driverName || ""), epoch(body.routeDate), String(body.originAddress || ""), String(body.status || "draft"), Number(body.plannedKm || 0), Number(body.estimatedCostCents || 0), String(body.notes || ""), actor.userId, timestamp, timestamp).first<RouteRow>();
  if (!route) return NextResponse.json({ error: "Não foi possível criar a rota." }, { status: 500 });
  const statements: D1PreparedStatement[] = [];
  orderedStops.forEach((item, index) => statements.push(db.prepare(`INSERT INTO route_stops (route_id,order_id,sequence,status,address_snapshot,weight_kg,package_summary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(route.id, Number(item.order.id), index + 1, "pending", address(item.order), item.weight, item.packages, timestamp, timestamp)));
  await db.batch(statements);
  await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','route',?,?,?)").bind(actor.userId, String(route.id), JSON.stringify({ code, orderIds, loadedKg: loaded }), timestamp).run();
  return NextResponse.json({ route: { ...(await details(db, { ...route, plate: vehicle.plate, model: vehicle.model, capacity_kg: vehicle.capacity_kg })), originAddress: route.origin_address ?? "" } }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>, id = Number(body.id), db = getD1();
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Rota inválida" }, { status: 400 });
  const current = await db.prepare("SELECT * FROM routes WHERE id=?").bind(id).first<RouteRow>();
  if (!current) return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
  const timestamp = now();
  await db.prepare("UPDATE routes SET name=?,driver_name=?,origin_address=?,status=?,planned_km=?,estimated_cost_cents=?,notes=?,updated_at=? WHERE id=?").bind(String(body.name ?? current.name), String(body.driverName ?? current.driver_name), String(body.originAddress ?? current.origin_address ?? ""), String(body.status ?? current.status), Number(body.plannedKm ?? current.planned_km), Number(body.estimatedCostCents ?? current.estimated_cost_cents), String(body.notes ?? current.notes ?? ""), timestamp, id).run();
  if (Array.isArray(body.orderIds)) {
    const orderIds = body.orderIds.map(Number).filter(value => Number.isInteger(value) && value > 0);
    const stops = await db.prepare("SELECT id,order_id FROM route_stops WHERE route_id=?").bind(id).all<{ id: number; order_id: number }>();
    const byOrder = new Map(stops.results.map(stop => [stop.order_id, stop.id]));
    if (orderIds.length !== stops.results.length || orderIds.some(orderId => !byOrder.has(orderId))) return NextResponse.json({ error: "A sequência deve conter exatamente todas as paradas da rota." }, { status: 400 });
    await db.batch(orderIds.map((orderId, index) => db.prepare("UPDATE route_stops SET sequence=?,updated_at=? WHERE id=? AND route_id=?").bind(index + 1, timestamp, byOrder.get(orderId), id)));
  }
  const row = await db.prepare(`SELECT r.*,v.plate,v.model,v.capacity_kg FROM routes r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=?`).bind(id).first<RouteRow>();
  return NextResponse.json({ route: { ...(await details(db, row!)), originAddress: row?.origin_address ?? "" } });
}
