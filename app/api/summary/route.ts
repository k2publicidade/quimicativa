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
  const day = 86400,
    today = Math.floor(now / day) * day,
    inThirty = today + 30 * day;
  const products = await db
      .prepare(
        "SELECT COUNT(*) total,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active FROM products",
      )
      .first<{ total: number; active: number }>(),
    activeFispqs = await db
      .prepare("SELECT product_id,validity_date FROM fispq WHERE status='active'")
      .all<{ product_id: number; validity_date: number | null }>(),
    fispqExpired = activeFispqs.results.filter(
      (row) => row.validity_date && row.validity_date < today,
    ).length,
    fispqExpiring = activeFispqs.results.filter(
      (row) =>
        row.validity_date &&
        row.validity_date >= today &&
        row.validity_date <= inThirty,
    ).length,
    fispqMissing = Math.max(
      0,
      (products?.active ?? 0) - activeFispqs.results.length,
    ),
    lots = await db
      .prepare(
        "SELECT COUNT(*) total,SUM(CASE WHEN expiry_date<today THEN 1 ELSE 0 END) expired,SUM(CASE WHEN expiry_date>=today AND expiry_date<=? THEN 1 ELSE 0 END) expiring FROM (SELECT expiry_date, (SELECT ?) today FROM lots WHERE quantity>0)",
      )
      .bind(inThirty, today)
      .first<{ total: number; expired: number; expiring: number }>(),
    licenses = await db
      .prepare(
        "SELECT COUNT(*) total,SUM(CASE WHEN status='active' AND validity_date<today THEN 1 ELSE 0 END) expired,SUM(CASE WHEN status='active' AND validity_date>=today AND validity_date<=? THEN 1 ELSE 0 END) expiring FROM (SELECT status,validity_date,(SELECT ?) today FROM licenses)",
      )
      .bind(inThirty, today)
      .first<{ total: number; expired: number; expiring: number }>();
  return NextResponse.json({
    metrics: {
      records: records?.total ?? 0,
      attention: records?.attention ?? 0,
      documents: documents?.total ?? 0,
      review: documents?.review ?? 0,
      expiring: documents?.expiring ?? 0,
      products: products?.total ?? 0,
    },
    recent: recent.results,
    compliance: {
      products: products?.active ?? 0,
      fispqMissing,
      fispqExpired,
      fispqExpiring,
      lotsExpired: lots?.expired ?? 0,
      lotsExpiring: lots?.expiring ?? 0,
      licensesExpired: licenses?.expired ?? 0,
      licensesExpiring: licenses?.expiring ?? 0,
      totalAlerts:
        fispqMissing +
        fispqExpired +
        fispqExpiring +
        (lots?.expired ?? 0) +
        (lots?.expiring ?? 0) +
        (licenses?.expired ?? 0) +
        (licenses?.expiring ?? 0),
    },
  });
}
