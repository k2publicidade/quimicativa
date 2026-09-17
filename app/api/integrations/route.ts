import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";
import { externalErpUrl } from "./url-safety";
import { supabaseAdmin } from "../../../lib/supabase/admin";

type Integration = { id: number; provider: string; base_url: string; orders_path: string; customers_path: string; active: number; last_sync_at: number | null; last_sync_status: string | null; last_sync_message: string | null; created_at: number; updated_at: number };
const safe = (row: Integration | null) => row ? { id: row.id, provider: row.provider, baseUrl: row.base_url, ordersPath: row.orders_path, customersPath: row.customers_path || "/clientes", active: Boolean(row.active), lastSyncAt: row.last_sync_at, lastSyncStatus: row.last_sync_status, lastSyncMessage: row.last_sync_message, updatedAt: row.updated_at } : null;
const timestamp = () => Math.floor(Date.now() / 1000);

export async function GET() {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const row = await getD1().prepare("SELECT * FROM erp_integrations ORDER BY id DESC LIMIT 1").first<Integration>();
  return NextResponse.json({ integration: safe(row ?? null) });
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
    if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
    const body = await request.json() as Record<string, unknown>, db = getD1();
    const { baseUrl, ordersPath } = externalErpUrl(String(body.baseUrl || "").trim(), String(body.ordersPath || "/orders").trim());
    const { ordersPath: customersPath } = externalErpUrl(baseUrl, String(body.customersPath || "/clientes").trim());
    const now = timestamp(), supabase = supabaseAdmin(), { data: current, error: currentError } = await supabase.from("erp_integrations").select("id,api_token,secret_api_token").order("id", { ascending: false }).limit(1).maybeSingle();
    if (currentError) throw new Error(currentError.message);
    const token = body.apiToken === undefined ? current?.api_token ?? null : String(body.apiToken || "").trim() || null;
    const secret = body.secretApiToken === undefined ? current?.secret_api_token ?? null : String(body.secretApiToken || "").trim() || null;
    const values = { provider: String(body.provider || "REST"), base_url: baseUrl, orders_path: ordersPath, customers_path: customersPath, api_token: token, secret_api_token: secret, active: body.active ? 1 : 0, updated_at: now };
    const result = current ? await supabase.from("erp_integrations").update(values).eq("id", current.id).select("*").single() : await supabase.from("erp_integrations").insert({ ...values, created_by: actor.userId, created_at: now }).select("*").single();
    if (result.error) throw new Error(result.error.message);
    const row = result.data as Integration;
    return NextResponse.json({ integration: safe(row ?? null) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar a integração." }, { status: 400 });
  }
}
