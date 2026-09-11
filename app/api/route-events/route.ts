import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

const EVENTS = ["departure", "stop_arrival", "delivery_completed", "delivery_failed", "stop_delay", "return"];
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
  const body = await request.json() as Record<string, unknown>, routeId = Number(body.routeId), eventType = String(body.eventType || ""), db = getD1();
  if (!Number.isInteger(routeId) || routeId <= 0 || !EVENTS.includes(eventType)) return NextResponse.json({ error: "Rota ou tipo de evento inválido" }, { status: 400 });
  const route = await db.prepare("SELECT id,status FROM routes WHERE id=?").bind(routeId).first<{ id: number; status: string }>();
  if (!route) return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
  const timestamp = now(), occurredAt = body.occurredAt ? Math.floor(new Date(String(body.occurredAt)).getTime() / 1000) : timestamp;
  if (!Number.isFinite(occurredAt)) return NextResponse.json({ error: "Data do evento inválida" }, { status: 400 });
  const stopId = body.stopId ? Number(body.stopId) : null, odometerKm = body.odometerKm === undefined ? null : Number(body.odometerKm), fuelLiters = body.fuelLiters === undefined ? null : Number(body.fuelLiters);
  const stop = stopId !== null ? await db.prepare("SELECT id,status FROM route_stops WHERE id=? AND route_id=?").bind(stopId, routeId).first<{ id: number; status: string }>() : null;
  if (stopId !== null && !stop) return NextResponse.json({ error: "Parada não pertence à rota" }, { status: 400 });
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) return NextResponse.json({ error: "Hodômetro inválido" }, { status: 400 });
  if (fuelLiters !== null && (!Number.isFinite(fuelLiters) || fuelLiters < 0)) return NextResponse.json({ error: "Consumo de combustível inválido" }, { status: 400 });
  if (["stop_arrival", "delivery_completed", "delivery_failed", "stop_delay"].includes(eventType) && stopId === null) return NextResponse.json({ error: "Selecione a parada deste evento" }, { status: 400 });
  if (eventType === "departure" && route.status !== "draft") return NextResponse.json({ error: "A saída só pode ser registrada em uma rota planejada." }, { status: 409 });
  if (["stop_arrival", "delivery_completed", "delivery_failed", "stop_delay", "return"].includes(eventType) && route.status !== "active") return NextResponse.json({ error: "Registre a saída antes dos eventos da jornada." }, { status: 409 });
  if (["delivery_completed", "delivery_failed"].includes(eventType) && stop && ["completed", "failed"].includes(stop.status)) return NextResponse.json({ error: "Esta parada já foi encerrada." }, { status: 409 });
  if (eventType === "return") { const pending = await db.prepare("SELECT COUNT(*) AS count FROM route_stops WHERE route_id=? AND status NOT IN ('completed','failed')").bind(routeId).first<{ count: number }>(); if ((pending?.count ?? 0) > 0) return NextResponse.json({ error: "Encerre todas as entregas como concluídas ou não realizadas antes do retorno." }, { status: 409 }); }
  if (odometerKm !== null) { const previous = await db.prepare("SELECT odometer_km FROM route_events WHERE route_id=? AND odometer_km IS NOT NULL ORDER BY occurred_at DESC,id DESC LIMIT 1").bind(routeId).first<{ odometer_km: number }>(); if (previous && odometerKm < previous.odometer_km) return NextResponse.json({ error: `O hodômetro não pode ser menor que o último registro (${previous.odometer_km.toLocaleString("pt-BR")} km).` }, { status: 409 }); }
  const event = await db.prepare("INSERT INTO route_events (route_id,stop_id,event_type,occurred_at,odometer_km,fuel_liters,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *").bind(routeId, stopId, eventType, occurredAt, odometerKm, fuelLiters, String(body.notes || ""), actor.userId, timestamp).first();
  if (eventType === "departure") await db.prepare("UPDATE routes SET status='active',updated_at=? WHERE id=? AND status='draft'").bind(timestamp, routeId).run();
  if (eventType === "return") await db.prepare("UPDATE routes SET status='completed',updated_at=? WHERE id=? AND status='active'").bind(timestamp, routeId).run();
  if (eventType === "stop_arrival" && stopId) await db.prepare("UPDATE route_stops SET status='in_progress',updated_at=? WHERE id=? AND route_id=? AND status='pending'").bind(timestamp, stopId, routeId).run();
  if (eventType === "delivery_completed" && stopId) await db.prepare("UPDATE route_stops SET status='completed',delivered_at=?,updated_at=? WHERE id=? AND route_id=?").bind(occurredAt, timestamp, stopId, routeId).run();
  if (eventType === "delivery_failed" && stopId) await db.prepare("UPDATE route_stops SET status='failed',updated_at=? WHERE id=? AND route_id=?").bind(timestamp, stopId, routeId).run();
  return NextResponse.json({ event }, { status: 201 });
}
