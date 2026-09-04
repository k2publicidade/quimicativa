import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type VehicleRow = {
  id: number;
  plate: string;
  renavam: string | null;
  chassis: string | null;
  brand: string;
  model: string;
  model_year: number | null;
  vehicle_type: string;
  capacity_kg: number | null;
  odometer_km: number;
  maint_interval_km: number | null;
  maint_interval_months: number | null;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
};
type DocRow = {
  id: number;
  doc_type: string;
  number: string | null;
  expiry_date: number | null;
};
type MaintRow = {
  id: number;
  maint_type: string;
  service_date: number;
  odometer_km: number;
  next_due_km: number | null;
  next_due_date: number | null;
  status: string;
};

const VEHICLE_STATUSES = [
  { value: "active", label: "Ativo" },
  { value: "in_maintenance", label: "Em manutenção" },
  { value: "retired", label: "Baixado" },
];
export const DOC_TYPES = [
  "CRLV",
  "Licenciamento",
  "Seguro",
  "ANTT",
  "MOPP",
  "Tacógrafo",
  "Inspeção veicular",
  "Outro",
];
export const MAINT_TYPES = [
  "Preventiva",
  "Corretiva",
  "Inspeção",
  "Pneus",
  "Outro",
];
export const vehicleStatusLabel = (value: string) =>
  VEHICLE_STATUSES.find((s) => s.value === value)?.label ?? value;
const DAY = 86400;
const fmt = (epoch: number | null | undefined) =>
  epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : "";
export const fmtDate = fmt;

export const serializeVehicle = (row: VehicleRow) => ({
  id: row.id,
  plate: row.plate,
  renavam: row.renavam ?? "",
  chassis: row.chassis ?? "",
  brand: row.brand,
  model: row.model,
  modelYear: row.model_year ?? null,
  vehicleType: row.vehicle_type,
  capacityKg: row.capacity_kg ?? null,
  odometerKm: row.odometer_km,
  maintIntervalKm: row.maint_interval_km ?? null,
  maintIntervalMonths: row.maint_interval_months ?? null,
  status: row.status,
  statusLabel: vehicleStatusLabel(row.status),
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const computeFleetAlert = (args: {
  vehicle: { odometer_km: number; maint_interval_km: number | null; maint_interval_months: number | null; status: string };
  docs: { doc_type: string; expiry_date: number | null }[];
  lastPreventive: { odometer_km: number; service_date: number } | null;
  today: number;
}) => {
  const { vehicle, docs, lastPreventive, today } = args;
  const items: string[] = [];
  let level: "ok" | "warn" | "danger" = "ok";
  const push = (text: string, severity: "warn" | "danger") => {
    items.push(text);
    if (severity === "danger") level = "danger";
    else if (level === "ok") level = "warn";
  };
  if (vehicle.status === "in_maintenance") push("Veículo em manutenção", "warn");

  // documentos com validade
  const dayStart = Math.floor(today / DAY) * DAY;
  for (const doc of docs) {
    if (!doc.expiry_date) continue;
    const label = doc.doc_type;
    if (doc.expiry_date < dayStart)
      push(`${label} vencido`, "danger");
    else if (doc.expiry_date <= dayStart + 30 * DAY)
      push(
        `${label} vence em ${Math.max(1, Math.ceil((doc.expiry_date - dayStart) / DAY))} dia(s)`,
        "warn",
      );
  }

  // revisão periódica preventiva
  const kmInterval = vehicle.maint_interval_km;
  const monthInterval = vehicle.maint_interval_months;
  if (kmInterval || monthInterval) {
    if (lastPreventive) {
      const nextKm = kmInterval
        ? lastPreventive.odometer_km + kmInterval
        : null;
      if (nextKm !== null) {
        const remaining = nextKm - vehicle.odometer_km;
        if (remaining <= 0)
          push(
            `Revisão periódica em atraso (${Math.abs(remaining)} km além do previsto)`,
            "danger",
          );
        else if (remaining <= Math.max(500, Math.round(kmInterval! * 0.1)))
          push(`Revisão periódica próxima (em ${remaining} km)`, "warn");
      }
      if (monthInterval) {
        const dueMs =
          (lastPreventive.service_date + monthInterval * 30 * DAY) * 1000;
        const days = Math.floor((dueMs - today * 1000) / (DAY * 1000));
        if (days <= 0) push("Revisão periódica em atraso (por tempo)", "danger");
        else if (days <= 15)
          push(`Revisão periódica por tempo em ${days} dia(s)`, "warn");
      }
    } else {
      push(
        `Nenhuma manutenção preventiva registrada (intervalo definido de ${[kmInterval ? `${kmInterval} km` : "", monthInterval ? `${monthInterval} meses` : ""].filter(Boolean).join(" / ")})`,
        "warn",
      );
    }
  }
  return { level, items };
};

export const computeNextDue = (args: {
  vehicle: { maint_interval_km: number | null; maint_interval_months: number | null };
  lastPreventive: { odometer_km: number; service_date: number } | null;
}) => {
  const { vehicle, lastPreventive } = args;
  if (!lastPreventive) return { km: null, date: null };
  return {
    km:
      vehicle.maint_interval_km !== null
        ? lastPreventive.odometer_km + vehicle.maint_interval_km
        : null,
    date:
      vehicle.maint_interval_months !== null
        ? lastPreventive.service_date +
          vehicle.maint_interval_months * 30 * DAY
        : null,
  };
};

type DocFullRow = {
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
  created_at: number;
};
const serializeDocFull = (row: DocFullRow) => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  docType: row.doc_type,
  number: row.number ?? "",
  issuingBody: row.issuing_body ?? "",
  issueDate: fmt(row.issue_date),
  expiryDate: fmt(row.expiry_date),
  fileName: row.file_name ?? "",
  contentType: row.content_type ?? "",
  sizeBytes: row.size_bytes ?? 0,
  notes: row.notes ?? "",
  createdAt: row.created_at,
});

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
  const today = Math.floor(Date.now() / 1000);

  if (Number.isInteger(id) && id > 0) {
    const row = await db
      .prepare("SELECT * FROM vehicles WHERE id=?")
      .bind(id)
      .first<VehicleRow>();
    if (!row)
      return NextResponse.json(
        { error: "Veículo não encontrado" },
        { status: 404 },
      );
    const [docs, maints] = await Promise.all([
      db
        .prepare(
          "SELECT * FROM vehicle_documents WHERE vehicle_id=? ORDER BY expiry_date",
        )
        .bind(id)
        .all<DocFullRow>(),
      db
        .prepare(
          "SELECT * FROM vehicle_maintenance WHERE vehicle_id=? ORDER BY service_date DESC,id DESC",
        )
        .bind(id)
        .all<MaintRow>(),
    ]);
    const lastPreventive = maints.results.find(
      (m) => m.status === "completed" && m.maint_type === "Preventiva",
    );
    const vehicle = serializeVehicle(row);
    const alert = computeFleetAlert({
      vehicle: row,
      docs: docs.results as { doc_type: string; expiry_date: number | null }[],
      lastPreventive: lastPreventive
        ? { odometer_km: lastPreventive.odometer_km, service_date: lastPreventive.service_date }
        : null,
      today,
    });
    return NextResponse.json({
      vehicle,
      documents: docs.results.map(serializeDocFull),
      maintenance: maints.results.map((m) => ({
        id: m.id,
        vehicleId: row.id,
        maintType: m.maint_type,
        serviceDate: fmt(m.service_date),
        odometerKm: m.odometer_km,
        nextDueKm: m.next_due_km,
        nextDueDate: fmt(m.next_due_date),
        status: m.status,
      })),
      alert,
    });
  }

  const vehicles = await db
    .prepare("SELECT * FROM vehicles ORDER BY plate")
    .all<VehicleRow>();
  const ids = vehicles.results.map((v) => v.id);
  let docRows: { vehicle_id: number; doc_type: string; expiry_date: number | null }[] = [],
    maintRows: { vehicle_id: number; maint_type: string; service_date: number; odometer_km: number; status: string }[] = [];
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    [docRows, maintRows] = await Promise.all([
      db
        .prepare(
          `SELECT vehicle_id,doc_type,expiry_date FROM vehicle_documents WHERE vehicle_id IN (${ph})`,
        )
        .bind(...ids)
        .all<{ vehicle_id: number; doc_type: string; expiry_date: number | null }>()
        .then((r) => r.results),
      db
        .prepare(
          `SELECT vehicle_id,maint_type,service_date,odometer_km,status FROM vehicle_maintenance WHERE vehicle_id IN (${ph}) ORDER BY service_date DESC`,
        )
        .bind(...ids)
        .all<{ vehicle_id: number; maint_type: string; service_date: number; odometer_km: number; status: string }>()
        .then((r) => r.results),
    ]);
  }
  const docsByVehicle = new Map<number, typeof docRows>();
  docRows.forEach((d) => {
    const list = docsByVehicle.get(d.vehicle_id) ?? [];
    list.push(d);
    docsByVehicle.set(d.vehicle_id, list);
  });
  const lastByVehicle = new Map<number, (typeof maintRows)[number]>();
  maintRows.forEach((m) => {
    if (!lastByVehicle.has(m.vehicle_id))
      lastByVehicle.set(m.vehicle_id, m);
  });
  const list = vehicles.results.map((row) => {
    const docs = docsByVehicle.get(row.id) ?? [],
      lastMaint = lastByVehicle.get(row.id);
    const alert = computeFleetAlert({
      vehicle: row,
      docs,
      lastPreventive:
        lastMaint?.status === "completed" && lastMaint.maint_type === "Preventiva"
          ? { odometer_km: lastMaint.odometer_km, service_date: lastMaint.service_date }
          : null,
      today,
    });
    return {
      ...serializeVehicle(row),
      documentsCount: docs.length,
      expiredCount: docs.filter(
        (d) => d.expiry_date && d.expiry_date < Math.floor(today / DAY) * DAY,
      ).length,
      expiringSoonCount: docs.filter(
        (d) =>
          d.expiry_date &&
          d.expiry_date >= Math.floor(today / DAY) * DAY &&
          d.expiry_date <= Math.floor(today / DAY) * DAY + 30 * DAY,
      ).length,
      lastMaintenance: lastMaint
        ? {
            type: lastMaint.maint_type,
            date: fmt(lastMaint.service_date),
            odometerKm: lastMaint.odometer_km,
          }
        : null,
      alert,
    };
  });
  let filtered = list;
  if (q) {
    const like = q.toLowerCase();
    filtered = filtered.filter((v) =>
      `${v.plate} ${v.brand} ${v.model} ${v.renavam}`.toLowerCase().includes(like),
    );
  }
  if (status) filtered = filtered.filter((v) => v.status === status);
  const summary = {
    total: vehicles.results.length,
    active: vehicles.results.filter((v) => v.status === "active").length,
    inMaintenance: vehicles.results.filter(
      (v) => v.status === "in_maintenance",
    ).length,
    attention: filtered.filter((v) => v.alert.level !== "ok").length,
    danger: filtered.filter((v) => v.alert.level === "danger").length,
  };
  return NextResponse.json({ vehicles: filtered, summary });
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
    plate = String(body.plate || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .trim(),
    model = String(body.model || "").trim(),
    now = Math.floor(Date.now() / 1000);
  const error = validateVehicleBody(body, plate, model);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const duplicate = await db
    .prepare("SELECT id,plate FROM vehicles WHERE plate=?")
    .bind(plate)
    .first();
  if (duplicate)
    return NextResponse.json(
      { error: `Já existe um veículo com a placa ${plate}.` },
      { status: 409 },
    );
  const created = await db
    .prepare(
      `INSERT INTO vehicles
       (plate,renavam,chassis,brand,model,model_year,vehicle_type,capacity_kg,odometer_km,maint_interval_km,maint_interval_months,status,notes,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    )
    .bind(
      plate,
      String(body.renavam || "").trim(),
      String(body.chassis || "").trim(),
      String(body.brand || "").trim(),
      model,
      body.modelYear ? Number(body.modelYear) : null,
      String(body.vehicleType || "Caminhão"),
      body.capacityKg ? Number(body.capacityKg) : null,
      Number(body.odometerKm ?? 0),
      body.maintIntervalKm ? Number(body.maintIntervalKm) : null,
      body.maintIntervalMonths ? Number(body.maintIntervalMonths) : null,
      String(body.status || "active"),
      String(body.notes || "").trim(),
      actor.userId,
      now,
      now,
    )
    .first<VehicleRow>();
  if (!created)
    return NextResponse.json(
      { error: "Não foi possível cadastrar o veículo" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','vehicle',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({ plate, model }),
      now,
    )
    .run();
  return NextResponse.json(
    { vehicle: serializeVehicle(created) },
    { status: 201 },
  );
}

function validateVehicleBody(
  body: Record<string, unknown>,
  plate: string,
  model: string,
): string | null {
  if (!plate) return "Informe a placa do veículo.";
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate))
    return "Placa inválida. Use o padrão Mercosul (ABC1D23) ou antigo (ABC1234).";
  if (!model) return "Informe o modelo do veículo.";
  if (!["active", "in_maintenance", "retired"].includes(String(body.status ?? "active")))
    return "Situação inválida. Use Ativo, Em manutenção ou Baixado.";
  const odometer = Number(body.odometerKm ?? 0);
  if (!Number.isFinite(odometer) || odometer < 0 || odometer > 9_999_999)
    return "Odômetro (km) inválido.";
  const intervalKm = body.maintIntervalKm ? Number(body.maintIntervalKm) : null;
  if (intervalKm !== null && (!Number.isInteger(intervalKm) || intervalKm < 100))
    return "Intervalo de manutenção (km) deve ser um número inteiro maior que 100.";
  const intervalMonths = body.maintIntervalMonths
    ? Number(body.maintIntervalMonths)
    : null;
  if (
    intervalMonths !== null &&
    (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 60)
  )
    return "Intervalo de manutenção (meses) deve estar entre 1 e 60.";
  const year = body.modelYear ? Number(body.modelYear) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100))
    return "Ano do modelo inválido.";
  const capacity = body.capacityKg ? Number(body.capacityKg) : null;
  if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0 || capacity > 1_000_000))
    return "Capacidade (kg) inválida.";
  return null;
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
    return NextResponse.json({ error: "Veículo inválido" }, { status: 400 });
  const current = await db
    .prepare("SELECT * FROM vehicles WHERE id=?")
    .bind(id)
    .first<VehicleRow>();
  if (!current)
    return NextResponse.json(
      { error: "Veículo não encontrado" },
      { status: 404 },
    );
  const plate = String(body.plate ?? current.plate)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .trim(),
    model = String(body.model ?? current.model).trim(),
    error = validateVehicleBody({ ...body, plate, model }, plate, model);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const duplicate = await db
    .prepare("SELECT id FROM vehicles WHERE plate=? AND id<>?")
    .bind(plate, id)
    .first();
  if (duplicate)
    return NextResponse.json(
      { error: `Já existe um veículo com a placa ${plate}.` },
      { status: 409 },
    );
  const now = Math.floor(Date.now() / 1000),
    updated = await db
      .prepare(
        `UPDATE vehicles SET
         plate=?,renavam=?,chassis=?,brand=?,model=?,model_year=?,vehicle_type=?,capacity_kg=?,odometer_km=?,
         maint_interval_km=?,maint_interval_months=?,status=?,notes=?,updated_at=? WHERE id=? RETURNING *`,
      )
      .bind(
        plate,
        String(body.renavam ?? current.renavam ?? "").trim(),
        String(body.chassis ?? current.chassis ?? "").trim(),
        String(body.brand ?? current.brand ?? "").trim(),
        model,
        body.modelYear !== undefined && body.modelYear !== null && body.modelYear !== ""
          ? Number(body.modelYear)
          : current.model_year,
        String(body.vehicleType ?? current.vehicle_type ?? "Caminhão"),
        body.capacityKg !== undefined && body.capacityKg !== null && body.capacityKg !== ""
          ? Number(body.capacityKg)
          : current.capacity_kg,
        Number(body.odometerKm ?? current.odometer_km),
        body.maintIntervalKm !== undefined && body.maintIntervalKm !== null && body.maintIntervalKm !== ""
          ? Number(body.maintIntervalKm)
          : current.maint_interval_km,
        body.maintIntervalMonths !== undefined && body.maintIntervalMonths !== null && body.maintIntervalMonths !== ""
          ? Number(body.maintIntervalMonths)
          : current.maint_interval_months,
        String(body.status ?? current.status),
        String(body.notes ?? current.notes ?? "").trim(),
        now,
        id,
      )
      .first<VehicleRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar o veículo" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','vehicle',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({ before: { plate: current.plate }, after: { plate } }),
      now,
    )
    .run();
  return NextResponse.json({ vehicle: serializeVehicle(updated) });
}
