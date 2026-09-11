"use client";

import { useEffect, useState } from "react";

type Config = {
  provider: string;
  baseUrl: string;
  ordersPath: string;
  apiToken?: string;
  active: boolean;
  lastSyncAt: number | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
};

const emptyConfig: Config = {
  provider: "REST",
  baseUrl: "",
  ordersPath: "/orders",
  active: false,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncMessage: null,
};

export default function ErpIntegration({ canWrite, notify }: { canWrite: boolean; notify: (message: string) => void }) {
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [saving, setSaving] = useState(false);

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
      const data = await response.json() as { error?: string; integration?: Config };
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
      const response = await fetch("/api/integrations/sync", { method: "POST" });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "Falha na sincronização");
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
    } finally {
      setSaving(false);
    }
  };

  return <section className="panel erp-panel">
    <div className="panel-heading">
      <div><h2>Integração com ERP</h2><p>Sincronize pedidos sem redigitar dados no CRM.</p></div>
      <span className={`erp-state ${config.active ? "on" : "off"}`}>{config.active ? "Ativa" : "Não configurada"}</span>
    </div>
    {canWrite ? <form className="erp-form" onSubmit={save}>
      <div className="form-row">
        <label>Provedor<input value={config.provider} onChange={event => setConfig({ ...config, provider: event.target.value })} placeholder="REST, Omie, Bling..." /></label>
        <label>Endpoint base<input type="url" required value={config.baseUrl} onChange={event => setConfig({ ...config, baseUrl: event.target.value })} placeholder="https://erp.empresa.com/api" /></label>
      </div>
      <div className="form-row">
        <label>Caminho dos pedidos<input required value={config.ordersPath} onChange={event => setConfig({ ...config, ordersPath: event.target.value })} placeholder="/orders" /></label>
        <label>Token de API<input type="password" value={config.apiToken ?? ""} onChange={event => setConfig({ ...config, apiToken: event.target.value })} placeholder="Deixe em branco para manter" autoComplete="new-password" /></label>
      </div>
      <label className="erp-check"><input type="checkbox" checked={config.active} onChange={event => setConfig({ ...config, active: event.target.checked })} /> Ativar sincronização</label>
      <div className="erp-actions">
        <button className="secondary-button" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar configuração"}</button>
        <button className="primary-button" type="button" onClick={sync} disabled={saving || !config.active}>Sincronizar pedidos</button>
      </div>
    </form> : <p className="erp-readonly">Somente gestores podem alterar a integração.</p>}
    {config.lastSyncMessage && <small className={`erp-message ${config.lastSyncStatus}`}>{config.lastSyncMessage}{config.lastSyncAt ? ` · ${new Date(config.lastSyncAt * 1000).toLocaleString("pt-BR")}` : ""}</small>}
  </section>;
}
