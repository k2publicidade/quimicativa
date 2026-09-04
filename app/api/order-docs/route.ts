import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getD1, getFiles } from "../../../db";
import { canWrite, getActor } from "../authz";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "application/xml",
  "text/xml",
]);
const KINDS = ["nf", "boleto", "laudo", "ficha"] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABELS: Record<Kind, string> = {
  nf: "Nota fiscal",
  boleto: "Boleto",
  laudo: "Laudo",
  ficha: "Ficha de risco",
};
const METADATA_KEYS: Record<Kind, string[]> = {
  nf: ["numero", "serie", "chaveAcesso", "dataEmissao", "valor", "paginas"],
  boleto: ["numero", "vencimento", "valor", "linhaDigitavel"],
  laudo: ["numero", "data", "lote"],
  ficha: ["produto", "numeroOnu", "data"],
};
type DocRow = {
  id: number;
  order_id: number;
  order_item_id: number | null;
  kind: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  metadata: string;
  status: string;
  notes: string | null;
  uploaded_by: string | null;
  created_at: number;
  updated_at: number;
};
type OrderRow = { id: number; number: string; status: string };
type ItemRow = { id: number; product_name: string };

const serialize = (row: DocRow) => {
  let metadata: Record<string, string> = {};
  try {
    metadata = JSON.parse(row.metadata || "{}");
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    kind: row.kind,
    kindLabel: KIND_LABELS[row.kind as Kind] ?? row.kind,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    metadata,
    status: row.status,
    notes: row.notes ?? "",
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};
const safeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-120) || "documento";
const validSignature = (bytes: Uint8Array, type: string) => {
  if (type === "application/pdf")
    return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (type === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png")
    return (
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  if (type === "image/webp")
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  if (type === "image/tiff")
    return (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a)
    );
  if (type.includes("xml"))
    return new TextDecoder()
      .decode(bytes.slice(0, 100))
      .trimStart()
      .startsWith("<");
  return false;
};

export async function GET(request: NextRequest) {
  const user = await getActor();
  if (!user)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  const db = getD1(),
    orderId = Number(request.nextUrl.searchParams.get("orderId")),
    downloadId = Number(request.nextUrl.searchParams.get("download"));
  if (Number.isInteger(downloadId) && downloadId > 0) {
    const row = await db
      .prepare("SELECT * FROM order_documents WHERE id=?")
      .bind(downloadId)
      .first<DocRow>();
    if (!row)
      return NextResponse.json(
        { error: "Documento não encontrado" },
        { status: 404 },
      );
    const object = await getFiles().get(row.storage_key);
    if (!object)
      return NextResponse.json(
        { error: "Arquivo indisponível no armazenamento" },
        { status: 404 },
      );
    await db
      .prepare(
        "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'download','order_document',?,?,?)",
      )
      .bind(
        user.userId,
        String(row.id),
        JSON.stringify({ filename: row.file_name }),
        Math.floor(Date.now() / 1000),
      )
      .run();
    return new Response(object.body, {
      headers: {
        "Content-Type": row.content_type,
        "Content-Length": String(row.size_bytes),
        "Content-Disposition": `attachment; filename="${safeName(row.file_name)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (!Number.isInteger(orderId) || orderId <= 0)
    return NextResponse.json(
      { error: "Informe o pedido para listar os documentos" },
      { status: 400 },
    );
  const result = await db
    .prepare(
      "SELECT * FROM order_documents WHERE order_id=? ORDER BY kind,created_at",
    )
    .bind(orderId)
    .all<DocRow>();
  return NextResponse.json({
    documents: result.results.map(serialize),
  });
}

export async function POST(request: NextRequest) {
  const user = await getActor();
  if (!user)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  if (!canWrite(user))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const form = await request.formData(),
    file = form.get("file");
  if (!(file instanceof File) || !file.size)
    return NextResponse.json(
      { error: "Selecione um arquivo" },
      { status: 400 },
    );
  if (file.size > MAX_FILE_SIZE)
    return NextResponse.json(
      { error: "O arquivo deve ter no máximo 20 MB" },
      { status: 413 },
    );
  if (!ALLOWED_TYPES.has(file.type))
    return NextResponse.json(
      {
        error:
          "Formato não permitido. Envie o documento em PDF, imagem (JPEG/PNG) ou XML.",
      },
      { status: 415 },
    );
  const db = getD1(),
    orderId = Number(form.get("orderId")),
    kind = String(form.get("kind") || "") as Kind,
    orderItemIdRaw = String(form.get("orderItemId") || "").trim(),
    notes = String(form.get("notes") || ""),
    now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(orderId) || orderId <= 0 || !KINDS.includes(kind))
    return NextResponse.json(
      { error: "Pedido ou tipo de documento inválido" },
      { status: 400 },
    );
  const order = await db
    .prepare("SELECT id,number,status FROM orders WHERE id=?")
    .bind(orderId)
    .first<OrderRow>();
  if (!order)
    return NextResponse.json(
      { error: "Pedido não encontrado" },
      { status: 404 },
    );
  if (order.status === "cancelled")
    return NextResponse.json(
      { error: "Pedido cancelado não aceita novos documentos" },
      { status: 400 },
    );
  let orderItemId: number | null = null,
    itemLabel = "";
  if (kind === "laudo" || kind === "ficha") {
    orderItemId = Number(orderItemIdRaw);
    if (!Number.isInteger(orderItemId) || orderItemId <= 0)
      return NextResponse.json(
        {
          error: `A ${KIND_LABELS[kind].toLowerCase()} precisa ser vinculada a um produto do pedido.`,
        },
        { status: 400 },
      );
    const item = await db
      .prepare("SELECT id,product_name FROM order_items WHERE id=? AND order_id=?")
      .bind(orderItemId, orderId)
      .first<ItemRow>();
    if (!item)
      return NextResponse.json(
        { error: "Produto do pedido não encontrado para este vínculo" },
        { status: 404 },
      );
    itemLabel = item.product_name;
  } else if (orderItemIdRaw) {
    return NextResponse.json(
      { error: "Nota fiscal e boleto são vinculados ao pedido inteiro, não a um produto." },
      { status: 400 },
    );
  }
  const bytes = await file.arrayBuffer(),
    signature = new Uint8Array(bytes.slice(0, 128));
  if (!validSignature(signature, file.type))
    return NextResponse.json(
      { error: "O conteúdo do arquivo não corresponde ao formato informado." },
      { status: 415 },
    );
  let pages = 1;
  if (file.type === "application/pdf") {
    const tail = new TextDecoder()
      .decode(bytes.slice(-2048))
      .replace(/\s+$/, "");
    if (!tail.includes("%%EOF"))
      return NextResponse.json(
        {
          error:
            "O PDF parece estar incompleto ou corrompido. Envie o arquivo original novamente.",
        },
        { status: 415 },
      );
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      pages = pdf.getPageCount();
    } catch {
      return NextResponse.json(
        {
          error:
            "Não foi possível ler o conteúdo deste PDF. Confira se o arquivo não está corrompido.",
        },
        { status: 415 },
      );
    }
  }
  let metadata: Record<string, string> = {};
  try {
    const raw = JSON.parse(String(form.get("metadata") || "{}"));
    if (raw && typeof raw === "object") {
      const allowed = METADATA_KEYS[kind] ?? [];
      metadata = Object.fromEntries(
        Object.entries(raw)
          .filter(([key]) => allowed.includes(key))
          .map(([key, value]) => [key, String(value).trim()]),
      );
    }
  } catch {
    /* metadados opcionais */
  }
  if (kind === "nf" && metadata.chaveAcesso) {
    const digits = metadata.chaveAcesso.replace(/\D/g, "");
    if (digits.length !== 44)
      return NextResponse.json(
        { error: "Chave de acesso da NF-e deve ter 44 dígitos." },
        { status: 400 },
      );
  }
  const key = `orders/${orderId}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`,
    storageMeta: Record<string, string> = { orderId: String(orderId) };
  if (orderItemId) storageMeta.orderItemId = String(orderItemId);
  let row: DocRow | null = null;
  try {
    await getFiles().put(key, bytes, {
      httpMetadata: { contentType: file.type },
      customMetadata: storageMeta,
    });
    row = await db
      .prepare(
        `INSERT INTO order_documents
         (order_id,order_item_id,kind,storage_key,file_name,content_type,size_bytes,metadata,status,notes,uploaded_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      )
      .bind(
        orderId,
        orderItemId,
        kind,
        key,
        file.name,
        file.type,
        file.size,
        JSON.stringify({ ...metadata, paginas: String(pages) }),
        "active",
        notes,
        user.userId,
        now,
        now,
      )
      .first<DocRow>();
  } catch {
    await getFiles().delete(key).catch(() => undefined);
    return NextResponse.json(
      {
        error:
          "Não foi possível salvar o arquivo. Tente novamente; se o problema persistir, confira o armazenamento.",
      },
      { status: 500 },
    );
  }
  if (!row)
    return NextResponse.json(
      { error: "Não foi possível registrar o documento" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','order_document',?,?,?)",
    )
    .bind(
      user.userId,
      String(row.id),
      JSON.stringify({
        orderId,
        orderNumber: order.number,
        kind,
        fileName: file.name,
        item: itemLabel || undefined,
      }),
      now,
    )
    .run();
  return NextResponse.json({ document: serialize(row) }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const user = await getActor();
  if (!user)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  if (!canWrite(user))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>,
    id = Number(body.id),
    db = getD1();
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json(
      { error: "Documento inválido" },
      { status: 400 },
    );
  const current = await db
    .prepare("SELECT * FROM order_documents WHERE id=?")
    .bind(id)
    .first<DocRow>();
  if (!current)
    return NextResponse.json(
      { error: "Documento não encontrado" },
      { status: 404 },
    );
  const now = Math.floor(Date.now() / 1000);
  let metadata = current.metadata;
  if (body.metadata !== undefined && body.metadata !== null) {
    let parsed: unknown = body.metadata;
    if (typeof parsed !== "object") {
      try {
        parsed = JSON.parse(String(body.metadata));
      } catch {
        return NextResponse.json(
          { error: "Metadados inválidos" },
          { status: 400 },
        );
      }
    }
    if (parsed && typeof parsed === "object") {
      const allowed = METADATA_KEYS[current.kind as Kind] ?? [];
      metadata = JSON.stringify(
        Object.fromEntries(
          Object.entries(parsed)
            .filter(([key]) => allowed.includes(key))
            .map(([key, value]) => [key, String(value).trim()]),
        ),
      );
    }
  }
  const status = String(body.status ?? current.status);
  if (!["active", "archived"].includes(status))
    return NextResponse.json(
      { error: "Situação do documento inválida" },
      { status: 400 },
    );
  const updated = await db
    .prepare(
      "UPDATE order_documents SET metadata=?,status=?,notes=?,updated_at=? WHERE id=? RETURNING *",
    )
    .bind(
      metadata,
      status,
      String(body.notes ?? current.notes ?? ""),
      now,
      id,
    )
    .first<DocRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar o documento" },
      { status: 500 },
    );
  if (status === "archived" && current.status !== "archived")
    await db
      .prepare(
        "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'archive','order_document',?,?,?)",
      )
      .bind(user.userId, String(id), JSON.stringify({ fileName: current.file_name }), now)
      .run();
  return NextResponse.json({ document: serialize(updated) });
}
