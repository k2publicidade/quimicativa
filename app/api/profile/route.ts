import { NextResponse } from "next/server";
import { getActor } from "../authz";
export async function GET() {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  return NextResponse.json({ name: actor.displayName, role: actor.role });
}
