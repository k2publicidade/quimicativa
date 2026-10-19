import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { count, InputError, overlaps, positiveId, textValue } from "../../../lib/operations";
import { allOperations, encodedText } from "../../../lib/operations-store";
import { canWrite, getActor } from "../authz";

const EVENTS = ["departure", "stop_arrival", "delivery_completed", "delivery_failed", "stop_delay", "return", "route_changed"];
const now = () => Math.floor(Date.now() / 1000);
export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const routeId = Number(request.nextUrl.searchParams.get("routeId"));
  if (!Number.isInteger(routeId) || routeId <= 0) return NextResponse.json({ error: "Informe uma rota válida" }, { status: 400 });
  const events = await getD1().prepare("SELECT * FROM route_events WHERE route_id=? ORDER BY occurred_at,id").bind(routeId).all();
  return NextResponse.json({ events: events.results });
}
export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>, routeId = positiveId(body.routeId), eventType = String(body.eventType || ""), db = getD1();
    if (!routeId || !EVENTS.includes(eventType)) throw new InputError("Rota ou tipo de evento inválido.");
    const route = await db.prepare("SELECT id,status,vehicle_id,route_date,updated_at FROM routes WHERE id=?").bind(routeId).first<{ id: number; status: string; vehicle_id: number; route_date: number; updated_at: number }>();
    if (!route) throw new InputError("Rota não encontrada.", 404);
    const timestamp = now(), occurredAt = body.occurredAt ? Math.floor(new Date(String(body.occurredAt)).getTime() / 1000) : timestamp;
    if (!Number.isFinite(occurredAt) || occurredAt > timestamp + 300) throw new InputError("Informe uma data e hora válidas, até o momento atual.");
    const stopId = body.stopId ? positiveId(body.stopId) : null, odometerKm = body.odometerKm == null ? null : count(body.odometerKm, "Quilometragem", 9_999_999), fuelLiters = body.fuelLiters == null ? null : Number(body.fuelLiters);
    const notes = textValue(body.notes, "Observações", ["route_changed", "return"].includes(eventType));
    const stop = stopId !== null ? await db.prepare("SELECT id,status FROM route_stops WHERE id=? AND route_id=?").bind(stopId, routeId).first<{ id: number; status: string }>() : null;
    if (stopId !== null && !stop) throw new InputError("Parada não pertence à rota.");
    if (fuelLiters !== null && (!Number.isFinite(fuelLiters) || fuelLiters < 0 || fuelLiters > 10000)) throw new InputError("Combustível inválido.");
    if (["departure", "return"].includes(eventType) && odometerKm === null) throw new InputError("Informe a quilometragem do caminhão na saída e no retorno.");
    if (["stop_arrival", "delivery_completed", "delivery_failed", "stop_delay"].includes(eventType) && stopId === null) throw new InputError("Selecione a parada deste evento.");
    if (eventType === "departure" && route.status !== "draft") throw new InputError("A saída só pode ser registrada em uma rota planejada.", 409);
    if (!["departure", "route_changed"].includes(eventType) && route.status !== "active") throw new InputError("Registre a saída antes dos eventos da jornada.", 409);
    if (eventType === "route_changed" && !["draft", "active"].includes(route.status)) throw new InputError("Rota encerrada não aceita alterações.", 409);
    if (["delivery_completed", "delivery_failed"].includes(eventType) && stop && ["completed", "failed"].includes(stop.status)) throw new InputError("Esta parada já foi encerrada.", 409);
    const records = await allOperations(db);
    if (eventType === "departure" && !records.some(row => row.kind === "crew" && row.data.routeId === String(routeId))) throw new InputError("Confirme os ajudantes da saída na ficha da equipe (ou confirme saída sem ajudantes).");
    if (eventType === "departure") {
      const crew = records.find(row => row.kind === "crew" && row.data.routeId === String(routeId))!, routeDay = new Date(route.route_date * 1000).toISOString().slice(0, 10);
      for (const id of crew.data.helperIds.split(",").filter(Boolean)) {
        const helper = records.find(row => row.kind === "employee" && row.id === Number(id));
        if (!helper || helper.status !== "active" || records.some(row => row.kind === "vacation" && row.status === "approved" && row.data.employeeId === id && overlaps(routeDay, routeDay, row.data.start, row.data.end))) throw new InputError("Um dos ajudantes não está disponível para esta saída. Confira a escala e as férias.", 409);
      }
    }
    if (["delivery_completed", "delivery_failed"].includes(eventType)) {
      const report = records.find(row => row.kind === "report" && row.data.stopId === String(stopId));
      if (!report) throw new InputError("Registre primeiro o relatório de retorno deste pedido.", 409);
      if ((eventType === "delivery_completed") !== (report.data.outcome === "completed")) throw new InputError("O encerramento precisa corresponder ao resultado do relatório. Entrega parcial deve ser encerrada como não integral.");
    }
    if (eventType === "return") {
      const stops = await db.prepare("SELECT id,status FROM route_stops WHERE route_id=?").bind(routeId).all<{ id: number; status: string }>();
      if (stops.results.some(stop => !["completed", "failed"].includes(stop.status) || !records.some(row => row.kind === "report" && row.data.stopId === String(stop.id)))) throw new InputError("Encerre todas as paradas e registre o relatório de cada pedido antes do retorno.", 409);
    }
    const previous = await db.prepare("SELECT occurred_at,odometer_km FROM route_events WHERE route_id=? ORDER BY occurred_at DESC,id DESC LIMIT 1").bind(routeId).first<{ occurred_at: number; odometer_km: number | null }>();
    if (previous && occurredAt < previous.occurred_at) throw new InputError("O horário não pode ser anterior ao último evento da rota.");
    if (odometerKm !== null) {
      const truck = await db.prepare("SELECT odometer_km FROM vehicles WHERE id=?").bind(route.vehicle_id).first<{ odometer_km: number }>();
      const lastKm = await db.prepare("SELECT odometer_km FROM route_events WHERE route_id=? AND odometer_km IS NOT NULL ORDER BY occurred_at DESC,id DESC LIMIT 1").bind(routeId).first<{ odometer_km: number }>();
      if (odometerKm < Math.max(truck?.odometer_km || 0, lastKm?.odometer_km || 0)) throw new InputError("A quilometragem não pode diminuir em relação ao caminhão ou à jornada.", 409);
    }
    const nextStatus = eventType === "departure" ? "active" : eventType === "return" ? "completed" : route.status;
    const stopStatus = eventType === "delivery_completed" ? "completed" : eventType === "delivery_failed" ? "failed" : eventType === "stop_arrival" ? "in_progress" : "";
    const blockTag = `$journey_${crypto.randomUUID().replaceAll("-", "")}$`;
    await db.prepare(`DO ${blockTag} DECLARE current_version bigint; truck_km bigint; BEGIN
      SELECT updated_at INTO current_version FROM routes WHERE id=? FOR UPDATE;
      IF current_version IS DISTINCT FROM ? THEN RAISE EXCEPTION 'OPS_CONFLICT'; END IF;
      SELECT odometer_km INTO truck_km FROM vehicles WHERE id=? FOR UPDATE;
      IF ? IS NOT NULL AND truck_km > ? THEN RAISE EXCEPTION 'OPS_ODOMETER'; END IF;
      INSERT INTO route_events (route_id,stop_id,event_type,occurred_at,odometer_km,fuel_liters,notes,created_by,created_at) VALUES (?,?,?,?,?,?,convert_from(decode(?,'hex'),'UTF8'),?,?);
      UPDATE routes SET status=?,updated_at=? WHERE id=?;
      UPDATE route_stops SET status=?,delivered_at=CASE WHEN ?='completed' THEN ? ELSE delivered_at END,updated_at=? WHERE id=? AND route_id=? AND ?<>'';
      UPDATE vehicles SET odometer_km=GREATEST(odometer_km,?),updated_at=? WHERE id=? AND ? IS NOT NULL;
      UPDATE orders SET status='completed',updated_at=? WHERE id=(SELECT order_id FROM route_stops WHERE id=?) AND ?='completed';
    END ${blockTag}`).bind(routeId, route.updated_at, route.vehicle_id, odometerKm, odometerKm,
      routeId, stopId, eventType, occurredAt, odometerKm, fuelLiters, encodedText(`${notes}${eventType === "route_changed" ? `\nRegistrado por ${actor.displayName}` : ""}`), actor.userId, timestamp,
      nextStatus, Math.max(timestamp, route.updated_at + 1), routeId, stopStatus, stopStatus, occurredAt, timestamp, stopId, routeId, stopStatus, odometerKm, timestamp, route.vehicle_id, odometerKm, timestamp, stopId, stopStatus).run();
    return NextResponse.json({ event: { routeId, stopId, eventType, occurredAt, odometerKm } }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && /OPS_CONFLICT|OPS_ODOMETER/.test(error.message)) return NextResponse.json({ error: "A jornada ou o caminhão foi atualizado por outra pessoa. Atualize a tela." }, { status: 409 });
    console.error("route-event", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não foi possível registrar a jornada." }, { status: 500 });
  }
}
