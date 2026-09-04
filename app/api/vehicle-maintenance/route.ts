import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type MaintRow = {
  id: number;
  vehicle_id: number;
  maint_type: string;
  service_date: number;
  odometer_km: number;
  description: string | null;
  supplier: string | null;
  cost_cents: number;
  next_due_km: number | null;
  next_due_date: number | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};
type VehicleRow = {
  id: number;
  plate: string;
  model: string;
  maint_interval_km: number | null;
  maint_interval_months: number | null;
};
const DAY = 86400;
const STATUSES = [
  { value: "scheduled", label: "Agendada" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluída" },
  { value: "cancelled", label: "Cancelada" },
];
const fmt = (epoch: number | null | undefined) =>
  epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : "";
export const serializeMaint = (row: MaintRow, plate = "", model = "") => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  plate,
  model,
  maintType: row.maint_type,
  serviceDate: fmt(row.service_date),
  odometerKm: row.odometer_km,
  description: row.description ?? "",
  supplier: row.supplier ?? "",
  costCents: row.cost_cents,
  nextDueKm: row.next_due_km,
  nextDueDate: fmt(row.next_due_date),
  status: row.status,
  notes: row.notes ?? "",
  createdAt: row.created_at,
});
export const maintStatusLabel = (value: string) =>
  STATUSES.find((s) => s.value === value)?.label ?? value;

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  const db = getD1(),
    vehicleId = Number(request.nextUrl.searchParams.get("vehicleId")),
    limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 100));
  const rows = await db
    .prepare(
      `SELECT m.*,v.plate,v.model FROM vehicle_maintenance m
       JOIN vehicles v ON v.id=m.vehicle_id
       ${Number.isInteger(vehicleId) && vehicleId > 0 ? "WHERE m.vehicle_id=?" : ""}
       ORDER BY m.service_date DESC,m.id DESC LIMIT ?`,
    )
    .bind(
      ...(Number.isInteger(vehicleId) && vehicleId > 0 ? [vehicleId] : []),
      limit,
    )
    .all<MaintRow & { plate: string; model: string }>();
  return NextResponse.json({
    maintenance: rows.results.map((row) => serializeMaint(row, row.plate, row.model)),
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
  const body = (await request.json()) as Record<string, unknown>,
    db = getD1(),
    vehicleId = Number(body.vehicleId);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0)
    return NextResponse.json(
      { error: "Selecione o veículo da manutenção." },
      { status: 400 },
    );
  const vehicle = await db
    .prepare(
      "SELECT id,plate,model,maint_interval_km,maint_interval_months FROM vehicles WHERE id=?",
    )
    .bind(vehicleId)
    .first<VehicleRow>();
  if (!vehicle)
    return NextResponse.json(
      { error: "Veículo não encontrado" },
      { status: 404 },
    );
  const maintType = String(body.maintType || "Preventiva").trim(),
    status = String(body.status || "completed"),
    odometerKm = Number(body.odometerKm ?? 0),
    costCents = Number(body.costCents ?? 0);
  if (!["Preventiva", "Corretiva", "Inspeção", "Pneus", "Outro"].includes(maintType))
    return NextResponse.json(
      { error: "Tipo de manutenção inválido." },
      { status: 400 },
    );
  if (!STATUSES.some((s) => s.value === status))
    return NextResponse.json(
      { error: "Situação da manutenção inválida." },
      { status: 400 },
    );
  if (!Number.isFinite(odometerKm) || odometerKm < 0 || odometerKm > 9_999_999)
    return NextResponse.json(
      { error: "Odômetro (km) inválido." },
      { status: 400 },
    );
  if (!Number.isFinite(costCents) || costCents < 0 || Math.round(costCents) !== costCents)
    return NextResponse.json({ error: "Custo inválido." }, { status: 400 });
  let serviceEpoch: number;
  const rawDate = String(body.serviceDate || "").trim();
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    serviceEpoch = Math.floor(new Date(`${rawDate}T12:00:00`).getTime() / 1000);
    if (!Number.isFinite(serviceEpoch))
      return NextResponse.json(
        { error: "Data da manutenção inválida." },
        { status: 400 },
      );
  } else serviceEpoch = Math.floor(Date.now() / 1000);
  const isDone = status === "completed";
  const nextDueKm =
    isDone && vehicle.maint_interval_km !== null
      ? odometerKm + vehicle.maint_interval_km
      : null;
  const nextDueDate =
    isDone && vehicle.maint_interval_months !== null
      ? serviceEpoch + vehicle.maint_interval_months * 30 * DAY
      : null;
  const now = Math.floor(Date.now() / 1000),
    created = await db
      .prepare(
        `INSERT INTO vehicle_maintenance
         (vehicle_id,maint_type,service_date,odometer_km,description,supplier,cost_cents,next_due_km,next_due_date,status,notes,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      )
      .bind(
        vehicleId,
        maintType,
        serviceEpoch,
        odometerKm,
        String(body.description || "").trim(),
        String(body.supplier || "").trim(),
        costCents,
        nextDueKm,
        nextDueDate,
        status,
        String(body.notes || "").trim(),
        actor.userId,
        now,
        now,
      )
      .first<MaintRow>();
  if (!created)
    return NextResponse.json(
      { error: "Não foi possível registrar a manutenção" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','vehicle_maintenance',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({
        vehicleId,
        plate: vehicle.plate,
        maintType,
        odometerKm,
        nextDueKm,
      }),
      now,
    )
    .run();
  return NextResponse.json(
    { maintenance: serializeMaint(created, vehicle.plate, vehicle.model) },
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
    return NextResponse.json(
      { error: "Manutenção inválida" },
      { status: 400 },
    );
  const current = await db
    .prepare("SELECT * FROM vehicle_maintenance WHERE id=?")
    .bind(id)
    .first<MaintRow>();
  if (!current)
    return NextResponse.json(
      { error: "Manutenção não encontrada" },
      { status: 404 },
    );
  const vehicle = await db
    .prepare(
      "SELECT id,plate,model,maint_interval_km,maint_interval_months FROM vehicles WHERE id=?",
    )
    .bind(current.vehicle_id)
    .first<VehicleRow>();
  const maintType = String(body.maintType ?? current.maint_type),
    status = String(body.status ?? current.status),
    odometerKm = Number(body.odometerKm ?? current.odometer_km),
    costCents = Number(body.costCents ?? current.cost_cents);
  if (!["Preventiva", "Corretiva", "Inspeção", "Pneus", "Outro"].includes(maintType))
    return NextResponse.json(
      { error: "Tipo de manutenção inválido." },
      { status: 400 },
    );
  if (!STATUSES.some((s) => s.value === status))
    return NextResponse.json(
      { error: "Situação da manutenção inválida." },
      { status: 400 },
    );
  if (!Number.isFinite(odometerKm) || odometerKm < 0 || odometerKm > 9_999_999)
    return NextResponse.json(
      { error: "Odômetro (km) inválido." },
      { status: 400 },
    );
  const rawDate = String(body.serviceDate ?? fmt(current.service_date)).trim();
  const serviceEpoch = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? Math.floor(new Date(`${rawDate}T12:00:00`).getTime() / 1000)
    : current.service_date;
  const isDone = status === "completed";
  const now = Math.floor(Date.now() / 1000),
    updated = await db
      .prepare(
        `UPDATE vehicle_maintenance SET
         maint_type=?,service_date=?,odometer_km=?,description=?,supplier=?,cost_cents=?,
         next_due_km=?,next_due_date=?,status=?,notes=?,updated_at=? WHERE id=? RETURNING *`,
      )
      .bind(
        maintType,
        serviceEpoch,
        odometerKm,
        String(body.description ?? current.description ?? "").trim(),
        String(body.supplier ?? current.supplier ?? "").trim(),
        costCents,
        isDone && vehicle?.maint_interval_km !== null
          ? odometerKm + (vehicle?.maint_interval_km ?? 0)
          : null,
        isDone && vehicle?.maint_interval_months !== null
          ? serviceEpoch + (vehicle?.maint_interval_months ?? 0) * 30 * DAY
          : null,
        status,
        String(body.notes ?? current.notes ?? "").trim(),
        now,
        id,
      )
      .first<MaintRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar a manutenção" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','vehicle_maintenance',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({ status, maintType }),
      now,
    )
    .run();
  return NextResponse.json({
    maintenance: serializeMaint(updated, vehicle?.plate ?? "", vehicle?.model ?? ""),
  });
}

export async function DELETE(request: NextRequest) {
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
  const id = Number(request.nextUrl.searchParams.get("id")),
    db = getD1();
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json(
      { error: "Manutenção inválida" },
      { status: 400 },
    );
  const row = await db
    .prepare("SELECT * FROM vehicle_maintenance WHERE id=?")
    .bind(id)
    .first<MaintRow>();
  if (!row)
    return NextResponse.json(
      { error: "Manutenção não encontrada" },
      { status: 404 },
    );
  await db.prepare("DELETE FROM vehicle_maintenance WHERE id=?").bind(id).run();
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'delete','vehicle_maintenance',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({ vehicleId: row.vehicle_id }),
      Math.floor(Date.now() / 1000),
    )
    .run();
  return NextResponse.json({ ok: true });
}
