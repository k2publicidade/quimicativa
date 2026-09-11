import { NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { getActor } from "../authz";

type OrderRow = { id: number; customer_id: number; order_date: number | null; delivery_date: number | null; status: string };
type CustomerRow = { id: number; company_name: string; city: string | null };
type ItemRow = { order_id: number; product_name: string };
type RouteRow = { id: number; name: string; capacity_kg: number | null; loaded_kg: number; cities: string | null };

export async function GET() {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(), now = Math.floor(Date.now() / 1000), day = 86400;
  const [customers, orders, items, routes] = await Promise.all([
    db.prepare("SELECT id,company_name,city FROM customers WHERE status='active'").all<CustomerRow>(),
    db.prepare("SELECT id,customer_id,order_date,delivery_date,status FROM orders WHERE status <> 'cancelled' ORDER BY customer_id,order_date").all<OrderRow>(),
    db.prepare("SELECT order_id,product_name FROM order_items").all<ItemRow>(),
    db.prepare("SELECT r.id,r.name,v.capacity_kg,COALESCE(SUM(s.weight_kg),0) AS loaded_kg,GROUP_CONCAT(DISTINCT c.city) AS cities FROM routes r JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN route_stops s ON s.route_id=r.id LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN customers c ON c.id=o.customer_id WHERE r.status IN ('draft','active') GROUP BY r.id,r.name,v.capacity_kg ORDER BY r.route_date,r.id").all<RouteRow>(),
  ]);
  const customerById = new Map(customers.results.map(customer => [customer.id, customer]));
  const history = new Map<number, number[]>();
  orders.results.forEach(order => { if (order.order_date) history.set(order.customer_id, [...(history.get(order.customer_id) ?? []), order.order_date]); });
  const atRisk = [...history.entries()].map(([customerId, dates]) => {
    const intervals = dates.slice(1).map((date, index) => (date - dates[index]) / day).filter(interval => interval > 0);
    const averageInterval = intervals.length ? Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length) : null;
    const daysSinceLastOrder = Math.max(0, Math.floor((now - dates[dates.length - 1]) / day));
    const cadenceDays = averageInterval ? [7, 15, 30].reduce((best, cadence) => Math.abs(cadence - averageInterval) < Math.abs(best - averageInterval) ? cadence : best) : null;
    return { customerId, customerName: customerById.get(customerId)?.company_name ?? "Cliente", city: customerById.get(customerId)?.city ?? "", averageInterval, cadenceDays, daysSinceLastOrder, overdue: Boolean(averageInterval && daysSinceLastOrder > averageInterval + 3) };
  }).filter(item => item.overdue).sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder).slice(0, 8);
  const productsByOrder = new Map<number, string[]>();
  items.results.forEach(item => productsByOrder.set(item.order_id, [...(productsByOrder.get(item.order_id) ?? []), item.product_name]));
  const pairCounts = new Map<string, number>();
  productsByOrder.forEach(productsInOrder => { const unique = [...new Set(productsInOrder)].sort(); for (let i = 0; i < unique.length; i += 1) for (let j = i + 1; j < unique.length; j += 1) { const key = `${unique[i]} + ${unique[j]}`; pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1); } });
  const productPairs = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pair, ordersCount]) => ({ pair, ordersCount }));
  const ordersByWeek = new Map<number, Set<number>>();
  orders.results.forEach(order => { if (!order.order_date) return; const week = Math.floor(order.order_date / (7 * day)); const buyers = ordersByWeek.get(week) ?? new Set<number>(); buyers.add(order.customer_id); ordersByWeek.set(week, buyers); });
  const customerPairCounts = new Map<string, { customerA: string; customerB: string; weeksCount: number }>();
  ordersByWeek.forEach(buyers => { const ids = [...buyers].sort((a, b) => a - b); for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) { const key = `${ids[i]}-${ids[j]}`, current = customerPairCounts.get(key) ?? { customerA: customerById.get(ids[i])?.company_name ?? "Cliente", customerB: customerById.get(ids[j])?.company_name ?? "Cliente", weeksCount: 0 }; current.weeksCount += 1; customerPairCounts.set(key, current); } });
  const customerPairs = [...customerPairCounts.values()].filter(pair => pair.weeksCount > 1).sort((a, b) => b.weeksCount - a.weeksCount).slice(0, 5);
  const orderCustomer = new Map(orders.results.map(order => [order.id, order.customer_id])), customerProducts = new Map<number, Set<string>>(), productCounts = new Map<string, number>();
  items.results.forEach(item => { const customerId = orderCustomer.get(item.order_id); if (!customerId) return; const owned = customerProducts.get(customerId) ?? new Set<string>(); owned.add(item.product_name); customerProducts.set(customerId, owned); productCounts.set(item.product_name, (productCounts.get(item.product_name) ?? 0) + 1); });
  const popularProducts = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).map(([product]) => product);
  const productOpportunities = atRisk.map(customer => ({ customerId: customer.customerId, customerName: customer.customerName, productName: popularProducts.find(product => !customerProducts.get(customer.customerId)?.has(product)) ?? "" })).filter(item => item.productName).slice(0, 5);
  const routeOpportunities = routes.results.flatMap(route => { const routeCities = new Set(String(route.cities ?? "").split(",").map(city => city.trim().toLowerCase()).filter(Boolean)), remainingKg = route.capacity_kg === null ? null : Math.max(0, Number(route.capacity_kg) - Number(route.loaded_kg)); return atRisk.filter(customer => customer.city && routeCities.has(customer.city.toLowerCase())).map(customer => ({ routeId: route.id, routeName: route.name, customerId: customer.customerId, customerName: customer.customerName, city: customer.city, remainingKg })); }).slice(0, 5);
  return NextResponse.json({ generatedAt: now, customersTracked: history.size, atRisk, productPairs, customerPairs, productOpportunities, routeOpportunities });
}
