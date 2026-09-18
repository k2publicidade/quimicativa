"use client";

import { useEffect, useState } from "react";
import { syncErp } from '../lib/sync-erp-client';

type Config = {
  provider: string;
  baseUrl: string;
  ordersPath: string;
  customersPath: string;
  goodsReceiptsPath: string;
  invoicesPath: string;
  receivablesPath: string;
  apiToken?: string;
  secretApiToken?: string;
  active: boolean;
  lastSyncAt: number | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
};
type Preview = { totalRecords: number; validRecords: number; sample: { number: string; customerName: string; deliveryDate: string; paymentTerms: string; items: number }[] };

const emptyConfig: Config = {
  provider: "REST",
  baseUrl: "",
  ordersPath: "/orders",
  active: false,
  customersPath: "/clientes",
  goodsReceiptsPath: "/entradas",
  invoicesPath: "/notas-fiscais",
  receivablesPath: "/contas-a-receber",
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncMessage: null,
};

export default function ErpIntegration({ canWrite, notify }: { canWrite: boolean; notify: (message: string) => void }) {
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    fetch("/api/integrations")
      .then(response => response.json() as Promise<{ integration?: Config }>)
      .then(data => { if (data.integration) setConfig(data.integration); })
      .catch(() => undefined);
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; integration?: Config };
      if (!response.ok || !data.integration) throw new Error(data.error || "Resposta inválida ao salvar a integração");
      setConfig(data.integration);
      notify("Integração com ERP salva");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar a integração");
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSaving(true);
    try {
      const data = await syncErp(message => setConfig(current => ({...current,lastSyncStatus:'running',lastSyncMessage:message})));
      const message = data.message || "Sincronização concluída";
      notify(message);
      setConfig(current => ({
        ...current,
        lastSyncAt: Math.floor(Date.now() / 1000),
        lastSyncStatus: "success",
        lastSyncMessage: message,
      }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha na sincronização");
      setConfig(current=>({...current,lastSyncStatus:'error',lastSyncMessage:error instanceof Error?error.message:'Falha na sincronização'}));
    } finally {
      setSaving(false);
    }
  };

  const testPayload = async () => {
    setPreviewing(true);
    try {
      const response = await fetch("/api/integrations/sync?preview=1", { method: "POST" });
      const data = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível validar o payload do ERP");
      setPreview(data);
      notify(`${data.validRecords} de ${data.totalRecords} pedido(s) reconhecido(s); nenhum dado foi importado.`);
    } catch (error) {
      setPreview(null);
      notify(error instanceof Error ? error.message : "Não foi possível validar o ERP");
    } finally {
      setPreviewing(false);
    }
  };

  const syncFiscal = async (scope: "entradas" | "notas-fiscais" | "contas-pagar", label: string) => {
    setSaving(true);
    try {
      let offset = 0, imported = 0;
      for (;;) {
        const response = await fetch(`/api/integrations/sync?scope=${scope}&offset=${offset}`, { method: "POST" });
        const data = await response.json() as { error?: string; issues?: string[]; message?: string; imported?: number; nextOffset?: number | null };
        if (!response.ok) throw new Error(data.error || `Falha ao sincronizar ${label}`);
        if(data.issues?.length) throw new Error(`${data.issues.length} falha(s): ${data.issues.slice(0,2).join(' ')}`);
        imported += data.imported ?? 0;
        setConfig(current=>({...current,lastSyncStatus:'running',lastSyncMessage:`${imported} ${label} sincronizadas`}));
        if (data.nextOffset === null || data.nextOffset === undefined) break;
        if (data.nextOffset <= offset) throw new Error("A paginação da vhsys não avançou");
        offset = data.nextOffset;
      }
      notify(`${imported} ${label} sincronizada(s)`);
      setConfig(current=>({...current,lastSyncStatus:'success',lastSyncAt:Math.floor(Date.now()/1000),lastSyncMessage:`${imported} ${label} sincronizadas`}));
    } catch (error) { const message=error instanceof Error ? error.message : `Falha ao sincronizar ${label}`; notify(message); setConfig(current=>({...current,lastSyncStatus:'error',lastSyncMessage:message})); }
    finally { setSaving(false); }
  };

  return <section className="panel erp-panel">
    <div className="panel-heading">
      <div><h2>Integração com ERP</h2><p>Sincronize pedidos sem redigitar dados no CRM.</p></div>
      <span className={`erp-state ${config.active ? "on" : "off"}`}>{config.active ? "Ativa" : "Não configurada"}</span>
    </div>
    {canWrite ? <form className="erp-form" onSubmit={save}>
      <div className="form-row">
        <label>Provedor<input value={config.provider} onChange={event => setConfig({ ...config, provider: event.target.value })} placeholder="vhsys" /></label>
        <label>Endpoint base<input type="url" required value={config.baseUrl} onChange={event => setConfig({ ...config, baseUrl: event.target.value })} placeholder="https://api.vhsys.com/v2" /></label>
      </div>
      <div className="form-row">
        <label>Caminho dos pedidos<input required value={config.ordersPath} onChange={event => setConfig({ ...config, ordersPath: event.target.value })} placeholder="/pedidos" /></label>
        <label>Caminho dos clientes<input required value={config.customersPath} onChange={event => setConfig({ ...config, customersPath: event.target.value })} placeholder="/clientes" /></label>
      </div>
      <div className="form-row">
        <label>Entrada de mercadoria<input required value={config.goodsReceiptsPath} onChange={event => setConfig({ ...config, goodsReceiptsPath: event.target.value })} placeholder="/entradas" /></label>
        <label>Notas fiscais<input required value={config.invoicesPath} onChange={event => setConfig({ ...config, invoicesPath: event.target.value })} placeholder="/notas-fiscais" /></label>
        <label>Contas a receber<input required value={config.receivablesPath} onChange={event => setConfig({ ...config, receivablesPath: event.target.value })} placeholder="/contas-a-receber" /></label>
      </div>
      <div className="form-row">
        <label>Access token<input type="password" value={config.apiToken ?? ""} onChange={event => setConfig({ ...config, apiToken: event.target.value })} placeholder="Deixe em branco para manter" autoComplete="new-password" /></label>
        <label>Secret access token<input type="password" value={config.secretApiToken ?? ""} onChange={event => setConfig({ ...config, secretApiToken: event.target.value })} placeholder="Deixe em branco para manter" autoComplete="new-password" /></label>
      </div>
      <label className="erp-check"><input type="checkbox" checked={config.active} onChange={event => setConfig({ ...config, active: event.target.checked })} /> Ativar sincronização</label>
      <div className="erp-actions">
        <button className="secondary-button" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar configuração"}</button>
        <button className="secondary-button" type="button" onClick={testPayload} disabled={saving || previewing || !config.active}>{previewing ? "Validando..." : "Testar e visualizar"}</button>
        <button className="primary-button" type="button" onClick={sync} disabled={saving || !config.active}>Sincronizar pedidos</button>
        <button className="primary-button" type="button" onClick={() => syncFiscal("contas-pagar", "contas a pagar")} disabled={saving || !config.active}>Sincronizar contas a pagar</button>
        <button className="secondary-button" type="button" onClick={() => syncFiscal("entradas", "entradas de mercadoria")} disabled={saving || !config.active}>Sincronizar entradas</button>
        <button className="secondary-button" type="button" onClick={() => syncFiscal("notas-fiscais", "notas fiscais")} disabled={saving || !config.active}>Sincronizar notas fiscais</button>
      </div>
    </form> : <p className="erp-readonly">Somente gestores podem alterar a integração.</p>}
    {preview && <div className="erp-preview"><strong>Prévia sem importação</strong><span>{preview.validRecords} de {preview.totalRecords} registros válidos</span>{preview.sample.length ? <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Pagamento</th><th>Itens válidos</th></tr></thead><tbody>{preview.sample.map((item, index) => <tr key={`${item.number}-${index}`}><td>{item.number || "Ausente"}</td><td>{item.customerName || "Ausente"}</td><td>{item.deliveryDate || "—"}</td><td>{item.paymentTerms || "—"}</td><td>{item.items}</td></tr>)}</tbody></table></div> : <small>Nenhum pedido reconhecido no retorno.</small>}</div>}
    {config.lastSyncMessage && <small className={`erp-message ${config.lastSyncStatus}`}>{config.lastSyncMessage}{config.lastSyncAt ? ` · ${new Date(config.lastSyncAt * 1000).toLocaleString("pt-BR")}` : ""}</small>}
  </section>;
}
