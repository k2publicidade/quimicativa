"use client";
import { useCallback, useEffect, useState } from "react";
import { CustomersTab, type Customer } from "./PedidosCenter";

export default function ClientesCenter({
  notify,
  canWrite,
}: {
  notify: (message: string) => void;
  canWrite: boolean;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/customers?status=active", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setCustomers((await response.json()).customers ?? []);
    } catch {
      notify("Não foi possível carregar os clientes ativos");
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <section className="panel archive-panel"><div className="ord-empty">Carregando clientes ativos...</div></section>;
  return <CustomersTab customers={customers} canWrite={canWrite} notify={notify} onChanged={load} />;
}
