import type { D1Database } from "@cloudflare/workers-types";
import { getD1 } from "../db";
import { addDays, normalizeName, overlaps } from "./operations";
import { allOperations } from "./operations-store";
import { baselinePlan, repairPlan, type PlanInput, type PlanResult } from "./route-planner";
import { deepseekConfigured, deepseekJson } from "./deepseek";
import { supabaseAdmin } from "./supabase/admin";
import { syncVhsysBatch } from "./vhsys-sync";

/**
 * Sugestão de rotas do dia: lê os pedidos com entrega na data (e atrasados da última semana)
 * que ainda não estão em rota, pede ao DeepSeek a melhor distribuição e confere o resultado.
 * Fica gravada em `records` (source_key route-suggestion:AAAA-MM-DD) para o quadro de montagem.
 */

export type RouteSuggestion = PlanResult & { date: string; source: "deepseek" | "automatic"; generatedAt: number; generatedBy: string; aiError: string; orderCount: number; sync: string };

const LATE_DAYS = 7;
const dayStart = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
const sourceKey = (date: string) => `route-suggestion:${date}`;

export async function planningInput(db: D1Database, date: string): Promise<PlanInput & { lateIds: number[] }> {
  const start = dayStart(date), end = start + 86400, routeNoon = start + 43200;
  const orders = await db.prepare(`SELECT o.id,o.number,o.delivery_date,c.company_name,COALESCE(c.district,'') AS district,COALESCE(c.city,'') AS city,COALESCE(c.state,'') AS state,COALESCE(c.receiving_window,'') AS receiving_window,
      COALESCE(SUM(CASE WHEN oi.weight_kg>0 THEN oi.weight_kg WHEN oi.package_count>0 AND oi.package_unit_weight_kg>0 THEN oi.package_count*oi.package_unit_weight_kg WHEN LOWER(oi.unit) IN ('kg','quilo','quilos') THEN oi.quantity ELSE 0 END),0) AS weight_kg,
      COALESCE(SUM(oi.volume_m3),0) AS volume_m3,
      COALESCE(SUM(CASE WHEN oi.id IS NOT NULL AND oi.volume_m3<=0 THEN 1 ELSE 0 END),0) AS missing_volume,
      COALESCE(MAX(CASE WHEN COALESCE(p.un_number,'')<>'' OR COALESCE(p.hazard_class,'')<>'' OR COALESCE(p.flammable,0)<>0 OR COALESCE(p.controlled,0)<>0 THEN 1 ELSE 0 END),0) AS hazardous,
      COALESCE(STRING_AGG(CASE WHEN oi.package_count>0 AND COALESCE(oi.package_type,'')<>'' THEN CAST(oi.package_count AS text) || ' ' || oi.package_type || ' ' || oi.product_name ELSE CAST(oi.quantity AS text) || ' ' || oi.unit || ' ' || oi.product_name END, '; ' ORDER BY oi.id),'') AS packages
    FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
    WHERE o.status NOT IN ('cancelled','delivered','completed') AND o.delivery_date>=? AND o.delivery_date<?
      AND NOT EXISTS (SELECT 1 FROM route_stops s JOIN routes r ON r.id=s.route_id WHERE s.order_id=o.id AND (r.status IN ('draft','active') OR (r.status='completed' AND s.status='completed')))
    GROUP BY o.id,o.number,o.delivery_date,c.company_name,c.district,c.city,c.state,c.receiving_window
    ORDER BY o.id`).bind(start - LATE_DAYS * 86400, end).all<Record<string, unknown>>();
  const vehicles = await db.prepare("SELECT id,plate,model,capacity_kg,capacity_m3 FROM vehicles v WHERE status='active' AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.vehicle_id=v.id AND r.route_date>=? AND r.route_date<? AND r.status IN ('draft','active')) ORDER BY id").bind(start, end).all<{ id: number; plate: string; model: string; capacity_kg: number | null; capacity_m3: number | null }>();
  const drivers = await db.prepare("SELECT id,name,license_expiry,mopp_expiry FROM drivers d WHERE status='active' AND (license_expiry IS NULL OR license_expiry>=?) AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.driver_id=d.id AND r.route_date>=? AND r.route_date<? AND r.status IN ('draft','active')) ORDER BY id").bind(routeNoon, start, end).all<{ id: number; name: string; license_expiry: number | null; mopp_expiry: number | null }>();
  // Mesma regra da criação da rota: motorista em férias, afastado ou desligado fica de fora.
  const operations = await allOperations(db);
  const unavailable = (name: string) => {
    const employee = operations.find(row => row.kind === "employee" && /motorista/i.test(row.data.role || "") && (normalizeName(name) === normalizeName(row.title) || normalizeName(name).startsWith(`${normalizeName(row.title)} `)));
    return Boolean(employee && (employee.status !== "active" || operations.some(row => row.kind === "vacation" && row.status === "approved" && row.data.employeeId === String(employee.id) && overlaps(date, date, row.data.start, row.data.end))));
  };
  const lateIds: number[] = [];
  return {
    date,
    lateIds,
    orders: orders.results.map(row => {
      if (Number(row.delivery_date) < start) lateIds.push(Number(row.id));
      return {
        id: Number(row.id), number: String(row.number ?? row.id), customerName: String(row.company_name ?? ""), district: String(row.district), city: String(row.city), state: String(row.state),
        deliveryDate: new Date(Number(row.delivery_date) * 1000).toISOString().slice(0, 10), weightKg: Number(row.weight_kg) || 0, volumeM3: Number(row.volume_m3) || 0,
        missingVolume: Number(row.missing_volume) > 0, hazardous: Number(row.hazardous) > 0, receivingWindow: String(row.receiving_window), packages: String(row.packages).slice(0, 400),
      };
    }),
    vehicles: vehicles.results.map(row => ({ id: Number(row.id), plate: row.plate, model: row.model, capacityKg: row.capacity_kg ? Number(row.capacity_kg) : null, capacityM3: row.capacity_m3 ? Number(row.capacity_m3) : null })),
    drivers: drivers.results.filter(row => !unavailable(row.name)).map(row => ({ id: Number(row.id), name: row.name, hasMopp: Boolean(row.mopp_expiry && Number(row.mopp_expiry) >= routeNoon) })),
  };
}

const SYSTEM_PROMPT = `Você é o planejador de entregas de uma distribuidora de produtos químicos no Rio de Janeiro.
Os caminhões saem do galpão na Rua Isidro Rocha, 48, Vigário Geral, Rio de Janeiro/RJ, e voltam para lá.
Monte as rotas do dia distribuindo os pedidos entre os caminhões e motoristas disponíveis.
Regras obrigatórias:
- Cada pedido em no máximo uma rota; cada caminhão e cada motorista em no máximo uma rota.
- Nunca passe da capacidade de peso (capacityKg) nem de volume (capacityM3) do caminhão; null significa sem limite cadastrado.
- Pedido com hazardous=true só pode ir com motorista hasMopp=true.
- Pedido com missingVolume=true não pode ir em caminhão que tenha capacityM3.
Objetivos: manter bairros e cidades vizinhos na mesma rota, usar o menor número razoável de caminhões, ordenar as paradas
na sequência geográfica mais curta a partir do galpão e respeitar as janelas de recebimento (receivingWindow).
Pedidos marcados late=true estão atrasados e têm prioridade.
Responda somente em JSON, em português, no formato:
{"routes":[{"vehicleId":1,"driverId":1,"orderIds":[3,1,2],"name":"Zona Norte — Penha e Ramos","reason":"por que agrupou e ordenou assim"}],
 "unassigned":[{"orderId":9,"reason":"motivo"}],
 "summary":"resumo curto do plano para o administrador"}`;

export async function generateSuggestion(date: string, generatedBy: string, sync = "", db = getD1()): Promise<RouteSuggestion> {
  const input = await planningInput(db, date);
  let plan: PlanResult, source: RouteSuggestion["source"] = "automatic", aiError = "";
  if (input.orders.length && input.vehicles.length && input.drivers.length && deepseekConfigured()) {
    try {
      // Dados reduzidos: sem CNPJ, valores, contatos ou nomes de motoristas.
      const late = new Set(input.lateIds);
      const payload = {
        date,
        vehicles: input.vehicles.map(({ id, model, capacityKg, capacityM3 }) => ({ id, model, capacityKg, capacityM3 })),
        drivers: input.drivers.map(({ id, hasMopp }) => ({ id, hasMopp })),
        orders: input.orders.map(order => ({ id: order.id, customer: order.customerName, district: order.district, city: order.city, weightKg: Math.round(order.weightKg * 10) / 10, volumeM3: Math.round(order.volumeM3 * 1000) / 1000, missingVolume: order.missingVolume, hazardous: order.hazardous, receivingWindow: order.receivingWindow, packages: order.packages, late: late.has(order.id) })),
      };
      plan = repairPlan(input, await deepseekJson(SYSTEM_PROMPT, JSON.stringify(payload)));
      source = "deepseek";
    } catch (error) {
      aiError = error instanceof Error ? error.message : "Falha ao consultar o DeepSeek.";
      plan = baselinePlan(input);
    }
  } else {
    plan = baselinePlan(input);
    if (!deepseekConfigured()) aiError = "DEEPSEEK_API_KEY não configurada: sugestão feita pelas regras do sistema.";
  }
  if (!input.orders.length) plan.summary = "Nenhum pedido com entrega nesta data aguardando rota.";
  else if (!input.vehicles.length || !input.drivers.length) plan.summary = "Não há caminhão ou motorista livre nesta data.";
  const suggestion: RouteSuggestion = { ...plan, date, source, aiError, generatedAt: Math.floor(Date.now() / 1000), generatedBy, orderCount: input.orders.length, sync };
  const now = suggestion.generatedAt;
  await db.prepare(`INSERT INTO records (source_key,department,module,title,metadata,status,priority,created_at,updated_at) VALUES (?,'operacao','route-suggestion',?,?,'active','medium',?,?)
    ON CONFLICT (source_key) DO UPDATE SET title=EXCLUDED.title,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at`).bind(sourceKey(date), `Sugestão de rotas ${date}`, JSON.stringify(suggestion), now, now).run();
  return suggestion;
}

export async function readSuggestion(date: string, db = getD1()): Promise<RouteSuggestion | null> {
  const row = await db.prepare("SELECT metadata FROM records WHERE source_key=?").bind(sourceKey(date)).first<{ metadata: string }>();
  if (!row) return null;
  try { return JSON.parse(row.metadata) as RouteSuggestion; } catch { return null; }
}

/**
 * Atualiza os pedidos mais recentes do VHSYS antes de sugerir. Percorre do mais novo para o mais antigo
 * e para quando três lotes seguidos não trazem alteração, ou quando o tempo acaba.
 */
export async function syncRecentOrders(budgetMs = 150_000, db = getD1()): Promise<string> {
  const config = await db.prepare("SELECT * FROM erp_integrations WHERE active=1 ORDER BY id DESC LIMIT 1").first<{ id: number; provider: string; base_url: string; api_token: string | null; secret_api_token: string | null }>();
  if (!config) return "Integração com o VHSYS não está ativa.";
  if (config.provider.toLowerCase() !== "vhsys" && !/api\.vhsys\.com/.test(config.base_url)) return "Integração ativa não é VHSYS; sincronização ignorada.";
  const started = Date.now();
  let offset = 0, imported = 0, quiet = 0, batches = 0;
  try {
    while (Date.now() - started < budgetMs && batches < 80) {
      const result = await syncVhsysBatch(supabaseAdmin(), config, { offset });
      batches++; imported += result.imported;
      quiet = result.imported ? 0 : quiet + 1;
      if (result.nextOffset === null || result.nextOffset === undefined || result.nextOffset <= offset || quiet >= 3) break;
      offset = result.nextOffset;
    }
  } catch (error) {
    return `VHSYS: ${imported} pedido(s) atualizados antes da falha (${error instanceof Error ? error.message : "erro"}).`;
  }
  return `VHSYS: ${imported} pedido(s) novos ou alterados.`;
}

/** Próximo dia de entrega a partir de hoje (Brasília). Domingo é pulado. */
export function nextDeliveryDay(today: string) {
  let date = addDays(today, 1);
  if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) date = addDays(date, 1);
  return date;
}
