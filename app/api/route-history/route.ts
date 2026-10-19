import { NextResponse } from "next/server";
import { getActor } from "../authz";
import rows from "../../data/route-history.json";

export async function GET() {
  if (!(await getActor())) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, no-store" } });
}
