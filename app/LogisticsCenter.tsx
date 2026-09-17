"use client";

import { useEffect, useMemo, useState } from "react";
import RouteMap from "./RouteMap";

type Order = { id: number; number: string; customerName: string; customerDistrict: string; customerCity: string; customerState: string; deliveryDate: string; status: string; totalCents: number; totalWeightKg: number; totalVolumeM3: number; missingVolumeItems: number };
type Vehicle = { id: number; plate: string; model: string; capacityKg: number | null; capacityM3: number | null; status: string };
type Driver = { id: number; name: string; licenseCategory: string; licenseExpiry: string; moppExpiry: string; status: string; alerts: string[] };
type RouteEvent = { id: number; stopId: number | null; eventType: string; occurredAt: number; odometerKm: number | null; fuelLiters: number | null; notes: string };
type RouteStop = { id: number; orderId: number; orderNumber: string; customerName: string; sequence: number; address: string; weightKg: number; volumeM3: number; packageSummary: string; receivingWindow: string; paymentTerms: string; serviceMinutes: number | null; status: string };
type Route = {
  id: number; code: string; name: string; plate: string; originAddress: string; driverName: string;
  routeDate: string; status: string; loadedKg: number; capacityKg: number | null;
  remainingCapacityKg: number | null; canAddDeliveries: boolean | null; occupancy: number | null;
  capacityM3: number | null; loadedM3: number; remainingCapacityM3: number | null; volumeOccupancy: number | null; volumeDataComplete: boolean;
  loadSummary: { packageType: string; unitWeightKg: number; count: number }[];
  productSummary: { productName: string; quantity: number; unit: string; unNumber: string; hazardClass: string; flammable: boolean; controlled: boolean }[];
  hazardousLoad: boolean; hasValidMopp: boolean; safetyNotices: string[];
  revenueCents: number; estimatedCostCents: number; actualCostCents: number | null; costSource: "imported" | "estimated"; estimatedProfitCents: number; actualProfitCents: number | null; profitSource: "imported" | "estimated";
  measuredKm: number | null; fuelLiters: number | null; fuelEfficiencyKmL: number | null; durationHours: number | null;
  drivingHours: number | null; stoppedMinutes: number | null;
  completedDeliveries: number; deliveriesPerHour: number | null; averageServiceMinutes: number | null;
  costPerDeliveryCents: number | null; costPerKmCents: number | null; profitPerKmCents: number | null;
  events: RouteEvent[]; stops: RouteStop[];
};

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const statusLabel = (value: string) => ({ draft: "Planejada", active: "Em andamento", completed: "Concluída", cancelled: "Cancelada" }[value] ?? value);
const routeUtilization = (route: Pick<Route, "occupancy" | "volumeOccupancy" | "capacityM3" | "volumeDataComplete">) => {
  if (route.capacityM3 && !route.volumeDataComplete) return { effective: null, limitingFactor: "cubagem pendente" };
  const known = [route.occupancy, route.volumeOccupancy].filter((value): value is number => value !== null);
  const effective = known.length ? Math.max(...known) : null;
  const limitingFactor = effective === null ? null : route.volumeOccupancy !== null && route.volumeOccupancy > (route.occupancy ?? -1) ? "cubagem" : "peso";
  return { effective, limitingFactor };
};

export default function LogisticsCenter({ notify, canWrite, initialOrderId = null, onInitialOrderConsumed, onManageDrivers }: { notify: (message: string) => void; canWrite: boolean; initialOrderId?: number | null; onInitialOrderConsumed?: () => void; onManageDrivers?: () => void }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [orderIds, setOrderIds] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [driverId, setDriverId] = useState("");
  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [originAddress, setOriginAddress] = useState("");
  const [plannedKm, setPlannedKm] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [routesResponse, ordersResponse, vehiclesResponse, driversResponse] = await Promise.all([
      fetch("/api/routes"),
      fetch("/api/orders?status=active"),
      fetch("/api/vehicles"),
      fetch("/api/drivers"),
    ]);
    const routeData = await routesResponse.json() as { routes?: Route[] };
    const orderData = await ordersResponse.json() as { orders?: Order[] };
    const vehicleData = await vehiclesResponse.json() as { vehicles?: Vehicle[] };
    const driverData = await driversResponse.json() as { drivers?: Driver[] };
    setRoutes(routeData.routes ?? []);
    setOrders(orderData.orders ?? []);
    setVehicles(vehicleData.vehicles ?? []);
    setDrivers(driverData.drivers ?? []);
  };

  useEffect(() => {
    load().catch(() => notify("Não foi possível carregar a operação logística"));
  }, []);

  const activeOrders = useMemo(
    () => orders.filter(order => !routes.some(route => route.stops.some(stop => stop.orderId === order.id))),
    [orders, routes],
  );
  const regionalOrders = useMemo(() => {
    const groups = new Map<string, { label: string; orders: Order[] }>();
    activeOrders.forEach(order => {
      const label = [order.customerCity, order.customerState].filter(Boolean).join(" / ") || order.customerDistrict || "Região não informada";
      const key = label.toLocaleLowerCase("pt-BR");
      const group = groups.get(key) ?? { label, orders: [] };
      group.orders.push(order);
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [activeOrders]);
  const currentVehicle = vehicles.find(vehicle => String(vehicle.id) === vehicleId);
  const selectedWeightKg = activeOrders
    .filter(order => orderIds.includes(order.id))
    .reduce((sum, order) => sum + Number(order.totalWeightKg || 0), 0);
  const projectedOccupancy = currentVehicle?.capacityKg
    ? Math.round(selectedWeightKg / currentVehicle.capacityKg * 100)
    : null;
  const selectedVolumeM3 = activeOrders.filter(order => orderIds.includes(order.id)).reduce((sum, order) => sum + Number(order.totalVolumeM3 || 0), 0);
  const hasIncompleteVolume = activeOrders.some(order => orderIds.includes(order.id) && order.missingVolumeItems > 0);
  const projectedVolumeOccupancy = currentVehicle?.capacityM3 ? Math.round(selectedVolumeM3 / currentVehicle.capacityM3 * 100) : null;
  const route = routes.find(item => item.id === selected) ?? routes[0];
  const measuredUtilization = routes.map(routeUtilization).filter(item => item.effective !== null);
  const averageUtilization = measuredUtilization.length ? Math.round(measuredUtilization.reduce((sum, item) => sum + (item.effective ?? 0), 0) / measuredUtilization.length) : null;

  useEffect(() => {
    if (!initialOrderId) return;
    const order = activeOrders.find(item => item.id === initialOrderId);
    if (!order) return;
    setOrderIds([order.id]);
    setName(`Entrega ${order.number}${order.customerCity ? ` — ${order.customerCity}` : ""}`);
    setRouteDate(order.deliveryDate || new Date().toISOString().slice(0, 10));
    setOriginAddress(current => current || "Rua Isidro Rocha, 48 — Vigário Geral — Rio de Janeiro/RJ — 21241-180");
    onInitialOrderConsumed?.();
  }, [initialOrderId, activeOrders, onInitialOrderConsumed]);

  const reorder = async (routeId: number, stopIndex: number, direction: -1 | 1) => {
    const target = routes.find(item => item.id === routeId);
    if (!target) return;
    const nextIndex = stopIndex + direction;
    if (nextIndex < 0 || nextIndex >= target.stops.length) return;
    const orderSequence = target.stops.map(stop => stop.orderId);
    [orderSequence[stopIndex], orderSequence[nextIndex]] = [orderSequence[nextIndex], orderSequence[stopIndex]];
    const response = await fetch("/api/routes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: routeId, orderIds: orderSequence }),
    });
    if (!response.ok) return notify("Não foi possível atualizar a sequência");
    notify("Sequência atualizada");
    await load();
  };

  const registerEvent = async (
    eventType: string,
    stopId?: number,
    details: { odometerKm?: number; fuelLiters?: number; notes?: string } = {},
  ) => {
    if (!route) return;
    const response = await fetch("/api/route-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: route.id, eventType, stopId, ...details }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) return notify(data.error || "Não foi possível registrar o evento");
    notify("Evento registrado");
    await load();
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: Number(vehicleId), driverId: Number(driverId), orderIds, name, originAddress,
          plannedKm: Number(plannedKm || 0),
          estimatedCostCents: Math.round(Number(estimatedCost || 0) * 100),
          optimize: true,
          routeDate,
        }),
      });
      const data = await response.json() as { error?: string; route?: { id: number } };
      if (!response.ok) throw new Error(data.error);
      notify("Rota criada com carga conferida");
      setOrderIds([]);
      setVehicleId("");
      setName("");
      setDriverId("");
      setOriginAddress("");
      setPlannedKm("");
      setEstimatedCost("");
      await load();
      if (data.route) setSelected(data.route.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível criar a rota");
    } finally {
      setSaving(false);
    }
  };

  return <div className="logistics-center">
    <section className="operation-flow logistics-flow" aria-label="Fluxo operacional">
      <div className="done"><b>✓</b><span><strong>Pedido montado</strong><small>Dados comerciais e carga</small></span></div><i>→</i>
      <div className="active"><b>2</b><span><strong>Montar rota</strong><small>Escalar caminhão e motorista</small></span></div><i>→</i>
      <div><b>3</b><span><strong>Imprimir romaneio</strong><small>Entregar à expedição e ao motorista</small></span></div>
    </section>
    <div className="logistics-summary">
      <article><span>Rotas programadas</span><strong>{routes.length}</strong><small>com carga rastreável</small></article>
      <article><span>Pedidos disponíveis</span><strong>{activeOrders.length}</strong><small>aguardando alocação</small></article>
      <article><span>Ocupação média efetiva</span><strong>{averageUtilization === null ? "—" : `${averageUtilization}%`}</strong><small>maior uso entre peso e cubagem</small></article>
    </div>

    <div className="logistics-grid">
      {canWrite && <form className="panel route-builder" onSubmit={create}>
        <div className="panel-heading"><div><h2>Montar nova rota</h2><p>Selecione o caminhão, o motorista, a base de saída e os pedidos do dia.</p></div>{onManageDrivers && <button type="button" className="manage-drivers-link" onClick={onManageDrivers}>Gerenciar motoristas</button>}</div>
        <label>Caminhão
          <select required value={vehicleId} onChange={event => setVehicleId(event.target.value)}>
            <option value="">Selecione um caminhão</option>
            {vehicles.filter(vehicle => vehicle.status === "active").map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} — {vehicle.model}{vehicle.capacityKg ? ` · ${vehicle.capacityKg.toLocaleString("pt-BR")} kg` : ""}{vehicle.capacityM3 ? ` · ${vehicle.capacityM3.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m³` : ""}</option>)}
          </select>
        </label>
        <div className="form-row">
          <label>Nome da rota<input value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Zona Norte — terça" /></label>
          <label>Data da rota<input required type="date" value={routeDate} onChange={event => setRouteDate(event.target.value)} /></label>
        </div>
        <label>Motorista
          <select required value={driverId} onChange={event => setDriverId(event.target.value)}>
            <option value="">Selecione um motorista</option>
            {drivers.filter(driver => driver.status === "active").map(driver => <option key={driver.id} value={driver.id}>{driver.name}{driver.licenseCategory ? ` · CNH ${driver.licenseCategory}` : ""}{driver.alerts.length ? ` · ${driver.alerts.join(", ")}` : ""}</option>)}
          </select>
        </label>
        {!drivers.length && onManageDrivers && <div className="driver-empty-alert"><div><strong>Nenhum motorista cadastrado</strong><small>Cadastre o condutor, a CNH e a validade do MOPP antes de montar a rota.</small></div><button type="button" onClick={onManageDrivers}>Cadastrar motorista</button></div>}
        <label>Ponto de partida / depósito
          <input required value={originAddress} onChange={event => setOriginAddress(event.target.value)} placeholder="Rua, número, cidade, estado e CEP" />
        </label>
        <div className="form-row">
          <label>Quilometragem prevista<input type="number" min="0" step="0.1" value={plannedKm} onChange={event => setPlannedKm(event.target.value)} placeholder="Ex.: 86,5" /></label>
          <label>Custo estimado (R$)<input type="number" min="0" step="0.01" value={estimatedCost} onChange={event => setEstimatedCost(event.target.value)} placeholder="Ex.: 420,00" /></label>
        </div>
        {currentVehicle && orderIds.length > 0 && <div className={`capacity-preview ${(projectedOccupancy !== null && projectedOccupancy > 100) || (projectedVolumeOccupancy !== null && projectedVolumeOccupancy > 100) ? "over" : ""}`}>
          <div><span>Carga selecionada</span><strong>{selectedWeightKg.toLocaleString("pt-BR")} kg</strong></div>
          <div><span>Ocupação prevista</span><strong>{projectedOccupancy !== null ? `${projectedOccupancy}%` : "Capacidade não cadastrada"}</strong></div>
          <div><span>Cubagem selecionada</span><strong>{hasIncompleteVolume ? "Dados incompletos" : `${selectedVolumeM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³`}</strong></div>
          <div><span>Ocupação por volume</span><strong>{hasIncompleteVolume && currentVehicle.capacityM3 ? "Informe a cubagem dos itens" : projectedVolumeOccupancy !== null ? `${projectedVolumeOccupancy}%` : "Capacidade não cadastrada"}</strong></div>
        </div>}
        <div className="route-order-list">
          <div className="route-list-header"><strong>Pedidos disponíveis</strong><small>{orderIds.length} selecionado(s)</small></div>
          {regionalOrders.length ? regionalOrders.map(group => {
            const ids = group.orders.map(order => order.id);
            const allSelected = ids.every(id => orderIds.includes(id));
            return <section className="route-region" key={group.label}>
              <header><div><strong>{group.label}</strong><small>{group.orders.length} pedido(s)</small></div><button type="button" onClick={() => setOrderIds(allSelected ? orderIds.filter(id => !ids.includes(id)) : [...new Set([...orderIds, ...ids])])}>{allSelected ? "Remover região" : "Selecionar região"}</button></header>
              {group.orders.map(order => <label className="route-order" key={order.id}>
                <input type="checkbox" checked={orderIds.includes(order.id)} onChange={event => setOrderIds(event.target.checked ? [...orderIds, order.id] : orderIds.filter(id => id !== order.id))} />
                <span><b>{order.number}</b> {order.customerName}<small>{order.customerDistrict ? `${order.customerDistrict} · ` : ""}{order.deliveryDate || "Sem data"} · {brl(order.totalCents)} · {order.totalWeightKg.toLocaleString("pt-BR")} kg{order.missingVolumeItems ? " · cubagem pendente" : ` · ${order.totalVolumeM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³`}</small></span>
              </label>)}
            </section>;
          }) : <p className="logistics-empty">Nenhum pedido ativo aguardando alocação.</p>}
        </div>
        <button className="primary-button" disabled={saving || !vehicleId || !driverId || !routeDate || !originAddress.trim() || !orderIds.length || Boolean((currentVehicle?.capacityM3 && hasIncompleteVolume) || (projectedOccupancy && projectedOccupancy > 100) || (projectedVolumeOccupancy && projectedVolumeOccupancy > 100))}>
          {saving ? "Conferindo carga..." : currentVehicle?.capacityM3 && hasIncompleteVolume ? "Cubagem pendente" : (projectedOccupancy && projectedOccupancy > 100) || (projectedVolumeOccupancy && projectedVolumeOccupancy > 100) ? "Capacidade excedida" : `Criar rota${currentVehicle ? ` · ${currentVehicle.plate}` : ""}`}
        </button>
      </form>}

      <section className="panel route-list-panel">
        <div className="panel-heading"><div><h2>Rotas e cargas</h2><p>Abra uma rota para revisar a sequência e o aproveitamento.</p></div></div>
        {routes.length ? <div className="route-cards">{routes.map(item => { const utilization = routeUtilization(item); return <button className={`route-card ${route?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}>
          <div><strong>{item.name}</strong><small>{item.code} · {item.plate} · {item.stops.length} entregas</small></div>
          <div className="route-card-side"><b>{utilization.effective === null ? "—" : `${utilization.effective}%`}</b><small>{utilization.limitingFactor === "cubagem pendente" ? utilization.limitingFactor : utilization.limitingFactor ? `limite: ${utilization.limitingFactor}` : "capacidade não cadastrada"}</small><span className={`route-status ${item.status}`}>{statusLabel(item.status)}</span></div>
        </button>; })}</div> : <div className="logistics-empty">Ainda não há rotas programadas.</div>}
      </section>
    </div>

    {route && <RouteDetails route={route} canWrite={canWrite} notify={notify} reload={load} reorder={reorder} />}
    {route && <section className="panel route-finance">
      <div><span>Faturamento da rota</span><strong>{brl(route.revenueCents)}</strong></div>
      <div><span>{route.costSource === "imported" ? "Custo realizado" : "Custo estimado"}</span><strong>{brl(route.actualCostCents ?? route.estimatedCostCents)}</strong></div>
      <div><span>{route.profitSource === "imported" ? "Lucro bruto realizado" : "Contribuição estimada"}</span><strong className={(route.actualProfitCents ?? route.estimatedProfitCents) >= 0 ? "positive" : "negative"}>{brl(route.actualProfitCents ?? route.estimatedProfitCents)}</strong></div>
    </section>}
    {route && <JourneyKpis route={route} />}
    {route && <RouteMonitoring route={route} canWrite={canWrite} onRegister={registerEvent} />}
  </div>;
}

function RouteDetails({ route, canWrite, notify, reload, reorder }: {
  route: Route;
  canWrite: boolean;
  notify: (message: string) => void;
  reload: () => Promise<void>;
  reorder: (routeId: number, stopIndex: number, direction: -1 | 1) => Promise<void>;
}) {
  const applySuggestion = async (optimizedOrderIds: number[], distanceKm: number) => {
    const response = await fetch("/api/routes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: route.id, orderIds: optimizedOrderIds, plannedKm: distanceKm }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) return notify(data.error || "Não foi possível aplicar a rota sugerida");
    notify("Melhor sequência viária aplicada");
    await reload();
  };

  return <section className="panel route-detail">
    <div className="panel-heading">
      <div><h2>{route.name}</h2><p>{route.plate} · {route.driverName || "Motorista não definido"} · {route.routeDate}</p></div>
      <div className="route-heading-actions">
        <a className="primary-button print-manifest" href={`/api/routes/manifest?id=${route.id}`} target="_blank" rel="noreferrer">Imprimir romaneio</a>
        <span className={`route-status ${route.status}`}>{statusLabel(route.status)}</span>
      </div>
    </div>
    <p className="route-origin"><strong>Saída e retorno:</strong> {route.originAddress || "Depósito não informado"}</p>
    <div className="load-meter">
      <div><span>Carga consolidada</span><strong>{route.loadedKg.toLocaleString("pt-BR")} kg {route.capacityKg ? <small>de {route.capacityKg.toLocaleString("pt-BR")} kg · {route.remainingCapacityKg?.toLocaleString("pt-BR")} kg livres</small> : null}</strong></div>
      <div className="meter"><i style={{ width: `${Math.min(route.occupancy ?? 0, 100)}%` }} /></div>
    </div>
    <div className="load-meter volume-meter">
      <div><span>Cubagem consolidada</span><strong>{route.volumeDataComplete ? `${route.loadedM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³` : "Dados incompletos"} {route.capacityM3 && route.volumeDataComplete ? <small>de {route.capacityM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³ · {route.remainingCapacityM3?.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³ livres</small> : null}</strong></div>
      <div className="meter"><i style={{ width: `${Math.min(route.volumeOccupancy ?? 0, 100)}%` }} /></div>
    </div>
    <div className={`capacity-decision ${route.canAddDeliveries === true ? "available" : route.canAddDeliveries === false ? "blocked" : "unknown"}`}>
      <strong>{route.canAddDeliveries === true ? "Há capacidade para avaliar novas entregas" : route.canAddDeliveries === false && route.capacityM3 && !route.volumeDataComplete ? "Não é possível avaliar novos encaixes" : route.canAddDeliveries === false ? "Carga sem capacidade disponível" : "Capacidade máxima não cadastrada"}</strong>
      <small>{route.canAddDeliveries === true ? "Confirme o peso e a cubagem do novo pedido antes de incluí-lo." : route.canAddDeliveries === false && route.capacityM3 && !route.volumeDataComplete ? "Informe a cubagem de todos os itens para liberar a análise." : route.canAddDeliveries === false ? "O limite de peso ou volume foi atingido." : "Cadastre os limites do caminhão para receber uma decisão segura."}</small>
    </div>
    {route.loadSummary.length > 0 && <div className="load-summary">
      <strong>Resumo para carregamento</strong>
      <div>{route.loadSummary.map(item => <span key={`${item.packageType}-${item.unitWeightKg}`}>{item.count.toLocaleString("pt-BR")} {item.packageType}{item.unitWeightKg ? ` de ${item.unitWeightKg.toLocaleString("pt-BR")} kg` : ""}</span>)}</div>
    </div>}
    {route.productSummary.length > 0 && <div className="product-load-summary">
      <strong>Produtos na carga</strong>
      <div>{route.productSummary.map(item => <span key={`${item.productName}-${item.unit}`} className={item.unNumber || item.hazardClass ? "hazard" : ""}><b>{item.productName}</b> · {item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} {item.unit}{item.unNumber ? ` · ONU ${item.unNumber}` : ""}{item.hazardClass ? ` · classe ${item.hazardClass}` : ""}</span>)}</div>
    </div>}
    {route.safetyNotices.length > 0 && <div className="route-safety-alert"><strong>Conferência de segurança</strong>{route.safetyNotices.map(notice => <span key={notice}>{notice}</span>)}</div>}
    <RouteMap originAddress={route.originAddress} routeDate={route.routeDate} stops={route.stops} canWrite={canWrite} onApplySuggestion={applySuggestion} />
    <div className="route-timeline">{route.stops.map((stop, index) => <article key={stop.id}>
      <span className="stop-number">{stop.sequence}</span>
      <div><strong>{stop.customerName} <small>{stop.orderNumber}</small></strong><p>{stop.address || "Endereço não cadastrado"}</p><small>{stop.weightKg ? `${stop.weightKg.toLocaleString("pt-BR")} kg · ` : ""}{stop.volumeM3 ? `${stop.volumeM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³ · ` : ""}{stop.packageSummary || "Carga a conferir"}</small><small className="receiving-window">Recebimento: {stop.receivingWindow || "sem restrição informada"}</small><small className="payment-terms">Pagamento: {stop.paymentTerms || "não informado"}{stop.serviceMinutes !== null ? ` · atendimento ${Math.round(stop.serviceMinutes)} min` : ""}</small></div>
      {canWrite && <div className="stop-actions"><button type="button" aria-label="Mover parada para cima" disabled={!index} onClick={() => reorder(route.id, index, -1)}>↑</button><button type="button" aria-label="Mover parada para baixo" disabled={index === route.stops.length - 1} onClick={() => reorder(route.id, index, 1)}>↓</button></div>}
    </article>)}</div>
  </section>;
}

function JourneyKpis({ route }: { route: Route }) {
  return <section className="panel journey-kpis">
    <div><span>Tempo de jornada</span><strong>{route.durationHours !== null ? `${route.durationHours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : "—"}</strong></div>
    <div><span>Tempo em entregas</span><strong>{route.stoppedMinutes !== null ? `${route.stoppedMinutes.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} min` : "—"}</strong></div>
    <div><span>Tempo em deslocamento</span><strong>{route.drivingHours !== null ? `${route.drivingHours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : "—"}</strong></div>
    <div><span>Entregas concluídas</span><strong>{route.completedDeliveries}/{route.stops.length}</strong></div>
    <div><span>Entregas por hora</span><strong>{route.deliveriesPerHour !== null ? route.deliveriesPerHour.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}</strong></div>
    <div><span>Tempo médio / entrega</span><strong>{route.averageServiceMinutes !== null ? `${Math.round(route.averageServiceMinutes)} min` : "—"}</strong></div>
    <div><span>Eficiência de combustível</span><strong>{route.fuelEfficiencyKmL !== null ? `${route.fuelEfficiencyKmL.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km/L` : "—"}</strong></div>
    <div><span>Custo por entrega <small>{route.costSource === "imported" ? "real" : "estimado"}</small></span><strong>{route.costPerDeliveryCents !== null ? brl(route.costPerDeliveryCents) : "—"}</strong></div>
    <div><span>Custo por km <small>{route.costSource === "imported" ? "real" : "estimado"}</small></span><strong>{route.costPerKmCents !== null ? brl(route.costPerKmCents) : "—"}</strong></div>
    <div><span>Lucro por km <small>{route.profitSource === "imported" ? "real" : "estimado"}</small></span><strong>{route.profitPerKmCents !== null ? brl(route.profitPerKmCents) : "—"}</strong></div>
  </section>;
}

function RouteMonitoring({ route, canWrite, onRegister }: {
  route: Route;
  canWrite: boolean;
  onRegister: (eventType: string, stopId?: number, details?: { odometerKm?: number; fuelLiters?: number; notes?: string }) => Promise<void>;
}) {
  const [eventType, setEventType] = useState("departure");
  const [stopId, setStopId] = useState("");
  const [odometer, setOdometer] = useState("");
  const [fuel, setFuel] = useState("");
  const [notes, setNotes] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onRegister(eventType, stopId ? Number(stopId) : undefined, {
      ...(odometer ? { odometerKm: Number(odometer) } : {}),
      ...(fuel ? { fuelLiters: Number(fuel) } : {}),
      ...(notes ? { notes } : {}),
    });
    setNotes("");
    if (eventType === "delivery_completed") setStopId("");
  };
  const label = (type: string) => type === "departure" ? "Saída" : type === "return" ? "Retorno" : type === "delivery_completed" ? "Entrega" : type === "delivery_failed" ? "Não realizada" : type === "stop_arrival" ? "Chegada" : "Ocorrência";

  return <section className="panel route-monitoring">
    <div className="panel-heading"><div><h2>Monitoramento da jornada</h2><p>{route.measuredKm !== null ? `${route.measuredKm.toLocaleString("pt-BR")} km medidos` : "Quilometragem ainda não informada"}{route.fuelLiters ? ` · ${route.fuelLiters.toLocaleString("pt-BR")} L` : ""}</p></div></div>
    {canWrite && <form className="event-form" onSubmit={submit}>
      <label>Evento<select value={eventType} onChange={event => setEventType(event.target.value)}><option value="departure">Saída</option><option value="stop_arrival">Chegada à parada</option><option value="delivery_completed">Entrega concluída</option><option value="delivery_failed">Entrega não realizada</option><option value="stop_delay">Ocorrência / atraso</option><option value="return">Retorno</option></select></label>
      <label>Parada<select value={stopId} onChange={event => setStopId(event.target.value)} required={["stop_arrival", "delivery_completed", "delivery_failed", "stop_delay"].includes(eventType)}><option value="">Rota inteira</option>{route.stops.map(stop => <option key={stop.id} value={stop.id}>{stop.sequence}. {stop.customerName}</option>)}</select></label>
      <label>Hodômetro (km)<input type="number" min="0" step="0.1" value={odometer} onChange={event => setOdometer(event.target.value)} placeholder="Ex.: 48230" /></label>
      <label>Combustível (L)<input type="number" min="0" step="0.1" value={fuel} onChange={event => setFuel(event.target.value)} placeholder="Opcional" /></label>
      <label className="event-notes">Observação<input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ocorrência, espera ou instrução" /></label>
      <button className="primary-button">Registrar evento</button>
    </form>}
    <div className="event-history">{route.events.length ? route.events.map(event => <span key={event.id}><b>{label(event.eventType)}</b> · {new Date(event.occurredAt * 1000).toLocaleString("pt-BR")}{event.odometerKm !== null ? ` · ${event.odometerKm.toLocaleString("pt-BR")} km` : ""}{event.notes ? ` · ${event.notes}` : ""}</span>) : <small>Nenhum evento registrado para esta rota.</small>}</div>
  </section>;
}
