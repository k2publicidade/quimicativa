import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type CustomerRow = {
  id: number;
  company_name: string;
  trading_name: string | null;
  document: string;
  state_registration: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  receiving_window: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  segment: string | null;
  lgpd_basis: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export const serializeCustomer = (row: CustomerRow) => ({
  id: row.id,
  companyName: row.company_name,
  tradingName: row.trading_name ?? "",
  document: row.document ?? "",
  stateRegistration: row.state_registration ?? "",
  street: row.street ?? "",
  number: row.number ?? "",
  complement: row.complement ?? "",
  district: row.district ?? "",
  city: row.city ?? "",
  state: row.state ?? "",
  zipCode: row.zip_code ?? "",
  receivingWindow: row.receiving_window ?? "",
  contactName: row.contact_name ?? "",
  contactEmail: row.contact_email ?? "",
  contactPhone: row.contact_phone ?? "",
  segment: row.segment ?? "",
  lgpdBasis: row.lgpd_basis,
  status: row.status,
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const displayAddress = (c: ReturnType<typeof serializeCustomer>) => {
  const parts = [
    [c.street, c.number].filter(Boolean).join(", "),
    c.complement,
    c.district,
    [c.city, c.state].filter(Boolean).join("/"),
    c.zipCode,
  ].filter(Boolean);
  return parts.join(" · ");
};

const LGPD_BASIS = [
  "Consentimento",
  "Execução de contrato",
  "Obrigação legal",
  "Legítimo interesse",
];
const SEGMENTS = [
  "Indústria",
  "Distribuidor",
  "Varejo",
  "Agronegócio",
  "Serviços",
  "Outro",
];
const STATUS = ["active", "inactive"];

export function validateCustomerBody(
  body: Record<string, unknown>,
): string | null {
  const companyName = String(body.companyName || "").trim();
  if (!companyName) return "Informe o nome / razão social do cliente.";
  if (companyName.length > 200)
    return "Nome do cliente muito longo (máximo 200 caracteres).";
  const document = String(body.document || "").trim();
  if (document) {
    const digits = document.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14)
      return "Documento inválido. Informe um CNPJ (14 dígitos) ou CPF (11 dígitos).";
  }
  const state = String(body.state || "").trim();
  if (state && !/^[A-Za-z]{2}$/.test(state))
    return "Estado deve ter 2 letras (ex.: SP).";
  const lgpdBasis = String(body.lgpdBasis || "");
  if (lgpdBasis && !LGPD_BASIS.includes(lgpdBasis))
    return "Base legal LGPD inválida. Escolha uma das opções da lista.";
  const segment = String(body.segment || "");
  if (segment && !SEGMENTS.includes(segment))
    return "Segmento inválido. Escolha uma das opções da lista.";
  const status = String(body.status || "active");
  if (!STATUS.includes(status))
    return "Situação inválida. Use Ativo ou Inativo.";
  const email = String(body.contactEmail || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return "E-mail de contato inválido.";
  if (String(body.receivingWindow || "").trim().length > 120)
    return "Janela de recebimento muito longa (máximo 120 caracteres).";
  return null;
}

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  const db = getD1(),
    id = Number(request.nextUrl.searchParams.get("id")),
    q = String(request.nextUrl.searchParams.get("q") || "").trim(),
    status = String(request.nextUrl.searchParams.get("status") || "").trim();
  if (Number.isInteger(id) && id > 0) {
    const row = await db
      .prepare("SELECT * FROM customers WHERE id=?")
      .bind(id)
      .first<CustomerRow>();
    if (!row)
      return NextResponse.json(
        { error: "Cliente não encontrado" },
        { status: 404 },
      );
    return NextResponse.json({ customer: serializeCustomer(row) });
  }
  let sql = "SELECT * FROM customers WHERE 1=1";
  const params: (string | number)[] = [];
  if (q) {
    sql +=
      " AND (company_name LIKE ? OR trading_name LIKE ? OR document LIKE ? OR city LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (status) {
    sql += " AND status=?";
    params.push(status);
  }
  sql += " ORDER BY company_name ASC";
  const result = await db.prepare(sql).bind(...params).all<CustomerRow>();
  return NextResponse.json({
    customers: result.results.map(serializeCustomer),
  });
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  if (!canWrite(actor))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>;
  const validationError = validateCustomerBody(body);
  if (validationError)
    return NextResponse.json({ error: validationError }, { status: 400 });
  const now = Math.floor(Date.now() / 1000),
    db = getD1(),
    created = await db
      .prepare(
        `INSERT INTO customers
         (company_name,trading_name,document,state_registration,street,number,complement,district,city,state,zip_code,
          receiving_window,contact_name,contact_email,contact_phone,segment,lgpd_basis,status,notes,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      )
      .bind(
        String(body.companyName || "").trim(),
        String(body.tradingName || "").trim(),
        String(body.document || "").trim(),
        String(body.stateRegistration || "").trim(),
        String(body.street || "").trim(),
        String(body.number || "").trim(),
        String(body.complement || "").trim(),
        String(body.district || "").trim(),
        String(body.city || "").trim(),
        String(body.state || "").trim().toUpperCase(),
        String(body.zipCode || "").trim(),
        String(body.receivingWindow || "").trim(),
        String(body.contactName || "").trim(),
        String(body.contactEmail || "").trim(),
        String(body.contactPhone || "").trim(),
        String(body.segment || "").trim(),
        String(body.lgpdBasis || "Execução de contrato"),
        String(body.status || "active"),
        String(body.notes || "").trim(),
        actor.userId,
        now,
        now,
      )
      .first<CustomerRow>();
  if (!created)
    return NextResponse.json(
      { error: "Não foi possível salvar o cliente" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','customer',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({ name: created.company_name }),
      now,
    )
    .run();
  return NextResponse.json(
    { customer: serializeCustomer(created) },
    { status: 201 },
  );
}

export async function PUT(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  if (!canWrite(actor))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>,
    id = Number(body.id),
    db = getD1();
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
  const current = await db
    .prepare("SELECT * FROM customers WHERE id=?")
    .bind(id)
    .first<CustomerRow>();
  if (!current)
    return NextResponse.json(
      { error: "Cliente não encontrado" },
      { status: 404 },
    );
  const candidate = {
    companyName: body.companyName ?? current.company_name,
    document: body.document ?? current.document ?? "",
    state: body.state ?? current.state ?? "",
    lgpdBasis: body.lgpdBasis ?? current.lgpd_basis,
    segment: body.segment ?? current.segment ?? "",
    status: body.status ?? current.status,
    contactEmail: body.contactEmail ?? current.contact_email ?? "",
    receivingWindow: body.receivingWindow ?? current.receiving_window ?? "",
  };
  const validationError = validateCustomerBody(candidate);
  if (validationError)
    return NextResponse.json({ error: validationError }, { status: 400 });
  const now = Math.floor(Date.now() / 1000),
    updated = await db
      .prepare(
        `UPDATE customers SET
         company_name=?,trading_name=?,document=?,state_registration=?,street=?,number=?,complement=?,district=?,city=?,state=?,zip_code=?,receiving_window=?,
         contact_name=?,contact_email=?,contact_phone=?,segment=?,lgpd_basis=?,status=?,notes=?,updated_at=?
         WHERE id=? RETURNING *`,
      )
      .bind(
        String(body.companyName ?? current.company_name).trim(),
        String(body.tradingName ?? current.trading_name ?? "").trim(),
        String(body.document ?? current.document ?? "").trim(),
        String(body.stateRegistration ?? current.state_registration ?? "").trim(),
        String(body.street ?? current.street ?? "").trim(),
        String(body.number ?? current.number ?? "").trim(),
        String(body.complement ?? current.complement ?? "").trim(),
        String(body.district ?? current.district ?? "").trim(),
        String(body.city ?? current.city ?? "").trim(),
        String(body.state ?? current.state ?? "").trim().toUpperCase(),
        String(body.zipCode ?? current.zip_code ?? "").trim(),
        String(body.receivingWindow ?? current.receiving_window ?? "").trim(),
        String(body.contactName ?? current.contact_name ?? "").trim(),
        String(body.contactEmail ?? current.contact_email ?? "").trim(),
        String(body.contactPhone ?? current.contact_phone ?? "").trim(),
        String(body.segment ?? current.segment ?? "").trim(),
        String(body.lgpdBasis ?? current.lgpd_basis),
        String(body.status ?? current.status),
        String(body.notes ?? current.notes ?? "").trim(),
        now,
        id,
      )
      .first<CustomerRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar o cliente" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','customer',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({
        before: { name: current.company_name, status: current.status },
        after: { name: updated.company_name, status: updated.status },
      }),
      now,
    )
    .run();
  return NextResponse.json({ customer: serializeCustomer(updated) });
}
