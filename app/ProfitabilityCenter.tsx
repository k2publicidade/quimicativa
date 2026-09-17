"use client";

import { useEffect, useState } from "react";

type Summary = {
  label: string; revenueCents: number; grossProfitCents: number; deliveryCostCents: number;
  deliveryCount: number; deliveredWeightKg: number; averageProfitPerDeliveryCents: number;
  averageWeightKg: number; averagePaymentDays: number | null; marginPercent: number | null;
  purchaseFrequencyDays?: number | null;
};
type Dimension = "customer" | "delivery" | "route" | "vehicle" | "region";
type Dimensions = Record<Dimension, Summary[]>;

const emptyDimensions: Dimensions = { customer: [], delivery: [], route: [], vehicle: [], region: [] };
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dimensionLabels: Record<Dimension, string> = { customer: "Cliente", delivery: "Entrega", route: "Rota", vehicle: "Caminhão", region: "Região" };
const template = "Cliente;Pedido;Rota;Placa;Região;Período;Faturamento;Lucro bruto;Custo entrega;Peso kg;Entregas;Prazo médio\nCliente Exemplo;PED-001;Zona Norte;ABC1D23;Zona Norte;16/09/2026;2500,00;600,00;180,00;1200;1;28";

export default function ProfitabilityCenter({ notify, canWrite }: { notify: (message: string) => void; canWrite: boolean }) {
  const [dimensions, setDimensions] = useState<Dimensions>(emptyDimensions);
  const [dimension, setDimension] = useState<Dimension>("customer");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const summary = dimensions[dimension];

  const load = async () => {
    const response = await fetch("/api/profitability");
    const data = await response.json() as { dimensions?: Dimensions; summary?: Summary[] };
    setDimensions(data.dimensions ?? { ...emptyDimensions, customer: data.summary ?? [] });
  };
  useEffect(() => { load().catch(() => undefined); }, []);

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10_000_000) return notify("A planilha exportada deve ter no máximo 10 MB.");
    setCsv(await file.text());
    setFileName(file.name);
  };
  const submit = async () => {
    if (!csv.trim()) return notify("Selecione um CSV/TSV exportado da planilha.");
    setSaving(true);
    try {
      const response = await fetch("/api/profitability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "Falha na importação");
      notify(data.message || "Dados importados");
      setCsv("");
      setFileName("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível importar a lucratividade");
    } finally {
      setSaving(false);
    }
  };
  const allCustomers = dimensions.customer;
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(template)}`;

  return <div className="profitability-center">
    <div className="module-kpis">
      <article><span>Clientes consolidados</span><strong>{allCustomers.length}</strong></article>
      <article><span>Faturamento importado</span><strong>{brl(allCustomers.reduce((sum, item) => sum + item.revenueCents, 0))}</strong></article>
      <article><span>Lucro bruto importado</span><strong>{brl(allCustomers.reduce((sum, item) => sum + item.grossProfitCents, 0))}</strong></article>
    </div>
    {canWrite && <section className="panel profit-import">
      <div className="panel-heading">
        <div><h2>Importar planilha de lucratividade</h2><p>Use CSV ou TSV e vincule por cliente, pedido, rota ou placa.</p></div>
        <a className="secondary-button" href={templateHref} download="modelo-lucratividade-quimicativa.csv">Baixar modelo</a>
      </div>
      <label className="profit-file">Arquivo CSV ou TSV<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={importFile} /><span>{fileName || "Nenhum arquivo selecionado"}</span></label>
      <small className="profit-help">Colunas: Cliente, Pedido, Rota, Placa, Região, Período, Faturamento, Lucro bruto, Custo entrega, Peso kg, Entregas e Prazo médio. Reimportações idênticas são ignoradas.</small>
      <button className="primary-button" onClick={submit} disabled={saving || !csv}>{saving ? "Importando..." : "Importar dados"}</button>
    </section>}
    <section className="panel profit-table">
      <div className="panel-heading">
        <div><h2>Rentabilidade comparativa</h2><p>Analise receita, lucro, custo e eficiência na dimensão escolhida.</p></div>
        <label className="profit-dimension">Agrupar por<select value={dimension} onChange={event => setDimension(event.target.value as Dimension)}>{(Object.keys(dimensionLabels) as Dimension[]).map(key => <option key={key} value={key}>{dimensionLabels[key]}</option>)}</select></label>
      </div>
      {summary.length ? <div className="table-wrap"><table><thead><tr>
        <th>{dimensionLabels[dimension]}</th><th>Faturamento</th><th>Lucro bruto</th><th>Margem</th><th>Lucro / entrega</th><th>Custo entrega</th><th>Entregas</th><th>Peso médio</th><th>Prazo médio</th>{dimension === "customer" && <th>Frequência</th>}
      </tr></thead><tbody>{summary.map(item => <tr key={item.label}>
        <td><strong>{item.label}</strong></td><td>{brl(item.revenueCents)}</td><td className={item.grossProfitCents >= 0 ? "profit-positive" : "profit-negative"}>{brl(item.grossProfitCents)}</td><td className={(item.marginPercent ?? 0) <= 0 ? "profit-negative" : ""}>{item.marginPercent !== null ? `${item.marginPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}</td><td>{brl(item.averageProfitPerDeliveryCents)}</td><td>{brl(item.deliveryCostCents)}</td><td>{item.deliveryCount}</td><td>{item.averageWeightKg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg</td><td>{item.averagePaymentDays !== null ? `${item.averagePaymentDays.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias` : "—"}</td>{dimension === "customer" && <td>{item.purchaseFrequencyDays ? `a cada ${Math.round(item.purchaseFrequencyDays)} dias` : "—"}</td>}
      </tr>)}</tbody></table></div> : <div className="logistics-empty">Não há dados vinculados para esta dimensão.</div>}
    </section>
  </div>;
}
