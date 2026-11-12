/**
 * Planejamento de rotas: tipos, sugestão determinística e validação.
 * A sugestão da IA (DeepSeek) passa sempre por `repairPlan`, que garante as regras
 * do sistema — a IA sugere, mas nunca decide capacidade, MOPP ou alocação.
 */

export type PlanOrder = {
  id: number; number: string; customerName: string; district: string; city: string; state: string;
  deliveryDate: string; weightKg: number; volumeM3: number; missingVolume: boolean; hazardous: boolean;
  receivingWindow: string; packages: string;
};
export type PlanVehicle = { id: number; plate: string; model: string; capacityKg: number | null; capacityM3: number | null };
export type PlanDriver = { id: number; name: string; hasMopp: boolean };
export type PlanInput = { date: string; orders: PlanOrder[]; vehicles: PlanVehicle[]; drivers: PlanDriver[] };
export type PlanRoute = { vehicleId: number; driverId: number; orderIds: number[]; name: string; reason: string };
export type PlanResult = { routes: PlanRoute[]; unassigned: { orderId: number; reason: string }[]; summary: string; warnings: string[] };

export const regionOf = (order: Pick<PlanOrder, "city" | "state" | "district">) => [order.city, order.state].filter(Boolean).join(" / ") || order.district || "Região não informada";
const kg = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;

type Lane = PlanRoute & { weight: number; volume: number };
const capacityKg = (vehicle: PlanVehicle | undefined) => vehicle?.capacityKg ?? Infinity;
const capacityM3 = (vehicle: PlanVehicle | undefined) => vehicle?.capacityM3 ?? Infinity;

/** Verifica se o pedido cabe na rota e se o motorista pode levá-lo. Retorna o motivo quando não pode. */
function blocker(lane: Lane, order: PlanOrder, vehicle: PlanVehicle | undefined, driver: PlanDriver | undefined) {
  if (order.hazardous && !driver?.hasMopp) return "produto perigoso exige motorista com MOPP válido";
  if (vehicle?.capacityM3 && order.missingVolume) return "pedido sem cubagem para caminhão com limite em m³";
  if (lane.weight + order.weightKg > capacityKg(vehicle)) return "não cabe no peso do caminhão";
  if (lane.volume + order.volumeM3 > capacityM3(vehicle)) return "não cabe no volume do caminhão";
  return "";
}

const sortStops = (orders: PlanOrder[]) => [...orders].sort((a, b) => a.city.localeCompare(b.city, "pt-BR") || a.district.localeCompare(b.district, "pt-BR") || a.customerName.localeCompare(b.customerName, "pt-BR"));
const laneName = (lane: PlanRoute, byId: Map<number, PlanOrder>, vehicles: Map<number, PlanVehicle>) => {
  const cities = [...new Set(lane.orderIds.map(id => byId.get(id)?.city || byId.get(id)?.district).filter(Boolean))];
  return `${cities.slice(0, 3).join(" / ") || "Entregas"} — ${vehicles.get(lane.vehicleId)?.plate ?? ""}`.trim();
};

/**
 * Sugestão determinística: agrupa por cidade e enche os caminhões livres sem passar a capacidade.
 * Também completa um plano parcial (pedidos que sobraram depois da IA).
 */
export function baselinePlan(input: PlanInput, start: PlanRoute[] = []): PlanResult {
  const vehicles = new Map(input.vehicles.map(item => [item.id, item]));
  const drivers = new Map(input.drivers.map(item => [item.id, item]));
  const byId = new Map(input.orders.map(item => [item.id, item]));
  const lanes: Lane[] = start.map(route => ({ ...route, orderIds: [...route.orderIds], weight: route.orderIds.reduce((sum, id) => sum + (byId.get(id)?.weightKg ?? 0), 0), volume: route.orderIds.reduce((sum, id) => sum + (byId.get(id)?.volumeM3 ?? 0), 0) }));
  const placed = new Set(lanes.flatMap(lane => lane.orderIds));
  const freeVehicles = input.vehicles.filter(item => !lanes.some(lane => lane.vehicleId === item.id)).sort((a, b) => capacityKg(b) - capacityKg(a));
  // Motoristas com MOPP ficam por último para sobrarem para as cargas perigosas.
  const freeDrivers = input.drivers.filter(item => !lanes.some(lane => lane.driverId === item.id)).sort((a, b) => Number(a.hasMopp) - Number(b.hasMopp));
  const unassigned: PlanResult["unassigned"] = [];
  const open = (needsMopp: boolean) => {
    const vehicle = freeVehicles.shift();
    const driverIndex = needsMopp ? freeDrivers.findIndex(item => item.hasMopp) : 0;
    if (!vehicle || driverIndex < 0 || !freeDrivers.length) { if (vehicle) freeVehicles.unshift(vehicle); return null; }
    const [driver] = freeDrivers.splice(driverIndex, 1);
    const lane: Lane = { vehicleId: vehicle.id, driverId: driver.id, orderIds: [], name: "", reason: "", weight: 0, volume: 0 };
    lanes.push(lane);
    return lane;
  };
  const cities = (lane: Lane) => new Set(lane.orderIds.map(id => regionOf(byId.get(id)!)));
  const pick = (order: PlanOrder) => lanes
    .filter(lane => !blocker(lane, order, vehicles.get(lane.vehicleId), drivers.get(lane.driverId)))
    .sort((a, b) => Number(cities(b).has(regionOf(order))) - Number(cities(a).has(regionOf(order))) || cities(a).size - cities(b).size || (capacityKg(vehicles.get(b.vehicleId)) - b.weight) - (capacityKg(vehicles.get(a.vehicleId)) - a.weight))[0];

  const groups = new Map<string, PlanOrder[]>();
  input.orders.filter(order => !placed.has(order.id)).forEach(order => groups.set(regionOf(order), [...(groups.get(regionOf(order)) ?? []), order]));
  [...groups.values()].sort((a, b) => b.reduce((s, o) => s + o.weightKg, 0) - a.reduce((s, o) => s + o.weightKg, 0)).forEach(group => {
    for (const order of sortStops(group)) {
      // 1) caminhão que já atende a mesma cidade; 2) um caminhão livre novo; 3) qualquer um com espaço.
      let lane: Lane | null | undefined = pick(order);
      if (lane && !cities(lane).has(regionOf(order))) lane = undefined;
      if (!lane) { const fresh = open(order.hazardous); if (fresh && !blocker(fresh, order, vehicles.get(fresh.vehicleId), drivers.get(fresh.driverId))) lane = fresh; }
      if (!lane) lane = pick(order);
      if (!lane) {
        const anyLane = lanes[0];
        unassigned.push({ orderId: order.id, reason: anyLane ? blocker(anyLane, order, vehicles.get(anyLane.vehicleId), drivers.get(anyLane.driverId)) || "sem caminhão ou motorista livre" : "sem caminhão ou motorista livre nesta data" });
        continue;
      }
      lane.orderIds.push(order.id); lane.weight += order.weightKg; lane.volume += order.volumeM3;
    }
  });
  const routes = lanes.filter(lane => lane.orderIds.length).map(lane => ({
    vehicleId: lane.vehicleId, driverId: lane.driverId, orderIds: lane.orderIds,
    name: lane.name || laneName(lane, byId, vehicles),
    reason: lane.reason || `Agrupado por cidade: ${[...cities(lane)].join(", ")} · ${kg(lane.weight)}${vehicles.get(lane.vehicleId)?.capacityKg ? ` de ${kg(vehicles.get(lane.vehicleId)!.capacityKg!)}` : ""}.`,
  }));
  return { routes, unassigned, summary: `${routes.length} rota(s) para ${input.orders.length - unassigned.length} pedido(s).`, warnings: [] };
}

/**
 * Confere o plano proposto (ex.: pela IA) contra as regras do sistema:
 * caminhão/motorista existentes, livres e usados uma única vez; cada pedido uma vez;
 * capacidade, cubagem e MOPP. O que não passar volta para a sugestão determinística.
 */
export function repairPlan(input: PlanInput, proposal: unknown): PlanResult {
  const vehicles = new Map(input.vehicles.map(item => [item.id, item]));
  const drivers = new Map(input.drivers.map(item => [item.id, item]));
  const byId = new Map(input.orders.map(item => [item.id, item]));
  const raw = proposal && typeof proposal === "object" ? proposal as Record<string, unknown> : {};
  const warnings: string[] = [];
  const usedVehicles = new Set<number>(), usedDrivers = new Set<number>(), usedOrders = new Set<number>();
  const kept: Lane[] = [];
  for (const entry of Array.isArray(raw.routes) ? raw.routes : []) {
    if (!entry || typeof entry !== "object") continue;
    const route = entry as Record<string, unknown>;
    const vehicleId = Number(route.vehicleId), driverId = Number(route.driverId);
    const vehicle = vehicles.get(vehicleId), driver = drivers.get(driverId);
    if (!vehicle || !driver || usedVehicles.has(vehicleId) || usedDrivers.has(driverId)) { warnings.push("Uma rota sugerida usava caminhão ou motorista indisponível e foi refeita."); continue; }
    const lane: Lane = { vehicleId, driverId, orderIds: [], name: String(route.name ?? "").slice(0, 120).trim(), reason: String(route.reason ?? "").slice(0, 600).trim(), weight: 0, volume: 0 };
    for (const value of Array.isArray(route.orderIds) ? route.orderIds : []) {
      const order = byId.get(Number(value));
      if (!order || usedOrders.has(order.id)) continue;
      const problem = blocker(lane, order, vehicle, driver);
      if (problem) { warnings.push(`Pedido ${order.number} saiu da rota ${vehicle.plate}: ${problem}.`); continue; }
      lane.orderIds.push(order.id); lane.weight += order.weightKg; lane.volume += order.volumeM3; usedOrders.add(order.id);
    }
    if (!lane.orderIds.length) continue;
    usedVehicles.add(vehicleId); usedDrivers.add(driverId);
    if (!lane.name) lane.name = laneName(lane, byId, vehicles);
    kept.push(lane);
  }
  const completed = baselinePlan(input, kept.map(lane => ({ vehicleId: lane.vehicleId, driverId: lane.driverId, orderIds: lane.orderIds, name: lane.name, reason: lane.reason })));
  const aiReasons = new Map<number, string>();
  for (const entry of Array.isArray(raw.unassigned) ? raw.unassigned : []) {
    if (entry && typeof entry === "object") aiReasons.set(Number((entry as Record<string, unknown>).orderId), String((entry as Record<string, unknown>).reason ?? "").slice(0, 300));
  }
  const filled = completed.routes.reduce((sum, route) => sum + route.orderIds.length, 0) - usedOrders.size;
  if (filled > 0) warnings.push(`${filled} pedido(s) que a IA deixou de fora foram encaixados automaticamente.`);
  return {
    routes: completed.routes,
    unassigned: completed.unassigned.map(item => ({ ...item, reason: aiReasons.get(item.orderId) || item.reason })),
    summary: String(raw.summary ?? "").slice(0, 1200).trim() || completed.summary,
    warnings,
  };
}
