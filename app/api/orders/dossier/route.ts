import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getD1, getFiles } from "../../../../db";
import { getActor } from "../../authz";

type OrderRow = {
  id: number;
  number: string;
  customer_id: number;
  order_date: number | null;
  delivery_date: number | null;
  status: string;
  notes: string | null;
  created_at: number;
};
type CustomerRow = {
  company_name: string;
  trading_name: string | null;
  document: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
};
type ItemRow = {
  product_name: string;
  quantity: number;
  unit: string;
  lot_number: string | null;
  unit_price_cents: number;
};
type DocRow = {
  id: number;
  kind: string;
  file_name: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  metadata: string;
  order_item_id: number | null;
  product_name: string | null;
};

const KIND_ORDER: Record<string, number> = {
  nf: 1,
  boleto: 2,
  laudo: 3,
  ficha: 4,
};
const KIND_LABELS: Record<string, string> = {
  nf: "Nota fiscal",
  boleto: "Boleto",
  laudo: "Laudo",
  ficha: "Ficha de risco",
};

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const fmtDate = (epoch: number | null | undefined) =>
  epoch ? new Date(epoch * 1000).toLocaleDateString("pt-BR") : "—";
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

function headerBand(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  const width = page.getWidth();
  page.drawRectangle({
    x: 0,
    y: page.getHeight() - 72,
    width,
    height: 72,
    color: ACCENT,
  });
  page.drawText(toPdf("QUIMICATIVA"), {
    x: 48,
    y: page.getHeight() - 34,
    size: 13,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(toPdf("Distribuidora de produtos quimicos"), {
    x: 48,
    y: page.getHeight() - 52,
    size: 9,
    font,
    color: rgb(0.85, 0.93, 0.95),
  });
}

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  const db = getD1(),
    orderId = Number(request.nextUrl.searchParams.get("orderId"));
  if (!Number.isInteger(orderId) || orderId <= 0)
    return NextResponse.json(
      { error: "Informe o pedido para gerar o PDF" },
      { status: 400 },
    );
  const order = await db
    .prepare("SELECT * FROM orders WHERE id=?")
    .bind(orderId)
    .first<OrderRow>();
  if (!order)
    return NextResponse.json(
      { error: "Pedido não encontrado" },
      { status: 404 },
    );
  const [customer, items, docs] = await Promise.all([
    db
      .prepare("SELECT * FROM customers WHERE id=?")
      .bind(order.customer_id)
      .first<CustomerRow>(),
    db
      .prepare(
        "SELECT product_name,quantity,unit,lot_number,unit_price_cents FROM order_items WHERE order_id=? ORDER BY id",
      )
      .bind(orderId)
      .all<ItemRow>(),
    db
      .prepare(
        `SELECT d.id,d.kind,d.file_name,d.storage_key,d.content_type,d.size_bytes,d.metadata,d.order_item_id,oi.product_name
         FROM order_documents d LEFT JOIN order_items oi ON oi.id=d.order_item_id
         WHERE d.order_id=? AND d.status='active'`,
      )
      .bind(orderId)
      .all<DocRow>(),
  ]);
  const itemsRows = items.results,
    docRows = docs.results.sort(
      (a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
        a.id - b.id,
    ),
    totalCents = itemsRows.reduce(
      (sum, i) => sum + Math.round(i.quantity * i.unit_price_cents),
      0,
    );
  const doc = await PDFDocument.create();
  doc.setTitle(`Dossie do pedido ${order.number}`);
  const font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const metaOf = (row: DocRow) => {
    try {
      const parsed = JSON.parse(row.metadata || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  // ── Página de capa ──────────────────────────────────────────────
  const cover = doc.addPage([595.28, 841.89]);
  headerBand(cover, bold, font);
  const width = cover.getWidth();
  cover.drawText(toPdf(`DOSSIE DO PEDIDO ${order.number}`), {
    x: 48,
    y: cover.getHeight() - 118,
    size: 18,
    font: bold,
    color: INK,
  });
  cover.drawText(
    toPdf(
      `Documentos do pedido: ${docRows.length} anexado(s) · gerado em ${new Date().toLocaleString("pt-BR")} por ${actor.displayName}`,
    ),
    { x: 48, y: cover.getHeight() - 138, size: 9, font, color: MUTED },
  );
  let y = cover.getHeight() - 170;
  const label = (text: string, value: string) => {
    cover.drawText(toPdf(text.toUpperCase()), {
      x: 48,
      y: y - 4,
      size: 7,
      font: bold,
      color: MUTED,
    });
    cover.drawText(toPdf(value), {
      x: 48,
      y: y - 19,
      size: 11,
      font,
      color: INK,
    });
    y -= 42;
  };
  label(
    "Cliente",
    customer
      ? `${customer.company_name}${customer.trading_name ? ` (${customer.trading_name})` : ""}${customer.document ? ` - CNPJ/CPF ${customer.document}` : ""}`
      : "Cliente removido",
  );
  if (customer) {
    const addr = [
      [customer.street, customer.number].filter(Boolean).join(", "),
      customer.complement,
      customer.district,
      [customer.city, customer.state].filter(Boolean).join("/"),
      customer.zip_code,
    ]
      .filter(Boolean)
      .join(" · ");
    if (addr) label("Endereco", addr);
  }
  label("Pedido", order.number);
  label(
    "Datas",
    `Pedido: ${fmtDate(order.order_date)}  ·  Entrega prevista: ${fmtDate(order.delivery_date)}`,
  );

  // tabela de itens
  cover.drawText(toPdf("PRODUTOS DO PEDIDO"), {
    x: 48,
    y: y - 6,
    size: 8,
    font: bold,
    color: MUTED,
  });
  const rowH = 20,
    headerH = 20;
  y -= 26;
  const columns = [
    { label: "Produto", width: 190 },
    { label: "Lote", width: 80 },
    { label: "Quantidade", width: 80 },
    { label: "Valor unit.", width: 85 },
    { label: "Total", width: 85 },
  ];
  const tableLeft = 48,
    tableWidth = columns.reduce((s, c) => s + c.width, 0);
  let itemsPage = cover;
  const drawTableHeader = (page: typeof cover) => {
    page.drawRectangle({
      x: tableLeft,
      y: y - headerH,
      width: tableWidth,
      height: headerH,
      color: rgb(0.94, 0.96, 0.98),
    });
    let cx = tableLeft;
    columns.forEach((column) => {
      page.drawText(toPdf(column.label.toUpperCase()), {
        x: cx + 6,
        y: y - headerH + 7,
        size: 7,
        font: bold,
        color: MUTED,
      });
      cx += column.width;
    });
    y -= headerH + rowH;
  };
  drawTableHeader(itemsPage);
  itemsRows.forEach((item) => {
    if (y < 90) {
      itemsPage = doc.addPage([595.28, 841.89]);
      headerBand(itemsPage, bold, font);
      y = itemsPage.getHeight() - 60;
      drawTableHeader(itemsPage);
    }
    itemsPage.drawText(toPdf(item.product_name.slice(0, 60)), {
      x: tableLeft + 6,
      y: y - 6,
      size: 8,
      font,
      color: INK,
    });
    itemsPage.drawText(toPdf(item.lot_number || "-"), {
      x: tableLeft + 196,
      y: y - 6,
      size: 8,
      font,
      color: INK,
    });
    itemsPage.drawText(toPdf(`${String(item.quantity)} ${item.unit}`), {
      x: tableLeft + 276,
      y: y - 6,
      size: 8,
      font,
      color: INK,
    });
    itemsPage.drawText(toPdf(fmtBRL(item.unit_price_cents)), {
      x: tableLeft + 356,
      y: y - 6,
      size: 8,
      font,
      color: INK,
    });
    itemsPage.drawText(
      toPdf(fmtBRL(Math.round(item.quantity * item.unit_price_cents))),
      {
        x: tableLeft + 441,
        y: y - 6,
        size: 8,
        font: bold,
        color: INK,
      },
    );
    itemsPage.drawLine({
      start: { x: tableLeft, y },
      end: { x: tableLeft + tableWidth, y },
      thickness: 0.5,
      color: LINE,
    });
    y -= rowH;
  });
  itemsPage.drawText(toPdf(`TOTAL DO PEDIDO: ${fmtBRL(totalCents)}`), {
    x: tableLeft + 250,
    y: y - 4,
    size: 10,
    font: bold,
    color: ACCENT,
  });
  y -= 40;

  // ── checklist de documentos ─────────────────────────────────────
  if (itemsPage !== cover) {
    itemsPage = doc.addPage([595.28, 841.89]);
    headerBand(itemsPage, bold, font);
    y = itemsPage.getHeight() - 100;
  } else {
    itemsPage = cover;
  }
  itemsPage.drawText(toPdf("DOCUMENTOS DO FLUXO"), {
    x: 48,
    y: y - 4,
    size: 8,
    font: bold,
    color: MUTED,
  });
  y -= 26;
  const flow = ["nf", "boleto", "laudo", "ficha"];
  for (const kind of flow) {
    const group = docRows.filter((d) => d.kind === kind);
    const present = group.length > 0;
    const labelText = KIND_LABELS[kind] ?? kind;
    itemsPage.drawText(toPdf(present ? "OK  " : "    "), {
      x: 48,
      y: y - 6,
      size: 9,
      font: bold,
      color: present ? rgb(0.11, 0.6, 0.45) : rgb(0.8, 0.3, 0.3),
    });
    itemsPage.drawText(toPdf(labelText), {
      x: 76,
      y: y - 6,
      size: 9,
      font: bold,
      color: INK,
    });
    if (kind === "laudo" || kind === "ficha") {
      const itemsNeeded = itemsRows.length;
      itemsPage.drawText(
        toPdf(
          present
            ? `Anexado a ${new Set(group.map((g) => g.order_item_id)).size} de ${itemsNeeded} produto(s)`
            : "Pendente",
        ),
        { x: 200, y: y - 6, size: 8, font, color: MUTED },
      );
    } else {
      itemsPage.drawText(
        toPdf(present ? group.map((g) => g.file_name).join("; ").slice(0, 80) : "Pendente"),
        { x: 200, y: y - 6, size: 8, font, color: MUTED },
      );
    }
    y -= 22;
  }
  const missing = flow.filter((kind) => !docRows.some((d) => d.kind === kind));
  if (missing.length) {
    itemsPage.drawText(
      toPdf(
        `Documentos pendentes: ${missing.map((k) => KIND_LABELS[k]).join(", ")}. Anexe-os no pedido para completar o dossie.`,
      ),
      { x: 48, y: y - 10, size: 8, font, color: MUTED },
    );
  }

  // ── anexos: separador + conteúdo ────────────────────────────────
  const skipped: string[] = [];
  let embeddedDocs = 0;
  for (const row of docRows) {
    const separator = doc.addPage([595.28, 841.89]);
    headerBand(separator, bold, font);
    separator.drawText(toPdf(KIND_LABELS[row.kind] ?? row.kind), {
      x: 48,
      y: separator.getHeight() - 130,
      size: 16,
      font: bold,
      color: INK,
    });
    const meta = metaOf(row);
    const lines = [
      `Arquivo: ${row.file_name}`,
      row.product_name ? `Produto: ${row.product_name}` : "",
      meta.numero ? `Numero: ${String(meta.numero)}` : "",
      meta.chaveAcesso ? `Chave de acesso: ${String(meta.chaveAcesso)}` : "",
      meta.vencimento ? `Vencimento: ${String(meta.vencimento)}` : "",
      meta.data ? `Data: ${String(meta.data)}` : "",
      meta.lote ? `Lote: ${String(meta.lote)}` : "",
      meta.numeroOnu ? `Numero ONU: ${String(meta.numeroOnu)}` : "",
    ].filter(Boolean);
    let ly = separator.getHeight() - 160;
    lines.forEach((line) => {
      separator.drawText(toPdf(line), {
        x: 48,
        y: ly,
        size: 9,
        font,
        color: MUTED,
      });
      ly -= 16;
    });
    let object;
    try {
      object = await getFiles().get(row.storage_key);
    } catch {
      skipped.push(`${row.file_name} (indisponivel no armazenamento)`);
      continue;
    }
    if (!object) {
      skipped.push(`${row.file_name} (nao encontrado no armazenamento)`);
      continue;
    }
    const bytes = await object.arrayBuffer();
    try {
      if (row.content_type === "application/pdf") {
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await doc.copyPages(source, source.getPageIndices());
        pages.forEach((page) => doc.addPage(page));
        embeddedDocs += 1;
      } else if (row.content_type === "image/jpeg") {
        const image = await doc.embedJpg(bytes),
          imgPage = doc.addPage([595.28, 841.89]),
          scale = Math.min(
            (595.28 - 96) / image.width,
            (841.89 - 96) / image.height,
          );
        imgPage.drawImage(image, {
          x: (595.28 - image.width * scale) / 2,
          y: (841.89 - image.height * scale) / 2,
          width: image.width * scale,
          height: image.height * scale,
        });
        embeddedDocs += 1;
      } else if (row.content_type === "image/png") {
        const image = await doc.embedPng(bytes),
          imgPage = doc.addPage([595.28, 841.89]),
          scale = Math.min(
            (595.28 - 96) / image.width,
            (841.89 - 96) / image.height,
          );
        imgPage.drawImage(image, {
          x: (595.28 - image.width * scale) / 2,
          y: (841.89 - image.height * scale) / 2,
          width: image.width * scale,
          height: image.height * scale,
        });
        embeddedDocs += 1;
      } else {
        skipped.push(
          `${row.file_name} (formato ${row.content_type} nao e incorporado ao PDF; baixe o arquivo original no pedido)`,
        );
      }
    } catch {
      skipped.push(`${row.file_name} (nao foi possivel ler o conteudo)`);
    }
  }
  if (skipped.length) {
    const note = doc.addPage([595.28, 841.89]);
    headerBand(note, bold, font);
    note.drawText(toPdf("AVISOS DE ARQUIVOS"), {
      x: 48,
      y: note.getHeight() - 130,
      size: 14,
      font: bold,
      color: INK,
    });
    let ny = note.getHeight() - 160;
    skipped.forEach((line) => {
      note.drawText(toPdf(`- ${line.slice(0, 110)}`), {
        x: 48,
        y: ny,
        size: 8,
        font,
        color: MUTED,
      });
      ny -= 14;
    });
  }
  const pdfBytes = await doc.save();
  const fileName = `dossie-${String(order.number).toLowerCase()}.pdf`;
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'generate','order_dossier',?,?,?)",
    )
    .bind(
      actor.userId,
      String(order.id),
      JSON.stringify({
        orderNumber: order.number,
        files: docRows.length,
        embedded: embeddedDocs,
        skipped: skipped.length,
      }),
      Math.floor(Date.now() / 1000),
    )
    .run();
  return new Response(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
