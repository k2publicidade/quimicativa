"use client";

import { useEffect, useMemo, useState } from "react";
import RouteMap from "./RouteMap";

type Order = { id: number; number: string; customerName: string; deliveryDate: string; status: string; totalCents: number; totalWeightKg: number };
type Vehicle = { id: number; plate: string; model: string; capacityKg: number | null; status: string };
type RouteEvent = { id: number; stopId: number | null; eventType: string; occurredAt: number; odometerKm: number | null; fuelLiters: number | null; notes: string };
type RouteStop = { id: number; orderId: number; orderNumber: string; customerName: string; sequence: number; address: string; weightKg: number; packageSummary: string; paymentTerms: string; serviceMinutes: number | null; status: string };
type Route = {
  id: number; code: string; name: string; plate: string; originAddress: string; driverName: string;
  routeDate: string; status: string; loadedKg: number; capacityKg: number | null;
  remainingCapacityKg: number | null; canAddDeliveries: boolean | null; occupancy: number | null;
  loadSummary: { packageType: string; unitWeightKg: number; count: number }[];
  revenueCents: number; estimatedCostCents: number; estimatedProfitCents: number;
  measuredKm: number | null; fuelLiters: number | null; durationHours: number | null;
  completedDeliveries: number; deliveriesPerHour: number | null; averageServiceMinutes: number | null;
  costPerDeliveryCents: number | null; costPerKmCents: number | null; profitPerKmCents: number | null;
  events: RouteEvent[]; stops: RouteStop[];
};

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const statusLabel = (value: string) => ({ draft: "Planejada", active: "Em andamento", completed: "Concluída", cancelled: "Cancelada" }[value] ?? value);

export default function LogisticsCenter({ notify, canWrite }: { notify: (message: string) => void; canWrite: boolean }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [orderIds, setOrderIds] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [driverName, setDriverName] = useState("");
  const [originAddress, setOriginAddress] = useState("");
  const [plannedKm, setPlannedKm] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [routesResponse, ordersResponse, vehiclesResponse] = await Promise.all([
      fetch("/api/routes"),
      fetch("/api/orders?status=active"),
      fetch("/api/vehicles"),
    ]);
    const routeData = await routesResponse.json() as { routes?: Route[] };
    const orderData = await ordersResponse.json() as { orders?: Order[] };
    const vehicleData = await vehiclesResponse.json() as { vehicles?: Vehicle[] };
    setRoutes(routeData.routes ?? []);
    setOrders(orderData.orders ?? []);
    setVehicles(vehicleData.vehicles ?? []);
  };

  useEffect(() => {
    load().catch(() => notify("Não foi possível carregar a operação logística"));
  }, []);

  const activeOrders = useMemo(
    () => orders.filter(order => !routes.some(route => route.stops.some(stop => stop.orderId === order.id))),
    [orders, routes],
  );
  const currentVehicle = vehicles.find(vehicle => String(vehicle.id) === vehicleId);
  const selectedWeightKg = activeOrders
    .filter(order => orderIds.includes(order.id))
    .reduce((sum, order) => sum + Number(order.totalWeightKg || 0), 0);
  const projectedOccupancy = currentVehicle?.capacityKg
    ? Math.round(selectedWeightKg / currentVehicle.capacityKg * 100)
    : null;
  const route = routes.find(item => item.id === selected) ?? routes[0];

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
          vehicleId: Number(vehicleId), orderIds, name, driverName, originAddress,
          plannedKm: Number(plannedKm || 0),
          estimatedCostCents: Math.round(Number(estimatedCost || 0) * 100),
          optimize: true,
          routeDate: new Date().toISOString().slice(0, 10),
        }),
      });
      const data = await response.json() as { error?: string; route?: { id: number } };
      if (!response.ok) throw new Error(data.error);
      notify("Rota criada com carga conferida");
      setOrderIds([]);
      setVehicleId("");
      setName("");
      setDriverName("");
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
    <div className="logistics-summary">
      <article><span>Rotas programadas</span><strong>{routes.length}</strong><small>com carga rastreável</small></article>
      <article><span>Pedidos disponíveis</span><strong>{activeOrders.length}</strong><small>aguardando alocação</small></article>
      <article><span>Ocupação média</span><strong>{routes.length ? Math.round(routes.reduce((sum, item) => sum + (item.occupancy ?? 0), 0) / routes.length) : 0}%</strong><small>por peso carregado</small></article>
    </div>

    <div className="logistics-grid">
      {canWrite && <form className="panel route-builder" onSubmit={create}>
        <div className="panel-heading"><div><h2>Montar nova rota</h2><p>Selecione o caminhão, a base de saída e os pedidos do dia.</p></div></div>
        <label>Caminhão
          <select required value={vehicleId} onChange={event => setVehicleId(event.target.value)}>
            <option value="">Selecione um caminhão</option>
            {vehicles.filter(vehicle => vehicle.status === "active").map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} — {vehicle.model}{vehicle.capacityKg ? ` · ${vehicle.capacityKg.toLocaleString("pt-BR")} kg` : ""}</option>)}
          </select>
        </label>
        <div className="form-row">
          <label>Nome da rota<input value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Zona Norte — terça" /></label>
          <label>Motorista<input value={driverName} onChange={event => setDriverName(event.target.value)} placeholder="Responsável pela entrega" /></label>
        </div>
        <label>Ponto de partida / depósito
          <input required value={originAddress} onChange={event => setOriginAddress(event.target.value)} placeholder="Rua, número, cidade, estado e CEP" />
        </label>
        <div className="form-row">
          <label>Quilometragem prevista<input type="number" min="0" step="0.1" value={plannedKm} onChange={event => setPlannedKm(event.target.value)} placeholder="Ex.: 86,5" /></label>
          <label>Custo estimado (R$)<input type="number" min="0" step="0.01" value={estimatedCost} onChange={event => setEstimatedCost(event.target.value)} placeholder="Ex.: 420,00" /></label>
        </div>
        {currentVehicle && orderIds.length > 0 && <div className={`capacity-preview ${projectedOccupancy !== null && projectedOccupancy > 100 ? "over" : ""}`}>
          <div><span>Carga selecionada</span><strong>{selectedWeightKg.toLocaleString("pt-BR")} kg</strong></div>
          <div><span>Ocupação prevista</span><strong>{projectedOccupancy !== null ? `${projectedOccupancy}%` : "Capacidade não cadastrada"}</strong></div>
        </div>}
        <div className="route-order-list">
          <div className="route-list-header"><strong>Pedidos disponíveis</strong><small>{orderIds.length} selecionado(s)</small></div>
          {activeOrders.length ? activeOrders.map(order => <label className="route-order" key={order.id}>
            <input type="checkbox" checked={orderIds.includes(order.id)} onChange={event => setOrderIds(event.target.checked ? [...orderIds, order.id] : orderIds.filter(id => id !== order.id))} />
            <span><b>{order.number}</b> {order.customerName}<small>{order.deliveryDate || "Sem data"} · {brl(order.totalCents)} · {order.totalWeightKg.toLocaleString("pt-BR")} kg</small></span>
          </label>) : <p className="logistics-empty">Nenhum pedido ativo aguardando alocação.</p>}
        </div>
        <button className="primary-button" disabled={saving || !vehicleId || !originAddress.trim() || !orderIds.length || Boolean(projectedOccupancy && projectedOccupancy > 100)}>
          {saving ? "Conferindo carga..." : projectedOccupancy && projectedOccupancy > 100 ? "Capacidade excedida" : `Criar rota${currentVehicle ? ` · ${currentVehicle.plate}` : ""}`}
        </button>
      </form>}

      <section className="panel route-list-panel">
        <div className="panel-heading"><div><h2>Rotas e cargas</h2><p>Abra uma rota para revisar a sequência e o aproveitamento.</p></div></div>
        {routes.length ? <div className="route-cards">{routes.map(item => <button className={`route-card ${route?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}>
          <div><strong>{item.name}</strong><small>{item.code} · {item.plate} · {item.stops.length} entregas</small></div>
          <div className="route-card-side"><b>{item.occupancy ?? "—"}%</b><span className={`route-status ${item.status}`}>{statusLabel(item.status)}</span></div>
        </button>)}</div> : <div className="logistics-empty">Ainda não há rotas programadas.</div>}
      </section>
    </div>

    {route && <RouteDetails route={route} canWrite={canWrite} notify={notify} reload={load} reorder={reorder} />}
    {route && <section className="panel route-finance">
      <div><span>Faturamento da rota</span><strong>{brl(route.revenueCents)}</strong></div>
      <div><span>Custo estimado</span><strong>{brl(route.estimatedCostCents)}</strong></div>
      <div><span>Contribuição estimada</span><strong className={route.estimatedProfitCents >= 0 ? "positive" : "negative"}>{brl(route.estimatedProfitCents)}</strong></div>
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
        <a className="secondary-button" href={`/api/routes/manifest?id=${route.id}`} target="_blank" rel="noreferrer">Gerar romaneio</a>
        <span className={`route-status ${route.status}`}>{statusLabel(route.status)}</span>
      </div>
    </div>
    <p className="route-origin"><strong>Saída e retorno:</strong> {route.originAddress || "Depósito não informado"}</p>
    <div className="load-meter">
      <div><span>Carga consolidada</span><strong>{route.loadedKg.toLocaleString("pt-BR")} kg {route.capacityKg ? <small>de {route.capacityKg.toLocaleString("pt-BR")} kg · {route.remainingCapacityKg?.toLocaleString("pt-BR")} kg livres</small> : null}</strong></div>
      <div className="meter"><i style={{ width: `${Math.min(route.occupancy ?? 0, 100)}%` }} /></div>
    </div>
    {route.loadSummary.length > 0 && <div className="load-summary">
      <strong>Resumo para carregamento</strong>
      <div>{route.loadSummary.map(item => <span key={`${item.packageType}-${item.unitWeightKg}`}>{item.count.toLocaleString("pt-BR")} {item.packageType}{item.unitWeightKg ? ` de ${item.unitWeightKg.toLocaleString("pt-BR")} kg` : ""}</span>)}</div>
    </div>}
    <RouteMap originAddress={route.originAddress} stops={route.stops} canWrite={canWrite} onApplySuggestion={applySuggestion} />
    <div className="route-timeline">{route.stops.map((stop, index) => <article key={stop.id}>
      <span className="stop-number">{stop.sequence}</span>
      <div><strong>{stop.customerName} <small>{stop.orderNumber}</small></strong><p>{stop.address || "Endereço não cadastrado"}</p><small>{stop.weightKg ? `${stop.weightKg.toLocaleString("pt-BR")} kg · ` : ""}{stop.packageSummary || "Peso a conferir"}</small><small className="payment-terms">Pagamento: {stop.paymentTerms || "não informado"}{stop.serviceMinutes !== null ? ` · atendimento ${Math.round(stop.serviceMinutes)} min` : ""}</small></div>
      {canWrite && <div className="stop-actions"><button type="button" aria-label="Mover parada para cima" disabled={!index} onClick={() => reorder(route.id, index, -1)}>↑</button><button type="button" aria-label="Mover parada para baixo" disabled={index === route.stops.length - 1} onClick={() => reorder(route.id, index, 1)}>↓</button></div>}
    </article>)}</div>
  </section>;
}

function JourneyKpis({ route }: { route: Route }) {
  return <section className="panel journey-kpis">
    <div><span>Tempo de jornada</span><strong>{route.durationHours !== null ? `${route.durationHours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : "—"}</strong></div>
    <div><span>Entregas concluídas</span><strong>{route.completedDeliveries}/{route.stops.length}</strong></div>
    <div><span>Entregas por hora</span><strong>{route.deliveriesPerHour !== null ? route.deliveriesPerHour.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}</strong></div>
    <div><span>Tempo médio / entrega</span><strong>{route.averageServiceMinutes !== null ? `${Math.round(route.averageServiceMinutes)} min` : "—"}</strong></div>
    <div><span>Custo por entrega</span><strong>{route.costPerDeliveryCents !== null ? brl(route.costPerDeliveryCents) : "—"}</strong></div>
    <div><span>Custo por km</span><strong>{route.costPerKmCents !== null ? brl(route.costPerKmCents) : "—"}</strong></div>
    <div><span>Lucro por km</span><strong>{route.profitPerKmCents !== null ? brl(route.profitPerKmCents) : "—"}</strong></div>
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
