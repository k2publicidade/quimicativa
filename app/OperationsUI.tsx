"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { OpsRecord } from "../lib/operations";

export type OpsProps = { notify: (message: string) => void; canWrite: boolean };
export type FormField = { key: string; label: string; type?: "text" | "date" | "number" | "month" | "select" | "textarea" | "datetime-local"; options?: { value: string; label: string }[]; required?: boolean; min?: number; max?: number; hint?: string };
export const options = (items: readonly string[]) => items.map(value => ({ value, label: value }));
export const yesNo = [{ value: "no", label: "Não" }, { value: "yes", label: "Sim" }];
export const displayDate = (iso: string) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "Não informado";
export const displayTime = (epoch?: number | null) => epoch ? new Date(epoch * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Não registrado";
export async function opsRequest(payload: Record<string, unknown>) {
  const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível salvar."); return result;
}
export function useOperations(scope: "rh" | "operations" = "operations") {
  const [records, setRecords] = useState<OpsRecord[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { const response = await fetch(`/api/operations?scope=${scope}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setRecords(data.records || []); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Falha ao carregar informações."); }
    finally { setLoading(false); }
  }, [scope]);
  useEffect(() => { void reload(); }, [reload]);
  return { records, reload, loading, error };
}
export function OpsForm({ title, fields, initial = {}, onSave, onCancel, submitLabel = "Salvar", children, disabled = false }: { title: string; fields: FormField[]; initial?: Record<string, string>; onSave: (values: Record<string, string>) => Promise<void>; onCancel?: () => void; submitLabel?: string; children?: ReactNode; disabled?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <form className="ops-form" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await onSave(values); } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setBusy(false); } }}>
    <h3>{title}</h3><fieldset disabled={busy || disabled}><div className="ops-fields">{fields.map(field => <label key={field.key} className={field.type === "textarea" ? "ops-wide" : ""}>{field.label}
      {field.type === "select" ? <select required={field.required !== false} value={values[field.key] || ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })}><option value="">Selecione</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : field.type === "textarea" ? <textarea required={field.required !== false} maxLength={2000} rows={3} value={values[field.key] || ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />
        : <input type={field.type || "text"} required={field.required !== false} maxLength={field.type === "text" || !field.type ? 150 : undefined} min={field.type === "number" ? field.min ?? 0 : undefined} max={field.max} step={field.type === "number" || field.type === "datetime-local" ? 1 : undefined} value={values[field.key] ?? ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />}
      {field.hint && <small>{field.hint}</small>}</label>)}</div>{children}<div className="ops-actions"><button className="primary-button" type="submit">{busy ? "Salvando…" : submitLabel}</button>{onCancel && <button className="ops-button" type="button" onClick={onCancel}>Cancelar</button>}</div></fieldset>{error && <p className="ops-error" role="alert">{error}</p>}
  </form>;
}
export function OpsState({ loading, error, reload }: { loading: boolean; error: string; reload: () => Promise<void> }) {
  if (error) return <div className="ops-error" role="alert">{error} <button type="button" onClick={() => void reload()}>Tentar novamente</button></div>;
  if (loading) return <p className="ops-empty" role="status">Carregando informações…</p>; return null;
}
export function OpsBadge({ children, warning = false }: { children: ReactNode; warning?: boolean }) { return <span className={`ops-badge${warning ? " warn" : ""}`}>{children}</span>; }
export function OpsTable({ headings, children }: { headings: string[]; children: ReactNode }) { return <div className="ops-table-wrap"><table className="ops-table"><thead><tr>{headings.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
