"use client";

import { useEffect, useState } from "react";

type Insight = { customerName: string; averageInterval: number | null; cadenceDays: number | null; daysSinceLastOrder: number };
type InsightData = {
  customersTracked: number;
  atRisk: Insight[];
  productPairs: { pair: string; ordersCount: number }[];
  customerPairs: { customerA: string; customerB: string; weeksCount: number }[];
  routePairs: { customerA: string; customerB: string; routesCount: number }[];
  productOpportunities: { customerName: string; productName: string; relatedProduct: string; ordersCount: number }[];
  routeOpportunities: { routeName: string; customerName: string; city: string; remainingKg: number | null; remainingM3: number | null; volumeDataComplete: boolean }[];
};

export default function CommercialInsights() {
  const [data, setData] = useState<InsightData | null>(null);
  useEffect(() => { fetch("/api/crm-insights").then(response => response.json()).then(setData).catch(() => undefined); }, []);
  return <section className="panel crm-insights">
    <div className="panel-heading"><div><h2>Inteligência comercial</h2><p>Oportunidades calculadas a partir do histórico de pedidos e rotas</p></div><strong className="insight-count">{data?.customersTracked ?? "—"} clientes acompanhados</strong></div>
    <div className="insight-columns insight-columns-three">
      <div><h3>Clientes para contato</h3>{data?.atRisk.length ? data.atRisk.slice(0, 5).map(item => <div className="insight-row" key={item.customerName}><span className="task-icon amber">CRM</span><div><strong>{item.customerName}</strong><small>Há {item.daysSinceLastOrder} dias · ciclo {item.cadenceDays ? `de ~${item.cadenceDays}` : `médio de ${item.averageInterval ?? "—"}`} dias</small></div></div>) : <p className="insight-empty">Nenhum cliente fora do ciclo esperado.</p>}</div>
      <div><h3>Encaixes em rotas</h3>{data?.routeOpportunities?.length ? data.routeOpportunities.map(item => <div className="insight-row" key={`${item.routeName}-${item.customerName}`}><span className="task-icon blue">↗</span><div><strong>{item.customerName} · {item.city}</strong><small>{item.routeName}{item.remainingKg !== null ? ` · ${item.remainingKg.toLocaleString("pt-BR")} kg livres` : ""}{item.remainingM3 !== null ? ` · ${item.remainingM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³ livres` : ""}</small></div></div>) : <p className="insight-empty">Nenhum encaixe regional com capacidade confirmada.</p>}</div>
      <div><h3>Produtos para oferecer</h3>{data?.productOpportunities?.length ? data.productOpportunities.map(item => <div className="insight-row" key={`${item.customerName}-${item.productName}`}><span className="task-icon green">+</span><div><strong>{item.productName}</strong><small>{item.customerName} já compra {item.relatedProduct} · combinação vista em {item.ordersCount} pedido(s)</small></div></div>) : <p className="insight-empty">Sem oportunidades com evidência suficiente.</p>}</div>
    </div>
    <div className="insight-evidence">
      <div><h3>Produtos comprados juntos</h3>{data?.productPairs.length ? data.productPairs.slice(0, 3).map(item => <span key={item.pair}><strong>{item.pair}</strong> · {item.ordersCount} pedidos</span>) : <small>Histórico insuficiente.</small>}</div>
      <div><h3>Clientes que compram na mesma semana</h3>{data?.customerPairs?.length ? data.customerPairs.slice(0, 3).map(item => <span key={`${item.customerA}-${item.customerB}`}><strong>{item.customerA} + {item.customerB}</strong> · {item.weeksCount} semanas</span>) : <small>Histórico insuficiente.</small>}</div>
      <div><h3>Clientes que compartilham rotas</h3>{data?.routePairs?.length ? data.routePairs.slice(0, 3).map(item => <span key={`${item.customerA}-${item.customerB}`}><strong>{item.customerA} + {item.customerB}</strong> · {item.routesCount} rotas</span>) : <small>Histórico insuficiente.</small>}</div>
    </div>
  </section>;
}
