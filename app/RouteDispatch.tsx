"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, localDay, type OpsRecord } from "../lib/operations";
import { displayDate, OpsBadge } from "./OperationsUI";

/**
 * Expedição para o galpão: a equipe física vê as rotas montadas pelo administrador,
 * imprime o romaneio de cada motorista (ou todas de uma vez) e envia o roteiro pelo WhatsApp.
 */

type DispatchStop = { id: number; orderId: number; orderNumber: string; customerName: string; sequence: number; address: string; weightKg: number; packageSummary: string; receivingWindow: string; paymentTerms: string; status: string };
type DispatchRoute = {
  id: number; code: string; name: string; plate: string; model: string; driverName: string; driverPhone?: string; routeDate: string; status: string; originAddress: string;
  loadedKg: number; capacityKg: number | null; hazardousLoad: boolean; safetyNotices: string[];
  loadSummary: { packageType: string; unitWeightKg: number; count: number }[];
  productSummary: { productName: string; quantity: number; unit: string }[];
  stops: DispatchStop[];
};

const EQUIPMENT: [string, string][] = [["bombonas", "Bombonas"], ["tampas", "Tampas"], ["lacres", "Lacres"], ["ibcs", "IBCs 1000L"], ["clamps", "Abraçadeiras"], ["couplings", "Engates"], ["carts", "Carrinhos"]];
const kg = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
const statusLabel = (value: string) => ({ draft: "Aguardando saída", active: "Em rota", completed: "Concluída", cancelled: "Cancelada" }[value] ?? value);

const prepFor = (records: OpsRecord[], orderId: number) => records.find(row => row.kind === "preparation" && row.data.orderId === String(orderId));
const equipmentFor = (records: OpsRecord[], route: DispatchRoute) => {
  const preps = route.stops.map(stop => prepFor(records, stop.orderId)).filter((row): row is OpsRecord => Boolean(row));
  return {
    preps,
    totals: EQUIPMENT.map(([key, label]) => ({ key, label, count: preps.reduce((sum, row) => sum + Number(row.data[key] || 0), 0) })).filter(item => item.count > 0),
    pumps: preps.filter(row => row.data.needsPump === "yes").map(row => `${row.data.pumpQty || 1}x ${row.data.pumpType || "bomba"}`),
    hoses: preps.filter(row => row.data.needsHose === "yes").map(row => row.data.hoseSize || "mangote"),
    ready: preps.filter(row => row.status === "ready").length,
  };
};

/** Bombonas da rota: o que o galpão lançou na preparação ou, sem preparação, as bombonas dos itens do pedido. */
const bombonasFor = (records: OpsRecord[], route: DispatchRoute) => {
  const prepared = equipmentFor(records, route).preps;
  if (prepared.length === route.stops.length) return prepared.reduce((sum, row) => sum + Number(row.data.bombonas || 0), 0);
  const fromItems = route.loadSummary.filter(item => /bombona/i.test(item.packageType)).reduce((sum, item) => sum + item.count, 0);
  return Math.max(fromItems, prepared.reduce((sum, row) => sum + Number(row.data.bombonas || 0), 0));
};

/** Texto do roteiro para o motorista (WhatsApp ou cópia). */
export function driverMessage(route: DispatchRoute, records: OpsRecord[]) {
  const equipment = equipmentFor(records, route);
  const lines = [
    `*${route.name}* (${route.code})`,
    `Data: ${displayDate(route.routeDate)} · Caminhão ${route.plate}`,
    `Saída: ${route.originAddress || "galpão"}`,
    "",
    ...route.stops.flatMap(stop => {
      const prep = prepFor(records, stop.orderId);
      return [
        `*${stop.sequence}. ${stop.customerName}* — Pedido ${stop.orderNumber}`,
        `📍 ${stop.address || "endereço não cadastrado"}`,
        `📦 ${stop.packageSummary || "conferir carga"}`,
        ...(prep && Number(prep.data.bombonas) > 0 ? [`🛢 ${prep.data.bombonas} bombona(s) — recolher as vazias`] : []),
        ...(stop.receivingWindow ? [`🕒 Recebimento: ${stop.receivingWindow}`] : []),
        ...(stop.paymentTerms ? [`💳 ${stop.paymentTerms}`] : []),
        "",
      ];
    }),
    `Total: ${route.stops.length} entrega(s) · ${kg(route.loadedKg)}`,
    ...(equipment.totals.length ? [`Levar: ${equipment.totals.map(item => `${item.count} ${item.label.toLowerCase()}`).join(", ")}`] : []),
    ...(route.hazardousLoad ? ["⚠ Carga com produto perigoso: conferir documentação e ficha de emergência."] : []),
  ];
  return lines.join("\n");
}
const whatsappLink = (phone: string | undefined, text: string) => {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return `https://wa.me/${digits.length >= 12 ? digits : ""}?text=${encodeURIComponent(text)}`;
};

export default function RouteDispatch({ records, notify }: { records: OpsRecord[]; notify: (message: string) => void }) {
  const [date, setDate] = useState(localDay());
  const [routes, setRoutes] = useState<DispatchRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const autoPicked = useRef(false);

  const load = useCallback(async (day: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/routes?date=${day}`, { cache: "no-store" });
      const data = await response.json() as { routes?: DispatchRoute[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Falha ao carregar as rotas.");
      const list = (data.routes ?? []).filter(route => route.status !== "cancelled");
      // Abre em "amanhã" quando hoje não tem rota a sair, que é a rotina do galpão.
      if (!autoPicked.current) {
        autoPicked.current = true;
        if (day === localDay() && !list.some(route => route.status !== "completed")) { setDate(addDays(localDay(), 1)); return; }
      }
      setRoutes(list); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao carregar as rotas."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(date); }, [date, load]);

  const copy = async (route: DispatchRoute) => {
    try { await navigator.clipboard.writeText(driverMessage(route, records).replace(/\*/g, "")); notify("Roteiro copiado. Cole na conversa com o motorista."); }
    catch { notify("Não foi possível copiar automaticamente."); }
  };
  const totalStops = routes.reduce((sum, route) => sum + route.stops.length, 0);
  const totalBombonas = routes.reduce((sum, route) => sum + bombonasFor(records, route), 0);

  return <section className="ops-panel rx-dispatch">
    <div className="ops-toolbar">
      <label>Dia das entregas<input type="date" value={date} onChange={event => event.target.value && setDate(event.target.value)} /></label>
      <button className="ops-button" onClick={() => setDate(localDay())}>Hoje</button>
      <button className="ops-button" onClick={() => setDate(addDays(localDay(), 1))}>Amanhã</button>
      <button className="ops-button" onClick={() => void load(date)}>Atualizar</button>
      {routes.length > 0 && <a className="primary-button rx-print-all" href={`/api/routes/manifest?date=${date}`} target="_blank" rel="noreferrer">🖨 Imprimir todas as rotas ({routes.length})</a>}
    </div>
    <div className="ops-kpis"><article><span>Rotas em {displayDate(date)}</span><strong>{routes.length}</strong></article><article><span>Entregas</span><strong>{totalStops}</strong></article><article><span>Peso total</span><strong>{kg(routes.reduce((sum, route) => sum + route.loadedKg, 0))}</strong></article><article><span>Bombonas a carregar</span><strong>{totalBombonas}</strong></article></div>
    {error && <div className="ops-error" role="alert">{error} <button type="button" onClick={() => void load(date)}>Tentar novamente</button></div>}
    {loading ? <p className="ops-empty" role="status">Carregando rotas…</p> : !routes.length && !error ? <p className="ops-empty">Nenhuma rota montada para {displayDate(date)}. O administrador monta em Logística → Montar rotas do dia.</p> : null}
    <p className="ops-note">Imprima um romaneio para cada motorista. Ele traz a lista de carregamento para conferir, as paradas na ordem de entrega e o espaço para canhoto e bombonas devolvidas.</p>
    <div className="rx-routes">{routes.map(route => {
      const equipment = equipmentFor(records, route), expanded = open === route.id, message = driverMessage(route, records);
      return <article key={route.id} className="rx-route">
        <header>
          <div><span className="rx-code">{route.code}</span><h3>{route.driverName || "Motorista não definido"}</h3><p>{route.name} · {route.plate}{route.model ? ` — ${route.model}` : ""}</p></div>
          <OpsBadge warning={route.status === "draft" && equipment.ready < route.stops.length}>{route.status === "draft" ? `Separação ${equipment.ready}/${route.stops.length}` : statusLabel(route.status)}</OpsBadge>
        </header>
        <div className="rx-facts"><span><b>{route.stops.length}</b> entrega(s)</span><span><b>{kg(route.loadedKg)}</b>{route.capacityKg ? ` de ${kg(route.capacityKg)}` : ""}</span>{equipment.totals.map(item => <span key={item.key}><b>{item.count}</b> {item.label.toLowerCase()}</span>)}{equipment.pumps.length > 0 && <span>Bomba: <b>{equipment.pumps.join(", ")}</b></span>}{equipment.hoses.length > 0 && <span>Mangote: <b>{equipment.hoses.join(", ")}</b></span>}</div>
        {route.productSummary.length > 0 && <div className="rx-load"><strong>Carregar</strong>{route.productSummary.map(item => <span key={`${item.productName}-${item.unit}`}>{item.productName} · {item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} {item.unit}</span>)}{route.loadSummary.map(item => <span key={`${item.packageType}-${item.unitWeightKg}`} className="pkg">{item.count.toLocaleString("pt-BR")} {item.packageType}{item.unitWeightKg ? ` de ${item.unitWeightKg.toLocaleString("pt-BR")} kg` : ""}</span>)}</div>}
        {route.safetyNotices.length > 0 && <p className="rx-safety">⚠ {route.safetyNotices[0]}</p>}
        <div className="rx-actions">
          <a className="primary-button" href={`/api/routes/manifest?id=${route.id}`} target="_blank" rel="noreferrer">🖨 Imprimir romaneio</a>
          <a className="ops-button rx-whatsapp" href={whatsappLink(route.driverPhone, message)} target="_blank" rel="noreferrer">Enviar ao motorista (WhatsApp)</a>
          <button type="button" className="ops-button" onClick={() => void copy(route)}>Copiar roteiro</button>
          <button type="button" className="ops-link" onClick={() => setOpen(expanded ? null : route.id)}>{expanded ? "Ocultar paradas" : "Ver paradas"}</button>
        </div>
        {expanded && <ol className="rx-stops">{route.stops.map(stop => {
          const prep = prepFor(records, stop.orderId);
          return <li key={stop.id}><span className="rx-seq">{stop.sequence}</span><div><strong>{stop.customerName} <small>Pedido {stop.orderNumber}</small></strong><p>{stop.address || "Endereço não cadastrado"}</p><small>{stop.packageSummary || "Carga a conferir"}</small>{stop.receivingWindow && <small>Recebimento: {stop.receivingWindow}</small>}<div className="ops-tags"><OpsBadge warning={prep?.status !== "ready"}>{prep?.status === "ready" ? "Separado" : prep ? "A separar" : "Preparação não cadastrada"}</OpsBadge>{prep && EQUIPMENT.filter(([key]) => Number(prep.data[key]) > 0).map(([key, label]) => <span key={key}>{label}: {prep.data[key]}</span>)}</div></div></li>;
        })}</ol>}
      </article>;
    })}</div>
  </section>;
}
