"use client";
import { useCallback, useEffect, useState } from "react";
import { localDay } from "../lib/operations";
import RouteOperations, { type OperationalRoute } from "./RouteOperations";
import { OpsState, type OpsProps } from "./OperationsUI";
export default function StaffJourney({ notify, canWrite }: OpsProps) {
  const [routes, setRoutes] = useState<OperationalRoute[]>([]), [selected, setSelected] = useState(""), [date, setDate] = useState(localDay()), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const reload = useCallback(async () => { try { const response = await fetch("/api/routes"); const data = await response.json(); if (!response.ok) throw new Error(data.error); setRoutes(data.routes || []); setError(""); } catch (error) { setError(error instanceof Error ? error.message : "Falha ao carregar jornadas."); } finally { setLoading(false); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  const available = routes.filter(route => route.routeDate === date), route = available.find(route => String(route.id) === selected) || available[0];
  return <div className="ops-center"><div className="ops-toolbar"><label>Dia de trabalho<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Rota / motorista<select value={route?.id || ""} onChange={event => setSelected(event.target.value)}><option value="">Selecione uma rota</option>{available.map(route => <option key={route.id} value={route.id}>{route.name} · {route.driverName} · {route.plate}</option>)}</select></label><button className="ops-button" onClick={() => void reload()}>Atualizar</button></div><OpsState loading={loading} error={error} reload={reload} />{route && <RouteOperations key={route.id} route={route} notify={notify} canWrite={canWrite} onReload={reload} />}{!route && !loading && !error && <p className="ops-empty">Nenhuma rota programada para este dia. Monte o roteiro no módulo Logística.</p>}</div>;
}
