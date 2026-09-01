import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type LicenseRow = {
  id: number;
  license_type: string;
  issuing_agency: string;
  number: string;
  validity_date: number | null;
  scope: string | null;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

const serialize = (row: LicenseRow) => ({
  id: row.id,
  licenseType: row.license_type,
  issuingAgency: row.issuing_agency,
  number: row.number,
  validityDate: row.validity_date
    ? new Date(row.validity_date * 1000).toISOString().slice(0, 10)
    : "",
  scope: row.scope ?? "",
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

const deriveStatus = (
  status: string,
  validityDate: number | null,
  now: number,
): string => {
  if (status !== "active") return status;
  if (!validityDate) return "active";
  const day = 86400,
    today = Math.floor(now / day) * day;
  if (validityDate < today) return "expired";
  return status;
};

export async function GET() {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(),
    rows = await db
      .prepare("SELECT * FROM licenses ORDER BY validity_date ASC")
      .all<LicenseRow>(),
    now = Math.floor(Date.now() / 1000),
    day = 86400,
    today = Math.floor(now / day) * day;
  const items = rows.results.map((row) => ({
    ...serialize(row),
    effectiveStatus: deriveStatus(row.status, row.validity_date, now),
  }));
  return NextResponse.json({
    licenses: items,
    summary: {
      total: items.length,
      active: items.filter((item) => item.effectiveStatus === "active").length,
      expired: items.filter((item) => item.effectiveStatus === "expired").length,
      expiringSoon: items.filter(
        (item) =>
          item.effectiveStatus === "active" &&
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
  const body = (await request.json()) as Record<string, unknown>,
    licenseType = String(body.licenseType || "").trim(),
    issuingAgency = String(body.issuingAgency || "").trim(),
    number = String(body.number || "").trim();
  if (!licenseType || !issuingAgency || !number)
    return NextResponse.json(
      { error: "Informe o tipo, o órgão emissor e o número da licença" },
      { status: 400 },
    );
  const now = Math.floor(Date.now() / 1000),
    db = getD1(),
    created = await db
      .prepare(
        "INSERT INTO licenses (license_type,issuing_agency,number,validity_date,scope,status,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *",
      )
      .bind(
        licenseType,
        issuingAgency,
        number,
        dateToEpoch(body.validityDate),
        String(body.scope || ""),
        String(body.status || "active"),
        String(body.notes || ""),
        actor.userId,
        now,
        now,
      )
      .first<LicenseRow>();
  if (!created)
    return NextResponse.json(
      { error: "Não foi possível cadastrar a licença" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','license',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({ licenseType, issuingAgency, number }),
      now,
    )
    .run();
  return NextResponse.json({ license: serialize(created) }, { status: 201 });
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
    return NextResponse.json({ error: "Licença inválida" }, { status: 400 });
  const current = await db
    .prepare("SELECT * FROM licenses WHERE id=?")
    .bind(id)
    .first<LicenseRow>();
  if (!current)
    return NextResponse.json(
      { error: "Licença não encontrada" },
      { status: 404 },
    );
  const now = Math.floor(Date.now() / 1000),
    updated = await db
      .prepare(
        "UPDATE licenses SET license_type=?,issuing_agency=?,number=?,validity_date=?,scope=?,status=?,notes=?,updated_at=? WHERE id=? RETURNING *",
      )
      .bind(
        String(body.licenseType || current.license_type),
        String(body.issuingAgency || current.issuing_agency),
        String(body.number || current.number),
        dateToEpoch(body.validityDate) ?? current.validity_date,
        String(body.scope ?? current.scope ?? ""),
        String(body.status || current.status),
        String(body.notes ?? current.notes ?? ""),
        now,
        id,
      )
      .first<LicenseRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar a licença" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','license',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({
        before: { number: current.number, status: current.status },
        after: { number: updated.number, status: updated.status },
      }),
      now,
    )
    .run();
  return NextResponse.json({ license: serialize(updated) });
}
