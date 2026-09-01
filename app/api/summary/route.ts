import { NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { getActor } from "../authz";

export async function GET() {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  const db = getD1(),
    now = Math.floor(Date.now() / 1000),
    limit = now + 30 * 86400;
  const records = await db
    .prepare(
      "SELECT COUNT(*) total,SUM(CASE WHEN status IN ('pending','review','expired','overdue','critical','failed') THEN 1 ELSE 0 END) attention FROM records WHERE department<>'digitalizacao'",
    )
    .first<{ total: number; attention: number }>();
  const documents = await db
    .prepare(
      "SELECT COUNT(*) total,SUM(CASE WHEN status='review' THEN 1 ELSE 0 END) review,SUM(CASE WHEN expires_at BETWEEN ? AND ? THEN 1 ELSE 0 END) expiring FROM files",
    )
    .bind(now, limit)
    .first<{ total: number; review: number; expiring: number }>();
  const recent = await db
    .prepare(
      "SELECT title,department,module,status,updated_at FROM records WHERE department<>'digitalizacao' ORDER BY updated_at DESC LIMIT 5",
    )
    .all<{
      title: string;
      department: string;
      module: string;
      status: string;
      updated_at: number;
    }>();
  return NextResponse.json({
    metrics: {
      records: records?.total ?? 0,
      attention: records?.attention ?? 0,
      documents: documents?.total ?? 0,
      review: documents?.review ?? 0,
      expiring: documents?.expiring ?? 0,
    },
    recent: recent.results,
  });
}
