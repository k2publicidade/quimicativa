import { NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { localDay, MAINTENANCE_TYPES, maintenanceDue } from "../../../lib/operations";
import { getActor } from "../authz";
export async function GET() {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  try {
    const db = getD1(), vehicles = await db.prepare("SELECT id,plate,model,odometer_km FROM vehicles WHERE status<>'retired' ORDER BY plate").all<{ id: number; plate: string; model: string; odometer_km: number }>();
    const latest = await db.prepare("SELECT m.* FROM vehicle_maintenance m WHERE m.status='completed' AND m.maint_type IN ('Óleo e filtros','Limpeza geral','Revisão geral') AND NOT EXISTS (SELECT 1 FROM vehicle_maintenance n WHERE n.vehicle_id=m.vehicle_id AND n.maint_type=m.maint_type AND n.status='completed' AND (n.service_date>m.service_date OR (n.service_date=m.service_date AND n.id>m.id)))").all<{ vehicle_id: number; maint_type: string; service_date: number; odometer_km: number }>();
    return NextResponse.json({ vehicles: vehicles.results.map(vehicle => ({ id: vehicle.id, plate: vehicle.plate, model: vehicle.model, odometerKm: vehicle.odometer_km, services: MAINTENANCE_TYPES.map(type => {
      const last = latest.results.find(row => row.vehicle_id === vehicle.id && row.maint_type === type), lastDate = last ? new Date(last.service_date * 1000).toISOString().slice(0, 10) : "";
      const due = last ? maintenanceDue(type, lastDate, last.odometer_km) : { km: null, date: "" };
      const overdue = last ? due.km !== null ? vehicle.odometer_km >= due.km : due.date <= localDay() : false;
      return { type, lastDate, lastKm: last?.odometer_km ?? null, nextKm: due.km, nextDate: due.date, status: !last ? "initial" : overdue ? "overdue" : "ok" };
    }) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Não foi possível carregar a agenda de manutenção." }, { status: 500 }); }
}
