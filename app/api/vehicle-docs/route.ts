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
]);
const REQUIRED_VALIDITY = [
  "CRLV",
  "Licenciamento",
  "Seguro",
  "ANTT",
  "Tacógrafo",
  "Inspeção veicular",
];
const ALL_DOC_TYPES = [...REQUIRED_VALIDITY, "Outro"];
type DocRow = {
  id: number;
  vehicle_id: number;
  doc_type: string;
  number: string | null;
  issuing_body: string | null;
  issue_date: number | null;
  expiry_date: number | null;
  storage_key: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: number;
  updated_at: number;
};
const fmtDate = (epoch: number | null | undefined) =>
  epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : "";
const serialize = (row: DocRow) => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  docType: row.doc_type,
  number: row.number ?? "",
  issuingBody: row.issuing_body ?? "",
  issueDate: fmtDate(row.issue_date),
  expiryDate: fmtDate(row.expiry_date),
  hasFile: Boolean(row.storage_key && row.file_name),
  fileName: row.file_name ?? "",
  contentType: row.content_type ?? "",
  sizeBytes: row.size_bytes ?? 0,
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
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
  return false;
};
const dateToEpoch = (value: unknown) => {
  if (!value || value === "null") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const epoch = Math.floor(new Date(`${text}T12:00:00`).getTime() / 1000);
  return Number.isFinite(epoch) ? epoch : null;
};

export async function GET(request: NextRequest) {
  const user = await getActor();
  if (!user)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  const db = getD1(),
    vehicleId = Number(request.nextUrl.searchParams.get("vehicleId")),
    downloadId = Number(request.nextUrl.searchParams.get("download"));
  if (Number.isInteger(downloadId) && downloadId > 0) {
    const row = await db
      .prepare("SELECT * FROM vehicle_documents WHERE id=?")
      .bind(downloadId)
      .first<DocRow>();
    if (!row || !row.storage_key || !row.file_name)
      return NextResponse.json(
        { error: "Documento ou arquivo não encontrado" },
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
        "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'download','vehicle_document',?,?,?)",
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
        "Content-Type": row.content_type ?? "application/octet-stream",
        "Content-Length": String(row.size_bytes ?? 0),
        "Content-Disposition": `attachment; filename="${safeName(row.file_name)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (!Number.isInteger(vehicleId) || vehicleId <= 0)
    return NextResponse.json(
      { error: "Informe o veículo para listar os documentos" },
      { status: 400 },
    );
  const result = await db
    .prepare(
      "SELECT * FROM vehicle_documents WHERE vehicle_id=? ORDER BY expiry_date,id",
    )
    .bind(vehicleId)
    .all<DocRow>();
  return NextResponse.json({ documents: result.results.map(serialize) });
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
    db = getD1(),
    vehicleId = Number(form.get("vehicleId")),
    docType = String(form.get("docType") || "").trim(),
    expiryDate = dateToEpoch(form.get("expiryDate")),
    issueDate = dateToEpoch(form.get("issueDate")),
    now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0)
    return NextResponse.json(
      { error: "Veículo inválido" },
      { status: 400 },
    );
  const vehicle = await db
    .prepare("SELECT id,plate FROM vehicles WHERE id=?")
    .bind(vehicleId)
    .first<{ id: number; plate: string }>();
  if (!vehicle)
    return NextResponse.json(
      { error: "Veículo não encontrado" },
      { status: 404 },
    );
  if (!ALL_DOC_TYPES.includes(docType))
    return NextResponse.json(
      { error: "Tipo de documento inválido." },
      { status: 400 },
    );
  if (REQUIRED_VALIDITY.includes(docType) && !expiryDate)
    return NextResponse.json(
      { error: `Informe a data de validade do ${docType}.` },
      { status: 400 },
    );
  const file = form.get("file");
  if (file && !(file instanceof File))
    return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });
  let storageKey: string | null = null,
    fileName = "",
    contentType = "",
    sizeBytes = 0;
  if (file && file instanceof File && file.size) {
    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json(
        { error: "O arquivo deve ter no máximo 20 MB" },
        { status: 413 },
      );
    if (!ALLOWED_TYPES.has(file.type))
      return NextResponse.json(
        {
          error: "Formato não permitido. Envie o documento em PDF ou imagem (JPEG/PNG).",
        },
        { status: 415 },
      );
    const bytes = await file.arrayBuffer(),
      signature = new Uint8Array(bytes.slice(0, 128));
    if (!validSignature(signature, file.type))
      return NextResponse.json(
        { error: "O conteúdo do arquivo não corresponde ao formato informado." },
        { status: 415 },
      );
    if (file.type === "application/pdf") {
      const tail = new TextDecoder()
        .decode(bytes.slice(-2048))
        .replace(/\s+$/, "");
      if (!tail.includes("%%EOF"))
        return NextResponse.json(
          {
            error: "O PDF parece estar incompleto ou corrompido. Envie o arquivo original novamente.",
          },
          { status: 415 },
        );
      try {
        await PDFDocument.load(bytes, { ignoreEncryption: true });
      } catch {
        return NextResponse.json(
          {
            error: "Não foi possível ler o conteúdo deste PDF.",
          },
          { status: 415 },
        );
      }
    }
    storageKey = `vehicles/${vehicleId}/docs/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`;
    fileName = file.name;
    contentType = file.type;
    sizeBytes = file.size;
    try {
      await getFiles().put(storageKey, bytes, {
        httpMetadata: { contentType: file.type },
        customMetadata: { vehicleId: String(vehicleId) },
      });
    } catch {
      return NextResponse.json(
        {
          error: "Não foi possível salvar o arquivo. Tente novamente; se o problema persistir, confira o armazenamento.",
        },
        { status: 500 },
      );
    }
  }
  let row: DocRow | null = null;
  try {
    row = await db
      .prepare(
        `INSERT INTO vehicle_documents
         (vehicle_id,doc_type,number,issuing_body,issue_date,expiry_date,storage_key,file_name,content_type,size_bytes,notes,uploaded_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      )
      .bind(
        vehicleId,
        docType,
        String(form.get("number") || "").trim(),
        String(form.get("issuingBody") || "").trim(),
        issueDate,
        expiryDate,
        storageKey,
        fileName,
        contentType,
        sizeBytes || null,
        String(form.get("notes") || "").trim(),
        user.userId,
        now,
        now,
      )
      .first<DocRow>();
  } catch {
    if (storageKey) await getFiles().delete(storageKey).catch(() => undefined);
    return NextResponse.json(
      { error: "Não foi possível registrar o documento" },
      { status: 500 },
    );
  }
  if (!row) {
    if (storageKey) await getFiles().delete(storageKey).catch(() => undefined);
    return NextResponse.json(
      { error: "Não foi possível registrar o documento" },
      { status: 500 },
    );
  }
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','vehicle_document',?,?,?)",
    )
    .bind(
      user.userId,
      String(row.id),
      JSON.stringify({ vehicleId, plate: vehicle.plate, docType, fileName }),
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
    .prepare("SELECT * FROM vehicle_documents WHERE id=?")
    .bind(id)
    .first<DocRow>();
  if (!current)
    return NextResponse.json(
      { error: "Documento não encontrado" },
      { status: 404 },
    );
  const docType = String(body.docType ?? current.doc_type),
    expiryDate = dateToEpoch(body.expiryDate ?? fmtDate(current.expiry_date));
  if (!ALL_DOC_TYPES.includes(docType))
    return NextResponse.json(
      { error: "Tipo de documento inválido." },
      { status: 400 },
    );
  if (REQUIRED_VALIDITY.includes(docType) && !expiryDate)
    return NextResponse.json(
      { error: `Informe a data de validade do ${docType}.` },
      { status: 400 },
    );
  const now = Math.floor(Date.now() / 1000),
    updated = await db
      .prepare(
        `UPDATE vehicle_documents SET doc_type=?,number=?,issuing_body=?,issue_date=?,expiry_date=?,notes=?,updated_at=? WHERE id=? RETURNING *`,
      )
      .bind(
        docType,
        String(body.number ?? current.number ?? "").trim(),
        String(body.issuingBody ?? current.issuing_body ?? "").trim(),
        dateToEpoch(body.issueDate ?? fmtDate(current.issue_date)),
        expiryDate,
        String(body.notes ?? current.notes ?? "").trim(),
        now,
        id,
      )
      .first<DocRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar o documento" },
      { status: 500 },
    );
  return NextResponse.json({ document: serialize(updated) });
}

export async function DELETE(request: NextRequest) {
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
  const id = Number(request.nextUrl.searchParams.get("id")),
    db = getD1();
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json(
      { error: "Documento inválido" },
      { status: 400 },
    );
  const row = await db
    .prepare("SELECT * FROM vehicle_documents WHERE id=?")
    .bind(id)
    .first<DocRow>();
  if (!row)
    return NextResponse.json(
      { error: "Documento não encontrado" },
      { status: 404 },
    );
  const now = Math.floor(Date.now() / 1000);
  if (row.storage_key)
    await getFiles().delete(row.storage_key).catch(() => undefined);
  await db
    .prepare("DELETE FROM vehicle_documents WHERE id=?")
    .bind(id)
    .run();
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'delete','vehicle_document',?,?,?)",
    )
    .bind(
      user.userId,
      String(id),
      JSON.stringify({ vehicleId: row.vehicle_id, docType: row.doc_type, fileName: row.file_name ?? "" }),
      now,
    )
    .run();
  return NextResponse.json({ ok: true });
}
