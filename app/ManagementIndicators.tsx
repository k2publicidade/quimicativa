"use client";

import { useEffect, useState } from "react";

type CustomerRank = { label: string; revenueCents: number; profitCents: number; deliveries: number };
type RouteRank = { id: number; name: string; plate: string; occupancy: number | null; profitCents: number; deliveries: number };
type VehicleRank = { plate: string; routes: number; averageOccupancy: number; profitCents: number };
type Metrics = { week: { customers: number; deliveries: number; weightKg: number }; month: { revenueCents: number; orders: number; profitCents: number; deliveryCostCents: number }; fleet: { routes: number; averageOccupancy: number; lowOccupancyRoutes: number }; rankings: { mostProfitableCustomers: CustomerRank[]; leastProfitableCustomers: CustomerRank[]; vehicles: VehicleRank[]; routes: RouteRank[] }; alerts: { lowOccupancyRoutes: RouteRank[]; lowProfitRoutes: RouteRank[] } };
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function ManagementIndicators() {
  const [data, setData] = useState<Metrics | null>(null);
  useEffect(() => { fetch("/api/management-metrics").then(response => response.json()).then(setData).catch(() => undefined); }, []);
  const cards = [{ label: "Clientes na semana", value: data?.week.customers ?? "—", note: `${data?.week.deliveries ?? 0} entregas concluídas` }, { label: "Peso entregue", value: data ? `${data.week.weightKg.toLocaleString("pt-BR")} kg` : "—", note: "últimos 7 dias" }, { label: "Faturamento", value: data ? brl(data.month.revenueCents) : "—", note: `${data?.month.orders ?? 0} pedidos em 30 dias` }, { label: "Lucro bruto", value: data ? brl(data.month.profitCents) : "—", note: `Custo logístico ${data ? brl(data.month.deliveryCostCents) : "—"}` }, { label: "Ocupação média", value: data ? `${data.fleet.averageOccupancy}%` : "—", note: `${data?.fleet.lowOccupancyRoutes ?? 0} rota(s) abaixo de 50%` }];
  return <section className="management-indicators">
    <div className="section-title"><div><h2>Operação e rentabilidade</h2><p>Indicadores calculados sobre pedidos, rotas e entregas nos últimos 30 dias.</p></div></div>
    <div className="management-grid">{cards.map(card => <article key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>)}</div>
    {data && <div className="management-details">
      <article><h3>Clientes mais rentáveis</h3>{data.rankings.mostProfitableCustomers.length ? data.rankings.mostProfitableCustomers.map((item, index) => <div key={item.label}><b>{index + 1}</b><span><strong>{item.label}</strong><small>{item.deliveries} entrega(s)</small></span><em>{brl(item.profitCents)}</em></div>) : <p>Importe os dados de lucratividade para formar o ranking.</p>}</article>
      <article><h3>Atenção gerencial</h3>{data.alerts.lowOccupancyRoutes.map(item => <div key={`occupancy-${item.id}`}><b>!</b><span><strong>{item.name}</strong><small>{item.plate} · ocupação de {item.occupancy}%</small></span></div>)}{data.alerts.lowProfitRoutes.map(item => <div key={`profit-${item.id}`}><b>R$</b><span><strong>{item.name}</strong><small>{item.plate} · contribuição {brl(item.profitCents)}</small></span></div>)}{!data.alerts.lowOccupancyRoutes.length && !data.alerts.lowProfitRoutes.length && <p>Nenhuma rota com baixa ocupação ou contribuição negativa.</p>}</article>
      <article><h3>Aproveitamento dos caminhões</h3>{data.rankings.vehicles.length ? data.rankings.vehicles.slice(0, 5).map(item => <div key={item.plate}><b>{item.averageOccupancy}%</b><span><strong>{item.plate}</strong><small>{item.routes} rota(s) · lucro {brl(item.profitCents)}</small></span></div>) : <p>Sem rotas no período.</p>}</article>
    </div>}
  </section>;
}
