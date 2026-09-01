import { NextRequest, NextResponse } from "next/server";
import { getD1, getFiles } from "../../../db";
import { canWrite, getActor } from "../authz";

type FispqRow = {
  id: number;
  product_id: number;
  version: string;
  issue_date: number | null;
  validity_date: number | null;
  file_key: string | null;
  file_name: string | null;
  file_size: number | null;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
  product_name?: string;
};

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const serialize = (row: FispqRow) => ({
  id: row.id,
  productId: row.product_id,
  productName: row.product_name ?? "",
  version: row.version,
  issueDate: row.issue_date
    ? new Date(row.issue_date * 1000).toISOString().slice(0, 10)
    : "",
  validityDate: row.validity_date
    ? new Date(row.validity_date * 1000).toISOString().slice(0, 10)
    : "",
  fileName: row.file_name ?? "",
  fileSize: row.file_size ?? 0,
  status: row.status,
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const dateToEpoch = (value: unknown): number | null => {
  if (!value) return null;
  const epoch = Math.floor(new Date(String(value)).getTime() / 1000);
  return Number.isFinite(epoch) ? epoch : null;
};

const safeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-120) || "fispq";

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(),
    downloadId = Number(request.nextUrl.searchParams.get("download"));
  if (Number.isInteger(downloadId) && downloadId > 0) {
    const row = await db
      .prepare("SELECT * FROM fispq WHERE id=?")
      .bind(downloadId)
      .first<FispqRow>();
    if (!row || !row.file_key)
      return NextResponse.json(
        { error: "Arquivo não encontrado" },
        { status: 404 },
      );
    const object = await getFiles().get(row.file_key);
    if (!object)
      return NextResponse.json(
        { error: "Arquivo indisponível" },
        { status: 404 },
      );
    await db
      .prepare(
        "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'download','fispq',?,?,?)",
      )
      .bind(
        actor.userId,
        String(row.id),
        JSON.stringify({ fileName: row.file_name }),
        Math.floor(Date.now() / 1000),
      )
      .run();
    return new Response(object.body, {
      headers: {
        "Content-Type": row.file_name?.endsWith(".pdf")
          ? "application/pdf"
          : "application/octet-stream",
        "Content-Length": String(row.file_size ?? 0),
        "Content-Disposition": `attachment; filename="${safeName(row.file_name || "fispq.pdf")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const productId = Number(request.nextUrl.searchParams.get("productId")),
    base =
      Number.isInteger(productId) && productId > 0
        ? " WHERE f.product_id=?"
        : "";
  const rows = await db
    .prepare(
      `SELECT f.*,p.name AS product_name FROM fispq f JOIN products p ON p.id=f.product_id${base} ORDER BY p.name,f.updated_at DESC`,
    )
    .bind(...(base ? [productId] : []))
    .all<FispqRow>();
  const now = Math.floor(Date.now() / 1000),
    day = 86400,
    today = Math.floor(now / day) * day;
  const items = rows.results.map(serialize);
  return NextResponse.json({
    fispqs: items,
    summary: {
      total: items.length,
      active: items.filter((item) => item.status === "active").length,
      expired: items.filter(
        (item) =>
          item.status === "active" &&
          item.validityDate &&
          new Date(item.validityDate).getTime() / 1000 < today,
      ).length,
      expiringSoon: items.filter(
        (item) =>
          item.status === "active" &&
          item.validityDate &&
          (() => {
            const epoch = new Date(item.validityDate).getTime() / 1000;
            return epoch >= today && epoch <= today + 30 * day;
          })(),
      ).length,
    },
  });
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const form = await request.formData(),
    productId = Number(form.get("productId")),
    version = String(form.get("version") || "1").trim(),
    validityDate = dateToEpoch(form.get("validityDate")),
    issueDate = dateToEpoch(form.get("issueDate")),
    notes = String(form.get("notes") || ""),
    file = form.get("file");
  if (!Number.isInteger(productId) || productId <= 0 || !version)
    return NextResponse.json(
      { error: "Informe o produto e a versão da FISPQ" },
      { status: 400 },
    );
  const db = getD1(),
    product = await db
      .prepare("SELECT id FROM products WHERE id=?")
      .bind(productId)
      .first();
  if (!product)
    return NextResponse.json(
      { error: "Produto não encontrado" },
      { status: 404 },
    );
  let fileKey: string | null = null,
    fileName = "",
    fileSize = 0;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json(
        { error: "O arquivo deve ter no máximo 20 MB" },
        { status: 413 },
      );
    if (!ALLOWED_TYPES.has(file.type))
      return NextResponse.json(
        { error: "Formato não permitido. Envie PDF ou imagem JPEG/PNG." },
        { status: 415 },
      );
    const bytes = await file.arrayBuffer();
    fileKey = `fispq/${productId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    try {
      await getFiles().put(fileKey, bytes, {
        httpMetadata: { contentType: file.type },
        customMetadata: { uploadedBy: actor.userId, productId: String(productId) },
      });
    } catch {
      return NextResponse.json(
        { error: "Falha ao armazenar o arquivo da FISPQ" },
        { status: 500 },
      );
    }
    fileName = file.name;
    fileSize = file.size;
  }
  const now = Math.floor(Date.now() / 1000),
    status = String(form.get("status") || "active");
  let created: FispqRow | null = null;
  try {
    if (status === "active")
      await db
        .prepare("UPDATE fispq SET status='archived',updated_at=? WHERE product_id=? AND status='active'")
        .bind(now, productId)
        .run();
    created = await db
      .prepare(
        "INSERT INTO fispq (product_id,version,issue_date,validity_date,file_key,file_name,file_size,status,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *",
      )
      .bind(
        productId,
        version,
        issueDate,
        validityDate,
        fileKey,
        fileName,
        fileSize,
        status,
        notes,
        actor.userId,
        now,
        now,
      )
      .first<FispqRow>();
  } catch {
    if (fileKey) await getFiles().delete(fileKey);
    return NextResponse.json(
      { error: "Não foi possível cadastrar a FISPQ" },
      { status: 500 },
    );
  }
  if (!created) {
    if (fileKey) await getFiles().delete(fileKey);
    return NextResponse.json(
      { error: "Não foi possível cadastrar a FISPQ" },
      { status: 500 },
    );
  }
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','fispq',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({ productId, version, status, validityDate }),
      now,
    )
    .run();
  return NextResponse.json({ fispq: serialize(created) }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>,
    id = Number(body.id),
    db = getD1();
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "FISPQ inválida" }, { status: 400 });
  const current = await db
    .prepare("SELECT * FROM fispq WHERE id=?")
    .bind(id)
    .first<FispqRow>();
  if (!current)
    return NextResponse.json(
      { error: "FISPQ não encontrada" },
      { status: 404 },
    );
  const nextStatus = String(body.status || current.status),
    now = Math.floor(Date.now() / 1000);
  if (nextStatus === "active" && current.status !== "active")
    await db
      .prepare(
        "UPDATE fispq SET status='archived',updated_at=? WHERE product_id=? AND status='active'",
      )
      .bind(now, current.product_id)
      .run();
  const updated = await db
    .prepare(
      "UPDATE fispq SET version=?,issue_date=?,validity_date=?,status=?,notes=?,updated_at=? WHERE id=? RETURNING *",
    )
    .bind(
      String(body.version || current.version),
      dateToEpoch(body.issueDate) ?? current.issue_date,
      dateToEpoch(body.validityDate) ?? current.validity_date,
      nextStatus,
      String(body.notes ?? current.notes ?? ""),
      now,
      id,
    )
    .first<FispqRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar a FISPQ" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','fispq',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({
        before: { version: current.version, status: current.status },
        after: { version: updated.version, status: updated.status },
      }),
      now,
    )
    .run();
  return NextResponse.json({ fispq: serialize(updated) });
}
