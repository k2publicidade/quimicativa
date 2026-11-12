import { NextRequest, NextResponse } from "next/server";
import { canValidate, canWrite, getActor } from "../../authz";
import { validDate } from "../../../../lib/operations";
import { deepseekConfigured } from "../../../../lib/deepseek";
import { generateSuggestion, readSuggestion, syncRecentOrders } from "../../../../lib/route-suggestion";

export const maxDuration = 300;

/** Sugestão de rotas gravada para a data (gerada às 10h ou manualmente). */
export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date");
  try { validDate(date); } catch { return NextResponse.json({ error: "Data inválida" }, { status: 400 }); }
  return NextResponse.json({ suggestion: await readSuggestion(String(date)), aiConfigured: deepseekConfigured() });
}

/** Gera agora a sugestão para a data. Com `sync: true`, gestores atualizam antes os pedidos do VHSYS. */
export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  let date: string;
  try { date = validDate(body.date, "Data"); } catch { return NextResponse.json({ error: "Data inválida" }, { status: 400 }); }
  const sync = body.sync === true ? canValidate(actor) ? await syncRecentOrders(120_000) : "Sincronização do VHSYS exige perfil de gestor." : "";
  const suggestion = await generateSuggestion(date, actor.displayName, sync);
  return NextResponse.json({ suggestion, aiConfigured: deepseekConfigured() });
}
