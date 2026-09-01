import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getD1 } from "../../../db";
import { canValidate, getActor } from "../authz";

type LotRow = {
  id: number;
  product_id: number;
  product_name: string;
  category: string;
  lot_number: string;
  expiry_date: number | null;
  quantity: number;
  unit: string;
  location: string | null;
  controlled: number;
  control_agency: string | null;
  un_number: string | null;
  hazard_class: string | null;
};

const fmtDate = (epoch: number | null | undefined) =>
  epoch
    ? new Date(epoch * 1000).toLocaleDateString("pt-BR")
    : "—";

// Helvetica padrão (WinAnsi) não cobre travessões/aspas curvas/etc.
const toPdf = (value: string) =>
  value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00B7/g, " / ")
    .replace(/\u2192/g, "->")
    .replace(/[^\x00-\xFF]/g, "?");

const INK = rgb(0.09, 0.13, 0.2);
const MUTED = rgb(0.45, 0.5, 0.59);
const LINE = rgb(0.91, 0.94, 0.96);
const ACCENT = rgb(0.16, 0.44, 0.51);

async function pdfHeader(
  doc: PDFDocument,
  title: string,
  subtitle: string,
  generatedBy: string,
  generatedAt: Date,
) {
  const page = doc.addPage([595.28, 841.89]),
    font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold),
    width = page.getWidth();
  page.drawRectangle({
    x: 0,
    y: page.getHeight() - 90,
    width,
    height: 90,
    color: ACCENT,
  });
  page.drawText(toPdf("QUIMICATIVA"), {
    x: 48,
    y: page.getHeight() - 44,
    size: 13,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(toPdf("Distribuidora de produtos químicos"), {
    x: 48,
    y: page.getHeight() - 62,
    size: 9,
    font,
    color: rgb(0.85, 0.93, 0.95),
  });
  page.drawText(toPdf(title), {
    x: 48,
    y: page.getHeight() - 128,
    size: 18,
    font: bold,
    color: INK,
  });
  page.drawText(toPdf(subtitle), {
    x: 48,
    y: page.getHeight() - 148,
    size: 10,
    font,
    color: MUTED,
  });
  page.drawText(
    toPdf(
      `Gerado em ${generatedAt.toLocaleString("pt-BR")} por ${generatedBy}`,
    ),
    { x: 48, y: page.getHeight() - 166, size: 8, font, color: MUTED },
  );
  return { page, font, bold, width, y: page.getHeight() - 200 };
}

async function drawTable(
  doc: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  startY: number,
  width: number,
  columns: { label: string; width: number }[],
  rows: string[][],
  rowColors: (string | undefined)[] = [],
) {
  const left = 48,
    headerH = 26,
    rowH = 24,
    maxRows = Math.max(2, Math.floor((page.getHeight() - startY - 60) / rowH));
  let y = startY - headerH;
  // Header
  page.drawRectangle({
    x: left,
    y,
    width,
    height: headerH,
    color: rgb(0.94, 0.96, 0.98),
  });
  let x = left;
  columns.forEach((column, index) => {
    page.drawText(toPdf(column.label.toUpperCase()), {
      x: x + 8,
      y: y + 9,
      size: 7.5,
      font: bold,
      color: MUTED,
    });
    x += column.width;
  });
  y -= rowH;
  let rowIndex = 0,
    count = 0;
  for (const row of rows) {
    if (count >= maxRows) {
      // nova página
      page.drawLine({
        start: { x: left, y: y - 6 },
        end: { x: left + width, y: y - 6 },
        thickness: 0.5,
        color: LINE,
      });
      const next = await pdfHeader(doc, "", "", "", new Date());
      page = next.page;
      font = next.font;
      bold = next.bold;
      y = next.y - headerH;
      page.drawRectangle({
        x: left,
        y,
        width,
        height: headerH,
        color: rgb(0.94, 0.96, 0.98),
      });
      x = left;
      columns.forEach((column, index) => {
        page.drawText(toPdf(column.label.toUpperCase()), {
          x: x + 8,
          y: y + 9,
          size: 7.5,
          font: bold,
          color: MUTED,
        });
        x += column.width;
      });
      y -= rowH;
      count = 0;
    }
    const color = rowColors[rowIndex];
    if (color)
      page.drawRectangle({
        x: left,
        y,
        width,
        height: rowH,
        color,
      });
    x = left;
    row.forEach((cell, index) => {
      page.drawText(toPdf(cell), {
        x: x + 8,
        y: y + 8,
        size: 8,
        font,
        color: INK,
      });
      x += columns[index].width;
    });
    page.drawLine({
      start: { x: left, y },
      end: { x: left + width, y },
      thickness: 0.5,
      color: LINE,
    });
    y -= rowH;
    count += 1;
    rowIndex += 1;
  }
  return y;
}

const DAY = 86400;

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const type = String(request.nextUrl.searchParams.get("type") || ""),
    productId = Number(request.nextUrl.searchParams.get("productId")),
    db = getD1(),
    now = Math.floor(Date.now() / 1000),
    today = Math.floor(now / DAY) * DAY,
    inSixty = today + 60 * DAY,
    doc = await PDFDocument.create();
  doc.setTitle("Quimicativa — Relatório");
  let title = "Relatório",
    subtitle = "Gerado a partir dos dados do sistema",
    page: Awaited<ReturnType<PDFDocument["addPage"]>>,
    font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
    bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
    width: number,
    y: number;

  if (type === "estoque") {
    title = "Relatório de estoque — validade";
    subtitle = "Produtos e lotes com vencimento nos próximos 60 dias";
    ({ page, font, bold, width, y } = await pdfHeader(
      doc,
      title,
      subtitle,
      actor.displayName,
      new Date(),
    ));
    const lots = await db
      .prepare(
        `SELECT l.*,p.name AS product_name,p.category,p.controlled,p.control_agency,p.un_number,p.hazard_class
         FROM lots l JOIN products p ON p.id=l.product_id
         WHERE l.quantity>0 AND (l.expiry_date IS NULL OR l.expiry_date<=?)
         ORDER BY l.expiry_date ASC`,
      )
      .bind(inSixty)
      .all<LotRow>();
    const rows = lots.results.map((lot) => {
      const expired = lot.expiry_date !== null && lot.expiry_date < today,
        soon = lot.expiry_date !== null && lot.expiry_date >= today;
      return [
        lot.product_name,
        lot.lot_number,
        fmtDate(lot.expiry_date),
        `${lot.quantity} ${lot.unit}`,
        lot.location ?? "—",
        expired ? "VENCIDO" : soon ? "Vence em breve" : "Sem validade",
      ];
    });
    const rowColors = lots.results.map((lot) => {
      if (lot.expiry_date !== null && lot.expiry_date < today)
        return rgb(0.996, 0.914, 0.91);
      if (lot.expiry_date !== null && lot.expiry_date <= now + 15 * DAY)
        return rgb(1, 0.94, 0.84);
      return undefined;
    });
    y = await drawTable(
      doc,
      page,
      font,
      bold,
      y,
      width - 96,
      [
        { label: "Produto", width: 150 },
        { label: "Lote", width: 90 },
        { label: "Validade", width: 75 },
        { label: "Quantidade", width: 70 },
        { label: "Localização", width: 90 },
        { label: "Situação", width: 60 },
      ],
      rows,
      rowColors,
    );
    page.drawText(
      toPdf(`Total de lotes analisados: ${rows.length}`),
      { x: 48, y: y - 14, size: 9, font: bold, color: INK },
    );
  } else if (type === "controlados") {
    if (!canValidate(actor))
      return NextResponse.json(
        { error: "Relatório restrito à direção e gestores" },
        { status: 403 },
      );
    title = "Produtos controlados — prestação de contas";
    subtitle = "Estoque e lotes de produtos sujeitos a controle de órgão fiscalizador";
    ({ page, font, bold, width, y } = await pdfHeader(
      doc,
      title,
      subtitle,
      actor.displayName,
      new Date(),
    ));
    const products = await db
      .prepare(
        "SELECT id,name,category,control_agency,un_number FROM products WHERE controlled=1 AND status='active' ORDER BY name",
      )
      .all<{
        id: number;
        name: string;
        category: string;
        control_agency: string | null;
        un_number: string | null;
      }>();
    const lots = await db
      .prepare(
        "SELECT l.*,p.name AS product_name,p.category,p.controlled,p.control_agency,p.un_number,p.hazard_class FROM lots l JOIN products p ON p.id=l.product_id WHERE p.controlled=1 ORDER BY p.name,l.expiry_date",
      )
      .all<LotRow>();
    const rows = lots.results.map((lot) => [
      lot.product_name,
      lot.lot_number,
      fmtDate(lot.expiry_date),
      `${lot.quantity} ${lot.unit}`,
      lot.location ?? "—",
      lot.control_agency ?? "—",
    ]);
    y = await drawTable(
      doc,
      page,
      font,
      bold,
      y,
      width - 96,
      [
        { label: "Produto", width: 140 },
        { label: "Lote", width: 85 },
        { label: "Validade", width: 70 },
        { label: "Quantidade", width: 65 },
        { label: "Localização", width: 85 },
        { label: "Órgão de controle", width: 75 },
      ],
      rows,
    );
    page.drawText(
      toPdf(`Produtos controlados cadastrados: ${products.results.length} · Lotes: ${rows.length}`),
      { x: 48, y: y - 14, size: 9, font: bold, color: INK },
    );
  } else if (type === "ficha" && Number.isInteger(productId) && productId > 0) {
    if (!canValidate(actor))
      return NextResponse.json(
        { error: "Ficha de produto restrita à direção e gestores" },
        { status: 403 },
      );
    title = "Ficha consolidada do produto";
    ({ page, font, bold, width, y } = await pdfHeader(
      doc,
      title,
      subtitle,
      actor.displayName,
      new Date(),
    ));
    const product = await db
      .prepare(
        "SELECT * FROM products WHERE id=? AND status='active'",
      )
      .bind(productId)
      .first<{
        id: number;
        name: string;
        category: string;
        concentration: string | null;
        un_number: string | null;
        hazard_class: string | null;
        signal_word: string | null;
        h_phrases: string;
        p_phrases: string;
        controlled: number;
        control_agency: string | null;
        flammable: number;
        storage: string | null;
        notes: string | null;
      }>();
    if (!product)
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 },
      );
    const fispq = await db
        .prepare(
          "SELECT version,issue_date,validity_date,file_name FROM fispq WHERE product_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(productId)
        .first<{
          version: string;
          issue_date: number | null;
          validity_date: number | null;
          file_name: string | null;
        }>(),
      lots = await db
        .prepare(
          "SELECT * FROM lots WHERE product_id=? AND quantity>0 ORDER BY expiry_date",
        )
        .bind(productId)
        .all<LotRow>();
    let hPhrases: string[] = [],
      pPhrases: string[] = [];
    try {
      hPhrases = JSON.parse(product.h_phrases);
      pPhrases = JSON.parse(product.p_phrases);
    } catch {
      /* ignore */
    }
    const label = (text: string, value: string) => {
      page.drawText(toPdf(text.toUpperCase()), {
        x: 48,
        y: y - 8,
        size: 7,
        font: bold,
        color: MUTED,
      });
      page.drawText(toPdf(value), {
        x: 48,
        y: y - 22,
        size: 10,
        font,
        color: INK,
      });
      y -= 44;
    };
    label("Produto", product.name);
    label("Categoria / apresentação", `${product.category}${product.concentration ? ` · ${product.concentration}` : ""}`);
    label(
      "Classificação de perigo (GHS)",
      product.hazard_class
        ? `${product.hazard_class}${product.signal_word ? ` — palavra de advertência: ${product.signal_word}` : ""}`
        : "—",
    );
    label("Número ONU", product.un_number || "—");
    label(
      "Controle regulatório",
      product.controlled === 1
        ? `Controlado — ${product.control_agency ?? "órgão não informado"}`
        : "Não controlado",
    );
    if (product.flammable === 1)
      label("NR-20", "Inflamável — exige atendimento à NR-20");
    label("Armazenamento", product.storage || "—");
    if (hPhrases.length)
      label("Frases H", hPhrases.join(" · "));
    if (pPhrases.length)
      label("Frases P", pPhrases.join(" · "));
    label(
      "FISPQ vigente",
      fispq
        ? `Versão ${fispq.version} — ${fmtDate(fispq.issue_date)} a ${fmtDate(fispq.validity_date)}${fispq.file_name ? ` (${fispq.file_name})` : ""}`
        : "Sem FISPQ vigente cadastrada",
    );
    page.drawText(toPdf("LOTES EM ESTOQUE"), {
      x: 48,
      y: y - 6,
      size: 7,
      font: bold,
      color: MUTED,
    });
    y = await drawTable(
      doc,
      page,
      font,
      bold,
      y - 18,
      width - 96,
      [
        { label: "Lote", width: 120 },
        { label: "Validade", width: 90 },
        { label: "Quantidade", width: 90 },
        { label: "Localização", width: 110 },
      ],
      lots.results.map((lot) => [
        lot.lot_number,
        fmtDate(lot.expiry_date),
        `${lot.quantity} ${lot.unit}`,
        lot.location ?? "—",
      ]),
    );
    if (product.notes)
      page.drawText(toPdf(`Observações: ${product.notes}`), {
        x: 48,
        y: y - 14,
        size: 8,
        font,
        color: MUTED,
      });
  } else {
    return NextResponse.json(
      {
        error:
          "Não foi possível gerar o relatório solicitado. Escolha o relatório pela tela de Relatórios.",
      },
      { status: 400 },
    );
  }
  const bytes = await doc.save(),
    filename = `${type}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
