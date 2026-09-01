import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type SupplierRow = {
  id: number;
  company_name: string;
  cnpj: string;
  state_registration: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  certificates: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

const parseCertificates = (value: string): { type: string; expiry: string }[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const serialize = (row: SupplierRow) => ({
  id: row.id,
  companyName: row.company_name,
  cnpj: row.cnpj,
  stateRegistration: row.state_registration ?? "",
  contactName: row.contact_name ?? "",
  contactEmail: row.contact_email ?? "",
  contactPhone: row.contact_phone ?? "",
  certificates: parseCertificates(row.certificates),
  status: row.status,
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const onlyDigits = (value: string) => value.replace(/\D/g, "");

export async function GET() {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(),
    rows = await db
      .prepare("SELECT * FROM suppliers ORDER BY company_name")
      .all<SupplierRow>(),
    now = Math.floor(Date.now() / 1000),
    day = 86400;
  const suppliers = rows.results.map(serialize);
  const expired = suppliers.filter((supplier) =>
    supplier.certificates.some(
      (cert) => cert.expiry && new Date(cert.expiry).getTime() / 1000 < now,
    ),
  ).length;
  const expiringSoon = suppliers.filter((supplier) =>
    supplier.certificates.some((cert) => {
      if (!cert.expiry) return false;
      const epoch = new Date(cert.expiry).getTime() / 1000;
      return epoch >= now && epoch <= now + 30 * day;
    }),
  ).length;
  return NextResponse.json({
    suppliers,
    summary: {
      total: suppliers.length,
      active: suppliers.filter((supplier) => supplier.status === "active").length,
      expired,
      expiringSoon,
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
    companyName = String(body.companyName || "").trim(),
    cnpj = onlyDigits(String(body.cnpj || ""));
  if (!companyName || cnpj.length < 14)
    return NextResponse.json(
      { error: "Informe a razão social e um CNPJ válido" },
      { status: 400 },
    );
  const now = Math.floor(Date.now() / 1000),
    db = getD1(),
    duplicate = await db
      .prepare("SELECT id FROM suppliers WHERE cnpj=?")
      .bind(cnpj)
      .first();
  if (duplicate)
    return NextResponse.json(
      { error: "Já existe um fornecedor cadastrado com este CNPJ" },
      { status: 409 },
    );
  const certificates = Array.isArray(body.certificates)
    ? body.certificates
    : [];
  const created = await db
    .prepare(
      "INSERT INTO suppliers (company_name,cnpj,state_registration,contact_name,contact_email,contact_phone,certificates,status,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *",
    )
    .bind(
      companyName,
      cnpj,
      String(body.stateRegistration || ""),
      String(body.contactName || ""),
      String(body.contactEmail || ""),
      String(body.contactPhone || ""),
      JSON.stringify(certificates),
      String(body.status || "active"),
      String(body.notes || ""),
      actor.userId,
      now,
      now,
    )
    .first<SupplierRow>();
  if (!created)
    return NextResponse.json(
      { error: "Não foi possível cadastrar o fornecedor" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','supplier',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({ companyName, cnpj }),
      now,
    )
    .run();
  return NextResponse.json({ supplier: serialize(created) }, { status: 201 });
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
    return NextResponse.json({ error: "Fornecedor inválido" }, { status: 400 });
  const current = await db
    .prepare("SELECT * FROM suppliers WHERE id=?")
    .bind(id)
    .first<SupplierRow>();
  if (!current)
    return NextResponse.json(
      { error: "Fornecedor não encontrado" },
      { status: 404 },
    );
  const companyName = String(body.companyName || current.company_name).trim(),
    cnpj = onlyDigits(String(body.cnpj || current.cnpj));
  if (!companyName || cnpj.length < 14)
    return NextResponse.json(
      { error: "Informe a razão social e um CNPJ válido" },
      { status: 400 },
    );
  const now = Math.floor(Date.now() / 1000),
    updated = await db
      .prepare(
        "UPDATE suppliers SET company_name=?,cnpj=?,state_registration=?,contact_name=?,contact_email=?,contact_phone=?,certificates=?,status=?,notes=?,updated_at=? WHERE id=? RETURNING *",
      )
      .bind(
        companyName,
        cnpj,
        String(body.stateRegistration ?? current.state_registration ?? ""),
        String(body.contactName ?? current.contact_name ?? ""),
        String(body.contactEmail ?? current.contact_email ?? ""),
        String(body.contactPhone ?? current.contact_phone ?? ""),
        JSON.stringify(
          Array.isArray(body.certificates)
            ? body.certificates
            : parseCertificates(current.certificates),
        ),
        String(body.status || current.status),
        String(body.notes ?? current.notes ?? ""),
        now,
        id,
      )
      .first<SupplierRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar o fornecedor" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','supplier',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({
        before: { companyName: current.company_name },
        after: { companyName: updated.company_name },
      }),
      now,
    )
    .run();
  return NextResponse.json({ supplier: serialize(updated) });
}
