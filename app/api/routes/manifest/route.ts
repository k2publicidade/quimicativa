import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getD1 } from "../../../../db";
import { getActor } from "../../authz";
import { allOperations } from "../../../../lib/operations-store";
import type { D1Database } from "@cloudflare/workers-types";
import type { PDFFont } from "pdf-lib";

type RouteRow = {
  id: number; code: string; name: string; vehicle_id: number; driver_id: number | null; driver_name: string; route_date: number;
  origin_address: string; planned_km: number; estimated_cost_cents: number;
  plate: string; model: string; capacity_kg: number | null; capacity_m3: number | null;
};
type StopRow = {
  id: number; order_id: number; sequence: number; address_snapshot: string; weight_kg: number;
  package_summary: string; receiving_window: string; order_number: string; payment_terms: string; customer_name: string;
};
type ItemRow = {
  order_id: number; product_name: string; quantity: number; unit: string; package_count: number;
  package_type: string; package_unit_weight_kg: number; weight_kg: number; volume_m3: number; un_number: string;
  hazard_class: string; flammable: number; controlled: number;
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

const EQUIPMENT = [["bombonas", "Bombonas"], ["tampas", "Tampas"], ["lacres", "Lacres"], ["ibcs", "IBCs 1000L"], ["clamps", "Abraçadeiras"], ["couplings", "Engates rápidos"], ["carts", "Carrinhos"]] as const;
const ink = rgb(0.09, 0.13, 0.2), muted = rgb(0.4, 0.46, 0.55), accent = rgb(0.06, 0.29, 0.48), line = rgb(0.87, 0.9, 0.93);
type Context = { document: PDFDocument; font: PDFFont; bold: PDFFont; db: D1Database; operations: Awaited<ReturnType<typeof allOperations>> };

async function renderRoute({ document, font, bold, db, operations }: Context, routeId: number) {
  const route = await db.prepare(`SELECT r.*,v.plate,v.model,v.capacity_kg,v.capacity_m3 FROM routes r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=?`).bind(routeId).first<RouteRow>();
  if (!route) return null;
  const stops = await db.prepare(`SELECT s.*,o.number AS order_number,o.payment_terms,c.company_name AS customer_name FROM route_stops s JOIN orders o ON o.id=s.order_id JOIN customers c ON c.id=o.customer_id WHERE s.route_id=? ORDER BY s.sequence`).bind(routeId).all<StopRow>();
  const orderIds = stops.results.map(stop => stop.order_id);
  const items = orderIds.length
    ? await db.prepare(`SELECT oi.order_id,oi.product_name,oi.quantity,oi.unit,oi.package_count,oi.package_type,oi.package_unit_weight_kg,oi.weight_kg,oi.volume_m3,COALESCE(p.un_number,'') AS un_number,COALESCE(p.hazard_class,'') AS hazard_class,COALESCE(p.flammable,0) AS flammable,COALESCE(p.controlled,0) AS controlled FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id IN (${orderIds.map(() => "?").join(",")}) ORDER BY oi.id`).bind(...orderIds).all<ItemRow>()
    : { results: [] as ItemRow[] };
  const itemsByOrder = new Map<number, ItemRow[]>();
  items.results.forEach(item => itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]));
  const hazardousLoad = items.results.some(item => item.un_number || item.hazard_class || item.flammable || item.controlled);
  const driver = hazardousLoad && route.driver_id ? await db.prepare("SELECT mopp_expiry FROM drivers WHERE id=?").bind(route.driver_id).first<{ mopp_expiry: number | null }>() : null;
  const hasValidMopp = Boolean(driver?.mopp_expiry && driver.mopp_expiry >= route.route_date);
  const crew = operations.find(row => row.kind === "crew" && row.data.routeId === String(routeId));
  const events = await db.prepare("SELECT event_type,occurred_at,odometer_km FROM route_events WHERE route_id=? AND event_type IN ('departure','return','route_changed') ORDER BY occurred_at,id").bind(routeId).all<{ event_type: string; occurred_at: number; odometer_km: number | null }>();
  const departure = events.results.find(row => row.event_type === "departure"), returned = events.results.find(row => row.event_type === "return");

  let page = document.addPage([841.89, 595.28]);
  const firstPage = page;
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
  y -= 17;
  text(`${route.plate} - ${route.model}  /  Motorista: ${route.driver_name || "não definido"}`, 38, 9, false, muted);
  y -= 18;
  text(`Origem e retorno: ${route.origin_address || "não informado"}`, 38, 8, false, muted);
  text(`Km previstos: ${number(route.planned_km, 1)}`, 655, 8, false, muted);
  y -= 15;
  wrap(`Ajudantes: ${crew ? crew.data.helpers || "Saída sem ajudantes" : "Equipe não confirmada"}`, 110).forEach(value => { text(value, 38, 8, true); y -= 11; });
  const journeyStamp = (event: typeof departure) => event ? `${new Date(event.occurred_at * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} / ${event.odometer_km == null ? "km não registrado" : `${number(event.odometer_km)} km`}` : "a registrar";
  text(`Saída: ${journeyStamp(departure)} | Retorno: ${journeyStamp(returned)}`, 38, 8);
  y -= 14;
  text(`Alteração da rota: ${events.results.some(event => event.event_type === "route_changed") ? "SIM - consultar histórico no sistema" : "não registrada"}`, 38, 8, true);
  y -= 22;

  const totalWeight = stops.results.reduce((sum, stop) => sum + Number(stop.weight_kg || 0), 0);
  const totalVolumeM3 = items.results.reduce((sum, item) => sum + Number(item.volume_m3 || 0), 0);
  const volumeDataComplete = items.results.length > 0 && items.results.every(item => Number(item.volume_m3) > 0);
  const occupancy = route.capacity_kg ? totalWeight / route.capacity_kg * 100 : null;
  page.drawRectangle({ x: 38, y: y - 46, width: 765, height: 54, color: rgb(0.95, 0.97, 0.98) });
  text(`Carga total: ${number(totalWeight, 1)} kg`, 52, 10, true);
  text(`Capacidade: ${route.capacity_kg ? `${number(route.capacity_kg, 1)} kg` : "não cadastrada"}`, 275, 9);
  text(`Ocupação por peso: ${occupancy === null ? "-" : `${number(occupancy, 0)}%`}`, 500, 9);
  text(`${stops.results.length} entrega(s)`, 680, 9, true);
  y -= 14;
  text(volumeDataComplete ? `Cubagem: ${number(totalVolumeM3, 3)} m³${route.capacity_m3 ? ` de ${number(route.capacity_m3, 3)} m³ (${number(totalVolumeM3 / route.capacity_m3 * 100, 0)}%)` : ""}` : "Cubagem: dados incompletos — conferir volumes antes do carregamento", 52, 8, true, volumeDataComplete ? muted : rgb(0.66, 0.29, 0.08));
  y -= 52;

  // Lista de carregamento: o que o galpão precisa separar e colocar no caminhão.
  const preparations = stops.results.map(stop => operations.find(row => row.kind === "preparation" && row.data.orderId === String(stop.order_id))).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const equipment = EQUIPMENT.map(([key, label]) => ({ label, count: preparations.reduce((sum, row) => sum + Number(row.data[key] || 0), 0) })).filter(item => item.count > 0);
  const pumps = preparations.filter(row => row.data.needsPump === "yes").map(row => `${row.data.pumpQty || 1}x ${row.data.pumpType || "bomba"}`);
  const hoses = preparations.filter(row => row.data.needsHose === "yes").map(row => row.data.hoseSize || "mangote");
  const products = new Map<string, { name: string; quantity: number; unit: string; packages: Map<string, number> }>();
  items.results.forEach(item => {
    const key = `${item.product_name.toLowerCase()}|${item.unit}`;
    const entry = products.get(key) ?? { name: item.product_name, quantity: 0, unit: item.unit, packages: new Map<string, number>() };
    entry.quantity += Number(item.quantity || 0);
    if (item.package_count && item.package_type) {
      const pkg = `${item.package_type}${item.package_unit_weight_kg ? ` ${number(item.package_unit_weight_kg, 1)} kg` : ""}`;
      entry.packages.set(pkg, (entry.packages.get(pkg) ?? 0) + Number(item.package_count));
    }
    products.set(key, entry);
  });
  const productRows = [...products.values()].sort((x, z) => x.name.localeCompare(z.name, "pt-BR"));
  const readyCount = preparations.filter(row => row.status === "ready").length;
  ensureSpace(40 + productRows.length * 12);
  text("LISTA DE CARREGAMENTO - conferir cada item ao carregar o caminhão", 38, 9, true, accent);
  text(`Separação no galpão: ${readyCount}/${stops.results.length} pedido(s) separados`, 560, 8, true, readyCount === stops.results.length ? muted : rgb(0.66, 0.29, 0.08));
  y -= 15;
  for (const product of productRows) {
    ensureSpace(14);
    page.drawRectangle({ x: 40, y: y - 2, width: 8, height: 8, borderColor: ink, borderWidth: 0.8 });
    text(product.name, 56, 8.5, true);
    text(`${number(product.quantity, 2)} ${product.unit}`, 400, 8.5);
    text([...product.packages.entries()].map(([pkg, total]) => `${number(total)} x ${pkg}`).join(" + ") || "-", 520, 8.5, true);
    y -= 12;
  }
  if (!productRows.length) { text("Itens dos pedidos não informados.", 56, 8, false, muted); y -= 12; }
  const equipmentText = [...equipment.map(item => `${item.label}: ${item.count}`), ...(pumps.length ? [`Bombas: ${pumps.join(", ")}`] : []), ...(hoses.length ? [`Mangotes: ${hoses.join(", ")}`] : [])].join("  |  ");
  y -= 4;
  for (const value of wrap(`EMBALAGENS E EQUIPAMENTOS: ${equipmentText || (preparations.length ? "nenhum item informado" : "preparação do galpão ainda não cadastrada")}`, 120)) { ensureSpace(14); text(value, 38, 8.5, true); y -= 12; }
  y -= 14;

  if (hazardousLoad) {
    page.drawRectangle({ x: 38, y: y - 32, width: 765, height: 40, color: rgb(1, 0.97, 0.9), borderColor: rgb(0.9, 0.72, 0.35), borderWidth: 1 });
    text("CARGA COM PRODUTO PERIGOSO", 52, 9, true, rgb(0.47, 0.31, 0.06));
    y -= 14;
    text(`Conferir documentação, sinalização, segregação e ficha de emergência. MOPP do motorista: ${hasValidMopp ? "comprovante localizado" : "confirmar antes da saída"}.`, 52, 8, false, rgb(0.47, 0.31, 0.06));
    y -= 38;
  }

  for (const stop of stops.results) {
    const orderItems = itemsByOrder.get(stop.order_id) ?? [];
    const itemLines = orderItems.flatMap(item => wrap(`${item.product_name}: ${number(item.quantity, 2)} ${item.unit}${item.package_count && item.package_type ? ` - ${number(item.package_count)} ${item.package_type}${item.package_unit_weight_kg ? ` de ${number(item.package_unit_weight_kg, 1)} kg` : ""}` : ""}${item.weight_kg ? ` - ${number(item.weight_kg, 1)} kg` : ""}${item.volume_m3 ? ` - ${number(item.volume_m3, 3)} m³` : " - cubagem não informada"}${item.un_number ? ` - ONU ${item.un_number}` : ""}${item.hazard_class ? ` - classe ${item.hazard_class}` : ""}`, 91));
    const addressLines = wrap(stop.address_snapshot || "Endereço não cadastrado", 72);
    const blockHeight = 62 + (addressLines.length + itemLines.length) * 10;
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
    text(`Recebimento: ${stop.receiving_window || "sem restrição informada"}`, 82, 8, true, muted);
    y -= 13;
    (itemLines.length ? itemLines : [stop.package_summary || "Itens não informados"]).forEach(value => { text(value, 82, 8); y -= 10; });
    y -= 18;
    const preparation = operations.find(row => row.kind === "preparation" && row.data.orderId === String(stop.order_id));
    const report = operations.find(row => row.kind === "report" && row.data.stopId === String(stop.id));
    const operationalLines = preparation ? wrap(`GALPÃO: ${preparation.data.bombonas} bombonas; ${preparation.data.tampas} tampas; ${preparation.data.lacres} lacres; ${preparation.data.ibcs} IBCs 1000L; Bomba: ${preparation.data.needsPump === "yes" ? `${preparation.data.pumpQty} x ${preparation.data.pumpType}` : "não precisa"}; Mangote: ${preparation.data.needsHose === "yes" ? preparation.data.hoseSize : "não precisa"}; ${preparation.data.clamps} abraçadeiras; ${preparation.data.couplings} engates; ${preparation.data.carts} carrinhos. ${preparation.data.notes || ""}`, 110) : ["GALPÃO: requisitos de preparação não informados."];
    if (report) operationalLines.push(...wrap(`RETORNO: ${report.data.returnDescription}. Observações: ${report.data.deliveryNotes || "sem observações"}. Bombonas: ${report.data.bombonasReturned}/${report.data.bombonasSent} retornaram. Canhoto: ${report.data.signed === "yes" ? `assinado por ${report.data.receiver}` : `pendente - ${report.data.unsignedReason}`}.`, 110));
    else operationalLines.push("RETORNO: ______________________________________________________________________________________");
    operationalLines.push("Recebedor / assinatura: ____________________________  Bombonas devolvidas: ______  Pendentes: ______");
    for (const value of operationalLines) { ensureSpace(24); text(value, 42, 8, false, muted); y -= 12; } y -= 16;
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

  return {
    firstPage, code: route.code, name: route.name, plate: route.plate, driver: route.driver_name, stops: stops.results.length, weight: totalWeight,
    bombonas: stops.results.reduce((sum, stop) => {
      const prepared = preparations.find(row => row.data.orderId === String(stop.order_id));
      return sum + (prepared ? Number(prepared.data.bombonas || 0) : (itemsByOrder.get(stop.order_id) ?? []).filter(item => /bombona/i.test(item.package_type || item.unit)).reduce((total, item) => total + Number(item.package_count || item.quantity || 0), 0));
    }, 0), ready: readyCount,
  };
}

export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const params = request.nextUrl.searchParams, db = getD1();
  const day = params.get("date"), single = Number(params.get("id"));
  let routeIds: number[] = [];
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) return NextResponse.json({ error: "Data inválida" }, { status: 400 });
    const start = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
    const rows = await db.prepare("SELECT id FROM routes WHERE route_date>=? AND route_date<? AND status<>'cancelled' ORDER BY id").bind(start, start + 86400).all<{ id: number }>();
    routeIds = rows.results.map(row => Number(row.id));
    if (!routeIds.length) return NextResponse.json({ error: "Nenhuma rota programada para esta data." }, { status: 404 });
  } else if (params.get("ids")) {
    routeIds = [...new Set(String(params.get("ids")).split(",").map(Number))];
    if (!routeIds.length || routeIds.length > 50 || routeIds.some(value => !Number.isInteger(value) || value <= 0)) return NextResponse.json({ error: "Rotas inválidas" }, { status: 400 });
  } else {
    if (!Number.isInteger(single) || single <= 0) return NextResponse.json({ error: "Rota inválida" }, { status: 400 });
    routeIds = [single];
  }
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const context: Context = { document, font, bold, db, operations: await allOperations(db) };
  const summaries: NonNullable<Awaited<ReturnType<typeof renderRoute>>>[] = [];
  for (const routeId of routeIds) {
    const summary = await renderRoute(context, routeId);
    if (summary) summaries.push(summary);
  }
  if (!summaries.length) return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
  if (summaries.length > 1 || day) drawCover(context, summaries, day);
  const title = summaries.length === 1 && !day ? `Romaneio ${summaries[0].code}` : `Expedição ${day ?? summaries.map(item => item.code).join(", ")}`;
  document.setTitle(toPdf(title));
  document.setAuthor("QUIMICATIVA");
  const bytes = await document.save();
  const filename = summaries.length === 1 && !day ? `romaneio-${summaries[0].code}` : `expedicao-${day ?? "rotas"}`;
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^a-zA-Z0-9-]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** Capa da expedição: uma linha por rota, para o líder do galpão distribuir aos motoristas. */
function drawCover({ document, font, bold }: Context, summaries: { code: string; name: string; plate: string; driver: string; stops: number; weight: number; bombonas: number; ready: number }[], day: string | null) {
  const page = document.insertPage(0, [841.89, 595.28]);
  const text = (value: string, x: number, y: number, size = 9, useBold = false, color = ink) => page.drawText(toPdf(value), { x, y, size, font: useBold ? bold : font, color });
  page.drawRectangle({ x: 0, y: 525, width: 841.89, height: 70, color: accent });
  text("QUIMICATIVA", 38, 561, 16, true, rgb(1, 1, 1));
  text("EXPEDIÇÃO DO DIA - DISTRIBUIÇÃO DAS ROTAS", 38, 540, 9, false, rgb(0.82, 0.91, 0.97));
  text(day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "Rotas selecionadas", 520, 551, 10, true, rgb(1, 1, 1));
  let y = 495;
  text(`${summaries.length} rota(s)  /  ${summaries.reduce((sum, item) => sum + item.stops, 0)} entrega(s)  /  ${number(summaries.reduce((sum, item) => sum + item.weight, 0), 1)} kg  /  ${summaries.reduce((sum, item) => sum + item.bombonas, 0)} bombona(s)`, 38, y, 11, true);
  y -= 30;
  const columns: [string, number][] = [["Rota", 38], ["Caminhão", 250], ["Motorista", 340], ["Entregas", 480], ["Peso", 540], ["Bombonas", 610], ["Separação", 680], ["Entregue a", 750]];
  columns.forEach(([label, x]) => text(label.toUpperCase(), x, y, 7, true, muted));
  y -= 8;
  page.drawLine({ start: { x: 38, y }, end: { x: 803, y }, thickness: 0.7, color: line });
  for (const item of summaries) {
    if (y < 70) break;
    y -= 20;
    text(item.name.slice(0, 48), 38, y, 8.5, true);
    text(item.code, 38, y - 10, 7, false, muted);
    text(item.plate, 250, y, 9);
    text((item.driver || "-").slice(0, 26), 340, y, 9, true);
    text(String(item.stops), 480, y, 9);
    text(`${number(item.weight, 0)} kg`, 540, y, 9);
    text(String(item.bombonas), 610, y, 9);
    text(`${item.ready}/${item.stops}`, 680, y, 9, true, item.ready === item.stops ? ink : rgb(0.66, 0.29, 0.08));
    page.drawLine({ start: { x: 750, y: y - 2 }, end: { x: 803, y: y - 2 }, thickness: 0.5, color: muted });
    y -= 14;
    page.drawLine({ start: { x: 38, y }, end: { x: 803, y }, thickness: 0.5, color: line });
  }
  if (summaries.length > 0 && y < 70) text("Mais rotas nas páginas seguintes.", 38, 50, 8, false, muted);
  text("Cada rota segue nas páginas seguintes com a lista de carregamento e as paradas em ordem de entrega.", 38, 34, 8, false, muted);
}
