import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";
import { externalErpUrl } from "./url-safety";

type Integration = { id: number; provider: string; base_url: string; orders_path: string; customers_path: string; active: number; last_sync_at: number | null; last_sync_status: string | null; last_sync_message: string | null; created_at: number; updated_at: number };
const safe = (row: Integration | null) => row ? { id: row.id, provider: row.provider, baseUrl: row.base_url, ordersPath: row.orders_path, customersPath: row.customers_path || "/clientes", active: Boolean(row.active), lastSyncAt: row.last_sync_at, lastSyncStatus: row.last_sync_status, lastSyncMessage: row.last_sync_message, updatedAt: row.updated_at } : null;
const timestamp = () => Math.floor(Date.now() / 1000);

export async function GET() {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const row = await getD1().prepare("SELECT * FROM erp_integrations ORDER BY id DESC LIMIT 1").first<Integration>();
  return NextResponse.json({ integration: safe(row ?? null) });
}

export async function PUT(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>, db = getD1();
  let baseUrl: string, ordersPath: string, customersPath: string;
  try {
    ({ baseUrl, ordersPath } = externalErpUrl(String(body.baseUrl || "").trim(), String(body.ordersPath || "/orders").trim()));
    ({ ordersPath: customersPath } = externalErpUrl(baseUrl, String(body.customersPath || "/clientes").trim()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Endpoint do ERP inválido." }, { status: 400 });
  }
  const now = timestamp(), current = await db.prepare("SELECT id,api_token,secret_api_token FROM erp_integrations ORDER BY id DESC LIMIT 1").first<{ id: number; api_token: string | null; secret_api_token: string | null }>(), token = body.apiToken === undefined ? current?.api_token ?? null : String(body.apiToken || "").trim() || null, secret = body.secretApiToken === undefined ? current?.secret_api_token ?? null : String(body.secretApiToken || "").trim() || null;
  const row = current ? await db.prepare("UPDATE erp_integrations SET provider=?,base_url=?,orders_path=?,customers_path=?,api_token=?,secret_api_token=?,active=?,updated_at=? WHERE id=? RETURNING *").bind(String(body.provider || "REST"), baseUrl, ordersPath, customersPath, token, secret, body.active ? 1 : 0, now, current.id).first<Integration>() : await db.prepare("INSERT INTO erp_integrations (provider,base_url,orders_path,customers_path,api_token,secret_api_token,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *").bind(String(body.provider || "REST"), baseUrl, ordersPath, customersPath, token, secret, body.active ? 1 : 0, actor.userId, now, now).first<Integration>();
  return NextResponse.json({ integration: safe(row ?? null) });
}
