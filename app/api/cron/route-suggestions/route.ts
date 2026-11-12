import { NextRequest, NextResponse } from "next/server";
import { localDay } from "../../../../lib/operations";
import { generateSuggestion, nextDeliveryDay, syncRecentOrders } from "../../../../lib/route-suggestion";

export const maxDuration = 300;

/**
 * Rotina diária (vercel.json → 13:00 UTC = 10h em Brasília): atualiza os pedidos do VHSYS
 * e grava a sugestão de rotas do próximo dia de entrega. Protegida pelo CRON_SECRET da Vercel.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date") || nextDeliveryDay(localDay());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Data inválida" }, { status: 400 });
  const sync = await syncRecentOrders(150_000);
  const suggestion = await generateSuggestion(date, "Rotina automática das 10h", sync);
  return NextResponse.json({ date, sync, source: suggestion.source, routes: suggestion.routes.length, orders: suggestion.orderCount, unassigned: suggestion.unassigned.length, aiError: suggestion.aiError });
}
