import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type DriverRow = {
  id: number; name: string; cpf: string | null; phone: string | null; license_number: string | null;
  license_category: string | null; license_expiry: number | null; mopp_expiry: number | null;
  status: string; notes: string | null;
};

const now = () => Math.floor(Date.now() / 1000);
const epoch = (value: unknown) => {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000);
};
const iso = (value: number | null) => value ? new Date(value * 1000).toISOString().slice(0, 10) : "";
const present = (row: DriverRow) => {
  const today = now(), warning = today + 30 * 86400;
  const alerts = [
    row.license_expiry && row.license_expiry < today ? "CNH vencida" : row.license_expiry && row.license_expiry <= warning ? "CNH vence em até 30 dias" : "",
    row.mopp_expiry && row.mopp_expiry < today ? "MOPP vencido" : row.mopp_expiry && row.mopp_expiry <= warning ? "MOPP vence em até 30 dias" : "",
  ].filter(Boolean);
  return { id: row.id, name: row.name, cpf: row.cpf ?? "", phone: row.phone ?? "", licenseNumber: row.license_number ?? "", licenseCategory: row.license_category ?? "", licenseExpiry: iso(row.license_expiry), moppExpiry: iso(row.mopp_expiry), status: row.status, notes: row.notes ?? "", alerts };
};

export async function GET() {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const result = await getD1().prepare("SELECT id,name,cpf,phone,license_number,license_category,license_expiry,mopp_expiry,status,notes FROM drivers ORDER BY status,name").all<DriverRow>();
  return NextResponse.json({ drivers: result.results.map(present) });
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>, name = String(body.name || "").trim(), cpf = String(body.cpf || "").replace(/\D/g, "") || null;
  if (name.length < 3) return NextResponse.json({ error: "Informe o nome completo do motorista." }, { status: 400 });
  if (cpf && cpf.length !== 11) return NextResponse.json({ error: "CPF deve conter 11 dígitos." }, { status: 400 });
  const timestamp = now(), db = getD1();
  try {
    const driver = await db.prepare("INSERT INTO drivers (name,cpf,phone,license_number,license_category,license_expiry,mopp_expiry,status,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *").bind(name, cpf, String(body.phone || "").trim(), String(body.licenseNumber || "").trim(), String(body.licenseCategory || "").trim().toUpperCase(), epoch(body.licenseExpiry), epoch(body.moppExpiry), String(body.status || "active"), String(body.notes || "").trim(), actor.userId, timestamp, timestamp).first<DriverRow>();
    await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','driver',?,?,?)").bind(actor.userId, String(driver?.id ?? ""), JSON.stringify({ name }), timestamp).run();
    return NextResponse.json({ driver: driver ? present(driver) : null }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error).toLowerCase().includes("unique") ? "Já existe um motorista com este CPF." : "Não foi possível cadastrar o motorista." }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>, id = Number(body.id), name = String(body.name || "").trim(), cpf = String(body.cpf || "").replace(/\D/g, "") || null;
  if (!Number.isInteger(id) || id <= 0 || name.length < 3) return NextResponse.json({ error: "Motorista ou nome inválido." }, { status: 400 });
  if (cpf && cpf.length !== 11) return NextResponse.json({ error: "CPF deve conter 11 dígitos." }, { status: 400 });
  const db = getD1(), timestamp = now();
  try {
    const driver = await db.prepare("UPDATE drivers SET name=?,cpf=?,phone=?,license_number=?,license_category=?,license_expiry=?,mopp_expiry=?,status=?,notes=?,updated_at=? WHERE id=? RETURNING *").bind(name, cpf, String(body.phone || "").trim(), String(body.licenseNumber || "").trim(), String(body.licenseCategory || "").trim().toUpperCase(), epoch(body.licenseExpiry), epoch(body.moppExpiry), String(body.status || "active"), String(body.notes || "").trim(), timestamp, id).first<DriverRow>();
    if (!driver) return NextResponse.json({ error: "Motorista não encontrado." }, { status: 404 });
    await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','driver',?,?,?)").bind(actor.userId, String(id), JSON.stringify({ name, status: driver.status }), timestamp).run();
    return NextResponse.json({ driver: present(driver) });
  } catch (error) {
    return NextResponse.json({ error: String(error).toLowerCase().includes("unique") ? "Já existe um motorista com este CPF." : "Não foi possível atualizar o motorista." }, { status: 409 });
  }
}
