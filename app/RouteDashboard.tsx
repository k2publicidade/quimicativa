"use client";

import { useEffect, useMemo, useState } from "react";

type HistoryRow = { row: number; date: string; vehicle: string; customer: string; district: string; product: string; quantity: number; packageKg: string; weightKg: number; company: string; pricePerKg: number; revenue: number; liters: number; productCost: number; tax: number; commission: number; grossProfit: number; operatingCost: number; netProfit: number };
type LiveOrder = { id: number; number: string; customerName: string; customerDistrict: string; customerCity: string; deliveryDate: string; totalCents: number; totalWeightKg: number };
type LiveRoute = { id: number; code: string; name: string; plate: string; routeDate: string; status: string; loadedKg: number; capacityKg: number | null; revenueCents: number; stops: { id: number; orderId: number; status: string }[] };
type HistoricRoute = { key: string; date: string; vehicle: string; rows: HistoryRow[]; weight: number; revenue: number; netProfit: number; districts: string[] };

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const integer = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const monthLabel = (value: string) => new Date(`${value}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const statusLabel = (status: string) => ({ draft: "Planejada", active: "Em rota", completed: "Concluída", cancelled: "Cancelada" }[status] ?? status);

export default function RouteDashboard({ routes, orders, onPlan, onOpenRoute }: { routes: LiveRoute[]; orders: LiveOrder[]; onPlan: () => void; onOpenRoute: (id: number) => void }) {
  const [historyData, setHistoryData] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [source, setSource] = useState<"history" | "live">("history");
  const [month, setMonth] = useState("all");
  const [vehicle, setVehicle] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState("all");
  useEffect(() => {
    fetch("/api/route-history", { cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Não foi possível carregar o histórico da planilha."); return response.json() as Promise<{ rows: HistoryRow[] }>; })
      .then(data => setHistoryData(data.rows))
      .catch(error => setHistoryError(error instanceof Error ? error.message : "Falha ao carregar o histórico."))
      .finally(() => setLoadingHistory(false));
  }, []);
  const months = useMemo(() => [...new Set(historyData.map(row => row.date.slice(0, 7)))].sort(), [historyData]);
  const vehicles = useMemo(() => [...new Set(historyData.map(row => row.vehicle))].sort((a, b) => a.localeCompare(b, "pt-BR")), [historyData]);

  const filteredRows = useMemo(() => historyData.filter(row => {
    if (month !== "all" && !row.date.startsWith(month)) return false;
    if (vehicle !== "all" && row.vehicle !== vehicle) return false;
    if (query && !normalize(`${row.customer} ${row.district} ${row.product} ${row.company} ${row.vehicle}`).includes(normalize(query))) return false;
    return true;
  }), [historyData, month, vehicle, query]);

  const historicRoutes = useMemo(() => {
    const grouped = new Map<string, HistoricRoute>();
    filteredRows.forEach(row => {
      const key = `${row.date}/${row.vehicle}`;
      const route = grouped.get(key) ?? { key, date: row.date, vehicle: row.vehicle, rows: [], weight: 0, revenue: 0, netProfit: 0, districts: [] };
      route.rows.push(row);
      route.weight += row.weightKg;
      route.revenue += row.revenue;
      route.netProfit += row.netProfit;
      if (row.district && !route.districts.includes(row.district)) route.districts.push(row.district);
      grouped.set(key, route);
    });
    return [...grouped.values()].sort((a, b) => b.date.localeCompare(a.date) || a.vehicle.localeCompare(b.vehicle, "pt-BR"));
  }, [filteredRows]);

  const selectedRoute = historicRoutes.find(route => route.key === selectedKey) ?? null;
  const totals = useMemo(() => filteredRows.reduce((acc, row) => ({ weight: acc.weight + row.weightKg, revenue: acc.revenue + row.revenue, netProfit: acc.netProfit + row.netProfit, liters: acc.liters + row.liters }), { weight: 0, revenue: 0, netProfit: 0, liters: 0 }), [filteredRows]);
  const monthly = useMemo(() => months.map(key => ({ key, revenue: filteredRows.filter(row => row.date.startsWith(key)).reduce((sum, row) => sum + row.revenue, 0) })).filter(item => item.revenue > 0), [months, filteredRows]);
  const truckTotals = useMemo(() => vehicles.map(key => ({ key, count: historicRoutes.filter(route => route.vehicle === key).length, weight: historicRoutes.filter(route => route.vehicle === key).reduce((sum, route) => sum + route.weight, 0) })).filter(item => item.count > 0).sort((a, b) => b.weight - a.weight), [vehicles, historicRoutes]);
  const liveRoutes = useMemo(() => routes.filter(route => (liveStatus === "all" || route.status === liveStatus) && (!query || normalize(`${route.name} ${route.plate} ${route.code}`).includes(normalize(query)))), [routes, liveStatus, query]);
  const assignedOrderIds = useMemo(() => new Set(routes.filter(route => route.status !== "cancelled").flatMap(route => (route as LiveRoute & { stops: { orderId?: number }[] }).stops.map(stop => stop.orderId).filter((id): id is number => typeof id === "number"))), [routes]);
  const unassignedOrders = orders.filter(order => !assignedOrderIds.has(order.id));
  const visibleRoutes = historicRoutes.slice((page - 1) * 12, page * 12);
  const pageCount = Math.max(1, Math.ceil(historicRoutes.length / 12));
  const maxMonthly = Math.max(1, ...monthly.map(item => item.revenue));
  const maxTruckWeight = Math.max(1, ...truckTotals.map(item => item.weight));

  useEffect(() => { setPage(1); setSelectedKey(null); }, [month, vehicle, query]);

  return <div className="rd-shell">
    <div className="rd-source-switch" role="tablist" aria-label="Fonte dos roteiros">
      <button type="button" role="tab" aria-selected={source === "history"} className={source === "history" ? "active" : ""} onClick={() => { setSource("history"); setQuery(""); }}>Histórico da planilha <span>{historyData.length}</span></button>
      <button type="button" role="tab" aria-selected={source === "live"} className={source === "live" ? "active" : ""} onClick={() => { setSource("live"); setQuery(""); }}>Operação atual <span>{routes.length}</span></button>
    </div>

    {source === "history" ? <>
      <div className="rd-context"><span className="rd-context-dot" /><span>Base: ROTEIRO PADRÃO.xlsx · 23 mai a 03 out 2025</span><span>Registros da planilha sem número de pedido ou confirmação de entrega.</span></div>
      {loadingHistory && <div className="rd-loading" role="status">Carregando registros da planilha...</div>}
      {historyError && <div className="rd-loading rd-error" role="alert">{historyError}</div>}
      <div className="rd-kpis">
        <article><span>Entregas registradas</span><strong>{integer(filteredRows.length)}</strong><small>{integer(historicRoutes.length)} roteiros por data e caminhão</small></article>
        <article><span>Carga transportada</span><strong>{integer(totals.weight)} <em>kg</em></strong><small>{integer(totals.liters)} litros informados</small></article>
        <article><span>Receita registrada</span><strong>{money(totals.revenue)}</strong><small>Soma dos itens filtrados</small></article>
        <article className="rd-kpi-accent"><span>Lucro líquido da planilha</span><strong>{money(totals.netProfit)}</strong><small>{totals.revenue ? `${(totals.netProfit / totals.revenue * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da receita` : "Sem receita no filtro"}</small></article>
      </div>

      <div className="rd-analytics">
        <section className="rd-panel rd-trend"><div className="rd-panel-head"><div><span>EVOLUÇÃO</span><h3>Receita por mês</h3></div><small>R$ · registros históricos</small></div>
          <div className="rd-bars" role="img" aria-label="Receita mensal da planilha">{monthly.map(item => <div key={item.key} className="rd-bar-item" title={`${monthLabel(item.key)}: ${money(item.revenue)}`}><b>{money(item.revenue)}</b><div><i style={{ height: `${Math.max(4, item.revenue / maxMonthly * 100)}%` }} /></div><span>{new Date(`${item.key}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span></div>)}</div>
        </section>
        <section className="rd-panel rd-fleet-bars"><div className="rd-panel-head"><div><span>FROTA</span><h3>Carga por caminhão</h3></div><small>kg</small></div>
          <div className="rd-progress-list">{truckTotals.map(item => <div key={item.key}><div><strong>{item.key}</strong><span>{integer(item.weight)} kg</span></div><div className="rd-progress"><i style={{ width: `${item.weight / maxTruckWeight * 100}%` }} /></div><small>{item.count} roteiros</small></div>)}</div>
        </section>
      </div>

      <section className="rd-panel rd-register">
        <div className="rd-register-head"><div><span>ROTEIROS</span><h3>Registro de saídas</h3><p>Uma linha por data e caminhão. Abra para consultar os clientes e produtos.</p></div><span className="rd-result-count">{historicRoutes.length} roteiros</span></div>
        <div className="rd-filters"><label>Período<select value={month} onChange={event => setMonth(event.target.value)}><option value="all">Todos os meses</option>{months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label><label>Caminhão<select value={vehicle} onChange={event => setVehicle(event.target.value)}><option value="all">Todos os caminhões</option>{vehicles.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="rd-search">Buscar<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cliente, bairro, produto..." /></label></div>
        <div className="rd-table-wrap"><table className="rd-table"><thead><tr><th>Data</th><th>Caminhão</th><th>Região / bairros</th><th>Entregas</th><th>Carga</th><th>Receita</th><th>Lucro líquido</th><th><span className="sr-only">Abrir</span></th></tr></thead><tbody>{visibleRoutes.map(route => <tr key={route.key}><td>{dateLabel(route.date)}</td><td><strong>{route.vehicle}</strong></td><td className="rd-neighborhoods">{route.districts.slice(0, 3).join(" · ")}{route.districts.length > 3 ? ` +${route.districts.length - 3}` : ""}</td><td>{route.rows.length}</td><td>{integer(route.weight)} kg</td><td>{money(route.revenue)}</td><td className={route.netProfit < 0 ? "rd-negative" : "rd-positive"}>{money(route.netProfit)}</td><td><button type="button" className="rd-row-action" onClick={() => setSelectedKey(route.key)} aria-label={`Abrir roteiro de ${dateLabel(route.date)} do caminhão ${route.vehicle}`}>↗</button></td></tr>)}</tbody></table>{!visibleRoutes.length && <div className="rd-empty">Nenhum roteiro corresponde aos filtros.</div>}</div>
        {pageCount > 1 && <div className="rd-pagination"><span>Página {page} de {pageCount}</span><div><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button><button type="button" disabled={page === pageCount} onClick={() => setPage(value => value + 1)}>Próxima</button></div></div>}
      </section>
    </> : <>
      <div className="rd-context"><span className="rd-context-dot rd-live-dot" /><span>Pedidos e rotas cadastrados no sistema</span><span>A sincronização com a vhsys atualiza os pedidos disponíveis para planejamento.</span></div>
      <div className="rd-kpis rd-live-kpis"><article><span>Pedidos disponíveis</span><strong>{integer(unassignedOrders.length)}</strong><small>Ativos e sem rota</small></article><article><span>Rotas planejadas</span><strong>{integer(routes.filter(route => route.status === "draft").length)}</strong><small>Aguardando saída</small></article><article><span>Em andamento</span><strong>{integer(routes.filter(route => route.status === "active").length)}</strong><small>Operação em curso</small></article><article className="rd-kpi-accent"><span>Carga programada</span><strong>{integer(routes.filter(route => route.status === "draft" || route.status === "active").reduce((sum, route) => sum + route.loadedKg, 0))} <em>kg</em></strong><small>Rotas abertas</small></article></div>
      <div className="rd-live-grid"><section className="rd-panel rd-live-list"><div className="rd-register-head"><div><span>OPERAÇÃO</span><h3>Rotas cadastradas</h3><p>Acompanhe o andamento e abra a rota para conferir as paradas.</p></div><button type="button" className="rd-text-action" onClick={onPlan}>Montar rota ↗</button></div><div className="rd-filters"><label>Situação<select value={liveStatus} onChange={event => setLiveStatus(event.target.value)}><option value="all">Todas</option><option value="draft">Planejadas</option><option value="active">Em rota</option><option value="completed">Concluídas</option><option value="cancelled">Canceladas</option></select></label><label className="rd-search">Buscar<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rota ou caminhão" /></label></div><div className="rd-live-route-list">{liveRoutes.map(route => <button type="button" key={route.id} onClick={() => onOpenRoute(route.id)}><div><strong>{route.name}</strong><small>{dateLabel(route.routeDate)} · {route.plate} · {route.stops.length} entregas</small></div><div className="rd-live-route-side"><span className={`rd-status rd-status-${route.status}`}>{statusLabel(route.status)}</span><b>{integer(route.loadedKg)} kg</b></div></button>)}{!liveRoutes.length && <div className="rd-empty">Nenhuma rota cadastrada neste filtro.</div>}</div></section>
      <section className="rd-panel rd-queue"><div className="rd-register-head"><div><span>FILA</span><h3>Pedidos para roteirizar</h3><p>Pedidos ativos ainda não vinculados a uma rota.</p></div><span className="rd-result-count">{unassignedOrders.length}</span></div><div className="rd-queue-list">{unassignedOrders.slice(0, 8).map(order => <div key={order.id}><span className="rd-queue-mark">{order.number.slice(-2)}</span><div><strong>{order.customerName}</strong><small>{order.number} · {order.customerDistrict || order.customerCity || "Região não informada"}{order.deliveryDate ? ` · ${dateLabel(order.deliveryDate)}` : ""}</small></div><b>{integer(order.totalWeightKg)} kg</b></div>)}{!unassignedOrders.length && <div className="rd-empty">Nenhum pedido aguardando roteirização.</div>}</div>{unassignedOrders.length > 8 && <small className="rd-queue-more">Mais {unassignedOrders.length - 8} pedidos no planejamento</small>}<button type="button" className="rd-queue-button" onClick={onPlan}>Abrir planejamento <span>↗</span></button></section></div>
    </>}

    {selectedRoute && <div className="rd-modal-backdrop" onClick={() => setSelectedKey(null)}><section className="rd-detail-modal" role="dialog" aria-modal="true" aria-label={`Roteiro histórico ${dateLabel(selectedRoute.date)}`} onClick={event => event.stopPropagation()}><div className="rd-detail-header"><div><span>ROTEIRO HISTÓRICO</span><h2>{selectedRoute.vehicle}</h2><p>{dateLabel(selectedRoute.date)} · {selectedRoute.rows.length} registros</p></div><button type="button" onClick={() => setSelectedKey(null)} aria-label="Fechar detalhes">×</button></div><div className="rd-detail-totals"><div><span>Carga</span><strong>{integer(selectedRoute.weight)} kg</strong></div><div><span>Receita</span><strong>{money(selectedRoute.revenue)}</strong></div><div><span>Lucro líquido</span><strong>{money(selectedRoute.netProfit)}</strong></div></div><div className="rd-detail-stops">{selectedRoute.rows.map((row, index) => <article key={row.row}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{row.customer}</strong><small>{row.district} · {row.company || "Empresa não informada"}</small><p>{row.product} · {row.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} bombonas de {row.packageKg} kg · {integer(row.weightKg)} kg</p></div><b>{money(row.revenue)}</b></article>)}</div><p className="rd-detail-note">A sequência segue as linhas da planilha. Não há horário, número de pedido ou confirmação de entrega nesta fonte.</p></section></div>}
  </div>;
}
