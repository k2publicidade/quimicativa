import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { getActor } from "../authz";

type ProfitRank = { label: string; revenue_cents: number; profit_cents: number; deliveries: number };
type RoutePerformance = { id: number; name: string; plate: string; loaded_kg: number; capacity_kg: number | null; loaded_m3: number; capacity_m3: number | null; volume_complete: number; profit_cents: number; profit_rows: number; deliveries: number };
type JourneyEvent = { route_id: number; stop_id: number | null; event_type: string; occurred_at: number; odometer_km: number | null; fuel_liters: number | null };

export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const requestedDays = Number(request.nextUrl.searchParams.get("days") || 30);
  const days = [7, 30, 90, 365].includes(requestedDays) ? requestedDays : 30;
  const db = getD1(), now = Math.floor(Date.now() / 1000), day = 86400;
  const periodStart = now - days * day, weekStart = now - Math.min(7, days) * day;
  const currentDate = new Date(now * 1000);
  const monthStart = Math.floor(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1) / 1000);
  const [week, month, salesWindows, profitability, customerProfit, routePerformance, journeyEvents] = await Promise.all([
    db.prepare("SELECT COUNT(DISTINCT o.customer_id) AS customers,COUNT(DISTINCT s.id) AS deliveries,COALESCE(SUM(s.weight_kg),0) AS weight_kg FROM route_stops s JOIN routes r ON r.id=s.route_id JOIN orders o ON o.id=s.order_id WHERE s.status='completed' AND COALESCE(s.delivered_at,r.route_date)>=?").bind(weekStart).first<{ customers: number; deliveries: number; weight_kg: number }>(),
    db.prepare("SELECT COALESCE(SUM(oi.quantity*oi.unit_price_cents),0) AS revenue_cents,COUNT(DISTINCT o.id) AS orders FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.status<>'cancelled' AND o.order_date>=?").bind(periodStart).first<{ revenue_cents: number; orders: number }>(),
    db.prepare("SELECT COALESCE(SUM(CASE WHEN o.order_date>=? THEN oi.quantity*oi.unit_price_cents ELSE 0 END),0) AS week_revenue_cents,COALESCE(SUM(CASE WHEN o.order_date>=? THEN oi.quantity*oi.unit_price_cents ELSE 0 END),0) AS month_revenue_cents FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.status<>'cancelled'").bind(now - 7 * day, monthStart).first<{ week_revenue_cents: number; month_revenue_cents: number }>(),
    db.prepare("SELECT COALESCE(SUM(gross_profit_cents),0) AS profit_cents,COALESCE(SUM(delivery_cost_cents),0) AS delivery_cost_cents FROM profitability_entries WHERE period>=?").bind(periodStart).first<{ profit_cents: number; delivery_cost_cents: number }>(),
    db.prepare("SELECT CASE WHEN c.company_name IS NOT NULL AND c.company_name<>'' THEN c.company_name WHEN p.region<>'' THEN p.region ELSE 'Sem classificação' END AS label,SUM(p.revenue_cents) AS revenue_cents,SUM(p.gross_profit_cents) AS profit_cents,SUM(p.delivery_count) AS deliveries FROM profitability_entries p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.period>=? GROUP BY label").bind(periodStart).all<ProfitRank>(),
    db.prepare("SELECT r.id,r.name,v.plate,v.capacity_kg,v.capacity_m3,COALESCE(load.loaded_kg,0) AS loaded_kg,COALESCE(load.loaded_m3,0) AS loaded_m3,COALESCE(load.volume_complete,0) AS volume_complete,COALESCE(profit.profit_cents,0) AS profit_cents,COALESCE(profit.profit_rows,0) AS profit_rows,COALESCE(load.deliveries,0) AS deliveries FROM routes r JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN (SELECT route_id,SUM(weight_kg) AS loaded_kg,SUM(volume_m3) AS loaded_m3,MIN(CASE WHEN volume_m3>0 THEN 1 ELSE 0 END) AS volume_complete,COUNT(*) AS deliveries FROM route_stops GROUP BY route_id) load ON load.route_id=r.id LEFT JOIN (SELECT route_id,SUM(gross_profit_cents) AS profit_cents,COUNT(*) AS profit_rows FROM profitability_entries WHERE period>=? GROUP BY route_id) profit ON profit.route_id=r.id WHERE r.route_date>=? ORDER BY r.route_date DESC,r.id DESC").bind(periodStart, periodStart).all<RoutePerformance>(),
    db.prepare("SELECT e.route_id,e.stop_id,e.event_type,e.occurred_at,e.odometer_km,e.fuel_liters FROM route_events e JOIN routes r ON r.id=e.route_id WHERE r.route_date>=? ORDER BY e.route_id,e.occurred_at,e.id").bind(periodStart).all<JourneyEvent>(),
  ]);
  const customers = customerProfit.results.map(item => ({ label: item.label, revenueCents: item.revenue_cents, profitCents: item.profit_cents, deliveries: item.deliveries })).sort((a, b) => b.profitCents - a.profitCents);
  const routes = routePerformance.results.map(item => {
    const weightOccupancy = item.capacity_kg ? item.loaded_kg * 100 / item.capacity_kg : null;
    const volumeOccupancy = item.capacity_m3 && item.volume_complete ? item.loaded_m3 * 100 / item.capacity_m3 : null;
    const known = [weightOccupancy, volumeOccupancy].filter((value): value is number => value !== null);
    return { id: item.id, name: item.name, plate: item.plate, loadedKg: item.loaded_kg, capacityKg: item.capacity_kg, loadedM3: item.loaded_m3, capacityM3: item.capacity_m3, weightOccupancy: weightOccupancy === null ? null : Math.round(weightOccupancy), volumeOccupancy: volumeOccupancy === null ? null : Math.round(volumeOccupancy), volumeDataComplete: Boolean(item.volume_complete), occupancy: known.length ? Math.round(Math.max(...known)) : null, limitingFactor: volumeOccupancy !== null && (weightOccupancy === null || volumeOccupancy > weightOccupancy) ? "volume" : weightOccupancy !== null ? "weight" : null, profitCents: item.profit_cents, hasProfitData: item.profit_rows > 0, deliveries: item.deliveries };
  });
  const vehicleGroups = new Map<string, { plate: string; routes: number; occupancyTotal: number; measuredRoutes: number; profitCents: number }>();
  routes.forEach(route => { const current = vehicleGroups.get(route.plate) ?? { plate: route.plate, routes: 0, occupancyTotal: 0, measuredRoutes: 0, profitCents: 0 }; current.routes += 1; current.profitCents += route.profitCents; if (route.occupancy !== null) { current.occupancyTotal += route.occupancy; current.measuredRoutes += 1; } vehicleGroups.set(route.plate, current); });
  const vehicles = [...vehicleGroups.values()].map(item => ({ plate: item.plate, routes: item.routes, averageOccupancy: item.measuredRoutes ? Math.round(item.occupancyTotal / item.measuredRoutes) : 0, profitCents: item.profitCents })).sort((a, b) => b.averageOccupancy - a.averageOccupancy);
  const measuredRoutes = routes.filter(route => route.occupancy !== null);
  const eventsByRoute = new Map<number, JourneyEvent[]>();
  journeyEvents.results.forEach(event => eventsByRoute.set(event.route_id, [...(eventsByRoute.get(event.route_id) ?? []), event]));
  let totalKm = 0, totalFuelLiters = 0, totalJourneyHours = 0, totalStoppedMinutes = 0, completedJourneys = 0, completedJourneyDeliveries = 0, measuredJourneys = 0, profitableWorkdays = 0, completedProfitCents = 0;
  eventsByRoute.forEach((events, routeId) => {
    const odometers = events.filter(event => event.odometer_km !== null).map(event => Number(event.odometer_km));
    if (odometers.length >= 2) { totalKm += Math.max(0, odometers[odometers.length - 1] - odometers[0]); measuredJourneys += 1; }
    totalFuelLiters += events.reduce((sum, event) => sum + Number(event.fuel_liters ?? 0), 0);
    const departure = events.find(event => event.event_type === "departure")?.occurred_at;
    const returned = [...events].reverse().find(event => event.event_type === "return")?.occurred_at;
    if (departure && returned && returned >= departure) { totalJourneyHours += (returned - departure) / 3600; completedJourneys += 1; const route = routes.find(item => item.id === routeId); if (route?.hasProfitData) { profitableWorkdays += 1; completedProfitCents += route.profitCents; } }
    completedJourneyDeliveries += events.filter(event => event.event_type === "delivery_completed").length;
    const arrivals = new Map<number, number>();
    events.forEach(event => {
      if (event.stop_id === null) return;
      if (event.event_type === "stop_arrival") arrivals.set(event.stop_id, event.occurred_at);
      if (["delivery_completed", "delivery_failed"].includes(event.event_type)) { const arrival = arrivals.get(event.stop_id); if (arrival && event.occurred_at >= arrival) totalStoppedMinutes += (event.occurred_at - arrival) / 60; }
    });
  });
  const logistics = {
    completedJourneys,
    measuredJourneys,
    totalKm,
    totalFuelLiters,
    averageJourneyHours: completedJourneys ? totalJourneyHours / completedJourneys : null,
    stoppedMinutes: totalStoppedMinutes || null,
    deliveriesPerHour: totalJourneyHours ? completedJourneyDeliveries / totalJourneyHours : null,
    fuelEfficiencyKmL: totalKm && totalFuelLiters ? totalKm / totalFuelLiters : null,
    profitableWorkdays,
    profitPerWorkdayCents: profitableWorkdays ? Math.round(completedProfitCents / profitableWorkdays) : null,
  };
  return NextResponse.json({ period: { days, weekStart, periodStart, generatedAt: now }, week: { customers: week?.customers ?? 0, deliveries: week?.deliveries ?? 0, weightKg: week?.weight_kg ?? 0, revenueCents: Math.round(salesWindows?.week_revenue_cents ?? 0) }, month: { revenueCents: Math.round(month?.revenue_cents ?? 0), calendarRevenueCents: Math.round(salesWindows?.month_revenue_cents ?? 0), orders: month?.orders ?? 0, profitCents: profitability?.profit_cents ?? 0, deliveryCostCents: profitability?.delivery_cost_cents ?? 0 }, fleet: { routes: routes.length, averageOccupancy: measuredRoutes.length ? Math.round(measuredRoutes.reduce((sum, route) => sum + (route.occupancy ?? 0), 0) / measuredRoutes.length) : 0, lowOccupancyRoutes: routes.filter(route => route.occupancy !== null && route.occupancy < 50).length }, logistics, rankings: { mostProfitableCustomers: customers.slice(0, 5), leastProfitableCustomers: [...customers].sort((a, b) => a.profitCents - b.profitCents).slice(0, 5), vehicles, routes }, alerts: { lowOccupancyRoutes: routes.filter(route => route.occupancy !== null && route.occupancy < 50).slice(0, 5), lowProfitRoutes: routes.filter(route => route.profitCents <= 0).sort((a, b) => a.profitCents - b.profitCents).slice(0, 5) } });
}
