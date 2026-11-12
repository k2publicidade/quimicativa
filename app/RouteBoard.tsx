"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { addDays, localDay } from "../lib/operations";

/**
 * Quadro de montagem rápida das rotas do dia.
 * O administrador escolhe a data, distribui os pedidos entre os caminhões (arrastando ou pelo seletor)
 * e cria todas as rotas de uma vez. As rotas criadas aparecem automaticamente em Galpão → Rotas do dia.
 */

export type BoardOrder = { id: number; number: string; customerName: string; customerDistrict: string; customerCity: string; customerState: string; deliveryDate: string; status: string; totalWeightKg: number; totalVolumeM3: number; missingVolumeItems: number; itemsSummary?: string };
export type BoardVehicle = { id: number; plate: string; model: string; capacityKg: number | null; capacityM3: number | null; status: string };
export type BoardDriver = { id: number; name: string; licenseCategory: string; status: string; alerts: string[] };
export type BoardRoute = { id: number; code: string; name: string; vehicleId?: number; plate: string; driverName: string; driverId?: number | null; routeDate: string; status: string; loadedKg: number; capacityKg: number | null; capacityM3: number | null; loadedM3: number; updatedAt?: number; stops: { id: number; orderId: number; orderNumber: string; customerName: string; sequence: number; address: string; weightKg: number; packageSummary: string; status: string }[] };

type Lane = { key: string; vehicleId: string; driverId: string; name: string; orderIds: number[]; note?: string; error?: string };
type Suggestion = { date: string; source: "deepseek" | "automatic"; generatedAt: number; generatedBy: string; aiError: string; orderCount: number; sync: string; summary: string; warnings: string[]; routes: { vehicleId: number; driverId: number; orderIds: number[]; name: string; reason: string }[]; unassigned: { orderId: number; reason: string }[] };
type Scope = "day" | "late" | "all";

export const DEFAULT_ORIGIN = "Rua Isidro Rocha, 48 — Vigário Geral — Rio de Janeiro/RJ — 21241-180";
const ORIGIN_KEY = "quimicativa:route-board:origin";
const boardKey = (date: string) => `quimicativa:route-board:${date}`;
const kg = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
const region = (order: BoardOrder) => [order.customerCity, order.customerState].filter(Boolean).join(" / ") || order.customerDistrict || "Região não informada";
const shortDate = (iso: string) => iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" }) : "sem data";
const newKey = () => `lane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* armazenamento indisponível */ } };

export default function RouteBoard({ orders, routes, vehicles, drivers, notify, reload, onOpenRoute }: {
  orders: BoardOrder[]; routes: BoardRoute[]; vehicles: BoardVehicle[]; drivers: BoardDriver[];
  notify: (message: string) => void; reload: () => Promise<void>; onOpenRoute?: (routeId: number) => void;
}) {
  const [date, setDate] = useState(() => addDays(localDay(), 1));
  const [scope, setScope] = useState<Scope>("late");
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [loadedDate, setLoadedDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [savedBusy, setSavedBusy] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSuggestion(null);
    fetch(`/api/routes/suggest?date=${date}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null).then((data: { suggestion?: Suggestion | null; aiConfigured?: boolean } | null) => {
      if (cancelled || !data) return;
      setSuggestion(data.suggestion ?? null); setAiConfigured(data.aiConfigured !== false);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [date]);

  useEffect(() => { const saved = read(ORIGIN_KEY); if (saved) setOrigin(saved); }, []);
  useEffect(() => { write(ORIGIN_KEY, origin.trim() ? origin : null); }, [origin]);

  // Rascunho do quadro guardado por data, para o administrador continuar depois.
  useEffect(() => {
    let draft: Lane[] = [];
    try { const parsed = JSON.parse(read(boardKey(date)) || "[]"); if (Array.isArray(parsed)) draft = parsed; } catch { draft = []; }
    setLanes(draft.map(lane => ({ key: String(lane.key || newKey()), vehicleId: String(lane.vehicleId || ""), driverId: String(lane.driverId || ""), name: String(lane.name || ""), note: lane.note ? String(lane.note) : undefined, orderIds: Array.isArray(lane.orderIds) ? lane.orderIds.map(Number) : [] })));
    setLoadedDate(date);
  }, [date]);
  useEffect(() => {
    if (loadedDate !== date) return;
    write(boardKey(date), lanes.length ? JSON.stringify(lanes.map(lane => ({ key: lane.key, vehicleId: lane.vehicleId, driverId: lane.driverId, name: lane.name, note: lane.note, orderIds: lane.orderIds }))) : null);
  }, [lanes, date, loadedDate]);

  const orderById = useMemo(() => new Map(orders.map(order => [order.id, order])), [orders]);
  // Pedidos que já entraram em rota (ou foram entregues) saem do rascunho automaticamente.
  useEffect(() => {
    if (!orders.length) return;
    setLanes(current => current.some(lane => lane.orderIds.some(id => !orderById.has(id))) ? current.map(lane => ({ ...lane, orderIds: lane.orderIds.filter(id => orderById.has(id)) })) : current);
  }, [orders, orderById]);

  const dayRoutes = routes.filter(route => route.routeDate === date && ["draft", "active"].includes(route.status));
  const busyVehicles = new Set(dayRoutes.map(route => route.vehicleId ?? vehicles.find(vehicle => vehicle.plate === route.plate)?.id).filter(Boolean).map(String));
  const busyDrivers = new Set(dayRoutes.map(route => route.driverId ?? drivers.find(driver => driver.name === route.driverName)?.id).filter(Boolean).map(String));
  const activeVehicles = vehicles.filter(vehicle => vehicle.status === "active");
  const activeDrivers = drivers.filter(driver => driver.status === "active");
  const assigned = new Set(lanes.flatMap(lane => lane.orderIds));
  const inScope = (order: BoardOrder) => scope === "all" || order.deliveryDate === date || (scope === "late" && (!order.deliveryDate || order.deliveryDate < date));
  const unassigned = orders.filter(order => !assigned.has(order.id) && inScope(order));
  const groups = useMemo(() => {
    const map = new Map<string, BoardOrder[]>();
    unassigned.forEach(order => map.set(region(order), [...(map.get(region(order)) ?? []), order]));
    return [...map.entries()].map(([label, list]) => ({ label, orders: list.sort((a, b) => a.customerDistrict.localeCompare(b.customerDistrict, "pt-BR") || a.customerName.localeCompare(b.customerName, "pt-BR")) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [unassigned]);
  const outsideScope = orders.filter(order => !assigned.has(order.id) && !inScope(order)).length;

  const laneStats = (lane: Lane) => {
    const list = lane.orderIds.map(id => orderById.get(id)).filter((order): order is BoardOrder => Boolean(order));
    const vehicle = activeVehicles.find(item => String(item.id) === lane.vehicleId);
    const weight = list.reduce((sum, order) => sum + Number(order.totalWeightKg || 0), 0);
    const volume = list.reduce((sum, order) => sum + Number(order.totalVolumeM3 || 0), 0);
    const missingVolume = list.some(order => order.missingVolumeItems > 0);
    const occupancy = vehicle?.capacityKg ? Math.round(weight / vehicle.capacityKg * 100) : null;
    const volumeOccupancy = vehicle?.capacityM3 && !missingVolume ? Math.round(volume / vehicle.capacityM3 * 100) : null;
    const cities = [...new Set(list.map(order => order.customerCity || order.customerDistrict).filter(Boolean))];
    const problems = [
      !lane.vehicleId ? "Escolha o caminhão" : "",
      !lane.driverId ? "Escolha o motorista" : "",
      occupancy !== null && occupancy > 100 ? `Peso acima da capacidade (${occupancy}%)` : "",
      volumeOccupancy !== null && volumeOccupancy > 100 ? `Volume acima da capacidade (${volumeOccupancy}%)` : "",
      vehicle?.capacityM3 && missingVolume ? "Há pedido sem cubagem — complete o volume dos itens" : "",
    ].filter(Boolean);
    return { list, vehicle, weight, volume, missingVolume, occupancy, volumeOccupancy, cities, problems };
  };

  const usedVehicles = (except?: string) => new Set(lanes.filter(lane => lane.key !== except).map(lane => lane.vehicleId).filter(Boolean));
  const usedDrivers = (except?: string) => new Set(lanes.filter(lane => lane.key !== except).map(lane => lane.driverId).filter(Boolean));
  const freeVehicle = (taken: Set<string>) => activeVehicles.find(vehicle => !busyVehicles.has(String(vehicle.id)) && !taken.has(String(vehicle.id)));
  const freeDriver = (taken: Set<string>) => activeDrivers.find(driver => !busyDrivers.has(String(driver.id)) && !taken.has(String(driver.id)));

  const addLane = () => {
    const vehicle = freeVehicle(usedVehicles()), driver = freeDriver(usedDrivers());
    setLanes(current => [...current, { key: newKey(), vehicleId: vehicle ? String(vehicle.id) : "", driverId: driver ? String(driver.id) : "", name: "", orderIds: [] }]);
  };
  const updateLane = (key: string, patch: Partial<Lane>) => setLanes(current => current.map(lane => lane.key === key ? { ...lane, ...patch, error: undefined } : lane));
  const removeLane = (key: string) => setLanes(current => current.filter(lane => lane.key !== key));
  const moveOrder = (orderId: number, target: string) => {
    if (target.startsWith("saved:")) { void addToSaved(Number(target.slice(6)), orderId); return; }
    setLanes(current => current.map(lane => {
      const without = lane.orderIds.filter(id => id !== orderId);
      return lane.key === target ? { ...lane, orderIds: [...without, orderId], error: undefined } : without.length === lane.orderIds.length ? lane : { ...lane, orderIds: without, error: undefined };
    }));
  };
  const shift = (key: string, index: number, direction: -1 | 1) => setLanes(current => current.map(lane => {
    if (lane.key !== key) return lane;
    const next = [...lane.orderIds], target = index + direction;
    if (target < 0 || target >= next.length) return lane;
    [next[index], next[target]] = [next[target], next[index]];
    return { ...lane, orderIds: next };
  }));
  const sortByDistrict = (key: string) => setLanes(current => current.map(lane => lane.key !== key ? lane : {
    ...lane,
    orderIds: [...lane.orderIds].sort((a, b) => {
      const x = orderById.get(a), z = orderById.get(b);
      return (x?.customerCity ?? "").localeCompare(z?.customerCity ?? "", "pt-BR") || (x?.customerDistrict ?? "").localeCompare(z?.customerDistrict ?? "", "pt-BR") || (x?.customerName ?? "").localeCompare(z?.customerName ?? "", "pt-BR");
    }),
  }));

  /** Sugestão automática: agrupa por cidade e enche os caminhões disponíveis sem passar da capacidade. */
  const autoDistribute = () => {
    const next = lanes.map(lane => ({ ...lane, orderIds: [...lane.orderIds] }));
    const takenVehicles = new Set(next.map(lane => lane.vehicleId).filter(Boolean)), takenDrivers = new Set(next.map(lane => lane.driverId).filter(Boolean));
    const capacityOf = (lane: Lane) => activeVehicles.find(vehicle => String(vehicle.id) === lane.vehicleId)?.capacityKg ?? Infinity;
    const loadOf = (lane: Lane) => lane.orderIds.reduce((sum, id) => sum + Number(orderById.get(id)?.totalWeightKg || 0), 0);
    const citiesOf = (lane: Lane) => new Set(lane.orderIds.map(id => orderById.get(id)).filter(Boolean).map(order => region(order!)));
    const openLane = () => {
      const vehicle = freeVehicle(takenVehicles), driver = freeDriver(takenDrivers);
      if (!vehicle || !driver) return null;
      takenVehicles.add(String(vehicle.id)); takenDrivers.add(String(driver.id));
      const lane: Lane = { key: newKey(), vehicleId: String(vehicle.id), driverId: String(driver.id), name: "", orderIds: [] };
      next.push(lane);
      return lane;
    };
    const fits = (lane: Lane, weight: number) => loadOf(lane) + weight <= capacityOf(lane);
    const pick = (label: string, weight: number) =>
      next.filter(lane => fits(lane, weight)).sort((a, b) => Number(citiesOf(b).has(label)) - Number(citiesOf(a).has(label)) || citiesOf(a).size - citiesOf(b).size || (capacityOf(b) - loadOf(b)) - (capacityOf(a) - loadOf(a)))[0];
    let left = 0;
    [...groups].sort((a, b) => b.orders.reduce((s, o) => s + o.totalWeightKg, 0) - a.orders.reduce((s, o) => s + o.totalWeightKg, 0)).forEach(group => {
      const weight = group.orders.reduce((sum, order) => sum + Number(order.totalWeightKg || 0), 0);
      const whole = pick(group.label, weight) ?? (next.every(lane => lane.orderIds.length) ? openLane() : null);
      if (whole && fits(whole, weight)) { whole.orderIds.push(...group.orders.map(order => order.id)); return; }
      group.orders.forEach(order => {
        const lane = pick(group.label, order.totalWeightKg) ?? openLane();
        if (lane && fits(lane, order.totalWeightKg)) lane.orderIds.push(order.id); else left++;
      });
    });
    if (!next.length) { notify("Cadastre caminhões e motoristas ativos (e livres nesta data) para distribuir os pedidos."); return; }
    setLanes(next.map(lane => ({ ...lane, error: undefined })));
    notify(left ? `Sugestão pronta. ${left} pedido(s) não couberam nos caminhões livres.` : "Sugestão pronta. Revise e clique em Criar rotas.");
  };

  /** Pede uma nova sugestão (VHSYS atualizado + DeepSeek) para o dia escolhido. */
  const generateSuggestion = async () => {
    setSuggesting(true);
    try {
      const response = await fetch("/api/routes/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, sync: true }) });
      const data = await response.json() as { suggestion?: Suggestion; aiConfigured?: boolean; error?: string };
      if (!response.ok || !data.suggestion) throw new Error(data.error || "Não foi possível gerar a sugestão.");
      await reload().catch(() => undefined);
      setSuggestion(data.suggestion); setAiConfigured(data.aiConfigured !== false);
      notify(data.suggestion.routes.length ? "Sugestão pronta. Confira e clique em Aplicar no quadro." : data.suggestion.summary);
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível gerar a sugestão."); }
    finally { setSuggesting(false); }
  };
  /** Coloca a sugestão no quadro, só com pedidos, caminhões e motoristas ainda disponíveis. */
  const applySuggestion = () => {
    if (!suggestion) return;
    const next: Lane[] = suggestion.routes.map(route => ({
      key: newKey(),
      vehicleId: activeVehicles.some(item => item.id === route.vehicleId) && !busyVehicles.has(String(route.vehicleId)) ? String(route.vehicleId) : "",
      driverId: activeDrivers.some(item => item.id === route.driverId) && !busyDrivers.has(String(route.driverId)) ? String(route.driverId) : "",
      name: route.name, note: route.reason, orderIds: route.orderIds.filter(id => orderById.has(id)),
    })).filter(lane => lane.orderIds.length);
    if (!next.length) return notify("Os pedidos desta sugestão já estão em rota. Gere uma nova sugestão.");
    if (lanes.some(lane => lane.orderIds.length) && !window.confirm("Substituir o quadro atual pela sugestão?")) return;
    setLanes(next);
    notify(`Sugestão aplicada: ${next.length} caminhão(ões). Revise e clique em Criar rotas.`);
  };

  const createAll = async () => {
    const ready = lanes.filter(lane => lane.orderIds.length);
    if (!ready.length) return notify("Coloque ao menos um pedido em um caminhão.");
    if (!origin.trim()) return notify("Informe o ponto de partida (depósito).");
    const blocked = ready.find(lane => laneStats(lane).problems.length);
    if (blocked) { setLanes(current => current.map(lane => lane.key === blocked.key ? { ...lane, error: laneStats(lane).problems.join(" · ") } : lane)); return notify("Resolva os avisos marcados antes de criar as rotas."); }
    setBusy(true);
    const errors = new Map<string, string>(), created: string[] = [];
    for (const lane of ready) {
      const stats = laneStats(lane);
      const name = lane.name.trim() || `${stats.cities.slice(0, 3).join(" / ") || "Entregas"} — ${stats.vehicle?.plate ?? ""}`.trim();
      try {
        const response = await fetch("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vehicleId: Number(lane.vehicleId), driverId: Number(lane.driverId), orderIds: lane.orderIds, name, originAddress: origin.trim(), routeDate: date, plannedKm: 0, estimatedCostCents: 0, optimize: false }) });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível criar a rota.");
        created.push(lane.key);
      } catch (error) { errors.set(lane.key, error instanceof Error ? error.message : "Não foi possível criar a rota."); }
    }
    setLanes(current => current.filter(lane => !created.includes(lane.key)).map(lane => ({ ...lane, error: errors.get(lane.key) })));
    await reload().catch(() => undefined);
    setBusy(false);
    notify(created.length ? `${created.length} rota(s) criada(s). O galpão já pode imprimir em Galpão → Rotas do dia.${errors.size ? ` ${errors.size} com pendência.` : ""}` : "Nenhuma rota foi criada. Veja os avisos nos caminhões.");
  };

  const changeSaved = async (route: BoardRoute, payload: { addOrderIds?: number[]; removeOrderIds?: number[] }) => {
    setSavedBusy(route.id);
    try {
      const response = await fetch("/api/routes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: route.id, ...payload }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível alterar a rota.");
      setLanes(current => current.map(lane => ({ ...lane, orderIds: lane.orderIds.filter(id => !(payload.addOrderIds ?? []).includes(id)) })));
      await reload();
      notify(payload.addOrderIds ? "Pedido incluído na rota." : "Pedido retirado da rota e devolvido à lista.");
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível alterar a rota."); }
    finally { setSavedBusy(null); }
  };
  const addToSaved = (routeId: number, orderId: number) => { const route = dayRoutes.find(item => item.id === routeId); return route ? changeSaved(route, { addOrderIds: [orderId] }) : undefined; };

  const onDragStart = (event: DragEvent, orderId: number) => { event.dataTransfer.setData("text/plain", String(orderId)); event.dataTransfer.effectAllowed = "move"; };
  const dropProps = (target: string) => ({
    onDragOver: (event: DragEvent) => { event.preventDefault(); setDragOver(target); },
    onDragLeave: () => setDragOver(current => current === target ? null : current),
    onDrop: (event: DragEvent) => { event.preventDefault(); setDragOver(null); const id = Number(event.dataTransfer.getData("text/plain")); if (id) moveOrder(id, target); },
  });
  const targets = [
    ...lanes.map((lane, index) => ({ value: lane.key, label: `Caminhão ${index + 1}${activeVehicles.find(item => String(item.id) === lane.vehicleId) ? ` · ${activeVehicles.find(item => String(item.id) === lane.vehicleId)!.plate}` : ""}` })),
    ...dayRoutes.filter(route => route.status === "draft").map(route => ({ value: `saved:${route.id}`, label: `Rota criada · ${route.plate} · ${route.driverName}` })),
  ];
  const plannedCount = lanes.reduce((sum, lane) => sum + lane.orderIds.length, 0);

  const orderCard = (order: BoardOrder, laneKey: string, controls?: React.ReactNode) => <article key={order.id} className="rb-order" draggable onDragStart={event => onDragStart(event, order.id)}>
    <div className="rb-order-main">
      <strong>{order.customerName}</strong>
      <small>Pedido {order.number} · {order.customerDistrict || order.customerCity || "sem bairro"} · {kg(order.totalWeightKg)}{order.deliveryDate !== date ? ` · entrega ${shortDate(order.deliveryDate)}` : ""}</small>
      {order.itemsSummary && <small className="rb-items">{order.itemsSummary}</small>}
    </div>
    <div className="rb-order-actions">
      {controls}
      <select aria-label={`Enviar pedido ${order.number} para`} value={laneKey} onChange={event => moveOrder(order.id, event.target.value)}>
        <option value="">{laneKey ? "↩ Tirar do caminhão" : "Enviar para…"}</option>
        {targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}
      </select>
    </div>
  </article>;

  return <section className="rb-board">
    <header className="rb-toolbar">
      <div className="rb-steps"><span><b>1</b> Escolha o dia</span><span><b>2</b> Distribua os pedidos nos caminhões</span><span><b>3</b> Crie as rotas — o galpão imprime</span></div>
      <div className="rb-controls">
        <label>Dia da entrega<input type="date" value={date} onChange={event => event.target.value && setDate(event.target.value)} /></label>
        <div className="rb-quick"><button type="button" className={date === localDay() ? "active" : ""} onClick={() => setDate(localDay())}>Hoje</button><button type="button" className={date === addDays(localDay(), 1) ? "active" : ""} onClick={() => setDate(addDays(localDay(), 1))}>Amanhã</button></div>
        <label>Pedidos exibidos<select value={scope} onChange={event => setScope(event.target.value as Scope)}><option value="day">Somente deste dia</option><option value="late">Deste dia + atrasados e sem data</option><option value="all">Todos os pendentes</option></select></label>
        <label className="rb-origin">Saída / depósito<input value={origin} onChange={event => setOrigin(event.target.value)} placeholder="Endereço do galpão" /></label>
      </div>
    </header>

    <section className={`rb-ai ${suggestion?.source === "deepseek" ? "ai" : ""}`}>
      <div className="rb-ai-head">
        <div>
          <h3>✨ Sugestão de rotas {suggestion?.source === "deepseek" ? "com IA (DeepSeek)" : "automática"}</h3>
          <small>{suggestion ? `Gerada em ${new Date(suggestion.generatedAt * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${suggestion.generatedBy}` : "Todo dia às 10h o sistema atualiza os pedidos do VHSYS e sugere as rotas do dia seguinte."}</small>
        </div>
        <div className="rb-ai-actions">
          {suggestion && suggestion.routes.length > 0 && <button type="button" className="rb-create" onClick={applySuggestion}>Aplicar no quadro</button>}
          <button type="button" className="rb-primary-ghost" disabled={suggesting} onClick={() => void generateSuggestion()}>{suggesting ? "Buscando no VHSYS e montando…" : suggestion ? "Gerar de novo agora" : "Sincronizar VHSYS e sugerir agora"}</button>
        </div>
      </div>
      {suggestion && <>
        <p className="rb-ai-summary">{suggestion.summary}</p>
        {suggestion.routes.length > 0 && <ol className="rb-ai-routes">{suggestion.routes.map(route => <li key={`${route.vehicleId}-${route.driverId}`}><b>{route.name}</b> · {vehicles.find(item => item.id === route.vehicleId)?.plate ?? "caminhão"} · {drivers.find(item => item.id === route.driverId)?.name ?? "motorista"} · {route.orderIds.length} entrega(s){route.reason && <small>{route.reason}</small>}</li>)}</ol>}
        {suggestion.unassigned.length > 0 && <p className="rb-ai-warn">Ficaram de fora: {suggestion.unassigned.map(item => `${orderById.get(item.orderId)?.number ?? item.orderId} (${item.reason})`).join("; ")}</p>}
        {suggestion.warnings.length > 0 && <p className="rb-ai-note">Conferência do sistema: {suggestion.warnings.join(" ")}</p>}
        {(suggestion.sync || (aiConfigured && suggestion.aiError)) && <p className="rb-ai-note">{[suggestion.sync, aiConfigured ? suggestion.aiError : ""].filter(Boolean).join(" · ")}</p>}
      </>}
      {!aiConfigured && <p className="rb-ai-note">A chave do DeepSeek ainda não foi configurada (DEEPSEEK_API_KEY). Enquanto isso, a sugestão usa as regras do sistema.</p>}
    </section>

    <div className="rb-columns">
      <section className={`rb-pool ${dragOver === "" ? "drop" : ""}`} {...dropProps("")}>
        <header><div><h3>Pedidos para entregar</h3><small>{unassigned.length} sem caminhão{outsideScope ? ` · ${outsideScope} fora do filtro` : ""}</small></div><button type="button" className="rb-primary-ghost" onClick={autoDistribute} disabled={!unassigned.length}>⚡ Distribuir automaticamente</button></header>
        <p className="rb-hint">Arraste o pedido até o caminhão ou use “Enviar para…”. A sugestão automática agrupa por cidade sem passar a capacidade.</p>
        {groups.length ? groups.map(group => <div className="rb-group" key={group.label}>
          <div className="rb-group-head"><strong>{group.label}</strong><small>{group.orders.length} pedido(s) · {kg(group.orders.reduce((sum, order) => sum + order.totalWeightKg, 0))}</small>
            {lanes.length > 0 && <select aria-label={`Enviar todos de ${group.label}`} value="" onChange={event => { const target = event.target.value; if (!target) return; setLanes(current => current.map(lane => lane.key === target ? { ...lane, orderIds: [...lane.orderIds, ...group.orders.map(order => order.id)], error: undefined } : lane)); }}><option value="">Enviar região para…</option>{targets.filter(target => !target.value.startsWith("saved:")).map(target => <option key={target.value} value={target.value}>{target.label}</option>)}</select>}
          </div>
          {group.orders.map(order => orderCard(order, ""))}
        </div>) : <p className="rb-empty">{orders.length ? "Todos os pedidos deste filtro já estão em um caminhão. 👍" : "Nenhum pedido pendente de rota."}</p>}
      </section>

      <section className="rb-lanes">
        {lanes.map((lane, index) => {
          const stats = laneStats(lane), over = (stats.occupancy ?? 0) > 100 || (stats.volumeOccupancy ?? 0) > 100;
          const takenV = usedVehicles(lane.key), takenD = usedDrivers(lane.key);
          return <article key={lane.key} className={`rb-lane ${dragOver === lane.key ? "drop" : ""} ${lane.error ? "has-error" : ""}`} {...dropProps(lane.key)}>
            <header>
              <span className="rb-lane-index">{index + 1}</span>
              <select aria-label="Caminhão" value={lane.vehicleId} onChange={event => updateLane(lane.key, { vehicleId: event.target.value })}>
                <option value="">Caminhão…</option>
                {activeVehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id} disabled={busyVehicles.has(String(vehicle.id)) || takenV.has(String(vehicle.id))}>{vehicle.plate} — {vehicle.model}{vehicle.capacityKg ? ` · ${vehicle.capacityKg.toLocaleString("pt-BR")} kg` : ""}{busyVehicles.has(String(vehicle.id)) ? " (já em rota)" : ""}</option>)}
              </select>
              <select aria-label="Motorista" value={lane.driverId} onChange={event => updateLane(lane.key, { driverId: event.target.value })}>
                <option value="">Motorista…</option>
                {activeDrivers.map(driver => <option key={driver.id} value={driver.id} disabled={busyDrivers.has(String(driver.id)) || takenD.has(String(driver.id))}>{driver.name}{driver.alerts.length ? ` ⚠ ${driver.alerts.join(", ")}` : ""}{busyDrivers.has(String(driver.id)) ? " (já em rota)" : ""}</option>)}
              </select>
              <button type="button" className="rb-icon" aria-label="Remover caminhão do quadro" title="Remover do quadro" onClick={() => removeLane(lane.key)}>✕</button>
            </header>
            <input className="rb-lane-name" value={lane.name} onChange={event => updateLane(lane.key, { name: event.target.value })} placeholder={`Nome da rota (opcional) — ex.: ${stats.cities.slice(0, 2).join(" / ") || "Zona Norte"}`} />
            {lane.note && <p className="rb-lane-note">✨ {lane.note}</p>}
            <div className={`rb-meter ${over ? "over" : ""}`}><i style={{ width: `${Math.min(stats.occupancy ?? 0, 100)}%` }} /></div>
            <div className="rb-lane-stats"><span><b>{stats.list.length}</b> entrega(s)</span><span><b>{kg(stats.weight)}</b>{stats.vehicle?.capacityKg ? ` de ${kg(stats.vehicle.capacityKg)} (${stats.occupancy}%)` : ""}</span>{stats.vehicle?.capacityM3 ? <span>{stats.missingVolume ? "cubagem pendente" : `${stats.volume.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m³ (${stats.volumeOccupancy}%)`}</span> : null}</div>
            {stats.list.length > 1 && <button type="button" className="rb-link" onClick={() => sortByDistrict(lane.key)}>Ordenar paradas por cidade e bairro</button>}
            <ol className="rb-stops">{stats.list.map((order, stopIndex) => <li key={order.id}>{orderCard(order, lane.key, <span className="rb-shift"><button type="button" aria-label="Subir parada" disabled={!stopIndex} onClick={() => shift(lane.key, stopIndex, -1)}>↑</button><button type="button" aria-label="Descer parada" disabled={stopIndex === stats.list.length - 1} onClick={() => shift(lane.key, stopIndex, 1)}>↓</button></span>)}</li>)}</ol>
            {!stats.list.length && <p className="rb-drop-hint">Solte os pedidos aqui</p>}
            {(lane.error || (stats.list.length > 0 && stats.problems.length > 0)) && <p className="rb-error" role="alert">{lane.error || stats.problems.join(" · ")}</p>}
          </article>;
        })}
        <button type="button" className="rb-add-lane" onClick={addLane}>+ Adicionar caminhão ao dia</button>

        {dayRoutes.length > 0 && <div className="rb-saved">
          <h3>Rotas já criadas para {shortDate(date)}</h3>
          {dayRoutes.map(route => <article key={route.id} className={`rb-lane saved ${dragOver === `saved:${route.id}` ? "drop" : ""}`} {...(route.status === "draft" ? dropProps(`saved:${route.id}`) : {})}>
            <header><span className="rb-lane-index">✓</span><div><strong>{route.name}</strong><small>{route.plate} · {route.driverName} · {route.stops.length} entrega(s) · {kg(route.loadedKg)}{route.capacityKg ? ` de ${kg(route.capacityKg)}` : ""}</small></div><span className={`route-status ${route.status}`}>{route.status === "draft" ? "Planejada" : "Em andamento"}</span></header>
            <ol className="rb-saved-stops">{route.stops.map(stop => <li key={stop.id}><span>{stop.sequence}. <b>{stop.customerName}</b> · {stop.orderNumber}</span>{route.status === "draft" && route.stops.length > 1 && <button type="button" className="rb-link" disabled={savedBusy === route.id} onClick={() => void changeSaved(route, { removeOrderIds: [stop.orderId] })}>Retirar</button>}</li>)}</ol>
            <div className="rb-saved-actions">{onOpenRoute && <button type="button" className="rb-link" onClick={() => onOpenRoute(route.id)}>Abrir detalhes</button>}<a className="rb-link" href={`/api/routes/manifest?id=${route.id}`} target="_blank" rel="noreferrer">Imprimir romaneio</a>{route.status === "draft" && <small>Arraste um pedido para cá para incluir.</small>}</div>
          </article>)}
          <a className="rb-print-day" href={`/api/routes/manifest?date=${date}`} target="_blank" rel="noreferrer">🖨 Imprimir todas as rotas de {shortDate(date)}</a>
        </div>}
      </section>
    </div>

    <footer className="rb-footer">
      <span>{lanes.filter(lane => lane.orderIds.length).length} caminhão(ões) · {plannedCount} pedido(s) no quadro · rascunho salvo neste navegador</span>
      <button type="button" className="rb-create" disabled={busy || !plannedCount} onClick={() => void createAll()}>{busy ? "Criando rotas…" : `Criar ${lanes.filter(lane => lane.orderIds.length).length || ""} rota(s) do dia`}</button>
    </footer>
  </section>;
}
