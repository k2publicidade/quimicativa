import { NextRequest, NextResponse } from "next/server";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type RouteRow = { id: number; code: string; name: string; vehicle_id: number; driver_id: number | null; driver_name: string; route_date: number; origin_address: string; status: string; planned_km: number; estimated_cost_cents: number; notes: string | null; created_at: number; updated_at: number; plate?: string; model?: string; capacity_kg?: number | null; capacity_m3?: number | null };
type StopRow = { id: number; route_id: number; order_id: number; sequence: number; status: string; address_snapshot: string; weight_kg: number; volume_m3: number; package_summary: string; receiving_window: string; delivered_at: number | null; notes: string | null; order_number: string; customer_name: string; payment_terms: string };
type LoadItem = { product_name: string; quantity: number; unit: string; package_count: number; package_type: string; package_unit_weight_kg: number; weight_kg: number; volume_m3: number; un_number: string; hazard_class: string; flammable: number; controlled: number };
const now = () => Math.floor(Date.now() / 1000);
const epoch = (value: unknown) => value ? Math.floor(new Date(String(value)).getTime() / 1000) : now();
const date = (value: number) => new Date(value * 1000).toISOString().slice(0, 10);
const address = (c: Record<string, unknown> | null) => c ? [c.street, c.number, c.complement, c.district, c.city, c.state, c.zip_code].filter(Boolean).join(", ") : "";

async function details(db: D1Database, row: RouteRow) {
  const [stops, revenue, events, loadItems, profitability, driverDocument] = await Promise.all([
    db.prepare(`SELECT s.*,o.number AS order_number,o.payment_terms,c.company_name AS customer_name FROM route_stops s JOIN orders o ON o.id=s.order_id JOIN customers c ON c.id=o.customer_id WHERE s.route_id=? ORDER BY s.sequence`).bind(row.id).all<StopRow>(),
    db.prepare(`SELECT COALESCE(SUM(oi.quantity * oi.unit_price_cents),0) AS revenue_cents FROM route_stops s JOIN order_items oi ON oi.order_id=s.order_id WHERE s.route_id=?`).bind(row.id).first<{ revenue_cents: number }>(),
    db.prepare("SELECT id,stop_id,event_type,occurred_at,odometer_km,fuel_liters,notes FROM route_events WHERE route_id=? ORDER BY occurred_at,id").bind(row.id).all<{ id: number; stop_id: number | null; event_type: string; occurred_at: number; odometer_km: number | null; fuel_liters: number | null; notes: string | null }>(),
    db.prepare("SELECT oi.product_name,oi.quantity,oi.unit,oi.package_count,oi.package_type,oi.package_unit_weight_kg,oi.weight_kg,oi.volume_m3,COALESCE(p.un_number,'') AS un_number,COALESCE(p.hazard_class,'') AS hazard_class,COALESCE(p.flammable,0) AS flammable,COALESCE(p.controlled,0) AS controlled FROM route_stops s JOIN order_items oi ON oi.order_id=s.order_id LEFT JOIN products p ON p.id=oi.product_id WHERE s.route_id=?").bind(row.id).all<LoadItem>(),
    db.prepare("SELECT COALESCE(SUM(gross_profit_cents),0) AS actual_profit_cents,COALESCE(SUM(delivery_cost_cents),0) AS actual_cost_cents,COUNT(*) AS profit_rows FROM profitability_entries WHERE route_id=?").bind(row.id).first<{ actual_profit_cents: number; actual_cost_cents: number; profit_rows: number }>(),
    row.driver_id ? db.prepare("SELECT license_expiry,mopp_expiry FROM drivers WHERE id=?").bind(row.driver_id).first<{ license_expiry: number | null; mopp_expiry: number | null }>() : Promise.resolve(null),
  ]);
  const weight = stops.results.reduce((sum, stop) => sum + Number(stop.weight_kg || 0), 0);
  const loadedM3 = stops.results.reduce((sum, stop) => sum + Number(stop.volume_m3 || 0), 0);
  const volumeDataComplete = loadItems.results.length > 0 && loadItems.results.every(item => Number(item.volume_m3) > 0);
  const revenueCents = Math.round(revenue?.revenue_cents ?? 0);
  const estimatedProfitCents = revenueCents - row.estimated_cost_cents;
  const hasActualProfit = Number(profitability?.profit_rows ?? 0) > 0;
  const actualProfitCents = hasActualProfit ? Math.round(Number(profitability?.actual_profit_cents ?? 0)) : null;
  const actualCostCents = hasActualProfit ? Math.round(Number(profitability?.actual_cost_cents ?? 0)) : null;
  const operationalProfitCents = actualProfitCents ?? estimatedProfitCents;
  const operationalCostCents = actualCostCents ?? row.estimated_cost_cents;
  const firstOdometer = events.results.find(event => event.odometer_km !== null)?.odometer_km ?? null;
  const lastOdometer = [...events.results].reverse().find(event => event.odometer_km !== null)?.odometer_km ?? null;
  const measuredKm = firstOdometer !== null && lastOdometer !== null ? Math.max(0, lastOdometer - firstOdometer) : null;
  const departure = events.results.find(event => event.event_type === "departure")?.occurred_at ?? null, returned = [...events.results].reverse().find(event => event.event_type === "return")?.occurred_at ?? null;
  const durationHours = departure && returned && returned >= departure ? (returned - departure) / 3600 : null, completedDeliveries = stops.results.filter(stop => stop.status === "completed").length;
  const serviceMinutes = new Map<number, number>();
  stops.results.forEach(stop => { const arrival = events.results.find(event => event.stop_id === stop.id && event.event_type === "stop_arrival")?.occurred_at, finished = events.results.find(event => event.stop_id === stop.id && ["delivery_completed", "delivery_failed"].includes(event.event_type))?.occurred_at; if (arrival && finished && finished >= arrival) serviceMinutes.set(stop.id, (finished - arrival) / 60); });
  const averageServiceMinutes = serviceMinutes.size ? [...serviceMinutes.values()].reduce((sum, value) => sum + value, 0) / serviceMinutes.size : null;
  const stoppedMinutes = serviceMinutes.size ? [...serviceMinutes.values()].reduce((sum, value) => sum + value, 0) : null;
  const drivingHours = durationHours !== null && stoppedMinutes !== null ? Math.max(0, durationHours - stoppedMinutes / 60) : null;
  const packages = new Map<string, { packageType: string; unitWeightKg: number; count: number }>();
  loadItems.results.forEach(item => { const inferredPackage = /^(un|cx|caixa|fardo|bombona|tambor|container|contêiner)$/i.test(item.unit); const count = Number(item.package_count || (inferredPackage ? item.quantity : 0)); const packageType = String(item.package_type || (inferredPackage ? item.unit : "")).trim(); if (!count || !packageType) return; const unitWeightKg = Number(item.package_unit_weight_kg || 0), key = `${packageType.toLowerCase()}|${unitWeightKg}`; const current = packages.get(key) ?? { packageType, unitWeightKg, count: 0 }; current.count += count; packages.set(key, current); });
  const products = new Map<string, { productName: string; quantity: number; unit: string; unNumber: string; hazardClass: string; flammable: boolean; controlled: boolean }>();
  loadItems.results.forEach(item => { const key = `${item.product_name.toLowerCase()}|${item.unit}|${item.un_number}`; const current = products.get(key) ?? { productName: item.product_name, quantity: 0, unit: item.unit, unNumber: item.un_number, hazardClass: item.hazard_class, flammable: Boolean(item.flammable), controlled: Boolean(item.controlled) }; current.quantity += Number(item.quantity || 0); products.set(key, current); });
  const productSummary = [...products.values()].sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR"));
  const hazardousLoad = productSummary.some(item => item.unNumber || item.hazardClass || item.flammable || item.controlled);
  const hasValidMopp = Boolean(driverDocument?.mopp_expiry && driverDocument.mopp_expiry >= row.route_date);
  const safetyNotices = [
    hazardousLoad ? "Carga com produto perigoso: conferir documentação, sinalização, segregação e ficha de emergência." : "",
    productSummary.some(item => item.flammable) ? "Há produto inflamável na carga." : "",
    productSummary.some(item => item.controlled) ? "Há produto controlado na carga; confira autorizações aplicáveis." : "",
    hazardousLoad && !hasValidMopp ? "Comprovante MOPP válido não localizado no cadastro documental associado a esta operação; confirme a habilitação do motorista." : "",
  ].filter(Boolean);
  const fuelLiters = events.results.reduce((sum, event) => sum + Number(event.fuel_liters ?? 0), 0) || null;
  return { id: row.id, code: row.code, name: row.name, vehicleId: row.vehicle_id, plate: row.plate ?? "", model: row.model ?? "", driverName: row.driver_name, routeDate: date(row.route_date), status: row.status, plannedKm: row.planned_km, estimatedCostCents: row.estimated_cost_cents, actualCostCents, costSource: hasActualProfit ? "imported" : "estimated", revenueCents, estimatedProfitCents, actualProfitCents, profitSource: hasActualProfit ? "imported" : "estimated", capacityKg: row.capacity_kg ?? null, loadedKg: weight, occupancy: row.capacity_kg ? Math.round(weight / row.capacity_kg * 100) : null, remainingCapacityKg: row.capacity_kg ? Math.max(0, row.capacity_kg - weight) : null, capacityM3: row.capacity_m3 ?? null, loadedM3, volumeDataComplete, volumeOccupancy: row.capacity_m3 && volumeDataComplete ? Math.round(loadedM3 / row.capacity_m3 * 100) : null, remainingCapacityM3: row.capacity_m3 && volumeDataComplete ? Math.max(0, row.capacity_m3 - loadedM3) : null, canAddDeliveries: !row.capacity_kg && !row.capacity_m3 ? null : (row.capacity_kg ? weight < row.capacity_kg : true) && (row.capacity_m3 ? volumeDataComplete && loadedM3 < row.capacity_m3 : true), loadSummary: [...packages.values()].sort((a, b) => a.packageType.localeCompare(b.packageType, "pt-BR")), productSummary, hazardousLoad, hasValidMopp, safetyNotices, measuredKm, fuelLiters, fuelEfficiencyKmL: measuredKm && measuredKm > 0 && fuelLiters ? measuredKm / fuelLiters : null, durationHours, drivingHours, stoppedMinutes, completedDeliveries, deliveriesPerHour: durationHours && durationHours > 0 ? completedDeliveries / durationHours : null, averageServiceMinutes, costPerDeliveryCents: completedDeliveries ? Math.round(operationalCostCents / completedDeliveries) : null, costPerKmCents: measuredKm && measuredKm > 0 ? Math.round(operationalCostCents / measuredKm) : null, profitPerKmCents: measuredKm && measuredKm > 0 ? Math.round(operationalProfitCents / measuredKm) : null, events: events.results.map(event => ({ id: event.id, stopId: event.stop_id, eventType: event.event_type, occurredAt: event.occurred_at, odometerKm: event.odometer_km, fuelLiters: event.fuel_liters, notes: event.notes ?? "" })), stops: stops.results.map(s => ({ id: s.id, orderId: s.order_id, orderNumber: s.order_number, customerName: s.customer_name, sequence: s.sequence, status: s.status, address: s.address_snapshot, weightKg: s.weight_kg, volumeM3: s.volume_m3, packageSummary: s.package_summary, receivingWindow: s.receiving_window ?? "", paymentTerms: s.payment_terms ?? "", serviceMinutes: serviceMinutes.get(s.id) ?? null, deliveredAt: s.delivered_at, notes: s.notes ?? "" })) };
}

export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(), id = Number(request.nextUrl.searchParams.get("id"));
  if (Number.isInteger(id) && id > 0) {
    const row = await db.prepare(`SELECT r.*,v.plate,v.model,v.capacity_kg,v.capacity_m3 FROM routes r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=?`).bind(id).first<RouteRow>();
    if (!row) return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    return NextResponse.json({ route: { ...(await details(db, row)), originAddress: row.origin_address ?? "" } });
  }
  const rows = await db.prepare(`SELECT r.*,v.plate,v.model,v.capacity_kg,v.capacity_m3 FROM routes r JOIN vehicles v ON v.id=r.vehicle_id ORDER BY r.route_date DESC,r.id DESC`).all<RouteRow>();
  const routes = await Promise.all(rows.results.map(async row => ({ ...(await details(db, row)), originAddress: row.origin_address ?? "" })));
  return NextResponse.json({ routes });
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>, db = getD1();
  const vehicleId = Number(body.vehicleId), driverId = Number(body.driverId), orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(Number) : [];
  if (!Number.isInteger(vehicleId) || vehicleId <= 0 || !Number.isInteger(driverId) || driverId <= 0 || !orderIds.length) return NextResponse.json({ error: "Selecione um caminhão, um motorista e ao menos um pedido." }, { status: 400 });
  if (!String(body.originAddress || "").trim()) return NextResponse.json({ error: "Informe o ponto de partida ou depósito da rota." }, { status: 400 });
  const vehicle = await db.prepare("SELECT id,plate,model,capacity_kg,capacity_m3 FROM vehicles WHERE id=? AND status='active'").bind(vehicleId).first<{ id: number; plate: string; model: string; capacity_kg: number | null; capacity_m3: number | null }>();
  if (!vehicle) return NextResponse.json({ error: "Caminhão ativo não encontrado." }, { status: 404 });
  const routeDate = epoch(body.routeDate);
  const driver = await db.prepare("SELECT id,name,license_expiry,mopp_expiry FROM drivers WHERE id=? AND status='active'").bind(driverId).first<{ id: number; name: string; license_expiry: number | null; mopp_expiry: number | null }>();
  if (!driver) return NextResponse.json({ error: "Motorista ativo não encontrado." }, { status: 404 });
  if (driver.license_expiry && driver.license_expiry < routeDate) return NextResponse.json({ error: "A CNH do motorista estará vencida na data da rota." }, { status: 409 });
  const conflictingRoute = await db.prepare("SELECT id,name FROM routes WHERE driver_id=? AND route_date=? AND status IN ('draft','active')").bind(driverId, routeDate).first<{ id: number; name: string }>();
  if (conflictingRoute) return NextResponse.json({ error: `O motorista já está vinculado à rota ${conflictingRoute.name} nesta data.` }, { status: 409 });
  const placeholders = orderIds.map(() => "?").join(",");
  const orders = await db.prepare(`SELECT o.id,o.number,o.payment_terms,c.company_name,c.street,c.number AS address_number,c.complement,c.district,c.city,c.state,c.zip_code,c.receiving_window FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id IN (${placeholders}) AND o.status <> 'cancelled'`).bind(...orderIds).all<Record<string, unknown>>();
  if (orders.results.length !== orderIds.length) return NextResponse.json({ error: "Um ou mais pedidos não foram encontrados ou estão cancelados." }, { status: 400 });
  const items = await db.prepare(`SELECT oi.order_id,oi.quantity,oi.unit,oi.product_name,oi.package_count,oi.package_type,oi.package_unit_weight_kg,oi.weight_kg,oi.volume_m3,COALESCE(p.un_number,'') AS un_number,COALESCE(p.hazard_class,'') AS hazard_class,COALESCE(p.flammable,0) AS flammable,COALESCE(p.controlled,0) AS controlled FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id IN (${placeholders})`).bind(...orderIds).all<{ order_id: number; quantity: number; unit: string; product_name: string; package_count: number; package_type: string; package_unit_weight_kg: number; weight_kg: number; volume_m3: number; un_number: string; hazard_class: string; flammable: number; controlled: number }>();
  const hazardousLoad = items.results.some(item => item.un_number || item.hazard_class || item.flammable || item.controlled);
  if (hazardousLoad && (!driver.mopp_expiry || driver.mopp_expiry < routeDate)) return NextResponse.json({ error: "Esta carga contém produto perigoso e exige confirmação de MOPP válido do motorista na data da rota." }, { status: 409 });
  const alreadyAssigned = await db.prepare(`SELECT s.order_id FROM route_stops s JOIN routes r ON r.id=s.route_id WHERE s.order_id IN (${placeholders}) AND r.status IN ('draft','active')`).bind(...orderIds).all<{ order_id: number }>();
  if (alreadyAssigned.results.length) return NextResponse.json({ error: `Pedido(s) já alocado(s) em uma rota ativa: ${alreadyAssigned.results.map(item => item.order_id).join(", ")}.` }, { status: 409 });
  const byOrder = new Map<number, typeof items.results>();
  items.results.forEach(item => byOrder.set(item.order_id, [...(byOrder.get(item.order_id) ?? []), item]));
  const stopData = orders.results.map((order, index) => {
    const orderItems = byOrder.get(Number(order.id)) ?? [];
    const weight = orderItems.reduce((sum, item) => sum + Number(item.weight_kg || (item.package_count && item.package_unit_weight_kg ? item.package_count * item.package_unit_weight_kg : /kg|quilo/i.test(item.unit) ? item.quantity : 0)), 0);
    const packages = orderItems.map(item => item.package_count && item.package_type ? `${item.package_count} ${item.package_type}${item.package_unit_weight_kg ? ` de ${item.package_unit_weight_kg} kg` : ""} · ${item.product_name}` : `${item.quantity} ${item.unit} · ${item.product_name}`).join("; ");
    const volumeM3 = orderItems.reduce((sum, item) => sum + Number(item.volume_m3 || 0), 0);
    return { order, index, weight, volumeM3, packages };
  });
  const orderedStops = body.optimize ? stopData.sort((a, b) => String(a.order.city ?? "").localeCompare(String(b.order.city ?? ""), "pt-BR") || String(a.order.district ?? "").localeCompare(String(b.order.district ?? ""), "pt-BR") || String(a.order.company_name ?? "").localeCompare(String(b.order.company_name ?? ""), "pt-BR")) : stopData;
  const loaded = orderedStops.reduce((sum, item) => sum + item.weight, 0);
  const loadedM3 = orderedStops.reduce((sum, item) => sum + item.volumeM3, 0);
  if (vehicle.capacity_m3 && items.results.some(item => Number(item.volume_m3) <= 0)) return NextResponse.json({ error: "Cubagem incompleta: informe o volume de todos os itens antes de usar um caminhão com limite em m³." }, { status: 409 });
  if (vehicle.capacity_kg && loaded > vehicle.capacity_kg) return NextResponse.json({ error: `Capacidade excedida: ${loaded.toLocaleString("pt-BR")} kg em um caminhão de ${vehicle.capacity_kg.toLocaleString("pt-BR")} kg.` }, { status: 409 });
  if (vehicle.capacity_m3 && loadedM3 > vehicle.capacity_m3) return NextResponse.json({ error: `Cubagem excedida: ${loadedM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³ em um caminhão de ${vehicle.capacity_m3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³.` }, { status: 409 });
  const timestamp = now(), code = `ROT-${timestamp}-${Math.floor(Math.random() * 900 + 100)}`;
  const route = await db.prepare(`INSERT INTO routes (code,name,vehicle_id,driver_id,driver_name,route_date,origin_address,status,planned_km,estimated_cost_cents,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).bind(code, String(body.name || `Rota ${vehicle.plate}`), vehicleId, driver.id, driver.name, routeDate, String(body.originAddress || ""), String(body.status || "draft"), Number(body.plannedKm || 0), Number(body.estimatedCostCents || 0), String(body.notes || ""), actor.userId, timestamp, timestamp).first<RouteRow>();
  if (!route) return NextResponse.json({ error: "Não foi possível criar a rota." }, { status: 500 });
  const statements: D1PreparedStatement[] = [];
  orderedStops.forEach((item, index) => statements.push(db.prepare(`INSERT INTO route_stops (route_id,order_id,sequence,status,address_snapshot,weight_kg,volume_m3,package_summary,receiving_window,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(route.id, Number(item.order.id), index + 1, "pending", address(item.order), item.weight, item.volumeM3, item.packages, String(item.order.receiving_window || ""), timestamp, timestamp)));
  await db.batch(statements);
  await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','route',?,?,?)").bind(actor.userId, String(route.id), JSON.stringify({ code, orderIds, loadedKg: loaded }), timestamp).run();
  return NextResponse.json({ route: { ...(await details(db, { ...route, plate: vehicle.plate, model: vehicle.model, capacity_kg: vehicle.capacity_kg, capacity_m3: vehicle.capacity_m3 })), originAddress: route.origin_address ?? "" } }, { status: 201 });
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
  const row = await db.prepare(`SELECT r.*,v.plate,v.model,v.capacity_kg,v.capacity_m3 FROM routes r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=?`).bind(id).first<RouteRow>();
  return NextResponse.json({ route: { ...(await details(db, row!)), originAddress: row?.origin_address ?? "" } });
}
