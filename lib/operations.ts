export const TEAM = [
  { name: "Eucimar", nickname: "Loirinho", role: "Motorista", department: "Logística" },
  { name: "Antonio", nickname: "Tonhão", role: "Motorista", department: "Logística" },
  ...["Mateus", "Alex", "Lidinelson", "Jair"].map(name => ({ name, nickname: name === "Lidinelson" ? "Nilsinho" : "", role: "Ajudante", department: "Logística" })),
  ...["Henrique", "Ezequiel", "Marcelo"].map(name => ({ name, nickname: "", role: "Galpão", department: "Galpão" })),
  { name: "Vera", nickname: "", role: "Secretaria", department: "Secretaria" },
  { name: "Francisco", nickname: "", role: "Compras / Gerente geral", department: "Compras / Gerência Geral" },
  { name: "Severino", nickname: "Civi", role: "Administrativo", department: "Administrativo" },
  { name: "Luiz Fernando", nickname: "", role: "Operacional", department: "Operacional" },
  ...["Marcia", "Claudia", "Elvira", "Sabrina"].map(name => ({ name, nickname: "", role: "Vendedora", department: "Vendas" })),
];
export const STOCK_TYPES = ["Bombona", "Tampa", "Lacre", "Contêiner IBC 1000L", "Bomba", "Mangote", "Abraçadeira", "Engate rápido", "Carrinho de mão"] as const;
export const PPE_TYPES = ["Luvas", "Óculos", "Capacete", "Avental", "Capa de chuva", "Bota", "Calça", "Blusa", "Camisa"] as const;
export const MAINTENANCE_TYPES = ["Óleo e filtros", "Limpeza geral", "Revisão geral"] as const;
export type OpsKind = "employee" | "vacation" | "basket" | "ppe" | "ppeReview" | "stock" | "movement" | "preparation" | "crew" | "report" | "collection";
export type OpsRecord = { id: number; kind: OpsKind; title: string; status: string; data: Record<string, string>; version: string; updatedAt: number };
export class InputError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function textValue(value: unknown, label: string, required = true, max = 2000): string {
  if (value != null && typeof value !== "string") throw new InputError(`${label}: informe um texto válido.`);
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > max) throw new InputError(`${label}: preencha até ${max} caracteres.`);
  return result;
}
export function count(value: unknown, label: string, max = 1_000_000): number {
  if (value === "" || value == null || typeof value === "boolean") throw new InputError(`${label}: informe uma quantidade.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > max) throw new InputError(`${label}: use um número inteiro entre 0 e ${max}.`);
  return result;
}
export function positiveId(value: unknown): number {
  const result = count(value, "Identificador", Number.MAX_SAFE_INTEGER);
  if (!result) throw new InputError("Selecione um registro válido.");
  return result;
}
export function validDate(value: unknown, label = "Data"): string {
  const result = textValue(value, label, true, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T12:00:00Z`)) || new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result) throw new InputError(`${label} inválida.`);
  return result;
}
export function localDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDays(iso: string, days: number): string {
  const date = new Date(`${validDate(iso)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
export function addMonths(iso: string, months: number): string {
  const date = new Date(`${validDate(iso)}T12:00:00Z`), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, last)); return date.toISOString().slice(0, 10);
}
export function maintenanceDue(type: string, serviceDate: string, km: number) {
  validDate(serviceDate); count(km, "Quilometragem", 9_999_999);
  return { km: type === "Óleo e filtros" ? km + 5000 : null, date: type === "Limpeza geral" ? addDays(serviceDate, 14) : type === "Revisão geral" ? addMonths(serviceDate, 3) : "" };
}
export function normalizeName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
export function overlaps(start: string, end: string, otherStart: string, otherEnd: string) { return start <= otherEnd && end >= otherStart; }
export function bombonaDebt(records: OpsRecord[]) {
  const balances = new Map<string, { reportId: number; customerId: number; customerName: string; orderNumber: string; sent: number; returned: number; collected: number; balance: number }>();
  for (const row of records.filter(row => row.kind === "report")) {
    const sent = Number(row.data.bombonasSent || 0), returned = Number(row.data.bombonasReturned || 0), owed = Math.max(0, sent - returned);
    balances.set(String(row.id), { reportId: row.id, customerId: Number(row.data.customerId), customerName: row.data.customerName, orderNumber: row.data.orderNumber, sent, returned, collected: 0, balance: owed });
  }
  for (const row of records.filter(row => row.kind === "collection")) { const debt = balances.get(row.data.reportId); if (debt) { debt.collected += Number(row.data.quantity); debt.balance = Math.max(0, debt.sent - debt.returned - debt.collected); } }
  return [...balances.values()].filter(row => row.balance > 0);
}
export function validatePreparation(input: Record<string, unknown>): Record<string, string> {
  const data: Record<string, string> = { orderId: String(positiveId(input.orderId)), date: validDate(input.date, "Data de entrega"), notes: textValue(input.notes, "Observações", false), status: textValue(input.status, "Separação") };
  if (!["pending", "ready"].includes(data.status)) throw new InputError("Situação de separação inválida.");
  for (const key of ["bombonas", "tampas", "lacres", "ibcs", "pumpQty", "clamps", "couplings", "carts"]) data[key] = String(count(input[key] ?? 0, key));
  for (const key of ["needsPump", "needsHose"]) { data[key] = textValue(input[key], key); if (!["yes", "no"].includes(data[key])) throw new InputError("Informe explicitamente se precisa de bomba e de mangote."); }
  data.pumpType = textValue(input.pumpType, "Tipo de bomba", data.needsPump === "yes", 150);
  data.hoseSize = textValue(input.hoseSize, "Comprimento e diâmetro do mangote", data.needsHose === "yes", 150);
  if (data.needsPump === "yes" && Number(data.pumpQty) < 1) throw new InputError("Informe a quantidade de bombas.");
  if (data.needsPump === "no") { data.pumpQty = "0"; data.pumpType = ""; }
  if (data.needsHose === "no") data.hoseSize = "";
  return data;
}
export function validateVacation(data: Record<string, unknown>) {
  const start = validDate(data.start, "Início das férias"), end = validDate(data.end, "Fim das férias");
  if (end < start) throw new InputError("O fim das férias deve ser igual ou posterior ao início.");
  if (!["planned", "approved", "completed", "cancelled"].includes(String(data.status))) throw new InputError("Situação das férias inválida.");
  return { employeeId: String(positiveId(data.employeeId)), start, end, status: String(data.status), notes: textValue(data.notes, "Observações", false) };
}
