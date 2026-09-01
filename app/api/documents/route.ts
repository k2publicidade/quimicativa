import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getD1, getFiles } from "../../../db";
import { canReadConfidential, canValidate, canWrite, getActor } from "../authz";

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
type FileRow = {
  id: number;
  record_id: number;
  storage_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  department: string;
  module: string;
  document_type: string;
  reference_date: number | null;
  expires_at: number | null;
  notes: string | null;
  status: string;
  checksum: string | null;
  batch_code: string | null;
  physical_location: string | null;
  confidentiality: string;
  page_count: number;
  version: number;
  validation_checklist: string;
  ocr_text: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  rejection_reason: string | null;
  updated_at: number;
  created_at: number;
  record_title?: string;
};

const serialize = (row: FileRow) => ({
  id: row.id,
  recordId: row.record_id,
  filename: row.filename,
  contentType: row.content_type,
  sizeBytes: row.size_bytes,
  department: row.department,
  module: row.module,
  documentType: row.document_type,
  referenceDate: row.reference_date
    ? new Date(row.reference_date * 1000).toISOString().slice(0, 10)
    : "",
  expiresAt: row.expires_at
    ? new Date(row.expires_at * 1000).toISOString().slice(0, 10)
    : "",
  notes: row.notes ?? "",
  status: row.status,
  checksum: row.checksum,
  batchCode: row.batch_code ?? "",
  physicalLocation: row.physical_location ?? "",
  confidentiality: row.confidentiality,
  pageCount: row.page_count,
  version: row.version,
  validationChecklist: JSON.parse(row.validation_checklist || "{}"),
  ocrText: row.ocr_text ?? "",
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at,
  rejectionReason: row.rejection_reason ?? "",
  createdAt: row.created_at,
  recordTitle: row.record_title ?? "",
});
const dateToEpoch = (value: FormDataEntryValue | null) => {
  if (!value) return null;
  const epoch = Math.floor(new Date(String(value)).getTime() / 1000);
  return Number.isFinite(epoch) ? epoch : null;
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
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
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
    downloadId = Number(request.nextUrl.searchParams.get("download"));
  if (Number.isInteger(downloadId) && downloadId > 0) {
    const row = await db
      .prepare("SELECT * FROM files WHERE id=?")
      .bind(downloadId)
      .first<FileRow>();
    if (!row)
      return NextResponse.json(
        { error: "Documento não encontrado" },
        { status: 404 },
      );
    if (row.confidentiality !== "internal" && !canReadConfidential(user))
      return NextResponse.json(
        { error: "Documento restrito à direção" },
        { status: 403 },
      );
    const object = await getFiles().get(row.storage_key);
    if (!object)
      return NextResponse.json(
        { error: "Arquivo indisponível" },
        { status: 404 },
      );
    await db
      .prepare(
        "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'download','file',?,?,?)",
      )
      .bind(
        user.userId,
        String(row.id),
        JSON.stringify({ filename: row.filename }),
        Math.floor(Date.now() / 1000),
      )
      .run();
    return new Response(object.body, {
      headers: {
        "Content-Type": row.content_type,
        "Content-Length": String(row.size_bytes),
        "Content-Disposition": `attachment; filename="${safeName(row.filename)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const recordId = Number(request.nextUrl.searchParams.get("recordId"));
  const query =
    Number.isInteger(recordId) && recordId > 0
      ? db
          .prepare(
            `SELECT f.*,r.title AS record_title FROM files f JOIN records r ON r.id=f.record_id WHERE f.record_id=? ${canReadConfidential(user) ? "" : "AND f.confidentiality = 'internal'"} ORDER BY f.created_at DESC`,
          )
          .bind(recordId)
      : db.prepare(
          `SELECT f.*,r.title AS record_title FROM files f JOIN records r ON r.id=f.record_id ${canReadConfidential(user) ? "" : "WHERE f.confidentiality = 'internal'"} ORDER BY f.created_at DESC LIMIT 100`,
        );
  const result = await query.all<FileRow>();
  const docs = result.results.map(serialize),
    now = Math.floor(Date.now() / 1000),
    thirtyDays = now + 30 * 86400,
    stats = await db
        .prepare(
          `SELECT COUNT(*) total,SUM(CASE WHEN status='review' THEN 1 ELSE 0 END) to_review,SUM(CASE WHEN expires_at BETWEEN ? AND ? THEN 1 ELSE 0 END) expiring,SUM(CASE WHEN status IN ('indexed','validated','archived') THEN 1 ELSE 0 END) count_indexed FROM files${canReadConfidential(user) ? "" : " WHERE confidentiality='internal'"}`,
        )
        .bind(now, thirtyDays)
        .first<{
          total: number;
          to_review: number;
          expiring: number;
          count_indexed: number;
        }>(),
      departmentStats = await db
        .prepare(
          `SELECT department,COUNT(*) total FROM files${canReadConfidential(user) ? "" : " WHERE confidentiality='internal'"} GROUP BY department`,
        )
        .all<{ department: string; total: number }>(),
    batches = await db
      .prepare("SELECT * FROM intake_batches ORDER BY updated_at DESC LIMIT 30")
      .all<Record<string, unknown>>();
  const byDepartment = Object.fromEntries(
    departmentStats.results.map((row) => [row.department, row.total]),
  );
  return NextResponse.json({
    documents: docs,
    batches: batches.results,
    summary: {
      total: stats?.total ?? 0,
      toReview: stats?.to_review ?? 0,
      expiring: stats?.expiring ?? 0,
      indexed: stats?.count_indexed ?? 0,
      byDepartment,
    },
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
          "Formato não permitido. Envie PDF, imagem TIFF/JPEG/PNG ou XML fiscal.",
      },
      { status: 415 },
    );
  const department = String(form.get("department") || ""),
    moduleName = String(form.get("module") || ""),
    documentType = String(form.get("documentType") || ""),
    notes = String(form.get("notes") || ""),
    ocrText = String(form.get("ocrText") || "").slice(0, 200000),
    batchCode = String(form.get("batchCode") || "").trim(),
    physicalLocation = String(form.get("physicalLocation") || "").trim(),
    responsible = String(form.get("responsible") || user.displayName).trim(),
    confidentiality = String(form.get("confidentiality") || "internal"),
    pageCount = Math.max(1, Math.min(5000, Number(form.get("pageCount")) || 1)),
    expectedDocuments = Math.max(1, Number(form.get("expectedDocuments")) || 1),
    expectedPages = Math.max(1, Number(form.get("expectedPages")) || pageCount),
    now = Math.floor(Date.now() / 1000),
    referenceDate = dateToEpoch(form.get("referenceDate")),
    expiresAt = dateToEpoch(form.get("expiresAt")),
    db = getD1();
  if (
    !department ||
    !moduleName ||
    !documentType ||
    !batchCode ||
    !physicalLocation ||
    !["internal", "restricted", "confidential"].includes(confidentiality) ||
    (confidentiality !== "internal" && !canReadConfidential(user))
  )
    return NextResponse.json(
      { error: "Classificação, lote, custódia ou nível de acesso inválido" },
      { status: 400 },
    );
  const bytes = await file.arrayBuffer(),
    signature = new Uint8Array(bytes.slice(0, 128));
  if (!validSignature(signature, file.type))
    return NextResponse.json(
      { error: "O conteúdo do arquivo não corresponde ao formato informado." },
      { status: 415 },
    );
  let realPageCount = pageCount;
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
      realPageCount = pdf.getPageCount();
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
  const digest = await crypto.subtle.digest("SHA-256", bytes),
    checksum = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    duplicate = await db
      .prepare("SELECT id,filename FROM files WHERE checksum=? LIMIT 1")
      .bind(checksum)
      .first<{ id: number; filename: string }>();
  if (duplicate)
    return NextResponse.json(
      {
        error: `Este arquivo já foi digitalizado como “${duplicate.filename}”.`,
        duplicateId: duplicate.id,
      },
      { status: 409 },
    );
  const existingBatch = await db
    .prepare(
      "SELECT department,module,status,responsible,physical_location,expected_documents,expected_pages FROM intake_batches WHERE code=?",
    )
    .bind(batchCode)
    .first<{
      department: string;
      module: string;
      status: string;
      responsible: string;
      physical_location: string;
      expected_documents: number;
      expected_pages: number;
    }>();
  if (
    existingBatch &&
    (existingBatch.department !== department ||
      existingBatch.module !== moduleName ||
      existingBatch.status !== "open" ||
      existingBatch.responsible !== responsible ||
      existingBatch.physical_location !== physicalLocation ||
      existingBatch.expected_documents !== expectedDocuments ||
      existingBatch.expected_pages !== expectedPages)
  )
    return NextResponse.json(
      {
        error:
          "O código do lote já existe com identidade, inventário ou custódia diferentes",
      },
      { status: 409 },
    );
  const requestedRecordId = Number(form.get("recordId"));
  if (Number.isInteger(requestedRecordId) && requestedRecordId > 0) {
    const linked = await db
      .prepare(
        "SELECT id FROM records WHERE id=? AND department=? AND module=?",
      )
      .bind(requestedRecordId, department, moduleName)
      .first();
    if (!linked)
      return NextResponse.json(
        { error: "O registro não pertence ao setor e módulo informados" },
        { status: 409 },
      );
  }
  const batchWasNew = !existingBatch;
  let recordId = requestedRecordId,
    createdRecord = false;
  if (!Number.isInteger(recordId) || recordId <= 0) {
    const created = await db
      .prepare(
        "INSERT INTO records (department,module,title,description,metadata,status,priority,owner_id,due_date,created_at,updated_at) VALUES ('digitalizacao','Triagem documental',?,?,?,'review','medium',?,?,?,?) RETURNING id",
      )
      .bind(
        `${documentType} — ${file.name}`,
        notes,
        JSON.stringify({
          source: "Acervo físico",
          migrationStatus: "Digitalizado",
        }),
        user.userId,
        expiresAt,
        now,
        now,
      )
      .first<{ id: number }>();
    if (!created)
      return NextResponse.json(
        { error: "Não foi possível criar o registro" },
        { status: 500 },
      );
    recordId = created.id;
    createdRecord = true;
  }
  const key = `documents/${department}/${moduleName}/${recordId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  let inserted: FileRow | null = null;
  try {
    await getFiles().put(key, bytes, {
      httpMetadata: { contentType: file.type },
      customMetadata: { uploadedBy: user.userId, recordId: String(recordId) },
    });
    inserted = await db
      .prepare(
        "INSERT INTO files (record_id,storage_key,filename,content_type,size_bytes,department,module,document_type,reference_date,expires_at,notes,status,checksum,batch_code,physical_location,confidentiality,page_count,version,validation_checklist,ocr_text,updated_at,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'{}',?,?,?,?) RETURNING *",
      )
      .bind(
        recordId,
        key,
        file.name,
        file.type,
        file.size,
        department,
        moduleName,
        documentType,
        referenceDate,
        expiresAt,
        notes,
        "review",
        checksum,
        batchCode,
        physicalLocation,
        confidentiality,
        realPageCount,
        ocrText,
        now,
        user.userId,
        now,
      )
      .first<FileRow>();
  } catch (error) {
    await getFiles().delete(key);
    if (createdRecord)
      await db.prepare("DELETE FROM records WHERE id=?").bind(recordId).run();
    if (batchWasNew)
      await db
        .prepare(
          "DELETE FROM intake_batches WHERE code=? AND received_documents=0",
        )
        .bind(batchCode)
        .run();
    const message = String(error);
    if (message.includes("UNIQUE") && message.includes("checksum")) {
      const duplicate = await db
        .prepare("SELECT id,filename FROM files WHERE checksum=? LIMIT 1")
        .bind(checksum)
        .first<{ id: number; filename: string }>();
      if (duplicate)
        return NextResponse.json(
          {
            error: `Este arquivo já foi digitalizado como “${duplicate.filename}”.`,
            duplicateId: duplicate.id,
          },
          { status: 409 },
        );
    }
    return NextResponse.json(
      {
        error:
          "Falha ao armazenar o documento; nenhuma alteração parcial foi mantida",
      },
      { status: 500 },
    );
  }
  if (!inserted) {
    await getFiles().delete(key);
    if (createdRecord)
      await db.prepare("DELETE FROM records WHERE id=?").bind(recordId).run();
    if (batchWasNew)
      await db
        .prepare(
          "DELETE FROM intake_batches WHERE code=? AND received_documents=0",
        )
        .bind(batchCode)
        .run();
    return NextResponse.json(
      { error: "Não foi possível indexar o documento" },
      { status: 500 },
    );
  }
  try {
    await db
      .prepare(
        "INSERT INTO intake_batches (code,department,module,responsible,physical_location,expected_documents,expected_pages,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING",
      )
      .bind(
        batchCode,
        department,
        moduleName,
        responsible,
        physicalLocation,
        expectedDocuments,
        expectedPages,
        user.userId,
        now,
        now,
      )
      .run();
    await db
      .prepare(
        "UPDATE intake_batches SET received_documents=received_documents+1,received_pages=received_pages+?,divergences=CASE WHEN received_documents+1>expected_documents OR received_pages+?>expected_pages THEN 'Quantidade recebida acima do inventário previsto' ELSE divergences END,updated_at=? WHERE code=?",
      )
      .bind(realPageCount, realPageCount, now, batchCode)
      .run();
  } catch {
    await db.prepare("DELETE FROM files WHERE id=?").bind(inserted.id).run();
    await getFiles().delete(key);
    if (createdRecord)
      await db.prepare("DELETE FROM records WHERE id=?").bind(recordId).run();
    if (batchWasNew)
      await db
        .prepare("DELETE FROM intake_batches WHERE code=?")
        .bind(batchCode)
        .run();
    return NextResponse.json(
      { error: "Falha ao atualizar o inventário do lote; upload revertido" },
      { status: 500 },
    );
  }
  try {
    await db
      .prepare(
        "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'upload','file',?,?,?)",
      )
      .bind(
        user.userId,
        String(inserted.id),
        JSON.stringify({
          filename: file.name,
          recordId,
          department,
          module: moduleName,
          batchCode,
          physicalLocation,
          checksum,
        }),
        now,
      )
      .run();
  } catch {
    // A auditoria não pode derrubar o upload já concluído
  }
  return NextResponse.json({ document: serialize(inserted) }, { status: 201 });
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
    allowedStatus = new Set([
      "review",
      "indexed",
      "validated",
      "archived",
      "rejected",
    ]);
  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !allowedStatus.has(String(body.status))
  )
    return NextResponse.json({ error: "Documento inválido" }, { status: 400 });
  const expires = body.expiresAt
      ? Math.floor(new Date(String(body.expiresAt)).getTime() / 1000)
      : null,
    reference = body.referenceDate
      ? Math.floor(new Date(String(body.referenceDate)).getTime() / 1000)
      : null,
    now = Math.floor(Date.now() / 1000),
    db = getD1();
  const current = await db
    .prepare("SELECT * FROM files WHERE id=?")
    .bind(id)
    .first<FileRow>();
  if (!current)
    return NextResponse.json(
      { error: "Documento não encontrado" },
      { status: 404 },
    );
  if (
    String(body.confidentiality || current.confidentiality) !== "internal" &&
    !canReadConfidential(user)
  )
    return NextResponse.json(
      { error: "Somente a direção pode classificar documentos restritos" },
      { status: 403 },
    );
  if (
    current.confidentiality !== "internal" &&
    body.confidentiality !== undefined &&
    body.confidentiality !== current.confidentiality &&
    !canReadConfidential(user)
  )
    return NextResponse.json(
      {
        error:
          "Somente a direção pode reclassificar documentos restritos ou confidenciais",
      },
      { status: 403 },
    );
  if (
    String(body.status) === current.status &&
    ["validated", "archived"].includes(current.status) &&
    !canValidate(user)
  )
    return NextResponse.json(
      { error: "Documento validado é imutável; solicite reabertura à gestão" },
      { status: 423 },
    );
  const statusLabels: Record<string, string> = {
    review: "A revisar",
    indexed: "Classificado",
    validated: "Validado",
    archived: "Arquivado",
    rejected: "Rejeitado",
  };
  const next = String(body.status),
    transitions: Record<string, string[]> = {
      review: ["indexed", "rejected"],
      rejected: ["review"],
      indexed: ["validated", "review"],
      validated: ["archived", "review"],
      archived: ["review"],
    };
  if (next !== current.status && !transitions[current.status]?.includes(next))
    return NextResponse.json(
      {
        error: `Não é possível mover o documento de “${statusLabels[current.status] ?? current.status}” para “${statusLabels[next] ?? next}”.`,
      },
      { status: 409 },
    );
  if (
    next !== current.status &&
    ["validated", "archived"].includes(next) &&
    !canValidate(user)
  )
    return NextResponse.json(
      { error: "Somente direção ou gestores podem validar e arquivar" },
      { status: 403 },
    );
  if (
    next !== current.status &&
    ["validated", "archived"].includes(current.status) &&
    !canValidate(user)
  )
    return NextResponse.json(
      {
        error:
          "Somente direção ou gestores podem reabrir um documento validado ou arquivado",
      },
      { status: 403 },
    );
  if (
    next !== current.status &&
    current.status === "archived" &&
    !String(body.rejectionReason || "").trim()
  )
    return NextResponse.json(
      { error: "Informe o motivo da reabertura do documento arquivado" },
      { status: 400 },
    );
  const checklist = (
      next === current.status
        ? JSON.parse(current.validation_checklist || "{}")
        : body.validationChecklist &&
            typeof body.validationChecklist === "object"
          ? body.validationChecklist
          : {}
    ) as Record<string, unknown>,
    required = ["complete", "legible", "classified", "custody"];
  if (
    next !== current.status &&
    next === "validated" &&
    !required.every((key) => checklist[key] === true)
  )
    return NextResponse.json(
      { error: "Conclua os quatro itens da conferência" },
      { status: 400 },
    );
  if (
    next !== current.status &&
    next === "rejected" &&
    !String(body.rejectionReason || "").trim()
  )
    return NextResponse.json(
      { error: "Informe o motivo da rejeição" },
      { status: 400 },
    );
  const clientVersion = Number(body.version),
    versionConflict =
      Number.isInteger(clientVersion) &&
      clientVersion > 0 &&
      clientVersion !== current.version;
  if (versionConflict)
    return NextResponse.json(
      {
        error:
          "Este documento foi alterado por outra pessoa enquanto você o editava. Recarregue a lista e tente novamente.",
      },
      { status: 409 },
    );
  const updated = await db
    .prepare(
      "UPDATE files SET document_type=?,reference_date=?,expires_at=?,notes=?,status=?,batch_code=?,physical_location=?,confidentiality=?,page_count=?,validation_checklist=?,ocr_text=?,reviewed_by=?,reviewed_at=?,rejection_reason=?,updated_at=?,version=version+1 WHERE id=? AND version=? RETURNING *",
    )
    .bind(
      String(body.documentType || current.document_type),
      reference,
      expires,
      String(body.notes || ""),
      next,
      String(body.batchCode || current.batch_code || ""),
      String(body.physicalLocation || current.physical_location || ""),
      String(body.confidentiality || current.confidentiality),
      Math.max(1, Math.min(5000, Number(body.pageCount) || 1)),
      JSON.stringify(checklist),
      String(body.ocrText ?? current.ocr_text ?? "").slice(0, 200000),
      user.userId,
      now,
      String(body.rejectionReason || ""),
      now,
      id,
      current.version,
    )
    .first<FileRow>();
  if (!updated) {
    const fresh = await db
      .prepare("SELECT version FROM files WHERE id=?")
      .bind(id)
      .first<{ version: number }>();
    return NextResponse.json(
      {
        error:
          fresh && fresh.version !== current.version
            ? "Este documento foi alterado por outra pessoa. Recarregue a lista e tente novamente."
            : "Documento não encontrado",
      },
      { status: fresh && fresh.version !== current.version ? 409 : 404 },
    );
  }
  try {
    await db
      .prepare(
        "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','file',?,?,?)",
      )
      .bind(
        user.userId,
        String(id),
        JSON.stringify({
          before: {
            documentType: current.document_type,
            status: current.status,
            batchCode: current.batch_code,
            physicalLocation: current.physical_location,
          },
          after: {
            documentType: updated.document_type,
            status: updated.status,
            batchCode: updated.batch_code,
            physicalLocation: updated.physical_location,
          },
          reviewer: user.userId,
          checklist,
          rejectionReason: String(body.rejectionReason || ""),
        }),
        now,
      )
      .run();
  } catch {
    // A auditoria não pode derrubar a atualização já aplicada
  }
  return NextResponse.json({ document: serialize(updated) });
}
