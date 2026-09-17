import { NextRequest, NextResponse } from "next/server";
import { getActor } from "../../authz";

type Coordinate = [number, number];
type OptimizationStop = { orderId: number; coordinates: Coordinate; receivingWindow?: string; serviceMinutes?: number | null };

const token = () => process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const timeWindow = (value: string, routeDate: string) => {
  const match = value.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)\D+([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/);
  if (!match) return null;
  const start = `${match[1].padStart(2, "0")}:${match[2]}`;
  const end = `${match[3].padStart(2, "0")}:${match[4]}`;
  if (end <= start) return null;
  return { earliest: `${routeDate}T${start}:00-03:00`, latest: `${routeDate}T${end}:00-03:00`, type: "strict" };
};
const validCoordinate = (value: unknown): value is Coordinate => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

export async function POST(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const accessToken = token();
  if (!accessToken) return NextResponse.json({ error: "Configure MAPBOX_ACCESS_TOKEN para usar a otimização com horários." }, { status: 503 });
  const body = await request.json() as { routeDate?: string; departureTime?: string; origin?: Coordinate; stops?: OptimizationStop[] };
  const routeDate = String(body.routeDate || ""), departureTime = String(body.departureTime || "07:00");
  const stops = Array.isArray(body.stops) ? body.stops : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime) || !validCoordinate(body.origin) || !stops.length || stops.length > 24) return NextResponse.json({ error: "Dados da rota inválidos para otimização." }, { status: 400 });
  if (stops.some(stop => !Number.isInteger(stop.orderId) || stop.orderId <= 0 || !validCoordinate(stop.coordinates))) return NextResponse.json({ error: "Há uma parada sem coordenadas válidas." }, { status: 400 });
  const invalidWindows = stops.filter(stop => stop.receivingWindow?.trim() && !timeWindow(stop.receivingWindow, routeDate));
  if (invalidWindows.length) return NextResponse.json({ error: `Use janelas no formato HH:MM–HH:MM. Revise ${invalidWindows.length} parada(s).` }, { status: 400 });
  const locations = [{ name: "depot", coordinates: body.origin }, ...stops.map((stop, index) => ({ name: `location-${stop.orderId}-${index}`, coordinates: stop.coordinates }))];
  const services = stops.map((stop, index) => {
    const window = stop.receivingWindow?.trim() ? timeWindow(stop.receivingWindow, routeDate) : null;
    return { name: `order-${stop.orderId}`, location: `location-${stop.orderId}-${index}`, duration: Math.max(1, Math.round(Number(stop.serviceMinutes || 20) * 60)), ...(window ? { service_times: [window] } : {}) };
  });
  const problem = { version: 1, locations, vehicles: [{ name: "truck-1", routing_profile: "mapbox/driving-traffic", start_location: "depot", end_location: "depot", earliest_start: `${routeDate}T${departureTime}:00-03:00`, latest_end: `${routeDate}T23:59:00-03:00` }], services, options: { objectives: ["min-total-travel-duration"] } };
  const response = await fetch(`https://api.mapbox.com/optimized-trips/v2?access_token=${encodeURIComponent(accessToken)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(problem), cache: "no-store" });
  const data = await response.json().catch(() => ({})) as { id?: string; message?: string; code?: string };
  if (!response.ok || !data.id) {
    const betaAccess = response.status === 401 || response.status === 403;
    return NextResponse.json({ error: betaAccess ? "O token Mapbox ainda não possui acesso à Optimization v2 Beta." : data.message || data.code || "Não foi possível enviar a otimização." }, { status: betaAccess ? 503 : response.status || 502 });
  }
  return NextResponse.json({ jobId: data.id }, { status: 202 });
}

export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const accessToken = token(), jobId = String(request.nextUrl.searchParams.get("jobId") || "");
  if (!accessToken) return NextResponse.json({ error: "Mapbox não configurado." }, { status: 503 });
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(jobId)) return NextResponse.json({ error: "Identificador da otimização inválido." }, { status: 400 });
  const response = await fetch(`https://api.mapbox.com/optimized-trips/v2/${encodeURIComponent(jobId)}?access_token=${encodeURIComponent(accessToken)}`, { cache: "no-store" });
  if (response.status === 202) return NextResponse.json({ status: "processing" }, { status: 202 });
  const data = await response.json().catch(() => ({})) as { message?: string; dropped?: { services?: string[] }; routes?: { stops?: { type: string; services?: string[]; eta?: string; wait?: number; duration?: number; odometer?: number }[] }[] };
  if (!response.ok) return NextResponse.json({ error: data.message || "Não foi possível consultar a otimização." }, { status: response.status || 502 });
  const dropped = data.dropped?.services ?? [], routeStops = data.routes?.[0]?.stops ?? [];
  if (dropped.length) return NextResponse.json({ error: `${dropped.length} entrega(s) não cabem nas janelas informadas.` }, { status: 409 });
  const schedule = routeStops.flatMap(stop => stop.type === "service" && stop.services?.[0] ? [{ orderId: Number(stop.services[0].replace("order-", "")), eta: stop.eta ?? "", waitMinutes: Math.round(Number(stop.wait || 0) / 60), serviceMinutes: Math.round(Number(stop.duration || 0) / 60) }] : []);
  if (!schedule.length || schedule.some(stop => !Number.isInteger(stop.orderId))) return NextResponse.json({ error: "A solução Mapbox não retornou uma sequência válida." }, { status: 502 });
  const distanceMeters = Math.max(0, ...routeStops.map(stop => Number(stop.odometer || 0)));
  return NextResponse.json({ status: "complete", orderIds: schedule.map(stop => stop.orderId), schedule, distanceKm: distanceMeters / 1000 });
}
