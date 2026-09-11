import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getD1 } from "../../../../db";
import { getActor } from "../../authz";

type RouteRow = {
  id: number; code: string; name: string; driver_name: string; route_date: number;
  origin_address: string; planned_km: number; estimated_cost_cents: number;
  plate: string; model: string; capacity_kg: number | null;
};
type StopRow = {
  id: number; order_id: number; sequence: number; address_snapshot: string; weight_kg: number;
  package_summary: string; order_number: string; payment_terms: string; customer_name: string;
};
type ItemRow = {
  order_id: number; product_name: string; quantity: number; unit: string; package_count: number;
  package_type: string; package_unit_weight_kg: number; weight_kg: number;
};

const toPdf = (value: string) => value
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, "-")
  .replace(/\u2026/g, "...")
  .replace(/\u00B7/g, " / ")
  .replace(/[^\x00-\xFF]/g, "?");
const date = (epoch: number) => new Date(epoch * 1000).toLocaleDateString("pt-BR");
const number = (value: number, digits = 0) => value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const wrap = (text: string, max = 74) => {
  const words = toPdf(text).split(/\s+/).filter(Boolean), lines: string[] = [];
  let current = "";
  words.forEach(word => {
    if (`${current} ${word}`.trim().length > max && current) {
      lines.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  });
  if (current) lines.push(current);
  return lines.length ? lines : ["-"];
};

export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const routeId = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(routeId) || routeId <= 0) return NextResponse.json({ error: "Rota inválida" }, { status: 400 });
  const db = getD1();
  const route = await db.prepare(`SELECT r.*,v.plate,v.model,v.capacity_kg FROM routes r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=?`).bind(routeId).first<RouteRow>();
  if (!route) return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
  const stops = await db.prepare(`SELECT s.*,o.number AS order_number,o.payment_terms,c.company_name AS customer_name FROM route_stops s JOIN orders o ON o.id=s.order_id JOIN customers c ON c.id=o.customer_id WHERE s.route_id=? ORDER BY s.sequence`).bind(routeId).all<StopRow>();
  const orderIds = stops.results.map(stop => stop.order_id);
  const items = orderIds.length
    ? await db.prepare(`SELECT order_id,product_name,quantity,unit,package_count,package_type,package_unit_weight_kg,weight_kg FROM order_items WHERE order_id IN (${orderIds.map(() => "?").join(",")}) ORDER BY id`).bind(...orderIds).all<ItemRow>()
    : { results: [] as ItemRow[] };
  const itemsByOrder = new Map<number, ItemRow[]>();
  items.results.forEach(item => itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]));

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.13, 0.2), muted = rgb(0.4, 0.46, 0.55), accent = rgb(0.06, 0.29, 0.48), line = rgb(0.87, 0.9, 0.93);
  let page = document.addPage([841.89, 595.28]);
  let y = 0;

  const addHeader = () => {
    page.drawRectangle({ x: 0, y: 525, width: 841.89, height: 70, color: accent });
    page.drawText("QUIMICATIVA", { x: 38, y: 561, size: 16, font: bold, color: rgb(1, 1, 1) });
    page.drawText("ROMANEIO DE CARGA E ENTREGA", { x: 38, y: 540, size: 9, font, color: rgb(0.82, 0.91, 0.97) });
    page.drawText(toPdf(`${route.code}  /  ${date(route.route_date)}`), { x: 650, y: 551, size: 9, font: bold, color: rgb(1, 1, 1) });
    y = 505;
  };
  const ensureSpace = (height: number) => {
    if (y - height >= 38) return;
    page = document.addPage([841.89, 595.28]);
    addHeader();
  };
  const text = (value: string, x: number, size = 8, useBold = false, color = ink) => page.drawText(toPdf(value), { x, y, size, font: useBold ? bold : font, color });

  addHeader();
  text(route.name, 38, 14, true);
  text(`${route.plate} - ${route.model}  /  Motorista: ${route.driver_name || "não definido"}`, 38, 9, false, muted);
  y -= 18;
  text(`Origem e retorno: ${route.origin_address || "não informado"}`, 38, 8, false, muted);
  text(`Km previstos: ${number(route.planned_km, 1)}`, 655, 8, false, muted);
  y -= 22;

  const totalWeight = stops.results.reduce((sum, stop) => sum + Number(stop.weight_kg || 0), 0);
  const occupancy = route.capacity_kg ? totalWeight / route.capacity_kg * 100 : null;
  page.drawRectangle({ x: 38, y: y - 34, width: 765, height: 42, color: rgb(0.95, 0.97, 0.98) });
  text(`Carga total: ${number(totalWeight, 1)} kg`, 52, 10, true);
  text(`Capacidade: ${route.capacity_kg ? `${number(route.capacity_kg, 1)} kg` : "não cadastrada"}`, 275, 9);
  text(`Ocupação: ${occupancy === null ? "-" : `${number(occupancy, 0)}%`}`, 500, 9);
  text(`${stops.results.length} entrega(s)`, 680, 9, true);
  y -= 54;

  for (const stop of stops.results) {
    const orderItems = itemsByOrder.get(stop.order_id) ?? [];
    const itemLines = orderItems.flatMap(item => wrap(`${item.product_name}: ${number(item.quantity, 2)} ${item.unit}${item.package_count && item.package_type ? ` - ${number(item.package_count)} ${item.package_type}${item.package_unit_weight_kg ? ` de ${number(item.package_unit_weight_kg, 1)} kg` : ""}` : ""}${item.weight_kg ? ` - ${number(item.weight_kg, 1)} kg` : ""}`, 91));
    const addressLines = wrap(stop.address_snapshot || "Endereço não cadastrado", 72);
    const blockHeight = 52 + (addressLines.length + itemLines.length) * 10;
    ensureSpace(blockHeight);
    page.drawRectangle({ x: 38, y: y - blockHeight + 8, width: 765, height: blockHeight, borderColor: line, borderWidth: 1 });
    page.drawCircle({ x: 58, y: y - 10, size: 13, color: accent });
    page.drawText(String(stop.sequence), { x: 54.5, y: y - 13.5, size: 9, font: bold, color: rgb(1, 1, 1) });
    text(`${stop.customer_name}  /  Pedido ${stop.order_number}`, 82, 10, true);
    text(`${number(stop.weight_kg, 1)} kg`, 715, 9, true);
    y -= 17;
    addressLines.forEach(value => { text(value, 82, 8, false, muted); y -= 10; });
    text(`Pagamento: ${stop.payment_terms || "não informado"}`, 82, 8, true, muted);
    y -= 13;
    (itemLines.length ? itemLines : [stop.package_summary || "Itens não informados"]).forEach(value => { text(value, 82, 8); y -= 10; });
    y -= 18;
  }

  ensureSpace(74);
  y -= 5;
  text("CONFERÊNCIA", 38, 9, true);
  y -= 18;
  page.drawLine({ start: { x: 38, y }, end: { x: 260, y }, thickness: 0.7, color: muted });
  page.drawLine({ start: { x: 310, y }, end: { x: 532, y }, thickness: 0.7, color: muted });
  page.drawLine({ start: { x: 582, y }, end: { x: 803, y }, thickness: 0.7, color: muted });
  y -= 13;
  text("Separação da carga", 38, 7, false, muted);
  text("Motorista", 310, 7, false, muted);
  text("Responsável pela expedição", 582, 7, false, muted);

  document.setTitle(toPdf(`Romaneio ${route.code}`));
  document.setAuthor("QUIMICATIVA");
  const bytes = await document.save();
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="romaneio-${route.code.replace(/[^a-zA-Z0-9-]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
