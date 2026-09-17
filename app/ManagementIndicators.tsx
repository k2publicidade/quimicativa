"use client";

import { useEffect, useState } from "react";

type CustomerRank = { label: string; revenueCents: number; profitCents: number; deliveries: number };
type RouteRank = { id: number; name: string; plate: string; occupancy: number | null; weightOccupancy: number | null; volumeOccupancy: number | null; volumeDataComplete: boolean; limitingFactor: "weight" | "volume" | null; profitCents: number; deliveries: number };
type VehicleRank = { plate: string; routes: number; averageOccupancy: number; profitCents: number };
type Metrics = {
  period: { days: number; periodStart: number; generatedAt: number };
  week: { customers: number; deliveries: number; weightKg: number; revenueCents: number };
  month: { revenueCents: number; calendarRevenueCents: number; orders: number; profitCents: number; deliveryCostCents: number };
  fleet: { routes: number; averageOccupancy: number; lowOccupancyRoutes: number };
  logistics: { completedJourneys: number; measuredJourneys: number; totalKm: number; totalFuelLiters: number; averageJourneyHours: number | null; stoppedMinutes: number | null; deliveriesPerHour: number | null; fuelEfficiencyKmL: number | null; profitableWorkdays: number; profitPerWorkdayCents: number | null };
  rankings: { mostProfitableCustomers: CustomerRank[]; leastProfitableCustomers: CustomerRank[]; vehicles: VehicleRank[]; routes: RouteRank[] };
  alerts: { lowOccupancyRoutes: RouteRank[]; lowProfitRoutes: RouteRank[] };
};
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function ManagementIndicators() {
  const [data, setData] = useState<Metrics | null>(null);
  const [days, setDays] = useState(30);
  useEffect(() => {
    fetch(`/api/management-metrics?days=${days}`)
      .then(response => response.json() as Promise<Metrics>)
      .then(setData)
      .catch(() => undefined);
  }, [days]);
  const cards = [
    { label: "Clientes na semana", value: data?.week.customers ?? "—", note: `${data?.week.deliveries ?? 0} entregas concluídas` },
    { label: "Peso entregue", value: data ? `${data.week.weightKg.toLocaleString("pt-BR")} kg` : "—", note: "últimos 7 dias" },
    { label: "Faturamento semanal", value: data ? brl(data.week.revenueCents) : "—", note: "pedidos dos últimos 7 dias" },
    { label: "Faturamento mensal", value: data ? brl(data.month.calendarRevenueCents) : "—", note: `mês corrente · ${data?.month.orders ?? 0} pedidos no período analisado` },
    { label: "Lucro bruto", value: data ? brl(data.month.profitCents) : "—", note: `Custo logístico ${data ? brl(data.month.deliveryCostCents) : "—"}` },
    { label: "Ocupação média", value: data ? `${data.fleet.averageOccupancy}%` : "—", note: `${data?.fleet.lowOccupancyRoutes ?? 0} rota(s) abaixo de 50%` },
    { label: "Distância medida", value: data?.logistics.measuredJourneys ? `${data.logistics.totalKm.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : "—", note: `${data?.logistics.measuredJourneys ?? 0} jornada(s) com hodômetro` },
    { label: "Jornada média", value: data?.logistics.averageJourneyHours !== null && data?.logistics.averageJourneyHours !== undefined ? `${data.logistics.averageJourneyHours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : "—", note: `${data?.logistics.completedJourneys ?? 0} jornada(s) encerrada(s)` },
    { label: "Tempo em entregas", value: data?.logistics.stoppedMinutes ? `${data.logistics.stoppedMinutes.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} min` : "—", note: data?.logistics.deliveriesPerHour ? `${data.logistics.deliveriesPerHour.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} entrega(s)/h` : "Sem ciclo completo registrado" },
    { label: "Eficiência de combustível", value: data?.logistics.fuelEfficiencyKmL ? `${data.logistics.fuelEfficiencyKmL.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km/L` : "—", note: data?.logistics.totalFuelLiters ? `${data.logistics.totalFuelLiters.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} L registrados` : "Consumo ainda não registrado" },
    { label: "Lucro por dia de trabalho", value: data?.logistics.profitPerWorkdayCents !== null && data?.logistics.profitPerWorkdayCents !== undefined ? brl(data.logistics.profitPerWorkdayCents) : "—", note: data?.logistics.profitableWorkdays ? `${data.logistics.profitableWorkdays} jornada(s) encerrada(s) com rentabilidade vinculada` : "Vincule a planilha às rotas concluídas" },
  ];

  return <section className="management-indicators">
    <div className="section-title"><div><h2>Operação e rentabilidade</h2><p>Indicadores calculados sobre pedidos, rotas e entregas no período selecionado.</p></div><label className="management-period">Período<select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={365}>12 meses</option></select></label></div>
    <div className="management-grid">{cards.map(card => <article key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>)}</div>
    {data && <div className="management-details">
      <Rank title="Clientes mais rentáveis" items={data.rankings.mostProfitableCustomers} empty="Importe os dados de lucratividade para formar o ranking." />
      <Rank title="Clientes menos rentáveis" items={data.rankings.leastProfitableCustomers} empty="Importe os dados de lucratividade para identificar margens baixas." negative />
      <article><h3>Atenção gerencial</h3>
        {data.alerts.lowOccupancyRoutes.map(item => <div key={`occupancy-${item.id}`}><b>!</b><span><strong>{item.name}</strong><small>{item.plate} · ocupação efetiva de {item.occupancy}%{item.limitingFactor ? ` · limitada por ${item.limitingFactor === "volume" ? "cubagem" : "peso"}` : ""}</small></span></div>)}
        {data.alerts.lowProfitRoutes.map(item => <div key={`profit-${item.id}`}><b>R$</b><span><strong>{item.name}</strong><small>{item.plate} · contribuição {brl(item.profitCents)}</small></span></div>)}
        {!data.alerts.lowOccupancyRoutes.length && !data.alerts.lowProfitRoutes.length && <p>Nenhuma rota com baixa ocupação ou contribuição negativa.</p>}
      </article>
      <article><h3>Aproveitamento dos caminhões</h3>
        {data.rankings.vehicles.length ? data.rankings.vehicles.slice(0, 5).map(item => <div key={item.plate}><b>{item.averageOccupancy}%</b><span><strong>{item.plate}</strong><small>{item.routes} rota(s) · lucro {brl(item.profitCents)}</small></span></div>) : <p>Sem rotas no período.</p>}
      </article>
    </div>}
  </section>;
}

function Rank({ title, items, empty, negative = false }: { title: string; items: CustomerRank[]; empty: string; negative?: boolean }) {
  return <article><h3>{title}</h3>{items.length ? items.map((item, index) => <div key={item.label}>
    <b>{index + 1}</b><span><strong>{item.label}</strong><small>{item.deliveries} entrega(s)</small></span><em className={negative || item.profitCents < 0 ? "negative" : ""}>{brl(item.profitCents)}</em>
  </div>) : <p>{empty}</p>}</article>;
}
