import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { getModuleConfig } from "../../module-config";
import { canWrite, getActor } from "../authz";

type RecordRow = {
  source_payload?: unknown;
  id: number;
  department: string;
  module: string;
  title: string;
  description: string | null;
  metadata: string;
  status: string;
  priority: string;
  owner_id: string | null;
  due_date: number | null;
  amount_cents: number | null;
  created_at: number;
  updated_at: number;
};

function serialize(row: RecordRow) {
  return {
    id: row.id,
    erpSnapshot: typeof row.source_payload === 'string' ? safeMetadata(row.source_payload) : row.source_payload,
    department: row.department,
    module: row.module,
    title: row.title,
    description: row.description ?? "",
    status: row.status,
    priority: row.priority,
    ownerId: row.owner_id,
    dueDate: row.due_date
      ? new Date(row.due_date * 1000).toISOString().slice(0, 10)
      : "",
    amountCents: row.amount_cents ?? 0,
    metadata: safeMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeMetadata(value: string | null): Record<string, string> {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

const allowedDepartments = new Set([
  "rh",
  "logistica",
  "embalagem",
  "vendas",
  "compras",
  "financeiro",
]);
function validateDomain(
  department: string,
  moduleName: string,
  body?: Record<string, unknown>,
) {
  const config = getModuleConfig(moduleName);
  if (!allowedDepartments.has(department) || !config.fields.length)
    return false;
  if (body) {
    const status = String(body.status ?? config.statuses[0].value),
      priority = String(body.priority ?? "medium"),
      metadata = (
        body.metadata && typeof body.metadata === "object" ? body.metadata : {}
      ) as Record<string, unknown>;
    const fieldsValid = config.fields.every((field) => {
      const value = String(metadata[field.key] ?? "").trim();
      if (field.required && !value) return false;
      if (!value) return true;
      if (field.type === "number") return Number.isFinite(Number(value));
      if (field.type === "date")
        return (
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(new Date(`${value}T12:00:00`).getTime())
        );
      if (field.type === "select")
        return Boolean(field.options?.includes(value));
      return value.length <= 500;
    });
    if (
      !config.statuses.some((s) => s.value === status) ||
      !["low", "medium", "high", "critical"].includes(priority) ||
      !fieldsValid ||
      Object.keys(metadata).some(
        (key) => !config.fields.some((f) => f.key === key),
      )
    )
      return false;
  }
  return true;
}

export async function GET(request: NextRequest) {
  const user = await getActor();
  if (!user)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  const department = request.nextUrl.searchParams.get("department")?.trim();
  const moduleName = request.nextUrl.searchParams.get("module")?.trim();
  if (!department || !moduleName || !validateDomain(department, moduleName))
    return NextResponse.json(
      { error: "Setor ou módulo inválido" },
      { status: 400 },
    );
  const db = getD1();
  const result = await db
    .prepare(
      "SELECT * FROM records WHERE department = ? AND module = ? ORDER BY updated_at DESC",
    )
    .bind(department, moduleName)
    .all<RecordRow>();
  return NextResponse.json({ records: result.results.map(serialize) });
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
  const body = (await request.json()) as Record<string, unknown>;
  const department = String(body.department ?? "").trim(),
    moduleName = String(body.module ?? "").trim(),
    title = String(body.title ?? "").trim();
  if (
    !department ||
    !moduleName ||
    !title ||
    !validateDomain(department, moduleName, body)
  )
    return NextResponse.json(
      { error: "Dados incompatíveis com o módulo" },
      { status: 400 },
    );
  const now = Math.floor(Date.now() / 1000),
    due = body.dueDate
      ? Math.floor(new Date(String(body.dueDate)).getTime() / 1000)
      : null;
  const db = getD1();
  const inserted = await db
    .prepare(
      "INSERT INTO records (department,module,title,description,metadata,status,priority,owner_id,due_date,amount_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *",
    )
    .bind(
      department,
      moduleName,
      title,
      String(body.description ?? ""),
      JSON.stringify(body.metadata ?? {}),
      String(body.status ?? "active"),
      String(body.priority ?? "medium"),
      user.userId,
      due,
      Number(body.amountCents ?? 0),
      now,
      now,
    )
    .first<RecordRow>();
  if (!inserted)
    return NextResponse.json(
      { error: "Não foi possível salvar" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','record',?,?,?)",
    )
    .bind(user.userId, String(inserted.id), title, now)
    .run();
  return NextResponse.json({ record: serialize(inserted) }, { status: 201 });
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
    title = String(body.title ?? "").trim(),
    department = String(body.department ?? "").trim(),
    moduleName = String(body.module ?? "").trim();
  if (
    !Number.isInteger(id) ||
    !title ||
    !department ||
    !moduleName ||
    !validateDomain(department, moduleName, body)
  )
    return NextResponse.json({ error: "Registro inválido" }, { status: 400 });
  const due = body.dueDate
      ? Math.floor(new Date(String(body.dueDate)).getTime() / 1000)
      : null,
    now = Math.floor(Date.now() / 1000),
    db = getD1();
  const updated = await db
    .prepare(
      "UPDATE records SET title=?,description=?,metadata=?,status=?,priority=?,due_date=?,amount_cents=?,updated_at=? WHERE id=? AND department=? AND module=? AND source_key IS NULL RETURNING *",
    )
    .bind(
      title,
      String(body.description ?? ""),
      JSON.stringify(body.metadata ?? {}),
      String(body.status ?? "active"),
      String(body.priority ?? "medium"),
      due,
      Number(body.amountCents ?? 0),
      now,
      id,
      department,
      moduleName,
    )
    .first<RecordRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Registro não encontrado" },
      { status: 404 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','record',?,?,?)",
    )
    .bind(user.userId, String(id), title, now)
    .run();
  return NextResponse.json({ record: serialize(updated) });
}
